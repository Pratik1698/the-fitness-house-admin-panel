-- This view exposes member follow-up operations; apply the table's active-role RLS policies.
BEGIN;

ALTER VIEW public.v_member_followups SET (security_invoker = true);

COMMIT;
