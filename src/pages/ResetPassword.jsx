import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Dumbbell, Eye, EyeOff, Lock, CheckCircle, AlertCircle, ArrowRight,
  ShieldCheck, ArrowLeft
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useAuth } from '../context/AppContext';
import {
  getSession as serviceGetSession,
  canAcceptStaffInvitation as serviceCanAccept,
  getUserRole as serviceGetUserRole,
  verifyOtp as serviceVerifyOtp,
  parseAuthCallback as serviceParseAuthCallback,
} from '../services/authService';

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    resetPassword,
    getSession: authGetSession,
    acceptStaffInvitation,
    logout,
    user,
    pendingInvitation,
    canAcceptStaffInvitation: authCanAccept,
    getUserRole: authGetUserRole,
    verifyOtp: authVerifyOtp,
    parseAuthCallback: authParseAuthCallback,
  } = useAuth();

  const getSession = authGetSession || serviceGetSession;
  const canAcceptStaffInvitation = authCanAccept || serviceCanAccept;
  const getUserRole = authGetUserRole || serviceGetUserRole;
  const verifyOtp = authVerifyOtp || serviceVerifyOtp;
  const parseAuthCallback = authParseAuthCallback || serviceParseAuthCallback;

  // Determine mode: first-time staff password setup vs ordinary forgotten-password recovery
  const searchParams = new URLSearchParams(location.search);
  const isInviteMode = searchParams.get('mode') === 'invite' || Boolean(pendingInvitation);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasValidRecoverySession, setHasValidRecoverySession] = useState(false);
  const [isAlreadyAccepted, setIsAlreadyAccepted] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Check if we have an active session and (if in invitation mode) valid pending staff invitation
  useEffect(() => {
    let isMounted = true;

    async function checkRecoverySession() {
      try {
        setCheckingSession(true);

        // Check if hash or search contains error descriptions or callback params
        const callback = parseAuthCallback(location);

        if (callback.isError) {
          if (isMounted) {
            setHasValidRecoverySession(false);
            setError(
              callback.friendlyErrorMessage ||
              (isInviteMode
                ? 'This staff invitation link is invalid or has expired. Please contact the gym administrator.'
                : 'This password-reset link is invalid or has expired. Please request a new one.')
            );
            setCheckingSession(false);
          }
          return;
        }

        // Handle direct token_hash verification (e.g. from custom invite template)
        if (callback.tokenHash && (callback.type === 'invite' || callback.type === 'email' || callback.type === 'recovery')) {
          const verifyRes = await verifyOtp({
            token_hash: callback.tokenHash,
            type: callback.type || (isInviteMode ? 'invite' : 'recovery'),
          });
          if (!isMounted) return;
          if (verifyRes.error) {
            setHasValidRecoverySession(false);
            setError(verifyRes.error.message || 'Invitation verification failed. The link may have expired.');
            setCheckingSession(false);
            return;
          }
        }

        // Check active session from client
        let { session } = await getSession();

        if (!session?.user) {
          // Give Supabase a brief moment to process the hash fragment
          await new Promise((resolve) => setTimeout(resolve, 600));
          if (!isMounted) return;
          const retryRes = await getSession();
          session = retryRes.session;
        }

        if (!isMounted) return;

        if (!session?.user) {
          setHasValidRecoverySession(false);
          setError(
            isInviteMode
              ? 'This staff invitation link is invalid or has expired. Please contact the gym administrator.'
              : 'This password-reset link is invalid or has expired. Please request a new one.'
          );
          setCheckingSession(false);
          return;
        }

        // In invitation setup mode: verify the current user has a valid pending staff invitation
        if (isInviteMode) {
          const canAccept = await canAcceptStaffInvitation();
          if (!isMounted) return;

          if (!canAccept) {
            // Check if user already accepted this invitation previously
            const activeRole = await getUserRole(session.user.id);
            if (!isMounted) return;

            if (activeRole === 'staff') {
              setIsAlreadyAccepted(true);
              setHasValidRecoverySession(false);
              setCheckingSession(false);
              return;
            }

            setHasValidRecoverySession(false);
            setError('No valid pending staff invitation was found for this account, or the invitation has expired. Please contact the gym administrator.');
            setCheckingSession(false);
            return;
          }
        }

        setHasValidRecoverySession(true);
        setError(null);
        setCheckingSession(false);
      } catch (err) {
        if (isMounted) {
          setHasValidRecoverySession(false);
          setError(
            isInviteMode
              ? 'This staff invitation link is invalid or has expired. Please contact the gym administrator.'
              : 'This password-reset link is invalid or has expired. Please request a new one.'
          );
          setCheckingSession(false);
        }
      }
    }

    checkRecoverySession();

    return () => {
      isMounted = false;
    };
  }, [getSession, isInviteMode, location, parseAuthCallback, verifyOtp, canAcceptStaffInvitation, getUserRole]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!newPassword || !confirmPassword) {
      setError('Please complete all password fields.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    // Protection against duplicate submissions
    if (loading) return;
    setLoading(true);

    try {
      if (isInviteMode) {
        // 1. Update password through existing Supabase Auth updateUser implementation
        const pwdResult = await resetPassword(newPassword, confirmPassword);
        if (!pwdResult.success) {
          setError(pwdResult.error?.message || 'Failed to set password. Please try again.');
          setLoading(false);
          return;
        }

        // 2. Call existing acceptStaffInvitation flow (Do NOT sign out!)
        const acceptResult = await acceptStaffInvitation();
        if (acceptResult?.error) {
          setError(acceptResult.error.message || 'The invitation could not be accepted. Please contact the gym administrator.');
          setLoading(false);
          return;
        }

        // 3. Verify that the resulting role is active staff
        const verifiedRole = acceptResult?.role || (await getUserRole(user?.id));
        if (verifiedRole !== 'staff') {
          setError('Account activated, but active staff role could not be confirmed. Please contact an administrator.');
          setLoading(false);
          return;
        }

        // 4. Role verified! Show success state and redirect to dashboard
        setSuccess(true);
        setTimeout(() => {
          navigate('/', { replace: true });
        }, 800);
      } else {
        // Ordinary forgotten password recovery
        const result = await resetPassword(newPassword, confirmPassword);
        if (!result.success) {
          setError(result.error?.message || 'Failed to reset password. Please try again or request a new link.');
        } else {
          setSuccess(true);
          // Clear temporary recovery session
          await logout();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F7F8] flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-[420px] mx-auto">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#E8F5EE] border border-[#16845B]/20 text-[#16845B] mb-3.5 shadow-xs">
            <Dumbbell size={26} strokeWidth={2.2} />
          </div>
          <h1 className="text-2xl font-bold text-[#25313B] tracking-tight">
            THE FITNESS HOUSE
          </h1>
          <p className="text-xs font-medium text-[#64717B] mt-1">
            {isInviteMode
              ? 'Gym Management Admin Panel · First-Time Staff Setup'
              : 'Gym Management Admin Panel · Password Recovery'}
          </p>
        </div>

        {/* Reset / Setup Password Card */}
        <div className="bg-white rounded-2xl border border-[#E1E6E9] shadow-sm p-6 sm:p-8">
          {checkingSession ? (
            <div className="text-center py-8 space-y-3">
              <div className="w-10 h-10 border-2 border-[#16845B] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-medium text-[#64717B]">
                {isInviteMode ? 'Verifying staff invitation...' : 'Verifying password recovery session...'}
              </p>
            </div>
          ) : success ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-12 h-12 rounded-full bg-[#E8F5EE] text-[#16845B] flex items-center justify-center mx-auto">
                <CheckCircle size={26} />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#25313B]">
                  {isInviteMode
                    ? 'Staff account activated successfully!'
                    : 'Your password has been reset successfully.'}
                </h2>
                <p className="text-xs text-[#64717B] mt-1">
                  {isInviteMode
                    ? 'Your password has been configured and your staff account is active. Redirecting to your dashboard...'
                    : 'You can now sign in to the gym dashboard with your new credentials.'}
                </p>
              </div>
              <div className="pt-2">
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={() => navigate(isInviteMode ? '/' : '/login', { replace: true })}
                >
                  {isInviteMode ? 'Go to Dashboard' : 'Return to Sign In'}
                  <ArrowRight size={16} />
                </Button>
              </div>
            </div>
          ) : isAlreadyAccepted ? (
            <div className="py-2 space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-[#E8F5EE] text-[#16845B] flex items-center justify-center mx-auto">
                <CheckCircle size={26} />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#25313B]">
                  Staff Account Already Active
                </h2>
                <p className="text-xs text-[#64717B] mt-1">
                  Your staff account has already completed invitation setup and is currently active.
                </p>
              </div>
              <div className="pt-2">
                <Button
                  variant="primary"
                  size="md"
                  className="w-full"
                  onClick={() => navigate('/', { replace: true })}
                >
                  Proceed to Dashboard
                  <ArrowRight size={16} />
                </Button>
              </div>
            </div>
          ) : !hasValidRecoverySession ? (
            <div className="py-2 space-y-4">
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2.5">
                <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">
                    {isInviteMode ? 'Invalid or Expired Invitation' : 'Invalid or Expired Link'}
                  </span>
                  <span>
                    {error ||
                      (isInviteMode
                        ? 'This staff invitation link is invalid or has expired. Please contact the gym administrator.'
                        : 'This password-reset link is invalid or has expired. Please request a new one.')}
                  </span>
                </div>
              </div>

              <div className="pt-2 space-y-2">
                <Button
                  variant="primary"
                  size="md"
                  className="w-full"
                  onClick={async () => {
                    if (isInviteMode) await logout();
                    navigate('/login', { replace: true });
                  }}
                >
                  {isInviteMode ? 'Return to Sign In' : 'Request a New Password Reset'}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-bold text-[#25313B] tracking-tight">
                  {isInviteMode ? 'Set your staff password' : 'Set new password'}
                </h2>
                <p className="text-xs text-[#64717B] mt-1">
                  {isInviteMode
                    ? `Welcome to The Fitness House${user?.email ? `, ${user.email}` : ''}! Create a secure password to complete your invitation and activate your staff access.`
                    : 'Choose a secure password for your administrative staff account.'}
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-semibold block">
                      {isInviteMode ? 'Activation Failed' : 'Reset Failed'}
                    </span>
                    <span>{error}</span>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* New Password Field */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-[#25313B]">
                      {isInviteMode ? 'Staff Password' : 'New Password'}
                    </label>
                    <span className="text-[11px] text-[#64717B]">Min 6 characters</span>
                  </div>
                  <div className="relative">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64717B] pointer-events-none">
                      <Lock size={16} />
                    </div>
                    <input
                      type={showNew ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setError(null); }}
                      placeholder="Enter password"
                      required
                      disabled={loading}
                      className="w-full h-10 pl-10 pr-10 text-sm border border-[#E1E6E9] rounded-xl bg-white text-[#25313B] placeholder-[#64717B]/60 focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew(!showNew)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64717B] hover:text-[#25313B] p-1 cursor-pointer"
                      aria-label={showNew ? 'Hide password' : 'Show password'}
                    >
                      {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Confirm New Password Field */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#25313B]">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64717B] pointer-events-none">
                      <Lock size={16} />
                    </div>
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
                      placeholder="Confirm password"
                      required
                      disabled={loading}
                      className="w-full h-10 pl-10 pr-10 text-sm border border-[#E1E6E9] rounded-xl bg-white text-[#25313B] placeholder-[#64717B]/60 focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64717B] hover:text-[#25313B] p-1 cursor-pointer"
                      aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    >
                      {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="pt-2 space-y-2">
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={loading}
                    className="w-full"
                  >
                    {loading
                      ? (isInviteMode ? 'Activating Staff Account...' : 'Updating Password...')
                      : (isInviteMode ? 'Set Password & Activate Account' : 'Save New Password')}
                    {!loading && <ArrowRight size={16} />}
                  </Button>

                  {isInviteMode && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      disabled={loading}
                      className="w-full"
                      onClick={async () => {
                        await logout();
                        navigate('/login', { replace: true });
                      }}
                    >
                      <ArrowLeft size={14} /> Cancel & Sign Out
                    </Button>
                  )}
                </div>
              </form>
            </>
          )}

          {/* Security Badge */}
          <div className="mt-6 pt-5 border-t border-[#E1E6E9] text-center">
            <div className="inline-flex items-center gap-1.5 text-xs text-[#64717B] bg-[#F5F7F8] px-3.5 py-1.5 rounded-full border border-[#E1E6E9]">
              <ShieldCheck size={14} className="text-[#16845B] shrink-0" />
              <span>
                {isInviteMode
                  ? 'Staff Invitation · Secure Account Activation'
                  : 'Administrative Portal · Secure Recovery'}
              </span>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <p className="text-center text-xs text-[#64717B] mt-6">
          The Fitness House Gym Management · Near Vitthal Mandir, Arag
        </p>
      </div>
    </div>
  );
}
