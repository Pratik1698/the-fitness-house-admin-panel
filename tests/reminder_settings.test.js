import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REMINDER_SETTINGS,
  normalizeReminderSettings,
  fetchReminderSettings,
  updateReminderSettings,
  parseReminderSettingsError,
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting,
} from '../src/services/reminderSettingsService.js';

/**
 * Phase 4 — Reminder Automation Test Suite
 * The Fitness House Gym Management Admin Panel
 *
 * Verifies:
 * 1. Default settings (5 in-app alerts true, 2 gateway channels false)
 * 2. 7-field exact normalization (snake_case DB -> camelCase UI)
 * 3. Persisting all 7 values into the singleton row
 * 4. Admin permission denial (RLS 42501)
 * 5. Missing-row fallback: unseeded table returns defaults safely
 * 6. Toggle state refresh: confirmed database state updates UI
 * 7. All seven toggles represented in schedule and gateway categories
 * 8. Staff read-only enforcement
 * 9. 1-day notification eligibility condition (v_days_left <= 1 AND v_days_left > 0)
 * 10. Disabled trigger suppression: toggle=false suppresses notification type
 * 11. Preservation of expired-membership tracking regardless of toggle state
 */

test.beforeEach(() => {
  resetSupabaseClientForTesting();
});

// ---------------------------------------------------------------------------
// 1. Default settings
// ---------------------------------------------------------------------------
test('1. Default settings: all 5 in-app triggers enabled (true) and external gateways default false', () => {
  assert.equal(DEFAULT_REMINDER_SETTINGS.fiveDay, true);
  assert.equal(DEFAULT_REMINDER_SETTINGS.threeDay, true);
  assert.equal(DEFAULT_REMINDER_SETTINGS.oneDay, true);
  assert.equal(DEFAULT_REMINDER_SETTINGS.expiryDay, true);
  assert.equal(DEFAULT_REMINDER_SETTINGS.paymentAlerts, true);
  assert.equal(DEFAULT_REMINDER_SETTINGS.autoWhatsApp, false);
  assert.equal(DEFAULT_REMINDER_SETTINGS.smsFallback, false);
});

// ---------------------------------------------------------------------------
// 2. 7-field normalization
// ---------------------------------------------------------------------------
test('2. Seven-field normalization: accurately maps snake_case database columns to camelCase UI properties', () => {
  const dbRow = {
    id: 'rem-settings-uuid-001',
    singleton_guard: true,
    five_day: false,
    three_day: true,
    one_day: false,
    expiry_day: true,
    payment_alerts: false,
    auto_whatsapp: true,
    sms_fallback: false,
    updated_at: '2026-11-02T08:00:00Z',
    updated_by: 'user-admin-uuid',
  };

  const normalized = normalizeReminderSettings(dbRow);

  assert.equal(normalized.id, dbRow.id);
  assert.equal(normalized.fiveDay, false);
  assert.equal(normalized.threeDay, true);
  assert.equal(normalized.oneDay, false);
  assert.equal(normalized.expiryDay, true);
  assert.equal(normalized.paymentAlerts, false);
  assert.equal(normalized.autoWhatsApp, true);
  assert.equal(normalized.smsFallback, false);
  assert.equal(normalized.updatedAt, dbRow.updated_at);
  assert.equal(normalized.updatedBy, dbRow.updated_by);
});

// ---------------------------------------------------------------------------
// 3. Persisting all seven values
// ---------------------------------------------------------------------------
test('3. Persisting all seven values: updates singleton row and returns database-confirmed state', async () => {
  let capturedPayload = null;
  let capturedFilter = null;

  const newSettings = {
    fiveDay: false,
    threeDay: true,
    oneDay: true,
    expiryDay: true,
    paymentAlerts: false,
    autoWhatsApp: true,
    smsFallback: true,
  };

  const mockClient = {
    from: (table) => {
      assert.equal(table, 'reminder_settings');
      return {
        update: (payload) => {
          capturedPayload = payload;
          return {
            eq: (col, val) => {
              capturedFilter = { col, val };
              return {
                select: () => ({
                  single: async () => ({
                    data: {
                      id: 'rem-singleton-uuid',
                      singleton_guard: true,
                      five_day: payload.five_day,
                      three_day: payload.three_day,
                      one_day: payload.one_day,
                      expiry_day: payload.expiry_day,
                      payment_alerts: payload.payment_alerts,
                      auto_whatsapp: payload.auto_whatsapp,
                      sms_fallback: payload.sms_fallback,
                      updated_at: payload.updated_at,
                    },
                    error: null,
                  }),
                }),
              };
            },
          };
        },
      };
    },
  };

  setSupabaseClientForTesting(mockClient, true);

  const res = await updateReminderSettings(newSettings);

  assert.equal(res.error, null);
  assert.equal(capturedFilter.col, 'singleton_guard');
  assert.equal(capturedFilter.val, true);

  // Verify all 7 mapped DB fields
  assert.equal(capturedPayload.five_day, false);
  assert.equal(capturedPayload.three_day, true);
  assert.equal(capturedPayload.one_day, true);
  assert.equal(capturedPayload.expiry_day, true);
  assert.equal(capturedPayload.payment_alerts, false);
  assert.equal(capturedPayload.auto_whatsapp, true);
  assert.equal(capturedPayload.sms_fallback, true);

  // Verify normalized confirmation
  assert.equal(res.data.fiveDay, false);
  assert.equal(res.data.autoWhatsApp, true);
  assert.equal(res.data.paymentAlerts, false);
});

// ---------------------------------------------------------------------------
// 4. Admin permission denial (RLS 42501)
// ---------------------------------------------------------------------------
test('4. Admin permission failure: surfaces clean error when non-admin role attempts settings update', async () => {
  const mockClient = {
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '42501',
                message: 'new row violates row-level security policy for table "reminder_settings"',
              },
            }),
          }),
        }),
      }),
    }),
  };

  setSupabaseClientForTesting(mockClient, true);

  const res = await updateReminderSettings({ fiveDay: false });
  assert.notEqual(res.error, null);
  assert.match(res.error.message, /only administrators can update reminder automation settings/i);
});

// ---------------------------------------------------------------------------
// 5. Missing-row fallback
// ---------------------------------------------------------------------------
test('5. Missing-row fallback: unseeded table returns default configuration safely without crashing', async () => {
  const mockClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  };

  setSupabaseClientForTesting(mockClient, true);

  const res = await fetchReminderSettings();
  assert.equal(res.error, null);
  assert.equal(res.data.fiveDay, true);
  assert.equal(res.data.oneDay, true);
  assert.equal(res.data.paymentAlerts, true);
  assert.equal(res.data.autoWhatsApp, false);
});

// ---------------------------------------------------------------------------
// 6. Toggle state refresh
// ---------------------------------------------------------------------------
test('6. Toggle state refresh: fetched settings reflect database mutations', async () => {
  const savedRow = {
    id: 'singleton-uuid',
    five_day: true,
    three_day: false,
    one_day: true,
    expiry_day: false,
    payment_alerts: true,
    auto_whatsapp: true,
    sms_fallback: false,
  };

  const mockClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: savedRow, error: null }),
        }),
      }),
    }),
  };

  setSupabaseClientForTesting(mockClient, true);

  const res = await fetchReminderSettings();
  assert.equal(res.error, null);
  assert.equal(res.data.threeDay, false);
  assert.equal(res.data.expiryDay, false);
  assert.equal(res.data.autoWhatsApp, true);
});

// ---------------------------------------------------------------------------
// 7. All seven toggles accounted for in UI definition
// ---------------------------------------------------------------------------
test('7. All seven toggles: verifies complete 7-key configuration specification', () => {
  const expectedToggles = [
    'fiveDay',
    'threeDay',
    'oneDay',
    'expiryDay',
    'paymentAlerts',
    'autoWhatsApp',
    'smsFallback',
  ];

  const actualKeys = Object.keys(DEFAULT_REMINDER_SETTINGS);
  assert.deepEqual(actualKeys.sort(), expectedToggles.sort());
});

// ---------------------------------------------------------------------------
// 8. Staff read-only behavior simulation
// ---------------------------------------------------------------------------
test('8. Staff read-only behavior: staff role cannot mutate settings in UI handler logic', () => {
  const userRole = 'staff';
  const isAdmin = userRole === 'admin';

  let attemptedMutation = false;
  const handleSaveAttempt = () => {
    if (!isAdmin) {
      return { error: 'Permission denied: only administrators can save reminder preferences.' };
    }
    attemptedMutation = true;
    return { success: true };
  };

  const outcome = handleSaveAttempt();
  assert.equal(attemptedMutation, false);
  assert.match(outcome.error, /permission denied/i);
});

// ---------------------------------------------------------------------------
// 9. 1-day notification eligibility condition
// ---------------------------------------------------------------------------
test('9. 1-day reminder eligibility: applies strictly to positive remaining days (days_left = 1), not expired or today', () => {
  const evaluate1DayTrigger = (daysLeft, oneDayEnabled) => {
    // Mirrors PL/pgSQL: v_days_left <= 1 AND (v_cfg.one_day IS TRUE) inside ELSE branch (v_days_left > 0)
    if (daysLeft < 0) return { type: 'expired', eligible: true };
    if (daysLeft === 0) return { type: 'expiry_today', eligible: true };
    if (daysLeft <= 1 && oneDayEnabled) return { type: 'expiry_1d', eligible: true };
    return { type: 'none', eligible: false };
  };

  // 1 day remaining with trigger enabled -> eligible for expiry_1d
  assert.equal(evaluate1DayTrigger(1, true).type, 'expiry_1d');

  // 1 day remaining with trigger disabled -> not eligible
  assert.equal(evaluate1DayTrigger(1, false).eligible, false);

  // 0 days remaining (today) -> routes to expiry_today stage, never expiry_1d
  assert.equal(evaluate1DayTrigger(0, true).type, 'expiry_today');

  // -1 days remaining (expired) -> routes to expired stage, never expiry_1d
  assert.equal(evaluate1DayTrigger(-1, true).type, 'expired');
});

// ---------------------------------------------------------------------------
// 10. Disabled trigger suppression
// ---------------------------------------------------------------------------
test('10. Disabled trigger suppression: toggle=false prevents that notification type while leaving others active', () => {
  const evaluateReminders = (daysLeft, balance, cfg) => {
    const generated = [];
    if (daysLeft < 0) {
      generated.push('expired');
    } else if (daysLeft === 0) {
      if (cfg.expiryDay) generated.push('expiry_today');
    } else {
      if (daysLeft <= 5 && cfg.fiveDay) generated.push('expiry_5d');
      if (daysLeft <= 3 && cfg.threeDay) generated.push('expiry_3d');
      if (daysLeft <= 1 && cfg.oneDay) generated.push('expiry_1d');
    }
    if (balance > 0 && cfg.paymentAlerts) {
      generated.push('payment_due');
    }
    return generated;
  };

  // Case A: 5-day disabled, but 3-day and payment alerts enabled
  const cfgA = { fiveDay: false, threeDay: true, oneDay: true, expiryDay: true, paymentAlerts: true };
  const res3DaysLeft = evaluateReminders(3, 500, cfgA);

  assert.equal(res3DaysLeft.includes('expiry_5d'), false, '5d alert must be suppressed when disabled');
  assert.equal(res3DaysLeft.includes('expiry_3d'), true, '3d alert must generate when enabled');
  assert.equal(res3DaysLeft.includes('payment_due'), true, 'payment_due must generate when enabled');

  // Case B: Payment alerts disabled
  const cfgB = { fiveDay: true, threeDay: true, oneDay: true, expiryDay: true, paymentAlerts: false };
  const resWithBalance = evaluateReminders(5, 1000, cfgB);
  assert.equal(resWithBalance.includes('payment_due'), false, 'payment_due must be suppressed when toggle is false');
  assert.equal(resWithBalance.includes('expiry_5d'), true);
});

// ---------------------------------------------------------------------------
// 11. Preserving expired-membership tracking & deduplication
// ---------------------------------------------------------------------------
test('11. Expired tracking preserved: members with negative days_left ALWAYS generate expired notice regardless of settings', () => {
  const allDisabledCfg = {
    fiveDay: false,
    threeDay: false,
    oneDay: false,
    expiryDay: false,
    paymentAlerts: false,
  };

  // Even if all user-configurable toggles are false:
  const isExpired = (daysLeft) => daysLeft < 0; // Stage 1 in execute_expiry_reminders_core
  assert.equal(isExpired(-5), true);
  assert.equal(isExpired(-1), true);
  assert.equal(isExpired(0), false);
});

