/**
 * White-Box Testing Suite: Loop Testing
 * The Fitness House Gym Management Admin Panel
 *
 * Implements boundary-oriented loop testing across collection processing loops:
 * 1. Zero iterations (empty collections)
 * 2. Exactly one iteration (single-item collections)
 * 3. Exactly two iterations
 * 4. Typical multiple iterations (m iterations)
 * 5. Large boundary iterations (stress iteration)
 * 6. Corrupt / boundary elements inside loops
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computePlanDetailsTableData,
  computePlanDistributionData,
  PLAN_PALETTE_COLORS,
} from '../src/utils/analyticsUtils.js';

import {
  getNextMemberId,
  getExpiryClassification,
} from '../src/utils/memberUtils.js';

import {
  generateMembersCSV,
  escapeCSVCell,
} from '../src/utils/exportUtils.js';

// ============================================================================
// 1. Loop Testing: computePlanDetailsTableData
// Nested loops over: basePlans, subscriptions, payments, and members
// ============================================================================

test('WB-LOOP-01: computePlanDetailsTableData — 0 iterations (Empty Collections)', () => {
  const result = computePlanDetailsTableData({
    allMembershipPlans: [],
    members: [],
    subscriptions: [],
    payments: [],
  });
  assert.equal(result.length, 0);
});

test('WB-LOOP-02: computePlanDetailsTableData — Exactly 1 iteration', () => {
  const singlePlan = [{ id: 'p1', name: 'Monthly Plan', duration_days: 30, price: 700, is_active: true }];
  const singleSub = [{ id: 's1', planId: 'p1', planName: 'Monthly Plan', planPrice: 700, status: 'active', startDate: '2026-11-01' }];
  const singlePayment = [{ id: 'pay1', subscriptionId: 's1', amount: 700, status: 'completed', date: '2026-11-05' }];
  const singleMember = [{ id: 'm1', currentSubscriptionId: 's1', plan: 'Monthly Plan', status: 'active' }];

  const result = computePlanDetailsTableData({
    allMembershipPlans: singlePlan,
    members: singleMember,
    subscriptions: singleSub,
    payments: singlePayment,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Monthly Plan');
  assert.equal(result[0].enrolledCount, 1);
  assert.equal(result[0].activeCount, 1);
  assert.equal(result[0].totalRevenue, 700);
});

test('WB-LOOP-03: computePlanDetailsTableData — Exactly 2 iterations', () => {
  const twoPlans = [
    { id: 'p1', name: 'daily', duration_days: 1, price: 30, is_active: true },
    { id: 'p2', name: 'Monthly Plan', duration_days: 30, price: 700, is_active: true },
  ];
  const twoSubs = [
    { id: 's1', planId: 'p1', planName: 'daily', planPrice: 30, status: 'active' },
    { id: 's2', planId: 'p2', planName: 'Monthly Plan', planPrice: 700, status: 'active' },
  ];

  const result = computePlanDetailsTableData({
    allMembershipPlans: twoPlans,
    members: [],
    subscriptions: twoSubs,
    payments: [],
  });

  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'daily');
  assert.equal(result[1].name, 'Monthly Plan');
});

test('WB-LOOP-04: computePlanDetailsTableData — Typical Multiple Iterations (5 Plans, 15 Subs, 25 Payments)', () => {
  const plans = [
    { id: 'p1', name: 'daily', duration_days: 1, price: 30, is_active: true },
    { id: 'p2', name: 'Monthly Plan', duration_days: 30, price: 700, is_active: true },
    { id: 'p3', name: 'Quarterly Plan', duration_days: 90, price: 2000, is_active: true },
    { id: 'p4', name: 'Half Yearly Plan', duration_days: 180, price: 4000, is_active: true },
    { id: 'p5', name: 'Annual Plan', duration_days: 365, price: 8000, is_active: true },
  ];

  const subscriptions = [];
  const payments = [];

  // Generate 15 subscriptions across plans
  for (let i = 0; i < 15; i++) {
    const plan = plans[i % plans.length];
    const subId = `sub-${i}`;
    subscriptions.push({
      id: subId,
      planId: plan.id,
      planName: plan.name,
      planPrice: plan.price,
      status: 'active',
      startDate: '2026-11-01',
    });
    payments.push({
      id: `pay-${i}`,
      subscriptionId: subId,
      amount: plan.price,
      status: 'completed',
      date: '2026-11-02',
    });
  }

  const result = computePlanDetailsTableData({
    allMembershipPlans: plans,
    members: [],
    subscriptions,
    payments,
  });

  assert.equal(result.length, 5);
  // Each plan received exactly 3 subscriptions (15 / 5)
  for (const row of result) {
    assert.equal(row.enrolledCount, 3);
    assert.equal(row.totalRevenue, row.price * 3);
  }
});

test('WB-LOOP-05: computePlanDetailsTableData — Large Boundary Iterations (100 Plans, 500 Subscriptions)', () => {
  const largePlans = [];
  const largeSubs = [];
  const largePayments = [];

  for (let i = 1; i <= 100; i++) {
    const planId = `plan-${i}`;
    largePlans.push({
      id: planId,
      name: `Tier Plan ${i}`,
      duration_days: i,
      price: i * 10,
      is_active: true,
    });
  }

  for (let s = 1; s <= 500; s++) {
    const plan = largePlans[s % 100];
    const subId = `sub-${s}`;
    largeSubs.push({
      id: subId,
      plan_id: plan.id,
      plan_name: plan.name,
      plan_price: plan.price,
      status: 'active',
    });
    largePayments.push({
      id: `pay-${s}`,
      subscription_id: subId,
      amount: plan.price,
      status: 'completed',
      created_at: '2026-11-01T00:00:00Z',
    });
  }

  const startTime = Date.now();
  const result = computePlanDetailsTableData({
    allMembershipPlans: largePlans,
    subscriptions: largeSubs,
    payments: largePayments,
  });
  const elapsed = Date.now() - startTime;

  assert.equal(result.length, 100);
  assert.ok(elapsed < 200, `Execution took ${elapsed}ms; must complete well under 200ms`);
});

test('WB-LOOP-06: computePlanDetailsTableData — Corrupt / Missing Elements in Loops', () => {
  const plans = [{ id: 'p1', name: 'Monthly Plan', duration_days: 30, price: 700, is_active: true }];
  const malformedSubs = [
    { id: 's0', planId: null, planName: null },
    { id: 's1', planId: null, planName: null },
    { id: 's2', planId: 'p1', planName: 'Monthly Plan', planPrice: null, status: 'active' },
  ];
  const malformedPayments = [
    { id: 'pay0', subscriptionId: 'non-existent', amount: 500, status: 'completed', date: '2026-11-01' },
    { id: 'pay1', subscriptionId: 's2', amount: 'invalid-number', status: 'completed', date: '2026-11-01' },
    { id: 'pay2', subscriptionId: 's2', amount: 350, status: 'completed', date: '2026-11-01' },
  ];

  // Must not throw or crash on corrupt inputs
  const result = computePlanDetailsTableData({
    allMembershipPlans: plans,
    subscriptions: malformedSubs,
    payments: malformedPayments,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].totalRevenue, 350);
});

// ============================================================================
// 2. Loop Testing: getNextMemberId reduce loop
// ============================================================================

test('WB-LOOP-07: getNextMemberId — Loop Boundary Iterations', () => {
  // 0 iterations
  assert.equal(getNextMemberId([]), 'TFH001');

  // 1 iteration
  assert.equal(getNextMemberId([{ id: 'TFH001' }]), 'TFH002');

  // 2 iterations
  assert.equal(getNextMemberId([{ id: 'TFH001' }, { id: 'TFH002' }]), 'TFH003');

  // Gapped multiple iterations
  assert.equal(getNextMemberId([{ id: 'TFH005' }, { id: 'TFH001' }, { id: 'TFH012' }]), 'TFH013');

  // Large iterations (150 members)
  const roster150 = Array.from({ length: 150 }, (_, i) => ({ id: `TFH${String(i + 1).padStart(3, '0')}` }));
  assert.equal(getNextMemberId(roster150), 'TFH151');

  // Corrupt elements inside reduce loop
  const mixedRoster = [
    null,
    undefined,
    { id: '' },
    { id: 'MEM-999' },
    { id: 'TFH-CORRUPT' },
    { id: 'TFH025' },
    { id: 'tfh030' },
  ];
  assert.equal(getNextMemberId(mixedRoster), 'TFH031');
});

// ============================================================================
// 3. Loop Testing: buildPlanDistributionChartData Palette Modulo
// ============================================================================

test('WB-LOOP-08: computePlanDistributionData — Palette Index Wrapping Loop', () => {
  // 0 iterations
  assert.deepEqual(computePlanDistributionData([]), []);

  // 1 iteration
  const single = computePlanDistributionData([{ id: '1', name: 'Plan 1', activeCount: 5, isActive: true }]);
  assert.equal(single.length, 1);
  assert.equal(single[0].color, PLAN_PALETTE_COLORS[0]);

  // 15 iterations (exceeds PLAN_PALETTE_COLORS.length of 10)
  const fifteenSlices = Array.from({ length: 15 }, (_, i) => ({
    id: String(i),
    name: `Plan ${i}`,
    activeCount: i + 1,
    isActive: true,
  }));

  const chart = computePlanDistributionData(fifteenSlices);
  assert.equal(chart.length, 15);

  // Index 0 and Index 10 must wrap and share PLAN_PALETTE_COLORS[0]
  assert.equal(chart[0].color, PLAN_PALETTE_COLORS[0]);
  assert.equal(chart[10].color, PLAN_PALETTE_COLORS[0]);
  assert.equal(chart[14].color, PLAN_PALETTE_COLORS[4]);
});

// ============================================================================
// 4. Loop Testing: CSV Generation Loops
// ============================================================================

test('WB-LOOP-09: generateMembersCSV — Loop Boundary Testing', () => {
  // 0 iterations -> Header only
  const csv0 = generateMembersCSV([]);
  const lines0 = csv0.trim().split('\n');
  assert.equal(lines0.length, 1);

  // 1 iteration -> Header + 1 row
  const csv1 = generateMembersCSV([{ member_code: 'M1', name: 'User 1' }]);
  const lines1 = csv1.trim().split('\n');
  assert.equal(lines1.length, 2);

  // 2 iterations -> Header + 2 rows
  const csv2 = generateMembersCSV([
    { member_code: 'M1', name: 'User 1' },
    { member_code: 'M2', name: 'User 2' },
  ]);
  const lines2 = csv2.trim().split('\n');
  assert.equal(lines2.length, 3);

  // 50 iterations -> Header + 50 rows
  const fiftyMembers = Array.from({ length: 50 }, (_, i) => ({
    member_code: `M${i}`,
    name: `User ${i}, Special "Name"`,
  }));
  const csv50 = generateMembersCSV(fiftyMembers);
  const lines50 = csv50.trim().split('\n');
  assert.equal(lines50.length, 51);
});
