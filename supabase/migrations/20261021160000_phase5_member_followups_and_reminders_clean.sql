-- ============================================================================
-- Migration: 20261021160000_phase5_member_followups_and_reminders_clean.sql
-- Description: Persistent, relational member_followups table with RLS, cascading 
-- foreign keys to members, views, and authorized SECURITY DEFINER RPCs.
-- Separates manual staff follow-ups from system-generated reminders.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLE: member_followups
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_followups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('expiry', 'balance', 'inquiry', 'general', 'pt')),
    reason TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
    due_date DATE NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
    notes TEXT,
    outcome TEXT,
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES auth.users(id),
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_member_followups_member_id ON public.member_followups(member_id);
CREATE INDEX IF NOT EXISTS idx_member_followups_status ON public.member_followups(status);
CREATE INDEX IF NOT EXISTS idx_member_followups_due_date ON public.member_followups(due_date);

-- Enable RLS
ALTER TABLE public.member_followups ENABLE ROW LEVEL SECURITY;

-- Revoke all direct permissions from PUBLIC and anon
REVOKE ALL ON public.member_followups FROM PUBLIC, anon;

-- Policies for Authenticated Staff and Admin
DROP POLICY IF EXISTS "member_followups_select" ON public.member_followups;
CREATE POLICY "member_followups_select" ON public.member_followups
    FOR SELECT TO authenticated
    USING (get_user_role() = ANY (ARRAY['admin'::text, 'staff'::text]));

DROP POLICY IF EXISTS "member_followups_insert" ON public.member_followups;
CREATE POLICY "member_followups_insert" ON public.member_followups
    FOR INSERT TO authenticated
    WITH CHECK (get_user_role() = ANY (ARRAY['admin'::text, 'staff'::text]));

DROP POLICY IF EXISTS "member_followups_update" ON public.member_followups;
CREATE POLICY "member_followups_update" ON public.member_followups
    FOR UPDATE TO authenticated
    USING (get_user_role() = ANY (ARRAY['admin'::text, 'staff'::text]));

GRANT SELECT, INSERT, UPDATE ON public.member_followups TO authenticated;


-- ----------------------------------------------------------------------------
-- 2. VIEW: v_member_followups
-- Joins member directory details with follow-up metadata
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_member_followups AS
SELECT 
    f.id,
    f.member_id,
    m.member_code,
    m.name AS member_name,
    m.phone,
    f.category,
    f.reason,
    f.priority,
    f.due_date,
    f.status,
    f.notes,
    f.outcome,
    f.completed_at,
    f.created_at,
    f.updated_at
FROM public.member_followups f
JOIN public.members m ON m.id = f.member_id;

REVOKE ALL ON public.v_member_followups FROM PUBLIC, anon;
GRANT SELECT ON public.v_member_followups TO authenticated;


-- ----------------------------------------------------------------------------
-- 3. RPC: create_member_followup
-- Authorized SECURITY DEFINER function to create a manual follow-up task
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_member_followup(
    p_member_id UUID,
    p_category TEXT,
    p_reason TEXT,
    p_priority TEXT DEFAULT 'medium',
    p_due_date DATE DEFAULT (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date,
    p_notes TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_role TEXT;
    v_new_id UUID;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_role := public.get_user_role();
    IF v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'FORBIDDEN: Insufficient permissions.' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = p_member_id) THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND: Member does not exist.' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.member_followups (
        member_id,
        category,
        reason,
        priority,
        due_date,
        notes,
        status,
        created_by
    ) VALUES (
        p_member_id,
        COALESCE(p_category, 'general'),
        TRIM(p_reason),
        COALESCE(p_priority, 'medium'),
        COALESCE(p_due_date, (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date),
        TRIM(p_notes),
        'pending',
        v_actor_id
    ) RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
        'success', true,
        'followup_id', v_new_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_member_followup FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_member_followup TO authenticated;


-- ----------------------------------------------------------------------------
-- 4. RPC: update_member_followup
-- Completes, reschedules, or updates outcome on a manual follow-up task
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_member_followup(
    p_followup_id UUID,
    p_status TEXT DEFAULT NULL,
    p_outcome TEXT DEFAULT NULL,
    p_reschedule_date DATE DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_role TEXT;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_role := public.get_user_role();
    IF v_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'FORBIDDEN: Insufficient permissions.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.member_followups
    SET 
        status = COALESCE(p_status, status),
        outcome = CASE WHEN p_outcome IS NOT NULL THEN TRIM(p_outcome) ELSE outcome END,
        due_date = COALESCE(p_reschedule_date, due_date),
        notes = CASE WHEN p_notes IS NOT NULL THEN TRIM(p_notes) ELSE notes END,
        completed_at = CASE WHEN p_status = 'completed' THEN clock_timestamp() ELSE completed_at END,
        completed_by = CASE WHEN p_status = 'completed' THEN v_actor_id ELSE completed_by END,
        updated_at = clock_timestamp()
    WHERE id = p_followup_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FOLLOWUP_NOT_FOUND: Record does not exist.' USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object('success', true, 'followup_id', p_followup_id);
END;
$$;

REVOKE ALL ON FUNCTION public.update_member_followup FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_member_followup TO authenticated;
