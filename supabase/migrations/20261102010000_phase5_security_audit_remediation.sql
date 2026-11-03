-- Phase 5 local security remediation. Additive and transaction scoped; does not touch member or financial rows.
BEGIN;

-- API roles cannot create objects in a trusted SECURITY DEFINER search-path schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA extensions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.member_code_seq, public.receipt_number_seq, public.checkin_code_seq
    FROM PUBLIC, anon, authenticated, service_role;
-- Revoke API execution only from the Phase 5 RPCs and internal helpers reviewed here.
-- Other application RPC ACLs are preserved; this avoids silently removing unrelated workflows.
REVOKE ALL ON FUNCTION
    public.get_user_role(), public.is_admin(), public.is_staff(),
    public.admin_set_user_status(uuid, boolean), public.admin_set_user_role(uuid, text),
    public.create_staff_invitation(text, text), public.resend_staff_invitation(uuid),
    public.revoke_staff_invitation(uuid), public.accept_staff_invitation(),
    public.record_dues_payment(uuid, uuid, numeric, text, text, text),
    public.record_pt_dues_payment(uuid, uuid, numeric, text, text, text),
    public.renew_member_subscription(uuid, uuid, date, boolean, numeric, text, text),
    public.onboard_member(text, text, text, text, date, text, text, text, text, text, uuid, date, numeric, text, text),
    public.assign_pt_package(uuid, uuid, uuid, date, numeric, text, text, text),
    public.get_staff_operational_summary(), public.fn_on_auth_user_created(),
    public.fn_sync_payment_balances(), public.fn_prevent_tamper_payment_records(),
    public.hash_payload(jsonb), public.generate_member_code(),
    public.generate_receipt_number(), public.generate_checkin_code()
    FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION
    public.fn_on_auth_user_created(),
    public.fn_sync_payment_balances(), public.fn_prevent_tamper_payment_records(),
    public.hash_payload(jsonb), public.generate_member_code(),
    public.generate_receipt_number(), public.generate_checkin_code()
    FROM authenticated;

GRANT EXECUTE ON FUNCTION
    public.get_user_role(), public.is_admin(), public.is_staff(),
    public.admin_set_user_status(uuid, boolean), public.admin_set_user_role(uuid, text),
    public.create_staff_invitation(text, text), public.resend_staff_invitation(uuid),
    public.revoke_staff_invitation(uuid), public.accept_staff_invitation(),
    public.record_dues_payment(uuid, uuid, numeric, text, text, text),
    public.record_pt_dues_payment(uuid, uuid, numeric, text, text, text),
    public.renew_member_subscription(uuid, uuid, date, boolean, numeric, text, text),
    public.onboard_member(text, text, text, text, date, text, text, text, text, text, uuid, date, numeric, text, text),
    public.assign_pt_package(uuid, uuid, uuid, date, numeric, text, text, text),
    public.get_staff_operational_summary() TO authenticated;

REVOKE ALL ON public.profiles, public.members, public.membership_plans,
    public.member_subscriptions, public.pt_packages, public.trainers, public.pt_assignments,
    public.pt_sessions, public.payments, public.idempotency_keys, public.checkins,
    public.notifications, public.member_followups, public.gym_info, public.reminder_settings,
    public.staff_invitations, public.security_audit_logs FROM PUBLIC, anon;
REVOKE ALL ON public.v_active_members, public.v_member_dues, public.v_outstanding_payments,
    public.v_notifications, public.v_staff_roster, public.v_member_followups,
    public.v_attendance_logs FROM PUBLIC, anon;
REVOKE ALL ON public.profiles, public.members, public.membership_plans,
    public.member_subscriptions, public.pt_packages, public.trainers, public.pt_assignments,
    public.pt_sessions, public.payments, public.idempotency_keys, public.checkins,
    public.notifications, public.member_followups, public.gym_info, public.reminder_settings,
    public.staff_invitations, public.security_audit_logs,
    public.v_active_members, public.v_member_dues, public.v_outstanding_payments,
    public.v_notifications, public.v_staff_roster, public.v_member_followups,
    public.v_attendance_logs FROM service_role;

-- Remove column-level grants too: table-level revokes do not remove them.
DO $phase5_sensitive_column_revokes$
DECLARE
    v_table text;
    v_columns text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'profiles', 'members', 'membership_plans', 'member_subscriptions', 'payments',
        'pt_packages', 'trainers', 'pt_assignments', 'pt_sessions', 'idempotency_keys',
        'checkins', 'notifications', 'member_followups', 'gym_info', 'reminder_settings',
        'staff_invitations', 'security_audit_logs'
    ] LOOP
        SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
        INTO v_columns
        FROM pg_attribute a
        WHERE a.attrelid = format('public.%I', v_table)::regclass
          AND a.attnum > 0 AND NOT a.attisdropped;

        IF v_columns IS NULL THEN
            RAISE EXCEPTION 'PHASE5_SCHEMA_MISMATCH: public.% has no ordinary columns.', v_table;
        END IF;

        EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC, anon, service_role', v_columns, v_table);

        IF v_table IN ('payments', 'member_subscriptions', 'idempotency_keys') THEN
            EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM authenticated', v_columns, v_table);
        END IF;

        IF v_table IN ('payments', 'member_subscriptions') THEN
            EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', v_table);
        ELSIF v_table = 'idempotency_keys' THEN
            EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', v_table);
        END IF;
    END LOOP;
END;
$phase5_sensitive_column_revokes$;
REVOKE TRUNCATE ON TABLE public.profiles, public.members, public.member_subscriptions,
    public.pt_assignments, public.pt_sessions, public.payments, public.idempotency_keys,
    public.staff_invitations, public.security_audit_logs FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.payments, public.member_subscriptions
    FROM authenticated;

-- Staff need operational PT data, while financial PT columns remain admin-only through a gated view.
CREATE OR REPLACE VIEW public.v_admin_pt_assignments WITH (security_invoker = false, security_barrier = true) AS
SELECT
    id, member_id, package_id, trainer_id, total_sessions, completed_sessions,
    fee_amount, amount_paid, balance, status, start_date, notes, created_at
FROM public.pt_assignments
WHERE public.is_admin();

COMMENT ON VIEW public.v_admin_pt_assignments IS
    'Administrator-only PT assignment detail, including fees and balances. Access is gated by public.is_admin().';

REVOKE ALL ON public.v_admin_pt_assignments FROM PUBLIC, anon;
REVOKE ALL ON public.v_admin_pt_assignments FROM service_role;
GRANT SELECT ON public.v_admin_pt_assignments TO authenticated;

REVOKE ALL ON TABLE public.pt_assignments FROM PUBLIC, anon, authenticated;
REVOKE SELECT (id, member_id, package_id, trainer_id, total_sessions, completed_sessions, remaining_sessions, fee_amount, amount_paid, credit_adjustments, balance, payment_status, status, start_date, notes, created_at, updated_at) ON public.pt_assignments FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (trainer_id, notes) ON public.pt_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, member_id, package_id, trainer_id, total_sessions, completed_sessions, remaining_sessions, status, start_date, notes, created_at, updated_at) ON public.pt_assignments TO authenticated;
GRANT UPDATE (trainer_id, notes) ON public.pt_assignments TO authenticated;

-- Idempotency responses can contain financial data; RPCs are the only supported access path.
REVOKE ALL ON public.idempotency_keys FROM PUBLIC, anon, authenticated, service_role;

-- The service-role Edge Functions only need append access for external-action audit events.
REVOKE ALL ON public.security_audit_logs FROM service_role;
GRANT INSERT ON public.security_audit_logs TO service_role;

-- Read-only invitation eligibility check; it never accepts or activates an invitation.
CREATE OR REPLACE FUNCTION public.can_accept_staff_invitation()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT COALESCE(EXISTS (
        SELECT 1
        FROM auth.users AS u
        JOIN public.profiles AS p ON p.id = u.id
        JOIN public.staff_invitations AS i ON i.auth_user_id = u.id
        WHERE u.id = auth.uid()
          AND p.role = 'staff'
          AND p.is_active = false
          AND p.deactivated_at IS NULL
          AND i.role = 'staff'
          AND i.status = 'pending'
          AND i.expires_at > pg_catalog.now()
          AND lower(trim(i.email)) = lower(trim(u.email))
    ), false);
$$;
REVOKE ALL ON FUNCTION public.can_accept_staff_invitation() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_accept_staff_invitation() TO authenticated;

-- Atomic audit events for invitation creation, expiry, and resend. Revoke/accept are already audited in their RPCs.
CREATE OR REPLACE FUNCTION public.audit_staff_invitation_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.security_audit_logs (actor_id, target_user_id, action, details)
        VALUES (
            auth.uid(), NEW.auth_user_id, 'staff_invitation_created',
            jsonb_build_object('invitation_id', NEW.id, 'email', NEW.email, 'role', NEW.role, 'expires_at', NEW.expires_at)
        );
    ELSIF NEW.status = 'pending' AND NEW.expires_at > OLD.expires_at THEN
        INSERT INTO public.security_audit_logs (actor_id, target_user_id, action, details)
        VALUES (
            auth.uid(), NEW.auth_user_id, 'staff_invitation_resent',
            jsonb_build_object('invitation_id', NEW.id, 'email', NEW.email, 'expires_at', NEW.expires_at)
        );
    ELSIF OLD.status = 'pending' AND NEW.status = 'expired' THEN
        INSERT INTO public.security_audit_logs (actor_id, target_user_id, action, details)
        VALUES (
            auth.uid(), NEW.auth_user_id, 'staff_invitation_expired',
            jsonb_build_object('invitation_id', NEW.id, 'email', NEW.email)
        );
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_staff_invitation_changes() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER trg_audit_staff_invitation_changes
AFTER INSERT OR UPDATE OF status, expires_at ON public.staff_invitations
FOR EACH ROW EXECUTE FUNCTION public.audit_staff_invitation_changes();

-- Internal hashing and identifier helpers are callable by their owning SECURITY DEFINER functions only.
REVOKE EXECUTE ON FUNCTION public.hash_payload(jsonb), public.generate_member_code(),
    public.generate_receipt_number(), public.generate_checkin_code() FROM authenticated;

-- Set reviewed Phase 5 definer paths by exact overload. Unrelated application RPCs
-- retain their existing definitions, settings, and ACLs.
ALTER FUNCTION public.get_user_role() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.is_admin() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.is_staff() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.admin_set_user_status(uuid, boolean) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.admin_set_user_role(uuid, text) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.create_staff_invitation(text, text) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.resend_staff_invitation(uuid) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.revoke_staff_invitation(uuid) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.accept_staff_invitation() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.fn_on_auth_user_created() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.fn_sync_payment_balances() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.fn_prevent_tamper_payment_records() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.hash_payload(jsonb) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.generate_member_code() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.generate_receipt_number() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.generate_checkin_code() SET search_path = pg_catalog, public, extensions, pg_temp;

CREATE OR REPLACE FUNCTION public.record_dues_payment(
    p_member_id uuid,
    p_subscription_id uuid,
    p_amount numeric,
    p_payment_method text,
    p_notes text,
    p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_sub record;
    v_payment_id uuid;
    v_receipt_number text;
    v_canonical_payload jsonb;
    v_payload_hash text;
    v_cached_response jsonb;
    v_cached_hash text;
    v_lock_key text;
    v_response jsonb;
BEGIN
    -- Authorization: active administrator required
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can record dues payments.' USING ERRCODE = '42501';
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Idempotency key is required.' USING ERRCODE = '22023';
    END IF;

    IF p_member_id IS NULL OR p_subscription_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Member and subscription identifiers are mandatory.' USING ERRCODE = '22023';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0.00 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Payment amount must be strictly positive.' USING ERRCODE = '22003';
    END IF;
    IF p_payment_method NOT IN ('Cash', 'UPI', 'Card') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Invalid payment method.' USING ERRCODE = '22023';
    END IF;

    -- Canonical Hash
    v_canonical_payload := jsonb_build_object(
        'member_id', p_member_id,
        'subscription_id', p_subscription_id,
        'amount', to_char(p_amount, 'FM999999990.00'),
        'payment_method', p_payment_method,
        'notes', NULLIF(trim(p_notes), '')
    );
    v_payload_hash := public.hash_payload(v_canonical_payload);

    -- Lock this caller/operation/key before looking for a cached response.
    v_lock_key := v_actor_id::text || ':record_dues_payment:' || p_idempotency_key;
    PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_lock_key), 1, 16))::bit(64)::bigint);

    SELECT response, payload_hash INTO v_cached_response, v_cached_hash
    FROM public.idempotency_keys
    WHERE actor_id = v_actor_id
      AND operation = 'record_dues_payment'
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_cached_hash IS DISTINCT FROM v_payload_hash THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: A divergent request already used this idempotency key.' USING ERRCODE = '23505';
        END IF;
        RETURN v_cached_response;
    END IF;
    -- Fetch and Lock Subscription Contract
    SELECT * INTO v_sub
    FROM public.member_subscriptions
    WHERE id = p_subscription_id AND member_id = p_member_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND: Target subscription contract does not exist.' USING ERRCODE = 'P0002';
    END IF;

    IF p_amount > v_sub.balance THEN
        RAISE EXCEPTION 'ERR_OVERPAYMENT_EXCEEDS_BALANCE: Payment amount % exceeds outstanding balance %.', p_amount, v_sub.balance USING ERRCODE = '22003';
    END IF;

    v_receipt_number := public.generate_receipt_number();

    -- Record Payment Entry
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
        p_subscription_id,
        'payment',
        p_amount,
        p_payment_method,
        'completed',
        NULLIF(trim(p_notes), ''),
        v_actor_id
    ) RETURNING id INTO v_payment_id;

    -- trg_sync_payment_balances updates amount_paid atomically from the ledger row.
    -- balance and payment_status are generated columns and must never be assigned.

    v_response := jsonb_build_object(
        'payment_id', v_payment_id,
        'receipt_number', v_receipt_number,
        'member_id', p_member_id,
        'subscription_id', p_subscription_id,
        'amount', p_amount,
        'payment_method', p_payment_method,
        'new_balance', v_sub.balance - p_amount,
        'payment_status', CASE WHEN (v_sub.balance - p_amount) = 0.00 THEN 'paid' ELSE 'partial' END
    );

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'record_dues_payment', p_idempotency_key, v_payload_hash, v_response)
    ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING;

    RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_pt_dues_payment(
    p_member_id uuid,
    p_pt_assignment_id uuid,
    p_amount numeric,
    p_payment_method text,
    p_notes text,
    p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_pt record;
    v_payment_id uuid;
    v_receipt_number text;
    v_canonical_payload jsonb;
    v_payload_hash text;
    v_cached_response jsonb;
    v_cached_hash text;
    v_lock_key text;
    v_response jsonb;
BEGIN
    -- Authorization: active administrator required
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can record PT dues payments.' USING ERRCODE = '42501';
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Idempotency key is required.' USING ERRCODE = '22023';
    END IF;

    IF p_member_id IS NULL OR p_pt_assignment_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Member and PT assignment identifiers are mandatory.' USING ERRCODE = '22023';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0.00 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Payment amount must be strictly positive.' USING ERRCODE = '22003';
    END IF;
    IF p_payment_method NOT IN ('Cash', 'UPI', 'Card') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Invalid payment method.' USING ERRCODE = '22023';
    END IF;

    v_canonical_payload := jsonb_build_object(
        'member_id', p_member_id,
        'pt_assignment_id', p_pt_assignment_id,
        'amount', to_char(p_amount, 'FM999999990.00'),
        'payment_method', p_payment_method,
        'notes', NULLIF(trim(p_notes), '')
    );
    v_payload_hash := public.hash_payload(v_canonical_payload);

    -- Lock this caller/operation/key before looking for a cached response.
    v_lock_key := v_actor_id::text || ':record_pt_dues_payment:' || p_idempotency_key;
    PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_lock_key), 1, 16))::bit(64)::bigint);

    SELECT response, payload_hash INTO v_cached_response, v_cached_hash
    FROM public.idempotency_keys
    WHERE actor_id = v_actor_id
      AND operation = 'record_pt_dues_payment'
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_cached_hash IS DISTINCT FROM v_payload_hash THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: A divergent request already used this idempotency key.' USING ERRCODE = '23505';
        END IF;
        RETURN v_cached_response;
    END IF;
    SELECT * INTO v_pt
    FROM public.pt_assignments
    WHERE id = p_pt_assignment_id AND member_id = p_member_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PT_ASSIGNMENT_NOT_FOUND: Target PT assignment does not exist.' USING ERRCODE = 'P0002';
    END IF;

    IF p_amount > v_pt.balance THEN
        RAISE EXCEPTION 'ERR_OVERPAYMENT_EXCEEDS_BALANCE: Payment % exceeds PT balance %.', p_amount, v_pt.balance USING ERRCODE = '22003';
    END IF;

    v_receipt_number := public.generate_receipt_number();

    INSERT INTO public.payments (
        receipt_number,
        member_id,
        pt_assignment_id,
        transaction_type,
        amount,
        payment_method,
        status,
        notes,
        actor_id
    ) VALUES (
        v_receipt_number,
        p_member_id,
        p_pt_assignment_id,
        'payment',
        p_amount,
        p_payment_method,
        'completed',
        NULLIF(trim(p_notes), ''),
        v_actor_id
    ) RETURNING id INTO v_payment_id;

    -- trg_sync_payment_balances updates amount_paid atomically from the ledger row.
    -- balance and payment_status are generated columns and must never be assigned.

    v_response := jsonb_build_object(
        'payment_id', v_payment_id,
        'receipt_number', v_receipt_number,
        'member_id', p_member_id,
        'pt_assignment_id', p_pt_assignment_id,
        'amount', p_amount,
        'payment_method', p_payment_method,
        'new_balance', v_pt.balance - p_amount,
        'payment_status', CASE WHEN (v_pt.balance - p_amount) = 0.00 THEN 'paid' ELSE 'partial' END
    );

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'record_pt_dues_payment', p_idempotency_key, v_payload_hash, v_response)
    ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING;

    RETURN v_response;
END;
$$;

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
            SET status = 'completed',
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

CREATE OR REPLACE FUNCTION public.onboard_member(
    p_name text,
    p_phone text,
    p_email text,
    p_gender text,
    p_dob date,
    p_address text,
    p_emergency_contact text,
    p_blood_group text,
    p_medical_notes text,
    p_notes text,
    p_plan_id uuid,
    p_start_date date,
    p_initial_payment_amount numeric,
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
    v_member_id uuid;
    v_member_code text;
    v_subscription_id uuid;
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
    -- 1. Authorization: active personnel required
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Active personnel authentication required.' USING ERRCODE = '42501';
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Idempotency key is required.' USING ERRCODE = '22023';
    END IF;

    -- Financial isolation: Only active administrators can record initial payments
    IF NOT public.is_admin() AND COALESCE(p_initial_payment_amount, 0.00) > 0.00 THEN
        RAISE EXCEPTION 'FORBIDDEN: Staff cannot record initial payments. Initial payment must be 0.00.' USING ERRCODE = '42501';
    END IF;

    -- 2. Input Validation
    IF trim(p_name) = '' OR trim(p_phone) = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Member name and phone are mandatory.' USING ERRCODE = '22023';
    END IF;
    IF p_plan_id IS NULL OR p_start_date IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Plan ID and start date are mandatory.' USING ERRCODE = '22023';
    END IF;
    IF p_initial_payment_amount IS NULL OR p_initial_payment_amount < 0.00 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Initial payment amount cannot be negative or null.' USING ERRCODE = '22003';
    END IF;
    IF p_initial_payment_amount > 0.00 AND p_payment_method NOT IN ('Cash', 'UPI', 'Card') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Invalid payment method for initial dues.' USING ERRCODE = '22023';
    END IF;

    -- 3. Canonical Payload Serialization & Hashing
    v_canonical_payload := jsonb_build_object(
        'name', trim(p_name),
        'phone', trim(p_phone),
        'email', NULLIF(trim(p_email), ''),
        'gender', p_gender,
        'dob', to_char(p_dob, 'YYYY-MM-DD'),
        'address', NULLIF(trim(p_address), ''),
        'emergency_contact', NULLIF(trim(p_emergency_contact), ''),
        'blood_group', NULLIF(trim(p_blood_group), ''),
        'medical_notes', NULLIF(trim(p_medical_notes), ''),
        'notes', NULLIF(trim(p_notes), ''),
        'plan_id', p_plan_id,
        'start_date', to_char(p_start_date, 'YYYY-MM-DD'),
        'initial_payment_amount', to_char(p_initial_payment_amount, 'FM999999990.00'),
        'payment_method', p_payment_method
    );
    v_payload_hash := public.hash_payload(v_canonical_payload);

    -- 4. Transaction-Scoped Pessimistic Advisory Lock
    v_lock_key := v_actor_id::text || ':onboard_member:' || p_idempotency_key;
    PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_lock_key), 1, 16))::bit(64)::bigint);

    -- 5. Idempotency Cache Check
    SELECT response, payload_hash INTO v_cached_response, v_cached_hash
    FROM public.idempotency_keys
    WHERE actor_id = v_actor_id
      AND operation = 'onboard_member'
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_cached_hash <> v_payload_hash THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: Key "%" was already used for onboard_member with divergent parameters.', p_idempotency_key
                USING ERRCODE = 'P0004';
        END IF;
        IF public.is_admin() THEN
            RETURN v_cached_response;
        END IF;
        RETURN v_cached_response - ARRAY['plan_price', 'initial_payment_amount', 'payment_id', 'receipt_number', 'outstanding_balance']::text[];
    END IF;

    -- 6. Plan Verification
    SELECT * INTO v_plan FROM public.membership_plans WHERE id = p_plan_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_PLAN: Active membership plan not found.' USING ERRCODE = 'P0002';
    END IF;

    -- Overpayment Guard
    IF p_initial_payment_amount > v_plan.price THEN
        RAISE EXCEPTION 'ERR_OVERPAYMENT_EXCEEDS_BALANCE: Initial payment amount (%) exceeds plan price (%). Overpayments are rejected.',
            p_initial_payment_amount, v_plan.price USING ERRCODE = '22003';
    END IF;

    -- Server-Derived Expiry Date
    v_expiry_date := (p_start_date + (v_plan.duration_days || ' days')::interval)::date;

    -- 7. Atomic Insertions
    v_member_code := public.generate_member_code();
    INSERT INTO public.members (
        member_code, name, phone, email, gender, dob, address,
        emergency_contact, blood_group, medical_notes, notes
    ) VALUES (
        v_member_code, trim(p_name), trim(p_phone), NULLIF(trim(p_email), ''),
        p_gender, p_dob, NULLIF(trim(p_address), ''),
        NULLIF(trim(p_emergency_contact), ''), NULLIF(trim(p_blood_group), ''),
        NULLIF(trim(p_medical_notes), ''), NULLIF(trim(p_notes), '')
    ) RETURNING id INTO v_member_id;

    INSERT INTO public.member_subscriptions (
        member_id, plan_id, plan_name, plan_price, previous_balance_carried,
        status, start_date, expiry_date
    ) VALUES (
        v_member_id, v_plan.id, v_plan.name, v_plan.price, 0.00,
        'active', p_start_date, v_expiry_date
    ) RETURNING id INTO v_subscription_id;

    IF p_initial_payment_amount > 0.00 THEN
        v_receipt_number := public.generate_receipt_number();
        INSERT INTO public.payments (
            receipt_number, member_id, subscription_id, transaction_type,
            amount, payment_method, status, notes, actor_id
        ) VALUES (
            v_receipt_number, v_member_id, v_subscription_id, 'payment',
            p_initial_payment_amount, p_payment_method, 'completed',
            'Initial onboarding payment', v_actor_id
        ) RETURNING id INTO v_payment_id;
    END IF;

    -- 8. Assemble Response & Record Idempotency
    v_response := jsonb_build_object(
        'success', true,
        'member_id', v_member_id,
        'member_code', v_member_code,
        'subscription_id', v_subscription_id,
        'plan_name', v_plan.name,
        'plan_price', v_plan.price,
        'start_date', p_start_date,
        'expiry_date', v_expiry_date,
        'initial_payment_amount', p_initial_payment_amount,
        'payment_id', v_payment_id,
        'receipt_number', v_receipt_number,
        'outstanding_balance', (v_plan.price - p_initial_payment_amount)
    );

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'onboard_member', p_idempotency_key, v_payload_hash, v_response)
    ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING;

    IF public.is_admin() THEN
        RETURN v_response;
    END IF;
    RETURN v_response - ARRAY['plan_price', 'initial_payment_amount', 'payment_id', 'receipt_number', 'outstanding_balance']::text[];
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_pt_package(
    p_member_id uuid,
    p_package_id uuid,
    p_trainer_id uuid,
    p_start_date date,
    p_initial_payment_amount numeric,
    p_payment_method text,
    p_notes text,
    p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_pkg record;
    v_pt_id uuid;
    v_payment_id uuid := NULL;
    v_receipt_number text := NULL;
    v_canonical_payload jsonb;
    v_payload_hash text;
    v_cached_response jsonb;
    v_cached_hash text;
    v_lock_key text;
    v_response jsonb;
BEGIN
    -- 1. Authorization: active personnel required
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Active personnel authentication required.' USING ERRCODE = '42501';
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Idempotency key is required.' USING ERRCODE = '22023';
    END IF;

    -- Financial isolation: Only active administrators can record initial payments
    IF NOT public.is_admin() AND COALESCE(p_initial_payment_amount, 0.00) > 0.00 THEN
        RAISE EXCEPTION 'FORBIDDEN: Staff cannot record initial payments. Initial payment must be 0.00.' USING ERRCODE = '42501';
    END IF;

    -- 2. Input Validation
    IF p_member_id IS NULL OR p_package_id IS NULL OR p_trainer_id IS NULL OR p_start_date IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Member, package, trainer, and start date are mandatory.' USING ERRCODE = '22023';
    END IF;
    IF p_initial_payment_amount IS NULL OR p_initial_payment_amount < 0.00 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Initial payment cannot be negative.' USING ERRCODE = '22003';
    END IF;
    IF p_initial_payment_amount > 0.00 AND p_payment_method NOT IN ('Cash', 'UPI', 'Card') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Invalid payment method.' USING ERRCODE = '22023';
    END IF;

    -- 3. Canonical Hash
    v_canonical_payload := jsonb_build_object(
        'member_id', p_member_id,
        'package_id', p_package_id,
        'trainer_id', p_trainer_id,
        'start_date', to_char(p_start_date, 'YYYY-MM-DD'),
        'initial_payment_amount', to_char(p_initial_payment_amount, 'FM999999990.00'),
        'payment_method', p_payment_method,
        'notes', NULLIF(trim(p_notes), '')
    );
    v_payload_hash := public.hash_payload(v_canonical_payload);

    -- 4. Advisory Lock
    v_lock_key := v_actor_id::text || ':assign_pt_package:' || p_idempotency_key;
    PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_lock_key), 1, 16))::bit(64)::bigint);

    -- 5. Cache Check
    SELECT response, payload_hash INTO v_cached_response, v_cached_hash
    FROM public.idempotency_keys
    WHERE actor_id = v_actor_id
      AND operation = 'assign_pt_package'
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_cached_hash <> v_payload_hash THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: Key reused with divergent parameters.' USING ERRCODE = 'P0004';
        END IF;
        IF public.is_admin() THEN
            RETURN v_cached_response;
        END IF;
        RETURN v_cached_response - ARRAY['fee_amount', 'amount_paid', 'outstanding_balance', 'receipt_number']::text[];
    END IF;

    -- 6. Verify Package & Trainer
    SELECT * INTO v_pkg FROM public.pt_packages WHERE id = p_package_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_PACKAGE: Active PT package not found.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM id FROM public.trainers WHERE id = p_trainer_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_TRAINER: Active trainer not found.' USING ERRCODE = 'P0002';
    END IF;

    IF p_initial_payment_amount > v_pkg.price THEN
        RAISE EXCEPTION 'ERR_OVERPAYMENT_EXCEEDS_BALANCE: Payment amount (%) exceeds package fee (%). Overpayments are rejected.',
            p_initial_payment_amount, v_pkg.price USING ERRCODE = '22003';
    END IF;

    -- 7. Atomic Insertions
    INSERT INTO public.pt_assignments (
        member_id, package_id, trainer_id, total_sessions, completed_sessions,
        fee_amount, amount_paid, status, start_date, notes
    ) VALUES (
        p_member_id, v_pkg.id, p_trainer_id, v_pkg.total_sessions, 0,
        v_pkg.price, 0.00, 'active', p_start_date, NULLIF(trim(p_notes), '')
    ) RETURNING id INTO v_pt_id;

    IF p_initial_payment_amount > 0.00 THEN
        v_receipt_number := public.generate_receipt_number();
        INSERT INTO public.payments (
            receipt_number, member_id, pt_assignment_id, transaction_type,
            amount, payment_method, status, notes, actor_id
        ) VALUES (
            v_receipt_number, p_member_id, v_pt_id, 'payment',
            p_initial_payment_amount, p_payment_method, 'completed',
            'Initial PT enrollment payment', v_actor_id
        ) RETURNING id INTO v_payment_id;
    END IF;

    -- 8. Assemble Response & Record Idempotency
    v_response := jsonb_build_object(
        'success', true,
        'pt_assignment_id', v_pt_id,
        'package_name', v_pkg.name,
        'total_sessions', v_pkg.total_sessions,
        'fee_amount', v_pkg.price,
        'amount_paid', p_initial_payment_amount,
        'outstanding_balance', (v_pkg.price - p_initial_payment_amount),
        'receipt_number', v_receipt_number
    );

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'assign_pt_package', p_idempotency_key, v_payload_hash, v_response)
    ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING;

    IF public.is_admin() THEN
        RETURN v_response;
    END IF;
    RETURN v_response - ARRAY['fee_amount', 'amount_paid', 'outstanding_balance', 'receipt_number']::text[];
END;
$$;
COMMIT;
