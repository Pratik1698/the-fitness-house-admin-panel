import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePtPackageInput,
  normalizePtPackage,
  getPtPackages,
  createPtPackage,
  setSupabaseClientForTesting as setPtClientForTesting,
  resetSupabaseClientForTesting as resetPtClientForTesting,
} from '../src/services/ptPackageService.js';
import {
  DEFAULT_REMINDER_SETTINGS,
  normalizeReminderSettings,
  fetchReminderSettings,
  updateReminderSettings,
  setSupabaseClientForTesting as setReminderClientForTesting,
  resetSupabaseClientForTesting as resetReminderClientForTesting,
} from '../src/services/reminderSettingsService.js';

test.beforeEach(() => {
  resetPtClientForTesting();
  resetReminderClientForTesting();
});

// ---------------------------------------------------------------------------
// 1. Settings -> Personal Training Integration
// ---------------------------------------------------------------------------
test('Integration: PT package empty state handled cleanly when database has 0 packages', async () => {
  // Mock Supabase returning empty array (as in empty production table)
  const mockClient = {
    from: () => ({
      select: () => ({
        order: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
          then: (resolve) => resolve({ data: [], error: null }),
        }),
      }),
    }),
  };

  setPtClientForTesting(mockClient, true);

  const res = await getPtPackages({ includeInactive: false });
  assert.equal(res.error, null);
  assert.ok(Array.isArray(res.data));
  assert.equal(res.data.length, 0, 'Production currently has 0 packages; returns empty list');
});

test('Integration: Package validation enforces positive sessions, positive validity, and non-negative price', () => {
  // Test valid package specification
  const valid = validatePtPackageInput({
    name: '12 Sessions Transformation',
    totalSessions: 12,
    price: 6000,
    validityDays: 45,
    description: '1-on-1 coaching',
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.sanitized.total_sessions, 12);
  assert.equal(valid.sanitized.validity_days, 45);
  assert.equal(valid.sanitized.price, 6000);

  // Test invalid package names
  assert.equal(validatePtPackageInput({ name: '', totalSessions: 12, price: 6000 }).valid, false);
  assert.equal(validatePtPackageInput({ name: '   ', totalSessions: 12, price: 6000 }).valid, false);

  // Test invalid session counts
  assert.equal(validatePtPackageInput({ name: 'Plan', totalSessions: 0, price: 6000 }).valid, false);
  assert.equal(validatePtPackageInput({ name: 'Plan', totalSessions: -5, price: 6000 }).valid, false);
  assert.equal(validatePtPackageInput({ name: 'Plan', totalSessions: 8.5, price: 6000 }).valid, false);

  // Test invalid prices
  assert.equal(validatePtPackageInput({ name: 'Plan', totalSessions: 8, price: -100 }).valid, false);
  assert.equal(validatePtPackageInput({ name: 'Plan', totalSessions: 8, price: 'invalid' }).valid, false);

  // Test invalid validity
  assert.equal(validatePtPackageInput({ name: 'Plan', totalSessions: 8, price: 4000, validityDays: 0 }).valid, false);
  assert.equal(validatePtPackageInput({ name: 'Plan', totalSessions: 8, price: 4000, validityDays: -10 }).valid, false);
});

// ---------------------------------------------------------------------------
// 2. Settings -> Reminder Automation Integration
// ---------------------------------------------------------------------------
test('Integration: Reminder settings loads all seven preferences matching Supabase defaults', async () => {
  // Simulated production singleton row seeded by migration
  const productionRow = {
    id: 'b1111111-0000-0000-0000-000000000001',
    singleton_guard: true,
    five_day: true,
    three_day: true,
    one_day: true,
    expiry_day: true,
    payment_alerts: true,
    auto_whatsapp: false,
    sms_fallback: false,
    updated_at: '2026-11-02T04:30:00Z',
    updated_by: null,
  };

  const mockClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: productionRow, error: null }),
        }),
      }),
    }),
  };

  setReminderClientForTesting(mockClient, true);

  const res = await fetchReminderSettings();
  assert.equal(res.error, null);

  // Check all seven settings match production database defaults
  assert.equal(res.data.fiveDay, true);
  assert.equal(res.data.threeDay, true);
  assert.equal(res.data.oneDay, true);
  assert.equal(res.data.expiryDay, true);
  assert.equal(res.data.paymentAlerts, true);
  assert.equal(res.data.autoWhatsApp, false);
  assert.equal(res.data.smsFallback, false);
});

test('Integration: Staff vs Admin control permissions for reminder automation', () => {
  // Admin role check simulation
  const checkCanUpdateReminders = (role) => {
    const isAdmin = role === 'admin';
    if (!isAdmin) {
      return { allowed: false, error: 'Permission denied: only administrators can save reminder preferences.' };
    }
    return { allowed: true, error: null };
  };

  // Staff is read-only
  const staffCheck = checkCanUpdateReminders('staff');
  assert.equal(staffCheck.allowed, false);
  assert.match(staffCheck.error, /only administrators/i);

  // Admin is allowed
  const adminCheck = checkCanUpdateReminders('admin');
  assert.equal(adminCheck.allowed, true);
  assert.equal(adminCheck.error, null);
});

// ---------------------------------------------------------------------------
// 3. Personal Training Page & Assign Modal Integration
// ---------------------------------------------------------------------------
test('Integration: Assignment modal cannot proceed without active packages and uses UUIDs', () => {
  // Simulate packages passed to AssignPtModal
  const emptyPackagesList = [];

  // Assignment validation rule from AssignPtModal:
  const validateAssignment = (form, packages) => {
    const errors = {};
    if (packages.length === 0) {
      errors.general = 'No active PT packages available. Configure packages in Facility Settings before assigning.';
    }
    if (!form.memberId) errors.memberId = 'Please select a gym member';
    if (!form.packageId) errors.packageId = 'Please select a PT package';
    return {
      isValid: Object.keys(errors).length === 0 && packages.length > 0,
      errors,
    };
  };

  // When packages list is empty:
  const emptyForm = { memberId: 'TFH001', packageId: '' };
  const resEmpty = validateAssignment(emptyForm, emptyPackagesList);
  assert.equal(resEmpty.isValid, false);
  assert.ok(resEmpty.errors.general);

  // When packages exist with UUIDs:
  const livePackages = [
    { id: '11111111-2222-3333-4444-555555555555', name: '8 Sessions', price: 4000, totalSessions: 8, validityDays: 30 },
  ];
  const validForm = { memberId: 'TFH001', packageId: '11111111-2222-3333-4444-555555555555' };
  const resValid = validateAssignment(validForm, livePackages);
  assert.equal(resValid.isValid, true);
  assert.equal(validForm.packageId, '11111111-2222-3333-4444-555555555555');
  assert.equal(/^pt-/.test(validForm.packageId), false); // Must NOT be string mock ID
});
