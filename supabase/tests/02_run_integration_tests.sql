-- ============================================================================
-- THE FITNESS HOUSE — GYM MANAGEMENT ADMIN PANEL
-- COMPREHENSIVE INTEGRATION TEST SUITE: 02_run_integration_tests.sql
-- ============================================================================
-- Execution Mode: Client runner in disposable PostgreSQL 15+ environment.
-- Error Handling: \set ON_ERROR_STOP on ensures any assertion failure aborts
-- immediately with a non-zero exit status.
-- ============================================================================

\set ON_ERROR_STOP on

-- ----------------------------------------------------------------------------
-- FIXTURE SETUP: Seed Auth Users & Master Catalogs
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_admin_id uuid := '11111111-1111-1111-1111-111111111111'::uuid;
    v_staff_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;
BEGIN
    -- 1. Insert mock auth users
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES 
        (v_admin_id, 'admin@thefitnesshouse.in', '{"full_name": "Admin Ajay"}'::jsonb),
        (v_staff_id, 'staff@thefitnesshouse.in', '{"full_name": "Staff Priya"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;

    -- Profiles are automatically populated by trg_on_auth_user_created with role='staff'
    -- Promote the admin user
    UPDATE public.profiles SET role = 'admin' WHERE id = v_admin_id;

    -- 2. Seed Master Catalogs
    INSERT INTO public.membership_plans (id, name, duration_days, price, is_active)
    VALUES 
        ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Monthly', 30, 1500.00, true),
        ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'Quarterly', 90, 4000.00, true),
        ('aaaaaaaa-0000-0000-0000-000000000003'::uuid, 'Yearly', 365, 12000.00, true)
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO public.pt_packages (id, name, total_sessions, price, is_active)
    VALUES 
        ('cccccccc-0000-0000-0000-000000000001'::uuid, 'PT 10 Sessions', 10, 5000.00, true)
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO public.trainers (id, name, specialty, is_active)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 'Coach Vikram', 'Strength & Conditioning', true)
    ON CONFLICT DO NOTHING;

    RAISE NOTICE '[SETUP] Test fixtures and catalogs initialized successfully.';
END $$;

-- ----------------------------------------------------------------------------
-- TEST 1: Member Onboarding & Atomic Receipt Generation
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_staff_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;
    v_plan_id uuid := 'aaaaaaaa-0000-0000-0000-000000000002'::uuid; -- Quarterly (4000)
    v_resp jsonb;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_staff_id::text, true);

    v_resp := public.onboard_member(
        'Rohan Sharma', '9876543210', 'rohan@test.com', 'Male', '1995-05-10'::date,
        'Gandhinagar', '9876543211', 'O+', 'None', 'Morning batch',
        v_plan_id, '2026-10-01'::date, 2500.00, 'UPI', 'IDEMP-TEST-001'
    );

    IF (v_resp->>'success')::boolean <> true THEN
        RAISE EXCEPTION 'TEST 1 FAILED: onboard_member returned false success';
    END IF;

    IF (v_resp->>'outstanding_balance')::numeric <> 1500.00 THEN
        RAISE EXCEPTION 'TEST 1 FAILED: Expected balance 1500.00, got %', v_resp->>'outstanding_balance';
    END IF;

    RAISE NOTICE 'TEST 1 PASSED: Onboard member created atomically with correct contract and receipt.';
END $$;

-- ----------------------------------------------------------------------------
-- TEST 2: Duplicate Idempotency Replay & Divergence Rejection
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_staff_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;
    v_plan_id uuid := 'aaaaaaaa-0000-0000-0000-000000000002'::uuid;
    v_resp2 jsonb;
    v_caught_mismatch boolean := false;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_staff_id::text, true);

    -- Identical call returns identical cached response
    v_resp2 := public.onboard_member(
        'Rohan Sharma', '9876543210', 'rohan@test.com', 'Male', '1995-05-10'::date,
        'Gandhinagar', '9876543211', 'O+', 'None', 'Morning batch',
        v_plan_id, '2026-10-01'::date, 2500.00, 'UPI', 'IDEMP-TEST-001'
    );

    IF v_resp2->>'receipt_number' IS NULL THEN
        RAISE EXCEPTION 'TEST 2 FAILED: Cached response missing receipt_number';
    END IF;

    -- Reusing key with altered payload amount must fail with P0004
    BEGIN
        PERFORM public.onboard_member(
            'Rohan Sharma', '9876543210', 'rohan@test.com', 'Male', '1995-05-10'::date,
            'Gandhinagar', '9876543211', 'O+', 'None', 'Morning batch',
            v_plan_id, '2026-10-01'::date, 3000.00, 'UPI', 'IDEMP-TEST-001'
        );
    EXCEPTION WHEN SQLSTATE 'P0004' THEN
        v_caught_mismatch := true;
    END;

    IF NOT v_caught_mismatch THEN
        RAISE EXCEPTION 'TEST 2 FAILED: Reused idempotency key with altered payload was not rejected!';
    END IF;

    RAISE NOTICE 'TEST 2 PASSED: Idempotency exact replay returned cached result, payload divergence rejected.';
END $$;

-- ----------------------------------------------------------------------------
-- TEST 3: Partial Payments, Overpayment Rejection & Settlement
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_staff_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;
    v_member_id uuid;
    v_sub_id uuid;
    v_caught_overpayment boolean := false;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_staff_id::text, true);

    SELECT id INTO v_member_id FROM public.members WHERE phone = '9876543210';
    SELECT id INTO v_sub_id FROM public.member_subscriptions WHERE member_id = v_member_id AND status = 'active';

    -- Remaining balance is 1500.00. Attempt paying 2000.00 (Overpayment):
    BEGIN
        PERFORM public.record_dues_payment(v_member_id, v_sub_id, 2000.00, 'Cash', 'Excess payment', 'IDEMP-TEST-OVERPAY');
    EXCEPTION WHEN SQLSTATE '22003' THEN
        v_caught_overpayment := true;
    END;

    IF NOT v_caught_overpayment THEN
        RAISE EXCEPTION 'TEST 3 FAILED: Overpayment was not rejected by record_dues_payment!';
    END IF;

    -- Pay partial dues of 500.00
    PERFORM public.record_dues_payment(v_member_id, v_sub_id, 500.00, 'Cash', 'Partial dues', 'IDEMP-TEST-PARTIAL');
    IF (SELECT balance FROM public.member_subscriptions WHERE id = v_sub_id) <> 1000.00 THEN
        RAISE EXCEPTION 'TEST 3 FAILED: Contract balance expected 1000.00, got %',
            (SELECT balance FROM public.member_subscriptions WHERE id = v_sub_id);
    END IF;

    -- Settle remaining balance of 1000.00:
    PERFORM public.record_dues_payment(v_member_id, v_sub_id, 1000.00, 'Cash', 'Exact dues settlement', 'IDEMP-TEST-SETTLE');

    IF (SELECT balance FROM public.member_subscriptions WHERE id = v_sub_id) <> 0.00 THEN
        RAISE EXCEPTION 'TEST 3 FAILED: Contract balance did not reach 0 after exact settlement';
    END IF;

    RAISE NOTICE 'TEST 3 PASSED: Overpayment rejected, partial payment and settlement exact.';
END $$;

-- ----------------------------------------------------------------------------
-- TEST 4: Renewal with Debt Carry-Forward Across Two Consecutive Renewals
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_staff_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;
    v_member_id uuid;
    v_sub1_id uuid;
    v_sub2_id uuid;
    v_sub3_id uuid;
    v_monthly_plan_id uuid := 'aaaaaaaa-0000-0000-0000-000000000001'::uuid; -- 1500
    v_yearly_plan_id uuid := 'aaaaaaaa-0000-0000-0000-000000000003'::uuid;  -- 12000
    v_resp jsonb;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_staff_id::text, true);

    SELECT id INTO v_member_id FROM public.members WHERE phone = '9876543210';
    SELECT id INTO v_sub1_id FROM public.member_subscriptions WHERE member_id = v_member_id AND status = 'active';

    -- Simulate Sub 1 having 1000.00 unpaid dues
    UPDATE public.member_subscriptions SET amount_paid = 3000.00 WHERE id = v_sub1_id;
    -- Sub 1 stored balance is now 1000.00

    -- RENEWAL 1 (Sub 1 -> Sub 2): Monthly (1500), carry 1000 debt, pay 1000 renewal payment
    v_resp := public.renew_member_subscription(
        v_member_id, v_monthly_plan_id, '2027-01-01'::date, true, 1000.00, 'UPI', 'IDEMP-RENEW-01'
    );
    v_sub2_id := (v_resp->>'subscription_id')::uuid;

    -- Assert Sub 1 balance is zeroed out
    IF (SELECT balance FROM public.member_subscriptions WHERE id = v_sub1_id) <> 0.00 THEN
        RAISE EXCEPTION 'TEST 4 FAILED: Sub 1 balance not zeroed out after carry-forward!';
    END IF;

    -- Sub 2 liability = 1500 + 1000 = 2500, paid = 1000, balance = 1500
    IF (SELECT balance FROM public.member_subscriptions WHERE id = v_sub2_id) <> 1500.00 THEN
        RAISE EXCEPTION 'TEST 4 FAILED: Sub 2 balance expected 1500.00, got %',
            (SELECT balance FROM public.member_subscriptions WHERE id = v_sub2_id);
    END IF;

    -- RENEWAL 2 (Sub 2 -> Sub 3): Yearly (12000), carry 1500 debt, pay 3500 renewal payment
    v_resp := public.renew_member_subscription(
        v_member_id, v_yearly_plan_id, '2027-02-01'::date, true, 3500.00, 'UPI', 'IDEMP-RENEW-02'
    );
    v_sub3_id := (v_resp->>'subscription_id')::uuid;

    -- Assert Sub 2 balance is zeroed out
    IF (SELECT balance FROM public.member_subscriptions WHERE id = v_sub2_id) <> 0.00 THEN
        RAISE EXCEPTION 'TEST 4 FAILED: Sub 2 balance not zeroed out after carry-forward!';
    END IF;

    -- Sub 3 liability = 12000 + 1500 = 13500, paid = 3500, balance = 10000
    IF (SELECT balance FROM public.member_subscriptions WHERE id = v_sub3_id) <> 10000.00 THEN
        RAISE EXCEPTION 'TEST 4 FAILED: Sub 3 balance expected 10000.00, got %',
            (SELECT balance FROM public.member_subscriptions WHERE id = v_sub3_id);
    END IF;

    -- Zero Double Counting Audit across all 3 contracts:
    -- Sub 1 = 0.00, Sub 2 = 0.00, Sub 3 = 10000.00. Total = 10000.00.
    RAISE NOTICE 'TEST 4 PASSED: Renewal debt successfully carried across two consecutive renewals without double-counting.';
END $$;

-- ----------------------------------------------------------------------------
-- TEST 5: Refunds on Superseded Chain & Refund Ceiling Guard
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_admin_id uuid := '11111111-1111-1111-1111-111111111111'::uuid;
    v_member_id uuid;
    v_sub1_id uuid;
    v_sub2_id uuid;
    v_sub3_id uuid;
    v_pay_id uuid;
    v_orig_amount numeric;
    v_caught_ceiling boolean := false;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

    SELECT id INTO v_member_id FROM public.members WHERE phone = '9876543210';
    SELECT id INTO v_sub3_id FROM public.member_subscriptions WHERE member_id = v_member_id AND status = 'active';

    -- Find initial renewal payment on Sub 2 (amount was 1000.00)
    SELECT id, subscription_id, amount INTO v_pay_id, v_sub2_id, v_orig_amount
    FROM public.payments
    WHERE member_id = v_member_id AND notes = 'Renewal payment with carried debt' AND amount = 1000.00
    LIMIT 1;

    -- 1. Attempt refunding 1500.00 on a 1000.00 payment (Ceiling Guard Test)
    BEGIN
        PERFORM public.record_refund_transaction(v_pay_id, 1500.00, 'Cash', 'Excess refund test', 'IDEMP-REF-CEIL');
    EXCEPTION WHEN SQLSTATE '22003' THEN
        v_caught_ceiling := true;
    END;

    IF NOT v_caught_ceiling THEN
        RAISE EXCEPTION 'TEST 5 FAILED: Refund exceeding original payment was not rejected!';
    END IF;

    -- 2. Issue valid refund of 500.00 on Sub 2 payment
    -- Sub 2 is superseded and transferred to Sub 3!
    -- Restored debt must flow forward: Sub 2 balance stays 0, Sub 3 balance increments from 10000 to 10500!
    PERFORM public.record_refund_transaction(v_pay_id, 500.00, 'Cash', 'Legitimate partial refund', 'IDEMP-REF-CHAIN');

    IF (SELECT balance FROM public.member_subscriptions WHERE id = v_sub2_id) <> 0.00 THEN
        RAISE EXCEPTION 'TEST 5 FAILED: Superseded contract balance corrupted after refund!';
    END IF;

    IF (SELECT balance FROM public.member_subscriptions WHERE id = v_sub3_id) <> 10500.00 THEN
        RAISE EXCEPTION 'TEST 5 FAILED: Active contract did not receive restored debt from refund! Got %',
            (SELECT balance FROM public.member_subscriptions WHERE id = v_sub3_id);
    END IF;

    RAISE NOTICE 'TEST 5 PASSED: Refund ceiling enforced; refund on superseded contract properly restored debt to active contract.';
END $$;

-- ----------------------------------------------------------------------------
-- TEST 6: Standalone Facility Payment & Standalone Refund Integrity
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_admin_id uuid := '11111111-1111-1111-1111-111111111111'::uuid;
    v_member_id uuid;
    v_pay_id uuid;
    v_receipt text;
    v_refund_resp jsonb;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

    SELECT id INTO v_member_id FROM public.members WHERE phone = '9876543210';

    -- Insert Facility payment (subscription_id IS NULL and pt_assignment_id IS NULL)
    v_receipt := public.generate_receipt_number();
    INSERT INTO public.payments (
        receipt_number, member_id, subscription_id, pt_assignment_id,
        transaction_type, amount, payment_method, status, notes, actor_id
    ) VALUES (
        v_receipt, v_member_id, NULL, NULL,
        'payment', 500.00, 'Cash', 'completed', 'Day Pass Store', v_admin_id
    ) RETURNING id INTO v_pay_id;

    -- Standalone refund of 200.00 permitted by corrected chk_payment_target
    v_refund_resp := public.record_refund_transaction(v_pay_id, 200.00, 'Cash', 'Day pass refund', 'IDEMP-FAC-01');

    IF (v_refund_resp->>'success')::boolean <> true THEN
        RAISE EXCEPTION 'TEST 6 FAILED: Standalone facility refund failed!';
    END IF;

    RAISE NOTICE 'TEST 6 PASSED: Facility payment and standalone refund processed without contract linkage.';
END $$;

-- ----------------------------------------------------------------------------
-- TEST 7: Personal Training (PT) Dues, Sessions, & Ceiling Exhaustion
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_staff_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;
    v_member_id uuid;
    v_pkg_id uuid := 'cccccccc-0000-0000-0000-000000000001'::uuid; -- 10 sessions, 5000 fee
    v_trainer_id uuid := 'bbbbbbbb-0000-0000-0000-000000000001'::uuid;
    v_pt_resp jsonb;
    v_pt_id uuid;
    v_caught_pt_overpay boolean := false;
    v_caught_pt_exhaust boolean := false;
    v_i integer;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_staff_id::text, true);

    SELECT id INTO v_member_id FROM public.members WHERE phone = '9876543210';

    -- 1. Assign PT package with initial payment of 3000.00 (Balance = 2000.00)
    v_pt_resp := public.assign_pt_package(
        v_member_id, v_pkg_id, v_trainer_id, '2026-10-15'::date,
        3000.00, 'Cash', 'Strength training', 'IDEMP-PT-001'
    );
    v_pt_id := (v_pt_resp->>'pt_assignment_id')::uuid;

    -- 2. Attempt overpayment of 2500.00 on 2000.00 balance
    BEGIN
        PERFORM public.record_pt_dues_payment(v_member_id, v_pt_id, 2500.00, 'UPI', 'Excess PT dues', 'IDEMP-PT-OVERPAY');
    EXCEPTION WHEN SQLSTATE '22003' THEN
        v_caught_pt_overpay := true;
    END;

    IF NOT v_caught_pt_overpay THEN
        RAISE EXCEPTION 'TEST 7 FAILED: PT overpayment was not rejected!';
    END IF;

    -- Settle exact PT balance of 2000.00
    PERFORM public.record_pt_dues_payment(v_member_id, v_pt_id, 2000.00, 'UPI', 'Exact PT dues', 'IDEMP-PT-SETTLE');
    IF (SELECT balance FROM public.pt_assignments WHERE id = v_pt_id) <> 0.00 THEN
        RAISE EXCEPTION 'TEST 7 FAILED: PT balance not zero after settlement!';
    END IF;

    -- 3. Log all 10 sessions
    FOR v_i IN 1..10 LOOP
        PERFORM public.complete_pt_session(v_pt_id, 'Session ' || v_i);
    END LOOP;

    -- Status must now be 'completed' and remaining_sessions must be 0
    IF (SELECT status FROM public.pt_assignments WHERE id = v_pt_id) <> 'completed' THEN
        RAISE EXCEPTION 'TEST 7 FAILED: PT assignment status expected completed!';
    END IF;

    -- 4. Attempt 11th session (Exhaustion Test)
    BEGIN
        PERFORM public.complete_pt_session(v_pt_id, 'Session 11 overflow');
    EXCEPTION WHEN SQLSTATE '22003' THEN
        v_caught_pt_exhaust := true;
    END;

    IF NOT v_caught_pt_exhaust THEN
        RAISE EXCEPTION 'TEST 7 FAILED: Logging session beyond total_sessions was not rejected!';
    END IF;

    -- Verify package integrity: remains completed with no extra session logged
    IF (SELECT status FROM public.pt_assignments WHERE id = v_pt_id) <> 'completed' THEN
        RAISE EXCEPTION 'TEST 7 FAILED: PT assignment status altered after rejected 11th session!';
    END IF;

    IF (SELECT completed_sessions FROM public.pt_assignments WHERE id = v_pt_id) <> 10 THEN
        RAISE EXCEPTION 'TEST 7 FAILED: Completed sessions altered after rejected 11th session!';
    END IF;

    IF (SELECT count(*) FROM public.pt_sessions WHERE assignment_id = v_pt_id) <> 10 THEN
        RAISE EXCEPTION 'TEST 7 FAILED: Session log count altered after rejected 11th session!';
    END IF;

    RAISE NOTICE 'TEST 7 PASSED: PT package assigned, dues settled, all sessions logged, and session ceiling enforced.';
END $$;

-- ----------------------------------------------------------------------------
-- TEST 8: Staff vs Admin Permissions & Least-Privilege Denials
-- ----------------------------------------------------------------------------
-- 8a. Switch session role to unprivileged authenticated role
SET ROLE authenticated;

DO $$
DECLARE
    v_staff_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;
    v_caught_trunc boolean := false;
    v_caught_insert boolean := false;
    v_caught_report boolean := false;
    v_caught_role boolean := false;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_staff_id::text, true);

    -- 1. TRUNCATE catalog denial (Least-privilege: TRUNCATE strictly revoked)
    BEGIN
        EXECUTE 'TRUNCATE TABLE public.membership_plans;';
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_caught_trunc := true;
    END;
    IF NOT v_caught_trunc THEN
        RAISE EXCEPTION 'TEST 8 FAILED: Staff was able to TRUNCATE membership_plans!';
    END IF;

    -- 2. Direct member INSERT denial (Must use onboard_member RPC)
    BEGIN
        INSERT INTO public.members (member_code, name, phone)
        VALUES ('MEM-HACK', 'Hacked Member', '0000000000');
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_caught_insert := true;
    END;
    IF NOT v_caught_insert THEN
        RAISE EXCEPTION 'TEST 8 FAILED: Staff was able to directly INSERT into members!';
    END IF;

    -- 3. Executive Report denial for staff
    BEGIN
        PERFORM public.get_executive_revenue_report();
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_caught_report := true;
    END;
    IF NOT v_caught_report THEN
        RAISE EXCEPTION 'TEST 8 FAILED: Staff was able to access get_executive_revenue_report()!';
    END IF;

    -- 4. Role elevation denial for staff
    BEGIN
        PERFORM public.admin_set_user_role(v_staff_id, 'admin');
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_caught_role := true;
    END;
    IF NOT v_caught_role THEN
        RAISE EXCEPTION 'TEST 8 FAILED: Staff was able to promote themselves to admin!';
    END IF;

    RAISE NOTICE 'TEST 8a (Staff Denials) PASSED: All staff denial gates and privilege boundaries verified.';
END $$;

-- 8b. Revert to session login user (postgres superuser)
RESET ROLE;

-- 8c. Verify admin execution of executive revenue report succeeds
DO $$
DECLARE
    v_admin_id uuid := '11111111-1111-1111-1111-111111111111'::uuid;
    v_report jsonb;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    v_report := public.get_executive_revenue_report();
    IF (v_report->>'net_cash_revenue')::numeric <= 0.00 THEN
        RAISE EXCEPTION 'TEST 8 FAILED: Admin executive report returned invalid net revenue';
    END IF;

    RAISE NOTICE 'TEST 8b (Admin Execution) PASSED: Admin executive revenue report verified.';
END $$;

-- ----------------------------------------------------------------------------
-- TEST 9: Profile Email Privacy & Sanitized Staff Roster Attribution
-- ----------------------------------------------------------------------------
-- 9a. Switch session role to unprivileged authenticated role
SET ROLE authenticated;

DO $$
DECLARE
    v_staff_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;
    v_visible_emails integer;
    v_roster_count integer;
    v_caught_profile_update boolean := false;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_staff_id::text, true);

    -- Querying profiles table: staff should only see 1 email (their own)
    SELECT COUNT(*) INTO v_visible_emails FROM public.profiles WHERE email IS NOT NULL;
    IF v_visible_emails <> 1 THEN
        RAISE EXCEPTION 'TEST 9 FAILED: Staff could view coworker emails! Count: %', v_visible_emails;
    END IF;

    -- Querying sanitized roster view: staff can see team members without email exposure
    SELECT COUNT(*) INTO v_roster_count FROM public.v_staff_roster;
    IF v_roster_count < 2 THEN
        RAISE EXCEPTION 'TEST 9 FAILED: Sanitized roster did not return team members!';
    END IF;

    -- Staff attempt to change role via direct profile update must fail (Column-level grant check)
    BEGIN
        UPDATE public.profiles SET role = 'admin' WHERE id = v_staff_id;
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_caught_profile_update := true;
    END;
    IF NOT v_caught_profile_update THEN
        RAISE EXCEPTION 'TEST 9 FAILED: Staff was able to update role directly in profiles!';
    END IF;

    RAISE NOTICE 'TEST 9 PASSED: Profile privacy enforced; sanitized roster view provides attribution.';
END $$;

-- 9b. Revert to session login user
RESET ROLE;

-- ----------------------------------------------------------------------------
-- FINAL ASSERTION SUMMARY
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'ALL 9 COMPREHENSIVE INTEGRATION TEST SUITES PASSED!';
    RAISE NOTICE '================================================================';
END $$;
