/**
 * Export Utilities — CSV Generation and Download
 * The Fitness House Gym Management Admin Panel
 */

/**
 * Escapes a cell value for standard CSV formatting.
 * Handles commas, double-quotes, and newlines.
 */
function escapeCSVCell(value) {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Triggers a native browser file download for a given CSV string.
 */
export function downloadCSV(filename, headers, rows) {
  const csvContent = [
    headers.map(escapeCSVCell).join(','),
    ...rows.map(row => row.map(escapeCSVCell).join(','))
  ].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
