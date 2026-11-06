import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTrainers,
  getPtAssignments,
  getPtSessions,
  assignPtPackage,
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting,
} from '../src/services/ptService.js';

/**
 * Phase 2 — Personal Training Assignment Workflow & Contract Test Suite
 * The Fitness House Gym Management Admin Panel
 *
 * Verifies:
 * 1. Active trainer retrieval & offline fallback
 * 2. Input validation (memberId, packageId, trainerId, startDate, non-negative payment)
 * 3. Admin assignment with ₹0 upfront payment
 * 4. Admin assignment with partial upfront payment
 * 5. Staff assignment with ₹0 upfront payment (masked financial response)
 * 6. Staff assignment with upfront payment rejected with 42501
 * 7. Idempotency key deduplication contract
 * 8. Database RPC error propagation
 * 9. Financial isolation between pt_assignments and v_admin_pt_assignments
 */

test.beforeEach(() => {
  resetSupabaseClientForTesting();
});

// ---------------------------------------------------------------------------
// 1. Trainer Retrieval
// ---------------------------------------------------------------------------
test('1. getTrainers: returns active trainers from database ordered by name', async () => {
  const mockTrainers = [
    { id: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72', name: 'Coach Pravin Joshi', phone: '+91 7385846525', is_active: true },
    { id: 'a1111111-2222-3333-4444-555555555555', name: 'Coach Rohit Sharma', phone: '+91 9876543210', is_active: true },
  ];

  const mockClient = {
    from: (table) => {
      assert.equal(table, 'trainers');
      return {
        select: (cols) => {
          assert.equal(cols, 'id, name, phone, is_active');
          return {
            eq: (col, val) => {
              assert.equal(col, 'is_active');
              assert.equal(val, true);
              return {
                order: (orderCol) => {
                  assert.equal(orderCol, 'name');
                  return Promise.resolve({ data: mockTrainers, error: null });
                },
              };
            },
          };
        },
      };
    },
  };

  setSupabaseClientForTesting(mockClient, true);

  const { data, error } = await getTrainers();
  assert.equal(error, null);
  assert.equal(data.length, 2);
  assert.equal(data[0].name, 'Coach Pravin Joshi');
  assert.equal(data[1].name, 'Coach Rohit Sharma');
});

test('2. getTrainers: offline / unconfigured client returns default Coach Pravin Joshi', async () => {
  setSupabaseClientForTesting(null, false);

  const { data, error } = await getTrainers();
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.equal(data[0].id, '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72');
  assert.equal(data[0].name, 'Coach Pravin Joshi');
});

// ---------------------------------------------------------------------------
// 2. Input Validation
// ---------------------------------------------------------------------------
test('3. assignPtPackage: rejects missing memberId before invoking database', async () => {
  const mockClient = {
    rpc: () => {
      assert.fail('RPC should not be called when memberId is missing');
    },
  };
  setSupabaseClientForTesting(mockClient, true);

  const { data, error } = await assignPtPackage({
    packageId: 'b1111111-1111-1111-1111-111111111111',
    trainerId: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72',
    startDate: '2026-11-06',
  });

  assert.equal(data, null);
  assert.ok(error instanceof Error);
  assert.match(error.message, /Member ID is required/i);
});

test('4. assignPtPackage: rejects missing packageId before invoking database', async () => {
  const mockClient = {
    rpc: () => {
      assert.fail('RPC should not be called when packageId is missing');
    },
  };
  setSupabaseClientForTesting(mockClient, true);

  const { data, error } = await assignPtPackage({
    memberId: 'm1111111-1111-1111-1111-111111111111',
    trainerId: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72',
    startDate: '2026-11-06',
  });

  assert.equal(data, null);
  assert.ok(error instanceof Error);
  assert.match(error.message, /PT Package ID is required/i);
});

test('5. assignPtPackage: rejects missing trainerId before invoking database', async () => {
  const mockClient = {
    rpc: () => {
      assert.fail('RPC should not be called when trainerId is missing');
    },
  };
  setSupabaseClientForTesting(mockClient, true);

  const { data, error } = await assignPtPackage({
    memberId: 'm1111111-1111-1111-1111-111111111111',
    packageId: 'b1111111-1111-1111-1111-111111111111',
    startDate: '2026-11-06',
  });

  assert.equal(data, null);
  assert.ok(error instanceof Error);
  assert.match(error.message, /Trainer ID is required/i);
});

test('6. assignPtPackage: rejects missing startDate before invoking database', async () => {
  const mockClient = {
    rpc: () => {
      assert.fail('RPC should not be called when startDate is missing');
    },
  };
  setSupabaseClientForTesting(mockClient, true);

  const { data, error } = await assignPtPackage({
    memberId: 'm1111111-1111-1111-1111-111111111111',
    packageId: 'b1111111-1111-1111-1111-111111111111',
    trainerId: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72',
  });

  assert.equal(data, null);
  assert.ok(error instanceof Error);
  assert.match(error.message, /Start date is required/i);
});

test('7. assignPtPackage: rejects negative initial payment amount', async () => {
  const mockClient = {
    rpc: () => {
      assert.fail('RPC should not be called when payment amount is negative');
    },
  };
  setSupabaseClientForTesting(mockClient, true);

  const { data, error } = await assignPtPackage({
    memberId: 'm1111111-1111-1111-1111-111111111111',
    packageId: 'b1111111-1111-1111-1111-111111111111',
    trainerId: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72',
    startDate: '2026-11-06',
    initialPaymentAmount: -500,
  });

  assert.equal(data, null);
  assert.ok(error instanceof Error);
  assert.match(error.message, /cannot be negative/i);
});

// ---------------------------------------------------------------------------
// 3. Admin & Staff RPC Assignment Contract
// ---------------------------------------------------------------------------
test('8. assignPtPackage: Admin assignment with ₹0 upfront payment invokes assign_pt_package RPC', async () => {
  let invokedFn = null;
  let invokedParams = null;

  const mockResponse = {
    assignment_id: 'assign-uuid-001',
    member_id: 'm1111111-1111-1111-1111-111111111111',
    package_id: 'b1111111-1111-1111-1111-111111111111',
    trainer_id: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72',
    fee_amount: 5000,
    amount_paid: 0,
    balance: 5000,
    payment_id: null,
    receipt_number: null,
  };

  const mockClient = {
    rpc: (fnName, params) => {
      invokedFn = fnName;
      invokedParams = params;
      return Promise.resolve({ data: mockResponse, error: null });
    },
  };

  setSupabaseClientForTesting(mockClient, true);

  const { data, error } = await assignPtPackage({
    memberId: 'm1111111-1111-1111-1111-111111111111',
    packageId: 'b1111111-1111-1111-1111-111111111111',
    trainerId: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72',
    startDate: '2026-11-06',
    initialPaymentAmount: 0,
    notes: 'Standard 12 session plan',
  });

  assert.equal(error, null);
  assert.equal(invokedFn, 'assign_pt_package');
  assert.equal(invokedParams.p_member_id, 'm1111111-1111-1111-1111-111111111111');
  assert.equal(invokedParams.p_initial_payment_amount, 0);
  assert.equal(invokedParams.p_payment_method, null);
  assert.equal(invokedParams.p_notes, 'Standard 12 session plan');
  assert.ok(invokedParams.p_idempotency_key);
  assert.equal(data.assignment_id, 'assign-uuid-001');
  assert.equal(data.balance, 5000);
});

test('9. assignPtPackage: Admin assignment with partial upfront payment passes payment parameters and returns receipt', async () => {
  let invokedParams = null;

  const mockResponse = {
    assignment_id: 'assign-uuid-002',
    member_id: 'm1111111-1111-1111-1111-111111111111',
    package_id: 'b1111111-1111-1111-1111-111111111111',
    trainer_id: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72',
    fee_amount: 5000,
    amount_paid: 2000,
    balance: 3000,
    payment_id: 'pay-uuid-999',
    receipt_number: 'RCP-20261106-0001',
  };

  const mockClient = {
    rpc: (fnName, params) => {
      invokedParams = params;
      return Promise.resolve({ data: mockResponse, error: null });
    },
  };

  setSupabaseClientForTesting(mockClient, true);

  const { data, error } = await assignPtPackage({
    memberId: 'm1111111-1111-1111-1111-111111111111',
    packageId: 'b1111111-1111-1111-1111-111111111111',
    trainerId: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72',
    startDate: '2026-11-06',
    initialPaymentAmount: 2000,
    paymentMethod: 'UPI',
    notes: '₹2,000 upfront via UPI',
  });

  assert.equal(error, null);
  assert.equal(invokedParams.p_initial_payment_amount, 2000);
  assert.equal(invokedParams.p_payment_method, 'UPI');
  assert.equal(data.payment_id, 'pay-uuid-999');
  assert.equal(data.receipt_number, 'RCP-20261106-0001');
  assert.equal(data.balance, 3000);
});

test('10. assignPtPackage: Staff assignment with ₹0 upfront payment receives masked financial response', async () => {
  // Database returns NULL for financial columns when caller role is staff
  const mockStaffResponse = {
    assignment_id: 'assign-uuid-003',
    member_id: 'm1111111-1111-1111-1111-111111111111',
    package_id: 'b1111111-1111-1111-1111-111111111111',
    trainer_id: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72',
    fee_amount: null,
    amount_paid: null,
    balance: null,
    payment_id: null,
    receipt_number: null,
  };

  const mockClient = {
    rpc: () => Promise.resolve({ data: mockStaffResponse, error: null }),
  };

  setSupabaseClientForTesting(mockClient, true);

  const { data, error } = await assignPtPackage({
    memberId: 'm1111111-1111-1111-1111-111111111111',
    packageId: 'b1111111-1111-1111-1111-111111111111',
    trainerId: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72',
    startDate: '2026-11-06',
    initialPaymentAmount: 0,
  });

  assert.equal(error, null);
  assert.equal(data.assignment_id, 'assign-uuid-003');
  assert.equal(data.fee_amount, null);
  assert.equal(data.amount_paid, null);
  assert.equal(data.balance, null);
});

test('11. assignPtPackage: Staff attempting upfront payment is rejected with PostgreSQL 42501 FORBIDDEN', async () => {
  const mockClient = {
    rpc: () =>
      Promise.resolve({
        data: null,
        error: {
          code: '42501',
          message: 'FORBIDDEN: Staff members cannot record initial payment during PT package assignment.',
        },
      }),
  };

  setSupabaseClientForTesting(mockClient, true);

  const { data, error } = await assignPtPackage({
    memberId: 'm1111111-1111-1111-1111-111111111111',
    packageId: 'b1111111-1111-1111-1111-111111111111',
    trainerId: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72',
    startDate: '2026-11-06',
    initialPaymentAmount: 1500,
  });

  assert.equal(data, null);
  assert.ok(error instanceof Error);
  assert.match(error.message, /FORBIDDEN/i);
});

// ---------------------------------------------------------------------------
// 4. Idempotency & Concurrency Contract
// ---------------------------------------------------------------------------
test('12. assignPtPackage: Explicit idempotency key is forwarded to database RPC', async () => {
  let passedKey = null;
  const testKey = 'test-idempotency-key-xyz-789';

  const mockClient = {
    rpc: (fn, params) => {
      passedKey = params.p_idempotency_key;
      return Promise.resolve({
        data: {
          assignment_id: 'assign-uuid-cached',
          member_id: params.p_member_id,
          package_id: params.p_package_id,
        },
        error: null,
      });
    },
  };

  setSupabaseClientForTesting(mockClient, true);

  const { data, error } = await assignPtPackage({
    memberId: 'm1111111-1111-1111-1111-111111111111',
    packageId: 'b1111111-1111-1111-1111-111111111111',
    trainerId: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72',
    startDate: '2026-11-06',
    idempotencyKey: testKey,
  });

  assert.equal(error, null);
  assert.equal(passedKey, testKey);
  assert.equal(data.assignment_id, 'assign-uuid-cached');
});

// ---------------------------------------------------------------------------
// 5. Query Views & Financial Isolation
// ---------------------------------------------------------------------------
test('13. getPtAssignments: Staff caller queries pt_assignments without financial columns', async () => {
  let queriedRelation = null;
  let queriedColumns = null;

  const mockClient = {
    from: (table) => {
      queriedRelation = table;
      return {
        select: (cols) => {
          queriedColumns = cols;
          return {
            order: () => Promise.resolve({ data: [], error: null }),
          };
        },
      };
    },
  };

  setSupabaseClientForTesting(mockClient, true);

  await getPtAssignments({ includeFinancials: false });

  assert.equal(queriedRelation, 'pt_assignments');
  assert.ok(!queriedColumns.includes('fee_amount'));
  assert.ok(!queriedColumns.includes('amount_paid'));
  assert.ok(!queriedColumns.includes('balance'));
});

test('14. getPtAssignments: Admin caller queries v_admin_pt_assignments with fee_amount and balance', async () => {
  let queriedRelation = null;
  let queriedColumns = null;

  const mockClient = {
    from: (table) => {
      queriedRelation = table;
      return {
        select: (cols) => {
          queriedColumns = cols;
          return {
            order: () => Promise.resolve({ data: [], error: null }),
          };
        },
      };
    },
  };

  setSupabaseClientForTesting(mockClient, true);

  await getPtAssignments({ includeFinancials: true });

  assert.equal(queriedRelation, 'v_admin_pt_assignments');
  assert.ok(queriedColumns.includes('fee_amount'));
  assert.ok(queriedColumns.includes('amount_paid'));
  assert.ok(queriedColumns.includes('balance'));
});

