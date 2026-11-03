-- The original SECURITY DEFINER operational RPCs checked authentication but not active staff status.
BEGIN;

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
      AND start_date <= v_today AND expiry_date >= v_today
    ORDER BY expiry_date DESC LIMIT 1;
    IF NOT FOUND THEN
        SELECT * INTO v_sub FROM public.member_subscriptions
        WHERE member_id = p_member_id ORDER BY expiry_date DESC LIMIT 1;
        IF FOUND THEN
            RAISE EXCEPTION 'ERR_MEMBERSHIP_EXPIRED: Membership for % expired on %. Renewal required before check-in.',
                v_member.name, v_sub.expiry_date USING ERRCODE = '22023';
        ELSE
            RAISE EXCEPTION 'ERR_NO_ACTIVE_MEMBERSHIP: Member % has no active membership plan. Onboarding or plan renewal required.',
                v_member.name USING ERRCODE = '22023';
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
        'success', true, 'checkin_id', v_checkin_id, 'checkin_code', v_checkin_code,
        'member_id', p_member_id, 'member_code', v_member.member_code, 'member_name', v_member.name,
        'plan_name', v_sub.plan_name, 'checked_in_at', v_checked_in_at, 'status', 'checked_in'
    );
END;
$$;

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
    IF v_ci.checked_out_at IS NOT NULL THEN
        RAISE EXCEPTION 'ALREADY_CHECKED_OUT: Check-in record % was already checked out at %.',
            v_ci.checkin_code, to_char(v_ci.checked_out_at, 'HH12:MI AM') USING ERRCODE = '22023';
    END IF;
    IF v_ci.status = 'cancelled' THEN
        RAISE EXCEPTION 'INVALID_CHECKIN_STATUS: Check-in record % has been cancelled.', v_ci.checkin_code USING ERRCODE = '22023';
    END IF;

    v_duration_min := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_now - v_ci.checked_in_at)) / 60)::integer);
    UPDATE public.checkins
    SET checked_out_at = v_now, status = 'checked_out',
        notes = CASE WHEN p_notes IS NOT NULL AND trim(p_notes) <> ''
                     THEN COALESCE(notes || ' | ' || trim(p_notes), trim(p_notes)) ELSE notes END,
        updated_at = v_now
    WHERE id = p_checkin_id;

    RETURN jsonb_build_object(
        'success', true, 'checkin_id', v_ci.id, 'checkin_code', v_ci.checkin_code,
        'member_id', v_ci.member_id, 'checked_in_at', v_ci.checked_in_at,
        'checked_out_at', v_now, 'duration_minutes', v_duration_min, 'status', 'checked_out'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_member_checkin(
    p_checkin_id uuid,
    p_reason text DEFAULT NULL
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
    IF v_ci.status = 'cancelled' THEN
        RAISE EXCEPTION 'ALREADY_CANCELLED: Check-in record % has already been cancelled.', v_ci.checkin_code USING ERRCODE = '22023';
    END IF;
    IF v_ci.status = 'checked_out' OR v_ci.checked_out_at IS NOT NULL THEN
        RAISE EXCEPTION 'CANNOT_CANCEL_COMPLETED_VISIT: Cannot cancel completed check-in record %.', v_ci.checkin_code USING ERRCODE = '22023';
    END IF;

    UPDATE public.checkins
    SET status = 'cancelled',
        notes = CASE WHEN p_reason IS NOT NULL AND trim(p_reason) <> ''
                     THEN COALESCE(notes || ' | Cancelled: ' || trim(p_reason), 'Cancelled: ' || trim(p_reason)) ELSE notes END,
        updated_at = v_now
    WHERE id = p_checkin_id;

    RETURN jsonb_build_object('success', true, 'checkin_id', v_ci.id, 'checkin_code', v_ci.checkin_code,
                              'member_id', v_ci.member_id, 'status', 'cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_pt_session(
    p_assignment_id uuid,
    p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_pt record;
    v_new_completed integer;
    v_new_status text;
BEGIN
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: Active staff authentication required.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_pt FROM public.pt_assignments WHERE id = p_assignment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND: PT assignment record not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_pt.completed_sessions >= v_pt.total_sessions THEN
        RAISE EXCEPTION 'SESSIONS_EXHAUSTED: All % package sessions have already been logged.', v_pt.total_sessions USING ERRCODE = '22003';
    END IF;
    IF v_pt.status <> 'active' THEN
        RAISE EXCEPTION 'INVALID_STATUS: Sessions can only be logged against active PT packages.' USING ERRCODE = '22023';
    END IF;

    v_new_completed := v_pt.completed_sessions + 1;
    v_new_status := CASE WHEN v_new_completed >= v_pt.total_sessions THEN 'completed' ELSE 'active' END;
    UPDATE public.pt_assignments SET completed_sessions = v_new_completed, status = v_new_status, updated_at = clock_timestamp()
    WHERE id = p_assignment_id;
    INSERT INTO public.pt_sessions (assignment_id, session_number, conducted_at, trainer_id, notes, actor_id)
    VALUES (p_assignment_id, v_new_completed, clock_timestamp(), v_pt.trainer_id, NULLIF(trim(p_notes), ''), v_actor_id);

    RETURN jsonb_build_object('success', true, 'assignment_id', p_assignment_id, 'session_number', v_new_completed,
                              'remaining_sessions', v_pt.total_sessions - v_new_completed, 'status', v_new_status);
END;
$$;

REVOKE ALL ON FUNCTION public.record_member_checkin(uuid, text),
    public.record_member_checkout(uuid, text), public.cancel_member_checkin(uuid, text),
    public.complete_pt_session(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_member_checkin(uuid, text),
    public.record_member_checkout(uuid, text), public.cancel_member_checkin(uuid, text),
    public.complete_pt_session(uuid, text) TO authenticated;

COMMIT;
