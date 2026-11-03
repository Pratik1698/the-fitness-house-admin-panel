# Phase 5 — Final Production Deployment Runbook

**Project:** The Fitness House Admin Panel
**Hosted Supabase Project Reference:** `xfagvgypgboplonokntk`
**Target Engine:** Hosted Supabase PostgreSQL 17.11 (`170011`)
**Combined Execution Script:** `docs/phase5-security/PHASE5_PRODUCTION_EXECUTION.sql`
**Execution Script Checksum (SHA-256):** `0D82672ACB18695CEE19C9956153165577EAE0E36D6B68A1BF2B83F21A4E35DE`
**Candidate Forward Migration:** `supabase/production-migrations/20261102_phase5_security_forward.sql`
**Candidate Checksum (SHA-256):** `40184CB8C96DC193E1FD3D0F38C9C3711F57C40C41671C9FEFCBEC7C8BFE38B2`
**Candidate Backup Checksum (SHA-256):** `BF24FEC268C606526FB7B3A06C96CF20B39151BAAF15E876054726D96706B60C` (`.bak`)
**Execution Mode:** Controlled Single-Transaction Deployment via Supabase Dashboard SQL Editor
**Status:** **OPERATIONAL NO-GO** (Awaiting Business Owner Action on Prerequisites)

---

## 1. Safety Rules & Governance

1. **NO AUTOMATED EXECUTION:** Never run `supabase db push`, `supabase migration repair`, or automated CLI push against the hosted production database.
2. **STRICT TRANSACTION WRAPPER:** The migration must execute within a single explicit transaction block (`BEGIN; ... COMMIT;`). Any preflight or postcondition violation rolls back the entire transaction automatically.
3. **ZERO DATA LOSS:** The migration performs zero table drops, zero column drops, zero `TRUNCATE` operations, and zero deletions of business data (`members`, `member_subscriptions`, `payments`, `checkins`, `pt_assignments`, etc.).
4. **EXPLICIT PROFILE MAP:** The migration fails closed (`PHASE5_PROFILE_MAP_REQUIRED`) if the temporary mapping table is omitted. Activation status must be authoritatively provided; it is never guessed.
5. **OWNER AUTHORIZATION REQUIRED:** Deployment must not begin without explicit, written signoff from the business owner.

---

## 2. Pre-Deployment Operational Prerequisites (Owner Signoff)

Before scheduling execution, the following three requirements must be formally satisfied by the business owner.

### A. Authoritative Profile Activation Mapping (CONFIRMED)
Both production accounts (`1 admin`, `1 staff`) have been explicitly confirmed active by the business owner with `deactivated_at = NULL`:

- **Admin Profile:** `449e7fbc-42a0-42a0-970a-40186c14b653` (`role = 'admin'`, `is_active = true`, `deactivated_at = NULL`)
- **Staff Profile:** `35367862-cc44-4d30-be0d-bd097af236b5` (`role = 'staff'`, `is_active = true`, `deactivated_at = NULL`)

The combined execution script contains an automated pre-transaction assertion DO-block enforcing that `public.profiles` contains **exactly and only** these two IDs with their expected roles, failing closed if any ID is missing or an unexpected third profile exists.

```sql
-- Explicit Mapping in PHASE5_PRODUCTION_EXECUTION.sql:
CREATE TEMP TABLE phase5_profile_activation_map (
    profile_id uuid PRIMARY KEY,
    is_active boolean NOT NULL,
    deactivated_at timestamptz NULL,
    source_reference text NOT NULL
);

INSERT INTO phase5_profile_activation_map (profile_id, is_active, deactivated_at, source_reference)
VALUES
    ('449e7fbc-42a0-42a0-970a-40186c14b653'::uuid, true, NULL, 'Authoritative Owner Signoff - Active Admin Profile 2026-11-03'),
    ('35367862-cc44-4d30-be0d-bd097af236b5'::uuid, true, NULL, 'Authoritative Owner Signoff - Active Staff Profile 2026-11-03');
```

- **Signoff Checklist:**
  - [x] Account 1 (Admin: `449e7fbc-42a0-42a0-970a-40186c14b653`) confirmed active.
  - [x] Account 2 (Staff: `35367862-cc44-4d30-be0d-bd097af236b5`) confirmed active.
  - [x] `deactivated_at` confirmed `NULL` for both accounts.
  - [x] Explicit pre-transaction profile count assertion added (fails closed if count <> 2).

### B. External Service-Role Key Dependencies
The migration restricts broad `service_role` direct table mutations (except `security_audit_logs` INSERT). The business owner must verify external consumers:

- [ ] **Edge Functions:** Updated `manage-staff-session` and `invite-staff` code reviewed.
- [ ] **Zapier / Make / n8n:** Confirmed that no external webhooks directly mutate public database tables.
- [ ] **BI / Analytics Tools (Metabase / PowerBI):** Confirmed reporting queries connect via read-only users or admin roles, not raw table writers.
- [ ] **Custom Maintenance Scripts:** Confirmed no ad-hoc Python/Node scripts perform direct unauthenticated table writes.

### C. Backup and Recovery Verification
- [ ] **Supabase Dashboard Backup:** Confirmed in `Database -> Backups` that a clean, restorable backup was taken within the last 24 hours.
- [ ] **Point-In-Time Recovery (PITR):** Verified PITR status and restorable timestamp window for project `xfagvgypgboplonokntk`.
- [ ] **Maintenance Window Scheduled:** Scheduled during non-operating hours (recommended: 11:00 PM – 1:00 AM IST).
- [ ] **Emergency Contacts:** Lead developer and business owner available on standby.

---

## 3. Read-Only Production Preflight Inspection

Before executing the migration, paste and run this **strictly read-only** inspection script in the Supabase Dashboard SQL Editor:

```sql
-- ============================================================================
-- PHASE 5 PRODUCTION READ-ONLY PREFLIGHT QUERY
-- Run in Supabase SQL Editor: project xfagvgypgboplonokntk
-- ============================================================================

-- 1. Verify Server Identity & PostgreSQL 17.11
SELECT
    current_database() AS database_name,
    current_user AS connected_user,
    current_setting('server_version_num') AS pg_version_num,
    (current_setting('server_version_num') = '170011') AS is_pg17_11;

-- 2. Verify Migration Ledger (Must be exactly 11 recorded migrations)
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;

-- 3. Verify Baseline Tables (Expect 15 core tables + reminder_settings = 16)
SELECT count(*) AS base_table_count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- 4. Verify Phase 5 Target Tables Do NOT Exist Yet
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('staff_invitations', 'security_audit_logs');

-- 5. Extract Profile UUIDs for the Activation Map (ID, Role, Creation Date only)
SELECT id, role, created_at
FROM public.profiles
ORDER BY created_at;

-- 6. Verify Baseline Profiles Columns (Must be exactly 6)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY ordinal_position;

-- 7. Verify Baseline View Columns (v_staff_roster must have 4 columns)
SELECT table_name, count(column_name) AS column_count
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN (
    'v_staff_roster', 'v_active_members', 'v_member_dues',
    'v_outstanding_payments', 'v_notifications', 'v_member_followups',
    'v_attendance_logs'
)
GROUP BY table_name
ORDER BY table_name;

-- 8. Verify Non-Internal Triggers (Expect 3: auth trigger + 2 payment triggers)
SELECT event_object_table, trigger_name
FROM information_schema.triggers
WHERE trigger_schema IN ('public', 'auth')
  AND trigger_name IN ('trg_on_auth_user_created', 'trg_prevent_tamper_payment_records', 'trg_sync_payment_balances')
ORDER BY event_object_table, trigger_name;
```

### Preflight Acceptance Criteria
- `is_pg17_11` must be `true` (`170011`).
- `schema_migrations` must contain exactly 11 rows (`20261019` to `20261022144500`).
- `base_table_count` must be 16 (includes `reminder_settings`).
- `staff_invitations` and `security_audit_logs` must return 0 rows.
- `profiles` must return exactly 2 rows and 6 columns.
- `v_staff_roster` must have exactly 4 columns (`id`, `full_name`, `role`, `created_at`).
- Triggers must return 3 active triggers.

> [!CAUTION]
> If any preflight query returns unexpected results, **STOP IMMEDIATELY**. Do not proceed to deployment.

---

## 4. Controlled Deployment Sequence

### Phase A: Preparation (T - 15 minutes)
1. Verify Supabase project reference is `xfagvgypgboplonokntk`.
2. Inspect latest backup in `Settings -> Database -> Backups`.
3. Notify all staff that the portal is undergoing a scheduled 5-minute update.
4. Open the pre-assembled, fully validated production execution script:
   - File: `docs/phase5-security/PHASE5_PRODUCTION_EXECUTION.sql`
   - File SHA-256: `0D82672ACB18695CEE19C9956153165577EAE0E36D6B68A1BF2B83F21A4E35DE`
   - Embedded Candidate SHA-256: `40184CB8C96DC193E1FD3D0F38C9C3711F57C40C41671C9FEFCBEC7C8BFE38B2`
   - Contains: Part A (Fail-closed assertions + explicit UUID temp mapping), Part B (Verbatim Candidate BEGIN..COMMIT), Part C (Post-commit temp cleanup).

### Phase B: Execution (T - 0)
1. Open a single SQL Editor tab in the Supabase Dashboard (`xfagvgypgboplonokntk`).
2. Copy the entire contents of `docs/phase5-security/PHASE5_PRODUCTION_EXECUTION.sql`.
3. Paste into the SQL Editor.
4. Click **Run** (or press Ctrl+Enter).
5. Execution runs in a single database session:
   - Part A creates and populates `pg_temp.phase5_profile_activation_map` for both active accounts.
   - Part B opens transaction, runs compatibility preflight, executes DDL, validates postconditions, and commits atomically.
   - Part C explicitly drops the temporary table.
6. Review the execution output:
   - Must show successful execution with notice logs and zero error exceptions.

### Phase C: Post-Deployment Verification (T + 5 minutes)
Run these verification queries in a fresh SQL Editor tab:

```sql
-- 1. Verify Phase 5 Tables Exist with RLS Enabled
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('staff_invitations', 'security_audit_logs');

-- 2. Verify Profiles Columns Extended to 9
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY ordinal_position;

-- 3. Verify Profiles Activation Values
SELECT id, role, is_active, deactivated_at, invited_by
FROM public.profiles;

-- 4. Verify 8 Views and Security Barrier Options
SELECT c.relname, c.relrowsecurity, c.reloptions
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v'
ORDER BY c.relname;

-- 5. Verify Migration Ledger Contains Phase 5 Record
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 5;
```

### Phase D: Application Smoke Test (T + 10 minutes)
1. Log into the application frontend as the Administrator:
   - Verify Member Directory loads and displays all active members.
   - Verify Financial totals (Revenue, Dues, Liability) display correct numerical values.
   - Verify Check-in scanner allows member attendance logging.
   - Verify Staff Management screen displays the 2 accounts with correct active status badges.
2. Log into the application as Staff:
   - Verify Member Directory displays member names and plans, but all plan prices, amount paid, and balances display masked `₹ —` values.
   - Verify Financial Dues screen displays 0 records or access denied.
   - Verify Staff cannot modify settings or view audit logs.

---

## 5. Abort and Recovery Procedure

### Condition 1: Failure During Execution
- If any error occurs prior to `COMMIT;`, PostgreSQL automatically rolls back the entire transaction.
- **Action:** No database cleanup is required. Confirm with the preflight script that the database remains at baseline. Log the error message and report to the lead developer.

### Condition 2: Post-Deployment Critical Defect
- If a critical bug is discovered after `COMMIT;` (e.g. core workflow broken):
- **Action:**
  1. Freeze application access.
  2. Restore from the pre-deployment backup via Supabase Dashboard (`Database -> Backups -> Restore`).
  3. Notify stakeholders and initiate post-incident review.

---

## 6. Signoff and Authorization Form

| Role | Name | Decision | Date / Timestamp | Signature |
| :--- | :--- | :---: | :---: | :---: |
| **Lead Developer / DBA** | AI Agent / Antigravity | **TECHNICAL GO** | 2026-11-03 | Verified (Checksum `40184CB8...`) |
| **Business Owner** | [Owner Name] | [PENDING APPROVAL] | [Pending] | ___________________________ |
| **Deployment Lead** | [Operator Name] | [PENDING APPROVAL] | [Pending] | ___________________________ |
