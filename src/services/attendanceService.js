/**
 * The Fitness House — Persistent Attendance Service
 * File: src/services/attendanceService.js
 *
 * Handles live member check-in verification, check-out state transitions,
 * and attendance history retrieval backed by public.checkins and public.v_attendance_logs.
 */

import { supabase as defaultSupabase, isSupabaseConfigured as defaultIsConfigured } from './supabaseClient.js';
import { getLocalDateString } from '../utils/memberUtils.js';

// ---------------------------------------------------------------------------
// Testing Client Injection Support
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

function getActiveClient() {
  return _injectedClient || defaultSupabase;
}

function getIsConfigured() {
  return _injectedConfigured !== null ? _injectedConfigured : defaultIsConfigured;
}

/**
 * Normalizes a raw database attendance log record for UI consumption.
 */
function normalizeAttendanceRecord(row) {
  if (!row) return null;

  const checkedInDate = row.checked_in_at ? new Date(row.checked_in_at) : null;
  const checkedOutDate = row.checked_out_at ? new Date(row.checked_out_at) : null;

  // Format local date YYYY-MM-DD
  const dateStr = checkedInDate
    ? getLocalDateString(checkedInDate)
    : (row.created_at ? getLocalDateString(new Date(row.created_at)) : '');

  // Format 12-hour time (e.g. 06:30 AM)
  const timeStr = checkedInDate
    ? checkedInDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    : '';

  const checkoutTimeStr = checkedOutDate
    ? checkedOutDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    : null;

  return {
    id: row.checkin_code || row.id,
    checkinId: row.id,
    checkinCode: row.checkin_code || row.id,
    memberId: row.member_id,
    memberCode: row.member_code || '',
    memberName: row.member_name || '',
    memberPhone: row.member_phone || '',
    date: dateStr,
    time: timeStr,
    checkedInAt: row.checked_in_at,
    checkedOutAt: row.checked_out_at,
    checkedOutTime: checkoutTimeStr,
    plan: row.plan_name || 'General',
    status: row.status === 'checked_in' ? 'valid' : (row.status === 'checked_out' ? 'completed' : row.status),
    rawStatus: row.status,
    actorName: row.actor_name || 'Staff',
    actorId: row.actor_id,
    notes: row.notes || '',
  };
}

/**
 * Fetches attendance logs from the database view public.v_attendance_logs.
 *
 * @param {object} [options]
 * @param {string} [options.memberId] - Optional filter by member UUID
 * @param {string} [options.startDate] - Optional filter by start date ISO string
 * @param {string} [options.endDate] - Optional filter by end date ISO string
 * @param {number} [options.limit=200] - Record limit
 * @returns {Promise<{ data: Array|null, error: Error|null }>}
 */
export async function getAttendanceLogs(options = {}) {
  if (!getIsConfigured()) {
    return {
      data: null,
      error: new Error('Supabase client is not configured.'),
    };
  }

  try {
    let query = getActiveClient()
      .from('v_attendance_logs')
      .select('*')
      .order('checked_in_at', { ascending: false });

    if (options.memberId) {
      query = query.eq('member_id', options.memberId);
    }
    if (options.startDate) {
      query = query.gte('checked_in_at', options.startDate);
    }
    if (options.endDate) {
      query = query.lte('checked_in_at', options.endDate);
    }
    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[attendanceService.getAttendanceLogs] Database error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch attendance logs from database.'),
      };
    }

    const normalized = (data || []).map(normalizeAttendanceRecord);
    return { data: normalized, error: null };
  } catch (err) {
    console.error('[attendanceService.getAttendanceLogs] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Records a member check-in persistently via the authorized RPC public.record_member_checkin.
 * Validates active membership eligibility and prevents duplicate active sessions.
 *
 * @param {object} payload
 * @param {string} payload.memberId - Member UUID
 * @param {string} [payload.notes] - Optional check-in note
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function recordCheckin({ memberId, notes = '' }) {
  if (!getIsConfigured()) {
    return {
      data: null,
      error: new Error('Supabase client is not configured.'),
    };
  }

  if (!memberId) {
    return {
      data: null,
      error: new Error('Member ID is required to log check-in.'),
    };
  }

  try {
    const { data, error } = await getActiveClient().rpc('record_member_checkin', {
      p_member_id: memberId,
      p_notes: notes ? notes.trim() : null,
    });

    if (error) {
      console.error('[attendanceService.recordCheckin] RPC error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to record check-in in database.'),
      };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[attendanceService.recordCheckin] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Records a member check-out persistently via the authorized RPC public.record_member_checkout.
 *
 * @param {object} payload
 * @param {string} payload.checkinId - Check-in UUID
 * @param {string} [payload.notes] - Optional check-out note
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function recordCheckout({ checkinId, notes = '' }) {
  if (!getIsConfigured()) {
    return {
      data: null,
      error: new Error('Supabase client is not configured.'),
    };
  }

  if (!checkinId) {
    return {
      data: null,
      error: new Error('Check-in ID is required to record check-out.'),
    };
  }

  try {
    const { data, error } = await getActiveClient().rpc('record_member_checkout', {
      p_checkin_id: checkinId,
      p_notes: notes ? notes.trim() : null,
    });

    if (error) {
      console.error('[attendanceService.recordCheckout] RPC error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to record check-out in database.'),
      };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[attendanceService.recordCheckout] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Cancels a member check-in persistently via the authorized RPC public.cancel_member_checkin.
 *
 * @param {object} payload
 * @param {string} payload.checkinId - Check-in UUID
 * @param {string} [payload.reason] - Optional cancellation reason
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function cancelCheckin({ checkinId, reason = '' }) {
  if (!getIsConfigured()) {
    return {
      data: null,
      error: new Error('Supabase client is not configured.'),
    };
  }

  if (!checkinId) {
    return {
      data: null,
      error: new Error('Check-in ID is required to cancel check-in.'),
    };
  }

  try {
    const { data, error } = await getActiveClient().rpc('cancel_member_checkin', {
      p_checkin_id: checkinId,
      p_reason: reason ? reason.trim() : null,
    });

    if (error) {
      console.error('[attendanceService.cancelCheckin] RPC error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to cancel check-in in database.'),
      };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[attendanceService.cancelCheckin] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

