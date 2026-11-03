import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const container = 'supabase_db_The_Fitness_house_admin_Panel';
const enabled = process.env.PHASE5_LOCAL_DB_TESTS === '1';
const migrationDir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

function verifyLocalTarget() {
  const containers = execFileSync('docker', [
    'ps', '--filter', `name=${container}`, '--format', '{{.Names}}\t{{.Ports}}\t{{.Status}}',
  ], { encoding: 'utf8', timeout: 10000 }).trim().split(/\r?\n/);
  assert.equal(containers.length, 1, 'Expected exactly one named local Supabase database container');
  assert.ok(containers[0].startsWith(`${container}\t`), 'Unexpected database container name');
  assert.ok(containers[0].includes('54322->5432'), 'Expected the verified local 54322 database port');
  assert.ok(containers[0].includes('healthy'), 'Local Supabase database container must be healthy');

  const identity = execFileSync('docker', [
    'exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t',
    '-c', "SELECT current_database() || '|' || current_setting('server_version_num');",
  ], { encoding: 'utf8', timeout: 10000 }).trim();
  assert.equal(identity, 'postgres|170011', 'Expected PostgreSQL 17 in the named local database');
}

function psqlArgs(sql) {
  return [
    'exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ];
}

function runSql(sql) {
  verifyLocalTarget();
  return spawnSync('docker', psqlArgs(sql), { encoding: 'utf8', timeout: 30000 });
}

function runOk(sql) {
  const result = runSql(sql);
  assert.equal(result.status, 0, `Local SQL failed:\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

function runExpectedFailure(sql, expectedText) {
  const result = runSql(sql);
  assert.notEqual(result.status, 0, `Expected local SQL to fail with ${expectedText}`);
  assert.match(`${result.stderr}\n${result.stdout}`, new RegExp(expectedText));
}

function spawnSql(sql) {
  verifyLocalTarget();
  return new Promise((resolve, reject) => {
    const child = spawn('docker', psqlArgs(sql), { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill(), 20000);
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

function jsonRows(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('{')).map(JSON.parse);
}

function userInsert(id, email) {
  return `INSERT INTO auth.users (id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
          VALUES ('${id}'::uuid,'authenticated','authenticated','${email}',clock_timestamp(),'{}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp());`;
}

function profileInsert(id, email, name, role, active = true, deactivatedAt = 'NULL') {
  return `INSERT INTO public.profiles (id,email,full_name,role,is_active,deactivated_at)
          VALUES ('${id}'::uuid,'${email}','${name}','${role}',${active},${deactivatedAt});`;
}

test('local PostgreSQL 17 migration state and security catalog', { skip: !enabled }, () => {
  const expected = readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort().map((name) => name.split('_', 1)[0]);
  const actual = runOk('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;').split(/\r?\n/);
  assert.equal(new Set(actual).size, actual.length, 'Local migration ledger must not contain duplicate versions');
  assert.deepEqual([...actual].sort(), [...expected].sort(), 'Local migration ledger must match every repository migration');
  assert.equal(runOk("SELECT count(*) FROM (SELECT tablename,roles,cmd FROM pg_policies WHERE schemaname='public' GROUP BY tablename,roles,cmd HAVING count(*) > 1) p;"), '0');
  assert.equal(runOk("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND p.proconfig IS NULL;"), '0');
  assert.equal(runOk("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'EXECUTE');"), '0');
  assert.equal(runOk("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('fn_on_auth_user_created','fn_sync_payment_balances','fn_prevent_tamper_payment_records','audit_staff_invitation_changes') AND has_function_privilege('authenticated',p.oid,'EXECUTE');"), '0');
  assert.equal(runOk("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('get_user_role','is_admin','is_staff','can_accept_staff_invitation','create_staff_invitation','resend_staff_invitation','revoke_staff_invitation','accept_staff_invitation','admin_set_user_status','admin_set_user_role','record_dues_payment','record_pt_dues_payment','renew_member_subscription','onboard_member','assign_pt_package','get_staff_operational_summary','record_member_checkin','record_member_checkout','cancel_member_checkin','complete_pt_session') AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE'));"), '0');
  assert.equal(runOk("SELECT has_column_privilege('authenticated','public.pt_assignments','fee_amount','SELECT')::text || '|' || has_column_privilege('authenticated','public.pt_assignments','amount_paid','SELECT')::text || '|' || has_column_privilege('authenticated','public.pt_assignments','balance','SELECT')::text;"), 'false|false|false');
  assert.equal(runOk("SELECT has_table_privilege('authenticated','public.idempotency_keys','SELECT')::text || '|' || has_table_privilege('authenticated','public.idempotency_keys','INSERT')::text || '|' || has_table_privilege('authenticated','public.idempotency_keys','UPDATE')::text || '|' || has_table_privilege('authenticated','public.payments','UPDATE')::text || '|' || has_table_privilege('authenticated','public.member_subscriptions','DELETE')::text;"), 'false|false|false|false|false');
  assert.equal(runOk("SELECT count(*) FROM pg_attribute a WHERE a.attrelid='public.idempotency_keys'::regclass AND a.attnum>0 AND NOT a.attisdropped AND (has_column_privilege('authenticated',a.attrelid,a.attname,'SELECT') OR has_column_privilege('authenticated',a.attrelid,a.attname,'INSERT') OR has_column_privilege('authenticated',a.attrelid,a.attname,'UPDATE'));"), '0');
  assert.equal(runOk("SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid='public.v_member_followups'::regclass;"), 't');
  assert.equal(runOk("SELECT reloptions @> ARRAY['security_invoker=false','security_barrier=true'] FROM pg_class WHERE oid='public.v_active_members'::regclass;"), 't');
  assert.equal(runOk("SELECT roles::text||'|'||cmd||'|'||permissive||'|'||qual FROM pg_policies WHERE schemaname='public' AND tablename='trainers' AND policyname='trainers_select';"), '{authenticated}|SELECT|PERMISSIVE|is_staff()');
  assert.equal(runOk("SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND ((t.tgrelid='public.payments'::regclass AND t.tgname IN ('trg_sync_payment_balances','trg_prevent_tamper_payment_records')) OR (t.tgrelid='auth.users'::regclass AND t.tgname='trg_on_auth_user_created') OR (t.tgrelid='public.staff_invitations'::regclass AND t.tgname='trg_audit_staff_invitation_changes')) AND t.tgenabled='O';"), '4');
  assert.equal(runOk("SELECT pg_get_functiondef('public.get_user_role()'::regprocedure) LIKE '%is_active = true%' AND pg_get_functiondef('public.is_admin()'::regprocedure) LIKE '%is_active = true%';"), 't');
});

test('local PostgreSQL role matrix and operational workflows', { skip: !enabled }, () => {
  const ids = Object.fromEntries([
    'admin','admin2','staff','inactive','invited','expired','revoked','wrong','plan','member','member2','package','trainer','assignment','notification','followup',
  ].map((name) => [name, randomUUID()]));
  const emails = Object.fromEntries(['admin','admin2','staff','inactive','invited','expired','revoked','wrong'].map((name) => [name, `p5-${name}-${ids[name].slice(0,8)}@example.invalid`]));
  const phone = `555${ids.member.replaceAll('-', '').slice(0,10)}`;
  const phone2 = `555${ids.member2.replaceAll('-', '').slice(0,10)}`;
  const inviteEmail = emails.invited;
  const expiredEmail = emails.expired;
  const revokedEmail = emails.revoked;
  const wrongInviteEmail = `p5-wrong-invite-${ids.wrong.slice(0,8)}@example.invalid`;
  const key = `p5-role-${ids.admin}`;
  const onboardKey = `p5-onboard-${ids.staff}`;
  const assignKey = `p5-assign-${ids.staff}`;
  const onboardEmail = `p5-onboard-${ids.staff.slice(0,8)}@example.invalid`;

  const sql = `
BEGIN;
${userInsert(ids.admin, emails.admin)}
${userInsert(ids.admin2, emails.admin2)}
${userInsert(ids.staff, emails.staff)}
${userInsert(ids.inactive, emails.inactive)}
${profileInsert(ids.admin, emails.admin, 'Phase 5 Admin', 'admin')}
${profileInsert(ids.admin2, emails.admin2, 'Phase 5 Admin Two', 'admin')}
${profileInsert(ids.staff, emails.staff, 'Phase 5 Staff', 'staff')}
${profileInsert(ids.inactive, emails.inactive, 'Phase 5 Inactive', 'staff', false, 'clock_timestamp()')}

INSERT INTO public.membership_plans (id,name,duration_days,price,is_active) VALUES ('${ids.plan}'::uuid,'Phase 5 Test Plan',30,1000,true);
INSERT INTO public.members (id,member_code,name,phone,email,is_archived) VALUES ('${ids.member}'::uuid,'P5-${ids.member.slice(0,8)}','Phase 5 Member','${phone}','p5-member-${ids.member.slice(0,8)}@example.invalid',false);
INSERT INTO public.members (id,member_code,name,phone,email,is_archived) VALUES ('${ids.member2}'::uuid,'P5-${ids.member2.slice(0,8)}','Phase 5 Member Two','${phone2}','p5-member-${ids.member2.slice(0,8)}@example.invalid',false);
INSERT INTO public.member_subscriptions (id,member_id,plan_id,plan_name,plan_price,previous_balance_carried,amount_paid,start_date,expiry_date,status)
VALUES ('${randomUUID()}'::uuid,'${ids.member}'::uuid,'${ids.plan}'::uuid,'Phase 5 Test Plan',1000,0,0,current_date-1,current_date+29,'active');
INSERT INTO public.member_subscriptions (id,member_id,plan_id,plan_name,plan_price,previous_balance_carried,amount_paid,start_date,expiry_date,status)
VALUES ('${randomUUID()}'::uuid,'${ids.member2}'::uuid,'${ids.plan}'::uuid,'Phase 5 Test Plan',1000,0,0,current_date-1,current_date+29,'active');
INSERT INTO public.pt_packages (id,name,total_sessions,price,is_active) VALUES ('${ids.package}'::uuid,'Phase 5 PT Package',5,500,true);
INSERT INTO public.trainers (id,name,is_active) VALUES ('${ids.trainer}'::uuid,'Phase 5 Trainer',true);
INSERT INTO public.pt_assignments (id,member_id,package_id,trainer_id,total_sessions,completed_sessions,fee_amount,amount_paid,status,start_date,notes)
VALUES ('${ids.assignment}'::uuid,'${ids.member}'::uuid,'${ids.package}'::uuid,'${ids.trainer}'::uuid,5,0,500,0,'active',current_date,'initial');
INSERT INTO public.notifications (id,member_id,subscription_id,notification_type,title,message,target_date)
SELECT '${ids.notification}'::uuid,'${ids.member}'::uuid,id,'expiry_5d','Phase 5 notice','Test notification',current_date+10
FROM public.member_subscriptions WHERE member_id='${ids.member}'::uuid;
INSERT INTO public.member_followups (id,member_id,category,reason,priority,due_date,created_by)
VALUES ('${ids.followup}'::uuid,'${ids.member}'::uuid,'general','Phase 5 follow-up','medium',current_date+1,'${ids.admin}'::uuid);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '${ids.admin}';
SELECT public.create_staff_invitation('${inviteEmail}','Phase 5 Invitee');
DO $phase5$
DECLARE v_invitation public.staff_invitations%ROWTYPE;
BEGIN
  SELECT * INTO v_invitation FROM public.staff_invitations WHERE email='${inviteEmail}';
  IF v_invitation.id IS NULL OR v_invitation.role <> 'staff' OR v_invitation.status <> 'pending' THEN RAISE EXCEPTION 'Admin invitation creation contract failed'; END IF;
END
$phase5$;
RESET ROLE;

${userInsert(ids.invited, inviteEmail)}
SET LOCAL request.jwt.claim.sub = '${ids.invited}';
DO $phase5$
BEGIN
  IF public.get_user_role() IS DISTINCT FROM NULL THEN RAISE EXCEPTION 'Role lookup unexpectedly activated a pending invite'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id='${ids.invited}'::uuid AND is_active=false AND deactivated_at IS NULL) THEN RAISE EXCEPTION 'Auth trigger did not create inactive invite profile'; END IF;
END
$phase5$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '${ids.invited}';
DO $phase5$
BEGIN
  IF public.get_user_role() IS NOT NULL THEN RAISE EXCEPTION 'Pending invitation role lookup was not read-only'; END IF;
  IF NOT public.can_accept_staff_invitation() THEN RAISE EXCEPTION 'Valid linked invitation was not eligible'; END IF;
END
$phase5$;
SELECT public.accept_staff_invitation();
DO $phase5$
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'staff' THEN RAISE EXCEPTION 'Explicit acceptance did not activate staff'; END IF;
END
$phase5$;
RESET ROLE;

${userInsert(ids.expired, expiredEmail)}
${userInsert(ids.revoked, revokedEmail)}
${userInsert(ids.wrong, emails.wrong)}
${profileInsert(ids.expired, expiredEmail, 'Expired Invitee', 'staff', false)}
${profileInsert(ids.revoked, revokedEmail, 'Revoked Invitee', 'staff', false)}
${profileInsert(ids.wrong, emails.wrong, 'Wrong Email Invitee', 'staff', false)}
INSERT INTO public.staff_invitations (email,full_name,role,status,invited_by,auth_user_id,expires_at)
VALUES ('${expiredEmail}','Expired Invitee','staff','pending','${ids.admin}'::uuid,'${ids.expired}'::uuid,clock_timestamp()-interval '1 hour'),
       ('${revokedEmail}','Revoked Invitee','staff','revoked','${ids.admin}'::uuid,'${ids.revoked}'::uuid,clock_timestamp()+interval '7 days'),
       ('${wrongInviteEmail}','Wrong Email Invitee','staff','pending','${ids.admin}'::uuid,'${ids.wrong}'::uuid,clock_timestamp()+interval '7 days');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '${ids.expired}';
DO $phase5$
DECLARE v_failed boolean;
BEGIN
  IF public.can_accept_staff_invitation() THEN RAISE EXCEPTION 'Expired invitation was eligible'; END IF;
  v_failed := false; BEGIN PERFORM public.accept_staff_invitation(); EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Expired invitation was accepted'; END IF;
END
$phase5$;
SET LOCAL request.jwt.claim.sub = '${ids.revoked}';
DO $phase5$
DECLARE v_failed boolean;
BEGIN
  IF public.can_accept_staff_invitation() THEN RAISE EXCEPTION 'Revoked invitation was eligible'; END IF;
  v_failed := false; BEGIN PERFORM public.accept_staff_invitation(); EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Revoked invitation was accepted'; END IF;
END
$phase5$;
SET LOCAL request.jwt.claim.sub = '${ids.wrong}';
DO $phase5$
DECLARE v_failed boolean;
BEGIN
  IF public.can_accept_staff_invitation() THEN RAISE EXCEPTION 'Wrong-email invitation was eligible'; END IF;
  v_failed := false; BEGIN PERFORM public.accept_staff_invitation(); EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Wrong-email invitation was accepted'; END IF;
END
$phase5$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '${ids.admin2}';
DO $phase5$
DECLARE v_response jsonb;
BEGIN
  v_response := public.record_dues_payment('${ids.member2}'::uuid,(SELECT id FROM public.member_subscriptions WHERE member_id='${ids.member2}'::uuid),30,'Cash','Same key different actor','${key}');
  IF v_response->>'member_id' IS DISTINCT FROM '${ids.member2}' OR v_response->>'subscription_id' IS NULL THEN
    RAISE EXCEPTION 'Idempotency cache crossed actor boundary';
  END IF;
  IF (SELECT count(*) FROM public.payments WHERE member_id='${ids.member2}'::uuid) <> 1 THEN
    RAISE EXCEPTION 'Second actor did not receive its own financial operation';
  END IF;
END
$phase5$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '${ids.admin}';
DO $phase5$
DECLARE v_first jsonb; v_second jsonb; v_report jsonb;
BEGIN
  v_first := public.record_dues_payment('${ids.member}'::uuid,(SELECT id FROM public.member_subscriptions WHERE member_id='${ids.member}'::uuid),125,'Cash','Phase 5 role test','${key}');
  v_second := public.record_dues_payment('${ids.member}'::uuid,(SELECT id FROM public.member_subscriptions WHERE member_id='${ids.member}'::uuid),125,'Cash','Phase 5 role test','${key}');
  IF v_first->>'payment_id' IS DISTINCT FROM v_second->>'payment_id' THEN RAISE EXCEPTION 'Sequential identical payment retry changed its response'; END IF;
  IF (SELECT count(*) FROM public.payments WHERE member_id='${ids.member}'::uuid) <> 1 THEN RAISE EXCEPTION 'Sequential retry created a duplicate payment'; END IF;
  v_report := public.get_executive_revenue_report(clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day');
  IF NOT (v_report ? 'gross_cash_collections') THEN RAISE EXCEPTION 'Admin revenue report was unavailable'; END IF;
  IF (SELECT count(*) FROM public.v_admin_pt_assignments WHERE id='${ids.assignment}'::uuid) <> 1 THEN RAISE EXCEPTION 'Admin PT financial view failed'; END IF;
  IF (SELECT balance FROM public.v_active_members WHERE id='${ids.member}'::uuid) IS NULL THEN RAISE EXCEPTION 'Admin active-member financial view was masked'; END IF;
  IF (SELECT count(*) FROM public.v_member_dues WHERE member_id='${ids.member}'::uuid) <> 1 THEN RAISE EXCEPTION 'Admin dues view failed'; END IF;
  IF (SELECT current_balance FROM public.v_notifications WHERE id='${ids.notification}'::uuid) IS NULL THEN RAISE EXCEPTION 'Admin notification balance was masked'; END IF;
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Admin role resolution failed'; END IF;
  BEGIN PERFORM public.admin_set_user_status('${ids.admin}'::uuid,false); RAISE EXCEPTION 'Self-deactivation unexpectedly succeeded'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.admin_set_user_role('${ids.admin}'::uuid,'staff'); RAISE EXCEPTION 'Self-demotion unexpectedly succeeded'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END
$phase5$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '${ids.staff}';
DO $phase5$
DECLARE v_rows integer; v_onboard jsonb; v_onboard_retry jsonb; v_assigned jsonb; v_assigned_retry jsonb; v_checkin jsonb; v_checkin_id uuid; v_cancel jsonb;
DECLARE v_denied boolean;
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'staff' THEN RAISE EXCEPTION 'Active staff role resolution failed'; END IF;
  IF (SELECT count(*) FROM public.members WHERE id='${ids.member}'::uuid) <> 1 THEN RAISE EXCEPTION 'Staff member access failed'; END IF;
  IF (SELECT count(*) FROM public.payments WHERE member_id='${ids.member}'::uuid) <> 0 THEN RAISE EXCEPTION 'Staff read payment ledger amounts'; END IF;
  IF (SELECT count(*) FROM public.member_subscriptions WHERE member_id='${ids.member}'::uuid) <> 0 THEN RAISE EXCEPTION 'Staff read subscription finances'; END IF;
  IF (SELECT count(*) FROM public.v_admin_pt_assignments WHERE id='${ids.assignment}'::uuid) <> 0 THEN RAISE EXCEPTION 'Staff read admin PT financial view'; END IF;
  IF (SELECT count(*) FROM public.v_member_dues) <> 0 OR (SELECT count(*) FROM public.v_outstanding_payments) <> 0 THEN RAISE EXCEPTION 'Staff read admin dues reports'; END IF;
  IF (SELECT plan_price IS NOT NULL OR total_liability IS NOT NULL OR amount_paid IS NOT NULL OR balance IS NOT NULL OR payment_status IS NOT NULL FROM public.v_active_members WHERE id='${ids.member}'::uuid) THEN RAISE EXCEPTION 'Staff saw membership financial fields in active-member view'; END IF;
  IF (SELECT current_balance FROM public.v_notifications WHERE id='${ids.notification}'::uuid) IS NOT NULL THEN RAISE EXCEPTION 'Staff saw notification balance'; END IF;
  IF (SELECT count(*) FROM public.v_member_followups WHERE id='${ids.followup}'::uuid) <> 1 THEN RAISE EXCEPTION 'Staff follow-up view failed under invoker RLS'; END IF;
  v_denied := false; BEGIN PERFORM fee_amount FROM public.pt_assignments WHERE id='${ids.assignment}'::uuid; EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Staff direct PT fee column read succeeded'; END IF;
  UPDATE public.members SET notes='staff operational edit' WHERE id='${ids.member}'::uuid;
  UPDATE public.pt_assignments SET notes='staff PT operational edit' WHERE id='${ids.assignment}'::uuid;
  v_checkin := public.record_member_checkin('${ids.member}'::uuid,'Phase 5 check-in');
  v_checkin_id := (v_checkin->>'checkin_id')::uuid;
  IF (SELECT count(*) FROM public.v_attendance_logs WHERE id=v_checkin_id) <> 1 THEN RAISE EXCEPTION 'Staff attendance view failed'; END IF;
  PERFORM public.record_member_checkout(v_checkin_id,'Phase 5 check-out');
  v_checkin := public.record_member_checkin('${ids.member}'::uuid,'Phase 5 cancel check-in');
  v_cancel := public.cancel_member_checkin((v_checkin->>'checkin_id')::uuid,'test cancellation');
  IF v_cancel->>'status' <> 'cancelled' THEN RAISE EXCEPTION 'Staff check-in cancellation failed'; END IF;
  IF (public.complete_pt_session('${ids.assignment}'::uuid,'Phase 5 PT session')->>'session_number')::integer <> 1 THEN RAISE EXCEPTION 'Staff PT session workflow failed'; END IF;
  IF NOT (public.create_member_followup('${ids.member}'::uuid,'general','Phase 5 staff follow-up','medium',current_date+1,'test')->>'success')::boolean THEN RAISE EXCEPTION 'Staff follow-up create failed'; END IF;
  PERFORM public.mark_notification_read('${ids.notification}'::uuid);
  v_onboard := public.onboard_member('Phase 5 Onboarded','555${ids.staff.replaceAll('-', '').slice(0,10)}','${onboardEmail}',NULL,NULL,NULL,NULL,NULL,NULL,'Staff onboarding test','${ids.plan}'::uuid,current_date,0,'Cash','${onboardKey}');
  v_onboard_retry := public.onboard_member('Phase 5 Onboarded','555${ids.staff.replaceAll('-', '').slice(0,10)}','${onboardEmail}',NULL,NULL,NULL,NULL,NULL,NULL,'Staff onboarding test','${ids.plan}'::uuid,current_date,0,'Cash','${onboardKey}');
  IF v_onboard->>'member_id' IS DISTINCT FROM v_onboard_retry->>'member_id' THEN RAISE EXCEPTION 'Staff onboarding retry did not return cached result'; END IF;
  IF v_onboard ? 'plan_price' OR v_onboard ? 'initial_payment_amount' OR v_onboard ? 'payment_id' OR v_onboard ? 'receipt_number' OR v_onboard ? 'outstanding_balance' THEN RAISE EXCEPTION 'Staff onboarding leaked financial fields'; END IF;
  v_assigned := public.assign_pt_package('${ids.member}'::uuid,'${ids.package}'::uuid,'${ids.trainer}'::uuid,current_date,0,'Cash','Staff PT assignment','${assignKey}');
  v_assigned_retry := public.assign_pt_package('${ids.member}'::uuid,'${ids.package}'::uuid,'${ids.trainer}'::uuid,current_date,0,'Cash','Staff PT assignment','${assignKey}');
  IF v_assigned->>'pt_assignment_id' IS DISTINCT FROM v_assigned_retry->>'pt_assignment_id' THEN RAISE EXCEPTION 'Staff PT assignment retry did not return cached result'; END IF;
  IF v_assigned ? 'fee_amount' OR v_assigned ? 'amount_paid' OR v_assigned ? 'outstanding_balance' OR v_assigned ? 'receipt_number' THEN RAISE EXCEPTION 'Staff PT assignment leaked financial fields'; END IF;
  IF (SELECT count(*) FROM public.get_staff_operational_summary()) <> 1 THEN RAISE EXCEPTION 'Staff operational summary unavailable'; END IF;
  v_denied := false; BEGIN PERFORM public.create_staff_invitation('p5-forbidden@example.invalid','Forbidden'); EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Staff created a staff invitation'; END IF;
  v_denied := false; BEGIN PERFORM public.admin_set_user_status('${ids.admin}'::uuid,false); EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Staff deactivated an admin'; END IF;
END
$phase5$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '${ids.inactive}';
DO $phase5$
DECLARE v_denied boolean;
BEGIN
  IF public.get_user_role() IS NOT NULL THEN RAISE EXCEPTION 'Inactive profile resolved an active role'; END IF;
  IF (SELECT count(*) FROM public.members) <> 0 OR (SELECT count(*) FROM public.pt_packages) <> 0 THEN RAISE EXCEPTION 'Inactive profile read operational data'; END IF;
  v_denied := false; BEGIN PERFORM public.record_member_checkin('${ids.member}'::uuid,'inactive'); EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Inactive user recorded attendance'; END IF;
  v_denied := false; BEGIN PERFORM public.complete_pt_session('${ids.assignment}'::uuid,'inactive'); EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Inactive user completed a PT session'; END IF;
  IF public.can_accept_staff_invitation() THEN RAISE EXCEPTION 'Inactive non-invite profile became invitation eligible'; END IF;
END
$phase5$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $phase5$
DECLARE v_denied boolean;
BEGIN
  IF has_table_privilege(current_user,'public.members','SELECT') OR has_table_privilege(current_user,'public.payments','SELECT') THEN RAISE EXCEPTION 'anon has sensitive SELECT grants'; END IF;
  IF has_function_privilege(current_user,'public.is_admin()','EXECUTE') OR has_function_privilege(current_user,'public.admin_set_user_status(uuid,boolean)','EXECUTE') THEN RAISE EXCEPTION 'anon has privileged RPC grants'; END IF;
  v_denied := false; BEGIN PERFORM 1 FROM public.members; EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'anon read private member data'; END IF;
END
$phase5$;
SET LOCAL ROLE service_role;
DO $phase5$
BEGIN
  IF has_table_privilege('service_role','public.members','SELECT') OR has_table_privilege('service_role','public.payments','SELECT')
     OR has_table_privilege('service_role','public.member_subscriptions','SELECT')
     OR has_table_privilege('service_role','public.idempotency_keys','SELECT')
     OR has_table_privilege('service_role','public.member_subscriptions','UPDATE') THEN
    RAISE EXCEPTION 'service_role retained direct access to sensitive application data';
  END IF;
  IF NOT has_table_privilege('service_role','public.security_audit_logs','INSERT') OR has_table_privilege('service_role','public.security_audit_logs','SELECT') THEN
    RAISE EXCEPTION 'service_role audit privilege scope is incorrect';
  END IF;
  INSERT INTO public.security_audit_logs (action,details)
  VALUES ('phase5_service_role_append_test','{"local_fixture":true}'::jsonb);
END
$phase5$;
RESET ROLE;
ROLLBACK;
`;

  runOk(sql);
});

test('local PostgreSQL payment and renewal idempotency under concurrent transactions', { skip: !enabled }, async () => {
  const ids = Object.fromEntries(['admin','plan','member','subscription','package','trainer','assignment'].map((name) => [name, randomUUID()]));
  const email = `p5-concurrency-${ids.admin.slice(0,8)}@example.invalid`;
  const phone = `666${ids.member.replaceAll('-', '').slice(0,10)}`;
  const keys = {
    dues: `p5-dues-${ids.admin}`,
    pt: `p5-pt-${ids.admin}`,
    renewal: `p5-renewal-${ids.admin}`,
    retry: `p5-retry-${ids.admin}`,
  };
  let fixtureCreated = false;
  const cleanupSql = `BEGIN;
ALTER TABLE public.payments DISABLE TRIGGER trg_prevent_tamper_payment_records;
DELETE FROM public.payments WHERE member_id='${ids.member}'::uuid;
DELETE FROM public.idempotency_keys WHERE actor_id='${ids.admin}'::uuid AND idempotency_key IN ('${keys.dues}','${keys.pt}','${keys.renewal}','${keys.retry}');
DELETE FROM public.pt_sessions WHERE assignment_id='${ids.assignment}'::uuid;
DELETE FROM public.pt_assignments WHERE id='${ids.assignment}'::uuid;
DELETE FROM public.member_subscriptions WHERE member_id='${ids.member}'::uuid;
DELETE FROM public.members WHERE id='${ids.member}'::uuid;
DELETE FROM public.pt_packages WHERE id='${ids.package}'::uuid;
DELETE FROM public.trainers WHERE id='${ids.trainer}'::uuid;
DELETE FROM public.membership_plans WHERE id='${ids.plan}'::uuid;
DELETE FROM public.profiles WHERE id='${ids.admin}'::uuid;
DELETE FROM auth.users WHERE id='${ids.admin}'::uuid;
ALTER TABLE public.payments ENABLE TRIGGER trg_prevent_tamper_payment_records;
COMMIT;`;

  try {
    runOk(`BEGIN;
${userInsert(ids.admin, email)}
${profileInsert(ids.admin, email, 'Phase 5 Concurrency Admin', 'admin')}
INSERT INTO public.membership_plans (id,name,duration_days,price,is_active) VALUES ('${ids.plan}'::uuid,'Phase 5 Concurrency Plan',30,1000,true);
INSERT INTO public.members (id,member_code,name,phone,email,is_archived) VALUES ('${ids.member}'::uuid,'P5-${ids.member.slice(0,8)}','Concurrency Member','${phone}','p5-member-${ids.member.slice(0,8)}@example.invalid',false);
INSERT INTO public.member_subscriptions (id,member_id,plan_id,plan_name,plan_price,previous_balance_carried,amount_paid,start_date,expiry_date,status)
VALUES ('${ids.subscription}'::uuid,'${ids.member}'::uuid,'${ids.plan}'::uuid,'Phase 5 Concurrency Plan',1000,0,0,current_date-1,current_date+29,'active');
INSERT INTO public.pt_packages (id,name,total_sessions,price,is_active) VALUES ('${ids.package}'::uuid,'Phase 5 Concurrency PT',5,500,true);
INSERT INTO public.trainers (id,name,is_active) VALUES ('${ids.trainer}'::uuid,'Phase 5 Concurrency Trainer',true);
INSERT INTO public.pt_assignments (id,member_id,package_id,trainer_id,total_sessions,completed_sessions,fee_amount,amount_paid,status,start_date)
VALUES ('${ids.assignment}'::uuid,'${ids.member}'::uuid,'${ids.package}'::uuid,'${ids.trainer}'::uuid,5,0,500,0,'active',current_date);
COMMIT;`);
    fixtureCreated = true;

    async function race(sql) {
      const first = spawnSql(sql);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const second = spawnSql(sql);
      const [a, b] = await Promise.all([first, second]);
      assert.equal(a.code, 0, `First concurrent transaction failed: ${a.stderr}`);
      assert.equal(b.code, 0, `Second concurrent transaction failed: ${b.stderr}`);
      const firstJson = jsonRows(a.stdout);
      const secondJson = jsonRows(b.stdout);
      assert.equal(firstJson.length, 1, `First transaction did not return one JSON result: ${a.stdout}`);
      assert.equal(secondJson.length, 1, `Second transaction did not return one JSON result: ${b.stdout}`);
      assert.deepEqual(secondJson[0], firstJson[0], 'Concurrent identical requests must return the same cached JSON');
      return firstJson[0];
    }

    const adminSet = `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${ids.admin}';`;
    const duesSql = `BEGIN; ${adminSet} SELECT public.record_dues_payment('${ids.member}'::uuid,'${ids.subscription}'::uuid,100,'Cash','concurrent dues','${keys.dues}'); SELECT pg_sleep(1); COMMIT;`;
    const dues = await race(duesSql);
    assert.equal(runOk(`SELECT count(*) FROM public.payments WHERE subscription_id='${ids.subscription}'::uuid AND transaction_type='payment';`), '1');
    const duesRetry = JSON.parse(runOk(`BEGIN; ${adminSet} SELECT public.record_dues_payment('${ids.member}'::uuid,'${ids.subscription}'::uuid,100,'Cash','concurrent dues','${keys.dues}'); COMMIT;`));
    assert.equal(duesRetry.payment_id, dues.payment_id);
    runExpectedFailure(`BEGIN; ${adminSet} SELECT public.record_dues_payment('${ids.member}'::uuid,'${ids.subscription}'::uuid,101,'Cash','different payload','${keys.dues}'); COMMIT;`, 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH');
    runExpectedFailure(`BEGIN; ${adminSet} SELECT public.record_dues_payment('${ids.member}'::uuid,'${ids.subscription}'::uuid,100,'Cash','blank key',''); COMMIT;`, 'Idempotency key is required');

    const ptSql = `BEGIN; ${adminSet} SELECT public.record_pt_dues_payment('${ids.member}'::uuid,'${ids.assignment}'::uuid,50,'UPI','concurrent PT dues','${keys.pt}'); SELECT pg_sleep(1); COMMIT;`;
    const pt = await race(ptSql);
    assert.equal(runOk(`SELECT count(*) FROM public.payments WHERE pt_assignment_id='${ids.assignment}'::uuid AND transaction_type='payment';`), '1');
    runExpectedFailure(`BEGIN; ${adminSet} SELECT public.record_pt_dues_payment('${ids.member}'::uuid,'${ids.assignment}'::uuid,51,'UPI','different payload','${keys.pt}'); COMMIT;`, 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH');
    runExpectedFailure(`BEGIN; ${adminSet} SELECT public.record_pt_dues_payment('${ids.member}'::uuid,'${ids.assignment}'::uuid,50,'UPI','blank key',''); COMMIT;`, 'Idempotency key is required');

    const renewalSql = `BEGIN; ${adminSet} SELECT public.renew_member_subscription('${ids.member}'::uuid,'${ids.plan}'::uuid,current_date,true,0,'Cash','${keys.renewal}'); SELECT pg_sleep(1); COMMIT;`;
    const renewal = await race(renewalSql);
    assert.equal(runOk(`SELECT count(*) FROM public.member_subscriptions WHERE member_id='${ids.member}'::uuid AND status='active';`), '1');
    assert.equal(runOk(`SELECT count(*) FROM public.member_subscriptions WHERE member_id='${ids.member}'::uuid;`), '2');
    runExpectedFailure(`BEGIN; ${adminSet} SELECT public.renew_member_subscription('${ids.member}'::uuid,'${ids.plan}'::uuid,current_date+1,true,0,'Cash','${keys.renewal}'); COMMIT;`, 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH');
    runExpectedFailure(`BEGIN; ${adminSet} SELECT public.renew_member_subscription('${ids.member}'::uuid,'${ids.plan}'::uuid,current_date,true,0,'Cash',''); COMMIT;`, 'Idempotency key is required');

    const failedAttempt = runOk(`BEGIN; ${adminSet} SELECT public.record_dues_payment('${ids.member}'::uuid,'${ids.subscription}'::uuid,75,'Cash','rollback then retry','${keys.retry}'); ROLLBACK;`);
    assert.equal(jsonRows(failedAttempt).length, 1);
    assert.equal(runOk(`SELECT count(*) FROM public.idempotency_keys WHERE actor_id='${ids.admin}'::uuid AND idempotency_key='${keys.retry}';`), '0');
    runOk(`BEGIN; ${adminSet} SELECT public.record_dues_payment('${ids.member}'::uuid,'${ids.subscription}'::uuid,75,'Cash','rollback then retry','${keys.retry}'); COMMIT;`);
    assert.equal(runOk(`SELECT count(*) FROM public.payments WHERE subscription_id='${ids.subscription}'::uuid AND transaction_type='payment';`), '2');
    assert.ok(pt.payment_id && renewal.subscription_id, 'PT payment and renewal return identifiers');
  } finally {
    if (fixtureCreated) runOk(cleanupSql);
  }
});
