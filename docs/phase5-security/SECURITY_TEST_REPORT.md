# Phase 5 Security Test Report

## Results

| Command/check | Result | Notes |
|---|---|---|
| npm test | 169 total; 166 passed, 0 failed, 3 skipped | The three opt-in local PostgreSQL tests are run separately below. |
| npm run build | Passed | Vite transformed 2,309 modules. Existing warnings remain: one module is both statically and dynamically imported, and the minified JS bundle is about 1.44 MB (over the 500 kB advisory limit). |
| Local migration replay | Passed | All 21 local migration versions are present through 20261102050000. All six Phase 5 migrations replayed against the existing local database; existing business rows were preserved. |
| Production-forward bundle | Passed locally | The strict preflight and postconditions passed on local PostgreSQL 17.11, including a second transactional apply. This is not production compatibility evidence. |
| PostgreSQL integration | 3 passed, 0 failed, 0 skipped | Opt-in catalog/security, role/workflow and concurrency tests executed against the verified local Docker database. |
| git diff --check | Passed | No whitespace errors. |
| npm run lint | Not configured | No lint script exists in package.json. |

## PostgreSQL coverage

The opt-in command was run with PHASE5_LOCAL_DB_TESTS=1. Before SQL execution, the harness verifies the named local Docker container, port mapping, database name and PostgreSQL version.

1. Catalog/security: migration ledger matches all 21 files; no duplicate permissive policy commands; project SECURITY DEFINER functions have configured search paths; anon has no definer execution; staff financial column grants are absent; follow-up view is invoker security; role helpers require active status; idempotency, service-role, payment/subscription, trigger and trainer-policy state matches the expected catalog contract.
2. Role/workflow: anon, active admin, second admin, active staff, inactive staff, invitation-linked users and service_role were exercised with PostgreSQL roles and JWT claims. Verified admin reports/payments/invitations; explicit invitation acceptance/failures; staff member edits; check-in/checkout/cancel; PT session; follow-up; notifications; onboarding; PT assignment; redaction; denial of financial reads/admin operations; and service-role audit-only table access. The workflow transaction rolled back.
3. Concurrency: concurrent identical dues-payment, PT-dues payment and renewal calls returned identical cached JSON. Each created one corresponding payment/renewal. Reused keys with different payloads and blank keys were rejected. Failed work rolled back its cache/payment and retry succeeded. Disposable fixtures were cleaned.

## Data preservation and limits

Business-table counts and security-audit fixture count were zero before and after local verification; migration head remained 20261102050000. The local runs did not connect to hosted production or perform a hosted SQL operation. Migration replay used the existing local database and did not reset it. The schema was verified without a seed load because supabase/seed.sql is absent; integration cases used disposable fixtures.

Deno and the Supabase CLI were not installed. Edge Function changes received source review and mocked contract coverage, but no Deno typecheck/emulator run; no function was deployed. Real mail/SMS/WhatsApp, hosted Supabase, GitHub and Vercel were not contacted or changed.

Local success does not prove that the hosted schema matches the candidate. The actual production Query 6–10 inventory, profile activation mapping, external service-role workflow review, production backup/change plan, and a separate production compatibility review remain prerequisites. See PRODUCTION_ACTIVATION_CHECKLIST.md.
