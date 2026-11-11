/**
 * reminderSettingsService.js
 * The Fitness House Gym Management Admin Panel
 *
 * Provides typed, structured methods for querying and updating automated reminder
 * preferences stored in the singleton public.reminder_settings table in Supabase.
 *
 * Safety & Integrity Design:
 *  - Authoritative Singleton: Targets public.reminder_settings guarded by singleton_guard = true.
 *  - 7 Field Exact Mapping:
 *      fiveDay       <-> five_day
 *      threeDay      <-> three_day
 *      oneDay        <-> one_day
 *      expiryDay     <-> expiry_day
 *      paymentAlerts <-> payment_alerts
 *      autoWhatsApp  <-> auto_whatsapp
 *      smsFallback   <-> sms_fallback
 *  - Never Fabricates Success: Always reads back database-confirmed values.
 *  - Safe Defaults: Returns all-active defaults if row has not been seeded yet.
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
// Defaults & Normalizer
// ---------------------------------------------------------------------------

export const DEFAULT_REMINDER_SETTINGS = Object.freeze({
  fiveDay: true,
  threeDay: true,
  oneDay: true,
  expiryDay: true,
  paymentAlerts: true,
  autoWhatsApp: false,
  smsFallback: false,
});

/**
 * Normalizes a raw database row from public.reminder_settings for frontend consumption.
 * Maps snake_case database columns to camelCase UI properties.
 *
 * @param {object|null} row
 * @returns {object}
 */
export function normalizeReminderSettings(row) {
  if (!row) {
    return { ...DEFAULT_REMINDER_SETTINGS, id: null, updatedAt: null, updatedBy: null };
  }

  return {
    id: row.id || null,
    fiveDay: row.five_day !== undefined ? Boolean(row.five_day) : DEFAULT_REMINDER_SETTINGS.fiveDay,
    threeDay: row.three_day !== undefined ? Boolean(row.three_day) : DEFAULT_REMINDER_SETTINGS.threeDay,
    oneDay: row.one_day !== undefined ? Boolean(row.one_day) : DEFAULT_REMINDER_SETTINGS.oneDay,
    expiryDay: row.expiry_day !== undefined ? Boolean(row.expiry_day) : DEFAULT_REMINDER_SETTINGS.expiryDay,
    paymentAlerts: row.payment_alerts !== undefined ? Boolean(row.payment_alerts) : DEFAULT_REMINDER_SETTINGS.paymentAlerts,
    autoWhatsApp: row.auto_whatsapp !== undefined ? Boolean(row.auto_whatsapp) : DEFAULT_REMINDER_SETTINGS.autoWhatsApp,
    smsFallback: row.sms_fallback !== undefined ? Boolean(row.sms_fallback) : DEFAULT_REMINDER_SETTINGS.smsFallback,
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null,
  };
}

/**
 * Formats database errors into user-friendly diagnostic messages.
 *
 * @param {object|Error} error
 * @returns {string}
 */
export function parseReminderSettingsError(error) {
  if (!error) return 'An unexpected database error occurred.';
  const code = String(error.code || '').toUpperCase();
  const message = String(error.message || '');

  // 42501: RLS permission violation
  if (code === '42501' || message.toLowerCase().includes('violates row-level security') || message.toLowerCase().includes('permission denied')) {
    return 'Permission denied: only administrators can update reminder automation settings.';
  }

  return error.message || 'Database operation failed.';
}

// ---------------------------------------------------------------------------
// Service Methods
// ---------------------------------------------------------------------------

/**
 * Fetches the current reminder automation preferences from public.reminder_settings.
 * Returns defaults if the table has not yet been seeded.
 *
 * @param {object} [client]
 * @param {boolean} [configured]
 * @returns {Promise<{ data: object, error: Error|null }>}
 */
export async function fetchReminderSettings(client, configured) {
  const activeClient = await getClient(client);
  const isConfigured = await getConfigured(configured);

  if (!isConfigured || !activeClient) {
    return {
      data: { ...DEFAULT_REMINDER_SETTINGS },
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
    };
  }

  try {
    const { data, error } = await activeClient
      .from('reminder_settings')
      .select('*')
      .eq('singleton_guard', true)
      .maybeSingle();

    if (error) {
      console.error('[reminderSettingsService] Database error fetching settings:', error);
      return {
        data: { ...DEFAULT_REMINDER_SETTINGS },
        error: new Error(error.message || 'Failed to fetch reminder settings.'),
      };
    }

    if (!data) {
      // Table exists but unseeded; return defaults safely without throwing
      return {
        data: { ...DEFAULT_REMINDER_SETTINGS },
        error: null,
      };
    }

    return {
      data: normalizeReminderSettings(data),
      error: null,
    };
  } catch (err) {
    console.error('[reminderSettingsService] Unexpected exception fetching settings:', err);
    return {
      data: { ...DEFAULT_REMINDER_SETTINGS },
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Updates reminder automation preferences in the singleton public.reminder_settings row.
 * Returns the database-confirmed record.
 *
 * @param {object} settings - object containing up to 7 boolean toggles
 * @param {object} [client]
 * @param {boolean} [configured]
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function updateReminderSettings(settings, client, configured) {
  const activeClient = await getClient(client);
  const isConfigured = await getConfigured(configured);

  if (!isConfigured || !activeClient) {
    return {
      data: null,
      error: new Error('Supabase client is not configured.'),
    };
  }

  if (!settings || typeof settings !== 'object') {
    return {
      data: null,
      error: new Error('Settings payload must be provided as an object.'),
    };
  }

  const payload = {
    updated_at: new Date().toISOString(),
  };

  if (settings.fiveDay !== undefined) payload.five_day = Boolean(settings.fiveDay);
  if (settings.threeDay !== undefined) payload.three_day = Boolean(settings.threeDay);
  if (settings.oneDay !== undefined) payload.one_day = Boolean(settings.oneDay);
  if (settings.expiryDay !== undefined) payload.expiry_day = Boolean(settings.expiryDay);
  if (settings.paymentAlerts !== undefined) payload.payment_alerts = Boolean(settings.paymentAlerts);
  if (settings.autoWhatsApp !== undefined) payload.auto_whatsapp = Boolean(settings.autoWhatsApp);
  if (settings.smsFallback !== undefined) payload.sms_fallback = Boolean(settings.smsFallback);

  try {
    const { data, error } = await activeClient
      .from('reminder_settings')
      .update(payload)
      .eq('singleton_guard', true)
      .select('*')
      .single();

    if (error) {
      console.error('[reminderSettingsService] Database error updating settings:', error);
      return {
        data: null,
        error: new Error(parseReminderSettingsError(error)),
      };
    }

    if (!data) {
      return {
        data: null,
        error: new Error('Settings update succeeded but no record was returned.'),
      };
    }

    return {
      data: normalizeReminderSettings(data),
      error: null,
    };
  } catch (err) {
    console.error('[reminderSettingsService] Unexpected exception updating settings:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

