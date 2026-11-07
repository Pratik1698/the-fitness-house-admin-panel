/**
 * Export Utilities — CSV Generation and Download
 * The Fitness House Gym Management Admin Panel
 */

import { getMembershipStatus, getLocalDateString } from './memberUtils.js';

/**
 * Escapes a cell value for standard CSV formatting (RFC 4180).
 * Handles commas, double-quotes, and newlines.
 * Formats null/undefined as clean empty strings.
 */
export function escapeCSVCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Normalizes date value to standard YYYY-MM-DD string.
 */
function formatDate(val) {
  if (!val) return '';
  const str = String(val).trim();
  if (!str || str === 'null' || str === 'undefined') return '';
  if (str.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  return str;
}

/**
 * Triggers a native browser file download for a given CSV string.
 * Appends UTF-8 BOM (\uFEFF) for Microsoft Excel compatibility.
 * Safely deallocates the object URL asynchronously to avoid premature cancellation.
 */
export function downloadCSV(filename, headers, rows) {
  const csvContent = [
    headers.map(escapeCSVCell).join(','),
    ...rows.map(row => row.map(escapeCSVCell).join(','))
  ].join('\r\n');

  // Prepend UTF-8 BOM (\uFEFF) for Microsoft Excel compatibility
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const actualFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;

  if (typeof document !== 'undefined') {
    const createUrl = (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function')
      ? URL.createObjectURL
      : (typeof window !== 'undefined' && window.URL && typeof window.URL.createObjectURL === 'function')
        ? window.URL.createObjectURL
        : null;

    if (createUrl) {
      const url = createUrl(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', actualFilename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => {
        const revokeUrl = (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function')
          ? URL.revokeObjectURL
          : (typeof window !== 'undefined' && window.URL && typeof window.URL.revokeObjectURL === 'function')
            ? window.URL.revokeObjectURL
            : null;
        if (revokeUrl) revokeUrl(url);
      }, 1000);
    }
  }

  return { csvContent, blob, filename: actualFilename };
}

/**
 * 14 Canonical CSV Headers for Member Roster Export
 */
export const MEMBERS_CSV_HEADERS = [
  'Member ID',
  'Full Name',
  'Phone Number',
  'Email',
  'Gender',
  'Date of Birth',
  'Address',
  'Membership Plan',
  'Start Date',
  'Expiry Date',
  'Total Fee',
  'Amount Paid',
  'Outstanding Balance',
  'Membership Status'
];

/**
 * Maps a single member record to the canonical 14-column CSV array.
 */
export function mapMemberToCSVRow(member, todayStr = getLocalDateString()) {
  if (!member) return [];

  const rawTotal = Number(member.totalFee ?? member.total_liability ?? member.plan_price ?? 0);
  const rawPaid = Number(member.amountPaid ?? member.amount_paid ?? 0);
  const rawBalance = Number(member.balance ?? 0);

  let status = member.status || 'active';
  if (status !== 'cancelled' && status !== 'superseded') {
    if (member.expiryDate) {
      status = getMembershipStatus(member, todayStr);
    }
  }

  return [
    member.member_code || member.memberCode || member.id || '',
    member.name || member.fullName || '',
    member.phone || member.phoneNumber || '',
    member.email || '',
    member.gender || '',
    formatDate(member.dob || member.dateOfBirth),
    member.address || '',
    member.plan || member.plan_name || member.planName || '',
    formatDate(member.startDate || member.start_date || member.joinDate),
    formatDate(member.expiryDate || member.expiry_date),
    isNaN(rawTotal) ? 0 : rawTotal,
    isNaN(rawPaid) ? 0 : rawPaid,
    isNaN(rawBalance) ? 0 : rawBalance,
    status
  ];
}

/**
 * Generates raw CSV content string for a list of members.
 */
export function generateMembersCSV(members = [], todayStr = getLocalDateString()) {
  const rows = (members || []).map(m => mapMemberToCSVRow(m, todayStr));
  return [
    MEMBERS_CSV_HEADERS.map(escapeCSVCell).join(','),
    ...rows.map(row => row.map(escapeCSVCell).join(','))
  ].join('\r\n');
}

/**
 * Exports gym members to CSV and triggers browser file download.
 */
export function exportMembersCSV(members = [], filename, todayStr = getLocalDateString()) {
  const actualFilename = filename || `fitness-house-members-${todayStr}.csv`;
  const list = Array.isArray(members) ? members : [];
  if (list.length === 0) {
    return { success: false, count: 0, filename: actualFilename, message: 'No records to export' };
  }

  const rows = list.map(m => mapMemberToCSVRow(m, todayStr));
  const result = downloadCSV(actualFilename, MEMBERS_CSV_HEADERS, rows);

  return {
    success: true,
    count: list.length,
    filename: actualFilename.endsWith('.csv') ? actualFilename : `${actualFilename}.csv`,
    csvContent: result?.csvContent
  };
}

/**
 * Exports financial transactions to CSV.
 */
export function exportTransactionsCSV(payments, filename = 'tfh_transactions_report') {
  const headers = [
    'Receipt ID',
    'Date',
    'Member ID',
    'Member Name',
    'Category',
    'Related Plan / Purpose',
    'Payment Method',
    'Amount (INR)',
    'Status',
    'Notes'
  ];

  const rows = payments.map(p => [
    p.id || '',
    p.date || '',
    p.memberId || '',
    p.memberName || '',
    p.category || 'General',
    p.purpose || p.relatedPlan || '',
    p.method || 'Cash',
    Number(p.amount) || 0,
    p.status || 'completed',
    p.notes || ''
  ]);

  downloadCSV(filename, headers, rows);
}

/**
 * Exports members with outstanding dues to CSV.
 */
export function exportOutstandingDuesCSV(membersWithDues, filename = 'tfh_outstanding_dues_report') {
  const headers = [
    'Member ID',
    'Member Name',
    'Phone',
    'Plan',
    'Membership Status',
    'Expiry Date',
    'Total Fee (INR)',
    'Amount Paid (INR)',
    'Balance Due (INR)',
    'Notes'
  ];

  const rows = membersWithDues.map(m => [
    m.id || '',
    m.name || '',
    m.phone || '',
    m.plan || '',
    m.status || '',
    m.expiryDate || '',
    Number(m.totalFee) || 0,
    Number(m.amountPaid) || 0,
    Number(m.balance) || 0,
    m.notes || ''
  ]);

  downloadCSV(filename, headers, rows);
}

/**
 * Exports check-in attendance logs to CSV.
 */
export function exportAttendanceCSV(checkins, filename = 'tfh_attendance_report') {
  const headers = [
    'Pass Code',
    'Date',
    'In Time',
    'Out Time',
    'Member Code',
    'Member Name',
    'Membership Plan',
    'Status',
    'Logged By Staff'
  ];

  const rows = checkins.map(c => [
    c.checkinCode || c.id || '',
    c.date || '',
    c.time || '',
    c.checkedOutTime || (c.checkedOutAt ? '' : 'Active In Gym'),
    c.memberCode || c.memberId || '',
    c.memberName || '',
    c.plan || '',
    c.rawStatus || c.status || 'valid',
    c.actorName || 'Staff'
  ]);

  downloadCSV(filename, headers, rows);
}

/**
 * Exports Personal Training clients and package progress to CSV.
 */
export function exportPtReportCSV(ptClients, filename = 'tfh_personal_training_report') {
  const headers = [
    'Member ID',
    'Member Name',
    'Package',
    'Assigned Trainer',
    'Start Date',
    'Valid Till',
    'Total Sessions',
    'Completed Sessions',
    'Remaining Sessions',
    'Status'
  ];

  const rows = ptClients.map(c => [
    c.memberId || '',
    c.memberName || '',
    c.package || '',
    c.trainer || 'Coach Pravin Joshi',
    c.startDate || '',
    c.validTill || '',
    Number(c.totalSessions) || 0,
    Number(c.completedSessions) || 0,
    Number(c.remainingSessions) || 0,
    c.status || 'active'
  ]);

  downloadCSV(filename, headers, rows);
}
