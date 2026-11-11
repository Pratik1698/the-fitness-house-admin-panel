import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  signInWithPassword,
  signOut as authSignOut,
  getSession,
  getUserRole,
  canAcceptStaffInvitation,
  onAuthStateChange,
  isValidRole,
  changePassword as authChangePassword,
  requestPasswordReset as authRequestPasswordReset,
  resetPassword as authResetPassword,
  resendVerificationEmail as authResendVerificationEmail,
  verifyOtp as authVerifyOtp,
  parseAuthCallback,
} from '../services/authService';
import {
  getActiveMembershipPlans,
  getAllMembershipPlans,
  createMembershipPlan as createMembershipPlanService,
  updateMembershipPlan as updateMembershipPlanService,
  deactivateMembershipPlan as deactivateMembershipPlanService,
  reactivateMembershipPlan as reactivateMembershipPlanService,
} from '../services/membershipPlanService';
import {
  onboardMember as onboardMemberService,
  getActiveMembers,
  getMemberSubscriptions,
  renewMemberSubscription as renewMemberSubscriptionService,
} from '../services/memberService';
import {
  getPayments,
  recordDuesPayment as recordDuesPaymentService,
  recordPtDuesPayment as recordPtDuesPaymentService,
} from '../services/paymentService';
import {
  getPtAssignments,
  getPtSessions,
  getTrainers,
  assignPtPackage as assignPtPackageService,
  schedulePtSession as schedulePtSessionService,
  completePtSession as completePtSessionService,
  cancelPtSession as cancelPtSessionService,
  updatePtScheduledSession as updatePtScheduledSessionService,
} from '../services/ptService';
import {
  getAttendanceLogs,
  recordCheckin as recordCheckinService,
  recordCheckout as recordCheckoutService,
} from '../services/attendanceService';
import {
  getNotifications,
  generateExpiryReminders,
  markNotificationRead as markNotificationReadService,
  markAllNotificationsRead as markAllNotificationsReadService,
  markNotificationWhatsAppSent as markNotificationWhatsAppSentService,
  getOutstandingPayments,
  getLatestReminderJobStatus,
} from '../services/notificationService';
import {
  getFollowups,
  createFollowup as createFollowupService,
  updateFollowup as updateFollowupService,
  completeFollowup as completeFollowupService,
  rescheduleFollowup as rescheduleFollowupService,
} from '../services/followupService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import {
  fetchGymInfo as fetchGymInfoService,
  updateGymInfo as updateGymInfoService,
  DEFAULT_GYM_INFO,
} from '../services/gymInfoService';
import {
  getPtPackages as getPtPackagesService,
  createPtPackage as createPtPackageService,
  updatePtPackage as updatePtPackageService,
  togglePtPackageStatus as togglePtPackageStatusService,
} from '../services/ptPackageService';
import {
  fetchReminderSettings as fetchReminderSettingsService,
  updateReminderSettings as updateReminderSettingsService,
  DEFAULT_REMINDER_SETTINGS,
} from '../services/reminderSettingsService';
import {
  getStaffRoster as getStaffRosterService,
  inviteStaffMember as inviteStaffMemberService,
  updateStaffRole as updateStaffRoleService,
  toggleStaffStatus as toggleStaffStatusService,
  getPendingInvitations as getPendingInvitationsService,
  revokeInvitation as revokeInvitationService,
  resendInvitation as resendInvitationService,
  acceptInvitation as acceptInvitationService,
  getSecurityAuditLogs as getSecurityAuditLogsService,
  getStaffOperationalSummary as getStaffOperationalSummaryService,
} from '../services/staffService';
import {
  getLocalDateString,
  getDaysDifference,
  getMembershipStatus,
  getExpiryClassification,
  generateNotificationMessage,
} from '../utils/memberUtils';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // Authentication & Session State
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [pendingInvitation, setPendingInvitation] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const clearPasswordRecovery = useCallback(() => {
    setIsPasswordRecovery(false);
  }, []);

  // Initialize collections as clean empty arrays — Supabase is the sole authoritative source
  const [members, setMembers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [checkins, setCheckins] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [ptClients, setPtClients] = useState([]);
  const [ptSessions, setPtSessions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [gymInfo, setGymInfo] = useState(DEFAULT_GYM_INFO);

  // Overarching initial data loading state — tracks the initial batch of Supabase queries
  const [initialDataLoading, setInitialDataLoading] = useState(true);

  // Supabase Gym Info State (Phase 1 — Gym Profile & Info synchronization)
  const [gymInfoLoading, setGymInfoLoading] = useState(false);
  const [gymInfoError, setGymInfoError] = useState(null);
  // Stores the DB-assigned UUID of the gym_info singleton row — required for targeted updates.
  const [gymInfoDbId, setGymInfoDbId] = useState(null);
  const [gymInfoMigrationPending, setGymInfoMigrationPending] = useState(false);

  // Supabase Database Membership Plans State
  const [membershipPlans, setMembershipPlans] = useState([]);
  const [allMembershipPlans, setAllMembershipPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState(null);

  const fetchPlans = useCallback(async () => {
    setPlansLoading(true);
    setPlansError(null);
    try {
      const [allRes, activeRes] = await Promise.all([
        getAllMembershipPlans(),
        getActiveMembershipPlans(),
      ]);

      if (allRes.error && activeRes.error) {
        setPlansError(allRes.error.message || activeRes.error.message || 'Failed to load membership plans.');
        setMembershipPlans([]);
        setAllMembershipPlans([]);
      } else {
        const allData = allRes.data || [];
        const activeData = activeRes.data || allData.filter(p => p.is_active);
        setAllMembershipPlans(allData);
        setMembershipPlans(activeData);
        setPlansError(null);
      }
    } catch (err) {
      setPlansError(err instanceof Error ? err.message : 'Unexpected error loading membership plans.');
      setMembershipPlans([]);
      setAllMembershipPlans([]);
    } finally {
      setPlansLoading(false);
    }
  }, []);

  // Supabase Database PT Packages State (Phase 3)
  const [ptPackages, setPtPackages] = useState([]);
  const [allPtPackages, setAllPtPackages] = useState([]);
  const [ptPackagesLoading, setPtPackagesLoading] = useState(false);
  const [ptPackagesError, setPtPackagesError] = useState(null);

  const fetchPtPackages = useCallback(async () => {
    setPtPackagesLoading(true);
    setPtPackagesError(null);
    try {
      const [allRes, activeRes] = await Promise.all([
        getPtPackagesService({ includeInactive: true }),
        getPtPackagesService({ includeInactive: false }),
      ]);

      if (allRes.error && activeRes.error) {
        setPtPackagesError(allRes.error.message || activeRes.error.message || 'Failed to load PT packages.');
        setPtPackages([]);
        setAllPtPackages([]);
      } else {
        const allData = allRes.data || [];
        const activeData = activeRes.data || allData.filter(p => p.isActive || p.is_active);
        setAllPtPackages(allData);
        setPtPackages(activeData);
        setPtPackagesError(null);
      }
    } catch (err) {
      setPtPackagesError(err instanceof Error ? err.message : 'Unexpected error loading PT packages.');
      setPtPackages([]);
      setAllPtPackages([]);
    } finally {
      setPtPackagesLoading(false);
    }
  }, []);

  // Supabase Reminder Automation Settings State (Phase 4)
  const [reminderSettings, setReminderSettings] = useState(DEFAULT_REMINDER_SETTINGS);
  const [reminderSettingsLoading, setReminderSettingsLoading] = useState(false);
  const [reminderSettingsError, setReminderSettingsError] = useState(null);

  const fetchReminderSettingsData = useCallback(async () => {
    setReminderSettingsLoading(true);
    setReminderSettingsError(null);
    try {
      const res = await fetchReminderSettingsService();
      if (res.error) {
        setReminderSettingsError(res.error.message || 'Failed to load reminder settings.');
      } else if (res.data) {
        setReminderSettings(res.data);
        setReminderSettingsError(null);
      }
    } catch (err) {
      setReminderSettingsError(err instanceof Error ? err.message : 'Unexpected error loading reminder settings.');
    } finally {
      setReminderSettingsLoading(false);
    }
  }, []);

  // Supabase Staff Roster & Security State (Phase 5)
  const [staffRoster, setStaffRoster] = useState([]);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [securityAuditLogs, setSecurityAuditLogs] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState(null);

  const fetchStaffData = useCallback(async () => {
    setStaffLoading(true);
    setStaffError(null);
    try {
      const [rosterRes, invitesRes, auditRes] = await Promise.all([
        getStaffRosterService(),
        getPendingInvitationsService(),
        getSecurityAuditLogsService(),
      ]);

      if (rosterRes.data) setStaffRoster(rosterRes.data);
      if (invitesRes.data) setPendingInvitations(invitesRes.data);
      if (auditRes.data) setSecurityAuditLogs(auditRes.data);

      if (rosterRes.error) {
        setStaffError(rosterRes.error.message || 'Failed to load staff roster.');
      }
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : 'Unexpected error loading staff security data.');
    } finally {
      setStaffLoading(false);
    }
  }, []);

  const inviteStaffMember = useCallback(async ({ email, fullName }) => {
    const res = await inviteStaffMemberService({ email, fullName });
    if (!res.error) {
      await fetchStaffData();
    }
    return res;
  }, [fetchStaffData]);

  const updateStaffRole = useCallback(async ({ userId, role: newRole }) => {
    const res = await updateStaffRoleService({ userId, role: newRole });
    if (!res.error) {
      await fetchStaffData();
    }
    return res;
  }, [fetchStaffData]);

  const toggleStaffStatus = useCallback(async ({ userId, isActive }) => {
    const res = await toggleStaffStatusService({ userId, isActive });
    if (!res.error) {
      await fetchStaffData();
    }
    return res;
  }, [fetchStaffData]);

  const revokeInvitation = useCallback(async ({ invitationId }) => {
    const res = await revokeInvitationService({ invitationId });
    if (!res.error) {
      await fetchStaffData();
    }
    return res;
  }, [fetchStaffData]);

  const resendInvitation = useCallback(async ({ invitationId, email, fullName }) => {
    const res = await resendInvitationService({ invitationId, email, fullName });
    if (!res.error) {
      await fetchStaffData();
    }
    return res;
  }, [fetchStaffData]);

  // ---------------------------------------------------------------------------
  // Supabase Gym Info Fetch (Phase 1 — Gym Profile & Info synchronization)
  // ---------------------------------------------------------------------------
  const fetchGymInfo = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setGymInfoLoading(true);
    setGymInfoError(null);
    try {
      const { data, error, migrationPending } = await fetchGymInfoService();
      setGymInfoMigrationPending(Boolean(migrationPending));
      if (error) {
        setGymInfoError(error.message || 'Failed to load gym profile.');
        // Do NOT overwrite gymInfo state — keep showing the placeholder so
        // the UI remains functional even when the DB read fails.
      } else if (data) {
        setGymInfoDbId(data.id);
        setGymInfo(data);
        setGymInfoError(null);
      }
    } catch (err) {
      setGymInfoError(err instanceof Error ? err.message : 'Unexpected error loading gym profile.');
    } finally {
      setGymInfoLoading(false);
    }
  }, []);

  // Supabase Database Members Directory State
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState(null);

  const fetchMembers = useCallback(async () => {
    setMembersLoading(true);
    setMembersError(null);
    try {
      const { data, error } = await getActiveMembers();
      if (error) {
        setMembersError(error.message || 'Failed to load members from database.');
      } else {
        setMembers(data || []);
        setMembersError(null);
      }
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Unexpected error loading members.');
    } finally {
      setMembersLoading(false);
    }
  }, []);

  // Supabase Database Payments Ledger State
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState(null);

  const fetchPayments = useCallback(async () => {
    // Financial isolation: staff accounts must never load the payments ledger
    if (role !== 'admin') {
      setPayments([]);
      setPaymentsLoading(false);
      setPaymentsError(null);
      return;
    }

    setPaymentsLoading(true);
    setPaymentsError(null);
    try {
      const { data, error } = await getPayments();
      if (error) {
        setPaymentsError(error.message || 'Failed to load payments from database.');
      } else {
        setPayments(data || []);
        setPaymentsError(null);
      }
    } catch (err) {
      setPaymentsError(err instanceof Error ? err.message : 'Unexpected error loading payments.');
    } finally {
      setPaymentsLoading(false);
    }
  }, [role]);

  // Supabase Database Subscriptions Ledger State
  const [subscriptions, setSubscriptions] = useState([]);
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(false);
  const [subscriptionsError, setSubscriptionsError] = useState(null);

  const fetchSubscriptions = useCallback(async () => {
    // Financial isolation: staff accounts must not query full member subscriptions
    if (role !== 'admin') {
      setSubscriptions([]);
      setSubscriptionsLoading(false);
      setSubscriptionsError(null);
      return;
    }

    setSubscriptionsLoading(true);
    setSubscriptionsError(null);
    try {
      const { data, error } = await getMemberSubscriptions();
      if (error) {
        setSubscriptionsError(error.message || 'Failed to load member subscriptions from database.');
      } else {
        setSubscriptions(data || []);
        setSubscriptionsError(null);
      }
    } catch (err) {
      setSubscriptionsError(err instanceof Error ? err.message : 'Unexpected error loading subscriptions.');
    } finally {
      setSubscriptionsLoading(false);
    }
  }, [role]);

  // Supabase Database Personal Training State
  const [ptLoading, setPtLoading] = useState(false);
  const [ptError, setPtError] = useState(null);
  const [trainers, setTrainers] = useState([
    { id: '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72', name: 'Coach Pravin Joshi', phone: '+91 7385846525', is_active: true }
  ]);
  const [trainersLoading, setTrainersLoading] = useState(false);
  const [trainersError, setTrainersError] = useState(null);

  const fetchTrainers = useCallback(async () => {
    setTrainersLoading(true);
    setTrainersError(null);
    try {
      const { data, error } = await getTrainers();
      if (error) {
        setTrainersError(error.message || 'Failed to fetch trainers.');
      } else if (data && data.length > 0) {
        setTrainers(data);
        setTrainersError(null);
      }
    } catch (err) {
      setTrainersError(err instanceof Error ? err.message : 'Unexpected error loading trainers.');
    } finally {
      setTrainersLoading(false);
    }
  }, []);

  const fetchPtData = useCallback(async () => {
    setPtLoading(true);
    setPtError(null);
    try {
      const [assignmentsRes, sessionsRes, trainersRes] = await Promise.all([
        getPtAssignments({ includeFinancials: role === 'admin' }),
        getPtSessions(),
        getTrainers(),
      ]);
      if (assignmentsRes.data) {
        setPtClients(assignmentsRes.data);
      }
      if (sessionsRes.data) {
        setPtSessions(sessionsRes.data);
      }
      if (trainersRes.data && trainersRes.data.length > 0) {
        setTrainers(trainersRes.data);
      }
    } catch (err) {
      setPtError(err instanceof Error ? err.message : 'Unexpected error loading PT data.');
    } finally {
      setPtLoading(false);
    }
  }, [role]);

  // Supabase Database Attendance & Check-ins State
  const [checkinsLoading, setCheckinsLoading] = useState(false);
  const [checkinsError, setCheckinsError] = useState(null);

  const fetchCheckins = useCallback(async () => {
    setCheckinsLoading(true);
    setCheckinsError(null);
    try {
      const { data, error } = await getAttendanceLogs();
      if (error) {
        setCheckinsError(error.message || 'Failed to load attendance logs.');
        setCheckins([]);
      } else {
        setCheckins(data || []);
        setCheckinsError(null);
      }
    } catch (err) {
      setCheckinsError(err instanceof Error ? err.message : 'Unexpected error loading attendance logs.');
      setCheckins([]);
    } finally {
      setCheckinsLoading(false);
    }
  }, []);

  // Supabase Database Persistent Notifications & Expiry Reminders State
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState(null);
  const [latestReminderJobStatus, setLatestReminderJobStatus] = useState(null);
  const [refreshingReminders, setRefreshingReminders] = useState(false);

  // Pure read: fetches persisted notifications and latest execution status without triggering generation
  const fetchNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    setNotificationsError(null);
    try {
      const [{ data, error }, { data: jobStatus }] = await Promise.all([
        getNotifications(),
        getLatestReminderJobStatus(),
      ]);
      if (error) {
        setNotificationsError(error.message || 'Failed to load notifications.');
      } else {
        setNotifications(data || []);
        setNotificationsError(null);
      }
      if (jobStatus) {
        setLatestReminderJobStatus(jobStatus);
      }
    } catch (err) {
      setNotificationsError(err instanceof Error ? err.message : 'Unexpected error loading notifications.');
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  // Explicit admin action: triggers server-side generation, then refreshes notifications and execution status
  const triggerManualReminderRefresh = useCallback(async () => {
    setRefreshingReminders(true);
    try {
      const { data: genResult, error: genError } = await generateExpiryReminders();
      if (genError) {
        throw genError;
      }

      // Re-fetch persisted notifications and latest job status
      const [{ data: freshNotifs }, { data: freshJobStatus }] = await Promise.all([
        getNotifications(),
        getLatestReminderJobStatus(),
      ]);

      if (freshNotifs) {
        setNotifications(freshNotifs);
      }
      if (freshJobStatus) {
        setLatestReminderJobStatus(freshJobStatus);
      }

      return genResult || { success: true };
    } finally {
      setRefreshingReminders(false);
    }
  }, []);

  const markNotificationAsRead = useCallback(async (notificationId) => {
    if (!isSupabaseConfigured) {
      setNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, status: 'read', isRead: true } : n));
      return;
    }
    const { error } = await markNotificationReadService(notificationId);
    if (error) {
      throw error;
    }
    setNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, status: 'read', isRead: true, readAt: new Date().toISOString() } : n));
  }, []);

  const markAllNotificationsAsRead = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setNotifications(prev => prev.map(n => ({ ...n, status: 'read', isRead: true })));
      return;
    }
    const { error } = await markAllNotificationsReadService();
    if (error) {
      throw error;
    }
    setNotifications(prev => prev.map(n => ({ ...n, status: 'read', isRead: true, readAt: new Date().toISOString() })));
  }, []);

  // Staff action: explicitly records that staff sent the message manually on WhatsApp
  // Note: Keeps unread/read state completely independent.
  const markNotificationAsWhatsAppSent = useCallback(async (notificationId) => {
    if (!isSupabaseConfigured) {
      setNotifications(prev => prev.map(n => n.id === notificationId ? {
        ...n,
        isWhatsAppSent: true,
        whatsappSentAt: new Date().toISOString(),
        whatsappSentByName: 'Staff',
      } : n));
      return { success: true };
    }

    const { data, error } = await markNotificationWhatsAppSentService(notificationId);
    if (error) {
      throw error;
    }

    setNotifications(prev => prev.map(n => n.id === notificationId ? {
      ...n,
      isWhatsAppSent: true,
      whatsappSentAt: data?.whatsapp_sent_at || new Date().toISOString(),
      whatsappSentBy: data?.whatsapp_sent_by || null,
      whatsappSentByName: data?.whatsapp_sent_by_name || 'Staff',
    } : n));

    return data;
  }, []);

  // Supabase Database Persistent Member Follow-ups State
  const [followupsLoading, setFollowupsLoading] = useState(false);
  const [followupsError, setFollowupsError] = useState(null);

  const fetchFollowups = useCallback(async () => {
    if (!session?.user || !isSupabaseConfigured) {
      return;
    }
    setFollowupsLoading(true);
    setFollowupsError(null);
    try {
      const { data, error } = await getFollowups();
      if (error) {
        setFollowupsError(error.message || 'Failed to load follow-ups.');
      } else {
        setFollowups(data || []);
        setFollowupsError(null);
      }
    } catch (err) {
      setFollowupsError(err instanceof Error ? err.message : 'Unexpected error loading follow-ups.');
    } finally {
      setFollowupsLoading(false);
    }
  }, [session]);

  // Authentication Lifecycle & Session Synchronization
  useEffect(() => {
    let isMounted = true;

    async function initSession() {
      try {
        setAuthLoading(true);

        // Detect password recovery callback parameters from URL
        const callback = parseAuthCallback(typeof window !== 'undefined' ? window.location : null);
        const isRecoveryUrl = callback.type === 'recovery' || Boolean(typeof window !== 'undefined' && window.location.hash?.includes('type=recovery'));
        if (isRecoveryUrl && isMounted) {
          setIsPasswordRecovery(true);
        }

        const { session: currentSession, error } = await getSession();
        if (error) {
          if (isMounted) {
            setAuthError(error.message);
            setSession(null);
            setUser(null);
            setRole(null);
            setPendingInvitation(false);
            setIsPasswordRecovery(false);
            setAuthLoading(false);
          }
          return;
        }

        if (currentSession?.user) {
          const emailVerified = Boolean(currentSession.user.email_confirmed_at);
          if (!emailVerified) {
            if (isMounted) {
              setSession(currentSession);
              setUser(currentSession.user);
              setRole(null);
              setPendingInvitation(false);
              setAuthError('Please verify your email address to continue.');
            }
          } else {
            const userRole = await getUserRole(currentSession.user.id);
            if (isMounted) {
              if (isValidRole(userRole)) {
                setSession(currentSession);
                setUser(currentSession.user);
                setRole(userRole);
                setPendingInvitation(false);
                setAuthError(null);
              } else {
                const canAcceptInvitation = await canAcceptStaffInvitation();
                if (canAcceptInvitation) {
                  setSession(currentSession);
                  setUser(currentSession.user);
                  setRole(null);
                  setPendingInvitation(true);
                  setAuthError(null);
                } else {
                  // Fail closed: only a valid invitation may remain on the public acceptance screen.
                  await authSignOut();
                  setSession(null);
                  setUser(null);
                  setRole(null);
                  setPendingInvitation(false);
                  setAuthError('Your account is not authorized to access this application. Please contact the gym administrator.');
                }
              }
            }
          }
        } else {
          if (isMounted) {
            setSession(null);
            setUser(null);
            setRole(null);
            setPendingInvitation(false);
            setAuthError(null);
            setGymInfoMigrationPending(false);
          }
        }
      } catch (err) {
        if (isMounted) {
          setAuthError(err instanceof Error ? err.message : String(err));
          setSession(null);
          setUser(null);
          setRole(null);
          setPendingInvitation(false);
          setGymInfoMigrationPending(false);
        }
      } finally {
        if (isMounted) {
          setAuthLoading(false);
        }
      }
    }

    initSession();

    // Subscribe to auth state changes
    const unsubscribe = onAuthStateChange(async (event, newSession) => {
      if (!isMounted) return;

      if (event === 'SIGNED_OUT' || !newSession) {
        setSession(null);
        setUser(null);
        setRole(null);
        setPendingInvitation(false);
        setIsPasswordRecovery(false);
        setAuthError(null);
        setGymInfoMigrationPending(false);
        setAuthLoading(false);
        return;
      }

      if (event === 'PASSWORD_RECOVERY') {
        setSession(newSession);
        setUser(newSession?.user || null);
        setIsPasswordRecovery(true);
        setPendingInvitation(false);
        setAuthLoading(false);
        return;
      }

      if (event === 'USER_UPDATED') {
        setIsPasswordRecovery(false);
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        if (newSession?.user) {
          const emailVerified = Boolean(newSession.user.email_confirmed_at);
          if (!emailVerified) {
            if (isMounted) {
              setSession(newSession);
              setUser(newSession.user);
              setRole(null);
              setPendingInvitation(false);
              setAuthError('Please verify your email address to continue.');
            }
          } else {
            const userRole = await getUserRole(newSession.user.id);
            if (!isMounted) return;

            if (isValidRole(userRole)) {
              setSession(newSession);
              setUser(newSession.user);
              setRole(userRole);
              setPendingInvitation(false);
              setAuthError(null);
            } else {
              const canAcceptInvitation = await canAcceptStaffInvitation();
              if (!isMounted) return;
              if (canAcceptInvitation) {
                setSession(newSession);
                setUser(newSession.user);
                setRole(null);
                setPendingInvitation(true);
                setAuthError(null);
              } else {
                // Fail closed: only a valid invitation may remain on the public acceptance screen.
                await authSignOut();
                setSession(null);
                setUser(null);
                setRole(null);
                setPendingInvitation(false);
                setAuthError('Your account is not authorized to access this application. Please contact the gym administrator.');
              }
            }
          }
        }
        setAuthLoading(false);
      }
    });

    return () => {
      isMounted = false;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const login = useCallback(async (email, password) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const result = await signInWithPassword(email, password);
      if (result.error) {
        setAuthError(result.error.message);
        setSession(null);
        setUser(null);
        setRole(null);
        setPendingInvitation(false);
        return { success: false, error: result.error };
      }
      setSession(result.session);
      setUser(result.user);
      setRole(result.role);
      setPendingInvitation(Boolean(result.pendingInvitation));
      setAuthError(null);
      return { success: true, user: result.user, role: result.role, pendingInvitation: Boolean(result.pendingInvitation) };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setAuthError(errMsg);
      return { success: false, error: err };
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const acceptStaffInvitation = useCallback(async () => {
    const result = await acceptInvitationService();
    if (result.error) return result;

    const currentUserId = user?.id || session?.user?.id || (await getSession())?.session?.user?.id;
    const resolvedRole = await getUserRole(currentUserId);
    if (!isValidRole(resolvedRole)) {
      return {
        data: null,
        error: new Error('The invitation was accepted, but the active staff role could not be confirmed. Please sign in again or contact an administrator.'),
      };
    }

    if (!user && (session?.user || (await getSession())?.session?.user)) {
      setUser(session?.user || (await getSession())?.session?.user);
    }
    setRole(resolvedRole);
    setPendingInvitation(false);
    setAuthError(null);
    return { data: result.data, error: null, role: resolvedRole };
  }, [user, session]);

  const logout = useCallback(async () => {
    setAuthLoading(true);
    try {
      await authSignOut();
    } finally {
      setSession(null);
      setUser(null);
      setRole(null);
      setPendingInvitation(false);
      setIsPasswordRecovery(false);
      setAuthError(null);
      setGymInfoMigrationPending(false);
      setPtPackages([]);
      setAllPtPackages([]);
      setReminderSettings(DEFAULT_REMINDER_SETTINGS);
      setStaffRoster([]);
      setPendingInvitations([]);
      setSecurityAuditLogs([]);
      setAuthLoading(false);
    }
  }, []);

  // Fetch active membership plans, members, payments, PT data, attendance, notifications, followups,
  // PT packages, reminder settings, staff data, and gym profile whenever session is authenticated and authorized
  useEffect(() => {
    let isMounted = true;
    if (session?.user && session.user.email_confirmed_at && isValidRole(role)) {
      setInitialDataLoading(true);
      const fetches = [
        fetchGymInfo(),
        fetchPlans(),
        fetchMembers(),
        role === 'admin' ? fetchPayments() : Promise.resolve(),
        role === 'admin' ? fetchSubscriptions() : Promise.resolve(),
        fetchPtData(),
        fetchPtPackages(),
        fetchReminderSettingsData(),
        fetchStaffData(),
        fetchCheckins(),
        fetchNotifications(),
        fetchFollowups(),
      ];
      Promise.allSettled(fetches).finally(() => {
        if (isMounted) {
          setInitialDataLoading(false);
        }
      });
    } else if (!session?.user) {
      // Unauthenticated: clean empty arrays, no demo seeding
      setGymInfoDbId(null);
      setGymInfoLoading(false);
      setGymInfoError(null);
      setGymInfo(DEFAULT_GYM_INFO);
      setMembershipPlans([]);
      setAllMembershipPlans([]);
      setPlansLoading(false);
      setPlansError(null);
      setPtPackages([]);
      setAllPtPackages([]);
      setPtPackagesLoading(false);
      setPtPackagesError(null);
      setReminderSettings(DEFAULT_REMINDER_SETTINGS);
      setReminderSettingsLoading(false);
      setReminderSettingsError(null);
      setMembers([]);
      setMembersLoading(false);
      setMembersError(null);
      setPayments([]);
      setPaymentsLoading(false);
      setPaymentsError(null);
      setSubscriptions([]);
      setSubscriptionsLoading(false);
      setSubscriptionsError(null);
      setPtClients([]);
      setPtSessions([]);
      setPtLoading(false);
      setPtError(null);
      setCheckins([]);
      setCheckinsLoading(false);
      setCheckinsError(null);
      setFollowups([]);
      setFollowupsLoading(false);
      setFollowupsError(null);
      setNotifications([]);
      setNotificationsLoading(false);
      setNotificationsError(null);
      setInitialDataLoading(false);
    }
    return () => {
      isMounted = false;
    };
  }, [session, role, fetchGymInfo, fetchPlans, fetchMembers, fetchPayments, fetchSubscriptions, fetchPtData, fetchPtPackages, fetchReminderSettingsData, fetchStaffData, fetchCheckins, fetchNotifications, fetchFollowups]);

  /**
   * Registers a new gym member via Supabase public.onboard_member RPC
   * and records the initial payment receipt (if amountPaid > 0)
   */
  const addMember = useCallback(async (memberData) => {
    // 1. Invoke Supabase onboard_member RPC via memberService
    const res = await onboardMemberService({
      name: memberData.name,
      phone: memberData.phone,
      email: memberData.email,
      gender: memberData.gender,
      dob: memberData.dob,
      address: memberData.address,
      emergencyContact: memberData.emergencyContact,
      bloodGroup: memberData.bloodGroup,
      medicalNotes: memberData.medicalNotes,
      notes: memberData.notes,
      planId: memberData.planId,
      startDate: memberData.startDate,
      initialPaymentAmount: memberData.amountPaid,
      paymentMethod: memberData.paymentMethod,
      idempotencyKey: memberData.idempotencyKey,
    });

    if (res.error) {
      throw res.error;
    }

    const dbResult = res.data;
    const today = getLocalDateString();

    // 2. Prepend the new member into local state using the real database IDs and attributes
    const newMember = {
      ...memberData,
      id: dbResult.member_id,
      member_code: dbResult.member_code,
      name: memberData.name,
      phone: memberData.phone,
      email: memberData.email || '',
      gender: memberData.gender || 'Male',
      dob: memberData.dob || '',
      address: memberData.address || 'Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra',
      plan: dbResult.plan_name,
      planId: memberData.planId,
      startDate: dbResult.start_date,
      expiryDate: dbResult.expiry_date,
      totalFee: role === 'admin' && (dbResult.total_liability ?? dbResult.plan_price) !== null && (dbResult.total_liability ?? dbResult.plan_price) !== undefined
        ? Number(dbResult.total_liability ?? dbResult.plan_price)
        : null,
      amountPaid: role === 'admin' && dbResult.initial_payment_amount !== null && dbResult.initial_payment_amount !== undefined
        ? Number(dbResult.initial_payment_amount)
        : null,
      balance: role === 'admin' && dbResult.outstanding_balance !== null && dbResult.outstanding_balance !== undefined
        ? Number(dbResult.outstanding_balance)
        : null,
      status: getMembershipStatus({ expiryDate: dbResult.expiry_date }, today),
      joinDate: dbResult.start_date || today,
      totalCheckins: 0,
      hasPT: memberData.hasPT || false,
      notes: memberData.notes || '',
      receiptNumber: dbResult.receipt_number,
    };

    // Refresh member directory from database to cleanly display the new record without duplicates
    const { data: refreshedMembers, error: refreshError } = await getActiveMembers();
    if (!refreshError && refreshedMembers) {
      setMembers(refreshedMembers);
    } else {
      // Fallback: prepend new member if database refresh failed, ensuring no duplicate
      setMembers(prev => {
        const exists = prev.some(m => m.id === newMember.id || m.member_code === newMember.member_code);
        return exists ? prev : [newMember, ...prev];
      });
    }

    // Refresh payments ledger from database
    await fetchPayments();

    // 3. Record initial payment receipt in payments state if payment was collected
    if (dbResult.payment_id && Number(dbResult.initial_payment_amount) > 0) {
      const isCompleted = Number(dbResult.outstanding_balance) === 0;
      const initialPayment = {
        id: dbResult.payment_id,
        receiptNumber: dbResult.receipt_number,
        date: dbResult.start_date || today,
        memberId: dbResult.member_id,
        memberName: newMember.name,
        category: 'Membership',
        relatedPlan: dbResult.plan_name,
        amount: Number(dbResult.initial_payment_amount),
        method: memberData.paymentMethod || 'Cash',
        status: isCompleted ? 'completed' : 'partial',
        purpose: 'Initial Registration Fee',
        notes: memberData.notes
          ? `Initial registration: ${memberData.notes}`
          : `Initial membership registration (${dbResult.plan_name})`,
      };
      setPayments(prev => {
        const exists = prev.some(p => p.id === initialPayment.id || p.paymentId === initialPayment.id || (initialPayment.receiptNumber && p.receiptNumber === initialPayment.receiptNumber));
        return exists ? prev : [initialPayment, ...prev];
      });
    }

    return {
      ...newMember,
      ...dbResult,
    };
  }, []);

  /**
   * Updates existing member information without resetting membership dates or history
   */
  const updateMember = useCallback((id, updates) => {
    const today = getLocalDateString();
    setMembers(prev => prev.map(m => {
      if (m.id === id) {
        const updated = { ...m, ...updates };
        if (updates.expiryDate) {
          updated.status = getMembershipStatus(updated, today);
        }
        return updated;
      }
      return m;
    }));

    // Keep member name in sync across associated records
    if (updates.name) {
      setPayments(prev => prev.map(p => p.memberId === id ? { ...p, memberName: updates.name } : p));
      setCheckins(prev => prev.map(c => c.memberId === id ? { ...c, memberName: updates.name } : c));
      setFollowups(prev => prev.map(f => f.memberId === id ? { ...f, memberName: updates.name } : f));
      setPtClients(prev => prev.map(pt => pt.memberId === id ? { ...pt, memberName: updates.name } : pt));
      setPtSessions(prev => prev.map(s => s.memberId === id ? { ...s, memberName: updates.name } : s));
    }
  }, []);

  /**
   * Records a member dues payment via public.record_dues_payment RPC in Supabase.
   * Updates database ledger and refreshes live member and payment data.
   */
  const recordDuesPayment = useCallback(async ({
    memberId,
    subscriptionId,
    amount,
    paymentMethod = 'Cash',
    notes = '',
    idempotencyKey,
  }) => {
    if (session?.user && isSupabaseConfigured) {
      // Find member if subscriptionId is not passed directly
      let subId = subscriptionId;
      if (!subId && memberId) {
        const targetMember = members.find(m => m.id === memberId || m.member_code === memberId);
        subId = targetMember?.currentSubscriptionId || targetMember?.planId;
      }

      if (!subId) {
        throw new Error('Unable to find an active subscription for this member.');
      }

      const res = await recordDuesPaymentService({
        memberId,
        subscriptionId: subId,
        amount: Number(amount),
        paymentMethod: paymentMethod || 'Cash',
        notes: notes || '',
        idempotencyKey,
      });

      if (res.error) {
        throw res.error;
      }

      // Refresh directory, payments ledger, and subscriptions from the database
      await Promise.all([fetchMembers(), fetchPayments(), fetchSubscriptions()]);

      return res.data;
    }

    throw new Error('Authentication required: Supabase is the sole authoritative data source.');
  }, [session, fetchMembers, fetchPayments, fetchSubscriptions]);

  const addPayment = recordDuesPayment;

  /**
   * Logs a check-in persistently via public.record_member_checkin RPC when authenticated
   */
  const addCheckin = useCallback(async (checkinData) => {
    if (session?.user && isSupabaseConfigured) {
      const res = await recordCheckinService({
        memberId: checkinData.memberId,
        notes: checkinData.notes || '',
      });

      if (res.error) {
        throw res.error;
      }

      // Refresh attendance records from the database
      await fetchCheckins();
      return res.data;
    }

    throw new Error('Authentication required: Supabase is the sole authoritative data source.');
  }, [session, fetchCheckins]);

  /**
   * Records member check-out via public.record_member_checkout RPC when authenticated
   */
  const checkoutMember = useCallback(async ({ checkinId, notes = '' }) => {
    if (session?.user && isSupabaseConfigured) {
      const res = await recordCheckoutService({ checkinId, notes });
      if (res.error) {
        throw res.error;
      }
      await fetchCheckins();
      return res.data;
    }

    throw new Error('Authentication required: Supabase is the sole authoritative data source.');
  }, [session, fetchCheckins]);

  /**
   * Adds a new PT assignment for a member via authoritative database RPC or local fallback.
   */
  const addPtClient = useCallback(async (clientData, paymentData = null) => {
    // If Supabase is configured and user is authenticated, use authoritative RPC
    if (session?.user && isSupabaseConfigured) {
      try {
        let trainerId = clientData.trainerId;
        if (!trainerId) {
          const found = trainers.find(t => t.name?.toLowerCase() === (clientData.trainer || '').toLowerCase());
          trainerId = found ? found.id : '2cc58cc8-31c0-4f09-bec4-96ba7aea9a72';
        }

        // Enforce role-based financial isolation: staff cannot record initial payment
        const paymentAmount = (role === 'admin' && paymentData?.amount) ? Number(paymentData.amount) : 0;
        const paymentMethod = paymentAmount > 0 ? (paymentData?.method || 'Cash') : null;

        const rpcPayload = {
          memberId: clientData.memberId,
          packageId: clientData.packageId,
          trainerId,
          startDate: clientData.startDate || getLocalDateString(),
          initialPaymentAmount: paymentAmount,
          paymentMethod,
          notes: (clientData.notes || paymentData?.notes || '').trim(),
        };

        const { data, error } = await assignPtPackageService(rpcPayload);
        if (error) {
          console.error('[AppContext.addPtClient] assignPtPackage error:', error);
          return { success: false, error: error.message || 'Failed to assign PT package.' };
        }

        // Refresh authoritative datasets
        await Promise.all([
          fetchPtData(),
          fetchPayments(),
          fetchMembers(),
        ]);

        return { success: true, data };
      } catch (err) {
        console.error('[AppContext.addPtClient] Unexpected exception:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    return { success: false, error: 'Authentication required: Supabase is the sole authoritative data source.' };
  }, [session, role, trainers, fetchPtData, fetchPayments, fetchMembers, addPayment]);

  /**
   * Updates an existing PT client's assignment
   */
  const updatePtClient = useCallback((memberId, updates) => {
    setPtClients(prev => prev.map(c => {
      if (c.memberId === memberId) {
        const merged = { ...c, ...updates };
        const total = Number(merged.totalSessions) || c.totalSessions;
        const completed = Number(merged.completedSessions) ?? c.completedSessions;
        merged.totalSessions = total;
        merged.completedSessions = completed;
        merged.remainingSessions = Math.max(0, total - completed);
        if (merged.remainingSessions === 0 && merged.status === 'active') {
          merged.status = 'completed';
        }
        return merged;
      }
      return c;
    }));
  }, []);

  /**
   * Schedules a new PT training session with Supabase persistence
   */
  const addPtSession = useCallback(async (sessionData) => {
    if (session?.user && isSupabaseConfigured) {
      try {
        const client = ptClients.find(c => c.memberId === sessionData.memberId && c.status === 'active');
        const assignmentId = sessionData.assignmentId || client?.assignmentId || client?.id;
        if (!assignmentId) {
          return { success: false, error: 'Active PT assignment not found for selected member.' };
        }

        const res = await schedulePtSessionService({
          assignmentId,
          sessionDate: sessionData.date || getLocalDateString(),
          sessionTime: sessionData.time || '07:00 AM',
          notes: sessionData.notes || '',
        });

        if (res.error) {
          console.error('[AppContext.addPtSession] schedulePtSession error:', res.error);
          return { success: false, error: res.error.message || 'Failed to schedule session.' };
        }

        // Refresh authoritative datasets
        await fetchPtData();
        return { success: true, data: res.data };
      } catch (err) {
        console.error('[AppContext.addPtSession] Unexpected exception:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    return { success: false, error: 'Authentication required: Supabase is the sole authoritative data source.' };
  }, [session, ptClients, fetchPtData]);

  /**
   * Updates a session's status with consistent session count tracking (fallback & in-memory)
   */
  const updatePtSessionStatus = useCallback((sessionId, newStatus, notesUpdate = null) => {
    const session = ptSessions.find(s => s.id === sessionId);
    if (!session) return;
    const oldStatus = session.status;
    if (oldStatus === newStatus && !notesUpdate) return;

    // Update Session
    setPtSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        return {
          ...s,
          status: newStatus,
          notes: notesUpdate !== null ? notesUpdate : s.notes,
        };
      }
      return s;
    }));

    // Update Client session counts
    if (session.memberId) {
      // 1. Moving to completed (from non-completed)
      if (newStatus === 'completed' && oldStatus !== 'completed') {
        setPtClients(prev => prev.map(c => {
          if (c.memberId === session.memberId) {
            if (Number(c.remainingSessions) <= 0) return c;
            const completed = (Number(c.completedSessions) || 0) + 1;
            const remaining = Math.max(0, (Number(c.remainingSessions) || 0) - 1);
            return {
              ...c,
              completedSessions: completed,
              remainingSessions: remaining,
              status: remaining === 0 ? 'completed' : c.status,
            };
          }
          return c;
        }));
      }
      // 2. Moving away from completed (reversal)
      else if (oldStatus === 'completed' && newStatus !== 'completed') {
        setPtClients(prev => prev.map(c => {
          if (c.memberId === session.memberId) {
            const completed = Math.max(0, (Number(c.completedSessions) || 0) - 1);
            const remaining = (Number(c.remainingSessions) || 0) + 1;
            return {
              ...c,
              completedSessions: completed,
              remainingSessions: remaining,
              status: remaining > 0 ? 'active' : c.status,
            };
          }
          return c;
        }));
      }
    }
  }, [ptSessions]);

  /**
   * Completes a scheduled PT session with atomic Supabase persistence and credit deduction
   */
  const completePtSession = useCallback(async (sessionId, notes = null) => {
    if (session?.user && isSupabaseConfigured) {
      try {
        const targetSession = ptSessions.find(s => s.id === sessionId);
        const assignmentId = targetSession?.assignmentId;
        if (!assignmentId) {
          return { success: false, error: 'Assignment not found for session.' };
        }

        const res = await completePtSessionService({
          assignmentId,
          notes: notes !== null ? notes : targetSession?.notes,
          scheduledSessionId: sessionId,
        });

        if (res.error) {
          console.error('[AppContext.completePtSession] completePtSession error:', res.error);
          return { success: false, error: res.error.message || 'Failed to complete session.' };
        }

        await Promise.all([fetchPtData(), fetchPayments()]);
        return { success: true, data: res.data };
      } catch (err) {
        console.error('[AppContext.completePtSession] Unexpected exception:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    return { success: false, error: 'Authentication required: Supabase is the sole authoritative data source.' };
  }, [session, ptSessions, fetchPtData, fetchPayments]);

  /**
   * Cancels a scheduled PT session without deducting package credits
   */
  const cancelPtSession = useCallback(async (sessionId, notes = null) => {
    if (session?.user && isSupabaseConfigured) {
      try {
        const res = await cancelPtSessionService({
          scheduledSessionId: sessionId,
          notes,
        });

        if (res.error) {
          console.error('[AppContext.cancelPtSession] cancelPtSession error:', res.error);
          return { success: false, error: res.error.message || 'Failed to cancel session.' };
        }

        await fetchPtData();
        return { success: true, data: res.data };
      } catch (err) {
        console.error('[AppContext.cancelPtSession] Unexpected exception:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    return { success: false, error: 'Authentication required: Supabase is the sole authoritative data source.' };
  }, [session, fetchPtData]);

  /**
   * Updates session record details with status sync and Supabase persistence
   */
  const updatePtSession = useCallback(async (sessionId, updates) => {
    if (session?.user && isSupabaseConfigured) {
      try {
        const res = await updatePtScheduledSessionService({
          scheduledSessionId: sessionId,
          sessionDate: updates.date,
          sessionTime: updates.time,
          notes: updates.notes,
        });

        if (res.error) {
          console.error('[AppContext.updatePtSession] updatePtSession error:', res.error);
          return { success: false, error: res.error.message || 'Failed to update session.' };
        }

        await fetchPtData();
        return { success: true, data: res.data };
      } catch (err) {
        console.error('[AppContext.updatePtSession] Unexpected exception:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    return { success: false, error: 'Authentication required: Supabase is the sole authoritative data source.' };
  }, [session, fetchPtData]);

  const addFollowup = useCallback(async (item) => {
    if (session?.user && isSupabaseConfigured) {
      const res = await createFollowupService({
        memberId: item.memberId,
        category: item.category || 'general',
        reason: item.reason,
        priority: item.priority || 'medium',
        dueDate: item.dueDate,
        notes: item.notes || '',
      });
      if (res.error) {
        throw res.error;
      }
      await fetchFollowups();
      return res;
    }

    throw new Error('Authentication required: Supabase is the sole authoritative data source.');
  }, [session, fetchFollowups]);

  const updateFollowup = useCallback(async (id, updates) => {
    if (session?.user && isSupabaseConfigured) {
      const res = await updateFollowupService(id, {
        status: updates.status,
        outcome: updates.outcome,
        rescheduleDate: updates.dueDate,
        notes: updates.notes,
      });
      if (res.error) {
        throw res.error;
      }
      await fetchFollowups();
      return res;
    }

    throw new Error('Authentication required: Supabase is the sole authoritative data source.');
  }, [session, fetchFollowups]);

  const rescheduleFollowup = useCallback(async (id, newDueDate, reason, notes) => {
    if (session?.user && isSupabaseConfigured) {
      const res = await rescheduleFollowupService(id, newDueDate, notes);
      if (res.error) {
        throw res.error;
      }
      await fetchFollowups();
      return res;
    }

    throw new Error('Authentication required: Supabase is the sole authoritative data source.');
  }, [session, fetchFollowups]);

  const recordFollowupOutcome = useCallback(async (id, outcomeText, markCompleted = false) => {
    if (session?.user && isSupabaseConfigured) {
      const res = await updateFollowupService(id, {
        status: markCompleted ? 'completed' : null,
        outcome: outcomeText,
        notes: outcomeText,
      });
      if (res.error) {
        throw res.error;
      }
      await fetchFollowups();
      return res;
    }

    throw new Error('Authentication required: Supabase is the sole authoritative data source.');
  }, [session, fetchFollowups]);

  const addNotification = useCallback((notif) => {
    const maxNNum = notifications.reduce((max, n) => {
      const match = String(n?.id || '').match(/N(\d+)/i);
      const num = match ? parseInt(match[1], 10) : 0;
      return Math.max(max, isNaN(num) ? 0 : num);
    }, 0);
    const id = notif.id || `N${String(maxNNum + 1).padStart(3, '0')}`;
    setNotifications(prev => [{ ...notif, id }, ...prev]);
  }, [notifications]);

  const updateNotification = useCallback((id, updates) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
  }, []);

  const sendNotification = useCallback((id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, status: 'sent', sentAt: new Date().toISOString() } : n));
  }, []);

  /**
   * Renews membership: invokes public.renew_member_subscription RPC in Supabase,
   * carries forward debt if requested, records payment receipt, and refreshes members & payments.
   */
  const renewMember = useCallback(async ({
    memberId,
    planId,
    planName,
    startDate,
    expiryDate,
    planFee,
    previousBalance = 0,
    settlePreviousBalance = true,
    amountPaid = 0,
    paymentMethod = 'Cash',
    notes = '',
    idempotencyKey,
  }) => {
    if (session?.user && isSupabaseConfigured) {
      const res = await renewMemberSubscriptionService({
        memberId,
        planId,
        startDate,
        carryForwardBalance: Boolean(settlePreviousBalance),
        paymentAmount: Number(amountPaid) || 0,
        paymentMethod: paymentMethod || 'Cash',
        idempotencyKey,
      });

      if (res.error) {
        throw res.error;
      }

      // Refresh directory, payments ledger, and subscriptions from the database
      await Promise.all([fetchMembers(), fetchPayments(), fetchSubscriptions()]);

      return res.data;
    }

    throw new Error('Authentication required: Supabase is the sole authoritative data source.');
  }, [session, fetchMembers, fetchPayments, fetchSubscriptions]);

  /**
   * updateGymInfo — Phase 1 Supabase-backed gym profile update.
   *
   * When authenticated:
   *   1. Calls gymInfoService.updateGymInfo() with the DB record id.
   *   2. On success, updates shared React state with the database-confirmed record.
   *   3. Throws a descriptive error on failure (caller shows error UI).
   *      NEVER shows success before the database confirms the write.
   */
  const updateGymInfo = useCallback(async (updates) => {
    if (session?.user && isSupabaseConfigured) {
      if (!gymInfoDbId) {
        throw new Error(
          'Gym profile is not loaded from the database yet. Please wait and try again.'
        );
      }
      const { data, error, migrationPending } = await updateGymInfoService(gymInfoDbId, updates);
      if (migrationPending !== undefined) {
        setGymInfoMigrationPending(Boolean(migrationPending));
      }
      if (error) {
        throw error;
      }
      // Update state with the database-confirmed record (not just the local form values)
      setGymInfo(data);
      return data;
    }

    throw new Error('Authentication required: Supabase is the sole authoritative data source.');
  }, [session, gymInfoDbId]);

  /**
   * Membership Plans mutation operations (Phase 2)
   */
  const createPlan = useCallback(async (planData) => {
    const res = await createMembershipPlanService(planData);
    if (!res.error) {
      await fetchPlans();
    }
    return res;
  }, [fetchPlans]);

  const updatePlan = useCallback(async (id, updates) => {
    const res = await updateMembershipPlanService(id, updates);
    if (!res.error) {
      await fetchPlans();
    }
    return res;
  }, [fetchPlans]);

  const togglePlanStatus = useCallback(async (id, currentIsActive) => {
    const res = currentIsActive
      ? await deactivateMembershipPlanService(id)
      : await reactivateMembershipPlanService(id);
    if (!res.error) {
      await fetchPlans();
    }
    return res;
  }, [fetchPlans]);

  /**
   * Personal Training Packages mutation operations (Phase 3)
   */
  const createPtPackageAction = useCallback(async (pkgData) => {
    const res = await createPtPackageService(pkgData);
    if (!res.error) {
      await fetchPtPackages();
    }
    return res;
  }, [fetchPtPackages]);

  const updatePtPackageAction = useCallback(async (id, updates) => {
    const res = await updatePtPackageService(id, updates);
    if (!res.error) {
      await fetchPtPackages();
    }
    return res;
  }, [fetchPtPackages]);

  const togglePtPackageStatusAction = useCallback(async (id, currentIsActive) => {
    const res = await togglePtPackageStatusService(id, currentIsActive);
    if (!res.error) {
      await fetchPtPackages();
    }
    return res;
  }, [fetchPtPackages]);

  /**
   * Reminder Automation Settings mutation operations (Phase 4)
   */
  const updateReminderSettingsAction = useCallback(async (newSettings) => {
    setReminderSettingsLoading(true);
    setReminderSettingsError(null);
    try {
      const res = await updateReminderSettingsService(newSettings);
      if (res.error) {
        setReminderSettingsError(res.error.message || 'Failed to update reminder settings.');
        return res;
      }
      if (res.data) {
        setReminderSettings(res.data);
        return { data: res.data, error: null };
      }
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update reminder settings.';
      setReminderSettingsError(msg);
      return { data: null, error: new Error(msg) };
    } finally {
      setReminderSettingsLoading(false);
    }
  }, []);

  /**
   * Resets local state (obsolete sample data path removed)
   */
  const resetToDemoData = useCallback(() => {
    // Obsolete: sample data and demo mode have been permanently removed.
  }, []);

  const isEmailVerified = Boolean(user?.email_confirmed_at);
  const isAuthenticated = Boolean(session && user && isEmailVerified && isValidRole(role));
  const isEmailUnverified = Boolean(user && !user.email_confirmed_at);

  const value = {
    // Authentication & Authorization state
    session,
    user,
    role,
    authLoading,
    initialDataLoading,
    authError,
    isAuthenticated,
    pendingInvitation,
    isPasswordRecovery,
    clearPasswordRecovery,
    isEmailVerified,
    isEmailUnverified,
    isAdmin: role === 'admin',
    isStaff: role === 'staff',
    login,
    acceptStaffInvitation,
    logout,
    changePassword: authChangePassword,
    requestPasswordReset: authRequestPasswordReset,
    resetPassword: authResetPassword,
    resendVerificationEmail: authResendVerificationEmail,
    verifyOtp: authVerifyOtp,
    parseAuthCallback,
    getSession,
    getUserRole,
    canAcceptStaffInvitation,
    isSupabaseConfigured,

    // Membership Plans Catalog State (from Supabase public.membership_plans)
    membershipPlans, // Active plans only (for member onboarding & renewals)
    allMembershipPlans, // All plans including inactive (for Settings management)
    plansLoading,
    plansError,
    reloadPlans: fetchPlans,
    createPlan,
    updatePlan,
    togglePlanStatus,

    // Members Directory Supabase State (from Supabase public.v_active_members)
    membersLoading,
    membersError,
    reloadMembers: fetchMembers,

    // Payments Ledger Supabase State (from Supabase public.payments)
    payments,
    paymentsLoading,
    paymentsError,
    reloadPayments: fetchPayments,
    recordDuesPayment,
    addPayment: recordDuesPayment,

    // Subscriptions Ledger Supabase State (from Supabase public.member_subscriptions)
    subscriptions,
    subscriptionsLoading,
    subscriptionsError,
    reloadSubscriptions: fetchSubscriptions,

    // Personal Training Supabase State (from Supabase public.pt_assignments & pt_sessions)
    ptLoading,
    ptError,
    reloadPtData: fetchPtData,
    trainers,
    trainersLoading,
    trainersError,
    reloadTrainers: fetchTrainers,

    // PT Packages Catalog State (Phase 3: Supabase public.pt_packages)
    ptPackages, // Active packages only (for personal training assignments & pricing)
    allPtPackages, // All packages including inactive (for Settings management)
    ptPackagesLoading,
    ptPackagesError,
    reloadPtPackages: fetchPtPackages,
    createPtPackage: createPtPackageAction,
    updatePtPackage: updatePtPackageAction,
    togglePtPackageStatus: togglePtPackageStatusAction,

    // Attendance Supabase State (from Supabase public.checkins & public.v_attendance_logs)
    checkins,
    checkinsLoading,
    checkinsError,
    reloadCheckins: fetchCheckins,
    addCheckin,
    checkoutMember,

    // Notifications Supabase State (from Supabase public.notifications & public.v_notifications)
    notifications,
    notificationsLoading,
    notificationsError,
    latestReminderJobStatus,
    refreshingReminders,
    reloadNotifications: fetchNotifications,
    triggerManualReminderRefresh,
    markNotificationRead: markNotificationAsRead,
    markAllNotificationsRead: markAllNotificationsAsRead,
    markNotificationWhatsAppSent: markNotificationAsWhatsAppSent,

    // Reminder Automation State (Phase 4: Supabase public.reminder_settings)
    reminderSettings,
    reminderSettingsLoading,
    reminderSettingsError,
    reloadReminderSettings: fetchReminderSettingsData,
    updateReminderSettings: updateReminderSettingsAction,

    // Member Follow-ups Supabase State (from Supabase public.member_followups & public.v_member_followups)
    followupsLoading,
    followupsError,
    reloadFollowups: fetchFollowups,

    // Gym Data State (preserved exactly)
    members, setMembers, addMember, updateMember,
    followups, addFollowup, updateFollowup, rescheduleFollowup, recordFollowupOutcome,
    ptClients, setPtClients, addPtClient, updatePtClient,
    ptSessions, setPtSessions, addPtSession, updatePtSessionStatus, updatePtSession, completePtSession, cancelPtSession,
    setNotifications, addNotification, updateNotification, sendNotification,
    // Gym Profile State (Phase 1: Supabase-backed)
    gymInfo, updateGymInfo,
    gymInfoLoading, gymInfoError,
    gymInfoMigrationPending,
    refreshGymInfo: fetchGymInfo,

    // Staff & Security State (Phase 5: Supabase public.profiles, staff_invitations, security_audit_logs)
    staffRoster,
    pendingInvitations,
    securityAuditLogs,
    staffLoading,
    staffError,
    refreshStaffRoster: fetchStaffData,
    inviteStaffMember,
    updateStaffRole,
    toggleStaffStatus,
    revokeInvitation,
    resendInvitation,
    getStaffOperationalSummary: getStaffOperationalSummaryService,

    renewMember,
    resetToDemoData,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function useAuth() {
  const ctx = useApp();
  return {
    session: ctx.session,
    user: ctx.user,
    role: ctx.role,
    authLoading: ctx.authLoading,
    authError: ctx.authError,
    isAuthenticated: ctx.isAuthenticated,
    pendingInvitation: ctx.pendingInvitation,
    isPasswordRecovery: ctx.isPasswordRecovery,
    clearPasswordRecovery: ctx.clearPasswordRecovery,
    isEmailVerified: ctx.isEmailVerified,
    isEmailUnverified: ctx.isEmailUnverified,
    isAdmin: ctx.isAdmin,
    isStaff: ctx.isStaff,
    login: ctx.login,
    acceptStaffInvitation: ctx.acceptStaffInvitation,
    logout: ctx.logout,
    changePassword: ctx.changePassword,
    requestPasswordReset: ctx.requestPasswordReset,
    resetPassword: ctx.resetPassword,
    resendVerificationEmail: ctx.resendVerificationEmail,
    verifyOtp: ctx.verifyOtp,
    parseAuthCallback: ctx.parseAuthCallback,
    getSession: ctx.getSession,
    getUserRole: ctx.getUserRole,
    canAcceptStaffInvitation: ctx.canAcceptStaffInvitation,
  };
}
