-- Migration: 20261021150000_phase5_tighten_anon_grants.sql
-- Description: Revoke all SELECT and table privileges from PUBLIC and anon on Phase 5 notifications table and views, ensuring strict role isolation.

REVOKE ALL ON public.notifications FROM PUBLIC, anon;
GRANT SELECT ON public.notifications TO authenticated;

REVOKE ALL ON public.v_notifications FROM PUBLIC, anon;
GRANT SELECT ON public.v_notifications TO authenticated;

REVOKE ALL ON public.v_member_dues FROM PUBLIC, anon;
GRANT SELECT ON public.v_member_dues TO authenticated;

REVOKE ALL ON public.v_outstanding_payments FROM PUBLIC, anon;
GRANT SELECT ON public.v_outstanding_payments TO authenticated;
