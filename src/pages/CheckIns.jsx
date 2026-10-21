import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge, Badge } from '../components/ui/Badge';
import { SearchInput, Select } from '../components/ui/Input';
import { EmptyState } from '../components/ui/EmptyState';
import { KPICard } from '../components/shared/KPICard';
import {
  getLocalDateString,
  getMembershipStatus,
  getDaysDifference,
  getMemberInitials,
  formatINR,
  isCurrentMonth,
} from '../utils/memberUtils';
import {
  LogIn, LogOut, CheckCircle2, AlertTriangle, XCircle, Search,
  Users, Clock, RotateCcw, Calendar, ArrowRight, CreditCard,
  RotateCw, Check, Activity, User, RefreshCw
} from 'lucide-react';

export default function CheckIns() {
  const navigate = useNavigate();
  const {
    members,
    checkins,
    checkinsLoading,
    checkinsError,
    reloadCheckins,
    addCheckin,
    checkoutMember,
    session,
  } = useApp();

  // Search & Selected Member
  const [deskSearch, setDeskSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // History Table Filters
  const [historySearch, setHistorySearch] = useState('');
  const [historyDateFilter, setHistoryDateFilter] = useState('today'); // 'today' | '7days' | 'month' | 'all'
  const [page, setPage] = useState(1);
  const perPage = 10;

  const todayStr = useMemo(() => getLocalDateString(), []);

  // -------------------------------------------------------------
  // Member Search for Check-in Desk
  // -------------------------------------------------------------
  const searchCandidates = useMemo(() => {
    const q = deskSearch.trim().toLowerCase();
    if (q.length < 1) return [];

    return members.filter(m =>
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.member_code && m.member_code.toLowerCase().includes(q)) ||
      (m.id && m.id.toLowerCase().includes(q)) ||
      (m.phone && m.phone.includes(q))
    ).slice(0, 6);
  }, [members, deskSearch]);

  const handleSelectMember = (member) => {
    setSelectedMember(member);
    setDeskSearch('');
    setFeedback(null);
  };

  // Status & Expiry of selected member
  const selectedStatus = useMemo(() => {
    if (!selectedMember) return null;
    return getMembershipStatus(selectedMember, todayStr);
  }, [selectedMember, todayStr]);

  const selectedDaysLeft = useMemo(() => {
    if (!selectedMember || !selectedMember.expiryDate) return 0;
    return getDaysDifference(selectedMember.expiryDate, todayStr);
  }, [selectedMember, todayStr]);

  // Today's Checkins
  const todayCheckins = useMemo(() => {
    return checkins.filter(c => c.date === todayStr);
  }, [checkins, todayStr]);

  // Unique members checked in today
  const uniqueMembersToday = useMemo(() => {
    const set = new Set(todayCheckins.map(c => c.memberId));
    return set.size;
  }, [todayCheckins]);

  // Active check-in for selected member (currently in gym, unclosed visit)
  const activeOpenCheckin = useMemo(() => {
    if (!selectedMember) return null;
    return checkins.find(c =>
      (c.memberId === selectedMember.id || c.memberId === selectedMember.member_code) &&
      (!c.checkedOutAt && c.rawStatus !== 'checked_out')
    );
  }, [selectedMember, checkins]);

  // Previous completed visits today for selected member
  const previousVisitsToday = useMemo(() => {
    if (!selectedMember) return [];
    return todayCheckins.filter(c =>
      (c.memberId === selectedMember.id || c.memberId === selectedMember.member_code) &&
      (c.checkedOutAt || c.rawStatus === 'checked_out')
    );
  }, [selectedMember, todayCheckins]);

  // Currently in gym across all members
  const currentlyInGymCount = useMemo(() => {
    return checkins.filter(c => c.date === todayStr && !c.checkedOutAt && c.rawStatus !== 'checked_out').length;
  }, [checkins, todayStr]);

  // -------------------------------------------------------------
  // Check-in Execution
  // -------------------------------------------------------------
  const handleCheckin = async () => {
    if (!selectedMember || submitting) return;

    // 1. Expired Member Guard
    if (selectedStatus === 'expired') {
      setFeedback({
        type: 'error',
        message: `Check-in blocked: ${selectedMember.name}'s membership expired on ${selectedMember.expiryDate}. Renewal required.`,
      });
      return;
    }

    // 2. Active Session Guard (Reject duplicate open visit)
    if (activeOpenCheckin) {
      setFeedback({
        type: 'warning',
        message: `${selectedMember.name} is currently in the gym (checked in at ${activeOpenCheckin.time}). Please check out first.`,
      });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    try {
      const res = await addCheckin({
        memberId: selectedMember.id,
        memberName: selectedMember.name,
        plan: selectedMember.plan || 'General',
        status: 'valid',
        date: todayStr,
      });

      const assignedCode = res?.checkin_code || res?.id || 'Saved';
      setFeedback({
        type: 'success',
        message: `${selectedMember.name} checked in successfully! Pass #${assignedCode}`,
      });

      setTimeout(() => {
        setSelectedMember(null);
        setFeedback(null);
      }, 3500);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to record check-in in database.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------
  // Check-out Execution
  // -------------------------------------------------------------
  const handleCheckout = async (checkinId) => {
    if (!checkinId || submitting) return;

    setSubmitting(true);
    setFeedback(null);

    try {
      await checkoutMember({ checkinId });
      setFeedback({
        type: 'success',
        message: `${selectedMember ? selectedMember.name : 'Member'} checked out successfully!`,
      });

      setTimeout(() => {
        setSelectedMember(null);
        setFeedback(null);
      }, 3500);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to record check-out in database.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRowCheckout = async (checkinId, memberName) => {
    if (!checkinId) return;
    try {
      await checkoutMember({ checkinId });
    } catch (err) {
      alert(`Check-out failed: ${err.message}`);
    }
  };

  // -------------------------------------------------------------
  // Attendance History Filtering & Pagination
  // -------------------------------------------------------------
  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();

    return checkins.filter(c => {
      // Search: member name, member ID, checkin code
      const matchSearch =
        !q ||
        (c.memberName && c.memberName.toLowerCase().includes(q)) ||
        (c.memberCode && c.memberCode.toLowerCase().includes(q)) ||
        (c.memberId && c.memberId.toLowerCase().includes(q)) ||
        (c.checkinCode && c.checkinCode.toLowerCase().includes(q)) ||
        (c.id && c.id.toLowerCase().includes(q));

      if (!matchSearch) return false;

      // Date Filter
      if (historyDateFilter === 'today') {
        return c.date === todayStr;
      }
      if (historyDateFilter === '7days') {
        const diff = getDaysDifference(todayStr, c.date);
        return diff >= 0 && diff <= 7;
      }
      if (historyDateFilter === 'month') {
        return isCurrentMonth(c.date, todayStr);
      }

      return true; // 'all'
    });
  }, [checkins, historySearch, historyDateFilter, todayStr]);

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / perPage));
  const pagedHistory = filteredHistory.slice((page - 1) * perPage, page * perPage);

  const resetHistoryFilters = () => {
    setHistorySearch('');
    setHistoryDateFilter('today');
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Check-in Desk & Attendance"
        description="Live front-desk member attendance verification, pass validity checks, and persistent visit ledger."
        badge={
          <div className="flex items-center gap-2">
            {session?.user ? (
              <Badge variant="success">● Live Attendance Sync</Badge>
            ) : (
              <Badge variant="default">Demo Mode</Badge>
            )}
            <Badge variant="accent">Today: {todayCheckins.length} Visits ({uniqueMembersToday} Unique)</Badge>
          </div>
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            disabled={checkinsLoading}
            onClick={() => reloadCheckins && reloadCheckins()}
            className={checkinsLoading ? 'animate-spin' : ''}
          >
            {checkinsLoading ? 'Syncing...' : 'Refresh'}
          </Button>
        }
      />

      {/* Sync Error Notice */}
      {checkinsError && (
        <div className="p-4 rounded-xl bg-[#FCE9E9] border border-[#B42318]/25 text-[#B42318] text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            <span>Attendance database sync error: {checkinsError}</span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => reloadCheckins && reloadCheckins()}
            className="text-xs shrink-0"
          >
            Retry Sync
          </Button>
        </div>
      )}

      {/* Attendance Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          icon={LogIn}
          label="Today's Check-ins"
          value={todayCheckins.length}
          subtitle="Total verified entries today"
          variant="accent"
        />
        <KPICard
          icon={Users}
          label="Unique Members Today"
          value={uniqueMembersToday}
          subtitle="Distinct active gym-goers"
          variant="default"
        />
        <KPICard
          icon={Clock}
          label="Currently In Gym"
          value={currentlyInGymCount}
          subtitle="Active unclosed workout sessions"
          variant="default"
        />
        <KPICard
          icon={Calendar}
          label="Total Database Logs"
          value={checkins.length}
          subtitle="Recorded attendance events"
          variant="default"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ========================================================
            CHECK-IN DESK PANEL (LEFT COLUMN)
            ======================================================== */}
        <Card className="lg:col-span-1 h-fit">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Member Verification & Check-in</CardTitle>
              {checkinsLoading && <span className="text-[11px] text-[#64717B] animate-pulse">Syncing...</span>}
            </div>
          </CardHeader>

          {/* Search Box */}
          <div className="relative mb-4">
            <SearchInput
              placeholder="Search by name, member code (MEM-...), or phone..."
              value={deskSearch}
              onChange={(e) => setDeskSearch(e.target.value)}
              onClear={() => setDeskSearch('')}
            />

            {/* Live Search Candidate Dropdown */}
            {searchCandidates.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-[#E1E6E9] rounded-xl shadow-xl z-20 overflow-hidden divide-y divide-[#E1E6E9] animate-in">
                {searchCandidates.map(m => {
                  const status = getMembershipStatus(m, todayStr);
                  const isExpired = status === 'expired';
                  const inGym = checkins.some(c =>
                    (c.memberId === m.id || c.memberId === m.member_code) &&
                    (!c.checkedOutAt && c.rawStatus !== 'checked_out')
                  );

                  return (
                    <button
                      key={m.id}
                      onClick={() => handleSelectMember(m)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#F5F7F8] text-left cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          isExpired ? 'bg-[#FCE9E9] text-[#B42318]' : 'bg-[#E8F5EE] text-[#16845B]'
                        }`}>
                          {getMemberInitials(m.name)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-[#25313B]">{m.name}</p>
                          <p className="text-xs text-[#64717B] font-mono">
                            {m.member_code || m.id} • {m.phone || 'No phone'}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        {inGym ? (
                          <Badge variant="accent">In Gym</Badge>
                        ) : (
                          <StatusBadge status={status} />
                        )}
                        {Number(m.balance) > 0 && (
                          <p className="text-[10px] text-[#A66A00] font-bold mt-0.5">
                            Due: {formatINR(m.balance)}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected Member Verification Card */}
          {selectedMember ? (
            <div className="space-y-4">
              <div className="p-4 bg-[#F5F7F8] rounded-xl border border-[#E1E6E9] space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-[#E8F5EE] border border-[#16845B]/25 flex items-center justify-center text-[#16845B] text-base font-bold shadow-xs">
                      {getMemberInitials(selectedMember.name)}
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-[#25313B]">{selectedMember.name}</h4>
                      <p className="text-xs font-mono text-[#64717B]">
                        {selectedMember.member_code || selectedMember.id} • {selectedMember.phone}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => { setSelectedMember(null); setFeedback(null); }}
                    className="text-xs text-[#64717B] hover:text-[#25313B] p-1 cursor-pointer"
                    title="Change member"
                  >
                    ✕
                  </button>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-2.5 text-xs pt-1">
                  <div className="p-2.5 bg-white rounded-lg border border-[#E1E6E9]">
                    <span className="text-[#64717B] block text-[10px] uppercase font-semibold">Plan</span>
                    <strong className="text-[#25313B] font-semibold text-xs mt-0.5 block truncate">
                      {selectedMember.plan || 'General'}
                    </strong>
                  </div>

                  <div className="p-2.5 bg-white rounded-lg border border-[#E1E6E9]">
                    <span className="text-[#64717B] block text-[10px] uppercase font-semibold">Plan Status</span>
                    <div className="mt-0.5"><StatusBadge status={selectedStatus} /></div>
                  </div>

                  <div className="p-2.5 bg-white rounded-lg border border-[#E1E6E9]">
                    <span className="text-[#64717B] block text-[10px] uppercase font-semibold">Expiry Date</span>
                    <strong className={`font-semibold text-xs mt-0.5 block ${
                      selectedStatus === 'expired' ? 'text-[#B42318]' : selectedDaysLeft <= 5 ? 'text-[#A66A00]' : 'text-[#25313B]'
                    }`}>
                      {selectedMember.expiryDate || 'N/A'}
                    </strong>
                  </div>

                  <div className="p-2.5 bg-white rounded-lg border border-[#E1E6E9]">
                    <span className="text-[#64717B] block text-[10px] uppercase font-semibold">Days Remaining</span>
                    <strong className={`font-semibold text-xs mt-0.5 block ${
                      selectedDaysLeft < 0 ? 'text-[#B42318]' : selectedDaysLeft <= 5 ? 'text-[#A66A00]' : 'text-[#16845B]'
                    }`}>
                      {selectedDaysLeft < 0 ? `Expired (${Math.abs(selectedDaysLeft)}d ago)` : `${selectedDaysLeft} days`}
                    </strong>
                  </div>
                </div>

                {/* Outstanding Dues Callout */}
                {Number(selectedMember.balance) > 0 && (
                  <div className="p-2.5 rounded-lg bg-[#FFF2D8] border border-[#A66A00]/25 text-xs flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[#A66A00]">
                      <AlertTriangle size={15} className="shrink-0" />
                      <span>Pending Dues: <strong>{formatINR(selectedMember.balance)}</strong></span>
                    </div>
                    <button
                      onClick={() => navigate(`/payments?record=true&memberId=${selectedMember.id}`)}
                      className="text-[11px] font-bold text-[#16845B] hover:underline cursor-pointer bg-white px-2 py-0.5 rounded border border-[#16845B]/30 shrink-0"
                    >
                      Collect Dues
                    </button>
                  </div>
                )}

                {/* In Gym Status Callout */}
                {activeOpenCheckin && (
                  <div className="p-3 rounded-lg bg-[#E8F5EE] border border-[#16845B]/30 text-xs text-[#25313B] space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[#16845B] font-bold">
                      <Clock size={15} className="shrink-0" />
                      <span>Currently Active in Gym</span>
                    </div>
                    <p className="text-[11px] text-[#64717B]">
                      Checked in at <strong>{activeOpenCheckin.time}</strong> (Pass #{activeOpenCheckin.checkinCode || activeOpenCheckin.id}). The session must be checked out before a new check-in can be recorded.
                    </p>
                  </div>
                )}

                {/* Prior Visit Today Notice */}
                {!activeOpenCheckin && previousVisitsToday.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-[#F5F7F8] border border-[#E1E6E9] text-xs text-[#64717B] space-y-1">
                    <div className="flex items-center gap-1 text-[#25313B] font-medium">
                      <Clock size={14} className="shrink-0 text-[#16845B]" />
                      <span>Completed visit earlier today (at {previousVisitsToday[0].time})</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              {selectedStatus === 'expired' ? (
                <div className="space-y-2">
                  <div className="p-3 rounded-xl bg-[#FCE9E9] border border-[#B42318]/25 text-xs text-[#B42318] flex items-center gap-2">
                    <XCircle size={16} className="shrink-0" />
                    <span>Membership has expired. Check-in is blocked until renewed.</span>
                  </div>
                  <Button
                    className="w-full"
                    icon={RotateCw}
                    onClick={() => navigate(`/members/${selectedMember.id}?renew=true`)}
                  >
                    Renew Membership First
                  </Button>
                </div>
              ) : activeOpenCheckin ? (
                <div className="space-y-2">
                  <Button
                    className="w-full py-3 bg-[#16845B] hover:bg-[#126b49] text-white font-bold"
                    icon={LogOut}
                    disabled={submitting}
                    onClick={() => handleCheckout(activeOpenCheckin.checkinId || activeOpenCheckin.id)}
                  >
                    {submitting ? 'Checking Out...' : 'Check Out Member Now'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setSelectedMember(null); setFeedback(null); }}
                    className="w-full text-xs text-[#64717B]"
                  >
                    Cancel / Select Another Member
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Button
                    className="w-full py-3"
                    icon={LogIn}
                    disabled={submitting}
                    onClick={handleCheckin}
                  >
                    {submitting ? 'Verifying & Logging Check-in...' : 'Confirm Check-in'}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-10 px-4 text-xs text-[#64717B] space-y-2 bg-[#F5F7F8]/60 rounded-xl border border-dashed border-[#E1E6E9]">
              <LogIn size={28} className="mx-auto text-[#64717B]/50" />
              <p className="font-semibold text-sm text-[#25313B]">Front Desk Ready</p>
              <p>Type member name, member code (e.g. MEM-01001), or mobile number in the search bar above.</p>
            </div>
          )}

          {/* Feedback Notice */}
          {feedback && (
            <div className={`mt-4 p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2.5 animate-in ${
              feedback.type === 'success'
                ? 'bg-[#E8F5EE] border-[#16845B]/25 text-[#16845B]'
                : feedback.type === 'warning'
                ? 'bg-[#FFF2D8] border-[#A66A00]/25 text-[#A66A00]'
                : 'bg-[#FCE9E9] border-[#B42318]/25 text-[#B42318]'
            }`}>
              {feedback.type === 'success' ? (
                <CheckCircle2 size={16} className="shrink-0" />
              ) : feedback.type === 'warning' ? (
                <AlertTriangle size={16} className="shrink-0" />
              ) : (
                <XCircle size={16} className="shrink-0" />
              )}
              <p className="leading-snug">{feedback.message}</p>
            </div>
          )}
        </Card>

        {/* ========================================================
            ATTENDANCE LOG & HISTORY (RIGHT 2 COLUMNS)
            ======================================================== */}
        <Card className="lg:col-span-2" padding={false}>
          {/* Controls Bar */}
          <div className="p-4 border-b border-[#E1E6E9] flex flex-col sm:flex-row gap-3 items-center justify-between">
            <SearchInput
              placeholder="Search member name, code, or pass ID in logs..."
              value={historySearch}
              onChange={(e) => { setHistorySearch(e.target.value); setPage(1); }}
              onClear={() => { setHistorySearch(''); setPage(1); }}
              className="w-full sm:w-64"
            />

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Select
                value={historyDateFilter}
                onChange={(e) => { setHistoryDateFilter(e.target.value); setPage(1); }}
                options={[
                  { value: 'today', label: "Today's Attendance" },
                  { value: '7days', label: 'Last 7 Days' },
                  { value: 'month', label: 'This Month' },
                  { value: 'all', label: 'All-Time Database Logs' },
                ]}
                className="w-48"
              />

              {(historySearch || historyDateFilter !== 'today') && (
                <Button variant="ghost" size="sm" icon={RotateCcw} onClick={resetHistoryFilters}>
                  Reset
                </Button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#F5F7F8] border-b border-[#E1E6E9] text-[#64717B] text-xs font-semibold uppercase">
                <tr>
                  <th className="px-4 py-3">Pass Code</th>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3 hidden sm:table-cell">Plan</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">In / Out Time</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E6E9]">
                {pagedHistory.map(c => {
                  const isInGym = !c.checkedOutAt && c.rawStatus !== 'checked_out';
                  return (
                    <tr key={c.id || c.checkinId} className="hover:bg-[#F5F7F8]/60 transition-colors">
                      {/* Log ID */}
                      <td className="px-4 py-3.5 text-xs font-mono text-[#64717B]">
                        {c.checkinCode || c.id}
                      </td>

                      {/* Member */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-[#E8F5EE] text-[#16845B] flex items-center justify-center text-xs font-bold shrink-0">
                            {getMemberInitials(c.memberName)}
                          </div>
                          <div>
                            <button
                              onClick={() => c.memberId && navigate(`/members/${c.memberId}`)}
                              className="font-semibold text-sm text-[#25313B] hover:text-[#16845B] cursor-pointer text-left hover:underline block"
                            >
                              {c.memberName}
                            </button>
                            <p className="text-[11px] font-mono text-[#64717B]">
                              {c.memberCode || c.memberId}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Plan */}
                      <td className="px-4 py-3.5 text-xs text-[#64717B] hidden sm:table-cell">
                        {c.plan || 'General'}
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3.5 text-xs text-[#25313B] whitespace-nowrap">
                        {c.date === todayStr ? (
                          <span className="font-semibold text-[#16845B]">Today</span>
                        ) : (
                          c.date
                        )}
                      </td>

                      {/* In / Out Time */}
                      <td className="px-4 py-3.5 text-xs whitespace-nowrap tabular-nums">
                        <div className="font-medium text-[#25313B]">In: {c.time}</div>
                        {c.checkedOutTime ? (
                          <div className="text-[11px] text-[#64717B]">Out: {c.checkedOutTime}</div>
                        ) : isInGym ? (
                          <span className="text-[10px] font-bold text-[#16845B] bg-[#E8F5EE] px-1.5 py-0.5 rounded">
                            In Gym
                          </span>
                        ) : null}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        {isInGym ? (
                          <Badge variant="accent">In Gym</Badge>
                        ) : (
                          <StatusBadge status={c.status || 'valid'} />
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {isInGym && (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={LogOut}
                              onClick={() => handleRowCheckout(c.checkinId || c.id, c.memberName)}
                              className="text-xs h-7 px-2 text-[#16845B] border-[#16845B]/30"
                              title="Check out member"
                            >
                              Check Out
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => c.memberId && navigate(`/members/${c.memberId}`)}
                            className="text-xs h-7 px-2"
                          >
                            Profile <ArrowRight size={13} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {pagedHistory.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12">
                      <EmptyState
                        icon={LogIn}
                        title="No attendance records found"
                        description={
                          historySearch || historyDateFilter !== 'today'
                            ? "No check-ins match your current search and filter criteria."
                            : "No gym check-ins have been recorded today yet."
                        }
                        action={
                          (historySearch || historyDateFilter !== 'today') ? (
                            <Button variant="secondary" size="sm" onClick={resetHistoryFilters}>
                              Reset Filters
                            </Button>
                          ) : null
                        }
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {filteredHistory.length > perPage && (
            <div className="p-4 border-t border-[#E1E6E9] flex items-center justify-between text-xs text-[#64717B]">
              <span>
                Showing <strong>{(page - 1) * perPage + 1}</strong> to <strong>{Math.min(page * perPage, filteredHistory.length)}</strong> of <strong>{filteredHistory.length}</strong> records
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className="h-8 px-2.5 text-xs"
                >
                  Previous
                </Button>
                <span className="px-2 font-medium text-[#25313B]">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="h-8 px-2.5 text-xs"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
