import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Dumbbell, Eye, EyeOff, Lock, CheckCircle, AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useAuth } from '../context/AppContext';

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const { resetPassword, getSession, logout } = useAuth();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasValidRecoverySession, setHasValidRecoverySession] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Check if we have an active recovery session or recovery tokens in URL
  useEffect(() => {
    let isMounted = true;

    async function checkRecoverySession() {
      try {
        setCheckingSession(true);

        // Check if hash contains error descriptions (e.g. error=access_denied&error_description=Email+link+is+invalid+or+has+expired)
        const hash = window.location.hash || '';
        const search = window.location.search || '';
        const fullParams = new URLSearchParams(hash.replace(/^#/, '') || search.replace(/^\?/, ''));

        if (fullParams.get('error') || fullParams.get('error_description')) {
          if (isMounted) {
            setHasValidRecoverySession(false);
            setError('This password-reset link is invalid or has expired. Please request a new one.');
            setCheckingSession(false);
          }
          return;
        }

        // Check active session from client
        const { session } = await getSession();
        if (isMounted) {
          if (session?.user) {
            setHasValidRecoverySession(true);
          } else {
            // Give Supabase a brief moment to process the hash fragment
            setTimeout(async () => {
              if (!isMounted) return;
              const { session: retrySession } = await getSession();
              if (retrySession?.user) {
                setHasValidRecoverySession(true);
              } else {
                setHasValidRecoverySession(false);
                setError('This password-reset link is invalid or has expired. Please request a new one.');
              }
              setCheckingSession(false);
            }, 600);
            return;
          }
          setCheckingSession(false);
        }
      } catch (err) {
        if (isMounted) {
          setHasValidRecoverySession(false);
          setError('This password-reset link is invalid or has expired. Please request a new one.');
          setCheckingSession(false);
        }
      }
    }

    checkRecoverySession();

    return () => {
      isMounted = false;
    };
  }, [getSession]);

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

    setLoading(true);

    try {
      const result = await resetPassword(newPassword, confirmPassword);
      if (!result.success) {
        setError(result.error?.message || 'Failed to reset password. Please try again or request a new link.');
      } else {
        setSuccess(true);
        // Clear any temporary recovery session
        await logout();
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
            Gym Management Admin Panel · Password Recovery
          </p>
        </div>

        {/* Reset Password Card */}
        <div className="bg-white rounded-2xl border border-[#E1E6E9] shadow-sm p-6 sm:p-8">
          {checkingSession ? (
            <div className="text-center py-8 space-y-3">
              <div className="w-10 h-10 border-2 border-[#16845B] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-medium text-[#64717B]">
                Verifying password recovery session...
              </p>
            </div>
          ) : success ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-12 h-12 rounded-full bg-[#E8F5EE] text-[#16845B] flex items-center justify-center mx-auto">
                <CheckCircle size={26} />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#25313B]">
                  Your password has been reset successfully.
                </h2>
                <p className="text-xs text-[#64717B] mt-1">
                  You can now sign in to the gym dashboard with your new credentials.
                </p>
              </div>
              <div className="pt-2">
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={() => navigate('/login', { replace: true })}
                >
                  Return to Sign In
                  <ArrowRight size={16} />
                </Button>
              </div>
            </div>
          ) : !hasValidRecoverySession ? (
            <div className="py-2 space-y-4">
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2.5">
                <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">Invalid or Expired Link</span>
                  <span>{error || 'This password-reset link is invalid or has expired. Please request a new one.'}</span>
                </div>
              </div>

              <div className="pt-2 space-y-2">
                <Button
                  variant="primary"
                  size="md"
                  className="w-full"
                  onClick={() => navigate('/login', { replace: true })}
                >
                  Request a New Password Reset
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-bold text-[#25313B] tracking-tight">
                  Set new password
                </h2>
                <p className="text-xs text-[#64717B] mt-1">
                  Choose a secure password for your administrative staff account.
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-semibold block">Reset Failed</span>
                    <span>{error}</span>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* New Password Field */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-[#25313B]">
                      New Password
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
                      placeholder="Enter new password"
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
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64717B] pointer-events-none">
                      <Lock size={16} />
                    </div>
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
                      placeholder="Confirm new password"
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

                <div className="pt-2">
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={loading}
                    className="w-full"
                  >
                    {loading ? 'Updating Password...' : 'Save New Password'}
                    {!loading && <ArrowRight size={16} />}
                  </Button>
                </div>
              </form>
            </>
          )}

          {/* Security Badge */}
          <div className="mt-6 pt-5 border-t border-[#E1E6E9] text-center">
            <div className="inline-flex items-center gap-1.5 text-xs text-[#64717B] bg-[#F5F7F8] px-3.5 py-1.5 rounded-full border border-[#E1E6E9]">
              <ShieldCheck size={14} className="text-[#16845B] shrink-0" />
              <span>Administrative Portal · Secure Recovery</span>
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
