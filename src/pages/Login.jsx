import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Dumbbell, Eye, EyeOff, Lock, Mail, ArrowRight, ShieldCheck, Check,
  AlertCircle, ArrowLeft, Send, CheckCircle
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useAuth } from '../context/AppContext';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    login,
    isAuthenticated,
    authLoading,
    pendingInvitation,
    acceptStaffInvitation,
    logout,
    user,
    requestPasswordReset,
    resendVerificationEmail,
  } = useAuth();

  // Mode: 'login' | 'forgot_password'
  const [mode, setMode] = useState('login');

  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Forgot password form state
  const [resetEmail, setResetEmail] = useState('');
  const [resetSuccessMessage, setResetSuccessMessage] = useState(null);

  // Unverified email handling & resend cooldown
  const [unverifiedEmail, setUnverifiedEmail] = useState(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendStatus, setResendStatus] = useState(null); // 'sending' | 'sent' | 'error'
  const [resendMessage, setResendMessage] = useState(null);

  // Common UI states
  const [loading, setLoading] = useState(false);
  const [acceptingInvitation, setAcceptingInvitation] = useState(false);
  const [error, setError] = useState(null);

  // If already logged in with a valid session and role, redirect to target page or dashboard
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      const from = location.state?.from?.pathname || '/';
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, authLoading, navigate, location]);

  // If user has a pending staff invitation, redirect to reset-password in invitation setup mode
  useEffect(() => {
    if (!authLoading && pendingInvitation) {
      navigate('/reset-password?mode=invite', { replace: true });
    }
  }, [pendingInvitation, authLoading, navigate]);

  // Handle Resend Cooldown Timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setResendStatus(null);
    setResendMessage(null);

    // Client-side input validation
    if (!email || !email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);

    try {
      const result = await login(email, password);
      if (!result.success) {
        const errorMsg = result.error?.message || 'Invalid email or password. Please check your details and try again.';
        setError(errorMsg);

        // Detect if error is due to unverified email
        if (
          errorMsg.toLowerCase().includes('not verified') ||
          errorMsg.toLowerCase().includes('not confirmed') ||
          result.isEmailUnverified
        ) {
          setUnverifiedEmail(email.trim());
        } else {
          setUnverifiedEmail(null);
        }
      } else {
        if (result.pendingInvitation) {
          navigate('/reset-password?mode=invite', { replace: true });
          return;
        }
        const from = location.state?.from?.pathname || '/';
        navigate(from, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in right now. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptInvitation = async () => {
    setError(null);
    setAcceptingInvitation(true);
    try {
      const result = await acceptStaffInvitation();
      if (result.error) {
        setError(result.error.message || 'The invitation could not be accepted. Contact the gym administrator.');
        return;
      }
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The invitation could not be accepted.');
    } finally {
      setAcceptingInvitation(false);
    }
  };

  const handleForgotPasswordSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setResetSuccessMessage(null);

    if (!resetEmail || !resetEmail.trim()) {
      setError('Please enter your email address.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(resetEmail.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);

    try {
      const result = await requestPasswordReset(resetEmail.trim());
      // Always show generic message to prevent account enumeration
      setResetSuccessMessage(
        result.message || 'If an account exists for this email address, password reset instructions will be sent.'
      );
    } catch (err) {
      setResetSuccessMessage('If an account exists for this email address, password reset instructions will be sent.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    const targetEmail = unverifiedEmail || email.trim();
    if (!targetEmail || resendCooldown > 0) return;

    setResendStatus('sending');
    setResendMessage(null);

    try {
      const result = await resendVerificationEmail(targetEmail);
      if (!result.success) {
        setResendStatus('error');
        setResendMessage(result.error?.message || 'Failed to resend verification email. Please try again shortly.');
      } else {
        setResendStatus('sent');
        setResendMessage('Verification email sent! Check your inbox or local Mailpit at http://127.0.0.1:54324.');
        setResendCooldown(60); // 60-second cooldown
      }
    } catch (err) {
      setResendStatus('error');
      setResendMessage('Failed to resend verification email. Please try again shortly.');
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
            Gym Management Admin Panel · Arag
          </p>
        </div>

        {/* Auth Card */}
        <div className="bg-white rounded-2xl border border-[#E1E6E9] shadow-sm p-6 sm:p-8">
          {pendingInvitation ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-[#25313B] tracking-tight">Staff Account Activation</h2>
                <p className="text-xs text-[#64717B] mt-1">
                  You are signed in as <span className="font-semibold text-[#25313B]">{user?.email}</span>. Please configure your password to activate your staff access.
                </p>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="button"
                variant="primary"
                size="lg"
                disabled={authLoading}
                className="w-full"
                onClick={() => navigate('/reset-password?mode=invite', { replace: true })}
              >
                Set Password & Activate Account
                <ArrowRight size={16} />
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={authLoading}
                className="w-full"
                onClick={logout}
              >
                <ArrowLeft size={14} /> Sign Out
              </Button>
            </div>
          ) : mode === 'login' ? (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-bold text-[#25313B] tracking-tight">
                  Sign in to your account
                </h2>
                <p className="text-xs text-[#64717B] mt-1">
                  Enter your administrator credentials to access the facility dashboard.
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <span className="font-semibold block">Authentication Notice</span>
                      <span>{error}</span>
                    </div>
                  </div>

                  {/* Resend Verification Action if Email Unverified */}
                  {unverifiedEmail && (
                    <div className="pt-2 border-t border-red-200/60 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={handleResendVerification}
                        disabled={resendCooldown > 0 || resendStatus === 'sending'}
                        className="text-xs font-semibold text-[#16845B] hover:underline cursor-pointer disabled:text-[#64717B] text-left"
                      >
                        {resendStatus === 'sending'
                          ? 'Sending verification email...'
                          : resendCooldown > 0
                          ? `Resend available in ${resendCooldown}s`
                          : 'Resend Verification Email'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Resend status feedback */}
              {resendMessage && (
                <div
                  className={`mb-4 p-3 rounded-xl text-xs flex items-start gap-2 ${
                    resendStatus === 'sent'
                      ? 'bg-[#E8F5EE] border border-[#16845B]/20 text-[#16845B]'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}
                >
                  {resendStatus === 'sent' ? (
                    <CheckCircle size={16} className="shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  )}
                  <span>{resendMessage}</span>
                </div>
              )}

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                {/* Email Field */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#25313B]">
                    Email Address
                  </label>
                  <div className="relative">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64717B] pointer-events-none">
                      <Mail size={16} />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(null); }}
                      placeholder="pravinjoshi2707@gmail.com"
                      required
                      disabled={loading}
                      className="w-full h-10 pl-10 pr-3.5 text-sm border border-[#E1E6E9] rounded-xl bg-white text-[#25313B] placeholder-[#64717B]/60 focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] hover:border-[#CBD5E1] transition-all"
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-[#25313B]">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('forgot_password');
                        setResetEmail(email);
                        setError(null);
                        setResetSuccessMessage(null);
                      }}
                      className="text-xs font-medium text-[#16845B] hover:underline cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64717B] pointer-events-none">
                      <Lock size={16} />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(null); }}
                      placeholder="Enter your password"
                      required
                      disabled={loading}
                      className="w-full h-10 pl-10 pr-10 text-sm border border-[#E1E6E9] rounded-xl bg-white text-[#25313B] placeholder-[#64717B]/60 focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] hover:border-[#CBD5E1] transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64717B] hover:text-[#25313B] p-1 cursor-pointer transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Custom Styled Checkbox */}
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <div className="relative flex items-center">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="sr-only"
                      />
                      <div
                        className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${
                          rememberMe
                            ? 'bg-[#16845B] border-[#16845B] text-white'
                            : 'bg-white border-[#CBD5E1]'
                        }`}
                      >
                        {rememberMe && <Check size={12} strokeWidth={3} />}
                      </div>
                    </div>
                    <span className="text-xs text-[#64717B]">
                      Remember this device for 30 days
                    </span>
                  </label>
                </div>

                {/* Submit Button */}
                <div className="pt-2">
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={loading}
                    className="w-full"
                  >
                    {loading ? 'Signing In...' : 'Sign In to Dashboard'}
                    {!loading && <ArrowRight size={16} />}
                  </Button>
                </div>
              </form>
            </>
          ) : (
            /* Forgot Password Mode */
            <>
              <div className="mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                    setResetSuccessMessage(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#16845B] hover:underline mb-3 cursor-pointer"
                >
                  <ArrowLeft size={14} /> Back to Sign In
                </button>
                <h2 className="text-lg font-bold text-[#25313B] tracking-tight">
                  Recover your password
                </h2>
                <p className="text-xs text-[#64717B] mt-1">
                  Enter your registered email address to receive password reset instructions.
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-semibold block">Request Notice</span>
                    <span>{error}</span>
                  </div>
                </div>
              )}

              {resetSuccessMessage ? (
                <div className="py-2 space-y-4">
                  <div className="p-3.5 bg-[#E8F5EE] border border-[#16845B]/20 rounded-xl text-xs text-[#16845B] space-y-1.5">
                    <div className="flex items-center gap-2 font-semibold">
                      <CheckCircle size={16} /> Instructions Dispatched
                    </div>
                    <p className="text-[#25313B]">{resetSuccessMessage}</p>
                    <p className="text-[11px] text-[#64717B] pt-1 border-t border-[#16845B]/10">
                      Local Testing: Open Mailpit at <a href="http://127.0.0.1:54324" target="_blank" rel="noreferrer" className="text-[#16845B] underline font-medium">http://127.0.0.1:54324</a> to view your recovery link.
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    className="w-full"
                    onClick={() => {
                      setMode('login');
                      setResetSuccessMessage(null);
                    }}
                  >
                    Return to Sign In
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleForgotPasswordSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-[#25313B]">
                      Registered Email Address
                    </label>
                    <div className="relative">
                      <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64717B] pointer-events-none">
                        <Mail size={16} />
                      </div>
                      <input
                        type="email"
                        value={resetEmail}
                        onChange={(e) => { setResetEmail(e.target.value); setError(null); }}
                        placeholder="pravinjoshi2707@gmail.com"
                        required
                        disabled={loading}
                        className="w-full h-10 pl-10 pr-3.5 text-sm border border-[#E1E6E9] rounded-xl bg-white text-[#25313B] placeholder-[#64717B]/60 focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] transition-all"
                      />
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
                      {loading ? 'Sending Instructions...' : 'Send Reset Instructions'}
                      {!loading && <Send size={15} />}
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}

          {/* Security Badge */}
          <div className="mt-6 pt-5 border-t border-[#E1E6E9] text-center">
            <div className="inline-flex items-center gap-1.5 text-xs text-[#64717B] bg-[#F5F7F8] px-3.5 py-1.5 rounded-full border border-[#E1E6E9]">
              <ShieldCheck size={14} className="text-[#16845B] shrink-0" />
              <span>Administrative Portal · Role-Protected Access</span>
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
