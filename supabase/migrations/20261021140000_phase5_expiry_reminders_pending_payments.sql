-- ============================================================================
-- Migration: 20261021140000_phase5_expiry_reminders_pending_payments.sql
-- Description: Phase 5: Persistent Membership Expiry Reminders & Pending Payments
-- Author: Senior Supabase/PostgreSQL Engineer
-- Timezone Standard: Asia/Kolkata
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. NOTIFICATIONS TABLE (IDEMPOTENT, IMMUTABLE EVENT IDENTITY, RLS-PROTECTED)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES public.member_subscriptions(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL CHECK (notification_type IN (
        'expiry_5d',
        'expiry_3d',
        'expiry_today',
        'expired',
        'payment_due',
        'general'
    )),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    days_remaining INTEGER,
    target_date DATE NOT NULL,
    channel TEXT NOT NULL DEFAULT 'In-App' CHECK (channel IN ('In-App', 'WhatsApp', 'SMS')),
    status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'archived')),
    read_at TIMESTAMPTZ,
    read_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_notifications_sub_type UNIQUE (subscription_id, notification_type)
);

-- Indexing for high-performance dashboard & notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_member_id ON public.notifications(member_id);
CREATE INDEX IF NOT EXISTS idx_notifications_subscription_id ON public.notifications(subscription_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON public.notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON public.notifications(notification_type);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Drop previous policies if any
DROP POLICY IF EXISTS "notifications_select" ON public.notifications;

-- RLS Policy: Authenticated staff and admins can read notifications
CREATE POLICY "notifications_select" ON public.notifications
    FOR SELECT TO authenticated
    USING (get_user_role() = ANY (ARRAY['admin'::text, 'staff'::text]));

-- Revoke all direct writes from client roles
REVOKE INSERT, UPDATE, DELETE ON public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;


-- ----------------------------------------------------------------------------
-- 2. NOTIFICATIONS VIEW (v_notifications)
-- Resolves member identity, current subscription details, and superseded status
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
        ELSE false
    END AS is_superseded
FROM public.notifications n
JOIN public.members m ON m.id = n.member_id
LEFT JOIN public.member_subscriptions s ON s.id = n.subscription_id
WHERE m.is_archived = false;

REVOKE ALL ON public.v_notifications FROM PUBLIC, anon;
GRANT SELECT ON public.v_notifications TO authenticated;


-- ----------------------------------------------------------------------------
-- 3. OUTSTANDING PAYMENTS VIEWS (v_member_dues & v_outstanding_payments)
-- Authoritative financial views based on member_subscriptions and payments ledger
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_member_dues AS
SELECT 
    m.id AS member_id,
    m.member_code,
    m.name AS member_name,
    m.phone,
    m.email,
    m.is_archived,
    s.id AS subscription_id,
    s.plan_name,
    s.start_date,
    s.expiry_date,
    s.total_liability AS total_amount_due,
    s.amount_paid,
    s.balance AS outstanding_balance,
    s.payment_status,
    s.status AS subscription_status
FROM public.members m
JOIN LATERAL (
    SELECT sub.*
    FROM public.member_subscriptions sub
    WHERE sub.member_id = m.id AND sub.status = 'active'
    ORDER BY sub.expiry_date DESC
    LIMIT 1
) s ON true
WHERE m.is_archived = false;

REVOKE ALL ON public.v_member_dues FROM PUBLIC, anon;
GRANT SELECT ON public.v_member_dues TO authenticated;


CREATE OR REPLACE VIEW public.v_outstanding_payments AS
SELECT *
FROM public.v_member_dues
WHERE outstanding_balance > 0.00;

REVOKE ALL ON public.v_outstanding_payments FROM PUBLIC, anon;
GRANT SELECT ON public.v_outstanding_payments TO authenticated;


-- ----------------------------------------------------------------------------
-- 4. SERVER-SIDE REMINDER GENERATOR RPC (public.generate_expiry_reminders)
-- Idempotent, concurrency-safe, security definer function operating in Asia/Kolkata
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
    v_today DATE;
    v_sub RECORD;
    v_days_left INTEGER;
    v_generated_count INTEGER := 0;
    v_scanned_count INTEGER := 0;
BEGIN
    -- 1. Verify Authentication & Role
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_role := public.get_user_role();
    IF v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'FORBIDDEN: Insufficient permissions to generate reminders.' USING ERRCODE = '42501';
    END IF;

    -- 2. Determine Local Gym Date in Asia/Kolkata Timezone
    v_today := (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;

    -- 3. Scan each non-archived member's latest valid subscription
    -- Excludes superseded and cancelled subscriptions
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

    RETURN jsonb_build_object(
        'scanned_members', v_scanned_count,
        'generated_reminders', v_generated_count,
        'calculation_date', v_today
    );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_expiry_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_expiry_reminders() TO authenticated;


-- ----------------------------------------------------------------------------
-- 5. READ-STATE MUTATION RPCS (mark_notification_read, mark_all_notifications_read)
-- Authorized security definer functions to mutate read states safely
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_role TEXT;
    v_row RECORD;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_role := public.get_user_role();
    IF v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'FORBIDDEN: Insufficient permissions.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.notifications
    SET status = 'read',
        read_at = clock_timestamp(),
        read_by = v_actor_id,
        updated_at = clock_timestamp()
    WHERE id = p_notification_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Notification record does not exist.' USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_row.id,
        'status', v_row.status,
        'read_at', v_row.read_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notification_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_role TEXT;
    v_updated_count INTEGER := 0;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_role := public.get_user_role();
    IF v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'FORBIDDEN: Insufficient permissions.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.notifications
    SET status = 'read',
        read_at = clock_timestamp(),
        read_by = v_actor_id,
        updated_at = clock_timestamp()
    WHERE status = 'unread';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'updated_count', v_updated_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;
