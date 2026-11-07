import test from 'node:test';
import assert from 'node:assert/strict';
import { formatINR } from '../src/utils/memberUtils.js';

/**
 * Attention Required & Dashboard — Pending Dues Regression Suite
 *
 * Verifies:
 * 1. Only positive balances (> 0) appear in pending dues.
 * 2. Sorting is strictly descending (highest debt first).
 * 3. Zero (₹0) and null/undefined balances are strictly excluded.
 * 4. Numeric string balances ('2500', '0.00') behave correctly and sort numerically.
 * 5. Dashboard and Attention Required filters produce equivalent cohorts.
 * 6. Empty, null, or undefined data arrays safely return empty arrays.
 * 7. Currency formatting conforms to INR standards (formatINR).
 */

// Source logic extracted directly from src/pages/Attention.jsx line 51-55
const getAttentionPendingPayments = (members) => {
  if (!members || !Array.isArray(members)) return [];
  return members
    .filter(m => Number(m.balance) > 0)
    .sort((a, b) => Number(b.balance) - Number(a.balance));
};

// Source logic extracted directly from src/pages/Dashboard.jsx line 113-114
const getDashboardPendingPayments = (members) => {
  if (!members || !Array.isArray(members)) return [];
  return members.filter(m => (Number(m.balance) || 0) > 0);
};

const getDashboardTotalOutstanding = (pendingPayments) => {
  if (!pendingPayments || !Array.isArray(pendingPayments)) return 0;
  return pendingPayments.reduce((s, m) => s + (Number(m.balance) || 0), 0);
};

// -----------------------------------------------------------------------------
// Base Synthetic Cohort
// -----------------------------------------------------------------------------
const SYNTHETIC_MEMBERS = [
  { id: 'M-HIGH', name: 'High Dues Member', plan: 'Annual Plan', balance: 2500 },
  { id: 'M-MED', name: 'Medium Dues Member', plan: 'Quarterly Plan', balance: 1200 },
  { id: 'M-LOW', name: 'Low Dues Member', plan: 'Monthly Plan', balance: 500 },
  { id: 'M-ZERO', name: 'Fully Paid Member', plan: 'Monthly Plan', balance: 0 },
  { id: 'M-NULL', name: 'Null Balance Member', plan: 'No Plan', balance: null },
];

// -----------------------------------------------------------------------------
// Test 1: Only Positive Balances Appear
// -----------------------------------------------------------------------------
test('1. Only positive balances appear in Attention Required Pending Dues', () => {
  const result = getAttentionPendingPayments(SYNTHETIC_MEMBERS);

  assert.equal(result.length, 3, 'Only 3 members with balance > 0 must be included');
  const resultIds = result.map(m => m.id);
  assert.ok(resultIds.includes('M-HIGH'), 'High dues (₹2,500) must be included');
  assert.ok(resultIds.includes('M-MED'), 'Medium dues (₹1,200) must be included');
  assert.ok(resultIds.includes('M-LOW'), 'Low dues (₹500) must be included');
  assert.ok(!resultIds.includes('M-ZERO'), 'Fully paid member (₹0) must be excluded');
  assert.ok(!resultIds.includes('M-NULL'), 'Null balance member must be excluded');
});

// -----------------------------------------------------------------------------
// Test 2: Descending Sort Order
// -----------------------------------------------------------------------------
test('2. Pending Dues list is sorted descending by outstanding balance (highest first)', () => {
  // Pass members in shuffled/unsorted order
  const unsorted = [
    { id: 'M-LOW', balance: 500 },
    { id: 'M-HIGH', balance: 2500 },
    { id: 'M-MED', balance: 1200 },
  ];

  const result = getAttentionPendingPayments(unsorted);

  assert.equal(result[0].id, 'M-HIGH', 'Highest balance (₹2,500) must be index 0');
  assert.equal(result[1].id, 'M-MED', 'Medium balance (₹1,200) must be index 1');
  assert.equal(result[2].id, 'M-LOW', 'Lowest balance (₹500) must be index 2');

  const balances = result.map(m => m.balance);
  assert.deepEqual(balances, [2500, 1200, 500], 'Balances must strictly decrease');
});

// -----------------------------------------------------------------------------
// Test 3: Zero and Null Balances Excluded
// -----------------------------------------------------------------------------
test('3. Zero, negative, null, and undefined balances are strictly excluded', () => {
  const nonPayersCohort = [
    { id: 'M-ZERO-NUM', balance: 0 },
    { id: 'M-ZERO-DEC', balance: 0.00 },
    { id: 'M-NULL', balance: null },
    { id: 'M-UNDEF', balance: undefined },
    { id: 'M-EMPTY-OBJ' },
    { id: 'M-NEGATIVE', balance: -200 }, // Credit / overpayment
  ];

  const result = getAttentionPendingPayments(nonPayersCohort);
  assert.equal(result.length, 0, 'No non-paying or zero-balance members should be returned');
});

// -----------------------------------------------------------------------------
// Test 4: Numeric String Balance Handling
// -----------------------------------------------------------------------------
test('4. Numeric string balances from API/database views behave correctly and sort numerically', () => {
  const stringCohort = [
    { id: 'M-STR-LOW', balance: '500' },
    { id: 'M-STR-HIGH', balance: '2500' },
    { id: 'M-STR-MED', balance: '1200.50' },
    { id: 'M-STR-ZERO', balance: '0' },
    { id: 'M-STR-ZERODEC', balance: '0.00' },
    { id: 'M-STR-INVALID', balance: 'not-a-number' },
  ];

  const result = getAttentionPendingPayments(stringCohort);

  assert.equal(result.length, 3, 'Must parse numeric strings and exclude 0, 0.00, and non-numeric string');
  assert.equal(result[0].id, 'M-STR-HIGH', 'String "2500" must sort before "1200.50" and "500" numerically (not lexicographically)');
  assert.equal(result[1].id, 'M-STR-MED');
  assert.equal(result[2].id, 'M-STR-LOW');

  assert.ok(!result.map(m => m.id).includes('M-STR-ZERO'), 'String "0" must be excluded');
  assert.ok(!result.map(m => m.id).includes('M-STR-ZERODEC'), 'String "0.00" must be excluded');
  assert.ok(!result.map(m => m.id).includes('M-STR-INVALID'), 'Invalid string must be excluded');
});

// -----------------------------------------------------------------------------
// Test 5: Dashboard and Attention Filter Equivalence
// -----------------------------------------------------------------------------
test('5. Dashboard and Attention Required filters produce identical member sets and total liability', () => {
  const mixedCohort = [
    { id: 'M-HIGH', name: 'High', balance: 2500 },
    { id: 'M-ZERO', name: 'Zero', balance: 0 },
    { id: 'M-MED', name: 'Med', balance: 1200 },
    { id: 'M-NULL', name: 'Null', balance: null },
    { id: 'M-LOW', name: 'Low', balance: 500 },
  ];

  const attentionList = getAttentionPendingPayments(mixedCohort);
  const dashboardList = getDashboardPendingPayments(mixedCohort);

  // Both identify the exact same set of 3 members
  assert.equal(attentionList.length, dashboardList.length, 'Both filters must return identical count');

  const attentionIds = new Set(attentionList.map(m => m.id));
  const dashboardIds = new Set(dashboardList.map(m => m.id));
  assert.deepEqual(attentionIds, dashboardIds, 'Both filters must identify the exact same member IDs');

  // Verify total outstanding computation on Dashboard
  const totalDue = getDashboardTotalOutstanding(dashboardList);
  assert.equal(totalDue, 4200, 'Total outstanding must equal 2500 + 1200 + 500 = 4200');
});

// -----------------------------------------------------------------------------
// Test 6: Empty Data Returns Empty List
// -----------------------------------------------------------------------------
test('6. Empty or missing data returns an empty list safely without throwing', () => {
  assert.deepEqual(getAttentionPendingPayments([]), []);
  assert.deepEqual(getAttentionPendingPayments(null), []);
  assert.deepEqual(getAttentionPendingPayments(undefined), []);

  assert.deepEqual(getDashboardPendingPayments([]), []);
  assert.deepEqual(getDashboardPendingPayments(null), []);
  assert.deepEqual(getDashboardPendingPayments(undefined), []);

  assert.equal(getDashboardTotalOutstanding([]), 0);
  assert.equal(getDashboardTotalOutstanding(null), 0);
  assert.equal(getDashboardTotalOutstanding(undefined), 0);
});

// -----------------------------------------------------------------------------
// Test 7: Currency Formatting Verification
// -----------------------------------------------------------------------------
test('7. formatINR accurately formats synthetic dues balances for UI display', () => {
  assert.equal(formatINR(2500), '₹2,500', 'High dues must format as ₹2,500');
  assert.equal(formatINR(1200), '₹1,200', 'Medium dues must format as ₹1,200');
  assert.equal(formatINR(500), '₹500', 'Low dues must format as ₹500');
  assert.equal(formatINR(0), '₹0', 'Zero balance must format as ₹0');
  assert.equal(formatINR(null), '₹0', 'Null balance must format safely as ₹0');
  assert.equal(formatINR(undefined), '₹0', 'Undefined balance must format safely as ₹0');
  assert.equal(formatINR('2500'), '₹2,500', 'Numeric string balance must format as ₹2,500');
});
