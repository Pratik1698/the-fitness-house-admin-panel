/**
 * White-Box Testing Suite: Basis Path Testing
 * The Fitness House Gym Management Admin Panel
 *
 * Implements basis path testing derived from control flow graphs (CFGs)
 * and cyclomatic complexity (V(G) = E - N + 2P = P_decisions + 1)
 * across critical gym business logic utilities and Supabase service RPC wrappers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getExpiryClassification,
  getMembershipStatus,
} from '../src/utils/memberUtils.js';

import {
  recordDuesPayment,
  setSupabaseClientForTesting as setPaymentClient,
  resetSupabaseClientForTesting as resetPaymentClient,
} from '../src/services/paymentService.js';

import {
  renewMemberSubscription,
  setSupabaseClientForTesting as setMemberClient,
  resetSupabaseClientForTesting as resetMemberClient,
} from '../src/services/memberService.js';

import {
  recordCheckin,
  setSupabaseClientForTesting as setAttendanceClient,
  resetSupabaseClientForTesting as resetAttendanceClient,
} from '../src/services/attendanceService.js';

test.beforeEach(() => {
  resetPaymentClient();
  resetMemberClient();
  resetAttendanceClient();
});

// ============================================================================
// 1. Basis Path Testing: getExpiryClassification
// Control Flow Complexity: V(G) = 4 predicate nodes + 1 = 5 independent paths
// Predicate 1: (!member || !member.expiryDate)
// Predicate 2: (daysLeft < 0)
// Predicate 3: (daysLeft <= 3)
// Predicate 4: (daysLeft <= 5)
// ============================================================================

test('WB-PATH-01: getExpiryClassification — Path 1: Missing member or expiry date', () => {
  // Path 1: Predicate 1 evaluates TRUE
  const resNull = getExpiryClassification(null, '2026-11-09');
  assert.equal(resNull.tier, 'expired');
  assert.equal(resNull.daysLeft, -999);
  assert.equal(resNull.priority, 'high');

  const resMissingDate = getExpiryClassification({ name: 'No Expiry' }, '2026-11-09');
  assert.equal(resMissingDate.tier, 'expired');
  assert.equal(resMissingDate.daysLeft, -999);
});

test('WB-PATH-02: getExpiryClassification — Path 2: Expiry in the past (daysLeft < 0)', () => {
  // Path 2: Predicate 1 FALSE -> Predicate 2 TRUE
  const member = { expiryDate: '2026-11-05' }; // 4 days ago
  const res = getExpiryClassification(member, '2026-11-09');
  assert.equal(res.tier, 'expired');
  assert.equal(res.daysLeft, -4);
  assert.equal(res.label, 'Expired 4 days ago');
  assert.equal(res.priority, 'high');
});

test('WB-PATH-03: getExpiryClassification — Path 3: Urgent window (0 <= daysLeft <= 3)', () => {
  // Path 3: Predicates 1 & 2 FALSE -> Predicate 3 TRUE
  const memberToday = { expiryDate: '2026-11-09' }; // 0 days
  const resToday = getExpiryClassification(memberToday, '2026-11-09');
  assert.equal(resToday.tier, 'expiring_3d');
  assert.equal(resToday.daysLeft, 0);
  assert.equal(resToday.label, 'Expires Today');
  assert.equal(resToday.priority, 'urgent');

  const member3d = { expiryDate: '2026-11-12' }; // 3 days
  const res3d = getExpiryClassification(member3d, '2026-11-09');
  assert.equal(res3d.tier, 'expiring_3d');
  assert.equal(res3d.daysLeft, 3);
  assert.equal(res3d.label, 'Expires in 3 days');
  assert.equal(res3d.priority, 'urgent');
});

test('WB-PATH-04: getExpiryClassification — Path 4: Medium window (4 <= daysLeft <= 5)', () => {
  // Path 4: Predicates 1, 2, 3 FALSE -> Predicate 4 TRUE
  const member4d = { expiryDate: '2026-11-13' }; // 4 days
  const res4d = getExpiryClassification(member4d, '2026-11-09');
  assert.equal(res4d.tier, 'expiring_5d');
  assert.equal(res4d.daysLeft, 4);
  assert.equal(res4d.priority, 'medium');

  const member5d = { expiryDate: '2026-11-14' }; // 5 days
  const res5d = getExpiryClassification(member5d, '2026-11-09');
  assert.equal(res5d.tier, 'expiring_5d');
  assert.equal(res5d.daysLeft, 5);
  assert.equal(res5d.priority, 'medium');
});

test('WB-PATH-05: getExpiryClassification — Path 5: Active window (daysLeft > 5)', () => {
  // Path 5: Predicates 1, 2, 3, 4 all FALSE -> Final fallthrough
  const member10d = { expiryDate: '2026-11-19' }; // 10 days
  const res = getExpiryClassification(member10d, '2026-11-09');
  assert.equal(res.tier, 'active');
  assert.equal(res.daysLeft, 10);
  assert.equal(res.label, 'Active (10 days left)');
  assert.equal(res.priority, 'low');
});

// ============================================================================
// 2. Basis Path Testing: getMembershipStatus
// Control Flow Complexity: V(G) = 5 predicate nodes + 1 = 6 independent paths
// Predicate 1: (!member)
// Predicate 2: (member.status === 'cancelled')
// Predicate 3: (member.status === 'superseded')
// Predicate 4: (!member.expiryDate || daysLeft < 0)
// Predicate 5: (daysLeft <= 5)
// ============================================================================

test('WB-PATH-06: getMembershipStatus — 6 Independent Basis Paths', () => {
  const today = '2026-11-09';

  // Path 1: null member
  assert.equal(getMembershipStatus(null, today), 'expired');

  // Path 2: cancelled member
  assert.equal(getMembershipStatus({ status: 'cancelled', expiryDate: '2026-12-01' }, today), 'cancelled');

  // Path 3: superseded member
  assert.equal(getMembershipStatus({ status: 'superseded', expiryDate: '2026-12-01' }, today), 'superseded');

  // Path 4: missing expiry date or past expiry
  assert.equal(getMembershipStatus({ status: 'active', expiryDate: null }, today), 'expired');
  assert.equal(getMembershipStatus({ status: 'active', expiryDate: '2026-11-01' }, today), 'expired');

  // Path 5: expiring soon (0 to 5 days)
  assert.equal(getMembershipStatus({ status: 'active', expiryDate: '2026-11-12' }, today), 'expiring');

  // Path 6: active (> 5 days)
  assert.equal(getMembershipStatus({ status: 'active', expiryDate: '2026-11-30' }, today), 'active');
});

// ============================================================================
// 3. Basis Path Testing: paymentService.recordDuesPayment
// Tests the actual paymentService implementation with mocked Supabase RPC responses
// ============================================================================

test('WB-PATH-07: record_dues_payment — Basis Path Set (Production paymentService)', async () => {
  // Path 1: Client not configured
  setPaymentClient(null, false);
  const unconfiguredRes = await recordDuesPayment({ memberId: 'm1', amount: 100 });
  assert.equal(unconfiguredRes.data, null);
  assert.match(unconfiguredRes.error.message, /Supabase client is not configured/);

  // Path 2: Validation failure - zero or negative amount
  setPaymentClient({ rpc: async () => ({ data: null, error: null }) }, true);
  const zeroRes = await recordDuesPayment({ memberId: 'm1', amount: 0 });
  assert.equal(zeroRes.data, null);
  assert.match(zeroRes.error.message, /strictly greater than zero/);

  const negRes = await recordDuesPayment({ memberId: 'm1', amount: -25 });
  assert.equal(negRes.data, null);
  assert.match(negRes.error.message, /strictly greater than zero/);

  // Path 3: RPC Success path
  let capturedRpcName = '';
  let capturedRpcParams = null;
  const mockRpcSuccess = async (name, params) => {
    capturedRpcName = name;
    capturedRpcParams = params;
    return {
      data: {
        payment_id: 'pay-001',
        balance: 0,
        payment_status: 'paid',
        amount_paid: 300,
      },
      error: null,
    };
  };
  setPaymentClient({ rpc: mockRpcSuccess }, true);

  const successRes = await recordDuesPayment({
    memberId: 'm1',
    subscriptionId: 's1',
    amount: 300,
    paymentMethod: 'UPI',
    notes: 'Settling remaining balance',
  });
  assert.equal(capturedRpcName, 'record_dues_payment');
  assert.equal(capturedRpcParams.p_member_id, 'm1');
  assert.equal(capturedRpcParams.p_amount, 300);
  assert.equal(capturedRpcParams.p_payment_method, 'UPI');
  assert.equal(successRes.error, null);
  assert.equal(successRes.data.payment_id, 'pay-001');
  assert.ok(successRes.idempotencyKey);

  // Path 4: RPC Error path - Overpayment exceeds balance
  const mockOverpayment = async () => ({
    data: null,
    error: { message: 'ERR_OVERPAYMENT_EXCEEDS_BALANCE: Amount 500 exceeds dues balance 300' },
  });
  setPaymentClient({ rpc: mockOverpayment }, true);

  const overpayRes = await recordDuesPayment({ memberId: 'm1', subscriptionId: 's1', amount: 500 });
  assert.equal(overpayRes.data, null);
  assert.match(overpayRes.error.message, /exceeds the outstanding dues balance/);

  // Path 5: RPC Error path - Subscription not found
  const mockSubNotFound = async () => ({
    data: null,
    error: { message: 'SUBSCRIPTION_NOT_FOUND: Active subscription matching this member could not be found' },
  });
  setPaymentClient({ rpc: mockSubNotFound }, true);

  const subNotFoundRes = await recordDuesPayment({ memberId: 'm1', subscriptionId: 's1', amount: 100 });
  assert.equal(subNotFoundRes.data, null);
  assert.match(subNotFoundRes.error.message, /Active subscription matching this member could not be found/);

  // Path 6: RPC Error path - Idempotency payload mismatch
  const mockIdempMismatch = async () => ({
    data: null,
    error: { message: 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH: Divergent parameters' },
  });
  setPaymentClient({ rpc: mockIdempMismatch }, true);

  const idempRes = await recordDuesPayment({ memberId: 'm1', subscriptionId: 's1', amount: 100 });
  assert.equal(idempRes.data, null);
  assert.match(idempRes.error.message, /divergent parameters already used this idempotency key/);

  // Path 7: Unexpected exception thrown
  const mockThrow = async () => {
    throw new Error('Connection reset by peer');
  };
  setPaymentClient({ rpc: mockThrow }, true);

  const throwRes = await recordDuesPayment({ memberId: 'm1', subscriptionId: 's1', amount: 100 });
  assert.equal(throwRes.data, null);
  assert.match(throwRes.error.message, /Connection reset by peer/);
});

// ============================================================================
// 4. Basis Path Testing: memberService.renewMemberSubscription
// Tests the actual memberService renewal implementation with mocked Supabase RPC
// ============================================================================

test('WB-PATH-08: renew_member_subscription — Basis Path Set (Production memberService)', async () => {
  // Path 1: Client not configured
  setMemberClient(null, false);
  const unconfiguredRes = await renewMemberSubscription({ memberId: 'm1', planId: 'p1', startDate: '2026-11-09' });
  assert.equal(unconfiguredRes.data, null);
  assert.match(unconfiguredRes.error.message, /Supabase client is not configured/);

  // Path 2: RPC Success path (Full payment / zero payment / carry forward)
  let capturedRpcName = '';
  let capturedRpcParams = null;
  const mockRenewSuccess = async (name, params) => {
    capturedRpcName = name;
    capturedRpcParams = params;
    return {
      data: {
        subscription_id: 'sub-new-001',
        member_id: params.p_member_id,
        plan_id: params.p_plan_id,
        status: 'active',
        payment_status: 'paid',
      },
      error: null,
    };
  };
  setMemberClient({ rpc: mockRenewSuccess }, true);

  const successRes = await renewMemberSubscription({
    memberId: 'm1',
    planId: 'p1',
    startDate: '2026-11-09',
    carryForwardBalance: true,
    paymentAmount: 700,
    paymentMethod: 'Cash',
  });
  assert.equal(capturedRpcName, 'renew_member_subscription');
  assert.equal(capturedRpcParams.p_member_id, 'm1');
  assert.equal(capturedRpcParams.p_carry_forward_balance, true);
  assert.equal(capturedRpcParams.p_payment_amount, 700);
  assert.equal(successRes.error, null);
  assert.equal(successRes.data.subscription_id, 'sub-new-001');
  assert.ok(successRes.idempotencyKey);

  // Path 3: RPC Error - Outstanding balance not settled
  const mockUnsettledBalance = async () => ({
    data: null,
    error: { message: 'ERR_OUTSTANDING_BALANCE_NOT_SETTLED: Previous contract has an unpaid balance' },
  });
  setMemberClient({ rpc: mockUnsettledBalance }, true);

  const unsettledRes = await renewMemberSubscription({ memberId: 'm1', planId: 'p1', startDate: '2026-11-09' });
  assert.equal(unsettledRes.data, null);
  assert.match(unsettledRes.error.message, /Previous contract has an unpaid balance/);

  // Path 4: RPC Error - Overpayment exceeds total liability
  const mockOverpayment = async () => ({
    data: null,
    error: { message: 'ERR_OVERPAYMENT_EXCEEDS_BALANCE: Payment exceeds total liability' },
  });
  setMemberClient({ rpc: mockOverpayment }, true);

  const overpayRes = await renewMemberSubscription({ memberId: 'm1', planId: 'p1', startDate: '2026-11-09', paymentAmount: 2000 });
  assert.equal(overpayRes.data, null);
  assert.match(overpayRes.error.message, /Payment amount exceeds the total liability/);

  // Path 5: RPC Error - Invalid plan
  const mockInvalidPlan = async () => ({
    data: null,
    error: { message: 'INVALID_PLAN: Plan does not exist' },
  });
  setMemberClient({ rpc: mockInvalidPlan }, true);

  const invalidPlanRes = await renewMemberSubscription({ memberId: 'm1', planId: 'nonexistent', startDate: '2026-11-09' });
  assert.equal(invalidPlanRes.data, null);
  assert.match(invalidPlanRes.error.message, /selected membership plan is not active or could not be found/);

  // Path 6: Unexpected exception
  const mockThrow = async () => {
    throw new Error('Database gateway timeout');
  };
  setMemberClient({ rpc: mockThrow }, true);

  const throwRes = await renewMemberSubscription({ memberId: 'm1', planId: 'p1', startDate: '2026-11-09' });
  assert.equal(throwRes.data, null);
  assert.match(throwRes.error.message, /Database gateway timeout/);
});

// ============================================================================
// 5. Basis Path Testing: attendanceService.recordCheckin
// Tests the actual attendanceService implementation with mocked Supabase RPC
// ============================================================================

test('WB-PATH-09: record_member_checkin — Basis Path Set (Production attendanceService)', async () => {
  // Path 1: Client not configured
  setAttendanceClient(null, false);
  const unconfiguredRes = await recordCheckin({ memberId: 'm1' });
  assert.equal(unconfiguredRes.data, null);
  assert.match(unconfiguredRes.error.message, /Supabase client is not configured/);

  // Path 2: Validation failure - missing memberId
  setAttendanceClient({ rpc: async () => ({ data: null, error: null }) }, true);
  const missingIdRes = await recordCheckin({ memberId: null });
  assert.equal(missingIdRes.data, null);
  assert.match(missingIdRes.error.message, /Member ID is required to log check-in/);

  // Path 3: RPC Success path
  let capturedRpcName = '';
  let capturedRpcParams = null;
  const mockCheckinSuccess = async (name, params) => {
    capturedRpcName = name;
    capturedRpcParams = params;
    return {
      data: {
        checkin_id: 'chk-001',
        member_id: params.p_member_id,
        status: 'checked_in',
        member_name: 'Rahul Shinde',
      },
      error: null,
    };
  };
  setAttendanceClient({ rpc: mockCheckinSuccess }, true);

  const successRes = await recordCheckin({ memberId: 'm1', notes: 'Morning regular workout' });
  assert.equal(capturedRpcName, 'record_member_checkin');
  assert.equal(capturedRpcParams.p_member_id, 'm1');
  assert.equal(capturedRpcParams.p_notes, 'Morning regular workout');
  assert.equal(successRes.error, null);
  assert.equal(successRes.data.checkin_id, 'chk-001');

  // Path 4: RPC Error - Already checked in
  const mockAlreadyCheckedIn = async () => ({
    data: null,
    error: { message: 'ALREADY_CHECKED_IN: Member is already checked in today' },
  });
  setAttendanceClient({ rpc: mockAlreadyCheckedIn }, true);

  const alreadyRes = await recordCheckin({ memberId: 'm1' });
  assert.equal(alreadyRes.data, null);
  assert.match(alreadyRes.error.message, /ALREADY_CHECKED_IN/);

  // Path 5: RPC Error - Subscription expired
  const mockExpired = async () => ({
    data: null,
    error: { message: 'SUBSCRIPTION_EXPIRED: Member membership has expired' },
  });
  setAttendanceClient({ rpc: mockExpired }, true);

  const expiredRes = await recordCheckin({ memberId: 'm1' });
  assert.equal(expiredRes.data, null);
  assert.match(expiredRes.error.message, /SUBSCRIPTION_EXPIRED/);

  // Path 6: Unexpected exception
  const mockThrow = async () => {
    throw new Error('Database connection failed');
  };
  setAttendanceClient({ rpc: mockThrow }, true);

  const throwRes = await recordCheckin({ memberId: 'm1' });
  assert.equal(throwRes.data, null);
  assert.match(throwRes.error.message, /Database connection failed/);
});
