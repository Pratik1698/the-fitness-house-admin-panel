# Phase 5 Remediation Report

## Database changes

- Corrected `20261102000003_phase5_staff_security_and_invitations.sql` to use dependency-preserving `CREATE OR REPLACE VIEW` statements and stable view column contracts.
- Added `20261102010000_phase5_security_audit_remediation.sql` for idempotency, generated-ledger correctness, role grants, audit logging, view access, and safe `SECURITY DEFINER` paths.
- Added `20261102020000_phase5_policy_cleanup.sql` to remove permissive PT-package and duplicate follow-up policies that could widen access through PostgreSQL's policy OR behavior.
- Added `20261102030000_phase5_followup_view_security.sql` to enable invoker RLS on the member follow-up view.
- Added `20261102040000_phase5_active_role_operational_rpcs.sql` to require active staff/admin status for attendance and PT operational definer RPCs.
- Added `20261102050000_phase5_staff_summary_schema_fix.sql` to count PT sessions from the actual `conducted_at` column.
- Payment ledger triggers now update the writable `amount_paid` fields once; RPCs no longer assign generated `balance` or `payment_status` fields. Renewal writes `previous_balance_carried` and lets a new payment ledger row update its paid amount.

## Application and Edge Functions

- `src/services/authService.js`, `src/context/AppContext.jsx`, and `src/pages/Login.jsx`: role lookup is read-only and invitation acceptance is explicit.
- `src/services/ptService.js` and `src/pages/PersonalTraining.jsx`: staff query operational PT columns only; admins use the guarded financial view.
- `src/services/staffService.js`: roster source is role-aware and staff results remain email-free.
- `supabase/functions/invite-staff/index.ts`: authorization-sensitive RPCs preserve the caller JWT; service role handles Auth administration/audit actions, and partial external-action results are surfaced.
- `supabase/functions/manage-staff-session/index.ts`: authenticated caller context is required for session management; privileged Auth operations remain separated.

No Edge Function was deployed, and no real email, invitation, SMS, or WhatsApp action occurred.

## Local PostgreSQL completion

The exact disposable container was verified before every database mutation. Its `public` schema was reset and all **21** repository migrations replayed in filename order. Final ledger version: `20261102050000`. The missing `supabase/seed.sql` was not loaded; tests create isolated fixtures instead.

The real PostgreSQL tests found and fixed two runtime defects that source tests had not detected: writes to generated financial columns (including double ledger updates) and a staff summary query for nonexistent PT session columns. The final role/workflow and concurrency tests passed on the clean replay.

## Production-forward migration

Prepared [20261102_phase5_security_forward.sql](../../supabase/production-migrations/20261102_phase5_security_forward.sql), separate from `supabase/migrations`. It bundles the current Phase 5 forward changes in one transaction behind strict PostgreSQL, relation/column/generated-type, view-column, function-signature, sequence, and RLS-policy checks. It was applied a second time to the matching local database successfully, confirming local repeatability. It has **not** been applied to hosted Supabase.

Hosted schema details remain a production blocker until a DBA runs the read-only catalog inventory in [the production checklist](PRODUCTION_ACTIVATION_CHECKLIST.md) and confirms it matches the migration preflight. The file intentionally aborts on unknown structures or policies.

## Files changed

Application and Edge Function changes are in `src/context/AppContext.jsx`, `src/pages/Login.jsx`, `src/pages/PersonalTraining.jsx`, `src/services/authService.js`, `src/services/ptService.js`, `src/services/staffService.js`, and the two staff Edge Functions. Database changes are in the six Phase 5 migrations listed above. Test changes are in `tests/staff_security.test.js`, `tests/phase5_security_contracts.test.js`, and `tests/phase5_postgres.integration.test.js`. The five `docs/phase5-security/` reports are updated.

## Preservation and deployment status

The local schema reset affected only the disposable local database that the user explicitly authorized. Test fixture work rolled back or was cleaned up. No production rows, schema, migration history, secrets, or hosted settings were accessed or changed. Production deployment remains pending the catalog preflight, DBA/security approval, backup/restore point, and the reviewed sequence in the activation checklist.
