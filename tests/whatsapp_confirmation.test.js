import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeWhatsAppPhone,
  formatConfirmationDate,
  formatPlanDuration,
  extractMemberWhatsAppDetails,
  generateRegistrationWhatsAppMessage,
  generateWhatsAppUrl,
  openWhatsAppChat,
} from '../src/utils/whatsappUtils.js';

// ============================================================================
// Group 1: Indian Phone Number Normalization
// ============================================================================

test('1.1 Normalization: Standard 10-digit number starting with 6, 7, 8, 9', () => {
  const result = normalizeWhatsAppPhone('9876543210');
  assert.equal(result.valid, true);
  assert.equal(result.phone, '9876543210');
  assert.equal(result.waNumber, '919876543210');
  assert.equal(result.formattedPhone, '+91 98765 43210');
  assert.equal(result.reason, null);
});

test('1.2 Normalization: Handles +91 prefix and varied spacing', () => {
  const variations = [
    '+91 9876543210',
    '+91-98765-43210',
    '+91 (98765) 43210',
    '  +91 9876543210  ',
  ];

  for (const raw of variations) {
    const res = normalizeWhatsAppPhone(raw);
    assert.equal(res.valid, true, `Failed for input: ${raw}`);
    assert.equal(res.phone, '9876543210');
    assert.equal(res.waNumber, '919876543210');
  }
});

test('1.3 Normalization: Handles 91 prefix without plus', () => {
  const res = normalizeWhatsAppPhone('919876543210');
  assert.equal(res.valid, true);
  assert.equal(res.phone, '9876543210');
  assert.equal(res.waNumber, '919876543210');
});

test('1.4 Normalization: Handles leading trunk zero (09876543210)', () => {
  const res = normalizeWhatsAppPhone('09876543210');
  assert.equal(res.valid, true);
  assert.equal(res.phone, '9876543210');
  assert.equal(res.waNumber, '919876543210');
});

test('1.5 Normalization: Handles +91 09876543210 compound prefix', () => {
  const res = normalizeWhatsAppPhone('+91 09876543210');
  assert.equal(res.valid, true);
  assert.equal(res.phone, '9876543210');
  assert.equal(res.waNumber, '919876543210');
});

test('1.6 Normalization: Supports all valid Indian mobile starting digits (6, 7, 8, 9)', () => {
  const validPrefixes = ['6', '7', '8', '9'];
  for (const p of validPrefixes) {
    const raw = `${p}123456789`;
    const res = normalizeWhatsAppPhone(raw);
    assert.equal(res.valid, true, `Prefix ${p} must be recognized as valid`);
    assert.equal(res.phone, raw);
  }
});

// ============================================================================
// Group 2: Invalid Number Handling
// ============================================================================

test('2.1 Invalid handling: Empty, null, and undefined values', () => {
  const emptyRes = normalizeWhatsAppPhone('');
  assert.equal(emptyRes.valid, false);
  assert.equal(emptyRes.phone, '');
  assert.equal(emptyRes.reason, 'missing');

  const nullRes = normalizeWhatsAppPhone(null);
  assert.equal(nullRes.valid, false);
  assert.equal(nullRes.reason, 'missing');

  const undefRes = normalizeWhatsAppPhone(undefined);
  assert.equal(undefRes.valid, false);
  assert.equal(undefRes.reason, 'missing');

  const whitespaceRes = normalizeWhatsAppPhone('   ');
  assert.equal(whitespaceRes.valid, false);
  assert.equal(whitespaceRes.reason, 'missing');
});

test('2.2 Invalid handling: Invalid leading digits (< 6, e.g. 5, 4, 1)', () => {
  const res5 = normalizeWhatsAppPhone('5551234567');
  assert.equal(res5.valid, false);
  assert.equal(res5.reason, 'invalid_prefix');

  const res1 = normalizeWhatsAppPhone('1234567890');
  assert.equal(res1.valid, false);
  assert.equal(res1.reason, 'invalid_prefix');
});

test('2.3 Invalid handling: Length mismatch (too short or too long)', () => {
  const shortRes = normalizeWhatsAppPhone('98765');
  assert.equal(shortRes.valid, false);
  assert.equal(shortRes.reason, 'invalid_length');

  const longRes = normalizeWhatsAppPhone('98765432109999');
  assert.equal(longRes.valid, false);
  assert.equal(longRes.reason, 'invalid_length');
});

test('2.4 Invalid handling: Pure alphabetic or punctuation string', () => {
  const alphaRes = normalizeWhatsAppPhone('ABCDEFGHIJ');
  assert.equal(alphaRes.valid, false);
  assert.equal(alphaRes.reason, 'missing');
});

test('2.5 URL generation: Fails safely when phone number is invalid', () => {
  const res = generateWhatsAppUrl('invalid-phone', 'Hello');
  assert.equal(res.success, false);
  assert.equal(res.url, null);
  assert.ok(res.error);
});

// ============================================================================
// Group 3: Message Content Accuracy & Consistency
// ============================================================================

test('3.1 Message Content: Accurately formats full member registration with verified fee breakdown', () => {
  const sampleMember = {
    name: 'Rahul Patil',
    phone: '9876543210',
    member_code: 'TFH042',
    plan_name: '1 Month Fitness',
    duration_days: 30,
    start_date: '2026-11-14',
    expiry_date: '2026-12-14',
    total_liability: 1500,
    initial_payment_amount: 1500,
    outstanding_balance: 0,
    receipt_number: 'REC-202611-042',
  };

  const message = generateRegistrationWhatsAppMessage({
    member: sampleMember,
    isAdmin: true,
  });

  assert.ok(message.includes('WELCOME TO THE FITNESS HOUSE!'), 'Must include header');
  assert.ok(message.includes('*Rahul Patil*'), 'Must include formatted member name');
  assert.ok(message.includes('*TFH042*'), 'Must include member code');
  assert.ok(message.includes('*1 Month Fitness* (1 Month (30 Days))'), 'Must include plan & duration');
  assert.ok(message.includes('14 Nov 2026'), 'Must include formatted start date');
  assert.ok(message.includes('14 Dec 2026'), 'Must include formatted expiry date');
  assert.ok(message.includes('₹1,500'), 'Must include fee amount');
  assert.ok(message.includes('Nil (Paid in Full) ✅'), 'Must indicate paid in full balance');
  assert.ok(message.includes('*REC-202611-042*'), 'Must include receipt number');
  assert.ok(message.includes('Coach Pravin Joshi'), 'Must include coach name');
  assert.ok(message.includes('+91 7385846525'), 'Must include gym contact');
});

test('3.2 Message Content: Pending balance is explicitly flagged', () => {
  const partialMember = {
    name: 'Amit Shinde',
    phone: '9876543210',
    member_code: 'TFH043',
    plan_name: '3 Months Standard',
    duration_days: 90,
    start_date: '2026-11-14',
    expiry_date: '2027-02-12',
    totalFee: 4000,
    amountPaid: 2500,
    balance: 1500,
  };

  const msg = generateRegistrationWhatsAppMessage({
    member: partialMember,
    isAdmin: true,
  });

  assert.ok(msg.includes('• Total Fee: ₹4,000'));
  assert.ok(msg.includes('• Amount Paid: ₹2,500'));
  assert.ok(msg.includes('• Balance Due: ₹1,500 (Pending)'));
});

test('3.3 Financial Privacy Guard: Non-admin staff view completely excludes fee breakdown', () => {
  const memberWithFee = {
    name: 'Sunil Jadhav',
    phone: '9876543210',
    member_code: 'TFH044',
    plan: 'Annual Gold',
    totalFee: 12000,
    amountPaid: 12000,
    balance: 0,
  };

  const staffMessage = generateRegistrationWhatsAppMessage({
    member: memberWithFee,
    isAdmin: false, // Staff role
  });

  assert.ok(!staffMessage.includes('Fee & Payment Summary'), 'Staff message must NOT include fee summary');
  assert.ok(!staffMessage.includes('₹12,000'), 'Staff message must NOT expose fee amounts');
  assert.ok(staffMessage.includes('*Sunil Jadhav*'), 'Staff message must still contain member name');
  assert.ok(staffMessage.includes('Annual Gold'), 'Staff message must still contain plan');
});

// ============================================================================
// Group 4: URL Encoding & wa.me Integration
// ============================================================================

test('4.1 URL Encoding: Constructs valid https://wa.me/91... URL with RFC3986 encoding', () => {
  const phone = '9876543210';
  const text = 'Hello Rahul! Welcome to TFH 🏋️ & enjoy your workout.';

  const result = generateWhatsAppUrl(phone, text);
  assert.equal(result.success, true);
  assert.ok(result.url.startsWith('https://wa.me/919876543210?text='));

  // Decoded text must exactly match original string including emoji
  const queryParam = result.url.split('?text=')[1];
  assert.equal(decodeURIComponent(queryParam), text);
});

test('4.2 URL Encoding: Preserves newlines and markdown characters without corrupting', () => {
  const multiline = '*BOLD*\nLine 2\n• Bullet 1\n₹1,500';
  const res = generateWhatsAppUrl('9876543210', multiline);
  assert.equal(res.success, true);

  const decoded = decodeURIComponent(res.url.split('?text=')[1]);
  assert.equal(decoded, multiline);
});

test('4.3 Direct API Endpoint: Generates directUrl pointing to api.whatsapp.com to prevent 302 redirect emoji corruption', () => {
  const phone = '9876543210';
  const text = 'Direct link test 🏋️ 💪';
  const res = generateWhatsAppUrl(phone, text);

  assert.equal(res.success, true);
  assert.ok(res.directUrl.startsWith('https://api.whatsapp.com/send/?phone=919876543210&text='));
  assert.ok(res.directUrl.includes('%F0%9F%8F%8B%EF%B8%8F'));
  assert.ok(res.directUrl.includes('%F0%9F%92%AA'));
});

// ============================================================================
// Group 5: Missing / Incomplete Subscription Data Handling
// ============================================================================

test('5.1 Missing Data: Gracefully falls back when member object is incomplete', () => {
  const bareMember = {
    phone: '9876543210',
  };

  const message = generateRegistrationWhatsAppMessage({
    member: bareMember,
    isAdmin: true,
  });

  assert.ok(message.includes('Dear *Member*'), 'Defaults member name to Member');
  assert.ok(message.includes('• Member ID: *Pending*'), 'Defaults ID to Pending');
  assert.ok(message.includes('• Plan: *Standard Membership*'), 'Defaults plan to Standard Membership');
  assert.ok(message.includes('• Start Date: *N/A*'), 'Defaults start date to N/A');
  assert.ok(message.includes('• Expiry Date: *N/A*'), 'Defaults expiry date to N/A');
  assert.ok(!message.includes('Fee & Payment Summary'), 'Does not fabricate fee section');
});

test('5.2 Missing Data: Null member input does not throw', () => {
  assert.doesNotThrow(() => {
    const details = extractMemberWhatsAppDetails(null);
    assert.equal(details.name, '');
    assert.equal(details.phone, '');
  });
});

test('5.3 Duration Formatting: Correctly handles varied day counts and intervals', () => {
  assert.equal(formatPlanDuration(30), '1 Month (30 Days)');
  assert.equal(formatPlanDuration(60), '2 Months (60 Days)');
  assert.equal(formatPlanDuration(90), '3 Months (90 Days)');
  assert.equal(formatPlanDuration(180), '6 Months (180 Days)');
  assert.equal(formatPlanDuration(365), '1 Year (365 Days)');
  assert.equal(formatPlanDuration(45), '45 Days');
  assert.equal(formatPlanDuration(0), '');
  assert.equal(formatPlanDuration(null), '');
});

test('5.4 Date Formatting: Formats ISO dates and YYYY-MM-DD uniformly', () => {
  assert.equal(formatConfirmationDate('2026-11-14'), '14 Nov 2026');
  assert.equal(formatConfirmationDate('2026-01-01'), '01 Jan 2026');
  assert.equal(formatConfirmationDate(''), 'N/A');
  assert.equal(formatConfirmationDate(null), 'N/A');
});

// ============================================================================
// Group 6: Registration Success Integration & Attribute Normalization
// ============================================================================

test('6.1 Integration: Normalizes RPC onboard_member response object identically to MemberProfile', () => {
  // Shape returned by public.onboard_member
  const rpcResult = {
    member_id: '11111111-2222-3333-4444-555555555555',
    member_code: 'TFH101',
    plan_name: '6 Months Muscle Building',
    start_date: '2026-11-14',
    expiry_date: '2027-05-13',
    plan_price: 6000,
    initial_payment_amount: 6000,
    outstanding_balance: 0,
    receipt_number: 'REC-202611-101',
    name: 'Kishor Mane',
    phone: '9876543210',
  };

  const details = extractMemberWhatsAppDetails(rpcResult);
  assert.equal(details.name, 'Kishor Mane');
  assert.equal(details.memberCode, 'TFH101');
  assert.equal(details.planName, '6 Months Muscle Building');
  assert.equal(details.startDate, '2026-11-14');
  assert.equal(details.expiryDate, '2027-05-13');
  assert.equal(details.totalFee, 6000);
  assert.equal(details.amountPaid, 6000);
  assert.equal(details.balance, 0);
  assert.equal(details.receiptNumber, 'REC-202611-101');
});

// ============================================================================
// Group 7: Resend Idempotency & Zero Mutation Guarantee
// ============================================================================

test('7.1 Idempotency: Multiple dispatches or URL generations do not mutate input data', () => {
  const member = Object.freeze({
    id: 'mem-99',
    member_code: 'TFH099',
    name: 'Pratik More',
    phone: '9876543210',
    plan: '1 Month',
    startDate: '2026-11-14',
    expiryDate: '2026-12-14',
    totalFee: 1500,
    amountPaid: 1500,
    balance: 0,
  });

  // Multiple calls
  const url1 = generateWhatsAppUrl(member.phone, 'First copy');
  const url2 = generateWhatsAppUrl(member.phone, 'First copy');

  assert.equal(url1.url, url2.url);
  assert.equal(member.member_code, 'TFH099', 'Source member data must remain strictly immutable');
});

// ============================================================================
// Group 8: Browser / Window Dispatch Safety
// ============================================================================

test('8.1 Window Open Safety: Handles environments without window object safely', () => {
  // In Node environment, window is undefined
  const res = openWhatsAppChat('9876543210', 'Test message');
  assert.equal(res.success, true);
  assert.ok(res.url.startsWith('https://wa.me/919876543210?text=Test%20message'));
});

// ============================================================================
// Group 9: Unicode Integrity & Emoji Corruption Prevention (Regression Tests)
// ============================================================================

test('9.1 Unicode Integrity: Generated registration message contains no Unicode replacement character (U+FFFD)', () => {
  const sampleMember = {
    name: 'Rahul Patil',
    phone: '9876543210',
    member_code: 'TFH042',
    plan_name: '1 Month Fitness',
    duration_days: 30,
    start_date: '2026-11-14',
    expiry_date: '2026-12-14',
    total_liability: 1500,
    initial_payment_amount: 1500,
    outstanding_balance: 0,
    receipt_number: 'REC-202611-042',
  };

  const message = generateRegistrationWhatsAppMessage({
    member: sampleMember,
    isAdmin: true,
  });

  assert.equal(message.includes('\uFFFD'), false, 'Message must not contain Unicode replacement character U+FFFD');
  assert.equal(message.includes('\uEFBFBD'), false, 'Message must not contain UTF-8 replacement byte sequence');
});

test('9.2 Emoji Preservation: Expected simple, widely supported emojis are present and uncorrupted', () => {
  const sampleMember = {
    name: 'Rahul Patil',
    phone: '9876543210',
    member_code: 'TFH042',
    plan_name: '1 Month Fitness',
    duration_days: 30,
    start_date: '2026-11-14',
    expiry_date: '2026-12-14',
    total_liability: 1500,
    initial_payment_amount: 1500,
    outstanding_balance: 0,
    receipt_number: 'REC-202611-042',
  };

  const message = generateRegistrationWhatsAppMessage({
    member: sampleMember,
    isAdmin: true,
  });

  // Required simple, widely supported emojis: 🏋️ 💪 👋 📋 💰 📍 ⏰ 📞 ✅
  const expectedEmojis = ['🏋️', '💪', '👋', '📋', '💰', '📍', '⏰', '📞', '✅'];
  for (const emoji of expectedEmojis) {
    assert.ok(message.includes(emoji), `Message must include expected emoji: ${emoji}`);
  }
});

test('9.3 URL Roundtrip Decoding: URL decoding reproduces the exact original message and emojis without corruption', () => {
  const sampleMember = {
    name: 'Rahul Patil',
    phone: '9876543210',
    member_code: 'TFH042',
    plan_name: '1 Month Fitness',
    duration_days: 30,
    start_date: '2026-11-14',
    expiry_date: '2026-12-14',
    total_liability: 1500,
    initial_payment_amount: 1500,
    outstanding_balance: 0,
    receipt_number: 'REC-202611-042',
  };

  const originalMessage = generateRegistrationWhatsAppMessage({
    member: sampleMember,
    isAdmin: true,
  });

  const urlResult = generateWhatsAppUrl(sampleMember.phone, originalMessage);
  assert.equal(urlResult.success, true);
  assert.ok(urlResult.url);

  // Extract query string parameter
  const queryParam = urlResult.url.split('?text=')[1];
  const decodedMessage = decodeURIComponent(queryParam);

  // Decoded text must match original byte-for-byte and char-for-char
  assert.equal(decodedMessage, originalMessage, 'Decoded message must match original message perfectly');
  assert.equal(decodedMessage.includes('\uFFFD'), false, 'Decoded message must have no U+FFFD');

  const expectedEmojis = ['🏋️', '💪', '👋', '📋', '💰', '📍', '⏰', '📞', '✅'];
  for (const emoji of expectedEmojis) {
    assert.ok(decodedMessage.includes(emoji), `Decoded message must retain emoji: ${emoji}`);
  }
});

test('9.4 Formatting & Currency Integrity: Newlines and Indian Rupee symbol ₹ remain intact', () => {
  const sampleMember = {
    name: 'Sneha Kulkarni',
    phone: '9876543210',
    member_code: 'TFH088',
    plan_name: 'Annual Standard',
    duration_days: 365,
    start_date: '2026-11-14',
    expiry_date: '2027-11-14',
    total_liability: 10000,
    initial_payment_amount: 8000,
    outstanding_balance: 2000,
  };

  const message = generateRegistrationWhatsAppMessage({
    member: sampleMember,
    isAdmin: true,
  });

  // Verify Rupee symbol is present and uncorrupted
  assert.ok(message.includes('₹10,000'), 'Must contain ₹ symbol with total fee');
  assert.ok(message.includes('₹8,000'), 'Must contain ₹ symbol with amount paid');
  assert.ok(message.includes('₹2,000'), 'Must contain ₹ symbol with balance');

  // Verify multiple newlines are present
  const newlineCount = (message.match(/\n/g) || []).length;
  assert.ok(newlineCount >= 10, 'Message must retain clean multi-line paragraph structure');

  // Roundtrip URL check
  const urlRes = generateWhatsAppUrl(sampleMember.phone, message);
  const decoded = decodeURIComponent(urlRes.url.split('?text=')[1]);
  assert.equal(decoded, message);
  assert.ok(decoded.includes('₹10,000'));
  assert.equal(decoded.includes('?10,000'), false, 'Rupee must not become a question mark');
});

test('9.5 Source File Encoding: JavaScript files are valid UTF-8 and contain no U+FFFD characters', () => {
  const filesToCheck = [
    'src/utils/whatsappUtils.js',
    'src/components/shared/WhatsAppConfirmationModal.jsx',
    'tests/whatsapp_confirmation.test.js',
  ];

  for (const filePath of filesToCheck) {
    const rawBuffer = fs.readFileSync(filePath);
    // Buffer decoded as UTF-8
    const content = rawBuffer.toString('utf8');
    assert.equal(content.includes('\uFFFD'), false, `${filePath} must not contain U+FFFD`);
    assert.equal(content.includes('\uEFBFBD'), false, `${filePath} must not contain UTF-8 replacement sequence`);
  }
});

