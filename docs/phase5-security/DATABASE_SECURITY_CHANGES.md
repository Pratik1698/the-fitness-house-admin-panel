# Phase 5 Database Security Changes

## Local migration sequence

| Version | Change |
|---|---|
| `20261102000003` | Staff active/deactivation fields, invitations and append-only security audit, invitation lifecycle RPCs, guarded role helpers, staff/admin access policies and views, staff operational reporting. Existing views use `CREATE OR REPLACE`, not cascade drops. |
| `20261102010000` | Scoped grants, safe definer paths, idempotency and financial response masking, invitation eligibility/audit trigger, admin PT finance view. Payment functions defer ledger totals to the payment trigger and do not assign generated columns. |
| `20261102020000` | Drops stale `packages_select` and duplicate `followups_select` permissive policies. |
| `20261102030000` | Sets `v_member_followups` to `security_invoker=true` so base-table RLS applies. |
| `20261102040000` | Requires an active staff/admin caller for check-in/check-out/cancel and PT-session RPCs. |
| `20261102050000` | Corrects the staff summary to count PT session rows by `conducted_at`, the actual session timestamp column. |

All migration files execute in a transaction. The clean local replay applied **21 repository migrations** through `20261102050000` on PostgreSQL `17.11`.

## Security behavior

| Surface | Final behavior |
|---|---|
| Dues/PT dues/renewal idempotency | Non-empty key required; actor/operation/key transaction advisory lock precedes cache read; payload hash mismatch rejected; response stored transactionally. Concurrent identical requests return the same response and create one corresponding ledger/renewal operation. |
| Payment ledger | `trg_sync_payment_balances` is the single writer for paid totals. Generated balance/status columns are read-only outputs. Renewal initializes paid amount at zero; its optional payment row updates the new contract through the trigger. |
| Onboarding/PT assignment cache | Full response is cached for stable retries; staff responses remove financial keys on both cache-hit and fresh-result paths. |
| PT assignment table | Staff receive operational column access only. PT fee, amount paid, credit adjustments, balance, and payment status are not granted. Admin finance is provided through `v_admin_pt_assignments` with an `is_admin()` predicate. |
| Member financial tables | Payments and subscriptions have admin-only row policies. Staff views mask amounts or return no financial rows. `idempotency_keys` has no direct API grant. |
| Sensitive views | Owner-rights views use explicit active-role predicates/masking plus `security_barrier` where applicable. `v_member_followups` is an invoker view so its table RLS applies. Barriers are not treated as authorization. |
| RLS policies | Stale permissive PT-package and duplicate follow-up policies are removed; unknown hosted policies are rejected by the separate production preflight. |
| Definer functions | Project functions have explicit safe search paths. PUBLIC/anon execution is revoked; explicit service-role function ACLs are preserved. Trigger-only functions keep triggers but have direct authenticated execution revoked. |
| Service role | Direct access to sensitive application tables/views is revoked; append-only audit-log insertion is granted for external-action audit events. Local PostgreSQL tests verified insert allowed and sensitive reads denied. |
| Invitations | Role lookup is read-only; only explicit acceptance can activate a valid linked staff invitation. Expiry, revocation, wrong email, staff-only role, last-admin/self-change controls, and audit events are enforced. |
| Operational RPCs | Active staff/admin can use attendance and PT operations. Inactive accounts cannot use definer RPCs to bypass RLS. |

## PostgreSQL validation

The clean local replay validated every migration against a fresh disposable schema. The actual PostgreSQL suite passed the catalog, role/workflow, and concurrency groups. It exercised `anon`, active admin, a second admin using the same key, active staff, inactive staff, pending invitees, and `service_role` using real `SET ROLE` sessions plus Supabase JWT claim settings.

The standalone forward bundle passed its strict preflight and a second apply on the same local schema, with no data migration and no ledger change. This establishes repeatability only for the verified local schema, not compatibility with hosted production.

## Hosted activation boundary

`supabase/production-migrations/20261102_phase5_security_forward.sql` is intentionally outside `supabase/migrations`, is not auto-applied, and contains no `DROP ... CASCADE`. Its preflight requires PostgreSQL 15+, exact financial generated-column contracts, the expected view columns and existing follow-up/attendance views, compatible function overloads, required sequences, and no unknown sensitive-table RLS policies. Any mismatch raises an exception before Phase 5 DDL; later DDL is in the same transaction and rolls back on error.

Hosted schemas, view dependencies, function bodies/signatures/ACLs, and policy inventory were not queried in this task. The user-provided prior hosted observations are not independently verified. Use the read-only DBA inventory and deployment order in [PRODUCTION_ACTIVATION_CHECKLIST.md](PRODUCTION_ACTIVATION_CHECKLIST.md) before production use.
