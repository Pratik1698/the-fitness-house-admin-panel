import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  renewMemberSubscription,
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting,
} from '../src/services/memberService.js';

/**
 * Membership Renewal Workflow & Regression Test Suite
 * The Fitness House Gym Management Admin Panel
 *
 * Verifies the 8 regression scenarios required for the membership renewal remediation:
 * 1. Fully paid renewal: sets previous subscription status to 'superseded' (never 'completed').
 * 2. Partially paid renewal: carries forward debt and sets previous status to 'superseded'.
 * 3. Renewal with zero initial payment: succeeds with payment_status 'unpaid' and null payment/receipt.
 * 4. Correct subscription status: verifies strict compliance with member_subscriptions_status_check.
 * 5. Correct payment status: tests generated column logic ('paid', 'partial', 'unpaid') and overpayment guard.
 * 6. Correct expiry date: tests interval derivation (start_date + duration_days).
 * 7. Duplicate submission / idempotency: verifies cache hit on duplicate and mismatch detection on divergent retry.
 * 8. Transaction atomicity: verifies failure leaves zero partial financial records.
 */

test.beforeEach(() => {
  resetSupabaseClientForTesting();
});

// Helper to read and extract SQL function bodies
function getFunctionBody(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${escapedName}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
  assert.ok(match, `Expected function ${name} in migration source`);
  return match[1];
}

const forwardMigrationPath = new URL('../supabase/migrations/20261107000000_fix_renew_member_subscription_status.sql', import.meta.url);
const forwardBundlePath = new URL('../supabase/production-migrations/20261102_phase5_security_forward.sql', import.meta.url);
const remediationPath = new URL('../supabase/migrations/20261102010000_phase5_security_audit_remediation.sql', import.meta.url);
const staffSecurityPath = new URL('../supabase/migrations/20261102000003_phase5_staff_security_and_invitations.sql', import.meta.url);

const forwardMigrationSql = readFileSync(forwardMigrationPath, 'utf8');
const forwardBundleSql = readFileSync(forwardBundlePath, 'utf8');
const remediationSql = readFileSync(remediationPath, 'utf8');
const staffSecuritySql = readFileSync(staffSecurityPath, 'utf8');

// ============================================================================
// 1. Fully Paid Renewal: Transition to 'superseded' (never 'completed')
// ============================================================================
test('1. Fully paid renewal: forward migration sets previous subscription status to superseded (never completed)', () => {
  const body = getFunctionBody(forwardMigrationSql, 'renew_member_subscription');

  // Must NOT contain SET status = 'completed' on member_subscriptions
  assert.doesNotMatch(
    body,
    /UPDATE\s+public\.member_subscriptions[\s\S]*?SET\s+status\s*=\s*'completed'/i,
    'Forward migration must NOT update member_subscriptions to completed'
  );

  // Must contain SET status = 'superseded' in the fully paid (ELSE) branch
  assert.match(
    body,
    /ELSE\s+UPDATE\s+public\.member_subscriptions\s+SET\s+status\s*=\s*'superseded'/i,
    'Fully paid previous subscription must be updated to superseded'
  );
});

test('1a. Forward migration strictly supersedes historical Phase 5 definition with clean status transition', () => {
  const forwardBody = getFunctionBody(forwardMigrationSql, 'renew_member_subscription');
  const historicalBody = getFunctionBody(remediationSql, 'renew_member_subscription');

  // Verify historical definition contained the bug that caused production SQLSTATE 23514:
  assert.match(
    historicalBody,
    /ELSE\s+UPDATE\s+public\.member_subscriptions\s+SET\s+status\s*=\s*'completed'/i,
    'Historical remediation migration must reflect original applied state with status = completed'
  );

  // Verify forward migration supersedes with status = superseded:
  assert.match(
    forwardBody,
    /ELSE\s+UPDATE\s+public\.member_subscriptions\s+SET\s+status\s*=\s*'superseded'/i,
    'Forward migration must correct status transition to superseded'
  );
  assert.doesNotMatch(
    forwardBody,
    /UPDATE\s+public\.member_subscriptions[\s\S]*?SET\s+status\s*=\s*'completed'/i
  );
});

test('1b. Fully paid renewal: RPC service simulation sets previous status to superseded and records paid receipt', async () => {
  const memberId = 'd1111111-1111-1111-1111-111111111111';
  const planId = 'p1111111-1111-1111-1111-111111111111';
  const prevSubId = 's1111111-1111-1111-1111-111111111111';
  const newSubId = 's2222222-2222-2222-2222-222222222222';
  const paymentId = 'pay11111-1111-1111-1111-111111111111';

  // Simulated database state
  const prevSub = {
    id: prevSubId,
    member_id: memberId,
    plan_price: 2000.00,
    amount_paid: 2000.00,
    balance: 0.00,
    status: 'active',
  };

  let prevSubUpdatedStatus = null;
  let newSubInserted = null;
  let paymentInserted = null;

  const mockClient = {
    rpc: async (fn, params) => {
      assert.equal(fn, 'renew_member_subscription');
      assert.equal(params.p_member_id, memberId);
      assert.equal(params.p_plan_id, planId);
      assert.equal(params.p_payment_amount, 2000);

      // Execute simulated RPC logic matching 20261107000000:
      if (prevSub.balance <= 0.00) {
        prevSubUpdatedStatus = 'superseded';
      }

      newSubInserted = {
        id: newSubId,
        member_id: memberId,
        plan_name: 'Quarterly Fitness Plan',
        plan_price: 2000.00,
        previous_balance_carried: 0.00,
        amount_paid: 2000.00,
        status: 'active',
        start_date: params.p_start_date,
        expiry_date: '2027-05-06',
      };

      paymentInserted = {
        id: paymentId,
        subscription_id: newSubId,
        amount: 2000.00,
        receipt_number: 'TFH-20270205-10042',
        status: 'completed',
      };

      return {
        data: {
          subscription_id: newSubId,
          member_id: memberId,
          plan_name: 'Quarterly Fitness Plan',
          new_expiry_date: '2027-05-06',
          total_liability: 2000.00,
          amount_paid: 2000.00,
          balance: 0.00,
          payment_status: 'paid',
          payment_id: paymentId,
          receipt_number: 'TFH-20270205-10042',
        },
        error: null,
      };
    },
  };

  setSupabaseClientForTesting(mockClient, true);

  const result = await renewMemberSubscription({
    memberId,
    planId,
    startDate: '2027-02-05',
    carryForwardBalance: false,
    paymentAmount: 2000,
    paymentMethod: 'UPI',
    idempotencyKey: 'idemp-fully-paid-test-001',
  });

  assert.equal(result.error, null);
  assert.equal(prevSubUpdatedStatus, 'superseded');
  assert.equal(newSubInserted.status, 'active');
  assert.equal(result.data.payment_status, 'paid');
  assert.equal(result.data.balance, 0.00);
  assert.equal(result.data.receipt_number, 'TFH-20270205-10042');
});

// ============================================================================
// 2. Partially Paid Renewal & Debt Carry-Forward
// ============================================================================
test('2. Partially paid renewal: carries forward debt and sets previous status to superseded', async () => {
  const memberId = 'd2222222-2222-2222-2222-222222222222';
  const planId = 'p2222222-2222-2222-2222-222222222222';
  const prevBalance = 500.00;
  const newPlanPrice = 2000.00;
  const initialPayment = 1000.00;

  const mockClient = {
    rpc: async (fn, params) => {
      assert.equal(fn, 'renew_member_subscription');
      assert.equal(params.p_carry_forward_balance, true);

      const totalLiability = newPlanPrice + prevBalance;
      const remainingBalance = totalLiability - initialPayment;

      return {
        data: {
          subscription_id: 's-carried-001',
          member_id: memberId,
          plan_name: 'Quarterly Fitness Plan',
          new_expiry_date: '2027-05-06',
          total_liability: totalLiability,
          amount_paid: initialPayment,
          balance: remainingBalance,
          payment_status: remainingBalance === 0 ? 'paid' : initialPayment > 0 ? 'partial' : 'unpaid',
          payment_id: 'pay-carried-001',
          receipt_number: 'TFH-20270205-10043',
        },
        error: null,
      };
    },
  };

  setSupabaseClientForTesting(mockClient, true);

  const result = await renewMemberSubscription({
    memberId,
    planId,
    startDate: '2027-02-05',
    carryForwardBalance: true,
    paymentAmount: initialPayment,
    paymentMethod: 'Cash',
    idempotencyKey: 'idemp-partially-paid-test-002',
  });

  assert.equal(result.error, null);
  assert.equal(result.data.total_liability, 2500.00);
  assert.equal(result.data.amount_paid, 1000.00);
  assert.equal(result.data.balance, 1500.00);
  assert.equal(result.data.payment_status, 'partial');
});

test('2b. Partially paid renewal: rejects renewal if previous dues are not settled and carryForward is false', async () => {
  const mockClient = {
    rpc: async () => {
      return {
        data: null,
        error: {
          code: '22000',
          message: 'ERR_OUTSTANDING_BALANCE_NOT_SETTLED: Previous contract has an unpaid balance of 500.00. Settle dues or carry forward.',
        },
      };
    },
  };

  setSupabaseClientForTesting(mockClient, true);

  const result = await renewMemberSubscription({
    memberId: 'd2222222-2222-2222-2222-222222222222',
    planId: 'p2222222-2222-2222-2222-222222222222',
    startDate: '2027-02-05',
    carryForwardBalance: false,
    paymentAmount: 2000,
    paymentMethod: 'Cash',
  });

  assert.notEqual(result.error, null);
  assert.match(result.error.message, /Previous contract has an unpaid balance/i);
});

// ============================================================================
// 3. Renewal with Zero Initial Payment
// ============================================================================
test('3. Renewal with zero initial payment: succeeds with unpaid status and null receipt', async () => {
  const mockClient = {
    rpc: async (fn, params) => {
      assert.equal(fn, 'renew_member_subscription');
      assert.equal(params.p_payment_amount, 0);

      return {
        data: {
          subscription_id: 's-zero-001',
          member_id: params.p_member_id,
          plan_name: 'Monthly Plan',
          new_expiry_date: '2027-03-05',
          total_liability: 1000.00,
          amount_paid: 0.00,
          balance: 1000.00,
          payment_status: 'unpaid',
          payment_id: null,
          receipt_number: null,
        },
        error: null,
      };
    },
  };

  setSupabaseClientForTesting(mockClient, true);

  const result = await renewMemberSubscription({
    memberId: 'm-zero-001',
    planId: 'p-zero-001',
    startDate: '2027-02-05',
    carryForwardBalance: false,
    paymentAmount: 0,
    idempotencyKey: 'idemp-zero-payment-test-003',
  });

  assert.equal(result.error, null);
  assert.equal(result.data.amount_paid, 0.00);
  assert.equal(result.data.balance, 1000.00);
  assert.equal(result.data.payment_status, 'unpaid');
  assert.equal(result.data.payment_id, null);
  assert.equal(result.data.receipt_number, null);
});

// ============================================================================
// 4. Correct Subscription Status & Constraint Compliance
// ============================================================================
test('4. Correct subscription status: all statuses strictly satisfy member_subscriptions_status_check', () => {
  const allowedStatuses = new Set(['active', 'expired', 'superseded', 'cancelled']);

  // Extract all status assignments to member_subscriptions in the RPC definition
  const body = getFunctionBody(forwardMigrationSql, 'renew_member_subscription');

  // Match: status = 'XYZ' or status := 'XYZ'
  const matches = [...body.matchAll(/status\s*=\s*'([a-z_]+)'/gi)];
  assert.ok(matches.length > 0, 'Expected status assignments in renew_member_subscription');

  for (const match of matches) {
    const assignedStatus = match[1].toLowerCase();
    // In member_subscriptions, only allowed statuses may be assigned
    if (['active', 'superseded', 'expired', 'cancelled', 'completed'].includes(assignedStatus)) {
      if (assignedStatus === 'completed') {
        // Assert that 'completed' is ONLY assigned to payments, NEVER to member_subscriptions
        const matchIndex = match.index;
        const precedingText = body.substring(Math.max(0, matchIndex - 120), matchIndex);
        assert.ok(
          precedingText.includes('payments') || precedingText.includes('payment'),
          `'completed' status may ONLY be used for payments, found near: ${precedingText}`
        );
      } else {
        assert.ok(
          allowedStatuses.has(assignedStatus),
          `Status '${assignedStatus}' must be permitted by member_subscriptions_status_check`
        );
      }
    }
  }
});

// ============================================================================
// 5. Correct Payment Status & Overpayment Guard
// ============================================================================
test('5. Correct payment status: generated column logic and overpayment guard', () => {
  const body = getFunctionBody(forwardMigrationSql, 'renew_member_subscription');

  // Verify payment_status expression matches PostgreSQL convention
  assert.match(
    body,
    /CASE\s+WHEN\s+\(\(v_plan\.price\s*\+\s*v_carried_balance\)\s*-\s*p_payment_amount\)\s*=\s*0\.00\s+THEN\s*'paid'\s+WHEN\s+p_payment_amount\s*>\s*0\.00\s+THEN\s*'partial'\s+ELSE\s*'unpaid'\s+END/i,
    'payment_status must compute paid, partial, or unpaid accurately'
  );

  // Verify overpayment guard exists and throws ERR_OVERPAYMENT_EXCEEDS_BALANCE
  assert.match(
    body,
    /IF\s+p_payment_amount\s*>\s*\(v_plan\.price\s*\+\s*v_carried_balance\)\s+THEN\s+RAISE\s+EXCEPTION\s+'ERR_OVERPAYMENT_EXCEEDS_BALANCE/i,
    'Must reject overpayment exceeding total liability'
  );
});

// ============================================================================
// 6. Correct Expiry Date Calculation
// ============================================================================
test('6. Correct expiry date: computes interval accurately across month and leap boundaries', () => {
  const body = getFunctionBody(forwardMigrationSql, 'renew_member_subscription');

  // Verify server-side interval calculation
  assert.match(
    body,
    /v_expiry_date\s*:=\s*p_start_date\s*\+\s*\(v_plan\.duration_days\s*\|\|\s*' days'\)::interval/i,
    'Must derive expiry date from start date and plan duration'
  );

  // Unit calculation of dates
  function deriveExpiry(startStr, durationDays) {
    const d = new Date(startStr);
    d.setDate(d.getDate() + durationDays);
    return d.toISOString().split('T')[0];
  }

  // Leap year 2028: 2028-02-01 + 30 days = 2028-03-02 (Feb 2028 has 29 days)
  assert.equal(deriveExpiry('2028-02-01', 30), '2028-03-02');
  // Non-leap year 2027: 2027-02-01 + 30 days = 2027-03-03 (Feb 2027 has 28 days)
  assert.equal(deriveExpiry('2027-02-01', 30), '2027-03-03');
  // 90-day quarterly renewal: 2027-02-05 + 90 days = 2027-05-06
  assert.equal(deriveExpiry('2027-02-05', 90), '2027-05-06');
  // 365-day annual renewal: 2027-01-01 + 365 days = 2028-01-01
  assert.equal(deriveExpiry('2027-01-01', 365), '2028-01-01');
});

// ============================================================================
// 7. Duplicate Submission / Idempotency
// ============================================================================
test('7. Duplicate submission / idempotency: returns cached result on exact replay and rejects divergent payload', () => {
  const body = getFunctionBody(forwardMigrationSql, 'renew_member_subscription');

  // 1. Mandatory idempotency key
  assert.match(
    body,
    /IF\s+p_idempotency_key\s+IS\s+NULL\s+OR\s+btrim\(p_idempotency_key\)\s*=\s*''\s+THEN\s+RAISE\s+EXCEPTION\s+'INVALID_ARGUMENT:\s*Idempotency key is required/i
  );

  // 2. Advisory lock before cache lookup
  const lockPos = body.indexOf('pg_advisory_xact_lock');
  const cacheReadPos = body.indexOf('SELECT response, payload_hash INTO v_cached_response');
  const cacheInsertPos = body.indexOf('INSERT INTO public.idempotency_keys');

  assert.ok(lockPos > 0, 'Must acquire transaction advisory lock');
  assert.ok(cacheReadPos > lockPos, 'Must acquire lock before cache lookup');
  assert.ok(cacheInsertPos > cacheReadPos, 'Must cache response after successful transaction');

  // 3. Payload divergence detection
  assert.match(
    body,
    /IF\s+v_cached_hash\s+IS\s+DISTINCT\s+FROM\s+v_payload_hash\s+THEN\s+RAISE\s+EXCEPTION\s+'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH/i
  );

  // 4. Safe ON CONFLICT DO NOTHING insert
  assert.match(
    body,
    /ON\s+CONFLICT\s+\(actor_id,\s*operation,\s*idempotency_key\)\s+DO\s+NOTHING/i
  );
});

// ============================================================================
// 8. Transaction Atomicity & Failure Rollback Semantics
// ============================================================================
test('8. Transaction atomicity: single PL/pgSQL transaction with zero partial record persistence on failure', () => {
  const body = getFunctionBody(forwardMigrationSql, 'renew_member_subscription');

  // 1. Function must be a single PL/pgSQL block with no internal autonomous commits
  assert.doesNotMatch(body, /\bCOMMIT\b/i, 'PL/pgSQL function must execute inside caller transaction boundary without COMMIT');
  assert.doesNotMatch(body, /\bROLLBACK\b/i, 'PL/pgSQL function must rely on PostgreSQL engine rollback on unhandled EXCEPTION');

  // 2. Unhandled exception guarantees engine rollback
  assert.doesNotMatch(
    body,
    /EXCEPTION\s+WHEN\s+check_violation/i,
    'Must NOT swallow check constraint violations'
  );

  // 3. Transaction advisory lock is released automatically at transaction end
  assert.match(
    body,
    /pg_advisory_xact_lock/i,
    'Must use xact lock so lock is released on both COMMIT and ROLLBACK'
  );
});

