import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { PageHeader } from '../components/ui/PageHeader';
import { KPICard } from '../components/shared/KPICard';
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge, Badge } from '../components/ui/Badge';
import { RenewMembershipModal } from '../components/shared/RenewMembershipModal';
import {
  getMembershipStatus,
  getLocalDateString,
  formatINR,
  isCurrentMonth,
  getDaysDifference,
} from '../utils/memberUtils';
import {
  Users, UserCheck, LogIn, LogOut, CreditCard, Clock, IndianRupee,
  Plus, AlertTriangle, Dumbbell, Activity, ChevronRight,
  CheckCircle2, Search, X, Calendar, Phone, ArrowUpRight, RotateCw, RefreshCw
} from 'lucide-react';

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    members,
    payments,
    checkins,
    checkinsLoading,
    checkinsError,
    reloadCheckins,
    followups,
    ptClients,
    ptSessions,
    addCheckin,
    checkoutMember,
    membersLoading,
    membersError,
    reloadMembers,
    paymentsLoading,
    paymentsError,
    reloadPayments,
    ptLoading,
    ptError,
    reloadPtData,
    reloadNotifications,
    reloadFollowups,
    followupsLoading,
    session,
  } = useApp();

  const [submittingCheckin, setSubmittingCheckin] = useState(false);

  // Renewal Modal State
  const [renewingMember, setRenewingMember] = useState(null);
  const [renewalSuccess, setRenewalSuccess] = useState(null);

  // Quick Check-in State
  const [quickSearch, setQuickSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState(null);
  const [quickFeedback, setQuickFeedback] = useState(null);

  // Refresh State
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        reloadMembers && reloadMembers(),
        reloadPayments && reloadPayments(),
        reloadPtData && reloadPtData(),
        reloadCheckins && reloadCheckins(),
        reloadNotifications && reloadNotifications(),
        reloadFollowups && reloadFollowups(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const dashboardError = membersError || paymentsError || ptError || checkinsError;

  // Dynamic Date calculations based on local date
  const todayStr = useMemo(() => getLocalDateString(), []);
  const todayDate = useMemo(() => new Date(), []);

  // 1. Members metrics (from public.v_active_members)
  const activeMembers = useMemo(() => {
    return members.filter(m => getMembershipStatus(m, todayStr) !== 'expired');
  }, [members, todayStr]);

  const recentlyExpired = useMemo(() => {
    return members.filter(m => getMembershipStatus(m, todayStr) === 'expired');
  }, [members, todayStr]);

  const activeRate = useMemo(() => {
    if (!members.length) return 0;
    return Math.round((activeMembers.length / members.length) * 100);
  }, [members.length, activeMembers.length]);

  // Expiry in exactly 0 days (today)
  const expiringToday = useMemo(() => {
    return members.filter(m => m.expiryDate && getDaysDifference(m.expiryDate, todayStr) === 0);
  }, [members, todayStr]);

  // 2. Attendance metrics (Local Reception Desk Session)
  const todayCheckins = useMemo(() => checkins.filter(c => c.date === todayStr), [checkins, todayStr]);

  // 3. Financial metrics (completed transactions from public.payments)
  const pendingPayments = useMemo(() => members.filter(m => (Number(m.balance) || 0) > 0), [members]);
  const totalOutstanding = useMemo(() => pendingPayments.reduce((s, m) => s + (Number(m.balance) || 0), 0), [pendingPayments]);

  const todayPayments = useMemo(() => {
    return payments.filter(p => p.status === 'completed' && p.date === todayStr);
  }, [payments, todayStr]);
  const todayCollection = useMemo(() => {
    return todayPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }, [todayPayments]);

  const monthPayments = useMemo(() => {
    return payments.filter(p => p.status === 'completed' && isCurrentMonth(p.date, todayStr));
  }, [payments, todayStr]);
  const monthCollection = useMemo(() => {
    return monthPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }, [monthPayments]);

  // 4. Expiring soon (within next 5 days) using shared status logic
  const expiringSoon = useMemo(() => {
    return members.filter(m => {
      return getMembershipStatus(m, todayStr) === 'expiring';
    }).sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
  }, [members, todayStr]);

  // 5. PT and Followup metrics
  const completedPtToday = useMemo(() => {
    return ptSessions.filter(s => s.status === 'completed' && s.date === todayStr);
  }, [ptSessions, todayStr]);

  const ptEndingSoon = useMemo(() => {
    return ptClients.filter(c => (Number(c.remainingSessions) || 0) <= 3 && c.status === 'active');
  }, [ptClients]);

  const followupsDueToday = useMemo(() => {
    return followups.filter(f => (f.dueDate === todayStr || f.status === 'overdue') && f.status !== 'completed');
  }, [followups, todayStr]);

  // Dynamic Greeting
  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Good morning' : greetingHour < 17 ? 'Good afternoon' : 'Good evening';

  // -------------------------------------------------------------
  // ATTENTION REQUIRED: Ordered priority & smart deduplication
  // Priority: 1. Expired -> 2. Overdue payments -> 3. Expiring in 5d -> 4. PT ending -> 5. Followups
  // -------------------------------------------------------------
  const attentionItems = useMemo(() => {
    const items = [];
    const seenMemberIds = new Set();

    // Priority 1: Expired memberships
    recentlyExpired.forEach(m => {
      if (!seenMemberIds.has(m.id)) {
        seenMemberIds.add(m.id);
        const daysAgo = Math.max(0, Math.ceil((todayDate - new Date(m.expiryDate)) / (1000 * 60 * 60 * 24)));
        items.push({
          id: `exp-${m.id}`,
          memberId: m.id,
          memberCode: m.member_code || m.id,
          memberName: m.name,
          plan: m.plan,
          priorityRank: 1,
          type: 'expired',
          badgeText: 'Expired',
          badgeVariant: 'error',
          bgClass: 'border-[#B42318]/20 bg-[#FCE9E9]/45 hover:bg-[#FCE9E9]/65',
          avatarClass: 'bg-white text-[#B42318] border border-[#B42318]/25',
          reason: `Membership expired ${daysAgo > 0 ? `${daysAgo}d ago` : 'recently'} (${m.expiryDate})`,
          subtext: (Number(m.balance) || 0) > 0
            ? `Previous plan: ${m.plan} · Pending balance: ₹${Number(m.balance).toLocaleString('en-IN')}`
            : `Previous plan: ${m.plan} · Inactive account`,
          actionLabel: 'Renew Membership',
          onAction: () => setRenewingMember(m),
        });
      }
    });

    // Priority 2: Overdue payments (with balance)
    pendingPayments.forEach(m => {
      if (!seenMemberIds.has(m.id)) {
        seenMemberIds.add(m.id);
        const daysLeft = Math.ceil((new Date(m.expiryDate) - todayDate) / (1000 * 60 * 60 * 24));
        const isExpiringSoon = daysLeft <= 5 && daysLeft >= 0;
        items.push({
          id: `pay-${m.id}`,
          memberId: m.id,
          memberCode: m.member_code || m.id,
          memberName: m.name,
          plan: m.plan,
          priorityRank: 2,
          type: 'payment',
          badgeText: `₹${Number(m.balance).toLocaleString('en-IN')} Due`,
          badgeVariant: 'warning',
          bgClass: 'border-[#A66A00]/20 bg-[#FFF2D8]/45 hover:bg-[#FFF2D8]/65',
          avatarClass: 'bg-white text-[#A66A00] border border-[#A66A00]/25',
          reason: `Pending dues: ₹${Number(m.balance).toLocaleString('en-IN')} of ₹${Number(m.totalFee || m.planPrice || 0).toLocaleString('en-IN')} liability`,
          subtext: isExpiringSoon
            ? `${m.plan} Plan · Also expiring in ${daysLeft} days`
            : `${m.plan} Plan · Paid ₹${Number(m.amountPaid || 0).toLocaleString('en-IN')}`,
          actionLabel: 'Collect Payment',
          onAction: () => navigate(`/payments?record=true&memberId=${m.id}`),
        });
      }
    });

    // Priority 3: Memberships expiring within 5 days
    expiringSoon.forEach(m => {
      if (!seenMemberIds.has(m.id)) {
        seenMemberIds.add(m.id);
        const daysLeft = Math.max(0, Math.ceil((new Date(m.expiryDate) - todayDate) / (1000 * 60 * 60 * 24)));
        items.push({
          id: `expsoon-${m.id}`,
          memberId: m.id,
          memberCode: m.member_code || m.id,
          memberName: m.name,
          plan: m.plan,
          priorityRank: 3,
          type: 'expiring',
          badgeText: `${daysLeft}d left`,
          badgeVariant: 'warning',
          bgClass: 'border-[#A66A00]/20 bg-[#FFF2D8]/45 hover:bg-[#FFF2D8]/65',
          avatarClass: 'bg-white text-[#A66A00] border border-[#A66A00]/25',
          reason: `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${m.expiryDate})`,
          subtext: `${m.plan} Plan · Requires renewal notice`,
          actionLabel: 'Renew Membership',
          onAction: () => setRenewingMember(m),
        });
      }
    });

    // Priority 4: PT packages with few sessions remaining
    ptEndingSoon.forEach(c => {
      if (!seenMemberIds.has(c.memberId)) {
        seenMemberIds.add(c.memberId);
        items.push({
          id: `pt-${c.memberId}`,
          memberId: c.memberId,
          memberCode: c.memberCode || c.memberId,
          memberName: c.memberName,
          plan: c.package,
          priorityRank: 4,
          type: 'pt',
          badgeText: `${c.remainingSessions} left`,
          badgeVariant: 'warning',
          bgClass: 'border-[#A66A00]/20 bg-[#FFF2D8]/45 hover:bg-[#FFF2D8]/65',
          avatarClass: 'bg-white text-[#A66A00] border border-[#A66A00]/25',
          reason: `Only ${c.remainingSessions} PT session${c.remainingSessions === 1 ? '' : 's'} remaining`,
          subtext: `${c.trainer || 'Coach Pravin Joshi'} · ${c.completedSessions}/${c.totalSessions} sessions completed`,
          actionLabel: 'View PT Client',
          onAction: () => navigate('/personal-training'),
        });
      }
    });

    const validMemberIds = new Set(members.map(m => m.id));

    // Priority 5: Legitimate manual staff follow-ups due today or overdue
    followupsDueToday.forEach(f => {
      // Exclude orphaned follow-ups pointing to non-existent members or test fixtures
      if (validMemberIds.size > 0 && !validMemberIds.has(f.memberId)) {
        return;
      }
      if (!seenMemberIds.has(f.memberId)) {
        seenMemberIds.add(f.memberId);
        items.push({
          id: `fu-${f.id}`,
          memberId: f.memberId,
          memberCode: f.memberCode || f.memberId,
          memberName: f.memberName,
          plan: '',
          priorityRank: 5,
          type: 'followup',
          badgeText: f.status === 'overdue' ? 'Overdue' : 'Due Today',
          badgeVariant: f.status === 'overdue' ? 'error' : 'warning',
          bgClass: f.status === 'overdue'
            ? 'border-[#B42318]/20 bg-[#FCE9E9]/45 hover:bg-[#FCE9E9]/65'
            : 'border-[#A66A00]/20 bg-[#FFF2D8]/45 hover:bg-[#FFF2D8]/65',
          avatarClass: f.status === 'overdue'
            ? 'bg-white text-[#B42318] border border-[#B42318]/25'
            : 'bg-white text-[#A66A00] border border-[#A66A00]/25',
          reason: `Follow-up: ${f.reason}`,
          subtext: f.notes ? `Note: ${f.notes}` : 'Scheduled for today',
          actionLabel: 'Complete Follow-up',
          onAction: () => navigate('/followups'),
        });
      }
    });

    return items;
  }, [recentlyExpired, pendingPayments, expiringSoon, ptEndingSoon, followupsDueToday, members, todayDate, navigate]);

  // Show only top 4 most urgent items on dashboard
  const displayAttentionItems = attentionItems.slice(0, 4);

  // -------------------------------------------------------------
  // QUICK CHECK-IN: Search & selection
  // -------------------------------------------------------------
  const quickCandidates = useMemo(() => {
    const q = quickSearch.trim().toLowerCase();
    if (!q) return [];
    return members.filter(m =>
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.member_code && m.member_code.toLowerCase().includes(q)) ||
      (m.id && String(m.id).toLowerCase().includes(q)) ||
      (m.phone && m.phone.includes(q))
    ).slice(0, 4);
  }, [members, quickSearch]);

  const handleSelectCandidate = (member) => {
    setSelectedMember(member);
    setQuickSearch('');
    setQuickFeedback(null);
  };

  const handleClearSelected = () => {
    setSelectedMember(null);
    setQuickSearch('');
    setQuickFeedback(null);
  };

  // Check if selected member is currently in gym (open unclosed visit)
  const activeOpenCheckin = useMemo(() => {
    if (!selectedMember) return null;
    return checkins.find(c => 
      (c.memberId === selectedMember.id || c.memberId === selectedMember.member_code) &&
      (!c.checkedOutAt && c.rawStatus !== 'checked_out')
    );
  }, [selectedMember, checkins]);

  // Check if selected member already checked in today
  const selectedAlreadyCheckedIn = useMemo(() => {
    if (!selectedMember) return null;
    return checkins.find(c => (c.memberId === selectedMember.id || c.memberId === selectedMember.member_code) && c.date === todayStr);
  }, [selectedMember, checkins, todayStr]);

  const selectedIsExpired = useMemo(() => {
    if (!selectedMember) return false;
    return getMembershipStatus(selectedMember, todayStr) === 'expired';
  }, [selectedMember, todayStr]);

  const handleExecuteCheckin = async (memberToLog) => {
    if (!memberToLog || submittingCheckin) return;

    if (getMembershipStatus(memberToLog, todayStr) === 'expired') {
      setQuickFeedback({
        type: 'error',
        text: `Cannot check in ${memberToLog.name} — membership expired on ${memberToLog.expiryDate}.`
      });
      return;
    }

    if (activeOpenCheckin) {
      setQuickFeedback({
        type: 'warning',
        text: `${memberToLog.name} is currently in the gym (checked in at ${activeOpenCheckin.time}). Please check out first.`
      });
      return;
    }

    setSubmittingCheckin(true);
    setQuickFeedback(null);

    try {
      const res = await addCheckin({
        memberId: memberToLog.id,
        memberName: memberToLog.name,
        plan: memberToLog.plan,
        status: 'valid'
      });

      const passCode = res?.checkin_code || res?.id || 'Saved';
      setQuickFeedback({
        type: 'success',
        text: `${memberToLog.name} checked in! Pass #${passCode}`
      });
      setSelectedMember(null);
      setQuickSearch('');
      setTimeout(() => setQuickFeedback(null), 4000);
    } catch (err) {
      setQuickFeedback({
        type: 'error',
        text: err.message || 'Failed to record check-in in database.'
      });
    } finally {
      setSubmittingCheckin(false);
    }
  };

  const handleExecuteCheckout = async (checkinId) => {
    if (!checkinId || submittingCheckin) return;

    setSubmittingCheckin(true);
    setQuickFeedback(null);

    try {
      await checkoutMember({ checkinId });
      setQuickFeedback({
        type: 'success',
        text: `${selectedMember.name} checked out successfully!`
      });
      setSelectedMember(null);
      setQuickSearch('');
      setTimeout(() => setQuickFeedback(null), 4000);
    } catch (err) {
      setQuickFeedback({
        type: 'error',
        text: err.message || 'Failed to record check-out in database.'
      });
    } finally {
      setSubmittingCheckin(false);
    }
  };

  // -------------------------------------------------------------
  // RECENT ACTIVITY: Dynamic unified stream from verified data
  // Supports Payment, Registration, PT Session, Check-in
  // -------------------------------------------------------------
  const recentActivities = useMemo(() => {
    const list = [];

    // 1. Payments Received (from public.payments)
    payments.forEach(p => {
      list.push({
        id: `act-p-${p.receiptNumber || p.id}`,
        type: 'payment',
        title: 'Payment received',
        memberId: p.memberId,
        memberName: p.memberName,
        subtitle: `${p.category || 'Membership'} (${p.relatedPlan || 'Fee'}) · ${p.method} • Receipt #${p.receiptNumber || p.id}`,
        time: p.date === todayStr ? 'Today' : p.date,
        amount: `+${formatINR(p.amount)}`,
        icon: IndianRupee,
        iconBg: 'bg-[#E8F5EE] text-[#16845B]',
        sortDate: p.date || (p.createdAt ? p.createdAt.split('T')[0] : ''),
        sortTime: p.createdAt ? new Date(p.createdAt).toTimeString().substring(0, 5) : '12:00',
      });
    });

    // 2. New Member Registrations (from public.v_active_members)
    members.forEach(m => {
      const regDate = m.joinDate || m.startDate || todayStr;
      list.push({
        id: `act-m-${m.id}`,
        type: 'registration',
        title: 'New member registered',
        memberId: m.id,
        memberName: m.name,
        subtitle: `${m.plan || 'Membership'} · ID: ${m.member_code || m.id}`,
        time: regDate === todayStr ? 'Today' : regDate,
        amount: null,
        icon: Users,
        iconBg: 'bg-[#F5F7F8] text-[#25313B]',
        sortDate: regDate,
        sortTime: '09:00',
      });
    });

    // 3. Completed PT Sessions (from public.pt_sessions)
    ptSessions.filter(s => s.status === 'completed').forEach(s => {
      list.push({
        id: `act-pt-${s.id}`,
        type: 'pt',
        title: 'PT session completed',
        memberId: s.memberId,
        memberName: s.memberName,
        subtitle: `${s.trainer || 'Coach Pravin Joshi'} · ${s.notes || `Session #${s.sessionNumber || 1}`}`,
        time: s.date === todayStr ? (s.time || 'Today') : s.date,
        amount: null,
        icon: Dumbbell,
        iconBg: 'bg-[#E8F5EE] text-[#16845B]',
        sortDate: s.date || todayStr,
        sortTime: s.time || '10:00',
      });
    });

    // 4. Verified Member Attendance Events (from public.checkins)
    checkins.forEach(c => {
      const isOut = c.checkedOutAt || c.rawStatus === 'checked_out';
      list.push({
        id: `act-c-${c.checkinCode || c.id}`,
        type: 'checkin',
        title: isOut ? 'Member checked out' : 'Member check-in',
        memberId: c.memberId,
        memberName: c.memberName,
        subtitle: `${c.plan || 'Member'} · Pass #${c.checkinCode || c.id}${c.actorName ? ` • Logged by ${c.actorName}` : ''}`,
        time: c.date === todayStr ? (c.time || 'Today') : c.date,
        amount: null,
        icon: isOut ? LogOut : LogIn,
        iconBg: isOut ? 'bg-[#F5F7F8] text-[#64717B]' : 'bg-[#E8F5EE] text-[#16845B]',
        sortDate: c.date || todayStr,
        sortTime: c.time || '11:00',
      });
    });

    // Sort descending by date, then by time
    list.sort((a, b) => {
      if (b.sortDate !== a.sortDate) {
        return b.sortDate.localeCompare(a.sortDate);
      }
      return (b.sortTime || '').localeCompare(a.sortTime || '');
    });

    return list.slice(0, 6);
  }, [payments, members, ptSessions, checkins, todayStr]);

  return (
    <div className="space-y-6">
      {/* 1. Page Header with Quick Actions & Live Sync Indicator */}
      <PageHeader
        title={`${greeting}, Admin`}
        description="Here's what's happening at The Fitness House today · Near Vitthal Mandir, Arag"
        badge={
          session?.user ? (
            <Badge variant="success">● Live Database</Badge>
          ) : (
            <Badge variant="default">Demo Mode</Badge>
          )
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              icon={RotateCw}
              onClick={handleRefresh}
              disabled={isRefreshing || membersLoading || paymentsLoading}
              title="Refresh all dashboard metrics from database"
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={Plus}
              onClick={() => navigate('/members?add=true')}
            >
              Add Member
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={IndianRupee}
              onClick={() => navigate('/payments?record=true')}
            >
              Record Payment
            </Button>
          </div>
        }
      />

      {/* Database Error Alert */}
      {dashboardError && (
        <div className="p-4 rounded-xl bg-[#FEF3F2] border border-[#FECDCA] text-[#B42318] flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={18} className="shrink-0 text-[#D92D20]" />
            <div>
              <p className="text-xs font-bold">Failed to synchronize live data with database</p>
              <p className="text-xs text-[#B42318]/90">{dashboardError}</p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="border-[#FDA29B] text-[#B42318] hover:bg-[#FEE4E2] shrink-0"
          >
            Retry Sync
          </Button>
        </div>
      )}

      {/* Renewal Success Notification Banner */}
      {renewalSuccess && (
        <div className="p-3.5 rounded-xl bg-[#E8F5EE] border border-[#16845B]/25 text-[#16845B] text-xs font-semibold flex items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{renewalSuccess}</span>
          </div>
          <button
            onClick={() => setRenewalSuccess(null)}
            className="text-[#16845B] hover:text-[#126b49] p-0.5 cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* 2. Compact 6-Metric Summary Cards Grid (Single Horizontal Row on Desktop) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-3.5">
        {/* Card 1: Directory Members */}
        <KPICard
          icon={Users}
          label="Directory Members"
          value={membersLoading ? '...' : members.length}
          subtitle={`${activeMembers.length} active · ${recentlyExpired.length} expired`}
          variant="default"
          onClick={() => navigate('/members')}
        />

        {/* Card 2: Active Members */}
        <KPICard
          icon={UserCheck}
          label="Active Members"
          value={membersLoading ? '...' : activeMembers.length}
          subtitle={`${activeRate}% active rate`}
          variant="accent"
          onClick={() => navigate('/members?status=active')}
        />

        {/* Card 3: Pending Dues */}
        <KPICard
          icon={CreditCard}
          label="Pending Dues"
          value={membersLoading ? '...' : formatINR(totalOutstanding)}
          subtitle={`${pendingPayments.length} member${pendingPayments.length === 1 ? '' : 's'} with bal.`}
          variant={totalOutstanding > 0 ? 'warning' : 'default'}
          onClick={() => navigate('/payments?tab=pending')}
        />

        {/* Card 4: Expiring Soon */}
        <KPICard
          icon={Clock}
          label="Expiring Soon"
          value={membersLoading ? '...' : expiringSoon.length}
          subtitle="Within next 5 days"
          variant={expiringSoon.length > 0 ? 'warning' : 'default'}
          onClick={() => navigate('/notifications?filter=expiry')}
        />

        {/* Card 5: Today's Collection */}
        <KPICard
          icon={IndianRupee}
          label="Today's Collection"
          value={paymentsLoading ? '...' : formatINR(todayCollection)}
          subtitle={`${todayPayments.length} completed receipt${todayPayments.length === 1 ? '' : 's'}`}
          variant="accent"
          onClick={() => navigate('/payments')}
        />

        {/* Card 6: This Month */}
        <KPICard
          icon={Calendar}
          label="This Month"
          value={paymentsLoading ? '...' : formatINR(monthCollection)}
          subtitle={`${monthPayments.length} transaction${monthPayments.length === 1 ? '' : 's'} this month`}
          variant="default"
          onClick={() => navigate('/payments')}
        />
      </div>

      {/* 3. Balanced Two-Column Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* LEFT COLUMN: Operations & Timeline (xl:col-span-2) */}
        <div className="xl:col-span-2 space-y-6">

          {/* Attention Required Card */}
          <Card>
            <CardHeader
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/attention')}
                  className="text-xs font-semibold text-[#16845B] hover:text-[#126b49]"
                >
                  View Attention Center ({attentionItems.length}) <ChevronRight size={14} />
                </Button>
              }
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#FFF2D8] text-[#A66A00] flex items-center justify-center shrink-0">
                  <AlertTriangle size={17} />
                </div>
                <div>
                  <CardTitle>Attention Required</CardTitle>
                  <CardDescription>
                    {attentionItems.length} operational alert{attentionItems.length === 1 ? '' : 's'} require immediate management action
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <div className="space-y-3">
              {displayAttentionItems.map((item) => (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-xl border ${item.bgClass} flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors`}
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-full ${item.avatarClass} font-bold text-xs flex items-center justify-center shrink-0 shadow-xs`}>
                      {item.memberName.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => navigate(`/members/${item.memberId}`)}
                          className="text-sm font-semibold text-[#25313B] hover:text-[#16845B] transition-colors truncate text-left cursor-pointer"
                        >
                          {item.memberName}
                        </button>
                        <span className="text-[11px] font-mono text-[#64717B] bg-white/70 px-1.5 py-0.5 rounded border border-[#E1E6E9]">
                          {item.memberCode || item.memberId}
                        </span>
                        <Badge variant={item.badgeVariant}>
                          {item.badgeText}
                        </Badge>
                      </div>
                      <p className="text-xs font-medium text-[#25313B]/85 mt-1 truncate">
                        {item.reason}
                      </p>
                      <p className="text-[11px] text-[#64717B] truncate mt-0.5">
                        {item.subtext}
                      </p>
                    </div>
                  </div>

                  <div className="sm:self-center shrink-0 pt-1 sm:pt-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={item.onAction}
                      className="w-full sm:w-auto text-xs font-semibold shadow-xs"
                    >
                      {item.actionLabel}
                    </Button>
                  </div>
                </div>
              ))}

              {attentionItems.length === 0 && (
                <div className="text-center py-9 bg-[#F5F7F8]/50 rounded-xl border border-dashed border-[#E1E6E9]">
                  <CheckCircle2 size={32} className="text-[#16845B] mx-auto mb-2" />
                  <p className="text-sm font-semibold text-[#25313B]">All Clear!</p>
                  <p className="text-xs text-[#64717B] mt-0.5">No expired passes, overdue balances, or urgent follow-ups right now.</p>
                </div>
              )}
            </div>
          </Card>

          {/* Recent Gym Activity Card */}
          <Card>
            <CardHeader
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/checkins')}
                  className="text-xs font-semibold text-[#16845B] hover:text-[#126b49]"
                >
                  View Check-in Desk <ChevronRight size={14} />
                </Button>
              }
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#E8F5EE] text-[#16845B] flex items-center justify-center shrink-0">
                  <Activity size={17} />
                </div>
                <div>
                  <CardTitle>Recent Gym Activity</CardTitle>
                  <CardDescription>
                    Live chronological timeline of payments, registrations, PT sessions, and check-ins
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <div className="divide-y divide-[#E1E6E9] -mx-6">
              {recentActivities.map((act) => {
                const IconComponent = act.icon;
                return (
                  <div
                    key={act.id}
                    className="px-6 py-3.5 flex items-center justify-between gap-4 hover:bg-[#F5F7F8]/60 transition-colors"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className={`w-8 h-8 rounded-full ${act.iconBg} flex items-center justify-center shrink-0 shadow-xs`}>
                        <IconComponent size={15} strokeWidth={2.2} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-[#64717B]">
                            {act.title}:
                          </span>
                          <button
                            onClick={() => act.memberId && navigate(`/members/${act.memberId}`)}
                            className="text-sm font-semibold text-[#25313B] hover:text-[#16845B] transition-colors truncate cursor-pointer text-left"
                          >
                            {act.memberName}
                          </button>
                        </div>
                        <p className="text-xs text-[#64717B] truncate mt-0.5">
                          {act.subtitle}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      {act.amount ? (
                        <p className="text-sm font-bold text-[#16845B] tabular-nums">
                          {act.amount}
                        </p>
                      ) : (
                        <Badge variant={act.type === 'registration' ? 'default' : 'success'}>
                          {act.type === 'checkin' ? 'Check-in' : act.type === 'pt' ? 'PT Done' : 'Member'}
                        </Badge>
                      )}
                      <p className="text-[11px] text-[#64717B] mt-0.5">
                        {act.time}
                      </p>
                    </div>
                  </div>
                );
              })}

              {recentActivities.length === 0 && (
                <div className="px-6 py-8 text-center text-xs text-[#64717B]">
                  No recent activities recorded yet.
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* RIGHT COLUMN: Reception Desk & Operations (xl:col-span-1) */}
        <div className="space-y-6">

          {/* Quick Check-in Desk Card */}
          <Card>
            <div className="flex items-center justify-between gap-2.5 mb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#E8F5EE] text-[#16845B] flex items-center justify-center shrink-0">
                  <LogIn size={18} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#25313B]">Quick Check-in Desk</h3>
                  <p className="text-xs text-[#64717B]">Reception attendance logger</p>
                </div>
              </div>
              <Badge variant="default">
                Local Desk
              </Badge>
            </div>

            {/* Notification Feedback Banner */}
            {quickFeedback && (
              <div
                className={`p-3 rounded-xl text-xs font-semibold mb-3 flex items-start justify-between gap-2 ${
                  quickFeedback.type === 'success'
                    ? 'bg-[#E8F5EE] text-[#16845B] border border-[#16845B]/20'
                    : quickFeedback.type === 'warning'
                    ? 'bg-[#FFF2D8] text-[#A66A00] border border-[#A66A00]/20'
                    : 'bg-[#FCE9E9] text-[#B42318] border border-[#B42318]/20'
                }`}
              >
                <div className="flex items-center gap-2">
                  {quickFeedback.type === 'success' ? (
                    <CheckCircle2 size={16} className="shrink-0" />
                  ) : (
                    <AlertTriangle size={16} className="shrink-0" />
                  )}
                  <span>{quickFeedback.text}</span>
                </div>
                <button
                  onClick={() => setQuickFeedback(null)}
                  className="text-current opacity-70 hover:opacity-100 cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Search Input when no member selected */}
            {!selectedMember ? (
              <div className="space-y-2 mb-3">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by name, ID, or phone..."
                    value={quickSearch}
                    onChange={(e) => setQuickSearch(e.target.value)}
                    className="w-full h-10 pl-9 pr-8 text-xs border border-[#E1E6E9] rounded-xl bg-[#F5F7F8] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] transition-all"
                  />
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64717B]" />
                  {quickSearch && (
                    <button
                      onClick={() => setQuickSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#64717B] hover:text-[#25313B] p-0.5 cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Candidate Dropdown List */}
                {quickCandidates.length > 0 && (
                  <div className="space-y-1.5 p-1.5 bg-[#F5F7F8] rounded-xl border border-[#E1E6E9]">
                    <p className="text-[11px] font-semibold text-[#64717B] px-2 py-0.5">
                      Select Member ({quickCandidates.length} matches):
                    </p>
                    {quickCandidates.map(c => (
                      <div
                        key={c.id}
                        onClick={() => handleSelectCandidate(c)}
                        className="p-2.5 rounded-lg border border-[#E1E6E9] bg-white flex items-center justify-between gap-2 shadow-xs cursor-pointer hover:border-[#16845B]/50 hover:bg-[#E8F5EE]/20 transition-all"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-[#25313B] truncate">{c.name}</span>
                            <span className="text-[10px] font-mono text-[#16845B] bg-[#E8F5EE] px-1 rounded border border-[#16845B]/20">{c.member_code || c.id}</span>
                          </div>
                          <p className="text-[11px] text-[#64717B] truncate">
                            {c.plan} Plan · {c.phone}
                          </p>
                        </div>
                        <StatusBadge status={getMembershipStatus(c, todayStr)} />
                      </div>
                    ))}
                  </div>
                )}

                {quickSearch.trim().length >= 2 && quickCandidates.length === 0 && (
                  <p className="text-xs text-[#64717B] py-2 text-center">
                    No matching members found for "{quickSearch}".
                  </p>
                )}
              </div>
            ) : (
              /* Selected Member Card & Verification Summary */
              <div className="p-3.5 rounded-xl border border-[#E1E6E9] bg-[#F5F7F8] space-y-3 mb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-white border border-[#E1E6E9] font-bold text-xs text-[#16845B] flex items-center justify-center shrink-0 shadow-xs">
                      {selectedMember.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-bold text-[#25313B] truncate">{selectedMember.name}</p>
                        <span className="text-[10px] font-mono text-[#16845B] bg-white px-1 rounded border border-[#16845B]/20">{selectedMember.member_code || selectedMember.id}</span>
                      </div>
                      <p className="text-[11px] text-[#64717B]">{selectedMember.plan} Plan · {selectedMember.phone}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleClearSelected}
                    className="text-xs text-[#64717B] hover:text-[#25313B] p-1 cursor-pointer"
                    title="Change member"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-[#E1E6E9]">
                  <div className="bg-white p-2 rounded-lg border border-[#E1E6E9]">
                    <span className="text-[10px] uppercase font-semibold text-[#64717B] block">Plan Status</span>
                    <div className="mt-0.5">
                      <StatusBadge status={getMembershipStatus(selectedMember, todayStr)} />
                    </div>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-[#E1E6E9]">
                    <span className="text-[10px] uppercase font-semibold text-[#64717B] block">Valid Till</span>
                    <span className="text-xs font-bold text-[#25313B] mt-0.5 block truncate">
                      {selectedMember.expiryDate}
                    </span>
                  </div>
                </div>

                {/* Expiry Warning Before Check-in */}
                {selectedIsExpired && (
                  <div className="p-2.5 rounded-lg bg-[#FCE9E9] border border-[#B42318]/25 text-[#B42318] text-xs">
                    <div className="flex items-center gap-1.5 font-bold mb-1">
                      <AlertTriangle size={14} className="shrink-0" />
                      <span>Membership Expired</span>
                    </div>
                    <p className="text-[11px] text-[#B42318]/90">
                      Plan expired on {selectedMember.expiryDate}. Member must renew before logging attendance.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRenewingMember(selectedMember)}
                        className="w-full text-xs font-semibold"
                      >
                        Renew Plan
                      </Button>
                    </div>
                  </div>
                )}

                {/* Active in Gym Notice */}
                {activeOpenCheckin && (
                  <div className="p-2.5 rounded-lg bg-[#E8F5EE] border border-[#16845B]/30 text-[#16845B] text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-bold">
                      <Clock size={15} className="shrink-0" />
                      <span>Currently active in gym (checked in at {activeOpenCheckin.time})</span>
                    </div>
                    <p className="text-[11px] text-[#25313B]">
                      Pass #{activeOpenCheckin.checkinCode || activeOpenCheckin.id}. Must check out before logging another visit.
                    </p>
                  </div>
                )}

                {/* Duplicate Check-in Notice */}
                {!activeOpenCheckin && selectedAlreadyCheckedIn && !selectedIsExpired && (
                  <div className="p-2.5 rounded-lg bg-[#F5F7F8] border border-[#E1E6E9] text-xs text-[#64717B] space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-[#25313B]">
                      <Clock size={15} className="shrink-0 text-[#16845B]" />
                      <span>Completed a visit earlier today (at {selectedAlreadyCheckedIn.time}).</span>
                    </div>
                  </div>
                )}

                {/* Check In / Check Out Action Buttons */}
                {!selectedIsExpired && activeOpenCheckin && (
                  <div className="space-y-2">
                    <Button
                      variant="primary"
                      size="md"
                      disabled={submittingCheckin}
                      onClick={() => handleExecuteCheckout(activeOpenCheckin.checkinId || activeOpenCheckin.id)}
                      className="w-full justify-center bg-[#16845B] hover:bg-[#126b49] text-white py-2.5 font-bold text-xs shadow-xs"
                    >
                      <LogOut size={16} /> {submittingCheckin ? 'Checking Out...' : 'Check Out Member Now'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearSelected}
                      className="w-full justify-center text-xs text-[#64717B] hover:text-[#25313B]"
                    >
                      Cancel / Select Another Member
                    </Button>
                  </div>
                )}

                {!selectedIsExpired && !activeOpenCheckin && (
                  <div className="space-y-2">
                    <Button
                      variant="primary"
                      size="md"
                      disabled={submittingCheckin}
                      onClick={() => handleExecuteCheckin(selectedMember)}
                      className="w-full justify-center bg-[#16845B] hover:bg-[#126b49] text-white py-2.5 font-bold text-xs shadow-xs"
                    >
                      <LogIn size={16} /> {submittingCheckin ? 'Logging Check-in...' : 'Log Check-in Now'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearSelected}
                      className="w-full justify-center text-xs text-[#64717B] hover:text-[#25313B]"
                    >
                      Cancel / Select Another Member
                    </Button>
                  </div>
                )}
                {selectedIsExpired && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearSelected}
                    className="w-full justify-center text-xs text-[#64717B] hover:text-[#25313B]"
                  >
                    Cancel / Select Another Member
                  </Button>
                )}
              </div>
            )}

            {/* Bottom summary and session disclosure */}
            <div className="space-y-2 pt-2.5 border-t border-[#E1E6E9]">
              <div className="flex items-center justify-between text-xs text-[#64717B]">
                <span>Reception Desk: <strong>{todayCheckins.length} visits today</strong></span>
                <button
                  onClick={() => navigate('/checkins')}
                  className="text-[#16845B] font-semibold hover:underline cursor-pointer flex items-center gap-1"
                >
                  Open Full Desk <ArrowUpRight size={13} />
                </button>
              </div>
              <p className="text-[10px] text-[#16845B] font-medium flex items-center gap-1">
                <span>●</span> Persistent attendance synced with PostgreSQL database.
              </p>
            </div>
          </Card>

          {/* Gym Pulse (Operational Summary) */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#E8F5EE] text-[#16845B] flex items-center justify-center shrink-0">
                  <Activity size={17} strokeWidth={2.2} />
                </div>
                <div>
                  <CardTitle>Gym Pulse</CardTitle>
                  <CardDescription>Live operational summary</CardDescription>
                </div>
              </div>
              {session?.user ? (
                <Badge variant="success">● Live Database</Badge>
              ) : (
                <Badge variant="default">Demo Mode</Badge>
              )}
            </CardHeader>

            <div className="space-y-2.5">
              {/* Row 1: Active Directory */}
              <div className="p-3 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-[#E8F5EE] text-[#16845B] flex items-center justify-center shrink-0">
                    <UserCheck size={15} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-[#25313B] block">Active Directory</span>
                    <span className="text-[11px] text-[#64717B]">{activeMembers.length} valid of {members.length} members</span>
                  </div>
                </div>
                <span className="text-base font-bold text-[#25313B] tabular-nums">{activeMembers.length}</span>
              </div>

              {/* Row 2: Today's Collection */}
              <div className="p-3 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-[#E8F5EE] text-[#16845B] flex items-center justify-center shrink-0">
                    <IndianRupee size={15} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-[#25313B] block">Today's Collection</span>
                    <span className="text-[11px] text-[#64717B]">{todayPayments.length} completed receipt{todayPayments.length === 1 ? '' : 's'}</span>
                  </div>
                </div>
                <span className="text-base font-bold text-[#16845B] tabular-nums">{formatINR(todayCollection)}</span>
              </div>

              {/* Row 3: This Month's Collection */}
              <div className="p-3 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-[#E8F5EE] text-[#16845B] flex items-center justify-center shrink-0">
                    <Calendar size={15} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-[#25313B] block">This Month</span>
                    <span className="text-[11px] text-[#64717B]">{monthPayments.length} completed transaction{monthPayments.length === 1 ? '' : 's'}</span>
                  </div>
                </div>
                <span className="text-base font-bold text-[#16845B] tabular-nums">{formatINR(monthCollection)}</span>
              </div>

              {/* Row 4: Pending Dues */}
              <div className="p-3 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-[#FFF2D8] text-[#A66A00] flex items-center justify-center shrink-0">
                    <CreditCard size={15} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-[#25313B] block">Pending Dues</span>
                    <span className="text-[11px] text-[#64717B]">{pendingPayments.length} member{pendingPayments.length === 1 ? '' : 's'} with balance</span>
                  </div>
                </div>
                <span className={`text-base font-bold tabular-nums ${totalOutstanding > 0 ? 'text-[#B42318]' : 'text-[#16845B]'}`}>
                  {formatINR(totalOutstanding)}
                </span>
              </div>

              {/* Row 5: PT Sessions Today */}
              <div className="p-3 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-[#E8F5EE] text-[#16845B] flex items-center justify-center shrink-0">
                    <Dumbbell size={15} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-[#25313B] block">PT Sessions Today</span>
                    <span className="text-[11px] text-[#64717B]">
                      {completedPtToday.length} completed today
                    </span>
                  </div>
                </div>
                <span className="text-base font-bold text-[#25313B] tabular-nums">{completedPtToday.length}</span>
              </div>

              {/* Row 6: Today's Check-ins (Local) */}
              <div className="p-3 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-[#F5F7F8] text-[#64717B] border border-[#E1E6E9] flex items-center justify-center shrink-0">
                    <LogIn size={15} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-[#25313B] block">Today's Check-ins</span>
                    <span className="text-[11px] text-[#64717B]">Reception Desk (Local)</span>
                  </div>
                </div>
                <span className="text-base font-bold text-[#25313B] tabular-nums">{todayCheckins.length}</span>
              </div>
            </div>
          </Card>

          {/* Today's PT Schedule Card */}
          <Card>
            <CardHeader
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/personal-training')}
                  className="text-xs font-semibold text-[#16845B] hover:text-[#126b49]"
                >
                  All Sessions <ChevronRight size={14} />
                </Button>
              }
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#E8F5EE] text-[#16845B] flex items-center justify-center shrink-0">
                  <Dumbbell size={17} strokeWidth={2.2} />
                </div>
                <div>
                  <CardTitle>PT Sessions Today</CardTitle>
                  <CardDescription>
                    {session?.user ? 'Verified from database ledger' : 'Coach Pravin Joshi sessions'}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <div className="space-y-2.5">
              {completedPtToday.length > 0 ? (
                completedPtToday.map((s) => (
                  <div
                    key={s.id}
                    className="p-3 rounded-xl border border-[#E1E6E9] bg-white flex items-center justify-between gap-2 shadow-xs hover:border-[#16845B]/30 transition-colors"
                  >
                    <div className="min-w-0">
                      <button
                        onClick={() => s.memberId && navigate(`/members/${s.memberId}`)}
                        className="text-xs font-bold text-[#25313B] hover:text-[#16845B] transition-colors truncate block text-left cursor-pointer"
                      >
                        {s.memberName}
                      </button>
                      <p className="text-[11px] text-[#64717B] flex items-center gap-1.5 mt-0.5">
                        <Clock size={11} className="shrink-0 text-[#64717B]" />
                        <span>{s.time || 'Completed'}</span>
                        <span>·</span>
                        <span className="truncate">{s.notes || 'Workout completed'}</span>
                      </p>
                    </div>
                    <StatusBadge status={s.status || 'completed'} />
                  </div>
                ))
              ) : (
                <p className="text-xs text-[#64717B] py-4 text-center bg-[#F5F7F8] rounded-xl">
                  No completed PT sessions recorded for today.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Renew Membership Modal */}
      {renewingMember && (
        <RenewMembershipModal
          isOpen={!!renewingMember}
          member={renewingMember}
          onClose={() => setRenewingMember(null)}
          onSuccess={(res) => {
            setRenewalSuccess(
              `Membership successfully renewed for ${res.memberName} (${res.memberCode || res.memberId}) on ${res.planName} plan until ${res.newExpiryDate}!`
            );
            setTimeout(() => setRenewalSuccess(null), 6000);
          }}
        />
      )}
    </div>
  );
}
