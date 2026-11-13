/**
 * analyticsUtils.js
 * The Fitness House Gym Management Admin Panel
 *
 * Pure domain utilities for membership analytics, dynamic plan breakdown,
 * and chart distribution calculations in Reports & Analytics.
 *
 * Safety & Design:
 * - Dynamic data source: Drives reporting from live Supabase plan catalog (allMembershipPlans),
 *   contracted subscriptions (member_subscriptions), and payments ledger.
 * - Strict Separation of Concerns:
 *   1. Current Plan Fee: membership_plans.price (current catalog rate for new subscriptions).
 *   2. Historical Contracted Fee: member_subscriptions.plan_price (frozen rate at contract time).
 *   3. Actual Revenue Collected: Sum of completed payment transactions in the selected date range.
 *   4. Active Members: Current-state active memberships (never truncated by period filters).
 *   5. Total Enrollments: All-time historical subscription counts.
 * - Authoritative Joins: Joins on plan_id foreign keys as primary relationship,
 *   with case-insensitive name fallbacks for backward compatibility and staff views.
 * - Zero Prototype Data: Completely eliminates hardcoded plansMeta and static category objects.
 */

export const PLAN_PALETTE_COLORS = [
  '#16845B', // Emerald / Brand green
  '#2196F3', // Blue
  '#FF9800', // Amber
  '#9C27B0', // Purple
  '#00BCD4', // Cyan
  '#E91E63', // Pink
  '#3F51B5', // Indigo
  '#009688', // Teal
  '#795548', // Brown
  '#607D8B', // Blue Grey
];

/**
 * Computes dynamic plan details table data for the Membership Analytics tab.
 *
 * @param {object} params
 * @param {Array<object>} [params.allMembershipPlans=[]] - All configured plans from public.membership_plans
 * @param {Array<object>} [params.membershipPlans=[]] - Active plans fallback
 * @param {Array<object>} [params.members=[]] - Members directory from public.v_active_members
 * @param {Array<object>} [params.subscriptions=[]] - Subscriptions ledger from public.member_subscriptions
 * @param {Array<object>} [params.payments=[]] - Payments ledger from public.payments
 * @param {Function} [params.isDateInRange] - Filter predicate for date-bounded revenue
 * @returns {Array<object>} Array of computed plan detail rows
 */
export function computePlanDetailsTableData({
  allMembershipPlans = [],
  membershipPlans = [],
  members = [],
  subscriptions = [],
  payments = [],
  isDateInRange = () => true,
} = {}) {
  // 1. Resolve configured plans catalog (prefer allMembershipPlans so inactive plans remain visible)
  const basePlans = (Array.isArray(allMembershipPlans) && allMembershipPlans.length > 0)
    ? allMembershipPlans
    : (Array.isArray(membershipPlans) ? membershipPlans : []);

  // Sort by duration_days ascending (e.g. Daily (1) -> Monthly (30) -> Quarterly (90) -> Half Yearly (180) -> Annual (365))
  const sortedPlans = [...basePlans].sort((a, b) => {
    const durA = Number(a.duration_days ?? a.duration ?? 0);
    const durB = Number(b.duration_days ?? b.duration ?? 0);
    return durA - durB;
  });

  // 2. Prepare lookup indexes and filtered payment lists
  const subscriptionsById = new Map();
  if (Array.isArray(subscriptions)) {
    subscriptions.forEach((s) => {
      if (s && s.id) {
        subscriptionsById.set(s.id, s);
      }
    });
  }

  const activeMembers = Array.isArray(members)
    ? members.filter(m => m && m.status === 'active')
    : [];

  // Exclude non-completed, failed, or PT payments
  const validCompletedPayments = Array.isArray(payments)
    ? payments.filter(p => p && p.status === 'completed' && p.category !== 'Personal Training')
    : [];

  const inRangeCompletedPayments = validCompletedPayments.filter(p => {
    const dateStr = p.date || (p.createdAt ? p.createdAt.split('T')[0] : '');
    return isDateInRange(dateStr);
  });

  // 3. Tracking sets to prevent duplicate assignment across plans
  const claimedActiveMemberIds = new Set();
  const claimedSubscriptionIds = new Set();
  const claimedPaymentIds = new Set();

  // 4. Map each configured plan
  const planRows = sortedPlans.map((plan) => {
    const planId = plan.id;
    const planNameLower = (plan.name || '').trim().toLowerCase();

    // A. Active Members count (Current-state metric — not affected by period filter)
    const matchedActiveMembers = activeMembers.filter((m) => {
      if (claimedActiveMemberIds.has(m.id)) return false;

      let matched = false;
      const sub = m.currentSubscriptionId ? subscriptionsById.get(m.currentSubscriptionId) : null;

      if (sub && sub.planId) {
        matched = (sub.planId === planId);
      } else if (sub && sub.planName) {
        matched = (sub.planName.trim().toLowerCase() === planNameLower);
      } else if (m.plan) {
        matched = (m.plan.trim().toLowerCase() === planNameLower);
      }

      if (matched) {
        claimedActiveMemberIds.add(m.id);
      }
      return matched;
    });

    const activeCount = matchedActiveMembers.length;

    // B. Total Enrolled count (Historical enrollments)
    let enrolledCount = 0;
    if (subscriptions.length > 0) {
      const matchedSubs = subscriptions.filter((s) => {
        if (claimedSubscriptionIds.has(s.id)) return false;

        let matched = false;
        if (s.planId) {
          matched = (s.planId === planId);
        } else if (s.planName) {
          matched = (s.planName.trim().toLowerCase() === planNameLower);
        }

        if (matched) {
          claimedSubscriptionIds.add(s.id);
        }
        return matched;
      });
      enrolledCount = matchedSubs.length;
    } else {
      // Fallback when subscriptions ledger is not loaded (e.g. staff view or legacy tests)
      const matchedMembers = members.filter((m) => {
        return m.plan && m.plan.trim().toLowerCase() === planNameLower;
      });
      enrolledCount = matchedMembers.length;
    }

    // C. Actual Revenue Collected (Sum of completed payments within the selected date range)
    const matchedPayments = inRangeCompletedPayments.filter((p) => {
      const paymentKey = p.paymentId || p.id;
      if (claimedPaymentIds.has(paymentKey)) return false;

      let matched = false;
      if (p.planId) {
        matched = (p.planId === planId);
      } else if (p.subscriptionId && subscriptionsById.has(p.subscriptionId)) {
        const sub = subscriptionsById.get(p.subscriptionId);
        matched = (sub.planId === planId) || (sub.planName && sub.planName.trim().toLowerCase() === planNameLower);
      } else if (p.relatedPlan) {
        matched = (p.relatedPlan.trim().toLowerCase() === planNameLower);
      }

      if (matched) {
        claimedPaymentIds.add(paymentKey);
      }
      return matched;
    });

    const totalRevenue = matchedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    // D. Build clean row metadata
    const durationDays = Number(plan.duration_days ?? plan.duration ?? 0);
    const durationLabel = durationDays === 1
      ? '1 Day'
      : (durationDays > 0 ? `${durationDays} Days` : 'Custom');

    return {
      id: plan.id,
      name: plan.name,
      duration: durationLabel,
      durationDays,
      price: Number(plan.price || 0),
      isActive: plan.is_active !== false,
      enrolledCount,
      activeCount,
      totalRevenue,
    };
  });

  // 5. Discover any unmatched / legacy plans in active members or completed payments
  const unmappedActiveMembers = activeMembers.filter(m => !claimedActiveMemberIds.has(m.id));
  const unmappedPayments = inRangeCompletedPayments.filter(p => !claimedPaymentIds.has(p.paymentId || p.id));

  const legacyPlanNames = new Set([
    ...unmappedActiveMembers.map(m => m.plan).filter(Boolean),
    ...unmappedPayments.map(p => p.relatedPlan).filter(Boolean),
  ]);

  legacyPlanNames.forEach((legacyName) => {
    const legacyNameLower = legacyName.trim().toLowerCase();
    const legacyMembers = unmappedActiveMembers.filter(m => m.plan && m.plan.trim().toLowerCase() === legacyNameLower);
    const legacyPayments = unmappedPayments.filter(p => p.relatedPlan && p.relatedPlan.trim().toLowerCase() === legacyNameLower);

    legacyMembers.forEach(m => claimedActiveMemberIds.add(m.id));
    legacyPayments.forEach(p => claimedPaymentIds.add(p.paymentId || p.id));

    const totalRevenue = legacyPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    planRows.push({
      id: `legacy-${legacyName}`,
      name: `${legacyName} (Legacy / Unconfigured)`,
      duration: 'Legacy',
      durationDays: 0,
      price: 0,
      isActive: false,
      isLegacy: true,
      enrolledCount: legacyMembers.length,
      activeCount: legacyMembers.length,
      totalRevenue,
    });
  });

  return planRows;
}

/**
 * Computes pie chart distribution data from the plan details table data.
 *
 * @param {Array<object>} [planDetailsTableData=[]]
 * @param {number} [activeMembersCount=0]
 * @returns {Array<object>} Array of chart slice objects with { id, name, value, color }
 */
export function computePlanDistributionData(planDetailsTableData = [], activeMembersCount = 0) {
  if (!Array.isArray(planDetailsTableData)) return [];

  // Recharts Pie requires positive values; omit 0-count plans from wedges
  const activeSlices = planDetailsTableData.filter(p => Number(p.activeCount) > 0);

  return activeSlices.map((plan, index) => ({
    id: plan.id,
    name: plan.isActive ? plan.name : `${plan.name} (Inactive)`,
    value: Number(plan.activeCount) || 0,
    color: PLAN_PALETTE_COLORS[index % PLAN_PALETTE_COLORS.length],
  }));
}

/**
 * Checks whether a given ISO date string (YYYY-MM-DD) falls within an optional date range.
 * Both boundaries are inclusive. If a boundary is omitted/null/undefined, that side is unbounded.
 *
 * @param {string} dateStr - Target date string in YYYY-MM-DD format
 * @param {string|null} [startDate] - Inclusive start date string (YYYY-MM-DD)
 * @param {string|null} [endDate] - Inclusive end date string (YYYY-MM-DD)
 * @returns {boolean}
 */
export function isDateInRange(dateStr, startDate = null, endDate = null) {
  if (!dateStr) return false;
  const afterStart = !startDate || dateStr >= startDate;
  const beforeEnd = !endDate || dateStr <= endDate;
  return afterStart && beforeEnd;
}

/**
 * Computes unified attendance metrics (visit count, latest check-in timestamp)
 * for all members based on actual check-in records.
 *
 * Rules:
 * - Excludes cancelled check-in records (status === 'cancelled' or rawStatus === 'cancelled').
 * - Matches check-ins to members by memberId with memberCode fallback without double counting.
 * - Safely ignores missing, null, and unmatched member identifiers.
 * - Resolves the latest valid check-in date/time for each member across various timestamp formats.
 * - Provides consistent visit counts across all reporting widgets.
 *
 * @param {object} params
 * @param {Array<object>} [params.members=[]] - Members directory
 * @param {Array<object>} [params.checkins=[]] - Check-in records
 * @param {Function} [params.isDateInRange] - Optional date range predicate function
 * @returns {Array<object>} Decorated members with { visitCount, lastCheckinTime, lastCheckinDate }
 */
export function computeMemberAttendanceMetrics({ members = [], checkins = [], isDateInRange: dateFilter } = {}) {
  if (!Array.isArray(members)) return [];

  const validMembers = members.filter(Boolean);

  // 1. Build member lookup indexes for robust, unambiguous identity matching
  const memberIdSet = new Set();
  const codeToIdMap = new Map();

  validMembers.forEach(m => {
    if (m && m.id) {
      memberIdSet.add(m.id);
      if (m.member_code) {
        codeToIdMap.set(m.member_code, m.id);
      }
    }
  });

  // 2. Exclude cancelled check-in records and apply optional period filter
  let validCheckins = Array.isArray(checkins)
    ? checkins.filter(c => c && c.status !== 'cancelled' && c.rawStatus !== 'cancelled')
    : [];

  if (typeof dateFilter === 'function') {
    validCheckins = validCheckins.filter(c => dateFilter(c.date));
  }

  // 3. Aggregate counts and determine latest valid check-in per member
  const attendanceMap = new Map();

  validCheckins.forEach(c => {
    if (!c) return;

    // Resolve target member ID:
    // a) Direct memberId match
    // b) Check if memberId is a member_code
    // c) Fallback to memberCode
    let targetMemberId = null;
    if (c.memberId && memberIdSet.has(c.memberId)) {
      targetMemberId = c.memberId;
    } else if (c.memberId && codeToIdMap.has(c.memberId)) {
      targetMemberId = codeToIdMap.get(c.memberId);
    } else if (c.memberCode && codeToIdMap.has(c.memberCode)) {
      targetMemberId = codeToIdMap.get(c.memberCode);
    } else if (c.memberId) {
      targetMemberId = c.memberId;
    } else if (c.memberCode) {
      targetMemberId = c.memberCode;
    }

    if (!targetMemberId) return; // Skip missing/null identifiers

    const existing = attendanceMap.get(targetMemberId) || {
      count: 0,
      latestCheckin: null,
      latestTimestamp: -1,
    };

    existing.count += 1;

    // Resolve epoch timestamp for recency comparison across ISO string, epoch number, and local date/time
    let timestamp = -1;
    if (c.checkedInAt) {
      if (typeof c.checkedInAt === 'number') {
        timestamp = c.checkedInAt;
      } else {
        const parsed = new Date(c.checkedInAt).getTime();
        if (!isNaN(parsed)) timestamp = parsed;
      }
    }
    if (timestamp === -1 && c.date) {
      if (c.time) {
        const parsed = new Date(`${c.date} ${c.time}`).getTime();
        if (!isNaN(parsed)) timestamp = parsed;
      }
      if (timestamp === -1) {
        const dateParsed = new Date(c.date).getTime();
        if (!isNaN(dateParsed)) timestamp = dateParsed;
      }
    }

    if (!existing.latestCheckin || timestamp >= existing.latestTimestamp) {
      existing.latestCheckin = c;
      existing.latestTimestamp = timestamp;
    }

    attendanceMap.set(targetMemberId, existing);
  });

  // 4. Decorate members with consistent visitCount and lastCheckinTime
  return validMembers.map(m => {
    const stats = attendanceMap.get(m.id) || (m.member_code ? attendanceMap.get(m.member_code) : null);
    const loggedCount = stats ? stats.count : 0;
    const totalVisits = Math.max(Number(m.totalCheckins) || 0, loggedCount);
    const lastCheckin = stats ? stats.latestCheckin : null;

    let lastCheckinTime = '—';
    if (lastCheckin) {
      if (lastCheckin.date && lastCheckin.time) {
        lastCheckinTime = `${lastCheckin.date} (${lastCheckin.time})`;
      } else if (lastCheckin.date) {
        lastCheckinTime = lastCheckin.date;
      } else if (lastCheckin.checkedInAt) {
        try {
          const d = new Date(lastCheckin.checkedInAt);
          lastCheckinTime = d.toISOString().split('T')[0];
        } catch {
          lastCheckinTime = '—';
        }
      }
    }

    return {
      ...m,
      visitCount: totalVisits,
      lastCheckinTime,
      lastCheckinDate: lastCheckin?.date || null,
    };
  });
}

/**
 * Computes top frequent visitors from actual check-in records.
 *
 * @param {object} params
 * @param {Array<object>} params.members - Members directory
 * @param {Array<object>} params.checkins - Check-in records
 * @param {number} [params.limit=5] - Number of top members to return
 * @param {Function} [params.isDateInRange] - Optional period filter
 * @returns {Array<object>} Top members sorted descending by visitCount
 */
export function computeTopFrequentMembers({ members = [], checkins = [], limit = 5, isDateInRange: dateFilter } = {}) {
  const decorated = computeMemberAttendanceMetrics({ members, checkins, isDateInRange: dateFilter });
  return decorated
    .sort((a, b) => {
      if (b.visitCount !== a.visitCount) {
        return b.visitCount - a.visitCount;
      }
      return (a.name || '').localeCompare(b.name || '');
    })
    .slice(0, limit);
}

/**
 * Computes active members with low activity (< threshold visits, default < 3 visits).
 * Sorted ascending by visitCount so members with 0 visits are prioritized first.
 *
 * @param {object} params
 * @param {Array<object>} params.members - Members directory
 * @param {Array<object>} params.checkins - Check-in records
 * @param {number} [params.threshold=3] - Exclusive upper bound for visits (< threshold)
 * @param {number} [params.limit=5] - Number of members to return
 * @param {Function} [params.isDateInRange] - Optional period filter
 * @returns {Array<object>} Low activity members sorted ascending by visitCount
 */
export function computeLowActivityMembers({ members = [], checkins = [], threshold = 3, limit = 5, isDateInRange: dateFilter } = {}) {
  const decorated = computeMemberAttendanceMetrics({ members, checkins, isDateInRange: dateFilter });
  return decorated
    .filter(m => m.status === 'active' && m.visitCount < threshold)
    .sort((a, b) => {
      // Primary: ascending by visit count (0 visits first, then 1, then 2)
      if (a.visitCount !== b.visitCount) {
        return a.visitCount - b.visitCount;
      }
      // Secondary: alphabetically by name for deterministic order
      return (a.name || '').localeCompare(b.name || '');
    })
    .slice(0, limit);
}
