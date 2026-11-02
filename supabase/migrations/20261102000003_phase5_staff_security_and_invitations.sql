-- ============================================================================
-- THE FITNESS HOUSE — GYM MANAGEMENT ADMIN PANEL
-- PHASE 5: FINAL SECURITY CORRECTIONS & PRODUCTION READINESS
-- File: 20261102000003_phase5_staff_security_and_invitations.sql
-- ============================================================================
-- Purpose:
-- 1. Safely add is_active, deactivated_at, and invited_by to public.profiles.
--    Drop legacy profiles_admin_all wildcard policy and REVOKE DELETE, INSERT on public.profiles
--    from authenticated, anon, PUBLIC to prevent raw admin deletion.
-- 2. Create public.staff_invitations table with strict staff-only role constraint,
--    lifecycle tracking, and partial unique active-email index.
-- 3. Create public.security_audit_logs table with strictly append-only security definer writes.
--    No direct authenticated INSERT is permitted.
-- 4. Harden public.get_user_role(), public.is_admin(), and public.is_staff()
--    to fail-closed on deactivated accounts (is_active = false).
-- 5. Create secure public.admin_set_user_status() RPC with transaction serialization lock,
--    last-admin protection, self-deactivation protection, and audit logging.
-- 6. Update public.admin_set_user_role() with transaction serialization lock,
--    last-admin demotion protection, and audit logging.
-- 7. Add race-safe invitation lifecycle RPCs:
--    - create_staff_invitation(email, full_name)
--    - resend_staff_invitation(invitation_id)
--    - revoke_staff_invitation(invitation_id)
--    - accept_staff_invitation()
-- 8. Update auth trigger fn_on_auth_user_created():
--    - Only creates profile if unexpired pending invitation exists.
--    - Links auth_user_id without marking invitation accepted.
--    - Sets role = 'staff', is_active = false until explicit acceptance.
--    - Rejects unauthorized signups with no profile creation.
-- 9. Protect financial RPCs with active administrator authorization:
--    - record_dues_payment()
--    - record_pt_dues_payment()
--    - renew_member_subscription()
--    - onboard_member() (active staff can onboard with 0.00 initial payment; initial payments > 0.00 restricted to admin)
--    - assign_pt_package() (active staff can assign with 0.00 initial payment; initial payments > 0.00 restricted to admin)
-- 10. Enforce PostgreSQL financial isolation:
--    - Direct payments & member_subscriptions SELECT restricted to administrators.
--    - v_active_members masks plan_price, total_liability, amount_paid, balance for staff.
--    - v_member_dues and v_outstanding_payments return 0 rows for non-admins.
--    - v_notifications masks current_balance for non-admins.
-- 11. Enforce inactive account rejection across all table RLS policies (using is_staff / is_admin).
-- 12. Add public.get_staff_operational_summary() RPC for non-financial staff reporting.
-- 13. Configure strict grants:
--    - Revoke mutation privileges on staff_invitations and security_audit_logs.
--    - Revoke all privileges from anon and PUBLIC.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. PROFILES ENHANCEMENT: ACCOUNT STATUS & INVITATION ATTRIBUTION
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.is_active IS 'Active status of gym staff/admin. Inactive accounts are immediately rejected across all auth and RLS gates.';
COMMENT ON COLUMN public.profiles.deactivated_at IS 'Timestamp when the account was deactivated by an administrator.';
COMMENT ON COLUMN public.profiles.invited_by IS 'Admin user who dispatched the invitation for this account.';

-- Ensure index on is_active for performant RLS and role checks
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON public.profiles(is_active);

-- ----------------------------------------------------------------------------
-- 1B. PROFILES RLS & PRIVILEGE HARDENING (PREVENT DIRECT DELETION & INSERTION)
-- ----------------------------------------------------------------------------
-- Drop legacy wildcard policy that previously permitted broad mutation
DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;

-- Ensure RLS is active on public.profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Revoke direct mutation privileges from non-superuser roles
REVOKE DELETE, INSERT ON public.profiles FROM authenticated, anon, PUBLIC;

-- Revoke general UPDATE on profiles from anon, PUBLIC, and authenticated
REVOKE UPDATE ON public.profiles FROM anon, PUBLIC;
REVOKE UPDATE ON public.profiles FROM authenticated;

-- Users may only update their own full_name (via column-level grant and profiles_update_self policy)
GRANT UPDATE (full_name) ON public.profiles TO authenticated;

-- Ensure SELECT is granted to authenticated role (subject to profiles_select_self_or_admin)
GRANT SELECT ON public.profiles TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. STAFF INVITATIONS TABLE
-- ----------------------------------------------------------------------------
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

COMMENT ON TABLE public.staff_invitations IS 'Tracks staff member invitations, expiration, and acceptance lifecycle.';

-- Prevent multiple simultaneous active pending invitations for the same normalized email
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_invitations_active_email
    ON public.staff_invitations (lower(trim(email)))
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_staff_invitations_email
    ON public.staff_invitations (lower(trim(email)));

CREATE INDEX IF NOT EXISTS idx_staff_invitations_status
    ON public.staff_invitations (status);

-- ----------------------------------------------------------------------------
-- 3. SECURITY AUDIT LOGS TABLE (STRICTLY APPEND-ONLY)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    target_user_id UUID DEFAULT NULL,
    action TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE public.security_audit_logs IS 'Append-only audit ledger for administrative security events. Writes permitted strictly via security definer RPCs and server Edge Functions.';

CREATE INDEX IF NOT EXISTS idx_security_audit_logs_actor
    ON public.security_audit_logs (actor_id);

CREATE INDEX IF NOT EXISTS idx_security_audit_logs_target
    ON public.security_audit_logs (target_user_id);

CREATE INDEX IF NOT EXISTS idx_security_audit_logs_created_at
    ON public.security_audit_logs (created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. HARDENED ROLE RESOLUTION HELPERS (FAIL-CLOSED ON INACTIVE)
-- ----------------------------------------------------------------------------
-- Inactive accounts immediately return NULL role, blocking all RLS and RPC gates.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;

-- Inactive administrators immediately return false.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE((SELECT role = 'admin' FROM public.profiles WHERE id = auth.uid() AND is_active = true), false);
$$;

-- Active staff or admin helper. Returns true ONLY if account is active.
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE((SELECT role IN ('admin', 'staff') FROM public.profiles WHERE id = auth.uid() AND is_active = true), false);
$$;

-- ----------------------------------------------------------------------------
-- 5. SANITIZED STAFF ROSTER VIEW
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_staff_roster CASCADE;

CREATE OR REPLACE VIEW public.v_staff_roster WITH (security_invoker = false) AS
SELECT
    id,
    full_name,
    role,
    is_active,
    deactivated_at,
    created_at
FROM public.profiles
WHERE public.is_staff();

COMMENT ON VIEW public.v_staff_roster IS 'Sanitized staff roster exposing names, roles, active statuses, and deactivation timestamps without disclosing private emails to coworkers.';

-- ----------------------------------------------------------------------------
-- 6. ACCOUNT STATUS MANAGEMENT RPC (WITH DEADLOCK-SAFE SERIALIZATION LOCK)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_status(
    p_user_id UUID,
    p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_target_profile RECORD;
    v_admin_count INT;
    v_actor_id UUID := auth.uid();
BEGIN
    -- 1. Authorization: verify caller is an active administrator
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can modify account status.' USING ERRCODE = '42501';
    END IF;

    -- 2. Argument validation
    IF p_user_id IS NULL OR p_is_active IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Target user ID and active status are required.' USING ERRCODE = '22023';
    END IF;

    -- 3. Prevent self-deactivation
    IF p_user_id = v_actor_id AND NOT p_is_active THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Administrators cannot deactivate their own account.' USING ERRCODE = '22023';
    END IF;

    -- 4. Target profile existence check
    SELECT * INTO v_target_profile
    FROM public.profiles
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROFILE_NOT_FOUND: Target user profile does not exist.' USING ERRCODE = 'P0002';
    END IF;

    -- 5. Prevent deactivating the last active administrator
    -- SERIALIZE CHECK: Lock all active admin rows in consistent order to prevent deadlocks and race condition
    IF v_target_profile.role = 'admin' AND NOT p_is_active THEN
        PERFORM 1
        FROM public.profiles
        WHERE role = 'admin' AND is_active = true
        ORDER BY id
        FOR UPDATE;

        SELECT count(*) INTO v_admin_count
        FROM public.profiles
        WHERE role = 'admin' AND is_active = true AND id != p_user_id;

        IF v_admin_count < 1 THEN
            RAISE EXCEPTION 'INVALID_OPERATION: Cannot deactivate the last active administrator.' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- 6. Apply status update
    UPDATE public.profiles
    SET is_active = p_is_active,
        deactivated_at = CASE WHEN p_is_active THEN NULL ELSE clock_timestamp() END,
        updated_at = clock_timestamp()
    WHERE id = p_user_id;

    -- 7. If deactivating, attempt session purge from auth.sessions (if permitted in schema)
    IF NOT p_is_active THEN
        BEGIN
            DELETE FROM auth.sessions WHERE user_id = p_user_id;
        EXCEPTION WHEN OTHERS THEN
            -- In restricted permission environments, fail open for session table deletion
            -- because RLS is_active check immediately rejects all subsequent requests anyway.
            NULL;
        END;
    END IF;

    -- 8. Record append-only security audit log (atomic in the same transaction)
    INSERT INTO public.security_audit_logs (actor_id, target_user_id, action, details)
    VALUES (
        v_actor_id,
        p_user_id,
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

-- ----------------------------------------------------------------------------
-- 7. HARDENED ROLE MANAGEMENT RPC (WITH DEADLOCK-SAFE SERIALIZATION LOCK)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
    p_user_id UUID,
    p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_target_profile RECORD;
    v_admin_count INT;
    v_actor_id UUID := auth.uid();
BEGIN
    -- 1. Authorization: verify caller is an active administrator
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can modify user roles.' USING ERRCODE = '42501';
    END IF;

    -- 2. Argument validation
    IF p_user_id IS NULL OR p_role IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Target user ID and role are required.' USING ERRCODE = '22023';
    END IF;

    IF p_role NOT IN ('admin', 'staff') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Role must be admin or staff.' USING ERRCODE = '22023';
    END IF;

    -- 3. Prevent self-demotion
    IF p_user_id = v_actor_id AND p_role = 'staff' THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Administrators cannot demote their own account.' USING ERRCODE = '22023';
    END IF;

    -- 4. Target profile existence check
    SELECT * INTO v_target_profile
    FROM public.profiles
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROFILE_NOT_FOUND: Target user profile does not exist.' USING ERRCODE = 'P0002';
    END IF;

    -- 5. Prevent demoting the last active administrator
    -- SERIALIZE CHECK: Lock all active admin rows in consistent order to prevent deadlocks and race condition
    IF v_target_profile.role = 'admin' AND p_role = 'staff' THEN
        PERFORM 1
        FROM public.profiles
        WHERE role = 'admin' AND is_active = true
        ORDER BY id
        FOR UPDATE;

        SELECT count(*) INTO v_admin_count
        FROM public.profiles
        WHERE role = 'admin' AND is_active = true AND id != p_user_id;

        IF v_admin_count < 1 THEN
            RAISE EXCEPTION 'INVALID_OPERATION: Cannot demote the last active administrator.' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- 6. Apply role change
    UPDATE public.profiles
    SET role = p_role,
        updated_at = clock_timestamp()
    WHERE id = p_user_id;

    -- 7. Record security audit log (atomic in the same transaction)
    INSERT INTO public.security_audit_logs (actor_id, target_user_id, action, details)
    VALUES (
        v_actor_id,
        p_user_id,
        'role_changed',
        jsonb_build_object(
            'previous_role', v_target_profile.role,
            'new_role', p_role,
            'target_email', v_target_profile.email
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_user_id,
        'new_role', p_role
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. ATOMIC INVITATION LIFECYCLE RPCs (RACE-SAFE & AUDITED)
-- ----------------------------------------------------------------------------

-- A. Create Staff Invitation
CREATE OR REPLACE FUNCTION public.create_staff_invitation(
    p_email TEXT,
    p_full_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_norm_email TEXT := lower(trim(p_email));
    v_existing_profile RECORD;
    v_existing_invite RECORD;
    v_new_invite_id UUID;
    v_expires_at TIMESTAMPTZ := clock_timestamp() + interval '7 days';
BEGIN
    -- 1. Authorization: verify caller is an active administrator
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can create staff invitations.' USING ERRCODE = '42501';
    END IF;

    -- 2. Validate input
    IF v_norm_email IS NULL OR v_norm_email = '' OR position('@' in v_norm_email) < 2 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: A valid email address is required.' USING ERRCODE = '22023';
    END IF;

    IF p_full_name IS NULL OR length(trim(p_full_name)) < 2 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Staff member full name is required (minimum 2 characters).' USING ERRCODE = '22023';
    END IF;

    -- 3. Check existing profiles
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

    -- 4. Mark expired pending invitations for this email as 'expired'
    UPDATE public.staff_invitations
    SET status = 'expired'
    WHERE lower(trim(email)) = v_norm_email
      AND status = 'pending'
      AND expires_at <= clock_timestamp();

    -- 5. Lock and check if an active unexpired pending invitation still exists
    SELECT * INTO v_existing_invite
    FROM public.staff_invitations
    WHERE lower(trim(email)) = v_norm_email
      AND status = 'pending'
      AND expires_at > clock_timestamp()
    FOR UPDATE;

    IF FOUND THEN
        RAISE EXCEPTION 'DUPLICATE_INVITATION: An active pending invitation for this email already exists.' USING ERRCODE = '23505';
    END IF;

    -- 6. Insert new pending invitation (ALWAYS role 'staff')
    INSERT INTO public.staff_invitations (
        email,
        full_name,
        role,
        status,
        invited_by,
        expires_at
    ) VALUES (
        v_norm_email,
        trim(p_full_name),
        'staff',
        'pending',
        v_actor_id,
        v_expires_at
    )
    RETURNING id INTO v_new_invite_id;

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

-- B. Resend Staff Invitation
CREATE OR REPLACE FUNCTION public.resend_staff_invitation(
    p_invitation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

    -- Renew pending status and extend expiry by 7 days
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

-- C. Revoke Staff Invitation
CREATE OR REPLACE FUNCTION public.revoke_staff_invitation(
    p_invitation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

    -- Atomic audit log entry
    INSERT INTO public.security_audit_logs (actor_id, target_user_id, action, details)
    VALUES (
        v_actor_id,
        v_invite.auth_user_id,
        'invitation_revoked',
        jsonb_build_object(
            'invitation_id', v_invite.id,
            'email', v_invite.email
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'invitation_id', v_invite.id,
        'email', v_invite.email,
        'status', 'revoked'
    );
END;
$$;

-- D. Accept Staff Invitation (Trusted Server-Side Acceptance Workflow)
CREATE OR REPLACE FUNCTION public.accept_staff_invitation()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_user_email TEXT;
    v_invitation RECORD;
BEGIN
    -- 1. Must be authenticated
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to accept invitation.' USING ERRCODE = '42501';
    END IF;

    -- 2. Retrieve authenticated user email directly from auth.users
    SELECT email INTO v_user_email
    FROM auth.users
    WHERE id = v_actor_id;

    IF v_user_email IS NULL THEN
        RAISE EXCEPTION 'USER_NOT_FOUND: Authenticated user record could not be found.' USING ERRCODE = 'P0002';
    END IF;

    -- 3. Atomically find and lock the pending, unexpired, non-revoked invitation
    SELECT * INTO v_invitation
    FROM public.staff_invitations
    WHERE lower(trim(email)) = lower(trim(v_user_email))
      AND status = 'pending'
      AND expires_at > clock_timestamp()
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_invitation.id IS NULL THEN
        -- Check if already accepted
        IF EXISTS (
            SELECT 1 FROM public.staff_invitations
            WHERE lower(trim(email)) = lower(trim(v_user_email))
              AND status = 'accepted'
        ) THEN
            RETURN jsonb_build_object('success', true, 'message', 'Invitation already accepted.');
        END IF;

        RAISE EXCEPTION 'INVALID_INVITATION: No valid, unexpired pending invitation found for this account.' USING ERRCODE = '22023';
    END IF;

    -- 4. Reject if the user was previously deactivated (invitations must never reactivate deactivated accounts)
    IF EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = v_actor_id AND is_active = false AND deactivated_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN: Deactivated accounts cannot be reactivated via invitation.' USING ERRCODE = '42501';
    END IF;

    -- 5. Mark invitation accepted atomically
    UPDATE public.staff_invitations
    SET status = 'accepted',
        accepted_at = clock_timestamp(),
        auth_user_id = v_actor_id
    WHERE id = v_invitation.id;

    -- 6. Activate the profile and strictly enforce staff role
    UPDATE public.profiles
    SET is_active = true,
        role = 'staff',
        deactivated_at = NULL,
        updated_at = clock_timestamp()
    WHERE id = v_actor_id;

    -- 7. Audit log (atomic in the same transaction)
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

-- ----------------------------------------------------------------------------
-- 9. AUTH USER CREATION TRIGGER (NO AUTO-ACCEPTANCE, UNAUTHORIZED SIGNUP PREVENTION)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_on_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_invitation RECORD;
    v_existing_profile RECORD;
BEGIN
    -- 1. Check if profile already exists for this user ID.
    -- If so, DO NOT reactivate or overwrite role automatically!
    SELECT * INTO v_existing_profile
    FROM public.profiles
    WHERE id = NEW.id;

    IF FOUND THEN
        UPDATE public.profiles
        SET email = NEW.email,
            updated_at = clock_timestamp()
        WHERE id = NEW.id;
        RETURN NEW;
    END IF;

    -- 2. Atomically find an unexpired pending invitation for this normalized email
    SELECT * INTO v_invitation
    FROM public.staff_invitations
    WHERE lower(trim(email)) = lower(trim(NEW.email))
      AND status = 'pending'
      AND expires_at > clock_timestamp()
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    -- 3. UNAUTHORIZED AUTH USER CREATION PREVENTION:
    -- If no valid pending invitation exists, do NOT create a profile.
    -- The user will have no role, cannot access any RLS table, and is effectively blocked.
    IF v_invitation.id IS NULL THEN
        RETURN NEW;
    END IF;

    -- 4. Link auth_user_id on pending invitation WITHOUT marking accepted!
    UPDATE public.staff_invitations
    SET auth_user_id = NEW.id
    WHERE id = v_invitation.id
      AND status = 'pending';

    -- 5. Insert profile: ALWAYS 'staff' role, is_active = false until explicit acceptance
    INSERT INTO public.profiles (
        id,
        email,
        full_name,
        role,
        is_active,
        invited_by
    )
    VALUES (
        NEW.id,
        NEW.email,
        v_invitation.full_name,
        'staff', -- Strictly enforced staff role; cannot create admin
        false,   -- Inactive until user completes invitation acceptance workflow
        v_invitation.invited_by
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. FINANCIAL RPCs BACKEND AUTHORIZATION HARDENING
-- ----------------------------------------------------------------------------

-- A. record_dues_payment: Enforce active administrator authorization
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
    -- Authorization: active administrator required
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can record dues payments.' USING ERRCODE = '42501';
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

    -- Idempotency Check
    IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' THEN
        SELECT response, payload_hash INTO v_cached_response, v_cached_hash
        FROM public.idempotency_keys
        WHERE actor_id = v_actor_id AND operation = 'record_dues_payment' AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_cached_hash <> v_payload_hash THEN
                RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: A divergent request already used this idempotency key.' USING ERRCODE = '23505';
            END IF;
            RETURN v_cached_response;
        END IF;

        v_lock_key := 'record_dues_payment:' || v_actor_id::text || ':' || p_idempotency_key;
        PERFORM pg_advisory_xact_lock(hashtext(v_lock_key));
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

    -- Update Subscription Balances
    UPDATE public.member_subscriptions
    SET amount_paid = amount_paid + p_amount,
        balance = balance - p_amount,
        payment_status = CASE
            WHEN (balance - p_amount) = 0.00 THEN 'paid'
            ELSE 'partial'
        END,
        updated_at = clock_timestamp()
    WHERE id = p_subscription_id;

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

    IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' THEN
        INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
        VALUES (v_actor_id, 'record_dues_payment', p_idempotency_key, v_payload_hash, v_response)
        ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING;
    END IF;

    RETURN v_response;
END;
$$;

-- B. record_pt_dues_payment: Enforce active administrator authorization
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
    -- Authorization: active administrator required
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can record PT dues payments.' USING ERRCODE = '42501';
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

    IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' THEN
        SELECT response, payload_hash INTO v_cached_response, v_cached_hash
        FROM public.idempotency_keys
        WHERE actor_id = v_actor_id AND operation = 'record_pt_dues_payment' AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_cached_hash <> v_payload_hash THEN
                RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: A divergent request already used this idempotency key.' USING ERRCODE = '23505';
            END IF;
            RETURN v_cached_response;
        END IF;

        v_lock_key := 'record_pt_dues_payment:' || v_actor_id::text || ':' || p_idempotency_key;
        PERFORM pg_advisory_xact_lock(hashtext(v_lock_key));
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

    UPDATE public.pt_assignments
    SET amount_paid = amount_paid + p_amount,
        balance = balance - p_amount,
        payment_status = CASE
            WHEN (balance - p_amount) = 0.00 THEN 'paid'
            ELSE 'partial'
        END,
        updated_at = clock_timestamp()
    WHERE id = p_pt_assignment_id;

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

    IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' THEN
        INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
        VALUES (v_actor_id, 'record_pt_dues_payment', p_idempotency_key, v_payload_hash, v_response)
        ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING;
    END IF;

    RETURN v_response;
END;
$$;

-- C. renew_member_subscription: Enforce active administrator authorization
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
    -- Authorization: active administrator required
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can renew membership subscriptions.' USING ERRCODE = '42501';
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

    IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' THEN
        SELECT response, payload_hash INTO v_cached_response, v_cached_hash
        FROM public.idempotency_keys
        WHERE actor_id = v_actor_id AND operation = 'renew_member_subscription' AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_cached_hash <> v_payload_hash THEN
                RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: A divergent request already used this idempotency key.' USING ERRCODE = '23505';
            END IF;
            RETURN v_cached_response;
        END IF;

        v_lock_key := 'renew_member_subscription:' || v_actor_id::text || ':' || p_idempotency_key;
        PERFORM pg_advisory_xact_lock(hashtext(v_lock_key));
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
                    notes = COALESCE(notes, '') || ' [Balance of ' || v_prev_sub.balance || ' transferred to renewal]',
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
        carried_balance,
        total_liability,
        amount_paid,
        balance,
        payment_status,
        start_date,
        expiry_date,
        status,
        notes
    ) VALUES (
        p_member_id,
        v_plan.id,
        v_plan.name,
        v_plan.price,
        v_carried_balance,
        v_plan.price + v_carried_balance,
        p_payment_amount,
        (v_plan.price + v_carried_balance) - p_payment_amount,
        CASE
            WHEN ((v_plan.price + v_carried_balance) - p_payment_amount) = 0.00 THEN 'paid'
            WHEN p_payment_amount > 0.00 THEN 'partial'
            ELSE 'unpaid'
        END,
        p_start_date,
        v_expiry_date,
        'active',
        CASE WHEN v_carried_balance > 0.00 THEN 'Carried forward ₹' || v_carried_balance || ' from prior contract.' ELSE NULL END
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

    IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' THEN
        INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
        VALUES (v_actor_id, 'renew_member_subscription', p_idempotency_key, v_payload_hash, v_response)
        ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING;
    END IF;

    RETURN v_response;
END;
$$;

-- D. onboard_member: Atomic Registration, Subscription & Admin-Only Initial Payment Collection
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
    -- 1. Authorization: active personnel required
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Active personnel authentication required.' USING ERRCODE = '42501';
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

    RETURN v_response;
END;
$$;

-- E. assign_pt_package: Atomic Personal Training Assignment & Admin-Only Initial Payment Collection
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
    -- 1. Authorization: active personnel required
    IF v_actor_id IS NULL OR NOT public.is_staff() THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Active personnel authentication required.' USING ERRCODE = '42501';
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
        RETURN v_cached_response;
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

    RETURN v_response;
END;
$$;

-- ----------------------------------------------------------------------------
-- 11. DEDICATED NON-FINANCIAL STAFF OPERATIONAL REPORTING RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_staff_operational_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_active_members_count INT;
    v_today_checkins_count INT;
    v_pt_sessions_month INT;
    v_expiring_soon_count INT;
    v_today DATE := (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
    -- Authorization: active staff or active admin
    IF NOT public.is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: Access restricted to authorized active personnel.' USING ERRCODE = '42501';
    END IF;

    -- Operational counts (completely stripped of revenues and currency)
    SELECT count(*) INTO v_active_members_count
    FROM public.members
    WHERE is_archived = false;

    SELECT count(*) INTO v_today_checkins_count
    FROM public.checkins
    WHERE (checked_in_at AT TIME ZONE 'Asia/Kolkata')::date = v_today;

    SELECT count(*) INTO v_pt_sessions_month
    FROM public.pt_sessions
    WHERE status = 'completed'
      AND (session_date >= date_trunc('month', v_today)::date);

    SELECT count(*) INTO v_expiring_soon_count
    FROM public.member_subscriptions
    WHERE status = 'active'
      AND expiry_date BETWEEN v_today AND (v_today + interval '7 days')::date;

    RETURN jsonb_build_object(
        'active_members', v_active_members_count,
        'today_checkins', v_today_checkins_count,
        'pt_sessions_month', v_pt_sessions_month,
        'expiring_this_week', v_expiring_soon_count,
        'generated_at', clock_timestamp()
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 12. FINANCIAL ISOLATION & DATA ACCESS VIEWS
-- ----------------------------------------------------------------------------
-- A. v_active_members: Masks all financial fields for non-admin callers
DROP VIEW IF EXISTS public.v_active_members CASCADE;

CREATE OR REPLACE VIEW public.v_active_members WITH (security_invoker = false) AS
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
    CASE WHEN public.is_admin() THEN s.plan_price ELSE NULL END AS plan_price,
    CASE WHEN public.is_admin() THEN s.total_liability ELSE NULL END AS total_liability,
    CASE WHEN public.is_admin() THEN s.amount_paid ELSE NULL END AS amount_paid,
    CASE WHEN public.is_admin() THEN s.balance ELSE NULL END AS balance,
    CASE WHEN public.is_admin() THEN s.payment_status ELSE NULL END AS payment_status,
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
WHERE m.is_archived = false
  AND public.is_staff();

COMMENT ON VIEW public.v_active_members IS 'Active members directory view: excludes archived members, masks sensitive financial fields (plan_price, total_liability, amount_paid, balance, payment_status) for non-admin callers, and permits access only to authenticated active staff and administrators.';

-- B. v_member_dues & v_outstanding_payments: Financial views return 0 rows for non-admins
DROP VIEW IF EXISTS public.v_outstanding_payments CASCADE;
DROP VIEW IF EXISTS public.v_member_dues CASCADE;

CREATE OR REPLACE VIEW public.v_member_dues WITH (security_invoker = false) AS
SELECT
    m.id AS member_id,
    m.member_code,
    m.name AS member_name,
    m.phone,
    m.email,
    m.is_archived,
    s.id AS subscription_id,
    s.plan_name,
    s.start_date,
    s.expiry_date,
    s.total_liability AS total_amount_due,
    s.amount_paid,
    s.balance AS outstanding_balance,
    s.payment_status,
    s.status AS subscription_status
FROM public.members m
JOIN LATERAL (
    SELECT sub.*
    FROM public.member_subscriptions sub
    WHERE sub.member_id = m.id AND sub.status = 'active'
    ORDER BY sub.expiry_date DESC
    LIMIT 1
) s ON true
WHERE m.is_archived = false
  AND public.is_admin(); -- Financial isolation: returns 0 rows for non-admins

COMMENT ON VIEW public.v_member_dues IS 'Active member dues statuses (unpaid, partial, paid): authoritative financial ledger view restricted to active administrators. Returns 0 rows for non-admin staff.';

CREATE OR REPLACE VIEW public.v_outstanding_payments WITH (security_invoker = false) AS
SELECT *
FROM public.v_member_dues
WHERE outstanding_balance > 0.00
  AND public.is_admin();

COMMENT ON VIEW public.v_outstanding_payments IS 'Outstanding member balances view: filters v_member_dues where outstanding_balance > 0. Restricted to active administrators; returns 0 rows for non-admin staff.';

-- C. v_notifications: Masks current_balance for non-admin callers
DROP VIEW IF EXISTS public.v_notifications CASCADE;

CREATE OR REPLACE VIEW public.v_notifications WITH (security_invoker = false) AS
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
    CASE WHEN public.is_admin() THEN COALESCE(s.balance, 0.00) ELSE NULL END AS current_balance,
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
WHERE m.is_archived = false
  AND public.is_staff();

COMMENT ON VIEW public.v_notifications IS 'Notifications and automated reminders view: calculates dynamic days_remaining in Asia/Kolkata timezone, preserves WhatsApp delivery audit tracking, excludes archived members, and masks current_balance for non-admin callers.';

-- ----------------------------------------------------------------------------
-- 13. ROW LEVEL SECURITY (RLS) POLICIES & ACCESS HARDENING
-- ----------------------------------------------------------------------------
-- A. staff_invitations RLS: Admins may SELECT only. Direct mutations prohibited.
ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_invitations_admin_all" ON public.staff_invitations;
DROP POLICY IF EXISTS "staff_invitations_select_admin" ON public.staff_invitations;

CREATE POLICY "staff_invitations_select_admin" ON public.staff_invitations
    FOR SELECT TO authenticated
    USING (public.is_admin());

-- B. security_audit_logs RLS: Admins may SELECT only. Writes strictly via Definer/Server.
ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "security_audit_logs_select_admin" ON public.security_audit_logs;
DROP POLICY IF EXISTS "security_audit_logs_insert_admin" ON public.security_audit_logs;

CREATE POLICY "security_audit_logs_select_admin" ON public.security_audit_logs
    FOR SELECT TO authenticated
    USING (public.is_admin());

-- C. Financial Tables RLS (Admin Only)
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

-- D. Operational Tables RLS (Active Staff & Admin Only; Inactive Rejected)
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

ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plans_select" ON public.membership_plans;
CREATE POLICY "plans_select" ON public.membership_plans
    FOR SELECT TO authenticated
    USING (public.is_staff());

ALTER TABLE public.pt_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pt_packages_select_active" ON public.pt_packages;
DROP POLICY IF EXISTS "pt_packages_select_all" ON public.pt_packages;
CREATE POLICY "pt_packages_select_all" ON public.pt_packages
    FOR SELECT TO authenticated
    USING (public.is_staff());

ALTER TABLE public.gym_info ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gym_info_select" ON public.gym_info;
CREATE POLICY "gym_info_select" ON public.gym_info
    FOR SELECT TO authenticated
    USING (public.is_staff());

ALTER TABLE public.reminder_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reminder_settings_select" ON public.reminder_settings;
CREATE POLICY "reminder_settings_select" ON public.reminder_settings
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

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications
    FOR SELECT TO authenticated
    USING (public.is_staff());

ALTER TABLE public.member_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "followups_select" ON public.member_followups;
CREATE POLICY "followups_select" ON public.member_followups
    FOR SELECT TO authenticated
    USING (public.is_staff());

-- ----------------------------------------------------------------------------
-- 14. STRICT PRIVILEGE GRANTS & REVOCATIONS
-- ----------------------------------------------------------------------------
-- Revoke all table, view, and function privileges from anon and PUBLIC
REVOKE ALL ON public.staff_invitations FROM PUBLIC, anon;
REVOKE ALL ON public.security_audit_logs FROM PUBLIC, anon;
REVOKE ALL ON public.v_staff_roster FROM PUBLIC, anon;
REVOKE ALL ON public.v_member_dues FROM PUBLIC, anon;
REVOKE ALL ON public.v_outstanding_payments FROM PUBLIC, anon;
REVOKE ALL ON public.v_active_members FROM PUBLIC, anon;
REVOKE ALL ON public.v_notifications FROM PUBLIC, anon;

-- Revoke mutation privileges on staff_invitations and security_audit_logs from authenticated
REVOKE ALL ON public.staff_invitations FROM authenticated;
REVOKE ALL ON public.security_audit_logs FROM authenticated;

-- Revoke direct mutation on payments and member_subscriptions from authenticated
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.member_subscriptions FROM authenticated;

-- Grant SELECT only to authenticated (gated by RLS)
GRANT SELECT ON public.staff_invitations TO authenticated;
GRANT SELECT ON public.security_audit_logs TO authenticated;
GRANT SELECT ON public.v_staff_roster TO authenticated;
GRANT SELECT ON public.v_active_members TO authenticated;
GRANT SELECT ON public.v_notifications TO authenticated;
GRANT SELECT ON public.v_member_dues TO authenticated;
GRANT SELECT ON public.v_outstanding_payments TO authenticated;

-- Grant execution of SECURITY DEFINER functions to authenticated role
GRANT EXECUTE ON FUNCTION public.create_staff_invitation(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resend_staff_invitation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_staff_invitation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_staff_invitation() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_status(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_staff_operational_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_dues_payment(uuid, uuid, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_pt_dues_payment(uuid, uuid, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renew_member_subscription(uuid, uuid, date, boolean, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.onboard_member(text, text, text, text, date, text, text, text, text, text, uuid, date, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_pt_package(uuid, uuid, uuid, date, numeric, text, text, text) TO authenticated;

-- Ensure profiles direct mutation remains permanently revoked
REVOKE DELETE, INSERT ON public.profiles FROM authenticated, anon, PUBLIC;

COMMIT;
