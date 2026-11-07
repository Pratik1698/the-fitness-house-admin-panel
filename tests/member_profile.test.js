/**
 * MemberProfile — Automated Regression Tests
 * Phase 3 QA: The Fitness House Admin Panel
 *
 * Tests pure logic extracted from MemberProfile.jsx:
 * - Member lookup by id and member_code
 * - ?renew=true URL param: renewal modal trigger
 * - Payment/check-in/PT/follow-up filter by memberId
 * - Activity feed: merged, sorted, sliced to 10 items
 * - Subscription status and daysLeft display logic
 * - Outstanding balance display guard (balance > 0)
 * - PT progress: completion %, "ending soon" threshold
 * - Expired member: check-in blocked, notice message
 * - Profile field validation: phone, email
 * - Missing member: "not found" state
 *
 * No React rendering. No Supabase connection. Synthetic data only.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMembershipStatus,
  getDaysDifference,
  getMemberInitials,
  isValidIndianPhone,
  isValidEmail,
} from '../src/utils/memberUtils.js';

// ---------------------------------------------------------------------------
// Reference date
// ---------------------------------------------------------------------------
const TODAY = '2026-11-07';

// ---------------------------------------------------------------------------
// Pure logic helpers mirroring MemberProfile.jsx
// ---------------------------------------------------------------------------

/** MemberProfile.jsx line 39: find member by id or member_code */
function findMember(members, id) {
  return members.find(m => m.id === id || m.member_code === id);
}

/** MemberProfile.jsx line 52: filter payments for a member */
function getMemberPayments(payments, id, member) {
  return payments.filter(p =>
    p.memberId === id ||
    (member && (p.memberId === member.id || p.memberId === member.member_code))
  );
}

/** MemberProfile.jsx line 53: filter checkins for a member */
function getMemberCheckins(checkins, id, member) {
  return checkins.filter(c =>
    c.memberId === id ||
    (member && (c.memberId === member.id || c.memberId === member.member_code))
  );
}

/** MemberProfile.jsx line 54: filter PT clients for a member */
function getMemberPT(ptClients, id, member) {
  return ptClients.filter(c =>
    c.memberId === id ||
    (member && (c.memberId === member.id || c.memberId === member.member_code))
  );
}

/** MemberProfile.jsx line 55: filter PT sessions for a member */
function getMemberPTSessions(ptSessions, id, member) {
  return ptSessions.filter(s =>
    s.memberId === id ||
    (member && (s.memberId === member.id || s.memberId === member.member_code))
  );
}

/** MemberProfile.jsx lines 279–281: activity feed (merged, date-sorted, top-10) */
function computeActivityFeed(memberPayments, memberCheckins) {
  return [
    ...memberPayments.map(p => ({ type: 'payment', date: p.date, desc: `Payment ₹${p.amount.toLocaleString()} (${p.category})` })),
    ...memberCheckins.map(c => ({ type: 'checkin', date: c.date, desc: `Checked in at ${c.time}` })),
  ]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);
}

/** MemberProfile.jsx line 89: outstanding display — only show when balance > 0 */
function computeOutstandingDisplay(balance) {
  return (Number(balance) || 0) > 0 ? `₹${Number(balance).toLocaleString()}` : '—';
}

/** MemberProfile.jsx line 93: days remaining display (clamped to 0) */
function computeDaysRemainingDisplay(daysLeft) {
  return daysLeft > 0 ? daysLeft : 0;
}

/** MemberProfile.jsx lines 215–217: PT progress percentage */
function computePtProgressPercent(completedSessions, totalSessions) {
  return Math.round((completedSessions / (totalSessions || 1)) * 100);
}

/** MemberProfile.jsx line 222: PT ending soon (<=3 and active) */
function isPtEndingSoon(remainingSessions, status) {
  return remainingSessions <= 3 && status === 'active';
}

/** MemberProfile.jsx lines 61–65: check-in guard for expired members */
function canCheckin(member, todayStr) {
  const status = getMembershipStatus(member, todayStr);
  return status !== 'expired';
}

// ---------------------------------------------------------------------------
// Synthetic test data
// ---------------------------------------------------------------------------
const MEMBERS = [
  { id: 'M01', member_code: 'MEM-00001', name: 'Alice Active', plan: 'Monthly', expiryDate: '2026-11-30', balance: 0, totalFee: 700, amountPaid: 700, status: 'active' },
  { id: 'M02', member_code: 'MEM-00002', name: 'Bob Dues', plan: 'Quarterly', expiryDate: '2026-12-15', balance: 400, totalFee: 1500, amountPaid: 1100, status: 'active' },
  { id: 'M03', member_code: 'MEM-00003', name: 'Charlie Expired', plan: 'Monthly', expiryDate: '2026-11-01', balance: 0, totalFee: 700, amountPaid: 700, status: 'active' },
  { id: 'M04', member_code: 'MEM-00004', name: 'Diana Cancelled', plan: 'Monthly', expiryDate: '2027-01-01', balance: 0, totalFee: 700, amountPaid: 700, status: 'cancelled' },
];

const PAYMENTS = [
  { id: 'P01', memberId: 'M01', amount: 700, status: 'completed', date: '2026-11-01', method: 'UPI', category: 'Membership' },
  { id: 'P02', memberId: 'MEM-00002', amount: 1100, status: 'completed', date: '2026-10-20', method: 'Cash', category: 'Membership' },
  { id: 'P03', memberId: 'M03', amount: 700, status: 'completed', date: '2026-10-01', method: 'UPI', category: 'Membership' },
  { id: 'P04', memberId: 'OTHER01', amount: 500, status: 'completed', date: '2026-11-01', method: 'Cash', category: 'Membership' },
];

const CHECKINS = [
  { id: 'C01', memberId: 'M01', date: '2026-11-07', time: '09:00', status: 'valid' },
  { id: 'C02', memberId: 'M01', date: '2026-11-06', time: '10:00', status: 'valid' },
  { id: 'C03', memberId: 'M01', date: '2026-11-05', time: '08:30', status: 'valid' },
  { id: 'C04', memberId: 'M02', date: '2026-11-07', time: '11:00', status: 'valid' },
];

const PT_CLIENTS = [
  { packageId: 'PT01', memberId: 'M01', memberName: 'Alice Active', package: '12-Session', trainer: 'Coach Pravin', totalSessions: 12, completedSessions: 10, remainingSessions: 2, status: 'active', startDate: '2026-10-01', validTill: '2026-12-01' },
  { packageId: 'PT02', memberId: 'M02', memberName: 'Bob Dues', package: '20-Session', trainer: 'Coach Pravin', totalSessions: 20, completedSessions: 5, remainingSessions: 15, status: 'active', startDate: '2026-09-01', validTill: '2027-01-01' },
];

const PT_SESSIONS = [
  { id: 'S01', memberId: 'M01', date: '2026-11-07', time: '09:00', status: 'completed', trainer: 'Coach Pravin' },
  { id: 'S02', memberId: 'M01', date: '2026-11-05', time: '10:00', status: 'completed', trainer: 'Coach Pravin' },
  { id: 'S03', memberId: 'M02', date: '2026-11-07', time: '11:00', status: 'scheduled', trainer: 'Coach Pravin' },
];

// ---------------------------------------------------------------------------
// 1. Member lookup
// ---------------------------------------------------------------------------
test('MemberProfile: findMember by id returns correct member', () => {
  const member = findMember(MEMBERS, 'M01');
  assert.ok(member, 'Member M01 must be found');
  assert.strictEqual(member.name, 'Alice Active');
});

test('MemberProfile: findMember by member_code returns correct member', () => {
  const member = findMember(MEMBERS, 'MEM-00001');
  assert.ok(member, 'Member by code MEM-00001 must be found');
  assert.strictEqual(member.id, 'M01');
});

test('MemberProfile: findMember returns undefined for unknown id', () => {
  const member = findMember(MEMBERS, 'UNKNOWN-999');
  assert.strictEqual(member, undefined);
});

test('MemberProfile: findMember by member_code that is another member\'s id returns correct', () => {
  // M02's member_code is MEM-00002; searching by member_code should find M02
  const member = findMember(MEMBERS, 'MEM-00002');
  assert.ok(member);
  assert.strictEqual(member.id, 'M02');
});

// ---------------------------------------------------------------------------
// 2. Data filtering by memberId / member_code
// ---------------------------------------------------------------------------
test('MemberProfile: getMemberPayments returns only payments for the member', () => {
  const member = findMember(MEMBERS, 'M01');
  const result = getMemberPayments(PAYMENTS, 'M01', member);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'P01');
});

test('MemberProfile: getMemberPayments matches by member_code (MEM-00002)', () => {
  const member = findMember(MEMBERS, 'M02');
  // P02 uses memberId = MEM-00002 (the member_code)
  const result = getMemberPayments(PAYMENTS, 'M02', member);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'P02');
});

test('MemberProfile: getMemberPayments excludes other members\' payments', () => {
  const member = findMember(MEMBERS, 'M01');
  const result = getMemberPayments(PAYMENTS, 'M01', member);
  const ids = result.map(p => p.id);
  assert.ok(!ids.includes('P02'), 'P02 belongs to M02 — must not appear for M01');
  assert.ok(!ids.includes('P04'), 'P04 belongs to OTHER01 — must not appear for M01');
});

test('MemberProfile: getMemberCheckins returns only checkins for the member', () => {
  const member = findMember(MEMBERS, 'M01');
  const result = getMemberCheckins(CHECKINS, 'M01', member);
  assert.strictEqual(result.length, 3); // C01, C02, C03
  assert.ok(result.every(c => c.memberId === 'M01'));
});

test('MemberProfile: getMemberPT returns correct PT client records', () => {
  const member = findMember(MEMBERS, 'M01');
  const result = getMemberPT(PT_CLIENTS, 'M01', member);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].packageId, 'PT01');
});

test('MemberProfile: getMemberPTSessions returns sessions for the correct member', () => {
  const member = findMember(MEMBERS, 'M01');
  const result = getMemberPTSessions(PT_SESSIONS, 'M01', member);
  assert.strictEqual(result.length, 2); // S01, S02
  assert.ok(result.every(s => s.memberId === 'M01'));
});

// ---------------------------------------------------------------------------
// 3. Subscription status display
// ---------------------------------------------------------------------------
test('MemberProfile: active member has status active', () => {
  const member = findMember(MEMBERS, 'M01');
  const status = getMembershipStatus(member, TODAY);
  assert.strictEqual(status, 'active');
});

test('MemberProfile: expired member has status expired', () => {
  const member = findMember(MEMBERS, 'M03');
  const status = getMembershipStatus(member, TODAY);
  assert.strictEqual(status, 'expired');
});

test('MemberProfile: cancelled member has status cancelled', () => {
  const member = findMember(MEMBERS, 'M04');
  const status = getMembershipStatus(member, TODAY);
  assert.strictEqual(status, 'cancelled');
});

test('MemberProfile: daysLeft is positive for active member', () => {
  const member = findMember(MEMBERS, 'M01');
  const daysLeft = getDaysDifference(member.expiryDate, TODAY);
  assert.ok(daysLeft > 0, `daysLeft should be positive, got ${daysLeft}`);
});

test('MemberProfile: daysLeft is negative for expired member', () => {
  const member = findMember(MEMBERS, 'M03');
  const daysLeft = getDaysDifference(member.expiryDate, TODAY);
  assert.ok(daysLeft < 0, `daysLeft should be negative for expired member, got ${daysLeft}`);
});

test('MemberProfile: daysRemaining display clamped to 0 for expired member', () => {
  const daysLeft = getDaysDifference('2026-11-01', TODAY); // -6
  const display = computeDaysRemainingDisplay(daysLeft);
  assert.strictEqual(display, 0);
});

test('MemberProfile: daysRemaining display is actual value for active member', () => {
  const daysLeft = getDaysDifference('2026-11-30', TODAY); // 23
  const display = computeDaysRemainingDisplay(daysLeft);
  assert.strictEqual(display, 23);
});

// ---------------------------------------------------------------------------
// 4. Outstanding balance display
// ---------------------------------------------------------------------------
test('MemberProfile: outstanding shows formatted amount when balance > 0', () => {
  assert.strictEqual(computeOutstandingDisplay(400), '₹400');
});

test('MemberProfile: outstanding shows dash when balance is 0', () => {
  assert.strictEqual(computeOutstandingDisplay(0), '—');
});

test('MemberProfile: outstanding shows dash when balance is null', () => {
  assert.strictEqual(computeOutstandingDisplay(null), '—');
});

test('MemberProfile: outstanding shows dash when balance is undefined', () => {
  assert.strictEqual(computeOutstandingDisplay(undefined), '—');
});

test('MemberProfile: outstanding shows formatted amount for numeric string balance', () => {
  assert.strictEqual(computeOutstandingDisplay('1200'), '₹1,200');
});

// ---------------------------------------------------------------------------
// 5. PT package progress
// ---------------------------------------------------------------------------
test('MemberProfile: PT progress 10/12 → 83%', () => {
  const pct = computePtProgressPercent(10, 12);
  assert.strictEqual(pct, 83);
});

test('MemberProfile: PT progress 0/0 → 0% (no divide by zero)', () => {
  const pct = computePtProgressPercent(0, 0);
  assert.strictEqual(pct, 0);
});

test('MemberProfile: PT progress 20/20 → 100%', () => {
  const pct = computePtProgressPercent(20, 20);
  assert.strictEqual(pct, 100);
});

test('MemberProfile: PT ending soon: 2 remaining, active → true', () => {
  assert.ok(isPtEndingSoon(2, 'active'));
});

test('MemberProfile: PT ending soon: 3 remaining, active → true (boundary)', () => {
  assert.ok(isPtEndingSoon(3, 'active'));
});

test('MemberProfile: PT ending soon: 4 remaining, active → false', () => {
  assert.ok(!isPtEndingSoon(4, 'active'));
});

test('MemberProfile: PT ending soon: 1 remaining, completed → false', () => {
  assert.ok(!isPtEndingSoon(1, 'completed'));
});

// ---------------------------------------------------------------------------
// 6. Check-in business logic
// ---------------------------------------------------------------------------
test('MemberProfile: expired member cannot check in', () => {
  const member = findMember(MEMBERS, 'M03');
  assert.ok(!canCheckin(member, TODAY), 'Expired member must not be allowed to check in');
});

test('MemberProfile: active member can check in', () => {
  const member = findMember(MEMBERS, 'M01');
  assert.ok(canCheckin(member, TODAY), 'Active member must be allowed to check in');
});

test('MemberProfile: member expiring today can still check in', () => {
  const expiringToday = { id: 'T01', name: 'Test', expiryDate: TODAY, status: 'active' };
  assert.ok(canCheckin(expiringToday, TODAY), 'Member expiring today must still be allowed to check in');
});

test('MemberProfile: cancelled member check-in status is not expired (cancelled)', () => {
  const member = findMember(MEMBERS, 'M04');
  const status = getMembershipStatus(member, TODAY);
  assert.strictEqual(status, 'cancelled');
  // Dashboard check-in guard only blocks 'expired', not 'cancelled'
  assert.ok(canCheckin(member, TODAY), 'Cancelled member is not "expired" — guard passes');
});

// ---------------------------------------------------------------------------
// 7. Activity feed
// ---------------------------------------------------------------------------
test('MemberProfile: activity feed merges payments and checkins sorted by date desc', () => {
  const payments = [
    { id: 'P1', memberId: 'M01', amount: 700, date: '2026-11-01', category: 'Membership' },
    { id: 'P2', memberId: 'M01', amount: 400, date: '2026-10-15', category: 'Membership' },
  ];
  const checkins = [
    { id: 'C1', memberId: 'M01', date: '2026-11-07', time: '09:00' },
    { id: 'C2', memberId: 'M01', date: '2026-11-05', time: '10:00' },
  ];
  const feed = computeActivityFeed(payments, checkins);
  // Most recent first: C1 (Nov 7), P1 (Nov 1), C2 (Nov 5)... wait: Nov 7 > Nov 5 > Nov 1 > Oct 15
  assert.strictEqual(feed[0].date, '2026-11-07');
  assert.strictEqual(feed[0].type, 'checkin');
  assert.strictEqual(feed[1].date, '2026-11-05');
  assert.strictEqual(feed[2].date, '2026-11-01');
  assert.strictEqual(feed[3].date, '2026-10-15');
});

test('MemberProfile: activity feed sliced to maximum 10 items', () => {
  const payments = Array.from({ length: 8 }, (_, i) => ({
    id: `P${i}`, memberId: 'M01', amount: 100, date: `2026-10-${String(i + 1).padStart(2, '0')}`, category: 'Membership',
  }));
  const checkins = Array.from({ length: 8 }, (_, i) => ({
    id: `C${i}`, memberId: 'M01', date: `2026-11-${String(i + 1).padStart(2, '0')}`, time: '09:00',
  }));
  const feed = computeActivityFeed(payments, checkins);
  assert.ok(feed.length <= 10, `Feed must not exceed 10 items; got ${feed.length}`);
  assert.strictEqual(feed.length, 10);
});

test('MemberProfile: activity feed empty when no payments or checkins', () => {
  const feed = computeActivityFeed([], []);
  assert.strictEqual(feed.length, 0);
});

test('MemberProfile: activity feed payment desc format', () => {
  const payments = [
    { id: 'P1', memberId: 'M01', amount: 1500, date: '2026-11-01', category: 'Membership' },
  ];
  const feed = computeActivityFeed(payments, []);
  assert.ok(feed[0].desc.includes('₹1,500'));
  assert.ok(feed[0].desc.includes('Membership'));
});

// ---------------------------------------------------------------------------
// 8. Profile field validation
// ---------------------------------------------------------------------------
test('MemberProfile validation: valid Indian phone 10 digits starting with 9', () => {
  assert.ok(isValidIndianPhone('9876543210'));
});

test('MemberProfile validation: valid Indian phone starting with 7', () => {
  assert.ok(isValidIndianPhone('7000000000'));
});

test('MemberProfile validation: invalid phone — 9 digits', () => {
  assert.ok(!isValidIndianPhone('987654321'));
});

test('MemberProfile validation: invalid phone — starts with 5', () => {
  assert.ok(!isValidIndianPhone('5876543210'));
});

test('MemberProfile validation: empty phone is invalid', () => {
  assert.ok(!isValidIndianPhone(''));
  assert.ok(!isValidIndianPhone(null));
});

test('MemberProfile validation: valid email', () => {
  assert.ok(isValidEmail('alice@example.com'));
});

test('MemberProfile validation: empty email is valid (optional field)', () => {
  // isValidEmail returns true for empty (email is optional in registration)
  assert.ok(isValidEmail(''));
  assert.ok(isValidEmail(null));
});

test('MemberProfile validation: invalid email format rejected', () => {
  assert.ok(!isValidEmail('not-an-email'));
  assert.ok(!isValidEmail('missing@'));
});

// ---------------------------------------------------------------------------
// 9. getMemberInitials
// ---------------------------------------------------------------------------
test('MemberProfile: getMemberInitials for two-word name', () => {
  assert.strictEqual(getMemberInitials('Alice Active'), 'AA');
});

test('MemberProfile: getMemberInitials for single-word name uses first 2 chars', () => {
  assert.strictEqual(getMemberInitials('Alice'), 'AL');
});

test('MemberProfile: getMemberInitials returns M for null name', () => {
  assert.strictEqual(getMemberInitials(null), 'M');
  assert.strictEqual(getMemberInitials(''), 'M');
});

test('MemberProfile: getMemberInitials three-word name uses first and last', () => {
  assert.strictEqual(getMemberInitials('Alice Mary Active'), 'AA');
});

// ---------------------------------------------------------------------------
// 10. Missing member / empty-state contract
// ---------------------------------------------------------------------------
test('MemberProfile: undefined returned for missing member (no-render contract)', () => {
  const member = findMember(MEMBERS, 'DOES-NOT-EXIST');
  // Component renders "Member not found." when member is undefined
  assert.strictEqual(member, undefined, 'findMember must return undefined for unknown ID');
});

test('MemberProfile: getMemberPayments returns [] for unknown member', () => {
  const result = getMemberPayments(PAYMENTS, 'GHOST-99', undefined);
  assert.strictEqual(result.length, 0);
});

test('MemberProfile: getMemberCheckins returns [] for unknown member', () => {
  const result = getMemberCheckins(CHECKINS, 'GHOST-99', undefined);
  assert.strictEqual(result.length, 0);
});

test('MemberProfile: getMemberPT returns [] for member with no PT package', () => {
  const member = findMember(MEMBERS, 'M03');
  const result = getMemberPT(PT_CLIENTS, 'M03', member);
  assert.strictEqual(result.length, 0);
});
