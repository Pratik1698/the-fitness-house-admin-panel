import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const remediation = read('../supabase/migrations/20261102010000_phase5_security_audit_remediation.sql');
const invitationMigration = read('../supabase/migrations/20261102000003_phase5_staff_security_and_invitations.sql');
const policyCleanup = read('../supabase/migrations/20261102020000_phase5_policy_cleanup.sql');
const followupViewSecurity = read('../supabase/migrations/20261102030000_phase5_followup_view_security.sql');
const operationalRpcSecurity = read('../supabase/migrations/20261102040000_phase5_active_role_operational_rpcs.sql');
const staffSummaryFix = read('../supabase/migrations/20261102050000_phase5_staff_summary_schema_fix.sql');
const authService = read('../src/services/authService.js');
const invitationFunction = read('../supabase/functions/invite-staff/index.ts');

function getFunctionBody(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${escapedName}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
  assert.ok(match, `Expected function ${name} in migration source`);
  return match[1];
}

test('financial RPCs reject blank keys, lock before cache lookup, and bind retries to the same payload', () => {
  for (const name of ['record_dues_payment', 'record_pt_dues_payment', 'renew_member_subscription']) {
    const body = getFunctionBody(remediation, name);
    const keyCheck = body.indexOf('IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) =');
    const lock = body.indexOf('pg_advisory_xact_lock');
    const cacheRead = body.indexOf('SELECT response, payload_hash INTO v_cached_response');
    const cacheWrite = body.indexOf('INSERT INTO public.idempotency_keys');

    assert.notEqual(keyCheck, -1, `${name} must reject an empty idempotency key`);
    assert.ok(lock > keyCheck, `${name} must validate the key before locking`);
    assert.ok(cacheRead > lock, `${name} must lock before checking the cache`);
    assert.ok(cacheWrite > cacheRead, `${name} must cache its result after the serialized lookup`);
    assert.match(body, /v_cached_hash IS DISTINCT FROM v_payload_hash/);
    assert.match(body, /ON CONFLICT \(actor_id, operation, idempotency_key\) DO NOTHING/);
  }
});

test('onboarding and PT assignment keep idempotency and redact financial fields for staff on cache hits and fresh responses', () => {
  for (const [name, privateFields] of [
    ['onboard_member', ['plan_price', 'initial_payment_amount', 'payment_id', 'receipt_number', 'outstanding_balance']],
    ['assign_pt_package', ['fee_amount', 'amount_paid', 'outstanding_balance', 'receipt_number']],
  ]) {
    const body = getFunctionBody(remediation, name);
    assert.match(body, /IF p_idempotency_key IS NULL OR btrim\(p_idempotency_key\) =/);
    assert.ok(body.indexOf('pg_advisory_xact_lock') < body.indexOf('SELECT response, payload_hash INTO v_cached_response'));
    assert.match(body, /RETURN v_cached_response - ARRAY\[/);
    assert.match(body, /RETURN v_response - ARRAY\[/);
    for (const field of privateFields) assert.match(body, new RegExp(`'${field}'`));
  }
});

test('staff PT reads are column-scoped and admin financial reads use a guarded barrier view', () => {
  assert.match(remediation, /REVOKE ALL ON TABLE public\.pt_assignments FROM PUBLIC, anon, authenticated/);
  const staffGrant = remediation.match(/GRANT SELECT \(([^)]+)\) ON public\.pt_assignments TO authenticated/);
  assert.ok(staffGrant, 'Expected a scoped staff SELECT grant');
  for (const financialColumn of ['fee_amount', 'amount_paid', 'credit_adjustments', 'balance', 'payment_status']) {
    assert.equal(staffGrant[1].includes(financialColumn), false, `${financialColumn} must not be granted to staff`);
  }
  assert.match(remediation, /VIEW public\.v_admin_pt_assignments WITH \(security_invoker = false, security_barrier = true\)/);
  assert.match(remediation, /FROM public\.pt_assignments\s+WHERE public\.is_admin\(\)/);
  assert.match(remediation, /REVOKE ALL ON public\.idempotency_keys FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(remediation, /REVOKE ALL \(%s\) ON TABLE public\.%I FROM PUBLIC, anon, service_role/);
  assert.match(remediation, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.%I FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(remediation, /REVOKE ALL ON public\.v_admin_pt_assignments FROM service_role/);
  assert.doesNotMatch(remediation, /DROP\s+VIEW[^;]*CASCADE/i);
});

test('sensitive views use explicit security barriers and sequence revokes stay scoped', () => {
  for (const name of ['v_staff_roster', 'v_active_members', 'v_member_dues', 'v_outstanding_payments', 'v_notifications']) {
    assert.match(invitationMigration, new RegExp(`VIEW public\\.${name} WITH \\(security_invoker = false, security_barrier = true\\)`));
  }
  assert.match(remediation, /REVOKE ALL ON SEQUENCE public\.member_code_seq, public\.receipt_number_seq, public\.checkin_code_seq/);
  assert.doesNotMatch(remediation, /REVOKE ALL ON ALL SEQUENCES/i);
  assert.doesNotMatch(remediation, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public/i);
  assert.match(remediation, /REVOKE ALL ON FUNCTION[\s\S]*public\.get_user_role\(\)/);
  assert.match(remediation, /REVOKE ALL ON FUNCTION[\s\S]*public\.fn_sync_payment_balances\(\)/);
  assert.match(remediation, /REVOKE ALL ON FUNCTION public\.audit_staff_invitation_changes\(\) FROM PUBLIC, anon, authenticated, service_role/);
});

test('profile activation migration requires explicit mapping for ambiguous existing users', () => {
  assert.match(invitationMigration, /ADD COLUMN IF NOT EXISTS is_active BOOLEAN,/);
  assert.doesNotMatch(invitationMigration, /ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true/i);
  assert.match(invitationMigration, /PHASE5_PROFILE_MAP_REQUIRED/);
  assert.match(invitationMigration, /phase5_profile_activation_map/);
  assert.match(invitationMigration, /source_reference IS NULL OR btrim\(source_reference\) = ''/);
  assert.match(invitationMigration, /v_mapping_count <> v_profile_count/);
  assert.match(invitationMigration, /ALTER COLUMN is_active SET DEFAULT true/);
  assert.match(invitationMigration, /SET is_active = m\.is_active,[\s\S]*deactivated_at = m\.deactivated_at/);
});

test('payment and subscription writes, idempotency data, and trigger-only functions stay outside direct API access', () => {
  assert.match(remediation, /REVOKE ALL \(%s\) ON TABLE public\.%I FROM authenticated/);
  assert.match(remediation, /'payments', 'member_subscriptions', 'idempotency_keys'/);
  assert.match(remediation, /public\.audit_staff_invitation_changes\(\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(remediation, /public\.fn_on_auth_user_created\(\)/);
  assert.match(remediation, /public\.fn_prevent_tamper_payment_records\(\)/);
  assert.match(operationalRpcSecurity, /FROM PUBLIC, anon, service_role/);
});

test('trainer table policies require an active staff role', () => {
  assert.match(invitationMigration, /CREATE POLICY "trainers_select" ON public\.trainers\s+FOR SELECT TO authenticated\s+USING \(public\.is_staff\(\)\)/);
});

test('legacy permissive policies cannot OR-bypass active-role gates', () => {
  assert.match(policyCleanup, /DROP POLICY IF EXISTS packages_select ON public\.pt_packages/);
  assert.match(policyCleanup, /DROP POLICY IF EXISTS followups_select ON public\.member_followups/);
});

test('follow-up view uses invoker RLS because its projection has no role predicate', () => {
  assert.match(followupViewSecurity, /ALTER VIEW public\.v_member_followups SET \(security_invoker = true\)/);
});

test('SECURITY DEFINER operational RPCs require an active staff or admin role', () => {
  for (const name of ['record_member_checkin', 'record_member_checkout', 'cancel_member_checkin', 'complete_pt_session']) {
    const body = getFunctionBody(operationalRpcSecurity, name);
    assert.match(body, /v_actor_id IS NULL OR NOT public\.is_staff\(\)/, `${name} must reject inactive or unroled callers`);
  }
});

test('staff operational summary counts the canonical PT session timestamp without financial data', () => {
  const body = getFunctionBody(staffSummaryFix, 'get_staff_operational_summary');
  assert.match(body, /IF NOT public\.is_staff\(\)/);
  assert.match(body, /FROM public\.pt_sessions\s+WHERE conducted_at >=/);
  assert.doesNotMatch(body, /session_date|\bstatus\s*=\s*'completed'/);
  assert.match(body, /'pt_sessions_month', v_pt_sessions_month/);
  assert.doesNotMatch(body, /revenue|amount_paid|balance|payment/);
});

test('role lookup never accepts invitations; pending invitations require an explicit acceptance action', () => {
  const roleLookup = authService.slice(authService.indexOf('export async function getUserRole'), authService.indexOf('export async function canAcceptStaffInvitation'));
  assert.doesNotMatch(roleLookup, /accept_staff_invitation/);
  assert.match(authService, /rpc\('can_accept_staff_invitation'\)/);
  assert.match(authService, /await canAcceptStaffInvitation\(\)/);
  assert.match(invitationMigration, /CREATE OR REPLACE FUNCTION public\.accept_staff_invitation\(\)/);
  assert.match(invitationMigration, /status = 'pending'[\s\S]*?expires_at > clock_timestamp\(\)/);
});

test('invitation management RPCs preserve caller identity and report external-action audit failures', () => {
  assert.match(invitationFunction, /callerClient\.rpc\(\s*"create_staff_invitation"/);
  assert.match(invitationFunction, /callerClient\.rpc\(\s*"resend_staff_invitation"/);
  assert.match(invitationFunction, /callerClient\.rpc\(\s*"revoke_staff_invitation"/);
  assert.match(invitationFunction, /if \(auditError\)/);
  assert.match(invitationFunction, /partialSuccess: true/);
  assert.match(invitationFunction, /allowedRedirectOrigins\.has\(requestOrigin\)/);
  assert.doesNotMatch(invitationFunction, /adminClient\.rpc\(\s*"(?:create_staff_invitation|resend_staff_invitation|revoke_staff_invitation)"/);
});

test('remediation is non-destructive to existing member and financial rows', () => {
  assert.doesNotMatch(remediation, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM\s+public\.(?:members|member_subscriptions|payments|pt_assignments|pt_sessions)/i);
  assert.match(remediation, /REVOKE TRUNCATE ON TABLE/);
});
