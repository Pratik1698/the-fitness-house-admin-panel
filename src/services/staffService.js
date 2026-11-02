import { supabase as defaultClient, isSupabaseConfigured as defaultIsConfigured } from './supabaseClient.js';

/**
 * Staff & Security Management Service
 * The Fitness House Gym Management Admin Panel (Phase 5)
 *
 * Provides typed, structured methods for staff roster retrieval, role elevation,
 * account status toggling, staff invitations, and security audit logs.
 */

// Injectable client for unit and integration testing without network calls
let activeClient = defaultClient;
let activeConfigured = defaultIsConfigured;

export function setSupabaseClientForTesting(client, configured = true) {
  activeClient = client;
  activeConfigured = configured;
}

export function resetSupabaseClientForTesting() {
  activeClient = defaultClient;
  activeConfigured = defaultIsConfigured;
}

async function getConfigured(configured) {
  if (typeof configured === 'function') {
    return await configured();
  }
  return configured;
}

/**
 * Normalizes database profile row to consistent camelCase object
 */
export function normalizeStaffMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name || '',
    name: row.full_name || '', // Compatibility alias
    email: row.email || null,
    role: (row.role || 'staff').toLowerCase(),
    isActive: row.is_active !== undefined ? Boolean(row.is_active) : true,
    createdAt: row.created_at || null,
    deactivatedAt: row.deactivated_at || null,
    invitedBy: row.invited_by || null,
  };
}

/**
 * Normalizes database invitation row
 */
export function normalizeInvitation(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email || '',
    fullName: row.full_name || '',
    role: row.role || 'staff',
    status: row.status || 'pending',
    invitedBy: row.invited_by || null,
    createdAt: row.created_at || null,
    expiresAt: row.expires_at || null,
    acceptedAt: row.accepted_at || null,
    revokedAt: row.revoked_at || null,
  };
}

/**
 * Validates staff invitation input
 */
export function validateInvitationInput({ email, fullName }) {
  const cleanEmail = email ? email.trim().toLowerCase() : '';
  const cleanName = fullName ? fullName.trim() : '';

  if (!cleanName || cleanName.length < 2) {
    return { valid: false, error: "Staff member's full name is required (minimum 2 characters)." };
  }

  if (!cleanEmail) {
    return { valid: false, error: 'Staff member email address is required.' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }

  return {
    valid: true,
    error: null,
    sanitized: {
      email: cleanEmail,
      fullName: cleanName,
    },
  };
}

/**
 * Parses database or edge function errors into clean user-facing messages
 */
export function parseStaffSecurityError(error) {
  if (!error) return null;
  const msg = error.message ? error.message : String(error);

  if (error.code === '42501' || msg.includes('FORBIDDEN') || msg.includes('row-level security')) {
    return 'Permission denied: Only active administrators can perform staff security operations.';
  }

  if (msg.includes('cannot deactivate their own account') || msg.includes('cannot demote their own account')) {
    return 'Operation prohibited: You cannot demote or deactivate your own administrator account.';
  }

  if (msg.includes('last active administrator')) {
    return 'Operation prohibited: Cannot demote or deactivate the gym’s last active administrator.';
  }

  if (msg.includes('already exists') || error.code === '23505') {
    return 'An active staff member or pending invitation with this email address already exists.';
  }

  if (msg.includes('PROFILE_NOT_FOUND')) {
    return 'The requested staff account was not found in the database.';
  }

  return msg || 'An unexpected staff security error occurred.';
}

/**
 * Fetches the staff roster from Supabase.
 * Administrators fetch full profiles (with email); staff members fetch sanitized roster.
 */
export async function getStaffRoster() {
  const isConfigured = await getConfigured(activeConfigured);
  if (!isConfigured || !activeClient) {
    return {
      data: [],
      error: new Error('Supabase client is not configured.'),
    };
  }

  try {
    // Attempt fetching from public.profiles first (returns emails for admins)
    let { data, error } = await activeClient
      .from('profiles')
      .select('id, email, full_name, role, is_active, created_at, deactivated_at')
      .order('created_at', { ascending: true });

    // If RLS restricted email access (for non-admin staff), fall back to public.v_staff_roster
    if (error && (error.code === '42501' || error.message?.includes('policy'))) {
      const fallback = await activeClient
        .from('v_staff_roster')
        .select('id, full_name, role, is_active, created_at, deactivated_at')
        .order('created_at', { ascending: true });

      if (fallback.error) {
        return { data: [], error: fallback.error };
      }
      data = fallback.data;
      error = null;
    }

    if (error) {
      return { data: [], error: new Error(parseStaffSecurityError(error)) };
    }

    const normalized = (data || []).map(normalizeStaffMember);
    return { data: normalized, error: null };
  } catch (err) {
    return {
      data: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Invites a new staff member via the secure invite-staff Edge Function
 */
export async function inviteStaffMember({ email, fullName }) {
  const isConfigured = await getConfigured(activeConfigured);
  if (!isConfigured || !activeClient) {
    return { data: null, error: new Error('Supabase client is not configured.') };
  }

  const validation = validateInvitationInput({ email, fullName });
  if (!validation.valid) {
    return { data: null, error: new Error(validation.error) };
  }

  const { email: cleanEmail, fullName: cleanName } = validation.sanitized;

  try {
    // Edge Function is required to securely invite staff and dispatch invitation emails
    if (activeClient.functions?.invoke) {
      const { data, error } = await activeClient.functions.invoke('invite-staff', {
        body: { action: 'invite', email: cleanEmail, fullName: cleanName },
      });

      if (error) {
        return { data: null, error: new Error(parseStaffSecurityError(error)) };
      }
      if (data?.error) {
        return { data: null, error: new Error(data.error) };
      }
      return { data, error: null };
    }

    return {
      data: null,
      error: new Error('Edge function invite-staff is required to send staff invitations.'),
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Updates a staff member's role (Admin <-> Staff) via public.admin_set_user_role RPC
 */
export async function updateStaffRole({ userId, role }) {
  const isConfigured = await getConfigured(activeConfigured);
  if (!isConfigured || !activeClient) {
    return { data: null, error: new Error('Supabase client is not configured.') };
  }

  if (!userId) {
    return { data: null, error: new Error('User ID is required.') };
  }

  const cleanRole = (role || '').trim().toLowerCase();
  if (!['admin', 'staff'].includes(cleanRole)) {
    return { data: null, error: new Error('Invalid role. Role must be admin or staff.') };
  }

  try {
    const { data, error } = await activeClient.rpc('admin_set_user_role', {
      p_user_id: userId,
      p_role: cleanRole,
    });

    if (error) {
      return { data: null, error: new Error(parseStaffSecurityError(error)) };
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Safely extracts structured details and error message from Supabase Functions responses or errors.
 * Handles:
 * - FunctionsHttpError where error.context is a fetch Response (calling .json() or .text())
 * - Mocked error objects where error.context is already an object
 * - Payload objects where error was returned under data.error
 * - Malformed, unreadable, or missing response bodies (safe fallback without throwing)
 */
export async function parseFunctionsErrorPayload(error, data) {
  // If data already contains structured error fields
  if (data && typeof data === 'object' && (data.error || data.dbDeactivated || data.dbReactivated)) {
    return data;
  }

  if (!error) return null;

  const context = error.context;
  if (context) {
    // If context is a fetch Response (has .json() method)
    if (typeof context.json === 'function') {
      try {
        const target = typeof context.clone === 'function' ? context.clone() : context;
        const parsed = await target.json();
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      } catch {
        // Response body might be raw text or malformed JSON
        if (typeof context.text === 'function') {
          try {
            const textTarget = typeof context.clone === 'function' ? context.clone() : context;
            const rawText = await textTarget.text();
            if (rawText && typeof rawText === 'string') {
              try {
                return JSON.parse(rawText);
              } catch {
                // Not JSON, return null to fall back to error.message
              }
            }
          } catch {
            // Body unreadable - safe ignore
          }
        }
      }
    } else if (typeof context === 'object') {
      // Mocked or pre-parsed context object
      return context;
    }
  }

  return null;
}

/**
 * Deactivates or reactivates a staff member's account via public.admin_set_user_status RPC
 * and invokes session revocation
 */
export async function toggleStaffStatus({ userId, isActive }) {
  const isConfigured = await getConfigured(activeConfigured);
  if (!isConfigured || !activeClient) {
    return { data: null, error: new Error('Supabase client is not configured.') };
  }

  if (!userId) {
    return { data: null, error: new Error('User ID is required.') };
  }

  try {
    // If Edge Function is available, call manage-staff-session for GoTrue ban / unban coordination
    if (activeClient.functions?.invoke) {
      const action = isActive ? 'reactivate' : 'deactivate_and_revoke';
      const { data, error } = await activeClient.functions.invoke('manage-staff-session', {
        body: { targetUserId: userId, action },
      });

      const errorPayload = await parseFunctionsErrorPayload(error, data);

      if (error || data?.error || errorPayload?.error) {
        const serverErrorMessage =
          errorPayload?.error ||
          errorPayload?.message ||
          (error ? parseStaffSecurityError(error) : 'Staff status update failed.');

        const structuredError = new Error(serverErrorMessage);

        let structuredData = null;
        if (errorPayload && typeof errorPayload === 'object') {
          structuredData = {
            success: false,
            is_active: isActive
              ? Boolean(errorPayload.dbReactivated)
              : !Boolean(errorPayload.dbDeactivated),
            dbDeactivated: Boolean(errorPayload.dbDeactivated),
            dbReactivated: Boolean(errorPayload.dbReactivated),
            gotrueBanSucceeded: Boolean(errorPayload.gotrueBanSucceeded),
            gotrueUnbanSucceeded: Boolean(errorPayload.gotrueUnbanSucceeded),
            globalSignOutAttempted: Boolean(errorPayload.globalSignOutAttempted),
            globalSignOutSucceeded: Boolean(errorPayload.globalSignOutSucceeded),
            auditLogSucceeded: Boolean(errorPayload.auditLogSucceeded),
            isDatabaseOnly: false,
            message: serverErrorMessage,
          };
          structuredError.details = structuredData;
        }

        return {
          data: structuredData,
          error: structuredError,
        };
      }

      return {
        data: {
          success: true,
          is_active: Boolean(isActive),
          globalSignOutAttempted: Boolean(data?.globalSignOutAttempted),
          globalSignOutSucceeded: isActive ? false : Boolean(data?.globalSignOutSucceeded),
          gotrueBanSucceeded: isActive ? false : Boolean(data?.gotrueBanSucceeded),
          gotrueUnbanSucceeded: isActive ? Boolean(data?.gotrueUnbanSucceeded) : false,
          auditLogSucceeded: Boolean(data?.auditLogSucceeded),
          isDatabaseOnly: false,
          message: data?.message || (isActive ? 'Account reactivated successfully.' : 'Account deactivated.'),
        },
        error: null,
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // FALLBACK HANDLING WHEN EDGE FUNCTION IS UNAVAILABLE
    // ──────────────────────────────────────────────────────────────────────────
    // CRITICAL SECURITY RULE: Reactivation requires lifting the GoTrue user ban.
    // A database-only reactivation would set is_active=true while leaving the user
    // banned in GoTrue and unable to sign in. Therefore, database-only reactivation
    // is strictly prohibited.
    if (isActive) {
      return {
        data: null,
        error: new Error(
          'Reactivation requires the Edge Function manage-staff-session to lift the GoTrue login ban. The Edge Function service is currently unavailable.'
        ),
      };
    }

    // Emergency database-only fallback for deactivation:
    // Permitted because setting is_active=false immediately halts data access across all RLS gates.
    // However, it must be clearly reported as database-only without GoTrue session revocation.
    const { data, error } = await activeClient.rpc('admin_set_user_status', {
      p_user_id: userId,
      p_is_active: false,
    });

    if (error) {
      return { data: null, error: new Error(parseStaffSecurityError(error)) };
    }

    return {
      data: {
        success: true,
        is_active: false,
        globalSignOutSucceeded: false,
        gotrueBanSucceeded: false,
        gotrueUnbanSucceeded: false,
        auditLogSucceeded: false,
        isDatabaseOnly: true,
        message:
          'Staff account deactivated in database. Access blocked immediately via RLS, but neither GoTrue ban nor session revocation occurred (Edge Function unavailable).',
      },
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Fetches pending staff invitations
 */
export async function getPendingInvitations() {
  const isConfigured = await getConfigured(activeConfigured);
  if (!isConfigured || !activeClient) {
    return { data: [], error: new Error('Supabase client is not configured.') };
  }

  try {
    const { data, error } = await activeClient
      .from('staff_invitations')
      .select('id, email, full_name, role, status, invited_by, created_at, expires_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      return { data: [], error: new Error(parseStaffSecurityError(error)) };
    }

    const normalized = (data || []).map(normalizeInvitation);
    return { data: normalized, error: null };
  } catch (err) {
    return {
      data: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Revokes a pending staff invitation via Edge Function or atomic DB query
 */
export async function revokeInvitation({ invitationId }) {
  const isConfigured = await getConfigured(activeConfigured);
  if (!isConfigured || !activeClient) {
    return { success: false, error: new Error('Supabase client is not configured.') };
  }

  if (!invitationId) {
    return { success: false, error: new Error('Invitation ID is required.') };
  }

  try {
    if (activeClient.functions?.invoke) {
      const { data, error } = await activeClient.functions.invoke('invite-staff', {
        body: { action: 'revoke', invitationId },
      });
      if (error) {
        return { success: false, error: new Error(parseStaffSecurityError(error)) };
      }
      if (data?.error) {
        return { success: false, error: new Error(data.error) };
      }
      return { success: true, error: null };
    }

    // Direct database RPC fallback (atomic, audited, and strictly enforces admin role)
    const { data, error } = await activeClient.rpc('revoke_staff_invitation', {
      p_invitation_id: invitationId,
    });

    if (error) {
      return { success: false, error: new Error(parseStaffSecurityError(error)) };
    }

    return { success: true, error: null };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Resends a pending invitation by dispatching an email via Edge Function
 */
export async function resendInvitation({ invitationId, email, fullName }) {
  const isConfigured = await getConfigured(activeConfigured);
  if (!isConfigured || !activeClient) {
    return { success: false, error: new Error('Supabase client is not configured.') };
  }

  if (!invitationId) {
    return { success: false, error: new Error('Invitation ID is required.') };
  }

  try {
    // Edge Function is required to actually dispatch an invitation email
    if (activeClient.functions?.invoke) {
      const { data, error } = await activeClient.functions.invoke('invite-staff', {
        body: { action: 'resend', invitationId, email, fullName },
      });
      if (error) {
        return { success: false, error: new Error(parseStaffSecurityError(error)) };
      }
      if (data?.error) {
        return { success: false, error: new Error(data.error) };
      }
      return { success: true, error: null };
    }

    return {
      success: false,
      error: new Error('Edge function invite-staff is required to resend invitations.'),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Accepts a pending staff invitation for the currently authenticated user
 * via trusted server-side RPC public.accept_staff_invitation().
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function acceptInvitation() {
  const isConfigured = await getConfigured(activeConfigured);
  if (!isConfigured || !activeClient) {
    return { data: null, error: new Error('Supabase client is not configured.') };
  }

  try {
    if (activeClient.functions?.invoke) {
      const { data, error } = await activeClient.functions.invoke('invite-staff', {
        body: { action: 'accept' },
      });
      if (error) {
        return { data: null, error: new Error(parseStaffSecurityError(error)) };
      }
      if (data?.error) {
        return { data: null, error: new Error(data.error) };
      }
      return { data: data.result || data, error: null };
    }

    const { data, error } = await activeClient.rpc('accept_staff_invitation');
    if (error) {
      return { data: null, error: new Error(parseStaffSecurityError(error)) };
    }
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Retrieves sanitized operational summary metrics for staff dashboard/reports
 * (completely devoid of revenue figures, currency amounts, or dues).
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function getStaffOperationalSummary() {
  const isConfigured = await getConfigured(activeConfigured);
  if (!isConfigured || !activeClient) {
    return { data: null, error: new Error('Supabase client is not configured.') };
  }

  try {
    const { data, error } = await activeClient.rpc('get_staff_operational_summary');
    if (error) {
      return { data: null, error: new Error(parseStaffSecurityError(error)) };
    }
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Fetches recent security audit logs (Admin only)
 */
export async function getSecurityAuditLogs() {
  const isConfigured = await getConfigured(activeConfigured);
  if (!isConfigured || !activeClient) {
    return { data: [], error: new Error('Supabase client is not configured.') };
  }

  try {
    const { data, error } = await activeClient
      .from('security_audit_logs')
      .select('id, actor_id, target_user_id, action, details, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      return { data: [], error: new Error(parseStaffSecurityError(error)) };
    }

    return { data: data || [], error: null };
  } catch (err) {
    return {
      data: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Evaluates the appropriate user feedback (type and message) for a staff status change
 * ensuring action-specific handling:
 * - Reactivation: Success only if gotrueUnbanSucceeded. Warning is never shown for false globalSignOutSucceeded.
 * - Incomplete Reactivation: Error is reported; never claims success.
 * - Full Deactivation: Success only when both GoTrue ban and session revocation succeeded.
 * - Partial Deactivation (Edge Function): Warning showing the actual operation results (never described as DB-only fallback).
 * - Database-Only Deactivation: Warning explicitly identifying that neither GoTrue ban nor session revocation occurred.
 * - Service Error: Error feedback.
 */
export function getStaffStatusFeedback({ targetActive, res }) {
  if (res?.error) {
    return {
      type: 'error',
      message: res.error.message || (targetActive ? 'Failed to reactivate staff account.' : 'Failed to deactivate staff account.'),
    };
  }

  if (targetActive) {
    // Successful reactivation: show success only when GoTrue unban succeeded
    if (res?.data?.gotrueUnbanSucceeded) {
      return {
        type: 'success',
        message: res.data?.message || 'Staff account reactivated successfully and GoTrue login ban lifted.',
      };
    }
    // Failed or incomplete reactivation: show an error; never claim success
    return {
      type: 'error',
      message: res?.data?.message || 'Reactivation failed: GoTrue login ban could not be lifted.',
    };
  }

  // Deactivation:
  // 1. Database-only fallback (Edge Function was unavailable)
  if (res?.data?.isDatabaseOnly) {
    return {
      type: 'warning',
      message:
        res?.data?.message ||
        'Staff account deactivated in database. Access blocked immediately via RLS, but neither GoTrue ban nor session revocation occurred (Edge Function unavailable).',
    };
  }

  // 2. Edge Function deactivation: check independent operation results
  const banSucceeded = Boolean(res?.data?.gotrueBanSucceeded);
  const signOutSucceeded = Boolean(res?.data?.globalSignOutSucceeded);

  // Combination 1: Ban true, session revocation true -> success
  if (banSucceeded && signOutSucceeded) {
    return {
      type: 'success',
      message: res?.data?.message || 'Staff account deactivated, GoTrue login ban applied, and all active sessions revoked.',
    };
  }

  // Combination 2: Ban true, session revocation false -> warning (partial Edge Function)
  if (banSucceeded && !signOutSucceeded) {
    return {
      type: 'warning',
      message:
        res?.data?.message && /session/i.test(res.data.message) && /fail|not/i.test(res.data.message)
          ? res.data.message
          : 'Staff account deactivated and GoTrue login ban applied, but active session revocation was not completed.',
    };
  }

  // Combination 3: Ban false, session revocation true -> warning (partial Edge Function)
  if (!banSucceeded && signOutSucceeded) {
    return {
      type: 'warning',
      message:
        res?.data?.message && /ban/i.test(res.data.message) && /fail|not/i.test(res.data.message)
          ? res.data.message
          : 'Staff account deactivated and active sessions revoked, but GoTrue login ban failed to apply.',
    };
  }

  // Combination 4: Ban false, session revocation false -> warning (partial Edge Function)
  return {
    type: 'warning',
    message:
      res?.data?.message && /ban/i.test(res.data.message) && /session/i.test(res.data.message) && /fail|not/i.test(res.data.message)
        ? res.data.message
        : 'Staff account deactivated in database, but both GoTrue login ban and session revocation failed.',
  };
}

export default {
  getStaffRoster,
  inviteStaffMember,
  updateStaffRole,
  toggleStaffStatus,
  getStaffStatusFeedback,
  parseFunctionsErrorPayload,
  getPendingInvitations,
  revokeInvitation,
  resendInvitation,
  getSecurityAuditLogs,
  normalizeStaffMember,
  normalizeInvitation,
  validateInvitationInput,
  parseStaffSecurityError,
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting,
};
