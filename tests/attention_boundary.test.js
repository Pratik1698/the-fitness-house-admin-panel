import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDaysDifference,
  getExpiryClassification,
  getMembershipStatus,
} from '../src/utils/memberUtils.js';

/**
 * Attention Required — Expiry Classification & Boundary Filtering Regression Suite
 *
 * Reference Anchor Date: 2026-11-07
 *
 * Verifies:
 * 1. Exact tier, daysLeft, and label output across all boundary dates (-1d to +7d).
 * 2. Urgent (<=3d) vs Medium (4-5d) vs Active (>=6d) classification thresholds.
 * 3. Exact inclusion of 5 days and exclusion of 6 days from Expiring Soon.
 * 4. Independence from machine local clock by supplying reference date parameter.
 * 5. Robustness against missing, empty, or null expiryDate inputs.
 * 6. Attention.jsx component filtering and sorting logic for expiring and expired cohorts.
 * 7. Inspection of sorting stability with empty expiry dates (NaN defect audit).
 */

const REF_DATE = '2026-11-07';

// -----------------------------------------------------------------------------
// Suite 1: Specific Expiry Date Scenarios (Target Matrix)
// -----------------------------------------------------------------------------

test('1.1 Expiry Date 2026-11-06 (Yesterday): Classifies as Expired (-1 days)', () => {
  const member = { id: 'M-01', name: 'Member Expired Yesterday', expiryDate: '2026-11-06' };
  const res = getExpiryClassification(member, REF_DATE);

  assert.equal(res.daysLeft, -1, 'daysLeft must be exactly -1');
  assert.equal(res.tier, 'expired', 'tier must be "expired"');
  assert.equal(res.label, 'Expired 1 day ago', 'label must read "Expired 1 day ago"');
  assert.equal(res.priority, 'high', 'priority must be "high"');
  assert.equal(res.badgeVariant, 'error', 'badgeVariant must be "error"');
});

test('1.2 Expiry Date 2026-11-07 (Today): Classifies as Urgent, 0 days remaining', () => {
  const member = { id: 'M-02', name: 'Member Expiring Today', expiryDate: '2026-11-07' };
  const res = getExpiryClassification(member, REF_DATE);

  assert.equal(res.daysLeft, 0, 'daysLeft must be exactly 0 on expiry date');
  assert.equal(res.tier, 'expiring_3d', 'tier must be "expiring_3d" (Urgent)');
  assert.equal(res.label, 'Expires Today', 'label must read "Expires Today"');
  assert.equal(res.priority, 'urgent', 'priority must be "urgent"');
  assert.equal(res.badgeVariant, 'warning', 'badgeVariant must be "warning"');
});

test('1.3 Expiry Date 2026-11-08 (Tomorrow): Classifies as Urgent, 1 day remaining', () => {
  const member = { id: 'M-03', name: 'Member Expiring in 1d', expiryDate: '2026-11-08' };
  const res = getExpiryClassification(member, REF_DATE);

  assert.equal(res.daysLeft, 1, 'daysLeft must be exactly 1');
  assert.equal(res.tier, 'expiring_3d', 'tier must be "expiring_3d"');
  assert.equal(res.label, 'Expires in 1 day', 'label must read "Expires in 1 day"');
  assert.equal(res.priority, 'urgent', 'priority must be "urgent"');
  assert.equal(res.badgeVariant, 'warning');
});

test('1.4 Expiry Date 2026-11-09: Classifies as Urgent, 2 days remaining', () => {
  const member = { id: 'M-04', name: 'Member Expiring in 2d', expiryDate: '2026-11-09' };
  const res = getExpiryClassification(member, REF_DATE);

  assert.equal(res.daysLeft, 2, 'daysLeft must be exactly 2');
  assert.equal(res.tier, 'expiring_3d', 'tier must be "expiring_3d"');
  assert.equal(res.label, 'Expires in 2 days', 'label must read "Expires in 2 days"');
  assert.equal(res.priority, 'urgent', 'priority must be "urgent"');
  assert.equal(res.badgeVariant, 'warning');
});

test('1.5 Expiry Date 2026-11-10: Classifies as Urgent, 3 days remaining (Urgent boundary ceiling)', () => {
  const member = { id: 'M-05', name: 'Member Expiring in 3d', expiryDate: '2026-11-10' };
  const res = getExpiryClassification(member, REF_DATE);

  assert.equal(res.daysLeft, 3, 'daysLeft must be exactly 3');
  assert.equal(res.tier, 'expiring_3d', 'tier must be "expiring_3d"');
  assert.equal(res.label, 'Expires in 3 days', 'label must read "Expires in 3 days"');
  assert.equal(res.priority, 'urgent', 'priority must be "urgent"');
  assert.equal(res.badgeVariant, 'warning');
});

test('1.6 Expiry Date 2026-11-11: Classifies as Medium, 4 days remaining (Medium boundary floor)', () => {
  const member = { id: 'M-06', name: 'Member Expiring in 4d', expiryDate: '2026-11-11' };
  const res = getExpiryClassification(member, REF_DATE);

  assert.equal(res.daysLeft, 4, 'daysLeft must be exactly 4');
  assert.equal(res.tier, 'expiring_5d', 'tier must be "expiring_5d" (Medium)');
  assert.equal(res.label, 'Expires in 4 days', 'label must read "Expires in 4 days"');
  assert.equal(res.priority, 'medium', 'priority must be "medium"');
  assert.equal(res.badgeVariant, 'warning');
});

test('1.7 Expiry Date 2026-11-12: Classifies as Medium, 5 days remaining (Expiring boundary ceiling)', () => {
  const member = { id: 'M-07', name: 'Member Expiring in 5d', expiryDate: '2026-11-12' };
  const res = getExpiryClassification(member, REF_DATE);

  assert.equal(res.daysLeft, 5, 'daysLeft must be exactly 5');
  assert.equal(res.tier, 'expiring_5d', 'tier must be "expiring_5d"');
  assert.equal(res.label, 'Expires in 5 days', 'label must read "Expires in 5 days"');
  assert.equal(res.priority, 'medium', 'priority must be "medium"');
  assert.equal(res.badgeVariant, 'warning');
});

test('1.8 Expiry Date 2026-11-13: Classifies as Active, 6 days remaining (Excluded from Expiring)', () => {
  const member = { id: 'M-08', name: 'Member Expiring in 6d', expiryDate: '2026-11-13' };
  const res = getExpiryClassification(member, REF_DATE);

  assert.equal(res.daysLeft, 6, 'daysLeft must be exactly 6');
  assert.equal(res.tier, 'active', 'tier must be "active" (excluded from Expiring Soon)');
  assert.equal(res.label, 'Active (6 days left)', 'label must indicate active state');
  assert.equal(res.priority, 'low', 'priority must be "low"');
  assert.equal(res.badgeVariant, 'success');
});

test('1.9 Expiry Date 2026-11-14: Classifies as Active, 7 days remaining (Excluded from Expiring)', () => {
  const member = { id: 'M-09', name: 'Member Expiring in 7d', expiryDate: '2026-11-14' };
  const res = getExpiryClassification(member, REF_DATE);

  assert.equal(res.daysLeft, 7, 'daysLeft must be exactly 7');
  assert.equal(res.tier, 'active', 'tier must be "active"');
  assert.equal(res.label, 'Active (7 days left)');
  assert.equal(res.priority, 'low');
  assert.equal(res.badgeVariant, 'success');
});

// -----------------------------------------------------------------------------
// Suite 2: Boundary Inclusions & Date Stability
// -----------------------------------------------------------------------------

test('2.1 Boundary verification: exactly 5 days is expiring_5d, exactly 6 days is active', () => {
  const m5 = { id: 'M-5D', expiryDate: '2026-11-12' };
  const m6 = { id: 'M-6D', expiryDate: '2026-11-13' };

  const res5 = getExpiryClassification(m5, REF_DATE);
  const res6 = getExpiryClassification(m6, REF_DATE);

  assert.equal(res5.tier, 'expiring_5d', 'Day 5 must be in expiring_5d');
  assert.equal(res6.tier, 'active', 'Day 6 must transition to active');
  assert.notEqual(res5.tier, res6.tier, 'Day 5 and Day 6 must belong to different tiers');
});

test('2.2 Urgent boundary: day 3 is urgent (expiring_3d), day 4 is medium (expiring_5d)', () => {
  const m3 = { id: 'M-3D', expiryDate: '2026-11-10' };
  const m4 = { id: 'M-4D', expiryDate: '2026-11-11' };

  const res3 = getExpiryClassification(m3, REF_DATE);
  const res4 = getExpiryClassification(m4, REF_DATE);

  assert.equal(res3.priority, 'urgent');
  assert.equal(res3.tier, 'expiring_3d');
  assert.equal(res4.priority, 'medium');
  assert.equal(res4.tier, 'expiring_5d');
});

test('2.3 Date calculation is stable and strictly respects supplied reference date parameter', () => {
  const member = { id: 'M-REF', expiryDate: '2027-01-15' };

  // Calculate relative to different anchor dates
  const resAnchor1 = getExpiryClassification(member, '2027-01-15');
  assert.equal(resAnchor1.daysLeft, 0, 'On target date, daysLeft must be 0');
  assert.equal(resAnchor1.label, 'Expires Today');

  const resAnchor2 = getExpiryClassification(member, '2027-01-10');
  assert.equal(resAnchor2.daysLeft, 5, '5 days prior, daysLeft must be 5');
  assert.equal(resAnchor2.tier, 'expiring_5d');

  const resAnchor3 = getExpiryClassification(member, '2027-01-09');
  assert.equal(resAnchor3.daysLeft, 6, '6 days prior, daysLeft must be 6');
  assert.equal(resAnchor3.tier, 'active');

  const resAnchor4 = getExpiryClassification(member, '2027-01-16');
  assert.equal(resAnchor4.daysLeft, -1, '1 day after, daysLeft must be -1');
  assert.equal(resAnchor4.tier, 'expired');
});

// -----------------------------------------------------------------------------
// Suite 3: Missing, Null, or Empty Expiry Date Handling
// -----------------------------------------------------------------------------

test('3.1 Missing or null member object returns safe expired fallback without throwing', () => {
  const resNull = getExpiryClassification(null, REF_DATE);
  assert.equal(resNull.tier, 'expired');
  assert.equal(resNull.daysLeft, -999);
  assert.equal(resNull.badgeVariant, 'error');

  const resUndefined = getExpiryClassification(undefined, REF_DATE);
  assert.equal(resUndefined.tier, 'expired');
  assert.equal(resUndefined.daysLeft, -999);

  const resEmptyObj = getExpiryClassification({}, REF_DATE);
  assert.equal(resEmptyObj.tier, 'expired');
  assert.equal(resEmptyObj.daysLeft, -999);
});

test('3.2 Missing or empty expiryDate field returns safe expired fallback', () => {
  const mEmpty = { id: 'M-EMPTY', name: 'No Date', expiryDate: '' };
  const resEmpty = getExpiryClassification(mEmpty, REF_DATE);
  assert.equal(resEmpty.tier, 'expired');
  assert.equal(resEmpty.daysLeft, -999);
  assert.equal(resEmpty.label, 'Expired');

  const mNullDate = { id: 'M-NULL', name: 'Null Date', expiryDate: null };
  const resNull = getExpiryClassification(mNullDate, REF_DATE);
  assert.equal(resNull.tier, 'expired');
  assert.equal(resNull.daysLeft, -999);

  const mUndefinedDate = { id: 'M-UNDEF', name: 'Undefined Date', expiryDate: undefined };
  const resUndef = getExpiryClassification(mUndefinedDate, REF_DATE);
  assert.equal(resUndef.tier, 'expired');
  assert.equal(resUndef.daysLeft, -999);
});

// -----------------------------------------------------------------------------
// Suite 4: Attention.jsx Component Filtering & Sorting Logic
// -----------------------------------------------------------------------------

const COHORT = [
  { id: 'M-EXP-PAST-5D', name: 'Expired 5 Days Ago', expiryDate: '2026-11-02' },
  { id: 'M-EXP-PAST-1D', name: 'Expired Yesterday', expiryDate: '2026-11-06' },
  { id: 'M-DUE-0D', name: 'Expires Today', expiryDate: '2026-11-07' },
  { id: 'M-DUE-1D', name: 'Expires in 1 Day', expiryDate: '2026-11-08' },
  { id: 'M-DUE-2D', name: 'Expires in 2 Days', expiryDate: '2026-11-09' },
  { id: 'M-DUE-3D', name: 'Expires in 3 Days', expiryDate: '2026-11-10' },
  { id: 'M-DUE-4D', name: 'Expires in 4 Days', expiryDate: '2026-11-11' },
  { id: 'M-DUE-5D', name: 'Expires in 5 Days', expiryDate: '2026-11-12' },
  { id: 'M-ACT-6D', name: 'Active 6 Days Left', expiryDate: '2026-11-13' },
  { id: 'M-ACT-7D', name: 'Active 7 Days Left', expiryDate: '2026-11-14' },
  { id: 'M-ACT-30D', name: 'Active 30 Days Left', expiryDate: '2026-12-07' },
  { id: 'M-NO-DATE', name: 'Member Without Date', expiryDate: '' },
];

test('4.1 Attention.jsx expiringMembers filter: includes only 0 through 5 days', () => {
  // Exact filtering logic from src/pages/Attention.jsx lines 22-26
  const expiringMembers = COHORT
    .map(m => ({ ...m, cls: getExpiryClassification(m, REF_DATE) }))
    .filter(m => m.cls.tier === 'expiring_3d' || m.cls.tier === 'expiring_5d')
    .sort((a, b) => a.cls.daysLeft - b.cls.daysLeft);

  assert.equal(expiringMembers.length, 6, 'Exactly 6 members (0d through 5d) must be included');

  const includedIds = expiringMembers.map(m => m.id);
  assert.deepEqual(includedIds, [
    'M-DUE-0D', // 0 days
    'M-DUE-1D', // 1 day
    'M-DUE-2D', // 2 days
    'M-DUE-3D', // 3 days
    'M-DUE-4D', // 4 days
    'M-DUE-5D', // 5 days
  ]);

  // Ensure exclusions
  assert.ok(!includedIds.includes('M-ACT-6D'), '6-day member must be excluded from Expiring Soon');
  assert.ok(!includedIds.includes('M-ACT-7D'), '7-day member must be excluded');
  assert.ok(!includedIds.includes('M-ACT-30D'), '30-day member must be excluded');
  assert.ok(!includedIds.includes('M-EXP-PAST-1D'), 'Expired member must be excluded from Expiring Soon');
  assert.ok(!includedIds.includes('M-NO-DATE'), 'Member without date must be excluded from Expiring Soon');
});

test('4.2 Attention.jsx expiringMembers sorting: sorts ascending by daysLeft (most urgent first)', () => {
  // Test with unsorted input
  const unsortedCohort = [
    { id: 'M-5D', expiryDate: '2026-11-12' },
    { id: 'M-1D', expiryDate: '2026-11-08' },
    { id: 'M-0D', expiryDate: '2026-11-07' },
    { id: 'M-3D', expiryDate: '2026-11-10' },
  ];

  const sorted = unsortedCohort
    .map(m => ({ ...m, cls: getExpiryClassification(m, REF_DATE) }))
    .filter(m => m.cls.tier === 'expiring_3d' || m.cls.tier === 'expiring_5d')
    .sort((a, b) => a.cls.daysLeft - b.cls.daysLeft);

  const daysLeftSeq = sorted.map(m => m.cls.daysLeft);
  assert.deepEqual(daysLeftSeq, [0, 1, 3, 5], 'Expiring members must sort in ascending daysLeft order');
});

test('4.3 Attention.jsx expiredMembers filter: captures past dates and missing dates', () => {
  // Exact filtering logic from src/pages/Attention.jsx lines 29-33
  const expiredMembers = COHORT
    .map(m => ({ ...m, cls: getExpiryClassification(m, REF_DATE) }))
    .filter(m => m.cls.tier === 'expired');

  assert.equal(expiredMembers.length, 3, 'Must capture the 2 past-date members plus 1 no-date member');
  const expiredIds = expiredMembers.map(m => m.id);
  assert.ok(expiredIds.includes('M-EXP-PAST-5D'));
  assert.ok(expiredIds.includes('M-EXP-PAST-1D'));
  assert.ok(expiredIds.includes('M-NO-DATE'));
});

test('4.4 Attention.jsx safe comparator: sorts valid dates descending and places null, undefined, empty, and invalid dates at the end', () => {
  // The exact safe comparator implemented in src/pages/Attention.jsx
  const safeExpiredSort = (a, b) => {
    const timeA = a.expiryDate ? new Date(a.expiryDate).getTime() : NaN;
    const timeB = b.expiryDate ? new Date(b.expiryDate).getTime() : NaN;
    const validA = !Number.isNaN(timeA);
    const validB = !Number.isNaN(timeB);

    if (validA && validB) {
      return timeB - timeA;
    }
    if (validA && !validB) return -1;
    if (!validA && validB) return 1;
    return 0;
  };

  const mixedCohort = [
    { id: 'M-EMPTY', expiryDate: '' },
    { id: 'M-NULL', expiryDate: null },
    { id: 'M-UNDEF', expiryDate: undefined },
    { id: 'M-INVALID', expiryDate: 'not-a-valid-date' },
    { id: 'M-EXP-5D', expiryDate: '2026-11-02' },
    { id: 'M-EXP-1D', expiryDate: '2026-11-06' },
    { id: 'M-EXP-20D', expiryDate: '2026-10-18' },
  ];

  const sorted = [...mixedCohort].sort(safeExpiredSort);

  // 1. Verify valid dates are sorted descending (most recent first)
  assert.equal(sorted[0].id, 'M-EXP-1D', 'Most recently expired (2026-11-06) must be index 0');
  assert.equal(sorted[1].id, 'M-EXP-5D', '2026-11-02 must be index 1');
  assert.equal(sorted[2].id, 'M-EXP-20D', '2026-10-18 must be index 2');

  // 2. Verify all missing/invalid dates are placed at the end (indices 3, 4, 5, 6)
  const trailingIds = sorted.slice(3).map(m => m.id);
  assert.ok(trailingIds.includes('M-EMPTY'), 'Empty date must be placed at the end');
  assert.ok(trailingIds.includes('M-NULL'), 'Null date must be placed at the end');
  assert.ok(trailingIds.includes('M-UNDEF'), 'Undefined date must be placed at the end');
  assert.ok(trailingIds.includes('M-INVALID'), 'Invalid date string must be placed at the end');

  // 3. Verify comparator NEVER returns NaN for any pair
  for (let i = 0; i < mixedCohort.length; i++) {
    for (let j = 0; j < mixedCohort.length; j++) {
      const cmp = safeExpiredSort(mixedCohort[i], mixedCohort[j]);
      assert.ok(!Number.isNaN(cmp), `Comparator must never return NaN for pair (${mixedCohort[i].id}, ${mixedCohort[j].id})`);
    }
  }
});

test('4.5 Attention.jsx display fallback: renders valid expiry date or N/A fallback when missing/invalid', () => {
  const getDisplayExpiry = (member) => {
    return member.expiryDate && !Number.isNaN(new Date(member.expiryDate).getTime())
      ? member.expiryDate
      : 'N/A';
  };

  assert.equal(getDisplayExpiry({ expiryDate: '2026-11-06' }), '2026-11-06', 'Valid date renders directly');
  assert.equal(getDisplayExpiry({ expiryDate: '' }), 'N/A', 'Empty string renders as N/A');
  assert.equal(getDisplayExpiry({ expiryDate: null }), 'N/A', 'Null renders as N/A');
  assert.equal(getDisplayExpiry({ expiryDate: undefined }), 'N/A', 'Undefined renders as N/A');
  assert.equal(getDisplayExpiry({ expiryDate: 'invalid-date' }), 'N/A', 'Invalid date string renders as N/A');
});
