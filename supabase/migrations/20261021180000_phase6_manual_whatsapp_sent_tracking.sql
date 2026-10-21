-- ============================================================================
-- Migration: 20261021180000_phase6_manual_whatsapp_sent_tracking.sql
-- Description: Adds manual WhatsApp message-sent tracking to public.notifications
--              and public.v_notifications without altering existing financial,
--              attendance, membership, or unread/read state semantics.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. ADD WHATSAPP TRACKING COLUMNS TO public.notifications
-- ----------------------------------------------------------------------------
ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS whatsapp_sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_whatsapp_sent_at 
    ON public.notifications(whatsapp_sent_at);

-- ----------------------------------------------------------------------------
-- 2. RECREATE public.v_notifications VIEW (EXPOSE SENT AUDIT DATA)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_notifications;

CREATE VIEW public.v_notifications AS
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
    END AS is_superseded,
    n.whatsapp_sent_at,
    n.whatsapp_sent_by,
    sent_staff.full_name AS whatsapp_sent_by_name
FROM public.notifications n
JOIN public.members m ON m.id = n.member_id
LEFT JOIN public.member_subscriptions s ON s.id = n.subscription_id
LEFT JOIN public.profiles sent_staff ON sent_staff.id = n.whatsapp_sent_by
WHERE m.is_archived = false;

REVOKE ALL ON public.v_notifications FROM PUBLIC, anon;
GRANT SELECT ON public.v_notifications TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. STAFF ACTION RPC: public.mark_notification_whatsapp_sent
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_notification_whatsapp_sent(p_notification_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_role TEXT;
    v_row RECORD;
    v_actor_name TEXT;
BEGIN
    -- 1. Strictly verify authentication
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
    END IF;

    -- 2. Verify staff or admin role
    v_role := public.get_user_role();
    IF v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'FORBIDDEN: Insufficient permissions.' USING ERRCODE = '42501';
    END IF;

    -- 3. Update only WhatsApp tracking fields (separate from read status!)
    UPDATE public.notifications
    SET whatsapp_sent_at = clock_timestamp(),
        whatsapp_sent_by = v_actor_id,
        updated_at = clock_timestamp()
    WHERE id = p_notification_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Notification record does not exist.' USING ERRCODE = 'P0002';
    END IF;

    -- Retrieve staff name for immediate UI feedback
    SELECT full_name INTO v_actor_name 
    FROM public.profiles 
    WHERE id = v_actor_id;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_row.id,
        'whatsapp_sent_at', v_row.whatsapp_sent_at,
        'whatsapp_sent_by', v_row.whatsapp_sent_by,
        'whatsapp_sent_by_name', COALESCE(v_actor_name, 'Staff')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notification_whatsapp_sent(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_whatsapp_sent(UUID) TO authenticated;

COMMIT;
