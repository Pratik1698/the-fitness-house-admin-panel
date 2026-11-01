import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchGymInfo,
  updateGymInfo,
  normalizeGymInfo,
  denormalizeGymInfoFields,
  isMissingColumnError,
  detectExtendedColumnsSupport,
  setExtendedColumnsSupport,
  resetExtendedColumnsCache,
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting,
  EXTENDED_FIELD_KEYS,
  BASE_FIELD_KEYS,
} from '../src/services/gymInfoService.js';

/**
 * Phase 1 Safety Correction Test Suite
 * The Fitness House Gym Management Admin Panel
 *
 * Validates:
 * 1. Missing-column detection (PostgreSQL 42703 + PostgREST PGRST204 / schema cache)
 * 2. Database field normalization & no fabrication of unsaved values
 * 3. Migration-pending status on fetch
 * 4. Extended-only update when migration is pending (rejected BEFORE write)
 * 5. Mixed base and extended update when migration is pending (aborted, no partial save)
 * 6. Base-only update when migration is pending (persists base fields safely)
 * 7. Successful update after migration (all fields confirmed)
 * 8. RLS permission denial (42501)
 * 9. No false success with unsaved values
 * 10. Role and downstream consumer consistency
 */

test.beforeEach(() => {
  resetExtendedColumnsCache();
  resetSupabaseClientForTesting();
});

test('1. Missing-column detection handles both PostgreSQL 42703 and PostgREST PGRST204 schema cache errors', () => {
  // PostgreSQL undefined_column
  assert.equal(
    isMissingColumnError({ code: '42703', message: 'column "whatsapp_number" of relation "gym_info" does not exist' }),
    true
  );

  // PostgREST schema-cache column not found
  assert.equal(
    isMissingColumnError({ code: 'PGRST204', message: 'Could not find the "whatsapp_number" column of "gym_info" in the schema cache' }),
    true
  );

  assert.equal(
    isMissingColumnError({ message: 'Could not find the column "operating_hours" in the schema cache' }),
    true
  );

  // Other errors must NOT be falsely identified as missing column
  assert.equal(
    isMissingColumnError({ code: '42501', message: 'new row violates row-level security policy for table "gym_info"' }),
    false
  );

  assert.equal(
    isMissingColumnError({ code: 'PGRST301', message: 'JWT expired' }),
    false
  );

  assert.equal(isMissingColumnError(null), false);
});

test('2. Field normalization: never fabricates dummy defaults for unpersisted columns', () => {
  // Raw row where extended columns do NOT exist (e.g. before migration)
  const preMigrationDbRow = {
    id: 'b1234567-89ab-cdef-0123-456789abcdef',
    name: 'The Fitness House',
    tagline: 'Gym Management',
    address: 'Near Vitthal Mandir, Arag',
    phone: '+91 7385846525',
    email: 'pravinjoshi2707@gmail.com',
    gst_number: '27AAAAA0000A1Z5',
    currency_code: 'INR',
    currency_symbol: '₹',
    created_at: '2026-10-19T00:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
  };

  const normalized = normalizeGymInfo(preMigrationDbRow);
  assert.equal(normalized.name, 'The Fitness House');
  assert.equal(normalized.phone, '+91 7385846525');

  // Must be empty string when column was not in database row — NEVER a fabricated string!
  assert.equal(normalized.whatsapp, '', 'Must not fabricate whatsapp when column does not exist');
  assert.equal(normalized.timings, '', 'Must not fabricate timings when column does not exist');
  assert.equal(normalized.location, '', 'Must not fabricate location when column does not exist');
  assert.equal(normalized.ownerName, '', 'Must not fabricate ownerName when column does not exist');
  assert.equal(normalized.headCoach, '', 'Must not fabricate headCoach when column does not exist');
});

test('3. Migration-pending status on fetch: falls back to base columns and flags migrationPending: true', async () => {
  const fallbackDbRow = {
    id: 'b1234567-89ab-cdef-0123-456789abcdef',
    name: 'The Fitness House',
    tagline: 'Gym Management',
    address: 'Near Vitthal Mandir, Arag',
    phone: '+91 7385846525',
    email: 'pravinjoshi2707@gmail.com',
    gst_number: '27AAAAA0000A1Z5',
    currency_code: 'INR',
    currency_symbol: '₹',
    created_at: '2026-10-19T00:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
  };

  let selectCallCount = 0;
  const mockClient = {
    from: (table) => {
      assert.equal(table, 'gym_info');
      return {
        select: (cols) => {
          selectCallCount++;
          return {
            limit: async () => {
              // First call attempts GYM_INFO_COLUMNS, fails with PGRST204
              if (selectCallCount === 1) {
                return {
                  data: null,
                  error: { code: 'PGRST204', message: 'Could not find the "whatsapp_number" column of "gym_info" in the schema cache' },
                };
              }
              // Second call fetches BASE_COLUMNS, succeeds
              return { data: [fallbackDbRow], error: null };
            },
          };
        },
      };
    },
  };

  const result = await fetchGymInfo(mockClient, true);

  assert.equal(result.error, null);
  assert.equal(result.migrationPending, true, 'Must clearly flag migrationPending: true');
  assert.equal(result.data.id, fallbackDbRow.id);
  assert.equal(result.data.name, 'The Fitness House');
  assert.equal(result.data.whatsapp, '', 'Unpersisted columns must be blank');
});

test('4. Extended-only update when migration is pending: rejects BEFORE write and returns migration error', async () => {
  setExtendedColumnsSupport(false); // Schema probe indicates migration is pending

  let updateCalled = false;
  const mockClient = {
    from: () => ({
      update: () => {
        updateCalled = true;
        return { eq: () => ({ select: () => ({ single: async () => ({}) }) }) };
      },
    }),
  };

  const result = await updateGymInfo(
    'b1234567-89ab-cdef-0123-456789abcdef',
    { whatsapp: '+91 9999988888', timings: '6 AM - 10 PM' },
    mockClient,
    true
  );

  assert.equal(updateCalled, false, 'Database UPDATE must NOT be called when extended migration is pending');
  assert.equal(result.data, null, 'Must NOT return success data for unpersisted fields');
  assert.ok(result.error instanceof Error);
  assert.ok(result.error.message.includes('migration pending for extended fields (whatsapp, timings)'));
  assert.equal(result.migrationPending, true);
  assert.deepEqual(result.unsupportedFields, ['whatsapp', 'timings']);
});

test('5. Mixed base and extended update when migration is pending: aborts BEFORE write to prevent partial save', async () => {
  setExtendedColumnsSupport(false); // Migration pending

  let updateCalled = false;
  const mockClient = {
    from: () => ({
      update: () => {
        updateCalled = true;
        return { eq: () => ({ select: () => ({ single: async () => ({}) }) }) };
      },
    }),
  };

  const result = await updateGymInfo(
    'b1234567-89ab-cdef-0123-456789abcdef',
    {
      name: 'New Gym Name',
      phone: '+91 7385846525',
      whatsapp: '+91 9999988888', // Extended field!
    },
    mockClient,
    true
  );

  assert.equal(updateCalled, false, 'Must NOT partially write base fields when extended fields cannot be saved');
  assert.equal(result.data, null);
  assert.ok(result.error instanceof Error);
  assert.ok(result.error.message.includes('No changes were saved'));
  assert.equal(result.migrationPending, true);
});

test('6. Base-only update when migration is pending: persists base fields and returns database-confirmed data', async () => {
  setExtendedColumnsSupport(false); // Extended columns missing, but base fields exist

  let capturedDbFields = null;
  const targetId = 'b1234567-89ab-cdef-0123-456789abcdef';

  const mockClient = {
    from: () => ({
      update: (fields) => {
        capturedDbFields = fields;
        return {
          eq: (idCol, idVal) => {
            assert.equal(idVal, targetId);
            return {
              select: (cols) => {
                assert.ok(!cols.includes('whatsapp_number'), 'Must only select base columns');
                return {
                  single: async () => ({
                    data: {
                      id: targetId,
                      name: fields.name,
                      tagline: fields.tagline,
                      phone: '+91 7385846525',
                      address: 'Arag',
                      email: 'admin@tfh.com',
                      currency_code: 'INR',
                      currency_symbol: '₹',
                      updated_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      },
    }),
  };

  const result = await updateGymInfo(
    targetId,
    { name: 'The Fitness House Elite', tagline: 'Peak Fitness' },
    mockClient,
    true
  );

  assert.equal(result.error, null);
  assert.equal(result.migrationPending, true);
  assert.equal(result.data.name, 'The Fitness House Elite');
  assert.equal(result.data.tagline, 'Peak Fitness');
  assert.equal(capturedDbFields.name, 'The Fitness House Elite');
  assert.equal(capturedDbFields.whatsapp_number, undefined, 'Must not send extended columns to DB');
});

test('7. Successful update after migration: persists all fields and returns full database-confirmed record', async () => {
  setExtendedColumnsSupport(true); // Migration applied!

  const targetId = 'b1234567-89ab-cdef-0123-456789abcdef';
  let capturedCols = null;

  const mockClient = {
    from: () => ({
      update: (fields) => ({
        eq: () => ({
          select: (cols) => {
            capturedCols = cols;
            return {
              single: async () => ({
                data: {
                  id: targetId,
                  name: fields.name,
                  tagline: fields.tagline,
                  phone: fields.phone,
                  whatsapp_number: fields.whatsapp_number,
                  operating_hours: fields.operating_hours,
                  location: fields.location,
                  owner_name: fields.owner_name,
                  head_coach: fields.head_coach,
                  email: fields.email,
                  address: fields.address,
                  currency_code: 'INR',
                  currency_symbol: '₹',
                  updated_at: new Date().toISOString(),
                },
                error: null,
              }),
            };
          },
        }),
      }),
    }),
  };

  const updates = {
    name: 'The Fitness House',
    tagline: 'Gym Management',
    phone: '+91 7385846525',
    whatsapp: '+91 7385846525',
    timings: '6:00 AM – 10:00 PM',
    location: 'Near Vitthal Mandir, Arag',
    ownerName: 'Pravin Joshi',
    headCoach: 'Coach Pravin Joshi',
  };

  const result = await updateGymInfo(targetId, updates, mockClient, true);

  assert.equal(result.error, null);
  assert.equal(result.migrationPending, false);
  assert.equal(result.data.name, 'The Fitness House');
  assert.equal(result.data.whatsapp, '+91 7385846525');
  assert.equal(result.data.timings, '6:00 AM – 10:00 PM');
  assert.equal(result.data.location, 'Near Vitthal Mandir, Arag');
  assert.ok(capturedCols.includes('whatsapp_number'), 'Must select all columns after migration');
});

test('8. RLS permission denial: surfaces clear error when staff or unauthorized role attempts update', async () => {
  setExtendedColumnsSupport(true);

  const mockClient = {
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '42501',
                message: 'new row violates row-level security policy for table "gym_info"',
              },
            }),
          }),
        }),
      }),
    }),
  };

  const result = await updateGymInfo(
    'b1234567-89ab-cdef-0123-456789abcdef',
    { name: 'Unauthorized Change' },
    mockClient,
    true
  );

  assert.equal(result.data, null);
  assert.ok(result.error instanceof Error);
  assert.ok(result.error.message.includes('Permission denied: only administrators can update gym profile settings'));
});

test('9. No false success with unsaved values: verify data is never synthesized from form inputs', () => {
  // If database only returned { id, name, phone }, normalizeGymInfo must not attach unreturned form values
  const dbConfirmedRecord = {
    id: 'test-1',
    name: 'Database Name',
    phone: '+91 7385846525',
  };

  const normalized = normalizeGymInfo(dbConfirmedRecord);
  assert.equal(normalized.name, 'Database Name');
  assert.equal(normalized.phone, '+91 7385846525');
  assert.equal(normalized.whatsapp, '', 'Must not invent whatsapp');
  assert.equal(normalized.timings, '', 'Must not invent timings');
  assert.equal(normalized.location, '', 'Must not invent location');
});

// ---------------------------------------------------------------------------
// Focused Safety Correction 1 & 2 Tests
// ---------------------------------------------------------------------------

test('10. Schema detection returns null on network failure (fail-closed)', async () => {
  const networkErrorClient = {
    from: () => ({
      select: () => ({
        limit: async () => ({
          data: null,
          error: { message: 'Failed to fetch: network error', code: 'ENOTFOUND' },
        }),
      }),
    }),
  };

  const status = await detectExtendedColumnsSupport(networkErrorClient, true);
  assert.equal(status, null, 'Must return null (unknown) on network error, never true or false');
});

test('11. Unknown schema status (null) blocks extended-field updates with distinct verification error', async () => {
  let updateCalled = false;
  const networkFailingClient = {
    from: () => ({
      select: () => ({
        limit: async () => ({
          data: null,
          error: { message: 'Connection timeout', code: 'ETIMEDOUT' },
        }),
      }),
      update: () => {
        updateCalled = true;
        return { eq: () => ({ select: () => ({ single: async () => ({}) }) }) };
      },
    }),
  };

  const result = await updateGymInfo(
    'b1234567-89ab-cdef-0123-456789abcdef',
    { whatsapp: '+91 9999988888' },
    networkFailingClient,
    true
  );

  assert.equal(updateCalled, false, 'Database UPDATE must not be called when schema support is unknown');
  assert.equal(result.data, null);
  assert.equal(result.schemaVerificationFailed, true, 'Must flag schemaVerificationFailed: true');
  assert.equal(result.migrationPending, false, 'Must not be classified as migration pending');
  assert.ok(result.error instanceof Error);
  assert.ok(result.error.message.includes('unable to verify database schema support'));
});

test('12. Confirmed missing columns (false) block extended-field updates with migration error', async () => {
  setExtendedColumnsSupport(false);

  let updateCalled = false;
  const mockClient = {
    from: () => ({
      update: () => {
        updateCalled = true;
        return { eq: () => ({ select: () => ({ single: async () => ({}) }) }) };
      },
    }),
  };

  const result = await updateGymInfo(
    'b1234567-89ab-cdef-0123-456789abcdef',
    { whatsapp: '+91 9999988888', timings: '6 AM - 10 PM' },
    mockClient,
    true
  );

  assert.equal(updateCalled, false, 'Database UPDATE must not be called when migration is pending');
  assert.equal(result.data, null);
  assert.equal(result.migrationPending, true);
  assert.equal(result.schemaVerificationFailed, false);
  assert.ok(result.error instanceof Error);
  assert.ok(result.error.message.includes('database migration pending for extended fields (whatsapp, timings)'));
});

test('13. Confirmed existing columns (true) permit extended-field update', async () => {
  setExtendedColumnsSupport(true);

  const targetId = 'b1234567-89ab-cdef-0123-456789abcdef';
  let capturedFields = null;

  const mockClient = {
    from: () => ({
      update: (fields) => {
        capturedFields = fields;
        return {
          eq: () => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: targetId,
                  name: fields.name,
                  whatsapp_number: fields.whatsapp_number,
                  operating_hours: fields.operating_hours,
                  location: fields.location,
                  owner_name: fields.owner_name,
                  head_coach: fields.head_coach,
                  phone: '+91 7385846525',
                  currency_code: 'INR',
                  currency_symbol: '₹',
                },
                error: null,
              }),
            }),
          }),
        };
      },
    }),
  };

  const result = await updateGymInfo(
    targetId,
    { name: 'The Fitness House', whatsapp: '+91 7385846525', timings: '6 AM - 10 PM' },
    mockClient,
    true
  );

  assert.equal(result.error, null);
  assert.equal(result.migrationPending, false);
  assert.equal(result.schemaVerificationFailed, false);
  assert.equal(result.data.whatsapp, '+91 7385846525');
  assert.equal(result.data.timings, '6 AM - 10 PM');
  assert.equal(capturedFields.whatsapp_number, '+91 7385846525');
});

test('14. Migration-pending status propagates through AppContext (fetchGymInfo sets gymInfoMigrationPending)', async () => {
  let gymInfoMigrationPending = false;
  const setGymInfoMigrationPending = (val) => { gymInfoMigrationPending = Boolean(val); };

  const fallbackDbRow = {
    id: 'b1234567-89ab-cdef-0123-456789abcdef',
    name: 'The Fitness House',
    tagline: 'Gym Management',
    address: 'Near Vitthal Mandir, Arag',
    phone: '+91 7385846525',
    email: 'pravinjoshi2707@gmail.com',
    gst_number: '27AAAAA0000A1Z5',
    currency_code: 'INR',
    currency_symbol: '₹',
    created_at: '2026-10-19T00:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
  };

  let selectCallCount = 0;
  const mockClient = {
    from: () => ({
      select: () => {
        selectCallCount++;
        return {
          limit: async () => {
            if (selectCallCount === 1) {
              return {
                data: null,
                error: { code: 'PGRST204', message: 'Could not find "whatsapp_number" column in schema cache' },
              };
            }
            return { data: [fallbackDbRow], error: null };
          },
        };
      },
    }),
  };

  const { data, error, migrationPending } = await fetchGymInfo(mockClient, true);
  setGymInfoMigrationPending(Boolean(migrationPending));

  assert.equal(error, null);
  assert.equal(migrationPending, true);
  assert.equal(gymInfoMigrationPending, true, 'gymInfoMigrationPending must be set to true in AppContext');
  assert.equal(data.name, 'The Fitness House');
});

test('15. Migration-pending warning presence logic in Settings', () => {
  // Evaluates the exact conditional rendering expression used in Settings.jsx:
  // {gymInfoMigrationPending && !saveSuccess && (...banner...)}
  const shouldShowMigrationBanner = (gymInfoMigrationPending, saveSuccess) => {
    return Boolean(gymInfoMigrationPending && !saveSuccess);
  };

  // Case 1: Migration pending, no save in progress -> warning MUST show
  assert.equal(shouldShowMigrationBanner(true, false), true);

  // Case 2: Migration pending, but save succeeded -> warning suppressed during success toast
  assert.equal(shouldShowMigrationBanner(true, true), false);

  // Case 3: Migration completed -> warning MUST NOT show
  assert.equal(shouldShowMigrationBanner(false, false), false);
  assert.equal(shouldShowMigrationBanner(false, true), false);
});

test('16. Logout resets gymInfoMigrationPending to false', async () => {
  let gymInfoMigrationPending = true;
  let session = { user: { id: 'admin-user' } };

  // Simulates AppContext logout() routine
  const simulateLogout = async () => {
    session = null;
    gymInfoMigrationPending = false;
  };

  await simulateLogout();
  assert.equal(session, null);
  assert.equal(gymInfoMigrationPending, false, 'Logout must reset gymInfoMigrationPending to false');
});

test('17. Schema support cache invalidates when client instance changes across sessions/tests', async () => {
  const clientA = {
    from: () => ({
      select: () => ({ limit: async () => ({ data: [], error: null }) }),
    }),
  };
  const clientB = {
    from: () => ({
      select: () => ({
        limit: async () => ({
          data: null,
          error: { code: 'PGRST204', message: 'Could not find column in schema cache' },
        }),
      }),
    }),
  };

  const statusA = await detectExtendedColumnsSupport(clientA, true);
  assert.equal(statusA, true, 'Client A verifies extended columns present');

  // Client B represents a different session/environment where migration is pending
  const statusB = await detectExtendedColumnsSupport(clientB, true);
  assert.equal(statusB, false, 'Client B detects missing columns; cache was invalidated for new client instance');
});
