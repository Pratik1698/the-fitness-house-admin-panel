import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import {
  MessageSquare,
  Copy,
  Check,
  RotateCcw,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  User,
  Phone,
  Calendar,
  CreditCard,
  Sparkles,
  Info,
} from 'lucide-react';
import {
  normalizeWhatsAppPhone,
  extractMemberWhatsAppDetails,
  generateRegistrationWhatsAppMessage,
  generateWhatsAppUrl,
  formatConfirmationDate,
} from '../../utils/whatsappUtils';
import { useApp } from '../../context/AppContext';

/**
 * WhatsAppConfirmationModal
 * The Fitness House Gym Management Admin Panel
 *
 * Light-theme modal allowing the owner/admin to preview, customize, and manually
 * dispatch a registration confirmation message to a gym member via WhatsApp (wa.me).
 *
 * Strict Compliance:
 * - Operates purely client-side; zero external WhatsApp Cloud API calls.
 * - Does not create or mutate member/payment records on dispatch or resend.
 * - Disables sending if phone number is invalid or missing.
 * - Excludes unverified/restricted financial figures for non-admins.
 * - Clear disclaimer that message is not automatically delivered.
 */
export function WhatsAppConfirmationModal({
  isOpen,
  onClose,
  member,
  membershipPlans = [],
  isAdmin = true,
  onDispatched,
}) {
  const { gymInfo } = useApp ? useApp() : { gymInfo: null };

  const memberDetails = useMemo(() => {
    return extractMemberWhatsAppDetails(member, membershipPlans);
  }, [member, membershipPlans]);

  const phoneValidation = useMemo(() => {
    return normalizeWhatsAppPhone(memberDetails.phone);
  }, [memberDetails.phone]);

  const defaultMessage = useMemo(() => {
    return generateRegistrationWhatsAppMessage({
      member,
      plans: membershipPlans,
      gymInfo,
      isAdmin,
    });
  }, [member, membershipPlans, gymInfo, isAdmin]);

  const [message, setMessage] = useState(defaultMessage);
  const [copied, setCopied] = useState(false);
  const [dispatchStatus, setDispatchStatus] = useState(null);

  // Sync default message whenever member or modal state changes
  useEffect(() => {
    if (isOpen) {
      setMessage(defaultMessage);
      setCopied(false);
      setDispatchStatus(null);
    }
  }, [isOpen, defaultMessage]);

  if (!isOpen || !member) return null;

  const urlResult = generateWhatsAppUrl(memberDetails.phone, message);

  const handleCopy = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
        return;
      }
    } catch {
      // Fall through to fallback
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = message;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  };

  const handleReset = () => {
    setMessage(defaultMessage);
  };

  const handleOpenWhatsApp = () => {
    if (!phoneValidation.valid || !urlResult.success || !urlResult.url) {
      return;
    }

    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      // Prioritize direct API endpoint to prevent wa.me Latin-1 HTTP 302 redirect corruption
      const targetUrl = urlResult.directUrl || urlResult.url;
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
      setDispatchStatus('opened');
      if (typeof onDispatched === 'function') {
        onDispatched();
      }
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="WhatsApp Registration Confirmation"
      size="lg"
      footer={
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-2 text-xs">
            {phoneValidation.valid ? (
              <span className="flex items-center gap-1.5 text-[#16845B] font-medium">
                <CheckCircle2 size={14} className="shrink-0" />
                <span>Ready to send to {phoneValidation.formattedPhone}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[#B42318] font-medium">
                <AlertCircle size={14} className="shrink-0" />
                <span>Invalid phone number ({phoneValidation.display})</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              icon={ExternalLink}
              disabled={!phoneValidation.valid || !urlResult.success}
              onClick={handleOpenWhatsApp}
              className="bg-[#16845B] hover:bg-[#12704D] text-white shadow-xs"
            >
              Open WhatsApp
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 text-[#25313B]">
        {/* Recipient & Membership Summary Card */}
        <div className="bg-[#F8FAFB] rounded-xl border border-[#E1E6E9] p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E1E6E9] pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-full bg-[#E8F5EE] border border-[#16845B]/20 flex items-center justify-center text-[#16845B] font-bold shrink-0">
                <User size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-[#25313B]">{memberDetails.name || 'Member'}</h3>
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-white border border-[#E1E6E9] text-[#64717B]">
                    {memberDetails.memberCode || 'Pending'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-[#64717B]">
                  <Phone size={12} />
                  <span>{phoneValidation.formattedPhone}</span>
                  {phoneValidation.valid ? (
                    <span className="inline-flex items-center text-[10px] font-semibold text-[#16845B] bg-[#E8F5EE] px-1.5 py-0.2 rounded">
                      Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-[10px] font-semibold text-[#B42318] bg-[#FCE9E9] px-1.5 py-0.2 rounded">
                      Invalid Format
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="text-left sm:text-right text-xs">
              <p className="font-semibold text-[#25313B]">
                {memberDetails.planName}
              </p>
              <p className="text-[#64717B] text-[11px]">
                {memberDetails.durationLabel || 'Active Membership'}
              </p>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <p className="text-[11px] text-[#64717B]">Start Date</p>
              <p className="font-semibold text-[#25313B] mt-0.5">
                {formatConfirmationDate(memberDetails.startDate)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#64717B]">Expiry Date</p>
              <p className="font-semibold text-[#25313B] mt-0.5">
                {formatConfirmationDate(memberDetails.expiryDate)}
              </p>
            </div>
            {isAdmin && memberDetails.totalFee !== null && (
              <>
                <div>
                  <p className="text-[11px] text-[#64717B]">Fee / Paid</p>
                  <p className="font-semibold text-[#25313B] mt-0.5">
                    ₹{(memberDetails.totalFee ?? 0).toLocaleString('en-IN')} / ₹{(memberDetails.amountPaid ?? 0).toLocaleString('en-IN')}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[#64717B]">Balance</p>
                  <p className={`font-semibold mt-0.5 ${(memberDetails.balance ?? 0) > 0 ? 'text-[#B42318]' : 'text-[#16845B]'}`}>
                    {(memberDetails.balance ?? 0) > 0
                      ? `₹${(memberDetails.balance ?? 0).toLocaleString('en-IN')} Due`
                      : 'Fully Paid ✅'}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Invalid Phone Warning Banner */}
        {!phoneValidation.valid && (
          <div className="p-3 rounded-xl bg-[#FCE9E9] border border-[#B42318]/25 text-[#B42318] text-xs flex items-start gap-2.5">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-bold">WhatsApp Dispatch Blocked</p>
              <p>
                A valid 10-digit Indian mobile number (starting with 6, 7, 8, or 9) is required to open WhatsApp.
                Please edit the member profile with a valid mobile number.
              </p>
            </div>
          </div>
        )}

        {/* Editable Message Box */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="wa-confirmation-message" className="font-bold text-[#25313B] flex items-center gap-1.5">
              <MessageSquare size={14} className="text-[#16845B]" />
              <span>Message Preview & Editor</span>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReset}
                className="text-[#64717B] hover:text-[#25313B] transition-colors flex items-center gap-1 cursor-pointer"
                title="Reset to generated default message"
              >
                <RotateCcw size={12} />
                <span>Reset</span>
              </button>
              <span className="text-[#E1E6E9]">|</span>
              <button
                type="button"
                onClick={handleCopy}
                className="text-[#16845B] hover:text-[#12704D] font-medium transition-colors flex items-center gap-1 cursor-pointer"
                title="Copy message to clipboard"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <textarea
            id="wa-confirmation-message"
            rows={10}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full text-xs font-sans leading-relaxed bg-white border border-[#E1E6E9] rounded-xl p-3 text-[#25313B] focus:outline-none focus:ring-2 focus:ring-[#16845B] focus:border-transparent resize-y shadow-xs"
            placeholder="Enter confirmation message..."
          />

          <div className="flex items-center justify-between text-[11px] text-[#64717B]">
            <span>Tip: Use *text* for bold in WhatsApp</span>
            <span>{message.length} characters · {message.trim().split(/\s+/).filter(Boolean).length} words</span>
          </div>
        </div>

        {/* Dispatch Confirmation / Feedback */}
        {dispatchStatus === 'opened' && (
          <div className="p-3 rounded-xl bg-[#E8F5EE] border border-[#16845B]/25 text-[#16845B] text-xs flex items-start gap-2.5">
            <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">WhatsApp Opened in New Tab</p>
              <p className="text-[11px]">
                The chat window was opened with this message pre-filled. Please review and click <strong>Send</strong> inside WhatsApp.
              </p>
            </div>
          </div>
        )}

        {/* Safety & Protocol Notice */}
        <div className="p-3 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] text-[11px] text-[#64717B] space-y-1">
          <div className="flex items-center gap-1.5 font-semibold text-[#25313B]">
            <Info size={13} className="text-[#16845B]" />
            <span>Manual Dispatch Protocol</span>
          </div>
          <p>
            Clicking <strong>Open WhatsApp</strong> launches WhatsApp Web or the WhatsApp desktop/mobile app with this pre-filled text.
            The message is <strong>not sent automatically</strong>. Antigravity never accesses member WhatsApp chats or marks messages as delivered until verified by you.
          </p>
        </div>
      </div>
    </Modal>
  );
}

