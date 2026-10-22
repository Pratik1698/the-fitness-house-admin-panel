import { supabase, isSupabaseConfigured } from './supabaseClient';
import { calculateNotificationDaysRemaining, getLocalDateString } from '../utils/memberUtils';

/**
 * Notification & Outstanding Payments Service
 * The Fitness House Gym Management Admin Panel
 *
 * Provides typed, structured methods for interacting with persistent membership
 * expiry reminders, read-state mutations, and authoritative dues views in Supabase.
 */

/**
 * Fetches all persistent notifications from public.v_notifications view,
 * ordered by created_at descending.
 *
 * @returns {Promise<{ data: Array<object>|null, error: Error|null }>}
 */
export async function getNotifications() {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
    };
  }

  try {
    const { data, error } = await supabase
      .from('v_notifications')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[notificationService.getNotifications] Database error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch notifications from database.'),
      };
    }

    const todayStr = getLocalDateString();
    const normalized = (data || []).map((row) => {
      const targetDate = row.target_date || row.expiry_date;
      const daysRemaining = (targetDate && typeof targetDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(targetDate))
        ? calculateNotificationDaysRemaining({ targetDate }, todayStr)
        : row.days_remaining;

      return {
        id: row.id,
        memberId: row.member_id,
        subscriptionId: row.subscription_id,
        memberCode: row.member_code || '',
        memberName: row.member_name || 'Member',
        phone: row.member_phone || '',
        planName: row.plan_name || 'Plan',
        subscriptionStatus: row.subscription_status || 'active',
        startDate: row.start_date || '',
        expiryDate: row.expiry_date || '',
        currentBalance: Number(row.current_balance || 0),
        notificationType: row.notification_type,
        title: row.title,
        message: row.message,
        daysRemaining,
        targetDate: row.target_date,
        channel: row.channel || 'In-App',
        status: row.status, // 'unread' | 'read' | 'archived'
        isRead: row.status === 'read',
        readAt: row.read_at,
        readBy: row.read_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        isSuperseded: Boolean(row.is_superseded),
        isWhatsAppSent: Boolean(row.whatsapp_sent_at),
        whatsappSentAt: row.whatsapp_sent_at || null,
        whatsappSentBy: row.whatsapp_sent_by || null,
        whatsappSentByName: row.whatsapp_sent_by_name || null,
      };
    });

    return { data: normalized, error: null };
  } catch (err) {
    console.error('[notificationService.getNotifications] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Triggers the idempotent server-side reminder generator via public.generate_expiry_reminders RPC.
 * Operates in Asia/Kolkata timezone and scans active subscriptions.
 *
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function generateExpiryReminders() {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
    };
  }

  try {
    const { data, error } = await supabase.rpc('generate_expiry_reminders');

    if (error) {
      console.error('[notificationService.generateExpiryReminders] RPC error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to generate membership expiry reminders.'),
      };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[notificationService.generateExpiryReminders] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Marks a notification as read via public.mark_notification_read RPC.
 *
 * @param {string} notificationId - UUID of notification
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function markNotificationRead(notificationId) {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
    };
  }

  try {
    const { data, error } = await supabase.rpc('mark_notification_read', {
      p_notification_id: notificationId,
    });

    if (error) {
      console.error('[notificationService.markNotificationRead] RPC error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to mark notification as read.'),
      };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[notificationService.markNotificationRead] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Marks all unread notifications as read via public.mark_all_notifications_read RPC.
 *
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function markAllNotificationsRead() {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
    };
  }

  try {
    const { data, error } = await supabase.rpc('mark_all_notifications_read');

    if (error) {
      console.error('[notificationService.markAllNotificationsRead] RPC error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to mark all notifications as read.'),
      };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[notificationService.markAllNotificationsRead] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Marks a notification reminder as manually sent via WhatsApp by staff
 * via public.mark_notification_whatsapp_sent RPC.
 *
 * @param {string} notificationId - UUID of notification
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function markNotificationWhatsAppSent(notificationId) {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
    };
  }

  try {
    const { data, error } = await supabase.rpc('mark_notification_whatsapp_sent', {
      p_notification_id: notificationId,
    });

    if (error) {
      console.error('[notificationService.markNotificationWhatsAppSent] RPC error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to mark WhatsApp message as sent.'),
      };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[notificationService.markNotificationWhatsAppSent] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Fetches members with positive outstanding balances from public.v_outstanding_payments.
 *
 * @returns {Promise<{ data: Array<object>|null, error: Error|null }>}
 */
export async function getOutstandingPayments() {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
    };
  }

  try {
    const { data, error } = await supabase
      .from('v_outstanding_payments')
      .select('*')
      .order('outstanding_balance', { ascending: false });

    if (error) {
      console.error('[notificationService.getOutstandingPayments] Database error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch outstanding payment accounts.'),
      };
    }

    const normalized = (data || []).map((row) => ({
      memberId: row.member_id,
      memberCode: row.member_code || '',
      memberName: row.member_name || 'Member',
      phone: row.phone || '',
      email: row.email || '',
      isArchived: Boolean(row.is_archived),
      subscriptionId: row.subscription_id,
      planName: row.plan_name || 'Plan',
      startDate: row.start_date || '',
      expiryDate: row.expiry_date || '',
      totalAmountDue: Number(row.total_amount_due || 0),
      amountPaid: Number(row.amount_paid || 0),
      outstandingBalance: Number(row.outstanding_balance || 0),
      paymentStatus: row.payment_status || 'unpaid',
      subscriptionStatus: row.subscription_status || 'active',
    }));

    return { data: normalized, error: null };
  } catch (err) {
    console.error('[notificationService.getOutstandingPayments] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Fetches all active member dues statuses (unpaid, partial, paid) from public.v_member_dues.
 *
 * @returns {Promise<{ data: Array<object>|null, error: Error|null }>}
 */
export async function getMemberDues() {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase client is not configured. Please check your environment configuration.'),
    };
  }

  try {
    const { data, error } = await supabase
      .from('v_member_dues')
      .select('*')
      .order('member_code', { ascending: true });

    if (error) {
      console.error('[notificationService.getMemberDues] Database error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch member dues records.'),
      };
    }

    const normalized = (data || []).map((row) => ({
      memberId: row.member_id,
      memberCode: row.member_code || '',
      memberName: row.member_name || 'Member',
      phone: row.phone || '',
      email: row.email || '',
      isArchived: Boolean(row.is_archived),
      subscriptionId: row.subscription_id,
      planName: row.plan_name || 'Plan',
      startDate: row.start_date || '',
      expiryDate: row.expiry_date || '',
      totalAmountDue: Number(row.total_amount_due || 0),
      amountPaid: Number(row.amount_paid || 0),
      outstandingBalance: Number(row.outstanding_balance || 0),
      paymentStatus: row.payment_status || 'unpaid',
      subscriptionStatus: row.subscription_status || 'active',
    }));

    return { data: normalized, error: null };
  } catch (err) {
    console.error('[notificationService.getMemberDues] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Fetches the latest background scheduler/manual reminder execution status
 * via public.get_latest_reminder_job_status RPC.
 *
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function getLatestReminderJobStatus() {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase client is not configured.'),
    };
  }

  try {
    const { data, error } = await supabase.rpc('get_latest_reminder_job_status');

    if (error) {
      console.error('[notificationService.getLatestReminderJobStatus] RPC error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch reminder job status.'),
      };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[notificationService.getLatestReminderJobStatus] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
