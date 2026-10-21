import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input, Select, Textarea } from '../ui/Input';
import { isValidIndianPhone, isValidEmail } from '../../utils/memberUtils';
import { UserCheck, Phone, Mail, MapPin, User, Calendar } from 'lucide-react';

export function EditMemberModal({
  isOpen,
  onClose,
  member,
  onSuccess,
}) {
  const { updateMember } = useApp();

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    gender: 'Male',
    dob: '',
    address: '',
    notes: '',
  });

  const [formErrors, setFormErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (member && isOpen) {
      setFormData({
        name: member.name || '',
        phone: member.phone || '',
        email: member.email || '',
        gender: member.gender || 'Male',
        dob: member.dob || '',
        address: member.address || '',
        notes: member.notes || '',
      });
      setFormErrors({});
      setIsSaving(false);
    }
  }, [member, isOpen]);

  const validate = () => {
    const errors = {};
    if (!formData.name.trim()) {
      errors.name = 'Full name is required';
    }

    if (!formData.phone.trim()) {
      errors.phone = 'Phone number is required';
    } else if (!isValidIndianPhone(formData.phone)) {
      errors.phone = 'Enter a valid 10-digit Indian mobile number';
    }

    if (formData.email.trim() && !isValidEmail(formData.email)) {
      errors.email = 'Enter a valid email address';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (isSaving) return;
    if (!validate()) return;

    setIsSaving(true);
    try {
      const updates = {
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim(),
        gender: formData.gender,
        dob: formData.dob,
        address: formData.address.trim(),
        notes: formData.notes.trim(),
      };

      updateMember(member.id, updates);

      if (onSuccess) {
        onSuccess(updates);
      }
      onClose();
    } catch (err) {
      console.error('Failed to update member:', err);
      setFormErrors({ general: 'Failed to update member details. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !member) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={isSaving ? undefined : onClose}
      title="Edit Member Information"
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            icon={UserCheck}
            onClick={handleSubmit}
            disabled={isSaving}
            className="bg-[#16845B] hover:bg-[#126b49] text-white shadow-xs font-semibold"
          >
            {isSaving ? 'Saving Changes...' : 'Save Member Details'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {formErrors.general && (
          <div className="p-3 rounded-xl bg-[#FEE4E2] border border-[#B42318]/30 text-xs text-[#B42318] font-medium">
            {formErrors.general}
          </div>
        )}

        {/* Member Reference Header */}
        <div className="p-3 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] flex items-center justify-between text-xs text-[#64717B]">
          <span className="font-mono font-medium">Member ID: <strong className="text-[#25313B]">{member.id}</strong></span>
          <span>Current Plan: <strong className="text-[#16845B]">{member.plan}</strong></span>
          <span>Joined: <strong>{member.joinDate || member.startDate}</strong></span>
        </div>

        {/* Primary Contact Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Full Name *"
            icon={User}
            placeholder="e.g. Rahul Sharma"
            value={formData.name}
            onChange={(e) => {
              setFormData({ ...formData, name: e.target.value });
              setFormErrors(prev => ({ ...prev, name: undefined }));
            }}
            error={formErrors.name}
            autoFocus
          />

          <Input
            label="Phone Number (10 digits) *"
            icon={Phone}
            placeholder="10-digit mobile number"
            value={formData.phone}
            onChange={(e) => {
              setFormData({ ...formData, phone: e.target.value });
              setFormErrors(prev => ({ ...prev, phone: undefined }));
            }}
            error={formErrors.phone}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input
            label="Email Address"
            type="email"
            icon={Mail}
            placeholder="name@email.com"
            value={formData.email}
            onChange={(e) => {
              setFormData({ ...formData, email: e.target.value });
              setFormErrors(prev => ({ ...prev, email: undefined }));
            }}
            error={formErrors.email}
          />

          <Select
            label="Gender"
            value={formData.gender}
            onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
            options={[
              { value: 'Male', label: 'Male' },
              { value: 'Female', label: 'Female' },
              { value: 'Other', label: 'Other' },
            ]}
          />

          <Input
            label="Date of Birth"
            type="date"
            value={formData.dob}
            onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
          />
        </div>

        {/* Address Field */}
        <Input
          label="Residential Address"
          icon={MapPin}
          placeholder="e.g. Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra"
          value={formData.address}
          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
        />

        {/* Member Notes */}
        <Textarea
          label="Member Notes & Preferences"
          rows={3}
          placeholder="e.g. Prefers morning workouts, medical considerations, locker assigned..."
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
        />
      </form>
    </Modal>
  );
}
