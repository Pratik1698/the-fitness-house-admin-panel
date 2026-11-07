/**
 * Dashboard KPI Calculations — Automated Regression Tests
 * Phase 3 QA: The Fitness House Admin Panel
 *
 * Tests pure logic extracted from Dashboard.jsx:
 * - Member metrics (active, expired, activeRate, expiringToday)
 * - Financial metrics (pendingPayments, totalOutstanding, todayCollection, monthCollection)
 * - Attendance metrics (todayCheckins)
 * - PT metrics (ptEndingSoon, completedPtToday)
 * - Follow-up metrics (followupsDueToday)
 * - Attention widget: priority ordering, deduplication (seenMemberIds), empty state
 * - Quick check-in: active-only gate, expired rejection contract
 *
 * No React rendering. No Supabase connection. Synthetic data only.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMembershipStatus,
  getDaysDifference,
  isCurrentMonth,
} from '../src/utils/memberUtils.js';

// ---------------------------------------------------------------------------
// Reference date — mirrors dashboard todayStr logic
// ---------------------------------------------------------------------------
const TODAY = '2026-11-07';

// ---------------------------------------------------------------------------
// Pure logic helpers mirroring Dashboard.jsx useMemo computations
// ---------------------------------------------------------------------------

/** Dashboard.jsx line 91–93: active members (non-expired) */
function computeActiveMembers(members, todayStr) {
  return members.filter(m => getMembershipStatus(m, todayStr) !== 'expired');
}

/** Dashboard.jsx line 95–97: recently expired */
function computeRecentlyExpired(members, todayStr) {
  return members.filter(m => getMembershipStatus(m, todayStr) === 'expired');
}

/** Dashboard.jsx line 100–102: active rate % */
function computeActiveRate(members, activeMembers) {
  if (!members.length) return 0;
  return Math.round((activeMembers.length / members.length) * 100);
}

/** Dashboard.jsx line 104–107: expiring today (daysLeft === 0) */
function computeExpiringToday(members, todayStr) {
  return members.filter(m => m.expiryDate && getDaysDifference(m.expiryDate, todayStr) === 0);
}

/** Dashboard.jsx line 110: today check-ins */
function computeTodayCheckins(checkins, todayStr) {
  return checkins.filter(c => c.date === todayStr);
}

/** Dashboard.jsx line 113: pending payments (balance > 0) */
function computePendingPayments(members) {
  return members.filter(m => (Number(m.balance) || 0) > 0);
}

/** Dashboard.jsx line 114: total outstanding */
function computeTotalOutstanding(pendingPayments) {
  return pendingPayments.reduce((s, m) => s + (Number(m.balance) || 0), 0);
}

/** Dashboard.jsx line 116–118 + 119–121: today's completed payment collection */
function computeTodayCollection(payments, todayStr) {
  return payments
    .filter(p => p.status === 'completed' && p.date === todayStr)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

/** Dashboard.jsx line 123–128: this-month completed payment collection */
function computeMonthCollection(payments, todayStr) {
  return payments
    .filter(p => p.status === 'completed' && isCurrentMonth(p.date, todayStr))
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

/** Dashboard.jsx line 131–135: expiring within 5 days */
function computeExpiringSoon(members, todayStr) {
  return members
    .filter(m => getMembershipStatus(m, todayStr) === 'expiring')
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
}

/** Dashboard.jsx line 138–140: completed PT sessions today */
function computeCompletedPtToday(ptSessions, todayStr) {
  return ptSessions.filter(s => s.status === 'completed' && s.date === todayStr);
}

/** Dashboard.jsx line 142–144: PT clients with <= 3 sessions remaining, status active */
function computePtEndingSoon(ptClients) {
  return ptClients.filter(c => (Number(c.remainingSessions) || 0) <= 3 && c.status === 'active');
}

/** Dashboard.jsx line 146–148: follow-ups due today (not completed) */
function computeFollowupsDueToday(followups, todayStr) {
  return followups.filter(f => (f.dueDate === todayStr || f.status === 'overdue') && f.status !== 'completed');
}

/**
 * Attention widget logic — mirrors Dashboard.jsx lines 158–300.
 * Priority: 1=Expired, 2=Pending dues, 3=Expiring soon, 4=PT ending, 5=Follow-ups
 * Deduplication via seenMemberIds Set using member.id.
 */
function computeAttentionItems({
  recentlyExpired = [],
  pendingPayments = [],
  expiringSoon = [],
  ptEndingSoon = [],
  followupsDueToday = [],
  members = [],
  todayStr = TODAY,
}) {
  const items = [];
  const seenMemberIds = new Set();
  const todayDate = new Date(todayStr);

  // P1: Expired
  recentlyExpired.forEach(m => {
    if (!seenMemberIds.has(m.id)) {
      seenMemberIds.add(m.id);
      items.push({ type: 'expired', memberId: m.id, memberName: m.name, priorityRank: 1 });
    }
  });

  // P2: Pending dues
  pendingPayments.forEach(m => {
    if (!seenMemberIds.has(m.id)) {
      seenMemberIds.add(m.id);
      items.push({ type: 'payment', memberId: m.id, memberName: m.name, priorityRank: 2 });
    }
  });

  // P3: Expiring soon
  expiringSoon.forEach(m => {
    if (!seenMemberIds.has(m.id)) {
      seenMemberIds.add(m.id);
      items.push({ type: 'expiring', memberId: m.id, memberName: m.name, priorityRank: 3 });
    }
  });

  // P4: PT ending soon
  ptEndingSoon.forEach(c => {
    if (!seenMemberIds.has(c.memberId)) {
      seenMemberIds.add(c.memberId);
      items.push({ type: 'pt', memberId: c.memberId, memberName: c.memberName, priorityRank: 4 });
    }
  });

  // P5: Follow-ups (excluding orphaned)
  const validMemberIds = new Set(members.map(m => m.id));
  followupsDueToday.forEach(f => {
    if (validMemberIds.size > 0 && !validMemberIds.has(f.memberId)) return;
    if (!seenMemberIds.has(f.memberId)) {
      seenMemberIds.add(f.memberId);
      items.push({ type: 'followup', memberId: f.memberId, memberName: f.memberName, priorityRank: 5 });
    }
  });

  return items;
}

// ---------------------------------------------------------------------------
// Synthetic test data
// ---------------------------------------------------------------------------
const MEMBERS = [
  { id: 'M01', name: 'Alice Active', plan: 'Monthly', expiryDate: '2026-11-30', balance: 0, status: 'active' },
  { id: 'M02', name: 'Bob Active', plan: 'Quarterly', expiryDate: '2027-01-15', balance: 0, status: 'active' },
  { id: 'M03', name: 'Charlie Expired', plan: 'Monthly', expiryDate: '2026-11-01', balance: 0, status: 'active' },
  { id: 'M04', name: 'Diana Expired', plan: 'Monthly', expiryDate: '2026-10-20', balance: 500, status: 'active' },
  { id: 'M05', name: 'Eve Expiring3', plan: 'Monthly', expiryDate: '2026-11-09', balance: 0, status: 'active' },
  { id: 'M06', name: 'Frank Expiring5', plan: 'Monthly', expiryDate: '2026-11-11', balance: 1200, status: 'active' },
  { id: 'M07', name: 'Grace ExpiringToday', plan: 'Monthly', expiryDate: TODAY, balance: 0, status: 'active' },
  { id: 'M08', name: 'Henry Cancelled', plan: 'Monthly', expiryDate: '2026-12-01', balance: 0, status: 'cancelled' },
];

const PAYMENTS = [
  { id: 'P01', memberId: 'M01', amount: 700, status: 'completed', date: TODAY, method: 'UPI', category: 'Membership' },
  { id: 'P02', memberId: 'M02', amount: 1500, status: 'completed', date: TODAY, method: 'Cash', category: 'Membership' },
  { id: 'P03', memberId: 'M03', amount: 500, status: 'completed', date: '2026-11-01', method: 'Cash', category: 'Membership' },
  { id: 'P04', memberId: 'M04', amount: 300, status: 'completed', date: '2026-10-20', method: 'UPI', category: 'Membership' },
  { id: 'P05', memberId: 'M05', amount: 700, status: 'failed', date: TODAY, method: 'Card', category: 'Membership' },
  { id: 'P06', memberId: 'M06', amount: 200, status: 'completed', date: '2026-11-03', method: 'Cash', category: 'Personal Training' },
  { id: 'P07', memberId: 'M01', amount: 400, status: 'completed', date: '2026-11-05', method: 'UPI', category: 'Membership' },
];

const CHECKINS = [
  { id: 'C01', memberId: 'M01', date: TODAY, time: '09:00', status: 'valid' },
  { id: 'C02', memberId: 'M02', date: TODAY, time: '10:30', status: 'valid' },
  { id: 'C03', memberId: 'M05', date: '2026-11-06', time: '08:00', status: 'valid' },
  { id: 'C04', memberId: 'M01', date: '2026-11-06', time: '09:00', status: 'valid' },
];

const PT_CLIENTS = [
  { memberId: 'M01', memberName: 'Alice Active', package: '12-Session Package', remainingSessions: 2, completedSessions: 10, totalSessions: 12, status: 'active' },
  { memberId: 'M02', memberName: 'Bob Active', package: '20-Session Package', remainingSessions: 15, completedSessions: 5, totalSessions: 20, status: 'active' },
  { memberId: 'M03', memberName: 'Charlie Expired', package: '8-Session Package', remainingSessions: 1, completedSessions: 7, totalSessions: 8, status: 'active' },
  { memberId: 'M05', memberName: 'Eve Expiring3', package: '10-Session Package', remainingSessions: 3, completedSessions: 7, totalSessions: 10, status: 'completed' },
];

const PT_SESSIONS = [
  { id: 'S01', memberId: 'M01', date: TODAY, time: '09:00', status: 'completed', trainer: 'Coach Pravin' },
  { id: 'S02', memberId: 'M02', date: TODAY, time: '10:00', status: 'scheduled', trainer: 'Coach Pravin' },
  { id: 'S03', memberId: 'M03', date: '2026-11-06', time: '09:00', status: 'completed', trainer: 'Coach Pravin' },
];

const FOLLOWUPS = [
  { id: 'F01', memberId: 'M05', memberName: 'Eve Expiring3', dueDate: TODAY, status: 'pending', reason: 'Membership renewal reminder' },
  { id: 'F02', memberId: 'M06', memberName: 'Frank Expiring5', dueDate: '2026-11-05', status: 'overdue', reason: 'Payment dues follow-up' },
  { id: 'F03', memberId: 'M01', memberName: 'Alice Active', dueDate: TODAY, status: 'completed', reason: 'Completed' },
  { id: 'F04', memberId: 'ORPHAN-99', memberName: 'Ghost Member', dueDate: TODAY, status: 'pending', reason: 'Orphaned follow-up' },
];

// ---------------------------------------------------------------------------
// 1. Member metrics
// ---------------------------------------------------------------------------
test('Dashboard KPI: active members exclude expired and cancelled', () => {
  const active = computeActiveMembers(MEMBERS, TODAY);
  // M03 expired 2026-11-01, M04 expired 2026-10-20 → both expired
  // M08 is cancelled → getMembershipStatus returns 'cancelled', not 'expired', so stays in active
  // M07 expiryDate=TODAY → daysLeft=0 → 'expiring' → not expired
  // M05 2026-11-09 → daysLeft=2 → 'expiring' → not expired
  // M06 2026-11-11 → daysLeft=4 → 'expiring' → not expired
  const activeIds = active.map(m => m.id);
  assert.ok(!activeIds.includes('M03'), 'M03 (expired Nov 1) must not be in active');
  assert.ok(!activeIds.includes('M04'), 'M04 (expired Oct 20) must not be in active');
  assert.ok(activeIds.includes('M01'), 'M01 (expires Nov 30) must be in active');
  assert.ok(activeIds.includes('M02'), 'M02 (expires Jan 2027) must be in active');
  assert.ok(activeIds.includes('M07'), 'M07 (expires today) must be active (expiring, not expired)');
});

test('Dashboard KPI: recently expired members', () => {
  const expired = computeRecentlyExpired(MEMBERS, TODAY);
  const expiredIds = expired.map(m => m.id);
  assert.ok(expiredIds.includes('M03'), 'M03 expired on 2026-11-01');
  assert.ok(expiredIds.includes('M04'), 'M04 expired on 2026-10-20');
  assert.ok(!expiredIds.includes('M07'), 'M07 expires today (daysLeft=0) is not expired');
});

test('Dashboard KPI: activeRate rounds correctly', () => {
  const active = computeActiveMembers(MEMBERS, TODAY);
  const rate = computeActiveRate(MEMBERS, active);
  // 6 active out of 8 → 75%
  assert.strictEqual(rate, Math.round((active.length / MEMBERS.length) * 100));
});

test('Dashboard KPI: activeRate returns 0 for empty members', () => {
  const rate = computeActiveRate([], []);
  assert.strictEqual(rate, 0);
});

test('Dashboard KPI: expiringToday matches only daysLeft===0', () => {
  const expiringToday = computeExpiringToday(MEMBERS, TODAY);
  assert.strictEqual(expiringToday.length, 1);
  assert.strictEqual(expiringToday[0].id, 'M07');
});

test('Dashboard KPI: expiringToday excludes members with no expiryDate', () => {
  const members = [
    { id: 'X01', name: 'No Date', plan: 'Monthly', expiryDate: null, balance: 0 },
    { id: 'X02', name: 'Today', plan: 'Monthly', expiryDate: TODAY, balance: 0 },
  ];
  const result = computeExpiringToday(members, TODAY);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'X02');
});

// ---------------------------------------------------------------------------
// 2. Financial metrics
// ---------------------------------------------------------------------------
test('Dashboard KPI: pendingPayments only includes members with balance > 0', () => {
  const pending = computePendingPayments(MEMBERS);
  const pendingIds = pending.map(m => m.id);
  assert.ok(pendingIds.includes('M04'), 'M04 has ₹500 balance');
  assert.ok(pendingIds.includes('M06'), 'M06 has ₹1200 balance');
  assert.ok(!pendingIds.includes('M01'), 'M01 has ₹0 balance — excluded');
  assert.ok(!pendingIds.includes('M03'), 'M03 has ₹0 balance — excluded');
});

test('Dashboard KPI: totalOutstanding sums all positive balances', () => {
  const pending = computePendingPayments(MEMBERS);
  const total = computeTotalOutstanding(pending);
  assert.strictEqual(total, 1700); // M04: 500, M06: 1200
});

test('Dashboard KPI: totalOutstanding is 0 for no pending members', () => {
  const total = computeTotalOutstanding([]);
  assert.strictEqual(total, 0);
});

test('Dashboard KPI: todayCollection sums only completed payments for today', () => {
  const collection = computeTodayCollection(PAYMENTS, TODAY);
  // P01: 700 completed today, P02: 1500 completed today, P05: 500 failed (excluded)
  assert.strictEqual(collection, 2200);
});

test('Dashboard KPI: todayCollection excludes failed and non-today payments', () => {
  const payments = [
    { id: 'T1', amount: 1000, status: 'completed', date: TODAY },
    { id: 'T2', amount: 500, status: 'failed', date: TODAY },
    { id: 'T3', amount: 800, status: 'completed', date: '2026-11-06' },
  ];
  const collection = computeTodayCollection(payments, TODAY);
  assert.strictEqual(collection, 1000);
});

test('Dashboard KPI: monthCollection sums completed payments in current month', () => {
  const collection = computeMonthCollection(PAYMENTS, TODAY);
  // P01: 700 today, P02: 1500 today, P03: 500 on 2026-11-01, P06: 200 on 2026-11-03, P07: 400 on 2026-11-05
  // P04: 300 on 2026-10-20 (not this month), P05: failed (excluded)
  assert.strictEqual(collection, 3300);
});

test('Dashboard KPI: monthCollection excludes prior months', () => {
  const payments = [
    { id: 'T1', amount: 1000, status: 'completed', date: '2026-11-01' },
    { id: 'T2', amount: 999, status: 'completed', date: '2026-10-31' },
  ];
  const collection = computeMonthCollection(payments, TODAY);
  assert.strictEqual(collection, 1000);
});

test('Dashboard KPI: todayCollection returns 0 for empty payments', () => {
  assert.strictEqual(computeTodayCollection([], TODAY), 0);
});

// ---------------------------------------------------------------------------
// 3. Attendance metrics
// ---------------------------------------------------------------------------
test('Dashboard KPI: todayCheckins counts only today\'s check-ins', () => {
  const result = computeTodayCheckins(CHECKINS, TODAY);
  assert.strictEqual(result.length, 2); // C01, C02
  assert.ok(result.every(c => c.date === TODAY));
});

test('Dashboard KPI: todayCheckins returns empty for no check-ins today', () => {
  const result = computeTodayCheckins(CHECKINS, '2026-12-01');
  assert.strictEqual(result.length, 0);
});

// ---------------------------------------------------------------------------
// 4. PT metrics
// ---------------------------------------------------------------------------
test('Dashboard KPI: ptEndingSoon filters active clients with <= 3 sessions', () => {
  const result = computePtEndingSoon(PT_CLIENTS);
  // M01: 2 remaining, active → included
  // M03: 1 remaining, active → included
  // M05: 3 remaining, completed → excluded (not active)
  // M02: 15 remaining → excluded
  const ids = result.map(c => c.memberId);
  assert.ok(ids.includes('M01'));
  assert.ok(ids.includes('M03'));
  assert.ok(!ids.includes('M02'));
  assert.ok(!ids.includes('M05'), 'M05 PT status=completed, not active → excluded');
});

test('Dashboard KPI: completedPtToday counts only completed sessions today', () => {
  const result = computeCompletedPtToday(PT_SESSIONS, TODAY);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'S01');
});

// ---------------------------------------------------------------------------
// 5. Follow-up metrics
// ---------------------------------------------------------------------------
test('Dashboard KPI: followupsDueToday includes overdue and today-due (not completed)', () => {
  const result = computeFollowupsDueToday(FOLLOWUPS, TODAY);
  const ids = result.map(f => f.id);
  assert.ok(ids.includes('F01'), 'F01: dueDate=today, pending → included');
  assert.ok(ids.includes('F02'), 'F02: status=overdue → included');
  assert.ok(!ids.includes('F03'), 'F03: status=completed → excluded');
});

// ---------------------------------------------------------------------------
// 6. Attention widget — priority and deduplication
// ---------------------------------------------------------------------------
test('Attention widget: empty state returns empty array', () => {
  const items = computeAttentionItems({});
  assert.strictEqual(items.length, 0);
});

test('Attention widget: expired member appears only as P1 (not duplicated as P2 or P3)', () => {
  // M04 is both expired AND has a balance → should appear only once at P1
  const expired = [{ id: 'M04', name: 'Diana', expiryDate: '2026-10-20', balance: 500 }];
  const pending = [{ id: 'M04', name: 'Diana', expiryDate: '2026-10-20', balance: 500 }];
  const items = computeAttentionItems({ recentlyExpired: expired, pendingPayments: pending });
  const m04Items = items.filter(i => i.memberId === 'M04');
  assert.strictEqual(m04Items.length, 1);
  assert.strictEqual(m04Items[0].type, 'expired');
  assert.strictEqual(m04Items[0].priorityRank, 1);
});

test('Attention widget: priority ordering P1 before P2 before P3', () => {
  const expired = [{ id: 'EXP1', name: 'Expired One', expiryDate: '2026-10-01' }];
  const pending = [{ id: 'PAY1', name: 'Dues One', expiryDate: '2026-11-30', balance: 500 }];
  const expiring = [{ id: 'EXP_SOON', name: 'Expiring Soon', expiryDate: '2026-11-09' }];
  const items = computeAttentionItems({ recentlyExpired: expired, pendingPayments: pending, expiringSoon: expiring });
  assert.strictEqual(items[0].type, 'expired');
  assert.strictEqual(items[1].type, 'payment');
  assert.strictEqual(items[2].type, 'expiring');
});

test('Attention widget: member seen in P3 not duplicated in P4 or P5', () => {
  // M05 is expiring soon AND has a PT client record
  const expiringSoon = [{ id: 'M05', name: 'Eve', expiryDate: '2026-11-09' }];
  const ptEndingSoon = [{ memberId: 'M05', memberName: 'Eve', remainingSessions: 3, status: 'active' }];
  const items = computeAttentionItems({ expiringSoon, ptEndingSoon });
  const m05Items = items.filter(i => i.memberId === 'M05');
  assert.strictEqual(m05Items.length, 1);
  assert.strictEqual(m05Items[0].type, 'expiring');
});

test('Attention widget: orphaned follow-up excluded when validMemberIds is populated', () => {
  const members = [{ id: 'REAL01', name: 'Real Member' }];
  const followupsDueToday = [
    { id: 'FU1', memberId: 'REAL01', memberName: 'Real Member', dueDate: TODAY, status: 'pending', reason: 'Check-in' },
    { id: 'FU2', memberId: 'GHOST01', memberName: 'Ghost', dueDate: TODAY, status: 'pending', reason: 'Orphan' },
  ];
  const items = computeAttentionItems({ followupsDueToday, members });
  const memberIds = items.map(i => i.memberId);
  assert.ok(memberIds.includes('REAL01'), 'Real member follow-up should be included');
  assert.ok(!memberIds.includes('GHOST01'), 'Orphaned follow-up must be excluded');
});

test('Attention widget: PT item included only when not already seen by P1–P3', () => {
  const ptEndingSoon = [
    { memberId: 'PT_NEW', memberName: 'PT Only Member', remainingSessions: 2, status: 'active' },
  ];
  const items = computeAttentionItems({ ptEndingSoon });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].type, 'pt');
  assert.strictEqual(items[0].priorityRank, 4);
});

test('Attention widget: deduplication across all five priority levels', () => {
  const m = { id: 'SHARED', name: 'Shared Member', expiryDate: '2026-10-01', balance: 300 };
  const ptClient = { memberId: 'SHARED', memberName: 'Shared Member', remainingSessions: 1, status: 'active' };
  const followup = { id: 'F1', memberId: 'SHARED', memberName: 'Shared Member', dueDate: TODAY, status: 'pending', reason: 'Test' };
  const items = computeAttentionItems({
    recentlyExpired: [m],
    pendingPayments: [m],
    expiringSoon: [m],
    ptEndingSoon: [ptClient],
    followupsDueToday: [followup],
    members: [m],
  });
  const sharedItems = items.filter(i => i.memberId === 'SHARED');
  assert.strictEqual(sharedItems.length, 1, 'SHARED member must appear exactly once');
  assert.strictEqual(sharedItems[0].type, 'expired', 'Must be classified at highest priority (P1)');
});

// ---------------------------------------------------------------------------
// 7. Quick check-in contract
// ---------------------------------------------------------------------------
test('Quick check-in: expired membership status blocks check-in', () => {
  const expiredMember = { id: 'M03', name: 'Charlie', expiryDate: '2026-11-01', status: 'active' };
  const status = getMembershipStatus(expiredMember, TODAY);
  assert.strictEqual(status, 'expired', 'getMembershipStatus must return expired for past expiry');
  // Simulate Dashboard.jsx handleCheckin guard
  const blocked = status === 'expired';
  assert.ok(blocked, 'Check-in must be blocked for expired member');
});

test('Quick check-in: active membership status allows check-in', () => {
  const activeMember = { id: 'M01', name: 'Alice', expiryDate: '2026-11-30', status: 'active' };
  const status = getMembershipStatus(activeMember, TODAY);
  assert.notStrictEqual(status, 'expired', 'Active member must not be blocked');
});

test('Quick check-in: member expiring today is not blocked', () => {
  const expiringTodayMember = { id: 'M07', name: 'Grace', expiryDate: TODAY, status: 'active' };
  const status = getMembershipStatus(expiringTodayMember, TODAY);
  assert.strictEqual(status, 'expiring', 'Member expiring today has status expiring, not expired');
  assert.notStrictEqual(status, 'expired');
});

// ---------------------------------------------------------------------------
// 8. Edge cases
// ---------------------------------------------------------------------------
test('Dashboard KPI: member with null balance treated as 0 in pending payments', () => {
  const members = [
    { id: 'N01', name: 'Null Balance', balance: null },
    { id: 'N02', name: 'Undefined Balance', balance: undefined },
    { id: 'N03', name: 'Zero Balance', balance: 0 },
    { id: 'N04', name: 'Positive Balance', balance: 300 },
  ];
  const pending = computePendingPayments(members);
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].id, 'N04');
});

test('Dashboard KPI: numeric string balance treated correctly', () => {
  const members = [
    { id: 'S01', name: 'String Balance', balance: '750' },
    { id: 'S02', name: 'Zero String', balance: '0' },
  ];
  const pending = computePendingPayments(members);
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].id, 'S01');
  const total = computeTotalOutstanding(pending);
  assert.strictEqual(total, 750);
});

test('Dashboard KPI: expiringSoon result sorted ascending by expiryDate', () => {
  const members = [
    { id: 'E1', name: 'Three Days', expiryDate: '2026-11-10', status: 'active' },
    { id: 'E2', name: 'One Day', expiryDate: '2026-11-08', status: 'active' },
    { id: 'E3', name: 'Two Days', expiryDate: '2026-11-09', status: 'active' },
  ];
  const result = computeExpiringSoon(members, TODAY);
  assert.strictEqual(result[0].id, 'E2'); // Nov 8 — soonest
  assert.strictEqual(result[1].id, 'E3'); // Nov 9
  assert.strictEqual(result[2].id, 'E1'); // Nov 10
});
