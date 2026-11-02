import { useState } from 'react';
import { X, UserPlus, Mail, User, AlertCircle, Loader2, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { validateInvitationInput } from '../../services/staffService';

export function InviteStaffModal({ isOpen, onClose, onInvite }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const validation = validateInvitationInput({ fullName, email });
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    setLoading(true);

    try {
      const res = await onInvite({
        fullName: validation.sanitized.fullName,
        email: validation.sanitized.email,
      });

      if (res?.error) {
        setError(res.error.message || res.error);
      } else {
        setSuccess(`Invitation successfully sent to ${validation.sanitized.email}!`);
        setFullName('');
        setEmail('');
        setTimeout(() => {
          onClose();
          setSuccess(null);
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred while sending invitation.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setError(null);
    setSuccess(null);
    setFullName('');
    setEmail('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-staff-title"
    >
      <div className="bg-white w-full max-w-md rounded-2xl border border-[#E1E6E9] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#E1E6E9] bg-[#F5F7F8]/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#E8F5EE] border border-[#16845B]/20 text-[#16845B] flex items-center justify-center shrink-0">
              <UserPlus size={18} strokeWidth={2.2} />
            </div>
            <div>
              <h3 id="invite-staff-title" className="text-base font-bold text-[#25313B]">
                Invite Staff Member
              </h3>
              <p className="text-xs text-[#64717B]">Send an official gym invitation link via email</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="p-1 rounded-lg text-[#64717B] hover:text-[#25313B] hover:bg-[#F5F7F8] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 bg-[#E8F5EE] border border-[#16845B]/20 rounded-xl text-xs text-[#16845B] flex items-start gap-2">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          {/* Full Name */}
          <div>
            <label className="block text-xs font-semibold text-[#25313B] mb-1.5">
              Staff Full Name <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#85949F]">
                <User size={15} />
              </span>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Rahul Patil"
                disabled={loading}
                className="w-full pl-9 pr-3.5 py-2.5 text-xs bg-white border border-[#CBD5E1] rounded-xl text-[#25313B] placeholder-[#85949F] focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] transition-all"
              />
            </div>
          </div>

          {/* Email Address */}
          <div>
            <label className="block text-xs font-semibold text-[#25313B] mb-1.5">
              Email Address <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#85949F]">
                <Mail size={15} />
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff.member@example.com"
                disabled={loading}
                className="w-full pl-9 pr-3.5 py-2.5 text-xs bg-white border border-[#CBD5E1] rounded-xl text-[#25313B] placeholder-[#85949F] focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] transition-all"
              />
            </div>
          </div>

          {/* Security Notice: Staff Role Enforced */}
          <div className="p-3 bg-[#F8FAFB] border border-[#E1E6E9] rounded-xl text-xs text-[#64717B] flex items-start gap-2.5">
            <ShieldCheck size={16} className="text-[#16845B] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-[#25313B]">Staff Role Enforced</p>
              <p className="text-[11px] leading-relaxed">
                Invitations strictly create <strong>Staff</strong> accounts with operational permissions (check-ins, attendance, and member lookups). Administrator promotion is an explicit, separately authorized operation.
              </p>
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#E1E6E9]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={loading}
              icon={loading ? Loader2 : UserPlus}
              className={loading ? '[&>svg]:animate-spin' : ''}
            >
              {loading ? 'Sending Invitation...' : 'Send Invitation'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default InviteStaffModal;
