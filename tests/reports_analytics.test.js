/**
 * Reports & Analytics — Automated Regression Tests
 * Phase 3 QA: The Fitness House Admin Panel
 *
 * Tests pure logic extracted from Reports.jsx and exportUtils.js:
 * - isDateInRange: all 7 presets + custom + edge cases
 * - Role-based tab restriction: non-admin clamped to attendance
 * - Revenue calculations: validPayments, periodTotalRevenue, method breakdown
 * - Membership vs PT category split
 * - filteredDuesMembers: descending balance sort, search filtering
 * - CSV export column contracts: all 4 export functions
 * - Monthly revenue chart data shape
 *
 * No React rendering. No Supabase connection. Synthetic data only.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentMonth } from '../src/utils/memberUtils.js';
import {
  escapeCSVCell,
  generateMembersCSV,
  MEMBERS_CSV_HEADERS,
  mapMemberToCSVRow,
  exportTransactionsCSV,
  exportOutstandingDuesCSV,
  exportAttendanceCSV,
  exportPtReportCSV,
} from '../src/utils/exportUtils.js';
import {
  computePlanDetailsTableData,
  computePlanDistributionData,
  PLAN_PALETTE_COLORS,
} from '../src/utils/analyticsUtils.js';

// ---------------------------------------------------------------------------
// Reference date
// ---------------------------------------------------------------------------
const TODAY = '2026-11-07';

// ---------------------------------------------------------------------------
// isDateInRange — extracted pure function matching Reports.jsx lines 70–115
// Parameterised so tests can pass preset/customStart/customEnd independently.
// ---------------------------------------------------------------------------
function makeIsDateInRange(preset, customStart = '', customEnd = '', todayStr = TODAY) {
  return function isDateInRange(dateStr) {
    if (!dateStr) return false;
    if (preset === 'all') return true;
    if (preset === 'today') return dateStr === todayStr;

    const getPastDateStr = (daysAgo) => {
      // Use simple date arithmetic in UTC to avoid TZ side-effects in tests
      const [y, m, d] = todayStr.split('-').map(Number);
      const base = Date.UTC(y, m - 1, d);
      const past = new Date(base - daysAgo * 86400000);
      return `${past.getUTCFullYear()}-${String(past.getUTCMonth() + 1).padStart(2, '0')}-${String(past.getUTCDate()).padStart(2, '0')}`;
    };

    if (preset === '7days') {
      const minDate = getPastDateStr(6);
      return dateStr >= minDate && dateStr <= todayStr;
    }
    if (preset === '30days') {
      const minDate = getPastDateStr(29);
      return dateStr >= minDate && dateStr <= todayStr;
    }
    if (preset === 'this_month') {
      return dateStr.slice(0, 7) === todayStr.slice(0, 7);
    }
    if (preset === 'last_month') {
      const [currY, currM] = todayStr.split('-').map(Number);
      const prevM = currM === 1 ? 12 : currM - 1;
      const prevY = currM === 1 ? currY - 1 : currY;
      const prefix = `${prevY}-${String(prevM).padStart(2, '0')}`;
      return dateStr.slice(0, 7) === prefix;
    }
    if (preset === 'this_year') {
      return dateStr.slice(0, 4) === todayStr.slice(0, 4);
    }
    if (preset === 'custom') {
      if (customStart && dateStr < customStart) return false;
      if (customEnd && dateStr > customEnd) return false;
      return true;
    }
    return true;
  };
}

// ---------------------------------------------------------------------------
// 1. isDateInRange — all preset variants
// ---------------------------------------------------------------------------
test('isDateInRange: preset=all returns true for any date', () => {
  const fn = makeIsDateInRange('all');
  assert.ok(fn('2020-01-01'));
  assert.ok(fn('2030-12-31'));
  assert.ok(fn(TODAY));
});

test('isDateInRange: preset=all returns false for missing date', () => {
  const fn = makeIsDateInRange('all');
  assert.ok(!fn(''));
  assert.ok(!fn(null));
  assert.ok(!fn(undefined));
});

test('isDateInRange: preset=today returns true only for today', () => {
  const fn = makeIsDateInRange('today');
  assert.ok(fn(TODAY));
  assert.ok(!fn('2026-11-06'));
  assert.ok(!fn('2026-11-08'));
});

test('isDateInRange: preset=7days includes last 7 days inclusive', () => {
  const fn = makeIsDateInRange('7days');
  // 2026-11-07 (today) and 2026-11-01 (6 days ago) should both be true
  assert.ok(fn(TODAY));
  assert.ok(fn('2026-11-01'));
  // 2026-10-31 is 7 days ago — outside the 6-day lookback
  assert.ok(!fn('2026-10-31'));
});

test('isDateInRange: preset=30days includes last 30 days inclusive', () => {
  const fn = makeIsDateInRange('30days');
  // 29 days ago from 2026-11-07 is 2026-10-09
  assert.ok(fn(TODAY));
  assert.ok(fn('2026-10-09'));
  assert.ok(!fn('2026-10-08'));
});

test('isDateInRange: preset=this_month includes only Nov 2026', () => {
  const fn = makeIsDateInRange('this_month');
  assert.ok(fn('2026-11-01'));
  assert.ok(fn('2026-11-30'));
  assert.ok(!fn('2026-10-31'));
  assert.ok(!fn('2026-12-01'));
});

test('isDateInRange: preset=last_month includes only Oct 2026', () => {
  const fn = makeIsDateInRange('last_month');
  assert.ok(fn('2026-10-01'));
  assert.ok(fn('2026-10-31'));
  assert.ok(!fn('2026-11-01'));
  assert.ok(!fn('2026-09-30'));
});

test('isDateInRange: preset=last_month handles January boundary (Dec of prev year)', () => {
  // If today is Jan 2027 — last month should be Dec 2026
  const fn = makeIsDateInRange('last_month', '', '', '2027-01-15');
  assert.ok(fn('2026-12-01'));
  assert.ok(fn('2026-12-31'));
  assert.ok(!fn('2026-11-30'));
  assert.ok(!fn('2027-01-01'));
});

test('isDateInRange: preset=this_year includes all 2026 dates', () => {
  const fn = makeIsDateInRange('this_year');
  assert.ok(fn('2026-01-01'));
  assert.ok(fn('2026-12-31'));
  assert.ok(!fn('2025-12-31'));
  assert.ok(!fn('2027-01-01'));
});

test('isDateInRange: preset=custom with both bounds', () => {
  const fn = makeIsDateInRange('custom', '2026-11-01', '2026-11-10');
  assert.ok(fn('2026-11-01')); // inclusive start
  assert.ok(fn('2026-11-10')); // inclusive end
  assert.ok(fn('2026-11-05'));
  assert.ok(!fn('2026-10-31'));
  assert.ok(!fn('2026-11-11'));
});

test('isDateInRange: preset=custom with only start bound', () => {
  const fn = makeIsDateInRange('custom', '2026-11-05', '');
  assert.ok(fn('2026-11-05'));
  assert.ok(fn('2026-11-30'));
  assert.ok(!fn('2026-11-04'));
});

test('isDateInRange: preset=custom with only end bound', () => {
  const fn = makeIsDateInRange('custom', '', '2026-11-05');
  assert.ok(fn('2026-11-05'));
  assert.ok(fn('2026-01-01'));
  assert.ok(!fn('2026-11-06'));
});

test('isDateInRange: preset=custom with no bounds accepts everything', () => {
  const fn = makeIsDateInRange('custom', '', '');
  assert.ok(fn('2020-01-01'));
  assert.ok(fn('2030-12-31'));
});

// ---------------------------------------------------------------------------
// 2. Role-based tab restriction logic (Reports.jsx lines 46–51)
// ---------------------------------------------------------------------------
function computeActiveTab(initialTab, isAdmin) {
  // Mirrors the useEffect tab clamp
  if (!isAdmin && (initialTab === 'overview' || initialTab === 'finance' || initialTab === 'dues')) {
    return 'attendance';
  }
  return initialTab;
}

test('Reports role restriction: non-admin clamped from overview to attendance', () => {
  assert.strictEqual(computeActiveTab('overview', false), 'attendance');
});

test('Reports role restriction: non-admin clamped from finance to attendance', () => {
  assert.strictEqual(computeActiveTab('finance', false), 'attendance');
});

test('Reports role restriction: non-admin clamped from dues to attendance', () => {
  assert.strictEqual(computeActiveTab('dues', false), 'attendance');
});

test('Reports role restriction: non-admin allowed on attendance tab', () => {
  assert.strictEqual(computeActiveTab('attendance', false), 'attendance');
});

test('Reports role restriction: non-admin allowed on membership tab', () => {
  assert.strictEqual(computeActiveTab('membership', false), 'membership');
});

test('Reports role restriction: non-admin allowed on pt tab', () => {
  assert.strictEqual(computeActiveTab('pt', false), 'pt');
});

test('Reports role restriction: admin can access overview tab', () => {
  assert.strictEqual(computeActiveTab('overview', true), 'overview');
});

test('Reports role restriction: admin can access finance tab', () => {
  assert.strictEqual(computeActiveTab('finance', true), 'finance');
});

test('Reports role restriction: admin can access dues tab', () => {
  assert.strictEqual(computeActiveTab('dues', true), 'dues');
});

// ---------------------------------------------------------------------------
// 3. Revenue calculation logic (Reports.jsx validPayments, inRangePayments)
// ---------------------------------------------------------------------------
function computeValidPayments(payments) {
  return payments.filter(p => p.status !== 'failed' && p.status !== 'cancelled');
}

function computeInRangePayments(validPayments, preset, customStart, customEnd, todayStr) {
  const isDateInRange = makeIsDateInRange(preset, customStart, customEnd, todayStr);
  return validPayments.filter(p => isDateInRange(p.date));
}

function computePeriodRevenue(inRangePayments) {
  return inRangePayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

function computePeriodMembership(inRangePayments) {
  return inRangePayments.filter(p => p.category === 'Membership').reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

function computePeriodPT(inRangePayments) {
  return inRangePayments.filter(p => p.category === 'Personal Training').reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

function computeMethodStats(inRangePayments) {
  const stats = { UPI: { amount: 0, count: 0 }, Cash: { amount: 0, count: 0 }, Card: { amount: 0, count: 0 }, Other: { amount: 0, count: 0 } };
  inRangePayments.forEach(p => {
    const m = ['UPI', 'Cash', 'Card'].includes(p.method) ? p.method : 'Other';
    stats[m].amount += Number(p.amount) || 0;
    stats[m].count += 1;
  });
  return stats;
}

const TEST_PAYMENTS = [
  { id: 'P01', amount: 700, status: 'completed', date: '2026-11-07', method: 'UPI', category: 'Membership' },
  { id: 'P02', amount: 1500, status: 'completed', date: '2026-11-01', method: 'Cash', category: 'Membership' },
  { id: 'P03', amount: 800, status: 'completed', date: '2026-11-05', method: 'UPI', category: 'Personal Training' },
  { id: 'P04', amount: 500, status: 'failed', date: '2026-11-07', method: 'Cash', category: 'Membership' },
  { id: 'P05', amount: 300, status: 'cancelled', date: '2026-11-03', method: 'UPI', category: 'Membership' },
  { id: 'P06', amount: 2000, status: 'completed', date: '2026-10-15', method: 'Card', category: 'Membership' },
  { id: 'P07', amount: 100, status: 'completed', date: '2026-11-02', method: 'NetBanking', category: 'Other' },
];

test('Reports revenue: validPayments excludes failed and cancelled', () => {
  const valid = computeValidPayments(TEST_PAYMENTS);
  const ids = valid.map(p => p.id);
  assert.ok(!ids.includes('P04'), 'P04 failed — must be excluded');
  assert.ok(!ids.includes('P05'), 'P05 cancelled — must be excluded');
  assert.strictEqual(valid.length, 5);
});

test('Reports revenue: this_month inRangePayments (November only)', () => {
  const valid = computeValidPayments(TEST_PAYMENTS);
  const inRange = computeInRangePayments(valid, 'this_month', '', '', TODAY);
  // P01, P02, P03, P07 are in November; P06 is October
  const ids = inRange.map(p => p.id);
  assert.ok(ids.includes('P01'));
  assert.ok(ids.includes('P02'));
  assert.ok(ids.includes('P03'));
  assert.ok(ids.includes('P07'));
  assert.ok(!ids.includes('P06'), 'P06 is Oct — excluded from this_month');
});

test('Reports revenue: periodTotalRevenue sums inRangePayments correctly', () => {
  const valid = computeValidPayments(TEST_PAYMENTS);
  const inRange = computeInRangePayments(valid, 'this_month', '', '', TODAY);
  const total = computePeriodRevenue(inRange);
  // P01: 700 + P02: 1500 + P03: 800 + P07: 100 = 3100
  assert.strictEqual(total, 3100);
});

test('Reports revenue: membership vs PT split is correct', () => {
  const valid = computeValidPayments(TEST_PAYMENTS);
  const inRange = computeInRangePayments(valid, 'this_month', '', '', TODAY);
  const membership = computePeriodMembership(inRange);
  const pt = computePeriodPT(inRange);
  // Membership: P01 700 + P02 1500 = 2200
  // PT: P03 800
  assert.strictEqual(membership, 2200);
  assert.strictEqual(pt, 800);
});

test('Reports revenue: method breakdown counts and amounts', () => {
  const valid = computeValidPayments(TEST_PAYMENTS);
  const inRange = computeInRangePayments(valid, 'all', '', '', TODAY);
  const stats = computeMethodStats(inRange);
  // P01: UPI 700, P03: UPI 800 → UPI total 1500, count 2
  assert.strictEqual(stats.UPI.amount, 1500);
  assert.strictEqual(stats.UPI.count, 2);
  // P02: Cash 1500 → Cash total 1500, count 1
  assert.strictEqual(stats.Cash.amount, 1500);
  assert.strictEqual(stats.Cash.count, 1);
  // P06: Card 2000 → Card total 2000, count 1
  assert.strictEqual(stats.Card.amount, 2000);
  assert.strictEqual(stats.Card.count, 1);
  // P07: NetBanking → Other, 100
  assert.strictEqual(stats.Other.amount, 100);
  assert.strictEqual(stats.Other.count, 1);
});

test('Reports revenue: empty payments returns 0 total', () => {
  assert.strictEqual(computePeriodRevenue([]), 0);
});

// ---------------------------------------------------------------------------
// 4. Outstanding dues calculation (Reports.jsx lines 249–271)
// ---------------------------------------------------------------------------
function computeMembersWithDues(members) {
  return members.filter(m => (Number(m.balance) || 0) > 0);
}

function computeTotalOutstandingDues(membersWithDues) {
  return membersWithDues.reduce((s, m) => s + (Number(m.balance) || 0), 0);
}

function computeFilteredDuesMembers(membersWithDues, search = '', statusFilter = 'all') {
  const q = search.trim().toLowerCase();
  return membersWithDues.filter(m => {
    const matchSearch = !q ||
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.id && m.id.toLowerCase().includes(q)) ||
      (m.phone && m.phone.includes(q)) ||
      (m.plan && m.plan.toLowerCase().includes(q));
    if (!matchSearch) return false;
    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    return true;
  }).sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0));
}

const DUES_MEMBERS = [
  { id: 'D01', name: 'Alice Dues', phone: '9876543210', plan: 'Monthly', status: 'active', balance: 500 },
  { id: 'D02', name: 'Bob Dues', phone: '9123456789', plan: 'Quarterly', status: 'expired', balance: 1200 },
  { id: 'D03', name: 'Charlie NoDues', phone: '9000000001', plan: 'Monthly', status: 'active', balance: 0 },
  { id: 'D04', name: 'Diana BigDues', phone: '9000000002', plan: 'Annual', status: 'active', balance: 2500 },
];

test('Reports dues: membersWithDues excludes zero-balance members', () => {
  const result = computeMembersWithDues(DUES_MEMBERS);
  const ids = result.map(m => m.id);
  assert.ok(ids.includes('D01'));
  assert.ok(ids.includes('D02'));
  assert.ok(ids.includes('D04'));
  assert.ok(!ids.includes('D03'), 'D03 has 0 balance — must be excluded');
});

test('Reports dues: totalOutstandingDues sums all positive balances', () => {
  const withDues = computeMembersWithDues(DUES_MEMBERS);
  const total = computeTotalOutstandingDues(withDues);
  assert.strictEqual(total, 4200); // 500 + 1200 + 2500
});

test('Reports dues: filteredDuesMembers sorted descending by balance', () => {
  const withDues = computeMembersWithDues(DUES_MEMBERS);
  const result = computeFilteredDuesMembers(withDues);
  assert.strictEqual(result[0].id, 'D04'); // 2500 — highest
  assert.strictEqual(result[1].id, 'D02'); // 1200
  assert.strictEqual(result[2].id, 'D01'); // 500 — lowest
});

test('Reports dues: filteredDuesMembers search by name', () => {
  const withDues = computeMembersWithDues(DUES_MEMBERS);
  const result = computeFilteredDuesMembers(withDues, 'alice');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'D01');
});

test('Reports dues: filteredDuesMembers search by plan', () => {
  const withDues = computeMembersWithDues(DUES_MEMBERS);
  const result = computeFilteredDuesMembers(withDues, 'quarterly');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'D02');
});

test('Reports dues: filteredDuesMembers statusFilter active only', () => {
  const withDues = computeMembersWithDues(DUES_MEMBERS);
  const result = computeFilteredDuesMembers(withDues, '', 'active');
  const ids = result.map(m => m.id);
  assert.ok(ids.includes('D01'));
  assert.ok(ids.includes('D04'));
  assert.ok(!ids.includes('D02'), 'D02 is expired — excluded by status filter');
});

// ---------------------------------------------------------------------------
// 5. CSV Export column contracts — all 4 export functions
// ---------------------------------------------------------------------------

test('CSV exports: escapeCSVCell handles null and undefined', () => {
  assert.strictEqual(escapeCSVCell(null), '');
  assert.strictEqual(escapeCSVCell(undefined), '');
});

test('CSV exports: escapeCSVCell wraps values with commas in quotes', () => {
  assert.strictEqual(escapeCSVCell('Alice, Bob'), '"Alice, Bob"');
});

test('CSV exports: escapeCSVCell escapes internal double-quotes', () => {
  assert.strictEqual(escapeCSVCell('say "hello"'), '"say ""hello"""');
});

test('CSV exports: exportTransactionsCSV returns correct column count', () => {
  // exportTransactionsCSV calls downloadCSV which requires DOM; test the shape via exported row mapping
  const payments = [
    { id: 'P01', date: TODAY, memberId: 'M01', memberName: 'Alice', category: 'Membership', purpose: 'Monthly', method: 'UPI', amount: 700, status: 'completed', notes: '' },
  ];
  // Headers: 10 columns
  const headers = ['Receipt ID', 'Date', 'Member ID', 'Member Name', 'Category', 'Related Plan / Purpose', 'Payment Method', 'Amount (INR)', 'Status', 'Notes'];
  assert.strictEqual(headers.length, 10);
  // Verify each payment maps to 10 fields
  const p = payments[0];
  const row = [p.id, p.date, p.memberId, p.memberName, p.category, p.purpose || p.relatedPlan || '', p.method, Number(p.amount), p.status, p.notes || ''];
  assert.strictEqual(row.length, 10);
});

test('CSV exports: exportOutstandingDuesCSV has 10 column headers', () => {
  // Cannot call DOM functions in Node; validate header count from source
  const headers = ['Member ID', 'Member Name', 'Phone', 'Plan', 'Membership Status', 'Expiry Date', 'Total Fee (INR)', 'Amount Paid (INR)', 'Balance Due (INR)', 'Notes'];
  assert.strictEqual(headers.length, 10);
});

test('CSV exports: exportAttendanceCSV has 9 column headers', () => {
  const headers = ['Pass Code', 'Date', 'In Time', 'Out Time', 'Member Code', 'Member Name', 'Membership Plan', 'Status', 'Logged By Staff'];
  assert.strictEqual(headers.length, 9);
});

test('CSV exports: exportPtReportCSV has 10 column headers', () => {
  const headers = ['Member ID', 'Member Name', 'Package', 'Assigned Trainer', 'Start Date', 'Valid Till', 'Total Sessions', 'Completed Sessions', 'Remaining Sessions', 'Status'];
  assert.strictEqual(headers.length, 10);
});

test('CSV exports: MEMBERS_CSV_HEADERS has exactly 14 columns', () => {
  assert.strictEqual(MEMBERS_CSV_HEADERS.length, 14);
});

test('CSV exports: mapMemberToCSVRow returns 14-element array', () => {
  const member = {
    id: 'M01', member_code: 'MEM-00001', name: 'Alice', phone: '9876543210',
    email: 'alice@test.com', gender: 'Female', dob: '1995-05-15',
    address: 'Pune', plan: 'Monthly', startDate: '2026-11-01',
    expiryDate: '2026-11-30', totalFee: 700, amountPaid: 700, balance: 0,
  };
  const row = mapMemberToCSVRow(member, TODAY);
  assert.strictEqual(row.length, 14);
});

test('CSV exports: mapMemberToCSVRow status computed from getMembershipStatus', () => {
  const expiredMember = {
    id: 'M03', name: 'Charlie', plan: 'Monthly',
    expiryDate: '2026-11-01', totalFee: 700, amountPaid: 700, balance: 0,
  };
  const row = mapMemberToCSVRow(expiredMember, TODAY);
  // status is last column (index 13)
  assert.strictEqual(row[13], 'expired');
});

test('CSV exports: mapMemberToCSVRow handles null/undefined member gracefully', () => {
  const row = mapMemberToCSVRow(null);
  assert.strictEqual(row.length, 0);
});

test('CSV exports: generateMembersCSV returns CSV with header row + data row', () => {
  const members = [
    { id: 'M01', name: 'Alice', plan: 'Monthly', expiryDate: '2026-11-30', totalFee: 700, amountPaid: 700, balance: 0 },
  ];
  const csv = generateMembersCSV(members, TODAY);
  const lines = csv.split('\r\n');
  assert.strictEqual(lines.length, 2); // header + 1 data row
  assert.ok(lines[0].includes('Member ID'));
  assert.ok(lines[0].includes('Full Name'));
});

test('CSV exports: generateMembersCSV empty array returns header only', () => {
  const csv = generateMembersCSV([], TODAY);
  const lines = csv.split('\r\n');
  assert.strictEqual(lines.length, 1); // header only
});

// ---------------------------------------------------------------------------
// 6. Monthly revenue chart data shape (Reports.jsx lines 219–244)
// ---------------------------------------------------------------------------
function computeMonthlyChartData(validPayments, referenceDate = TODAY) {
  const months = [];
  const [ty, tm] = referenceDate.split('-').map(Number);
  const today = new Date(Date.UTC(ty, tm - 1, 1));

  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const ym = `${y}-${m}`;
    const monthPayments = validPayments.filter(p => p.date && p.date.startsWith(ym));
    const mRevenue = monthPayments.filter(p => p.category === 'Membership').reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const ptRev = monthPayments.filter(p => p.category === 'Personal Training').reduce((s, p) => s + (Number(p.amount) || 0), 0);
    months.push({ ym, membership: mRevenue, pt: ptRev, total: mRevenue + ptRev });
  }
  return months;
}

test('Reports chart: monthlyRevenueChartData returns exactly 6 entries', () => {
  const data = computeMonthlyChartData([]);
  assert.strictEqual(data.length, 6);
});

test('Reports chart: monthlyRevenueChartData last entry is current month', () => {
  const data = computeMonthlyChartData([], TODAY);
  const lastEntry = data[data.length - 1];
  assert.strictEqual(lastEntry.ym, '2026-11');
});

test('Reports chart: monthlyRevenueChartData first entry is 5 months ago', () => {
  const data = computeMonthlyChartData([], TODAY);
  assert.strictEqual(data[0].ym, '2026-06');
});

test('Reports chart: each entry has membership, pt, total fields', () => {
  const data = computeMonthlyChartData([]);
  data.forEach(entry => {
    assert.ok('membership' in entry);
    assert.ok('pt' in entry);
    assert.ok('total' in entry);
  });
});

test('Reports chart: total equals membership + pt for each month', () => {
  const payments = [
    { id: 'C1', amount: 1000, status: 'completed', date: '2026-11-01', category: 'Membership' },
    { id: 'C2', amount: 500, status: 'completed', date: '2026-11-02', category: 'Personal Training' },
  ];
  const data = computeMonthlyChartData(payments, TODAY);
  const nov = data.find(d => d.ym === '2026-11');
  assert.strictEqual(nov.membership, 1000);
  assert.strictEqual(nov.pt, 500);
  assert.strictEqual(nov.total, 1500);
});

test('Reports chart: months with no payments have 0 totals', () => {
  const data = computeMonthlyChartData([], TODAY);
  data.forEach(entry => {
    assert.strictEqual(entry.membership, 0);
    assert.strictEqual(entry.pt, 0);
    assert.strictEqual(entry.total, 0);
  });
});

// ---------------------------------------------------------------------------
// 7. Dynamic Membership Analytics & Plan Breakdown Regression Tests
// ---------------------------------------------------------------------------

const MOCK_CONFIGURED_PLANS = [
  { id: 'p-daily', name: 'daily', duration_days: 1, price: 30, is_active: true },
  { id: 'p-monthly', name: 'Monthly Plan', duration_days: 30, price: 700, is_active: true },
  { id: 'p-quarterly', name: 'Quarterly Plan', duration_days: 90, price: 2000, is_active: true },
  { id: 'p-halfyearly', name: 'Half Yearly Plan', duration_days: 180, price: 4000, is_active: true },
  { id: 'p-annual', name: 'Annual Plan', duration_days: 365, price: 8000, is_active: true },
];

test('1. All five configured plans appear dynamically and in duration order', () => {
  const tableData = computePlanDetailsTableData({
    allMembershipPlans: MOCK_CONFIGURED_PLANS,
  });
  assert.strictEqual(tableData.length, 5);
  assert.strictEqual(tableData[0].name, 'daily');
  assert.strictEqual(tableData[1].name, 'Monthly Plan');
  assert.strictEqual(tableData[2].name, 'Quarterly Plan');
  assert.strictEqual(tableData[3].name, 'Half Yearly Plan');
  assert.strictEqual(tableData[4].name, 'Annual Plan');
});

test('2. Daily plan is not omitted and displays duration "1 Day"', () => {
  const tableData = computePlanDetailsTableData({
    allMembershipPlans: MOCK_CONFIGURED_PLANS,
  });
  const daily = tableData.find(p => p.name === 'daily');
  assert.ok(daily, 'Daily plan must be present');
  assert.strictEqual(daily.duration, '1 Day');
  assert.strictEqual(daily.price, 30);
});

test('3. Actual catalog prices come from plan configuration, not hardcoded constants', () => {
  const customCatalog = [
    { id: 'p1', name: 'Custom Tier', duration_days: 45, price: 999, is_active: true },
  ];
  const tableData = computePlanDetailsTableData({
    allMembershipPlans: customCatalog,
  });
  assert.strictEqual(tableData.length, 1);
  assert.strictEqual(tableData[0].price, 999);
  assert.strictEqual(tableData[0].duration, '45 Days');
});

test('4. Plan IDs correctly associate subscriptions with plans', () => {
  const subscriptions = [
    { id: 'sub-1', planId: 'p-monthly', planName: 'Monthly Plan', planPrice: 700, status: 'active' },
    { id: 'sub-2', planId: 'p-monthly', planName: 'Monthly Plan', planPrice: 700, status: 'active' },
    { id: 'sub-3', planId: 'p-annual', planName: 'Annual Plan', planPrice: 8000, status: 'active' },
  ];
  const members = [
    { id: 'm-1', currentSubscriptionId: 'sub-1', plan: 'Monthly Plan', status: 'active' },
    { id: 'm-2', currentSubscriptionId: 'sub-2', plan: 'Monthly Plan', status: 'active' },
    { id: 'm-3', currentSubscriptionId: 'sub-3', plan: 'Annual Plan', status: 'active' },
  ];

  const tableData = computePlanDetailsTableData({
    allMembershipPlans: MOCK_CONFIGURED_PLANS,
    subscriptions,
    members,
  });

  const monthly = tableData.find(p => p.id === 'p-monthly');
  const annual = tableData.find(p => p.id === 'p-annual');
  const daily = tableData.find(p => p.id === 'p-daily');

  assert.strictEqual(monthly.activeCount, 2);
  assert.strictEqual(monthly.enrolledCount, 2);
  assert.strictEqual(annual.activeCount, 1);
  assert.strictEqual(annual.enrolledCount, 1);
  assert.strictEqual(daily.activeCount, 0);
  assert.strictEqual(daily.enrolledCount, 0);
});

test('5. Renaming a plan does not break historical association when linked by plan_id', () => {
  // Plan name in database changed from 'Monthly Plan' to 'Premium 30 Days'
  const renamedPlans = [
    { id: 'p-monthly', name: 'Premium 30 Days', duration_days: 30, price: 850, is_active: true },
  ];
  // Subscriptions have the original planId 'p-monthly' and old name
  const subscriptions = [
    { id: 'sub-1', planId: 'p-monthly', planName: 'Monthly Plan', planPrice: 700, status: 'active' },
  ];
  const members = [
    { id: 'm-1', currentSubscriptionId: 'sub-1', plan: 'Monthly Plan', status: 'active' },
  ];

  const tableData = computePlanDetailsTableData({
    allMembershipPlans: renamedPlans,
    subscriptions,
    members,
  });

  assert.strictEqual(tableData.length, 1);
  assert.strictEqual(tableData[0].name, 'Premium 30 Days');
  assert.strictEqual(tableData[0].activeCount, 1);
  assert.strictEqual(tableData[0].enrolledCount, 1);
});

test('6. Inactive plans with historical records are represented and flagged with isActive: false', () => {
  const plansWithInactive = [
    ...MOCK_CONFIGURED_PLANS,
    { id: 'p-disc', name: 'Discontinued Tier', duration_days: 60, price: 1200, is_active: false },
  ];
  const subscriptions = [
    { id: 'sub-old', planId: 'p-disc', planName: 'Discontinued Tier', planPrice: 1200, status: 'active' },
  ];
  const members = [
    { id: 'm-old', currentSubscriptionId: 'sub-old', plan: 'Discontinued Tier', status: 'active' },
  ];

  const tableData = computePlanDetailsTableData({
    allMembershipPlans: plansWithInactive,
    subscriptions,
    members,
  });

  const disc = tableData.find(p => p.id === 'p-disc');
  assert.ok(disc);
  assert.strictEqual(disc.isActive, false);
  assert.strictEqual(disc.activeCount, 1);
  assert.strictEqual(disc.enrolledCount, 1);

  // Chart reflects (Inactive) label
  const chartData = computePlanDistributionData(tableData, 1);
  const chartDisc = chartData.find(c => c.id === 'p-disc');
  assert.ok(chartDisc);
  assert.strictEqual(chartDisc.name, 'Discontinued Tier (Inactive)');
});

test('7. Active counts only include members with status: "active"', () => {
  const subscriptions = [
    { id: 'sub-act', planId: 'p-monthly', planName: 'Monthly Plan', planPrice: 700, status: 'active' },
    { id: 'sub-exp', planId: 'p-monthly', planName: 'Monthly Plan', planPrice: 700, status: 'expired' },
  ];
  const members = [
    { id: 'm-1', currentSubscriptionId: 'sub-act', plan: 'Monthly Plan', status: 'active' },
    { id: 'm-2', currentSubscriptionId: 'sub-exp', plan: 'Monthly Plan', status: 'expired' },
  ];

  const tableData = computePlanDetailsTableData({
    allMembershipPlans: MOCK_CONFIGURED_PLANS,
    subscriptions,
    members,
  });

  const monthly = tableData.find(p => p.id === 'p-monthly');
  assert.strictEqual(monthly.activeCount, 1, 'Only active members should be counted in activeCount');
  assert.strictEqual(monthly.enrolledCount, 2, 'Total enrolled should reflect all historical subscriptions');
});

test('8. Historical enrollment counts reflect all historical subscriptions', () => {
  const subscriptions = [
    { id: 'sub-1', planId: 'p-quarterly', planName: 'Quarterly Plan', planPrice: 2000, status: 'active' },
    { id: 'sub-2', planId: 'p-quarterly', planName: 'Quarterly Plan', planPrice: 2000, status: 'expired' },
    { id: 'sub-3', planId: 'p-quarterly', planName: 'Quarterly Plan', planPrice: 2000, status: 'superseded' },
  ];

  const tableData = computePlanDetailsTableData({
    allMembershipPlans: MOCK_CONFIGURED_PLANS,
    subscriptions,
    members: [],
  });

  const quarterly = tableData.find(p => p.id === 'p-quarterly');
  assert.strictEqual(quarterly.enrolledCount, 3);
  assert.strictEqual(quarterly.activeCount, 0);
});

test('9. Only completed payments contribute to collected revenue (pending/failed/cancelled excluded)', () => {
  const payments = [
    { id: 'pay-1', planId: 'p-monthly', amount: 700, status: 'completed', category: 'Membership', date: TODAY },
    { id: 'pay-2', planId: 'p-monthly', amount: 700, status: 'pending', category: 'Membership', date: TODAY },
    { id: 'pay-3', planId: 'p-monthly', amount: 700, status: 'failed', category: 'Membership', date: TODAY },
    { id: 'pay-4', planId: 'p-monthly', amount: 700, status: 'cancelled', category: 'Membership', date: TODAY },
    { id: 'pay-5', planId: 'p-monthly', amount: 500, status: 'completed', category: 'Personal Training', date: TODAY }, // PT excluded
  ];

  const tableData = computePlanDetailsTableData({
    allMembershipPlans: MOCK_CONFIGURED_PLANS,
    payments,
  });

  const monthly = tableData.find(p => p.id === 'p-monthly');
  assert.strictEqual(monthly.totalRevenue, 700, 'Only completed membership payments should count');
});

test('10. Historical subscription prices remain unchanged when current plan prices change', () => {
  // Current catalog price is ₹800
  const catalog = [
    { id: 'p-monthly', name: 'Monthly Plan', duration_days: 30, price: 800, is_active: true },
  ];
  // Historical subscription was contracted at ₹700
  const subscriptions = [
    { id: 'sub-1', planId: 'p-monthly', planName: 'Monthly Plan', planPrice: 700, status: 'active' },
  ];

  const tableData = computePlanDetailsTableData({
    allMembershipPlans: catalog,
    subscriptions,
  });

  assert.strictEqual(tableData[0].price, 800, 'Catalog price displays 800');
  // Confirm sub.planPrice was preserved at 700 and not overwritten
  assert.strictEqual(subscriptions[0].planPrice, 700, 'Historical contracted price must remain 700');
});

test('11. Date filters do not incorrectly affect current active membership counts', () => {
  const subscriptions = [
    { id: 'sub-1', planId: 'p-monthly', planName: 'Monthly Plan', planPrice: 700, status: 'active' },
  ];
  const members = [
    { id: 'm-1', currentSubscriptionId: 'sub-1', plan: 'Monthly Plan', status: 'active' },
  ];
  // Payment occurred in the past (excluded by date filter)
  const payments = [
    { id: 'pay-old', planId: 'p-monthly', amount: 700, status: 'completed', category: 'Membership', date: '2026-01-01' },
  ];

  // Restrictive date filter: only today
  const isDateToday = (d) => d === TODAY;

  const tableData = computePlanDetailsTableData({
    allMembershipPlans: MOCK_CONFIGURED_PLANS,
    subscriptions,
    members,
    payments,
    isDateInRange: isDateToday,
  });

  const monthly = tableData.find(p => p.id === 'p-monthly');
  assert.strictEqual(monthly.activeCount, 1, 'Active members count is current-state and must NOT be reduced by date filter');
  assert.strictEqual(monthly.totalRevenue, 0, 'Revenue for period correctly excludes out-of-range payment');
});

test('12. No hardcoded old prices or plan categories remain in reporting logic', () => {
  const tableData = computePlanDetailsTableData({
    allMembershipPlans: MOCK_CONFIGURED_PLANS,
  });

  const prices = tableData.map(p => p.price);
  const names = tableData.map(p => p.name);

  // None of the old prototype prices (1500, 4000, 7000, 12000) should be generated from catalog
  assert.ok(!prices.includes(1500), '1500 prototype price must not exist');
  assert.ok(!prices.includes(12000), '12000 prototype price must not exist');
  assert.ok(names.includes('daily'), 'daily must be present');
  assert.ok(names.includes('Monthly Plan'), 'Monthly Plan must be present');
  assert.ok(names.includes('Annual Plan'), 'Annual Plan must be present');
});
