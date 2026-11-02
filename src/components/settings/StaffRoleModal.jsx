import { useState } from 'react';
import { Shield, AlertTriangle, AlertCircle, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

export function StaffRoleModal({ isOpen, onClose, staffMember, targetRole, isSelf, onConfirm }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen || !staffMember) return null;

  const isPromotingToAdmin = targetRole === 'admin';

  const handleConfirm = async () => {
    if (isSelf && targetRole === 'staff') {
      setError('Operation prohibited: You cannot demote your own administrator account.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await onConfirm(staffMember.id, targetRole);
      if (res?.error) {
        setError(res.error.message || res.error);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while updating the role.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!loading) {
          setError(null);
          onClose();
        }
      }}
      title={isPromotingToAdmin ? "Promote to Gym Administrator" : "Demote to Staff Role"}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2.5 w-full">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant={isPromotingToAdmin ? "primary" : "secondary"}
            size="sm"
            onClick={handleConfirm}
            disabled={loading || (isSelf && targetRole === 'staff')}
            icon={loading ? Loader2 : Shield}
            className={loading ? '[&>svg]:animate-spin' : ''}
          >
            {loading ? 'Updating Role...' : isPromotingToAdmin ? 'Confirm Promotion' : 'Confirm Demotion'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5 text-xs text-[#25313B]">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <p>
          Are you sure you want to change the role for{' '}
          <strong>{staffMember.fullName || staffMember.name}</strong> to{' '}
          <strong className="capitalize">{targetRole}</strong>?
        </p>

        {isSelf && targetRole === 'staff' && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>You cannot demote yourself. Ask another active administrator to adjust your permissions.</span>
          </div>
        )}

        <div
          className={`p-3.5 rounded-xl border text-xs leading-relaxed space-y-1.5 ${
            isPromotingToAdmin
              ? 'bg-[#E8F5EE] border-[#16845B]/20 text-[#16845B]'
              : 'bg-[#FFF9F5] border-[#FEE4D2] text-[#B93815]'
          }`}
        >
          <div className="flex items-center gap-1.5 font-bold">
            <Shield size={15} />
            <span>{isPromotingToAdmin ? 'Administrator Permissions:' : 'Staff Permissions:'}</span>
          </div>
          {isPromotingToAdmin ? (
            <p className="text-[11px] leading-normal">
              Administrators hold full access to all modules, including total revenue analytics, financial collections, staff onboarding, account deactivation, and system settings.
            </p>
          ) : (
            <p className="text-[11px] leading-normal">
              Staff members are restricted to operational workflows: check-in desk, member onboarding, and attendance logs. They cannot view financial revenues, modify membership plans, or access facility security settings.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default StaffRoleModal;
