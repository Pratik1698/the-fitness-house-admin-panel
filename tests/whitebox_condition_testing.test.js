/**
 * White-Box Testing Suite: Condition Testing & MC/DC
 * The Fitness House Gym Management Admin Panel
 *
 * Implements condition coverage and Modified Condition/Decision Coverage (MC/DC)
 * demonstrating that each individual atomic boolean condition independently
 * determines the overall decision outcome by executing the actual production utility functions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidIndianPhone,
  isValidEmail,
  isPtEndingSoon,
  isPendingDuesVisible,
  isFollowupOverdue,
} from '../src/utils/memberUtils.js';

import { isDateInRange } from '../src/utils/analyticsUtils.js';

// ============================================================================
// 1. MC/DC Truth Table: PT Ending Soon Filter (isPtEndingSoon)
// Decision D1: (c.status === 'active') AND (Number(c.remainingSessions) <= 3)
// Condition A: status === 'active'
// Condition B: remainingSessions <= 3
//
// MC/DC Independence Pairs:
// - Independence of A: Test 1 (T, T -> TRUE) vs Test 3 (F, T -> FALSE)
// - Independence of B: Test 1 (T, T -> TRUE) vs Test 2 (T, F -> FALSE)
// ============================================================================

test('WB-COND-01: PT Ending Soon MC/DC Test Suite (Production isPtEndingSoon)', () => {
  // Row 1: A=True, B=True -> Outcome: TRUE (Alert triggered)
  assert.equal(isPtEndingSoon({ status: 'active', remainingSessions: 2 }), true);

  // Row 2: A=True, B=False -> Outcome: FALSE (Active, but 5 sessions remaining)
  assert.equal(isPtEndingSoon({ status: 'active', remainingSessions: 5 }), false);

  // Row 3: A=False, B=True -> Outcome: FALSE (Inactive/completed, despite <= 3 sessions)
  assert.equal(isPtEndingSoon({ status: 'completed', remainingSessions: 0 }), false);
  assert.equal(isPtEndingSoon({ status: 'cancelled', remainingSessions: 1 }), false);

  // Row 4: A=False, B=False -> Outcome: FALSE (Both false)
  assert.equal(isPtEndingSoon({ status: 'inactive', remainingSessions: 8 }), false);

  // Boundary condition: exactly 3 is true; exactly 4 is false
  assert.equal(isPtEndingSoon({ status: 'active', remainingSessions: 3 }), true);
  assert.equal(isPtEndingSoon({ status: 'active', remainingSessions: 4 }), false);

  // Safe falsy handling
  assert.equal(isPtEndingSoon(null), false);
  assert.equal(isPtEndingSoon(undefined), false);
});

// ============================================================================
// 2. MC/DC Truth Table: Attention Center Pending Dues Filter (isPendingDuesVisible)
// Decision D2: (isAdmin) AND (Number(m.balance) > 0)
// Condition A: isAdmin
// Condition B: Number(balance) > 0
//
// MC/DC Independence Pairs:
// - Independence of A: Test 1 (T, T -> TRUE) vs Test 3 (F, T -> FALSE)
// - Independence of B: Test 1 (T, T -> TRUE) vs Test 2 (T, F -> FALSE)
// ============================================================================

test('WB-COND-02: Attention Pending Dues MC/DC Test Suite (Production isPendingDuesVisible)', () => {
  // Row 1: A=True, B=True -> Outcome: TRUE (Admin sees member with dues)
  assert.equal(isPendingDuesVisible(true, { balance: 400 }), true);

  // Row 2: A=True, B=False -> Outcome: FALSE (Admin sees member with zero or negative dues)
  assert.equal(isPendingDuesVisible(true, { balance: 0 }), false);
  assert.equal(isPendingDuesVisible(true, { balance: -50 }), false);

  // Row 3: A=False, B=True -> Outcome: FALSE (Staff caller blocked despite member having dues)
  assert.equal(isPendingDuesVisible(false, { balance: 400 }), false);

  // Row 4: A=False, B=False -> Outcome: FALSE (Staff caller blocked with zero dues)
  assert.equal(isPendingDuesVisible(false, { balance: 0 }), false);

  // Falsy inputs
  assert.equal(isPendingDuesVisible(true, null), false);
  assert.equal(isPendingDuesVisible(false, null), false);
});

// ============================================================================
// 3. Condition Testing: Follow-up Overdue Decision (isFollowupOverdue)
// Decision D3: (status !== 'completed' && status !== 'cancelled')
//              AND (status === 'overdue' || dueDate < todayStr)
// ============================================================================

test('WB-COND-03: Follow-up Overdue Compound Condition Truth Permutations (Production isFollowupOverdue)', () => {
  const todayStr = '2026-11-09';

  // Case 1: Pending, past due date (A=T, B=T, C=F) -> TRUE
  assert.equal(isFollowupOverdue({ status: 'pending', dueDate: '2026-11-05' }, todayStr), true);

  // Case 2: Explicitly marked overdue, future date (A=T, B=F, C=T) -> TRUE
  assert.equal(isFollowupOverdue({ status: 'overdue', dueDate: '2026-11-15' }, todayStr), true);

  // Case 3: Both conditions true (A=T, B=T, C=T) -> TRUE
  assert.equal(isFollowupOverdue({ status: 'overdue', dueDate: '2026-11-01' }, todayStr), true);

  // Case 4: Pending, future date (A=T, B=F, C=F) -> FALSE
  assert.equal(isFollowupOverdue({ status: 'pending', dueDate: '2026-11-10' }, todayStr), false);

  // Case 5: Completed, past date (A=F, B=T, C=F) -> FALSE (Completed tasks are never overdue)
  assert.equal(isFollowupOverdue({ status: 'completed', dueDate: '2026-11-01' }, todayStr), false);

  // Case 6: Cancelled task, past date -> FALSE (Cancelled tasks are never overdue)
  assert.equal(isFollowupOverdue({ status: 'cancelled', dueDate: '2026-11-01' }, todayStr), false);

  // Falsy input handling
  assert.equal(isFollowupOverdue(null, todayStr), false);
});

// ============================================================================
// 4. MC/DC Truth Table: Date Range Filter (isDateInRange)
// Decision D4: (!startDate || date >= startDate) AND (!endDate || date <= endDate)
// Condition A: (!startDate || date >= startDate)
// Condition B: (!endDate || date <= endDate)
// ============================================================================

test('WB-COND-04: Date Range Inclusivity MC/DC Test Suite (Production isDateInRange)', () => {
  const testDate = '2026-11-09';

  // 1. No bounds (A=T, B=T) -> TRUE
  assert.equal(isDateInRange(testDate, null, null), true);

  // 2. Both bounds enclose testDate (A=T, B=T) -> TRUE
  assert.equal(isDateInRange(testDate, '2026-11-01', '2026-11-30'), true);

  // 3. Exact boundary matching (Both A=T, B=T on boundaries)
  assert.equal(isDateInRange(testDate, '2026-11-09', '2026-11-09'), true);

  // 4. Before start date (A=F, B=T) -> FALSE
  assert.equal(isDateInRange(testDate, '2026-11-15', '2026-11-30'), false);

  // 5. After end date (A=T, B=F) -> FALSE
  assert.equal(isDateInRange(testDate, '2026-11-01', '2026-11-05'), false);

  // 6. Inverted bounds where start > end (A=F, B=F) -> FALSE
  assert.equal(isDateInRange(testDate, '2026-11-20', '2026-11-01'), false);

  // 7. Falsy date string
  assert.equal(isDateInRange('', '2026-11-01', '2026-11-30'), false);
  assert.equal(isDateInRange(null, '2026-11-01', '2026-11-30'), false);
});

// ============================================================================
// 5. Condition Testing: isValidIndianPhone & isValidEmail
// ============================================================================

test('WB-COND-05: isValidIndianPhone atomic condition coverage', () => {
  // Empty / null condition
  assert.equal(isValidIndianPhone(null), false);
  assert.equal(isValidIndianPhone(''), false);

  // Valid 10 digits starting with 6, 7, 8, 9
  assert.equal(isValidIndianPhone('6123456789'), true);
  assert.equal(isValidIndianPhone('7385846525'), true);
  assert.equal(isValidIndianPhone('8987654321'), true);
  assert.equal(isValidIndianPhone('9876543210'), true);

  // Invalid starting digit (0 through 5)
  assert.equal(isValidIndianPhone('5123456789'), false);
  assert.equal(isValidIndianPhone('0123456789'), false);
  assert.equal(isValidIndianPhone('1234567890'), false);

  // Invalid length
  assert.equal(isValidIndianPhone('987654321'), false); // 9 digits
  assert.equal(isValidIndianPhone('98765432100'), false); // 11 digits
});

test('WB-COND-06: isValidEmail atomic condition coverage', () => {
  // In gym registration, email is an optional field: null/empty evaluates as true
  assert.equal(isValidEmail(null), true);
  assert.equal(isValidEmail(''), true);
  assert.equal(isValidEmail('   '), true);

  // If provided, format must match email regex
  assert.equal(isValidEmail('plainaddress'), false);
  assert.equal(isValidEmail('user@domain'), false);
  assert.equal(isValidEmail('@missingusername.com'), false);
  assert.equal(isValidEmail('username@.com'), false);
  assert.equal(isValidEmail('admin@thefitnesshouse.in'), true);
  assert.equal(isValidEmail('coach.pravin+test@gmail.com'), true);
});
