-- ============================================================================
-- THE FITNESS HOUSE — GYM MANAGEMENT ADMIN PANEL
-- MIGRATION: 20261019_001_phase7c_core_schema.sql
-- STAGE: Phase 7C — Production-Grade DDL, Security, Accounting & RPC Suite
-- ============================================================================
-- Engine Compatibility: PostgreSQL 15+ / Supabase
-- Execution Mode: Single Atomic Transaction
-- Re-run Safety: Idempotent (Safe for initial run and repeat execution)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONS & SCHEMAS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- Revoke default public execution privileges on functions created in public schema
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 2. SEQUENCES FOR HUMAN-READABLE IDENTIFIERS
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.member_code_seq START WITH 1001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS public.receipt_number_seq START WITH 10001 INCREMENT BY 1;

-- ----------------------------------------------------------------------------
-- 3. CORE ENUMS & LOOKUP TABLES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email text NOT NULL,
    full_name text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'staff')) DEFAULT 'staff',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.gym_info (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL DEFAULT 'The Fitness House',
    tagline text DEFAULT 'Transform Your Body, Transform Your Life',
    address text DEFAULT '123 Fitness Boulevard, Suite 100, Sector 4, Gandhinagar, Gujarat 382024',
    phone text DEFAULT '+91 98765 43210',
    email text DEFAULT 'info@thefitnesshouse.in',
    gst_number text DEFAULT '24AAAAA0000A1Z5',
    currency_code text NOT NULL DEFAULT 'INR',
    currency_symbol text NOT NULL DEFAULT '₹',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.membership_plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    duration_days integer NOT NULL CHECK (duration_days > 0),
    price numeric(12, 2) NOT NULL CHECK (price >= 0),
    description text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.pt_packages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    total_sessions integer NOT NULL CHECK (total_sessions > 0),
    price numeric(12, 2) NOT NULL CHECK (price >= 0),
    description text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.trainers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    specialty text,
    phone text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- ----------------------------------------------------------------------------
-- 4. MEMBER MASTER & CONTRACT TABLES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    member_code text NOT NULL UNIQUE,
    name text NOT NULL,
    phone text NOT NULL,
    email text,
    gender text CHECK (gender IN ('Male', 'Female', 'Other')),
    dob date,
    address text,
    emergency_contact text,
    blood_group text,
    medical_notes text,
    notes text,
    is_archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.member_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    plan_id uuid NOT NULL REFERENCES public.membership_plans(id) ON DELETE RESTRICT,
    plan_name text NOT NULL,
    plan_price numeric(12, 2) NOT NULL CHECK (plan_price >= 0),
    previous_balance_carried numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (previous_balance_carried >= 0),
    balance_transferred_out numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (balance_transferred_out >= 0),
    transferred_to_subscription_id uuid REFERENCES public.member_subscriptions(id) ON DELETE RESTRICT,
    credit_adjustments numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (credit_adjustments >= 0),
    total_liability numeric(12, 2) GENERATED ALWAYS AS (plan_price + previous_balance_carried) STORED,
    amount_paid numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (amount_paid >= 0),
    balance numeric(12, 2) GENERATED ALWAYS AS (GREATEST(0.00, (plan_price + previous_balance_carried) - amount_paid - balance_transferred_out - credit_adjustments)) STORED,
    status text NOT NULL CHECK (status IN ('active', 'expired', 'superseded', 'cancelled')) DEFAULT 'active',
    payment_status text GENERATED ALWAYS AS (
        CASE 
            WHEN ((plan_price + previous_balance_carried) - amount_paid - balance_transferred_out - credit_adjustments) <= 0.00 THEN 'paid'
            WHEN amount_paid > 0.00 THEN 'partial'
            ELSE 'unpaid'
        END
    ) STORED,
    start_date date NOT NULL,
    expiry_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.pt_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    package_id uuid NOT NULL REFERENCES public.pt_packages(id) ON DELETE RESTRICT,
    trainer_id uuid NOT NULL REFERENCES public.trainers(id) ON DELETE RESTRICT,
    total_sessions integer NOT NULL CHECK (total_sessions > 0),
    completed_sessions integer NOT NULL DEFAULT 0 CHECK (completed_sessions >= 0),
    remaining_sessions integer GENERATED ALWAYS AS (total_sessions - completed_sessions) STORED,
    fee_amount numeric(12, 2) NOT NULL CHECK (fee_amount >= 0),
    amount_paid numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (amount_paid >= 0),
    credit_adjustments numeric(12, 2) NOT NULL DEFAULT 0.00 CHECK (credit_adjustments >= 0),
    balance numeric(12, 2) GENERATED ALWAYS AS (GREATEST(0.00, fee_amount - amount_paid - credit_adjustments)) STORED,
    payment_status text GENERATED ALWAYS AS (
        CASE 
            WHEN (fee_amount - amount_paid - credit_adjustments) <= 0.00 THEN 'paid'
            WHEN amount_paid > 0.00 THEN 'partial'
            ELSE 'unpaid'
        END
    ) STORED,
    status text NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')) DEFAULT 'active',
    start_date date NOT NULL,
    notes text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_pt_sessions_ceiling CHECK (completed_sessions <= total_sessions)
);

CREATE TABLE IF NOT EXISTS public.pt_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id uuid NOT NULL REFERENCES public.pt_assignments(id) ON DELETE RESTRICT,
    session_number integer NOT NULL CHECK (session_number > 0),
    conducted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    trainer_id uuid NOT NULL REFERENCES public.trainers(id) ON DELETE RESTRICT,
    notes text,
    actor_id uuid NOT NULL REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- ----------------------------------------------------------------------------
-- 5. FINANCIAL LEDGER & AUDIT TABLES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_number text NOT NULL UNIQUE,
    member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    subscription_id uuid REFERENCES public.member_subscriptions(id) ON DELETE RESTRICT,
    pt_assignment_id uuid REFERENCES public.pt_assignments(id) ON DELETE RESTRICT,
    transaction_type text NOT NULL CHECK (transaction_type IN ('payment', 'refund', 'credit_adjustment')),
    amount numeric(12, 2) NOT NULL CHECK (amount > 0),
    payment_method text NOT NULL CHECK (payment_method IN ('Cash', 'UPI', 'Card', 'Adjustment')),
    status text NOT NULL CHECK (status IN ('completed', 'failed')) DEFAULT 'completed',
    refund_of_payment_id uuid REFERENCES public.payments(id) ON DELETE RESTRICT,
    notes text,
    actor_id uuid NOT NULL REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_payment_target CHECK (
        (subscription_id IS NOT NULL AND pt_assignment_id IS NULL) OR
        (subscription_id IS NULL AND pt_assignment_id IS NOT NULL) OR
        (subscription_id IS NULL AND pt_assignment_id IS NULL AND transaction_type IN ('payment', 'refund'))
    ),
    CONSTRAINT chk_refund_linkage CHECK (
        (transaction_type = 'refund' AND refund_of_payment_id IS NOT NULL) OR
        (transaction_type <> 'refund' AND refund_of_payment_id IS NULL)
    ),
    CONSTRAINT chk_adjustment_method CHECK (
        (transaction_type = 'credit_adjustment' AND payment_method = 'Adjustment') OR
        (transaction_type <> 'credit_adjustment' AND payment_method <> 'Adjustment')
    )
);

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    operation text NOT NULL,
    idempotency_key text NOT NULL,
    payload_hash text NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_idempotency_actor_op_key UNIQUE (actor_id, operation, idempotency_key)
);

-- ----------------------------------------------------------------------------
-- 6. INDEXES FOR PERFORMANCE & CONCURRENCY
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_members_code ON public.members(member_code);
CREATE INDEX IF NOT EXISTS idx_members_archived ON public.members(is_archived);
CREATE INDEX IF NOT EXISTS idx_subscriptions_member ON public.member_subscriptions(member_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.member_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_pt_assignments_member ON public.pt_assignments(member_id);
CREATE INDEX IF NOT EXISTS idx_pt_assignments_status ON public.pt_assignments(status);
CREATE INDEX IF NOT EXISTS idx_payments_member ON public.payments(member_id);
CREATE INDEX IF NOT EXISTS idx_payments_sub ON public.payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_pt ON public.payments(pt_assignment_id);
CREATE INDEX IF NOT EXISTS idx_payments_refund_target ON public.payments(refund_of_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_created ON public.payments(created_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_lookup ON public.idempotency_keys(actor_id, operation, idempotency_key);

-- ----------------------------------------------------------------------------
-- 7. HELPER FUNCTIONS & TRIGGERS
-- ----------------------------------------------------------------------------

-- Role Evaluation Helpers
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE((SELECT role = 'admin' FROM public.profiles WHERE id = auth.uid()), false);
$$;

-- Supported Canonical SHA-256 Payload Hash Helper (uses extensions.pgcrypto digest)
CREATE OR REPLACE FUNCTION public.hash_payload(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
    SELECT encode(extensions.digest(p_payload::text::bytea, 'sha256'), 'hex');
$$;

-- Human-Readable Code Generators
CREATE OR REPLACE FUNCTION public.generate_member_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN 'MEM-' || lpad(nextval('public.member_code_seq')::text, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN 'TFH-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' || lpad(nextval('public.receipt_number_seq')::text, 5, '0');
END;
$$;

-- Auth User Creation Profile Sync Trigger
CREATE OR REPLACE FUNCTION public.fn_on_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        'staff' -- Strict default for all signups; owner promoted manually in SQL Editor
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.fn_on_auth_user_created();

-- Immutable Payment Audit Trigger: Blocks Direct UPDATE or DELETE
CREATE OR REPLACE FUNCTION public.fn_prevent_tamper_payment_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'IMMUTABLE_FINANCIAL_RECORD: Direct modification or deletion of payment ledger records is strictly prohibited. Issue an authorized refund or adjustment transaction instead.'
        USING ERRCODE = '27000';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_tamper_payment_records ON public.payments;
CREATE TRIGGER trg_prevent_tamper_payment_records
    BEFORE UPDATE OR DELETE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_tamper_payment_records();

-- Financial Balance Synchronization Trigger (Append-Only Synchronizer)
CREATE OR REPLACE FUNCTION public.fn_sync_payment_balances()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.status <> 'completed' THEN
        RETURN NEW;
    END IF;

    -- 1. Sync Subscription Ledger
    IF NEW.subscription_id IS NOT NULL THEN
        IF NEW.transaction_type = 'payment' THEN
            UPDATE public.member_subscriptions
            SET amount_paid = amount_paid + NEW.amount,
                updated_at = clock_timestamp()
            WHERE id = NEW.subscription_id;
        ELSIF NEW.transaction_type = 'refund' THEN
            UPDATE public.member_subscriptions
            SET amount_paid = amount_paid - NEW.amount,
                updated_at = clock_timestamp()
            WHERE id = NEW.subscription_id;
        ELSIF NEW.transaction_type = 'credit_adjustment' THEN
            UPDATE public.member_subscriptions
            SET credit_adjustments = credit_adjustments + NEW.amount,
                updated_at = clock_timestamp()
            WHERE id = NEW.subscription_id;
        END IF;
    END IF;

    -- 2. Sync Personal Training Ledger
    IF NEW.pt_assignment_id IS NOT NULL THEN
        IF NEW.transaction_type = 'payment' THEN
            UPDATE public.pt_assignments
            SET amount_paid = amount_paid + NEW.amount,
                updated_at = clock_timestamp()
            WHERE id = NEW.pt_assignment_id;
        ELSIF NEW.transaction_type = 'refund' THEN
            UPDATE public.pt_assignments
            SET amount_paid = amount_paid - NEW.amount,
                updated_at = clock_timestamp()
            WHERE id = NEW.pt_assignment_id;
        ELSIF NEW.transaction_type = 'credit_adjustment' THEN
            UPDATE public.pt_assignments
            SET credit_adjustments = credit_adjustments + NEW.amount,
                updated_at = clock_timestamp()
            WHERE id = NEW.pt_assignment_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_payment_balances ON public.payments;
CREATE TRIGGER trg_sync_payment_balances
    AFTER INSERT ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_sync_payment_balances();

-- ----------------------------------------------------------------------------
-- 8. BUSINESS RPCS (ATOMIC, IDEMPOTENT & AUTHORIZED)
-- ----------------------------------------------------------------------------

-- A. Onboard Member (Atomic Registration, Subscription, Initial Payment)
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
SET search_path = public, extensions, pg_temp
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
    -- 1. Authorization Check
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
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
        RETURN v_cached_response;
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

    -- 8. Assemble Response & Record Idempotency (Corrected p_start_date reference)
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
    VALUES (v_actor_id, 'onboard_member', p_idempotency_key, v_payload_hash, v_response);

    RETURN v_response;
END;
$$;

-- B. Renew Subscription (Atomic Carry-Forward Debt, Plan Derivation & Payment)
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
SET search_path = public, extensions, pg_temp
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
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
    END IF;

    IF p_member_id IS NULL OR p_plan_id IS NULL OR p_start_date IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Member ID, plan ID, and start date are mandatory.' USING ERRCODE = '22023';
    END IF;
    IF p_payment_amount IS NULL OR p_payment_amount < 0.00 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Payment amount cannot be negative or null.' USING ERRCODE = '22003';
    END IF;
    IF p_payment_amount > 0.00 AND p_payment_method NOT IN ('Cash', 'UPI', 'Card') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Invalid payment method for renewal dues.' USING ERRCODE = '22023';
    END IF;

    -- Canonical Hash
    v_canonical_payload := jsonb_build_object(
        'member_id', p_member_id,
        'plan_id', p_plan_id,
        'start_date', to_char(p_start_date, 'YYYY-MM-DD'),
        'carry_forward_balance', p_carry_forward_balance,
        'payment_amount', to_char(p_payment_amount, 'FM999999990.00'),
        'payment_method', p_payment_method
    );
    v_payload_hash := public.hash_payload(v_canonical_payload);

    -- Advisory Lock
    v_lock_key := v_actor_id::text || ':renew_member_subscription:' || p_idempotency_key;
    PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_lock_key), 1, 16))::bit(64)::bigint);

    -- Cache Check
    SELECT response, payload_hash INTO v_cached_response, v_cached_hash
    FROM public.idempotency_keys
    WHERE actor_id = v_actor_id
      AND operation = 'renew_member_subscription'
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_cached_hash <> v_payload_hash THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: Key "%" reused with divergent parameters.', p_idempotency_key
                USING ERRCODE = 'P0004';
        END IF;
        RETURN v_cached_response;
    END IF;

    -- Pessimistic Lock on Member & Previous Subscriptions
    PERFORM id FROM public.members WHERE id = p_member_id FOR UPDATE;

    SELECT * INTO v_prev_sub
    FROM public.member_subscriptions
    WHERE member_id = p_member_id AND status = 'active'
    ORDER BY expiry_date DESC LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        IF p_carry_forward_balance = true THEN
            v_carried_balance := v_prev_sub.balance;
        ELSE
            IF v_prev_sub.balance > 0.00 THEN
                RAISE EXCEPTION 'ERR_OUTSTANDING_BALANCE_NOT_SETTLED: Previous contract has an unpaid balance of %. Either settle dues or set carry_forward_balance to true.',
                    v_prev_sub.balance USING ERRCODE = '22003';
            END IF;
            v_carried_balance := 0.00;
        END IF;
    END IF;

    -- Verify Plan
    SELECT * INTO v_plan FROM public.membership_plans WHERE id = p_plan_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_PLAN: Active membership plan not found.' USING ERRCODE = 'P0002';
    END IF;

    IF p_payment_amount > (v_plan.price + v_carried_balance) THEN
        RAISE EXCEPTION 'ERR_OVERPAYMENT_EXCEEDS_BALANCE: Payment amount (%) exceeds total liability (%). Overpayments are rejected.',
            p_payment_amount, (v_plan.price + v_carried_balance) USING ERRCODE = '22003';
    END IF;

    v_expiry_date := (p_start_date + (v_plan.duration_days || ' days')::interval)::date;

    -- Insert New Contract
    INSERT INTO public.member_subscriptions (
        member_id, plan_id, plan_name, plan_price, previous_balance_carried,
        status, start_date, expiry_date
    ) VALUES (
        p_member_id, v_plan.id, v_plan.name, v_plan.price, v_carried_balance,
        'active', p_start_date, v_expiry_date
    ) RETURNING id INTO v_new_sub_id;

    -- Supersede Previous Contract Cleanly (Zeroing prior balance via transferred_out)
    IF v_prev_sub.id IS NOT NULL THEN
        UPDATE public.member_subscriptions
        SET balance_transferred_out = v_carried_balance,
            transferred_to_subscription_id = v_new_sub_id,
            status = 'superseded',
            updated_at = clock_timestamp()
        WHERE id = v_prev_sub.id;
    END IF;

    -- Record Payment if provided
    IF p_payment_amount > 0.00 THEN
        v_receipt_number := public.generate_receipt_number();
        INSERT INTO public.payments (
            receipt_number, member_id, subscription_id, transaction_type,
            amount, payment_method, status, notes, actor_id
        ) VALUES (
            v_receipt_number, p_member_id, v_new_sub_id, 'payment',
            p_payment_amount, p_payment_method, 'completed',
            'Renewal payment with carried debt', v_actor_id
        ) RETURNING id INTO v_payment_id;
    END IF;

    v_response := jsonb_build_object(
        'success', true,
        'member_id', p_member_id,
        'subscription_id', v_new_sub_id,
        'plan_name', v_plan.name,
        'previous_balance_carried', v_carried_balance,
        'total_liability', (v_plan.price + v_carried_balance),
        'amount_paid', p_payment_amount,
        'outstanding_balance', ((v_plan.price + v_carried_balance) - p_payment_amount),
        'expiry_date', v_expiry_date,
        'receipt_number', v_receipt_number
    );

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'renew_member_subscription', p_idempotency_key, v_payload_hash, v_response);

    RETURN v_response;
END;
$$;

-- C. Record Subscription Dues Payment
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
SET search_path = public, extensions, pg_temp
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
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
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

    -- Advisory Lock
    v_lock_key := v_actor_id::text || ':record_dues_payment:' || p_idempotency_key;
    PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_lock_key), 1, 16))::bit(64)::bigint);

    -- Cache Check
    SELECT response, payload_hash INTO v_cached_response, v_cached_hash
    FROM public.idempotency_keys
    WHERE actor_id = v_actor_id
      AND operation = 'record_dues_payment'
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_cached_hash <> v_payload_hash THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: Key reused with divergent parameters.' USING ERRCODE = 'P0004';
        END IF;
        RETURN v_cached_response;
    END IF;

    -- Lock Subscription
    SELECT * INTO v_sub
    FROM public.member_subscriptions
    WHERE id = p_subscription_id AND member_id = p_member_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND: Active subscription matching member not found.' USING ERRCODE = 'P0002';
    END IF;

    IF p_amount > v_sub.balance THEN
        RAISE EXCEPTION 'ERR_OVERPAYMENT_EXCEEDS_BALANCE: Payment amount (%) exceeds outstanding dues balance (%). Overpayments are rejected.',
            p_amount, v_sub.balance USING ERRCODE = '22003';
    END IF;

    v_receipt_number := public.generate_receipt_number();
    INSERT INTO public.payments (
        receipt_number, member_id, subscription_id, transaction_type,
        amount, payment_method, status, notes, actor_id
    ) VALUES (
        v_receipt_number, p_member_id, p_subscription_id, 'payment',
        p_amount, p_payment_method, 'completed', NULLIF(trim(p_notes), ''), v_actor_id
    ) RETURNING id INTO v_payment_id;

    v_response := jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'receipt_number', v_receipt_number,
        'amount_paid', p_amount,
        'remaining_balance', (v_sub.balance - p_amount),
        'subscription_id', p_subscription_id
    );

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'record_dues_payment', p_idempotency_key, v_payload_hash, v_response);

    RETURN v_response;
END;
$$;

-- D. Assign Personal Training Package
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
SET search_path = public, extensions, pg_temp
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
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
    END IF;

    IF p_member_id IS NULL OR p_package_id IS NULL OR p_trainer_id IS NULL OR p_start_date IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Member, package, trainer, and start date are mandatory.' USING ERRCODE = '22023';
    END IF;
    IF p_initial_payment_amount IS NULL OR p_initial_payment_amount < 0.00 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Initial payment cannot be negative.' USING ERRCODE = '22003';
    END IF;
    IF p_initial_payment_amount > 0.00 AND p_payment_method NOT IN ('Cash', 'UPI', 'Card') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Invalid payment method.' USING ERRCODE = '22023';
    END IF;

    -- Canonical Hash
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

    -- Advisory Lock
    v_lock_key := v_actor_id::text || ':assign_pt_package:' || p_idempotency_key;
    PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_lock_key), 1, 16))::bit(64)::bigint);

    -- Cache Check
    SELECT response, payload_hash INTO v_cached_response, v_cached_hash
    FROM public.idempotency_keys
    WHERE actor_id = v_actor_id
      AND operation = 'assign_pt_package'
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_cached_hash <> v_payload_hash THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: Key reused with divergent parameters.' USING ERRCODE = 'P0004';
        END IF;
        RETURN v_cached_response;
    END IF;

    -- Verify Package & Trainer
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
    VALUES (v_actor_id, 'assign_pt_package', p_idempotency_key, v_payload_hash, v_response);

    RETURN v_response;
END;
$$;

-- E. Record PT Dues Payment
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
SET search_path = public, extensions, pg_temp
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
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
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

    v_lock_key := v_actor_id::text || ':record_pt_dues_payment:' || p_idempotency_key;
    PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_lock_key), 1, 16))::bit(64)::bigint);

    SELECT response, payload_hash INTO v_cached_response, v_cached_hash
    FROM public.idempotency_keys
    WHERE actor_id = v_actor_id
      AND operation = 'record_pt_dues_payment'
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_cached_hash <> v_payload_hash THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: Key reused with divergent parameters.' USING ERRCODE = 'P0004';
        END IF;
        RETURN v_cached_response;
    END IF;

    SELECT * INTO v_pt
    FROM public.pt_assignments
    WHERE id = p_pt_assignment_id AND member_id = p_member_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PT_ASSIGNMENT_NOT_FOUND: Assignment matching member not found.' USING ERRCODE = 'P0002';
    END IF;

    IF p_amount > v_pt.balance THEN
        RAISE EXCEPTION 'ERR_OVERPAYMENT_EXCEEDS_BALANCE: Payment amount (%) exceeds outstanding PT dues balance (%). Overpayments are rejected.',
            p_amount, v_pt.balance USING ERRCODE = '22003';
    END IF;

    v_receipt_number := public.generate_receipt_number();
    INSERT INTO public.payments (
        receipt_number, member_id, pt_assignment_id, transaction_type,
        amount, payment_method, status, notes, actor_id
    ) VALUES (
        v_receipt_number, p_member_id, p_pt_assignment_id, 'payment',
        p_amount, p_payment_method, 'completed', NULLIF(trim(p_notes), ''), v_actor_id
    ) RETURNING id INTO v_payment_id;

    v_response := jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'receipt_number', v_receipt_number,
        'amount_paid', p_amount,
        'remaining_balance', (v_pt.balance - p_amount),
        'pt_assignment_id', p_pt_assignment_id
    );

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'record_pt_dues_payment', p_idempotency_key, v_payload_hash, v_response);

    RETURN v_response;
END;
$$;

-- F. Complete PT Session (Concurrency-Safe Row-Level Decrementation)
CREATE OR REPLACE FUNCTION public.complete_pt_session(
    p_assignment_id uuid,
    p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_pt record;
    v_new_completed integer;
    v_new_status text;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
    END IF;

    -- Pessimistic Row Lock
    SELECT * INTO v_pt
    FROM public.pt_assignments
    WHERE id = p_assignment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND: PT assignment record not found.' USING ERRCODE = 'P0002';
    END IF;

    -- Check session exhaustion first (distinct 22003 error code for session limit reached)
    IF v_pt.completed_sessions >= v_pt.total_sessions THEN
        RAISE EXCEPTION 'SESSIONS_EXHAUSTED: All % package sessions have already been logged.', v_pt.total_sessions USING ERRCODE = '22003';
    END IF;

    -- Check package status for packages with remaining sessions
    IF v_pt.status <> 'active' THEN
        RAISE EXCEPTION 'INVALID_STATUS: Sessions can only be logged against active PT packages.' USING ERRCODE = '22023';
    END IF;

    v_new_completed := v_pt.completed_sessions + 1;
    v_new_status := CASE WHEN v_new_completed >= v_pt.total_sessions THEN 'completed' ELSE 'active' END;

    UPDATE public.pt_assignments
    SET completed_sessions = v_new_completed,
        status = v_new_status,
        updated_at = clock_timestamp()
    WHERE id = p_assignment_id;

    INSERT INTO public.pt_sessions (
        assignment_id, session_number, conducted_at, trainer_id, notes, actor_id
    ) VALUES (
        p_assignment_id, v_new_completed, clock_timestamp(), v_pt.trainer_id, NULLIF(trim(p_notes), ''), v_actor_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'assignment_id', p_assignment_id,
        'session_number', v_new_completed,
        'remaining_sessions', (v_pt.total_sessions - v_new_completed),
        'status', v_new_status
    );
END;
$$;

-- G. Record Refund Transaction (Admin-Only, Strictly Capped Cash Outflow with Transferred Debt Protection)
CREATE OR REPLACE FUNCTION public.record_refund_transaction(
    p_payment_id uuid,
    p_refund_amount numeric,
    p_refund_method text,
    p_reason text,
    p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_orig_payment record;
    v_sub record;
    v_pt record;
    v_curr_sub_id uuid;
    v_target_sub record;
    v_total_refunded numeric(12, 2);
    v_refund_id uuid;
    v_receipt_number text;
    v_canonical_payload jsonb;
    v_payload_hash text;
    v_cached_response jsonb;
    v_cached_hash text;
    v_lock_key text;
    v_response jsonb;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only administrators can execute refunds.' USING ERRCODE = '42501';
    END IF;

    IF p_payment_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Target payment ID is required.' USING ERRCODE = '22023';
    END IF;
    IF p_refund_amount IS NULL OR p_refund_amount <= 0.00 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Refund amount must be strictly positive.' USING ERRCODE = '22003';
    END IF;
    IF p_refund_method NOT IN ('Cash', 'UPI', 'Card') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Invalid refund method.' USING ERRCODE = '22023';
    END IF;

    v_canonical_payload := jsonb_build_object(
        'payment_id', p_payment_id,
        'refund_amount', to_char(p_refund_amount, 'FM999999990.00'),
        'refund_method', p_refund_method,
        'reason', NULLIF(trim(p_reason), '')
    );
    v_payload_hash := public.hash_payload(v_canonical_payload);

    v_lock_key := v_actor_id::text || ':record_refund_transaction:' || p_idempotency_key;
    PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_lock_key), 1, 16))::bit(64)::bigint);

    SELECT response, payload_hash INTO v_cached_response, v_cached_hash
    FROM public.idempotency_keys
    WHERE actor_id = v_actor_id
      AND operation = 'record_refund_transaction'
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_cached_hash <> v_payload_hash THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: Key reused with divergent parameters.' USING ERRCODE = 'P0004';
        END IF;
        RETURN v_cached_response;
    END IF;

    -- Lock Original Payment Row
    SELECT * INTO v_orig_payment
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYMENT_NOT_FOUND: Original payment record does not exist.' USING ERRCODE = 'P0002';
    END IF;

    IF v_orig_payment.transaction_type <> 'payment' OR v_orig_payment.status <> 'completed' THEN
        RAISE EXCEPTION 'INVALID_REFUND_TARGET: Refunds can only be issued against successful payment records.' USING ERRCODE = '22023';
    END IF;

    -- Verify Cumulative Refund Ceiling on the Payment Record
    SELECT COALESCE(SUM(amount), 0.00) INTO v_total_refunded
    FROM public.payments
    WHERE refund_of_payment_id = v_orig_payment.id
      AND transaction_type = 'refund'
      AND status = 'completed';

    IF (v_total_refunded + p_refund_amount) > v_orig_payment.amount THEN
        RAISE EXCEPTION 'ERR_REFUND_EXCEEDS_CEILING: Cumulative refunds (%) plus requested refund (%) exceed original payment amount (%).',
            v_total_refunded, p_refund_amount, v_orig_payment.amount USING ERRCODE = '22003';
    END IF;

    -- Prevent Negative Paid Amounts and Reconcile Transferred Debts
    IF v_orig_payment.subscription_id IS NOT NULL THEN
        SELECT * INTO v_sub FROM public.member_subscriptions WHERE id = v_orig_payment.subscription_id FOR UPDATE;
        IF (v_sub.amount_paid - p_refund_amount) < 0.00 THEN
            RAISE EXCEPTION 'ERR_REFUND_EXCEEDS_PAID_AMOUNT: Refund of % exceeds current paid amount (%) on subscription contract.',
                p_refund_amount, v_sub.amount_paid USING ERRCODE = '22003';
        END IF;

        -- If subscription transferred its debt forward upon renewal, traverse chain and adjust active contract liability
        v_curr_sub_id := v_orig_payment.subscription_id;
        LOOP
            SELECT * INTO v_target_sub FROM public.member_subscriptions WHERE id = v_curr_sub_id FOR UPDATE;
            IF v_target_sub.status = 'superseded' AND v_target_sub.transferred_to_subscription_id IS NOT NULL THEN
                UPDATE public.member_subscriptions
                SET balance_transferred_out = balance_transferred_out + p_refund_amount,
                    updated_at = clock_timestamp()
                WHERE id = v_curr_sub_id;

                v_curr_sub_id := v_target_sub.transferred_to_subscription_id;
                UPDATE public.member_subscriptions
                SET previous_balance_carried = previous_balance_carried + p_refund_amount,
                    updated_at = clock_timestamp()
                WHERE id = v_curr_sub_id;
            ELSE
                EXIT;
            END IF;
        END LOOP;
    ELSIF v_orig_payment.pt_assignment_id IS NOT NULL THEN
        SELECT * INTO v_pt FROM public.pt_assignments WHERE id = v_orig_payment.pt_assignment_id FOR UPDATE;
        IF (v_pt.amount_paid - p_refund_amount) < 0.00 THEN
            RAISE EXCEPTION 'ERR_REFUND_EXCEEDS_PAID_AMOUNT: Refund of % exceeds current paid amount (%) on PT assignment.',
                p_refund_amount, v_pt.amount_paid USING ERRCODE = '22003';
        END IF;
    END IF;

    v_receipt_number := public.generate_receipt_number();
    INSERT INTO public.payments (
        receipt_number, member_id, subscription_id, pt_assignment_id,
        transaction_type, amount, payment_method, status,
        refund_of_payment_id, notes, actor_id
    ) VALUES (
        v_receipt_number, v_orig_payment.member_id, v_orig_payment.subscription_id, v_orig_payment.pt_assignment_id,
        'refund', p_refund_amount, p_refund_method, 'completed',
        v_orig_payment.id, NULLIF(trim(p_reason), ''), v_actor_id
    ) RETURNING id INTO v_refund_id;

    v_response := jsonb_build_object(
        'success', true,
        'refund_id', v_refund_id,
        'receipt_number', v_receipt_number,
        'refund_amount', p_refund_amount,
        'original_payment_id', v_orig_payment.id,
        'remaining_refundable_balance', (v_orig_payment.amount - (v_total_refunded + p_refund_amount))
    );

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'record_refund_transaction', p_idempotency_key, v_payload_hash, v_response);

    RETURN v_response;
END;
$$;

-- H. Record Non-Cash Credit Adjustment / Fee Waiver (Admin-Only)
CREATE OR REPLACE FUNCTION public.record_credit_adjustment(
    p_member_id uuid,
    p_target_type text, -- 'subscription' or 'pt_assignment'
    p_target_id uuid,
    p_amount numeric,
    p_reason text,
    p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_target_balance numeric(12, 2);
    v_sub_id uuid := NULL;
    v_pt_id uuid := NULL;
    v_adj_id uuid;
    v_receipt_number text;
    v_canonical_payload jsonb;
    v_payload_hash text;
    v_cached_response jsonb;
    v_cached_hash text;
    v_lock_key text;
    v_response jsonb;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only administrators can record credit adjustments.' USING ERRCODE = '42501';
    END IF;

    IF p_member_id IS NULL OR p_target_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Member and target identifiers are mandatory.' USING ERRCODE = '22023';
    END IF;
    IF p_target_type NOT IN ('subscription', 'pt_assignment') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Target type must be subscription or pt_assignment.' USING ERRCODE = '22023';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0.00 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Adjustment amount must be strictly positive.' USING ERRCODE = '22003';
    END IF;

    v_canonical_payload := jsonb_build_object(
        'member_id', p_member_id,
        'target_type', p_target_type,
        'target_id', p_target_id,
        'amount', to_char(p_amount, 'FM999999990.00'),
        'reason', NULLIF(trim(p_reason), '')
    );
    v_payload_hash := public.hash_payload(v_canonical_payload);

    v_lock_key := v_actor_id::text || ':record_credit_adjustment:' || p_idempotency_key;
    PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_lock_key), 1, 16))::bit(64)::bigint);

    SELECT response, payload_hash INTO v_cached_response, v_cached_hash
    FROM public.idempotency_keys
    WHERE actor_id = v_actor_id
      AND operation = 'record_credit_adjustment'
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_cached_hash <> v_payload_hash THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: Key reused with divergent parameters.' USING ERRCODE = 'P0004';
        END IF;
        RETURN v_cached_response;
    END IF;

    IF p_target_type = 'subscription' THEN
        SELECT balance INTO v_target_balance
        FROM public.member_subscriptions
        WHERE id = p_target_id AND member_id = p_member_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'TARGET_NOT_FOUND: Subscription matching member not found.' USING ERRCODE = 'P0002';
        END IF;
        v_sub_id := p_target_id;
    ELSE
        SELECT balance INTO v_target_balance
        FROM public.pt_assignments
        WHERE id = p_target_id AND member_id = p_member_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'TARGET_NOT_FOUND: PT assignment matching member not found.' USING ERRCODE = 'P0002';
        END IF;
        v_pt_id := p_target_id;
    END IF;

    IF p_amount > v_target_balance THEN
        RAISE EXCEPTION 'ERR_ADJUSTMENT_EXCEEDS_BALANCE: Adjustment amount (%) exceeds outstanding target liability (%).',
            p_amount, v_target_balance USING ERRCODE = '22003';
    END IF;

    v_receipt_number := public.generate_receipt_number();
    INSERT INTO public.payments (
        receipt_number, member_id, subscription_id, pt_assignment_id,
        transaction_type, amount, payment_method, status, notes, actor_id
    ) VALUES (
        v_receipt_number, p_member_id, v_sub_id, v_pt_id,
        'credit_adjustment', p_amount, 'Adjustment', 'completed',
        NULLIF(trim(p_reason), ''), v_actor_id
    ) RETURNING id INTO v_adj_id;

    v_response := jsonb_build_object(
        'success', true,
        'adjustment_id', v_adj_id,
        'receipt_number', v_receipt_number,
        'amount_adjusted', p_amount,
        'target_type', p_target_type,
        'target_id', p_target_id,
        'new_balance', (v_target_balance - p_amount)
    );

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'record_credit_adjustment', p_idempotency_key, v_payload_hash, v_response);

    RETURN v_response;
END;
$$;

-- I. Admin Set Member Archive Status
CREATE OR REPLACE FUNCTION public.admin_set_member_archived(
    p_member_id uuid,
    p_archived boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only administrators can archive or unarchive members.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.members
    SET is_archived = p_archived,
        updated_at = clock_timestamp()
    WHERE id = p_member_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND: Member does not exist.' USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'member_id', p_member_id,
        'is_archived', p_archived
    );
END;
$$;

-- J. Admin Set User Role
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
    p_user_id uuid,
    p_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only administrators can modify user roles.' USING ERRCODE = '42501';
    END IF;

    IF p_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Role must be admin or staff.' USING ERRCODE = '22023';
    END IF;

    IF p_user_id = auth.uid() AND p_role = 'staff' THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Administrators cannot demote their own account.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.profiles
    SET role = p_role,
        updated_at = clock_timestamp()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROFILE_NOT_FOUND: User profile not found.' USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_user_id,
        'new_role', p_role
    );
END;
$$;

-- K. Executive Revenue & Financial Audit Report (Admin-Only, Disambiguated Historical Flow vs Current Snapshot)
CREATE OR REPLACE FUNCTION public.get_executive_revenue_report(
    p_start_date timestamptz DEFAULT '-infinity',
    p_end_date timestamptz DEFAULT 'infinity'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_gross_cash numeric(12, 2);
    v_cash_refunds numeric(12, 2);
    v_net_cash numeric(12, 2);
    v_credit_adjustments numeric(12, 2);
    v_live_sub_outstanding numeric(12, 2);
    v_live_pt_outstanding numeric(12, 2);
    v_cash_by_method jsonb;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Access restricted to administrators.' USING ERRCODE = '42501';
    END IF;

    -- 1. Periodic Cash Inflow
    SELECT COALESCE(SUM(amount), 0.00) INTO v_gross_cash
    FROM public.payments
    WHERE transaction_type = 'payment'
      AND status = 'completed'
      AND created_at >= p_start_date AND created_at <= p_end_date;

    -- 2. Periodic Cash Refunds Outflow
    SELECT COALESCE(SUM(amount), 0.00) INTO v_cash_refunds
    FROM public.payments
    WHERE transaction_type = 'refund'
      AND status = 'completed'
      AND created_at >= p_start_date AND created_at <= p_end_date;

    v_net_cash := v_gross_cash - v_cash_refunds;

    -- 3. Periodic Non-Cash Credit Adjustments (Fee Waivers)
    SELECT COALESCE(SUM(amount), 0.00) INTO v_credit_adjustments
    FROM public.payments
    WHERE transaction_type = 'credit_adjustment'
      AND status = 'completed'
      AND created_at >= p_start_date AND created_at <= p_end_date;

    -- 4. Point-in-Time Live Dues Snapshot (Unpaid Active Contracts)
    SELECT COALESCE(SUM(balance), 0.00) INTO v_live_sub_outstanding
    FROM public.member_subscriptions
    WHERE status = 'active' AND balance > 0.00;

    SELECT COALESCE(SUM(balance), 0.00) INTO v_live_pt_outstanding
    FROM public.pt_assignments
    WHERE status = 'active' AND balance > 0.00;

    -- 5. Periodic Net Cash by Payment Method
    SELECT COALESCE(jsonb_object_agg(payment_method, total), '{}'::jsonb) INTO v_cash_by_method
    FROM (
        SELECT payment_method, SUM(CASE WHEN transaction_type = 'payment' THEN amount ELSE -amount END) as total
        FROM public.payments
        WHERE transaction_type IN ('payment', 'refund')
          AND status = 'completed'
          AND created_at >= p_start_date AND created_at <= p_end_date
        GROUP BY payment_method
    ) sub;

    RETURN jsonb_build_object(
        'report_type', 'executive_revenue_and_dues_audit',
        'period_filter_start', p_start_date,
        'period_filter_end', p_end_date,
        'gross_cash_collections', v_gross_cash,
        'cash_refunds', v_cash_refunds,
        'net_cash_revenue', v_net_cash,
        'non_cash_credit_adjustments', v_credit_adjustments,
        'period_net_collections_by_method', v_cash_by_method,
        'live_snapshot_timestamp', clock_timestamp(),
        'live_active_membership_dues_outstanding', v_live_sub_outstanding,
        'live_active_pt_dues_outstanding', v_live_pt_outstanding,
        'live_total_outstanding_dues', (v_live_sub_outstanding + v_live_pt_outstanding)
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. REPORTING & CLIENT VIEWS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_active_members WITH (security_invoker = true) AS
SELECT 
    m.id,
    m.member_code,
    m.name,
    m.phone,
    m.email,
    m.gender,
    m.dob,
    m.is_archived,
    s.id AS current_subscription_id,
    s.plan_name,
    s.plan_price,
    s.total_liability,
    s.amount_paid,
    s.balance,
    s.payment_status,
    s.start_date,
    s.expiry_date,
    s.status AS subscription_status
FROM public.members m
LEFT JOIN LATERAL (
    SELECT *
    FROM public.member_subscriptions sub
    WHERE sub.member_id = m.id AND sub.status = 'active'
    ORDER BY sub.expiry_date DESC
    LIMIT 1
) s ON true
WHERE m.is_archived = false;

-- Sanitized Staff Roster View (Excludes private emails; allows staff attribution in UI)
CREATE OR REPLACE VIEW public.v_staff_roster WITH (security_invoker = false) AS
SELECT 
    id,
    full_name,
    role,
    created_at
FROM public.profiles;

-- ----------------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY (RLS) POLICIES (NON-RECURSIVE)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- A. Profiles (Clean non-recursive policies; role protected by column-level grant; emails hidden from coworkers)
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_self_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_self_or_admin" ON public.profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self" ON public.profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
CREATE POLICY "profiles_admin_all" ON public.profiles
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- B. Gym Info & Catalogs (Read-all, Admin-write)
DROP POLICY IF EXISTS "gym_info_select" ON public.gym_info;
CREATE POLICY "gym_info_select" ON public.gym_info FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "gym_info_admin" ON public.gym_info;
CREATE POLICY "gym_info_admin" ON public.gym_info FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "plans_select" ON public.membership_plans;
CREATE POLICY "plans_select" ON public.membership_plans FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "plans_admin" ON public.membership_plans;
CREATE POLICY "plans_admin" ON public.membership_plans FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "packages_select" ON public.pt_packages;
CREATE POLICY "packages_select" ON public.pt_packages FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "packages_admin" ON public.pt_packages;
CREATE POLICY "packages_admin" ON public.pt_packages FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "trainers_select" ON public.trainers;
CREATE POLICY "trainers_select" ON public.trainers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "trainers_admin" ON public.trainers;
CREATE POLICY "trainers_admin" ON public.trainers FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- C. Members (Non-recursive update policy; column-level grant protects is_archived & code)
DROP POLICY IF EXISTS "members_select" ON public.members;
CREATE POLICY "members_select" ON public.members
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "members_update_staff" ON public.members;
CREATE POLICY "members_update_staff" ON public.members
    FOR UPDATE TO authenticated
    USING (is_archived = false)
    WITH CHECK (true);

DROP POLICY IF EXISTS "members_admin_delete" ON public.members;
CREATE POLICY "members_admin_delete" ON public.members
    FOR DELETE TO authenticated USING (public.is_admin());

-- D. Member Subscriptions (Read-Only to Authenticated; Mutations strictly via RPC)
DROP POLICY IF EXISTS "subscriptions_select" ON public.member_subscriptions;
CREATE POLICY "subscriptions_select" ON public.member_subscriptions
    FOR SELECT TO authenticated USING (true);

-- E. Personal Training Assignments & Sessions
DROP POLICY IF EXISTS "pt_assignments_select" ON public.pt_assignments;
CREATE POLICY "pt_assignments_select" ON public.pt_assignments
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "pt_assignments_update_staff" ON public.pt_assignments;
CREATE POLICY "pt_assignments_update_staff" ON public.pt_assignments
    FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "pt_sessions_select" ON public.pt_sessions;
CREATE POLICY "pt_sessions_select" ON public.pt_sessions
    FOR SELECT TO authenticated USING (true);

-- F. Payments Ledger (Read-Only to Authenticated; Insertions strictly via RPC)
DROP POLICY IF EXISTS "payments_select" ON public.payments;
CREATE POLICY "payments_select" ON public.payments
    FOR SELECT TO authenticated USING (true);

-- G. Idempotency Keys (Actor Isolation)
DROP POLICY IF EXISTS "idempotency_actor_access" ON public.idempotency_keys;
CREATE POLICY "idempotency_actor_access" ON public.idempotency_keys
    FOR ALL TO authenticated
    USING (actor_id = auth.uid())
    WITH CHECK (actor_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 11. SQL TABLE & COLUMN LEVEL PRIVILEGES
-- ----------------------------------------------------------------------------

-- Revoke all table privileges from anon
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- Grant SELECT on all to authenticated
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON public.v_active_members TO authenticated;
GRANT SELECT ON public.v_staff_roster TO authenticated;

-- Profiles: Users can update their own full_name ONLY. Role cannot be updated via SQL grant.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;

-- Members: Disallow direct INSERT; Column-level grant prevents staff from changing is_archived or member_code
REVOKE INSERT, DELETE ON public.members FROM authenticated;
REVOKE UPDATE ON public.members FROM authenticated;
GRANT UPDATE (name, phone, email, gender, dob, address, emergency_contact, blood_group, medical_notes, notes)
    ON public.members TO authenticated;

-- Member Subscriptions: Strictly RPC managed
REVOKE INSERT, UPDATE, DELETE ON public.member_subscriptions FROM authenticated;

-- PT Assignments: Disallow INSERT/DELETE; Column-level UPDATE restricted to trainer assignment and notes
REVOKE INSERT, DELETE ON public.pt_assignments FROM authenticated;
REVOKE UPDATE ON public.pt_assignments FROM authenticated;
GRANT UPDATE (trainer_id, notes) ON public.pt_assignments TO authenticated;

-- PT Sessions & Payments: Strictly RPC managed (No direct write)
REVOKE INSERT, UPDATE, DELETE ON public.pt_sessions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.idempotency_keys FROM authenticated;

-- Catalogs Admin-Only Modifications (Least-Privilege: TRUNCATE strictly excluded to prevent RLS bypass)
REVOKE ALL ON public.gym_info FROM authenticated;
REVOKE ALL ON public.membership_plans FROM authenticated;
REVOKE ALL ON public.pt_packages FROM authenticated;
REVOKE ALL ON public.trainers FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gym_info TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pt_packages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainers TO authenticated;

-- ----------------------------------------------------------------------------
-- 12. FUNCTION PRIVILEGES (EXACT TYPED SIGNATURES)
-- ----------------------------------------------------------------------------

-- Revoke everything from public and anon
REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hash_payload(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_member_code() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_receipt_number() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.onboard_member(text, text, text, text, date, text, text, text, text, text, uuid, date, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.renew_member_subscription(uuid, uuid, date, boolean, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_dues_payment(uuid, uuid, numeric, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_pt_package(uuid, uuid, uuid, date, numeric, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_pt_dues_payment(uuid, uuid, numeric, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_pt_session(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_refund_transaction(uuid, numeric, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_credit_adjustment(uuid, text, uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_member_archived(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_executive_revenue_report(timestamptz, timestamptz) FROM PUBLIC, anon;

-- Grant EXECUTE to authenticated role
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hash_payload(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.onboard_member(text, text, text, text, date, text, text, text, text, text, uuid, date, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renew_member_subscription(uuid, uuid, date, boolean, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_dues_payment(uuid, uuid, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_pt_package(uuid, uuid, uuid, date, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_pt_dues_payment(uuid, uuid, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pt_session(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_refund_transaction(uuid, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_credit_adjustment(uuid, text, uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_member_archived(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_executive_revenue_report(timestamptz, timestamptz) TO authenticated;

COMMIT;
