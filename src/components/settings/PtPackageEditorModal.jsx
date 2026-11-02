import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Input, Textarea } from '../ui/Input';
import { Button } from '../ui/Button';
import { Dumbbell, AlertCircle, Loader2, Sparkles, Check, Clock } from 'lucide-react';

/**
 * PtPackageEditorModal
 *
 * Reusable modal for creating new personal training packages and editing existing ones.
 * Interacts with Supabase public.pt_packages via the onSave handler in Settings.jsx.
 *
 * @param {boolean} isOpen
 * @param {() => void} onClose
 * @param {object|null} pkg - If null: Create mode. If object: Edit mode.
 * @param {(pkgData: object, pkgId?: string) => Promise<{ success: boolean, error?: string }>} onSave
 */
export function PtPackageEditorModal({ isOpen, onClose, pkg = null, onSave }) {
  const isEditMode = Boolean(pkg && pkg.id);

  const [formData, setFormData] = useState({
    name: '',
    total_sessions: '',
    price: '',
    validity_days: '30',
    description: '',
  });

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (pkg) {
        setFormData({
          name: pkg.name || '',
          total_sessions: String(pkg.totalSessions ?? pkg.total_sessions ?? pkg.sessions ?? ''),
          price: String(pkg.price ?? ''),
          validity_days: String(pkg.validityDays ?? pkg.validity_days ?? pkg.validity ?? 30),
          description: pkg.description || '',
        });
      } else {
        setFormData({
          name: '',
          total_sessions: '',
          price: '',
          validity_days: '30',
          description: '',
        });
      }
      setErrors({});
      setServerError(null);
      setIsSubmitting(false);
    }
  }, [isOpen, pkg]);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    setServerError(null);
  };

  const validate = () => {
    const newErrors = {};

    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      newErrors.name = 'Package name is required.';
    }

    const numSessions = Number(formData.total_sessions);
    if (!formData.total_sessions || isNaN(numSessions)) {
      newErrors.total_sessions = 'Total session count is required.';
    } else if (!Number.isInteger(numSessions) || numSessions <= 0) {
      newErrors.total_sessions = 'Total sessions must be a positive whole number.';
    }

    const numPrice = Number(formData.price);
    if (formData.price === '' || isNaN(numPrice)) {
      newErrors.price = 'Package price is required.';
    } else if (numPrice < 0) {
      newErrors.price = 'Price cannot be negative.';
    }

    const numValidity = Number(formData.validity_days);
    if (!formData.validity_days || isNaN(numValidity)) {
      newErrors.validity_days = 'Validity days is required.';
    } else if (!Number.isInteger(numValidity) || numValidity <= 0) {
      newErrors.validity_days = 'Validity must be a positive whole number of days.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!validate()) return;

    setIsSubmitting(true);
    setServerError(null);

    const payload = {
      name: formData.name.trim(),
      total_sessions: Number(formData.total_sessions),
      price: Number(formData.price),
      validity_days: Number(formData.validity_days),
      description: formData.description.trim() || '',
    };

    try {
      const result = await onSave(payload, isEditMode ? pkg.id : undefined);
      if (result && result.error) {
        setServerError(result.error);
        setIsSubmitting(false);
      } else {
        onClose();
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed to save PT package. Please try again.');
      setIsSubmitting(false);
    }
  };

  const sessionsNum = Number(formData.total_sessions);
  const priceNum = Number(formData.price);
  const pricePerSession = sessionsNum > 0 && priceNum >= 0 ? Math.round(priceNum / sessionsNum) : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={isSubmitting ? () => {} : onClose}
      title={isEditMode ? `Edit PT Package: ${pkg?.name || ''}` : 'Configure New PT Package'}
      size="md"
      footer={
        <div className="flex items-center justify-end gap-3 w-full">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            icon={isSubmitting ? Loader2 : isEditMode ? Check : Sparkles}
            className={isSubmitting ? '[&>svg]:animate-spin' : ''}
          >
            {isSubmitting
              ? isEditMode ? 'Saving Changes...' : 'Creating Package...'
              : isEditMode ? 'Save Changes' : 'Create Package'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Error Banner */}
        {serverError && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#FEF3F2] border border-[#FECDCA] text-xs text-[#B42318]">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-[#B42318]" />
            <div className="space-y-0.5">
              <p className="font-semibold">Unable to save PT package</p>
              <p className="text-[11px] leading-relaxed text-[#7A271A]">{serverError}</p>
            </div>
          </div>
        )}

        {/* Package Name */}
        <Input
          label="Package Name *"
          placeholder="e.g., 8 Sessions, 12 Sessions, Transformation 20"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          error={errors.name}
          disabled={isSubmitting}
          helperText="Unique identifier displayed across member assignments and receipt logs."
        />

        {/* Sessions & Price Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Total Sessions *"
            type="number"
            min="1"
            step="1"
            placeholder="e.g., 8, 12, 20"
            value={formData.total_sessions}
            onChange={(e) => handleChange('total_sessions', e.target.value)}
            error={errors.total_sessions}
            disabled={isSubmitting}
            icon={Dumbbell}
            helperText="One-on-one training sessions."
          />

          <Input
            label="Package Price (₹) *"
            type="number"
            min="0"
            step="50"
            placeholder="e.g., 4000, 5500"
            value={formData.price}
            onChange={(e) => handleChange('price', e.target.value)}
            error={errors.price}
            disabled={isSubmitting}
            helperText="Total fee charged for the tier."
          />
        </div>

        {/* Validity Days */}
        <Input
          label="Validity Duration (Days) *"
          type="number"
          min="1"
          step="1"
          placeholder="e.g., 30, 45, 60"
          value={formData.validity_days}
          onChange={(e) => handleChange('validity_days', e.target.value)}
          error={errors.validity_days}
          disabled={isSubmitting}
          icon={Clock}
          helperText="Maximum allowed days to complete assigned sessions from start date."
        />

        {/* Live Calculation Preview Banner */}
        {pricePerSession !== null && (
          <div className="p-3 rounded-xl bg-[#F8FAFB] border border-[#E1E6E9] text-xs flex items-center justify-between">
            <span className="text-[#64717B]">Per-Session Rate Breakdown:</span>
            <span className="font-bold text-[#16845B]">₹{pricePerSession.toLocaleString()} / session</span>
          </div>
        )}

        {/* Description */}
        <Textarea
          label="Description / Special Instructions"
          placeholder="e.g., Strength and conditioning with dedicated nutrition assessment."
          value={formData.description}
          onChange={(e) => handleChange('description', e.target.value)}
          rows={3}
          disabled={isSubmitting}
        />
      </form>
    </Modal>
  );
}

