/**
 * ptPackageService.js
 * The Fitness House Gym Management Admin Panel
 *
 * Provides typed, structured methods for querying, creating, updating,
 * and deactivating/reactivating personal training packages stored in public.pt_packages.
 *
 * Safety & Integrity Design:
 *  - Authoritative Database Storage: Targets public.pt_packages via Supabase client.
 *  - Never Fabricates Success: Always returns database-confirmed records read back from PostgreSQL.
 *  - Soft-Delete Only: Deactivation sets is_active = false. Records are NEVER physically deleted
 *    because foreign key references in public.pt_assignments (ON DELETE RESTRICT) must remain intact.
 *  - Strict Validation: Package name must be non-empty, total sessions must be a positive integer,
 *    price must be non-negative, and validity days must be a positive integer.
 *  - RLS Guarded: Mutations are restricted to administrators (public.is_admin()).
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
 * Normalizes a raw database row from public.pt_packages for frontend consumption.
 * Provides camelCase and snake_case properties for compatibility.
 *
 * @param {object|null} row
 * @returns {object|null}
 */
export function normalizePtPackage(row) {
  if (!row) return null;

  const totalSessions = Number(row.total_sessions) || Number(row.sessions) || 0;
  const validityDays = Number(row.validity_days) || Number(row.validity) || 30;
  const price = Number(row.price) || 0;
  const isActive = row.is_active !== undefined ? Boolean(row.is_active) : (row.isActive !== undefined ? Boolean(row.isActive) : true);

  return {
    id: row.id,
    name: row.name ?? '',
    totalSessions,
    total_sessions: totalSessions,
    sessions: totalSessions, // Legacy alias for UI card compatibility
    price,
    validityDays,
    validity_days: validityDays,
    validity: validityDays, // Legacy alias for UI card compatibility
    description: row.description ?? '',
    isActive,
    is_active: isActive,
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
  };
}

/**
 * Validates PT package input fields.
 *
 * Rules:
 * - name: required non-empty string.
 * - totalSessions / sessions: required positive integer (> 0).
 * - price: required non-negative number (>= 0).
 * - validityDays / validity: positive integer (> 0), defaults to 30 if omitted.
 * - description: optional string.
 *
 * @param {object} input
 * @returns {{ valid: boolean, error: string|null, sanitized?: object }}
 */
export function validatePtPackageInput(input) {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Package details must be provided as an object.' };
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    return { valid: false, error: 'Package name is required.' };
  }

  const rawSessions = input.totalSessions !== undefined
    ? input.totalSessions
    : (input.total_sessions !== undefined ? input.total_sessions : input.sessions);
  const numSessions = Number(rawSessions);

  if (rawSessions === undefined || rawSessions === null || rawSessions === '' || isNaN(numSessions)) {
    return { valid: false, error: 'Session count is required.' };
  }
  if (!Number.isInteger(numSessions) || numSessions <= 0) {
    return { valid: false, error: 'Total sessions must be a positive whole number.' };
  }

  const rawPrice = input.price;
  const numPrice = Number(rawPrice);
  if (rawPrice === undefined || rawPrice === null || rawPrice === '' || isNaN(numPrice)) {
    return { valid: false, error: 'Package price is required.' };
  }
  if (numPrice < 0) {
    return { valid: false, error: 'Package price cannot be negative.' };
  }

  const rawValidity = input.validityDays !== undefined
    ? input.validityDays
    : (input.validity_days !== undefined ? input.validity_days : input.validity);
  let numValidity = 30; // Safe default
  if (rawValidity !== undefined && rawValidity !== null && rawValidity !== '') {
    numValidity = Number(rawValidity);
    if (!Number.isInteger(numValidity) || numValidity <= 0) {
      return { valid: false, error: 'Validity must be a positive whole number of days.' };
    }
  }

  return {
    valid: true,
    error: null,
    sanitized: {
      name,
      total_sessions: numSessions,
      price: numPrice,
      validity_days: numValidity,
      description: typeof input.description === 'string' ? input.description.trim() : '',
    },
  };
}

/**
 * Formats database errors into user-friendly diagnostic messages.
 *
 * @param {object|Error} error
 * @param {string} contextName
 * @returns {string}
 */
export function parsePtPackageError(error, contextName = '') {
  if (!error) return 'An unexpected database error occurred.';
  const code = String(error.code || '').toUpperCase();
  const message = String(error.message || '');

  // 42501: RLS permission violation
  if (code === '42501' || message.toLowerCase().includes('violates row-level security') || message.toLowerCase().includes('permission denied')) {
    return 'Permission denied: only administrators can modify PT packages.';
  }

  // 23505: Unique constraint violation (package name already exists)
  if (code === '23505' || message.toLowerCase().includes('unique') || message.toLowerCase().includes('already exists')) {
    return contextName
      ? `A PT package named "${contextName}" already exists. Please choose a different name.`
      : 'A PT package with this name already exists. Please choose a different name.';
  }

  // 23514: Check constraint violation
  if (code === '23514') {
    return 'Database validation failed: sessions and validity must be positive, and price cannot be negative.';
  }

  return error.message || 'Database operation failed.';
}

// ---------------------------------------------------------------------------
// Service Methods
// ---------------------------------------------------------------------------

/**
 * Fetches PT packages from public.pt_packages.
 *
 * @param {{ includeInactive?: boolean }} options
 * @param {object} [client]
 * @param {boolean} [configured]
 * @returns {Promise<{ data: Array<object>|null, error: Error|null }>}
 */
export async function getPtPackages({ includeInactive = false } = {}, client, configured) {
  const activeClient = await getClient(client);
  const isConfigured = await getConfigured(configured);

  if (!isConfigured || !activeClient) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
    };
  }

  try {
    let query = activeClient
      .from('pt_packages')
      .select('id, name, total_sessions, price, description, is_active, created_at, updated_at' +
        // Try to query validity_days; if missing on an unmigrated DB, the select will be handled cleanly
        ', validity_days')
      .order('price', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      // If error is about validity_days column not existing (e.g., migration pending)
      if (error.message && error.message.includes('validity_days')) {
        console.warn('[ptPackageService] validity_days column not detected, retrying without validity_days...');
        let fallbackQuery = activeClient
          .from('pt_packages')
          .select('id, name, total_sessions, price, description, is_active, created_at, updated_at')
          .order('price', { ascending: true });

        if (!includeInactive) {
          fallbackQuery = fallbackQuery.eq('is_active', true);
        }

        const fallbackRes = await fallbackQuery;
        if (fallbackRes.error) {
          return { data: null, error: new Error(fallbackRes.error.message || 'Failed to fetch PT packages.') };
        }
        return { data: (fallbackRes.data || []).map(normalizePtPackage), error: null };
      }

      console.error('[ptPackageService] Database error fetching PT packages:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch PT packages from database.'),
      };
    }

    return {
      data: (data || []).map(normalizePtPackage),
      error: null,
    };
  } catch (err) {
    console.error('[ptPackageService] Unexpected error in getPtPackages:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Creates a new PT package in public.pt_packages.
 * Validates inputs BEFORE sending query to database.
 * Returns the strictly database-confirmed record.
 *
 * @param {object} pkgData
 * @param {object} [client]
 * @param {boolean} [configured]
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function createPtPackage(pkgData, client, configured) {
  const activeClient = await getClient(client);
  const isConfigured = await getConfigured(configured);

  if (!isConfigured || !activeClient) {
    return {
      data: null,
      error: new Error('Supabase client is not configured.'),
    };
  }

  const validation = validatePtPackageInput(pkgData);
  if (!validation.valid) {
    return {
      data: null,
      error: new Error(validation.error),
    };
  }

  const { name, total_sessions, price, validity_days, description } = validation.sanitized;
  const now = new Date().toISOString();

  const insertPayload = {
    name,
    total_sessions,
    price,
    validity_days,
    description: description || null,
    is_active: pkgData.is_active !== undefined ? Boolean(pkgData.is_active) : (pkgData.isActive !== undefined ? Boolean(pkgData.isActive) : true),
    created_at: now,
    updated_at: now,
  };

  try {
    const { data, error } = await activeClient
      .from('pt_packages')
      .insert(insertPayload)
      .select('id, name, total_sessions, price, description, is_active, created_at, updated_at, validity_days')
      .single();

    if (error) {
      console.error('[ptPackageService] Database error creating package:', error);
      return {
        data: null,
        error: new Error(parsePtPackageError(error, name)),
      };
    }

    if (!data) {
      return {
        data: null,
        error: new Error('Database insert succeeded but no record was returned.'),
      };
    }

    return {
      data: normalizePtPackage(data),
      error: null,
    };
  } catch (err) {
    console.error('[ptPackageService] Unexpected error in createPtPackage:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Updates an existing PT package in public.pt_packages by ID.
 * Returns the strictly database-confirmed record.
 *
 * @param {string} id
 * @param {object} updates
 * @param {object} [client]
 * @param {boolean} [configured]
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function updatePtPackage(id, updates, client, configured) {
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
      error: new Error('Package ID is required to update a PT package.'),
    };
  }

  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return {
      data: null,
      error: new Error('No update fields provided.'),
    };
  }

  const dbPayload = {
    updated_at: new Date().toISOString(),
  };

  let targetName = '';

  if (updates.name !== undefined) {
    const trimmed = typeof updates.name === 'string' ? updates.name.trim() : '';
    if (!trimmed) {
      return { data: null, error: new Error('Package name cannot be empty.') };
    }
    dbPayload.name = trimmed;
    targetName = trimmed;
  }

  if (updates.totalSessions !== undefined || updates.total_sessions !== undefined || updates.sessions !== undefined) {
    const raw = updates.totalSessions !== undefined
      ? updates.totalSessions
      : (updates.total_sessions !== undefined ? updates.total_sessions : updates.sessions);
    const num = Number(raw);
    if (!Number.isInteger(num) || num <= 0) {
      return { data: null, error: 'Total sessions must be a positive whole number.' };
    }
    dbPayload.total_sessions = num;
  }

  if (updates.price !== undefined) {
    const numPrice = Number(updates.price);
    if (isNaN(numPrice) || numPrice < 0) {
      return { data: null, error: new Error('Price must be a valid, non-negative number.') };
    }
    dbPayload.price = numPrice;
  }

  if (updates.validityDays !== undefined || updates.validity_days !== undefined || updates.validity !== undefined) {
    const rawVal = updates.validityDays !== undefined
      ? updates.validityDays
      : (updates.validity_days !== undefined ? updates.validity_days : updates.validity);
    const numVal = Number(rawVal);
    if (!Number.isInteger(numVal) || numVal <= 0) {
      return { data: null, error: new Error('Validity must be a positive whole number of days.') };
    }
    dbPayload.validity_days = numVal;
  }

  if (updates.description !== undefined) {
    dbPayload.description = typeof updates.description === 'string' ? updates.description.trim() : null;
  }

  if (updates.isActive !== undefined || updates.is_active !== undefined) {
    dbPayload.is_active = updates.isActive !== undefined ? Boolean(updates.isActive) : Boolean(updates.is_active);
  }

  try {
    const { data, error } = await activeClient
      .from('pt_packages')
      .update(dbPayload)
      .eq('id', id)
      .select('id, name, total_sessions, price, description, is_active, created_at, updated_at, validity_days')
      .single();

    if (error) {
      console.error('[ptPackageService] Database error updating package:', error);
      return {
        data: null,
        error: new Error(parsePtPackageError(error, targetName)),
      };
    }

    if (!data) {
      return {
        data: null,
        error: new Error('Update returned no data. The package may not exist or permission was denied.'),
      };
    }

    return {
      data: normalizePtPackage(data),
      error: null,
    };
  } catch (err) {
    console.error('[ptPackageService] Unexpected error in updatePtPackage:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Toggles status (active/inactive) of a PT package (soft-delete).
 * Never deletes record from public.pt_packages to preserve historical assignment integrity.
 *
 * @param {string} id
 * @param {boolean} currentIsActive
 * @param {object} [client]
 * @param {boolean} [configured]
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function togglePtPackageStatus(id, currentIsActive, client, configured) {
  if (!id) {
    return { data: null, error: new Error('Package ID is required to toggle package status.') };
  }
  return updatePtPackage(id, { is_active: !currentIsActive }, client, configured);
}

