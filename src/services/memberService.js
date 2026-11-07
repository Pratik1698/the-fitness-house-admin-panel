import { supabase, isSupabaseConfigured } from './supabaseClient.js';

let _injectedClient = null;
let _injectedConfigured = null;

export function setSupabaseClientForTesting(client, configured = true) {
  _injectedClient = client;
  _injectedConfigured = configured;
}

export function resetSupabaseClientForTesting() {
  _injectedClient = null;
  _injectedConfigured = null;
}

function getActiveClient() {
  return _injectedClient || supabase;
}

function getIsConfigured() {
  return _injectedConfigured !== null ? _injectedConfigured : isSupabaseConfigured;
}

/**
 * Member Service
 * The Fitness House Gym Management Admin Panel
 *
 * Provides typed, structured methods for interacting with members,
 * subscriptions, and member business RPCs in Supabase.
 */

/**
 * Onboards a new member atomically via the public.onboard_member RPC.
 * Creates a member record, active subscription contract, and initial payment (if amount > 0).
 *
 * @param {object} payload
 * @param {string} payload.name - Full member name
 * @param {string} payload.phone - 10-digit mobile number
 * @param {string} [payload.email] - Optional email address
 * @param {string} [payload.gender] - 'Male' | 'Female' | 'Other'
 * @param {string} [payload.dob] - Optional date of birth ('YYYY-MM-DD')
 * @param {string} [payload.address] - Optional residential address
 * @param {string} [payload.emergencyContact] - Optional emergency contact
 * @param {string} [payload.bloodGroup] - Optional blood group
 * @param {string} [payload.medicalNotes] - Optional medical notes
 * @param {string} [payload.notes] - Optional general notes
 * @param {string} payload.planId - UUID of active membership plan
 * @param {string} payload.startDate - Start date ('YYYY-MM-DD')
 * @param {number} payload.initialPaymentAmount - Initial dues paid (>= 0)
 * @param {string} [payload.paymentMethod] - 'Cash' | 'UPI' | 'Card'
 * @param {string} [payload.idempotencyKey] - UUID idempotency key
 * @returns {Promise<{ data: object|null, error: Error|null, idempotencyKey: string }>}
 */
export async function onboardMember(payload) {
  if (!getIsConfigured()) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
      idempotencyKey: payload.idempotencyKey || '',
    };
  }

  // Preserve provided key or generate fresh UUID
  const idempotencyKey = payload.idempotencyKey || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `IDEMP-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

  const initialAmount = Math.max(0, Number(payload.initialPaymentAmount) || 0);

  // Exact 15 parameters expected by public.onboard_member
  const rpcParams = {
    p_name: payload.name ? payload.name.trim() : '',
    p_phone: payload.phone ? payload.phone.trim() : '',
    p_email: payload.email && payload.email.trim() ? payload.email.trim() : null,
    p_gender: payload.gender || 'Male',
    p_dob: payload.dob && payload.dob.trim() ? payload.dob.trim() : null,
    p_address: payload.address && payload.address.trim() ? payload.address.trim() : null,
    p_emergency_contact: payload.emergencyContact && payload.emergencyContact.trim() ? payload.emergencyContact.trim() : null,
    p_blood_group: payload.bloodGroup && payload.bloodGroup.trim() ? payload.bloodGroup.trim() : null,
    p_medical_notes: payload.medicalNotes && payload.medicalNotes.trim() ? payload.medicalNotes.trim() : null,
    p_notes: payload.notes && payload.notes.trim() ? payload.notes.trim() : null,
    p_plan_id: payload.planId,
    p_start_date: payload.startDate,
    p_initial_payment_amount: initialAmount,
    p_payment_method: initialAmount > 0 ? (payload.paymentMethod || 'Cash') : 'Cash',
    p_idempotency_key: idempotencyKey,
  };

  try {
    const { data, error } = await getActiveClient().rpc('onboard_member', rpcParams);

    if (error) {
      console.error('[memberService.onboardMember] RPC Error:', error);
      let userFriendlyMessage = error.message || 'Failed to complete member registration.';

      // Parse PostgreSQL custom error codes into helpful user messages
      if (error.message.includes('INVALID_ARGUMENT')) {
        userFriendlyMessage = error.message.replace(/.*?INVALID_ARGUMENT:\s*/, '');
      } else if (error.message.includes('ERR_OVERPAYMENT_EXCEEDS_BALANCE')) {
        userFriendlyMessage = 'Payment cannot exceed the plan fee.';
      } else if (error.message.includes('INVALID_PLAN')) {
        userFriendlyMessage = 'The selected membership plan is not active or could not be found.';
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
    console.error('[memberService.onboardMember] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
      idempotencyKey,
    };
  }
}

/**
 * Fetches all active members and their current active subscription details
 * from public.v_active_members view, ordered by member_code ascending.
 *
 * @returns {Promise<{ data: Array<object>|null, error: Error|null }>}
 */
export async function getActiveMembers() {
  if (!getIsConfigured()) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
    };
  }

  try {
    const { data, error } = await getActiveClient()
      .from('v_active_members')
      .select('*')
      .order('member_code', { ascending: true });

    if (error) {
      console.error('[memberService.getActiveMembers] Database error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch active members from database.'),
      };
    }

    const normalized = (data || []).map((row) => ({
      id: row.id,
      member_code: row.member_code,
      name: row.name,
      phone: row.phone,
      email: row.email || '',
      gender: row.gender || 'Male',
      dob: row.dob || '',
      address: 'Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra',
      plan: row.plan_name || 'No Plan',
      planId: row.current_subscription_id || '',
      currentSubscriptionId: row.current_subscription_id || '',
      startDate: row.start_date || '',
      expiryDate: row.expiry_date || '',
      totalFee: Number(row.total_liability ?? row.plan_price ?? 0),
      amountPaid: Number(row.amount_paid ?? 0),
      balance: Number(row.balance ?? 0),
      paymentStatus: row.payment_status || 'unpaid',
      status: row.subscription_status || 'active',
      joinDate: row.start_date || '',
      totalCheckins: 0,
      hasPT: false,
      notes: '',
      isArchived: Boolean(row.is_archived),
    }));

    return { data: normalized, error: null };
  } catch (err) {
    console.error('[memberService.getActiveMembers] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Renews an existing member's subscription via public.renew_member_subscription RPC.
 *
 * @param {object} payload
 * @param {string} payload.memberId - UUID of member
 * @param {string} payload.planId - UUID of active membership plan
 * @param {string} payload.startDate - Start date ('YYYY-MM-DD')
 * @param {boolean} [payload.carryForwardBalance=false] - Whether to roll unpaid previous dues into new contract
 * @param {number} [payload.paymentAmount=0] - Initial renewal dues paid (>= 0)
 * @param {string} [payload.paymentMethod='Cash'] - 'Cash' | 'UPI' | 'Card'
 * @param {string} [payload.idempotencyKey] - UUID idempotency key
 * @returns {Promise<{ data: object|null, error: Error|null, idempotencyKey: string }>}
 */
export async function renewMemberSubscription(payload) {
  if (!getIsConfigured()) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
      idempotencyKey: payload.idempotencyKey || '',
    };
  }

  const idempotencyKey = payload.idempotencyKey || (
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `IDEMP-RENEW-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  );

  const initialPayment = Math.max(0, Number(payload.paymentAmount) || 0);

  const rpcParams = {
    p_member_id: payload.memberId,
    p_plan_id: payload.planId,
    p_start_date: payload.startDate,
    p_carry_forward_balance: Boolean(payload.carryForwardBalance),
    p_payment_amount: initialPayment,
    p_payment_method: initialPayment > 0 ? (payload.paymentMethod || 'Cash') : 'Cash',
    p_idempotency_key: idempotencyKey,
  };

  try {
    const { data, error } = await getActiveClient().rpc('renew_member_subscription', rpcParams);

    if (error) {
      console.error('[memberService.renewMemberSubscription] RPC Error:', error);
      let userFriendlyMessage = error.message || 'Failed to renew membership subscription.';

      if (error.message.includes('ERR_OUTSTANDING_BALANCE_NOT_SETTLED')) {
        userFriendlyMessage = 'Previous contract has an unpaid balance. Either settle dues before renewing or check "Carry forward previous balance".';
      } else if (error.message.includes('ERR_OVERPAYMENT_EXCEEDS_BALANCE')) {
        userFriendlyMessage = 'Payment amount exceeds the total liability (plan fee + carried balance).';
      } else if (error.message.includes('INVALID_PLAN')) {
        userFriendlyMessage = 'The selected membership plan is not active or could not be found.';
      } else if (error.message.includes('INVALID_ARGUMENT')) {
        userFriendlyMessage = error.message.replace(/.*?INVALID_ARGUMENT:\s*/, '');
      } else if (error.message.includes('ERR_IDEMPOTENCY_PAYLOAD_MISMATCH')) {
        userFriendlyMessage = 'A renewal with divergent parameters already used this idempotency key. Please refresh.';
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
    console.error('[memberService.renewMemberSubscription] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
      idempotencyKey,
    };
  }
}


