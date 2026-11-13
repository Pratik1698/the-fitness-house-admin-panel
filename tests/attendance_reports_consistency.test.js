import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMemberAttendanceMetrics,
  computeTopFrequentMembers,
  computeLowActivityMembers,
} from '../src/utils/analyticsUtils.js';

test('1. 3 visits: member excluded from low-activity alert', () => {
  const members = [
    { id: 'm1', name: 'QA Test Member', status: 'active', totalCheckins: 0 },
  ];
  const checkins = [
    { memberId: 'm1', date: '2026-11-01', time: '08:00 AM', status: 'completed' },
    { memberId: 'm1', date: '2026-11-03', time: '09:00 AM', status: 'completed' },
    { memberId: 'm1', date: '2026-11-05', time: '07:30 AM', status: 'valid' },
  ];

  const lowActivity = computeLowActivityMembers({ members, checkins });
  assert.strictEqual(lowActivity.length, 0, 'Member with 3 visits must be strictly excluded from low-activity alert');

  const topFrequent = computeTopFrequentMembers({ members, checkins });
  assert.strictEqual(topFrequent.length, 1);
  assert.strictEqual(topFrequent[0].visitCount, 3);
});

test('2. 2 visits: member included in low-activity alert with 2 visits', () => {
  const members = [
    { id: 'm2', name: 'pranav khot', status: 'active', totalCheckins: 0 },
  ];
  const checkins = [
    { memberId: 'm2', date: '2026-11-02', time: '06:30 AM', status: 'completed' },
    { memberId: 'm2', date: '2026-11-04', time: '07:00 AM', status: 'valid' },
  ];

  const lowActivity = computeLowActivityMembers({ members, checkins });
  assert.strictEqual(lowActivity.length, 1);
  assert.strictEqual(lowActivity[0].name, 'pranav khot');
  assert.strictEqual(lowActivity[0].visitCount, 2, 'Must display accurate 2 visits, not 0');
});

test('3. 1 visit: member included in low-activity alert with 1 visit', () => {
  const members = [
    { id: 'm3', name: 'rohit shinde', status: 'active', totalCheckins: 0 },
  ];
  const checkins = [
    { memberId: 'm3', date: '2026-11-06', time: '10:00 AM', status: 'valid' },
  ];

  const lowActivity = computeLowActivityMembers({ members, checkins });
  assert.strictEqual(lowActivity.length, 1);
  assert.strictEqual(lowActivity[0].name, 'rohit shinde');
  assert.strictEqual(lowActivity[0].visitCount, 1, 'Must display accurate 1 visit, not 0');
});

test('4. 0 visits: member included in low-activity alert with 0 visits', () => {
  const members = [
    { id: 'm4', name: 'QA Test Member 2', status: 'active', totalCheckins: 0 },
  ];
  const checkins = [];

  const lowActivity = computeLowActivityMembers({ members, checkins });
  assert.strictEqual(lowActivity.length, 1);
  assert.strictEqual(lowActivity[0].name, 'QA Test Member 2');
  assert.strictEqual(lowActivity[0].visitCount, 0, 'Must display 0 visits');
  assert.strictEqual(lowActivity[0].lastCheckinTime, '—');
});

test('5. Cancelled check-ins are excluded from visit calculations', () => {
  const members = [
    { id: 'm5', name: 'sachin patil', status: 'active', totalCheckins: 0 },
  ];
  const checkins = [
    { memberId: 'm5', date: '2026-11-01', time: '08:00 AM', status: 'valid' },
    { memberId: 'm5', date: '2026-11-02', time: '08:30 AM', status: 'cancelled', rawStatus: 'cancelled' },
    { memberId: 'm5', date: '2026-11-03', time: '09:00 AM', status: 'completed' },
    { memberId: 'm5', date: '2026-11-04', time: '09:30 AM', status: 'cancelled' },
  ];

  const metrics = computeMemberAttendanceMetrics({ members, checkins });
  assert.strictEqual(metrics[0].visitCount, 2, 'Cancelled check-ins must not be counted');

  // Since visit count is 2 (< 3), member is included in low-activity alert with 2 visits
  const lowActivity = computeLowActivityMembers({ members, checkins });
  assert.strictEqual(lowActivity.length, 1);
  assert.strictEqual(lowActivity[0].visitCount, 2);
});

test('6. Both widgets use identical visit-count definitions', () => {
  const members = [
    { id: 'm1', name: 'QA Test Member', status: 'active', totalCheckins: 0 },
    { id: 'm2', name: 'pranav khot', status: 'active', totalCheckins: 0 },
    { id: 'm3', name: 'amar patil', status: 'active', totalCheckins: 0 },
  ];
  const checkins = [
    { memberId: 'm1', date: '2026-11-01', status: 'valid' },
    { memberId: 'm1', date: '2026-11-02', status: 'valid' },
    { memberId: 'm1', date: '2026-11-03', status: 'valid' },
    { memberId: 'm2', date: '2026-11-02', status: 'valid' },
    { memberId: 'm2', date: '2026-11-04', status: 'valid' },
    { memberId: 'm3', date: '2026-11-05', status: 'valid' },
  ];

  const topFrequent = computeTopFrequentMembers({ members, checkins, limit: 10 });
  const lowActivity = computeLowActivityMembers({ members, checkins, threshold: 3, limit: 10 });

  const topMap = new Map(topFrequent.map(m => [m.id, m.visitCount]));
  const lowMap = new Map(lowActivity.map(m => [m.id, m.visitCount]));

  // pranav khot has 2 visits, present in both (top frequent has up to 10)
  assert.strictEqual(topMap.get('m2'), 2);
  assert.strictEqual(lowMap.get('m2'), 2);

  // amar patil has 1 visit, present in both
  assert.strictEqual(topMap.get('m3'), 1);
  assert.strictEqual(lowMap.get('m3'), 1);

  // QA Test Member has 3 visits, present in top, excluded from low
  assert.strictEqual(topMap.get('m1'), 3);
  assert.strictEqual(lowMap.has('m1'), false);
});

test('7. Low-activity sorting is strictly ascending by visit count (0 visits first)', () => {
  const members = [
    { id: 'm_two', name: 'Member With Two Visits', status: 'active', totalCheckins: 0 },
    { id: 'm_zero', name: 'Member With Zero Visits', status: 'active', totalCheckins: 0 },
    { id: 'm_one', name: 'Member With One Visit', status: 'active', totalCheckins: 0 },
  ];
  const checkins = [
    { memberId: 'm_two', date: '2026-11-01', status: 'valid' },
    { memberId: 'm_two', date: '2026-11-02', status: 'valid' },
    { memberId: 'm_one', date: '2026-11-03', status: 'valid' },
  ];

  const lowActivity = computeLowActivityMembers({ members, checkins });
  assert.strictEqual(lowActivity.length, 3);
  assert.strictEqual(lowActivity[0].id, 'm_zero', '0 visits must be sorted first');
  assert.strictEqual(lowActivity[0].visitCount, 0);
  assert.strictEqual(lowActivity[1].id, 'm_one', '1 visit must be sorted second');
  assert.strictEqual(lowActivity[1].visitCount, 1);
  assert.strictEqual(lowActivity[2].id, 'm_two', '2 visits must be sorted third');
  assert.strictEqual(lowActivity[2].visitCount, 2);
});

test('8. Latest visit timestamp is correctly resolved from valid check-ins', () => {
  const members = [
    { id: 'm1', name: 'Test Member', status: 'active', totalCheckins: 0 },
  ];
  const checkins = [
    { memberId: 'm1', date: '2026-11-01', time: '06:00 AM', checkedInAt: '2026-11-01T06:00:00Z', status: 'completed' },
    { memberId: 'm1', date: '2026-11-08', time: '09:45 AM', checkedInAt: '2026-11-08T09:45:00Z', status: 'valid' },
    { memberId: 'm1', date: '2026-11-04', time: '07:30 AM', checkedInAt: '2026-11-04T07:30:00Z', status: 'completed' },
    // Later check-in was cancelled - should be ignored
    { memberId: 'm1', date: '2026-11-10', time: '11:00 AM', checkedInAt: '2026-11-10T11:00:00Z', status: 'cancelled' },
  ];

  const metrics = computeMemberAttendanceMetrics({ members, checkins });
  assert.strictEqual(metrics[0].lastCheckinTime, '2026-11-08 (09:45 AM)');
  assert.strictEqual(metrics[0].lastCheckinDate, '2026-11-08');
});

test('9. Inactive/expired members are excluded from low-activity alert', () => {
  const members = [
    { id: 'm_active', name: 'Active Member', status: 'active', totalCheckins: 0 },
    { id: 'm_expired', name: 'Expired Member', status: 'expired', totalCheckins: 0 },
    { id: 'm_inactive', name: 'Inactive Member', status: 'inactive', totalCheckins: 0 },
  ];
  const checkins = [];

  const lowActivity = computeLowActivityMembers({ members, checkins });
  assert.strictEqual(lowActivity.length, 1);
  assert.strictEqual(lowActivity[0].id, 'm_active');
});

test('10. End-to-end UAT reported scenario verification', () => {
  // Exact scenario from the UAT defect report:
  // QA Test Member: 3 visits
  // pranav khot: 2 visits
  // amar patil: 2 visits
  // QA Test Member 2: 0 visits
  // QA Dues Member 3: 0 visits
  const members = [
    { id: 'm1', member_code: 'MEM-01001', name: 'QA Test Member', status: 'active', totalCheckins: 0 },
    { id: 'm2', member_code: 'MEM-01002', name: 'pranav khot', status: 'active', totalCheckins: 0 },
    { id: 'm3', member_code: 'MEM-01008', name: 'amar patil', status: 'active', totalCheckins: 0 },
    { id: 'm4', member_code: 'MEM-01004', name: 'QA Test Member 2', status: 'active', totalCheckins: 0 },
    { id: 'm5', member_code: 'MEM-01005', name: 'QA Dues Member 3', status: 'active', totalCheckins: 0 },
  ];

  const checkins = [
    { memberId: 'm1', date: '2026-11-01', time: '08:00 AM', status: 'completed' },
    { memberId: 'm1', date: '2026-11-03', time: '08:30 AM', status: 'completed' },
    { memberId: 'm1', date: '2026-11-05', time: '09:00 AM', status: 'valid' },
    { memberId: 'm2', date: '2026-11-02', time: '07:00 AM', status: 'completed' },
    { memberId: 'm2', date: '2026-11-04', time: '07:30 AM', status: 'valid' },
    { memberId: 'm3', date: '2026-11-02', time: '06:30 AM', status: 'completed' },
    { memberId: 'm3', date: '2026-11-06', time: '07:00 AM', status: 'valid' },
  ];

  // 1. Most Frequent Members calculation
  const topFrequent = computeTopFrequentMembers({ members, checkins, limit: 5 });
  const topMap = new Map(topFrequent.map(m => [m.name, m.visitCount]));

  assert.strictEqual(topMap.get('QA Test Member'), 3);
  assert.strictEqual(topMap.get('pranav khot'), 2);
  assert.strictEqual(topMap.get('amar patil'), 2);
  assert.strictEqual(topMap.get('QA Test Member 2'), 0);
  assert.strictEqual(topMap.get('QA Dues Member 3'), 0);

  // 2. Low Activity / Inactive Alert calculation
  const lowActivity = computeLowActivityMembers({ members, checkins, threshold: 3, limit: 5 });
  const lowNames = lowActivity.map(m => m.name);
  const lowMap = new Map(lowActivity.map(m => [m.name, m.visitCount]));

  // Invariant 1: QA Test Member (3 visits) MUST NOT be in Low Activity Alert
  assert.strictEqual(lowNames.includes('QA Test Member'), false, 'QA Test Member (3 visits) must be excluded from Low Activity Alert');

  // Invariant 2: pranav khot (2 visits) MUST display 2 visits, NOT 0
  assert.strictEqual(lowMap.get('pranav khot'), 2, 'pranav khot must show 2 visits');

  // Invariant 3: amar patil (2 visits) MUST display 2 visits, NOT 0
  assert.strictEqual(lowMap.get('amar patil'), 2, 'amar patil must show 2 visits');

  // Invariant 4: 0-visit members must be sorted first
  assert.strictEqual(lowActivity[0].visitCount, 0, 'First low-activity member must have 0 visits');
  assert.strictEqual(lowActivity[1].visitCount, 0, 'Second low-activity member must have 0 visits');
  assert.strictEqual(lowActivity[2].visitCount, 2, 'Third low-activity member must have 2 visits');
  assert.strictEqual(lowActivity[3].visitCount, 2, 'Fourth low-activity member must have 2 visits');
});

test('11. Existing admin and staff financial restrictions remain unchanged', () => {
  // Confirm that member attendance metrics decoration preserves financial fields intact
  const staffMember = {
    id: 'm1',
    name: 'amar patil',
    status: 'active',
    totalFee: null,
    amountPaid: null,
    balance: null,
    paymentStatus: null,
    totalCheckins: 0,
  };
  const adminMember = {
    id: 'm2',
    name: 'amar patil',
    status: 'active',
    totalFee: 2000,
    amountPaid: 0,
    balance: 2000,
    paymentStatus: 'pending',
    totalCheckins: 0,
  };

  const checkins = [
    { memberId: 'm1', date: '2026-11-02', status: 'valid' },
    { memberId: 'm2', date: '2026-11-02', status: 'valid' },
  ];

  const decorated = computeMemberAttendanceMetrics({ members: [staffMember, adminMember], checkins });

  // Staff member financial fields remain null (masked)
  assert.strictEqual(decorated[0].totalFee, null);
  assert.strictEqual(decorated[0].amountPaid, null);
  assert.strictEqual(decorated[0].balance, null);
  assert.strictEqual(decorated[0].paymentStatus, null);
  assert.strictEqual(decorated[0].visitCount, 1);

  // Admin member financial fields remain unmasked
  assert.strictEqual(decorated[1].totalFee, 2000);
  assert.strictEqual(decorated[1].amountPaid, 0);
  assert.strictEqual(decorated[1].balance, 2000);
  assert.strictEqual(decorated[1].paymentStatus, 'pending');
  assert.strictEqual(decorated[1].visitCount, 1);
});

test('12. Date range consistency across reporting periods (this_month, 30days, custom)', () => {
  const members = [
    { id: 'm1', name: 'Member A', status: 'active', totalCheckins: 0 },
    { id: 'm2', name: 'Member B', status: 'active', totalCheckins: 0 },
  ];
  const checkins = [
    // October 2026 check-ins
    { memberId: 'm1', date: '2026-10-15', status: 'valid' },
    { memberId: 'm1', date: '2026-10-25', status: 'valid' },
    // November 2026 check-ins
    { memberId: 'm1', date: '2026-11-05', status: 'valid' },
    { memberId: 'm2', date: '2026-11-08', status: 'valid' },
    { memberId: 'm2', date: '2026-11-10', status: 'valid' },
  ];

  // Case A: All-time reporting (no dateFilter)
  const allTimeTop = computeTopFrequentMembers({ members, checkins, limit: 5 });
  const allTimeLow = computeLowActivityMembers({ members, checkins, threshold: 3, limit: 5 });
  assert.strictEqual(allTimeTop.find(m => m.id === 'm1').visitCount, 3);
  assert.strictEqual(allTimeTop.find(m => m.id === 'm2').visitCount, 2);
  // In all-time, Member A (3 visits) is excluded from low-activity; Member B (2 visits) is included
  assert.strictEqual(allTimeLow.some(m => m.id === 'm1'), false);
  assert.strictEqual(allTimeLow.find(m => m.id === 'm2').visitCount, 2);

  // Case B: Filter by November 2026 (this_month)
  const novemberFilter = (dateStr) => dateStr && dateStr.startsWith('2026-11');
  const novTop = computeTopFrequentMembers({ members, checkins, limit: 5, isDateInRange: novemberFilter });
  const novLow = computeLowActivityMembers({ members, checkins, threshold: 3, limit: 5, isDateInRange: novemberFilter });
  // In November: Member A has 1 visit, Member B has 2 visits
  assert.strictEqual(novTop.find(m => m.id === 'm1').visitCount, 1);
  assert.strictEqual(novTop.find(m => m.id === 'm2').visitCount, 2);
  // Both have < 3 visits in November, so both are included in low-activity with accurate counts
  assert.strictEqual(novLow.find(m => m.id === 'm1').visitCount, 1);
  assert.strictEqual(novLow.find(m => m.id === 'm2').visitCount, 2);
  // Invariant: Both widgets report identical counts under the period filter
  assert.strictEqual(novTop.find(m => m.id === 'm1').visitCount, novLow.find(m => m.id === 'm1').visitCount);
  assert.strictEqual(novTop.find(m => m.id === 'm2').visitCount, novLow.find(m => m.id === 'm2').visitCount);
});

test('13. Member identity consistency: memberId, memberCode fallback, and no double-counting', () => {
  const members = [
    { id: 'uuid-101', member_code: 'MEM-00101', name: 'Identity Test User', status: 'active', totalCheckins: 0 },
  ];

  // Records logged with varying identifier combinations
  const checkins = [
    // Standard record with UUID memberId
    { memberId: 'uuid-101', memberCode: 'MEM-00101', date: '2026-11-01', time: '08:00 AM', status: 'valid' },
    // Record where memberId is missing but memberCode is present
    { memberId: null, memberCode: 'MEM-00101', date: '2026-11-02', time: '08:30 AM', status: 'valid' },
    // Record where memberCode was mistakenly placed in memberId field
    { memberId: 'MEM-00101', memberCode: null, date: '2026-11-03', time: '09:00 AM', status: 'valid' },
    // Record with missing / null identifiers - must be skipped safely
    { memberId: null, memberCode: null, date: '2026-11-04', time: '09:30 AM', status: 'valid' },
    // Record for an unmatched member ID - must not pollute known members
    { memberId: 'uuid-999', memberCode: 'MEM-99999', date: '2026-11-05', time: '10:00 AM', status: 'valid' },
  ];

  const metrics = computeMemberAttendanceMetrics({ members, checkins });
  assert.strictEqual(metrics.length, 1);
  // 3 valid records for Identity Test User must be counted exactly once (no double counting, no missing)
  assert.strictEqual(metrics[0].visitCount, 3);
  assert.strictEqual(metrics[0].lastCheckinTime, '2026-11-03 (09:00 AM)');
});

test('14. Timestamp diversity and latest visit resolution across ISO, epoch, and local date/time', () => {
  const members = [
    { id: 'm1', name: 'Timestamp Test', status: 'active', totalCheckins: 0 },
  ];

  const checkins = [
    // Checkin 1: epoch timestamp for 2026-11-01
    { memberId: 'm1', date: '2026-11-01', checkedInAt: 1793491200000, status: 'valid' },
    // Checkin 2: ISO string for 2026-11-05
    { memberId: 'm1', date: '2026-11-05', time: '07:15 AM', checkedInAt: '2026-11-05T07:15:00+05:30', status: 'valid' },
    // Checkin 3: latest check-in date/time without checkedInAt
    { memberId: 'm1', date: '2026-11-09', time: '06:30 PM', status: 'valid' },
    // Checkin 4: cancelled check-in on 2026-11-12 - MUST NOT become latest
    { memberId: 'm1', date: '2026-11-12', time: '08:00 PM', checkedInAt: '2026-11-12T20:00:00+05:30', status: 'cancelled' },
  ];

  const metrics = computeMemberAttendanceMetrics({ members, checkins });
  assert.strictEqual(metrics[0].visitCount, 3);
  assert.strictEqual(metrics[0].lastCheckinTime, '2026-11-09 (06:30 PM)');
  assert.strictEqual(metrics[0].lastCheckinDate, '2026-11-09');
});

test('15. Robust handling of edge cases (empty inputs, null elements, missing fields)', () => {
  assert.deepStrictEqual(computeMemberAttendanceMetrics({ members: null, checkins: null }), []);
  assert.deepStrictEqual(computeTopFrequentMembers({ members: undefined, checkins: undefined }), []);
  assert.deepStrictEqual(computeLowActivityMembers({ members: [], checkins: [] }), []);

  const messyMembers = [
    null,
    undefined,
    { id: 'm1', name: 'Clean Member', status: 'active' },
  ];
  const messyCheckins = [
    null,
    undefined,
    { memberId: 'm1', status: 'valid', date: '2026-11-01' },
    { status: 'valid' }, // Missing memberId
  ];

  const top = computeTopFrequentMembers({ members: messyMembers, checkins: messyCheckins });
  assert.strictEqual(top.length, 1, 'Falsy/null members must be safely filtered out');
  assert.strictEqual(top[0].id, 'm1');
  assert.strictEqual(top[0].visitCount, 1);
});

