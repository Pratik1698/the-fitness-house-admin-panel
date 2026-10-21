-- ============================================================================
-- Migration: 20261021170000_phase6_secure_scheduler_and_job_logging.sql
-- Description: Phase 6 Secure Background Reminder Scheduler & Observability
-- Features:
--   1. Enables pg_cron extension for server-side automated job execution.
--   2. Creates public.reminder_job_logs for execution auditing and observability.
--   3. Implements secure core generator (public.execute_expiry_reminders_core).
--   4. Preserves staff/admin authenticated RPC (public.generate_expiry_reminders).
--   5. Creates dedicated scheduled runner (public.scheduled_daily_expiry_reminders).
--   6. Configures daily 9:00 AM Asia/Kolkata cron schedule (03:30 UTC).
--   7. Provides authenticated status inspection RPC (public.get_latest_reminder_job_status).
--   8. Updates public.v_notifications to mark superseded subscriptions upon renewal.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENABLE PG_CRON EXTENSION
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ----------------------------------------------------------------------------
-- 2. JOB EXECUTION AUDIT LOG TABLE (public.reminder_job_logs)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reminder_job_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name TEXT NOT NULL DEFAULT 'daily_expiry_reminders',
    triggered_by TEXT NOT NULL CHECK (triggered_by IN ('scheduled', 'manual', 'test')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    scanned_count INTEGER DEFAULT 0,
    generated_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Index for fetching latest job execution
CREATE INDEX IF NOT EXISTS idx_reminder_job_logs_latest 
ON public.reminder_job_logs (job_name, started_at DESC);

-- Enable Row Level Security
ALTER TABLE public.reminder_job_logs ENABLE ROW LEVEL SECURITY;

-- Allow only authenticated staff/admin to view job execution logs
DROP POLICY IF EXISTS reminder_job_logs_select ON public.reminder_job_logs;
CREATE POLICY reminder_job_logs_select ON public.reminder_job_logs
    FOR SELECT TO authenticated
    USING (public.get_user_role() IN ('admin', 'staff'));

-- Revoke direct table mutations from all client roles
REVOKE ALL ON public.reminder_job_logs FROM PUBLIC, anon;
GRANT SELECT ON public.reminder_job_logs TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. ENHANCE v_notifications VIEW (Preserve Renewed / Superseded Visibility)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_notifications AS
SELECT 
    n.id,
    n.member_id,
    n.subscription_id,
    m.member_code,
    m.name AS member_name,
    m.phone AS member_phone,
    COALESCE(s.plan_name, 'Membership Plan') AS plan_name,
    COALESCE(s.status, 'inactive') AS subscription_status,
    s.start_date,
    s.expiry_date,
    COALESCE(s.balance, 0.00) AS current_balance,
    n.notification_type,
    n.title,
    n.message,
    n.days_remaining,
    n.target_date,
    n.channel,
    n.status,
    n.read_at,
    n.read_by,
    n.created_at,
    n.updated_at,
    CASE 
        WHEN s.status = 'superseded' THEN true
        WHEN EXISTS (
            SELECT 1 FROM public.member_subscriptions newer_sub
            WHERE newer_sub.member_id = m.id
              AND newer_sub.status = 'active'
              AND newer_sub.expiry_date > s.expiry_date
        ) THEN true
        ELSE false
    END AS is_superseded
FROM public.notifications n
JOIN public.members m ON m.id = n.member_id
LEFT JOIN public.member_subscriptions s ON s.id = n.subscription_id
WHERE m.is_archived = false;

REVOKE ALL ON public.v_notifications FROM PUBLIC, anon;
GRANT SELECT ON public.v_notifications TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. CORE REMINDER GENERATION ENGINE (Internal Security Definer)
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

    -- 3. Scan each non-archived member's latest valid subscription
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

        -- Stage 1: Expired (days_left < 0)
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

        -- Stage 2: Expiry Today (days_left = 0)
        ELSIF v_days_left = 0 THEN
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

        -- Stage 3 & 4: Approaching Expiry (5 days and 3 days before)
        ELSE
            -- 5 Days Before Expiry
            IF v_days_left <= 5 THEN
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

            -- 3 Days Before Expiry
            IF v_days_left <= 3 THEN
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
        END IF;

        -- Stage 5: Outstanding Balance Due Alert (positive balance)
        IF v_sub.balance > 0.00 THEN
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

    -- 4. Mark job log as succeeded
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

-- ----------------------------------------------------------------------------
-- 5. USER-FACING AUTHENTICATED RPC (public.generate_expiry_reminders)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_expiry_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_role TEXT;
BEGIN
    -- 1. Strictly verify user authentication
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
    END IF;

    -- 2. Verify staff or admin role
    v_role := public.get_user_role();
    IF v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'FORBIDDEN: Insufficient permissions to generate reminders.' USING ERRCODE = '42501';
    END IF;

    -- 3. Execute core logic with manual audit trigger
    RETURN public.execute_expiry_reminders_core('manual');
END;
$$;

REVOKE ALL ON FUNCTION public.generate_expiry_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_expiry_reminders() TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. DEDICATED SCHEDULED RUNNER (public.scheduled_daily_expiry_reminders)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scheduled_daily_expiry_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Called exclusively by pg_cron or server-side automation
    PERFORM public.execute_expiry_reminders_core('scheduled');
END;
$$;

-- Narrow authorization: strictly restricted to database superuser / internal runner
REVOKE ALL ON FUNCTION public.scheduled_daily_expiry_reminders() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. CONFIGURE DAILY 9:00 AM IST CRON JOB (03:30 UTC)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    -- Unschedule existing job if already registered to ensure idempotent registration
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-expiry-reminders-9am-ist') THEN
        PERFORM cron.unschedule('daily-expiry-reminders-9am-ist');
    END IF;

    -- 9:00 AM Asia/Kolkata (IST = UTC+5:30) corresponds to 03:30 UTC
    PERFORM cron.schedule(
        'daily-expiry-reminders-9am-ist',
        '30 3 * * *',
        'SELECT public.scheduled_daily_expiry_reminders();'
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. AUTHORIZED JOB STATUS INSPECTION RPC (public.get_latest_reminder_job_status)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_latest_reminder_job_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role TEXT;
    v_latest RECORD;
BEGIN
    -- Verify caller authorization
    v_role := public.get_user_role();
    IF v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'FORBIDDEN: Insufficient permissions to inspect job logs.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_latest
    FROM public.reminder_job_logs
    WHERE job_name = 'daily_expiry_reminders'
    ORDER BY started_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'has_run', false,
            'message', 'No previous execution recorded.'
        );
    END IF;

    RETURN jsonb_build_object(
        'has_run', true,
        'id', v_latest.id,
        'job_name', v_latest.job_name,
        'triggered_by', v_latest.triggered_by,
        'started_at', v_latest.started_at,
        'finished_at', v_latest.finished_at,
        'status', v_latest.status,
        'scanned_count', v_latest.scanned_count,
        'generated_count', v_latest.generated_count,
        'error_message', v_latest.error_message
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_latest_reminder_job_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_latest_reminder_job_status() TO authenticated;
