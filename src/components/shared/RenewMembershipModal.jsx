import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input, Select, Textarea } from '../ui/Input';
import { StatusBadge } from '../ui/Badge';
import {
  RotateCw, IndianRupee,
  AlertTriangle, CheckCircle2, Clock, AlertCircle, RefreshCw
} from 'lucide-react';

function calculateExpiry(startStr, durationDays) {
  if (!startStr) return '';
  const d = new Date(startStr);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + Number(durationDays));
  return d.toISOString().split('T')[0];
}

export function RenewMembershipModal({
  isOpen,
  onClose,
  member,
  onSuccess,
}) {
  const { renewMember, membershipPlans, plansLoading, plansError, reloadPlans } = useApp();

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Form State
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [startDate, setStartDate] = useState(todayStr);
  const [amountPaid, setAmountPaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [notes, setNotes] = useState('');
  const [includePreviousBalance, setIncludePreviousBalance] = useState(true);
  const [formErrors, setFormErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Fresh UUID idempotency key per logical renewal attempt
  const [idempotencyKey, setIdempotencyKey] = useState(() => (
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `IDEMP-RENEW-${Date.now()}`
  ));

  // Initialize and prepopulate form when member changes or modal opens
  useEffect(() => {
    if (member && isOpen) {
      setIdempotencyKey(
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `IDEMP-RENEW-${Date.now()}`
      );
      // 1. Plan selection: match member's current plan ID or name against active database plans
      const matchingPlan = membershipPlans.find(
        p => p.id === member.planId || (member.plan && p.name.toLowerCase() === member.plan.toLowerCase())
      );
      const planId = matchingPlan?.id || membershipPlans[0]?.id || '';
      setSelectedPlanId(planId);

      // 2. Start Date Rule:
      // If member is still ACTIVE (expiry date >= today), renew from current expiry date so remaining days aren't lost!
      // If member is EXPIRED (expiry date < today), start renewal from today!
      const isStillActive = member.status === 'active' && member.expiryDate && member.expiryDate >= todayStr;
      const initialStart = isStillActive ? member.expiryDate : todayStr;
      setStartDate(initialStart);

      // 3. Amount prefill: plan price + previous balance (if applicable)
      const planObj = matchingPlan || membershipPlans.find(p => p.id === planId) || membershipPlans[0];
      const prevBal = member.balance > 0 ? member.balance : 0;
      const initialTotal = (planObj?.price || 0) + prevBal;
      setAmountPaid(String(initialTotal));

      setIncludePreviousBalance(prevBal > 0);
      setPaymentMethod('UPI');
      setNotes('');
      setFormErrors({});
      setSubmitError(null);
      setIsSaving(false);
    }
  }, [member, isOpen, todayStr, membershipPlans]);

  // Derived plan & fee calculations
  const selectedPlan = useMemo(() => {
    if (!membershipPlans || membershipPlans.length === 0) return null;
    return membershipPlans.find(p => p.id === selectedPlanId) || membershipPlans[0] || null;
  }, [membershipPlans, selectedPlanId]);

  const planFee = selectedPlan?.price || 0;
  const hasPreviousBalance = Boolean(member && member.balance > 0);
  const previousBalance = hasPreviousBalance ? member.balance : 0;

  // Invoice total due for this renewal transaction:
  // Includes previous balance only when "Settle previous outstanding balance" is checked
  const previousBalanceToSettle = includePreviousBalance ? previousBalance : 0;
  const totalAmountDue = planFee + previousBalanceToSettle;

  // New expiry date calculation
  const newExpiryDate = useMemo(() => {
    if (!selectedPlan) return '';
    return calculateExpiry(startDate, selectedPlan.duration);
  }, [startDate, selectedPlan]);

  // Numerical amount and remaining balance calculations
  const parsedAmountPaid = amountPaid === '' ? 0 : parseFloat(amountPaid) || 0;

  // Unpaid balance on this specific renewal invoice
  const renewalUnpaid = Math.max(0, totalAmountDue - parsedAmountPaid);

  // Total remaining balance on the member's account after this transaction:
  // If settling previous balance: remaining balance is simply renewalUnpaid
  // If NOT settling previous balance: renewalUnpaid + unsettled previous balance
  const totalRemainingBalance = includePreviousBalance
    ? renewalUnpaid
    : renewalUnpaid + previousBalance;

  // Handle plan change and update default amount paid
  const handlePlanChange = (newPlanId) => {
    setSelectedPlanId(newPlanId);
    const newPlan = membershipPlans.find(p => p.id === newPlanId) || membershipPlans[0];
    if (!newPlan) return;
    const newTotal = newPlan.price + (includePreviousBalance && member?.balance > 0 ? member.balance : 0);
    setAmountPaid(String(newTotal));
    setFormErrors(prev => ({ ...prev, planId: undefined, amountPaid: undefined }));
  };

  // Handle previous balance toggle
  const handleTogglePreviousBalance = (checked) => {
    setIncludePreviousBalance(checked);
    const newTotal = planFee + (checked && member?.balance > 0 ? member.balance : 0);
    setAmountPaid(String(newTotal));
    setFormErrors(prev => ({ ...prev, amountPaid: undefined }));
  };

  // Form Validation
  const validate = () => {
    const errors = {};

    if (!member) {
      errors.general = 'No member selected.';
    }

    if (!selectedPlan) {
      errors.planId = 'Please select a membership plan.';
    }

    if (!startDate) {
      errors.startDate = 'Renewal start date is required.';
    } else {
      const d = new Date(startDate);
      if (isNaN(d.getTime())) {
        errors.startDate = 'Please enter a valid start date.';
      }
    }

    if (amountPaid === '' || amountPaid === null || isNaN(Number(amountPaid))) {
      errors.amountPaid = 'Please enter a valid payment amount.';
    } else if (parsedAmountPaid < 0) {
      errors.amountPaid = 'Payment amount cannot be negative.';
    } else if (parsedAmountPaid > totalAmountDue) {
      errors.amountPaid = `Payment cannot exceed total amount due of ₹${totalAmountDue.toLocaleString('en-IN')}.`;
    }

    if (!paymentMethod || paymentMethod.trim() === '') {
      errors.paymentMethod = 'Please select a payment method.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle submission with double-click guard and error handling
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();

    // Guard against repeated double clicks
    if (isSaving) return;

    if (!validate()) return;

    setIsSaving(true);
    setSubmitError(null);

    try {
      // Diagnostic test hook: if notes include '[fail]', simulate network failure
      if (notes.includes('[fail]')) {
        throw new Error('Payment processing simulation failed: Network request timed out.');
      }

      const renewalResult = await renewMember({
        memberId: member.id,
        planId: selectedPlan.id,
        planName: selectedPlan.name,
        startDate: startDate,
        expiryDate: newExpiryDate,
        planFee: planFee,
        previousBalance: previousBalance,
        settlePreviousBalance: includePreviousBalance,
        amountPaid: parsedAmountPaid,
        paymentMethod: paymentMethod,
        notes: notes.trim(),
        idempotencyKey: idempotencyKey,
      });

      // Show success only after update succeeds
      if (onSuccess) {
        onSuccess({
          memberId: member.id,
          memberName: member.name,
          planName: selectedPlan.name,
          newExpiryDate: renewalResult?.expiry_date || newExpiryDate,
          amountPaid: parsedAmountPaid,
          remainingBalance: renewalResult?.outstanding_balance ?? totalRemainingBalance,
          receiptNumber: renewalResult?.receipt_number || null,
        });
      }

      onClose();
    } catch (err) {
      console.error('Renewal submission failed:', err);
      // Preserve form values and display error banner
      setSubmitError(err.message || 'Failed to complete renewal. Please review the details and try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !member) return null;

  const isExpired = member.status === 'expired' || (member.expiryDate && member.expiryDate < todayStr);

  return (
    <Modal
      isOpen={isOpen}
      onClose={isSaving ? undefined : onClose}
      title="Renew Membership"
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
            icon={RotateCw}
            onClick={handleSubmit}
            disabled={isSaving || plansLoading || !selectedPlan}
            className="bg-[#16845B] hover:bg-[#126b49] text-white shadow-xs font-semibold"
          >
            {isSaving
              ? 'Processing Renewal...'
              : `Confirm Renewal (₹${parsedAmountPaid.toLocaleString('en-IN')})`}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4.5">
        {/* Saving Error Alert */}
        {submitError && (
          <div className="p-3.5 rounded-xl bg-[#FEE4E2] border border-[#B42318]/30 text-xs text-[#B42318] flex items-start gap-2.5 font-medium animate-fadeIn">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-[#B42318]" />
            <div className="space-y-0.5">
              <span className="font-bold block">Renewal Failed</span>
              <span>{submitError} Form values have been preserved.</span>
            </div>
          </div>
        )}

        {/* General Form Error Alert */}
        {formErrors.general && (
          <div className="p-3 rounded-xl bg-[#FEE4E2] border border-[#B42318]/30 text-xs text-[#B42318] flex items-center gap-2 font-medium">
            <AlertTriangle size={15} className="shrink-0" />
            <span>{formErrors.general}</span>
          </div>
        )}

        {/* Prepopulated Member Summary Header */}
        <div className="p-3.5 rounded-xl border border-[#E1E6E9] bg-[#F5F7F8] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-white border border-[#E1E6E9] flex items-center justify-center font-bold text-sm text-[#16845B] shrink-0 shadow-xs">
              {member.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-[#25313B] truncate">{member.name}</span>
                <span className="text-xs font-mono text-[#64717B] bg-white px-1.5 py-0.5 rounded border border-[#E1E6E9]">
                  {member.member_code || member.id}
                </span>
                <StatusBadge status={isExpired ? 'expired' : 'active'} />
              </div>
              <p className="text-xs text-[#64717B] mt-0.5">
                Current Plan: <strong>{member.plan}</strong> · Expiry: <strong>{member.expiryDate}</strong>
              </p>
            </div>
          </div>

          {hasPreviousBalance && (
            <div className="px-3 py-1.5 rounded-lg bg-[#FFF2D8] border border-[#A66A00]/25 text-[#A66A00] text-xs font-semibold shrink-0">
              Outstanding Due: ₹{previousBalance.toLocaleString('en-IN')}
            </div>
          )}
        </div>

        {/* Plans Error Alert */}
        {plansError && (
          <div className="p-3.5 rounded-xl bg-[#FEE4E2] border border-[#B42318]/30 text-xs text-[#B42318] flex items-center justify-between gap-2.5 font-medium">
            <span>Failed to load plans from database: {plansError}</span>
            <button
              type="button"
              onClick={reloadPlans}
              className="px-2 py-1 rounded bg-[#B42318] text-white text-[11px] font-semibold hover:bg-[#911d13] cursor-pointer flex items-center gap-1 shrink-0"
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        )}

        {/* Form Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Plan Selection */}
          <Select
            label="Select Renewal Plan *"
            value={selectedPlanId}
            onChange={(e) => handlePlanChange(e.target.value)}
            disabled={plansLoading || membershipPlans.length === 0}
            error={formErrors.planId}
            options={
              membershipPlans.length > 0
                ? membershipPlans.map(p => ({
                    value: p.id,
                    label: `${p.name} (${p.duration} days) — ₹${p.price.toLocaleString('en-IN')}`
                  }))
                : [{ value: '', label: plansLoading ? 'Loading plans...' : 'No active plans found' }]
            }
          />

          {/* Renewal Start Date */}
          <Input
            label="Renewal Start Date *"
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setFormErrors(prev => ({ ...prev, startDate: undefined }));
            }}
            error={formErrors.startDate}
          />
        </div>

        {/* Expiry Rule Information Box */}
        <div className="p-3 rounded-xl bg-[#E8F5EE]/60 border border-[#16845B]/20 text-xs text-[#16845B] flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Clock size={15} className="shrink-0" />
            <span>
              New validity: <strong>{startDate}</strong> to <strong>{newExpiryDate}</strong> {selectedPlan ? `(${selectedPlan.duration} days)` : ''}
            </span>
          </div>
          <span className="text-[11px] font-medium text-[#64717B]">
            {isExpired ? '• Starting from today (membership expired)' : '• Continues smoothly from previous expiry (preserves remaining validity)'}
          </span>
        </div>

        {/* Outstanding Balance Carried Over Checkbox */}
        {hasPreviousBalance && (
          <div className="p-3 rounded-xl border border-[#A66A00]/20 bg-[#FFF2D8]/40 flex items-center justify-between gap-3">
            <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-[#25313B]">
              <input
                type="checkbox"
                checked={includePreviousBalance}
                onChange={(e) => handleTogglePreviousBalance(e.target.checked)}
                className="w-4 h-4 text-[#16845B] rounded border-[#E1E6E9] focus:ring-[#16845B]"
              />
              <span>Settle previous outstanding balance of ₹{previousBalance.toLocaleString('en-IN')} now</span>
            </label>
            <span className="text-xs font-bold text-[#A66A00]">
              {includePreviousBalance ? `+₹${previousBalance.toLocaleString('en-IN')}` : `₹${previousBalance.toLocaleString('en-IN')} (Carried over)`}
            </span>
          </div>
        )}

        {/* Payment Amount & Method Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Amount Received (₹) *"
            type="number"
            min="0"
            step="1"
            value={amountPaid}
            onChange={(e) => {
              setAmountPaid(e.target.value);
              setFormErrors(prev => ({ ...prev, amountPaid: undefined }));
            }}
            error={formErrors.amountPaid}
            placeholder="Enter payment received"
            icon={IndianRupee}
          />

          <Select
            label="Payment Method *"
            value={paymentMethod}
            onChange={(e) => {
              setPaymentMethod(e.target.value);
              setFormErrors(prev => ({ ...prev, paymentMethod: undefined }));
            }}
            error={formErrors.paymentMethod}
            options={[
              { value: '', label: 'Select payment method' },
              { value: 'UPI', label: 'UPI / QR Code' },
              { value: 'Cash', label: 'Cash' },
              { value: 'Card', label: 'Debit / Credit Card' },
              { value: 'Bank Transfer', label: 'Bank Transfer' },
            ]}
          />
        </div>

        {/* Optional Payment Note */}
        <Textarea
          label="Payment Note / Receipt Reference"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Paid via GooglePay, transaction reference, desk receipt..."
        />

        {/* Fee Summary Card */}
        <div className="p-4 rounded-xl border border-[#E1E6E9] bg-[#F5F7F8] space-y-2.5">
          <p className="text-xs font-bold text-[#25313B] uppercase tracking-wider">
            Renewal Fee Breakdown
          </p>

          <div className="space-y-1.5 text-xs">
            {/* 1. New Renewal Plan Fee */}
            <div className="flex items-center justify-between text-[#64717B]">
              <span>New Plan Fee ({selectedPlan.name} · {selectedPlan.duration} Days)</span>
              <span className="font-semibold text-[#25313B]">₹{planFee.toLocaleString('en-IN')}</span>
            </div>

            {/* 2. Previous Balance (Separately Displayed) */}
            {hasPreviousBalance && (
              <div className="flex items-center justify-between text-[#64717B]">
                <span>
                  {includePreviousBalance
                    ? 'Previous Outstanding Balance (Settling now)'
                    : 'Previous Outstanding Balance (Carried over - Unsettled)'}
                </span>
                <span className={`font-semibold ${includePreviousBalance ? 'text-[#A66A00]' : 'text-[#64717B]'}`}>
                  {includePreviousBalance
                    ? `+₹${previousBalance.toLocaleString('en-IN')}`
                    : `₹${previousBalance.toLocaleString('en-IN')} (Carried Over)`}
                </span>
              </div>
            )}

            {/* 3. Total Amount Due for this transaction */}
            <div className="flex items-center justify-between text-xs font-bold text-[#25313B] pt-1.5 border-t border-[#E1E6E9]">
              <span>Total Amount Due (This Transaction)</span>
              <span>₹{totalAmountDue.toLocaleString('en-IN')}</span>
            </div>

            {/* 4. Amount Received */}
            <div className="flex items-center justify-between text-xs text-[#16845B] font-semibold">
              <span>Amount Received ({paymentMethod || 'Payment'})</span>
              <span>₹{parsedAmountPaid.toLocaleString('en-IN')}</span>
            </div>

            {/* 5. Remaining Account Balance Status */}
            <div className="flex items-center justify-between text-xs pt-1.5 border-t border-[#E1E6E9]">
              <span className="font-semibold text-[#25313B]">Remaining Account Balance</span>
              {totalRemainingBalance === 0 ? (
                <span className="font-bold text-[#16845B] flex items-center gap-1">
                  <CheckCircle2 size={13} /> Fully Paid (₹0 Due)
                </span>
              ) : parsedAmountPaid < totalAmountDue ? (
                <span className="font-bold text-[#A66A00] flex items-center gap-1">
                  <AlertTriangle size={13} /> Partial Payment — ₹{totalRemainingBalance.toLocaleString('en-IN')} Due
                </span>
              ) : (
                <span className="font-bold text-[#A66A00] flex items-center gap-1">
                  <AlertTriangle size={13} /> Balance Due — ₹{totalRemainingBalance.toLocaleString('en-IN')} (Previous Dues Remain)
                </span>
              )}
            </div>

            {/* 6. Membership Expiry Date */}
            <div className="flex items-center justify-between text-xs pt-1.5 border-t border-[#E1E6E9]">
              <span className="text-[#64717B]">New Membership Expiry Date</span>
              <span className="font-bold text-[#25313B]">{newExpiryDate}</span>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
