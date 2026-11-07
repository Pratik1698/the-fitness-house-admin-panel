import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeCSVCell,
  downloadCSV,
  MEMBERS_CSV_HEADERS,
  mapMemberToCSVRow,
  generateMembersCSV,
  exportMembersCSV
} from '../src/utils/exportUtils.js';

test('1. MEMBERS_CSV_HEADERS: exports exactly the 14 required columns in exact canonical order', () => {
  const expectedHeaders = [
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

  assert.equal(MEMBERS_CSV_HEADERS.length, 14, 'Must have exactly 14 columns');
  assert.deepEqual(MEMBERS_CSV_HEADERS, expectedHeaders, 'Columns must match canonical order and spelling');
});

test('2. escapeCSVCell: RFC 4180 compliance for special characters, numbers, and nulls', () => {
  // Comma in string
  assert.equal(
    escapeCSVCell('Near Vitthal Mandir, Arag'),
    '"Near Vitthal Mandir, Arag"',
    'Fields with commas must be wrapped in double quotes'
  );

  // Double quotes in string
  assert.equal(
    escapeCSVCell('John "The Beast" Doe'),
    '"John ""The Beast"" Doe"',
    'Double quotes must be escaped as double-double-quotes ("") and wrapped in quotes'
  );

  // Newline in string (\n)
  assert.equal(
    escapeCSVCell('Plot 12\nMain Road'),
    '"Plot 12\nMain Road"',
    'Fields with newline must be wrapped in double quotes'
  );

  // Carriage return in string (\r\n)
  assert.equal(
    escapeCSVCell('Plot 12\r\nMain Road'),
    '"Plot 12\r\nMain Road"',
    'Fields with carriage return must be wrapped in double quotes'
  );

  // Standard alphanumeric text without special chars
  assert.equal(escapeCSVCell('Gold Yearly'), 'Gold Yearly', 'Clean strings should remain clean');
  assert.equal(escapeCSVCell('TFH-0001'), 'TFH-0001', 'Codes should remain clean');

  // Clean numbers (unquoted for proper spreadsheet arithmetic recognition)
  assert.equal(escapeCSVCell(2000), '2000');
  assert.equal(escapeCSVCell(0), '0');
  assert.equal(escapeCSVCell(1250.5), '1250.5');

  // Null and undefined (must be empty strings, never "null" or "undefined")
  assert.equal(escapeCSVCell(null), '');
  assert.equal(escapeCSVCell(undefined), '');
  assert.equal(escapeCSVCell(''), '');
});

test('3. mapMemberToCSVRow: maps all 14 fields correctly from a complete member record', () => {
  const member = {
    id: 'ce982281-322c-470f-a029-3c31150fc725',
    member_code: 'TFH-0001',
    name: 'Pratik Shinde',
    phone: '9876543210',
    email: 'pratik@example.com',
    gender: 'Male',
    dob: '1995-08-20',
    address: 'Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra',
    plan: 'Gold Yearly',
    startDate: '2026-11-01',
    expiryDate: '2027-11-01',
    totalFee: 2000,
    amountPaid: 2000,
    balance: 0,
    status: 'active'
  };

  const todayStr = '2026-11-07';
  const row = mapMemberToCSVRow(member, todayStr);

  assert.equal(row.length, 14, 'Row must contain 14 values');
  assert.equal(row[0], 'TFH-0001', 'Col 1: Member ID');
  assert.equal(row[1], 'Pratik Shinde', 'Col 2: Full Name');
  assert.equal(row[2], '9876543210', 'Col 3: Phone Number');
  assert.equal(row[3], 'pratik@example.com', 'Col 4: Email');
  assert.equal(row[4], 'Male', 'Col 5: Gender');
  assert.equal(row[5], '1995-08-20', 'Col 6: Date of Birth');
  assert.equal(row[6], 'Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra', 'Col 7: Address');
  assert.equal(row[7], 'Gold Yearly', 'Col 8: Membership Plan');
  assert.equal(row[8], '2026-11-01', 'Col 9: Start Date');
  assert.equal(row[9], '2027-11-01', 'Col 10: Expiry Date');
  assert.equal(row[10], 2000, 'Col 11: Total Fee');
  assert.equal(row[11], 2000, 'Col 12: Amount Paid');
  assert.equal(row[12], 0, 'Col 13: Outstanding Balance');
  assert.equal(row[13], 'active', 'Col 14: Membership Status');
});

test('4. mapMemberToCSVRow: supports alternate property keys and handles null / missing fields', () => {
  // Member with alternative snake_case / camelCase properties and missing optional values
  const member = {
    id: 'db-uuid-123',
    memberCode: 'TFH-0099',
    fullName: 'Aarav Patil',
    phoneNumber: '9123456780',
    email: null,
    gender: 'Male',
    dateOfBirth: null,
    address: null,
    planName: 'Silver Monthly',
    start_date: '2026-10-15T00:00:00Z',
    expiry_date: '2026-11-15T00:00:00Z',
    total_liability: 700,
    amount_paid: 500,
    balance: 200
  };

  const todayStr = '2026-11-07';
  const row = mapMemberToCSVRow(member, todayStr);

  assert.equal(row[0], 'TFH-0099', 'Member ID should resolve from memberCode');
  assert.equal(row[1], 'Aarav Patil', 'Full Name should resolve from fullName');
  assert.equal(row[2], '9123456780', 'Phone should resolve from phoneNumber');
  assert.equal(row[3], '', 'Null email should be empty string');
  assert.equal(row[5], '', 'Null dob should be empty string');
  assert.equal(row[6], '', 'Null address should be empty string');
  assert.equal(row[7], 'Silver Monthly', 'Plan should resolve from planName');
  assert.equal(row[8], '2026-10-15', 'ISO timestamp start_date sliced to YYYY-MM-DD');
  assert.equal(row[9], '2026-11-15', 'ISO timestamp expiry_date sliced to YYYY-MM-DD');
  assert.equal(row[10], 700, 'Total Fee should resolve from total_liability');
  assert.equal(row[11], 500, 'Amount Paid should resolve from amount_paid');
  assert.equal(row[12], 200, 'Outstanding Balance');
});

test('5. mapMemberToCSVRow: dynamic membership status calculation (active, expiring, expired, cancelled)', () => {
  const todayStr = '2026-11-07';

  // Case A: Expiry > 5 days in future -> active
  const activeMember = { id: 'm1', expiryDate: '2026-12-01', status: 'active' };
  assert.equal(mapMemberToCSVRow(activeMember, todayStr)[13], 'active');

  // Case B: Expiry within 5 days -> expiring
  const expiringMember = { id: 'm2', expiryDate: '2026-11-10', status: 'active' };
  assert.equal(mapMemberToCSVRow(expiringMember, todayStr)[13], 'expiring');

  // Case C: Expiry in past -> expired
  const expiredMember = { id: 'm3', expiryDate: '2026-11-01', status: 'active' };
  assert.equal(mapMemberToCSVRow(expiredMember, todayStr)[13], 'expired');

  // Case D: Explicit cancelled status -> preserved
  const cancelledMember = { id: 'm4', expiryDate: '2027-01-01', status: 'cancelled' };
  assert.equal(mapMemberToCSVRow(cancelledMember, todayStr)[13], 'cancelled');

  // Case E: Explicit superseded status -> preserved
  const supersededMember = { id: 'm5', expiryDate: '2027-01-01', status: 'superseded' };
  assert.equal(mapMemberToCSVRow(supersededMember, todayStr)[13], 'superseded');
});

test('6. generateMembersCSV: produces compliant CSV text with header row, escaping, and line breaks', () => {
  const members = [
    {
      member_code: 'TFH-0001',
      name: 'Pravin "Coach" Joshi',
      phone: '9822001122',
      email: 'coach@tfh.com',
      gender: 'Male',
      dob: '1988-02-14',
      address: 'Shop 4, Main Bazaar, Arag',
      plan: 'Annual Fitness',
      startDate: '2026-01-01',
      expiryDate: '2027-01-01',
      totalFee: 5000,
      amountPaid: 5000,
      balance: 0,
      status: 'active'
    },
    {
      member_code: 'TFH-0002',
      name: 'Sneha Kulkarni',
      phone: '9822334455',
      email: '',
      gender: 'Female',
      dob: '1999-07-25',
      address: 'Near Vitthal Mandir, Arag',
      plan: 'Quarterly',
      startDate: '2026-10-01',
      expiryDate: '2027-01-01',
      totalFee: 2000,
      amountPaid: 1500,
      balance: 500,
      status: 'active'
    }
  ];

  const todayStr = '2026-11-07';
  const csv = generateMembersCSV(members, todayStr);
  const lines = csv.split('\r\n');

  assert.equal(lines.length, 3, 'Must produce 1 header line + 2 data lines');
  assert.equal(lines[0], MEMBERS_CSV_HEADERS.join(','), 'First line must be the exact header row');

  // Line 1 check: coach name has escaped quotes (""Coach""), address has comma wrapped in quotes
  assert.ok(lines[1].includes('"Pravin ""Coach"" Joshi"'), 'Quotes in name must be escaped');
  assert.ok(lines[1].includes('"Shop 4, Main Bazaar, Arag"'), 'Address with comma must be wrapped in quotes');
  assert.ok(lines[1].includes('5000,5000,0'), 'Numbers must be clean comma-separated values');

  // Line 2 check: empty email represented as empty field between delimiters
  assert.ok(lines[2].includes('TFH-0002,Sneha Kulkarni,9822334455,,Female'), 'Missing email must produce clean empty cell');
});

test('7. exportMembersCSV: handles empty list and defaults filename with local date', () => {
  const todayStr = '2026-11-07';

  // Empty list handling
  const emptyRes = exportMembersCSV([], null, todayStr);
  assert.equal(emptyRes.success, false, 'Empty list must not trigger download');
  assert.equal(emptyRes.count, 0);
  assert.equal(emptyRes.filename, 'fitness-house-members-2026-11-07.csv');

  // Non-empty list handling
  const member = {
    member_code: 'TFH-0001',
    name: 'Rohan Sharma',
    phone: '9876500000',
    expiryDate: '2027-11-01'
  };

  const successRes = exportMembersCSV([member], null, todayStr);
  assert.equal(successRes.success, true);
  assert.equal(successRes.count, 1);
  assert.equal(successRes.filename, 'fitness-house-members-2026-11-07.csv');
  assert.ok(successRes.csvContent.startsWith(MEMBERS_CSV_HEADERS.join(',')));
});

test('8. downloadCSV: verifies UTF-8 BOM, MIME type, and deferred URL revocation', async () => {
  let createdBlob = null;
  let createdUrl = null;
  let clicked = false;
  let revokedUrl = null;
  let appendedChild = null;
  let removedChild = null;

  // Mock DOM environment
  const mockAnchor = {
    setAttribute(name, value) {
      this[name] = value;
    },
    click() {
      clicked = true;
    }
  };

  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'a');
      return mockAnchor;
    },
    body: {
      appendChild(node) {
        appendedChild = node;
      },
      removeChild(node) {
        removedChild = node;
      }
    }
  };

  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  URL.createObjectURL = (blob) => {
    createdBlob = blob;
    createdUrl = 'blob:http://localhost/mock-uuid';
    return createdUrl;
  };

  URL.revokeObjectURL = (url) => {
    revokedUrl = url;
  };

  try {
    const filename = 'fitness-house-members-2026-11-07.csv';
    const headers = ['Col1', 'Col2'];
    const rows = [['Val1', 'Val2']];

    downloadCSV(filename, headers, rows);

    // Verify DOM interactions
    assert.equal(clicked, true, 'anchor.click() must be called');
    assert.equal(mockAnchor.download, filename, 'download filename attribute must be set');
    assert.equal(mockAnchor.href, 'blob:http://localhost/mock-uuid', 'href must point to blob URL');
    assert.equal(appendedChild, mockAnchor, 'anchor must be appended to document.body');
    assert.equal(removedChild, mockAnchor, 'anchor must be removed from document.body');

    // Verify Blob has UTF-8 BOM (\uFEFF -> bytes: 0xEF, 0xBB, 0xBF)
    assert.ok(createdBlob, 'Blob must be created');
    assert.equal(createdBlob.type, 'text/csv;charset=utf-8;', 'MIME type must be text/csv;charset=utf-8;');
    const arrayBuf = await createdBlob.arrayBuffer();
    const bytes = Buffer.from(arrayBuf);
    assert.equal(bytes[0], 0xEF, 'Byte 0 must be 0xEF (UTF-8 BOM)');
    assert.equal(bytes[1], 0xBB, 'Byte 1 must be 0xBB (UTF-8 BOM)');
    assert.equal(bytes[2], 0xBF, 'Byte 2 must be 0xBF (UTF-8 BOM)');
    const text = bytes.subarray(3).toString('utf-8');
    assert.ok(text.includes('Col1,Col2\r\nVal1,Val2'), 'Blob must contain CSV content');

    // Verify URL was NOT revoked synchronously (vital for Firefox/Chromium download managers)
    assert.equal(revokedUrl, null, 'URL.revokeObjectURL must NOT be executed synchronously');

    // Wait for the deferred timer
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(revokedUrl, 'blob:http://localhost/mock-uuid', 'URL.revokeObjectURL must be called asynchronously');
  } finally {
    delete globalThis.document;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
