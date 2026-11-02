import { useState } from 'react';
import { Power, Check, AlertTriangle, AlertCircle, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

export function StaffStatusModal({ isOpen, onClose, staffMember, targetActive, onConfirm }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen || !staffMember) return null;

  const isDeactivating = !targetActive;

  const handleConfirm = async () => {
    setError(null);
    setLoading(true);

    try {
      const res = await onConfirm(staffMember.id, targetActive);
      if (res?.error) {
        setError(res.error.message || res.error);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while updating account status.');
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
      title={isDeactivating ? "Deactivate Staff Account" : "Reactivate Staff Account"}
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
            variant={isDeactivating ? "danger" : "primary"}
            size="sm"
            onClick={handleConfirm}
            disabled={loading}
            icon={loading ? Loader2 : isDeactivating ? Power : Check}
            className={loading ? '[&>svg]:animate-spin' : ''}
          >
            {loading
              ? 'Updating...'
              : isDeactivating
              ? 'Confirm Deactivation'
              : 'Confirm Reactivation'}
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
          {isDeactivating ? (
            <>
              Are you sure you want to deactivate the account for{' '}
              <strong>{staffMember.fullName || staffMember.name}</strong> ({staffMember.email || 'Staff'})?
            </>
          ) : (
            <>
              Are you sure you want to reactivate the account for{' '}
              <strong>{staffMember.fullName || staffMember.name}</strong>?
            </>
          )}
        </p>

        <div
          className={`p-3.5 rounded-xl border text-xs leading-relaxed space-y-1.5 ${
            isDeactivating
              ? 'bg-[#FFF9F5] border-[#FEE4D2] text-[#B93815]'
              : 'bg-[#E8F5EE] border-[#16845B]/20 text-[#16845B]'
          }`}
        >
          <div className="flex items-center gap-1.5 font-bold">
            {isDeactivating ? <AlertTriangle size={15} /> : <Check size={15} />}
            <span>{isDeactivating ? 'Immediate Security Impact:' : 'Reactivation Details:'}</span>
          </div>
          {isDeactivating ? (
            <ul className="list-disc pl-4 space-y-1 text-[11px] leading-normal">
              <li>Database access is blocked immediately across all features.</li>
              <li>Future login attempts and token refresh will be strictly blocked.</li>
              <li>Existing sessions cannot be refreshed once expired.</li>
              <li>Historical attendance logs, check-ins, and assignments are permanently preserved.</li>
            </ul>
          ) : (
            <p className="text-[11px] leading-normal">
              Once reactivated, the staff member will immediately be permitted to sign in again using their existing credentials.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default StaffStatusModal;
