-- ============================================================================
-- Migration: 20261107000000_fix_renew_member_subscription_status.sql
-- Description: Fix member_subscriptions check constraint violation on renewal
--
-- Issue: When renewing a member whose previous subscription was fully paid
-- (balance <= 0.00), renew_member_subscription attempted to update the prior
-- contract to status = 'completed'. Table public.member_subscriptions strictly
-- enforces CHECK (status IN ('active', 'expired', 'superseded', 'cancelled')).
-- Setting status = 'completed' caused SQLSTATE 23514 (check constraint violation).
--
-- Fix: Update the fully paid previous subscription branch to status = 'superseded',
-- which matches canonical subscription lifecycle semantics and conforms to
-- member_subscriptions_status_check.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.renew_member_subscription(
    p_member_id uuid,
    p_plan_id uuid,
    p_start_date date,
    p_carry_forward_balance boolean,
    p_payment_amount numeric,
    p_payment_method text,
    p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_plan record;
    v_prev_sub record;
    v_carried_balance numeric(12, 2) := 0.00;
    v_new_sub_id uuid;
    v_expiry_date date;
    v_payment_id uuid := NULL;
    v_receipt_number text := NULL;
    v_canonical_payload jsonb;
    v_payload_hash text;
    v_cached_response jsonb;
    v_cached_hash text;
    v_lock_key text;
    v_response jsonb;
BEGIN
    -- Authorization: active administrator required
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can renew membership subscriptions.' USING ERRCODE = '42501';
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Idempotency key is required.' USING ERRCODE = '22023';
    END IF;

    IF p_member_id IS NULL OR p_plan_id IS NULL OR p_start_date IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Member ID, plan ID, and start date are mandatory.' USING ERRCODE = '22023';
    END IF;
    IF p_payment_amount IS NULL OR p_payment_amount < 0.00 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Payment amount cannot be negative or null.' USING ERRCODE = '22003';
    END IF;
    IF p_payment_amount > 0.00 AND p_payment_method NOT IN ('Cash', 'UPI', 'Card') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Invalid payment method.' USING ERRCODE = '22023';
    END IF;

    v_canonical_payload := jsonb_build_object(
        'member_id', p_member_id,
        'plan_id', p_plan_id,
        'start_date', p_start_date,
        'carry_forward', p_carry_forward_balance,
        'payment_amount', to_char(p_payment_amount, 'FM999999990.00'),
        'payment_method', p_payment_method
    );
    v_payload_hash := public.hash_payload(v_canonical_payload);

    -- Lock this caller/operation/key before looking for a cached response.
    v_lock_key := v_actor_id::text || ':renew_member_subscription:' || p_idempotency_key;
    PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_lock_key), 1, 16))::bit(64)::bigint);

    SELECT response, payload_hash INTO v_cached_response, v_cached_hash
    FROM public.idempotency_keys
    WHERE actor_id = v_actor_id
      AND operation = 'renew_member_subscription'
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_cached_hash IS DISTINCT FROM v_payload_hash THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: A divergent request already used this idempotency key.' USING ERRCODE = '23505';
        END IF;
        RETURN v_cached_response;
    END IF;
    SELECT * INTO v_plan
    FROM public.membership_plans
    WHERE id = p_plan_id AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_PLAN: Active membership plan not found.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_prev_sub
    FROM public.member_subscriptions
    WHERE member_id = p_member_id AND status = 'active'
    ORDER BY expiry_date DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        IF v_prev_sub.balance > 0.00 THEN
            IF NOT p_carry_forward_balance THEN
                RAISE EXCEPTION 'ERR_OUTSTANDING_BALANCE_NOT_SETTLED: Previous contract has an unpaid balance of %. Settle dues or carry forward.' , v_prev_sub.balance USING ERRCODE = '22000';
            ELSE
                v_carried_balance := v_prev_sub.balance;
                UPDATE public.member_subscriptions
                SET status = 'superseded',
                    updated_at = clock_timestamp()
                WHERE id = v_prev_sub.id;
            END IF;
        ELSE
            UPDATE public.member_subscriptions
            SET status = 'superseded',
                updated_at = clock_timestamp()
            WHERE id = v_prev_sub.id;
        END IF;
    END IF;

    IF p_payment_amount > (v_plan.price + v_carried_balance) THEN
        RAISE EXCEPTION 'ERR_OVERPAYMENT_EXCEEDS_BALANCE: Payment % exceeds total liability %.', p_payment_amount, (v_plan.price + v_carried_balance) USING ERRCODE = '22003';
    END IF;

    v_expiry_date := p_start_date + (v_plan.duration_days || ' days')::interval;

    INSERT INTO public.member_subscriptions (
        member_id,
        plan_id,
        plan_name,
        plan_price,
        previous_balance_carried,
        amount_paid,
        start_date,
        expiry_date,
        status
    ) VALUES (
        p_member_id,
        v_plan.id,
        v_plan.name,
        v_plan.price,
        v_carried_balance,
        0.00,
        p_start_date,
        v_expiry_date,
        'active'
    ) RETURNING id INTO v_new_sub_id;

    IF p_payment_amount > 0.00 THEN
        v_receipt_number := public.generate_receipt_number();
        INSERT INTO public.payments (
            receipt_number,
            member_id,
            subscription_id,
            transaction_type,
            amount,
            payment_method,
            status,
            notes,
            actor_id
        ) VALUES (
            v_receipt_number,
            p_member_id,
            v_new_sub_id,
            'payment',
            p_payment_amount,
            p_payment_method,
            'completed',
            'Renewal initial dues collection',
            v_actor_id
        ) RETURNING id INTO v_payment_id;
    END IF;

    v_response := jsonb_build_object(
        'subscription_id', v_new_sub_id,
        'member_id', p_member_id,
        'plan_name', v_plan.name,
        'new_expiry_date', v_expiry_date,
        'total_liability', v_plan.price + v_carried_balance,
        'amount_paid', p_payment_amount,
        'balance', (v_plan.price + v_carried_balance) - p_payment_amount,
        'payment_status', CASE WHEN ((v_plan.price + v_carried_balance) - p_payment_amount) = 0.00 THEN 'paid' WHEN p_payment_amount > 0.00 THEN 'partial' ELSE 'unpaid' END,
        'payment_id', v_payment_id,
        'receipt_number', v_receipt_number
    );

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'renew_member_subscription', p_idempotency_key, v_payload_hash, v_response)
    ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING;

    RETURN v_response;
END;
$$;

GRANT EXECUTE ON FUNCTION public.renew_member_subscription(uuid, uuid, date, boolean, numeric, text, text) TO authenticated;

