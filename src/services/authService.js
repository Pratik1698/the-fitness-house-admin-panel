import { supabase, isSupabaseConfigured } from './supabaseClient.js';

let activeClient = supabase;
let activeConfigured = isSupabaseConfigured;

export function setSupabaseClientForTesting(client, configured = true) {
  activeClient = client;
  activeConfigured = configured;
}

export function resetSupabaseClientForTesting() {
  activeClient = supabase;
  activeConfigured = isSupabaseConfigured;
}

/**
 * Authentication Service
 * The Fitness House Gym Management Admin Panel
 *
 * Provides typed, structured methods for user authentication, session lifecycle,
 * role resolution, self-service password management, email verification, and recovery.
 */

export const VALID_ROLES = ['admin', 'staff'];
export const MIN_PASSWORD_LENGTH = 6;

/**
 * Checks whether a given role string is an authorized administrative role.
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
export function isValidRole(role) {
  return typeof role === 'string' && VALID_ROLES.includes(role.trim().toLowerCase());
}

/**
 * Validates email format.
 * @param {string} email
 * @returns {string|null} Error string or null if valid
 */
export function validateEmail(email) {
  if (!email || !email.trim()) {
    return 'Please enter your email and password.';
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return 'Please enter a valid email address.';
  }
  return null;
}

/**
 * Validates password strength against configured minimum requirements.
 * @param {string} password
 * @returns {string|null} Error string or null if valid
 */
export function validatePassword(password) {
  if (!password) {
    return 'Please complete all password fields.';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  }
  return null;
}

/**
 * Authenticates a user with email and password credentials.
 * Enforces email verification and strict role validation.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ user: object|null, session: object|null, role: string|null, isEmailUnverified?: boolean, unverifiedEmail?: string, error: Error|null }>}
 */
export async function signInWithPassword(email, password) {
  if (!isSupabaseConfigured) {
    return {
      user: null,
      session: null,
      role: null,
      error: new Error(
        'Authentication backend is not configured. Please define VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.'
      ),
    };
  }

  // Pre-flight client validation
  if (!email || !email.trim() || !password) {
    return {
      user: null,
      session: null,
      role: null,
      error: new Error('Please enter your email and password.'),
    };
  }

  const emailFormatErr = validateEmail(email);
  if (emailFormatErr) {
    return {
      user: null,
      session: null,
      role: null,
      error: new Error(emailFormatErr),
    };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      const msg = error.message ? error.message.toLowerCase() : '';
      const status = error.status;

      // Handle unverified email explicitly
      if (msg.includes('email not confirmed') || error.code === 'email_not_confirmed') {
        return {
          user: null,
          session: null,
          role: null,
          isEmailUnverified: true,
          unverifiedEmail: email.trim(),
          error: new Error('Your email address is not verified. Please verify it before signing in.'),
        };
      }

      // Generic error for invalid credentials (never reveal if email exists)
      if (status === 400 || msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
        return {
          user: null,
          session: null,
          role: null,
          error: new Error('Invalid email or password. Please check your details and try again.'),
        };
      }

      // Network / connectivity issues
      if (msg.includes('fetch') || msg.includes('network') || msg.includes('failed to fetch')) {
        return {
          user: null,
          session: null,
          role: null,
          error: new Error('Unable to sign in right now. Please check your connection and try again.'),
        };
      }

      return {
        user: null,
        session: null,
        role: null,
        error: new Error(error.message || 'Invalid email or password. Please check your details and try again.'),
      };
    }

    if (!data.user) {
      return {
        user: null,
        session: null,
        role: null,
        error: new Error('Authentication succeeded but user identity could not be established.'),
      };
    }

    // Check email verification status on user object
    if (!data.user.email_confirmed_at) {
      // Clear unverified session immediately
      try {
        await supabase.auth.signOut();
      } catch (e) {
        // Suppress secondary signout error
      }

      return {
        user: data.user,
        session: null,
        role: null,
        isEmailUnverified: true,
        unverifiedEmail: data.user.email || email.trim(),
        error: new Error('Your email address is not verified. Please check your inbox or resend the verification email.'),
      };
    }

    // Resolve an already active role first. Invitation acceptance is a separate,
    // explicit user action and must never happen during role lookup.
    const role = await getUserRole(data.user.id);

    if (!isValidRole(role)) {
      const pendingInvitation = await canAcceptStaffInvitation();
      if (pendingInvitation) {
        return {
          user: data.user,
          session: data.session,
          role: null,
          pendingInvitation: true,
          error: null,
        };
      }
    }

    // Fail-closed enforcement: only active roles or a verified pending invite
    // may keep an authenticated session in the public invitation screen.
    if (!isValidRole(role)) {
      try {
        await supabase.auth.signOut();
      } catch (signOutErr) {
        // Suppress secondary signout error
      }

      return {
        user: null,
        session: null,
        role: null,
        error: new Error('Your account is not authorized to access this application. Please contact the gym administrator.'),
      };
    }

    return {
      user: data.user,
      session: data.session,
      role,
      error: null,
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    if (rawMsg.toLowerCase().includes('fetch') || rawMsg.toLowerCase().includes('network')) {
      return {
        user: null,
        session: null,
        role: null,
        error: new Error('Unable to sign in right now. Please check your connection and try again.'),
      };
    }
    return {
      user: null,
      session: null,
      role: null,
      error: err instanceof Error ? err : new Error(rawMsg),
    };
  }
}

/**
 * Terminates the active session and signs out the user.
 * @returns {Promise<{ success: boolean, error: Error|null }>}
 */
export async function signOut() {
  if (!isSupabaseConfigured) {
    return { success: true, error: null };
  }

  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      return { success: false, error };
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
 * Retrieves the current session, if available.
 * @returns {Promise<{ session: object|null, error: Error|null }>}
 */
export async function getSession() {
  if (!isSupabaseConfigured) {
    return { session: null, error: null };
  }

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      return { session: null, error };
    }
    return { session: data.session, error: null };
  } catch (err) {
    return {
      session: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Retrieves the current authenticated user object.
 * @returns {Promise<{ user: object|null, error: Error|null }>}
 */
export async function getCurrentUser() {
  if (!isSupabaseConfigured) {
    return { user: null, error: null };
  }

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      return { user: null, error };
    }
    return { user: data.user, error: null };
  } catch (err) {
    return {
      user: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Resolves the authenticated user's role ('admin' or 'staff').
 * Leverages Phase 7C RPC public.get_user_role() with fallback to public.profiles.
 * @param {string} [userId]
 * @returns {Promise<string|null>}
 */
export async function getUserRole(userId) {
  const isConfigured = typeof activeConfigured === 'function' ? await activeConfigured() : activeConfigured;
  if (!isConfigured || !activeClient) {
    return null;
  }

  try {
    // 1. Primary: Attempt resolution via Phase 7C RPC
    const { data: roleData, error: rpcError } = await activeClient.rpc('get_user_role');
    if (!rpcError && roleData) {
      const roleStr = String(roleData).trim().toLowerCase();
      if (isValidRole(roleStr)) {
        return roleStr;
      }
    }

    // 2. Fallback: Query profile record directly only if RPC could not be executed
    // Must explicitly verify is_active = true; inactive accounts MUST NOT authenticate via fallback.
    let targetId = userId;
    if (!targetId && activeClient.auth?.getUser) {
      const { data: userData } = await activeClient.auth.getUser();
      targetId = userData?.user?.id;
    }

    if (!targetId) return null;

    const { data: profile, error: profileError } = await activeClient
      .from('profiles')
      .select('role, is_active')
      .eq('id', targetId)
      .maybeSingle();

    if (!profileError && profile && profile.is_active === true && profile.role) {
      const roleStr = String(profile.role).trim().toLowerCase();
      if (isValidRole(roleStr)) {
        return roleStr;
      }
    }

    return null;
  } catch (err) {
    console.warn('[authService] Failed to resolve user role:', err);
    return null;
  }
}

/**
 * Read-only check used to show the explicit invitation acceptance screen.
 * The database binds this result to the authenticated user's own invitation.
 */
export async function canAcceptStaffInvitation() {
  const isConfigured = typeof activeConfigured === 'function' ? await activeConfigured() : activeConfigured;
  if (!isConfigured || !activeClient) return false;

  try {
    const { data, error } = await activeClient.rpc('can_accept_staff_invitation');
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * Self-Service Password Change:
 * Re-authenticates the user with current credentials before updating to new password.
 * @param {{ currentPassword: string, newPassword: string, confirmPassword?: string }} params
 * @returns {Promise<{ success: boolean, message?: string, error: Error|null }>}
 */
export async function changePassword({ currentPassword, newPassword, confirmPassword }) {
  if (!isSupabaseConfigured) {
    return { success: false, error: new Error('Supabase client is not configured.') };
  }

  // Pre-flight checks
  if (!currentPassword || !newPassword) {
    return { success: false, error: new Error('Please complete all password fields.') };
  }

  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    return { success: false, error: new Error('New passwords do not match.') };
  }

  const strengthErr = validatePassword(newPassword);
  if (strengthErr) {
    return { success: false, error: new Error(strengthErr) };
  }

  try {
    // 1. Retrieve the currently logged in user
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user?.email) {
      return { success: false, error: new Error('Session expired. Please sign in again.') };
    }

    // 2. Re-authenticate user with current password to prove identity
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: userData.user.email,
      password: currentPassword,
    });

    if (reauthError) {
      return { success: false, error: new Error('Your current password is incorrect.') };
    }

    // 3. Update to the new password
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      return {
        success: false,
        error: new Error(updateError.message || 'Failed to update password. Please try again.'),
      };
    }

    return {
      success: true,
      message: 'Password changed successfully.',
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Initiates a password-reset recovery email.
 * Always returns generic confirmation message to prevent user enumeration.
 * @param {string} email
 * @returns {Promise<{ success: boolean, message: string, error: Error|null }>}
 */
export async function requestPasswordReset(email) {
  if (!isSupabaseConfigured) {
    return { success: false, message: '', error: new Error('Supabase is not configured.') };
  }

  const cleanEmail = email ? email.trim() : '';
  if (!cleanEmail) {
    return { success: false, message: '', error: new Error('Please enter your email and password.') };
  }

  const emailErr = validateEmail(cleanEmail);
  if (emailErr) {
    return { success: false, message: '', error: new Error(emailErr) };
  }

  try {
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo,
    });

    // Suppress enumeration errors; always display generic confirmation
    if (error) {
      console.warn('[authService] resetPasswordForEmail notice:', error.message);
    }

    return {
      success: true,
      message: 'If an account exists for this email address, password reset instructions will be sent.',
      error: null,
    };
  } catch (err) {
    return {
      success: true,
      message: 'If an account exists for this email address, password reset instructions will be sent.',
      error: null,
    };
  }
}

/**
 * Resets user password using the recovery session from email link.
 * @param {string} newPassword
 * @param {string} confirmPassword
 * @returns {Promise<{ success: boolean, message?: string, error: Error|null }>}
 */
export async function resetPassword(newPassword, confirmPassword) {
  const isConfigured = typeof activeConfigured === 'function' ? await activeConfigured() : activeConfigured;
  if (!isConfigured) {
    return { success: false, error: new Error('Supabase is not configured.') };
  }

  if (!newPassword || !confirmPassword) {
    return { success: false, error: new Error('Please complete all password fields.') };
  }

  if (newPassword !== confirmPassword) {
    return { success: false, error: new Error('New passwords do not match.') };
  }

  const strengthErr = validatePassword(newPassword);
  if (strengthErr) {
    return { success: false, error: new Error(strengthErr) };
  }

  try {
    const client = activeClient || supabase;
    const { data, error } = await client.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      const msg = error.message ? error.message.toLowerCase() : '';
      if (msg.includes('expired') || msg.includes('invalid') || msg.includes('session')) {
        return {
          success: false,
          error: new Error('This password-reset link is invalid or has expired. Please request a new one.'),
        };
      }
      return { success: false, error: new Error(error.message || 'Failed to reset password.') };
    }

    return {
      success: true,
      message: 'Your password has been reset successfully.',
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Resends signup email verification link.
 * @param {string} email
 * @returns {Promise<{ success: boolean, message?: string, error: Error|null }>}
 */
export async function resendVerificationEmail(email) {
  if (!isSupabaseConfigured) {
    return { success: false, error: new Error('Supabase is not configured.') };
  }

  const cleanEmail = email ? email.trim() : '';
  if (!cleanEmail) {
    return { success: false, error: new Error('Please enter a valid email address.') };
  }

  try {
    const emailRedirectTo = `${window.location.origin}/login`;
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: cleanEmail,
      options: {
        emailRedirectTo,
      },
    });

    if (error) {
      return {
        success: false,
        error: new Error(error.message || 'Failed to resend verification email. Please try again shortly.'),
      };
    }

    return {
      success: true,
      message: 'Verification email sent! Check your inbox or local Mailpit at http://127.0.0.1:54324.',
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Subscribes to authentication state changes (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, PASSWORD_RECOVERY).
 * @param {(event: string, session: object|null) => void} callback
 * @returns {(() => void)|null} Unsubscribe function
 */
export function onAuthStateChange(callback) {
  if (!isSupabaseConfigured) {
    return () => {};
  }

  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });

  return () => {
    subscription.unsubscribe();
  };
}

/**
 * Safely parses authentication callback parameters from URL hash fragments and query search strings.
 * Handles:
 * - GoTrue error redirects: #error=access_denied&error_code=otp_expired&error_description=...
 * - GoTrue implicit hash tokens: #access_token=...&refresh_token=...&type=invite
 * - Direct token hashes: ?token_hash=...&type=invite (or #token_hash=...)
 * - PKCE authorization codes: ?code=...
 *
 * @param {string|Location|{ search?: string, hash?: string }} [locationInput]
 * @returns {{
 *   hasCallback: boolean,
 *   isError: boolean,
 *   error: string|null,
 *   errorCode: string|null,
 *   errorDescription: string|null,
 *   friendlyErrorMessage: string|null,
 *   tokenHash: string|null,
 *   type: string|null,
 *   accessToken: string|null,
 *   refreshToken: string|null,
 *   code: string|null,
 *   isInvite: boolean,
 *   mode: string|null
 * }}
 */
export function parseAuthCallback(locationInput) {
  let searchStr = '';
  let hashStr = '';

  if (typeof locationInput === 'string') {
    try {
      const parsedUrl = new URL(locationInput, 'https://localhost');
      searchStr = parsedUrl.search || '';
      hashStr = parsedUrl.hash || '';
    } catch {
      searchStr = locationInput.includes('?') ? locationInput.split('?')[1].split('#')[0] : '';
      hashStr = locationInput.includes('#') ? locationInput.split('#')[1] : '';
    }
  } else if (locationInput && typeof locationInput === 'object') {
    searchStr = locationInput.search || '';
    hashStr = locationInput.hash || '';
  } else if (typeof window !== 'undefined' && window.location) {
    searchStr = window.location.search || '';
    hashStr = window.location.hash || '';
  }

  const searchParams = new URLSearchParams(searchStr.replace(/^\?/, ''));
  const hashParams = new URLSearchParams(hashStr.replace(/^#/, ''));

  const getParam = (key) => hashParams.get(key) || searchParams.get(key);

  const error = getParam('error');
  const errorCode = getParam('error_code');
  const errorDescription = getParam('error_description');
  const tokenHash = getParam('token_hash');
  const type = getParam('type');
  const accessToken = getParam('access_token');
  const refreshToken = getParam('refresh_token');
  const code = getParam('code');
  const mode = getParam('mode');

  const isError = Boolean(error || errorCode || errorDescription);
  const isInvite = type === 'invite' || mode === 'invite';
  const hasCallback = Boolean(isError || tokenHash || accessToken || code || isInvite);

  let friendlyErrorMessage = null;
  if (isError) {
    const desc = (errorDescription || '').toLowerCase();
    const codeLower = (errorCode || '').toLowerCase();
    if (codeLower === 'otp_expired' || desc.includes('expired') || desc.includes('invalid')) {
      friendlyErrorMessage = isInvite
        ? 'This staff invitation link is invalid or has expired. Please contact the gym administrator to resend your invitation.'
        : 'This invitation or verification link is invalid or has expired. Please contact the gym administrator to resend your invitation or request a new link.';
    } else if (codeLower === 'access_denied' || error === 'access_denied') {
      friendlyErrorMessage = isInvite
        ? 'Access was denied for this staff invitation. Please contact the gym administrator.'
        : 'Access was denied. Please verify your credentials or request a new link.';
    } else {
      friendlyErrorMessage = errorDescription || 'An error occurred during verification. Please request a new link.';
    }
  }

  return {
    hasCallback,
    isError,
    error,
    errorCode,
    errorDescription,
    friendlyErrorMessage,
    tokenHash,
    type,
    accessToken,
    refreshToken,
    code,
    isInvite,
    mode,
  };
}

/**
 * Verifies an OTP or token hash from an email link (e.g. staff invitation, signup confirmation, recovery).
 * For staff invitations, the expected OTP type is 'invite' or 'email'.
 *
 * @param {{ token_hash?: string, token?: string, type?: string, email?: string }} params
 * @returns {Promise<{ session: object|null, user: object|null, error: Error|null }>}
 */
export async function verifyOtp({ token_hash, token, type = 'invite', email } = {}) {
  if (!token_hash && !token) {
    return {
      session: null,
      user: null,
      error: new Error('Missing verification token or token hash.'),
    };
  }

  const isConfigured = typeof activeConfigured === 'function' ? await activeConfigured() : activeConfigured;
  if (!isConfigured) {
    return {
      session: null,
      user: null,
      error: new Error('Supabase client is not configured.'),
    };
  }

  const client = activeClient || supabase;

  try {
    let verifyParams = {};
    if (token_hash) {
      verifyParams = { token_hash, type };
    } else if (token && email) {
      verifyParams = { email, token, type };
    } else if (token) {
      verifyParams = { token_hash: token, type };
    }

    const { data, error } = await client.auth.verifyOtp(verifyParams);

    if (error) {
      const msg = error.message ? error.message.toLowerCase() : '';
      if (msg.includes('expired') || error.code === 'otp_expired') {
        return {
          session: null,
          user: null,
          error: new Error('This invitation link has expired. Please contact the gym administrator to resend your invitation.'),
        };
      }
      if (msg.includes('invalid') || error.code === 'validation_failed') {
        return {
          session: null,
          user: null,
          error: new Error('This invitation link is invalid. Please request a new invitation link from the administrator.'),
        };
      }
      return {
        session: null,
        user: null,
        error: new Error(error.message || 'Failed to verify invitation token.'),
      };
    }

    return {
      session: data?.session || null,
      user: data?.user || null,
      error: null,
    };
  } catch (err) {
    return {
      session: null,
      user: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export default {
  signInWithPassword,
  signOut,
  getSession,
  getCurrentUser,
  getUserRole,
  canAcceptStaffInvitation,
  onAuthStateChange,
  isValidRole,
  VALID_ROLES,
  validateEmail,
  validatePassword,
  changePassword,
  requestPasswordReset,
  resetPassword,
  resendVerificationEmail,
  verifyOtp,
  parseAuthCallback,
};
