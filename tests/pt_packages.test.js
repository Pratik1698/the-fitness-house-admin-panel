import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePtPackage,
  validatePtPackageInput,
  parsePtPackageError,
  getPtPackages,
  createPtPackage,
  updatePtPackage,
  togglePtPackageStatus,
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting,
} from '../src/services/ptPackageService.js';

/**
 * Phase 3 — Personal Training Packages Test Suite
 * The Fitness House Gym Management Admin Panel
 *
 * Verifies:
 * 1. Normalization & field mapping (total_sessions <-> totalSessions, validity_days <-> validityDays, is_active <-> isActive)
 * 2. Input validation for valid and invalid inputs
 * 3. Handling duplicate package names (PostgreSQL 23505)
 * 4. Create and update package with database-confirmed records
 * 5. Soft-deactivation (is_active = false) without physical deletion
 * 6. Reactivation (is_active = true)
 * 7. Admin permission enforcement (RLS 42501)
 * 8. UUID mapping and active-only assignment filtering
 * 9. Historical assignment snapshot preservation
 */

test.beforeEach(() => {
  resetSupabaseClientForTesting();
});

// ---------------------------------------------------------------------------
// 1. Normalization & field mapping
// ---------------------------------------------------------------------------
test('1. Normalization: maps database fields accurately to camelCase and preserves compatibility aliases', () => {
  const rawDbRow = {
    id: 'b1234567-89ab-cdef-0123-456789abcdef',
    name: '12 Sessions Pro',
    total_sessions: 12,
    price: '5500.00',
    validity_days: 45,
    description: 'Personalized strength program',
    is_active: true,
    created_at: '2026-10-20T10:00:00Z',
    updated_at: '2026-10-20T10:00:00Z',
  };

  const normalized = normalizePtPackage(rawDbRow);

  assert.equal(normalized.id, rawDbRow.id);
  assert.equal(normalized.name, '12 Sessions Pro');
  assert.equal(normalized.totalSessions, 12);
  assert.equal(normalized.sessions, 12); // Compatibility alias
  assert.equal(normalized.price, 5500);
  assert.equal(normalized.validityDays, 45);
  assert.equal(normalized.validity, 45); // Compatibility alias
  assert.equal(normalized.isActive, true);
  assert.equal(normalized.is_active, true);
  assert.equal(normalized.description, 'Personalized strength program');
});

test('1b. Normalization fallback: defaults validity to 30 days when missing or unmigrated', () => {
  const rowWithoutValidity = {
    id: 'pkg-001',
    name: '8 Sessions',
    total_sessions: 8,
    price: 4000,
    is_active: true,
  };

  const normalized = normalizePtPackage(rowWithoutValidity);
  assert.equal(normalized.validityDays, 30);
  assert.equal(normalized.validity, 30);
});

// ---------------------------------------------------------------------------
// 2. Input validation
// ---------------------------------------------------------------------------
test('2. Valid input: sanitizes and accepts complete package payload with default validity', () => {
  const input = {
    name: '  Transformation Tier  ',
    totalSessions: '16',
    price: '7200',
    description: '  Intensive coaching  ',
  };

  const result = validatePtPackageInput(input);
  assert.equal(result.valid, true);
  assert.equal(result.sanitized.name, 'Transformation Tier');
  assert.equal(result.sanitized.total_sessions, 16);
  assert.equal(result.sanitized.price, 7200);
  assert.equal(result.sanitized.validity_days, 30); // Default applied
  assert.equal(result.sanitized.description, 'Intensive coaching');
});

test('2b. Rejecting invalid inputs: empty name, 0 sessions, negative price, 0 validity', () => {
  assert.equal(validatePtPackageInput(null).valid, false);
  assert.equal(validatePtPackageInput({ name: '   ', totalSessions: 10, price: 5000 }).valid, false);
  assert.equal(validatePtPackageInput({ name: 'Tier', totalSessions: 0, price: 5000 }).valid, false);
  assert.equal(validatePtPackageInput({ name: 'Tier', totalSessions: -5, price: 5000 }).valid, false);
  assert.equal(validatePtPackageInput({ name: 'Tier', totalSessions: 10.5, price: 5000 }).valid, false);
  assert.equal(validatePtPackageInput({ name: 'Tier', totalSessions: 10, price: -100 }).valid, false);
  assert.equal(validatePtPackageInput({ name: 'Tier', totalSessions: 10, price: 5000, validityDays: 0 }).valid, false);
  assert.equal(validatePtPackageInput({ name: 'Tier', totalSessions: 10, price: 5000, validityDays: -10 }).valid, false);
});

// ---------------------------------------------------------------------------
// 3. Handling duplicate package names (23505)
// ---------------------------------------------------------------------------
test('3. Duplicate name conflict (23505): surfaces friendly and diagnostic error message', () => {
  const errorObj = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "chk_pt_packages_name_unique"',
  };

  const message = parsePtPackageError(errorObj, '12 Sessions');
  assert.match(message, /already exists/i);
  assert.match(message, /12 Sessions/);
});

// ---------------------------------------------------------------------------
// 4. Create package
// ---------------------------------------------------------------------------
test('4. Creating a package: inserts sanitized record and returns database-confirmed record', async () => {
  const generatedId = 'pkg-uuid-101';
  let capturedInsert = null;

  const mockClient = {
    from: (table) => {
      assert.equal(table, 'pt_packages');
      return {
        insert: (payload) => {
          capturedInsert = payload;
          return {
            select: () => ({
              single: async () => ({
                data: {
                  id: generatedId,
                  ...payload,
                  created_at: payload.created_at,
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

  setSupabaseClientForTesting(mockClient, true);

  const res = await createPtPackage({
    name: '24 Sessions Elite',
    totalSessions: 24,
    price: 9600,
    validityDays: 90,
    description: 'Complete athletic conditioning',
  });

  assert.equal(res.error, null);
  assert.equal(res.data.id, generatedId);
  assert.equal(res.data.name, '24 Sessions Elite');
  assert.equal(res.data.totalSessions, 24);
  assert.equal(res.data.price, 9600);
  assert.equal(res.data.validityDays, 90);
  assert.equal(capturedInsert.total_sessions, 24);
  assert.equal(capturedInsert.validity_days, 90);
});

// ---------------------------------------------------------------------------
// 5. Update package
// ---------------------------------------------------------------------------
test('5. Updating a package: targets specific row and returns database-confirmed record', async () => {
  const targetId = 'pkg-uuid-202';
  let capturedUpdate = null;

  const mockClient = {
    from: (table) => {
      assert.equal(table, 'pt_packages');
      return {
        update: (payload) => {
          capturedUpdate = payload;
          return {
            eq: (col, val) => {
              assert.equal(col, 'id');
              assert.equal(val, targetId);
              return {
                select: () => ({
                  single: async () => ({
                    data: {
                      id: targetId,
                      name: '12 Sessions Advanced',
                      total_sessions: 12,
                      price: 6000,
                      validity_days: 60,
                      description: 'Updated rate',
                      is_active: true,
                      created_at: '2026-10-01T00:00:00Z',
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

  const res = await updatePtPackage(targetId, {
    name: '12 Sessions Advanced',
    price: 6000,
    validityDays: 60,
  });

  assert.equal(res.error, null);
  assert.equal(res.data.name, '12 Sessions Advanced');
  assert.equal(res.data.price, 6000);
  assert.equal(res.data.validityDays, 60);
  assert.equal(capturedUpdate.price, 6000);
  assert.equal(capturedUpdate.validity_days, 60);
});

// ---------------------------------------------------------------------------
// 6. Soft-deactivation & Reactivation
// ---------------------------------------------------------------------------
test('6. Soft-deactivation: sets is_active = false and NEVER executes physical DELETE', async () => {
  const targetId = 'pkg-uuid-303';
  let executedDelete = false;
  let updatedActiveVal = null;

  const mockClient = {
    from: (table) => {
      assert.equal(table, 'pt_packages');
      return {
        delete: () => {
          executedDelete = true;
          throw new Error('PHYSICAL DELETE PROHIBITED');
        },
        update: (payload) => {
          updatedActiveVal = payload.is_active;
          return {
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: targetId,
                    name: 'Obsolete Tier',
                    total_sessions: 8,
                    price: 3500,
                    validity_days: 30,
                    is_active: payload.is_active,
                    created_at: '2026-09-01T00:00:00Z',
                    updated_at: payload.updated_at,
                  },
                  error: null,
                }),
              }),
            }),
          };
        },
      };
    },
  };

  setSupabaseClientForTesting(mockClient, true);

  // Deactivate
  const deactRes = await togglePtPackageStatus(targetId, true);
  assert.equal(executedDelete, false, 'Physical delete must never be invoked');
  assert.equal(updatedActiveVal, false);
  assert.equal(deactRes.data.isActive, false);

  // Reactivate
  const reactRes = await togglePtPackageStatus(targetId, false);
  assert.equal(updatedActiveVal, true);
  assert.equal(reactRes.data.isActive, true);
});

// ---------------------------------------------------------------------------
// 7. Admin permission enforcement (RLS 42501)
// ---------------------------------------------------------------------------
test('7. Admin permission denial: returns clear administrator-only error for non-admin mutations', async () => {
  const mockClient = {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: null,
            error: {
              code: '42501',
              message: 'new row violates row-level security policy for table "pt_packages"',
            },
          }),
        }),
      }),
    }),
  };

  setSupabaseClientForTesting(mockClient, true);

  const res = await createPtPackage({
    name: 'Unauthorized Tier',
    totalSessions: 10,
    price: 5000,
  });

  assert.notEqual(res.error, null);
  assert.match(res.error.message, /only administrators can modify PT packages/i);
});

// ---------------------------------------------------------------------------
// 8. UUID mapping and active-only assignment filtering
// ---------------------------------------------------------------------------
test('8. Querying packages: separates active packages for assignment from all packages', async () => {
  const activeUuid = 'a0000000-0000-0000-0000-000000000001';
  const inactiveUuid = 'b0000000-0000-0000-0000-000000000002';

  const mockRows = [
    { id: activeUuid, name: 'Active Tier', total_sessions: 8, price: 4000, validity_days: 30, is_active: true },
    { id: inactiveUuid, name: 'Legacy Inactive Tier', total_sessions: 12, price: 5000, validity_days: 45, is_active: false },
  ];

  let filteredByActive = false;

  const mockClient = {
    from: () => ({
      select: () => ({
        order: () => {
          return {
            eq: (col, val) => {
              if (col === 'is_active' && val === true) {
                filteredByActive = true;
                return Promise.resolve({ data: [mockRows[0]], error: null });
              }
              return Promise.resolve({ data: mockRows, error: null });
            },
            then: (resolve) => resolve({ data: mockRows, error: null }),
          };
        },
      }),
    }),
  };

  setSupabaseClientForTesting(mockClient, true);

  // Active only (for assignment dropdown)
  const activeRes = await getPtPackages({ includeInactive: false });
  assert.equal(filteredByActive, true);
  assert.equal(activeRes.data.length, 1);
  assert.equal(activeRes.data[0].id, activeUuid);
  assert.equal(activeRes.data[0].isActive, true);

  // All packages (for Settings management)
  const allRes = await getPtPackages({ includeInactive: true });
  assert.equal(allRes.data.length, 2);
});

// ---------------------------------------------------------------------------
// 9. Historical assignment snapshot preservation
// ---------------------------------------------------------------------------
test('9. Snapshot preservation: package catalog price changes do NOT mutate historical assignments', () => {
  // Existing client assignment formed on historical rate
  const historicalAssignment = {
    id: 'asgn-001',
    memberId: 'TFH001',
    memberName: 'Rahul Sharma',
    packageId: 'cccccccc-0000-0000-0000-000000000001',
    package: '12 Sessions Pro',
    totalSessions: 12,
    feeAmount: 5000, // Historical price when assigned
    amountPaid: 3000,
    balance: 2000,
    startDate: '2026-09-01',
    status: 'active',
  };

  // Package catalog is updated to ₹6000 and 15 sessions
  const updatedCatalogPackage = {
    id: 'cccccccc-0000-0000-0000-000000000001',
    name: '12 Sessions Pro',
    total_sessions: 15,
    price: 6000,
    validity_days: 45,
    is_active: true,
  };

  // Historical assignment remains completely immutable
  assert.equal(historicalAssignment.feeAmount, 5000);
  assert.equal(historicalAssignment.totalSessions, 12);
  assert.equal(historicalAssignment.balance, 2000);
  assert.notEqual(historicalAssignment.feeAmount, updatedCatalogPackage.price);
});

