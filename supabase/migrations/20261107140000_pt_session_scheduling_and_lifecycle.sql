-- ============================================================================
-- Migration: 20261107140000_pt_session_scheduling_and_lifecycle.sql
-- Description: Personal Training Session Scheduling, Lifecycle, and Persistence
--
-- Objective:
-- 1. Create public.pt_scheduled_sessions table for appointments and schedule tracking.
-- 2. Preserve public.pt_sessions as the authoritative completed sessions audit log.
-- 3. Provide atomic RPCs for scheduling, completing, cancelling, and editing sessions.
-- 4. Enforce business rules:
--    - Scheduling does NOT deduct session credits.
--    - Completing a session deducts exactly ONE session credit and logs to pt_sessions.
--    - Cancelling a session deducts ZERO session credits.
--    - Duplicate scheduling on identical slot is prevented.
--    - Completed sessions cannot be cancelled or re-completed.
--    - Cancelled sessions cannot be completed.
--    - Active staff authentication and search_path hardening enforced on all RPCs.
-- ============================================================================

-- 1. Sequence for human-readable sequential session codes (e.g. PTS001, PTS002)
CREATE SEQUENCE IF NOT EXISTS public.pt_session_code_seq START WITH 1;
GRANT USAGE, SELECT ON SEQUENCE public.pt_session_code_seq TO authenticated;

-- 2. Scheduled Sessions Table
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

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_pt_scheduled_sessions_assignment ON public.pt_scheduled_sessions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_pt_scheduled_sessions_member ON public.pt_scheduled_sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_pt_scheduled_sessions_trainer ON public.pt_scheduled_sessions(trainer_id);
CREATE INDEX IF NOT EXISTS idx_pt_scheduled_sessions_date ON public.pt_scheduled_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_pt_scheduled_sessions_status ON public.pt_scheduled_sessions(status);

-- Partial unique index: prevent double-booking the exact same slot for the same assignment while active
CREATE UNIQUE INDEX IF NOT EXISTS uq_pt_scheduled_assignment_slot
ON public.pt_scheduled_sessions (assignment_id, session_date, session_time)
WHERE (status = 'scheduled');

-- 4. Row Level Security
ALTER TABLE public.pt_scheduled_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view PT scheduled sessions" ON public.pt_scheduled_sessions;
CREATE POLICY "Staff can view PT scheduled sessions"
ON public.pt_scheduled_sessions
FOR SELECT
TO authenticated
USING (public.is_staff());

REVOKE ALL ON public.pt_scheduled_sessions FROM PUBLIC, anon, service_role;
GRANT SELECT ON public.pt_scheduled_sessions TO authenticated;

-- ============================================================================
-- 5. RPC: schedule_pt_session
-- Schedules a PT session appointment without deducting package credits.
-- ============================================================================
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
    -- Authorization guard
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: Active staff authentication required.' USING ERRCODE = '42501';
    END IF;

    -- Argument validation
    IF p_assignment_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Assignment ID is mandatory.' USING ERRCODE = '22023';
    END IF;
    IF p_session_date IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Session date is mandatory.' USING ERRCODE = '22023';
    END IF;
    IF v_time IS NULL OR v_time = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Session time slot is mandatory.' USING ERRCODE = '22023';
    END IF;

    -- Lock and verify assignment
    SELECT * INTO v_pt FROM public.pt_assignments WHERE id = p_assignment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND: PT assignment record not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_pt.status <> 'active' THEN
        RAISE EXCEPTION 'INVALID_STATUS: Sessions can only be scheduled for active PT packages.' USING ERRCODE = '22023';
    END IF;

    IF v_pt.completed_sessions >= v_pt.total_sessions THEN
        RAISE EXCEPTION 'SESSIONS_EXHAUSTED: All % package sessions have already been logged.',
            v_pt.total_sessions USING ERRCODE = '22003';
    END IF;

    IF p_session_date < v_pt.start_date THEN
        RAISE EXCEPTION 'INVALID_DATE: Session date (%) cannot be earlier than package start date (%).',
            p_session_date, v_pt.start_date USING ERRCODE = '22023';
    END IF;

    -- Prevent duplicate scheduled slot for this assignment
    IF EXISTS (
        SELECT 1 FROM public.pt_scheduled_sessions
        WHERE assignment_id = p_assignment_id
          AND session_date = p_session_date
          AND session_time = v_time
          AND status = 'scheduled'
    ) THEN
        RAISE EXCEPTION 'DUPLICATE_SESSION: A session for this client is already scheduled for % at %.',
            p_session_date, v_time USING ERRCODE = '23505';
    END IF;

    -- Generate sequential session code: PTS001, PTS002, ...
    v_session_code := 'PTS' || LPAD(nextval('public.pt_session_code_seq')::text, 3, '0');

    -- Insert scheduled session
    INSERT INTO public.pt_scheduled_sessions (
        session_code, assignment_id, member_id, trainer_id, session_date, session_time, notes, status, actor_id
    ) VALUES (
        v_session_code, p_assignment_id, v_pt.member_id, v_pt.trainer_id, p_session_date, v_time, NULLIF(trim(p_notes), ''), 'scheduled', v_actor_id
    ) RETURNING id INTO v_session_id;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_session_id,
        'session_id', v_session_id,
        'session_code', v_session_code,
        'assignment_id', p_assignment_id,
        'member_id', v_pt.member_id,
        'trainer_id', v_pt.trainer_id,
        'date', p_session_date,
        'time', v_time,
        'status', 'scheduled',
        'notes', NULLIF(trim(p_notes), '')
    );
END;
$$;

-- ============================================================================
-- 6. RPC: complete_pt_session
-- Atomically completes a scheduled or ad-hoc session, deducts 1 credit from
-- pt_assignments, and logs to public.pt_sessions.
-- ============================================================================
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
    -- Authorization guard
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: Active staff authentication required.' USING ERRCODE = '42501';
    END IF;

    IF p_assignment_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Assignment ID is mandatory.' USING ERRCODE = '22023';
    END IF;

    -- 1. If scheduled session ID provided, validate and lock it
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

    -- 2. Lock PT Assignment row
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

    -- 3. Atomic Session Deduction
    v_new_completed := v_pt.completed_sessions + 1;
    v_new_status := CASE WHEN v_new_completed >= v_pt.total_sessions THEN 'completed' ELSE 'active' END;

    UPDATE public.pt_assignments
    SET completed_sessions = v_new_completed,
        status = v_new_status,
        updated_at = v_conducted_at
    WHERE id = p_assignment_id;

    -- 4. Record into immutable completed sessions log
    INSERT INTO public.pt_sessions (
        assignment_id, session_number, conducted_at, trainer_id, notes, actor_id
    ) VALUES (
        p_assignment_id, v_new_completed, v_conducted_at, v_pt.trainer_id, NULLIF(trim(p_notes), ''), v_actor_id
    ) RETURNING id INTO v_pt_session_id;

    -- 5. If scheduled session, update scheduled session status to completed
    IF p_scheduled_session_id IS NOT NULL THEN
        UPDATE public.pt_scheduled_sessions
        SET status = 'completed',
            completed_session_id = v_pt_session_id,
            notes = COALESCE(NULLIF(trim(p_notes), ''), notes),
            updated_at = v_conducted_at
        WHERE id = p_scheduled_session_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'assignment_id', p_assignment_id,
        'session_id', p_scheduled_session_id,
        'completed_session_id', v_pt_session_id,
        'session_number', v_new_completed,
        'remaining_sessions', v_pt.total_sessions - v_new_completed,
        'status', 'completed',
        'assignment_status', v_new_status
    );
END;
$$;

-- ============================================================================
-- 7. RPC: cancel_pt_scheduled_session
-- Cancels a scheduled session without deducting package credits.
-- ============================================================================
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
BEGIN
    -- Authorization guard
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: Active staff authentication required.' USING ERRCODE = '42501';
    END IF;

    IF p_scheduled_session_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Scheduled session ID is mandatory.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_sched
    FROM public.pt_scheduled_sessions
    WHERE id = p_scheduled_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SESSION_NOT_FOUND: Scheduled PT session record not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_sched.status = 'completed' THEN
        RAISE EXCEPTION 'CANNOT_CANCEL_COMPLETED: Completed sessions cannot be cancelled.' USING ERRCODE = '22023';
    END IF;

    IF v_sched.status = 'cancelled' THEN
        RETURN jsonb_build_object('success', true, 'session_id', p_scheduled_session_id, 'status', 'cancelled');
    END IF;

    UPDATE public.pt_scheduled_sessions
    SET status = 'cancelled',
        notes = COALESCE(NULLIF(trim(p_notes), ''), notes),
        updated_at = clock_timestamp()
    WHERE id = p_scheduled_session_id;

    RETURN jsonb_build_object(
        'success', true,
        'session_id', p_scheduled_session_id,
        'status', 'cancelled'
    );
END;
$$;

-- ============================================================================
-- 8. RPC: update_pt_scheduled_session
-- Updates a pending scheduled session (date, time, notes).
-- ============================================================================
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
BEGIN
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: Active staff authentication required.' USING ERRCODE = '42501';
    END IF;

    IF p_scheduled_session_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Scheduled session ID is mandatory.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_sched
    FROM public.pt_scheduled_sessions
    WHERE id = p_scheduled_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SESSION_NOT_FOUND: Scheduled PT session record not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_sched.status <> 'scheduled' THEN
        RAISE EXCEPTION 'CANNOT_EDIT_NON_SCHEDULED: Only pending scheduled sessions can be updated.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.pt_scheduled_sessions
    SET session_date = COALESCE(p_session_date, session_date),
        session_time = COALESCE(v_time, session_time),
        notes = COALESCE(NULLIF(trim(p_notes), ''), notes),
        updated_at = clock_timestamp()
    WHERE id = p_scheduled_session_id;

    RETURN jsonb_build_object(
        'success', true,
        'session_id', p_scheduled_session_id,
        'date', COALESCE(p_session_date, v_sched.session_date),
        'time', COALESCE(v_time, v_sched.session_time),
        'status', 'scheduled'
    );
END;
$$;

-- ============================================================================
-- 9. Comments & Grants
-- ============================================================================
COMMENT ON TABLE public.pt_scheduled_sessions IS 'Stores scheduled personal training appointments and lifecycle status (scheduled, completed, cancelled).';
COMMENT ON FUNCTION public.schedule_pt_session(uuid, date, text, text) IS 'Schedules a PT session appointment without deducting package credits.';
COMMENT ON FUNCTION public.complete_pt_session(uuid, text, uuid) IS 'Atomically completes a PT session, deducts 1 credit from package, and records in public.pt_sessions.';
COMMENT ON FUNCTION public.cancel_pt_scheduled_session(uuid, text) IS 'Cancels a scheduled PT session without deducting package credits.';
COMMENT ON FUNCTION public.update_pt_scheduled_session(uuid, date, text, text) IS 'Updates date, time slot, and notes of a pending scheduled PT session.';

REVOKE ALL ON FUNCTION public.schedule_pt_session(uuid, date, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.schedule_pt_session(uuid, date, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_pt_session(uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_pt_session(uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_pt_scheduled_session(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_pt_scheduled_session(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_pt_scheduled_session(uuid, date, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_pt_scheduled_session(uuid, date, text, text) TO authenticated;
