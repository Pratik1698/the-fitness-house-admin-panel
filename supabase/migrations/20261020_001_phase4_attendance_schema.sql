-- ============================================================================
-- THE FITNESS HOUSE — GYM MANAGEMENT ADMIN PANEL
-- MIGRATION: 20261020_001_phase4_attendance_schema.sql
-- STAGE: Phase 4 — Persistent Attendance & Check-in Management
-- ============================================================================
-- Engine Compatibility: PostgreSQL 15+ / Supabase
-- Execution Mode: Single Atomic Transaction
-- Re-run Safety: Idempotent (Safe for initial run and repeat execution)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. SEQUENCES & IDENTIFIERS
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.checkin_code_seq START WITH 10001 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION public.generate_checkin_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN 'CHK-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' || lpad(nextval('public.checkin_code_seq')::text, 5, '0');
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. ATTENDANCE MASTER TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checkins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checkin_code text NOT NULL UNIQUE,
    member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    checked_in_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    checked_out_at timestamptz,
    status text NOT NULL CHECK (status IN ('checked_in', 'checked_out', 'cancelled')) DEFAULT 'checked_in',
    notes text,
    actor_id uuid NOT NULL REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_checkin_checkout_order CHECK (checked_out_at IS NULL OR checked_out_at >= checked_in_at)
);

-- ----------------------------------------------------------------------------
-- 3. INDEXES FOR PERFORMANCE, AUDIT & CONCURRENCY
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_checkins_member_id ON public.checkins(member_id);
CREATE INDEX IF NOT EXISTS idx_checkins_checked_in_at ON public.checkins(checked_in_at);
CREATE INDEX IF NOT EXISTS idx_checkins_actor_id ON public.checkins(actor_id);
CREATE INDEX IF NOT EXISTS idx_checkins_code ON public.checkins(checkin_code);

-- Strict Duplicate Prevention: At most ONE active (unclosed) check-in per member
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkins_active_member
ON public.checkins(member_id)
WHERE (checked_out_at IS NULL);

-- ----------------------------------------------------------------------------
-- 4. REPORTING VIEW
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_attendance_logs WITH (security_invoker = true) AS
SELECT 
    c.id,
    c.checkin_code,
    c.member_id,
    m.member_code,
    m.name AS member_name,
    m.phone AS member_phone,
    COALESCE(s.plan_name, 'General') AS plan_name,
    c.checked_in_at,
    c.checked_out_at,
    c.status,
    c.notes,
    c.actor_id,
    COALESCE(p.full_name, 'Staff') AS actor_name,
    c.created_at,
    c.updated_at
FROM public.checkins c
JOIN public.members m ON m.id = c.member_id
LEFT JOIN LATERAL (
    SELECT sub.plan_name
    FROM public.member_subscriptions sub
    WHERE sub.member_id = c.member_id
      AND sub.status = 'active'
    ORDER BY sub.expiry_date DESC
    LIMIT 1
) s ON true
LEFT JOIN public.profiles p ON p.id = c.actor_id;

-- ----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------
ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checkins_select" ON public.checkins;
CREATE POLICY "checkins_select" ON public.checkins
    FOR SELECT TO authenticated USING (true);

-- Revoke direct writes from non-admin / non-RPC contexts
REVOKE ALL ON public.checkins FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.checkins FROM authenticated;
GRANT SELECT ON public.checkins TO authenticated;
GRANT SELECT ON public.v_attendance_logs TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. AUTHORIZED BUSINESS TRANSACTIONS (RPCs)
-- ----------------------------------------------------------------------------

-- A. Record Member Check-in
CREATE OR REPLACE FUNCTION public.record_member_checkin(
    p_member_id uuid,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_member record;
    v_sub record;
    v_active_ci record;
    v_checkin_id uuid;
    v_checkin_code text;
    v_checked_in_at timestamptz;
BEGIN
    -- 1. Authentication Guard
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
    END IF;

    -- 2. Argument Guard
    IF p_member_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Member ID is mandatory.' USING ERRCODE = '22023';
    END IF;

    -- 3. Member Integrity Guard
    SELECT * INTO v_member
    FROM public.members
    WHERE id = p_member_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND: Member does not exist.' USING ERRCODE = 'P0002';
    END IF;

    IF v_member.is_archived THEN
        RAISE EXCEPTION 'MEMBER_ARCHIVED: Member % is archived. Archival must be reversed before logging attendance.',
            v_member.member_code USING ERRCODE = '22023';
    END IF;

    -- 4. Subscription & Expiry Validity Guard
    SELECT * INTO v_sub
    FROM public.member_subscriptions
    WHERE member_id = p_member_id
      AND status = 'active'
      AND start_date <= CURRENT_DATE
      AND expiry_date >= CURRENT_DATE
    ORDER BY expiry_date DESC
    LIMIT 1;

    IF NOT FOUND THEN
        SELECT * INTO v_sub
        FROM public.member_subscriptions
        WHERE member_id = p_member_id
        ORDER BY expiry_date DESC
        LIMIT 1;

        IF FOUND THEN
            RAISE EXCEPTION 'ERR_MEMBERSHIP_EXPIRED: Membership for % expired on %. Renewal required before check-in.',
                v_member.name, v_sub.expiry_date USING ERRCODE = '22023';
        ELSE
            RAISE EXCEPTION 'ERR_NO_ACTIVE_MEMBERSHIP: Member % has no active membership plan. Onboarding or plan renewal required.',
                v_member.name USING ERRCODE = '22023';
        END IF;
    END IF;

    -- 5. Duplicate Active Session Guard (Reject by default)
    SELECT * INTO v_active_ci
    FROM public.checkins
    WHERE member_id = p_member_id
      AND checked_out_at IS NULL;

    IF FOUND THEN
        RAISE EXCEPTION 'MEMBER_ALREADY_CHECKED_IN: % is already checked in (since %). Active session must be checked out first.',
            v_member.name, to_char(v_active_ci.checked_in_at, 'HH12:MI AM') USING ERRCODE = '23505';
    END IF;

    -- 6. Insert Verified Check-in
    v_checkin_code := public.generate_checkin_code();

    INSERT INTO public.checkins (
        checkin_code,
        member_id,
        checked_in_at,
        status,
        notes,
        actor_id
    ) VALUES (
        v_checkin_code,
        p_member_id,
        clock_timestamp(),
        'checked_in',
        NULLIF(trim(p_notes), ''),
        v_actor_id
    ) RETURNING id, checked_in_at INTO v_checkin_id, v_checked_in_at;

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

-- B. Record Member Check-out
CREATE OR REPLACE FUNCTION public.record_member_checkout(
    p_checkin_id uuid,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_ci record;
    v_now timestamptz := clock_timestamp();
    v_duration_min integer;
BEGIN
    -- 1. Authentication Guard
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
    END IF;

    -- 2. Argument Guard
    IF p_checkin_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Check-in ID is mandatory.' USING ERRCODE = '22023';
    END IF;

    -- 3. Lock Check-in Record
    SELECT * INTO v_ci
    FROM public.checkins
    WHERE id = p_checkin_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CHECKIN_NOT_FOUND: Check-in record % does not exist.', p_checkin_id USING ERRCODE = 'P0002';
    END IF;

    -- 4. State Validation
    IF v_ci.checked_out_at IS NOT NULL THEN
        RAISE EXCEPTION 'ALREADY_CHECKED_OUT: Check-in record % was already checked out at %.',
            v_ci.checkin_code, to_char(v_ci.checked_out_at, 'HH12:MI AM') USING ERRCODE = '22023';
    END IF;

    IF v_ci.status = 'cancelled' THEN
        RAISE EXCEPTION 'INVALID_CHECKIN_STATUS: Check-in record % has been cancelled.', v_ci.checkin_code USING ERRCODE = '22023';
    END IF;

    -- 5. Calculate Duration & Update
    v_duration_min := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_now - v_ci.checked_in_at)) / 60)::integer);

    UPDATE public.checkins
    SET checked_out_at = v_now,
        status = 'checked_out',
        notes = CASE 
            WHEN p_notes IS NOT NULL AND trim(p_notes) <> '' THEN 
                COALESCE(notes || ' | ' || trim(p_notes), trim(p_notes))
            ELSE notes 
        END,
        updated_at = v_now
    WHERE id = p_checkin_id;

    RETURN jsonb_build_object(
        'success', true,
        'checkin_id', v_ci.id,
        'checkin_code', v_ci.checkin_code,
        'member_id', v_ci.member_id,
        'checked_in_at', v_ci.checked_in_at,
        'checked_out_at', v_now,
        'duration_minutes', v_duration_min,
        'status', 'checked_out'
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. FUNCTION PRIVILEGES
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.generate_checkin_code() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_member_checkin(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_member_checkout(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.record_member_checkin(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_member_checkout(uuid, text) TO authenticated;

COMMIT;
