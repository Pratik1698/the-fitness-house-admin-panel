> **HISTORICAL / ARCHIVAL ARTIFACT NOTICE**
> **Status:** DEPRECATED & FULLY RECONCILED
> **Authoritative Data Store:** Supabase PostgreSQL (`xfagvgypgboplonokntk`)
> **Effective Date:** November 2026
>
> This reconciliation protocol is preserved strictly for historical audit trail documentation. The transition from legacy prototype browser localStorage to authoritative Supabase PostgreSQL 17 has been completed. All runtime operations, mutations, financial ledgers, and authentication flows exclusively target PostgreSQL database tables and verified RPC functions. No browser localStorage data is treated as authoritative.

# LocalStorage to PostgreSQL Reconciliation Plan
**Project:** The Fitness House Gym Management Admin Panel  
**Stage:** Phase 7C Pre-Staging Data Migration Protocol

---

## 1. Scope & Objective
Before enabling live Supabase backend operations, all existing records stored in browser `localStorage` across prototype sessions must be exported, validated, deduplicated, and mapped to the relational schema in `supabase/migrations/20261019_001_phase7c_core_schema.sql`.

---

## 2. Source Key Inventory & Target Relational Mapping

| LocalStorage Key | Target Table(s) | Key Transformation Rules | Handling of Conflicting / Missing Data |
|:---|:---|:---|:---|
| `TFH_MEMBERS_V1` | `public.members`, `public.member_subscriptions` | 1. `id` (e.g. `'TFH001'`) maps to `member_code`. Generate new `uuid` for `id`.<br>2. `planId` / `plan` maps to foreign key `membership_plans.id`.<br>3. `startDate`, `expiryDate`, `totalFee`, `amountPaid`, `balance` populate initial `member_subscriptions` row with `status = 'active'`. | If phone number already exists, flag duplicate for manual merge. If `email` is empty string, convert to `NULL`. |
| `TFH_PAYMENTS_V1` | `public.payments` | 1. `id` (e.g. `'PAY001'`) maps to legacy receipt notes. Sequential `TFH-YYYYMMDD-xxxxx` receipt number generated.<br>2. `category = 'Membership'` links to `member_subscriptions.id`.<br>3. `category = 'Personal Training'` links to `pt_assignments.id`.<br>4. Legacy `status = 'partial'` maps to `payments.status = 'completed'` (partial describes contract, not transaction). | Reject transactions with non-positive amounts. Assert payment member matches contract member. |
| `TFH_PT_CLIENTS_V1` | `public.pt_assignments` | 1. `packageId` maps to `pt_packages.id`.<br>2. `trainer` string (e.g. `'Coach Ajay'`) matched against `trainers.name` to obtain `trainer_id`.<br>3. `totalSessions`, `completedSessions` imported directly.<br>4. Assert `completedSessions <= totalSessions`. | If trainer does not exist, insert trainer into `public.trainers` first. If completed > total, clamp completed to total and log discrepancy. |
| `TFH_GYM_INFO_V1` | `public.gym_info` | Single-row configuration update matching gym contact, tax, and currency settings. | Fallback to default constants if absent. |
| `TFH_CHECKINS_V1` | Future `public.checkins` | Retain in backup JSON. Not part of core financial schema. | Preserved in archive. |
| `TFH_FOLLOWUPS_V1` | Future `public.followups` | Retain in backup JSON. | Preserved in archive. |

---

## 3. Step-by-Step Import Execution Sequence

1. **Pre-Migration JSON Dump:**
   - Execute client-side export utility generating `tfh_export_YYYYMMDD_HHMMSS.json`.
   - Store in `backups/` directory.

2. **Database Clean State Verification:**
   - Execute migration `20261019_001_phase7c_core_schema.sql` on staging database.
   - Assert all tables and sequences exist and have 0 records.

3. **Master Catalog Seeding:**
   - Seed `public.gym_info`.
   - Seed `public.membership_plans` (Monthly: ₹1,500, Quarterly: ₹4,000, Half Yearly: ₹7,000, Yearly: ₹12,000).
   - Seed `public.pt_packages` (8 Sessions: ₹4,000, 12 Sessions: ₹5,500, 20 Sessions: ₹8,000).
   - Seed `public.trainers` (Coach Ajay, Coach Priya, etc.).

4. **Member & Initial Contract Ingestion:**
   - Ingest members into `public.members`.
   - Ingest active subscriptions into `public.member_subscriptions`.

5. **Historical Payment Ledger Insertion:**
   - Temporarily disable `trg_prevent_tamper_payment_records` ONLY during initial historical data seeding script, OR route payments through standard bulk migration transaction.
   - Insert payments with historical `created_at` timestamps matching legacy dates.
   - Re-enable triggers and run reconciliation query.

6. **Post-Import Reconciliation Audit:**
   ```sql
   -- Check for contract balance mismatches
   SELECT id, plan_name, plan_price, amount_paid, balance,
          (plan_price - amount_paid) as expected_balance
   FROM public.member_subscriptions
   WHERE balance <> (plan_price - amount_paid);
   ```
   Assert 0 rows returned.
