/**
 * Follow-up Service — The Fitness House Admin Panel
 * Connects manual staff follow-up tasks to Supabase PostgreSQL with RLS.
 * Separates manual follow-ups from system-generated expiry & payment reminders.
 */

import { supabase } from './supabaseClient';

/**
 * Fetch all follow-ups from public.v_member_followups view.
 * Ordered by due_date ascending, created_at descending.
 */
export async function getFollowups() {
  try {
    const { data, error } = await supabase
      .from('v_member_followups')
      .select('*')
      .order('due_date', { ascending: true });

    if (error) {
      console.error('[FollowupService] Error fetching follow-ups:', error);
      return { data: [], error };
    }

    // Map database snake_case fields to camelCase
    const formatted = (data || []).map((row) => ({
      id: row.id,
      memberId: row.member_id,
      memberCode: row.member_code,
      memberName: row.member_name,
      phone: row.phone || '',
      category: row.category,
      reason: row.reason,
      priority: row.priority,
      dueDate: row.due_date,
      status: row.status,
      notes: row.notes || '',
      outcome: row.outcome || '',
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return { data: formatted, error: null };
  } catch (err) {
    console.error('[FollowupService] Unexpected error:', err);
    return { data: [], error: err };
  }
}

/**
 * Create a new manual follow-up task via RPC create_member_followup.
 */
export async function createFollowup({
  memberId,
  category = 'general',
  reason,
  priority = 'medium',
  dueDate,
  notes = '',
}) {
  try {
    const { data, error } = await supabase.rpc('create_member_followup', {
      p_member_id: memberId,
      p_category: category,
      p_reason: reason,
      p_priority: priority,
      p_due_date: dueDate || null,
      p_notes: notes || null,
    });

    if (error) {
      console.error('[FollowupService] Error creating follow-up:', error);
      return { success: false, error };
    }

    return { success: true, followupId: data?.followup_id, error: null };
  } catch (err) {
    console.error('[FollowupService] Unexpected error creating follow-up:', err);
    return { success: false, error: err };
  }
}

/**
 * Update an existing follow-up task (reschedule, complete, outcome) via RPC update_member_followup.
 */
export async function updateFollowup(
  followupId,
  { status = null, outcome = null, rescheduleDate = null, notes = null } = {}
) {
  try {
    const { data, error } = await supabase.rpc('update_member_followup', {
      p_followup_id: followupId,
      p_status: status,
      p_outcome: outcome,
      p_reschedule_date: rescheduleDate,
      p_notes: notes,
    });

    if (error) {
      console.error('[FollowupService] Error updating follow-up:', error);
      return { success: false, error };
    }

    return { success: true, error: null };
  } catch (err) {
    console.error('[FollowupService] Unexpected error updating follow-up:', err);
    return { success: false, error: err };
  }
}

/**
 * Convenience helper to complete a follow-up.
 */
export async function completeFollowup(followupId, outcome = '') {
  return updateFollowup(followupId, { status: 'completed', outcome });
}

/**
 * Convenience helper to reschedule a follow-up.
 */
export async function rescheduleFollowup(followupId, rescheduleDate, notes = '') {
  return updateFollowup(followupId, {
    status: 'pending',
    rescheduleDate,
    notes,
  });
}
