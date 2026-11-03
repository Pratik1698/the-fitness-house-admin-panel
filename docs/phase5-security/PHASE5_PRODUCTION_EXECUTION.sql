-- ============================================================================
-- THE FITNESS HOUSE — COMPLETE PHASE 5 PRODUCTION SQL EXECUTION SCRIPT
-- ============================================================================
-- Target Database: Hosted Supabase PostgreSQL 17.11
-- Target Supabase Project Reference: xfagvgypgboplonokntk
-- File: docs/phase5-security/PHASE5_PRODUCTION_EXECUTION.sql
-- Generated: 2026-11-03
--
-- PURPOSE:
-- Single-operation production execution script for Supabase Dashboard SQL Editor.
-- This script contains:
--   1. PART A: Pre-transaction validation of production profiles & session-level
--              temporary profile activation map setup with confirmed explicit UUIDs:
--              - Admin: 449e7fbc-42a0-42a0-970a-40186c14b653 (active)
--              - Staff: 35367862-cc44-4d30-be0d-bd097af236b5 (active)
--   2. PART B: Complete, verbatim, byte-for-byte Phase 5 candidate migration
--              (supabase/production-migrations/20261102_phase5_security_forward.sql)
--              enclosed in BEGIN ... COMMIT with strict preflight & postconditions.
--   3. PART C: Post-transaction explicit cleanup of temporary table.
--
-- EXECUTION INSTRUCTIONS:
--   1. Open the Supabase Dashboard -> Project "xfagvgypgboplonokntk".
--   2. Navigate to SQL Editor -> New Query.
--   3. Paste the ENTIRE contents of this file into the query editor.
--   4. Click "Run" (or press Ctrl+Enter).
--   5. Execution runs in a single database session:
--      - Part A validates the 2 explicit production accounts, creates and populates
--        pg_temp.phase5_profile_activation_map.
--      - Part B opens transaction, runs preflight, applies DDL, validates
--        postconditions, and commits atomically.
--      - Part C cleans up the temporary table.
--   6. Confirm "Success. No rows returned" or notice logs with zero exceptions.
--
-- VERIFICATION SHA-256 HASHES:
--   Embedded Candidate Migration SHA-256:
--     40184CB8C96DC193E1FD3D0F38C9C3711F57C40C41671C9FEFCBEC7C8BFE38B2
-- ============================================================================

-- ============================================================================
-- PART A: PRE-TRANSACTION VALIDATION & TEMPORARY PROFILE ACTIVATION MAP
-- ============================================================================

-- Assertion: Fail closed if unexpected profiles exist or expected profiles are missing
DO $check_production_profiles$
DECLARE
    v_admin_count integer;
    v_staff_count integer;
    v_total_count integer;
BEGIN
    -- Verify expected Admin profile
    SELECT count(*) INTO v_admin_count
    FROM public.profiles
    WHERE id = '449e7fbc-42a0-42a0-970a-40186c14b653'::uuid
      AND role = 'admin';

    IF v_admin_count <> 1 THEN
        RAISE EXCEPTION 'PRE-MIGRATION ASSERTION FAILED: Expected admin profile 449e7fbc-42a0-42a0-970a-40186c14b653 with role admin was not found in public.profiles.';
    END IF;

    -- Verify expected Staff profile
    SELECT count(*) INTO v_staff_count
    FROM public.profiles
    WHERE id = '35367862-cc44-4d30-be0d-bd097af236b5'::uuid
      AND role = 'staff';

    IF v_staff_count <> 1 THEN
        RAISE EXCEPTION 'PRE-MIGRATION ASSERTION FAILED: Expected staff profile 35367862-cc44-4d30-be0d-bd097af236b5 with role staff was not found in public.profiles.';
    END IF;

    -- Verify exact profile count (fail closed if a third profile exists)
    SELECT count(*) INTO v_total_count
    FROM public.profiles;

    IF v_total_count <> 2 THEN
        RAISE EXCEPTION 'PRE-MIGRATION ASSERTION FAILED: Expected exactly 2 profiles in public.profiles, found % profiles.', v_total_count;
    END IF;

    RAISE NOTICE 'Pre-migration assertion verified: Confirmed exactly 2 expected production profiles (Admin: 449e7fbc-42a0-42a0-970a-40186c14b653, Staff: 35367862-cc44-4d30-be0d-bd097af236b5).';
END;
$check_production_profiles$;

-- Safe handling for leftover temporary table in pooled connection:
DROP TABLE IF EXISTS pg_temp.phase5_profile_activation_map;

CREATE TEMP TABLE phase5_profile_activation_map (
    profile_id uuid PRIMARY KEY,
    is_active boolean NOT NULL,
    deactivated_at timestamptz NULL,
    source_reference text NOT NULL
);

-- Prepend confirmed profile activation map with the two explicit owner-confirmed production accounts:
INSERT INTO phase5_profile_activation_map (profile_id, is_active, deactivated_at, source_reference)
VALUES
    ('449e7fbc-42a0-42a0-970a-40186c14b653'::uuid, true, NULL, 'Authoritative Owner Signoff - Active Admin Profile 2026-11-03'),
    ('35367862-cc44-4d30-be0d-bd097af236b5'::uuid, true, NULL, 'Authoritative Owner Signoff - Active Staff Profile 2026-11-03');

-- Verification check before transaction begins:
DO $check_temp_map$
DECLARE
    v_map_count integer;
    v_prof_count integer;
BEGIN
    SELECT count(*) INTO v_map_count FROM pg_temp.phase5_profile_activation_map;
    SELECT count(*) INTO v_prof_count FROM public.profiles;
    IF v_map_count <> v_prof_count OR v_map_count <> 2 THEN
        RAISE EXCEPTION 'PRE-MIGRATION SETUP FAILED: phase5_profile_activation_map has % rows, expected exactly 2 rows matching public.profiles.',
            v_map_count;
    END IF;
    RAISE NOTICE 'Pre-migration setup verified: Exactly 2 explicit production profiles mapped as active for Phase 5 activation.';
END;
$check_temp_map$;

-- ============================================================================
-- PART B: VERBATIM CANDIDATE MIGRATION (BEGIN ... COMMIT)
-- Embedded candidate SHA-256: 40184CB8C96DC193E1FD3D0F38C9C3711F57C40C41671C9FEFCBEC7C8BFE38B2
-- Source file: supabase/production-migrations/20261102_phase5_security_forward.sql
-- ============================================================================
-- THE FITNESS HOUSE — PHASE 5 HOSTED FORWARD MIGRATION
--
-- This file is deliberately outside supabase/migrations and is not auto-applied.
-- It contains a strict, read-only compatibility preflight followed by the current
-- Phase 5 forward migrations in one transaction. The hosted schema inventory has
-- not been independently re-collected in this task. Run the DBA query in
-- docs/phase5-security/PRODUCTION_ACTIVATION_CHECKLIST.md and review its output
-- before considering this file for a production change window.
--
-- No DROP ... CASCADE, business-row DELETE, or TRUNCATE is used. If any preflight
-- check or DDL statement fails, the enclosing transaction rolls back.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

DO $phase5_preflight$
DECLARE
    v_req record;
    v_actual_type text;
    v_actual_generated text;
    v_actual_columns text[];
    v_relkind "char";
    v_name text;
BEGIN
    IF current_setting('server_version_num')::integer < 150000 THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: PostgreSQL 15+ is required for security_invoker views.';
    END IF;

    IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: Supabase Auth users and auth.uid() must exist.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='extensions')
       OR to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: The extensions schema and pgcrypto digest(bytea,text) are required.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname IN ('anon', 'authenticated', 'service_role')
        GROUP BY 1 HAVING count(*) = 3
    ) THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: Supabase roles anon, authenticated, and service_role must exist.';
    END IF;

    FOREACH v_name IN ARRAY ARRAY[
        'profiles','members','membership_plans','member_subscriptions','payments','pt_packages','trainers',
        'pt_assignments','pt_sessions','idempotency_keys','checkins','notifications','member_followups',
        'gym_info','reminder_settings'
    ] LOOP
        SELECT c.relkind INTO v_relkind
        FROM pg_catalog.pg_class c
        WHERE c.oid = to_regclass('public.' || v_name);
        IF v_relkind IS NULL OR v_relkind NOT IN ('r','p') THEN
            RAISE EXCEPTION 'PHASE5_PREFLIGHT: Required base relation public.% is missing or is not a table.', v_name;
        END IF;
    END LOOP;

    -- These are the exact base-table fields used by the latest Phase 5 SQL.
    -- New profile fields and Phase 5 tables are allowed to be absent; the migration adds them.
    FOR v_req IN
        SELECT * FROM (VALUES
            ('profiles','id','uuid','NEVER'), ('profiles','email','text','NEVER'),
            ('profiles','full_name','text','NEVER'), ('profiles','role','text','NEVER'),
            ('profiles','created_at','timestamp with time zone','NEVER'), ('profiles','updated_at','timestamp with time zone','NEVER'),
            ('members','id','uuid','NEVER'), ('members','member_code','text','NEVER'),
            ('members','name','text','NEVER'), ('members','phone','text','NEVER'), ('members','email','text','NEVER'),
            ('members','gender','text','NEVER'), ('members','dob','date','NEVER'), ('members','address','text','NEVER'),
            ('members','emergency_contact','text','NEVER'), ('members','blood_group','text','NEVER'),
            ('members','medical_notes','text','NEVER'), ('members','notes','text','NEVER'), ('members','is_archived','boolean','NEVER'),
            ('membership_plans','id','uuid','NEVER'), ('membership_plans','name','text','NEVER'),
            ('membership_plans','duration_days','integer','NEVER'), ('membership_plans','price','numeric','NEVER'),
            ('membership_plans','is_active','boolean','NEVER'),
            ('member_subscriptions','id','uuid','NEVER'), ('member_subscriptions','member_id','uuid','NEVER'),
            ('member_subscriptions','plan_id','uuid','NEVER'), ('member_subscriptions','plan_name','text','NEVER'),
            ('member_subscriptions','plan_price','numeric','NEVER'), ('member_subscriptions','previous_balance_carried','numeric','NEVER'),
            ('member_subscriptions','total_liability','numeric','ALWAYS'), ('member_subscriptions','amount_paid','numeric','NEVER'),
            ('member_subscriptions','balance','numeric','ALWAYS'), ('member_subscriptions','payment_status','text','ALWAYS'),
            ('member_subscriptions','status','text','NEVER'), ('member_subscriptions','start_date','date','NEVER'),
            ('member_subscriptions','expiry_date','date','NEVER'), ('member_subscriptions','updated_at','timestamp with time zone','NEVER'),
            ('pt_packages','id','uuid','NEVER'), ('pt_packages','name','text','NEVER'),
            ('pt_packages','total_sessions','integer','NEVER'), ('pt_packages','price','numeric','NEVER'), ('pt_packages','is_active','boolean','NEVER'),
            ('trainers','id','uuid','NEVER'), ('trainers','name','text','NEVER'), ('trainers','is_active','boolean','NEVER'),
            ('pt_assignments','id','uuid','NEVER'), ('pt_assignments','member_id','uuid','NEVER'),
            ('pt_assignments','package_id','uuid','NEVER'), ('pt_assignments','trainer_id','uuid','NEVER'),
            ('pt_assignments','total_sessions','integer','NEVER'), ('pt_assignments','completed_sessions','integer','NEVER'),
            ('pt_assignments','remaining_sessions','integer','ALWAYS'), ('pt_assignments','fee_amount','numeric','NEVER'),
            ('pt_assignments','amount_paid','numeric','NEVER'), ('pt_assignments','credit_adjustments','numeric','NEVER'),
            ('pt_assignments','balance','numeric','ALWAYS'), ('pt_assignments','payment_status','text','ALWAYS'),
            ('pt_assignments','status','text','NEVER'), ('pt_assignments','start_date','date','NEVER'),
            ('pt_assignments','notes','text','NEVER'), ('pt_assignments','created_at','timestamp with time zone','NEVER'),
            ('pt_assignments','updated_at','timestamp with time zone','NEVER'),
            ('pt_sessions','id','uuid','NEVER'), ('pt_sessions','assignment_id','uuid','NEVER'),
            ('pt_sessions','session_number','integer','NEVER'), ('pt_sessions','conducted_at','timestamp with time zone','NEVER'),
            ('pt_sessions','trainer_id','uuid','NEVER'), ('pt_sessions','actor_id','uuid','NEVER'),
            ('payments','id','uuid','NEVER'), ('payments','receipt_number','text','NEVER'), ('payments','member_id','uuid','NEVER'),
            ('payments','subscription_id','uuid','NEVER'), ('payments','pt_assignment_id','uuid','NEVER'),
            ('payments','transaction_type','text','NEVER'), ('payments','amount','numeric','NEVER'),
            ('payments','payment_method','text','NEVER'), ('payments','status','text','NEVER'),
            ('payments','refund_of_payment_id','uuid','NEVER'), ('payments','notes','text','NEVER'),
            ('payments','actor_id','uuid','NEVER'), ('payments','created_at','timestamp with time zone','NEVER'),
            ('idempotency_keys','actor_id','uuid','NEVER'), ('idempotency_keys','operation','text','NEVER'),
            ('idempotency_keys','idempotency_key','text','NEVER'), ('idempotency_keys','payload_hash','text','NEVER'),
            ('idempotency_keys','response','jsonb','NEVER'),
            ('checkins','id','uuid','NEVER'), ('checkins','member_id','uuid','NEVER'),
            ('checkins','checked_in_at','timestamp with time zone','NEVER'), ('checkins','checked_out_at','timestamp with time zone','NEVER'),
            ('checkins','status','text','NEVER'), ('checkins','actor_id','uuid','NEVER'),
            ('notifications','id','uuid','NEVER'), ('notifications','member_id','uuid','NEVER'),
            ('notifications','subscription_id','uuid','NEVER'), ('notifications','notification_type','text','NEVER'),
            ('notifications','title','text','NEVER'), ('notifications','message','text','NEVER'),
            ('notifications','target_date','date','NEVER'), ('notifications','status','text','NEVER'),
            ('notifications','read_at','timestamp with time zone','NEVER'), ('notifications','read_by','uuid','NEVER'),
            ('member_followups','id','uuid','NEVER'), ('member_followups','member_id','uuid','NEVER'),
            ('member_followups','category','text','NEVER'), ('member_followups','reason','text','NEVER'),
            ('member_followups','priority','text','NEVER'), ('member_followups','due_date','date','NEVER'),
            ('member_followups','status','text','NEVER'), ('member_followups','created_by','uuid','NEVER'),
            ('gym_info','id','uuid','NEVER'), ('reminder_settings','id','uuid','NEVER')
        ) AS required(table_name,column_name,data_type,is_generated)
    LOOP
        SELECT c.data_type, c.is_generated
        INTO v_actual_type, v_actual_generated
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'public'
          AND c.table_name = v_req.table_name
          AND c.column_name = v_req.column_name;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'PHASE5_PREFLIGHT: Required column public.%.% is missing.', v_req.table_name, v_req.column_name;
        END IF;
        IF v_actual_type IS DISTINCT FROM v_req.data_type OR v_actual_generated IS DISTINCT FROM v_req.is_generated THEN
            RAISE EXCEPTION 'PHASE5_PREFLIGHT: public.%.% has type/generated %,%; expected %,%.',
                v_req.table_name, v_req.column_name, v_actual_type, v_actual_generated, v_req.data_type, v_req.is_generated;
        END IF;
    END LOOP;

    -- Existing optional Phase 5 profile columns must have the exact intended types.
    FOR v_req IN
        SELECT * FROM (VALUES
            ('is_active','boolean'), ('deactivated_at','timestamp with time zone'), ('invited_by','uuid')
        ) AS required(column_name,data_type)
    LOOP
        SELECT c.data_type, c.is_generated INTO v_actual_type, v_actual_generated
        FROM information_schema.columns AS c
        WHERE c.table_schema='public' AND c.table_name='profiles' AND c.column_name=v_req.column_name;
        IF FOUND AND (v_actual_type IS DISTINCT FROM v_req.data_type OR v_actual_generated IS DISTINCT FROM 'NEVER') THEN
            RAISE EXCEPTION 'PHASE5_PREFLIGHT: public.profiles.% has type/generated %/%; expected %/NEVER.',
                v_req.column_name, v_actual_type, v_actual_generated, v_req.data_type;
        END IF;
    END LOOP;

    -- Existing invitation/audit tables may be absent, but partial or incompatible tables stop here.
    IF to_regclass('public.staff_invitations') IS NOT NULL THEN
        SELECT c.relkind INTO v_relkind FROM pg_catalog.pg_class c WHERE c.oid=to_regclass('public.staff_invitations');
        IF v_relkind NOT IN ('r','p') THEN
            RAISE EXCEPTION 'PHASE5_PREFLIGHT: Existing public.staff_invitations is not a table.';
        END IF;
        FOR v_req IN
            SELECT * FROM (VALUES
                ('id','uuid'),('email','text'),('full_name','text'),('role','text'),('status','text'),
                ('invited_by','uuid'),('auth_user_id','uuid'),('created_at','timestamp with time zone'),
                ('expires_at','timestamp with time zone'),('accepted_at','timestamp with time zone'),('revoked_at','timestamp with time zone')
            ) AS required(column_name,data_type)
        LOOP
            SELECT c.data_type INTO v_actual_type FROM information_schema.columns c
            WHERE c.table_schema='public' AND c.table_name='staff_invitations' AND c.column_name=v_req.column_name;
            IF NOT FOUND OR v_actual_type IS DISTINCT FROM v_req.data_type THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: Existing public.staff_invitations is missing or has an incompatible column %.', v_req.column_name;
            END IF;
        END LOOP;
    END IF;
    IF to_regclass('public.security_audit_logs') IS NOT NULL THEN
        SELECT c.relkind INTO v_relkind FROM pg_catalog.pg_class c WHERE c.oid=to_regclass('public.security_audit_logs');
        IF v_relkind NOT IN ('r','p') THEN
            RAISE EXCEPTION 'PHASE5_PREFLIGHT: Existing public.security_audit_logs is not a table.';
        END IF;
        FOR v_req IN
            SELECT * FROM (VALUES
                ('id','uuid'),('actor_id','uuid'),('target_user_id','uuid'),('action','text'),
                ('details','jsonb'),('created_at','timestamp with time zone')
            ) AS required(column_name,data_type)
        LOOP
            SELECT c.data_type INTO v_actual_type FROM information_schema.columns c
            WHERE c.table_schema='public' AND c.table_name='security_audit_logs' AND c.column_name=v_req.column_name;
            IF NOT FOUND OR v_actual_type IS DISTINCT FROM v_req.data_type THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: Existing public.security_audit_logs is missing or has an incompatible column %.', v_req.column_name;
            END IF;
        END LOOP;
    END IF;

    -- CREATE OR REPLACE VIEW can preserve dependencies only when existing output columns remain compatible.
    -- Baseline pre-migration contracts and target Phase 5 contracts are checked before any replacement begins.
    FOR v_req IN
        SELECT * FROM (VALUES
            ('v_staff_roster',
             ARRAY['id','full_name','role','created_at']::text[],
             ARRAY['id','full_name','role','created_at','is_active','deactivated_at']::text[],
             false),
            ('v_active_members',
             ARRAY['id','member_code','name','phone','email','gender','dob','is_archived','current_subscription_id','plan_name','plan_price','total_liability','amount_paid','balance','payment_status','start_date','expiry_date','subscription_status']::text[],
             ARRAY['id','member_code','name','phone','email','gender','dob','is_archived','current_subscription_id','plan_name','plan_price','total_liability','amount_paid','balance','payment_status','start_date','expiry_date','subscription_status']::text[],
             false),
            ('v_member_dues',
             ARRAY['member_id','member_code','member_name','phone','email','is_archived','subscription_id','plan_name','start_date','expiry_date','total_amount_due','amount_paid','outstanding_balance','payment_status','subscription_status']::text[],
             ARRAY['member_id','member_code','member_name','phone','email','is_archived','subscription_id','plan_name','start_date','expiry_date','total_amount_due','amount_paid','outstanding_balance','payment_status','subscription_status']::text[],
             false),
            ('v_outstanding_payments',
             ARRAY['member_id','member_code','member_name','phone','email','is_archived','subscription_id','plan_name','start_date','expiry_date','total_amount_due','amount_paid','outstanding_balance','payment_status','subscription_status']::text[],
             ARRAY['member_id','member_code','member_name','phone','email','is_archived','subscription_id','plan_name','start_date','expiry_date','total_amount_due','amount_paid','outstanding_balance','payment_status','subscription_status']::text[],
             false),
            ('v_notifications',
             ARRAY['id','member_id','subscription_id','member_code','member_name','member_phone','plan_name','subscription_status','start_date','expiry_date','current_balance','notification_type','title','message','days_remaining','target_date','channel','status','read_at','read_by','created_at','updated_at','is_superseded','whatsapp_sent_at','whatsapp_sent_by','whatsapp_sent_by_name']::text[],
             ARRAY['id','member_id','subscription_id','member_code','member_name','member_phone','plan_name','subscription_status','start_date','expiry_date','current_balance','notification_type','title','message','days_remaining','target_date','channel','status','read_at','read_by','created_at','updated_at','is_superseded','whatsapp_sent_at','whatsapp_sent_by','whatsapp_sent_by_name']::text[],
             false),
            ('v_member_followups',
             ARRAY['id','member_id','member_code','member_name','phone','category','reason','priority','due_date','status','notes','outcome','completed_at','created_at','updated_at']::text[],
             ARRAY['id','member_id','member_code','member_name','phone','category','reason','priority','due_date','status','notes','outcome','completed_at','created_at','updated_at']::text[],
             true),
            ('v_admin_pt_assignments',
             NULL::text[],
             ARRAY['id','member_id','package_id','trainer_id','total_sessions','completed_sessions','fee_amount','amount_paid','balance','status','start_date','notes','created_at']::text[],
             false),
            ('v_attendance_logs',
             ARRAY['id','checkin_code','member_id','member_code','member_name','member_phone','plan_name','checked_in_at','checked_out_at','status','notes','actor_id','actor_name','created_at','updated_at']::text[],
             ARRAY['id','checkin_code','member_id','member_code','member_name','member_phone','plan_name','checked_in_at','checked_out_at','status','notes','actor_id','actor_name','created_at','updated_at']::text[],
             true)
        ) AS expected(view_name,baseline_columns,target_columns,required_existing)
    LOOP
        IF to_regclass('public.' || v_req.view_name) IS NULL THEN
            IF v_req.required_existing THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: Required existing view public.% is missing.', v_req.view_name;
            END IF;
        ELSE
            SELECT c.relkind INTO v_relkind
            FROM pg_catalog.pg_class c
            WHERE c.oid = to_regclass('public.' || v_req.view_name);
            IF v_relkind <> 'v' THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: public.% exists but is not a regular view.', v_req.view_name;
            END IF;
            SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_actual_columns
            FROM pg_catalog.pg_attribute a
            WHERE a.attrelid = to_regclass('public.' || v_req.view_name)
              AND a.attnum > 0 AND NOT a.attisdropped;
            IF (v_req.baseline_columns IS NULL OR v_actual_columns IS DISTINCT FROM v_req.baseline_columns)
               AND (v_req.target_columns IS NULL OR v_actual_columns IS DISTINCT FROM v_req.target_columns) THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: public.% output columns differ. Actual %, expected baseline % or target %.',
                    v_req.view_name, v_actual_columns, v_req.baseline_columns, v_req.target_columns;
            END IF;
        END IF;
    END LOOP;

    -- Do not overwrite an overload accidentally. If a Phase 5 function name already exists,
    -- its expected argument identity must also exist; the later DDL still checks return types.
    FOR v_req IN
        SELECT * FROM (VALUES
            ('get_user_role','public.get_user_role()'), ('is_admin','public.is_admin()'), ('is_staff','public.is_staff()'),
            ('admin_set_user_status','public.admin_set_user_status(uuid,boolean)'),
            ('admin_set_user_role','public.admin_set_user_role(uuid,text)'),
            ('create_staff_invitation','public.create_staff_invitation(text,text)'),
            ('resend_staff_invitation','public.resend_staff_invitation(uuid)'),
            ('revoke_staff_invitation','public.revoke_staff_invitation(uuid)'),
            ('accept_staff_invitation','public.accept_staff_invitation()'),
            ('can_accept_staff_invitation','public.can_accept_staff_invitation()'),
            ('record_dues_payment','public.record_dues_payment(uuid,uuid,numeric,text,text,text)'),
            ('record_pt_dues_payment','public.record_pt_dues_payment(uuid,uuid,numeric,text,text,text)'),
            ('renew_member_subscription','public.renew_member_subscription(uuid,uuid,date,boolean,numeric,text,text)'),
            ('onboard_member','public.onboard_member(text,text,text,text,date,text,text,text,text,text,uuid,date,numeric,text,text)'),
            ('assign_pt_package','public.assign_pt_package(uuid,uuid,uuid,date,numeric,text,text,text)'),
            ('get_staff_operational_summary','public.get_staff_operational_summary()'),
            ('record_member_checkin','public.record_member_checkin(uuid,text)'),
            ('record_member_checkout','public.record_member_checkout(uuid,text)'),
            ('cancel_member_checkin','public.cancel_member_checkin(uuid,text)'),
            ('complete_pt_session','public.complete_pt_session(uuid,text)')
        ) AS expected(function_name,signature)
    LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='public' AND p.proname=v_req.function_name)
           AND to_regprocedure(v_req.signature) IS NULL THEN
            RAISE EXCEPTION 'PHASE5_PREFLIGHT: Existing public.% overload differs from expected signature %.',
                v_req.function_name, v_req.signature;
        END IF;
    END LOOP;

    -- Unknown policies on sensitive relations can OR-bypass a new permissive gate or alter workflows.
    -- Only known current policies and the specifically removed legacy names are accepted.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies p
        WHERE p.schemaname='public'
          AND p.tablename = ANY (ARRAY['profiles','members','member_subscriptions','payments','pt_assignments',
                                       'pt_packages','idempotency_keys','member_followups','staff_invitations','security_audit_logs'])
          AND p.policyname <> ALL (ARRAY[
              'profiles_select_self_or_admin','profiles_update_self','profiles_admin_all',
              'members_admin_delete','members_select','members_update_staff',
              'subscriptions_select','payments_select','pt_assignments_select','pt_assignments_update_staff',
              'packages_admin','pt_packages_select_all','pt_packages_select_active','packages_select',
              'idempotency_actor_access','member_followups_insert','member_followups_select','member_followups_update','followups_select',
              'staff_invitations_select_admin','staff_invitations_admin_all',
              'security_audit_logs_select_admin','security_audit_logs_insert_admin'
          ])
    ) THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: Unknown RLS policy exists on a sensitive relation; review pg_policies before applying.';
    END IF;

    FOREACH v_name IN ARRAY ARRAY[
        'public.member_code_seq','public.receipt_number_seq','public.checkin_code_seq'
    ] LOOP
        SELECT c.relkind INTO v_relkind FROM pg_catalog.pg_class c WHERE c.oid=to_regclass(v_name);
        IF v_relkind IS DISTINCT FROM 'S' THEN
            RAISE EXCEPTION 'PHASE5_PREFLIGHT: Required sequence % is missing or is not a sequence.', v_name;
        END IF;
    END LOOP;
END;
$phase5_preflight$;

-- Deep catalog contract: names alone are insufficient for policies, overloads,
-- triggers, views, and objects accepted by IF NOT EXISTS.
DO $phase5_deep_preflight$
DECLARE
    v_req record;
    v_actual text;
    v_count bigint;
    v_columns text[];
    v_dependencies text[];
    v_reloptions text[];
    v_needs_profile_map boolean := false;
    v_has_is_active boolean;
    v_has_deactivated_at boolean;
BEGIN
    IF current_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: Run the reviewed bundle as postgres or supabase_admin.';
    END IF;

    -- Existing disabled users must remain disabled. A missing/new activation column
    -- on a populated profile table requires a complete, reviewed same-session map.
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='profiles' AND column_name='is_active'
    ) INTO v_has_is_active;
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='profiles' AND column_name='deactivated_at'
    ) INTO v_has_deactivated_at;

    IF EXISTS (SELECT 1 FROM public.profiles) THEN
        IF NOT v_has_is_active THEN
            v_needs_profile_map := true;
        ELSE
            EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.profiles WHERE is_active IS NULL)'
            INTO v_needs_profile_map;
            IF v_has_deactivated_at THEN
                EXECUTE 'SELECT $1 OR EXISTS (SELECT 1 FROM public.profiles WHERE is_active IS TRUE AND deactivated_at IS NOT NULL)'
                INTO v_needs_profile_map USING v_needs_profile_map;
            END IF;
        END IF;
    END IF;

    IF v_needs_profile_map AND to_regclass('pg_temp.phase5_profile_activation_map') IS NULL THEN
        RAISE EXCEPTION 'PHASE5_PROFILE_MAP_REQUIRED: Existing profile activation state cannot be inferred safely. Supply a complete reviewed pg_temp.phase5_profile_activation_map in the same SQL session.';
    END IF;

    IF to_regclass('pg_temp.phase5_profile_activation_map') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pg_temp.phase5_profile_activation_map') AND attname='profile_id' AND format_type(atttypid,atttypmod)='uuid' AND NOT attisdropped)
           OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pg_temp.phase5_profile_activation_map') AND attname='is_active' AND format_type(atttypid,atttypmod)='boolean' AND NOT attisdropped)
           OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pg_temp.phase5_profile_activation_map') AND attname='deactivated_at' AND format_type(atttypid,atttypmod)='timestamp with time zone' AND NOT attisdropped)
           OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pg_temp.phase5_profile_activation_map') AND attname='source_reference' AND format_type(atttypid,atttypmod)='text' AND NOT attisdropped) THEN
            RAISE EXCEPTION 'PHASE5_PROFILE_MAP_INVALID: The same-session profile map is missing a required column.';
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_temp.phase5_profile_activation_map
            WHERE profile_id IS NULL OR is_active IS NULL OR source_reference IS NULL OR btrim(source_reference)=''
               OR (is_active IS TRUE AND deactivated_at IS NOT NULL)
        ) OR (SELECT count(*) FROM pg_temp.phase5_profile_activation_map) <> (SELECT count(*) FROM public.profiles)
          OR EXISTS (
              SELECT 1 FROM public.profiles p FULL JOIN pg_temp.phase5_profile_activation_map m ON m.profile_id=p.id
              WHERE p.id IS NULL OR m.profile_id IS NULL
          ) THEN
            RAISE EXCEPTION 'PHASE5_PROFILE_MAP_INVALID: The map must explicitly and validly cover every existing profile exactly once.';
        END IF;
    END IF;

    -- Every existing policy on Phase 5 relations must match a reviewed definition.
    -- Rows marked legacy are exact historical definitions that the bundled DDL replaces.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies p
        WHERE p.schemaname='public'
          AND p.tablename = ANY (ARRAY[
              'profiles','members','membership_plans','member_subscriptions','payments','pt_packages',
              'trainers','pt_assignments','pt_sessions','idempotency_keys','checkins','notifications',
              'member_followups','gym_info','reminder_settings','staff_invitations','security_audit_logs'
          ])
          AND NOT EXISTS (
              SELECT 1
              FROM (VALUES
                  ('profiles','profiles_select_self_or_admin','PERMISSIVE','{authenticated}','SELECT','((id = auth.uid()) OR is_admin())',NULL::text,true),
                  ('profiles','profiles_update_self','PERMISSIVE','{authenticated}','UPDATE','(id = auth.uid())','(id = auth.uid())',true),
                  ('profiles','profiles_admin_all','PERMISSIVE','{authenticated}','ALL','is_admin()','is_admin()',false),
                  ('members','members_admin_delete','PERMISSIVE','{authenticated}','DELETE','is_admin()',NULL::text,true),
                  ('members','members_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text,false),
                  ('members','members_select','PERMISSIVE','{authenticated}','SELECT','true',NULL::text,false),
                  ('members','members_update_staff','PERMISSIVE','{authenticated}','UPDATE','(is_staff() AND (is_archived = false))','is_staff()',false),
                  ('members','members_update_staff','PERMISSIVE','{authenticated}','UPDATE','(is_archived = false)','true',false),
                  ('membership_plans','plans_admin','PERMISSIVE','{authenticated}','ALL','is_admin()','is_admin()',true),
                  ('membership_plans','plans_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text,false),
                  ('membership_plans','plans_select','PERMISSIVE','{authenticated}','SELECT','true',NULL::text,false),
                  ('member_subscriptions','subscriptions_select','PERMISSIVE','{authenticated}','SELECT','is_admin()',NULL::text,false),
                  ('member_subscriptions','subscriptions_select','PERMISSIVE','{authenticated}','SELECT','true',NULL::text,false),
                  ('payments','payments_select','PERMISSIVE','{authenticated}','SELECT','is_admin()',NULL::text,false),
                  ('payments','payments_select','PERMISSIVE','{authenticated}','SELECT','true',NULL::text,false),
                  ('pt_packages','packages_admin','PERMISSIVE','{authenticated}','ALL','is_admin()','is_admin()',true),
                  ('pt_packages','pt_packages_select_all','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text,false),
                  ('pt_packages','packages_select','PERMISSIVE','{authenticated}','SELECT','true',NULL::text,false),
                  ('trainers','trainers_admin','PERMISSIVE','{authenticated}','ALL','is_admin()','is_admin()',true),
                  ('trainers','trainers_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text,false),
                  ('trainers','trainers_select','PERMISSIVE','{authenticated}','SELECT','true',NULL::text,false),
                  ('pt_assignments','pt_assignments_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text,false),
                  ('pt_assignments','pt_assignments_select','PERMISSIVE','{authenticated}','SELECT','true',NULL::text,false),
                  ('pt_assignments','pt_assignments_update_staff','PERMISSIVE','{authenticated}','UPDATE','is_staff()','is_staff()',false),
                  ('pt_assignments','pt_assignments_update_staff','PERMISSIVE','{authenticated}','UPDATE','true','true',false),
                  ('pt_sessions','pt_sessions_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text,false),
                  ('pt_sessions','pt_sessions_select','PERMISSIVE','{authenticated}','SELECT','true',NULL::text,false),
                  ('idempotency_keys','idempotency_actor_access','PERMISSIVE','{authenticated}','ALL','(actor_id = auth.uid())','(actor_id = auth.uid())',true),
                  ('checkins','checkins_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text,false),
                  ('checkins','checkins_select','PERMISSIVE','{authenticated}','SELECT','true',NULL::text,false),
                  ('checkins','checkins_insert','PERMISSIVE','{authenticated}','INSERT',NULL::text,'is_staff()',false),
                  ('notifications','notifications_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text,false),
                  ('notifications','notifications_select','PERMISSIVE','{authenticated}','SELECT','(get_user_role() = ANY (ARRAY[''admin''::text, ''staff''::text]))',NULL::text,false),
                  ('member_followups','member_followups_insert','PERMISSIVE','{authenticated}','INSERT',NULL::text,'(get_user_role() = ANY (ARRAY[''admin''::text, ''staff''::text]))',true),
                  ('member_followups','member_followups_select','PERMISSIVE','{authenticated}','SELECT','(get_user_role() = ANY (ARRAY[''admin''::text, ''staff''::text]))',NULL::text,true),
                  ('member_followups','member_followups_update','PERMISSIVE','{authenticated}','UPDATE','(get_user_role() = ANY (ARRAY[''admin''::text, ''staff''::text]))',NULL::text,true),
                  ('member_followups','followups_select','PERMISSIVE','{authenticated}','SELECT','true',NULL::text,false),
                  ('gym_info','gym_info_admin','PERMISSIVE','{authenticated}','ALL','is_admin()','is_admin()',true),
                  ('gym_info','gym_info_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text,false),
                  ('gym_info','gym_info_select','PERMISSIVE','{authenticated}','SELECT','true',NULL::text,false),
                  ('reminder_settings','reminder_settings_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text,false),
                  ('reminder_settings','reminder_settings_select','PERMISSIVE','{authenticated}','SELECT','(get_user_role() = ANY (ARRAY[''admin''::text, ''staff''::text]))',NULL::text,false),
                  ('reminder_settings','reminder_settings_update','PERMISSIVE','{authenticated}','UPDATE','is_admin()','is_admin()',true),
                  ('staff_invitations','staff_invitations_select_admin','PERMISSIVE','{authenticated}','SELECT','is_admin()',NULL::text,false),
                  ('staff_invitations','staff_invitations_admin_all','PERMISSIVE','{authenticated}','ALL','is_admin()','is_admin()',false),
                  ('security_audit_logs','security_audit_logs_select_admin','PERMISSIVE','{authenticated}','SELECT','is_admin()',NULL::text,false),
                  ('security_audit_logs','security_audit_logs_insert_admin','PERMISSIVE','{authenticated}','INSERT',NULL::text,'is_admin()',false)
              ) AS e(tablename,policyname,permissive,roles,cmd,qual,with_check,required_before)
              WHERE e.tablename=p.tablename AND e.policyname=p.policyname
                AND e.permissive=p.permissive AND e.roles=p.roles::text AND e.cmd=p.cmd
                AND e.qual IS NOT DISTINCT FROM p.qual
                AND e.with_check IS NOT DISTINCT FROM p.with_check
          )
    ) THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: A Phase 5 policy has an unexpected role, command, permissiveness, USING, WITH CHECK, or name. Review pg_policies before applying.';
    END IF;

    -- Policies that Phase 5 preserves must already exist exactly as reviewed.
    IF EXISTS (
        SELECT 1 FROM (VALUES
            ('profiles','profiles_select_self_or_admin'),('profiles','profiles_update_self'),
            ('members','members_admin_delete'),('membership_plans','plans_admin'),
            ('pt_packages','packages_admin'),('trainers','trainers_admin'),
            ('idempotency_keys','idempotency_actor_access'),
            ('member_followups','member_followups_insert'),('member_followups','member_followups_select'),('member_followups','member_followups_update'),
            ('gym_info','gym_info_admin'),('reminder_settings','reminder_settings_update')
        ) AS required(tablename,policyname)
        WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename=required.tablename AND p.policyname=required.policyname)
    ) THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: A policy that the bundle preserves is missing.';
    END IF;

    -- Existing same-name function overloads must be exact and safely owned/configured.
    FOR v_req IN
        SELECT * FROM (VALUES
            ('get_user_role','public.get_user_role()','','text'),
            ('is_admin','public.is_admin()','','boolean'),
            ('is_staff','public.is_staff()','','boolean'),
            ('admin_set_user_status','public.admin_set_user_status(uuid,boolean)','p_user_id uuid, p_is_active boolean','jsonb'),
            ('admin_set_user_role','public.admin_set_user_role(uuid,text)','p_user_id uuid, p_role text','jsonb'),
            ('create_staff_invitation','public.create_staff_invitation(text,text)','p_email text, p_full_name text','jsonb'),
            ('resend_staff_invitation','public.resend_staff_invitation(uuid)','p_invitation_id uuid','jsonb'),
            ('revoke_staff_invitation','public.revoke_staff_invitation(uuid)','p_invitation_id uuid','jsonb'),
            ('accept_staff_invitation','public.accept_staff_invitation()','','jsonb'),
            ('can_accept_staff_invitation','public.can_accept_staff_invitation()','','boolean'),
            ('record_dues_payment','public.record_dues_payment(uuid,uuid,numeric,text,text,text)','p_member_id uuid, p_subscription_id uuid, p_amount numeric, p_payment_method text, p_notes text, p_idempotency_key text','jsonb'),
            ('record_pt_dues_payment','public.record_pt_dues_payment(uuid,uuid,numeric,text,text,text)','p_member_id uuid, p_pt_assignment_id uuid, p_amount numeric, p_payment_method text, p_notes text, p_idempotency_key text','jsonb'),
            ('renew_member_subscription','public.renew_member_subscription(uuid,uuid,date,boolean,numeric,text,text)','p_member_id uuid, p_plan_id uuid, p_start_date date, p_carry_forward_balance boolean, p_payment_amount numeric, p_payment_method text, p_idempotency_key text','jsonb'),
            ('onboard_member','public.onboard_member(text,text,text,text,date,text,text,text,text,text,uuid,date,numeric,text,text)','p_name text, p_phone text, p_email text, p_gender text, p_dob date, p_address text, p_emergency_contact text, p_blood_group text, p_medical_notes text, p_notes text, p_plan_id uuid, p_start_date date, p_initial_payment_amount numeric, p_payment_method text, p_idempotency_key text','jsonb'),
            ('assign_pt_package','public.assign_pt_package(uuid,uuid,uuid,date,numeric,text,text,text)','p_member_id uuid, p_package_id uuid, p_trainer_id uuid, p_start_date date, p_initial_payment_amount numeric, p_payment_method text, p_notes text, p_idempotency_key text','jsonb'),
            ('get_staff_operational_summary','public.get_staff_operational_summary()','','jsonb'),
            ('record_member_checkin','public.record_member_checkin(uuid,text)','p_member_id uuid, p_notes text DEFAULT NULL::text','jsonb'),
            ('record_member_checkout','public.record_member_checkout(uuid,text)','p_checkin_id uuid, p_notes text DEFAULT NULL::text','jsonb'),
            ('cancel_member_checkin','public.cancel_member_checkin(uuid,text)','p_checkin_id uuid, p_reason text DEFAULT NULL::text','jsonb'),
            ('complete_pt_session','public.complete_pt_session(uuid,text)','p_assignment_id uuid, p_notes text','jsonb'),
            ('fn_on_auth_user_created','public.fn_on_auth_user_created()','','trigger'),
            ('fn_sync_payment_balances','public.fn_sync_payment_balances()','','trigger'),
            ('fn_prevent_tamper_payment_records','public.fn_prevent_tamper_payment_records()','','trigger'),
            ('audit_staff_invitation_changes','public.audit_staff_invitation_changes()','','trigger'),
            ('hash_payload','public.hash_payload(jsonb)','p_payload jsonb','text'),
            ('generate_member_code','public.generate_member_code()','','text'),
            ('generate_receipt_number','public.generate_receipt_number()','','text'),
            ('generate_checkin_code','public.generate_checkin_code()','','text')
        ) AS expected(function_name,signature,arguments,result_type)
    LOOP
        SELECT count(*) INTO v_count
        FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=v_req.function_name;
        IF v_count > 0 THEN
            IF v_count <> 1 OR to_regprocedure(v_req.signature) IS NULL THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: public.% has missing or unexpected overloads; expected only %.', v_req.function_name, v_req.signature;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_proc p
                WHERE p.oid=to_regprocedure(v_req.signature)
                  AND pg_get_function_arguments(p.oid)=v_req.arguments
                  AND pg_get_function_result(p.oid)=v_req.result_type
                  AND p.prokind='f' AND p.prosecdef
                  AND pg_get_userbyid(p.proowner) IN ('postgres','supabase_admin')
            ) THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: Existing public.% signature, argument names, result, owner, or SECURITY DEFINER setting is incompatible.', v_req.function_name;
            END IF;

            IF EXISTS (
                SELECT 1 FROM pg_catalog.pg_proc p
                CROSS JOIN LATERAL unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg(setting)
                CROSS JOIN LATERAL unnest(string_to_array(regexp_replace(cfg.setting, '^search_path=', ''), ',')) AS path(path_part)
                WHERE p.oid=to_regprocedure(v_req.signature)
                  AND (cfg.setting NOT LIKE 'search_path=%' OR btrim(path.path_part) NOT IN ('pg_catalog','public','extensions','pg_temp'))
            ) OR NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_proc p
                WHERE p.oid=to_regprocedure(v_req.signature)
                  AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg(setting) WHERE cfg.setting LIKE 'search_path=%')
            ) THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: Existing SECURITY DEFINER public.% has an unsafe or unset search_path.', v_req.function_name;
            END IF;

            IF EXISTS (
                SELECT 1 FROM pg_catalog.pg_proc p
                CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) acl
                LEFT JOIN pg_catalog.pg_roles r ON r.oid=acl.grantee
                WHERE p.oid=to_regprocedure(v_req.signature)
                  AND acl.privilege_type='EXECUTE'
                  AND acl.grantee <> p.proowner
                  AND acl.grantee <> 0
                  AND coalesce(r.rolname,'') NOT IN ('anon','authenticated','service_role')
            ) THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: Existing public.% has an EXECUTE ACL granted to an unreviewed role.', v_req.function_name;
            END IF;
        END IF;
    END LOOP;

    -- Payment sync and tamper protection must be exactly the reviewed local implementation.
    IF (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal) <> 2
       OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal AND t.tgname='trg_sync_payment_balances') <> 1
       OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal AND t.tgfoid='public.fn_sync_payment_balances()'::regprocedure) <> 1
       OR NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_trigger t
            WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal
              AND t.tgname='trg_sync_payment_balances' AND t.tgfoid='public.fn_sync_payment_balances()'::regprocedure
              AND t.tgtype=29 AND t.tgenabled='O' AND t.tgqual IS NULL AND t.tgnargs=0
              AND pg_get_triggerdef(t.oid,true)='CREATE TRIGGER trg_sync_payment_balances AFTER INSERT OR DELETE OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION fn_sync_payment_balances()'
       ) THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: trg_sync_payment_balances is missing, duplicated, disabled, or differs from the reviewed trigger definition.';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal AND t.tgname='trg_prevent_tamper_payment_records') <> 1
       OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal AND t.tgfoid='public.fn_prevent_tamper_payment_records()'::regprocedure) <> 1
       OR NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_trigger t
            WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal
              AND t.tgname='trg_prevent_tamper_payment_records' AND t.tgfoid='public.fn_prevent_tamper_payment_records()'::regprocedure
              AND t.tgtype=27 AND t.tgenabled='O' AND t.tgqual IS NULL AND t.tgnargs=0
              AND pg_get_triggerdef(t.oid,true)='CREATE TRIGGER trg_prevent_tamper_payment_records BEFORE DELETE OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION fn_prevent_tamper_payment_records()'
       ) THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: trg_prevent_tamper_payment_records is missing, duplicated, disabled, or differs from its reviewed definition.';
    END IF;
    IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.fn_sync_payment_balances()'::regprocedure) <> 'd6826b74faa7abbf0ba71520c623052e'
       OR (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.fn_prevent_tamper_payment_records()'::regprocedure) <> '8b4e85e78a586d8588e1eda8df15c5db' THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: A payment trigger function body differs from the reviewed local migration implementation.';
    END IF;

    IF (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal) <> 1
       OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal AND t.tgname='trg_on_auth_user_created') <> 1
       OR NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_trigger t
            WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal
              AND t.tgname='trg_on_auth_user_created' AND t.tgfoid='public.fn_on_auth_user_created()'::regprocedure
              AND t.tgtype=5 AND t.tgenabled='O' AND t.tgqual IS NULL AND t.tgnargs=0
              AND pg_get_triggerdef(t.oid,true)='CREATE TRIGGER trg_on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION fn_on_auth_user_created()'
       ) THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: Auth user creation trigger is missing, duplicated, disabled, or differs from the reviewed definition.';
    END IF;
    IF to_regclass('public.staff_invitations') IS NOT NULL AND (
        (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=to_regclass('public.staff_invitations') AND NOT t.tgisinternal AND t.tgname='trg_audit_staff_invitation_changes') > 1
        OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=to_regclass('public.staff_invitations') AND NOT t.tgisinternal AND t.tgfoid=to_regprocedure('public.audit_staff_invitation_changes()')) > 1
        OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_trigger t
            WHERE t.tgrelid=to_regclass('public.staff_invitations') AND NOT t.tgisinternal
              AND (t.tgname <> 'trg_audit_staff_invitation_changes'
                OR t.tgfoid <> to_regprocedure('public.audit_staff_invitation_changes()')
                OR t.tgtype <> 21 OR t.tgenabled <> 'O' OR t.tgqual IS NOT NULL OR t.tgnargs <> 0
                OR pg_get_triggerdef(t.oid,true) <> 'CREATE TRIGGER trg_audit_staff_invitation_changes AFTER INSERT OR UPDATE OF status, expires_at ON staff_invitations FOR EACH ROW EXECUTE FUNCTION audit_staff_invitation_changes()')
        )
    ) THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: Existing staff invitation triggers are duplicated or differ from the reviewed audit trigger.';
    END IF;

    -- CREATE OR REPLACE VIEW is permitted only for exact ordered name/type contracts,
    -- reviewed owners/options, and known base dependencies.
    -- Baseline pre-migration contracts and target Phase 5 contracts are checked before DDL.
    FOR v_req IN
        SELECT * FROM (VALUES
            ('v_staff_roster',
             ARRAY['id:uuid','full_name:text','role:text','created_at:timestamp with time zone']::text[],
             ARRAY['id:uuid','full_name:text','role:text','created_at:timestamp with time zone','is_active:boolean','deactivated_at:timestamp with time zone']::text[],
             ARRAY['profiles']::text[],
             false,
             ARRAY['security_invoker=false']::text[],
             ARRAY['security_invoker=false','security_barrier=true']::text[]),
            ('v_active_members',
             ARRAY['id:uuid','member_code:text','name:text','phone:text','email:text','gender:text','dob:date','is_archived:boolean','current_subscription_id:uuid','plan_name:text','plan_price:numeric(12,2)','total_liability:numeric(12,2)','amount_paid:numeric(12,2)','balance:numeric(12,2)','payment_status:text','start_date:date','expiry_date:date','subscription_status:text']::text[],
             ARRAY['id:uuid','member_code:text','name:text','phone:text','email:text','gender:text','dob:date','is_archived:boolean','current_subscription_id:uuid','plan_name:text','plan_price:numeric(12,2)','total_liability:numeric(12,2)','amount_paid:numeric(12,2)','balance:numeric(12,2)','payment_status:text','start_date:date','expiry_date:date','subscription_status:text']::text[],
             ARRAY['member_subscriptions','members']::text[],
             false,
             ARRAY['security_invoker=true']::text[],
             ARRAY['security_invoker=false','security_barrier=true']::text[]),
            ('v_member_dues',
             ARRAY['member_id:uuid','member_code:text','member_name:text','phone:text','email:text','is_archived:boolean','subscription_id:uuid','plan_name:text','start_date:date','expiry_date:date','total_amount_due:numeric(12,2)','amount_paid:numeric(12,2)','outstanding_balance:numeric(12,2)','payment_status:text','subscription_status:text']::text[],
             ARRAY['member_id:uuid','member_code:text','member_name:text','phone:text','email:text','is_archived:boolean','subscription_id:uuid','plan_name:text','start_date:date','expiry_date:date','total_amount_due:numeric(12,2)','amount_paid:numeric(12,2)','outstanding_balance:numeric(12,2)','payment_status:text','subscription_status:text']::text[],
             ARRAY['member_subscriptions','members']::text[],
             false,
             NULL::text[],
             ARRAY['security_invoker=false','security_barrier=true']::text[]),
            ('v_outstanding_payments',
             ARRAY['member_id:uuid','member_code:text','member_name:text','phone:text','email:text','is_archived:boolean','subscription_id:uuid','plan_name:text','start_date:date','expiry_date:date','total_amount_due:numeric(12,2)','amount_paid:numeric(12,2)','outstanding_balance:numeric(12,2)','payment_status:text','subscription_status:text']::text[],
             ARRAY['member_id:uuid','member_code:text','member_name:text','phone:text','email:text','is_archived:boolean','subscription_id:uuid','plan_name:text','start_date:date','expiry_date:date','total_amount_due:numeric(12,2)','amount_paid:numeric(12,2)','outstanding_balance:numeric(12,2)','payment_status:text','subscription_status:text']::text[],
             ARRAY['v_member_dues']::text[],
             false,
             NULL::text[],
             ARRAY['security_invoker=false','security_barrier=true']::text[]),
            ('v_notifications',
             ARRAY['id:uuid','member_id:uuid','subscription_id:uuid','member_code:text','member_name:text','member_phone:text','plan_name:text','subscription_status:text','start_date:date','expiry_date:date','current_balance:numeric','notification_type:text','title:text','message:text','days_remaining:integer','target_date:date','channel:text','status:text','read_at:timestamp with time zone','read_by:uuid','created_at:timestamp with time zone','updated_at:timestamp with time zone','is_superseded:boolean','whatsapp_sent_at:timestamp with time zone','whatsapp_sent_by:uuid','whatsapp_sent_by_name:text']::text[],
             ARRAY['id:uuid','member_id:uuid','subscription_id:uuid','member_code:text','member_name:text','member_phone:text','plan_name:text','subscription_status:text','start_date:date','expiry_date:date','current_balance:numeric','notification_type:text','title:text','message:text','days_remaining:integer','target_date:date','channel:text','status:text','read_at:timestamp with time zone','read_by:uuid','created_at:timestamp with time zone','updated_at:timestamp with time zone','is_superseded:boolean','whatsapp_sent_at:timestamp with time zone','whatsapp_sent_by:uuid','whatsapp_sent_by_name:text']::text[],
             ARRAY['member_subscriptions','members','notifications','profiles']::text[],
             false,
             NULL::text[],
             ARRAY['security_invoker=false','security_barrier=true']::text[]),
            ('v_member_followups',
             ARRAY['id:uuid','member_id:uuid','member_code:text','member_name:text','phone:text','category:text','reason:text','priority:text','due_date:date','status:text','notes:text','outcome:text','completed_at:timestamp with time zone','created_at:timestamp with time zone','updated_at:timestamp with time zone']::text[],
             ARRAY['id:uuid','member_id:uuid','member_code:text','member_name:text','phone:text','category:text','reason:text','priority:text','due_date:date','status:text','notes:text','outcome:text','completed_at:timestamp with time zone','created_at:timestamp with time zone','updated_at:timestamp with time zone']::text[],
             ARRAY['member_followups','members']::text[],
             true,
             NULL::text[],
             ARRAY['security_invoker=true']::text[]),
            ('v_admin_pt_assignments',
             NULL::text[],
             ARRAY['id:uuid','member_id:uuid','package_id:uuid','trainer_id:uuid','total_sessions:integer','completed_sessions:integer','fee_amount:numeric(12,2)','amount_paid:numeric(12,2)','balance:numeric(12,2)','status:text','start_date:date','notes:text','created_at:timestamp with time zone']::text[],
             ARRAY['pt_assignments']::text[],
             false,
             NULL::text[],
             ARRAY['security_invoker=false','security_barrier=true']::text[]),
            ('v_attendance_logs',
             ARRAY['id:uuid','checkin_code:text','member_id:uuid','member_code:text','member_name:text','member_phone:text','plan_name:text','checked_in_at:timestamp with time zone','checked_out_at:timestamp with time zone','status:text','notes:text','actor_id:uuid','actor_name:text','created_at:timestamp with time zone','updated_at:timestamp with time zone']::text[],
             ARRAY['id:uuid','checkin_code:text','member_id:uuid','member_code:text','member_name:text','member_phone:text','plan_name:text','checked_in_at:timestamp with time zone','checked_out_at:timestamp with time zone','status:text','notes:text','actor_id:uuid','actor_name:text','created_at:timestamp with time zone','updated_at:timestamp with time zone']::text[],
             ARRAY['checkins','member_subscriptions','members','profiles']::text[],
             true,
             ARRAY['security_invoker=true']::text[],
             ARRAY['security_invoker=true']::text[])
        ) AS expected(view_name,baseline_columns,target_columns,dependencies,required_existing,baseline_options,target_options)
    LOOP
        IF to_regclass('public.' || v_req.view_name) IS NULL THEN
            IF v_req.required_existing THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: Required existing view public.% is missing.', v_req.view_name;
            END IF;
        ELSE
            SELECT c.relkind::text, c.reloptions
            INTO v_actual, v_reloptions
            FROM pg_catalog.pg_class c WHERE c.oid=to_regclass('public.' || v_req.view_name);
            IF v_actual <> 'v' THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: public.% is not a regular view.', v_req.view_name;
            END IF;
            IF pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=to_regclass('public.' || v_req.view_name))) NOT IN ('postgres','supabase_admin') THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: public.% has an unreviewed owner.', v_req.view_name;
            END IF;
            SELECT array_agg(a.attname::text || ':' || format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
            INTO v_columns
            FROM pg_catalog.pg_attribute a
            WHERE a.attrelid=to_regclass('public.' || v_req.view_name) AND a.attnum>0 AND NOT a.attisdropped;
            IF (v_req.baseline_columns IS NULL OR v_columns IS DISTINCT FROM v_req.baseline_columns)
               AND (v_req.target_columns IS NULL OR v_columns IS DISTINCT FROM v_req.target_columns) THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: public.% output names/types differ from the reviewed view contract.', v_req.view_name;
            END IF;
            IF EXISTS (
                SELECT 1 FROM unnest(coalesce(v_reloptions,ARRAY[]::text[])) o
                WHERE o NOT IN ('security_invoker=true','security_invoker=false','security_barrier=true','security_barrier=false')
            ) OR (SELECT count(*) FROM unnest(coalesce(v_reloptions,ARRAY[]::text[]))) <>
                 (SELECT count(DISTINCT split_part(o,'=',1)) FROM unnest(coalesce(v_reloptions,ARRAY[]::text[])) o) THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: public.% has an unreviewed or duplicate view option.', v_req.view_name;
            END IF;
            IF NOT (
                (v_reloptions IS NULL AND (v_req.baseline_options IS NULL OR v_req.view_name = 'v_staff_roster'))
                OR (v_reloptions IS NOT NULL AND v_req.baseline_options IS NOT NULL AND v_reloptions <@ v_req.baseline_options AND v_req.baseline_options <@ v_reloptions)
                OR (v_reloptions IS NOT NULL AND v_req.target_options IS NOT NULL AND v_reloptions <@ v_req.target_options AND v_req.target_options <@ v_reloptions)
            ) THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: public.% options % differ from the approved pre-migration contract.', v_req.view_name, v_reloptions;
            END IF;
            SELECT array_agg(DISTINCT dep.relname::text ORDER BY dep.relname::text)
            INTO v_dependencies
            FROM pg_catalog.pg_rewrite rw
            JOIN pg_catalog.pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=rw.oid
            JOIN pg_catalog.pg_class dep ON dep.oid=d.refobjid
            JOIN pg_catalog.pg_namespace depn ON depn.oid=dep.relnamespace
            WHERE rw.ev_class=to_regclass('public.' || v_req.view_name)
              AND d.refclassid='pg_class'::regclass AND d.refobjid<>rw.ev_class AND depn.nspname='public';
            IF v_dependencies IS DISTINCT FROM v_req.dependencies THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: public.% has unknown or missing relation dependencies.', v_req.view_name;
            END IF;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_rewrite rw
        JOIN pg_catalog.pg_class dependent ON dependent.oid=rw.ev_class
        JOIN pg_catalog.pg_namespace dn ON dn.oid=dependent.relnamespace
        JOIN pg_catalog.pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=rw.oid
        JOIN pg_catalog.pg_class referenced ON referenced.oid=d.refobjid
        JOIN pg_catalog.pg_namespace rn ON rn.oid=referenced.relnamespace
        WHERE dn.nspname='public' AND rn.nspname='public'
          AND referenced.relname = ANY (ARRAY['v_staff_roster','v_active_members','v_member_dues','v_outstanding_payments','v_notifications','v_member_followups','v_admin_pt_assignments','v_attendance_logs'])
          AND dependent.relname <> referenced.relname
          AND NOT (dependent.relname='v_outstanding_payments' AND referenced.relname='v_member_dues')
    ) THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: A view outside the reviewed dependency graph depends on a Phase 5 view.';
    END IF;

    -- Existing optional tables accepted by CREATE TABLE IF NOT EXISTS must already
    -- have compatible column defaults/nullability, keys, checks, foreign keys, and indexes.
    FOR v_req IN
        SELECT * FROM (VALUES
            ('profiles','is_active','NO','true','NEVER','',false),
            ('profiles','deactivated_at','YES','', 'NEVER','',false),
            ('profiles','invited_by','YES','', 'NEVER','',false),
            ('staff_invitations','id','NO','gen_random_uuid()','NEVER','',true),
            ('staff_invitations','email','NO','','NEVER','',true),
            ('staff_invitations','full_name','NO','','NEVER','',true),
            ('staff_invitations','role','NO','''staff''::text','NEVER','',true),
            ('staff_invitations','status','NO','''pending''::text','NEVER','',true),
            ('staff_invitations','invited_by','YES','','NEVER','',true),
            ('staff_invitations','auth_user_id','YES','','NEVER','',true),
            ('staff_invitations','created_at','NO','clock_timestamp()','NEVER','',true),
            ('staff_invitations','expires_at','NO','(clock_timestamp() + ''7 days''::interval)','NEVER','',true),
            ('staff_invitations','accepted_at','YES','','NEVER','',true),
            ('staff_invitations','revoked_at','YES','','NEVER','',true),
            ('security_audit_logs','id','NO','gen_random_uuid()','NEVER','',true),
            ('security_audit_logs','actor_id','YES','','NEVER','',true),
            ('security_audit_logs','target_user_id','YES','','NEVER','',true),
            ('security_audit_logs','action','NO','','NEVER','',true),
            ('security_audit_logs','details','NO','''{}''::jsonb','NEVER','',true),
            ('security_audit_logs','created_at','NO','clock_timestamp()','NEVER','',true),
            ('idempotency_keys','id','NO','gen_random_uuid()','NEVER','',true),
            ('idempotency_keys','actor_id','NO','','NEVER','',true),
            ('idempotency_keys','operation','NO','','NEVER','',true),
            ('idempotency_keys','idempotency_key','NO','','NEVER','',true),
            ('idempotency_keys','payload_hash','NO','','NEVER','',true),
            ('idempotency_keys','response','NO','','NEVER','',true),
            ('idempotency_keys','created_at','NO','clock_timestamp()','NEVER','',true),
            ('payments','id','NO','gen_random_uuid()','NEVER','',true),
            ('payments','receipt_number','NO','','NEVER','',true),
            ('payments','member_id','NO','','NEVER','',true),
            ('payments','subscription_id','YES','','NEVER','',true),
            ('payments','pt_assignment_id','YES','','NEVER','',true),
            ('payments','transaction_type','NO','','NEVER','',true),
            ('payments','amount','NO','','NEVER','',true),
            ('payments','payment_method','NO','','NEVER','',true),
            ('payments','status','NO','''completed''::text','NEVER','',true),
            ('payments','refund_of_payment_id','YES','','NEVER','',true),
            ('payments','actor_id','NO','','NEVER','',true),
            ('payments','created_at','NO','clock_timestamp()','NEVER','',true),
            ('member_subscriptions','amount_paid','NO','0.00','NEVER','',true),
            ('member_subscriptions','balance_transferred_out','NO','0.00','NEVER','',true),
            ('member_subscriptions','credit_adjustments','NO','0.00','NEVER','',true),
            ('member_subscriptions','total_liability','YES','','ALWAYS','(plan_price + previous_balance_carried)',true),
            ('member_subscriptions','balance','YES','','ALWAYS','GREATEST(0.00,((((plan_price+previous_balance_carried)-amount_paid)-balance_transferred_out)-credit_adjustments))',true),
            ('member_subscriptions','payment_status','YES','','ALWAYS','CASEWHEN(((((plan_price+previous_balance_carried)-amount_paid)-balance_transferred_out)-credit_adjustments)<=0.00)THEN''paid''::textWHEN(amount_paid>0.00)THEN''partial''::textELSE''unpaid''::textEND',true),
            ('pt_assignments','remaining_sessions','YES','','ALWAYS','(total_sessions-completed_sessions)',true),
            ('pt_assignments','balance','YES','','ALWAYS','GREATEST(0.00,((fee_amount-amount_paid)-credit_adjustments))',true),
            ('pt_assignments','payment_status','YES','','ALWAYS','CASEWHEN(((fee_amount-amount_paid)-credit_adjustments)<=0.00)THEN''paid''::textWHEN(amount_paid>0.00)THEN''partial''::textELSE''unpaid''::textEND',true)
        ) AS expected(table_name,column_name,is_nullable,column_default,is_generated,generation_expression,required_column)
    LOOP
        IF to_regclass('public.' || v_req.table_name) IS NULL AND NOT v_req.required_column THEN
            CONTINUE;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema='public' AND c.table_name=v_req.table_name AND c.column_name=v_req.column_name
        ) THEN
            IF v_req.required_column AND to_regclass('public.' || v_req.table_name) IS NOT NULL THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: Required column public.%.% is missing.', v_req.table_name, v_req.column_name;
            END IF;
        ELSE
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns c
                WHERE c.table_schema='public' AND c.table_name=v_req.table_name AND c.column_name=v_req.column_name
                  AND c.is_nullable=v_req.is_nullable
                  AND coalesce(c.column_default,'')=v_req.column_default
                  AND c.is_generated=v_req.is_generated
                  AND regexp_replace(coalesce(c.generation_expression,''), '[[:space:]]+', '', 'g')=regexp_replace(v_req.generation_expression, '[[:space:]]+', '', 'g')
            ) THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: public.%.% has an unexpected default, nullability, or generated expression.', v_req.table_name, v_req.column_name;
            END IF;
        END IF;
    END LOOP;

    FOR v_req IN
        SELECT * FROM (VALUES
            ('profiles','profiles_pkey','PRIMARY KEY (id)',true),
            ('profiles','profiles_id_fkey','FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE',true),
            ('profiles','profiles_role_check','CHECK (role = ANY (ARRAY[''admin''::text, ''staff''::text]))',true),
            ('profiles','profiles_invited_by_fkey','FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL',false),
            ('idempotency_keys','idempotency_keys_pkey','PRIMARY KEY (id)',true),
            ('idempotency_keys','idempotency_keys_actor_id_fkey','FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE CASCADE',true),
            ('idempotency_keys','uq_idempotency_actor_op_key','UNIQUE (actor_id, operation, idempotency_key)',true),
            ('member_subscriptions','member_subscriptions_pkey','PRIMARY KEY (id)',true),
            ('member_subscriptions','member_subscriptions_member_id_fkey','FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT',true),
            ('member_subscriptions','member_subscriptions_plan_id_fkey','FOREIGN KEY (plan_id) REFERENCES membership_plans(id) ON DELETE RESTRICT',true),
            ('member_subscriptions','member_subscriptions_status_check','CHECK (status = ANY (ARRAY[''active''::text, ''expired''::text, ''superseded''::text, ''cancelled''::text]))',true),
            ('member_subscriptions','member_subscriptions_amount_paid_check','CHECK (amount_paid >= 0::numeric)',true),
            ('member_subscriptions','member_subscriptions_plan_price_check','CHECK (plan_price >= 0::numeric)',true),
            ('member_subscriptions','member_subscriptions_previous_balance_carried_check','CHECK (previous_balance_carried >= 0::numeric)',true),
            ('member_subscriptions','member_subscriptions_balance_transferred_out_check','CHECK (balance_transferred_out >= 0::numeric)',true),
            ('member_subscriptions','member_subscriptions_credit_adjustments_check','CHECK (credit_adjustments >= 0::numeric)',true),
            ('member_subscriptions','member_subscriptions_transferred_to_subscription_id_fkey','FOREIGN KEY (transferred_to_subscription_id) REFERENCES member_subscriptions(id) ON DELETE RESTRICT',true),
            ('payments','payments_pkey','PRIMARY KEY (id)',true),
            ('payments','payments_receipt_number_key','UNIQUE (receipt_number)',true),
            ('payments','payments_member_id_fkey','FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT',true),
            ('payments','payments_subscription_id_fkey','FOREIGN KEY (subscription_id) REFERENCES member_subscriptions(id) ON DELETE RESTRICT',true),
            ('payments','payments_pt_assignment_id_fkey','FOREIGN KEY (pt_assignment_id) REFERENCES pt_assignments(id) ON DELETE RESTRICT',true),
            ('payments','payments_refund_of_payment_id_fkey','FOREIGN KEY (refund_of_payment_id) REFERENCES payments(id) ON DELETE RESTRICT',true),
            ('payments','payments_actor_id_fkey','FOREIGN KEY (actor_id) REFERENCES auth.users(id)',true),
            ('payments','payments_amount_check','CHECK (amount > 0::numeric)',true),
            ('payments','payments_status_check','CHECK (status = ANY (ARRAY[''completed''::text, ''failed''::text]))',true),
            ('payments','payments_transaction_type_check','CHECK (transaction_type = ANY (ARRAY[''payment''::text, ''refund''::text, ''credit_adjustment''::text]))',true),
            ('payments','payments_payment_method_check','CHECK (payment_method = ANY (ARRAY[''Cash''::text, ''UPI''::text, ''Card''::text, ''Adjustment''::text]))',true),
            ('payments','chk_adjustment_method','CHECK (transaction_type = ''credit_adjustment''::text AND payment_method = ''Adjustment''::text OR transaction_type <> ''credit_adjustment''::text AND payment_method <> ''Adjustment''::text)',true),
            ('payments','chk_payment_target','CHECK (subscription_id IS NOT NULL AND pt_assignment_id IS NULL OR subscription_id IS NULL AND pt_assignment_id IS NOT NULL OR subscription_id IS NULL AND pt_assignment_id IS NULL AND (transaction_type = ANY (ARRAY[''payment''::text, ''refund''::text])))',true),
            ('payments','chk_refund_linkage','CHECK (transaction_type = ''refund''::text AND refund_of_payment_id IS NOT NULL OR transaction_type <> ''refund''::text AND refund_of_payment_id IS NULL)',true),
            ('staff_invitations','staff_invitations_pkey','PRIMARY KEY (id)',false),
            ('staff_invitations','staff_invitations_role_check','CHECK (role = ''staff''::text)',false),
            ('staff_invitations','staff_invitations_status_check','CHECK (status = ANY (ARRAY[''pending''::text, ''accepted''::text, ''revoked''::text, ''expired''::text]))',false),
            ('staff_invitations','staff_invitations_invited_by_fkey','FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL',false),
            ('staff_invitations','staff_invitations_auth_user_id_fkey','FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL',false),
            ('security_audit_logs','security_audit_logs_pkey','PRIMARY KEY (id)',false),
            ('security_audit_logs','security_audit_logs_actor_id_fkey','FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL',false)
        ) AS expected(table_name,constraint_name,definition,required_constraint)
    LOOP
        IF to_regclass('public.' || v_req.table_name) IS NULL THEN CONTINUE; END IF;
        SELECT pg_get_constraintdef(c.oid,true) INTO v_actual
        FROM pg_catalog.pg_constraint c
        WHERE c.conrelid=to_regclass('public.' || v_req.table_name) AND c.conname=v_req.constraint_name
          AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred;
        IF v_actual IS NULL THEN
            IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=to_regclass('public.' || v_req.table_name) AND c.conname=v_req.constraint_name)
               OR v_req.required_constraint OR v_req.table_name IN ('staff_invitations','security_audit_logs') THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: Constraint public.%.% is missing or unvalidated.', v_req.table_name, v_req.constraint_name;
            END IF;
        ELSIF v_actual <> v_req.definition THEN
            RAISE EXCEPTION 'PHASE5_PREFLIGHT: Constraint public.%.% has an unexpected definition.', v_req.table_name, v_req.constraint_name;
        END IF;
    END LOOP;

    FOR v_req IN
        SELECT * FROM (VALUES
            ('profiles','idx_profiles_is_active','CREATE INDEX idx_profiles_is_active ON public.profiles USING btree (is_active)',false),
            ('idempotency_keys','idx_idempotency_lookup','CREATE INDEX idx_idempotency_lookup ON public.idempotency_keys USING btree (actor_id, operation, idempotency_key)',true),
            ('member_subscriptions','idx_subscriptions_member','CREATE INDEX idx_subscriptions_member ON public.member_subscriptions USING btree (member_id)',true),
            ('member_subscriptions','idx_subscriptions_status','CREATE INDEX idx_subscriptions_status ON public.member_subscriptions USING btree (status)',true),
            ('payments','idx_payments_created','CREATE INDEX idx_payments_created ON public.payments USING btree (created_at)',true),
            ('payments','idx_payments_member','CREATE INDEX idx_payments_member ON public.payments USING btree (member_id)',true),
            ('payments','idx_payments_pt','CREATE INDEX idx_payments_pt ON public.payments USING btree (pt_assignment_id)',true),
            ('payments','idx_payments_refund_target','CREATE INDEX idx_payments_refund_target ON public.payments USING btree (refund_of_payment_id)',true),
            ('payments','idx_payments_sub','CREATE INDEX idx_payments_sub ON public.payments USING btree (subscription_id)',true),
            ('staff_invitations','idx_staff_invitations_active_email','CREATE UNIQUE INDEX idx_staff_invitations_active_email ON public.staff_invitations USING btree (lower(TRIM(BOTH FROM email))) WHERE (status = ''pending''::text)',false),
            ('staff_invitations','idx_staff_invitations_email','CREATE INDEX idx_staff_invitations_email ON public.staff_invitations USING btree (lower(TRIM(BOTH FROM email)))',false),
            ('staff_invitations','idx_staff_invitations_status','CREATE INDEX idx_staff_invitations_status ON public.staff_invitations USING btree (status)',false),
            ('security_audit_logs','idx_security_audit_logs_actor','CREATE INDEX idx_security_audit_logs_actor ON public.security_audit_logs USING btree (actor_id)',false),
            ('security_audit_logs','idx_security_audit_logs_created_at','CREATE INDEX idx_security_audit_logs_created_at ON public.security_audit_logs USING btree (created_at DESC)',false),
            ('security_audit_logs','idx_security_audit_logs_target','CREATE INDEX idx_security_audit_logs_target ON public.security_audit_logs USING btree (target_user_id)',false)
        ) AS expected(table_name,index_name,definition,required_index)
    LOOP
        IF to_regclass('public.' || v_req.table_name) IS NULL THEN CONTINUE; END IF;
        SELECT pg_get_indexdef(i.indexrelid) INTO v_actual
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
        WHERE i.indrelid=to_regclass('public.' || v_req.table_name) AND idx.relname=v_req.index_name;
        IF v_actual IS NULL THEN
            IF v_req.required_index OR v_req.table_name IN ('staff_invitations','security_audit_logs') THEN
                RAISE EXCEPTION 'PHASE5_PREFLIGHT: Index public.% is missing.', v_req.index_name;
            END IF;
        ELSIF v_actual <> v_req.definition THEN
            RAISE EXCEPTION 'PHASE5_PREFLIGHT: Index public.% has an unexpected definition.', v_req.index_name;
        END IF;
    END LOOP;

    IF to_regclass('public.staff_invitations') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM (SELECT lower(trim(email)) FROM public.staff_invitations WHERE status=''pending'' GROUP BY lower(trim(email)) HAVING count(*) > 1) duplicates'
        INTO v_count;
        IF v_count > 0 THEN
            RAISE EXCEPTION 'PHASE5_PREFLIGHT: Existing staff invitations contain duplicate pending normalized email addresses; the intended unique index cannot be created safely.';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid='public.profiles'::regclass AND c.contype='f'
          AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.profiles'::regclass AND a.attname='invited_by')]::smallint[]
          AND c.conname <> 'profiles_invited_by_fkey'
    ) THEN
        RAISE EXCEPTION 'PHASE5_PREFLIGHT: profiles.invited_by already has a differently named foreign key.';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='invited_by') THEN
        EXECUTE 'SELECT count(*) FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.invited_by WHERE p.invited_by IS NOT NULL AND u.id IS NULL'
        INTO v_count;
        IF v_count > 0 THEN
            RAISE EXCEPTION 'PHASE5_PREFLIGHT: Existing profiles.invited_by values contain references absent from auth.users.';
        END IF;
    END IF;

END;
$phase5_deep_preflight$;

-- ===== BEGIN 20261102000003_phase5_staff_security_and_invitations.sql =====
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


-- ----------------------------------------------------------------------------
-- 1. PROFILES ENHANCEMENT: ACCOUNT STATUS & INVITATION ATTRIBUTION
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN,
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS invited_by UUID;

-- Do not infer an existing account's activation state from the new-column default.
-- A reviewed, complete mapping is required whenever existing profiles have no
-- reliable activation value (including when this column is first introduced).
DO $phase5_profile_activation_map$
DECLARE
    v_has_status_column boolean;
    v_requires_mapping boolean := false;
    v_profile_count bigint;
    v_mapping_count bigint;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_active'
    ) INTO v_has_status_column;

    SELECT count(*) INTO v_profile_count FROM public.profiles;

    IF v_profile_count > 0 THEN
        IF NOT v_has_status_column THEN
            v_requires_mapping := true;
        ELSE
            SELECT EXISTS (
                SELECT 1 FROM public.profiles
                WHERE is_active IS NULL OR (is_active IS TRUE AND deactivated_at IS NOT NULL)
            ) INTO v_requires_mapping;
        END IF;
    END IF;

    IF v_requires_mapping AND to_regclass('pg_temp.phase5_profile_activation_map') IS NULL THEN
        RAISE EXCEPTION 'PHASE5_PROFILE_MAP_REQUIRED: Existing profiles lack a reconciled activation state. Create and populate pg_temp.phase5_profile_activation_map in this SQL session before running the forward migration.';
    END IF;

    IF to_regclass('pg_temp.phase5_profile_activation_map') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('pg_temp.phase5_profile_activation_map') AND attname = 'profile_id' AND format_type(atttypid,atttypmod)='uuid' AND NOT attisdropped)
           OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('pg_temp.phase5_profile_activation_map') AND attname = 'is_active' AND format_type(atttypid,atttypmod)='boolean' AND NOT attisdropped)
           OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('pg_temp.phase5_profile_activation_map') AND attname = 'deactivated_at' AND format_type(atttypid,atttypmod)='timestamp with time zone' AND NOT attisdropped)
           OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('pg_temp.phase5_profile_activation_map') AND attname = 'source_reference' AND format_type(atttypid,atttypmod)='text' AND NOT attisdropped) THEN
            RAISE EXCEPTION 'PHASE5_PROFILE_MAP_INVALID: pg_temp.phase5_profile_activation_map must provide profile_id uuid, is_active boolean, deactivated_at timestamptz, and source_reference text columns.';
        END IF;

        IF EXISTS (
            SELECT 1 FROM pg_temp.phase5_profile_activation_map
            WHERE profile_id IS NULL OR is_active IS NULL OR source_reference IS NULL OR btrim(source_reference) = ''
               OR (is_active IS TRUE AND deactivated_at IS NOT NULL)
        ) THEN
            RAISE EXCEPTION 'PHASE5_PROFILE_MAP_INVALID: Every mapped profile needs an explicit status and source reference; active profiles must not have deactivated_at set.';
        END IF;

        SELECT count(*) INTO v_mapping_count FROM pg_temp.phase5_profile_activation_map;
        IF v_mapping_count <> v_profile_count
           OR EXISTS (
                SELECT 1 FROM public.profiles p
                FULL JOIN pg_temp.phase5_profile_activation_map m ON m.profile_id = p.id
                WHERE p.id IS NULL OR m.profile_id IS NULL
           ) THEN
            RAISE EXCEPTION 'PHASE5_PROFILE_MAP_INVALID: The mapping must contain exactly one row for every existing profile and no other profile IDs.';
        END IF;
    ELSIF EXISTS (
        SELECT 1 FROM public.profiles
        WHERE is_active IS NULL OR (is_active IS TRUE AND deactivated_at IS NOT NULL)
    ) THEN
        RAISE EXCEPTION 'PHASE5_PROFILE_MAP_REQUIRED: Existing profile activation fields are inconsistent and require an explicit mapping.';
    END IF;

    IF to_regclass('pg_temp.phase5_profile_activation_map') IS NOT NULL THEN
        UPDATE public.profiles p
        SET is_active = m.is_active,
            deactivated_at = m.deactivated_at
        FROM pg_temp.phase5_profile_activation_map m
        WHERE m.profile_id = p.id;
    END IF;
END;
$phase5_profile_activation_map$;

ALTER TABLE public.profiles
    ALTER COLUMN is_active SET DEFAULT true,
    ALTER COLUMN is_active SET NOT NULL;

-- An existing same-named constraint with a different target or delete action is unsafe.
DO $phase5_profile_invited_by_fk$
DECLARE
    v_fk record;
BEGIN
    SELECT conname, pg_get_constraintdef(oid, true) AS definition
    INTO v_fk
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_invited_by_fkey';

    IF FOUND AND v_fk.definition <> 'FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL' THEN
        RAISE EXCEPTION 'PHASE5_SCHEMA_MISMATCH: profiles_invited_by_fkey has an unexpected definition: %.', v_fk.definition;
    ELSIF NOT FOUND THEN
        IF EXISTS (
            SELECT 1 FROM pg_constraint c
            WHERE c.conrelid = 'public.profiles'::regclass AND c.contype = 'f'
              AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'invited_by')]::smallint[]
        ) THEN
            RAISE EXCEPTION 'PHASE5_SCHEMA_MISMATCH: public.profiles.invited_by already has a differently named foreign key.';
        END IF;
        IF EXISTS (
            SELECT 1 FROM public.profiles p
            LEFT JOIN auth.users u ON u.id = p.invited_by
            WHERE p.invited_by IS NOT NULL AND u.id IS NULL
        ) THEN
            RAISE EXCEPTION 'PHASE5_SCHEMA_MISMATCH: Existing profiles.invited_by values do not all reference auth.users.';
        END IF;
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_invited_by_fkey FOREIGN KEY (invited_by)
            REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END;
$phase5_profile_invited_by_fk$;

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
CREATE OR REPLACE VIEW public.v_active_members WITH (security_invoker = false, security_barrier = true) AS
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
    (CASE WHEN public.is_admin() THEN s.plan_price ELSE NULL END)::numeric(12, 2) AS plan_price,
    (CASE WHEN public.is_admin() THEN s.total_liability ELSE NULL END)::numeric(12, 2) AS total_liability,
    (CASE WHEN public.is_admin() THEN s.amount_paid ELSE NULL END)::numeric(12, 2) AS amount_paid,
    (CASE WHEN public.is_admin() THEN s.balance ELSE NULL END)::numeric(12, 2) AS balance,
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
CREATE OR REPLACE VIEW public.v_member_dues WITH (security_invoker = false, security_barrier = true) AS
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

CREATE OR REPLACE VIEW public.v_outstanding_payments WITH (security_invoker = false, security_barrier = true) AS
SELECT *
FROM public.v_member_dues
WHERE outstanding_balance > 0.00
  AND public.is_admin();

COMMENT ON VIEW public.v_outstanding_payments IS 'Outstanding member balances view: filters v_member_dues where outstanding_balance > 0. Restricted to active administrators; returns 0 rows for non-admin staff.';

-- C. v_notifications: Masks current_balance for non-admin callers
CREATE OR REPLACE VIEW public.v_notifications WITH (security_invoker = false, security_barrier = true) AS
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

-- Trainer records are operational data and inactive accounts must not retain access.
ALTER TABLE public.trainers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trainers_select" ON public.trainers;
CREATE POLICY "trainers_select" ON public.trainers
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
-- ===== END 20261102000003_phase5_staff_security_and_invitations.sql =====

-- ===== BEGIN 20261102010000_phase5_security_audit_remediation.sql =====
-- Phase 5 local security remediation. Additive and transaction scoped; does not touch member or financial rows.

-- API roles cannot create objects in a trusted SECURITY DEFINER search-path schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA extensions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.member_code_seq, public.receipt_number_seq, public.checkin_code_seq
    FROM PUBLIC, anon, authenticated, service_role;
-- Revoke API execution only from the Phase 5 RPCs and internal helpers reviewed here.
-- Other application RPC ACLs are preserved; this avoids silently removing unrelated workflows.
REVOKE ALL ON FUNCTION
    public.get_user_role(), public.is_admin(), public.is_staff(),
    public.admin_set_user_status(uuid, boolean), public.admin_set_user_role(uuid, text),
    public.create_staff_invitation(text, text), public.resend_staff_invitation(uuid),
    public.revoke_staff_invitation(uuid), public.accept_staff_invitation(),
    public.record_dues_payment(uuid, uuid, numeric, text, text, text),
    public.record_pt_dues_payment(uuid, uuid, numeric, text, text, text),
    public.renew_member_subscription(uuid, uuid, date, boolean, numeric, text, text),
    public.onboard_member(text, text, text, text, date, text, text, text, text, text, uuid, date, numeric, text, text),
    public.assign_pt_package(uuid, uuid, uuid, date, numeric, text, text, text),
    public.get_staff_operational_summary(), public.fn_on_auth_user_created(),
    public.fn_sync_payment_balances(), public.fn_prevent_tamper_payment_records(),
    public.hash_payload(jsonb), public.generate_member_code(),
    public.generate_receipt_number(), public.generate_checkin_code()
    FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION
    public.fn_on_auth_user_created(),
    public.fn_sync_payment_balances(), public.fn_prevent_tamper_payment_records(),
    public.hash_payload(jsonb), public.generate_member_code(),
    public.generate_receipt_number(), public.generate_checkin_code()
    FROM authenticated;

GRANT EXECUTE ON FUNCTION
    public.get_user_role(), public.is_admin(), public.is_staff(),
    public.admin_set_user_status(uuid, boolean), public.admin_set_user_role(uuid, text),
    public.create_staff_invitation(text, text), public.resend_staff_invitation(uuid),
    public.revoke_staff_invitation(uuid), public.accept_staff_invitation(),
    public.record_dues_payment(uuid, uuid, numeric, text, text, text),
    public.record_pt_dues_payment(uuid, uuid, numeric, text, text, text),
    public.renew_member_subscription(uuid, uuid, date, boolean, numeric, text, text),
    public.onboard_member(text, text, text, text, date, text, text, text, text, text, uuid, date, numeric, text, text),
    public.assign_pt_package(uuid, uuid, uuid, date, numeric, text, text, text),
    public.get_staff_operational_summary() TO authenticated;

REVOKE ALL ON public.profiles, public.members, public.membership_plans,
    public.member_subscriptions, public.pt_packages, public.trainers, public.pt_assignments,
    public.pt_sessions, public.payments, public.idempotency_keys, public.checkins,
    public.notifications, public.member_followups, public.gym_info, public.reminder_settings,
    public.staff_invitations, public.security_audit_logs FROM PUBLIC, anon;
REVOKE ALL ON public.v_active_members, public.v_member_dues, public.v_outstanding_payments,
    public.v_notifications, public.v_staff_roster, public.v_member_followups,
    public.v_attendance_logs FROM PUBLIC, anon;
REVOKE ALL ON public.profiles, public.members, public.membership_plans,
    public.member_subscriptions, public.pt_packages, public.trainers, public.pt_assignments,
    public.pt_sessions, public.payments, public.idempotency_keys, public.checkins,
    public.notifications, public.member_followups, public.gym_info, public.reminder_settings,
    public.staff_invitations, public.security_audit_logs,
    public.v_active_members, public.v_member_dues, public.v_outstanding_payments,
    public.v_notifications, public.v_staff_roster, public.v_member_followups,
    public.v_attendance_logs FROM service_role;

-- Remove column-level grants too: table-level revokes do not remove them.
DO $phase5_sensitive_column_revokes$
DECLARE
    v_table text;
    v_columns text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'profiles', 'members', 'membership_plans', 'member_subscriptions', 'payments',
        'pt_packages', 'trainers', 'pt_assignments', 'pt_sessions', 'idempotency_keys',
        'checkins', 'notifications', 'member_followups', 'gym_info', 'reminder_settings',
        'staff_invitations', 'security_audit_logs'
    ] LOOP
        SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
        INTO v_columns
        FROM pg_attribute a
        WHERE a.attrelid = format('public.%I', v_table)::regclass
          AND a.attnum > 0 AND NOT a.attisdropped;

        IF v_columns IS NULL THEN
            RAISE EXCEPTION 'PHASE5_SCHEMA_MISMATCH: public.% has no ordinary columns.', v_table;
        END IF;

        EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC, anon, service_role', v_columns, v_table);

        IF v_table IN ('payments', 'member_subscriptions', 'idempotency_keys') THEN
            EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM authenticated', v_columns, v_table);
        END IF;

        IF v_table IN ('payments', 'member_subscriptions') THEN
            EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', v_table);
        ELSIF v_table = 'idempotency_keys' THEN
            EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', v_table);
        END IF;
    END LOOP;
END;
$phase5_sensitive_column_revokes$;
REVOKE TRUNCATE ON TABLE public.profiles, public.members, public.member_subscriptions,
    public.pt_assignments, public.pt_sessions, public.payments, public.idempotency_keys,
    public.staff_invitations, public.security_audit_logs FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.payments, public.member_subscriptions
    FROM authenticated;

-- Staff need operational PT data, while financial PT columns remain admin-only through a gated view.
CREATE OR REPLACE VIEW public.v_admin_pt_assignments WITH (security_invoker = false, security_barrier = true) AS
SELECT
    id, member_id, package_id, trainer_id, total_sessions, completed_sessions,
    fee_amount, amount_paid, balance, status, start_date, notes, created_at
FROM public.pt_assignments
WHERE public.is_admin();

COMMENT ON VIEW public.v_admin_pt_assignments IS
    'Administrator-only PT assignment detail, including fees and balances. Access is gated by public.is_admin().';

REVOKE ALL ON public.v_admin_pt_assignments FROM PUBLIC, anon;
REVOKE ALL ON public.v_admin_pt_assignments FROM service_role;
GRANT SELECT ON public.v_admin_pt_assignments TO authenticated;

REVOKE ALL ON TABLE public.pt_assignments FROM PUBLIC, anon, authenticated;
REVOKE SELECT (id, member_id, package_id, trainer_id, total_sessions, completed_sessions, remaining_sessions, fee_amount, amount_paid, credit_adjustments, balance, payment_status, status, start_date, notes, created_at, updated_at) ON public.pt_assignments FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (trainer_id, notes) ON public.pt_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, member_id, package_id, trainer_id, total_sessions, completed_sessions, remaining_sessions, status, start_date, notes, created_at, updated_at) ON public.pt_assignments TO authenticated;
GRANT UPDATE (trainer_id, notes) ON public.pt_assignments TO authenticated;

-- Idempotency responses can contain financial data; RPCs are the only supported access path.
REVOKE ALL ON public.idempotency_keys FROM PUBLIC, anon, authenticated, service_role;

-- The service-role Edge Functions only need append access for external-action audit events.
REVOKE ALL ON public.security_audit_logs FROM service_role;
GRANT INSERT ON public.security_audit_logs TO service_role;

-- Read-only invitation eligibility check; it never accepts or activates an invitation.
CREATE OR REPLACE FUNCTION public.can_accept_staff_invitation()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
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
REVOKE ALL ON FUNCTION public.can_accept_staff_invitation() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_accept_staff_invitation() TO authenticated;

-- Atomic audit events for invitation creation, expiry, and resend. Revoke/accept are already audited in their RPCs.
CREATE OR REPLACE FUNCTION public.audit_staff_invitation_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
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
REVOKE ALL ON FUNCTION public.audit_staff_invitation_changes() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER trg_audit_staff_invitation_changes
AFTER INSERT OR UPDATE OF status, expires_at ON public.staff_invitations
FOR EACH ROW EXECUTE FUNCTION public.audit_staff_invitation_changes();

-- Internal hashing and identifier helpers are callable by their owning SECURITY DEFINER functions only.
REVOKE EXECUTE ON FUNCTION public.hash_payload(jsonb), public.generate_member_code(),
    public.generate_receipt_number(), public.generate_checkin_code() FROM authenticated;

-- Set reviewed Phase 5 definer paths by exact overload. Unrelated application RPCs
-- retain their existing definitions, settings, and ACLs.
ALTER FUNCTION public.get_user_role() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.is_admin() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.is_staff() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.admin_set_user_status(uuid, boolean) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.admin_set_user_role(uuid, text) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.create_staff_invitation(text, text) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.resend_staff_invitation(uuid) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.revoke_staff_invitation(uuid) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.accept_staff_invitation() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.fn_on_auth_user_created() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.fn_sync_payment_balances() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.fn_prevent_tamper_payment_records() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.hash_payload(jsonb) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.generate_member_code() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.generate_receipt_number() SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.generate_checkin_code() SET search_path = pg_catalog, public, extensions, pg_temp;

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
    -- Authorization: active administrator required
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can record dues payments.' USING ERRCODE = '42501';
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Idempotency key is required.' USING ERRCODE = '22023';
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

    -- Lock this caller/operation/key before looking for a cached response.
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

    -- trg_sync_payment_balances updates amount_paid atomically from the ledger row.
    -- balance and payment_status are generated columns and must never be assigned.

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

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'record_dues_payment', p_idempotency_key, v_payload_hash, v_response)
    ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING;

    RETURN v_response;
END;
$$;

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
    -- Authorization: active administrator required
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'FORBIDDEN: Only active administrators can record PT dues payments.' USING ERRCODE = '42501';
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Idempotency key is required.' USING ERRCODE = '22023';
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

    -- Lock this caller/operation/key before looking for a cached response.
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

    -- trg_sync_payment_balances updates amount_paid atomically from the ledger row.
    -- balance and payment_status are generated columns and must never be assigned.

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

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'record_pt_dues_payment', p_idempotency_key, v_payload_hash, v_response)
    ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING;

    RETURN v_response;
END;
$$;

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
    -- Authorization: active administrator required
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

    -- Lock this caller/operation/key before looking for a cached response.
    v_lock_key := v_actor_id::text || ':renew_member_subscription:' || p_idempotency_key;
    PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_lock_key), 1, 16))::bit(64)::bigint);

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
                RAISE EXCEPTION 'ERR_OUTSTANDING_BALANCE_NOT_SETTLED: Previous contract has an unpaid balance of %. Settle dues or carry forward.' , v_prev_sub.balance USING ERRCODE = '22000';
            ELSE
                v_carried_balance := v_prev_sub.balance;
                UPDATE public.member_subscriptions
                SET status = 'superseded',
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
        previous_balance_carried,
        amount_paid,
        start_date,
        expiry_date,
        status
    ) VALUES (
        p_member_id,
        v_plan.id,
        v_plan.name,
        v_plan.price,
        v_carried_balance,
        0.00,
        p_start_date,
        v_expiry_date,
        'active'
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

    INSERT INTO public.idempotency_keys (actor_id, operation, idempotency_key, payload_hash, response)
    VALUES (v_actor_id, 'renew_member_subscription', p_idempotency_key, v_payload_hash, v_response)
    ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING;

    RETURN v_response;
END;
$$;

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
SET search_path = pg_catalog, public, extensions, pg_temp
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
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Idempotency key is required.' USING ERRCODE = '22023';
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
        IF public.is_admin() THEN
            RETURN v_cached_response;
        END IF;
        RETURN v_cached_response - ARRAY['plan_price', 'initial_payment_amount', 'payment_id', 'receipt_number', 'outstanding_balance']::text[];
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

    IF public.is_admin() THEN
        RETURN v_response;
    END IF;
    RETURN v_response - ARRAY['plan_price', 'initial_payment_amount', 'payment_id', 'receipt_number', 'outstanding_balance']::text[];
END;
$$;

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
SET search_path = pg_catalog, public, extensions, pg_temp
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
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: Idempotency key is required.' USING ERRCODE = '22023';
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
        IF public.is_admin() THEN
            RETURN v_cached_response;
        END IF;
        RETURN v_cached_response - ARRAY['fee_amount', 'amount_paid', 'outstanding_balance', 'receipt_number']::text[];
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

    IF public.is_admin() THEN
        RETURN v_response;
    END IF;
    RETURN v_response - ARRAY['fee_amount', 'amount_paid', 'outstanding_balance', 'receipt_number']::text[];
END;
$$;
-- ===== END 20261102010000_phase5_security_audit_remediation.sql =====

-- ===== BEGIN 20261102020000_phase5_policy_cleanup.sql =====
-- Remove legacy permissive policies that would OR-bypass the Phase 5 active-role gates.

DROP POLICY IF EXISTS packages_select ON public.pt_packages;
DROP POLICY IF EXISTS followups_select ON public.member_followups;
-- ===== END 20261102020000_phase5_policy_cleanup.sql =====

-- ===== BEGIN 20261102030000_phase5_followup_view_security.sql =====
-- This view exposes member follow-up operations; apply the table's active-role RLS policies.

ALTER VIEW public.v_member_followups SET (security_invoker = true);
-- ===== END 20261102030000_phase5_followup_view_security.sql =====

-- ===== BEGIN 20261102040000_phase5_active_role_operational_rpcs.sql =====
-- The original SECURITY DEFINER operational RPCs checked authentication but not active staff status.

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
-- ===== END 20261102040000_phase5_active_role_operational_rpcs.sql =====

-- ===== BEGIN 20261102050000_phase5_staff_summary_schema_fix.sql =====
-- Keep the staff dashboard summary aligned with the canonical PT session schema.
-- pt_sessions records each completed session with conducted_at; it has no status/session_date columns.

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
-- ===== END 20261102050000_phase5_staff_summary_schema_fix.sql =====

-- Postconditions fail the same transaction if any policy, function ACL, view option,
-- trigger, or direct table privilege differs from the reviewed Phase 5 target.
DO $phase5_postconditions$
DECLARE
    v_req record;
    v_count bigint;
    v_owner text;
    v_acl text;
    v_columns text[];
    v_reloptions text[];
BEGIN
    FOR v_req IN
        SELECT * FROM (VALUES
            ('get_user_role','public.get_user_role()','','text','pg_catalog, public, extensions, pg_temp',true),
            ('is_admin','public.is_admin()','','boolean','pg_catalog, public, extensions, pg_temp',true),
            ('is_staff','public.is_staff()','','boolean','pg_catalog, public, extensions, pg_temp',true),
            ('admin_set_user_status','public.admin_set_user_status(uuid,boolean)','p_user_id uuid, p_is_active boolean','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('admin_set_user_role','public.admin_set_user_role(uuid,text)','p_user_id uuid, p_role text','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('create_staff_invitation','public.create_staff_invitation(text,text)','p_email text, p_full_name text','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('resend_staff_invitation','public.resend_staff_invitation(uuid)','p_invitation_id uuid','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('revoke_staff_invitation','public.revoke_staff_invitation(uuid)','p_invitation_id uuid','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('accept_staff_invitation','public.accept_staff_invitation()','','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('can_accept_staff_invitation','public.can_accept_staff_invitation()','','boolean','pg_catalog, public, pg_temp',true),
            ('record_dues_payment','public.record_dues_payment(uuid,uuid,numeric,text,text,text)','p_member_id uuid, p_subscription_id uuid, p_amount numeric, p_payment_method text, p_notes text, p_idempotency_key text','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('record_pt_dues_payment','public.record_pt_dues_payment(uuid,uuid,numeric,text,text,text)','p_member_id uuid, p_pt_assignment_id uuid, p_amount numeric, p_payment_method text, p_notes text, p_idempotency_key text','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('renew_member_subscription','public.renew_member_subscription(uuid,uuid,date,boolean,numeric,text,text)','p_member_id uuid, p_plan_id uuid, p_start_date date, p_carry_forward_balance boolean, p_payment_amount numeric, p_payment_method text, p_idempotency_key text','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('onboard_member','public.onboard_member(text,text,text,text,date,text,text,text,text,text,uuid,date,numeric,text,text)','p_name text, p_phone text, p_email text, p_gender text, p_dob date, p_address text, p_emergency_contact text, p_blood_group text, p_medical_notes text, p_notes text, p_plan_id uuid, p_start_date date, p_initial_payment_amount numeric, p_payment_method text, p_idempotency_key text','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('assign_pt_package','public.assign_pt_package(uuid,uuid,uuid,date,numeric,text,text,text)','p_member_id uuid, p_package_id uuid, p_trainer_id uuid, p_start_date date, p_initial_payment_amount numeric, p_payment_method text, p_notes text, p_idempotency_key text','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('get_staff_operational_summary','public.get_staff_operational_summary()','','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('record_member_checkin','public.record_member_checkin(uuid,text)','p_member_id uuid, p_notes text DEFAULT NULL::text','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('record_member_checkout','public.record_member_checkout(uuid,text)','p_checkin_id uuid, p_notes text DEFAULT NULL::text','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('cancel_member_checkin','public.cancel_member_checkin(uuid,text)','p_checkin_id uuid, p_reason text DEFAULT NULL::text','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('complete_pt_session','public.complete_pt_session(uuid,text)','p_assignment_id uuid, p_notes text','jsonb','pg_catalog, public, extensions, pg_temp',true),
            ('fn_on_auth_user_created','public.fn_on_auth_user_created()','','trigger','pg_catalog, public, extensions, pg_temp',false),
            ('fn_sync_payment_balances','public.fn_sync_payment_balances()','','trigger','pg_catalog, public, extensions, pg_temp',false),
            ('fn_prevent_tamper_payment_records','public.fn_prevent_tamper_payment_records()','','trigger','pg_catalog, public, extensions, pg_temp',false),
            ('audit_staff_invitation_changes','public.audit_staff_invitation_changes()','','trigger','pg_catalog, public, pg_temp',false),
            ('hash_payload','public.hash_payload(jsonb)','p_payload jsonb','text','pg_catalog, public, extensions, pg_temp',false),
            ('generate_member_code','public.generate_member_code()','','text','pg_catalog, public, extensions, pg_temp',false),
            ('generate_receipt_number','public.generate_receipt_number()','','text','pg_catalog, public, extensions, pg_temp',false),
            ('generate_checkin_code','public.generate_checkin_code()','','text','pg_catalog, public, extensions, pg_temp',false)
        ) AS expected(function_name,signature,arguments,result_type,search_path,authenticated_execute)
    LOOP
        SELECT count(*) INTO v_count
        FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=v_req.function_name;
        IF v_count <> 1 OR to_regprocedure(v_req.signature) IS NULL THEN
            RAISE EXCEPTION 'PHASE5_POSTCONDITION: public.% does not have exactly its reviewed overload.', v_req.function_name;
        END IF;

        SELECT pg_get_userbyid(p.proowner), p.proacl::text
        INTO v_owner, v_acl
        FROM pg_catalog.pg_proc p
        WHERE p.oid=to_regprocedure(v_req.signature)
          AND pg_get_function_arguments(p.oid)=v_req.arguments
          AND pg_get_function_result(p.oid)=v_req.result_type
          AND p.prokind='f' AND p.prosecdef
          AND p.proconfig=ARRAY['search_path=' || v_req.search_path]::text[]
          AND p.provariadic=0
          AND pg_get_userbyid(p.proowner) IN ('postgres','supabase_admin')
          AND has_function_privilege('anon',p.oid,'EXECUTE')=false
          AND has_function_privilege('service_role',p.oid,'EXECUTE')=false
          AND has_function_privilege('authenticated',p.oid,'EXECUTE')=v_req.authenticated_execute
          AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
              LEFT JOIN pg_catalog.pg_roles r ON r.oid=acl.grantee
              WHERE acl.privilege_type='EXECUTE'
                AND (acl.grantee=0 OR (acl.grantee<>p.proowner AND NOT (v_req.authenticated_execute AND r.rolname='authenticated')))
          );
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PHASE5_POSTCONDITION: public.% return, argument names, owner, SECURITY DEFINER/search_path, or EXECUTE ACL differs from the reviewed contract.', v_req.function_name;
        END IF;
    END LOOP;

    -- Exact final policy contract; stale or newly added permissive policies abort commit.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies p
        WHERE p.schemaname='public'
          AND p.tablename = ANY (ARRAY['profiles','members','membership_plans','member_subscriptions','payments','pt_packages','trainers','pt_assignments','pt_sessions','idempotency_keys','checkins','notifications','member_followups','gym_info','reminder_settings','staff_invitations','security_audit_logs'])
          AND NOT EXISTS (
              SELECT 1 FROM (VALUES
                  ('profiles','profiles_select_self_or_admin','PERMISSIVE','{authenticated}','SELECT','((id = auth.uid()) OR is_admin())',NULL::text),
                  ('profiles','profiles_update_self','PERMISSIVE','{authenticated}','UPDATE','(id = auth.uid())','(id = auth.uid())'),
                  ('members','members_admin_delete','PERMISSIVE','{authenticated}','DELETE','is_admin()',NULL::text),
                  ('members','members_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text),
                  ('members','members_update_staff','PERMISSIVE','{authenticated}','UPDATE','(is_staff() AND (is_archived = false))','is_staff()'),
                  ('membership_plans','plans_admin','PERMISSIVE','{authenticated}','ALL','is_admin()','is_admin()'),
                  ('membership_plans','plans_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text),
                  ('member_subscriptions','subscriptions_select','PERMISSIVE','{authenticated}','SELECT','is_admin()',NULL::text),
                  ('payments','payments_select','PERMISSIVE','{authenticated}','SELECT','is_admin()',NULL::text),
                  ('pt_packages','packages_admin','PERMISSIVE','{authenticated}','ALL','is_admin()','is_admin()'),
                  ('pt_packages','pt_packages_select_all','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text),
                  ('trainers','trainers_admin','PERMISSIVE','{authenticated}','ALL','is_admin()','is_admin()'),
                  ('trainers','trainers_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text),
                  ('pt_assignments','pt_assignments_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text),
                  ('pt_assignments','pt_assignments_update_staff','PERMISSIVE','{authenticated}','UPDATE','is_staff()','is_staff()'),
                  ('pt_sessions','pt_sessions_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text),
                  ('idempotency_keys','idempotency_actor_access','PERMISSIVE','{authenticated}','ALL','(actor_id = auth.uid())','(actor_id = auth.uid())'),
                  ('checkins','checkins_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text),
                  ('checkins','checkins_insert','PERMISSIVE','{authenticated}','INSERT',NULL::text,'is_staff()'),
                  ('notifications','notifications_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text),
                  ('member_followups','member_followups_insert','PERMISSIVE','{authenticated}','INSERT',NULL::text,'(get_user_role() = ANY (ARRAY[''admin''::text, ''staff''::text]))'),
                  ('member_followups','member_followups_select','PERMISSIVE','{authenticated}','SELECT','(get_user_role() = ANY (ARRAY[''admin''::text, ''staff''::text]))',NULL::text),
                  ('member_followups','member_followups_update','PERMISSIVE','{authenticated}','UPDATE','(get_user_role() = ANY (ARRAY[''admin''::text, ''staff''::text]))',NULL::text),
                  ('gym_info','gym_info_admin','PERMISSIVE','{authenticated}','ALL','is_admin()','is_admin()'),
                  ('gym_info','gym_info_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text),
                  ('reminder_settings','reminder_settings_select','PERMISSIVE','{authenticated}','SELECT','is_staff()',NULL::text),
                  ('reminder_settings','reminder_settings_update','PERMISSIVE','{authenticated}','UPDATE','is_admin()','is_admin()'),
                  ('staff_invitations','staff_invitations_select_admin','PERMISSIVE','{authenticated}','SELECT','is_admin()',NULL::text),
                  ('security_audit_logs','security_audit_logs_select_admin','PERMISSIVE','{authenticated}','SELECT','is_admin()',NULL::text)
              ) AS e(tablename,policyname,permissive,roles,cmd,qual,with_check)
              WHERE e.tablename=p.tablename AND e.policyname=p.policyname AND e.permissive=p.permissive
                AND e.roles=p.roles::text AND e.cmd=p.cmd AND e.qual IS NOT DISTINCT FROM p.qual
                AND e.with_check IS NOT DISTINCT FROM p.with_check
          )
    ) OR EXISTS (
        SELECT 1 FROM (VALUES
            ('profiles','profiles_select_self_or_admin'),('profiles','profiles_update_self'),
            ('members','members_admin_delete'),('members','members_select'),('members','members_update_staff'),
            ('membership_plans','plans_admin'),('membership_plans','plans_select'),
            ('member_subscriptions','subscriptions_select'),('payments','payments_select'),
            ('pt_packages','packages_admin'),('pt_packages','pt_packages_select_all'),
            ('trainers','trainers_admin'),('trainers','trainers_select'),
            ('pt_assignments','pt_assignments_select'),('pt_assignments','pt_assignments_update_staff'),
            ('pt_sessions','pt_sessions_select'),('idempotency_keys','idempotency_actor_access'),
            ('checkins','checkins_select'),('checkins','checkins_insert'),('notifications','notifications_select'),
            ('member_followups','member_followups_insert'),('member_followups','member_followups_select'),('member_followups','member_followups_update'),
            ('gym_info','gym_info_admin'),('gym_info','gym_info_select'),
            ('reminder_settings','reminder_settings_select'),('reminder_settings','reminder_settings_update'),
            ('staff_invitations','staff_invitations_select_admin'),('security_audit_logs','security_audit_logs_select_admin')
        ) AS e(tablename,policyname)
        WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename=e.tablename AND p.policyname=e.policyname)
    ) THEN
        RAISE EXCEPTION 'PHASE5_POSTCONDITION: Final Phase 5 RLS policies differ from the exact role/command/permissive/USING/WITH CHECK manifest.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public'
          AND c.relname = ANY (ARRAY['profiles','members','membership_plans','member_subscriptions','payments','pt_packages','trainers','pt_assignments','pt_sessions','idempotency_keys','checkins','notifications','member_followups','gym_info','reminder_settings','staff_invitations','security_audit_logs'])
          AND NOT c.relrowsecurity
    ) THEN
        RAISE EXCEPTION 'PHASE5_POSTCONDITION: Row-level security is not enabled on every Phase 5 table.';
    END IF;

    -- API/service privileges are checked at table and column level. Service-role
    -- public-schema data access is limited to append-only security audit inserts.
    IF has_table_privilege('authenticated','public.payments','INSERT')
       OR has_table_privilege('authenticated','public.payments','UPDATE')
       OR has_table_privilege('authenticated','public.payments','DELETE')
       OR has_table_privilege('authenticated','public.payments','TRUNCATE')
       OR has_table_privilege('authenticated','public.member_subscriptions','INSERT')
       OR has_table_privilege('authenticated','public.member_subscriptions','UPDATE')
       OR has_table_privilege('authenticated','public.member_subscriptions','DELETE')
       OR has_table_privilege('authenticated','public.member_subscriptions','TRUNCATE') THEN
        RAISE EXCEPTION 'PHASE5_POSTCONDITION: authenticated retains a direct table-level write privilege on financial tables.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid='public.idempotency_keys'::regclass AND a.attnum>0 AND NOT a.attisdropped
          AND (has_column_privilege('authenticated','public.idempotency_keys',a.attname,'SELECT')
            OR has_column_privilege('authenticated','public.idempotency_keys',a.attname,'INSERT')
            OR has_column_privilege('authenticated','public.idempotency_keys',a.attname,'UPDATE')
            OR has_column_privilege('authenticated','public.idempotency_keys',a.attname,'REFERENCES'))
    ) OR has_table_privilege('authenticated','public.idempotency_keys','SELECT')
      OR has_table_privilege('authenticated','public.idempotency_keys','INSERT')
      OR has_table_privilege('authenticated','public.idempotency_keys','UPDATE')
      OR has_table_privilege('authenticated','public.idempotency_keys','DELETE')
      OR has_table_privilege('authenticated','public.idempotency_keys','TRUNCATE') THEN
        RAISE EXCEPTION 'PHASE5_POSTCONDITION: authenticated has direct table or column access to idempotency_keys.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid IN ('public.payments'::regclass,'public.member_subscriptions'::regclass)
          AND a.attnum>0 AND NOT a.attisdropped
          AND (has_column_privilege('authenticated',a.attrelid,a.attname,'INSERT')
            OR has_column_privilege('authenticated',a.attrelid,a.attname,'UPDATE'))
    ) THEN
        RAISE EXCEPTION 'PHASE5_POSTCONDITION: authenticated retains a column-level write grant on a financial table.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM unnest(ARRAY[
            'profiles','members','membership_plans','member_subscriptions','payments','pt_packages','trainers',
            'pt_assignments','pt_sessions','idempotency_keys','checkins','notifications','member_followups',
            'gym_info','reminder_settings','staff_invitations','v_active_members','v_member_dues',
            'v_outstanding_payments','v_notifications','v_staff_roster','v_member_followups','v_attendance_logs','v_admin_pt_assignments'
        ]) AS objects(name)
        WHERE has_table_privilege('service_role','public.' || objects.name,'SELECT')
           OR has_table_privilege('service_role','public.' || objects.name,'UPDATE')
           OR has_table_privilege('service_role','public.' || objects.name,'DELETE')
           OR has_table_privilege('service_role','public.' || objects.name,'TRUNCATE')
           OR (objects.name <> 'security_audit_logs' AND has_table_privilege('service_role','public.' || objects.name,'INSERT'))
    ) THEN
        RAISE EXCEPTION 'PHASE5_POSTCONDITION: service_role has an unapproved direct public-schema table/view privilege.';
    END IF;
    IF NOT has_table_privilege('service_role','public.security_audit_logs','INSERT')
       OR has_table_privilege('service_role','public.security_audit_logs','SELECT')
       OR has_table_privilege('service_role','public.security_audit_logs','UPDATE')
       OR has_table_privilege('service_role','public.security_audit_logs','DELETE') THEN
        RAISE EXCEPTION 'PHASE5_POSTCONDITION: service_role audit access must remain INSERT-only.';
    END IF;

    IF has_table_privilege('anon','public.payments','SELECT')
       OR has_table_privilege('anon','public.member_subscriptions','SELECT')
       OR has_table_privilege('anon','public.idempotency_keys','SELECT')
       OR has_table_privilege('service_role','public.payments','SELECT')
       OR has_table_privilege('service_role','public.member_subscriptions','SELECT')
       OR has_table_privilege('service_role','public.idempotency_keys','SELECT') THEN
        RAISE EXCEPTION 'PHASE5_POSTCONDITION: A non-application role has direct financial or idempotency reads.';
    END IF;

    IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.fn_on_auth_user_created()'::regprocedure) <> '112e23ed56b1d9b50555ec574294197f'
       OR (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.audit_staff_invitation_changes()'::regprocedure) <> 'bf1ce10ca7a05429bb198587e44374ff' THEN
        RAISE EXCEPTION 'PHASE5_POSTCONDITION: Auth or invitation audit trigger-function body differs from the reviewed Phase 5 definition.';
    END IF;

    -- Trigger definitions and multiplicity are checked again after all DDL.
    IF (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal) <> 2
       OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal AND t.tgfoid='public.fn_sync_payment_balances()'::regprocedure) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal AND t.tgname='trg_sync_payment_balances' AND t.tgfoid='public.fn_sync_payment_balances()'::regprocedure AND t.tgtype=29 AND t.tgenabled='O' AND pg_get_triggerdef(t.oid,true)='CREATE TRIGGER trg_sync_payment_balances AFTER INSERT OR DELETE OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION fn_sync_payment_balances()')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal AND t.tgname='trg_prevent_tamper_payment_records' AND t.tgfoid='public.fn_prevent_tamper_payment_records()'::regprocedure AND t.tgtype=27 AND t.tgenabled='O' AND pg_get_triggerdef(t.oid,true)='CREATE TRIGGER trg_prevent_tamper_payment_records BEFORE DELETE OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION fn_prevent_tamper_payment_records()')
       OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal AND t.tgname='trg_on_auth_user_created' AND t.tgfoid='public.fn_on_auth_user_created()'::regprocedure AND t.tgtype=5 AND t.tgenabled='O' AND pg_get_triggerdef(t.oid,true)='CREATE TRIGGER trg_on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION fn_on_auth_user_created()')
       OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.staff_invitations'::regclass AND NOT t.tgisinternal) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.staff_invitations'::regclass AND NOT t.tgisinternal AND t.tgname='trg_audit_staff_invitation_changes' AND t.tgfoid='public.audit_staff_invitation_changes()'::regprocedure AND t.tgtype=21 AND t.tgenabled='O' AND pg_get_triggerdef(t.oid,true)='CREATE TRIGGER trg_audit_staff_invitation_changes AFTER INSERT OR UPDATE OF status, expires_at ON staff_invitations FOR EACH ROW EXECUTE FUNCTION audit_staff_invitation_changes()') THEN
        RAISE EXCEPTION 'PHASE5_POSTCONDITION: Critical payment, Auth, or invitation audit trigger definition/count is wrong.';
    END IF;

    -- View postconditions: every Phase 5 view must exist, have exact target columns/types,
    -- approved owner, exact final security options, and correct API role privileges.
    FOR v_req IN
        SELECT * FROM (VALUES
            ('v_staff_roster',
             ARRAY['id:uuid','full_name:text','role:text','created_at:timestamp with time zone','is_active:boolean','deactivated_at:timestamp with time zone']::text[],
             ARRAY['security_invoker=false','security_barrier=true']::text[]),
            ('v_active_members',
             ARRAY['id:uuid','member_code:text','name:text','phone:text','email:text','gender:text','dob:date','is_archived:boolean','current_subscription_id:uuid','plan_name:text','plan_price:numeric(12,2)','total_liability:numeric(12,2)','amount_paid:numeric(12,2)','balance:numeric(12,2)','payment_status:text','start_date:date','expiry_date:date','subscription_status:text']::text[],
             ARRAY['security_invoker=false','security_barrier=true']::text[]),
            ('v_member_dues',
             ARRAY['member_id:uuid','member_code:text','member_name:text','phone:text','email:text','is_archived:boolean','subscription_id:uuid','plan_name:text','start_date:date','expiry_date:date','total_amount_due:numeric(12,2)','amount_paid:numeric(12,2)','outstanding_balance:numeric(12,2)','payment_status:text','subscription_status:text']::text[],
             ARRAY['security_invoker=false','security_barrier=true']::text[]),
            ('v_outstanding_payments',
             ARRAY['member_id:uuid','member_code:text','member_name:text','phone:text','email:text','is_archived:boolean','subscription_id:uuid','plan_name:text','start_date:date','expiry_date:date','total_amount_due:numeric(12,2)','amount_paid:numeric(12,2)','outstanding_balance:numeric(12,2)','payment_status:text','subscription_status:text']::text[],
             ARRAY['security_invoker=false','security_barrier=true']::text[]),
            ('v_notifications',
             ARRAY['id:uuid','member_id:uuid','subscription_id:uuid','member_code:text','member_name:text','member_phone:text','plan_name:text','subscription_status:text','start_date:date','expiry_date:date','current_balance:numeric','notification_type:text','title:text','message:text','days_remaining:integer','target_date:date','channel:text','status:text','read_at:timestamp with time zone','read_by:uuid','created_at:timestamp with time zone','updated_at:timestamp with time zone','is_superseded:boolean','whatsapp_sent_at:timestamp with time zone','whatsapp_sent_by:uuid','whatsapp_sent_by_name:text']::text[],
             ARRAY['security_invoker=false','security_barrier=true']::text[]),
            ('v_member_followups',
             ARRAY['id:uuid','member_id:uuid','member_code:text','member_name:text','phone:text','category:text','reason:text','priority:text','due_date:date','status:text','notes:text','outcome:text','completed_at:timestamp with time zone','created_at:timestamp with time zone','updated_at:timestamp with time zone']::text[],
             ARRAY['security_invoker=true']::text[]),
            ('v_admin_pt_assignments',
             ARRAY['id:uuid','member_id:uuid','package_id:uuid','trainer_id:uuid','total_sessions:integer','completed_sessions:integer','fee_amount:numeric(12,2)','amount_paid:numeric(12,2)','balance:numeric(12,2)','status:text','start_date:date','notes:text','created_at:timestamp with time zone']::text[],
             ARRAY['security_invoker=false','security_barrier=true']::text[]),
            ('v_attendance_logs',
             ARRAY['id:uuid','checkin_code:text','member_id:uuid','member_code:text','member_name:text','member_phone:text','plan_name:text','checked_in_at:timestamp with time zone','checked_out_at:timestamp with time zone','status:text','notes:text','actor_id:uuid','actor_name:text','created_at:timestamp with time zone','updated_at:timestamp with time zone']::text[],
             ARRAY['security_invoker=true']::text[])
        ) AS expected(view_name,columns,final_options)
    LOOP
        IF to_regclass('public.' || v_req.view_name) IS NULL THEN
            RAISE EXCEPTION 'PHASE5_POSTCONDITION: Required view public.% is missing.', v_req.view_name;
        END IF;

        IF (SELECT c.relkind FROM pg_catalog.pg_class c WHERE c.oid=to_regclass('public.' || v_req.view_name)) <> 'v' THEN
            RAISE EXCEPTION 'PHASE5_POSTCONDITION: public.% exists but is not a regular view.', v_req.view_name;
        END IF;

        IF pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid=to_regclass('public.' || v_req.view_name))) NOT IN ('postgres','supabase_admin') THEN
            RAISE EXCEPTION 'PHASE5_POSTCONDITION: public.% has an unapproved owner.', v_req.view_name;
        END IF;

        SELECT array_agg(a.attname::text || ':' || format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
        INTO v_columns
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid=to_regclass('public.' || v_req.view_name) AND a.attnum>0 AND NOT a.attisdropped;

        IF v_columns IS DISTINCT FROM v_req.columns THEN
            RAISE EXCEPTION 'PHASE5_POSTCONDITION: public.% output names/types differ from the target contract.', v_req.view_name;
        END IF;

        SELECT c.reloptions INTO v_reloptions
        FROM pg_catalog.pg_class c
        WHERE c.oid=to_regclass('public.' || v_req.view_name);

        IF NOT (
            (v_reloptions IS NULL AND v_req.final_options IS NULL)
            OR (v_reloptions IS NOT NULL AND v_req.final_options IS NOT NULL
                AND v_reloptions <@ v_req.final_options AND v_req.final_options <@ v_reloptions)
        ) THEN
            RAISE EXCEPTION 'PHASE5_POSTCONDITION: public.% options % differ from required target options %.',
                v_req.view_name, v_reloptions, v_req.final_options;
        END IF;

        IF has_table_privilege('anon', 'public.' || v_req.view_name, 'SELECT') THEN
            RAISE EXCEPTION 'PHASE5_POSTCONDITION: anon role has SELECT on public.%.', v_req.view_name;
        END IF;

        IF NOT has_table_privilege('authenticated', 'public.' || v_req.view_name, 'SELECT') THEN
            RAISE EXCEPTION 'PHASE5_POSTCONDITION: authenticated role lacks SELECT on public.%.', v_req.view_name;
        END IF;
    END LOOP;
END;
$phase5_postconditions$;



COMMIT;

-- ============================================================================
-- PART C: POST-TRANSACTION CLEANUP
-- ============================================================================
-- Explicitly clean up the session temporary table after successful COMMIT:
DROP TABLE IF EXISTS pg_temp.phase5_profile_activation_map;

DO $post_cleanup$
BEGIN
    RAISE NOTICE 'Phase 5 production execution successfully completed, committed, and cleaned up.';
END;
$post_cleanup$;
