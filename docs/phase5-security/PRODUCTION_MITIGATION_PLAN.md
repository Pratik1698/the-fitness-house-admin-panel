# Phase 5 — Production Mitigation and Execution Plan

**Project:** The Fitness House Admin Panel
**Project Ref:** `xfagvgypgboplonokntk` (Hosted Supabase)
**Candidate Forward Migration:** `supabase/production-migrations/20261102_phase5_security_forward.sql`
**Candidate Forward Checksum (SHA-256):** Verified in Pre-Migration Step
**Target Database:** Hosted Supabase PostgreSQL 17.11 (`170011`)
**Current Production Decision:** **OPERATIONAL NO-GO**
**Document Status:** Pending Business Owner Approvals for Prerequisites

---

## 1. Executive Summary & Production Risks

Phase 5 addresses critical architectural security gaps in The Fitness House Admin Panel. Currently, the production database lacks:
1. **Staff Deactivation Mechanism (P0 Severity):** There is no schema support (`profiles.is_active`) to revoke operational access from former staff members. Deactivated staff could theoretically continue accessing gym operations or triggering API endpoints.
2. **Member Financial Exposure (P0 Severity):** Database views (`v_active_members`, `v_member_dues`, `v_outstanding_payments`) expose full member billing details, revenue liabilities, payment histories, and debt balances to all authenticated staff members rather than restricting them to administrators.
3. **Absence of Security Audit Logging (P1 Severity):** Administrative actions (role changes, staff deactivations, security updates) are not recorded in an immutable database audit log.
4. **Lack of Controlled Staff Onboarding (P1 Severity):** There is no cryptographic invitation workflow (`staff_invitations`), allowing unauthorized sign-ups if user registration is unrestricted.

The candidate migration bundle `20261102_phase5_security_forward.sql` has been corrected and validated locally on PostgreSQL 17.11 to remediate all four vulnerabilities safely.

---

## 2. Confirmed Facts vs. Assumptions

| Domain | Confirmed Production Evidence | Unverified Assumptions (Strictly Rejected) |
| :--- | :--- | :--- |
| **Server Engine** | PostgreSQL 17.11 on x86_64, `server_version_num = 170011`. | Assuming behavior matches older PostgreSQL versions (e.g. 15 or 16). |
| **Migration Ledger** | Exactly 11 migration versions recorded (`20261019` to `20261022144500`). | Assuming local migrations `20261022160000` to `20261102000002` were recorded. |
| **Unrecorded Tables** | `public.reminder_settings` exists on production with 1 row, despite absence from ledger. | Assuming `reminder_settings` can be created without checking existing existence. |
| **Profiles Inventory** | Exactly 2 profile records exist: 1 `admin` and 1 `staff`. | Assuming either profile is active or inactive based on login history or role. |
| **Views & Grants** | 7 baseline views exist with baseline columns and legacy security options. | Assuming legacy production views match post-Phase-5 target view definitions. |
| **Integrations** | Supabase JS client and Edge Functions exist. | Assuming no third-party webhooks, Zapier, or BI tools use `service_role`. |

---

## 3. Local PostgreSQL Validation Evidence Summary

Technical validation was completed on an isolated PostgreSQL 17.11 disposable environment on 2026-11-03:
- **Baseline Simulation:** 100% faithful replication of the 15 application tables, `reminder_settings`, 7 baseline views, 3 triggers, generated columns, and 2 synthetic profiles.
- **Test A (Forward Migration):** Successfully executed all DDL, view replacements, and postconditions in a single transaction. Confirmed **100% data preservation** across 10 business tables and financial totals (₹12,500 paid, ₹16,500 balance, ₹29,000 liability). Verified that staff callers receive `NULL` for financial fields and 0 rows for dues/outstanding payment views.
- **Test B1 (Preflight Rollback):** Omission of the profile activation map triggered `PHASE5_PROFILE_MAP_REQUIRED` and executed a clean abort prior to DDL execution with zero residual changes.
- **Test B2 (Post-DDL Rollback):** Allowed all migration DDL, table creations, view replacements, and grants to execute, then raised a controlled failure immediately before `COMMIT;`. Verified 100% clean rollback of all DDL, tables, columns, views, and grants, with exact preservation of all 10 business tables, 28 RLS policies, 5 triggers, 32 functions, and ₹29,000 in member liabilities.
- Detailed technical report: [FINAL_POSTGRESQL_VALIDATION_REPORT.md](file:///D:/The_Fitness_house_admin_Panel/docs/phase5-security/FINAL_POSTGRESQL_VALIDATION_REPORT.md).

---

## 4. Operational Prerequisite 1: Authoritative Profile Activation Mapping

The migration strictly forbids guessing or inferring activation status for existing production accounts. A temporary table `phase5_profile_activation_map` must be provided in the same SQL Editor session.

### 4.1 Verification Procedure for Business Owner
The business owner must inspect the 2 existing production profiles in the Supabase Dashboard (`Table Editor` -> `profiles`) and sign off on the exact mapping parameters:

```
ACCOUNT 1 (Admin):
- Profile ID: [UUID from production profiles table]
- Role: admin
- Authoritative Status: [ACTIVE / INACTIVE]
- Historical Deactivation Timestamp: [NULL if active, or ISO timestamp if inactive]
- Source Reference: "Business Owner Signoff - [Owner Name] - [Date]"

ACCOUNT 2 (Staff):
- Profile ID: [UUID from production profiles table]
- Role: staff
- Authoritative Status: [ACTIVE / INACTIVE]
- Historical Deactivation Timestamp: [NULL if active, or ISO timestamp if inactive]
- Source Reference: "Business Owner Signoff - [Owner Name] - [Date]"
```

> [!CAUTION]
> If any account is marked `is_active = false`, its operational access will immediately be blocked upon migration commit. If an active staff member is mistakenly marked inactive, they will be denied access until reactivated by an admin.

### 4.2 Template for Execution
```sql
CREATE TEMP TABLE phase5_profile_activation_map (
    profile_id uuid PRIMARY KEY,
    is_active boolean NOT NULL,
    deactivated_at timestamptz NULL,
    source_reference text NOT NULL
);

INSERT INTO phase5_profile_activation_map (profile_id, is_active, deactivated_at, source_reference)
VALUES
    ('<CONFIRMED_ADMIN_UUID>', true, NULL, 'Authoritative Owner Signoff - Admin Active - 2026-11-03'),
    ('<CONFIRMED_STAFF_UUID>', <true_or_false>, <NULL_or_TIMESTAMP>, 'Authoritative Owner Signoff - Staff Verification - 2026-11-03');
```

---

## 5. Operational Prerequisite 2: External Service-Role Consumer Checklist

Before applying Phase 5 privileges and RLS tightening, confirm all consumers of the Supabase `service_role` key:

| Integration / Service | Potential Impact | Verification Requirement | Status |
| :--- | :--- | :--- | :---: |
| **Supabase Edge Functions** | `manage-staff-session` uses `service_role` to manage GoTrue bans and profiles. | Verify updated Edge Function code is tested and deployed with correct contracts. | **PENDING REVIEW** |
| **Zapier / Make / n8n** | Automated member onboarding or payment webhook listeners. | Confirm if any third-party scenario uses direct SQL or service-role REST calls. | **PENDING OWNER CONFIRMATION** |
| **BI & Analytics Tools** | Metabase, PowerBI, or Supabase Dashboard custom SQL. | Confirm that reporting queries rely on admin roles or service_role rather than staff keys. | **PENDING OWNER CONFIRMATION** |
| **Cron / Background Jobs** | `reminder_job_logs` and automated WhatsApp reminders. | Verified: Background pg_cron job runs as `postgres` internal runner and is preserved. | **VERIFIED COMPATIBLE** |
| **Custom Maintenance Scripts** | Local admin scripts, Python ETL, or backup utilities. | Confirm no external scripts depend on raw table access with revoked privileges. | **PENDING OWNER CONFIRMATION** |

> [!IMPORTANT]
> Never disclose, export, or print API keys, service-role secrets, or passwords in chats or documentation.

---

## 6. Operational Prerequisite 3: Backup and Recovery Protocol

Before executing any production migration:
1. **Supabase Scheduled Backup:** Verify in Supabase Dashboard (`Settings` -> `Database` -> `Backups`) that a fresh, automated backup was taken within the last 24 hours.
2. **Point-In-Time Recovery (PITR):** Verify if PITR is active for project `xfagvgypgboplonokntk`. Confirm recovery window and earliest restorable timestamp.
3. **Manual Snapshot:** If PITR is not enabled, take an explicit manual backup or logical pg_dump prior to execution.
4. **Maintenance Window:** Schedule execution during non-peak operating hours (e.g. 11:00 PM – 1:00 AM IST) when gym floor check-ins are closed.
5. **Incident Response Team:** Ensure the database administrator and business owner are active and reachable during the maintenance window.

---

## 7. Proposed 13-Step Production Execution Sequence

> [!WARNING]
> DO NOT EXECUTE THIS SEQUENCE WITHOUT EXPLICIT WRITTEN AUTHORIZATION FROM THE BUSINESS OWNER.

1. **Step 1: Confirm Project Identity**
   Confirm in the Supabase Dashboard that the target project reference is `xfagvgypgboplonokntk`.
2. **Step 2: Verify Backup Status**
   Inspect the latest backup timestamp in `Database -> Backups`. Confirm restorable state exists.
3. **Step 3: Freeze Client Mutations**
   Inform staff of a brief 5-minute maintenance window.
4. **Step 4: Verify Candidate Checksum**
   Verify that the SQL file being applied matches the locally validated checksum of `supabase/production-migrations/20261102_phase5_security_forward.sql`.
5. **Step 5: Verify Authoritative Profile Map**
   Load the approved profile map containing exact UUIDs, explicit statuses, and signed source references.
6. **Step 6: Open Single SQL Editor Session**
   Open a single SQL Editor tab in the Supabase Dashboard.
7. **Step 7: Paste Profile Map and Candidate Bundle**
   Combine the `CREATE TEMP TABLE phase5_profile_activation_map` block and the full candidate forward bundle.
8. **Step 8: Execute Transactional Block**
   Click `Run`. The migration executes inside `BEGIN; ... COMMIT;`.
9. **Step 9: Review Preflight & Postcondition Output**
   Confirm that all preflight and postcondition blocks pass without raising exceptions.
10. **Step 10: Run Post-Migration Read-Only Checks**
    Execute validation queries:
    - Check that `profiles` has `is_active` populated for all records.
    - Check that `staff_invitations` and `security_audit_logs` exist with 0 errors.
    - Check that `v_active_members` returns masked data for non-admin tokens.
11. **Step 11: End-to-End Application Smoke Test**
    Log into the admin portal using the approved admin credentials:
    - Verify Member directory loads correctly.
    - Verify Financial reports and dues calculations show expected totals.
    - Verify Check-in scanner functions normally.
12. **Step 12: Deploy Edge Function (manage-staff-session)**
    Deploy the updated `manage-staff-session` Edge Function only after database migration succeeds.
13. **Step 13: Continuous Observability**
    Monitor API logs, database query errors, and audit logs for 48 hours post-migration.

---

## 8. Immediate Stop and Rollback Conditions

Execution must be halted immediately and the transaction rolled back if:
1. Preflight raises any exception (e.g. `PHASE5_CATALOG_UNEXPECTED`, `PHASE5_PROFILE_MAP_REQUIRED`, `PHASE5_PROFILE_MAP_INVALID`).
2. Any PostgreSQL DDL or constraint error occurs during execution.
3. Postconditions block reports missing views, mismatched columns, or incorrect view options.
4. The execution takes longer than 60 seconds (statement timeout protection).
5. Post-migration smoke test shows missing member records, incorrect financial balances, or broken login flows.

---

## 9. Final Decision and Action Plan

| Domain | Status | Recommendation |
| :--- | :---: | :--- |
| **Technical Validation (PostgreSQL 17.11)** | **VERIFIED PASS** | SQL candidate is non-destructive, atomic, and complete. |
| **Data Preservation** | **VERIFIED PASS** | 100% preservation of all business tables and financial totals. |
| **Profile Activation Mapping** | **PENDING OWNER** | Requires business owner confirmation of the 2 live account statuses. |
| **External Integration Signoff** | **PENDING OWNER** | Requires owner signoff on external `service_role` usage. |
| **Backup Verification** | **PENDING OWNER** | Requires owner inspection of Supabase Dashboard backup state. |

### **Final Operational Verdict: NO-GO**
**Do not execute changes against production.** Wait for the business owner to review the validation reports, confirm the profile activation mapping for the 2 accounts, verify dashboard backups, and give explicit written approval before scheduling execution.
