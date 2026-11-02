-- ============================================================================
-- Phase 4: Reminder Automation Schema, Settings Singleton & Parameterized Engine
-- File: 20261102000002_phase4_reminder_settings_and_triggers.sql
-- 
-- Description:
-- 1. Updates public.notifications notification_type CHECK constraint to support 'expiry_1d'.
-- 2. Creates singleton public.reminder_settings table with strict RLS and default row.
-- 3. Parameterizes public.execute_expiry_reminders_core(p_triggered_by TEXT) to honor
--    user preferences stored in public.reminder_settings while preserving expired
--    tracking, deduplication, audit logging, and security properties.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. NOTIFICATION CONSTRAINT UPDATE
-- Safely drop existing check constraint on notification_type and re-add with 'expiry_1d'
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu 
          ON tc.constraint_name = ccu.constraint_name
         AND tc.table_schema = ccu.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'notifications'
          AND tc.constraint_type = 'CHECK'
          AND ccu.column_name = 'notification_type'
    ) LOOP
        EXECUTE 'ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
    END LOOP;

    -- Re-add constraint with all existing valid types + 'expiry_1d'
    ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_notification_type_check
    CHECK (notification_type IN (
        'expiry_5d',
        'expiry_3d',
        'expiry_1d',
        'expiry_today',
        'expired',
        'payment_due',
        'general'
    ));
END $$;

-- ----------------------------------------------------------------------------
-- 2. SINGLETON REMINDER SETTINGS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reminder_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    singleton_guard BOOLEAN NOT NULL DEFAULT true UNIQUE CHECK (singleton_guard = true),
    five_day BOOLEAN NOT NULL DEFAULT true,
    three_day BOOLEAN NOT NULL DEFAULT true,
    one_day BOOLEAN NOT NULL DEFAULT true,
    expiry_day BOOLEAN NOT NULL DEFAULT true,
    payment_alerts BOOLEAN NOT NULL DEFAULT true,
    auto_whatsapp BOOLEAN NOT NULL DEFAULT false,
    sms_fallback BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Seed singleton configuration row idempotently
INSERT INTO public.reminder_settings (
    singleton_guard, five_day, three_day, one_day, expiry_day,
    payment_alerts, auto_whatsapp, sms_fallback
) VALUES (
    true, true, true, true, true,
    true, false, false
) ON CONFLICT (singleton_guard) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE public.reminder_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "reminder_settings_select" ON public.reminder_settings;
CREATE POLICY "reminder_settings_select" ON public.reminder_settings
    FOR SELECT TO authenticated
    USING (public.get_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS "reminder_settings_update" ON public.reminder_settings;
CREATE POLICY "reminder_settings_update" ON public.reminder_settings
    FOR UPDATE TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Permissions: authenticated can read and update (gated by RLS); direct client insert/delete prohibited
GRANT SELECT, UPDATE ON public.reminder_settings TO authenticated;
REVOKE INSERT, DELETE ON public.reminder_settings FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. PARAMETERIZE CORE REMINDER ENGINE (public.execute_expiry_reminders_core)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_expiry_reminders_core(p_triggered_by TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_log_id UUID;
    v_today DATE;
    v_sub RECORD;
    v_days_left INTEGER;
    v_generated_count INTEGER := 0;
    v_scanned_count INTEGER := 0;

    -- Explicitly initialize default triggers as enabled (fail-safe for missing row)
    v_cfg_five_day BOOLEAN := true;
    v_cfg_three_day BOOLEAN := true;
    v_cfg_one_day BOOLEAN := true;
    v_cfg_expiry_day BOOLEAN := true;
    v_cfg_payment_alerts BOOLEAN := true;
BEGIN
    -- 1. Insert running log entry
    INSERT INTO public.reminder_job_logs (
        job_name,
        triggered_by,
        started_at,
        status
    ) VALUES (
        'daily_expiry_reminders',
        p_triggered_by,
        clock_timestamp(),
        'running'
    ) RETURNING id INTO v_log_id;

    -- 2. Determine local gym date in Asia/Kolkata timezone
    v_today := (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;

    -- 3. Load active settings from singleton table (if present)
    SELECT 
        COALESCE(five_day, true),
        COALESCE(three_day, true),
        COALESCE(one_day, true),
        COALESCE(expiry_day, true),
        COALESCE(payment_alerts, true)
    INTO 
        v_cfg_five_day,
        v_cfg_three_day,
        v_cfg_one_day,
        v_cfg_expiry_day,
        v_cfg_payment_alerts
    FROM public.reminder_settings
    LIMIT 1;

    -- 4. Scan each non-archived member's latest valid subscription
    FOR v_sub IN
        SELECT 
            m.id AS member_id,
            m.member_code,
            m.name AS member_name,
            m.phone,
            s.id AS subscription_id,
            s.plan_name,
            s.start_date,
            s.expiry_date,
            s.total_liability,
            s.amount_paid,
            s.balance,
            s.status AS subscription_status
        FROM public.members m
        JOIN LATERAL (
            SELECT sub.*
            FROM public.member_subscriptions sub
            WHERE sub.member_id = m.id 
              AND sub.status IN ('active', 'expired')
            ORDER BY sub.expiry_date DESC
            LIMIT 1
        ) s ON true
        WHERE m.is_archived = false
    LOOP
        v_scanned_count := v_scanned_count + 1;
        v_days_left := v_sub.expiry_date - v_today;

        -- Stage 1: Expired (days_left < 0) - Always tracked regardless of settings
        IF v_days_left < 0 THEN
            INSERT INTO public.notifications (
                member_id, subscription_id, notification_type,
                title, message, days_remaining, target_date, channel
            ) VALUES (
                v_sub.member_id, v_sub.subscription_id, 'expired',
                'Membership Expired', 'Membership has expired.',
                v_days_left, v_sub.expiry_date, 'In-App'
            )
            ON CONFLICT (subscription_id, notification_type) DO NOTHING;

            IF FOUND THEN
                v_generated_count := v_generated_count + 1;
            END IF;

        -- Stage 2: Expiry Today (days_left = 0) - Controlled by expiry_day
        ELSIF v_days_left = 0 THEN
            IF v_cfg_expiry_day IS TRUE THEN
                INSERT INTO public.notifications (
                    member_id, subscription_id, notification_type,
                    title, message, days_remaining, target_date, channel
                ) VALUES (
                    v_sub.member_id, v_sub.subscription_id, 'expiry_today',
                    'Membership Expires Today', 'Membership expires today.',
                    0, v_sub.expiry_date, 'In-App'
                )
                ON CONFLICT (subscription_id, notification_type) DO NOTHING;

                IF FOUND THEN
                    v_generated_count := v_generated_count + 1;
                END IF;
            END IF;

        -- Stages 3, 4, 4b: Approaching Expiry (positive days_left only)
        ELSE
            -- 5 Days Before Expiry (controlled by five_day)
            IF v_days_left <= 5 AND (v_cfg_five_day IS TRUE) THEN
                INSERT INTO public.notifications (
                    member_id, subscription_id, notification_type,
                    title, message, days_remaining, target_date, channel
                ) VALUES (
                    v_sub.member_id, v_sub.subscription_id, 'expiry_5d',
                    'Membership Expiring in 5 Days', 'Membership expires in 5 days.',
                    v_days_left, v_sub.expiry_date, 'In-App'
                )
                ON CONFLICT (subscription_id, notification_type) DO NOTHING;

                IF FOUND THEN
                    v_generated_count := v_generated_count + 1;
                END IF;
            END IF;

            -- 3 Days Before Expiry (controlled by three_day)
            IF v_days_left <= 3 AND (v_cfg_three_day IS TRUE) THEN
                INSERT INTO public.notifications (
                    member_id, subscription_id, notification_type,
                    title, message, days_remaining, target_date, channel
                ) VALUES (
                    v_sub.member_id, v_sub.subscription_id, 'expiry_3d',
                    'Membership Expiring in 3 Days', 'Membership expires in 3 days.',
                    v_days_left, v_sub.expiry_date, 'In-App'
                )
                ON CONFLICT (subscription_id, notification_type) DO NOTHING;

                IF FOUND THEN
                    v_generated_count := v_generated_count + 1;
                END IF;
            END IF;

            -- 1 Day Before Expiry (controlled by one_day)
            IF v_days_left <= 1 AND (v_cfg_one_day IS TRUE) THEN
                INSERT INTO public.notifications (
                    member_id, subscription_id, notification_type,
                    title, message, days_remaining, target_date, channel
                ) VALUES (
                    v_sub.member_id, v_sub.subscription_id, 'expiry_1d',
                    'Membership Expiring in 1 Day', 'Membership expires in 1 day. Please renew your pass.',
                    v_days_left, v_sub.expiry_date, 'In-App'
                )
                ON CONFLICT (subscription_id, notification_type) DO NOTHING;

                IF FOUND THEN
                    v_generated_count := v_generated_count + 1;
                END IF;
            END IF;
        END IF;

        -- Stage 5: Outstanding Balance Due Alert (controlled by payment_alerts)
        IF v_sub.balance > 0.00 AND (v_cfg_payment_alerts IS TRUE) THEN
            INSERT INTO public.notifications (
                member_id, subscription_id, notification_type,
                title, message, days_remaining, target_date, channel
            ) VALUES (
                v_sub.member_id, v_sub.subscription_id, 'payment_due',
                'Pending Payment Due', 'Outstanding balance of ₹' || v_sub.balance::text || ' due on ' || v_sub.plan_name || '.',
                v_days_left, v_sub.expiry_date, 'In-App'
            )
            ON CONFLICT (subscription_id, notification_type) DO NOTHING;

            IF FOUND THEN
                v_generated_count := v_generated_count + 1;
            END IF;
        END IF;
    END LOOP;

    -- 5. Mark job log as succeeded
    UPDATE public.reminder_job_logs
    SET finished_at = clock_timestamp(),
        status = 'succeeded',
        scanned_count = v_scanned_count,
        generated_count = v_generated_count
    WHERE id = v_log_id;

    RETURN jsonb_build_object(
        'success', true,
        'scanned_members', v_scanned_count,
        'generated_reminders', v_generated_count,
        'calculation_date', v_today,
        'log_id', v_log_id
    );

EXCEPTION WHEN OTHERS THEN
    -- In case of unexpected database failure, record failed state safely
    UPDATE public.reminder_job_logs
    SET finished_at = clock_timestamp(),
        status = 'failed',
        error_message = SUBSTRING(SQLERRM FROM 1 FOR 500)
    WHERE id = v_log_id;
    RAISE;
END;
$$;

-- Narrow authorization: only accessible internally to postgres/service_role
REVOKE ALL ON FUNCTION public.execute_expiry_reminders_core(TEXT) FROM PUBLIC, anon, authenticated;

