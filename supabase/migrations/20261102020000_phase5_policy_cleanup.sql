-- Remove legacy permissive policies that would OR-bypass the Phase 5 active-role gates.
BEGIN;

DROP POLICY IF EXISTS packages_select ON public.pt_packages;
DROP POLICY IF EXISTS followups_select ON public.member_followups;

COMMIT;
