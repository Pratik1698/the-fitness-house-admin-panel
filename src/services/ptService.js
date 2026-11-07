import { supabase as defaultSupabase, isSupabaseConfigured as defaultIsConfigured } from './supabaseClient.js';
import { calculateExpiryDate } from '../utils/memberUtils.js';

/**
 * Personal Training Service
 * The Fitness House Gym Management Admin Panel
 *
 * Provides typed methods for interacting with PT assignments, sessions, and trainers in Supabase.
 * Enforces atomic database RPC assignment (assign_pt_package) with idempotency, advisory locking,
 * and role-based financial masking.
 */

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

function getActiveConfigured() {
  if (_injectedConfigured !== null) return _injectedConfigured;
  return defaultIsConfigured;
}

/**
 * Fetches all active trainers from public.trainers.
 *
 * @returns {Promise<{ data: Array<object>|null, error: Error|null }>}
 */
export async function getTrainers() {
  const client = getActiveClient();
  const configured = getActiveConfigured();

  if (!configured || !client) {
    return {
      data: [{ id: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72', name: 'Coach Pravin Joshi', phone: '+91 7385846525', is_active: true }],
      error: null,
    };
  }

  try {
    const { data, error } = await client
      .from('trainers')
      .select('id, name, phone, is_active')
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('[ptService.getTrainers] Database error:', error);
      return { data: null, error: new Error(error.message || 'Failed to fetch trainers from database.') };
    }

    return { data: data || [], error: null };
  } catch (err) {
    console.error('[ptService.getTrainers] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Fetches all PT assignments from public.pt_assignments joined with
 * members, trainers, and pt_packages.
 *
 * @param {object} [options]
 * @param {boolean} [options.includeFinancials=false] - Whether to query v_admin_pt_assignments (admin only)
 * @returns {Promise<{ data: Array<object>|null, error: Error|null }>}
 */
export async function getPtAssignments({ includeFinancials = false } = {}) {
  const client = getActiveClient();
  const configured = getActiveConfigured();

  if (!configured || !client) {
    return {
      data: null,
      error: new Error('Supabase client is not configured.'),
    };
  }

  try {
    const relation = includeFinancials ? 'v_admin_pt_assignments' : 'pt_assignments';
    const financialColumns = includeFinancials ? 'fee_amount, amount_paid, balance,' : '';
    const { data, error } = await client
      .from(relation)
      .select(`
        id,
        member_id,
        package_id,
        trainer_id,
        total_sessions,
        completed_sessions,
        ${financialColumns}
        status,
        start_date,
        notes,
        created_at,
        members (
          id,
          name,
          member_code,
          phone
        ),
        trainers (
          id,
          name,
          phone
        ),
        pt_packages (
          id,
          name,
          total_sessions,
          price,
          validity_days
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(`[ptService.getPtAssignments:${relation}] Database error:`, error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch PT assignments from database.'),
      };
    }

    const normalized = (data || []).map((row) => {
      const member = row.members || {};
      const trainer = row.trainers || {};
      const pkg = row.pt_packages || {};
      const total = Number(row.total_sessions) || Number(pkg.total_sessions) || 0;
      const completed = Number(row.completed_sessions) || 0;
      const remaining = Math.max(0, total - completed);
      const validityDays = Number(pkg.validity_days) || 30;
      const validTill = row.start_date ? calculateExpiryDate(row.start_date, validityDays) : '';

      return {
        id: row.id,
        assignmentId: row.id,
        memberId: row.member_id,
        memberName: member.name || 'Member',
        memberCode: member.member_code || '',
        phone: member.phone || '',
        packageId: row.package_id,
        package: pkg.name || 'PT Package',
        trainerId: row.trainer_id,
        trainer: trainer.name || 'Coach Pravin Joshi',
        totalSessions: total,
        completedSessions: completed,
        remainingSessions: remaining,
        feeAmount: Number(row.fee_amount || 0),
        amountPaid: Number(row.amount_paid || 0),
        balance: Number(row.balance || 0),
        status: row.status,
        startDate: row.start_date,
        validTill,
        validityDays,
        notes: row.notes || '',
      };
    });

    return { data: normalized, error: null };
  } catch (err) {
    console.error('[ptService.getPtAssignments] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Assigns a personal training package to a member via the authoritative atomic database RPC.
 *
 * Enforces:
 * - Atomic database transaction (creates pt_assignments and initial payment atomically).
 * - Idempotency key tracking in public.idempotency_keys.
 * - Concurrency control via advisory transaction locking.
 * - Role-based authorization: staff must have initialPaymentAmount = 0.
 * - Financial masking: staff receives masked response (no fees/balances), admin receives full financial details.
 *
 * @param {object} payload
 * @param {string} payload.memberId - UUID of active member
 * @param {string} payload.packageId - UUID of active PT package
 * @param {string} payload.trainerId - UUID of active trainer
 * @param {string} payload.startDate - Start date in YYYY-MM-DD
 * @param {number} [payload.initialPaymentAmount=0] - Initial payment (must be 0 for staff)
 * @param {string} [payload.paymentMethod='Cash'] - Payment method ('Cash', 'UPI', 'Card') if initialPayment > 0
 * @param {string} [payload.notes=''] - Optional assignment notes
 * @param {string} [payload.idempotencyKey] - Unique idempotency key (defaults to UUID)
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function assignPtPackage({
  memberId,
  packageId,
  trainerId,
  startDate,
  initialPaymentAmount = 0,
  paymentMethod = 'Cash',
  notes = '',
  idempotencyKey,
} = {}) {
  const client = getActiveClient();
  const configured = getActiveConfigured();

  if (!configured || !client) {
    return { data: null, error: new Error('Supabase client is not configured.') };
  }

  // Input validation
  if (!memberId) {
    return { data: null, error: new Error('Member ID is required.') };
  }
  if (!packageId) {
    return { data: null, error: new Error('PT Package ID is required.') };
  }
  if (!trainerId) {
    return { data: null, error: new Error('Trainer ID is required.') };
  }
  if (!startDate) {
    return { data: null, error: new Error('Start date is required.') };
  }

  const numericAmount = Number(initialPaymentAmount || 0);
  if (isNaN(numericAmount) || numericAmount < 0) {
    return { data: null, error: new Error('Initial payment amount cannot be negative.') };
  }

  const key = idempotencyKey || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `pt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);

  try {
    const { data, error } = await client.rpc('assign_pt_package', {
      p_member_id: memberId,
      p_package_id: packageId,
      p_trainer_id: trainerId,
      p_start_date: startDate,
      p_initial_payment_amount: numericAmount,
      p_payment_method: numericAmount > 0 ? paymentMethod : null,
      p_notes: notes ? notes.trim() : null,
      p_idempotency_key: key,
    });

    if (error) {
      console.error('[ptService.assignPtPackage] RPC Error:', error);
      return { data: null, error: new Error(error.message || 'Failed to assign PT package.') };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[ptService.assignPtPackage] Unexpected exception:', err);
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Fetches PT sessions from public.pt_scheduled_sessions joined with
 * pt_assignments, members, and trainers.
 * Falls back to public.pt_sessions for backwards compatibility if pt_scheduled_sessions is unavailable.
 *
 * @returns {Promise<{ data: Array<object>|null, error: Error|null }>}
 */
export async function getPtSessions() {
  const client = getActiveClient();
  const configured = getActiveConfigured();

  if (!configured || !client) {
    return {
      data: null,
      error: new Error('Supabase client is not configured.'),
    };
  }

  try {
    // 1. Primary: Query pt_scheduled_sessions (scheduled, completed, cancelled)
    const { data: schedData, error: schedError } = await client
      .from('pt_scheduled_sessions')
      .select(`
        id,
        session_code,
        assignment_id,
        member_id,
        trainer_id,
        session_date,
        session_time,
        notes,
        status,
        completed_session_id,
        created_at,
        members (
          id,
          name,
          member_code
        ),
        trainers (
          id,
          name
        )
      `)
      .order('session_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (!schedError && schedData) {
      const normalized = schedData.map((row) => {
        const member = row.members || {};
        const trainer = row.trainers || {};

        return {
          id: row.id,
          sessionCode: row.session_code || '',
          assignmentId: row.assignment_id,
          memberId: row.member_id,
          memberName: member.name || 'Member',
          memberCode: member.member_code || '',
          trainerId: row.trainer_id,
          trainer: trainer.name || 'Coach Pravin Joshi',
          date: row.session_date,
          time: row.session_time || '07:00 AM',
          status: row.status || 'scheduled',
          notes: row.notes || '',
          completedSessionId: row.completed_session_id,
          createdAt: row.created_at,
        };
      });

      return { data: normalized, error: null };
    }

    // 2. Fallback: If pt_scheduled_sessions is unavailable, fall back to pt_sessions
    const { data: legData, error: legError } = await client
      .from('pt_sessions')
      .select(`
        id,
        assignment_id,
        session_number,
        conducted_at,
        trainer_id,
        notes,
        actor_id,
        created_at,
        pt_assignments (
          id,
          member_id,
          members (
            id,
            name,
            member_code
          )
        ),
        trainers (
          id,
          name
        )
      `)
      .order('conducted_at', { ascending: false });

    if (legError) {
      console.error('[ptService.getPtSessions] Database error:', schedError || legError);
      return {
        data: null,
        error: new Error((schedError || legError).message || 'Failed to fetch PT sessions from database.'),
      };
    }

    const legacyNormalized = (legData || []).map((row) => {
      const assignment = row.pt_assignments || {};
      const member = assignment.members || {};
      const trainer = row.trainers || {};
      const dateStr = row.conducted_at ? row.conducted_at.split('T')[0] : '';
      const timeStr = row.conducted_at
        ? new Date(row.conducted_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
        : '';

      return {
        id: row.id,
        sessionCode: `PTS${String(row.session_number || 1).padStart(3, '0')}`,
        assignmentId: row.assignment_id,
        memberId: assignment.member_id,
        memberName: member.name || 'Member',
        memberCode: member.member_code || '',
        sessionNumber: row.session_number,
        trainerId: row.trainer_id,
        trainer: trainer.name || 'Coach Pravin Joshi',
        date: dateStr,
        time: timeStr,
        conductedAt: row.conducted_at,
        status: 'completed',
        notes: row.notes || `Completed session #${row.session_number}`,
      };
    });

    return { data: legacyNormalized, error: null };
  } catch (err) {
    console.error('[ptService.getPtSessions] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Schedules a new PT session appointment in Supabase via public.schedule_pt_session RPC.
 *
 * @param {object} params
 * @param {string} params.assignmentId - UUID of active PT assignment
 * @param {string} params.sessionDate - Date of session in YYYY-MM-DD
 * @param {string} params.sessionTime - Time slot (e.g. '07:00 AM')
 * @param {string} [params.notes=''] - Optional session notes
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function schedulePtSession({
  assignmentId,
  sessionDate,
  sessionTime,
  notes = '',
} = {}) {
  const client = getActiveClient();
  const configured = getActiveConfigured();

  if (!configured || !client) {
    return { data: null, error: new Error('Supabase client is not configured.') };
  }
  if (!assignmentId) {
    return { data: null, error: new Error('Assignment ID is required.') };
  }
  if (!sessionDate) {
    return { data: null, error: new Error('Session date is required.') };
  }
  if (!sessionTime) {
    return { data: null, error: new Error('Session time slot is required.') };
  }

  try {
    const { data, error } = await client.rpc('schedule_pt_session', {
      p_assignment_id: assignmentId,
      p_session_date: sessionDate,
      p_session_time: sessionTime,
      p_notes: notes ? notes.trim() : null,
    });

    if (error) {
      console.error('[ptService.schedulePtSession] RPC error:', error);
      return { data: null, error: new Error(error.message || 'Failed to schedule PT session.') };
    }

    return {
      data: data ? {
        ...data,
        id: data.id || data.session_id,
        sessionCode: data.session_code || data.sessionCode || '',
      } : null,
      error: null,
    };
  } catch (err) {
    console.error('[ptService.schedulePtSession] Unexpected exception:', err);
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Completes a PT session via public.complete_pt_session RPC.
 * Atomically deducts 1 session credit from the assignment and marks scheduled session as completed.
 *
 * @param {object} params
 * @param {string} params.assignmentId - UUID of active PT assignment
 * @param {string} [params.notes=''] - Notes describing the session conducted
 * @param {string} [params.scheduledSessionId=null] - UUID of scheduled session to complete
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function completePtSession({
  assignmentId,
  notes = '',
  scheduledSessionId = null,
} = {}) {
  const client = getActiveClient();
  const configured = getActiveConfigured();

  if (!configured || !client) {
    return { data: null, error: new Error('Supabase client is not configured.') };
  }
  if (!assignmentId) {
    return { data: null, error: new Error('Assignment ID is required.') };
  }

  try {
    const { data, error } = await client.rpc('complete_pt_session', {
      p_assignment_id: assignmentId,
      p_notes: notes ? notes.trim() : null,
      p_scheduled_session_id: scheduledSessionId || null,
    });

    if (error) {
      console.error('[ptService.completePtSession] RPC error:', error);
      return { data: null, error: new Error(error.message || 'Failed to complete PT session.') };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[ptService.completePtSession] Unexpected exception:', err);
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Cancels a scheduled PT session via public.cancel_pt_scheduled_session RPC.
 * Does NOT deduct session credits.
 *
 * @param {object} params
 * @param {string} params.scheduledSessionId - UUID of scheduled session to cancel
 * @param {string} [params.notes=''] - Reason for cancellation
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function cancelPtSession({
  scheduledSessionId,
  notes = '',
} = {}) {
  const client = getActiveClient();
  const configured = getActiveConfigured();

  if (!configured || !client) {
    return { data: null, error: new Error('Supabase client is not configured.') };
  }
  if (!scheduledSessionId) {
    return { data: null, error: new Error('Scheduled session ID is required.') };
  }

  try {
    const { data, error } = await client.rpc('cancel_pt_scheduled_session', {
      p_scheduled_session_id: scheduledSessionId,
      p_notes: notes ? notes.trim() : null,
    });

    if (error) {
      console.error('[ptService.cancelPtSession] RPC error:', error);
      return { data: null, error: new Error(error.message || 'Failed to cancel PT session.') };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[ptService.cancelPtSession] Unexpected exception:', err);
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Updates a pending scheduled PT session via public.update_pt_scheduled_session RPC.
 *
 * @param {object} params
 * @param {string} params.scheduledSessionId - UUID of scheduled session to update
 * @param {string} [params.sessionDate] - Updated session date (YYYY-MM-DD)
 * @param {string} [params.sessionTime] - Updated time slot
 * @param {string} [params.notes] - Updated notes
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function updatePtScheduledSession({
  scheduledSessionId,
  sessionDate,
  sessionTime,
  notes = '',
} = {}) {
  const client = getActiveClient();
  const configured = getActiveConfigured();

  if (!configured || !client) {
    return { data: null, error: new Error('Supabase client is not configured.') };
  }
  if (!scheduledSessionId) {
    return { data: null, error: new Error('Scheduled session ID is required.') };
  }

  try {
    const { data, error } = await client.rpc('update_pt_scheduled_session', {
      p_scheduled_session_id: scheduledSessionId,
      p_session_date: sessionDate || null,
      p_session_time: sessionTime ? sessionTime.trim() : null,
      p_notes: notes ? notes.trim() : null,
    });

    if (error) {
      console.error('[ptService.updatePtScheduledSession] RPC error:', error);
      return { data: null, error: new Error(error.message || 'Failed to update PT session.') };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[ptService.updatePtScheduledSession] Unexpected exception:', err);
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// Re-export PT package management methods for unified PT service interface
export {
  getPtPackages,
  createPtPackage,
  updatePtPackage,
  togglePtPackageStatus,
  normalizePtPackage,
  validatePtPackageInput,
} from './ptPackageService.js';
