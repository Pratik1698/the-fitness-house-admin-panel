import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLocalDateString,
  getDaysDifference,
  formatDaysRemainingLabel,
  calculateNotificationDaysRemaining,
} from '../src/utils/memberUtils.js';

test('1. Date calculation: October 22, 2026 -> October 26, 2026 yields exactly 4 days remaining', () => {
  const baseDate = '2026-10-22';
  const targetDate = '2026-10-26';

  const daysDiff = getDaysDifference(targetDate, baseDate);
  assert.equal(daysDiff, 4, 'Day difference between 2026-10-22 and 2026-10-26 must be 4');

  const label = formatDaysRemainingLabel(daysDiff);
  assert.equal(label, '4 days remaining', 'UI copy must display "4 days remaining"');

  const item = {
    id: 'notif-1',
    targetDate: '2026-10-26',
    daysRemaining: 5, // Stale historical snapshot stored at reminder creation
  };
  const dynamicDays = calculateNotificationDaysRemaining(item, baseDate);
  assert.equal(dynamicDays, 4, 'Dynamic calculation must override stale stored value (5) with 4');
  assert.equal(formatDaysRemainingLabel(dynamicDays), '4 days remaining');
});

test('2. Date calculation: Expiry date itself (October 26, 2026 -> October 26, 2026) yields 0 days and "Expires Today"', () => {
  const baseDate = '2026-10-26';
  const targetDate = '2026-10-26';

  const daysDiff = getDaysDifference(targetDate, baseDate);
  assert.equal(daysDiff, 0, 'Day difference on the expiry date itself must be 0');

  const label = formatDaysRemainingLabel(daysDiff);
  assert.equal(label, 'Expires Today', 'UI copy on expiry date must display "Expires Today"');

  const item = {
    id: 'notif-2',
    targetDate: '2026-10-26',
    daysRemaining: 5,
  };
  const dynamicDays = calculateNotificationDaysRemaining(item, baseDate);
  assert.equal(dynamicDays, 0, 'On expiry date, calculated remaining days must be 0');
  assert.equal(formatDaysRemainingLabel(dynamicDays), 'Expires Today');
});

test('3. Date calculation: Already expired membership (e.g. October 20, 2026 relative to October 22, 2026) yields -2 and "Expired 2d ago"', () => {
  const baseDate = '2026-10-22';
  const targetDate = '2026-10-20';

  const daysDiff = getDaysDifference(targetDate, baseDate);
  assert.equal(daysDiff, -2, 'Day difference for past expiry date must be negative (-2)');

  const label = formatDaysRemainingLabel(daysDiff);
  assert.equal(label, 'Expired 2d ago', 'UI copy for expired membership must display "Expired 2d ago"');

  const item = {
    id: 'notif-3',
    targetDate: '2026-10-20',
    daysRemaining: 0,
  };
  const dynamicDays = calculateNotificationDaysRemaining(item, baseDate);
  assert.equal(dynamicDays, -2);
  assert.equal(formatDaysRemainingLabel(dynamicDays), 'Expired 2d ago');
});

test('4. Date calculation: 1 day expired (e.g. October 25, 2026 on October 26, 2026) yields -1 and "Expired 1d ago"', () => {
  const baseDate = '2026-10-26';
  const targetDate = '2026-10-25';

  const daysDiff = getDaysDifference(targetDate, baseDate);
  assert.equal(daysDiff, -1);
  assert.equal(formatDaysRemainingLabel(daysDiff), 'Expired 1d ago');
});

test('5. Timezone handling: getLocalDateString formats accurately in Asia/Kolkata across UTC day boundaries', () => {
  // 18:29:00 UTC on Oct 22 is 23:59:00 IST on Oct 22 (before midnight)
  const preMidnightUtc = new Date('2026-10-22T18:29:00Z');
  assert.equal(getLocalDateString(preMidnightUtc), '2026-10-22', 'Pre-midnight in IST must be 2026-10-22');

  // 18:31:00 UTC on Oct 22 is 00:01:00 IST on Oct 23 (after midnight in Kolkata)
  const postMidnightUtc = new Date('2026-10-22T18:31:00Z');
  assert.equal(getLocalDateString(postMidnightUtc), '2026-10-23', 'Post-midnight in IST must advance to 2026-10-23');

  // Passing already-formatted YYYY-MM-DD string returns identity safely
  assert.equal(getLocalDateString('2026-10-22'), '2026-10-22');
});

test('6. Midnight rollover simulation: Days remaining dynamically updates from 4 to 3 when midnight passes in Asia/Kolkata', () => {
  const expiryDate = '2026-10-26';
  const item = { targetDate: expiryDate, daysRemaining: 5 };

  // Before midnight IST on Oct 22
  const dateBeforeMidnight = getLocalDateString(new Date('2026-10-22T18:20:00Z')); // 23:50 IST
  assert.equal(dateBeforeMidnight, '2026-10-22');
  const daysBefore = calculateNotificationDaysRemaining(item, dateBeforeMidnight);
  assert.equal(daysBefore, 4);
  assert.equal(formatDaysRemainingLabel(daysBefore), '4 days remaining');

  // After midnight IST on Oct 23
  const dateAfterMidnight = getLocalDateString(new Date('2026-10-22T18:35:00Z')); // 00:05 IST Oct 23
  assert.equal(dateAfterMidnight, '2026-10-23');
  const daysAfter = calculateNotificationDaysRemaining(item, dateAfterMidnight);
  assert.equal(daysAfter, 3);
  assert.equal(formatDaysRemainingLabel(daysAfter), '3 days remaining');
});

test('7. Fallback handling: notification without target date gracefully retains daysRemaining or null', () => {
  const itemWithoutDate = { daysRemaining: 2 };
  assert.equal(calculateNotificationDaysRemaining(itemWithoutDate, '2026-10-22'), 2);

  const itemNull = { daysRemaining: null };
  assert.equal(calculateNotificationDaysRemaining(itemNull, '2026-10-22'), null);
  assert.equal(formatDaysRemainingLabel(null), null);
});
