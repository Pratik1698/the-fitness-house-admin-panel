-- ============================================================================
-- Phase 6 Verification Suite: Scheduler, Generator, Observability & Idempotency
-- ============================================================================
\set ON_ERROR_STOP on

BEGIN;

-- ----------------------------------------------------------------------------
-- SETUP: Authenticated Admin Session Simulation
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_admin_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    -- Ensure test admin exists in auth.users
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_admin_id) THEN
        INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud)
        VALUES (
            v_admin_id,
            'admin_phase6_test@thefitnesshouse.local',
            '{"role": "admin"}'::jsonb,
            'authenticated',
            'authenticated'
        );
    END IF;
END;
$$;

-- Set session to admin user
SET LOCAL "request.jwt.claims" = '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- ----------------------------------------------------------------------------
-- TEST 3: Authorization Checks
-- ----------------------------------------------------------------------------
-- 3a. Calling generate_expiry_reminders without auth must fail
DO $$
DECLARE
    v_threw BOOLEAN := false;
BEGIN
    BEGIN
        -- Clear auth claims to simulate unauthenticated call
        PERFORM set_config('request.jwt.claims', '', true);
        PERFORM public.generate_expiry_reminders();
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '42501' THEN
            v_threw := true;
        ELSE
            RAISE EXCEPTION 'Unexpected error code: % (expected 42501)', SQLSTATE;
        END IF;
    END;

    IF NOT v_threw THEN
        RAISE EXCEPTION 'FAIL: Unauthenticated generate_expiry_reminders did not throw 42501!';
    END IF;
    RAISE NOTICE '[TEST 3a PASS] Unauthenticated generate_expiry_reminders correctly rejected with 42501.';
END;
$$;

-- Reset session to admin user
SET LOCAL "request.jwt.claims" = '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- ----------------------------------------------------------------------------
-- SETUP FIXTURES: 5-Day, 3-Day, Expiry-Today, Expired, and Balance-Due Members
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_plan_id UUID;
    v_today DATE := (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
    v_m5_id UUID;
    v_m3_id UUID;
    v_m0_id UUID;
    v_mexp_id UUID;
    v_mbal_id UUID;
    v_mnodue_id UUID;
BEGIN
    SELECT id INTO v_plan_id FROM public.membership_plans WHERE is_active = true LIMIT 1;
    IF v_plan_id IS NULL THEN
        RAISE EXCEPTION 'Active membership plan required for tests.';
    END IF;

    -- Clean any leftover test fixtures
    DELETE FROM public.notifications WHERE member_id IN (SELECT id FROM public.members WHERE member_code LIKE 'TEST-PHASE6-%');
    DELETE FROM public.member_subscriptions WHERE member_id IN (SELECT id FROM public.members WHERE member_code LIKE 'TEST-PHASE6-%');
    DELETE FROM public.members WHERE member_code LIKE 'TEST-PHASE6-%';

    -- 1. Member expiring in 5 days
    INSERT INTO public.members (name, phone, member_code, is_archived)
    VALUES ('Phase6 Test FiveDay', '9999900001', 'TEST-PHASE6-5D', false)
    RETURNING id INTO v_m5_id;

    INSERT INTO public.member_subscriptions (member_id, plan_id, plan_name, plan_price, status, start_date, expiry_date, amount_paid)
    VALUES (v_m5_id, v_plan_id, 'Monthly', 700.00, 'active', v_today - 25, v_today + 5, 700.00);

    -- 2. Member expiring in 3 days
    INSERT INTO public.members (name, phone, member_code, is_archived)
    VALUES ('Phase6 Test ThreeDay', '9999900002', 'TEST-PHASE6-3D', false)
    RETURNING id INTO v_m3_id;

    INSERT INTO public.member_subscriptions (member_id, plan_id, plan_name, plan_price, status, start_date, expiry_date, amount_paid)
    VALUES (v_m3_id, v_plan_id, 'Monthly', 700.00, 'active', v_today - 27, v_today + 3, 700.00);

    -- 3. Member expiring today (0 days)
    INSERT INTO public.members (name, phone, member_code, is_archived)
    VALUES ('Phase6 Test Today', '9999900003', 'TEST-PHASE6-0D', false)
    RETURNING id INTO v_m0_id;

    INSERT INTO public.member_subscriptions (member_id, plan_id, plan_name, plan_price, status, start_date, expiry_date, amount_paid)
    VALUES (v_m0_id, v_plan_id, 'Monthly', 700.00, 'active', v_today - 30, v_today, 700.00);

    -- 4. Member expired 2 days ago
    INSERT INTO public.members (name, phone, member_code, is_archived)
    VALUES ('Phase6 Test Expired', '9999900004', 'TEST-PHASE6-EXP', false)
    RETURNING id INTO v_mexp_id;

    INSERT INTO public.member_subscriptions (member_id, plan_id, plan_name, plan_price, status, start_date, expiry_date, amount_paid)
    VALUES (v_mexp_id, v_plan_id, 'Monthly', 700.00, 'expired', v_today - 32, v_today - 2, 700.00);

    -- 5. Member with positive outstanding balance (plan_price 700, amount_paid 400 => balance 300)
    INSERT INTO public.members (name, phone, member_code, is_archived)
    VALUES ('Phase6 Test BalanceDue', '9999900005', 'TEST-PHASE6-BAL', false)
    RETURNING id INTO v_mbal_id;

    INSERT INTO public.member_subscriptions (member_id, plan_id, plan_name, plan_price, status, start_date, expiry_date, amount_paid)
    VALUES (v_mbal_id, v_plan_id, 'Monthly', 700.00, 'active', v_today - 10, v_today + 20, 400.00);

    -- 6. Member with 0 balance (plan_price 700, amount_paid 700 => balance 0)
    INSERT INTO public.members (name, phone, member_code, is_archived)
    VALUES ('Phase6 Test NoDue', '9999900006', 'TEST-PHASE6-NODUE', false)
    RETURNING id INTO v_mnodue_id;

    INSERT INTO public.member_subscriptions (member_id, plan_id, plan_name, plan_price, status, start_date, expiry_date, amount_paid)
    VALUES (v_mnodue_id, v_plan_id, 'Monthly', 700.00, 'active', v_today - 10, v_today + 20, 700.00);
END;
$$;

-- ----------------------------------------------------------------------------
-- RUN REMINDER GENERATOR VIA MANUAL ADMIN RPC
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_res jsonb;
BEGIN
    v_res := public.generate_expiry_reminders();
    RAISE NOTICE 'Generation result: %', v_res;
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'generate_expiry_reminders failed: %', v_res;
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- VERIFY TESTS 4, 5, 6, 7, 11, 12 (Correct Notification Classification)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_cnt INTEGER;
BEGIN
    -- Test 4: 5-Day reminder generated
    SELECT count(*) INTO v_cnt
    FROM public.notifications n
    JOIN public.members m ON m.id = n.member_id
    WHERE m.member_code = 'TEST-PHASE6-5D' AND n.notification_type = 'expiry_5d';
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'FAIL: 5-Day reminder not generated (found %)', v_cnt; END IF;
    RAISE NOTICE '[TEST 4 PASS] 5-Day expiry reminder generated correctly.';

    -- Test 5: 3-Day reminder generated (qualifies for both 5d and 3d)
    SELECT count(*) INTO v_cnt
    FROM public.notifications n
    JOIN public.members m ON m.id = n.member_id
    WHERE m.member_code = 'TEST-PHASE6-3D' AND n.notification_type = 'expiry_3d';
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'FAIL: 3-Day reminder not generated (found %)', v_cnt; END IF;
    RAISE NOTICE '[TEST 5 PASS] 3-Day expiry reminder generated correctly.';

    -- Test 6: Expiry-today reminder generated
    SELECT count(*) INTO v_cnt
    FROM public.notifications n
    JOIN public.members m ON m.id = n.member_id
    WHERE m.member_code = 'TEST-PHASE6-0D' AND n.notification_type = 'expiry_today';
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'FAIL: Expiry-today reminder not generated (found %)', v_cnt; END IF;
    RAISE NOTICE '[TEST 6 PASS] Expiry-today reminder generated correctly.';

    -- Test 7: Expired reminder generated
    SELECT count(*) INTO v_cnt
    FROM public.notifications n
    JOIN public.members m ON m.id = n.member_id
    WHERE m.member_code = 'TEST-PHASE6-EXP' AND n.notification_type = 'expired';
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'FAIL: Expired reminder not generated (found %)', v_cnt; END IF;
    RAISE NOTICE '[TEST 7 PASS] Expired reminder generated correctly.';

    -- Test 11: Member with zero balance does not receive payment_due
    SELECT count(*) INTO v_cnt
    FROM public.notifications n
    JOIN public.members m ON m.id = n.member_id
    WHERE m.member_code = 'TEST-PHASE6-NODUE' AND n.notification_type = 'payment_due';
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: Zero balance member received payment_due reminder (found %)', v_cnt; END IF;
    RAISE NOTICE '[TEST 11 PASS] Zero-balance member correctly received no payment_due notification.';

    -- Test 12: Member with positive balance receives payment_due
    SELECT count(*) INTO v_cnt
    FROM public.notifications n
    JOIN public.members m ON m.id = n.member_id
    WHERE m.member_code = 'TEST-PHASE6-BAL' AND n.notification_type = 'payment_due';
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'FAIL: Positive balance member did not receive payment_due reminder (found %)', v_cnt; END IF;
    RAISE NOTICE '[TEST 12 PASS] Positive balance member correctly received payment_due notification.';
END;
$$;

-- ----------------------------------------------------------------------------
-- TEST 8 & 16: Idempotency (Repeated Generation Creates 0 Duplicates)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_res jsonb;
    v_total_before INTEGER;
    v_total_after INTEGER;
BEGIN
    SELECT count(*) INTO v_total_before FROM public.notifications;

    -- Run 1st repeat
    v_res := public.generate_expiry_reminders();
    IF (v_res->>'generated_reminders')::integer <> 0 THEN
        RAISE EXCEPTION 'FAIL: Repeat run 1 generated % reminders (expected 0)!', v_res->>'generated_reminders';
    END IF;

    -- Run 2nd repeat
    v_res := public.generate_expiry_reminders();
    IF (v_res->>'generated_reminders')::integer <> 0 THEN
        RAISE EXCEPTION 'FAIL: Repeat run 2 generated % reminders (expected 0)!', v_res->>'generated_reminders';
    END IF;

    SELECT count(*) INTO v_total_after FROM public.notifications;
    IF v_total_before <> v_total_after THEN
        RAISE EXCEPTION 'FAIL: Total notifications changed from % to % after repeat runs!', v_total_before, v_total_after;
    END IF;

    RAISE NOTICE '[TEST 8 & 16 PASS] Repeated generation is 100%% idempotent. 0 duplicate notifications created.';
END;
$$;

-- ----------------------------------------------------------------------------
-- TEST 10: Renewal & Superseded Subscriptions Handling
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_mexp_id UUID;
    v_plan_id UUID;
    v_today DATE := (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
    v_is_superseded BOOLEAN;
    v_res jsonb;
BEGIN
    SELECT id INTO v_mexp_id FROM public.members WHERE member_code = 'TEST-PHASE6-EXP';
    SELECT id INTO v_plan_id FROM public.membership_plans WHERE is_active = true LIMIT 1;

    -- Simulate member renewing with a new active contract
    INSERT INTO public.member_subscriptions (member_id, plan_id, plan_name, plan_price, status, start_date, expiry_date, amount_paid)
    VALUES (v_mexp_id, v_plan_id, 'Monthly Renewal', 700.00, 'active', v_today, v_today + 30, 700.00);

    -- Run reminder generation again
    v_res := public.generate_expiry_reminders();

    -- Check view public.v_notifications for the previous expired alert
    SELECT is_superseded INTO v_is_superseded
    FROM public.v_notifications
    WHERE member_code = 'TEST-PHASE6-EXP' AND notification_type = 'expired';

    IF v_is_superseded IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL: Expired notification for renewed member was not flagged is_superseded!';
    END IF;

    RAISE NOTICE '[TEST 10 PASS] Renewed member correctly supersedes past notifications without false alerts.';
END;
$$;

-- ----------------------------------------------------------------------------
-- TEST 18: Latest Job Status RPC Check
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_status jsonb;
BEGIN
    v_status := public.get_latest_reminder_job_status();
    IF (v_status->>'has_run')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL: get_latest_reminder_job_status reported has_run = false!';
    END IF;
    IF v_status->>'status' <> 'succeeded' THEN
        RAISE EXCEPTION 'FAIL: Expected job status succeeded, got: %', v_status->>'status';
    END IF;
    RAISE NOTICE '[TEST 18 PASS] get_latest_reminder_job_status returned valid backend run details: %', v_status;
END;
$$;

-- ----------------------------------------------------------------------------
-- CLEANUP TEST FIXTURES
-- ----------------------------------------------------------------------------
DELETE FROM public.notifications WHERE member_id IN (SELECT id FROM public.members WHERE member_code LIKE 'TEST-PHASE6-%');
DELETE FROM public.member_subscriptions WHERE member_id IN (SELECT id FROM public.members WHERE member_code LIKE 'TEST-PHASE6-%');
DELETE FROM public.members WHERE member_code LIKE 'TEST-PHASE6-%';

-- Verify cleanup
DO $$
DECLARE
    v_rem_count INTEGER;
    v_notif_count INTEGER;
BEGIN
    SELECT count(*) INTO v_rem_count FROM public.members WHERE member_code LIKE 'TEST-PHASE6-%';
    IF v_rem_count > 0 THEN
        RAISE EXCEPTION 'FAIL: Test members not completely removed (% remaining)!', v_rem_count;
    END IF;
    SELECT count(*) INTO v_notif_count FROM public.notifications;
    IF v_notif_count <> 0 THEN
        RAISE EXCEPTION 'FAIL: Leftover test notifications found (%)!', v_notif_count;
    END IF;
    RAISE NOTICE '[CLEANUP OK] All test fixtures and notifications scrubbed cleanly.';
END;
$$;

COMMIT;
