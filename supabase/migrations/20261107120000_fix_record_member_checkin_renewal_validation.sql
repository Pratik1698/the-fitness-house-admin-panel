-- ============================================================================
-- Migration: 20261107120000_fix_record_member_checkin_renewal_validation.sql
-- Description: Fix check-in validation rejecting renewed active memberships
--
-- Issue:
-- During membership renewal, the previous subscription contract is updated to
-- status = 'superseded', and a new subscription is created with status = 'active'.
-- When a member renews early, the new contract's start_date is set to the continuation
-- date (the previous subscription's expiry date, e.g. 2027-02-05), which is in the future.
-- The prior implementation of record_member_checkin strictly required:
--   WHERE status = 'active' AND start_date <= v_today AND expiry_date >= v_today
-- Because the active renewed subscription had start_date > v_today and the earlier
-- subscription covering today was status = 'superseded', the query found 0 rows.
-- The fallback block then assumed any unfound subscription had expired, raising:
--   ERR_MEMBERSHIP_EXPIRED: Membership for % expired on %. Renewal required before check-in.
-- reporting a future expiry date (e.g. 2027-05-06) as "expired".
--
-- Remediation:
-- 1. Select the member's authoritative current active subscription:
--      WHERE member_id = p_member_id AND status = 'active' ORDER BY expiry_date DESC LIMIT 1
-- 2. Verify subscription has not expired (expiry_date >= v_today).
-- 3. If start_date is in the future, permit check-in if the member has continuous
--    active/superseded subscription coverage spanning today.
-- 4. If no active subscription exists, accurately distinguish between cancelled,
--    genuinely expired, or absent subscriptions.
-- 5. Preserve strict duplicate check-in prevention and active staff authorization.
-- ============================================================================

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
    -- 1. Active staff authorization guard
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: Active staff authentication required.' USING ERRCODE = '42501';
    END IF;

    IF p_member_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Member ID is mandatory.' USING ERRCODE = '22023';
    END IF;

    -- 2. Member existence & archival check
    SELECT * INTO v_member FROM public.members WHERE id = p_member_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND: Member does not exist.' USING ERRCODE = 'P0002';
    END IF;

    IF v_member.is_archived THEN
        RAISE EXCEPTION 'MEMBER_ARCHIVED: Member % is archived. Archival must be reversed before logging attendance.',
            v_member.member_code USING ERRCODE = '22023';
    END IF;

    -- 3. Identify authoritative current active subscription
    SELECT * INTO v_sub
    FROM public.member_subscriptions
    WHERE member_id = p_member_id AND status = 'active'
    ORDER BY expiry_date DESC
    LIMIT 1;

    -- If no active subscription exists, inspect latest subscription across all statuses to report exact state
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

    -- 4. Validate subscription validity period
    -- A subscription expiring today (expiry_date = v_today) is valid through the end of today.
    IF v_sub.expiry_date < v_today THEN
        RAISE EXCEPTION 'ERR_MEMBERSHIP_EXPIRED: Membership for % expired on %. Renewal required before check-in.',
            v_member.name, v_sub.expiry_date USING ERRCODE = '22023';
    END IF;

    -- If the active subscription starts in the future (e.g. renewed early),
    -- verify that the member has continuous coverage covering today.
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

    -- 5. Duplicate Visit Guard: Prevent concurrent unclosed sessions
    SELECT * INTO v_active_ci FROM public.checkins
    WHERE member_id = p_member_id AND status = 'checked_in' AND checked_out_at IS NULL;
    IF FOUND THEN
        RAISE EXCEPTION 'MEMBER_ALREADY_CHECKED_IN: % is already checked in (since %). Active session must be checked out first.',
            v_member.name, to_char(v_active_ci.checked_in_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') USING ERRCODE = '23505';
    END IF;

    -- 6. Generate check-in record
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

COMMENT ON FUNCTION public.record_member_checkin(uuid, text) IS 'Records a member check-in visit with active staff authorization, validates current or renewed subscription eligibility, and prevents duplicate concurrent open visits.';

REVOKE ALL ON FUNCTION public.record_member_checkin(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_member_checkin(uuid, text) TO authenticated;
