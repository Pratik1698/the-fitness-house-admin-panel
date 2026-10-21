-- ============================================================================
-- THE FITNESS HOUSE — GYM MANAGEMENT ADMIN PANEL
-- MIGRATION: 20261021_001_phase4_attendance_hardening.sql
-- STAGE: Phase 4 — Attendance Defect Fixes & Timezone Hardening
-- ============================================================================
-- Engine Compatibility: PostgreSQL 15+ / Supabase
-- Execution Mode: Single Atomic Transaction
-- Re-run Safety: Idempotent (Safe for initial run and repeat execution)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. HARDEN PARTIAL UNIQUE INDEX AGAINST CANCELLED RECORDS
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.uq_checkins_active_member;

CREATE UNIQUE INDEX IF NOT EXISTS uq_checkins_active_member
ON public.checkins(member_id)
WHERE (checked_out_at IS NULL AND status = 'checked_in');

-- ----------------------------------------------------------------------------
-- 2. HARDEN CODE GENERATOR WITH LOCAL TIMEZONE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_checkin_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN 'CHK-' || to_char(clock_timestamp() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD') || '-' || lpad(nextval('public.checkin_code_seq')::text, 5, '0');
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. HARDEN CHECK-IN RPC WITH LOCAL TIMEZONE & CANCELLED RECORD ISOLATION
-- ----------------------------------------------------------------------------
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
    v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
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

    -- 4. Subscription & Expiry Validity Guard (Evaluated against Indian gym calendar date)
    SELECT * INTO v_sub
    FROM public.member_subscriptions
    WHERE member_id = p_member_id
      AND status = 'active'
      AND start_date <= v_today
      AND expiry_date >= v_today
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

    -- 5. Duplicate Active Session Guard (Specifically matches status='checked_in', ignoring cancelled or closed visits)
    SELECT * INTO v_active_ci
    FROM public.checkins
    WHERE member_id = p_member_id
      AND status = 'checked_in'
      AND checked_out_at IS NULL;

    IF FOUND THEN
        RAISE EXCEPTION 'MEMBER_ALREADY_CHECKED_IN: % is already checked in (since %). Active session must be checked out first.',
            v_member.name, to_char(v_active_ci.checked_in_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') USING ERRCODE = '23505';
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

-- ----------------------------------------------------------------------------
-- 4. AUTHORIZED CANCEL CHECK-IN RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_member_checkin(
    p_checkin_id uuid,
    p_reason text DEFAULT NULL
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
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
    END IF;

    IF p_checkin_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Check-in ID is mandatory.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_ci
    FROM public.checkins
    WHERE id = p_checkin_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CHECKIN_NOT_FOUND: Check-in record % does not exist.', p_checkin_id USING ERRCODE = 'P0002';
    END IF;

    IF v_ci.status = 'cancelled' THEN
        RAISE EXCEPTION 'ALREADY_CANCELLED: Check-in record % has already been cancelled.', v_ci.checkin_code USING ERRCODE = '22023';
    END IF;

    IF v_ci.status = 'checked_out' OR v_ci.checked_out_at IS NOT NULL THEN
        RAISE EXCEPTION 'CANNOT_CANCEL_COMPLETED_VISIT: Cannot cancel completed check-in record %.', v_ci.checkin_code USING ERRCODE = '22023';
    END IF;

    UPDATE public.checkins
    SET status = 'cancelled',
        notes = CASE 
            WHEN p_reason IS NOT NULL AND trim(p_reason) <> '' THEN 
                COALESCE(notes || ' | Cancelled: ' || trim(p_reason), 'Cancelled: ' || trim(p_reason))
            ELSE notes 
        END,
        updated_at = v_now
    WHERE id = p_checkin_id;

    RETURN jsonb_build_object(
        'success', true,
        'checkin_id', v_ci.id,
        'checkin_code', v_ci.checkin_code,
        'member_id', v_ci.member_id,
        'status', 'cancelled'
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. FUNCTION PRIVILEGES
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.cancel_member_checkin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_member_checkin(uuid, text) TO authenticated;

COMMIT;
