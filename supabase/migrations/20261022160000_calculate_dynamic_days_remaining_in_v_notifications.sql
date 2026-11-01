-- ============================================================================
-- Migration: 20261022160000_calculate_dynamic_days_remaining_in_v_notifications.sql
-- Description: Recreates public.v_notifications to compute days_remaining dynamically
--              in Asia/Kolkata timezone from target_date / expiry_date relative to CURRENT_DATE.
-- Status: Prepared for user review; NOT applied to production without approval.
-- ============================================================================

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
    CASE 
        WHEN COALESCE(n.target_date, s.expiry_date) IS NOT NULL THEN
            (COALESCE(n.target_date, s.expiry_date) - (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date)
        ELSE n.days_remaining
    END AS days_remaining,
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
