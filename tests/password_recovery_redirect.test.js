import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const appSource = read('../src/App.jsx');
const appContextSource = read('../src/context/AppContext.jsx');
const resetPasswordSource = read('../src/pages/ResetPassword.jsx');
const authServiceSource = read('../src/services/authService.js');

import {
  validatePassword,
  resetPassword,
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting,
} from '../src/services/authService.js';

// ---------------------------------------------------------------------------
// 1. Route Guard & Routing Contracts
// ---------------------------------------------------------------------------

test('1.1 /reset-password is a standalone route (NOT wrapped in PublicRoute)', () => {
  // Verifies that /reset-password renders ResetPassword directly without PublicRoute ejection
  assert.match(
    appSource,
    /<Route path="\/reset-password" element=\{<ResetPassword \/>\} \/>/,
    '/reset-password must be rendered directly without PublicRoute'
  );
  assert.doesNotMatch(
    appSource,
    /<Route path="\/reset-password" element=\{<PublicRoute><ResetPassword \/><\/PublicRoute>\} \/>/,
    '/reset-password must NOT be wrapped in PublicRoute'
  );
});

test('1.2 PublicRoute continues to protect /login from normal authenticated users', () => {
  // Verifies that /login remains wrapped in PublicRoute
  assert.match(
    appSource,
    /<Route path="\/login" element=\{<PublicRoute><Login \/><\/PublicRoute>\} \/>/,
    '/login must remain protected by PublicRoute'
  );

  // Verifies that PublicRoute redirects authenticated users to /
  assert.match(
    appSource,
    /if \(isAuthenticated\) \{\s*return <Navigate to="\/" replace \/>;\s*\}/,
    'PublicRoute must redirect authenticated users to /'
  );
});

test('1.3 PublicRoute redirects recovery session users to /reset-password instead of /', () => {
  // When isPasswordRecovery is true, PublicRoute must route to /reset-password
  assert.match(
    appSource,
    /if \(isPasswordRecovery\) \{\s*return <Navigate to="\/reset-password" replace \/>;\s*\}/,
    'PublicRoute must navigate recovery users to /reset-password'
  );
});

test('1.4 ProtectedRoute keeps recovery session users on /reset-password', () => {
  // If an active recovery session attempts to browse protected routes, it is constrained to /reset-password
  assert.match(
    appSource,
    /if \(isPasswordRecovery\) \{\s*return <Navigate to="\/reset-password" replace \/>;\s*\}/,
    'ProtectedRoute must constrain recovery users to /reset-password'
  );
});

// ---------------------------------------------------------------------------
// 2. AppContext PASSWORD_RECOVERY Lifecycle & Recovery State
// ---------------------------------------------------------------------------

test('2.1 AppContext declares isPasswordRecovery state and clearPasswordRecovery handler', () => {
  assert.match(appContextSource, /const \[isPasswordRecovery, setIsPasswordRecovery\] = useState\(false\);/);
  assert.match(appContextSource, /const clearPasswordRecovery = useCallback\(\(\) => \{/);
  assert.match(appContextSource, /isPasswordRecovery,\s*clearPasswordRecovery,/);
});

test('2.2 onAuthStateChange captures PASSWORD_RECOVERY and sets isPasswordRecovery: true', () => {
  assert.match(
    appContextSource,
    /if \(event === 'PASSWORD_RECOVERY'\) \{[\s\S]*?setIsPasswordRecovery\(true\);/
  );
});

test('2.3 SIGNED_OUT and logout() reset isPasswordRecovery to false', () => {
  // In onAuthStateChange SIGNED_OUT
  assert.match(
    appContextSource,
    /if \(event === 'SIGNED_OUT' \|\| !newSession\) \{[\s\S]*?setIsPasswordRecovery\(false\);/
  );

  // In logout callback
  assert.match(
    appContextSource,
    /const logout = useCallback\(async \(\) => \{[\s\S]*?setIsPasswordRecovery\(false\);/
  );
});

test('2.4 initSession detects recovery tokens in URL on initial mount', () => {
  assert.match(
    appContextSource,
    /const isRecoveryUrl = callback\.type === 'recovery' \|\| Boolean\(typeof window !== 'undefined' && window\.location\.hash\?\.includes\('type=recovery'\)\);/
  );
  assert.match(
    appContextSource,
    /if \(isRecoveryUrl && isMounted\) \{\s*setIsPasswordRecovery\(true\);/
  );
});

test('2.5 useAuth() hook exposes isPasswordRecovery and clearPasswordRecovery', () => {
  assert.match(appContextSource, /isPasswordRecovery: ctx\.isPasswordRecovery/);
  assert.match(appContextSource, /clearPasswordRecovery: ctx\.clearPasswordRecovery/);
});

// ---------------------------------------------------------------------------
// 3. ResetPassword Component Lifecycle & Error Handling
// ---------------------------------------------------------------------------

test('3.1 ResetPassword component destructures clearPasswordRecovery from useAuth()', () => {
  assert.match(resetPasswordSource, /clearPasswordRecovery/);
});

test('3.2 On successful password recovery, temporary session and recovery state are cleared', () => {
  const handleSubmitBody = resetPasswordSource.slice(
    resetPasswordSource.indexOf('const handleSubmit = async')
  );

  const recoveryBranch = handleSubmitBody.slice(
    handleSubmitBody.indexOf('} else {'),
    handleSubmitBody.indexOf('} catch (err)')
  );

  // Calls resetPassword
  assert.match(recoveryBranch, /await resetPassword\(newPassword, confirmPassword\)/);
  // Clears recovery state
  assert.match(recoveryBranch, /if \(clearPasswordRecovery\) clearPasswordRecovery\(\);/);
  // Logs out temporary recovery session
  assert.match(recoveryBranch, /await logout\(\);/);
});

test('3.3 Invalid or expired recovery links show an appropriate error message', () => {
  assert.match(
    resetPasswordSource,
    /isInviteMode\s*\?\s*'This staff invitation link is invalid or has expired\. Please contact the gym administrator\.'\s*:\s*'This password-reset link is invalid or has expired\. Please request a new one\.'/
  );
});

test('3.4 ResetPassword provides Cancel & Return to Sign In options that reset recovery state', () => {
  assert.match(
    resetPasswordSource,
    /if \(clearPasswordRecovery\) clearPasswordRecovery\(\);[\s\S]*?await logout\(\);[\s\S]*?navigate\('\/login', \{ replace: true \}\);/
  );
});

// ---------------------------------------------------------------------------
// 4. Password Update Service Contracts
// ---------------------------------------------------------------------------

test('4.1 validatePassword validates length and completion', () => {
  assert.equal(validatePassword(''), 'Please complete all password fields.');
  assert.equal(validatePassword('12345'), 'Password must be at least 6 characters long.');
  assert.equal(validatePassword('Pass1234!'), null);
});

test('4.2 resetPassword delegates to auth.updateUser and returns success', async () => {
  let updatedPayload = null;
  const mockClient = {
    auth: {
      updateUser: async (payload) => {
        updatedPayload = payload;
        return { data: { user: { id: 'user-recovered-1' } }, error: null };
      },
    },
  };

  setSupabaseClientForTesting(mockClient, true);
  try {
    const result = await resetPassword('NewSecurePassword123', 'NewSecurePassword123');
    assert.equal(result.success, true);
    assert.deepEqual(updatedPayload, { password: 'NewSecurePassword123' });
    assert.equal(result.message, 'Your password has been reset successfully.');
  } finally {
    resetSupabaseClientForTesting();
  }
});
