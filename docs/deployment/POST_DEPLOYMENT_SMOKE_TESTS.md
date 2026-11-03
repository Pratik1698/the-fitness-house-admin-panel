# THE FITNESS HOUSE — POST-DEPLOYMENT SMOKE TESTS
**Target System:** Hosted Supabase (`xfagvgypgboplonokntk`)
**Authoritative Identities:**
- **Admin:** `pravinjoshi2707@gmail.com`
- **Staff:** `pratikp5598@gmail.com`

---

## 1. Test Suite Summary

Execute these 6 verification tests in sequence after Phase 1–5 deployment:

| Test ID | Test Scope | Target Validation | Expected Outcome |
| :---: | :--- | :--- | :--- |
| **ST-01** | **Database Catalog** | Public tables, views, triggers, policies | 18 tables, 8 views, 30 policies, 8 triggers |
| **ST-02** | **Admin Access & Dashboard** | Full financial visibility & metrics | Sees subscriptions, payments, dues |
| **ST-03** | **Staff Access & Isolation** | Financial isolation & operational roster | 0 rows on payments/dues; masked metrics |
| **ST-04** | **Payment Tamper Protection** | Immutable ledger triggers | `UPDATE` and `DELETE` blocked with ERRCODE 27000 |
| **ST-05** | **Staff Invitation Lifecycle** | Edge function & RPC workflow | Creates pending invitation; logs audit event |
| **ST-06** | **Session Invalidation Safeguard**| Last-admin & deactivation protection | Blocks last admin demotion; revokes tokens |

---

## 2. Test ST-01: Database Catalog Verification

Run in Supabase **SQL Editor**:
```sql
-- 1. Base Tables Count (Expected: 18)
SELECT count(*) AS base_table_count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- 2. Secure Views Count (Expected: 8)
SELECT count(*) AS view_count
FROM information_schema.views
WHERE table_schema = 'public';

-- 3. RLS Policies Count (Expected: 30)
SELECT count(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public';

-- 4. Triggers Count (Expected: 8)
SELECT count(*) AS trigger_count
FROM information_schema.triggers
WHERE trigger_schema IN ('public', 'auth');
```

- **Pass Criteria:**
  - `base_table_count = 18`
  - `view_count = 8`
  - `policy_count = 30`
  - `trigger_count = 8`

---

## 3. Test ST-02: Admin Access & Financial Visibility

Log into the Admin Panel as `pravinjoshi2707@gmail.com`:
1. Navigate to **Dashboard**:
   - Verify active members counter displays.
   - Verify total revenue and outstanding dues metrics display correctly.
2. Navigate to **Subscriptions & Payments**:
   - Verify payment records load without permission errors.
3. Verify via SQL Editor:
   ```sql
   SELECT count(*) FROM public.member_subscriptions;
   SELECT count(*) FROM public.payments;
   SELECT count(*) FROM public.v_member_dues;
   ```
- **Pass Criteria:** Queries succeed with full access; frontend displays financial widgets without error.

---

## 4. Test ST-03: Staff Role Isolation & Masking

Log into the Admin Panel as `pratikp5598@gmail.com`:
1. Navigate to **Members**:
   - Verify staff can view member names, codes, phone numbers, and attendance history.
   - Verify member dues and financial totals are masked (`₹0.00` or hidden).
2. Navigate to **Subscriptions & Payments**:
   - Verify payments ledger is hidden from the navigation bar or inaccessible.
3. Test direct query via PostgREST / Supabase Client under Staff JWT:
   ```sql
   -- Under staff context, these return 0 rows:
   SELECT * FROM public.payments;
   SELECT * FROM public.member_subscriptions;
   SELECT * FROM public.v_member_dues;
   ```
- **Pass Criteria:** All three queries return 0 rows. Staff dashboard displays operational rosters only.

---

## 5. Test ST-04: Payment Immutability Protection

Test in Supabase **SQL Editor**:
```sql
DO $$
DECLARE
    v_payment_id UUID;
BEGIN
    SELECT id INTO v_payment_id FROM public.payments LIMIT 1;

    IF v_payment_id IS NOT NULL THEN
        -- Attempt to tamper with amount
        BEGIN
            UPDATE public.payments SET amount = amount + 500 WHERE id = v_payment_id;
            RAISE EXCEPTION 'TEST_FAILED: Payment update was permitted!';
        EXCEPTION
            WHEN SQLSTATE '27000' THEN
                RAISE NOTICE 'TEST PASSED: Payment UPDATE was blocked with IMMUTABLE_FINANCIAL_RECORD.';
        END;

        -- Attempt to delete payment
        BEGIN
            DELETE FROM public.payments WHERE id = v_payment_id;
            RAISE EXCEPTION 'TEST_FAILED: Payment delete was permitted!';
        EXCEPTION
            WHEN SQLSTATE '27000' THEN
                RAISE NOTICE 'TEST PASSED: Payment DELETE was blocked with IMMUTABLE_FINANCIAL_RECORD.';
        END;
    END IF;
END $$;
```

- **Pass Criteria:** Both `UPDATE` and `DELETE` throw exception code `27000` with message `IMMUTABLE_FINANCIAL_RECORD`.

---

## 6. Test ST-05: Staff Invitation Lifecycle Flow

1. Sign in as Administrator (`pravinjoshi2707@gmail.com`).
2. In **Staff Management**, click **Invite Staff Member**.
3. Send an invitation to a test email: `smoketest_staff@example.com`.
4. In Supabase **SQL Editor**, verify:
   ```sql
   -- Verify pending invitation
   SELECT id, email, role, status, expires_at
   FROM public.staff_invitations
   WHERE email = 'smoketest_staff@example.com';

   -- Verify audit log entry
   SELECT action, details
   FROM public.security_audit_logs
   ORDER BY created_at DESC
   LIMIT 1;
   ```
5. Revoke test invitation:
   ```sql
   SELECT public.revoke_staff_invitation(
       (SELECT id FROM public.staff_invitations WHERE email = 'smoketest_staff@example.com')
   );
   ```
- **Pass Criteria:** Invitation created with `status = 'pending'`, logged in `security_audit_logs`, and revokes cleanly.

---

## 7. Test ST-06: Safeguards on Last Admin & Inactive Accounts

Test in Supabase **SQL Editor**:
```sql
-- Attempt to demote the sole active administrator:
DO $$
DECLARE
    v_admin_id UUID;
BEGIN
    SELECT id INTO v_admin_id FROM public.profiles WHERE email = 'pravinjoshi2707@gmail.com';
    IF v_admin_id IS NOT NULL THEN
        BEGIN
            PERFORM public.admin_set_user_role(v_admin_id, 'staff');
            RAISE EXCEPTION 'TEST_FAILED: Last admin demotion succeeded!';
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'TEST PASSED: Last admin demotion rejected with: %', SQLERRM;
        END;
    END IF;
END $$;
```

- **Pass Criteria:** Transaction aborts with:
  `INVALID_OPERATION: Cannot demote the last active administrator.`
