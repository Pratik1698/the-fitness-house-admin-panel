-- ============================================================================
-- Temporary Disposable Fixtures for WhatsApp Workflow Verification
-- ============================================================================
BEGIN;

DO $$
DECLARE
    v_plan_id UUID;
    v_today DATE := (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
    v_m1 UUID;
    v_m2 UUID;
    v_m3 UUID;
    v_m4 UUID;
    v_m5 UUID;
    v_m6 UUID;
    v_old_sub UUID;
BEGIN
    SELECT id INTO v_plan_id FROM public.membership_plans WHERE is_active = true LIMIT 1;

    -- Clean any leftover test fixtures
    DELETE FROM public.notifications WHERE member_id IN (SELECT id FROM public.members WHERE member_code LIKE 'TEST-WA-%');
    DELETE FROM public.member_subscriptions WHERE member_id IN (SELECT id FROM public.members WHERE member_code LIKE 'TEST-WA-%');
    DELETE FROM public.members WHERE member_code LIKE 'TEST-WA-%';

    -- 1. Five-Day Expiring Member with standard 10-digit phone
    INSERT INTO public.members (name, phone, member_code, is_archived)
    VALUES ('WhatsApp Test ValidFiveDay', '9876500002', 'TEST-WA-5D', false)
    RETURNING id INTO v_m1;

    INSERT INTO public.member_subscriptions (member_id, plan_id, plan_name, plan_price, status, start_date, expiry_date, amount_paid)
    VALUES (v_m1, v_plan_id, 'Monthly Plan', 700.00, 'active', v_today - 25, v_today + 5, 700.00);

    -- 2. Expiry-Today Member with +91 country-coded phone
    INSERT INTO public.members (name, phone, member_code, is_archived)
    VALUES ('WhatsApp Test CountryCodeToday', '+91 9876500003', 'TEST-WA-0D', false)
    RETURNING id INTO v_m2;

    INSERT INTO public.member_subscriptions (member_id, plan_id, plan_name, plan_price, status, start_date, expiry_date, amount_paid)
    VALUES (v_m2, v_plan_id, 'Quarterly Plan', 1800.00, 'active', v_today - 90, v_today, 1800.00);

    -- 3. Expiring Member with invalid short phone
    INSERT INTO public.members (name, phone, member_code, is_archived)
    VALUES ('WhatsApp Test InvalidPhone', '12345', 'TEST-WA-INVP', false)
    RETURNING id INTO v_m3;

    INSERT INTO public.member_subscriptions (member_id, plan_id, plan_name, plan_price, status, start_date, expiry_date, amount_paid)
    VALUES (v_m3, v_plan_id, 'Monthly Plan', 700.00, 'active', v_today - 25, v_today + 5, 700.00);

    -- 4. Expiring Member with blank phone
    INSERT INTO public.members (name, phone, member_code, is_archived)
    VALUES ('WhatsApp Test BlankPhone', '', 'TEST-WA-NOPH', false)
    RETURNING id INTO v_m4;

    INSERT INTO public.member_subscriptions (member_id, plan_id, plan_name, plan_price, status, start_date, expiry_date, amount_paid)
    VALUES (v_m4, v_plan_id, 'Monthly Plan', 700.00, 'active', v_today - 25, v_today + 5, 700.00);

    -- 5. Member with Cancelled subscription (should not generate reminder)
    INSERT INTO public.members (name, phone, member_code, is_archived)
    VALUES ('WhatsApp Test CancelledSub', '9876500005', 'TEST-WA-CANC', false)
    RETURNING id INTO v_m5;

    INSERT INTO public.member_subscriptions (member_id, plan_id, plan_name, plan_price, status, start_date, expiry_date, amount_paid)
    VALUES (v_m5, v_plan_id, 'Monthly Plan', 700.00, 'cancelled', v_today - 25, v_today + 5, 700.00);

    -- 6. Member with Renewed subscription (old sub superseded by active future sub)
    INSERT INTO public.members (name, phone, member_code, is_archived)
    VALUES ('WhatsApp Test RenewedSub', '9876500006', 'TEST-WA-RENEW', false)
    RETURNING id INTO v_m6;

    -- Older expired subscription
    INSERT INTO public.member_subscriptions (member_id, plan_id, plan_name, plan_price, status, start_date, expiry_date, amount_paid)
    VALUES (v_m6, v_plan_id, 'Monthly Plan', 700.00, 'expired', v_today - 35, v_today - 5, 700.00)
    RETURNING id INTO v_old_sub;

    -- Old notification on old subscription
    INSERT INTO public.notifications (member_id, subscription_id, notification_type, title, message, days_remaining, target_date, channel, status)
    VALUES (v_m6, v_old_sub, 'expiry_5d', 'Membership Expiring in 5 Days', 'Membership expires in 5 days.', -5, v_today - 5, 'In-App', 'unread');

    -- New active renewed subscription expiring in 60 days
    INSERT INTO public.member_subscriptions (member_id, plan_id, plan_name, plan_price, status, start_date, expiry_date, amount_paid)
    VALUES (v_m6, v_plan_id, 'Quarterly Plan', 1800.00, 'active', v_today - 4, v_today + 60, 1800.00);

END;
$$;

COMMIT;
