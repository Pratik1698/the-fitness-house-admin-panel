import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Input, Textarea } from '../ui/Input';
import { Button } from '../ui/Button';
import { CreditCard, Calendar, AlertCircle, Loader2, Sparkles, Check, Info } from 'lucide-react';

/**
 * PlanEditorModal
 *
 * Reusable modal for creating new membership plans and editing existing ones.
 * Interacts with Supabase via the onSave handler provided by Settings.jsx.
 *
 * @param {boolean} isOpen
 * @param {() => void} onClose
 * @param {object|null} plan - If null: Create mode. If object: Edit mode.
 * @param {(planData: object, planId?: string) => Promise<{ success: boolean, error?: string }>} onSave
 */
export function PlanEditorModal({ isOpen, onClose, plan = null, onSave }) {
  const isEditMode = Boolean(plan && plan.id);

  const [formData, setFormData] = useState({
    name: '',
    duration_days: '',
    price: '',
    description: '',
  });

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync form state when modal opens or target plan changes
  useEffect(() => {
    if (isOpen) {
      if (plan) {
        setFormData({
          name: plan.name || '',
          duration_days: String(plan.duration_days ?? plan.duration ?? ''),
          price: String(plan.price ?? ''),
          description: plan.description || '',
        });
      } else {
        setFormData({
          name: '',
          duration_days: '',
          price: '',
          description: '',
        });
      }
      setErrors({});
      setServerError(null);
      setIsSubmitting(false);
    }
  }, [isOpen, plan]);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear validation error when field is modified
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
      newErrors.name = 'Plan name is required.';
    }

    const numDuration = Number(formData.duration_days);
    if (!formData.duration_days || isNaN(numDuration)) {
      newErrors.duration_days = 'Duration is required.';
    } else if (!Number.isInteger(numDuration) || numDuration <= 0) {
      newErrors.duration_days = 'Duration must be a positive whole number of days.';
    }

    const numPrice = Number(formData.price);
    if (formData.price === '' || isNaN(numPrice)) {
      newErrors.price = 'Price is required.';
    } else if (numPrice < 0) {
      newErrors.price = 'Price cannot be negative.';
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
      duration_days: Number(formData.duration_days),
      price: Number(formData.price),
      description: formData.description.trim() || '',
    };

    try {
      const result = await onSave(payload, isEditMode ? plan.id : undefined);
      if (result && result.error) {
        setServerError(result.error);
        setIsSubmitting(false);
      } else {
        onClose();
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed to save plan. Please try again.');
      setIsSubmitting(false);
    }
  };

  // Derived calculations for preview
  const durationNum = Number(formData.duration_days);
  const priceNum = Number(formData.price);
  const pricePerDay = durationNum > 0 && priceNum >= 0 ? Math.round(priceNum / durationNum) : null;
  const qualifiesForFreeze = durationNum >= 180;

  return (
    <Modal
      isOpen={isOpen}
      onClose={isSubmitting ? () => {} : onClose}
      title={isEditMode ? `Edit Plan: ${plan?.name || ''}` : 'Configure New Membership Plan'}
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
              ? isEditMode ? 'Saving Changes...' : 'Creating Plan...'
              : isEditMode ? 'Save Changes' : 'Create Plan'}
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
              <p className="font-semibold">Unable to save membership plan</p>
              <p className="text-[11px] leading-relaxed text-[#7A271A]">{serverError}</p>
            </div>
          </div>
        )}

        {/* Plan Name */}
        <Input
          label="Plan Name *"
          placeholder="e.g., Monthly, Quarterly, Annual VIP"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          error={errors.name}
          disabled={isSubmitting}
          autoFocus
        />

        {/* Duration & Price Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Duration (Days) *"
            type="number"
            min="1"
            step="1"
            placeholder="e.g., 30, 90, 180, 365"
            value={formData.duration_days}
            onChange={(e) => handleChange('duration_days', e.target.value)}
            error={errors.duration_days}
            icon={Calendar}
            disabled={isSubmitting}
          />

          <Input
            label="Standard Price (₹) *"
            type="number"
            min="0"
            step="any"
            placeholder="e.g., 700, 2000, 8000"
            value={formData.price}
            onChange={(e) => handleChange('price', e.target.value)}
            error={errors.price}
            icon={CreditCard}
            disabled={isSubmitting}
          />
        </div>

        {/* Description */}
        <Textarea
          label="Description / Inclusions (Optional)"
          placeholder="e.g., Full gym access, locker facility, free diet consultation..."
          value={formData.description}
          onChange={(e) => handleChange('description', e.target.value)}
          rows={3}
          disabled={isSubmitting}
        />

        {/* Policy & Pricing Calculation Preview */}
        {durationNum > 0 && priceNum >= 0 && (
          <div className="p-3 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] space-y-1.5 text-xs text-[#64717B]">
            <div className="flex items-center justify-between">
              <span className="font-medium">Effective Daily Rate:</span>
              <span className="font-semibold text-[#16845B]">
                {pricePerDay !== null ? `₹${pricePerDay} / day` : '—'}
              </span>
            </div>
            <div className="flex items-start gap-1.5 pt-1 text-[11px] text-[#64717B] border-t border-[#E1E6E9]">
              <Info size={13} className="shrink-0 mt-0.5 text-[#16845B]" />
              <span>
                {qualifiesForFreeze
                  ? 'Policy rule: Members on this 180+ day plan automatically receive up to 15 days freeze privilege.'
                  : 'Policy rule: Plans under 180 days do not include freeze privileges.'}
              </span>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}

