-- ============================================================================
-- THE FITNESS HOUSE — CONSOLIDATED RELEASE CANDIDATE 2.2.2 (RC2.2.2) FORWARD MIGRATION
-- Project Target: xfagvgypgboplonokntk (Hosted Supabase PostgreSQL 15+)
-- Baseline Git Commit: 52c92d5
-- Coordinated Release Window: One Single Transaction Deployment
--
-- Objective:
-- 1. Execute strict preflight assertions.
-- 2. Apply all Phase 1 through Phase 5 schema extensions and missing tables.
-- 3. Resolve the complete_pt_session overloaded function ambiguity.
-- 4. Harden staff security, invitations, audit logs, and operational RPCs.
-- 5. Enforce fail-closed deactivation in get_user_role(), is_staff_active(), is_admin().
-- 6. Include canonical bug-fix DDL for renew_member_subscription and record_member_checkin.
-- 7. Enforce zero-trust financial balance masking on views for staff.
-- 8. Synchronize supabase_migrations.schema_migrations ledger for all 13 versions with metadata validation.
-- 9. Execute rigorous fail-closed postflight verification assertions (Issue A: Indexes, Issue B: RLS, Issue C: Ledger).
--
-- Safety Guarantees:
-- - No DROP ... CASCADE on base tables.
-- - No deletion, mutation, or truncation of existing production business rows.
-- - Single atomic transaction: rolls back automatically on ANY error or assertion failure.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- ============================================================================
-- 1. PREFLIGHT COMPATIBILITY CHECKS
-- ============================================================================
DO $preflight$
DECLARE
    v_name text;
    v_relkind "char";
BEGIN
    IF current_setting('server_version_num')::integer < 150000 THEN
        RAISE EXCEPTION 'PREFLIGHT_FAILED: PostgreSQL 15+ is required.';
    END IF;

    IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
        RAISE EXCEPTION 'PREFLIGHT_FAILED: Supabase Auth users and auth.uid() must exist.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname IN ('anon', 'authenticated', 'service_role')
        GROUP BY 1 HAVING count(*) = 3
    ) THEN
        RAISE EXCEPTION 'PREFLIGHT_FAILED: Standard Supabase roles (anon, authenticated, service_role) must exist.';
    END IF;

    FOREACH v_name IN ARRAY ARRAY[
        'profiles','members','membership_plans','member_subscriptions','payments','pt_packages','trainers',
        'pt_assignments','pt_sessions','idempotency_keys','checkins','notifications','member_followups','gym_info'
    ] LOOP
        SELECT c.relkind INTO v_relkind
        FROM pg_catalog.pg_class c
        WHERE c.oid = to_regclass('public.' || v_name);
        IF v_relkind IS NULL OR v_relkind NOT IN ('r','p') THEN
            RAISE EXCEPTION 'PREFLIGHT_FAILED: Required base relation public.% is missing.', v_name;
        END IF;
    END LOOP;
END;
$preflight$;

-- ============================================================================
-- 2. PROFILES LIFECYCLE & HARDENED ROLE RESOLUTION HELPERS (FAIL-CLOSED)
-- ============================================================================
-- Ensure profiles columns exist before role resolution helpers and table policies execute
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deactivated_at timestamp with time zone;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON public.profiles(is_active);

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.is_staff_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'staff')
          AND is_active = true
    );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
    SELECT COALESCE((SELECT role = 'admin' FROM public.profiles WHERE id = auth.uid() AND is_active = true), false);
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
    SELECT public.is_staff_active();
$$;

-- Sanitized Staff Roster View
CREATE OR REPLACE VIEW public.v_staff_roster WITH (security_invoker = false, security_barrier = true) AS
SELECT
    id,
    full_name,
    role,
    created_at,
    is_active,
    deactivated_at
FROM public.profiles
WHERE public.is_staff();

-- ============================================================================
-- 3. SCHEMA EXTENSIONS & NEW RELATIONS
-- ============================================================================

-- 2.1 Gym Info Extended Columns (20261101000000)
ALTER TABLE public.gym_info ADD COLUMN IF NOT EXISTS whatsapp_number text;
ALTER TABLE public.gym_info ADD COLUMN IF NOT EXISTS operating_hours jsonb;
ALTER TABLE public.gym_info ADD COLUMN IF NOT EXISTS tax_id text;
ALTER TABLE public.gym_info ADD COLUMN IF NOT EXISTS gst_number text;
ALTER TABLE public.gym_info ADD COLUMN IF NOT EXISTS rules text[];
ALTER TABLE public.gym_info ADD COLUMN IF NOT EXISTS social_links jsonb;

-- 2.2 PT Packages Validity (20261102000001)
ALTER TABLE public.pt_packages ADD COLUMN IF NOT EXISTS validity_days integer DEFAULT 30;

-- 2.3 Reminder Settings Table & Policies (20261102000002)
CREATE TABLE IF NOT EXISTS public.reminder_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key text NOT NULL UNIQUE,
    setting_value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.reminder_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reminder_settings_select" ON public.reminder_settings;
DROP POLICY IF EXISTS "Authenticated users can read reminder_settings" ON public.reminder_settings;
CREATE POLICY "reminder_settings_select" ON public.reminder_settings FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "reminder_settings_update" ON public.reminder_settings;
DROP POLICY IF EXISTS "Admins can update reminder_settings" ON public.reminder_settings;
CREATE POLICY "reminder_settings_update" ON public.reminder_settings FOR ALL TO authenticated USING (public.is_admin());

-- 2.5 Staff Invitations Table (20261102000003)
CREATE TABLE IF NOT EXISTS public.staff_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role = 'staff') DEFAULT 'staff',
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')) DEFAULT 'pending',
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + interval '7 days'),
    accepted_at TIMESTAMPTZ DEFAULT NULL,
    revoked_at TIMESTAMPTZ DEFAULT NULL
);
ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_invitations_active_email ON public.staff_invitations(lower(trim(email))) WHERE (status = 'pending');
CREATE INDEX IF NOT EXISTS idx_staff_invitations_email ON public.staff_invitations(lower(trim(email)));
CREATE INDEX IF NOT EXISTS idx_staff_invitations_status ON public.staff_invitations(status);

DROP POLICY IF EXISTS "staff_invitations_admin_all" ON public.staff_invitations;
DROP POLICY IF EXISTS "staff_invitations_select_admin" ON public.staff_invitations;
CREATE POLICY "staff_invitations_admin_all" ON public.staff_invitations FOR ALL TO authenticated USING (public.is_admin());

-- 2.6 Security Audit Logs Table (20261102000003)
CREATE TABLE IF NOT EXISTS public.security_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_actor ON public.security_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_action ON public.security_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_created_at ON public.security_audit_logs(created_at DESC);

DROP POLICY IF EXISTS "security_audit_logs_admin_only" ON public.security_audit_logs;
DROP POLICY IF EXISTS "security_audit_logs_select_admin" ON public.security_audit_logs;
CREATE POLICY "security_audit_logs_select_admin" ON public.security_audit_logs FOR SELECT TO authenticated USING (public.is_admin());

-- 2.7 PT Scheduled Sessions Table & Sequence (20261107140000)
CREATE SEQUENCE IF NOT EXISTS public.pt_session_code_seq START WITH 1;
GRANT USAGE, SELECT ON SEQUENCE public.pt_session_code_seq TO authenticated;

CREATE TABLE IF NOT EXISTS public.pt_scheduled_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_code text NOT NULL UNIQUE,
    assignment_id uuid NOT NULL REFERENCES public.pt_assignments(id) ON DELETE RESTRICT,
    member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    trainer_id uuid NOT NULL REFERENCES public.trainers(id) ON DELETE RESTRICT,
    session_date date NOT NULL,
    session_time text NOT NULL,
    notes text,
    status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no-show')),
    completed_session_id uuid REFERENCES public.pt_sessions(id) ON DELETE SET NULL,
    actor_id uuid NOT NULL REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.pt_scheduled_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pt_scheduled_sessions_assignment ON public.pt_scheduled_sessions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_pt_scheduled_sessions_member ON public.pt_scheduled_sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_pt_scheduled_sessions_trainer ON public.pt_scheduled_sessions(trainer_id);
CREATE INDEX IF NOT EXISTS idx_pt_scheduled_sessions_date ON public.pt_scheduled_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_pt_scheduled_sessions_status ON public.pt_scheduled_sessions(status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pt_scheduled_assignment_slot
ON public.pt_scheduled_sessions (assignment_id, session_date, session_time)
WHERE (status = 'scheduled');

-- Concurrency Invariant: At most one active check-in per member
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkins_active_member
ON public.checkins (member_id)
WHERE (checked_out_at IS NULL AND status = 'checked_in');

-- Concurrency Invariant: At most one active subscription per member
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_active_subscription
ON public.member_subscriptions (member_id)
WHERE (status = 'active');

DROP POLICY IF EXISTS "Staff can view PT scheduled sessions" ON public.pt_scheduled_sessions;
DROP POLICY IF EXISTS "pt_scheduled_sessions_staff_select" ON public.pt_scheduled_sessions;
CREATE POLICY "pt_scheduled_sessions_staff_select" ON public.pt_scheduled_sessions FOR SELECT TO authenticated USING (public.is_staff());

-- 3.8 Phase 5 Active-Role Core RLS Policies (20261102000003 & 20261102020000)
-- Update existing base tables with active-role fail-closed policies
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payments_select" ON public.payments;
CREATE POLICY "payments_select" ON public.payments
    FOR SELECT TO authenticated
    USING (public.is_admin());

ALTER TABLE public.member_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscriptions_select" ON public.member_subscriptions;
CREATE POLICY "subscriptions_select" ON public.member_subscriptions
    FOR SELECT TO authenticated
    USING (public.is_admin());

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members_select" ON public.members;
CREATE POLICY "members_select" ON public.members
    FOR SELECT TO authenticated
    USING (public.is_staff());

DROP POLICY IF EXISTS "members_update_staff" ON public.members;
CREATE POLICY "members_update_staff" ON public.members
    FOR UPDATE TO authenticated
    USING (public.is_staff() AND is_archived = false)
    WITH CHECK (public.is_staff());

ALTER TABLE public.pt_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pt_packages_select_active" ON public.pt_packages;
DROP POLICY IF EXISTS "pt_packages_select_all" ON public.pt_packages;
DROP POLICY IF EXISTS "packages_select" ON public.pt_packages;
CREATE POLICY "pt_packages_select_all" ON public.pt_packages
    FOR SELECT TO authenticated
    USING (public.is_staff());

ALTER TABLE public.gym_info ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gym_info_select" ON public.gym_info;
CREATE POLICY "gym_info_select" ON public.gym_info
    FOR SELECT TO authenticated
    USING (public.is_staff());

ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "checkins_select" ON public.checkins;
CREATE POLICY "checkins_select" ON public.checkins
    FOR SELECT TO authenticated
    USING (public.is_staff());

DROP POLICY IF EXISTS "checkins_insert" ON public.checkins;
CREATE POLICY "checkins_insert" ON public.checkins
    FOR INSERT TO authenticated
    WITH CHECK (public.is_staff());

ALTER TABLE public.pt_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pt_assignments_select" ON public.pt_assignments;
CREATE POLICY "pt_assignments_select" ON public.pt_assignments
    FOR SELECT TO authenticated
    USING (public.is_staff());

DROP POLICY IF EXISTS "pt_assignments_update_staff" ON public.pt_assignments;
CREATE POLICY "pt_assignments_update_staff" ON public.pt_assignments
    FOR UPDATE TO authenticated
    USING (public.is_staff())
    WITH CHECK (public.is_staff());

ALTER TABLE public.pt_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pt_sessions_select" ON public.pt_sessions;
CREATE POLICY "pt_sessions_select" ON public.pt_sessions
    FOR SELECT TO authenticated
    USING (public.is_staff());

DROP POLICY IF EXISTS "followups_select" ON public.member_followups;

-- ============================================================================
-- 4. PERSONAL TRAINING LIFECYCLE RPCS (OVERLOAD AMBIGUITY ELIMINATION)
-- ============================================================================

-- Drop obsolete 2-argument overload cleanly to eliminate Postgres 42725 ambiguity
DROP FUNCTION IF EXISTS public.complete_pt_session(uuid, text);

-- Single Canonical complete_pt_session RPC
CREATE OR REPLACE FUNCTION public.complete_pt_session(
    p_assignment_id uuid,
    p_notes text DEFAULT NULL,
    p_scheduled_session_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_pt record;
    v_sched record;
    v_pt_session_id uuid;
    v_new_completed integer;
    v_new_status text;
    v_conducted_at timestamptz := clock_timestamp();
BEGIN
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: Active staff authentication required.' USING ERRCODE = '42501';
    END IF;

    IF p_assignment_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Assignment ID is mandatory.' USING ERRCODE = '22023';
    END IF;

    IF p_scheduled_session_id IS NOT NULL THEN
        SELECT * INTO v_sched
        FROM public.pt_scheduled_sessions
        WHERE id = p_scheduled_session_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'SESSION_NOT_FOUND: Scheduled PT session record not found.' USING ERRCODE = 'P0002';
        END IF;

        IF v_sched.status = 'completed' THEN
            RAISE EXCEPTION 'SESSION_ALREADY_COMPLETED: This session has already been marked completed.' USING ERRCODE = '22023';
        END IF;

        IF v_sched.status = 'cancelled' THEN
            RAISE EXCEPTION 'SESSION_CANCELLED: Cancelled sessions cannot be completed.' USING ERRCODE = '22023';
        END IF;

        IF v_sched.assignment_id <> p_assignment_id THEN
            RAISE EXCEPTION 'ASSIGNMENT_MISMATCH: Scheduled session does not match provided assignment.' USING ERRCODE = '22023';
        END IF;
    END IF;

    SELECT * INTO v_pt FROM public.pt_assignments WHERE id = p_assignment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND: PT assignment record not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_pt.completed_sessions >= v_pt.total_sessions THEN
        RAISE EXCEPTION 'SESSIONS_EXHAUSTED: All % package sessions have already been logged.',
            v_pt.total_sessions USING ERRCODE = '22003';
    END IF;

    IF v_pt.status <> 'active' THEN
        RAISE EXCEPTION 'INVALID_STATUS: Sessions can only be logged against active PT packages.' USING ERRCODE = '22023';
    END IF;

    v_new_completed := v_pt.completed_sessions + 1;
    v_new_status := CASE WHEN v_new_completed >= v_pt.total_sessions THEN 'completed' ELSE 'active' END;

    UPDATE public.pt_assignments
    SET completed_sessions = v_new_completed,
        status = v_new_status,
        updated_at = v_conducted_at
    WHERE id = p_assignment_id;

    INSERT INTO public.pt_sessions (
        assignment_id, session_number, conducted_at, trainer_id, notes, actor_id
    ) VALUES (
        p_assignment_id, v_new_completed, v_conducted_at, v_pt.trainer_id, NULLIF(trim(p_notes), ''), v_actor_id
    ) RETURNING id INTO v_pt_session_id;

    IF p_scheduled_session_id IS NOT NULL THEN
        UPDATE public.pt_scheduled_sessions
        SET status = 'completed',
            completed_session_id = v_pt_session_id,
            updated_at = v_conducted_at
        WHERE id = p_scheduled_session_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'session_id', v_pt_session_id,
        'assignment_id', p_assignment_id,
        'session_number', v_new_completed,
        'total_sessions', v_pt.total_sessions,
        'completed_sessions', v_new_completed,
        'remaining_sessions', v_pt.total_sessions - v_new_completed,
        'status', v_new_status
    );
END;
$$;

-- schedule_pt_session RPC
DROP FUNCTION IF EXISTS public.schedule_pt_session(uuid, date, text, text);
CREATE OR REPLACE FUNCTION public.schedule_pt_session(
    p_assignment_id uuid,
    p_session_date date,
    p_session_time text,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_pt record;
    v_session_id uuid;
    v_session_code text;
    v_time text := trim(p_session_time);
BEGIN
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: Active staff authentication required.' USING ERRCODE = '42501';
    END IF;

    IF p_assignment_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Assignment ID is mandatory.' USING ERRCODE = '22023';
    END IF;
    IF p_session_date IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Session date is mandatory.' USING ERRCODE = '22023';
    END IF;
    IF v_time IS NULL OR v_time = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Session time slot is mandatory.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_pt FROM public.pt_assignments WHERE id = p_assignment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND: PT assignment record not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_pt.completed_sessions >= v_pt.total_sessions THEN
        RAISE EXCEPTION 'SESSIONS_EXHAUSTED: All % package sessions have already been logged.',
            v_pt.total_sessions USING ERRCODE = '22003';
    END IF;

    IF v_pt.status <> 'active' THEN
        RAISE EXCEPTION 'INVALID_STATUS: Sessions can only be scheduled for active PT packages.' USING ERRCODE = '22023';
    END IF;

    v_session_code := 'PTS' || lpad(nextval('public.pt_session_code_seq')::text, 4, '0');

    INSERT INTO public.pt_scheduled_sessions (
        session_code, assignment_id, member_id, trainer_id, session_date, session_time, notes, status, actor_id
    ) VALUES (
        v_session_code, p_assignment_id, v_pt.member_id, v_pt.trainer_id, p_session_date, v_time, NULLIF(trim(p_notes), ''), 'scheduled', v_actor_id
    ) RETURNING id INTO v_session_id;

    RETURN jsonb_build_object(
        'success', true,
        'session_id', v_session_id,
        'session_code', v_session_code,
        'assignment_id', p_assignment_id,
        'session_date', p_session_date,
        'session_time', v_time,
        'status', 'scheduled'
    );
END;
$$;

-- cancel_pt_scheduled_session RPC
DROP FUNCTION IF EXISTS public.cancel_pt_scheduled_session(uuid, text);
CREATE OR REPLACE FUNCTION public.cancel_pt_scheduled_session(
    p_scheduled_session_id uuid,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_sched record;
    v_now timestamptz := clock_timestamp();
BEGIN
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: Active staff authentication required.' USING ERRCODE = '42501';
    END IF;

    IF p_scheduled_session_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Scheduled session ID is mandatory.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_sched FROM public.pt_scheduled_sessions WHERE id = p_scheduled_session_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SESSION_NOT_FOUND: Scheduled PT session record not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_sched.status = 'completed' THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Completed sessions cannot be cancelled.' USING ERRCODE = '22023';
    END IF;

    IF v_sched.status = 'cancelled' THEN
        RETURN jsonb_build_object(
            'success', true,
            'session_id', p_scheduled_session_id,
            'status', 'cancelled',
            'message', 'Session was already cancelled.'
        );
    END IF;

    UPDATE public.pt_scheduled_sessions
    SET status = 'cancelled',
        notes = CASE 
            WHEN p_notes IS NOT NULL AND btrim(p_notes) <> '' THEN 
                COALESCE(notes || E'\nCancellation reason: ' || trim(p_notes), 'Cancellation reason: ' || trim(p_notes))
            ELSE notes 
        END,
        updated_at = v_now
    WHERE id = p_scheduled_session_id;

    RETURN jsonb_build_object(
        'success', true,
        'session_id', p_scheduled_session_id,
        'status', 'cancelled'
    );
END;
$$;

-- update_pt_scheduled_session RPC
DROP FUNCTION IF EXISTS public.update_pt_scheduled_session(uuid, date, text, text);
CREATE OR REPLACE FUNCTION public.update_pt_scheduled_session(
    p_scheduled_session_id uuid,
    p_session_date date,
    p_session_time text,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_sched record;
    v_time text := trim(p_session_time);
    v_now timestamptz := clock_timestamp();
BEGIN
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: Active staff authentication required.' USING ERRCODE = '42501';
    END IF;

    IF p_scheduled_session_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Scheduled session ID is mandatory.' USING ERRCODE = '22023';
    END IF;
    IF p_session_date IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Session date is mandatory.' USING ERRCODE = '22023';
    END IF;
    IF v_time IS NULL OR v_time = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Session time slot is mandatory.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_sched FROM public.pt_scheduled_sessions WHERE id = p_scheduled_session_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SESSION_NOT_FOUND: Scheduled PT session record not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_sched.status <> 'scheduled' THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Only active scheduled sessions can be updated.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.pt_scheduled_sessions
    SET session_date = p_session_date,
        session_time = v_time,
        notes = COALESCE(NULLIF(trim(p_notes), ''), notes),
        updated_at = v_now
    WHERE id = p_scheduled_session_id;

    RETURN jsonb_build_object(
        'success', true,
        'session_id', p_scheduled_session_id,
        'session_date', p_session_date,
        'session_time', v_time,
        'status', 'scheduled'
    );
END;
$$;

-- ============================================================================
-- 5. CANONICAL BUG-FIX RPCS (MEMBERSHIP & ATTENDANCE)
-- ============================================================================

-- 5.1 renew_member_subscription RPC (20261107000000)
-- Corrects check constraint violation: uses 'superseded' instead of 'completed'
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

    v_lock_key := v_actor_id::text || ':renew_member_subscription:' || p_idempotency_key;
    PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_lock_key), 1, 16))::bit(64)::bigint);

    -- Member-level advisory lock serializes concurrent renewals targeting the same member
    PERFORM pg_advisory_xact_lock(('x' || substr(md5('member_renewal:' || p_member_id::text), 1, 16))::bit(64)::bigint);

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
                RAISE EXCEPTION 'ERR_OUTSTANDING_BALANCE_NOT_SETTLED: Previous contract has an unpaid balance of %. Settle dues or carry forward.', v_prev_sub.balance USING ERRCODE = '22000';
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
        member_id, plan_id, plan_name, plan_price, previous_balance_carried,
        amount_paid, start_date, expiry_date, status
    ) VALUES (
        p_member_id, v_plan.id, v_plan.name, v_plan.price, v_carried_balance,
        0.00, p_start_date, v_expiry_date, 'active'
    ) RETURNING id INTO v_new_sub_id;

    IF p_payment_amount > 0.00 THEN
        v_receipt_number := public.generate_receipt_number();
        INSERT INTO public.payments (
            receipt_number, member_id, subscription_id, transaction_type,
            amount, payment_method, status, notes, actor_id
        ) VALUES (
            v_receipt_number, p_member_id, v_new_sub_id, 'payment',
            p_payment_amount, p_payment_method, 'completed',
            'Renewal initial dues collection', v_actor_id
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

-- 5.2 record_member_checkin RPC (20261107120000)
-- Validates current and early-renewed continuous subscription eligibility
CREATE OR REPLACE FUNCTION public.record_member_checkin(
    p_member_id uuid,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_member record;
    v_sub record;
    v_active_ci record;
    v_checkin_id uuid;
    v_checkin_code text;
    v_checked_in_at timestamptz;
    v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: Active staff authentication required.' USING ERRCODE = '42501';
    END IF;

    IF p_member_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Member ID is mandatory.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_member FROM public.members WHERE id = p_member_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND: Member does not exist.' USING ERRCODE = 'P0002';
    END IF;

    IF v_member.is_archived THEN
        RAISE EXCEPTION 'MEMBER_ARCHIVED: Member % is archived. Archival must be reversed before logging attendance.',
            v_member.member_code USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_sub
    FROM public.member_subscriptions
    WHERE member_id = p_member_id AND status = 'active'
    ORDER BY expiry_date DESC
    LIMIT 1;

    IF NOT FOUND THEN
        SELECT * INTO v_sub
        FROM public.member_subscriptions
        WHERE member_id = p_member_id
        ORDER BY expiry_date DESC
        LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'ERR_NO_ACTIVE_MEMBERSHIP: Member % has no active membership plan. Onboarding or plan renewal required.',
                v_member.name USING ERRCODE = '22023';
        ELSIF v_sub.status = 'cancelled' THEN
            RAISE EXCEPTION 'ERR_MEMBERSHIP_CANCELLED: Membership for % has been cancelled. Plan renewal required before check-in.',
                v_member.name USING ERRCODE = '22023';
        ELSIF v_sub.expiry_date < v_today THEN
            RAISE EXCEPTION 'ERR_MEMBERSHIP_EXPIRED: Membership for % expired on %. Renewal required before check-in.',
                v_member.name, v_sub.expiry_date USING ERRCODE = '22023';
        ELSE
            RAISE EXCEPTION 'ERR_NO_ACTIVE_MEMBERSHIP: Member % has no active membership plan. Onboarding or plan renewal required.',
                v_member.name USING ERRCODE = '22023';
        END IF;
    END IF;

    IF v_sub.expiry_date < v_today THEN
        RAISE EXCEPTION 'ERR_MEMBERSHIP_EXPIRED: Membership for % expired on %. Renewal required before check-in.',
            v_member.name, v_sub.expiry_date USING ERRCODE = '22023';
    END IF;

    IF v_sub.start_date > v_today THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.member_subscriptions
            WHERE member_id = p_member_id
              AND status IN ('active', 'superseded')
              AND start_date <= v_today
              AND expiry_date >= v_today
        ) THEN
            RAISE EXCEPTION 'ERR_MEMBERSHIP_FUTURE: Membership for % begins on %. Check-in not permitted prior to start date.',
                v_member.name, v_sub.start_date USING ERRCODE = '22023';
        END IF;
    END IF;

    SELECT * INTO v_active_ci FROM public.checkins
    WHERE member_id = p_member_id AND status = 'checked_in' AND checked_out_at IS NULL;
    IF FOUND THEN
        RAISE EXCEPTION 'MEMBER_ALREADY_CHECKED_IN: % is already checked in (since %). Active session must be checked out first.',
            v_member.name, to_char(v_active_ci.checked_in_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') USING ERRCODE = '23505';
    END IF;

    v_checkin_code := public.generate_checkin_code();
    INSERT INTO public.checkins (checkin_code, member_id, checked_in_at, status, notes, actor_id)
    VALUES (v_checkin_code, p_member_id, clock_timestamp(), 'checked_in', NULLIF(trim(p_notes), ''), v_actor_id)
    RETURNING id, checked_in_at INTO v_checkin_id, v_checked_in_at;

    RETURN jsonb_build_object(
        'success', true,
        'checkin_id', v_checkin_id,
        'checkin_code', v_checkin_code,
        'member_id', p_member_id,
        'member_code', v_member.member_code,
        'member_name', v_member.name,
        'plan_name', v_sub.plan_name,
        'checked_in_at', v_checked_in_at,
        'status', 'checked_in'
    );
END;
$$;

-- 5.3 record_member_checkout RPC (20261102040000)
CREATE OR REPLACE FUNCTION public.record_member_checkout(
    p_checkin_id uuid,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_ci record;
    v_now timestamptz := clock_timestamp();
    v_duration_min integer;
BEGIN
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: Active staff authentication required.' USING ERRCODE = '42501';
    END IF;
    IF p_checkin_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Check-in ID is mandatory.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_ci FROM public.checkins WHERE id = p_checkin_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CHECKIN_NOT_FOUND: Check-in record % does not exist.', p_checkin_id USING ERRCODE = 'P0002';
    END IF;

    IF v_ci.status = 'checked_out' OR v_ci.checked_out_at IS NOT NULL THEN
        RAISE EXCEPTION 'ALREADY_CHECKED_OUT: Session % was already checked out at %.',
            p_checkin_id, to_char(v_ci.checked_out_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') USING ERRCODE = '22023';
    END IF;

    v_duration_min := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_now - v_ci.checked_in_at)) / 60)::integer);

    UPDATE public.checkins
    SET checked_out_at = v_now,
        status = 'checked_out',
        notes = CASE 
            WHEN p_notes IS NOT NULL AND btrim(p_notes) <> '' THEN 
                COALESCE(notes || ' | ' || trim(p_notes), trim(p_notes))
            ELSE notes 
        END,
        updated_at = v_now
    WHERE id = p_checkin_id;

    RETURN jsonb_build_object(
        'success', true,
        'checkin_id', p_checkin_id,
        'checked_in_at', v_ci.checked_in_at,
        'checked_out_at', v_now,
        'duration_minutes', v_duration_min,
        'status', 'checked_out'
    );
END;
$$;

-- 5.4 record_dues_payment RPC (20261102010000)
-- Enforces active administrator authorization, search path, advisory locking
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
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can record dues payments.' USING ERRCODE = '42501';
    END IF;

    IF p_member_id IS NULL OR p_subscription_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Member and subscription identifiers are mandatory.' USING ERRCODE = '22023';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0.00 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Payment amount must be strictly greater than zero.' USING ERRCODE = '22003';
    END IF;
    IF p_payment_method NOT IN ('Cash', 'UPI', 'Card') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Payment method must be Cash, UPI, or Card.' USING ERRCODE = '22023';
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Idempotency key is required.' USING ERRCODE = '22023';
    END IF;

    v_canonical_payload := jsonb_build_object(
        'member_id', p_member_id,
        'subscription_id', p_subscription_id,
        'amount', to_char(p_amount, 'FM999999990.00'),
        'payment_method', p_payment_method
    );
    v_payload_hash := public.hash_payload(v_canonical_payload);

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

    SELECT * INTO v_sub
    FROM public.member_subscriptions
    WHERE id = p_subscription_id AND member_id = p_member_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND: Subscription record not found for this member.' USING ERRCODE = 'P0002';
    END IF;

    IF p_amount > v_sub.balance THEN
        RAISE EXCEPTION 'ERR_OVERPAYMENT_EXCEEDS_BALANCE: Payment amount (%) exceeds outstanding balance (%).',
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
        'payment_id', v_payment_id,
        'receipt_number', v_receipt_number,
        'member_id', p_member_id,
        'subscription_id', p_subscription_id,
        'amount_paid', p_amount,
        'remaining_balance', v_sub.balance - p_amount,
        'payment_status', CASE WHEN (v_sub.balance - p_amount) = 0.00 THEN 'paid' ELSE 'partial' END
    );

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'record_dues_payment', p_idempotency_key, v_payload_hash, v_response)
    ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING;

    RETURN v_response;
END;
$$;

-- 5.5 record_pt_dues_payment RPC (20261102010000)
CREATE OR REPLACE FUNCTION public.record_pt_dues_payment(
    p_assignment_id uuid,
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
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can record PT dues payments.' USING ERRCODE = '42501';
    END IF;

    IF p_assignment_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Assignment ID is mandatory.' USING ERRCODE = '22023';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0.00 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Payment amount must be strictly greater than zero.' USING ERRCODE = '22003';
    END IF;
    IF p_payment_method NOT IN ('Cash', 'UPI', 'Card') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Payment method must be Cash, UPI, or Card.' USING ERRCODE = '22023';
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Idempotency key is required.' USING ERRCODE = '22023';
    END IF;

    v_canonical_payload := jsonb_build_object(
        'assignment_id', p_assignment_id,
        'amount', to_char(p_amount, 'FM999999990.00'),
        'payment_method', p_payment_method
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
        IF v_cached_hash IS DISTINCT FROM v_payload_hash THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: A divergent request already used this idempotency key.' USING ERRCODE = '23505';
        END IF;
        RETURN v_cached_response;
    END IF;

    SELECT * INTO v_pt
    FROM public.pt_assignments
    WHERE id = p_assignment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND: PT assignment record not found.' USING ERRCODE = 'P0002';
    END IF;

    IF p_amount > v_pt.balance THEN
        RAISE EXCEPTION 'ERR_OVERPAYMENT_EXCEEDS_BALANCE: Payment amount (%) exceeds outstanding PT balance (%).',
            p_amount, v_pt.balance USING ERRCODE = '22003';
    END IF;

    v_receipt_number := public.generate_receipt_number();

    INSERT INTO public.payments (
        receipt_number, member_id, pt_assignment_id, transaction_type,
        amount, payment_method, status, notes, actor_id
    ) VALUES (
        v_receipt_number, v_pt.member_id, p_assignment_id, 'payment',
        p_amount, p_payment_method, 'completed', NULLIF(trim(p_notes), ''), v_actor_id
    ) RETURNING id INTO v_payment_id;

    v_response := jsonb_build_object(
        'payment_id', v_payment_id,
        'receipt_number', v_receipt_number,
        'assignment_id', p_assignment_id,
        'member_id', v_pt.member_id,
        'amount_paid', p_amount,
        'remaining_balance', v_pt.balance - p_amount
    );

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'record_pt_dues_payment', p_idempotency_key, v_payload_hash, v_response)
    ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING;

    RETURN v_response;
END;
$$;

-- 5.6 get_staff_operational_summary RPC (20261102050000)
CREATE OR REPLACE FUNCTION public.get_staff_operational_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_active_members_count integer;
    v_today_checkins_count integer;
    v_pt_sessions_month integer;
    v_expiring_soon_count integer;
    v_today date := (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
    IF NOT public.is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: Access restricted to authorized active personnel.' USING ERRCODE = '42501';
    END IF;

    SELECT count(*) INTO v_active_members_count
    FROM public.members
    WHERE is_archived = false;

    SELECT count(*) INTO v_today_checkins_count
    FROM public.checkins
    WHERE (checked_in_at AT TIME ZONE 'Asia/Kolkata')::date = v_today;

    SELECT count(*) INTO v_pt_sessions_month
    FROM public.pt_sessions
    WHERE conducted_at >= (date_trunc('month', v_today::timestamp) AT TIME ZONE 'Asia/Kolkata')
      AND conducted_at < ((date_trunc('month', v_today::timestamp) + interval '1 month') AT TIME ZONE 'Asia/Kolkata');

    SELECT count(*) INTO v_expiring_soon_count
    FROM public.member_subscriptions
    WHERE status = 'active'
      AND expiry_date BETWEEN v_today AND (v_today + interval '7 days')::date;

    RETURN jsonb_build_object(
        'active_members', v_active_members_count,
        'today_checkins', v_today_checkins_count,
        'pt_sessions_month', v_pt_sessions_month,
        'expiring_this_week', v_expiring_soon_count,
        'generated_at', statement_timestamp()
    );
END;
$$;

-- ============================================================================
-- 6. STAFF INVITATION LIFECYCLE & STATUS RPCS
-- ============================================================================

-- 6.1 can_accept_staff_invitation RPC
CREATE OR REPLACE FUNCTION public.can_accept_staff_invitation()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
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

-- 6.2 accept_staff_invitation RPC
CREATE OR REPLACE FUNCTION public.accept_staff_invitation()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_user_email TEXT;
    v_invitation RECORD;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to accept invitation.' USING ERRCODE = '42501';
    END IF;

    SELECT email INTO v_user_email
    FROM auth.users
    WHERE id = v_actor_id;

    IF v_user_email IS NULL THEN
        RAISE EXCEPTION 'USER_NOT_FOUND: Authenticated user record could not be found.' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_invitation
    FROM public.staff_invitations
    WHERE lower(trim(email)) = lower(trim(v_user_email))
      AND status = 'pending'
      AND expires_at > clock_timestamp()
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_invitation.id IS NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.staff_invitations
            WHERE lower(trim(email)) = lower(trim(v_user_email))
              AND status = 'accepted'
        ) THEN
            RETURN jsonb_build_object('success', true, 'message', 'Invitation already accepted.');
        END IF;

        RAISE EXCEPTION 'INVALID_INVITATION: No valid, unexpired pending invitation found for this account.' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = v_actor_id AND is_active = false AND deactivated_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN: Deactivated accounts cannot be reactivated via invitation.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.staff_invitations
    SET status = 'accepted',
        accepted_at = clock_timestamp(),
        auth_user_id = v_actor_id
    WHERE id = v_invitation.id;

    UPDATE public.profiles
    SET is_active = true,
        role = 'staff',
        deactivated_at = NULL,
        updated_at = clock_timestamp()
    WHERE id = v_actor_id;

    INSERT INTO public.security_audit_logs (actor_id, target_user_id, action, details)
    VALUES (
        v_actor_id,
        v_actor_id,
        'invitation_accepted',
        jsonb_build_object(
            'invitation_id', v_invitation.id,
            'email', v_user_email,
            'full_name', v_invitation.full_name,
            'invited_by', v_invitation.invited_by
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'invitation_id', v_invitation.id,
        'email', v_user_email,
        'full_name', v_invitation.full_name,
        'role', 'staff'
    );
END;
$$;

-- 6.3 create_staff_invitation RPC
CREATE OR REPLACE FUNCTION public.create_staff_invitation(
    p_email TEXT,
    p_full_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_norm_email TEXT := lower(trim(p_email));
    v_existing_profile RECORD;
    v_existing_invite RECORD;
    v_new_invite_id UUID;
    v_expires_at TIMESTAMPTZ := clock_timestamp() + interval '7 days';
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can create staff invitations.' USING ERRCODE = '42501';
    END IF;

    IF v_norm_email IS NULL OR v_norm_email = '' OR position('@' in v_norm_email) < 2 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: A valid email address is required.' USING ERRCODE = '22023';
    END IF;

    IF p_full_name IS NULL OR length(trim(p_full_name)) < 2 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Staff member full name is required (minimum 2 characters).' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_existing_profile
    FROM public.profiles
    WHERE lower(trim(email)) = v_norm_email;

    IF FOUND THEN
        IF v_existing_profile.is_active THEN
            RAISE EXCEPTION 'ALREADY_EXISTS: An active account with this email address already exists.' USING ERRCODE = '23505';
        ELSE
            RAISE EXCEPTION 'ACCOUNT_DEACTIVATED: An account with this email exists but is currently deactivated. Reactivate it from the staff roster instead.' USING ERRCODE = '22023';
        END IF;
    END IF;

    UPDATE public.staff_invitations
    SET status = 'expired'
    WHERE lower(trim(email)) = v_norm_email
      AND status = 'pending'
      AND expires_at <= clock_timestamp();

    SELECT * INTO v_existing_invite
    FROM public.staff_invitations
    WHERE lower(trim(email)) = v_norm_email
      AND status = 'pending'
      AND expires_at > clock_timestamp()
    FOR UPDATE;

    IF FOUND THEN
        RAISE EXCEPTION 'DUPLICATE_INVITATION: An active pending invitation for this email already exists.' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.staff_invitations (
        email, full_name, role, status, invited_by, expires_at
    ) VALUES (
        v_norm_email, trim(p_full_name), 'staff', 'pending', v_actor_id, v_expires_at
    ) RETURNING id INTO v_new_invite_id;

    RETURN jsonb_build_object(
        'id', v_new_invite_id,
        'email', v_norm_email,
        'full_name', trim(p_full_name),
        'role', 'staff',
        'status', 'pending',
        'expires_at', v_expires_at
    );
END;
$$;

-- 6.4 resend_staff_invitation RPC
CREATE OR REPLACE FUNCTION public.resend_staff_invitation(
    p_invitation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_invite RECORD;
    v_new_expires_at TIMESTAMPTZ := clock_timestamp() + interval '7 days';
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can resend invitations.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_invite
    FROM public.staff_invitations
    WHERE id = p_invitation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Invitation record not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_invite.status = 'accepted' THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Cannot resend an invitation that has already been accepted.' USING ERRCODE = '22023';
    END IF;

    IF v_invite.status = 'revoked' THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Cannot resend a revoked invitation. Create a new invitation instead.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.staff_invitations
    SET status = 'pending',
        expires_at = v_new_expires_at
    WHERE id = p_invitation_id;

    RETURN jsonb_build_object(
        'id', v_invite.id,
        'email', v_invite.email,
        'full_name', v_invite.full_name,
        'status', 'pending',
        'expires_at', v_new_expires_at
    );
END;
$$;

-- 6.5 revoke_staff_invitation RPC
CREATE OR REPLACE FUNCTION public.revoke_staff_invitation(
    p_invitation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_invite RECORD;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can revoke invitations.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_invite
    FROM public.staff_invitations
    WHERE id = p_invitation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Invitation record not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_invite.status = 'accepted' THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Cannot revoke an invitation that has already been accepted.' USING ERRCODE = '22023';
    END IF;

    IF v_invite.status = 'revoked' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Invitation is already revoked.');
    END IF;

    UPDATE public.staff_invitations
    SET status = 'revoked',
        revoked_at = clock_timestamp()
    WHERE id = p_invitation_id;

    INSERT INTO public.security_audit_logs (actor_id, target_user_id, action, details)
    VALUES (
        v_actor_id,
        v_invite.auth_user_id,
        'invitation_revoked',
        jsonb_build_object('invitation_id', v_invite.id, 'email', v_invite.email)
    );

    RETURN jsonb_build_object(
        'success', true,
        'invitation_id', v_invite.id,
        'email', v_invite.email,
        'status', 'revoked'
    );
END;
$$;

-- 6.6 admin_set_user_status RPC
CREATE OR REPLACE FUNCTION public.admin_set_user_status(
    p_user_id UUID,
    p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_target_profile RECORD;
    v_admin_count INT;
    v_actor_id UUID := auth.uid();
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can modify account status.' USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL OR p_is_active IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Target user ID and active status are required.' USING ERRCODE = '22023';
    END IF;

    IF p_user_id = v_actor_id AND NOT p_is_active THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Administrators cannot deactivate their own account.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_target_profile FROM public.profiles WHERE id = p_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROFILE_NOT_FOUND: Target user profile does not exist.' USING ERRCODE = 'P0002';
    END IF;

    IF v_target_profile.role = 'admin' AND NOT p_is_active THEN
        PERFORM 1 FROM public.profiles WHERE role = 'admin' AND is_active = true ORDER BY id FOR UPDATE;
        SELECT count(*) INTO v_admin_count FROM public.profiles WHERE role = 'admin' AND is_active = true AND id != p_user_id;
        IF v_admin_count < 1 THEN
            RAISE EXCEPTION 'INVALID_OPERATION: Cannot deactivate the last active administrator.' USING ERRCODE = '22023';
        END IF;
    END IF;

    UPDATE public.profiles
    SET is_active = p_is_active,
        deactivated_at = CASE WHEN p_is_active THEN NULL ELSE clock_timestamp() END,
        updated_at = clock_timestamp()
    WHERE id = p_user_id;

    IF NOT p_is_active THEN
        BEGIN
            DELETE FROM auth.sessions WHERE user_id = p_user_id;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;

    INSERT INTO public.security_audit_logs (actor_id, target_user_id, action, details)
    VALUES (
        v_actor_id, p_user_id,
        CASE WHEN p_is_active THEN 'account_reactivated' ELSE 'account_deactivated' END,
        jsonb_build_object(
            'previous_active', v_target_profile.is_active,
            'new_active', p_is_active,
            'target_role', v_target_profile.role,
            'target_email', v_target_profile.email
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_user_id,
        'is_active', p_is_active,
        'deactivated_at', CASE WHEN p_is_active THEN NULL ELSE clock_timestamp() END
    );
END;
$$;

-- 6.7 admin_set_user_role RPC
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
    p_user_id UUID,
    p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_target_profile RECORD;
    v_admin_count INT;
    v_actor_id UUID := auth.uid();
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can modify user roles.' USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL OR p_role IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Target user ID and role are required.' USING ERRCODE = '22023';
    END IF;

    IF p_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Role must be admin or staff.' USING ERRCODE = '22023';
    END IF;

    IF p_user_id = v_actor_id AND p_role = 'staff' THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Administrators cannot demote their own account.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_target_profile FROM public.profiles WHERE id = p_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROFILE_NOT_FOUND: Target user profile does not exist.' USING ERRCODE = 'P0002';
    END IF;

    IF v_target_profile.role = 'admin' AND p_role = 'staff' THEN
        PERFORM 1 FROM public.profiles WHERE role = 'admin' AND is_active = true ORDER BY id FOR UPDATE;
        SELECT count(*) INTO v_admin_count FROM public.profiles WHERE role = 'admin' AND is_active = true AND id != p_user_id;
        IF v_admin_count < 1 THEN
            RAISE EXCEPTION 'INVALID_OPERATION: Cannot demote the last active administrator.' USING ERRCODE = '22023';
        END IF;
    END IF;

    UPDATE public.profiles
    SET role = p_role,
        updated_at = clock_timestamp()
    WHERE id = p_user_id;

    INSERT INTO public.security_audit_logs (actor_id, target_user_id, action, details)
    VALUES (
        v_actor_id, p_user_id, 'role_changed',
        jsonb_build_object(
            'previous_role', v_target_profile.role,
            'new_role', p_role,
            'target_email', v_target_profile.email
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_user_id,
        'previous_role', v_target_profile.role,
        'new_role', p_role
    );
END;
$$;

-- 6.8 Triggers for Auth User Creation and Audit Logging
CREATE OR REPLACE FUNCTION public.fn_on_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_invitation RECORD;
    v_existing_profile RECORD;
BEGIN
    SELECT * INTO v_existing_profile FROM public.profiles WHERE id = NEW.id;
    IF FOUND THEN
        UPDATE public.profiles SET email = NEW.email, updated_at = clock_timestamp() WHERE id = NEW.id;
        RETURN NEW;
    END IF;

    SELECT * INTO v_invitation
    FROM public.staff_invitations
    WHERE lower(trim(email)) = lower(trim(NEW.email))
      AND status = 'pending'
      AND expires_at > clock_timestamp()
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_invitation.id IS NULL THEN
        RETURN NEW;
    END IF;

    UPDATE public.staff_invitations
    SET auth_user_id = NEW.id
    WHERE id = v_invitation.id AND status = 'pending';

    INSERT INTO public.profiles (
        id, email, full_name, role, is_active, invited_by
    ) VALUES (
        NEW.id, NEW.email, v_invitation.full_name, 'staff', false, v_invitation.invited_by
    ) ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_staff_invitation_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
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

DROP TRIGGER IF EXISTS trg_audit_staff_invitation_changes ON public.staff_invitations;
CREATE TRIGGER trg_audit_staff_invitation_changes
AFTER INSERT OR UPDATE OF status, expires_at ON public.staff_invitations
FOR EACH ROW EXECUTE FUNCTION public.audit_staff_invitation_changes();

-- ============================================================================
-- 7. ZERO-TRUST FINANCIAL MASKING VIEWS
-- ============================================================================

DROP VIEW IF EXISTS public.v_active_members RESTRICT;
CREATE OR REPLACE VIEW public.v_active_members WITH (security_invoker = false, security_barrier = true) AS
SELECT
    m.id,
    m.member_code,
    m.name,
    m.phone,
    m.email,
    m.gender,
    m.dob,
    m.address,
    m.emergency_contact,
    m.blood_group,
    m.medical_notes,
    m.notes,
    m.is_archived,
    m.created_at,
    s.id AS current_subscription_id,
    s.plan_id,
    s.plan_name,
    (CASE WHEN public.is_admin() THEN s.plan_price ELSE NULL END)::numeric(12, 2) AS plan_price,
    s.status AS subscription_status,
    s.start_date,
    s.expiry_date,
    (CASE WHEN public.is_admin() THEN s.total_liability ELSE NULL END)::numeric(12, 2) AS total_liability,
    (CASE WHEN public.is_admin() THEN s.amount_paid ELSE NULL END)::numeric(12, 2) AS amount_paid,
    (CASE WHEN public.is_admin() THEN s.balance ELSE NULL END)::numeric(12, 2) AS balance,
    CASE WHEN public.is_admin() THEN s.payment_status ELSE NULL END AS payment_status
FROM public.members m
LEFT JOIN LATERAL (
    SELECT *
    FROM public.member_subscriptions sub
    WHERE sub.member_id = m.id AND sub.status = 'active'
    ORDER BY sub.expiry_date DESC
    LIMIT 1
) s ON true
WHERE m.is_archived = false
  AND public.is_staff();

COMMENT ON VIEW public.v_active_members IS 'Active members directory view: excludes archived members, masks sensitive financial fields (plan_price, total_liability, amount_paid, balance, payment_status) for non-admin callers, and permits access only to authenticated active staff and administrators.';

DROP VIEW IF EXISTS public.v_notifications RESTRICT;
CREATE VIEW public.v_notifications
WITH (security_invoker = true)
AS
SELECT 
    n.id,
    n.member_id,
    n.subscription_id,
    m.member_code,
    m.name AS member_name,
    m.phone AS member_phone,
    COALESCE(s.plan_name, 'Membership Plan') AS plan_name,
    COALESCE(s.status, 'inactive') AS subscription_status,
    s.start_date,
    s.expiry_date,
    CASE WHEN public.is_admin() THEN COALESCE(s.balance, 0.00) ELSE NULL::numeric END AS current_balance,
    n.notification_type,
    n.title,
    n.message,
    CASE 
        WHEN COALESCE(n.target_date, s.expiry_date) IS NOT NULL THEN
            (COALESCE(n.target_date, s.expiry_date) - (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date)
        ELSE n.days_remaining
    END AS days_remaining,
    n.target_date,
    n.channel,
    n.status,
    n.read_at,
    n.read_by,
    n.created_at,
    n.updated_at,
    CASE 
        WHEN s.status = 'superseded' THEN true
        WHEN EXISTS (
            SELECT 1 FROM public.member_subscriptions newer_sub
            WHERE newer_sub.member_id = m.id
              AND newer_sub.status = 'active'
              AND newer_sub.expiry_date > s.expiry_date
        ) THEN true
        ELSE false
    END AS is_superseded,
    n.whatsapp_sent_at,
    n.whatsapp_sent_by,
    sent_staff.full_name AS whatsapp_sent_by_name
FROM public.notifications n
JOIN public.members m ON m.id = n.member_id
LEFT JOIN public.member_subscriptions s ON s.id = n.subscription_id
LEFT JOIN public.profiles sent_staff ON sent_staff.id = n.whatsapp_sent_by
WHERE m.is_archived = false;

-- ============================================================================
-- 8. RPC GRANTS & PRIVILEGES (TIGHTENED ANONYMOUS EXECUTION REVOCATION)
-- ============================================================================

-- Functions executed by authenticated only
REVOKE ALL ON FUNCTION public.is_staff_active() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff_active() TO authenticated;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;

REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;

REVOKE ALL ON FUNCTION public.complete_pt_session(uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_pt_session(uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.schedule_pt_session(uuid, date, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.schedule_pt_session(uuid, date, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_pt_scheduled_session(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_pt_scheduled_session(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_pt_scheduled_session(uuid, date, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_pt_scheduled_session(uuid, date, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.renew_member_subscription(uuid, uuid, date, boolean, numeric, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.renew_member_subscription(uuid, uuid, date, boolean, numeric, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_member_checkin(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_member_checkin(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_member_checkout(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_member_checkout(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_member_checkin(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_member_checkin(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.onboard_member(text, text, text, text, date, text, text, text, text, text, uuid, date, numeric, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.onboard_member(text, text, text, text, date, text, text, text, text, text, uuid, date, numeric, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_pt_package(uuid, uuid, uuid, date, numeric, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.assign_pt_package(uuid, uuid, uuid, date, numeric, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_dues_payment(uuid, uuid, numeric, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_dues_payment(uuid, uuid, numeric, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_pt_dues_payment(uuid, numeric, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_pt_dues_payment(uuid, numeric, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_pt_dues_payment(uuid, uuid, numeric, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_pt_dues_payment(uuid, uuid, numeric, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_staff_operational_summary() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_staff_operational_summary() TO authenticated;

REVOKE ALL ON FUNCTION public.can_accept_staff_invitation() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_accept_staff_invitation() TO authenticated;

REVOKE ALL ON FUNCTION public.accept_staff_invitation() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.accept_staff_invitation() TO authenticated;

REVOKE ALL ON FUNCTION public.create_staff_invitation(text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_staff_invitation(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.resend_staff_invitation(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resend_staff_invitation(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_staff_invitation(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_staff_invitation(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_user_status(uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_status(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.audit_staff_invitation_changes() FROM PUBLIC, anon, authenticated, service_role;

-- Revoke trigger functions from all direct callers (invoked strictly via triggers)
REVOKE ALL ON FUNCTION
    public.fn_on_auth_user_created(),
    public.fn_sync_payment_balances(),
    public.fn_prevent_tamper_payment_records()
FROM PUBLIC, anon, authenticated, service_role;

-- Revoke internal helpers from authenticated
REVOKE EXECUTE ON FUNCTION public.hash_payload(jsonb), public.generate_member_code(),
    public.generate_receipt_number(), public.generate_checkin_code() FROM authenticated;

-- View grants
GRANT SELECT ON public.v_active_members TO authenticated;
GRANT SELECT ON public.v_notifications TO authenticated;
GRANT SELECT ON public.v_staff_roster TO authenticated;

-- Ensure all public SECURITY DEFINER functions have strict immutable search paths
DO $harden_search_paths$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS func_sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef = true
    LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public, extensions, pg_temp', r.func_sig);
    END LOOP;
END;
$harden_search_paths$;

-- ============================================================================
-- 9. SYNCHRONIZE SCHEMA MIGRATIONS LEDGER (ALL 13 APPLIED VERSIONS)
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS supabase_migrations;

CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
    version text PRIMARY KEY,
    statements text[],
    name text
);

-- Fail immediately if any existing ledger record has conflicting metadata
DO $verify_no_ledger_conflict$
DECLARE
    v_conflict text;
BEGIN
    SELECT 'Version ' || m.version || ' conflicting name: existing [' || COALESCE(m.name, 'NULL') || '] vs expected [' || exp.name || ']'
    INTO v_conflict
    FROM supabase_migrations.schema_migrations m
    JOIN (VALUES
        ('20261022160000', 'calculate_dynamic_days_remaining_in_v_notifications'),
        ('20261101000000', 'phase1_gym_info_missing_columns'),
        ('20261102000001', 'phase3_pt_packages_validity'),
        ('20261102000002', 'phase4_reminder_settings_and_triggers'),
        ('20261102000003', 'phase5_staff_security_and_invitations'),
        ('20261102010000', 'phase5_security_audit_remediation'),
        ('20261102020000', 'phase5_policy_cleanup'),
        ('20261102030000', 'phase5_followup_view_security'),
        ('20261102040000', 'phase5_active_role_operational_rpcs'),
        ('20261102050000', 'phase5_staff_summary_schema_fix'),
        ('20261107000000', 'fix_renew_member_subscription_status'),
        ('20261107120000', 'fix_record_member_checkin_renewal_validation'),
        ('20261107140000', 'pt_session_scheduling_and_lifecycle')
    ) AS exp(ver, name) ON m.version = exp.ver
    WHERE m.name IS DISTINCT FROM exp.name
    LIMIT 1;

    IF v_conflict IS NOT NULL THEN
        RAISE EXCEPTION 'MIGRATION_LEDGER_CONFLICT: %', v_conflict;
    END IF;
END;
$verify_no_ledger_conflict$;

INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
SELECT exp.ver, NULL, exp.name
FROM (VALUES
    ('20261022160000', 'calculate_dynamic_days_remaining_in_v_notifications'),
    ('20261101000000', 'phase1_gym_info_missing_columns'),
    ('20261102000001', 'phase3_pt_packages_validity'),
    ('20261102000002', 'phase4_reminder_settings_and_triggers'),
    ('20261102000003', 'phase5_staff_security_and_invitations'),
    ('20261102010000', 'phase5_security_audit_remediation'),
    ('20261102020000', 'phase5_policy_cleanup'),
    ('20261102030000', 'phase5_followup_view_security'),
    ('20261102040000', 'phase5_active_role_operational_rpcs'),
    ('20261102050000', 'phase5_staff_summary_schema_fix'),
    ('20261107000000', 'fix_renew_member_subscription_status'),
    ('20261107120000', 'fix_record_member_checkin_renewal_validation'),
    ('20261107140000', 'pt_session_scheduling_and_lifecycle')
) AS exp(ver, name)
WHERE NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version = exp.ver
);

-- ============================================================================
-- 10. POSTFLIGHT INTEGRITY ASSERTIONS (8 COMPREHENSIVE SUITES)
-- ============================================================================
DO $postflight$
DECLARE
    v_sig text;
    v_count integer;
    v_rls_count integer;
    v_ledger_count integer;
    v_valid boolean;
    v_unique boolean;
    v_pred text;
    v_funcs text[] := ARRAY[
        'complete_pt_session', 'renew_member_subscription', 'record_member_checkin',
        'record_member_checkout', 'record_dues_payment', 'get_user_role',
        'is_staff_active', 'is_admin', 'is_staff'
    ];
    v_func text;
BEGIN
    -- 1. Exact critical function overload counts (= 1) and canonical signatures
    FOREACH v_func IN ARRAY v_funcs LOOP
        SELECT count(*) INTO v_count
        FROM pg_proc WHERE proname = v_func AND pronamespace = 'public'::regnamespace;
        IF v_count <> 1 THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: Expected exactly 1 % function, found %', v_func, v_count;
        END IF;
    END LOOP;

    SELECT pg_get_function_identity_arguments(oid) INTO v_sig
    FROM pg_proc WHERE proname = 'complete_pt_session' AND pronamespace = 'public'::regnamespace;
    IF v_sig IS NULL OR v_sig <> 'p_assignment_id uuid, p_notes text, p_scheduled_session_id uuid' THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: complete_pt_session exact signature mismatch: expected "p_assignment_id uuid, p_notes text, p_scheduled_session_id uuid", got "%"', v_sig;
    END IF;

    SELECT pg_get_function_identity_arguments(oid) INTO v_sig
    FROM pg_proc WHERE proname = 'renew_member_subscription' AND pronamespace = 'public'::regnamespace;
    IF v_sig IS NULL OR v_sig <> 'p_member_id uuid, p_plan_id uuid, p_start_date date, p_carry_forward_balance boolean, p_payment_amount numeric, p_payment_method text, p_idempotency_key text' THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: renew_member_subscription signature mismatch: %', v_sig;
    END IF;

    SELECT pg_get_function_identity_arguments(oid) INTO v_sig
    FROM pg_proc WHERE proname = 'record_member_checkin' AND pronamespace = 'public'::regnamespace;
    IF v_sig IS NULL OR v_sig <> 'p_member_id uuid, p_notes text' THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: record_member_checkin signature mismatch: %', v_sig;
    END IF;

    SELECT pg_get_function_identity_arguments(oid) INTO v_sig
    FROM pg_proc WHERE proname = 'record_member_checkout' AND pronamespace = 'public'::regnamespace;
    IF v_sig IS NULL OR v_sig <> 'p_checkin_id uuid, p_notes text' THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: record_member_checkout signature mismatch: %', v_sig;
    END IF;

    SELECT pg_get_function_identity_arguments(oid) INTO v_sig
    FROM pg_proc WHERE proname = 'record_dues_payment' AND pronamespace = 'public'::regnamespace;
    IF v_sig IS NULL OR v_sig <> 'p_member_id uuid, p_subscription_id uuid, p_amount numeric, p_payment_method text, p_notes text, p_idempotency_key text' THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: record_dues_payment signature mismatch: %', v_sig;
    END IF;

    SELECT pg_get_function_identity_arguments(oid) INTO v_sig
    FROM pg_proc WHERE proname = 'get_user_role' AND pronamespace = 'public'::regnamespace;
    IF v_sig IS NULL OR v_sig <> '' THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: get_user_role must take no arguments, got: %', v_sig;
    END IF;

    SELECT pg_get_function_identity_arguments(oid) INTO v_sig
    FROM pg_proc WHERE proname = 'is_staff_active' AND pronamespace = 'public'::regnamespace;
    IF v_sig IS NULL OR v_sig <> '' THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: is_staff_active must take no arguments, got: %', v_sig;
    END IF;

    SELECT pg_get_function_identity_arguments(oid) INTO v_sig
    FROM pg_proc WHERE proname = 'is_admin' AND pronamespace = 'public'::regnamespace;
    IF v_sig IS NULL OR v_sig <> '' THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: is_admin must take no arguments, got: %', v_sig;
    END IF;

    SELECT pg_get_function_identity_arguments(oid) INTO v_sig
    FROM pg_proc WHERE proname = 'is_staff' AND pronamespace = 'public'::regnamespace;
    IF v_sig IS NULL OR v_sig <> '' THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: is_staff must take no arguments, got: %', v_sig;
    END IF;

    -- 2. SECURITY DEFINER mode & immutable fixed search path on all public security functions
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef 
          AND (p.proconfig IS NULL OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, extensions, pg_temp'])
    ) THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: Found SECURITY DEFINER function in public with missing or mutable search_path.';
    END IF;

    -- 3. Exact unique-index definitions, validity, readiness, and predicates (Hardened Fail-Closed)
    DECLARE
        v_idx RECORD;
    BEGIN
        -- 3.1 Verify uq_checkins_active_member
        SELECT
            c.relname AS index_name,
            t.relname AS table_name,
            i.indisunique AS is_unique,
            i.indisvalid AS is_valid,
            i.indisready AS is_ready,
            (
                SELECT array_agg(a.attname::text ORDER BY array_position(i.indkey, a.attnum))
                FROM pg_attribute a
                WHERE a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            ) AS indexed_columns,
            pg_get_expr(i.indpred, i.indrelid) AS predicate
        INTO v_idx
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'uq_checkins_active_member';

        IF v_idx.index_name IS NULL THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: Required unique index public.uq_checkins_active_member does not exist.';
        END IF;
        IF v_idx.table_name IS DISTINCT FROM 'checkins' THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_checkins_active_member belongs to unexpected table %, expected checkins', v_idx.table_name;
        END IF;
        IF v_idx.is_unique IS NOT TRUE THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_checkins_active_member is not unique.';
        END IF;
        IF v_idx.is_valid IS NOT TRUE THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_checkins_active_member is not valid.';
        END IF;
        IF v_idx.is_ready IS NOT TRUE THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_checkins_active_member is not ready.';
        END IF;
        IF v_idx.indexed_columns IS DISTINCT FROM ARRAY['member_id']::text[] THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_checkins_active_member indexed columns mismatch: %, expected {member_id}', v_idx.indexed_columns;
        END IF;
        IF v_idx.predicate IS DISTINCT FROM '((checked_out_at IS NULL) AND (status = ''checked_in''::text))' THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_checkins_active_member predicate mismatch: %', v_idx.predicate;
        END IF;

        -- 3.2 Verify uq_member_active_subscription
        SELECT
            c.relname AS index_name,
            t.relname AS table_name,
            i.indisunique AS is_unique,
            i.indisvalid AS is_valid,
            i.indisready AS is_ready,
            (
                SELECT array_agg(a.attname::text ORDER BY array_position(i.indkey, a.attnum))
                FROM pg_attribute a
                WHERE a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            ) AS indexed_columns,
            pg_get_expr(i.indpred, i.indrelid) AS predicate
        INTO v_idx
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'uq_member_active_subscription';

        IF v_idx.index_name IS NULL THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: Required unique index public.uq_member_active_subscription does not exist.';
        END IF;
        IF v_idx.table_name IS DISTINCT FROM 'member_subscriptions' THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_member_active_subscription belongs to unexpected table %, expected member_subscriptions', v_idx.table_name;
        END IF;
        IF v_idx.is_unique IS NOT TRUE THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_member_active_subscription is not unique.';
        END IF;
        IF v_idx.is_valid IS NOT TRUE THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_member_active_subscription is not valid.';
        END IF;
        IF v_idx.is_ready IS NOT TRUE THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_member_active_subscription is not ready.';
        END IF;
        IF v_idx.indexed_columns IS DISTINCT FROM ARRAY['member_id']::text[] THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_member_active_subscription indexed columns mismatch: %, expected {member_id}', v_idx.indexed_columns;
        END IF;
        IF v_idx.predicate IS DISTINCT FROM '(status = ''active''::text)' THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_member_active_subscription predicate mismatch: %', v_idx.predicate;
        END IF;

        -- 3.3 Verify uq_pt_scheduled_assignment_slot
        SELECT
            c.relname AS index_name,
            t.relname AS table_name,
            i.indisunique AS is_unique,
            i.indisvalid AS is_valid,
            i.indisready AS is_ready,
            (
                SELECT array_agg(a.attname::text ORDER BY array_position(i.indkey, a.attnum))
                FROM pg_attribute a
                WHERE a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            ) AS indexed_columns,
            pg_get_expr(i.indpred, i.indrelid) AS predicate
        INTO v_idx
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'uq_pt_scheduled_assignment_slot';

        IF v_idx.index_name IS NULL THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: Required unique index public.uq_pt_scheduled_assignment_slot does not exist.';
        END IF;
        IF v_idx.table_name IS DISTINCT FROM 'pt_scheduled_sessions' THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_pt_scheduled_assignment_slot belongs to unexpected table %, expected pt_scheduled_sessions', v_idx.table_name;
        END IF;
        IF v_idx.is_unique IS NOT TRUE THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_pt_scheduled_assignment_slot is not unique.';
        END IF;
        IF v_idx.is_valid IS NOT TRUE THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_pt_scheduled_assignment_slot is not valid.';
        END IF;
        IF v_idx.is_ready IS NOT TRUE THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_pt_scheduled_assignment_slot is not ready.';
        END IF;
        IF v_idx.indexed_columns IS DISTINCT FROM ARRAY['assignment_id','session_date','session_time']::text[] THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_pt_scheduled_assignment_slot indexed columns mismatch: %, expected {assignment_id,session_date,session_time}', v_idx.indexed_columns;
        END IF;
        IF v_idx.predicate IS DISTINCT FROM '(status = ''scheduled''::text)' THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: uq_pt_scheduled_assignment_slot predicate mismatch: %', v_idx.predicate;
        END IF;
    END;

    -- 4. RLS enabled on 13 core tables, exact policy verification
    DECLARE
        v_missing_tbl text;
        v_missing_pol text;
        v_unexpected_pol text;
        v_mismatched_pol text;
        v_total_pol_count integer;
    BEGIN
        -- 4.1 Verify RLS is enabled on all 13 core tables
        SELECT t.tablename INTO v_missing_tbl
        FROM unnest(ARRAY[
            'members','member_subscriptions','payments','checkins','pt_packages',
            'pt_assignments','pt_sessions','pt_scheduled_sessions','member_followups',
            'reminder_settings','staff_invitations','security_audit_logs','gym_info'
        ]::text[]) AS t(tablename)
        LEFT JOIN pg_tables pt ON pt.schemaname = 'public' AND pt.tablename = t.tablename AND pt.rowsecurity = true
        WHERE pt.tablename IS NULL
        LIMIT 1;

        IF v_missing_tbl IS NOT NULL THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: Table public.% does not have RLS enabled.', v_missing_tbl;
        END IF;

        -- 4.2 Verify zero policies grant access to anon or public
        SELECT p.tablename || '.' || p.policyname INTO v_unexpected_pol
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename IN (
              'members','member_subscriptions','payments','checkins','pt_packages',
              'pt_assignments','pt_sessions','pt_scheduled_sessions','member_followups',
              'reminder_settings','staff_invitations','security_audit_logs','gym_info'
          )
          AND (p.roles && ARRAY['anon'::name, 'public'::name])
        LIMIT 1;

        IF v_unexpected_pol IS NOT NULL THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: Policy % grants access to anon or public.', v_unexpected_pol;
        END IF;

        -- 4.3 Verify total policy count equals exactly 22
        SELECT count(*) INTO v_total_pol_count
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename IN (
              'members','member_subscriptions','payments','checkins','pt_packages',
              'pt_assignments','pt_sessions','pt_scheduled_sessions','member_followups',
              'reminder_settings','staff_invitations','security_audit_logs','gym_info'
          );

        IF v_total_pol_count <> 22 THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: Expected exactly 22 policies across the 13 tables, found %', v_total_pol_count;
        END IF;

        -- 4.4 Create temporary table with expected catalog
        CREATE TEMPORARY TABLE exp_policies (
            tablename text,
            policyname text,
            permissive text,
            roles text[],
            cmd text,
            qual text,
            with_check text
        ) ON COMMIT DROP;

        INSERT INTO exp_policies (tablename, policyname, permissive, roles, cmd, qual, with_check) VALUES
            ('checkins', 'checkins_insert', 'PERMISSIVE', ARRAY['authenticated'], 'INSERT', NULL, 'is_staff()'),
            ('checkins', 'checkins_select', 'PERMISSIVE', ARRAY['authenticated'], 'SELECT', 'is_staff()', NULL),
            ('gym_info', 'gym_info_admin', 'PERMISSIVE', ARRAY['authenticated'], 'ALL', 'is_admin()', 'is_admin()'),
            ('gym_info', 'gym_info_select', 'PERMISSIVE', ARRAY['authenticated'], 'SELECT', 'is_staff()', NULL),
            ('member_followups', 'member_followups_insert', 'PERMISSIVE', ARRAY['authenticated'], 'INSERT', NULL, '(get_user_role() = ANY (ARRAY[''admin''::text, ''staff''::text]))'),
            ('member_followups', 'member_followups_select', 'PERMISSIVE', ARRAY['authenticated'], 'SELECT', '(get_user_role() = ANY (ARRAY[''admin''::text, ''staff''::text]))', NULL),
            ('member_followups', 'member_followups_update', 'PERMISSIVE', ARRAY['authenticated'], 'UPDATE', '(get_user_role() = ANY (ARRAY[''admin''::text, ''staff''::text]))', NULL),
            ('member_subscriptions', 'subscriptions_select', 'PERMISSIVE', ARRAY['authenticated'], 'SELECT', 'is_admin()', NULL),
            ('members', 'members_admin_delete', 'PERMISSIVE', ARRAY['authenticated'], 'DELETE', 'is_admin()', NULL),
            ('members', 'members_select', 'PERMISSIVE', ARRAY['authenticated'], 'SELECT', 'is_staff()', NULL),
            ('members', 'members_update_staff', 'PERMISSIVE', ARRAY['authenticated'], 'UPDATE', '(is_staff() AND (is_archived = false))', 'is_staff()'),
            ('payments', 'payments_select', 'PERMISSIVE', ARRAY['authenticated'], 'SELECT', 'is_admin()', NULL),
            ('pt_assignments', 'pt_assignments_select', 'PERMISSIVE', ARRAY['authenticated'], 'SELECT', 'is_staff()', NULL),
            ('pt_assignments', 'pt_assignments_update_staff', 'PERMISSIVE', ARRAY['authenticated'], 'UPDATE', 'is_staff()', 'is_staff()'),
            ('pt_packages', 'packages_admin', 'PERMISSIVE', ARRAY['authenticated'], 'ALL', 'is_admin()', 'is_admin()'),
            ('pt_packages', 'pt_packages_select_all', 'PERMISSIVE', ARRAY['authenticated'], 'SELECT', 'is_staff()', NULL),
            ('pt_scheduled_sessions', 'pt_scheduled_sessions_staff_select', 'PERMISSIVE', ARRAY['authenticated'], 'SELECT', 'is_staff()', NULL),
            ('pt_sessions', 'pt_sessions_select', 'PERMISSIVE', ARRAY['authenticated'], 'SELECT', 'is_staff()', NULL),
            ('reminder_settings', 'reminder_settings_select', 'PERMISSIVE', ARRAY['authenticated'], 'SELECT', 'is_staff()', NULL),
            ('reminder_settings', 'reminder_settings_update', 'PERMISSIVE', ARRAY['authenticated'], 'ALL', 'is_admin()', NULL),
            ('security_audit_logs', 'security_audit_logs_select_admin', 'PERMISSIVE', ARRAY['authenticated'], 'SELECT', 'is_admin()', NULL),
            ('staff_invitations', 'staff_invitations_admin_all', 'PERMISSIVE', ARRAY['authenticated'], 'ALL', 'is_admin()', NULL);

        -- Check for missing expected policies
        SELECT ep.tablename || '.' || ep.policyname INTO v_missing_pol
        FROM exp_policies ep
        LEFT JOIN pg_policies p ON p.schemaname = 'public'
                               AND p.tablename = ep.tablename
                               AND p.policyname = ep.policyname
        WHERE p.policyname IS NULL
        LIMIT 1;

        IF v_missing_pol IS NOT NULL THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: Missing expected policy %', v_missing_pol;
        END IF;

        -- Check for unexpected policies on these 13 tables
        SELECT p.tablename || '.' || p.policyname INTO v_unexpected_pol
        FROM pg_policies p
        LEFT JOIN exp_policies ep ON ep.tablename = p.tablename AND ep.policyname = p.policyname
        WHERE p.schemaname = 'public'
          AND p.tablename IN (
              'members','member_subscriptions','payments','checkins','pt_packages',
              'pt_assignments','pt_sessions','pt_scheduled_sessions','member_followups',
              'reminder_settings','staff_invitations','security_audit_logs','gym_info'
          )
          AND ep.policyname IS NULL
        LIMIT 1;

        IF v_unexpected_pol IS NOT NULL THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: Unexpected policy % found on core table', v_unexpected_pol;
        END IF;

        -- Check for mismatched definition (roles, cmd, qual, with_check)
        SELECT ep.tablename || '.' || ep.policyname || ' mismatch (cmd: ' || p.cmd || ' vs ' || ep.cmd || ', permissive: ' || p.permissive || ' vs ' || ep.permissive || ')' INTO v_mismatched_pol
        FROM exp_policies ep
        JOIN pg_policies p ON p.schemaname = 'public'
                          AND p.tablename = ep.tablename
                          AND p.policyname = ep.policyname
        WHERE p.permissive IS DISTINCT FROM ep.permissive
           OR p.roles::text[] IS DISTINCT FROM ep.roles
           OR p.cmd IS DISTINCT FROM ep.cmd
           OR p.qual IS DISTINCT FROM ep.qual
           OR p.with_check IS DISTINCT FROM ep.with_check
        LIMIT 1;

        IF v_mismatched_pol IS NOT NULL THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: Policy definition mismatch: %', v_mismatched_pol;
        END IF;

        DROP TABLE exp_policies;
    END;

    -- 5. Required function grants and revocations
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ) THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: Found SECURITY DEFINER function in public with anonymous EXECUTE privilege.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' 
          AND p.proname IN ('fn_on_auth_user_created','fn_sync_payment_balances','fn_prevent_tamper_payment_records','audit_staff_invitation_changes')
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: Sensitive internal trigger function has authenticated EXECUTE privilege.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'get_user_role','is_admin','is_staff','can_accept_staff_invitation','create_staff_invitation',
              'resend_staff_invitation','revoke_staff_invitation','accept_staff_invitation','admin_set_user_status',
              'admin_set_user_role','record_dues_payment','record_pt_dues_payment','renew_member_subscription',
              'onboard_member','assign_pt_package','get_staff_operational_summary','record_member_checkin',
              'record_member_checkout','cancel_member_checkin','complete_pt_session'
          )
          AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE'))
    ) THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: Found operational RPC callable by anon or service_role.';
    END IF;

    -- 6. View security options
    IF NOT (SELECT reloptions @> ARRAY['security_invoker=false','security_barrier=true'] FROM pg_class WHERE oid = 'public.v_active_members'::regclass) THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: v_active_members must have security_invoker=false and security_barrier=true.';
    END IF;

    IF NOT (SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid = 'public.v_notifications'::regclass) THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: v_notifications must have security_invoker=true.';
    END IF;

    IF NOT (SELECT reloptions @> ARRAY['security_invoker=false','security_barrier=true'] FROM pg_class WHERE oid = 'public.v_staff_roster'::regclass) THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: v_staff_roster must have security_invoker=false and security_barrier=true.';
    END IF;

    -- 7. Essential anti-tamper & audit triggers
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_tamper_payment_records' AND tgrelid = 'public.payments'::regclass AND tgenabled = 'O') THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: trg_prevent_tamper_payment_records trigger missing or disabled on public.payments.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_staff_invitation_changes' AND tgrelid = 'public.staff_invitations'::regclass AND tgenabled = 'O') THEN
        RAISE EXCEPTION 'POSTFLIGHT_FAILED: trg_audit_staff_invitation_changes trigger missing or disabled on public.staff_invitations.';
    END IF;

    -- 8. Migration ledger consistency & individual metadata verification (Hardened Fail-Closed)
    DECLARE
        v_missing_ver text;
        v_mismatched_meta text;
        v_duplicate_ver text;
    BEGIN
        -- 8.1 Check for duplicate versions in ledger
        SELECT version INTO v_duplicate_ver
        FROM supabase_migrations.schema_migrations
        GROUP BY version
        HAVING count(*) > 1
        LIMIT 1;

        IF v_duplicate_ver IS NOT NULL THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: Duplicate migration ledger entry detected for version %', v_duplicate_ver;
        END IF;

        -- 8.2 Verify each of the 13 required migration versions individually
        CREATE TEMPORARY TABLE exp_migrations (
            version text PRIMARY KEY,
            name text
        ) ON COMMIT DROP;

        INSERT INTO exp_migrations (version, name) VALUES
            ('20261022160000', 'calculate_dynamic_days_remaining_in_v_notifications'),
            ('20261101000000', 'phase1_gym_info_missing_columns'),
            ('20261102000001', 'phase3_pt_packages_validity'),
            ('20261102000002', 'phase4_reminder_settings_and_triggers'),
            ('20261102000003', 'phase5_staff_security_and_invitations'),
            ('20261102010000', 'phase5_security_audit_remediation'),
            ('20261102020000', 'phase5_policy_cleanup'),
            ('20261102030000', 'phase5_followup_view_security'),
            ('20261102040000', 'phase5_active_role_operational_rpcs'),
            ('20261102050000', 'phase5_staff_summary_schema_fix'),
            ('20261107000000', 'fix_renew_member_subscription_status'),
            ('20261107120000', 'fix_record_member_checkin_renewal_validation'),
            ('20261107140000', 'pt_session_scheduling_and_lifecycle');

        -- Verify no expected version is missing
        SELECT em.version INTO v_missing_ver
        FROM exp_migrations em
        LEFT JOIN supabase_migrations.schema_migrations sm ON sm.version = em.version
        WHERE sm.version IS NULL
        LIMIT 1;

        IF v_missing_ver IS NOT NULL THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: Migration version % is missing from schema_migrations.', v_missing_ver;
        END IF;

        -- Verify metadata (name) for each version matches expected
        SELECT 'Version ' || em.version || ' metadata mismatch: expected [' || em.name || '], found [' || COALESCE(sm.name, 'NULL') || ']'
        INTO v_mismatched_meta
        FROM exp_migrations em
        JOIN supabase_migrations.schema_migrations sm ON sm.version = em.version
        WHERE sm.name IS DISTINCT FROM em.name
        LIMIT 1;

        IF v_mismatched_meta IS NOT NULL THEN
            RAISE EXCEPTION 'POSTFLIGHT_FAILED: %', v_mismatched_meta;
        END IF;

        DROP TABLE exp_migrations;
    END;

    RAISE NOTICE 'POSTFLIGHT_VERIFICATION_SUCCESS: All 8 integrity suites passed.';
END;
$postflight$;

COMMIT;
