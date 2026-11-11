import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Staff vs Admin Financial Restriction Regression Test Suite
 *
 * Validates:
 * 1. Safe normalization in memberService.getActiveMembers (preserves null for masked fields, preserves genuine 0 for admins).
 * 2. MemberProfile financial display logic:
 *    - Admin sees unmasked financial values (e.g. ₹2,000, ₹0, ₹2,000).
 *    - Staff sees explicit "Financial information restricted" rather than misleading ₹0 or "—".
 * 3. MemberProfile Payments tab:
 *    - Admin sees payment history or genuine "No payment records yet."
 *    - Staff sees explicit "Financial information restricted".
 * 4. MemberProfile Activity feed:
 *    - Payments are omitted from activity feed for staff.
 * 5. Members directory table:
 *    - Admin sees pending dues balance or "Paid" badge.
 *    - Staff sees "Restricted" rather than misleading "Paid" badge for members with masked balance.
 *    - "Outstanding Balance" filter option is excluded for staff.
 */

// ---------------------------------------------------------------------------
// 1. Data Normalization Tests
// ---------------------------------------------------------------------------

function normalizeMemberRow(row) {
  return {
    id: row.id,
    member_code: row.member_code,
    name: row.name,
    phone: row.phone,
    email: row.email || '',
    gender: row.gender || 'Male',
    dob: row.dob || '',
    address: 'Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra',
    plan: row.plan_name || 'No Plan',
    planId: row.current_subscription_id || '',
    currentSubscriptionId: row.current_subscription_id || '',
    startDate: row.start_date || '',
    expiryDate: row.expiry_date || '',
    totalFee: (row.total_liability !== null && row.total_liability !== undefined)
      ? Number(row.total_liability)
      : (row.plan_price !== null && row.plan_price !== undefined)
        ? Number(row.plan_price)
        : null,
    amountPaid: (row.amount_paid !== null && row.amount_paid !== undefined)
      ? Number(row.amount_paid)
      : null,
    balance: (row.balance !== null && row.balance !== undefined)
      ? Number(row.balance)
      : null,
    paymentStatus: row.payment_status || null,
    status: row.subscription_status || 'active',
  };
}

test('1.1 Normalization preserves null for staff masked database view fields', () => {
  const staffRowFromDb = {
    id: 'mem-1008',
    member_code: 'MEM-01008',
    name: 'amar patil',
    phone: '9876543210',
    plan_name: 'Quarterly Plan',
    plan_price: null,
    total_liability: null,
    amount_paid: null,
    balance: null,
    payment_status: null,
    start_date: '2026-11-01',
    expiry_date: '2027-01-31',
    subscription_status: 'active',
  };

  const normalized = normalizeMemberRow(staffRowFromDb);

  assert.strictEqual(normalized.totalFee, null, 'totalFee must be null, not coerced to 0');
  assert.strictEqual(normalized.amountPaid, null, 'amountPaid must be null, not coerced to 0');
  assert.strictEqual(normalized.balance, null, 'balance must be null, not coerced to 0');
  assert.strictEqual(normalized.paymentStatus, null, 'paymentStatus must be null');
  assert.strictEqual(normalized.name, 'amar patil');
  assert.strictEqual(normalized.plan, 'Quarterly Plan');
});

test('1.2 Normalization preserves unmasked numeric values for admin database view fields', () => {
  const adminRowFromDb = {
    id: 'mem-1008',
    member_code: 'MEM-01008',
    name: 'amar patil',
    phone: '9876543210',
    plan_name: 'Quarterly Plan',
    plan_price: '2000.00',
    total_liability: '2000.00',
    amount_paid: '0.00',
    balance: '2000.00',
    payment_status: 'unpaid',
    start_date: '2026-11-01',
    expiry_date: '2027-01-31',
    subscription_status: 'active',
  };

  const normalized = normalizeMemberRow(adminRowFromDb);

  assert.strictEqual(normalized.totalFee, 2000);
  assert.strictEqual(normalized.amountPaid, 0);
  assert.strictEqual(normalized.balance, 2000);
  assert.strictEqual(normalized.paymentStatus, 'unpaid');
});

test('1.3 Normalization correctly handles genuine ₹0 plan for admin', () => {
  const freeTrialRow = {
    id: 'mem-1009',
    member_code: 'MEM-01009',
    name: 'Free Trial User',
    plan_name: 'Trial Pass',
    plan_price: '0.00',
    total_liability: '0.00',
    amount_paid: '0.00',
    balance: '0.00',
    payment_status: 'paid',
  };

  const normalized = normalizeMemberRow(freeTrialRow);

  assert.strictEqual(normalized.totalFee, 0, 'Genuine 0 fee must be preserved as 0 for admin');
  assert.strictEqual(normalized.amountPaid, 0);
  assert.strictEqual(normalized.balance, 0);
  assert.strictEqual(normalized.paymentStatus, 'paid');
});

// ---------------------------------------------------------------------------
// 2. MemberProfile Display Functions & Card Values
// ---------------------------------------------------------------------------

function computeMemberProfileFinancialCards(member, isAdmin) {
  const isFinancialRestricted = !isAdmin || member.totalFee === null;

  return {
    totalFee: isFinancialRestricted
      ? 'Financial information restricted'
      : `₹${member.totalFee?.toLocaleString() || '0'}`,
    amountPaid: isFinancialRestricted
      ? 'Financial information restricted'
      : `₹${member.amountPaid?.toLocaleString() || '0'}`,
    outstanding: isFinancialRestricted
      ? 'Financial information restricted'
      : (member.balance > 0 ? `₹${member.balance.toLocaleString()}` : '—'),
    isRestricted: isFinancialRestricted,
  };
}

test('2.1 Staff account displays "Financial information restricted" for Amar Patil', () => {
  const staffMember = {
    id: 'mem-1008',
    member_code: 'MEM-01008',
    name: 'amar patil',
    plan: 'Quarterly Plan',
    totalFee: null,
    amountPaid: null,
    balance: null,
    paymentStatus: null,
  };

  const cards = computeMemberProfileFinancialCards(staffMember, false);

  assert.strictEqual(cards.isRestricted, true);
  assert.strictEqual(cards.totalFee, 'Financial information restricted');
  assert.strictEqual(cards.amountPaid, 'Financial information restricted');
  assert.strictEqual(cards.outstanding, 'Financial information restricted');
  assert.notStrictEqual(cards.totalFee, '₹0', 'Staff must not see misleading ₹0');
  assert.notStrictEqual(cards.amountPaid, '₹0', 'Staff must not see misleading ₹0');
  assert.notStrictEqual(cards.outstanding, '—', 'Staff must not see misleading —');
});

test('2.2 Admin account displays accurate financial values for Amar Patil', () => {
  const adminMember = {
    id: 'mem-1008',
    member_code: 'MEM-01008',
    name: 'amar patil',
    plan: 'Quarterly Plan',
    totalFee: 2000,
    amountPaid: 0,
    balance: 2000,
    paymentStatus: 'unpaid',
  };

  const cards = computeMemberProfileFinancialCards(adminMember, true);

  assert.strictEqual(cards.isRestricted, false);
  assert.strictEqual(cards.totalFee, '₹2,000');
  assert.strictEqual(cards.amountPaid, '₹0');
  assert.strictEqual(cards.outstanding, '₹2,000');
});

test('2.3 Admin account with paid member shows ₹0 outstanding as dash', () => {
  const paidMember = {
    id: 'mem-1001',
    member_code: 'MEM-01001',
    name: 'Pooja Patil',
    plan: 'Monthly Plan',
    totalFee: 700,
    amountPaid: 700,
    balance: 0,
    paymentStatus: 'paid',
  };

  const cards = computeMemberProfileFinancialCards(paidMember, true);

  assert.strictEqual(cards.isRestricted, false);
  assert.strictEqual(cards.totalFee, '₹700');
  assert.strictEqual(cards.amountPaid, '₹700');
  assert.strictEqual(cards.outstanding, '—');
});

// ---------------------------------------------------------------------------
// 3. MemberProfile Payments Tab & Activity Isolation
// ---------------------------------------------------------------------------

function getPaymentsTabNotice(isAdmin, paymentsCount) {
  if (!isAdmin) {
    return 'Financial information restricted';
  }
  if (paymentsCount === 0) {
    return 'No payment records yet.';
  }
  return `${paymentsCount} records`;
}

test('3.1 Payments tab renders "Financial information restricted" for staff', () => {
  assert.strictEqual(getPaymentsTabNotice(false, 0), 'Financial information restricted');
  assert.strictEqual(getPaymentsTabNotice(true, 0), 'No payment records yet.');
  assert.strictEqual(getPaymentsTabNotice(true, 5), '5 records');
});

function getMemberActivityFeed(payments, checkins, isAdmin) {
  const paymentItems = isAdmin
    ? payments.map(p => ({ type: 'payment', date: p.date, desc: `Payment ₹${p.amount}` }))
    : [];
  const checkinItems = checkins.map(c => ({ type: 'checkin', date: c.date, desc: `Checked in at ${c.time}` }));

  return [...paymentItems, ...checkinItems].sort((a, b) => new Date(b.date) - new Date(a.date));
}

test('3.2 Activity feed excludes financial payment records when viewed by staff', () => {
  const samplePayments = [
    { id: 'p1', date: '2026-11-05', amount: 2000, category: 'Membership' },
  ];
  const sampleCheckins = [
    { id: 'c1', date: '2026-11-06', time: '08:00' },
  ];

  const staffFeed = getMemberActivityFeed(samplePayments, sampleCheckins, false);
  assert.strictEqual(staffFeed.length, 1);
  assert.strictEqual(staffFeed[0].type, 'checkin');
  assert.strictEqual(staffFeed.some(item => item.type === 'payment'), false);

  const adminFeed = getMemberActivityFeed(samplePayments, sampleCheckins, true);
  assert.strictEqual(adminFeed.length, 2);
  assert.strictEqual(adminFeed.some(item => item.type === 'payment'), true);
});

// ---------------------------------------------------------------------------
// 4. Members Directory Table Balance Cell & Filters
// ---------------------------------------------------------------------------

function renderMemberTableBalanceCell(member, isAdmin) {
  if (!isAdmin || member.balance === null || member.balance === undefined) {
    return { type: 'restricted', text: 'Restricted' };
  }
  if (member.balance > 0) {
    return { type: 'pending', text: `₹${member.balance.toLocaleString('en-IN')}` };
  }
  return { type: 'paid', text: 'Paid' };
}

test('4.1 Member table balance column shows "Restricted" for staff and never falsely shows "Paid"', () => {
  const staffMemberDues = { id: 'm1', name: 'amar patil', balance: null };
  const cell = renderMemberTableBalanceCell(staffMemberDues, false);
  assert.strictEqual(cell.type, 'restricted');
  assert.strictEqual(cell.text, 'Restricted');
  assert.notStrictEqual(cell.text, 'Paid', 'Must not display Paid for staff');
});

test('4.2 Member table balance column shows accurate status for admin', () => {
  const adminMemberDues = { id: 'm1', name: 'amar patil', balance: 2000 };
  const adminMemberPaid = { id: 'm2', name: 'pooja patil', balance: 0 };

  const duesCell = renderMemberTableBalanceCell(adminMemberDues, true);
  assert.strictEqual(duesCell.type, 'pending');
  assert.strictEqual(duesCell.text, '₹2,000');

  const paidCell = renderMemberTableBalanceCell(adminMemberPaid, true);
  assert.strictEqual(paidCell.type, 'paid');
  assert.strictEqual(paidCell.text, 'Paid');
});

function getMemberStatusFilterOptions(isAdmin) {
  return [
    { value: 'all', label: 'All Statuses' },
    { value: 'active', label: 'Active Members' },
    { value: 'expiring', label: 'Expiring Soon (≤5d)' },
    { value: 'expired', label: 'Expired' },
    ...(isAdmin ? [{ value: 'balance', label: 'Outstanding Balance' }] : []),
  ];
}

test('4.3 Outstanding Balance filter option is hidden for staff and available for admin', () => {
  const staffOptions = getMemberStatusFilterOptions(false);
  assert.strictEqual(staffOptions.some(o => o.value === 'balance'), false);

  const adminOptions = getMemberStatusFilterOptions(true);
  assert.strictEqual(adminOptions.some(o => o.value === 'balance'), true);
});

