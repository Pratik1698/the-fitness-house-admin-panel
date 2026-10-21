/**
 * Member Utilities & Shared Domain Calculations
 * The Fitness House Gym Management Admin Panel
 */

/**
 * Returns a date string formatted as YYYY-MM-DD in the local timezone.
 * Avoids UTC timezone conversion shifts.
 */
export function getLocalDateString(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculates the exact difference in days between target date and base date.
 * Uses Date.UTC on parsed YYYY-MM-DD components to prevent DST or timezone artifacts.
 */
export function getDaysDifference(targetDateStr, baseDateStr = getLocalDateString()) {
  if (!targetDateStr) return 0;
  const [ty, tm, td] = targetDateStr.split('-').map(Number);
  const [by, bm, bd] = baseDateStr.split('-').map(Number);
  if (!ty || !tm || !td || !by || !bm || !bd) return 0;
  const targetUtc = Date.UTC(ty, tm - 1, td);
  const baseUtc = Date.UTC(by, bm - 1, bd);
  return Math.round((targetUtc - baseUtc) / (1000 * 60 * 60 * 24));
}

/**
 * Shared membership-status calculation across the entire application.
 * - An expiry date earlier than today's local date means 'expired'.
 * - An expiry date within the next five days (0 <= days <= 5) means 'expiring'.
 * - Otherwise, an unexpired membership is 'active'.
 */
export function getMembershipStatus(member, todayStr = getLocalDateString()) {
  if (!member || !member.expiryDate) return 'expired';
  const daysLeft = getDaysDifference(member.expiryDate, todayStr);
  if (daysLeft < 0) {
    return 'expired';
  }
  if (daysLeft <= 5) {
    return 'expiring';
  }
  return 'active';
}

/**
 * Enhanced membership expiry classification with 4 explicit tiers:
 * - 'expired': expiryDate earlier than today (daysLeft < 0)
 * - 'expiring_3d': expiring within 3 days (0 <= daysLeft <= 3) -> Urgent Priority
 * - 'expiring_5d': expiring within 5 days (4 <= daysLeft <= 5) -> Medium Priority
 * - 'active': more than 5 days remaining (daysLeft > 5) -> Low Priority
 */
export function getExpiryClassification(member, todayStr = getLocalDateString()) {
  if (!member || !member.expiryDate) {
    return {
      tier: 'expired',
      daysLeft: -999,
      label: 'Expired',
      badgeVariant: 'error',
      priority: 'high',
    };
  }
  const daysLeft = getDaysDifference(member.expiryDate, todayStr);
  if (daysLeft < 0) {
    return {
      tier: 'expired',
      daysLeft,
      label: `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`,
      badgeVariant: 'error',
      priority: 'high',
    };
  }
  if (daysLeft <= 3) {
    return {
      tier: 'expiring_3d',
      daysLeft,
      label: daysLeft === 0 ? 'Expires Today' : `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      badgeVariant: 'warning',
      priority: 'urgent',
    };
  }
  if (daysLeft <= 5) {
    return {
      tier: 'expiring_5d',
      daysLeft,
      label: `Expires in ${daysLeft} days`,
      badgeVariant: 'warning',
      priority: 'medium',
    };
  }
  return {
    tier: 'active',
    daysLeft,
    label: `Active (${daysLeft} days left)`,
    badgeVariant: 'success',
    priority: 'low',
  };
}

/**
 * Canonical gym contact and public-facing identity definitions.
 * Single source of truth for front desk helpline and owner/coach branding.
 */
export const CANONICAL_GYM_CONTACT = {
  phone: '7385846525',
  displayPhone: '+91 7385846525',
  ownerName: 'Pravin Joshi',
  coachName: 'Coach Pravin Joshi',
  email: 'pravinjoshi2707@gmail.com',
  location: 'Near Vitthal Mandir, Arag',
  address: 'Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra',
};

export const DEFAULT_GYM_PHONE = CANONICAL_GYM_CONTACT.displayPhone;

/**
 * Generates personalized, professional message copy for WhatsApp or SMS.
 */
export function generateNotificationMessage({ type, member, daysLeft, balance, gymPhone = DEFAULT_GYM_PHONE }) {
  const name = member?.name || 'Member';
  const plan = member?.plan || 'Membership';
  const expiry = member?.expiryDate || '';
  const contactPhone = gymPhone || DEFAULT_GYM_PHONE;

  switch (type) {
    case 'expiry_5d':
      return `Hi ${name}, this is a gentle reminder from The Fitness House, Arag. Your ${plan} membership will expire in 5 days on ${expiry}. Please renew early to maintain uninterrupted access. Front Desk: ${contactPhone}`;
    case 'expiry_3d':
      return `Hi ${name}, only 3 days left on your The Fitness House ${plan} pass (expiring on ${expiry}). Visit the front desk today or call ${contactPhone} to renew!`;
    case 'expiry_today':
      return `Important: Hi ${name}, your gym membership at The Fitness House expires today (${expiry}). Please renew your pass at the front desk to continue your workout routine. Helpline: ${contactPhone}`;
    case 'expired':
      return `Hi ${name}, your The Fitness House membership has expired. We miss having you in the gym! Visit the front desk to renew your pass and resume training. Phone: ${contactPhone}`;
    case 'balance_due':
    case 'payment_due':
      return `Hi ${name}, you have a pending balance of ₹${(balance ?? member?.balance ?? 0).toLocaleString()} at The Fitness House. Please clear your dues at the gym counter or via UPI. Front Desk: ${contactPhone}`;
    case 'pt_ending':
      return `Hi ${name}, your Personal Training package at The Fitness House has 3 or fewer sessions remaining. Speak with Coach Pravin Joshi or reception to renew your PT package. Phone: ${contactPhone}`;
    default:
      return `Hi ${name}, greeting from The Fitness House, Arag. For any questions regarding your membership, please contact our front desk at ${contactPhone}.`;
  }
}

/**
 * Normalizes and validates standard 10-digit Indian mobile numbers.
 * Handles '+91', '91', '0' prefixes and checks for 10 digits starting with 6-9.
 */
export function normalizeIndianMobile(rawPhone) {
  if (!rawPhone || !String(rawPhone).trim()) {
    return { valid: false, phone: '', display: 'No phone provided', reason: 'missing' };
  }
  const digits = String(rawPhone).replace(/\D/g, '');
  let normalized = digits;
  if (digits.length === 12 && digits.startsWith('91')) {
    normalized = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    normalized = digits.slice(1);
  }
  const isValid = /^[6-9]\d{9}$/.test(normalized);
  return {
    valid: isValid,
    phone: normalized,
    display: rawPhone,
    reason: isValid ? null : 'invalid_format',
  };
}

/**
 * Calculates new expiry date from start date string and duration in days.
 */
export function calculateExpiryDate(startDateStr, durationDays) {
  if (!startDateStr) return '';
  const [y, m, d] = startDateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + Number(durationDays));
  return getLocalDateString(date);
}

/**
 * Safely extracts up to 2 uppercase initials from a member's name.
 * Safe against double spaces, prefixes, and single-word names.
 */
export function getMemberInitials(name) {
  if (!name) return 'M';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'M';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Generates the next sequential TFH member ID safely by analyzing existing member IDs.
 * Does NOT rely on array length to prevent ID collisions.
 */
export function getNextMemberId(membersList = []) {
  const maxNum = membersList.reduce((max, m) => {
    const match = String(m?.id || '').match(/TFH(\d+)/i);
    const num = match ? parseInt(match[1], 10) : 0;
    return Math.max(max, isNaN(num) ? 0 : num);
  }, 0);
  return `TFH${String(maxNum + 1).padStart(3, '0')}`;
}

/**
 * Generates the next sequential PAY receipt ID safely.
 */
export function getNextPaymentId(paymentsList = []) {
  const maxNum = paymentsList.reduce((max, p) => {
    const match = String(p?.id || '').match(/PAY(\d+)/i);
    const num = match ? parseInt(match[1], 10) : 0;
    return Math.max(max, isNaN(num) ? 0 : num);
  }, 0);
  return `PAY${String(maxNum + 1).padStart(3, '0')}`;
}

/**
 * Validates a 10-digit Indian mobile number.
 * Valid numbers start with 6, 7, 8, or 9 followed by 9 digits.
 */
export function isValidIndianPhone(phone) {
  if (!phone) return false;
  const cleaned = String(phone).replace(/\D/g, '');
  return /^[6-9]\d{9}$/.test(cleaned);
}

/**
 * Validates standard email address format.
 */
export function isValidEmail(email) {
  if (!email || email.trim() === '') return true; // Optional field
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Formats a number as Indian Rupee currency (e.g. ₹1,500).
 */
export function formatINR(amount) {
  const num = Number(amount) || 0;
  return `₹${num.toLocaleString('en-IN')}`;
}

/**
 * Determines whether a date string (YYYY-MM-DD) falls in the same year and month
 * as the given base date.
 */
export function isCurrentMonth(dateStr, baseDateStr = getLocalDateString()) {
  if (!dateStr || !baseDateStr) return false;
  return dateStr.slice(0, 7) === baseDateStr.slice(0, 7);
}

/**
 * Returns a clean, user-friendly payment purpose string.
 */
export function getPaymentPurpose(payment) {
  if (!payment) return 'Fee Payment';
  if (payment.purpose) return payment.purpose;
  const notes = (payment.notes || '').toLowerCase();
  if (notes.includes('initial') || notes.includes('registration')) {
    return 'Initial Registration Fee';
  }
  if (notes.includes('renew')) {
    return 'Membership Renewal';
  }
  if (notes.includes('settling') || notes.includes('dues') || notes.includes('balance')) {
    return 'Outstanding Dues Settlement';
  }
  if (payment.category === 'Personal Training') {
    return `PT Package (${payment.relatedPlan || 'Training'})`;
  }
  if (payment.relatedPlan) {
    return `Membership Fee (${payment.relatedPlan})`;
  }
  return payment.category ? `${payment.category} Fee` : 'Fee Payment';
}

/**
 * Formats an ISO UTC timestamp into standard Indian Standard Time (Asia/Kolkata).
 * Example: "21 Oct 2026, 09:00:00 AM IST"
 */
export function formatISTDateTime(isoString) {
  if (!isoString) return 'Not recorded';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return 'Invalid date';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }) + ' IST';
}
