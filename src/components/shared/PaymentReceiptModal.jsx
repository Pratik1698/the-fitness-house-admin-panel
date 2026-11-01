import { useRef } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge, StatusBadge } from '../ui/Badge';
import { Printer, CheckCircle2, ShieldCheck, Dumbbell } from 'lucide-react';
import { formatINR, getPaymentPurpose, DEFAULT_GYM_PHONE, CANONICAL_GYM_CONTACT } from '../../utils/memberUtils';
import { useApp } from '../../context/AppContext';

export function PaymentReceiptModal({ isOpen, onClose, payment, member }) {
  if (!payment) return null;

  const { gymInfo } = useApp();
  const purpose = getPaymentPurpose(payment);
  const remainingBal = member ? member.balance : 0;

  const gymName = gymInfo?.name || 'THE FITNESS HOUSE';
  const gymTagline = gymInfo?.tagline || 'Arag Gym & Fitness Center';
  const gymAddress = gymInfo?.address || CANONICAL_GYM_CONTACT.address;
  const gymPhone = gymInfo?.phone || DEFAULT_GYM_PHONE;
  const gymEmail = gymInfo?.email || CANONICAL_GYM_CONTACT.email;

  const handlePrint = () => {
    window.print();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Payment Receipt Preview"
      size="md"
      footer={
        <div className="flex items-center justify-between w-full no-print">
          <p className="text-xs text-[#64717B]">Receipt #{payment.id}</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button icon={Printer} onClick={handlePrint}>
              Print Receipt
            </Button>
          </div>
        </div>
      }
    >
      {/* Printable Receipt Container */}
      <div
        id="printable-receipt"
        className="bg-white rounded-2xl border border-[#E1E6E9] p-6 text-[#25313B] space-y-5 shadow-xs"
      >
        {/* Gym Header */}
        <div className="border-b border-[#E1E6E9] pb-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#16845B] text-white flex items-center justify-center font-bold text-base">
                <Dumbbell size={18} />
              </div>
              <div>
                <h3 className="text-lg font-black tracking-tight text-[#16845B]">
                  {gymName}
                </h3>
                <p className="text-[11px] font-medium text-[#64717B] -mt-0.5">
                  {gymTagline}
                </p>
              </div>
            </div>
            <p className="text-xs text-[#64717B] mt-2">
              {gymAddress}
            </p>
            <p className="text-xs text-[#64717B]">
              Helpline: {gymPhone} • Email: {gymEmail}
            </p>
          </div>

          <div className="text-right">
            <span className="inline-block px-2.5 py-1 rounded-md bg-[#F5F7F8] border border-[#E1E6E9] text-xs font-mono font-bold text-[#25313B]">
              {payment.id}
            </span>
            <p className="text-xs text-[#64717B] mt-1.5">
              Date: <span className="font-semibold text-[#25313B]">{payment.date}</span>
            </p>
            <div className="mt-1">
              <StatusBadge status={payment.status || 'completed'} />
            </div>
          </div>
        </div>

        {/* Member Details */}
        <div className="bg-[#F5F7F8] rounded-xl p-4 border border-[#E1E6E9] grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-[#64717B] uppercase font-semibold text-[10px] tracking-wider">
              Billed To
            </p>
            <p className="text-sm font-bold text-[#25313B] mt-0.5">
              {payment.memberName}
            </p>
            <p className="text-xs text-[#64717B] font-mono mt-0.5">
              Member ID: {payment.memberCode || member?.member_code || payment.memberId || 'N/A'}
            </p>
            {member?.phone && (
              <p className="text-xs text-[#64717B] mt-0.5">
                Phone: +91 {member.phone}
              </p>
            )}
          </div>
          <div className="text-right sm:text-left">
            <p className="text-[#64717B] uppercase font-semibold text-[10px] tracking-wider">
              Membership Info
            </p>
            <p className="text-sm font-semibold text-[#25313B] mt-0.5">
              {payment.relatedPlan || member?.plan || 'General Membership'}
            </p>
            {member?.expiryDate && (
              <p className="text-xs text-[#64717B] mt-0.5">
                Valid Till: <span className="font-medium text-[#25313B]">{member.expiryDate}</span>
              </p>
            )}
            <p className="text-xs text-[#64717B] mt-0.5">
              Payment Mode: <span className="font-semibold text-[#16845B]">{payment.method}</span>
            </p>
          </div>
        </div>

        {/* Payment Line Items */}
        <div className="border border-[#E1E6E9] rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[#F5F7F8] border-b border-[#E1E6E9] text-[#64717B] uppercase font-semibold">
              <tr>
                <th className="px-4 py-2.5 text-left">Description / Purpose</th>
                <th className="px-4 py-2.5 text-center">Mode</th>
                <th className="px-4 py-2.5 text-right">Amount (INR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E6E9]">
              <tr>
                <td className="px-4 py-3">
                  <p className="font-semibold text-sm text-[#25313B]">{purpose}</p>
                  {payment.notes && (
                    <p className="text-xs text-[#64717B] mt-0.5">{payment.notes}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-center text-[#64717B]">
                  <span className="px-2 py-0.5 rounded-md bg-[#F5F7F8] border border-[#E1E6E9] font-medium">
                    {payment.method}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-bold text-sm text-[#25313B] tabular-nums">
                  {formatINR(payment.amount)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Totals & Remaining Balance */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div className="text-xs text-[#64717B] space-y-1">
            <div className="flex items-center gap-1.5 text-[#16845B]">
              <ShieldCheck size={15} />
              <span className="font-medium">Verified Payment Transaction</span>
            </div>
            <p className="text-[11px] text-[#64717B]">
              Receipt generated on {payment.date}. Preserved in Gym Ledger.
            </p>
          </div>

          <div className="bg-[#F5F7F8] border border-[#E1E6E9] rounded-xl p-3 sm:min-w-64 space-y-1.5 text-right">
            <div className="flex justify-between text-xs text-[#64717B]">
              <span>Amount Received:</span>
              <span className="font-bold text-[#16845B] text-sm tabular-nums">
                {formatINR(payment.amount)}
              </span>
            </div>
            <div className="flex justify-between text-xs text-[#64717B] border-t border-[#E1E6E9] pt-1.5">
              <span>Remaining Member Dues:</span>
              <span
                className={`font-semibold tabular-nums ${remainingBal > 0 ? 'text-[#A66A00]' : 'text-[#16845B]'
                  }`}
              >
                {remainingBal > 0 ? formatINR(remainingBal) : '₹0 (No Dues)'}
              </span>
            </div>
          </div>
        </div>

        {/* Footer Notes & Signatory */}
        <div className="border-t border-[#E1E6E9] pt-4 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 text-[11px] text-[#64717B]">
          <div className="space-y-0.5">
            <p className="font-medium text-[#25313B]">Terms & Conditions:</p>
            <p>1. Membership fee is non-refundable and non-transferable.</p>
            <p>2. Please preserve this receipt for all gym access and audit purposes.</p>
          </div>
          <div className="text-center sm:text-right min-w-40 pt-2 sm:pt-0">
            <div className="border-b border-[#25313B]/40 pb-6 mb-1 text-[10px] text-[#64717B] italic">
              Authorized Signatory
            </div>
            <p className="text-[11px] font-bold text-[#25313B]">{gymName}</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
