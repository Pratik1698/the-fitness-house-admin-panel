# Phase 5 Production Activation Checklist

## Status and blockers

Production was not contacted or changed. Previously supplied observations say the hosted migration history is incomplete, profiles lacked activation columns, and staff_invitations/security_audit_logs were absent from an earlier column inspection; these observations are not independently verified and later objects may exist. Production Query 6–9 outputs (RLS policy definitions, table privileges, column privileges, function definitions/ACLs) and payment trigger inventory were collected and incorporated into local preflights. However, Queries 1–5 (server/version identity, migration ledger history, core table column types and generated expressions, view definitions/options, view dependencies) and the full public trigger inventory are still pending collection. Actual production compatibility is therefore unknown. Do not apply the forward bundle until the remaining read-only inventory below is reviewed and every difference is resolved.

Candidate: supabase/production-migrations/20261102_phase5_security_forward.sql. It is outside supabase/migrations and does not run automatically. It was verified only against local PostgreSQL 17.11. It is one transaction with strict preflight and postconditions. Local success is not hosted compatibility evidence.

## Read-only catalog inventory

Have the database owner independently confirm the intended project in the approved console. Use an authorized read-only session. Review function definitions locally; retain redacted findings only. Never include credentials or secret values.

    BEGIN READ ONLY;

    SELECT current_database() AS database_name,
           current_setting('server_version_num') AS server_version_num,
           current_user AS inspection_role;

    SELECT version, name
    FROM supabase_migrations.schema_migrations
    ORDER BY version;

    SELECT table_name, column_name, data_type, udt_name, is_nullable,
           is_generated, generation_expression, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY (ARRAY[
        'profiles','members','membership_plans','member_subscriptions','payments',
        'pt_packages','trainers','pt_assignments','pt_sessions','idempotency_keys',
        'checkins','notifications','member_followups','staff_invitations',
        'security_audit_logs','gym_info','reminder_settings'
      ])
    ORDER BY table_name, ordinal_position;

    SELECT c.relname AS view_name, pg_get_userbyid(c.relowner) AS view_owner,
           c.reloptions,
           (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid,a.atttypmod), ', ' ORDER BY a.attnum)
            FROM pg_catalog.pg_attribute a
            WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS output_columns,
           pg_get_viewdef(c.oid, true) AS view_definition
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND c.relname = ANY (ARRAY[
        'v_active_members','v_member_dues','v_outstanding_payments','v_notifications',
        'v_member_followups','v_staff_roster','v_admin_pt_assignments','v_attendance_logs'
      ])
    ORDER BY c.relname;

    SELECT v.relname AS dependent_view, d.refobjid::regclass AS referenced_relation,
           d.refobjsubid AS referenced_column_number
    FROM pg_catalog.pg_rewrite r
    JOIN pg_catalog.pg_class v ON v.oid = r.ev_class
    JOIN pg_catalog.pg_namespace n ON n.oid = v.relnamespace
    JOIN pg_catalog.pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid
    WHERE n.nspname = 'public' AND v.relkind = 'v'
      AND v.relname = ANY (ARRAY[
        'v_active_members','v_member_dues','v_outstanding_payments','v_notifications',
        'v_member_followups','v_staff_roster','v_admin_pt_assignments','v_attendance_logs'
      ])
      AND d.refclassid = 'pg_class'::regclass AND d.refobjid <> v.oid
    ORDER BY v.relname, referenced_relation::text, referenced_column_number;

    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;

    SELECT table_name, grantee, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND grantee IN ('PUBLIC','anon','authenticated','service_role')
    ORDER BY table_name, grantee, privilege_type;

    SELECT table_name, column_name, grantee, privilege_type
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND grantee IN ('PUBLIC','anon','authenticated','service_role')
    ORDER BY table_name, column_name, grantee, privilege_type;

    SELECT n.nspname AS schema_name, p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments,
           pg_get_function_arguments(p.oid) AS arguments_with_names_and_defaults,
           pg_get_function_result(p.oid) AS return_type,
           pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
           p.proconfig AS function_settings, p.proacl AS execute_acl,
           pg_get_functiondef(p.oid) AS definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    ORDER BY p.proname, identity_arguments;

    SELECT t.tgrelid::regclass AS table_name, t.tgname AS trigger_name,
           t.tgenabled, pg_get_triggerdef(t.oid, true) AS trigger_definition,
           p.oid::regprocedure AS trigger_function,
           pg_get_functiondef(p.oid) AS trigger_function_definition
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal
      AND t.tgrelid::regclass::text LIKE 'public.%'
    ORDER BY table_name::text, trigger_name;

    SELECT conrelid::regclass AS table_name, conname, contype,
           pg_get_constraintdef(oid, true) AS definition, convalidated
    FROM pg_catalog.pg_constraint
    WHERE connamespace = 'public'::regnamespace
    ORDER BY table_name::text, conname;

    SELECT schemaname, tablename, indexname, indexdef
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname;

    SELECT schemaname, sequencename, data_type
    FROM pg_catalog.pg_sequences
    WHERE schemaname = 'public'
    ORDER BY sequencename;

    SELECT e.extname, n.nspname AS extension_schema, e.extversion
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
    ORDER BY e.extname;

    ROLLBACK;

Separately, identify the authoritative source of disabled/suspended-user state, without exporting unnecessary personal data. The DBA must review get_user_role, is_admin, is_staff, all financial/idempotent RPCs, invitation RPCs, Auth user-creation logic, and payment/audit triggers against the repository. Review function source locally rather than pasting definitions into an unredacted report.

## Explicit profile activation mapping

The production forward bundle does not assume that existing profiles are active. If profile activation cannot be reliably inferred from existing columns and constraints, it requires a temporary map created and populated in the same SQL session before running the bundle. The map must cover every existing profile exactly once and provide an explicit status, deactivation timestamp, and nonempty source reference. Active profiles must have no deactivation timestamp.

Use an approved authoritative account-status source (for example, the reviewed suspension/deactivation register); do not generate all-active rows, infer status from role, or omit unknown users. Example shape only:

    CREATE TEMP TABLE phase5_profile_activation_map (
      profile_id uuid PRIMARY KEY,
      is_active boolean NOT NULL,
      deactivated_at timestamptz,
      source_reference text NOT NULL
    );

Populate it with individually reviewed profile IDs and outcomes. If any existing profile cannot be reconciled or a source reference cannot be provided, stop without running the migration. Keep the table and migration in the same SQL session; a separate session cannot see this temporary mapping.

## Go/no-go checks

- [ ] Confirm the inspection target and PostgreSQL version (15+).
- [ ] Reconcile migration history to actual catalog state; do not infer absence from a missing ledger row.
- [ ] Compare all listed columns/types/generated expressions, nullability/defaults, constraints, FKs, indexes, roles, extensions and sequences.
- [ ] Compare view output names/types, owner/options, definitions and dependencies. Investigate missing dependent objects from prior cascade drops.
- [ ] Compare exact policy roles, command, permissiveness, USING and WITH CHECK. Same-name policies with different definitions are not compatible.
- [ ] Compare exact function overloads, argument names/defaults, return types, owners, SECURITY DEFINER settings, search paths, ACLs and bodies.
- [ ] Confirm exact critical payment synchronization/tamper, Auth creation, audit and invitation trigger counts and definitions.
- [ ] Confirm service_role database consumers outside this repository. The retained in-repository workflows are Auth administration through Auth APIs and audit-log INSERT from the invite/session Edge Functions.
- [ ] Prepare and independently review the complete profile activation map. Abort if any status is ambiguous.
- [ ] Review the final SQL/checksum, backup/restore point, maintenance window and approved smoke accounts. Use a test mail sink.

Any difference requires a reviewed compatibility edit and another local replay. A passing preflight does not substitute for review of the production inventory.

## Deployment sequence after a separate approval

1. Obtain the read-only inventory above and retain a protected pre-change catalog snapshot.
2. Compare every result with the forward bundle. Resolve all differences, including external consumers, profile states and objects missing after any earlier cascade operation.
3. Freeze the reviewed source revision and SQL checksum; obtain the approved backup/restore point and change-window authorization.
4. Independently verify the production target in the approved console. In one approved SQL session, create and populate the explicit profile map if required, then execute exactly the reviewed file: supabase/production-migrations/20261102_phase5_security_forward.sql. Stop on any error. Do not run supabase link, supabase db push, remote migration comparison, or reset.
5. Use read-only postchecks for columns/tables, function signatures and paths, views/dependencies, policies/grants, and audit/payment triggers. Record revision/checksum/operator and use the DBA's documented migration-ledger strategy.
6. With approved test accounts and test mail sink, smoke-test admin reports/payment, staff operations, inactive-user denial, invitation acceptance and audit logging. Verify financial fields remain unavailable to staff.
7. Deploy the reviewed Edge Functions and frontend only under their separate approved release process. Monitor authorization, payment, invitation and audit errors.
8. If checks fail, stop rollout. Roll back the application where possible; use the approved snapshot or a separately reviewed forward correction. Do not use destructive rollback SQL or cascade drops.

## Recovery and data preservation

The candidate has no business-row deletion/truncation and no cascade view drops. DDL is transaction-scoped, so a preflight or DDL failure before commit rolls back. Function/ACL rollback cannot be generated safely without exact pre-change definitions/grants; retain the catalog snapshot and prefer a reviewed forward correction. Preserve all member, subscription, payment, receipt, attendance, PT and follow-up rows.
