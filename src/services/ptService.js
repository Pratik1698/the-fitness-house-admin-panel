import { supabase, isSupabaseConfigured } from './supabaseClient';

/**
 * Personal Training Service
 * The Fitness House Gym Management Admin Panel
 *
 * Provides typed methods for interacting with PT assignments and sessions in Supabase.
 */

/**
 * Fetches all PT assignments from public.pt_assignments joined with
 * members, trainers, and pt_packages.
 *
 * @returns {Promise<{ data: Array<object>|null, error: Error|null }>}
 */
export async function getPtAssignments() {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase client is not configured.'),
    };
  }

  try {
    const { data, error } = await supabase
      .from('pt_assignments')
      .select(`
        id,
        member_id,
        package_id,
        trainer_id,
        total_sessions,
        completed_sessions,
        fee_amount,
        amount_paid,
        balance,
        status,
        start_date,
        notes,
        created_at,
        members (
          id,
          name,
          member_code,
          phone
        ),
        trainers (
          id,
          name,
          phone
        ),
        pt_packages (
          id,
          name,
          total_sessions,
          price
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[ptService.getPtAssignments] Database error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch PT assignments from database.'),
      };
    }

    const normalized = (data || []).map((row) => {
      const member = row.members || {};
      const trainer = row.trainers || {};
      const pkg = row.pt_packages || {};
      const total = Number(row.total_sessions) || Number(pkg.total_sessions) || 0;
      const completed = Number(row.completed_sessions) || 0;
      const remaining = Math.max(0, total - completed);

      return {
        id: row.id,
        assignmentId: row.id,
        memberId: row.member_id,
        memberName: member.name || 'Member',
        memberCode: member.member_code || '',
        phone: member.phone || '',
        packageId: row.package_id,
        package: pkg.name || 'PT Package',
        trainerId: row.trainer_id,
        trainer: trainer.name || 'Coach Pravin Joshi',
        totalSessions: total,
        completedSessions: completed,
        remainingSessions: remaining,
        feeAmount: Number(row.fee_amount || 0),
        amountPaid: Number(row.amount_paid || 0),
        balance: Number(row.balance || 0),
        status: row.status,
        startDate: row.start_date,
        notes: row.notes || '',
      };
    });

    return { data: normalized, error: null };
  } catch (err) {
    console.error('[ptService.getPtAssignments] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Fetches completed PT sessions from public.pt_sessions joined with
 * pt_assignments, members, and trainers.
 *
 * @returns {Promise<{ data: Array<object>|null, error: Error|null }>}
 */
export async function getPtSessions() {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: new Error('Supabase client is not configured.'),
    };
  }

  try {
    const { data, error } = await supabase
      .from('pt_sessions')
      .select(`
        id,
        assignment_id,
        session_number,
        conducted_at,
        trainer_id,
        notes,
        actor_id,
        created_at,
        pt_assignments (
          id,
          member_id,
          members (
            id,
            name,
            member_code
          )
        ),
        trainers (
          id,
          name
        )
      `)
      .order('conducted_at', { ascending: false });

    if (error) {
      console.error('[ptService.getPtSessions] Database error:', error);
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch PT sessions from database.'),
      };
    }

    const normalized = (data || []).map((row) => {
      const assignment = row.pt_assignments || {};
      const member = assignment.members || {};
      const trainer = row.trainers || {};
      const dateStr = row.conducted_at ? row.conducted_at.split('T')[0] : '';
      const timeStr = row.conducted_at
        ? new Date(row.conducted_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
        : '';

      return {
        id: row.id,
        assignmentId: row.assignment_id,
        memberId: assignment.member_id,
        memberName: member.name || 'Member',
        memberCode: member.member_code || '',
        sessionNumber: row.session_number,
        trainerId: row.trainer_id,
        trainer: trainer.name || 'Coach Pravin Joshi',
        date: dateStr,
        time: timeStr,
        conductedAt: row.conducted_at,
        status: 'completed',
        notes: row.notes || `Completed session #${row.session_number}`,
      };
    });

    return { data: normalized, error: null };
  } catch (err) {
    console.error('[ptService.getPtSessions] Unexpected exception:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

// Re-export PT package management methods for unified PT service interface
export {
  getPtPackages,
  createPtPackage,
  updatePtPackage,
  togglePtPackageStatus,
  normalizePtPackage,
  validatePtPackageInput,
} from './ptPackageService';
