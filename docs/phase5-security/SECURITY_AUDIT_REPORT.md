# Phase 5 Security Audit Report

## Scope and verified environment

Reviewed React authentication and staff/PT workflows, Supabase Edge Functions, every repository migration, source tests, and the local PostgreSQL catalog. No `.env` file was read. No hosted Supabase endpoint, production database, email provider, or deployment service was contacted.

The disposable local database was positively identified as container `supabase_db_The_Fitness_house_admin_Panel`, database `postgres`, PostgreSQL `17.11`, mapped to host port `54322`. All 21 repository migrations were replayed from a clean local `public` schema. The separate production-forward bundle also passed its preflight and repeatability check against that local schema.

## Findings and remediation

| ID | Severity | Finding | Remediation and verification |
|---|---|---|---|
| F1 | High | Financial payment RPCs previously checked idempotency before acquiring the lock and allowed blank keys. The initial correction also attempted to update generated balances and duplicated work already performed by the payment ledger trigger. | `record_dues_payment`, `record_pt_dues_payment`, and `renew_member_subscription` now require a nonblank key, lock before cache reads, validate payload hashes, and cache in the same transaction. The payment trigger is the sole ledger writer; generated balance/status fields are not assigned. Real PostgreSQL same-key races returned identical results with exactly one payment or renewal. |
| F2 | High | Authenticated staff could read PT fee, amount-paid, and balance columns through direct table access. | Staff have column-scoped operational PT access. Admin financial detail uses `v_admin_pt_assignments`, gated by `is_admin()`. PostgreSQL role tests confirmed staff column reads are denied and admin reads work. |
| F3 | High | Idempotency cache JSON could expose financial responses; staff onboarding/PT assignment responses included financial fields. | Direct API access to `idempotency_keys` is revoked. `onboard_member` and `assign_pt_package` redact financial keys on both fresh and cached responses. An actual PostgreSQL test confirmed reuse of the same key by a second admin does not return the first actor's cached member/payment response. |
| F4 | High | Resolving a user role could accept a pending staff invitation as a side effect. | Role lookup is read-only. A separate eligibility RPC drives an explicit acceptance UI/action. Local PostgreSQL verified pending, expired, revoked, wrong-email, and accepted invitation behavior. |
| F5 | High | Invitation management RPCs called through a service-role client lost the caller's `auth.uid()` context. | Invitation RPCs now use the authenticated caller client; service role remains for required Auth administration and audit insertion. No real invitation was sent. Source/mock tests cover the caller identity and Edge Function error paths. |
| F6 | Medium | External invitation actions can partially succeed, and ignored audit errors could falsely report a complete success. | Invitation state transitions write audit rows; Edge Functions surface partial audit/cleanup outcomes. No external action was executed. |
| F7 | Medium | The staff roster fallback was bypassed when a profile query returned only the caller's own row. | Admin roster reads use profiles; staff reads use the sanitized, email-free `v_staff_roster`. |
| F8 | High | Sensitive views and inherited RLS had unsafe or unclear semantics; duplicate permissive policies could OR-bypass intended gates. | Sensitive views use explicit owner-rights predicates/masks and barriers where appropriate. `v_member_followups` uses invoker RLS. Stale permissive `packages_select` and duplicate `followups_select` policies are removed. No Phase 5 view is dropped with `CASCADE`. Local catalog checks confirmed the expected policy set and view options. |
| F9 | High | `SECURITY DEFINER` helpers and operational RPCs needed explicit search paths, execution grants, and active-account checks. | Project definer functions have explicit safe paths; `PUBLIC`/`anon` execution is removed, and operational attendance/PT RPCs require an active staff/admin role. Local catalog checks found no public definer function without `proconfig` and no definer execution grant to `anon`. |
| F10 | Medium | The staff summary referenced `pt_sessions.status` and `session_date`, which do not exist in the project schema. | Migration `20261102050000` counts persisted sessions by `conducted_at` in the Asia/Kolkata month. A live staff-session test exercised the summary successfully. |

## Local security verification

- `anon`: no private member/payment table access or privileged RPC execution.
- Active staff: permitted member edits, check-in/checkout/cancel, PT session completion, follow-ups, notifications, sanitized onboarding/PT assignment, and nonfinancial summary; financial columns/reports denied.
- Active admins: payment, renewal, roster, invitation administration, PT financial view, and revenue report available; self-demotion/deactivation rejected.
- Inactive staff: role lookup fails closed and operational RPCs are denied.
- `service_role`: direct member/payment reads denied; append-only security-audit insertion retained.
- Financial concurrency: dues payment, PT dues payment, and renewal each passed concurrent identical-request tests; payload mismatch and blank keys were rejected; rollback followed by retry succeeded.
- The role workflow ran in a PostgreSQL transaction that rolled back. Disposable concurrency fixtures were removed by the test cleanup.

## Remaining production limits

Hosted metadata was not independently inspected or modified. The user-provided prior observations—an incomplete migration ledger, profile status columns missing, and no `staff_invitations` / `security_audit_logs` in an earlier inspection—remain unverified in this task. The hosted view contracts/dependencies, financial column types and generated expressions, function identities, grants, triggers, policies, owners, and PostgreSQL version are unknown. These are explicit gates in the separate production-forward migration and [activation checklist](PRODUCTION_ACTIVATION_CHECKLIST.md).

The local clean replay dropped only the disposable local `public` schema with explicit authorization. It did not contain production records. No production migration, Edge Function deployment, push, or real invitation occurred.
