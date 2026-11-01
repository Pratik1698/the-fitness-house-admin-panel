import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Authoritative Membership Balance and Payment Status Calculation
 * Matches the PostgreSQL generated column and payment ledger logic:
 *
 *   amount_paid = SUM(completed payments) - SUM(completed refunds)
 *   credit_adjustments = SUM(completed credit adjustments)
 *   total_liability = plan_price + previous_balance_carried
 *   balance = GREATEST(0.00, total_liability - amount_paid - balance_transferred_out - credit_adjustments)
 *   payment_status = CASE
 *       WHEN total_liability - amount_paid - balance_transferred_out - credit_adjustments <= 0 THEN 'paid'
 *       WHEN amount_paid > 0 THEN 'partial'
 *       ELSE 'unpaid'
 *   END
 */
export function calculateMembershipBalance({
  planPrice = 0,
  previousBalanceCarried = 0,
  balanceTransferredOut = 0,
  creditAdjustments = 0,
  payments = [],
}) {
  const price = Number(planPrice) || 0;
  const prevCarried = Number(previousBalanceCarried) || 0;
  const transferredOut = Number(balanceTransferredOut) || 0;
  const credits = Number(creditAdjustments) || 0;

  // Aggregate only 'completed' transactions from the payment ledger
  let ledgerAmountPaid = 0;
  let ledgerCreditAdjustments = 0;

  for (const p of payments) {
    if (p.status !== 'completed') continue;

    const amount = Number(p.amount) || 0;
    if (p.transaction_type === 'payment') {
      ledgerAmountPaid += amount;
    } else if (p.transaction_type === 'refund') {
      ledgerAmountPaid -= amount;
    } else if (p.transaction_type === 'credit_adjustment') {
      ledgerCreditAdjustments += amount;
    }
  }

  const effectiveCreditAdjustments = credits + ledgerCreditAdjustments;
  const totalLiability = price + prevCarried;
  const netDue = totalLiability - ledgerAmountPaid - transferredOut - effectiveCreditAdjustments;
  const balance = Math.max(0, netDue);

  let paymentStatus = 'unpaid';
  if (netDue <= 0) {
    paymentStatus = 'paid';
  } else if (ledgerAmountPaid > 0) {
    paymentStatus = 'partial';
  }

  return {
    totalLiability,
    amountPaid: ledgerAmountPaid,
    creditAdjustments: effectiveCreditAdjustments,
    balanceTransferredOut: transferredOut,
    balance,
    paymentStatus,
  };
}

test('1. Member with ₹700 plan and ₹500 completed payment has exactly ₹200 outstanding balance', () => {
  const result = calculateMembershipBalance({
    planPrice: 700,
    previousBalanceCarried: 0,
    payments: [
      {
        receipt_number: 'TFH-20261021-10010',
        transaction_type: 'payment',
        amount: 500,
        status: 'completed',
      },
    ],
  });

  assert.equal(result.totalLiability, 700);
  assert.equal(result.amountPaid, 500);
  assert.equal(result.balance, 200);
  assert.equal(result.paymentStatus, 'partial');
});

test('2. Member with ₹700 plan and ₹700 completed payment has ₹0 outstanding balance', () => {
  const result = calculateMembershipBalance({
    planPrice: 700,
    previousBalanceCarried: 0,
    payments: [
      {
        receipt_number: 'TFH-20261020-10001',
        transaction_type: 'payment',
        amount: 700,
        status: 'completed',
      },
    ],
  });

  assert.equal(result.totalLiability, 700);
  assert.equal(result.amountPaid, 700);
  assert.equal(result.balance, 0);
  assert.equal(result.paymentStatus, 'paid');
});

test('3. Multiple partial payments correctly accumulate towards balance', () => {
  const result = calculateMembershipBalance({
    planPrice: 700,
    payments: [
      { transaction_type: 'payment', amount: 300, status: 'completed' },
      { transaction_type: 'payment', amount: 200, status: 'completed' },
    ],
  });

  assert.equal(result.amountPaid, 500);
  assert.equal(result.balance, 200);
  assert.equal(result.paymentStatus, 'partial');
});

test('4. Refunds reduce amount_paid and restore outstanding balance', () => {
  const result = calculateMembershipBalance({
    planPrice: 700,
    payments: [
      { transaction_type: 'payment', amount: 500, status: 'completed' },
      { transaction_type: 'refund', amount: 100, status: 'completed' },
    ],
  });

  assert.equal(result.amountPaid, 400);
  assert.equal(result.balance, 300);
  assert.equal(result.paymentStatus, 'partial');
});

test('5. Pending, cancelled, or failed payments are NOT counted in amount_paid', () => {
  const result = calculateMembershipBalance({
    planPrice: 700,
    payments: [
      { transaction_type: 'payment', amount: 500, status: 'completed' },
      { transaction_type: 'payment', amount: 200, status: 'pending' },
      { transaction_type: 'payment', amount: 200, status: 'cancelled' },
      { transaction_type: 'payment', amount: 200, status: 'failed' },
    ],
  });

  assert.equal(result.amountPaid, 500);
  assert.equal(result.balance, 200);
  assert.equal(result.paymentStatus, 'partial');
});

test('6. Renewal with carried forward debt increases total liability and tracks balance', () => {
  // Previous contract had ₹200 unpaid, carried forward to new ₹700 renewal
  const result = calculateMembershipBalance({
    planPrice: 700,
    previousBalanceCarried: 200,
    payments: [
      { transaction_type: 'payment', amount: 500, status: 'completed' },
    ],
  });

  assert.equal(result.totalLiability, 900);
  assert.equal(result.amountPaid, 500);
  assert.equal(result.balance, 400);
  assert.equal(result.paymentStatus, 'partial');
});

test('7. Credit adjustments reduce outstanding balance', () => {
  const result = calculateMembershipBalance({
    planPrice: 700,
    creditAdjustments: 100,
    payments: [
      { transaction_type: 'payment', amount: 400, status: 'completed' },
    ],
  });

  assert.equal(result.totalLiability, 700);
  assert.equal(result.amountPaid, 400);
  assert.equal(result.creditAdjustments, 100);
  assert.equal(result.balance, 200);
  assert.equal(result.paymentStatus, 'partial');
});

test('8. Transferred out balance on superseded subscription contract zeroes prior liability', () => {
  // When renewing, old contract transfers out its ₹200 balance to the new contract
  const result = calculateMembershipBalance({
    planPrice: 700,
    balanceTransferredOut: 200,
    payments: [
      { transaction_type: 'payment', amount: 500, status: 'completed' },
    ],
  });

  assert.equal(result.totalLiability, 700);
  assert.equal(result.amountPaid, 500);
  assert.equal(result.balanceTransferredOut, 200);
  assert.equal(result.balance, 0);
  assert.equal(result.paymentStatus, 'paid');
});

test('9. Overpayments clamp balance to 0 and set status to paid', () => {
  const result = calculateMembershipBalance({
    planPrice: 700,
    payments: [
      { transaction_type: 'payment', amount: 800, status: 'completed' },
    ],
  });

  assert.equal(result.balance, 0);
  assert.equal(result.paymentStatus, 'paid');
});

test('10. Reassignment of payment from Subscription A to Subscription B recalculates both correctly', () => {
  // Subscription A initially had payment of 500
  const subA_after_removal = calculateMembershipBalance({
    planPrice: 700,
    payments: [], // Payment was moved to Sub B
  });
  assert.equal(subA_after_removal.amountPaid, 0);
  assert.equal(subA_after_removal.balance, 700);
  assert.equal(subA_after_removal.paymentStatus, 'unpaid');

  // Subscription B receives the payment of 500
  const subB_after_addition = calculateMembershipBalance({
    planPrice: 700,
    payments: [
      { transaction_type: 'payment', amount: 500, status: 'completed' },
    ],
  });
  assert.equal(subB_after_addition.amountPaid, 500);
  assert.equal(subB_after_addition.balance, 200);
  assert.equal(subB_after_addition.paymentStatus, 'partial');
});

test('11. Idempotency: Re-evaluating ledger multiple times yields consistent totals without doubling', () => {
  const payments = [
    { transaction_type: 'payment', amount: 500, status: 'completed' },
  ];

  const run1 = calculateMembershipBalance({ planPrice: 700, payments });
  const run2 = calculateMembershipBalance({ planPrice: 700, payments });

  assert.deepEqual(run1, run2);
  assert.equal(run2.amountPaid, 500);
  assert.equal(run2.balance, 200);
});

