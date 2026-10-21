import { supabase, isSupabaseConfigured } from './supabaseClient';

/**
 * Payment Service
 * The Fitness House Gym Management Admin Panel
 *
 * Provides typed, structured methods for interacting with the payments ledger,
 * dues collection RPCs, and financial transactions in Supabase.
 */

/**
 * Fetches all payment transactions from public.payments joined with
 * members and member_subscriptions, ordered by created_at descending.
 *
 * @returns {Promise<{ data: Array<object>|null, error: Error|null }>}
 */
export async function getPayments() {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
    };
  }

  try {
    const { data, error } = await supabase
      .from('payments')
      .select(`
        id,
        receipt_number,
        transaction_type,
        amount,
        payment_method,
        status,
        notes,
        created_at,
        member_id,
        subscription_id,
        pt_assignment_id,
        members (
          id,
          name,
          member_code,
          phone
        ),
        member_subscriptions (
          id,
          plan_name
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[paymentService.getPayments] Database error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch payment records from database.'),
      };
    }

    const normalized = (data || []).map((row) => {
      const isPT = Boolean(row.pt_assignment_id);
      const member = row.members || {};
      const sub = row.member_subscriptions || {};
      const dateStr = row.created_at ? row.created_at.split('T')[0] : '';

      return {
        id: row.receipt_number || row.id,
        paymentId: row.id,
        receiptNumber: row.receipt_number,
        date: dateStr,
        createdAt: row.created_at,
        memberId: row.member_id,
        memberName: member.name || 'Member',
        memberCode: member.member_code || '',
        phone: member.phone || '',
        category: isPT ? 'Personal Training' : 'Membership',
        relatedPlan: sub.plan_name || (isPT ? 'PT Package' : 'Membership Dues'),
        amount: Number(row.amount || 0),
        method: row.payment_method,
        status: row.status,
        purpose: row.notes
          ? row.notes
          : (isPT ? 'Personal Training Session Dues' : 'Membership Dues Payment'),
        notes: row.notes || '',
        transactionType: row.transaction_type,
      };
    });

    return { data: normalized, error: null };
  } catch (err) {
    console.error('[paymentService.getPayments] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Records an outstanding membership dues payment via public.record_dues_payment RPC.
 *
 * @param {object} payload
 * @param {string} payload.memberId - UUID of member
 * @param {string} payload.subscriptionId - UUID of member_subscriptions
 * @param {number} payload.amount - Payment amount (> 0 and <= balance)
 * @param {string} payload.paymentMethod - 'Cash' | 'UPI' | 'Card'
 * @param {string} [payload.notes] - Optional transaction notes
 * @param {string} [payload.idempotencyKey] - UUID idempotency key
 * @returns {Promise<{ data: object|null, error: Error|null, idempotencyKey: string }>}
 */
export async function recordDuesPayment(payload) {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
      idempotencyKey: payload.idempotencyKey || '',
    };
  }

  const idempotencyKey = payload.idempotencyKey || (
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `IDEMP-DUES-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  );

  const amount = Number(payload.amount);
  if (!amount || isNaN(amount) || amount <= 0) {
    return {
      data: null,
      error: new Error('Payment amount must be strictly greater than zero.'),
      idempotencyKey,
    };
  }

  const rpcParams = {
    p_member_id: payload.memberId,
    p_subscription_id: payload.subscriptionId,
    p_amount: amount,
    p_payment_method: payload.paymentMethod || 'Cash',
    p_notes: payload.notes && payload.notes.trim() ? payload.notes.trim() : null,
    p_idempotency_key: idempotencyKey,
  };

  try {
    const { data, error } = await supabase.rpc('record_dues_payment', rpcParams);

    if (error) {
      console.error('[paymentService.recordDuesPayment] RPC Error:', error);
      let userFriendlyMessage = error.message || 'Failed to record dues payment.';

      if (error.message.includes('ERR_OVERPAYMENT_EXCEEDS_BALANCE')) {
        userFriendlyMessage = 'Payment amount exceeds the outstanding dues balance. Overpayments are rejected.';
      } else if (error.message.includes('SUBSCRIPTION_NOT_FOUND')) {
        userFriendlyMessage = 'Active subscription matching this member could not be found.';
      } else if (error.message.includes('INVALID_ARGUMENT')) {
        userFriendlyMessage = error.message.replace(/.*?INVALID_ARGUMENT:\s*/, '');
      } else if (error.message.includes('ERR_IDEMPOTENCY_PAYLOAD_MISMATCH')) {
        userFriendlyMessage = 'A submission with divergent parameters already used this idempotency key. Please refresh.';
      } else if (error.message.includes('UNAUTHORIZED')) {
        userFriendlyMessage = 'Your session has expired or is unauthorized. Please log in again.';
      }

      return {
        data: null,
        error: new Error(userFriendlyMessage),
        idempotencyKey,
      };
    }

    return {
      data,
      error: null,
      idempotencyKey,
    };
  } catch (err) {
    console.error('[paymentService.recordDuesPayment] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
      idempotencyKey,
    };
  }
}

/**
 * Records an outstanding personal training dues payment via public.record_pt_dues_payment RPC.
 *
 * @param {object} payload
 * @param {string} payload.memberId - UUID of member
 * @param {string} payload.ptAssignmentId - UUID of pt_assignments
 * @param {number} payload.amount - Payment amount (> 0 and <= balance)
 * @param {string} payload.paymentMethod - 'Cash' | 'UPI' | 'Card'
 * @param {string} [payload.notes] - Optional transaction notes
 * @param {string} [payload.idempotencyKey] - UUID idempotency key
 * @returns {Promise<{ data: object|null, error: Error|null, idempotencyKey: string }>}
 */
export async function recordPtDuesPayment(payload) {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
      idempotencyKey: payload.idempotencyKey || '',
    };
  }

  const idempotencyKey = payload.idempotencyKey || (
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `IDEMP-PTDUES-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  );

  const amount = Number(payload.amount);
  if (!amount || isNaN(amount) || amount <= 0) {
    return {
      data: null,
      error: new Error('Payment amount must be strictly greater than zero.'),
      idempotencyKey,
    };
  }

  const rpcParams = {
    p_member_id: payload.memberId,
    p_pt_assignment_id: payload.ptAssignmentId,
    p_amount: amount,
    p_payment_method: payload.paymentMethod || 'Cash',
    p_notes: payload.notes && payload.notes.trim() ? payload.notes.trim() : null,
    p_idempotency_key: idempotencyKey,
  };

  try {
    const { data, error } = await supabase.rpc('record_pt_dues_payment', rpcParams);

    if (error) {
      console.error('[paymentService.recordPtDuesPayment] RPC Error:', error);
      let userFriendlyMessage = error.message || 'Failed to record PT dues payment.';

      if (error.message.includes('ERR_OVERPAYMENT_EXCEEDS_BALANCE')) {
        userFriendlyMessage = 'Payment amount exceeds the outstanding PT dues balance.';
      } else if (error.message.includes('PT_ASSIGNMENT_NOT_FOUND')) {
        userFriendlyMessage = 'Active PT assignment matching this member could not be found.';
      } else if (error.message.includes('INVALID_ARGUMENT')) {
        userFriendlyMessage = error.message.replace(/.*?INVALID_ARGUMENT:\s*/, '');
      }

      return {
        data: null,
        error: new Error(userFriendlyMessage),
        idempotencyKey,
      };
    }

    return {
      data,
      error: null,
      idempotencyKey,
    };
  } catch (err) {
    console.error('[paymentService.recordPtDuesPayment] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
      idempotencyKey,
    };
  }
}
