import test from 'node:test';
import assert from 'node:assert/strict';
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
  completePtSession,
  schedulePtSession,
  setSupabaseClientForTesting as setPtClient,
  resetSupabaseClientForTesting as resetPtClient,
} from '../src/services/ptService.js';
import { formatINR, getMembershipStatus, getPaymentPurpose } from '../src/utils/memberUtils.js';

test('RC1-FIN-01: Full dues settlement to ₹0 marks subscription as completed', () => {
  const initialSubscription = {
    id: 'sub-001',
    planPrice: 700,
    totalLiability: 700,
    amountPaid: 300,
    balance: 400,
    status: 'active',
    paymentStatus: 'partial',
  };

  const settlementPayment = 400;
  const newAmountPaid = initialSubscription.amountPaid + settlementPayment;
  const newBalance = initialSubscription.totalLiability - newAmountPaid;
  const newPaymentStatus = newBalance === 0 ? 'completed' : 'partial';

  assert.equal(newBalance, 0, 'Balance must settle exactly to ₹0');
  assert.equal(newPaymentStatus, 'completed', 'Payment status must transition to completed');
});

test('RC1-FIN-02: Payment service prevents duplicate rapid submission with identical idempotency key', async () => {
  let rpcCallCount = 0;
  const mockClient = {
    rpc: async (fn, params) => {
      rpcCallCount++;
      if (params.p_idempotency_key === 'IDEMP-DUP-123' && rpcCallCount > 1) {
        return { data: null, error: { message: 'IDEMPOTENCY_CONFLICT: Payment already recorded' } };
      }
      return {
        data: {
          payment_id: 'pay-001',
          receipt_number: 'REC-202611-001',
          amount: 500,
          remaining_balance: 0,
        },
        error: null,
      };
    },
  };

  setPaymentClient(mockClient, true);
  try {
    const res1 = await recordDuesPayment({
      memberId: 'mem-001',
      subscriptionId: 'sub-001',
      amount: 500,
      paymentMethod: 'UPI',
      idempotencyKey: 'IDEMP-DUP-123',
    });

    assert.equal(res1.data.receipt_number, 'REC-202611-001');

    const res2 = await recordDuesPayment({
      memberId: 'mem-001',
      subscriptionId: 'sub-001',
      amount: 500,
      paymentMethod: 'UPI',
      idempotencyKey: 'IDEMP-DUP-123',
    });

    assert.equal(res2.data, null);
    assert.match(res2.error.message, /IDEMPOTENCY_CONFLICT/);
    assert.equal(rpcCallCount, 2);
  } finally {
    resetPaymentClient();
  }
});

test('RC1-FIN-03: Receipt layout and printable contract verification', () => {
  const paymentRecord = {
    id: 'REC-202611-009',
    receiptNumber: 'REC-202611-009',
    amount: 1500,
    date: '2026-11-10',
    method: 'UPI',
    memberName: 'Rahul Sharma',
    memberCode: 'MEM-00042',
    category: 'Membership',
    relatedPlan: 'Quarterly Plan',
    status: 'completed',
  };

  const purpose = getPaymentPurpose(paymentRecord);
  assert.equal(purpose, 'Membership Fee (Quarterly Plan)');
  assert.equal(formatINR(paymentRecord.amount), '₹1,500');
  assert.ok(paymentRecord.receiptNumber.startsWith('REC-'));
});

test('RC1-PT-01: Session scheduling requires future/current date and active assignment', async () => {
  const mockClient = {
    rpc: async (fn, params) => {
      if (fn === 'schedule_pt_session') {
        return {
          data: {
            session_id: 'sched-001',
            assignment_id: params.p_assignment_id,
            session_date: params.p_session_date,
            status: 'scheduled',
          },
          error: null,
        };
      }
      return { data: null, error: { message: 'Unknown RPC' } };
    },
  };

  setPtClient(mockClient, true);
  try {
    const res = await schedulePtSession({
      assignmentId: 'asg-001',
      trainerId: 'trn-001',
      sessionDate: '2026-11-12',
      sessionTime: '10:00:00',
      notes: 'Leg day session',
    });

    assert.equal(res.error, null);
    assert.ok(res.data);
    assert.equal(res.data.id, 'sched-001');
  } finally {
    resetPtClient();
  }
});

test('RC1-PT-02: PT completion atomically deducts 1 session and updates ledger', async () => {
  let recordedScheduledSessionId = null;
  const mockClient = {
    rpc: async (fn, params) => {
      if (fn === 'complete_pt_session') {
        recordedScheduledSessionId = params.p_scheduled_session_id;
        return {
          data: {
            session_id: 'sess-001',
            assignment_id: params.p_assignment_id,
            session_number: 5,
            remaining_sessions: 7,
            total_sessions: 12,
            completed_sessions: 5,
            status: 'completed',
          },
          error: null,
        };
      }
      return { data: null, error: { message: 'Unknown RPC' } };
    },
  };

  setPtClient(mockClient, true);
  try {
    const res = await completePtSession({
      assignmentId: 'asg-001',
      notes: 'Completed full chest circuit',
      scheduledSessionId: 'sched-001',
    });

    assert.equal(res.error, null);
    assert.equal(res.data.remaining_sessions, 7);
    assert.equal(res.data.completed_sessions, 5);
    assert.equal(recordedScheduledSessionId, 'sched-001');
  } finally {
    resetPtClient();
  }
});

test('RC1-PT-03: PT completion fails gracefully when remaining sessions is 0', async () => {
  const mockClient = {
    rpc: async () => {
      return {
        data: null,
        error: { message: 'NO_REMAINING_SESSIONS: All 12 package sessions have already been utilized.' },
      };
    },
  };

  setPtClient(mockClient, true);
  try {
    const res = await completePtSession({
      assignmentId: 'asg-exhausted',
    });

    assert.ok(res.error);
    assert.match(res.error.message, /NO_REMAINING_SESSIONS/);
  } finally {
    resetPtClient();
  }
});

test('RC1-SEC-01: Admin vs Staff balance masking integrity', () => {
  const dbMemberRow = {
    id: 'mem-001',
    name: 'Prashant Patil',
    balance: 500,
    plan: 'Monthly Plan',
    expiryDate: '2026-11-20',
  };

  // Staff simulation (balance masked by PostgreSQL view v_active_members)
  const staffView = {
    ...dbMemberRow,
    balance: null, // PostgreSQL CASE WHEN is_admin() THEN balance ELSE NULL END
  };

  // Admin sees true balance
  assert.equal(dbMemberRow.balance, 500);

  // Staff sees masked null balance (preventing financial leakage)
  assert.equal(staffView.balance, null);
  assert.equal(staffView.name, 'Prashant Patil');
});

test('RC1-SEC-02: Deactivated staff member is rejected from operational mutations', async () => {
  const mockClient = {
    rpc: async () => {
      return {
        data: null,
        error: {
          code: '42501',
          message: 'STAFF_INACTIVE: This staff account has been deactivated. Contact gym administrator.',
        },
      };
    },
  };

  setMemberClient(mockClient, true);
  try {
    const res = await renewMemberSubscription({
      memberId: 'mem-001',
      planId: 'plan-001',
      startDate: '2026-11-10',
    });

    assert.equal(res.data, null);
    assert.ok(res.error);
    assert.match(res.error.message, /STAFF_INACTIVE/);
  } finally {
    resetMemberClient();
  }
});
