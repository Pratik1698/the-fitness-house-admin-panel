import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const appSource = read('../src/App.jsx');
const loginSource = read('../src/pages/Login.jsx');
const resetPasswordSource = read('../src/pages/ResetPassword.jsx');
const authServiceSource = read('../src/services/authService.js');
const inviteStaffSource = read('../supabase/functions/invite-staff/index.ts');

import {
  verifyOtp,
  parseAuthCallback,
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting,
} from '../src/services/authService.js';

// ---------------------------------------------------------------------------
// 1. Vercel SPA Routing Configuration Tests
// ---------------------------------------------------------------------------
test('1. [Vercel Routing] vercel.json exists and configures single-page application rewrites to index.html', () => {
  assert.equal(existsSync(new URL('../vercel.json', import.meta.url)), true, 'vercel.json must exist in root');
  const vercelConfig = JSON.parse(read('../vercel.json'));

  assert.ok(Array.isArray(vercelConfig.rewrites), 'vercel.json must contain a rewrites array');
  const spaRewrite = vercelConfig.rewrites.find((r) => r.source === '/(.*)' && r.destination === '/index.html');
  assert.ok(spaRewrite, 'vercel.json must rewrite all SPA routes to /index.html');
});

// ---------------------------------------------------------------------------
// 2. Token Verification (verifyOtp) Tests
// ---------------------------------------------------------------------------
test('2. [Supabase Auth] verifyOtp verifies valid token_hash with type "invite" and returns session', async () => {
  const mockUser = { id: 'staff-uuid-1', email: 'coach.rahul@example.com' };
  const mockSession = { access_token: 'mock.access.jwt', user: mockUser };
  let passedParams = null;

  const mockClient = {
    auth: {
      verifyOtp: async (params) => {
        passedParams = params;
        return { data: { user: mockUser, session: mockSession }, error: null };
      },
    },
  };

  setSupabaseClientForTesting(mockClient, true);
  try {
    const res = await verifyOtp({ token_hash: 'valid_token_hash_abc', type: 'invite' });
    assert.equal(res.error, null);
    assert.deepEqual(res.user, mockUser);
    assert.deepEqual(res.session, mockSession);
    assert.deepEqual(passedParams, { token_hash: 'valid_token_hash_abc', type: 'invite' });
  } finally {
    resetSupabaseClientForTesting();
  }
});

test('3. [Supabase Auth] verifyOtp handles expired token and returns clear user-facing error', async () => {
  const mockClient = {
    auth: {
      verifyOtp: async () => ({
        data: { user: null, session: null },
        error: { code: 'otp_expired', message: 'Email link is invalid or has expired' },
      }),
    },
  };

  setSupabaseClientForTesting(mockClient, true);
  try {
    const res = await verifyOtp({ token_hash: 'expired_token_hash_123', type: 'invite' });
    assert.notEqual(res.error, null);
    assert.equal(res.session, null);
    assert.match(res.error.message, /expired/i);
    assert.match(res.error.message, /contact the gym administrator/i);
  } finally {
    resetSupabaseClientForTesting();
  }
});

test('4. [Supabase Auth] verifyOtp handles invalid/malformed token hash', async () => {
  const mockClient = {
    auth: {
      verifyOtp: async () => ({
        data: { user: null, session: null },
        error: { code: 'validation_failed', message: 'Token is invalid' },
      }),
    },
  };

  setSupabaseClientForTesting(mockClient, true);
  try {
    const res = await verifyOtp({ token_hash: 'malformed_token_xyz', type: 'invite' });
    assert.notEqual(res.error, null);
    assert.equal(res.session, null);
    assert.match(res.error.message, /invalid/i);
  } finally {
    resetSupabaseClientForTesting();
  }
});

test('5. [Supabase Auth] verifyOtp rejects when no token or token_hash is provided', async () => {
  const res = await verifyOtp({});
  assert.notEqual(res.error, null);
  assert.match(res.error.message, /Missing verification token/i);
});

// ---------------------------------------------------------------------------
// 3. Auth Callback URL Parsing Tests
// ---------------------------------------------------------------------------
test('6. [URL Parsing] parseAuthCallback extracts exact confirmed GoTrue error fragment', () => {
  const confirmedErrorUrl =
    '/login#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
  const callback = parseAuthCallback(confirmedErrorUrl);

  assert.equal(callback.isError, true);
  assert.equal(callback.error, 'access_denied');
  assert.equal(callback.errorCode, 'otp_expired');
  assert.equal(callback.errorDescription, 'Email link is invalid or has expired');
  assert.match(callback.friendlyErrorMessage, /expired/i);
  assert.match(callback.friendlyErrorMessage, /contact.*?administrator/i);
});

test('7. [URL Parsing] parseAuthCallback parses search query errors as well as hash errors', () => {
  const queryErrorUrl =
    '/reset-password?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&mode=invite';
  const callback = parseAuthCallback(queryErrorUrl);

  assert.equal(callback.isError, true);
  assert.equal(callback.isInvite, true);
  assert.equal(callback.errorCode, 'otp_expired');
  assert.match(callback.friendlyErrorMessage, /staff invitation link is invalid or has expired/i);
});

test('8. [URL Parsing] parseAuthCallback extracts token_hash and type from email invitation links', () => {
  const tokenHashUrl = '/login?token_hash=pkce_secret_token_12345&type=invite';
  const callback = parseAuthCallback(tokenHashUrl);

  assert.equal(callback.isError, false);
  assert.equal(callback.tokenHash, 'pkce_secret_token_12345');
  assert.equal(callback.type, 'invite');
  assert.equal(callback.isInvite, true);
});

test('9. [URL Parsing] parseAuthCallback detects implicit session tokens in URL hash', () => {
  const implicitTokenUrl =
    '/login#access_token=mock_jwt_access&refresh_token=mock_jwt_refresh&expires_in=3600&token_type=bearer&type=invite';
  const callback = parseAuthCallback(implicitTokenUrl);

  assert.equal(callback.isError, false);
  assert.equal(callback.accessToken, 'mock_jwt_access');
  assert.equal(callback.refreshToken, 'mock_jwt_refresh');
  assert.equal(callback.type, 'invite');
  assert.equal(callback.isInvite, true);
});

// ---------------------------------------------------------------------------
// 4. Component Source Level Contracts
// ---------------------------------------------------------------------------
test('10. [Login Component] Login component handles invitation callback errors and token_hash verification', () => {
  // Uses parseAuthCallback
  assert.match(loginSource, /parseAuthCallback\(location\)/);

  // Displays error from invitation callback
  assert.match(loginSource, /callback\.friendlyErrorMessage/);

  // Verifies token_hash when present
  assert.match(loginSource, /verifyOtp\(\{[\s\S]*?token_hash:\s*callback\.tokenHash[\s\S]*?type:\s*callback\.type\s*\|\|\s*'invite'/);

  // Clears fragment to prevent stale error loops
  assert.match(loginSource, /window\.history\?\.replaceState/);
});

test('11. [ResetPassword Component] ResetPassword handles token_hash and already-accepted invitations', () => {
  // Uses parseAuthCallback
  assert.match(resetPasswordSource, /parseAuthCallback\(location\)/);

  // Verifies token_hash
  assert.match(resetPasswordSource, /verifyOtp\(\{[\s\S]*?token_hash:\s*callback\.tokenHash/);

  // Handles already-accepted staff invitations cleanly
  assert.match(resetPasswordSource, /Staff Account Already Active/);
  assert.match(resetPasswordSource, /activeRole === 'staff'/);
});

test('12. [Routing Contract] Invitation verification occurs before requiring authenticated session', () => {
  // PublicRoute allows /login and /reset-password without existing active session
  assert.match(appSource, /<Route path="\/login" element=\{<PublicRoute><Login \/><\/PublicRoute>\} \/>/);
  assert.match(appSource, /<Route path="\/reset-password" element=\{<PublicRoute><ResetPassword \/><\/PublicRoute>\} \/>/);

  // ProtectedRoute redirects users with pendingInvitation to /reset-password?mode=invite
  assert.match(appSource, /if \(pendingInvitation\) \{[\s\S]*?return <Navigate to="\/reset-password\?mode=invite" replace \/>;/);
});

test('13. [Edge Function Contract] invite-staff redirects to /reset-password?mode=invite on confirmed production origin', () => {
  assert.match(inviteStaffSource, /const redirectTo = `\$\{redirectOrigin\}\/reset-password\?mode=invite`;/);
  assert.match(inviteStaffSource, /const PRODUCTION_FRONTEND_URL = "https:\/\/the-fitness-house-admin-panel-696c\.vercel\.app";/);
});

