/**
 * membershipPlanService.js
 * The Fitness House Gym Management Admin Panel
 *
 * Provides typed, structured methods for querying, creating, updating,
 * and deactivating/reactivating membership plans stored in public.membership_plans.
 *
 * Safety & Integrity Design:
 *  - Authoritative Database Storage: Targets public.membership_plans via Supabase client.
 *  - Never Fabricates Success: Always returns database-confirmed records read back from PostgreSQL.
 *  - Soft-Delete Only: Deactivation sets is_active = false. Records are NEVER physically deleted
 *    so foreign key references in public.member_subscriptions remain intact.
 *  - Strict Validation: Plan name must be non-empty, duration must be a positive integer,
 *    and price must be a non-negative number.
 *  - RLS Guarded: Modifications are restricted to administrators (public.is_admin()).
 */

// Ensure import.meta.env is safe in Node environments without Vite
if (typeof import.meta !== 'undefined' && !import.meta.env) {
  import.meta.env = {};
}

import { supabase, isSupabaseConfigured } from './supabaseClient.js';

// ---------------------------------------------------------------------------
// Client Provider (Lazy-loaded to support both Vite browser & Node test runner)
// ---------------------------------------------------------------------------

let _injectedClient = null;
let _injectedConfigured = null;

export function setSupabaseClientForTesting(client, configured = true) {
  _injectedClient = client;
  _injectedConfigured = configured;
}

export function resetSupabaseClientForTesting() {
  _injectedClient = null;
  _injectedConfigured = null;
}

async function getClient(client) {
  if (client) return client;
  if (_injectedClient) return _injectedClient;
  return supabase;
}

async function getConfigured(configured) {
  if (configured !== undefined && configured !== null) return configured;
  if (_injectedConfigured !== null) return _injectedConfigured;
  return isSupabaseConfigured;
}

// ---------------------------------------------------------------------------
// Normalizer & Validator
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw database row from public.membership_plans for frontend consumption.
 * Provides both duration and duration_days for full backward-compatibility.
 */
export function normalizeMembershipPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name ?? '',
    duration: Number(row.duration_days) || 0,
    duration_days: Number(row.duration_days) || 0,
    price: Number(row.price) || 0,
    description: row.description ?? '',
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Validates plan input fields.
 *
 * Rules:
 * - name: required non-empty string.
 * - duration_days / duration: required positive integer (> 0).
 * - price: required non-negative number (>= 0).
 * - description: optional string.
 */
export function validatePlanInput(input) {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Plan details must be provided as an object.' };
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    return { valid: false, error: 'Plan name is required.' };
  }

  const rawDuration = input.duration_days !== undefined ? input.duration_days : input.duration;
  const numDuration = Number(rawDuration);
  if (rawDuration === undefined || rawDuration === null || rawDuration === '' || isNaN(numDuration)) {
    return { valid: false, error: 'Duration in days is required.' };
  }
  if (!Number.isInteger(numDuration) || numDuration <= 0) {
    return { valid: false, error: 'Duration must be a positive whole number of days.' };
  }

  const rawPrice = input.price;
  const numPrice = Number(rawPrice);
  if (rawPrice === undefined || rawPrice === null || rawPrice === '' || isNaN(numPrice)) {
    return { valid: false, error: 'Plan price is required.' };
  }
  if (numPrice < 0) {
    return { valid: false, error: 'Price cannot be negative.' };
  }

  return {
    valid: true,
    error: null,
    sanitized: {
      name,
      duration_days: numDuration,
      price: numPrice,
      description: typeof input.description === 'string' ? input.description.trim() : '',
    },
  };
}

/**
 * Formats database errors into user-friendly diagnostic messages.
 */
function parsePlanDatabaseError(error, contextName = '') {
  if (!error) return 'An unexpected database error occurred.';
  const code = String(error.code || '').toUpperCase();
  const message = String(error.message || '');

  // 42501: RLS permission violation
  if (code === '42501' || message.toLowerCase().includes('violates row-level security') || message.toLowerCase().includes('permission denied')) {
    return 'Permission denied: only administrators can modify membership plans.';
  }

  // 23505: Unique constraint violation (plan name already exists)
  if (code === '23505' || message.toLowerCase().includes('unique') || message.toLowerCase().includes('already exists')) {
    return contextName
      ? `A membership plan named "${contextName}" already exists. Please choose a different name.`
      : 'A membership plan with this name already exists. Please choose a different name.';
  }

  // 23514: Check constraint violation
  if (code === '23514') {
    return 'Database validation failed: duration must be positive and price cannot be negative.';
  }

  return error.message || 'Database operation failed.';
}

// ---------------------------------------------------------------------------
// Service Methods
// ---------------------------------------------------------------------------

/**
 * Fetches all active membership plans (is_active = true) ordered by duration_days ascending.
 * Used for member onboarding registration and subscription renewal dropdowns.
 */
export async function getActiveMembershipPlans(client, configured) {
  const activeClient = await getClient(client);
  const isConfigured = await getConfigured(configured);

  if (!isConfigured || !activeClient) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
    };
  }

  try {
    const { data, error } = await activeClient
      .from('membership_plans')
      .select('id, name, duration_days, price, description, is_active, created_at, updated_at')
      .eq('is_active', true)
      .order('duration_days', { ascending: true });

    if (error) {
      console.error('[membershipPlanService] Database error fetching active plans:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch active membership plans from database.'),
      };
    }

    if (!data) {
      return { data: [], error: null };
    }

    return {
      data: data.map(normalizeMembershipPlan),
      error: null,
    };
  } catch (err) {
    console.error('[membershipPlanService] Unexpected error in getActiveMembershipPlans:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Fetches ALL membership plans (both active and inactive) ordered by duration_days ascending.
 * Used for administrative settings and plan management.
 */
export async function getAllMembershipPlans(client, configured) {
  const activeClient = await getClient(client);
  const isConfigured = await getConfigured(configured);

  if (!isConfigured || !activeClient) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
    };
  }

  try {
    const { data, error } = await activeClient
      .from('membership_plans')
      .select('id, name, duration_days, price, description, is_active, created_at, updated_at')
      .order('duration_days', { ascending: true });

    if (error) {
      console.error('[membershipPlanService] Database error fetching all plans:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch membership plans catalog.'),
      };
    }

    if (!data) {
      return { data: [], error: null };
    }

    return {
      data: data.map(normalizeMembershipPlan),
      error: null,
    };
  } catch (err) {
    console.error('[membershipPlanService] Unexpected error in getAllMembershipPlans:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Creates a new membership plan in public.membership_plans.
 * Validates inputs BEFORE sending query to database.
 * Returns the strictly database-confirmed record.
 */
export async function createMembershipPlan(planData, client, configured) {
  const activeClient = await getClient(client);
  const isConfigured = await getConfigured(configured);

  if (!isConfigured || !activeClient) {
    return {
      data: null,
      error: new Error('Supabase client is not configured.'),
    };
  }

  const validation = validatePlanInput(planData);
  if (!validation.valid) {
    return {
      data: null,
      error: new Error(validation.error),
    };
  }

  const { name, duration_days, price, description } = validation.sanitized;
  const now = new Date().toISOString();

  const insertPayload = {
    name,
    duration_days,
    price,
    description: description || null,
    is_active: planData.is_active !== undefined ? Boolean(planData.is_active) : true,
    created_at: now,
    updated_at: now,
  };

  try {
    const { data, error } = await activeClient
      .from('membership_plans')
      .insert(insertPayload)
      .select('id, name, duration_days, price, description, is_active, created_at, updated_at')
      .single();

    if (error) {
      console.error('[membershipPlanService] Database error creating plan:', error);
      return {
        data: null,
        error: new Error(parsePlanDatabaseError(error, name)),
      };
    }

    if (!data) {
      return {
        data: null,
        error: new Error('Database insert succeeded but no record was returned.'),
      };
    }

    return {
      data: normalizeMembershipPlan(data),
      error: null,
    };
  } catch (err) {
    console.error('[membershipPlanService] Unexpected error in createMembershipPlan:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Updates an existing membership plan in public.membership_plans by ID.
 * Returns the strictly database-confirmed record.
 */
export async function updateMembershipPlan(id, updates, client, configured) {
  const activeClient = await getClient(client);
  const isConfigured = await getConfigured(configured);

  if (!isConfigured || !activeClient) {
    return {
      data: null,
      error: new Error('Supabase client is not configured.'),
    };
  }

  if (!id) {
    return {
      data: null,
      error: new Error('Plan ID is required to update a membership plan.'),
    };
  }

  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return {
      data: null,
      error: new Error('No update fields provided.'),
    };
  }

  // Construct update payload and validate updated fields
  const dbPayload = {
    updated_at: new Date().toISOString(),
  };

  let targetName = '';

  if (updates.name !== undefined) {
    const trimmed = typeof updates.name === 'string' ? updates.name.trim() : '';
    if (!trimmed) {
      return { data: null, error: new Error('Plan name cannot be empty.') };
    }
    dbPayload.name = trimmed;
    targetName = trimmed;
  }

  if (updates.duration_days !== undefined || updates.duration !== undefined) {
    const raw = updates.duration_days !== undefined ? updates.duration_days : updates.duration;
    const num = Number(raw);
    if (!Number.isInteger(num) || num <= 0) {
      return { data: null, error: new Error('Duration must be a positive whole number of days.') };
    }
    dbPayload.duration_days = num;
  }

  if (updates.price !== undefined) {
    const numPrice = Number(updates.price);
    if (isNaN(numPrice) || numPrice < 0) {
      return { data: null, error: new Error('Price must be a valid, non-negative number.') };
    }
    dbPayload.price = numPrice;
  }

  if (updates.description !== undefined) {
    dbPayload.description = typeof updates.description === 'string' ? updates.description.trim() : null;
  }

  if (updates.is_active !== undefined) {
    dbPayload.is_active = Boolean(updates.is_active);
  }

  try {
    const { data, error } = await activeClient
      .from('membership_plans')
      .update(dbPayload)
      .eq('id', id)
      .select('id, name, duration_days, price, description, is_active, created_at, updated_at')
      .single();

    if (error) {
      console.error('[membershipPlanService] Database error updating plan:', error);
      return {
        data: null,
        error: new Error(parsePlanDatabaseError(error, targetName)),
      };
    }

    if (!data) {
      return {
        data: null,
        error: new Error('Update returned no data. The plan may not exist or permission was denied.'),
      };
    }

    return {
      data: normalizeMembershipPlan(data),
      error: null,
    };
  } catch (err) {
    console.error('[membershipPlanService] Unexpected error in updateMembershipPlan:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Deactivates a membership plan (soft-delete).
 * Sets is_active = false. NEVER deletes row from public.membership_plans.
 */
export async function deactivateMembershipPlan(id, client, configured) {
  if (!id) {
    return { data: null, error: new Error('Plan ID is required to deactivate a plan.') };
  }
  return updateMembershipPlan(id, { is_active: false }, client, configured);
}

/**
 * Reactivates a membership plan.
 * Sets is_active = true.
 */
export async function reactivateMembershipPlan(id, client, configured) {
  if (!id) {
    return { data: null, error: new Error('Plan ID is required to reactivate a plan.') };
  }
  return updateMembershipPlan(id, { is_active: true }, client, configured);
}
