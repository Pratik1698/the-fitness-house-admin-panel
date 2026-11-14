/**
 * WhatsApp Confirmation & Message Utilities
 * The Fitness House Gym Management Admin Panel
 *
 * Provides shared, domain-validated utilities for preparing, formatting,
 * and dispatching manual WhatsApp registration confirmations.
 *
 * Strict Compliance:
 * - Local dispatch only via standard https://wa.me/91XXXXXXXXXX URLs.
 * - Zero external API dependencies (no WhatsApp Cloud API).
 * - Enforces Indian 10-digit mobile phone normalization (/^[6-9]\d{9}$/).
 * - Respects administrative financial restriction boundaries.
 * - Guarantees consistent date formatting (DD MMM YYYY).
 */

import { CANONICAL_GYM_CONTACT, getDaysDifference } from './memberUtils.js';

/**
 * Normalizes and validates Indian mobile phone numbers for WhatsApp dispatch.
 * Handles '+91', '91', '0' prefixes, spaces, hyphens, and parentheses.
 *
 * @param {string|number} rawPhone
 * @returns {{
 *   valid: boolean,
 *   phone: string,
 *   waNumber: string,
 *   formattedPhone: string,
 *   display: string,
 *   reason: null | 'missing' | 'invalid_length' | 'invalid_prefix' | 'invalid_format'
 * }}
 */
export function normalizeWhatsAppPhone(rawPhone) {
  if (rawPhone === undefined || rawPhone === null || !String(rawPhone).trim()) {
    return {
      valid: false,
      phone: '',
      waNumber: '',
      formattedPhone: 'No phone provided',
      display: 'No phone provided',
      reason: 'missing',
    };
  }

  const trimmed = String(rawPhone).trim();
  let digits = trimmed.replace(/\D/g, '');

  if (digits.length === 13 && digits.startsWith('910')) {
    digits = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  const isValid = /^[6-9]\d{9}$/.test(digits);

  let reason = null;
  if (!isValid) {
    if (digits.length === 0) {
      reason = 'missing';
    } else if (digits.length !== 10) {
      reason = 'invalid_length';
    } else if (!/^[6-9]/.test(digits)) {
      reason = 'invalid_prefix';
    } else {
      reason = 'invalid_format';
    }
  }

  const formattedPhone = isValid
    ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
    : (digits ? `+91 ${digits}` : 'Invalid phone');

  return {
    valid: isValid,
    phone: digits,
    waNumber: isValid ? `91${digits}` : '',
    formattedPhone,
    display: trimmed,
    reason,
  };
}

/**
 * Formats a date string (YYYY-MM-DD, ISO, or timestamp) into a clean, human-readable
 * Indian gym format (e.g. "14 Nov 2026").
 *
 * @param {string|Date|number} dateVal
 * @returns {string} Formatted date or fallback
 */
export function formatConfirmationDate(dateVal) {
  if (!dateVal) return 'N/A';
  const str = String(dateVal).trim();
  if (!str || str === 'null' || str === 'undefined') return 'N/A';

  // Handle YYYY-MM-DD directly with UTC to avoid timezone shift
  const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const [_, y, m, d] = ymdMatch;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return date.toLocaleDateString('en-IN', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Formats a numeric duration in days into a user-friendly label.
 *
 * @param {number|string} days
 * @returns {string} e.g. "1 Month (30 Days)", "3 Months (90 Days)", "30 Days"
 */
export function formatPlanDuration(days) {
  if (days === undefined || days === null || isNaN(Number(days)) || Number(days) <= 0) {
    return '';
  }
  const numDays = Math.round(Number(days));
  if (numDays === 30) return '1 Month (30 Days)';
  if (numDays === 60) return '2 Months (60 Days)';
  if (numDays === 90) return '3 Months (90 Days)';
  if (numDays === 180) return '6 Months (180 Days)';
  if (numDays === 365 || numDays === 366) return '1 Year (365 Days)';
  if (numDays % 30 === 0) {
    const months = numDays / 30;
    return `${months} Months (${numDays} Days)`;
  }
  return `${numDays} Days`;
}

/**
 * Extracts and unifies member attributes across both registration responses
 * and existing member profile records.
 *
 * @param {object} member
 * @param {Array} [plans=[]]
 * @returns {object}
 */
export function extractMemberWhatsAppDetails(member, plans = []) {
  if (!member || typeof member !== 'object') {
    return {
      name: '',
      phone: '',
      memberCode: '',
      planName: '',
      durationDays: null,
      durationLabel: '',
      startDate: '',
      expiryDate: '',
      totalFee: null,
      amountPaid: null,
      balance: null,
      receiptNumber: '',
    };
  }

  const name = member.name ? String(member.name).trim() : '';
  const phone = member.phone ? String(member.phone).trim() : '';
  const memberCode = member.member_code || member.memberCode || member.id || '';
  const planName = member.plan_name || member.plan || 'Standard Membership';

  const startDate = member.start_date || member.startDate || '';
  const expiryDate = member.expiry_date || member.expiryDate || '';

  // Resolve duration in days
  let durationDays = null;
  if (member.duration_days !== undefined && member.duration_days !== null && !isNaN(Number(member.duration_days))) {
    durationDays = Number(member.duration_days);
  } else if (member.duration !== undefined && member.duration !== null && !isNaN(Number(member.duration))) {
    durationDays = Number(member.duration);
  } else if (Array.isArray(plans) && plans.length > 0) {
    const matched = plans.find(p => p.id === member.planId || p.name === planName);
    if (matched) {
      durationDays = Number(matched.duration_days || matched.duration);
    }
  }

  // Fallback: derive duration from start and expiry dates if available
  if ((durationDays === null || isNaN(durationDays) || durationDays <= 0) && startDate && expiryDate) {
    const diff = getDaysDifference(expiryDate, startDate);
    if (diff > 0) {
      durationDays = diff;
    }
  }

  const durationLabel = formatPlanDuration(durationDays);

  // Financial fields resolution (strictly respecting null/undefined)
  const rawTotalFee = member.total_liability ?? member.plan_price ?? member.totalFee;
  const totalFee = rawTotalFee !== undefined && rawTotalFee !== null && !isNaN(Number(rawTotalFee))
    ? Number(rawTotalFee)
    : null;

  const rawAmountPaid = member.initial_payment_amount ?? member.amountPaid;
  const amountPaid = rawAmountPaid !== undefined && rawAmountPaid !== null && !isNaN(Number(rawAmountPaid))
    ? Number(rawAmountPaid)
    : null;

  const rawBalance = member.outstanding_balance ?? member.balance;
  let balance = null;
  if (rawBalance !== undefined && rawBalance !== null && !isNaN(Number(rawBalance))) {
    balance = Number(rawBalance);
  } else if (totalFee !== null && amountPaid !== null) {
    balance = Math.max(0, totalFee - amountPaid);
  }

  const receiptNumber = member.receipt_number || member.receiptNumber || '';

  return {
    name,
    phone,
    memberCode,
    planName,
    durationDays,
    durationLabel,
    startDate,
    expiryDate,
    totalFee,
    amountPaid,
    balance,
    receiptNumber,
  };
}

/**
 * Generates the default registration confirmation message for WhatsApp.
 *
 * @param {object} params
 * @param {object} params.member - Member or registration result
 * @param {Array} [params.plans=[]] - Active plans catalog
 * @param {object} [params.gymInfo=null] - Gym singleton info
 * @param {boolean} [params.isAdmin=true] - Guard for financial details
 * @returns {string} Formatted WhatsApp message with markdown formatting (*bold*)
 */
export function generateRegistrationWhatsAppMessage({
  member,
  plans = [],
  gymInfo = null,
  isAdmin = true,
}) {
  const details = extractMemberWhatsAppDetails(member, plans);

  const gymName = gymInfo?.name || 'THE FITNESS HOUSE';
  const gymAddress = gymInfo?.address || CANONICAL_GYM_CONTACT.address;
  const gymPhone = gymInfo?.phone || CANONICAL_GYM_CONTACT.displayPhone;
  const coachName = gymInfo?.headCoach || CANONICAL_GYM_CONTACT.coachName;
  const timings = gymInfo?.timings || 'Mon – Sat: 05:30 AM – 10:00 AM | 05:00 PM – 10:00 PM';

  const memberName = details.name || 'Member';
  const memberId = details.memberCode || 'Pending';
  const planDisplay = details.planName || 'Gym Membership';
  const durationText = details.durationLabel ? ` (${details.durationLabel})` : '';
  const formattedStart = formatConfirmationDate(details.startDate);
  const formattedExpiry = formatConfirmationDate(details.expiryDate);

  // Financial details included ONLY when verified and authorized
  let feeSection = '';
  if (isAdmin && details.totalFee !== null && details.totalFee !== undefined) {
    const feeStr = details.totalFee.toLocaleString('en-IN');
    const paidStr = (details.amountPaid ?? 0).toLocaleString('en-IN');
    const balanceNum = details.balance ?? 0;
    const balanceStr = balanceNum > 0
      ? `₹${balanceNum.toLocaleString('en-IN')} (Pending)`
      : 'Nil (Paid in Full) ✅';

    const receiptLine = details.receiptNumber
      ? `\n• Receipt No: *${details.receiptNumber}*`
      : '';

    feeSection = [
      '',
      '💰 *Fee & Payment Summary:*',
      `• Total Fee: ₹${feeStr}`,
      `• Amount Paid: ₹${paidStr}`,
      `• Balance Due: ${balanceStr}${receiptLine}`,
    ].join('\n');
  }

  const messageLines = [
    `*WELCOME TO ${gymName.toUpperCase()}!* 🏋️ 💪`,
    '',
    `Dear *${memberName}* 👋,`,
    'Thank you for joining The Fitness House, Arag. Your gym membership registration has been successfully confirmed!',
    '',
    '📋 *Membership Details:*',
    `• Member ID: *${memberId}*`,
    `• Plan: *${planDisplay}*${durationText}`,
    `• Start Date: *${formattedStart}*`,
    `• Expiry Date: *${formattedExpiry}*`,
    feeSection,
    '',
    '📍 *Gym Address:*',
    gymAddress,
    '',
    '⏰ *Gym Timings:*',
    timings,
    '',
    '📞 *Helpline & Front Desk:*',
    `${coachName} · ${gymPhone}`,
    '',
    'We look forward to supporting your fitness journey! Please keep your Member ID handy when visiting the gym.',
  ];

  // Clean double blank lines if feeSection was omitted
  return messageLines.filter((line, idx, arr) => !(line === '' && arr[idx - 1] === '')).join('\n');
}

/**
 * Generates an encoded WhatsApp dispatch URL.
 * Provides both standard wa.me URL and direct api.whatsapp.com URL to bypass
 * server-side HTTP 302 Latin-1 redirect encoding corruption on desktop browsers.
 *
 * @param {string|number} rawPhone
 * @param {string} messageText
 * @returns {{
 *   success: boolean,
 *   url: string|null,
 *   directUrl: string|null,
 *   error: string|null,
 *   reason: string|null,
 *   waNumber: string,
 *   phone: string
 * }}
 */
export function generateWhatsAppUrl(rawPhone, messageText) {
  const phoneRes = normalizeWhatsAppPhone(rawPhone);
  if (!phoneRes.valid || !phoneRes.waNumber) {
    return {
      success: false,
      url: null,
      directUrl: null,
      error: phoneRes.reason === 'missing'
        ? 'Phone number is required'
        : 'Please enter a valid 10-digit Indian mobile number',
      reason: phoneRes.reason,
      waNumber: '',
      phone: phoneRes.phone || '',
    };
  }

  const encodedMessage = encodeURIComponent(messageText || '');
  const url = `https://wa.me/${phoneRes.waNumber}?text=${encodedMessage}`;
  const directUrl = `https://api.whatsapp.com/send/?phone=${phoneRes.waNumber}&text=${encodedMessage}`;

  return {
    success: true,
    url,
    directUrl,
    error: null,
    reason: null,
    waNumber: phoneRes.waNumber,
    phone: phoneRes.phone,
  };
}

/**
 * Safely triggers the browser to open the WhatsApp chat in a new tab.
 * Uses the direct api.whatsapp.com endpoint to prevent wa.me redirect emoji corruption.
 * Does NOT execute any server-side or automated API requests.
 *
 * @param {string|number} rawPhone
 * @param {string} messageText
 * @returns {{ success: boolean, url: string|null, directUrl: string|null, error: string|null }}
 */
export function openWhatsAppChat(rawPhone, messageText) {
  const result = generateWhatsAppUrl(rawPhone, messageText);
  if (!result.success || !result.url) {
    return { success: false, url: null, directUrl: null, error: result.error };
  }

  // Open direct API endpoint to bypass wa.me Latin-1 302 redirect emoji corruption
  const targetUrl = result.directUrl || result.url;
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  }

  return { success: true, url: result.url, directUrl: result.directUrl, error: null };
}

