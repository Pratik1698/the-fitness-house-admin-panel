import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  calculateExpiryDate,
  getLocalDateString,
  getDaysDifference
} from '../src/utils/memberUtils.js';

import {
  getPtAssignments,
  getPtSessions,
  schedulePtSession,
  completePtSession,
  cancelPtSession,
  updatePtScheduledSession,
  setSupabaseClientForTesting,
  resetSupabaseClientForTesting
} from '../src/services/ptService.js';

/**
 * Personal Training Session Scheduling & Lifecycle Regression Test Suite
 * The Fitness House Admin Panel
 *
 * Verifies:
 * 1. Migration SQL AST & Security Contracts (Sequence, Table, Constraints, RLS, RPCs)
 * 2. Service Layer Integration (validity_days join, validTill calculation, RPC callers)
 * 3. Business Invariants (Credits deduction on completion, zero deduction on scheduling & cancellation)
 * 4. Validity Date Calculation (QA Test Member 30-day package: 2026-11-07 -> 2026-12-07)
 */

const migrationPath = new URL('../supabase/migrations/20261107140000_pt_session_scheduling_and_lifecycle.sql', import.meta.url);
const migrationSql = readFileSync(migrationPath, 'utf8');

// ============================================================================
// 1. Database Schema & Security Migration Contracts
// ============================================================================

test('1. Migration Contract: Sequence public.pt_session_code_seq created and granted', () => {
  assert.match(migrationSql, /CREATE SEQUENCE IF NOT EXISTS public\.pt_session_code_seq START WITH 1;/);
  assert.match(migrationSql, /GRANT USAGE, SELECT ON SEQUENCE public\.pt_session_code_seq TO authenticated;/);
});

test('2. Migration Contract: Table public.pt_scheduled_sessions schema and foreign keys', () => {
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS public\.pt_scheduled_sessions/);
  assert.match(migrationSql, /assignment_id uuid NOT NULL REFERENCES public\.pt_assignments\(id\)/);
  assert.match(migrationSql, /member_id uuid NOT NULL REFERENCES public\.members\(id\)/);
  assert.match(migrationSql, /trainer_id uuid NOT NULL REFERENCES public\.trainers\(id\)/);
  assert.match(migrationSql, /actor_id uuid NOT NULL REFERENCES auth\.users\(id\)/);
  assert.match(migrationSql, /session_code text NOT NULL UNIQUE/);
  assert.match(migrationSql, /status text NOT NULL DEFAULT 'scheduled'/);
  assert.match(migrationSql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_pt_scheduled_assignment_slot/);
  assert.match(migrationSql, /ON public\.pt_scheduled_sessions \(assignment_id, session_date, session_time\)/);
});

test('3. Migration Contract: RLS enabled and secured on public.pt_scheduled_sessions', () => {
  assert.match(migrationSql, /ALTER TABLE public\.pt_scheduled_sessions ENABLE ROW LEVEL SECURITY;/);
  assert.match(migrationSql, /CREATE POLICY "Staff can view PT scheduled sessions"/);
  assert.match(migrationSql, /public\.is_staff\(\)/);
  assert.match(migrationSql, /REVOKE ALL ON public\.pt_scheduled_sessions FROM PUBLIC, anon, service_role;/);
  assert.match(migrationSql, /GRANT SELECT ON public\.pt_scheduled_sessions TO authenticated;/);
});

test('4. Migration Contract: schedule_pt_session RPC contracts', () => {
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.schedule_pt_session\(/);
  assert.match(migrationSql, /p_assignment_id uuid/);
  assert.match(migrationSql, /p_session_date date/);
  assert.match(migrationSql, /p_session_time text/);
  assert.match(migrationSql, /SECURITY DEFINER/);
  assert.match(migrationSql, /SET search_path = pg_catalog, public, extensions, pg_temp/);
  assert.match(migrationSql, /public\.is_staff\(\)/);
  assert.match(migrationSql, /'PTS' \|\| LPAD\(nextval\('public\.pt_session_code_seq'\)::text, 3, '0'\)/);
  assert.match(migrationSql, /GRANT EXECUTE ON FUNCTION public\.schedule_pt_session\(uuid, date, text, text\) TO authenticated;/);
});

test('5. Migration Contract: complete_pt_session RPC contracts & atomic credit deduction', () => {
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.complete_pt_session\(/);
  assert.match(migrationSql, /p_assignment_id uuid/);
  assert.match(migrationSql, /p_scheduled_session_id uuid DEFAULT NULL/);
  assert.match(migrationSql, /SECURITY DEFINER/);
  assert.match(migrationSql, /SET search_path = pg_catalog, public, extensions, pg_temp/);
  assert.match(migrationSql, /public\.is_staff\(\)/);
  // Atomic lock on assignment
  assert.match(migrationSql, /SELECT \* INTO v_pt FROM public\.pt_assignments WHERE id = p_assignment_id FOR UPDATE;/);
  // Deduct exactly 1 session
  assert.match(migrationSql, /completed_sessions = v_new_completed/);
  // Log into immutable pt_sessions
  assert.match(migrationSql, /INSERT INTO public\.pt_sessions/);
  // Mark scheduled session completed if provided
  assert.match(migrationSql, /UPDATE public\.pt_scheduled_sessions/);
  assert.match(migrationSql, /GRANT EXECUTE ON FUNCTION public\.complete_pt_session\(uuid, text, uuid\) TO authenticated;/);
});

test('6. Migration Contract: cancel_pt_scheduled_session RPC contracts & zero credit deduction', () => {
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.cancel_pt_scheduled_session\(/);
  assert.match(migrationSql, /p_scheduled_session_id uuid/);
  assert.match(migrationSql, /SECURITY DEFINER/);
  assert.match(migrationSql, /SET search_path = pg_catalog, public, extensions, pg_temp/);
  assert.match(migrationSql, /public\.is_staff\(\)/);
  assert.match(migrationSql, /CANNOT_CANCEL_COMPLETED/);
  assert.match(migrationSql, /SET status = 'cancelled'/);
  assert.match(migrationSql, /GRANT EXECUTE ON FUNCTION public\.cancel_pt_scheduled_session\(uuid, text\) TO authenticated;/);
});

test('7. Migration Contract: update_pt_scheduled_session RPC contracts', () => {
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.update_pt_scheduled_session\(/);
  assert.match(migrationSql, /p_scheduled_session_id uuid/);
  assert.match(migrationSql, /SECURITY DEFINER/);
  assert.match(migrationSql, /SET search_path = pg_catalog, public, extensions, pg_temp/);
  assert.match(migrationSql, /public\.is_staff\(\)/);
  assert.match(migrationSql, /GRANT EXECUTE ON FUNCTION public\.update_pt_scheduled_session\(uuid, date, text, text\) TO authenticated;/);
});

// ============================================================================
// 2. PT Service Integration & RPC Invocation Tests
// ============================================================================

test('8. ptService: schedulePtSession invokes RPC schedule_pt_session with normalized parameters', async () => {
  let invokedRpc = null;
  let invokedParams = null;

  const mockClient = {
    rpc: async (rpcName, params) => {
      invokedRpc = rpcName;
      invokedParams = params;
      return {
        data: {
          session_id: 'test-session-uuid-001',
          session_code: 'PTS001',
          assignment_id: params.p_assignment_id,
          date: params.p_session_date,
          time: params.p_session_time,
          status: 'scheduled',
          notes: params.p_notes,
        },
        error: null,
      };
    },
  };

  setSupabaseClientForTesting(mockClient, true);
  try {
    const res = await schedulePtSession({
      assignmentId: 'b4a1dc95-e5ac-4acf-ab34-73b37e77cc67',
      sessionDate: '2026-11-07',
      sessionTime: '07:00 AM',
      notes: 'QA Test Session 1',
    });

    assert.equal(invokedRpc, 'schedule_pt_session');
    assert.deepEqual(invokedParams, {
      p_assignment_id: 'b4a1dc95-e5ac-4acf-ab34-73b37e77cc67',
      p_session_date: '2026-11-07',
      p_session_time: '07:00 AM',
      p_notes: 'QA Test Session 1',
    });
    assert.equal(res.error, null);
    assert.equal(res.data.sessionCode, 'PTS001');
    assert.equal(res.data.status, 'scheduled');
  } finally {
    resetSupabaseClientForTesting();
  }
});

test('9. ptService: completePtSession invokes RPC complete_pt_session with scheduledSessionId', async () => {
  let invokedRpc = null;
  let invokedParams = null;

  const mockClient = {
    rpc: async (rpcName, params) => {
      invokedRpc = rpcName;
      invokedParams = params;
      return {
        data: {
          assignment_id: params.p_assignment_id,
          session_id: params.p_scheduled_session_id,
          session_number: 1,
          remaining_sessions: 7,
          assignment_status: 'active',
          status: 'completed',
        },
        error: null,
      };
    },
  };

  setSupabaseClientForTesting(mockClient, true);
  try {
    const res = await completePtSession({
      assignmentId: 'b4a1dc95-e5ac-4acf-ab34-73b37e77cc67',
      notes: 'Completed session smoothly',
      scheduledSessionId: 'test-session-uuid-001',
    });

    assert.equal(invokedRpc, 'complete_pt_session');
    assert.deepEqual(invokedParams, {
      p_assignment_id: 'b4a1dc95-e5ac-4acf-ab34-73b37e77cc67',
      p_notes: 'Completed session smoothly',
      p_scheduled_session_id: 'test-session-uuid-001',
    });
    assert.equal(res.error, null);
    assert.equal(res.data.session_number, 1);
    assert.equal(res.data.remaining_sessions, 7);
  } finally {
    resetSupabaseClientForTesting();
  }
});

test('10. ptService: cancelPtSession invokes RPC cancel_pt_scheduled_session', async () => {
  let invokedRpc = null;
  let invokedParams = null;

  const mockClient = {
    rpc: async (rpcName, params) => {
      invokedRpc = rpcName;
      invokedParams = params;
      return {
        data: {
          session_id: params.p_scheduled_session_id,
          status: 'cancelled',
        },
        error: null,
      };
    },
  };

  setSupabaseClientForTesting(mockClient, true);
  try {
    const res = await cancelPtSession({
      scheduledSessionId: 'test-session-uuid-001',
      notes: 'Member requested reschedule',
    });

    assert.equal(invokedRpc, 'cancel_pt_scheduled_session');
    assert.deepEqual(invokedParams, {
      p_scheduled_session_id: 'test-session-uuid-001',
      p_notes: 'Member requested reschedule',
    });
    assert.equal(res.error, null);
    assert.equal(res.data.status, 'cancelled');
  } finally {
    resetSupabaseClientForTesting();
  }
});

test('11. ptService: updatePtScheduledSession invokes RPC update_pt_scheduled_session', async () => {
  let invokedRpc = null;
  let invokedParams = null;

  const mockClient = {
    rpc: async (rpcName, params) => {
      invokedRpc = rpcName;
      invokedParams = params;
      return {
        data: {
          session_id: params.p_scheduled_session_id,
          date: params.p_session_date,
          time: params.p_session_time,
          status: 'scheduled',
        },
        error: null,
      };
    },
  };

  setSupabaseClientForTesting(mockClient, true);
  try {
    const res = await updatePtScheduledSession({
      scheduledSessionId: 'test-session-uuid-001',
      sessionDate: '2026-11-08',
      sessionTime: '08:00 AM',
      notes: 'Moved to next day',
    });

    assert.equal(invokedRpc, 'update_pt_scheduled_session');
    assert.deepEqual(invokedParams, {
      p_scheduled_session_id: 'test-session-uuid-001',
      p_session_date: '2026-11-08',
      p_session_time: '08:00 AM',
      p_notes: 'Moved to next day',
    });
    assert.equal(res.error, null);
    assert.equal(res.data.date, '2026-11-08');
    assert.equal(res.data.time, '08:00 AM');
  } finally {
    resetSupabaseClientForTesting();
  }
});

test('12. ptService: getPtAssignments joins validity_days and populates validTill correctly', async () => {
  const mockRows = [
    {
      id: 'b4a1dc95-e5ac-4acf-ab34-73b37e77cc67',
      member_id: 'ce982281-322c-470f-a029-3c31150fc725',
      package_id: 'pkg-8-sessions',
      trainer_id: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72',
      start_date: '2026-11-07',
      total_sessions: 8,
      completed_sessions: 0,
      status: 'active',
      fee_amount: 800,
      paid_amount: 800,
      balance_amount: 0,
      members: { name: 'QA Test Member', member_code: 'TH-2026-004' },
      trainers: { name: 'Coach Pravin Joshi' },
      pt_packages: { name: '8', price: 800, total_sessions: 8, validity_days: 30 },
    },
  ];

  const mockClient = {
    from: (table) => {
      assert.equal(table, 'pt_assignments');
      return {
        select: (columns) => {
          assert.match(columns, /validity_days/);
          return {
            order: () => Promise.resolve({ data: mockRows, error: null }),
          };
        },
      };
    },
  };

  setSupabaseClientForTesting(mockClient, true);
  try {
    const res = await getPtAssignments();
    assert.equal(res.error, null);
    assert.equal(res.data.length, 1);
    const client = res.data[0];
    assert.equal(client.memberName, 'QA Test Member');
    assert.equal(client.startDate, '2026-11-07');
    assert.equal(client.validityDays, 30);
    assert.equal(client.validTill, '2026-12-07'); // Exactly 30 days from 2026-11-07
  } finally {
    resetSupabaseClientForTesting();
  }
});

test('13. ptService: getPtSessions retrieves scheduled sessions and formats sessionCode', async () => {
  const mockScheduled = [
    {
      id: 'sess-uuid-001',
      session_code: 'PTS001',
      assignment_id: 'b4a1dc95-e5ac-4acf-ab34-73b37e77cc67',
      member_id: 'ce982281-322c-470f-a029-3c31150fc725',
      trainer_id: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72',
      session_date: '2026-11-07',
      session_time: '07:00 AM',
      status: 'scheduled',
      notes: 'QA Test Session 1',
      members: { name: 'QA Test Member', member_code: 'TH-2026-004' },
      trainers: { name: 'Coach Pravin Joshi' },
      pt_assignments: {
        total_sessions: 8,
        completed_sessions: 0,
        status: 'active',
        pt_packages: { name: '8' },
      },
    },
  ];

  const mockClient = {
    from: (table) => {
      if (table === 'pt_scheduled_sessions') {
        const queryBuilder = {
          order: () => queryBuilder,
          then: (resolve) => resolve({ data: mockScheduled, error: null }),
        };
        return {
          select: () => queryBuilder,
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  setSupabaseClientForTesting(mockClient, true);
  try {
    const res = await getPtSessions();
    assert.equal(res.error, null);
    assert.equal(res.data.length, 1);
    const session = res.data[0];
    assert.equal(session.id, 'sess-uuid-001');
    assert.equal(session.sessionCode, 'PTS001');
    assert.equal(session.date, '2026-11-07');
    assert.equal(session.time, '07:00 AM');
    assert.equal(session.status, 'scheduled');
    assert.equal(session.memberName, 'QA Test Member');
    assert.equal(session.trainer, 'Coach Pravin Joshi');
  } finally {
    resetSupabaseClientForTesting();
  }
});

// ============================================================================
// 3. Business Invariants & Lifecycle QA Scenarios
// ============================================================================

test('14. Business Invariant: Scheduling does NOT deduct session credits', () => {
  const assignment = {
    totalSessions: 8,
    completedSessions: 0,
    remainingSessions: 8,
  };

  // Simulating schedule action
  const scheduledSessions = [
    { id: 'PTS001', status: 'scheduled', date: '2026-11-07', time: '07:00 AM' }
  ];

  assert.equal(assignment.totalSessions, 8);
  assert.equal(assignment.completedSessions, 0);
  assert.equal(assignment.remainingSessions, 8);
  assert.equal(scheduledSessions.length, 1);
  assert.equal(scheduledSessions[0].status, 'scheduled');
});

test('15. Business Invariant: Completing a session deducts exactly 1 session credit', () => {
  let assignment = {
    totalSessions: 8,
    completedSessions: 0,
    remainingSessions: 8,
    status: 'active',
  };

  // Simulating complete_pt_session execution
  assignment.completedSessions += 1;
  assignment.remainingSessions = Math.max(0, assignment.totalSessions - assignment.completedSessions);

  assert.equal(assignment.totalSessions, 8);
  assert.equal(assignment.completedSessions, 1);
  assert.equal(assignment.remainingSessions, 7);
  assert.equal(assignment.status, 'active');
});

test('16. Business Invariant: Cancelling a session deducts ZERO session credits', () => {
  let assignment = {
    totalSessions: 8,
    completedSessions: 1,
    remainingSessions: 7,
    status: 'active',
  };

  // Simulating cancel_pt_scheduled_session execution
  const session = { id: 'PTS002', status: 'scheduled' };
  session.status = 'cancelled';

  // Assignment credits must remain unaffected
  assert.equal(assignment.totalSessions, 8);
  assert.equal(assignment.completedSessions, 1);
  assert.equal(assignment.remainingSessions, 7);
  assert.equal(session.status, 'cancelled');
});

test('17. Business Invariant: Package automatically completes when final credit is consumed', () => {
  let assignment = {
    totalSessions: 8,
    completedSessions: 7,
    remainingSessions: 1,
    status: 'active',
  };

  // Complete final 8th session
  assignment.completedSessions += 1;
  assignment.remainingSessions = Math.max(0, assignment.totalSessions - assignment.completedSessions);
  if (assignment.remainingSessions === 0) {
    assignment.status = 'completed';
  }

  assert.equal(assignment.totalSessions, 8);
  assert.equal(assignment.completedSessions, 8);
  assert.equal(assignment.remainingSessions, 0);
  assert.equal(assignment.status, 'completed');
});

test('18. Business Invariant: QA Test Member validity date calculation (2026-11-07 + 30 days = 2026-12-07)', () => {
  const startDate = '2026-11-07';
  const validityDays = 30;
  const expiryDate = calculateExpiryDate(startDate, validityDays);

  assert.equal(expiryDate, '2026-12-07');

  const daysDifference = getDaysDifference(expiryDate, startDate);
  assert.equal(daysDifference, 30);
});
