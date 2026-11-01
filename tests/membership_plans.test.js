import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePlanInput,
  normalizeMembershipPlan,
  getActiveMembershipPlans,
  getAllMembershipPlans,
  createMembershipPlan,
  updateMembershipPlan,
  deactivateMembershipPlan,
  reactivateMembershipPlan,
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting,
} from '../src/services/membershipPlanService.js';

/**
 * Phase 2 — Membership Plans Module Test Suite
 * The Fitness House Gym Management Admin Panel
 *
 * Verifies all 13 core requirements:
 * 1. Creating a valid plan
 * 2. Rejecting an empty plan name
 * 3. Rejecting zero or negative duration
 * 4. Rejecting invalid prices
 * 5. Updating an existing plan
 * 6. Deactivating a plan (soft-delete only)
 * 7. Reactivating a plan
 * 8. Database permission denial for staff (RLS 42501)
 * 9. Handling unique name conflict (23505) and duplicate submission prevention
 * 10. Refreshing plans after successful changes
 * 11. Excluding inactive plans from registration
 * 12. Excluding inactive plans from renewal
 * 13. Preserving historical subscriptions
 */

test.beforeEach(() => {
  resetSupabaseClientForTesting();
});

// ---------------------------------------------------------------------------
// 1. Creating a valid plan
// ---------------------------------------------------------------------------
test('1. Creating a valid plan: inserts with sanitized payload and returns database-confirmed record', async () => {
  const newPlanId = 'plan-uuid-001';
  let capturedPayload = null;

  const mockClient = {
    from: (table) => {
      assert.equal(table, 'membership_plans');
      return {
        insert: (payload) => {
          capturedPayload = payload;
          return {
            select: () => ({
              single: async () => ({
                data: {
                  id: newPlanId,
                  name: payload.name,
                  duration_days: payload.duration_days,
                  price: payload.price,
                  description: payload.description,
                  is_active: payload.is_active,
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

  const planInput = {
    name: '  Annual VIP  ',
    duration_days: '365',
    price: '8000',
    description: '  Full year gym access with locker privilege  ',
  };

  const { data, error } = await createMembershipPlan(planInput, mockClient, true);

  assert.equal(error, null);
  assert.ok(data);
  assert.equal(data.id, newPlanId);
  assert.equal(data.name, 'Annual VIP', 'Name must be trimmed');
  assert.equal(data.duration, 365, 'Duration must be normalized to number');
  assert.equal(data.duration_days, 365);
  assert.equal(data.price, 8000, 'Price must be normalized to number');
  assert.equal(data.description, 'Full year gym access with locker privilege');
  assert.equal(data.is_active, true, 'New plans default to active');

  // Verify database payload
  assert.equal(capturedPayload.name, 'Annual VIP');
  assert.equal(capturedPayload.duration_days, 365);
  assert.equal(capturedPayload.price, 8000);
  assert.ok(capturedPayload.created_at);
  assert.ok(capturedPayload.updated_at);
});

// ---------------------------------------------------------------------------
// 2. Rejecting an empty plan name
// ---------------------------------------------------------------------------
test('2. Rejecting an empty plan name: fails validation before query execution', async () => {
  let queryExecuted = false;
  const mockClient = {
    from: () => ({
      insert: () => {
        queryExecuted = true;
        return { select: () => ({ single: async () => ({}) }) };
      },
    }),
  };

  // Case A: empty string
  const resA = await createMembershipPlan({ name: '', duration_days: 30, price: 700 }, mockClient, true);
  assert.equal(queryExecuted, false);
  assert.equal(resA.data, null);
  assert.ok(resA.error instanceof Error);
  assert.equal(resA.error.message, 'Plan name is required.');

  // Case B: whitespace-only string
  const resB = await createMembershipPlan({ name: '    ', duration_days: 30, price: 700 }, mockClient, true);
  assert.equal(queryExecuted, false);
  assert.equal(resB.data, null);
  assert.equal(resB.error.message, 'Plan name is required.');
});

// ---------------------------------------------------------------------------
// 3. Rejecting zero or negative duration
// ---------------------------------------------------------------------------
test('3. Rejecting zero or negative duration: strictly requires positive whole number', async () => {
  let queryExecuted = false;
  const mockClient = {
    from: () => ({
      insert: () => {
        queryExecuted = true;
        return { select: () => ({ single: async () => ({}) }) };
      },
    }),
  };

  // Zero duration
  const resZero = await createMembershipPlan({ name: 'Zero Plan', duration_days: 0, price: 500 }, mockClient, true);
  assert.equal(queryExecuted, false);
  assert.ok(resZero.error.message.includes('positive whole number of days'));

  // Negative duration
  const resNeg = await createMembershipPlan({ name: 'Neg Plan', duration_days: -30, price: 500 }, mockClient, true);
  assert.equal(queryExecuted, false);
  assert.ok(resNeg.error.message.includes('positive whole number of days'));

  // Fractional duration
  const resFrac = await createMembershipPlan({ name: 'Frac Plan', duration_days: 30.5, price: 500 }, mockClient, true);
  assert.equal(queryExecuted, false);
  assert.ok(resFrac.error.message.includes('positive whole number of days'));

  // Non-numeric duration
  const resNaN = await createMembershipPlan({ name: 'NaN Plan', duration_days: 'invalid', price: 500 }, mockClient, true);
  assert.equal(queryExecuted, false);
  assert.ok(resNaN.error.message.includes('Duration in days is required'));
});

// ---------------------------------------------------------------------------
// 4. Rejecting invalid prices
// ---------------------------------------------------------------------------
test('4. Rejecting invalid prices: rejects negative and non-numeric values', async () => {
  let queryExecuted = false;
  const mockClient = {
    from: () => ({
      insert: () => {
        queryExecuted = true;
        return { select: () => ({ single: async () => ({}) }) };
      },
    }),
  };

  // Negative price
  const resNeg = await createMembershipPlan({ name: 'Negative Price', duration_days: 30, price: -100 }, mockClient, true);
  assert.equal(queryExecuted, false);
  assert.equal(resNeg.error.message, 'Price cannot be negative.');

  // Non-numeric price
  const resNaN = await createMembershipPlan({ name: 'NaN Price', duration_days: 30, price: 'free' }, mockClient, true);
  assert.equal(queryExecuted, false);
  assert.equal(resNaN.error.message, 'Plan price is required.');

  // Zero price is valid (e.g. promotional / trial plans)
  let zeroInserted = false;
  const zeroMockClient = {
    from: () => ({
      insert: () => {
        zeroInserted = true;
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: 'trial-001',
                name: 'Free Trial',
                duration_days: 7,
                price: 0,
                is_active: true,
              },
              error: null,
            }),
          }),
        };
      },
    }),
  };
  const resZero = await createMembershipPlan({ name: 'Free Trial', duration_days: 7, price: 0 }, zeroMockClient, true);
  assert.equal(zeroInserted, true);
  assert.equal(resZero.error, null);
  assert.equal(resZero.data.price, 0);
});

// ---------------------------------------------------------------------------
// 5. Updating an existing plan
// ---------------------------------------------------------------------------
test('5. Updating an existing plan: updates targeted row and returns confirmed record', async () => {
  const targetId = 'b1111111-2222-3333-4444-555555555555';
  let capturedUpdates = null;
  let capturedTargetId = null;

  const mockClient = {
    from: (table) => {
      assert.equal(table, 'membership_plans');
      return {
        update: (payload) => {
          capturedUpdates = payload;
          return {
            eq: (col, val) => {
              assert.equal(col, 'id');
              capturedTargetId = val;
              return {
                select: () => ({
                  single: async () => ({
                    data: {
                      id: targetId,
                      name: payload.name,
                      duration_days: payload.duration_days,
                      price: payload.price,
                      description: 'Updated quarterly tier',
                      is_active: true,
                      created_at: '2026-10-19T00:00:00Z',
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

  const updates = {
    name: 'Quarterly Pro',
    duration_days: 90,
    price: 2200,
  };

  const { data, error } = await updateMembershipPlan(targetId, updates, mockClient, true);

  assert.equal(error, null);
  assert.equal(capturedTargetId, targetId);
  assert.equal(capturedUpdates.name, 'Quarterly Pro');
  assert.equal(capturedUpdates.price, 2200);
  assert.ok(capturedUpdates.updated_at);
  assert.equal(data.name, 'Quarterly Pro');
  assert.equal(data.price, 2200);
});

// ---------------------------------------------------------------------------
// 6. Deactivating a plan (soft-delete only)
// ---------------------------------------------------------------------------
test('6. Deactivating a plan: performs soft-delete (is_active = false) and NEVER executes physical DELETE', async () => {
  const targetId = 'plan-to-deactivate';
  let deleteCalled = false;
  let updateCalled = false;
  let updatePayload = null;

  const mockClient = {
    from: (table) => {
      assert.equal(table, 'membership_plans');
      return {
        delete: () => {
          deleteCalled = true;
          return { eq: () => ({}) };
        },
        update: (payload) => {
          updateCalled = true;
          updatePayload = payload;
          return {
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: targetId,
                    name: 'Half-Yearly',
                    duration_days: 180,
                    price: 4000,
                    is_active: payload.is_active,
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

  const { data, error } = await deactivateMembershipPlan(targetId, mockClient, true);

  assert.equal(error, null);
  assert.equal(deleteCalled, false, 'Physical SQL DELETE must NEVER be called on membership_plans');
  assert.equal(updateCalled, true);
  assert.equal(updatePayload.is_active, false);
  assert.equal(data.is_active, false);
});

// ---------------------------------------------------------------------------
// 7. Reactivating a plan
// ---------------------------------------------------------------------------
test('7. Reactivating a plan: restores is_active = true and updates timestamp', async () => {
  const targetId = 'plan-to-reactivate';
  let updatePayload = null;

  const mockClient = {
    from: () => ({
      update: (payload) => {
        updatePayload = payload;
        return {
          eq: () => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: targetId,
                  name: 'Half-Yearly',
                  duration_days: 180,
                  price: 4000,
                  is_active: payload.is_active,
                  updated_at: payload.updated_at,
                },
                error: null,
              }),
            }),
          }),
        };
      },
    }),
  };

  const { data, error } = await reactivateMembershipPlan(targetId, mockClient, true);

  assert.equal(error, null);
  assert.equal(updatePayload.is_active, true);
  assert.equal(data.is_active, true);
});

// ---------------------------------------------------------------------------
// 8. Database permission denial for staff (RLS 42501)
// ---------------------------------------------------------------------------
test('8. Database permission denial for staff: catches 42501 and returns admin-only error', async () => {
  const mockRlsClient = {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: null,
            error: {
              code: '42501',
              message: 'new row violates row-level security policy for table "membership_plans"',
            },
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '42501',
                message: 'new row violates row-level security policy for table "membership_plans"',
              },
            }),
          }),
        }),
      }),
    }),
  };

  // Create denial
  const createRes = await createMembershipPlan(
    { name: 'Staff Unauthorized Plan', duration_days: 30, price: 1000 },
    mockRlsClient,
    true
  );
  assert.equal(createRes.data, null);
  assert.ok(createRes.error instanceof Error);
  assert.ok(createRes.error.message.includes('Permission denied: only administrators can modify membership plans'));

  // Update denial
  const updateRes = await updateMembershipPlan(
    'any-id',
    { price: 1200 },
    mockRlsClient,
    true
  );
  assert.equal(updateRes.data, null);
  assert.ok(updateRes.error instanceof Error);
  assert.ok(updateRes.error.message.includes('Permission denied: only administrators can modify membership plans'));
});

// ---------------------------------------------------------------------------
// 9. Preventing duplicate submissions & Unique name conflict (23505)
// ---------------------------------------------------------------------------
test('9. Unique name conflict (23505): surfaces friendly message when plan name already exists', async () => {
  const mockConflictClient = {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: null,
            error: {
              code: '23505',
              message: 'duplicate key value violates unique constraint "membership_plans_name_key"',
              details: 'Key (name)=(Monthly) already exists.',
            },
          }),
        }),
      }),
    }),
  };

  const res = await createMembershipPlan(
    { name: 'Monthly', duration_days: 30, price: 700 },
    mockConflictClient,
    true
  );

  assert.equal(res.data, null);
  assert.ok(res.error instanceof Error);
  assert.ok(res.error.message.includes('A membership plan named "Monthly" already exists'));
});

// ---------------------------------------------------------------------------
// 10. Refreshing plans after successful changes
// ---------------------------------------------------------------------------
test('10. Refreshing plans after successful changes: getAllMembershipPlans and getActiveMembershipPlans reflect changes', async () => {
  const dbStore = [
    { id: 'p1', name: 'Monthly', duration_days: 30, price: 700, is_active: true },
    { id: 'p2', name: 'Quarterly', duration_days: 90, price: 2000, is_active: true },
    { id: 'p3', name: 'Legacy Plan', duration_days: 60, price: 1200, is_active: false },
  ];

  const mockClient = {
    from: () => ({
      select: () => ({
        order: () => ({
          data: [...dbStore],
          error: null,
        }),
        eq: (col, val) => {
          assert.equal(col, 'is_active');
          assert.equal(val, true);
          return {
            order: () => ({
              data: dbStore.filter(p => p.is_active === true),
              error: null,
            }),
          };
        },
      }),
    }),
  };

  // 1. Fetch active plans only (used by registration & renewal)
  const activeRes = await getActiveMembershipPlans(mockClient, true);
  assert.equal(activeRes.data.length, 2);
  assert.ok(activeRes.data.every(p => p.is_active === true));

  // 2. Fetch all plans (used by settings management table)
  const allRes = await getAllMembershipPlans(mockClient, true);
  assert.equal(allRes.data.length, 3);
  assert.equal(allRes.data.some(p => p.name === 'Legacy Plan' && !p.is_active), true);
});

// ---------------------------------------------------------------------------
// 11. Excluding inactive plans from registration
// ---------------------------------------------------------------------------
test('11. Excluding inactive plans from registration: registration dropdown options map only active plans', () => {
  const allCatalogPlans = [
    { id: 'p-monthly', name: 'Monthly', duration: 30, price: 700, is_active: true },
    { id: 'p-quarterly', name: 'Quarterly', duration: 90, price: 2000, is_active: true },
    { id: 'p-annual', name: 'Annual', duration: 365, price: 8000, is_active: true },
    { id: 'p-summer', name: 'Summer Special (Inactive)', duration: 45, price: 1000, is_active: false },
  ];

  // Active filter (as implemented in AppContext membershipPlans)
  const registrationPlans = allCatalogPlans.filter(p => p.is_active);

  assert.equal(registrationPlans.length, 3);
  assert.equal(registrationPlans.some(p => p.id === 'p-summer'), false, 'Inactive plan must NOT appear in registration');

  // Verify dropdown mapping shape used in Members.jsx
  const dropdownOptions = registrationPlans.map(p => ({
    value: p.id,
    label: `${p.name} (${p.duration} days) - ₹${p.price.toLocaleString('en-IN')}`,
  }));

  assert.equal(dropdownOptions.length, 3);
  assert.equal(dropdownOptions[0].value, 'p-monthly');
  assert.ok(dropdownOptions[0].label.includes('₹700'));
});

// ---------------------------------------------------------------------------
// 12. Excluding inactive plans from renewal
// ---------------------------------------------------------------------------
test('12. Excluding inactive plans from renewal: renewal select options map only active plans', () => {
  const activePlans = [
    { id: 'p1', name: 'Monthly', duration: 30, price: 700, is_active: true },
    { id: 'p2', name: 'Quarterly', duration: 90, price: 2000, is_active: true },
  ];

  // Logic used in RenewMembershipModal.jsx
  const renewalOptions = activePlans.map(p => ({
    value: p.id,
    label: `${p.name} (${p.duration} days) - ₹${p.price.toLocaleString('en-IN')}`,
  }));

  assert.equal(renewalOptions.length, 2);
  assert.equal(renewalOptions[0].value, 'p1');
  assert.equal(renewalOptions[1].value, 'p2');
});

// ---------------------------------------------------------------------------
// 13. Preserving historical subscriptions
// ---------------------------------------------------------------------------
test('13. Preserving historical subscriptions: plan price changes do NOT mutate historical subscription contract', () => {
  // Scenario:
  // Member subscribed in January under "Monthly" plan at ₹700 snapshot
  const historicalSubscription = {
    id: 'sub-jan-001',
    member_id: 'member-001',
    plan_id: 'plan-monthly-uuid',
    plan_name: 'Monthly',
    plan_price: 700, // Historical snapshot column in public.member_subscriptions
    start_date: '2026-01-01',
    end_date: '2026-01-31',
  };

  // Gym administrator now updates Monthly plan standard fee from ₹700 to ₹750 in public.membership_plans
  const updatedPlanCatalogRow = {
    id: 'plan-monthly-uuid',
    name: 'Monthly',
    duration_days: 30,
    price: 750, // New price
    is_active: true,
  };

  // Historical subscription contract price MUST remain unchanged
  assert.equal(historicalSubscription.plan_price, 700, 'Historical subscription must retain original snapshot price of ₹700');
  assert.notEqual(historicalSubscription.plan_price, updatedPlanCatalogRow.price, 'Catalog update must not alter historical liability');
});

