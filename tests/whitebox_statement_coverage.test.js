/**
 * White-Box Testing Suite: Statement Coverage (Line-by-Line Testing)
 * The Fitness House Gym Management Admin Panel
 *
 * Verifies statement execution across domain calculations, utility modules,
 * and service data normalization functions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getLocalDateString,
  formatDaysRemainingLabel,
  calculateNotificationDaysRemaining,
  getDaysDifference,
  getMembershipStatus,
  getExpiryClassification,
  generateNotificationMessage,
  normalizeIndianMobile,
  calculateExpiryDate,
  getMemberInitials,
  getNextMemberId,
  formatINR,
  isValidIndianPhone,
  isValidEmail,
  isCurrentMonth,
  getPaymentPurpose,
} from '../src/utils/memberUtils.js';

import {
  computePlanDetailsTableData,
  computePlanDistributionData,
  PLAN_PALETTE_COLORS,
} from '../src/utils/analyticsUtils.js';

import {
  escapeCSVCell,
  generateMembersCSV,
} from '../src/utils/exportUtils.js';

import {
  validateEmail,
  validatePassword,
  isValidRole,
} from '../src/services/authService.js';

// ============================================================================
// 1. memberUtils.js Statement Coverage
// ============================================================================

test('WB-STMT-01: getLocalDateString statement paths', () => {
  // Empty / null inputs
  assert.equal(getLocalDateString(null), '');
  assert.equal(getLocalDateString(''), '');
  assert.equal(getLocalDateString(undefined), getLocalDateString(new Date()));

  // Already formatted YYYY-MM-DD string
  assert.equal(getLocalDateString('2026-11-09'), '2026-11-09');

  // Invalid date object / string
  assert.equal(getLocalDateString('invalid-date-string'), '');

  // Date object in UTC crossing midnight into Asia/Kolkata
  const utcLate = new Date('2026-11-09T20:00:00Z'); // 01:30 AM on Nov 10 in IST
  assert.equal(getLocalDateString(utcLate), '2026-11-10');
});

test('WB-STMT-02: formatDaysRemainingLabel statement paths', () => {
  assert.equal(formatDaysRemainingLabel(null), null);
  assert.equal(formatDaysRemainingLabel(undefined), null);
  assert.equal(formatDaysRemainingLabel(-5), 'Expired 5d ago');
  assert.equal(formatDaysRemainingLabel(0), 'Expires Today');
  assert.equal(formatDaysRemainingLabel(3), '3 days remaining');
});

test('WB-STMT-03: calculateNotificationDaysRemaining statement paths', () => {
  assert.equal(calculateNotificationDaysRemaining(null), null);

  // Target date variant
  const itemWithTarget = { targetDate: '2026-11-15' };
  assert.equal(calculateNotificationDaysRemaining(itemWithTarget, '2026-11-10'), 5);

  // Expiry date variant
  const itemWithExpiry = { expiryDate: '2026-11-10T12:00:00Z' };
  assert.equal(calculateNotificationDaysRemaining(itemWithExpiry, '2026-11-10'), 0);

  // Scheduled date variant
  const itemWithScheduled = { scheduledDate: '2026-11-08' };
  assert.equal(calculateNotificationDaysRemaining(itemWithScheduled, '2026-11-10'), -2);

  // Days remaining fallback when date string absent
  const itemWithFallback = { daysRemaining: 7 };
  assert.equal(calculateNotificationDaysRemaining(itemWithFallback, '2026-11-10'), 7);

  // No dates and no daysRemaining
  assert.equal(calculateNotificationDaysRemaining({}, '2026-11-10'), null);
});

test('WB-STMT-04: generateNotificationMessage statement paths for all 7 template types', () => {
  const member = { name: 'Rahul Shinde', plan: 'Quarterly Plan', expiryDate: '2026-11-15', balance: 500 };
  const phone = '+91 7385846525';

  assert.match(generateNotificationMessage({ type: 'expiry_5d', member, gymPhone: phone }), /will expire in 5 days/);
  assert.match(generateNotificationMessage({ type: 'expiry_3d', member, gymPhone: phone }), /only 3 days left/);
  assert.match(generateNotificationMessage({ type: 'expiry_today', member, gymPhone: phone }), /expires today/);
  assert.match(generateNotificationMessage({ type: 'expired', member, gymPhone: phone }), /membership has expired/);
  assert.match(generateNotificationMessage({ type: 'balance_due', member, balance: 500, gymPhone: phone }), /pending balance of ₹500/);
  assert.match(generateNotificationMessage({ type: 'payment_due', member, balance: 300, gymPhone: phone }), /pending balance of ₹300/);
  assert.match(generateNotificationMessage({ type: 'pt_ending', member, gymPhone: phone }), /Personal Training package/);
  assert.match(generateNotificationMessage({ type: 'unknown_type', member, gymPhone: phone }), /greeting from The Fitness House/);

  // Fallback defaults when member is null/empty
  assert.match(generateNotificationMessage({ type: 'expiry_5d', member: null }), /Hi Member/);
});

test('WB-STMT-05: normalizeIndianMobile statement paths', () => {
  // Missing / empty inputs
  assert.deepEqual(normalizeIndianMobile(''), { valid: false, phone: '', display: 'No phone provided', reason: 'missing' });
  assert.deepEqual(normalizeIndianMobile(null), { valid: false, phone: '', display: 'No phone provided', reason: 'missing' });

  // 12 digits with 91 prefix
  assert.deepEqual(normalizeIndianMobile('+91 9876543210'), { valid: true, phone: '9876543210', display: '+91 9876543210', reason: null });
  assert.deepEqual(normalizeIndianMobile('919876543210'), { valid: true, phone: '9876543210', display: '919876543210', reason: null });

  // 11 digits with 0 prefix
  assert.deepEqual(normalizeIndianMobile('09876543210'), { valid: true, phone: '9876543210', display: '09876543210', reason: null });

  // Clean 10 digits
  assert.deepEqual(normalizeIndianMobile('9876543210'), { valid: true, phone: '9876543210', display: '9876543210', reason: null });

  // Invalid length or prefix (< 6)
  assert.deepEqual(normalizeIndianMobile('5551234567'), { valid: false, phone: '5551234567', display: '5551234567', reason: 'invalid_format' });
  assert.deepEqual(normalizeIndianMobile('98765'), { valid: false, phone: '98765', display: '98765', reason: 'invalid_format' });
});

test('WB-STMT-06: getMemberInitials and getNextMemberId statement paths', () => {
  // getMemberInitials
  assert.equal(getMemberInitials(null), 'M');
  assert.equal(getMemberInitials('   '), 'M');
  assert.equal(getMemberInitials('Pratik'), 'PR');
  assert.equal(getMemberInitials('Pratik   Pawar'), 'PP');
  assert.equal(getMemberInitials('Coach Pravin Joshi'), 'CJ');

  // getNextMemberId
  assert.equal(getNextMemberId([]), 'TFH001');
  assert.equal(getNextMemberId([{ id: 'TFH001' }]), 'TFH002');
  assert.equal(getNextMemberId([{ id: 'TFH009' }, { id: 'TFH002' }]), 'TFH010');
  assert.equal(getNextMemberId([{ id: null }, { id: 'MEM-999' }]), 'TFH001');
});

test('WB-STMT-07: formatINR, isValidIndianPhone, isValidEmail, isCurrentMonth', () => {
  assert.equal(formatINR(0), '₹0');
  assert.equal(formatINR(2500), '₹2,500');
  assert.equal(formatINR(null), '₹0');
  assert.equal(formatINR(NaN), '₹0');

  assert.equal(isValidIndianPhone('9876543210'), true);
  assert.equal(isValidIndianPhone('1234567890'), false);
  assert.equal(isValidIndianPhone(''), false);

  assert.equal(isValidEmail('admin@thefitnesshouse.in'), true);
  assert.equal(isValidEmail('invalid-email'), false);
  assert.equal(isValidEmail(null), true); // Optional field

  assert.equal(isCurrentMonth('2026-11-09', '2026-11-01'), true);
  assert.equal(isCurrentMonth('2026-10-31', '2026-11-01'), false);
  assert.equal(isCurrentMonth('', '2026-11-01'), false);
});

test('WB-STMT-08: getPaymentPurpose statement paths', () => {
  assert.equal(getPaymentPurpose({ purpose: 'Explicit Custom Purpose' }), 'Explicit Custom Purpose');
  assert.equal(getPaymentPurpose({ notes: 'Initial registration pass' }), 'Initial Registration Fee');
  assert.equal(getPaymentPurpose({ notes: 'Monthly renewal fee' }), 'Membership Renewal');
  assert.equal(getPaymentPurpose({ notes: 'Settling pending dues' }), 'Outstanding Dues Settlement');
  assert.equal(getPaymentPurpose({ category: 'Personal Training', relatedPlan: 'Tier 1' }), 'PT Package (Tier 1)');
  assert.equal(getPaymentPurpose({ relatedPlan: 'Monthly Plan' }), 'Membership Fee (Monthly Plan)');
  assert.equal(getPaymentPurpose({ category: 'Locker' }), 'Locker Fee');
  assert.equal(getPaymentPurpose({}), 'Fee Payment');
});

// ============================================================================
// 2. analyticsUtils.js Statement Coverage
// ============================================================================

test('WB-STMT-09: computePlanDetailsTableData statement paths', () => {
  // Empty arguments fallback
  const emptyRes = computePlanDetailsTableData();
  assert.deepEqual(emptyRes, []);

  const plans = [
    { id: 'p1', name: 'daily', duration_days: 1, price: 30, is_active: true },
    { id: 'p2', name: 'Monthly Plan', duration_days: 30, price: 700, is_active: true },
    { id: 'p3', name: 'Archived Plan', duration_days: 60, price: 1200, is_active: false },
  ];

  const members = [
    { id: 'm1', currentSubscriptionId: 's1', plan: 'Monthly Plan', status: 'active' },
    { id: 'm2', currentSubscriptionId: 's2', plan: 'Archived Plan', status: 'active' },
    { id: 'm3', currentSubscriptionId: null, plan: 'daily', status: 'expired' },
    { id: 'm4', currentSubscriptionId: 's4', plan: 'Custom Ad-Hoc Plan', status: 'active' },
  ];

  const subscriptions = [
    { id: 's1', planId: 'p2', planName: 'Monthly Plan', planPrice: 700, status: 'active', startDate: '2026-11-01' },
    { id: 's2', planId: 'p3', planName: 'Archived Plan', planPrice: 1200, status: 'active', startDate: '2026-11-01' },
    { id: 's3', planId: 'p2', planName: 'Monthly Plan', planPrice: 700, status: 'superseded', startDate: '2026-10-01' },
    { id: 's4', planId: 'unknown-id', planName: 'Custom Ad-Hoc Plan', planPrice: 1500, status: 'active', startDate: '2026-11-01' },
  ];

  const payments = [
    { id: 'pay1', subscriptionId: 's1', amount: 700, status: 'completed', date: '2026-11-02' },
    { id: 'pay2', subscriptionId: 's3', amount: 700, status: 'completed', date: '2026-10-02' },
    { id: 'pay3', subscriptionId: 's1', amount: 200, status: 'failed', date: '2026-11-02' }, // excluded
  ];

  const result = computePlanDetailsTableData({
    allMembershipPlans: plans,
    members,
    subscriptions,
    payments,
    isDateInRange: (d) => d.startsWith('2026-11'),
  });

  // Verify daily plan is present with 0 enrolled
  const daily = result.find(r => r.name === 'daily');
  assert.ok(daily);
  assert.equal(daily.enrolledCount, 0);
  assert.equal(daily.activeCount, 0);
  assert.equal(daily.totalRevenue, 0);

  // Verify Monthly Plan has 2 enrolled (s1, s3), 1 active (m1), and 700 period revenue
  const monthly = result.find(r => r.name === 'Monthly Plan');
  assert.ok(monthly);
  assert.equal(monthly.enrolledCount, 2);
  assert.equal(monthly.activeCount, 1);
  assert.equal(monthly.totalRevenue, 700);

  // Verify custom unknown plan was appended dynamically as legacy
  const custom = result.find(r => r.name.includes('Custom Ad-Hoc Plan'));
  assert.ok(custom);
  assert.equal(custom.isLegacy, true);
  assert.equal(custom.activeCount, 1);
});

test('WB-STMT-10: computePlanDistributionData statement paths', () => {
  // Empty data
  assert.deepEqual(computePlanDistributionData([]), []);

  const data = [
    { id: 'p1', name: 'Monthly Plan', activeCount: 4, isActive: true },
    { id: 'p2', name: 'Zero Plan', activeCount: 0, isActive: true }, // excluded
    { id: 'p3', name: 'Archived Plan', activeCount: 1, isActive: false },
  ];

  const chart = computePlanDistributionData(data);
  assert.equal(chart.length, 2);
  assert.equal(chart[0].name, 'Monthly Plan');
  assert.equal(chart[0].value, 4);
  assert.equal(chart[0].color, PLAN_PALETTE_COLORS[0]);

  // Inactive tag appended
  assert.equal(chart[1].name, 'Archived Plan (Inactive)');
  assert.equal(chart[1].value, 1);
});

// ============================================================================
// 3. exportUtils.js Statement Coverage
// ============================================================================

test('WB-STMT-11: escapeCSVCell statement paths', () => {
  assert.equal(escapeCSVCell(null), '');
  assert.equal(escapeCSVCell(undefined), '');
  assert.equal(escapeCSVCell(1234), '1234');
  assert.equal(escapeCSVCell(true), 'true');
  assert.equal(escapeCSVCell('Simple Text'), 'Simple Text');
  assert.equal(escapeCSVCell('Text, with comma'), '"Text, with comma"');
  assert.equal(escapeCSVCell('Text with "quotes"'), '"Text with ""quotes"""');
  assert.equal(escapeCSVCell('Line 1\nLine 2'), '"Line 1\nLine 2"');
});

test('WB-STMT-12: CSV export string builders statement paths', () => {
  const members = [{
    member_code: 'MEM-01',
    name: 'Pratik Pawar',
    phone: '9876543210',
    email: 'pratik@example.com',
    gender: 'Male',
    plan: 'Monthly Plan',
    startDate: '2026-11-01',
    expiryDate: '2026-12-01',
    status: 'active',
    amountPaid: 700,
    balance: 0,
    joinDate: '2026-11-01',
  }];

  const csv = generateMembersCSV(members);
  assert.match(csv, /Member ID,Full Name,Phone/);
  assert.match(csv, /MEM-01,Pratik Pawar,9876543210/);

  // Empty list returns header row
  const emptyCsv = generateMembersCSV([]);
  assert.match(emptyCsv, /Member ID,Full Name,Phone/);
  assert.equal(emptyCsv.trim().split(/\r?\n/).length, 1, 'Empty CSV export must contain exactly one header row and zero data rows');
});

// ============================================================================
// 4. authService.js Statement Coverage
// ============================================================================

test('WB-STMT-13: authService validation statements', () => {
  // validateEmail
  assert.equal(validateEmail(''), 'Please enter your email and password.');
  assert.equal(validateEmail(null), 'Please enter your email and password.');
  assert.equal(validateEmail('not-an-email'), 'Please enter a valid email address.');
  assert.equal(validateEmail('user@thefitnesshouse.in'), null);

  // validatePassword
  assert.equal(validatePassword(''), 'Please complete all password fields.');
  assert.equal(validatePassword(null), 'Please complete all password fields.');
  assert.equal(validatePassword('12345'), 'Password must be at least 6 characters long.');
  assert.equal(validatePassword('validPass123'), null);

  // isValidRole
  assert.equal(isValidRole('admin'), true);
  assert.equal(isValidRole('staff'), true);
  assert.equal(isValidRole('ADMIN'), true);
  assert.equal(isValidRole('superadmin'), false);
  assert.equal(isValidRole(null), false);
  assert.equal(isValidRole(undefined), false);
});
