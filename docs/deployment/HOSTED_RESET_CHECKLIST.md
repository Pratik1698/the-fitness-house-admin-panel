# THE FITNESS HOUSE — HOSTED RESET & DEPLOYMENT CHECKLIST
**Target Project:** `xfagvgypgboplonokntk`
**Host URL:** `https://xfagvgypgboplonokntk.supabase.co`
**Authoritative Identities:**
- **Admin:** `pravinjoshi2707@gmail.com`
- **Staff:** `pratikp5598@gmail.com`

---

## 1. Safety Gates & Pre-Reset Verification

Before taking any destructive action on hosted Supabase, every gate below must be explicitly validated. If any check fails, **STOP IMMEDIATELY**.

### Gate 1: Target Project Confirmation
- [ ] Active Supabase project reference is strictly: **`xfagvgypgboplonokntk`**
- [ ] Command output of `npx supabase status` confirms `xfagvgypgboplonokntk`
- [ ] **FAIL-SAFE:** If project reference is different, **ABORT IMMEDIATELY**.

### Gate 2: Pre-Reset Backup Verification
- [ ] Backup file exists on local disk:
  `E:\TFH-Database-Backup\tfh-hosted-production-20261103_111744.dump`
- [ ] File size is verified: **`482,118 bytes`** (~0.46 MB)
- [ ] SHA-256 Checksum matches:
  `65173E740E9A18930546C90F1B38562584F7678ED3CDEEDDBEFC0AC9DEEF8A1C`
- [ ] **FAIL-SAFE:** If backup is missing, corrupted, or hash mismatches, **ABORT IMMEDIATELY**.

### Gate 3: Local Environment Protection
- [ ] Local development database container (`supabase_db_The_Fitness_house_admin_Panel`) remains completely untouched.
- [ ] Pre-flight verification passes 16/16 checks:
  ```powershell
  node scripts/deployment/verify-deployment-package.js
  ```

---

## 2. Step-by-Step Rebuild Execution Checklist

### Phase 1: Database Reset (Decoupled with `--no-seed`)
- [ ] Operator executes:
  ```powershell
  npx supabase db reset --remote --no-seed
  ```
- [ ] All 21 migrations execute sequentially without error:
  - [ ] 01. `20261019_001_phase7c_core_schema.sql`
  - [ ] 02. `20261020_001_phase4_attendance_schema.sql`
  - [ ] 03. `20261021140000_phase5_expiry_reminders_pending_payments.sql`
  - [ ] 04. `20261021150000_phase5_tighten_anon_grants.sql`
  - [ ] 05. `20261021160000_phase5_member_followups_and_reminders_clean.sql`
  - [ ] 06. `20261021170000_phase6_secure_scheduler_and_job_logging.sql`
  - [ ] 07. `20261021180000_phase6_manual_whatsapp_sent_tracking.sql`
  - [ ] 08. `20261021190000_canonical_contact_and_branding.sql`
  - [ ] 09. `20261021200000_canonical_email_and_address.sql`
  - [ ] 10. `20261021_001_phase4_attendance_hardening.sql`
  - [ ] 11. `20261022144500_fix_authoritative_dues_calculation_and_reconciliation.sql`
  - [ ] 12. `20261022160000_calculate_dynamic_days_remaining_in_v_notifications.sql`
  - [ ] 13. `20261101000000_phase1_gym_info_missing_columns.sql`
  - [ ] 14. `20261102000001_phase3_pt_packages_validity.sql`
  - [ ] 15. `20261102000002_phase4_reminder_settings_and_triggers.sql`
  - [ ] 16. `20261102000003_phase5_staff_security_and_invitations.sql`
  - [ ] 17. `20261102010000_phase5_security_audit_remediation.sql`
  - [ ] 18. `20261102020000_phase5_policy_cleanup.sql`
  - [ ] 19. `20261102030000_phase5_followup_view_security.sql`
  - [ ] 20. `20261102040000_phase5_active_role_operational_rpcs.sql`
  - [ ] 21. `20261102050000_phase5_staff_summary_schema_fix.sql`
- [ ] Confirm catalog post-condition: 18 base tables, 8 views, 30 policies, 8 triggers.

### Phase 2: Administrator Creation & Profile Linking
- [ ] Create user `pravinjoshi2707@gmail.com` in **Supabase Dashboard -> Authentication -> Users** (Auto Confirm: checked).
- [ ] Execute `supabase/seed.sql` to establish gym branding, membership tiers, and link the active `admin` profile:
  - **Recommended Method (100% Migration-Safe):** Copy contents of `supabase/seed.sql` into **Supabase Dashboard -> SQL Editor** and click **Run**.
  - **CLI Alternative (Verified CLI 3.0.0 syntax):** Run `npx supabase db push --remote --include-seed` from project root (Note: `--seed` is an invalid flag in CLI 3.0.0; `--include-seed` is verified).
- [ ] Verify profile entry in `public.profiles`: `email = 'pravinjoshi2707@gmail.com'`, `role = 'admin'`, `is_active = true`.

### Phase 3: Staff Invitation Lifecycle
- [ ] Administrator logs into the web application.
- [ ] In **Staff Management**, send an invitation to `pratikp5598@gmail.com`.
- [ ] Staff member accepts invitation from email and sets password.
- [ ] Verify staff profile entry in `public.profiles`: `email = 'pratikp5598@gmail.com'`, `role = 'staff'`, `is_active = true`.

### Phase 4: Edge Functions & Frontend Deployment
- [ ] Deploy `invite-staff`:
  ```powershell
  npx supabase functions deploy invite-staff --project-ref xfagvgypgboplonokntk
  ```
- [ ] Deploy `manage-staff-session`:
  ```powershell
  npx supabase functions deploy manage-staff-session --project-ref xfagvgypgboplonokntk
  ```
- [ ] Build and deploy frontend: `npm test -- --run` && `npm run build`.

### Phase 5: Smoke Verification
- [ ] Execute all 6 smoke tests in `POST_DEPLOYMENT_SMOKE_TESTS.md`.
- [ ] Acceptance sign-off completed.
