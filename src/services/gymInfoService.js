/**
 * gymInfoService.js
 * The Fitness House Gym Management Admin Panel
 *
 * Provides typed, structured methods for reading and updating the gym profile
 * singleton stored in public.gym_info via the Supabase client.
 *
 * Safety & Integrity Design:
 *  - Authoritative Singleton: Targets the existing record ID confirmed by fetch.
 *  - Atomic & Honest Updates: Never returns success for fields that were not
 *    actually persisted in the database.
 *  - Migration Guard: If extended fields (whatsapp, timings, location, ownerName,
 *    headCoach) are submitted while database migration is pending, the update
 *    is rejected BEFORE writing to prevent partial or corrupted state.
 *  - Robust Error Detection: Detects both PostgreSQL 42703 (undefined_column)
 *    and PostgREST PGRST204 (column not found in schema cache).
 *  - Database-Confirmed State: Return values are constructed strictly from the
 *    database read-back response, never fabricated from unsaved form state.
 */

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
  try {
    const mod = await import('./supabaseClient.js');
    return mod.supabase;
  } catch {
    return null;
  }
}

async function getConfigured(configured) {
  if (configured !== undefined && configured !== null) return configured;
  if (_injectedConfigured !== null) return _injectedConfigured;
  try {
    const mod = await import('./supabaseClient.js');
    return mod.isSupabaseConfigured;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Field & Column Definitions
// ---------------------------------------------------------------------------

export const BASE_COLUMNS = [
  'id',
  'name',
  'tagline',
  'address',
  'phone',
  'email',
  'gst_number',
  'currency_code',
  'currency_symbol',
  'created_at',
  'updated_at',
];

export const EXTENDED_COLUMNS = [
  'whatsapp_number',
  'operating_hours',
  'location',
  'owner_name',
  'head_coach',
];

export const DEFAULT_GYM_INFO = Object.freeze({
  name: 'The Fitness House',
  tagline: 'Gym Management',
  address: '',
  phone: '',
  whatsapp: '',
  email: '',
  timings: '',
  location: '',
  ownerName: '',
  headCoach: '',
  gstNumber: '',
  currencyCode: 'INR',
  currencySymbol: '₹',
});

export const ALL_GYM_INFO_COLUMNS = [
  ...BASE_COLUMNS,
  ...EXTENDED_COLUMNS,
];

const GYM_INFO_COLUMNS_STRING = ALL_GYM_INFO_COLUMNS.join(', ');
const BASE_COLUMNS_STRING = BASE_COLUMNS.join(', ');

export const EXTENDED_FIELD_KEYS = [
  'whatsapp',
  'timings',
  'location',
  'ownerName',
  'headCoach',
];

export const BASE_FIELD_KEYS = [
  'name',
  'tagline',
  'address',
  'phone',
  'email',
  'gstNumber',
];

// ---------------------------------------------------------------------------
// Schema Support Detection & Cache
// ---------------------------------------------------------------------------

let _extendedColumnsSupported = null; // null = unverified/unknown, true = verified present, false = verified missing
let _cachedClient = null;

export function setExtendedColumnsSupport(supported, client = null) {
  _extendedColumnsSupported = supported;
  _cachedClient = client;
}

export function getExtendedColumnsSupport() {
  return _extendedColumnsSupported;
}

export function resetExtendedColumnsCache() {
  _extendedColumnsSupported = null;
  _cachedClient = null;
}

/**
 * Checks whether the error corresponds to a missing database column,
 * handling both PostgreSQL 42703 and Supabase/PostgREST PGRST204 schema cache errors.
 */
export function isMissingColumnError(error) {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const msg = String(error.message || '').toLowerCase();
  const details = String(error.details || '').toLowerCase();
  const hint = String(error.hint || '').toLowerCase();

  return (
    code === '42703' || // PostgreSQL undefined_column
    code === 'PGRST204' || // PostgREST column not in schema cache
    code === 'PGRST200' ||
    msg.includes('schema cache') ||
    msg.includes('could not find the') ||
    (msg.includes('column') && (msg.includes('does not exist') || msg.includes('not found'))) ||
    details.includes('schema cache') ||
    (details.includes('column') && details.includes('does not exist')) ||
    hint.includes('column')
  );
}

/**
 * Probes the Supabase database to verify if extended columns exist in public.gym_info.
 *
 * Strict three-state return:
 *  - true: extended columns verified present in schema.
 *  - false: missing-column/schema-cache error positively identified (migration pending).
 *  - null: schema support could not be determined due to network, timeout, permission, or other error.
 *
 * Fail-closed security: unknown (null) is NEVER interpreted as true.
 */
export async function detectExtendedColumnsSupport(client, configured) {
  const activeClient = await getClient(client);
  const isConfigured = await getConfigured(configured);

  if (!isConfigured || !activeClient) {
    return null;
  }

  // Invalidate cache if a different client instance is provided
  if (_cachedClient !== null && _cachedClient !== activeClient) {
    _extendedColumnsSupported = null;
  }
  _cachedClient = activeClient;

  if (_extendedColumnsSupported !== null) {
    return _extendedColumnsSupported;
  }

  try {
    const { error } = await activeClient
      .from('gym_info')
      .select(EXTENDED_COLUMNS.join(', '))
      .limit(1);

    if (error) {
      if (isMissingColumnError(error)) {
        _extendedColumnsSupported = false;
        _cachedClient = activeClient;
        return false;
      }
      // Schema support could not be determined due to network, timeout, permission, or other unrelated errors
      _extendedColumnsSupported = null;
      return null;
    }

    _extendedColumnsSupported = true;
    _cachedClient = activeClient;
    return true;
  } catch {
    _extendedColumnsSupported = null;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Normalizer: maps database snake_case → frontend camelCase
// ONLY uses actual database row attributes — NEVER fabricates values.
// ---------------------------------------------------------------------------
export function normalizeGymInfo(row) {
  if (!row) return null;
  return {
    id:             row.id,
    name:           row.name            ?? '',
    tagline:        row.tagline         ?? '',
    address:        row.address         ?? '',
    phone:          row.phone           ?? '',
    whatsapp:       row.whatsapp_number ?? '',
    email:          row.email           ?? '',
    timings:        row.operating_hours ?? '',
    location:       row.location        ?? '',
    ownerName:      row.owner_name      ?? '',
    headCoach:      row.head_coach      ?? '',
    gstNumber:      row.gst_number      ?? '',
    currencyCode:   row.currency_code   ?? 'INR',
    currencySymbol: row.currency_symbol ?? '₹',
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Denormalizer: maps frontend camelCase fields → database snake_case columns.
// ---------------------------------------------------------------------------
export function denormalizeGymInfoFields(fields) {
  const columnMap = {
    name:           'name',
    tagline:        'tagline',
    address:        'address',
    phone:          'phone',
    whatsapp:       'whatsapp_number',
    email:          'email',
    timings:        'operating_hours',
    location:       'location',
    ownerName:      'owner_name',
    headCoach:      'head_coach',
    gstNumber:      'gst_number',
  };

  const dbFields = {};
  for (const [frontendKey, dbColumn] of Object.entries(columnMap)) {
    if (Object.prototype.hasOwnProperty.call(fields, frontendKey)) {
      const val = fields[frontendKey];
      dbFields[dbColumn] = typeof val === 'string' ? val.trim() : (val ?? null);
    }
  }
  return dbFields;
}

// ---------------------------------------------------------------------------
// fetchGymInfo()
//
// Fetches the authoritative gym profile row from public.gym_info.
// If extended columns are missing, falls back to BASE_COLUMNS and explicitly
// flags migrationPending: true.
// ---------------------------------------------------------------------------
export async function fetchGymInfo(client, configured) {
  const activeClient = await getClient(client);
  const isConfigured = await getConfigured(configured);

  if (!isConfigured || !activeClient) {
    return {
      data: null,
      error: new Error(
        '[gymInfoService] Supabase is not configured. ' +
        'Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env.local file.'
      ),
      migrationPending: false,
    };
  }

  try {
    const { data, error } = await activeClient
      .from('gym_info')
      .select(GYM_INFO_COLUMNS_STRING)
      .limit(2);

    if (error) {
      console.error('[gymInfoService] fetchGymInfo database error:', error);

      if (isMissingColumnError(error)) {
        _extendedColumnsSupported = false;
        _cachedClient = activeClient;
        console.warn(
          '[gymInfoService] Extended columns missing in public.gym_info. ' +
          'Run migration 20261101000000_phase1_gym_info_missing_columns.sql.'
        );

        const { data: fallbackData, error: fallbackError } = await activeClient
          .from('gym_info')
          .select(BASE_COLUMNS_STRING)
          .limit(2);

        if (fallbackError) {
          return {
            data: null,
            error: new Error(fallbackError.message || 'Failed to fetch gym profile from database.'),
            migrationPending: true,
          };
        }

        if (!fallbackData || fallbackData.length === 0) {
          return {
            data: null,
            error: new Error('No gym profile record found in database.'),
            migrationPending: true,
          };
        }

        if (fallbackData.length > 1) {
          console.error('[gymInfoService] Multiple gym_info rows found — expected singleton.', fallbackData.map(r => r.id));
          return {
            data: null,
            error: new Error('Data integrity error: multiple gym profile records found. Contact your database administrator.'),
            migrationPending: true,
          };
        }

        return {
          data: normalizeGymInfo(fallbackData[0]),
          error: null,
          migrationPending: true,
        };
      }

      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch gym profile from database.'),
        migrationPending: false,
      };
    }

    if (!data || data.length === 0) {
      return {
        data: null,
        error: new Error('No gym profile record found in the database. Run initial schema migrations.'),
        migrationPending: false,
      };
    }

    if (data.length > 1) {
      console.error('[gymInfoService] Multiple gym_info rows found (expected singleton):', data.map(r => r.id));
      return {
        data: null,
        error: new Error('Data integrity error: multiple gym profile records exist. Contact database administrator.'),
        migrationPending: false,
      };
    }

    _extendedColumnsSupported = true;
    _cachedClient = activeClient;
    return {
      data: normalizeGymInfo(data[0]),
      error: null,
      migrationPending: false,
    };
  } catch (err) {
    console.error('[gymInfoService] Unexpected error in fetchGymInfo:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
      migrationPending: false,
    };
  }
}

// ---------------------------------------------------------------------------
// updateGymInfo(id, fields)
//
// Updates the authoritative gym profile row identified by `id`.
//
// Strict Safety Invariants:
// 1. NEVER reports success for fields that were not actually persisted.
// 2. If extended fields are submitted while the migration is pending,
//    returns a clear migration-required error BEFORE writing.
// 3. If mixed fields (base + extended) are submitted while the migration is
//    pending, refuses to partially save base fields.
// 4. Returns strictly database-confirmed values read back from PostgreSQL.
// 5. Preserves existing row-ID update approach, RLS behavior, and select.
// ---------------------------------------------------------------------------
export async function updateGymInfo(id, fields, client, configured) {
  const activeClient = await getClient(client);
  const isConfigured = await getConfigured(configured);

  if (!isConfigured || !activeClient) {
    return {
      data: null,
      error: new Error('[gymInfoService] Supabase is not configured.'),
      migrationPending: false,
    };
  }

  if (!id) {
    return {
      data: null,
      error: new Error('[gymInfoService] Cannot update gym info: record ID is missing. Load gym info first.'),
      migrationPending: false,
    };
  }

  if (!fields || Object.keys(fields).length === 0) {
    return {
      data: null,
      error: new Error('[gymInfoService] No fields provided to update.'),
      migrationPending: false,
    };
  }

  // 1. Determine which extended and base fields are being submitted
  const submittedExtendedFields = EXTENDED_FIELD_KEYS.filter(
    k => Object.prototype.hasOwnProperty.call(fields, k) && fields[k] !== undefined
  );
  const hasExtendedFields = submittedExtendedFields.length > 0;

  // 2. Pre-write check: detect if extended columns exist in the database schema
  const extendedSupported = await detectExtendedColumnsSupport(activeClient, isConfigured);

  // Block extended-field writes when schema support is false OR unknown (null).
  // Show different helpful errors for migration pending vs schema verification unavailable.
  if (hasExtendedFields) {
    const fieldNames = submittedExtendedFields.join(', ');
    if (extendedSupported === false) {
      return {
        data: null,
        error: new Error(
          `Cannot save gym profile: database migration pending for extended fields (${fieldNames}). ` +
          'Please apply migration 20261101000000_phase1_gym_info_missing_columns.sql in Supabase. ' +
          'No changes were saved.'
        ),
        migrationPending: true,
        schemaVerificationFailed: false,
        unsupportedFields: submittedExtendedFields,
      };
    }
    if (extendedSupported === null) {
      return {
        data: null,
        error: new Error(
          `Cannot save gym profile: unable to verify database schema support for extended fields (${fieldNames}) due to a network or connection issue. ` +
          'Please check your connection and try again. No changes were saved.'
        ),
        migrationPending: false,
        schemaVerificationFailed: true,
        unsupportedFields: submittedExtendedFields,
      };
    }
  }

  // 3. Denormalize input fields to database column map
  const dbFields = denormalizeGymInfoFields(fields);
  dbFields.updated_at = new Date().toISOString();

  if (Object.keys(dbFields).length <= 1) {
    return {
      data: null,
      error: new Error('[gymInfoService] No recognized editable fields were provided.'),
      migrationPending: _extendedColumnsSupported === false,
      schemaVerificationFailed: false,
    };
  }

  // 4. Select appropriate columns based on schema support
  // When extendedSupported is confirmed true, select all columns.
  // When false or unknown, select confirmed base columns only.
  const selectColumns = extendedSupported === true ? GYM_INFO_COLUMNS_STRING : BASE_COLUMNS_STRING;

  try {
    const { data, error } = await activeClient
      .from('gym_info')
      .update(dbFields)
      .eq('id', id)
      .select(selectColumns)
      .single();

    if (error) {
      console.error('[gymInfoService] updateGymInfo database error:', error);

      // Handle missing-column error dynamically (if schema changed after initial check)
      if (isMissingColumnError(error)) {
        _extendedColumnsSupported = false;
        _cachedClient = activeClient;

        // If the user was trying to update extended fields, do not save base fields
        if (hasExtendedFields) {
          return {
            data: null,
            error: new Error(
              `Cannot save gym profile: database migration pending for extended fields (${submittedExtendedFields.join(', ')}). ` +
              'Please apply migration 20261101000000_phase1_gym_info_missing_columns.sql in Supabase. ' +
              'No changes were saved.'
            ),
            migrationPending: true,
            schemaVerificationFailed: false,
            unsupportedFields: submittedExtendedFields,
          };
        }

        // If ONLY base fields were submitted, retry with only base columns if selectColumns wasn't base
        if (selectColumns !== BASE_COLUMNS_STRING) {
          const baseDbFields = {};
          for (const col of BASE_COLUMNS) {
            if (col !== 'id' && col !== 'created_at' && dbFields[col] !== undefined) {
              baseDbFields[col] = dbFields[col];
            }
          }
          baseDbFields.updated_at = dbFields.updated_at;

          const { data: retryData, error: retryError } = await activeClient
            .from('gym_info')
            .update(baseDbFields)
            .eq('id', id)
            .select(BASE_COLUMNS_STRING)
            .single();

          if (retryError) {
            return {
              data: null,
              error: new Error(retryError.message || 'Failed to save base gym profile.'),
              migrationPending: true,
              schemaVerificationFailed: false,
            };
          }

          if (!retryData) {
            return {
              data: null,
              error: new Error('Update returned no data from database.'),
              migrationPending: true,
              schemaVerificationFailed: false,
            };
          }

          // Return strictly confirmed database data — no fake values
          return {
            data: normalizeGymInfo(retryData),
            error: null,
            migrationPending: true,
            schemaVerificationFailed: false,
          };
        }

        // Base schema missing or corrupt
        return {
          data: null,
          error: new Error('Cannot save gym profile: base gym_info table or columns are missing in the database schema.'),
          migrationPending: true,
          schemaVerificationFailed: false,
        };
      }

      // Handle RLS permission denial
      if (
        error.code === '42501' ||
        error.message?.toLowerCase().includes('permission') ||
        error.message?.toLowerCase().includes('violates row-level security')
      ) {
        return {
          data: null,
          error: new Error(
            'Permission denied: only administrators can update gym profile settings. ' +
            `(${error.message})`
          ),
          migrationPending: _extendedColumnsSupported === false,
          schemaVerificationFailed: false,
        };
      }

      return {
        data: null,
        error: new Error(error.message || 'Failed to save gym profile to database.'),
        migrationPending: _extendedColumnsSupported === false,
        schemaVerificationFailed: false,
      };
    }

    if (!data) {
      return {
        data: null,
        error: new Error(
          'Update returned no data — the gym profile record may not exist or RLS blocked the read-back.'
        ),
        migrationPending: _extendedColumnsSupported === false,
        schemaVerificationFailed: false,
      };
    }

    // Return strictly confirmed database values
    return {
      data: normalizeGymInfo(data),
      error: null,
      migrationPending: _extendedColumnsSupported === false,
      schemaVerificationFailed: false,
    };
  } catch (err) {
    console.error('[gymInfoService] Unexpected error in updateGymInfo:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
      migrationPending: _extendedColumnsSupported === false,
      schemaVerificationFailed: false,
    };
  }
}
