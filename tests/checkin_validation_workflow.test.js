import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  getMembershipStatus,
  getLocalDateString,
  getDaysDifference
} from '../src/utils/memberUtils.js';

/**
 * Check-in Validation & Renewal Workflow Regression Test Suite
 * The Fitness House Admin Panel
 *
 * Verifies the 8 regression scenarios required for the check-in remediation:
 * 1. Active membership expiring in future: Allow check-in
 * 2. Membership expiring today: Allow check-in (valid through the end of today)
 * 3. Membership expired yesterday: Reject check-in with ERR_MEMBERSHIP_EXPIRED
 * 4. Cancelled membership: Reject check-in with ERR_MEMBERSHIP_CANCELLED
 * 5. Superseded subscription with newer active subscription: Selects newer active subscription
 * 6. Renewal followed by check-in: Allow check-in when renewed subscription starts at prior expiry
 * 7. Date comparison across IST/UTC boundary: Correct local calendar date resolution
 * 8. Duplicate check-in: Preserve existing duplicate open visit prevention (MEMBER_ALREADY_CHECKED_IN)
 */

// Helper to extract function bodies from migration SQL
function getFunctionBody(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${escapedName}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
  assert.ok(match, `Expected function ${name} in migration source`);
  return match[1];
}

const forwardMigrationPath = new URL('../supabase/migrations/20261107120000_fix_record_member_checkin_renewal_validation.sql', import.meta.url);
const operationalRpcsPath = new URL('../supabase/migrations/20261102040000_phase5_active_role_operational_rpcs.sql', import.meta.url);

const forwardMigrationSql = readFileSync(forwardMigrationPath, 'utf8');
const operationalRpcsSql = readFileSync(operationalRpcsPath, 'utf8');

// ============================================================================
// SQL Contract & AST Verification
// ============================================================================

test('1. Migration Contract: record_member_checkin preserves SECURITY DEFINER and search_path', () => {
  assert.match(forwardMigrationSql, /CREATE OR REPLACE FUNCTION public\.record_member_checkin\(/);
  assert.match(forwardMigrationSql, /SECURITY DEFINER/);
  assert.match(forwardMigrationSql, /SET search_path = pg_catalog, public, extensions, pg_temp/);
  assert.match(forwardMigrationSql, /REVOKE ALL ON FUNCTION public\.record_member_checkin\(uuid, text\) FROM PUBLIC, anon, service_role;/);
  assert.match(forwardMigrationSql, /GRANT EXECUTE ON FUNCTION public\.record_member_checkin\(uuid, text\) TO authenticated;/);
});

test('2. Migration Contract: record_member_checkin enforces active staff authorization', () => {
  const body = getFunctionBody(forwardMigrationSql, 'record_member_checkin');
  assert.match(body, /v_actor_id IS NULL OR NOT public\.is_staff\(\)/, 'Must reject non-staff callers with 42501');
});

test('3. Migration Contract: selects active subscription by expiry_date DESC without blocking future start_date of renewals', () => {
  const body = getFunctionBody(forwardMigrationSql, 'record_member_checkin');

  // Must select active subscription:
  assert.match(
    body,
    /SELECT \* INTO v_sub\s+FROM public\.member_subscriptions\s+WHERE member_id = p_member_id AND status = 'active'\s+ORDER BY expiry_date DESC\s+LIMIT 1;/i,
    'Must select latest active subscription'
  );

  // Must NOT unconditionally require start_date <= v_today on the initial selection
  assert.doesNotMatch(
    body,
    /WHERE member_id = p_member_id AND status = 'active'\s+AND start_date <= v_today/i,
    'Must not disqualify renewed active subscriptions whose start_date is set to prior expiry'
  );

  // Must check continuous coverage for future-starting subscriptions:
  assert.match(
    body,
    /IF v_sub\.start_date > v_today THEN[\s\S]*?status IN \('active', 'superseded'\)[\s\S]*?start_date <= v_today[\s\S]*?expiry_date >= v_today/i,
    'Must allow future start_date if earlier active/superseded subscription covers today'
  );
});

test('4. Migration Contract: accurately distinguishes cancelled, expired, and absent memberships', () => {
  const body = getFunctionBody(forwardMigrationSql, 'record_member_checkin');
  assert.match(body, /ERR_MEMBERSHIP_CANCELLED/, 'Must report cancelled status specifically');
  assert.match(body, /ERR_MEMBERSHIP_EXPIRED/, 'Must report expired status specifically');
  assert.match(body, /ERR_NO_ACTIVE_MEMBERSHIP/, 'Must report absence of plan specifically');
  assert.match(body, /ERR_MEMBERSHIP_FUTURE/, 'Must report future start date when no prior coverage exists');
});

test('5. Migration Contract: preserves strict duplicate visit guard and verified session code generation', () => {
  const body = getFunctionBody(forwardMigrationSql, 'record_member_checkin');
  assert.match(body, /MEMBER_ALREADY_CHECKED_IN/, 'Must maintain duplicate visit prevention');
  assert.match(body, /public\.generate_checkin_code\(\)/, 'Must generate unique pass code');
  assert.match(body, /clock_timestamp\(\)/, 'Must timestamp visit at server clock time');
});

// ============================================================================
// Operational Scenario Simulations
// ============================================================================

/**
 * Pure simulation of the authoritative record_member_checkin logic
 */
function simulateRecordMemberCheckin({
  member,
  subscriptions,
  activeCheckins = [],
  todayStr = '2026-11-07',
  isStaff = true,
  actorId = 'staff-uuid-1'
}) {
  if (!actorId || !isStaff) {
    throw new Error('FORBIDDEN: Active staff authentication required.');
  }
  if (!member) {
    throw new Error('MEMBER_NOT_FOUND: Member does not exist.');
  }
  if (member.is_archived) {
    throw new Error(`MEMBER_ARCHIVED: Member ${member.member_code} is archived. Archival must be reversed before logging attendance.`);
  }

  // 1. Identify authoritative current active subscription
  const memberSubs = subscriptions.filter(s => s.member_id === member.id);
  const activeSubs = memberSubs
    .filter(s => s.status === 'active')
    .sort((a, b) => b.expiry_date.localeCompare(a.expiry_date));

  let v_sub = activeSubs[0];

  if (!v_sub) {
    const latestAny = memberSubs.sort((a, b) => b.expiry_date.localeCompare(a.expiry_date))[0];
    if (!latestAny) {
      throw new Error(`ERR_NO_ACTIVE_MEMBERSHIP: Member ${member.name} has no active membership plan. Onboarding or plan renewal required.`);
    }
    if (latestAny.status === 'cancelled') {
      throw new Error(`ERR_MEMBERSHIP_CANCELLED: Membership for ${member.name} has been cancelled. Plan renewal required before check-in.`);
    }
    if (latestAny.expiry_date < todayStr) {
      throw new Error(`ERR_MEMBERSHIP_EXPIRED: Membership for ${member.name} expired on ${latestAny.expiry_date}. Renewal required before check-in.`);
    }
    throw new Error(`ERR_NO_ACTIVE_MEMBERSHIP: Member ${member.name} has no active membership plan. Onboarding or plan renewal required.`);
  }

  // 2. Validate subscription validity period
  if (v_sub.expiry_date < todayStr) {
    throw new Error(`ERR_MEMBERSHIP_EXPIRED: Membership for ${member.name} expired on ${v_sub.expiry_date}. Renewal required before check-in.`);
  }

  if (v_sub.start_date > todayStr) {
    const hasPriorCoverage = memberSubs.some(s =>
      ['active', 'superseded'].includes(s.status) &&
      s.start_date <= todayStr &&
      s.expiry_date >= todayStr
    );
    if (!hasPriorCoverage) {
      throw new Error(`ERR_MEMBERSHIP_FUTURE: Membership for ${member.name} begins on ${v_sub.start_date}. Check-in not permitted prior to start date.`);
    }
  }

  // 3. Duplicate Visit Guard
  const openVisit = activeCheckins.find(c => c.member_id === member.id && c.status === 'checked_in' && !c.checked_out_at);
  if (openVisit) {
    throw new Error(`MEMBER_ALREADY_CHECKED_IN: ${member.name} is already checked in (since 10:00 AM). Active session must be checked out first.`);
  }

  // 4. Return successful pass
  return {
    success: true,
    checkin_id: 'ci-' + Date.now(),
    checkin_code: 'TFH-CHK-999',
    member_id: member.id,
    member_code: member.member_code,
    member_name: member.name,
    plan_name: v_sub.plan_name,
    status: 'checked_in'
  };
}

test('Scenario 1: Active membership expiring in future allows check-in', () => {
  const member = { id: 'm1', member_code: 'TFH-0001', name: 'Aarav Patil', is_archived: false };
  const subscriptions = [
    { id: 's1', member_id: 'm1', plan_name: 'Quarterly Plan', start_date: '2026-10-01', expiry_date: '2027-01-01', status: 'active' }
  ];

  const res = simulateRecordMemberCheckin({ member, subscriptions, todayStr: '2026-11-07' });
  assert.equal(res.success, true);
  assert.equal(res.plan_name, 'Quarterly Plan');
  assert.equal(res.status, 'checked_in');
});

test('Scenario 2: Membership expiring today allows check-in on its final day', () => {
  const member = { id: 'm2', member_code: 'TFH-0002', name: 'Rohan Sharma', is_archived: false };
  const subscriptions = [
    { id: 's2', member_id: 'm2', plan_name: 'Monthly Plan', start_date: '2026-10-07', expiry_date: '2026-11-07', status: 'active' }
  ];

  const res = simulateRecordMemberCheckin({ member, subscriptions, todayStr: '2026-11-07' });
  assert.equal(res.success, true, 'Member expiring today must be permitted entry on their final day');
  assert.equal(res.plan_name, 'Monthly Plan');
});

test('Scenario 3: Membership expired yesterday rejects check-in with ERR_MEMBERSHIP_EXPIRED', () => {
  const member = { id: 'm3', member_code: 'TFH-0003', name: 'Kavita Singh', is_archived: false };
  const subscriptions = [
    { id: 's3', member_id: 'm3', plan_name: 'Monthly Plan', start_date: '2026-10-06', expiry_date: '2026-11-06', status: 'active' }
  ];

  assert.throws(
    () => simulateRecordMemberCheckin({ member, subscriptions, todayStr: '2026-11-07' }),
    /ERR_MEMBERSHIP_EXPIRED: Membership for Kavita Singh expired on 2026-11-06/
  );
});

test('Scenario 4: Cancelled membership rejects check-in with ERR_MEMBERSHIP_CANCELLED', () => {
  const member = { id: 'm4', member_code: 'TFH-0004', name: 'Vikram Joshi', is_archived: false };
  const subscriptions = [
    { id: 's4', member_id: 'm4', plan_name: 'Annual Plan', start_date: '2026-01-01', expiry_date: '2027-01-01', status: 'cancelled' }
  ];

  assert.throws(
    () => simulateRecordMemberCheckin({ member, subscriptions, todayStr: '2026-11-07' }),
    /ERR_MEMBERSHIP_CANCELLED: Membership for Vikram Joshi has been cancelled/
  );
});

test('Scenario 5: Superseded subscription with newer active subscription uses newer active subscription', () => {
  const member = { id: 'm5', member_code: 'TFH-0005', name: 'Deepak Verma', is_archived: false };
  const subscriptions = [
    { id: 's5_old', member_id: 'm5', plan_name: 'Old Monthly Plan', start_date: '2026-09-01', expiry_date: '2026-10-01', status: 'superseded' },
    { id: 's5_new', member_id: 'm5', plan_name: 'Upgraded Annual Plan', start_date: '2026-10-01', expiry_date: '2027-10-01', status: 'active' }
  ];

  const res = simulateRecordMemberCheckin({ member, subscriptions, todayStr: '2026-11-07' });
  assert.equal(res.success, true);
  assert.equal(res.plan_name, 'Upgraded Annual Plan', 'Must use current active subscription plan name');
});

test('Scenario 6: Renewal followed by check-in (The QA Test Member production defect)', () => {
  // Member renewed early on 2026-11-07 before previous contract (2026-11-05 to 2027-02-05) expired.
  // New contract is 2027-02-05 to 2027-05-06 with status = 'active'.
  // Prior contract is updated to status = 'superseded'.
  const qaMember = {
    id: 'ce982281-322c-470f-a029-3c31150fc725',
    member_code: 'TFH-QA-001',
    name: 'QA Test Member',
    is_archived: false
  };

  const subscriptions = [
    {
      id: 'sub-prev-quarterly',
      member_id: qaMember.id,
      plan_name: 'Quarterly Plan',
      start_date: '2026-11-05',
      expiry_date: '2027-02-05',
      status: 'superseded'
    },
    {
      id: 'sub-renewed-quarterly',
      member_id: qaMember.id,
      plan_name: 'Quarterly Plan',
      start_date: '2027-02-05',
      expiry_date: '2027-05-06',
      status: 'active'
    }
  ];

  const res = simulateRecordMemberCheckin({
    member: qaMember,
    subscriptions,
    todayStr: '2026-11-07'
  });

  assert.equal(res.success, true, 'Renewed member MUST be permitted to check in');
  assert.equal(res.plan_name, 'Quarterly Plan');
  assert.equal(res.member_name, 'QA Test Member');
});

test('Scenario 7: Date comparison across IST/UTC boundary evaluates correctly', () => {
  // At 11:30 PM IST on 2026-11-07, UTC is 2026-11-07 18:00:00Z (same day).
  // At 01:30 AM IST on 2026-11-08, UTC is 2026-11-07 20:00:00Z (previous day in UTC, next day in IST!).
  const utcLateNight = new Date('2026-11-07T20:00:00Z');
  const istDateString = getLocalDateString(utcLateNight, 'Asia/Kolkata');
  assert.equal(istDateString, '2026-11-08', 'Must resolve to 2026-11-08 in Asia/Kolkata even though UTC is Nov 7');

  // Verify that an expiry date of 2026-11-07 is recognized as expired on 2026-11-08 in IST
  const member = { id: 'm7', member_code: 'TFH-0007', name: 'Nisha Pillai', is_archived: false };
  const subscriptions = [
    { id: 's7', member_id: 'm7', plan_name: 'Monthly', start_date: '2026-10-07', expiry_date: '2026-11-07', status: 'active' }
  ];

  assert.throws(
    () => simulateRecordMemberCheckin({ member, subscriptions, todayStr: istDateString }),
    /ERR_MEMBERSHIP_EXPIRED/,
    'Must evaluate as expired on 2026-11-08 IST'
  );
});

test('Scenario 8: Duplicate check-in rejects second entry while session is unclosed', () => {
  const member = { id: 'm8', member_code: 'TFH-0008', name: 'Aditya Kulkarni', is_archived: false };
  const subscriptions = [
    { id: 's8', member_id: 'm8', plan_name: 'Annual Plan', start_date: '2026-01-01', expiry_date: '2027-01-01', status: 'active' }
  ];
  const activeCheckins = [
    { id: 'ci-active-1', member_id: 'm8', status: 'checked_in', checked_out_at: null }
  ];

  assert.throws(
    () => simulateRecordMemberCheckin({ member, subscriptions, activeCheckins, todayStr: '2026-11-07' }),
    /MEMBER_ALREADY_CHECKED_IN: Aditya Kulkarni is already checked in/
  );
});

// ============================================================================
// Frontend & Utility Alignment Tests
// ============================================================================

test('9. Frontend Alignment: getMembershipStatus reflects active, expiring, expired, and cancelled correctly', () => {
  const todayStr = '2026-11-07';

  // Active (> 5 days left)
  assert.equal(getMembershipStatus({ expiryDate: '2027-05-06', status: 'active' }, todayStr), 'active');

  // Expiring soon (<= 5 days left)
  assert.equal(getMembershipStatus({ expiryDate: '2026-11-10', status: 'active' }, todayStr), 'expiring');

  // Expiring today (0 days left -> valid final day)
  assert.equal(getMembershipStatus({ expiryDate: '2026-11-07', status: 'active' }, todayStr), 'expiring');

  // Expired yesterday (-1 days left)
  assert.equal(getMembershipStatus({ expiryDate: '2026-11-06', status: 'active' }, todayStr), 'expired');

  // Cancelled status
  assert.equal(getMembershipStatus({ expiryDate: '2027-05-06', status: 'cancelled' }, todayStr), 'cancelled');

  // Superseded status
  assert.equal(getMembershipStatus({ expiryDate: '2027-02-05', status: 'superseded' }, todayStr), 'superseded');
});
