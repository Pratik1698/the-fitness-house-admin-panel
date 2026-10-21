import { useState } from 'react';
import { Key, Eye, EyeOff, Lock, CheckCircle, AlertCircle, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { useAuth } from '../../context/AppContext';

export function ChangePasswordModal({ isOpen, onClose }) {
  const { changePassword } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Client-side validations
    if (!currentPassword || !newPassword || !confirmPassword) {
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
      const result = await changePassword({
        currentPassword,
        newPassword,
        confirmPassword,
      });

      if (!result.success) {
        setError(result.error?.message || 'Failed to change password. Please verify your current password.');
      } else {
        setSuccess('Password changed successfully.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => {
          onClose();
          setSuccess(null);
        }, 1800);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setError(null);
    setSuccess(null);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-password-title"
    >
      <div className="bg-white w-full max-w-md rounded-2xl border border-[#E1E6E9] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#E1E6E9] bg-[#F5F7F8]/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#E8F5EE] border border-[#16845B]/20 text-[#16845B] flex items-center justify-center shrink-0">
              <Key size={18} strokeWidth={2.2} />
            </div>
            <div>
              <h3 id="change-password-title" className="text-base font-bold text-[#25313B]">
                Change Password
              </h3>
              <p className="text-xs text-[#64717B]">
                Update your account password securely
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="p-1.5 rounded-lg text-[#64717B] hover:text-[#25313B] hover:bg-[#E1E6E9]/50 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content & Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
              <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block">Update Failed</span>
                <span>{error}</span>
              </div>
            </div>
          )}

          {success && (
            <div className="p-3 bg-[#E8F5EE] border border-[#16845B]/20 rounded-xl text-xs text-[#16845B] flex items-start gap-2">
              <CheckCircle size={16} className="text-[#16845B] shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block">Success</span>
                <span>{success}</span>
              </div>
            </div>
          )}

          {/* Current Password */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[#25313B]">
              Current Password
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64717B] pointer-events-none">
                <Lock size={15} />
              </div>
              <input
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => { setCurrentPassword(e.target.value); setError(null); }}
                placeholder="Enter your existing password"
                disabled={loading}
                required
                className="w-full h-10 pl-9 pr-10 text-sm border border-[#E1E6E9] rounded-xl bg-white text-[#25313B] placeholder-[#64717B]/60 focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] transition-all"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64717B] hover:text-[#25313B] p-1 cursor-pointer"
                aria-label={showCurrent ? 'Hide current password' : 'Show current password'}
              >
                {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-[#25313B]">
                New Password
              </label>
              <span className="text-[11px] text-[#64717B]">Min 6 characters</span>
            </div>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64717B] pointer-events-none">
                <Lock size={15} />
              </div>
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setError(null); }}
                placeholder="Enter your new password"
                disabled={loading}
                required
                className="w-full h-10 pl-9 pr-10 text-sm border border-[#E1E6E9] rounded-xl bg-white text-[#25313B] placeholder-[#64717B]/60 focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] transition-all"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64717B] hover:text-[#25313B] p-1 cursor-pointer"
                aria-label={showNew ? 'Hide new password' : 'Show new password'}
              >
                {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Confirm New Password */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[#25313B]">
              Confirm New Password
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64717B] pointer-events-none">
                <Lock size={15} />
              </div>
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
                placeholder="Confirm your new password"
                disabled={loading}
                required
                className="w-full h-10 pl-9 pr-10 text-sm border border-[#E1E6E9] rounded-xl bg-white text-[#25313B] placeholder-[#64717B]/60 focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] transition-all"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64717B] hover:text-[#25313B] p-1 cursor-pointer"
                aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
              >
                {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#E1E6E9]">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={loading}
            >
              {loading ? 'Changing Password...' : 'Save New Password'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
