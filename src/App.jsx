import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Dumbbell, Mail, CheckCircle, AlertCircle, RefreshCw, LogOut, ShieldAlert } from 'lucide-react';
import { AppProvider, useAuth } from './context/AppContext';
import { AppLayout } from './components/layout/AppLayout';
import { Button } from './components/ui/Button';

// Module pages
import Dashboard from './pages/Dashboard';
import Members from './pages/Members';
import MemberProfile from './pages/MemberProfile';
import PersonalTraining from './pages/PersonalTraining';
import Payments from './pages/Payments';
import CheckIns from './pages/CheckIns';
import Attention from './pages/Attention';
import Notifications from './pages/Notifications';
import Followups from './pages/Followups';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';

/**
 * Branded loading screen displayed during initial session verification
 */
function AuthLoadingScreen() {
  return (
    <div className="min-h-screen bg-[#F5F7F8] flex flex-col items-center justify-center p-4">
      <div className="w-12 h-12 rounded-2xl bg-[#E8F5EE] border border-[#16845B]/20 text-[#16845B] flex items-center justify-center mb-4 shadow-xs animate-pulse">
        <Dumbbell size={24} strokeWidth={2.2} />
      </div>
      <p className="text-xs font-semibold text-[#25313B] tracking-tight">THE FITNESS HOUSE</p>
      <p className="text-[11px] text-[#64717B] mt-1">Verifying administrative access...</p>
    </div>
  );
}

/**
 * Screen displayed when an authenticated user has not confirmed their email address
 */
function EmailVerificationNotice() {
  const { user, resendVerificationEmail, logout } = useAuth();
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(null);
  const [resendError, setResendError] = useState(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = setInterval(() => {
      setCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldown]);

  const handleResend = async () => {
    if (!user?.email || cooldown > 0 || resending) return;
    setResending(true);
    setResendSuccess(null);
    setResendError(null);

    try {
      const res = await resendVerificationEmail(user.email);
      if (res.success) {
        setResendSuccess('Verification email sent! Check your inbox or local Mailpit at http://127.0.0.1:54324.');
        setCooldown(60);
      } else {
        setResendError(res.error?.message || 'Failed to resend verification email.');
      }
    } catch (err) {
      setResendError('Failed to resend verification email. Please try again shortly.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F7F8] flex flex-col justify-center items-center p-4 sm:p-6">
      <div className="w-full max-w-[440px] bg-white rounded-2xl border border-[#E1E6E9] shadow-sm p-6 sm:p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-[#E8F5EE] border border-[#16845B]/20 text-[#16845B] flex items-center justify-center mx-auto shadow-xs">
          <Mail size={26} strokeWidth={2.2} />
        </div>

        <div>
          <h2 className="text-lg font-bold text-[#25313B] tracking-tight">
            Please verify your email address to continue.
          </h2>
          <p className="text-xs text-[#64717B] mt-1.5">
            We sent a verification link to <span className="font-semibold text-[#25313B]">{user?.email}</span>. Please verify your email to unlock dashboard access.
          </p>
        </div>

        {resendSuccess && (
          <div className="p-3 bg-[#E8F5EE] border border-[#16845B]/20 rounded-xl text-xs text-[#16845B] flex items-start gap-2 text-left">
            <CheckCircle size={16} className="shrink-0 mt-0.5" />
            <span>{resendSuccess}</span>
          </div>
        )}

        {resendError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2 text-left">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{resendError}</span>
          </div>
        )}

        <div className="p-3 bg-[#F5F7F8] rounded-xl border border-[#E1E6E9] text-[11px] text-[#64717B] text-left">
          <span className="font-semibold text-[#25313B] block mb-0.5">Local Development:</span>
          Open Mailpit at <a href="http://127.0.0.1:54324" target="_blank" rel="noreferrer" className="text-[#16845B] font-semibold underline">http://127.0.0.1:54324</a> to view your verification email and click the confirmation link.
        </div>

        <div className="pt-2 flex flex-col gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={handleResend}
            disabled={resending || cooldown > 0}
            className="w-full"
          >
            {resending
              ? 'Sending email...'
              : cooldown > 0
              ? `Resend available in ${cooldown}s`
              : 'Resend Verification Email'}
            {!resending && cooldown <= 0 && <RefreshCw size={14} />}
          </Button>

          <Button
            variant="secondary"
            size="md"
            onClick={logout}
            className="w-full"
          >
            <LogOut size={14} />
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Screen displayed when an authenticated user does not possess the required role
 */
function AccessDeniedScreen() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center space-y-3">
      <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center shadow-xs">
        <ShieldAlert size={24} />
      </div>
      <h2 className="text-base font-bold text-[#25313B]">Access Restricted</h2>
      <p className="text-xs text-[#64717B] max-w-sm">
        This section is reserved for administrators only. Your current staff account does not possess permission to access this resource.
      </p>
      <Button variant="primary" size="sm" onClick={() => window.location.href = '/'}>
        Return to Dashboard
      </Button>
    </div>
  );
}

/**
 * Route guard enforcing authenticated sessions with verified email and optional role requirements
 */
function ProtectedRoute({ children, requiredRole }) {
  const { isAuthenticated, isEmailUnverified, authLoading, role } = useAuth();
  const location = useLocation();

  if (authLoading) {
    return <AuthLoadingScreen />;
  }

  // If user signed in but email is unverified, require email confirmation
  if (isEmailUnverified) {
    return <EmailVerificationNotice />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Enforce role-based access if route specifies requiredRole
  if (requiredRole && role !== requiredRole) {
    return (
      <AppLayout>
        <AccessDeniedScreen />
      </AppLayout>
    );
  }

  return <AppLayout>{children}</AppLayout>;
}

/**
 * Route guard for public auth pages; redirects authenticated users to dashboard
 */
function PublicRoute({ children }) {
  const { isAuthenticated, authLoading } = useAuth();

  if (authLoading) {
    return <AuthLoadingScreen />;
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Auth Routes */}
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/reset-password" element={<PublicRoute><ResetPassword /></PublicRoute>} />

          {/* Protected Main App Layout routes */}
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/members" element={<ProtectedRoute><Members /></ProtectedRoute>} />
          <Route path="/members/:id" element={<ProtectedRoute><MemberProfile /></ProtectedRoute>} />
          <Route path="/personal-training" element={<ProtectedRoute><PersonalTraining /></ProtectedRoute>} />
          <Route path="/payments" element={<ProtectedRoute requiredRole="admin"><Payments /></ProtectedRoute>} />
          <Route path="/checkins" element={<ProtectedRoute><CheckIns /></ProtectedRoute>} />
          <Route path="/attention" element={<ProtectedRoute><Attention /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
          <Route path="/followups" element={<ProtectedRoute><Followups /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
