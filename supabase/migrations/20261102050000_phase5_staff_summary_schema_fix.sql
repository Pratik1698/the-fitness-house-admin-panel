-- Keep the staff dashboard summary aligned with the canonical PT session schema.
-- pt_sessions records each completed session with conducted_at; it has no status/session_date columns.
BEGIN;

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

REVOKE ALL ON FUNCTION public.get_staff_operational_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_operational_summary() TO authenticated;

COMMIT;
