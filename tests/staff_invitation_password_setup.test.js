import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const resetPasswordSource = read('../src/pages/ResetPassword.jsx');
const loginSource = read('../src/pages/Login.jsx');
const appSource = read('../src/App.jsx');
const appContextSource = read('../src/context/AppContext.jsx');
const authServiceSource = read('../src/services/authService.js');

import {
  validatePassword,
  resetPassword,
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting,
} from '../src/services/authService.js';

test('1. validatePassword enforces non-empty and minimum length requirements', () => {
  assert.equal(validatePassword(''), 'Please complete all password fields.');
  assert.equal(validatePassword(null), 'Please complete all password fields.');
  assert.equal(validatePassword('12345'), 'Password must be at least 6 characters long.');
  assert.equal(validatePassword('123456'), null);
  assert.equal(validatePassword('SecureP@ssw0rd!'), null);
});

test('2. resetPassword delegates to auth.updateUser with new password', async () => {
  let updatedPayload = null;
  const mockClient = {
    auth: {
      updateUser: async (payload) => {
        updatedPayload = payload;
        return { data: { user: { id: 'test-user-id' } }, error: null };
      },
    },
  };

  setSupabaseClientForTesting(mockClient, true);
  try {
    const result = await resetPassword('NewValidPass123', 'NewValidPass123');
    assert.equal(result.success, true);
    assert.deepEqual(updatedPayload, { password: 'NewValidPass123' });

    // Rejection on password mismatch
    const mismatchResult = await resetPassword('PassA123', 'PassB123');
    assert.equal(mismatchResult.success, false);
    assert.match(mismatchResult.error.message, /do not match/i);

    // Rejection on short password
    const shortResult = await resetPassword('123', '123');
    assert.equal(shortResult.success, false);
    assert.match(shortResult.error.message, /at least 6 characters/i);
  } finally {
    resetSupabaseClientForTesting();
  }
});

test('3. ResetPassword component clearly distinguishes first-time staff setup vs ordinary recovery', () => {
  // Mode detection
  assert.match(resetPasswordSource, /const isInviteMode = searchParams\.get\('mode'\) === 'invite' \|\| Boolean\(pendingInvitation\);/);

  // Distinct titles & headings
  assert.match(resetPasswordSource, /isInviteMode\s*\?\s*['"]Gym Management Admin Panel · First-Time Staff Setup['"]\s*:\s*['"]Gym Management Admin Panel · Password Recovery['"]/);
  assert.match(resetPasswordSource, /isInviteMode \? 'Set your staff password' : 'Set new password'/);

  // Distinct buttons
  assert.match(resetPasswordSource, /isInviteMode \? 'Activating Staff Account\.\.\.' : 'Updating Password\.\.\.'/);
  assert.match(resetPasswordSource, /isInviteMode \? 'Set Password & Activate Account' : 'Save New Password'/);

  // Distinct security badges
  assert.match(resetPasswordSource, /isInviteMode\s*\?\s*['"]Staff Invitation · Secure Account Activation['"]\s*:\s*['"]Administrative Portal · Secure Recovery['"]/);
});

test('4. In invitation mode, session and pending invitation are verified using secure database checks', () => {
  // Session verification check
  assert.match(resetPasswordSource, /let\s*\{\s*session\s*\}\s*=\s*await getSession\(\);/);

  // In invitation mode, verifies canAcceptStaffInvitation
  assert.match(resetPasswordSource, /if \(isInviteMode\) \{[\s\S]*?await canAcceptStaffInvitation\(\);/);

  // Fail-closed on missing/expired invitation
  assert.match(resetPasswordSource, /No valid pending staff invitation was found for this account, or the invitation has expired\./);
});

test('5. In invitation mode, updates password and accepts invitation without signing out', () => {
  const handleSubmitBody = resetPasswordSource.slice(
    resetPasswordSource.indexOf('const handleSubmit = async')
  );

  const inviteBranch = handleSubmitBody.slice(
    handleSubmitBody.indexOf('if (isInviteMode) {'),
    handleSubmitBody.indexOf('} else {')
  );

  // Calls resetPassword
  assert.match(inviteBranch, /await resetPassword\(newPassword, confirmPassword\)/);

  // Calls acceptStaffInvitation immediately without logging out
  assert.match(inviteBranch, /await acceptStaffInvitation\(\)/);
  assert.doesNotMatch(inviteBranch, /await logout\(\)/);

  // Verifies that resulting role is active staff
  assert.match(inviteBranch, /verifiedRole !== 'staff'/);
  assert.match(inviteBranch, /Account activated, but active staff role could not be confirmed/);

  // Redirects to dashboard only after successful verification
  assert.match(inviteBranch, /navigate\('\/', \{ replace: true \}\)/);
});

test('6. Ordinary password recovery preserves logout and login redirection', () => {
  const handleSubmitBody = resetPasswordSource.slice(
    resetPasswordSource.indexOf('const handleSubmit = async')
  );

  const recoveryBranch = handleSubmitBody.slice(
    handleSubmitBody.indexOf('} else {'),
    handleSubmitBody.indexOf('} catch (err)')
  );

  assert.match(recoveryBranch, /await resetPassword\(newPassword, confirmPassword\)/);
  assert.match(recoveryBranch, /await logout\(\)/);
  assert.match(resetPasswordSource, /navigate\(isInviteMode \? '\/' : '\/login', \{ replace: true \}\)/);
});

test('7. App routing and Login component redirect pending staff invitations to invitation setup mode', () => {
  // ProtectedRoute in App.jsx redirects pending invitations to /reset-password?mode=invite
  assert.match(appSource, /if \(pendingInvitation\) \{[\s\S]*?return <Navigate to="\/reset-password\?mode=invite" replace \/>;/);

  // Login.jsx redirects pending invitations to /reset-password?mode=invite on mount
  assert.match(loginSource, /if \(!authLoading && pendingInvitation\) \{[\s\S]*?navigate\('\/reset-password\?mode=invite', \{ replace: true \}\);/);

  // Login.jsx redirects pending invitations on successful login result
  assert.match(loginSource, /if \(result\.pendingInvitation\) \{[\s\S]*?navigate\('\/reset-password\?mode=invite', \{ replace: true \}\);/);
});

test('8. Duplicate submission protection and loading states are enforced', () => {
  assert.match(resetPasswordSource, /if \(loading\) return;/);
  assert.match(resetPasswordSource, /disabled=\{loading\}/);
});

test('9. AppContext acceptStaffInvitation returns confirmed role and handles user binding', () => {
  assert.match(appContextSource, /const currentUserId = user\?\.id \|\| session\?\.user\?\.id/);
  assert.match(appContextSource, /const resolvedRole = await getUserRole\(currentUserId\);/);
  assert.match(appContextSource, /return \{ data: result\.data, error: null, role: resolvedRole \};/);
});
