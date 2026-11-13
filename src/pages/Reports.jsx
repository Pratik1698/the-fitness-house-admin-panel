import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Select, Input, SearchInput } from '../components/ui/Input';
import { KPICard } from '../components/shared/KPICard';
import { EmptyState } from '../components/ui/EmptyState';
import {
  formatINR,
  getLocalDateString,
  getDaysDifference,
  getExpiryClassification,
  isCurrentMonth,
  getPaymentPurpose,
} from '../utils/memberUtils';
import {
  exportTransactionsCSV,
  exportOutstandingDuesCSV,
  exportAttendanceCSV,
  exportPtReportCSV,
} from '../utils/exportUtils';
import {
  computePlanDetailsTableData,
  computePlanDistributionData,
  isDateInRange as checkDateInRange,
  computeTopFrequentMembers,
  computeLowActivityMembers,
} from '../utils/analyticsUtils';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
  Download, FileSpreadsheet, Calendar, IndianRupee,
  Users, UserCheck, TrendingUp, Dumbbell, Award, AlertCircle,
  AlertTriangle, CheckCircle2, Clock, CreditCard, ArrowUpRight,
  Search, RotateCcw, Check, ExternalLink, Filter, Lock, ShieldAlert
} from 'lucide-react';

export default function Reports() {
  const navigate = useNavigate();
  const {
    members,
    payments,
    checkins,
    ptClients,
    ptSessions,
    allMembershipPlans,
    membershipPlans,
    subscriptions,
    role,
    isAdmin,
  } = useApp();

  const todayStr = useMemo(() => getLocalDateString(), []);

  // Global Report Filters
  // For staff: default to 'attendance' since financial overview is restricted to admins
  const [activeTab, setActiveTab] = useState(isAdmin ? 'overview' : 'attendance'); // 'overview' | 'finance' | 'dues' | 'membership' | 'attendance' | 'pt'

  // Enforce staff restriction: if non-admin tries to land on financial tabs, clamp to 'attendance'
  useEffect(() => {
    if (!isAdmin && (activeTab === 'overview' || activeTab === 'finance' || activeTab === 'dues')) {
      setActiveTab('attendance');
    }
  }, [isAdmin, activeTab]);
  const [dateRangePreset, setDateRangePreset] = useState('this_month'); // 'all' | 'today' | '7days' | '30days' | 'this_month' | 'last_month' | 'this_year' | 'custom'
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [exportNotice, setExportNotice] = useState(null);

  // Search & Filter within Sub-Reports
  const [txSearch, setTxSearch] = useState('');
  const [txMethodFilter, setTxMethodFilter] = useState('all');
  const [txCategoryFilter, setTxCategoryFilter] = useState('all');

  const [duesSearch, setDuesSearch] = useState('');
  const [duesStatusFilter, setDuesStatusFilter] = useState('all');

  const [attendanceSearch, setAttendanceSearch] = useState('');

  // ==========================================
  // Date Filtering Engine
  // ==========================================
  const isDateInRange = (dateStr) => {
    if (!dateStr) return false;
    if (dateRangePreset === 'all') return true;
    if (dateRangePreset === 'today') return dateStr === todayStr;

    // Helper: calculate past date string
    const getPastDateStr = (daysAgo) => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      return getLocalDateString(d);
    };

    if (dateRangePreset === '7days') {
      const minDate = getPastDateStr(6);
      return dateStr >= minDate && dateStr <= todayStr;
    }

    if (dateRangePreset === '30days') {
      const minDate = getPastDateStr(29);
      return dateStr >= minDate && dateStr <= todayStr;
    }

    if (dateRangePreset === 'this_month') {
      return dateStr.slice(0, 7) === todayStr.slice(0, 7);
    }

    if (dateRangePreset === 'last_month') {
      const [currY, currM] = todayStr.split('-').map(Number);
      const prevM = currM === 1 ? 12 : currM - 1;
      const prevY = currM === 1 ? currY - 1 : currY;
      const lastMonthPrefix = `${prevY}-${String(prevM).padStart(2, '0')}`;
      return dateStr.slice(0, 7) === lastMonthPrefix;
    }

    if (dateRangePreset === 'this_year') {
      return dateStr.slice(0, 4) === todayStr.slice(0, 4);
    }

    if (dateRangePreset === 'custom') {
      return checkDateInRange(dateStr, customStart, customEnd);
    }

    return true;
  };

  // Label for current active date range
  const dateRangeLabel = useMemo(() => {
    switch (dateRangePreset) {
      case 'all': return 'All Time';
      case 'today': return `Today (${todayStr})`;
      case '7days': return 'Last 7 Days';
      case '30days': return 'Last 30 Days';
      case 'this_month': return `This Month (${todayStr.slice(0, 7)})`;
      case 'last_month': return 'Last Calendar Month';
      case 'this_year': return `This Year (${todayStr.slice(0, 4)})`;
      case 'custom': return customStart && customEnd ? `${customStart} to ${customEnd}` : 'Custom Date Range';
      default: return 'Selected Period';
    }
  }, [dateRangePreset, customStart, customEnd, todayStr]);

  // ==========================================
  // 1. Revenue Calculations
  // ==========================================
  // Exclude failed/cancelled payments
  const validPayments = useMemo(() => {
    return payments.filter(p => p.status !== 'failed' && p.status !== 'cancelled');
  }, [payments]);

  // Payments in selected date range
  const inRangePayments = useMemo(() => {
    return validPayments.filter(p => isDateInRange(p.date));
  }, [validPayments, dateRangePreset, customStart, customEnd, todayStr]);

  // Today's collections
  const todayCollections = useMemo(() => {
    return validPayments.filter(p => p.date === todayStr).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }, [validPayments, todayStr]);

  // This month's collections
  const thisMonthCollections = useMemo(() => {
    return validPayments.filter(p => isCurrentMonth(p.date, todayStr)).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }, [validPayments, todayStr]);

  // Filtered period total collection
  const periodTotalRevenue = useMemo(() => {
    return inRangePayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }, [inRangePayments]);

  // All-time total collection
  const allTimeTotalRevenue = useMemo(() => {
    return validPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }, [validPayments]);

  // Membership vs PT breakdown in selected range
  const periodMembershipRevenue = useMemo(() => {
    return inRangePayments.filter(p => p.category === 'Membership').reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }, [inRangePayments]);

  const periodPtRevenue = useMemo(() => {
    return inRangePayments.filter(p => p.category === 'Personal Training').reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }, [inRangePayments]);

  const periodOtherRevenue = useMemo(() => {
    return inRangePayments.filter(p => p.category !== 'Membership' && p.category !== 'Personal Training').reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }, [inRangePayments]);

  // Payment method breakdown in selected range
  const methodStats = useMemo(() => {
    const stats = {
      UPI: { amount: 0, count: 0 },
      Cash: { amount: 0, count: 0 },
      Card: { amount: 0, count: 0 },
      Other: { amount: 0, count: 0 },
    };

    inRangePayments.forEach(p => {
      const m = p.method === 'UPI' ? 'UPI' : p.method === 'Cash' ? 'Cash' : p.method === 'Card' ? 'Card' : 'Other';
      stats[m].amount += (Number(p.amount) || 0);
      stats[m].count += 1;
    });

    return stats;
  }, [inRangePayments]);

  // Transaction count and average value
  const txCount = inRangePayments.length;
  const avgTxValue = txCount > 0 ? Math.round(periodTotalRevenue / txCount) : 0;

  // Filtered transactions for the ledger table
  const filteredLedgerPayments = useMemo(() => {
    const q = txSearch.trim().toLowerCase();
    return inRangePayments.filter(p => {
      const matchSearch =
        !q ||
        (p.memberName && p.memberName.toLowerCase().includes(q)) ||
        (p.id && p.id.toLowerCase().includes(q)) ||
        (p.memberId && p.memberId.toLowerCase().includes(q)) ||
        (p.purpose && p.purpose.toLowerCase().includes(q));

      if (!matchSearch) return false;
      if (txMethodFilter !== 'all' && p.method !== txMethodFilter) return false;
      if (txCategoryFilter !== 'all' && p.category !== txCategoryFilter) return false;
      return true;
    });
  }, [inRangePayments, txSearch, txMethodFilter, txCategoryFilter]);

  // Monthly revenue chart data (Last 6 Months)
  const monthlyRevenueChartData = useMemo(() => {
    const months = [];
    const today = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const ym = `${y}-${m}`;
      const monthName = d.toLocaleString('en-US', { month: 'short' });

      // Aggregate payments matching this year-month
      const monthPayments = validPayments.filter(p => p.date && p.date.startsWith(ym));
      const mRevenue = monthPayments.filter(p => p.category === 'Membership').reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const ptRev = monthPayments.filter(p => p.category === 'Personal Training').reduce((s, p) => s + (Number(p.amount) || 0), 0);

      months.push({
        month: monthName,
        membership: mRevenue,
        pt: ptRev,
        total: mRevenue + ptRev,
      });
    }

    return months;
  }, [validPayments]);

  // ==========================================
  // 2. Outstanding Dues Calculations
  // ==========================================
  const membersWithDues = useMemo(() => {
    return members.filter(m => (Number(m.balance) || 0) > 0);
  }, [members]);

  const totalOutstandingDues = useMemo(() => {
    return membersWithDues.reduce((s, m) => s + (Number(m.balance) || 0), 0);
  }, [membersWithDues]);

  const filteredDuesMembers = useMemo(() => {
    const q = duesSearch.trim().toLowerCase();
    return membersWithDues.filter(m => {
      const matchSearch =
        !q ||
        (m.name && m.name.toLowerCase().includes(q)) ||
        (m.id && m.id.toLowerCase().includes(q)) ||
        (m.phone && m.phone.includes(q)) ||
        (m.plan && m.plan.toLowerCase().includes(q));

      if (!matchSearch) return false;
      if (duesStatusFilter !== 'all' && m.status !== duesStatusFilter) return false;
      return true;
    }).sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0));
  }, [membersWithDues, duesSearch, duesStatusFilter]);

  // ==========================================
  // 3. Membership Reports Calculations
  // ==========================================
  const activeMembersCount = useMemo(() => members.filter(m => m.status === 'active').length, [members]);
  const expiredMembersCount = useMemo(() => members.filter(m => m.status === 'expired').length, [members]);

  const expiring3DaysCount = useMemo(() => {
    return members.filter(m => getExpiryClassification(m, todayStr).tier === 'expiring_3d').length;
  }, [members, todayStr]);

  const expiring5DaysCount = useMemo(() => {
    return members.filter(m => {
      const t = getExpiryClassification(m, todayStr).tier;
      return t === 'expiring_3d' || t === 'expiring_5d';
    }).length;
  }, [members, todayStr]);

  // New registrations in selected range
  const newRegistrationsCount = useMemo(() => {
    return members.filter(m => m.joinDate && isDateInRange(m.joinDate)).length;
  }, [members, dateRangePreset, customStart, customEnd, todayStr]);

  // Renewals in selected range
  const renewalsCount = useMemo(() => {
    return validPayments.filter(p => {
      const purpose = (p.purpose || p.notes || '').toLowerCase();
      return (purpose.includes('renewal') || purpose.includes('renew')) && isDateInRange(p.date);
    }).length;
  }, [validPayments, dateRangePreset, customStart, customEnd, todayStr]);

  // Detailed Plan Breakdown Table data (Dynamic from Supabase catalog, subscriptions, and payments)
  const planDetailsTableData = useMemo(() => {
    return computePlanDetailsTableData({
      allMembershipPlans,
      membershipPlans,
      members,
      subscriptions,
      payments,
      isDateInRange,
    });
  }, [allMembershipPlans, membershipPlans, members, subscriptions, payments, dateRangePreset, customStart, customEnd, todayStr]);

  // Plan Distribution dynamic chart data (Derived from authoritative plan table data)
  const planDistributionData = useMemo(() => {
    return computePlanDistributionData(planDetailsTableData, activeMembersCount);
  }, [planDetailsTableData, activeMembersCount]);

  // ==========================================
  // 4. Attendance Reports Calculations
  // ==========================================
  // Check-ins in selected date range
  const inRangeCheckins = useMemo(() => {
    return checkins.filter(c => isDateInRange(c.date));
  }, [checkins, dateRangePreset, customStart, customEnd, todayStr]);

  const uniqueMembersAttending = useMemo(() => {
    return new Set(inRangeCheckins.map(c => c.memberId)).size;
  }, [inRangeCheckins]);

  // Today's attendance
  const todayCheckinsList = useMemo(() => {
    return checkins.filter(c => c.date === todayStr);
  }, [checkins, todayStr]);

  const todayUniqueMembers = useMemo(() => {
    return new Set(todayCheckinsList.map(c => c.memberId)).size;
  }, [todayCheckinsList]);

  // Most frequent visitors from actual check-in records (shared calculation)
  const topFrequentMembers = useMemo(() => {
    return computeTopFrequentMembers({ members, checkins, limit: 5 });
  }, [members, checkins]);

  // Low activity members (<3 visits among active, ascending sort, shared calculation)
  const lowActivityMembers = useMemo(() => {
    return computeLowActivityMembers({ members, checkins, threshold: 3, limit: 5 });
  }, [members, checkins]);

  // Filtered check-in logs
  const filteredAttendanceLogs = useMemo(() => {
    const q = attendanceSearch.trim().toLowerCase();
    return inRangeCheckins.filter(c => {
      return (
        !q ||
        (c.memberName && c.memberName.toLowerCase().includes(q)) ||
        (c.memberId && c.memberId.toLowerCase().includes(q)) ||
        (c.plan && c.plan.toLowerCase().includes(q))
      );
    });
  }, [inRangeCheckins, attendanceSearch]);

  // Attendance by Day of Week Chart Data
  const weeklyAttendanceTrendData = useMemo(() => {
    const dayMap = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    inRangeCheckins.forEach(c => {
      if (c.date) {
        const d = new Date(c.date);
        const dayName = dayNames[d.getDay()];
        if (dayMap[dayName] !== undefined) {
          dayMap[dayName] += 1;
        }
      }
    });

    return [
      { day: 'Mon', checkins: dayMap.Mon },
      { day: 'Tue', checkins: dayMap.Tue },
      { day: 'Wed', checkins: dayMap.Wed },
      { day: 'Thu', checkins: dayMap.Thu },
      { day: 'Fri', checkins: dayMap.Fri },
      { day: 'Sat', checkins: dayMap.Sat },
      { day: 'Sun', checkins: dayMap.Sun },
    ];
  }, [inRangeCheckins]);

  // ==========================================
  // 5. Personal Training Reports Calculations
  // ==========================================
  const activePtClientsList = useMemo(() => ptClients.filter(c => c.status === 'active'), [ptClients]);
  const activePtPackagesCount = activePtClientsList.length;

  const totalRemainingPtSessions = useMemo(() => {
    return activePtClientsList.reduce((s, c) => s + (Number(c.remainingSessions) || 0), 0);
  }, [activePtClientsList]);

  // Sessions in range
  const inRangePtSessions = useMemo(() => {
    return ptSessions.filter(s => isDateInRange(s.date));
  }, [ptSessions, dateRangePreset, customStart, customEnd, todayStr]);

  const ptSessionsScheduledCount = inRangePtSessions.filter(s => s.status === 'scheduled').length;
  const ptSessionsCompletedCount = inRangePtSessions.filter(s => s.status === 'completed').length;
  const ptSessionsCancelledCount = inRangePtSessions.filter(s => s.status === 'cancelled' || s.status === 'no-show').length;

  const ptEndingSoonCount = useMemo(() => {
    return ptClients.filter(c => {
      if (c.status !== 'active') return false;
      const isLow = Number(c.remainingSessions) <= 3;
      const days = c.validTill ? getDaysDifference(c.validTill, todayStr) : null;
      return isLow || (days !== null && days <= 5);
    }).length;
  }, [ptClients, todayStr]);

  const ptExpiredOrDoneCount = useMemo(() => {
    return ptClients.filter(c => c.status === 'completed' || c.status === 'expired' || Number(c.remainingSessions) === 0).length;
  }, [ptClients]);

  // Trainer Workload Breakdown
  const trainerWorkloadData = useMemo(() => {
    const trainers = {};

    ptClients.forEach(c => {
      const t = c.trainer || 'Coach Pravin Joshi';
      if (!trainers[t]) {
        trainers[t] = { name: t, activeClients: 0, scheduledSessions: 0, completedSessions: 0, totalSessions: 0 };
      }
      if (c.status === 'active') {
        trainers[t].activeClients += 1;
      }
    });

    ptSessions.forEach(s => {
      const t = s.trainer || 'Coach Pravin Joshi';
      if (!trainers[t]) {
        trainers[t] = { name: t, activeClients: 0, scheduledSessions: 0, completedSessions: 0, totalSessions: 0 };
      }
      trainers[t].totalSessions += 1;
      if (s.status === 'completed') trainers[t].completedSessions += 1;
      if (s.status === 'scheduled') trainers[t].scheduledSessions += 1;
    });

    return Object.values(trainers);
  }, [ptClients, ptSessions]);

  // ==========================================
  // CSV Export Handlers
  // ==========================================
  const triggerExport = (type) => {
    // Strictly block financial exports for non-admin staff
    if (!isAdmin && (type === 'transactions' || type === 'dues')) {
      setExportNotice('Access Restricted: Financial records export is reserved for administrators only.');
      setTimeout(() => setExportNotice(null), 4000);
      return;
    }

    const dateStamp = todayStr;
    switch (type) {
      case 'transactions':
        if (!isAdmin) return;
        exportTransactionsCSV(inRangePayments, `tfh_transactions_${dateStamp}`);
        setExportNotice(`Exported ${inRangePayments.length} transactions to CSV.`);
        break;
      case 'dues':
        if (!isAdmin) return;
        exportOutstandingDuesCSV(filteredDuesMembers, `tfh_outstanding_dues_${dateStamp}`);
        setExportNotice(`Exported ${filteredDuesMembers.length} outstanding dues records to CSV.`);
        break;
      case 'attendance':
        exportAttendanceCSV(inRangeCheckins, `tfh_attendance_${dateStamp}`);
        setExportNotice(`Exported ${inRangeCheckins.length} attendance records to CSV.`);
        break;
      case 'pt':
        exportPtReportCSV(ptClients, `tfh_personal_training_${dateStamp}`);
        setExportNotice(`Exported ${ptClients.length} PT client records to CSV.`);
        break;
      default:
        if (isAdmin) {
          exportTransactionsCSV(inRangePayments, `tfh_report_${dateStamp}`);
          setExportNotice('Report exported to CSV.');
        } else {
          exportAttendanceCSV(inRangeCheckins, `tfh_attendance_${dateStamp}`);
          setExportNotice(`Exported ${inRangeCheckins.length} attendance records to CSV.`);
        }
    }
    setTimeout(() => setExportNotice(null), 5000);
  };

  const reportTabs = isAdmin
    ? [
        { id: 'overview', label: 'Executive Overview' },
        { id: 'finance', label: 'Financial & Revenue' },
        { id: 'dues', label: `Outstanding Dues (${membersWithDues.length})` },
        { id: 'membership', label: 'Membership Analytics' },
        { id: 'attendance', label: 'Attendance Trends' },
        { id: 'pt', label: 'Personal Training' },
      ]
    : [
        { id: 'attendance', label: 'Attendance & Check-in Trends' },
        { id: 'pt', label: 'Personal Training Operations' },
        { id: 'membership', label: 'Membership Operations' },
      ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title={isAdmin ? "Reports & Business Analytics" : "Operational Reports & Activity"}
        description={
          isAdmin
            ? "Comprehensive audit of gym revenue streams, outstanding member balances, attendance patterns, and personal training operations."
            : "Operational overview of gym attendance patterns, daily check-in activity, and personal training session completion."
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {/* Date Range Selector */}
            <Select
              value={dateRangePreset}
              onChange={(e) => setDateRangePreset(e.target.value)}
              options={[
                { value: 'all', label: 'All Time' },
                { value: 'today', label: 'Today' },
                { value: '7days', label: 'Last 7 Days' },
                { value: '30days', label: 'Last 30 Days' },
                { value: 'this_month', label: 'This Month' },
                { value: 'last_month', label: 'Last Month' },
                { value: 'this_year', label: 'This Year' },
                { value: 'custom', label: 'Custom Range...' },
              ]}
              className="w-40"
            />

            {/* Custom Date Pickers */}
            {dateRangePreset === 'custom' && (
              <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-[#E1E6E9]">
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-32 h-8 text-xs"
                />
                <span className="text-xs text-[#64717B]">to</span>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-32 h-8 text-xs"
                />
              </div>
            )}

            {/* CSV Download (Restricted to non-financial datasets for staff) */}
            <Button
              variant="secondary"
              icon={FileSpreadsheet}
              onClick={() => {
                if (activeTab === 'dues') triggerExport('dues');
                else if (activeTab === 'attendance') triggerExport('attendance');
                else if (activeTab === 'pt') triggerExport('pt');
                else if (isAdmin) triggerExport('transactions');
                else triggerExport('attendance');
              }}
              title={isAdmin ? "Export filtered records to CSV" : "Export operational attendance records to CSV"}
            >
              Export CSV
            </Button>
          </div>
        }
      />

      {/* Staff Operational View Notice Banner */}
      {!isAdmin && (
        <div className="p-3 bg-[#F8FAFB] border border-[#E1E6E9] rounded-xl text-xs text-[#64717B] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock size={14} className="text-[#85949F] shrink-0" />
            <span>
              <strong>Staff Operational View:</strong> Displaying attendance, check-in activity, and member operations. Revenue collections, dues balances, and financial exports are restricted to administrators.
            </span>
          </div>
          <Badge variant="default">Staff View</Badge>
        </div>
      )}

      {/* Export Notice Banner */}
      {exportNotice && (
        <div className="p-3.5 rounded-xl bg-[#E8F5EE] border border-[#16845B]/25 text-[#16845B] text-xs font-semibold flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} />
            <span>{exportNotice}</span>
          </div>
          <button onClick={() => setExportNotice(null)} className="hover:text-[#12704D] cursor-pointer">✕</button>
        </div>
      )}

      {/* Report Module Tabs */}
      <div className="flex items-center gap-1 border-b border-[#E1E6E9] pb-px overflow-x-auto min-w-0 max-w-full bg-white px-2 rounded-t-xl scrollbar-thin">
        {reportTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-[#16845B] text-[#16845B] bg-[#E8F5EE]/40'
                : 'border-transparent text-[#64717B] hover:text-[#25313B]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ================================================================== */}
      {/* TAB 1: EXECUTIVE OVERVIEW                                          */}
      {/* ================================================================== */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Top KPI Cards Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              icon={IndianRupee}
              label="Selected Period Revenue"
              value={formatINR(periodTotalRevenue)}
              subtitle={dateRangeLabel}
              variant="accent"
            />
            <KPICard
              icon={CreditCard}
              label="Today's Collections"
              value={formatINR(todayCollections)}
              subtitle={`This Month: ${formatINR(thisMonthCollections)}`}
              variant="accent"
            />
            <KPICard
              icon={AlertTriangle}
              label="Pending Member Dues"
              value={formatINR(totalOutstandingDues)}
              subtitle={`${membersWithDues.length} members with balances`}
              variant={totalOutstandingDues > 0 ? 'warning' : 'default'}
            />
            <KPICard
              icon={UserCheck}
              label="Attendance (Period)"
              value={inRangeCheckins.length}
              subtitle={`${uniqueMembersAttending} unique members`}
              variant="default"
            />
          </div>

          {/* Revenue Chart & Plan Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Monthly Revenue Growth (Last 6 Months)</CardTitle>
                    <CardDescription>Actual revenue breakdown by Membership vs Personal Training</CardDescription>
                  </div>
                  <Badge variant="accent">₹ INR</Badge>
                </div>
              </CardHeader>
              <div className="h-72 w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyRevenueChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E1E6E9" vertical={false} />
                    <XAxis dataKey="month" stroke="#64717B" fontSize={12} tickLine={false} />
                    <YAxis stroke="#64717B" fontSize={12} tickLine={false} tickFormatter={(val) => `₹${val/1000}k`} />
                    <Tooltip
                      formatter={(val) => [`₹${Number(val).toLocaleString()}`, '']}
                      contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E1E6E9', borderRadius: 8, fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                    <Bar dataKey="membership" name="Memberships" fill="#16845B" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="pt" name="Personal Training" fill="#2196F3" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Plan Distribution</CardTitle>
                  <CardDescription>Active member ratio across membership plans</CardDescription>
                </div>
              </CardHeader>
              {planDistributionData.length === 0 ? (
                <div className="h-52 w-full flex items-center justify-center text-xs text-[#64717B]">
                  No active memberships currently
                </div>
              ) : (
                <>
                  <div className="h-52 w-full flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={planDistributionData}
                          innerRadius={50}
                          outerRadius={75}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {planDistributionData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => [`${value} members`, '']} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1.5 mt-2 border-t border-[#E1E6E9] pt-3">
                    {planDistributionData.map((item) => (
                      <div key={item.name} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 text-[#64717B]">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                          {item.name}
                        </span>
                        <span className="font-semibold text-[#25313B]">
                          {item.value} members ({Math.round((item.value / (activeMembersCount || 1)) * 100)}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* Weekly Attendance Patterns */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Attendance Patterns Across Operating Days</CardTitle>
                <CardDescription>Total check-in events distributed by day of week ({dateRangeLabel})</CardDescription>
              </div>
            </CardHeader>
            <div className="h-60 w-full mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyAttendanceTrendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E1E6E9" vertical={false} />
                  <XAxis dataKey="day" stroke="#64717B" fontSize={12} tickLine={false} />
                  <YAxis stroke="#64717B" fontSize={12} tickLine={false} />
                  <Tooltip
                    formatter={(val) => [`${val} check-ins`, 'Attendance']}
                    contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E1E6E9', borderRadius: 8, fontSize: 12 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="checkins"
                    stroke="#16845B"
                    strokeWidth={2.5}
                    dot={{ fill: '#16845B', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {/* ================================================================== */}
      {/* TAB 2: FINANCIAL & REVENUE                                         */}
      {/* ================================================================== */}
      {activeTab === 'finance' && (
        <div className="space-y-6">
          {/* Revenue Breakdown KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Period Total Collections</span>
              <p className="text-2xl font-bold text-[#25313B] mt-1">{formatINR(periodTotalRevenue)}</p>
              <p className="text-xs text-[#16845B] mt-1 font-medium">{dateRangeLabel}</p>
            </Card>

            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Membership Revenue</span>
              <p className="text-2xl font-bold text-[#16845B] mt-1">{formatINR(periodMembershipRevenue)}</p>
              <p className="text-xs text-[#64717B] mt-1">
                {periodTotalRevenue > 0 ? `${Math.round((periodMembershipRevenue / periodTotalRevenue) * 100)}% of total` : '0% of total'}
              </p>
            </Card>

            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Personal Training Revenue</span>
              <p className="text-2xl font-bold text-[#2196F3] mt-1">{formatINR(periodPtRevenue)}</p>
              <p className="text-xs text-[#64717B] mt-1">
                {periodTotalRevenue > 0 ? `${Math.round((periodPtRevenue / periodTotalRevenue) * 100)}% of total` : '0% of total'}
              </p>
            </Card>

            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Transactions & Avg Ticket</span>
              <p className="text-xl font-bold text-[#25313B] mt-1">{txCount} receipts</p>
              <p className="text-xs text-[#16845B] mt-1 font-medium">Avg ticket: {formatINR(avgTxValue)}</p>
            </Card>
          </div>

          {/* Payment Method Breakdown Cards */}
          <Card>
            <CardHeader>
              <CardTitle>Collections by Payment Method ({dateRangeLabel})</CardTitle>
              <CardDescription>Verified collections received via Cash, UPI, and Card</CardDescription>
            </CardHeader>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
              <div className="p-4 rounded-xl border border-[#E1E6E9] bg-[#F5F7F8]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#64717B]">UPI / QR Online</span>
                  <Badge variant="accent">{methodStats.UPI.count} txns</Badge>
                </div>
                <p className="text-2xl font-bold text-[#25313B] mt-2">{formatINR(methodStats.UPI.amount)}</p>
                <p className="text-xs text-[#16845B] mt-1">
                  {periodTotalRevenue > 0 ? `${Math.round((methodStats.UPI.amount / periodTotalRevenue) * 100)}% of total` : '0%'}
                </p>
              </div>

              <div className="p-4 rounded-xl border border-[#E1E6E9] bg-[#F5F7F8]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#64717B]">Cash Counter</span>
                  <Badge variant="success">{methodStats.Cash.count} txns</Badge>
                </div>
                <p className="text-2xl font-bold text-[#25313B] mt-2">{formatINR(methodStats.Cash.amount)}</p>
                <p className="text-xs text-[#16845B] mt-1">
                  {periodTotalRevenue > 0 ? `${Math.round((methodStats.Cash.amount / periodTotalRevenue) * 100)}% of total` : '0%'}
                </p>
              </div>

              <div className="p-4 rounded-xl border border-[#E1E6E9] bg-[#F5F7F8]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#64717B]">Debit / Credit Card</span>
                  <Badge variant="default">{methodStats.Card.count} txns</Badge>
                </div>
                <p className="text-2xl font-bold text-[#25313B] mt-2">{formatINR(methodStats.Card.amount)}</p>
                <p className="text-xs text-[#64717B] mt-1">
                  {periodTotalRevenue > 0 ? `${Math.round((methodStats.Card.amount / periodTotalRevenue) * 100)}% of total` : '0%'}
                </p>
              </div>
            </div>
          </Card>

          {/* Filtered Payment Ledger Table */}
          <Card padding={false} className="p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-[#25313B]">Payment Transactions Ledger</h3>
                <p className="text-xs text-[#64717B]">Filtered audit records for {dateRangeLabel}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <SearchInput
                  placeholder="Search receipt, member..."
                  value={txSearch}
                  onChange={(e) => setTxSearch(e.target.value)}
                  onClear={() => setTxSearch('')}
                  className="w-48 text-xs"
                />
                <Select
                  value={txMethodFilter}
                  onChange={(e) => setTxMethodFilter(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Methods' },
                    { value: 'UPI', label: 'UPI' },
                    { value: 'Cash', label: 'Cash' },
                    { value: 'Card', label: 'Card' },
                  ]}
                  className="w-32 text-xs"
                />
                <Select
                  value={txCategoryFilter}
                  onChange={(e) => setTxCategoryFilter(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Categories' },
                    { value: 'Membership', label: 'Membership' },
                    { value: 'Personal Training', label: 'Personal Training' },
                  ]}
                  className="w-36 text-xs"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Download}
                  onClick={() => triggerExport('transactions')}
                >
                  Export CSV
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto border border-[#E1E6E9] rounded-xl">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#F5F7F8] border-b border-[#E1E6E9] text-[#64717B] text-xs font-semibold uppercase">
                  <tr>
                    <th className="px-4 py-3">Receipt ID</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E6E9]">
                  {filteredLedgerPayments.map(p => (
                    <tr key={p.id} className="hover:bg-[#F5F7F8]/60 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-bold text-[#16845B]">{p.id}</td>
                      <td className="px-4 py-3 text-xs text-[#64717B] whitespace-nowrap">{p.date}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => p.memberId && navigate(`/members/${p.memberId}`)}
                          className="font-medium text-[#25313B] hover:text-[#16845B] cursor-pointer text-left block text-sm"
                        >
                          {p.memberName}
                        </button>
                        <span className="text-[11px] font-mono text-[#64717B]">{p.memberId}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#25313B]">
                        <span className="font-medium">{p.category}</span>
                        {p.relatedPlan && <span className="text-[#64717B] block text-[11px]">{p.relatedPlan}</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#25313B]">
                        <span className="inline-block px-2 py-0.5 rounded bg-[#F5F7F8] border border-[#E1E6E9] font-medium">
                          {p.method}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-[#25313B] tabular-nums whitespace-nowrap">
                        {formatINR(p.amount)}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <StatusBadge status={p.status || 'completed'} />
                      </td>
                    </tr>
                  ))}
                  {filteredLedgerPayments.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-xs text-[#64717B]">
                        No transactions recorded for the selected filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ================================================================== */}
      {/* TAB 3: OUTSTANDING DUES                                            */}
      {/* ================================================================== */}
      {activeTab === 'dues' && (
        <div className="space-y-6">
          {/* Dues KPI Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Total Uncollected Dues</span>
              <p className="text-3xl font-extrabold text-[#A66A00] mt-1">{formatINR(totalOutstandingDues)}</p>
              <p className="text-xs text-[#64717B] mt-1">Pending membership contract balances</p>
            </Card>

            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Members Owing Dues</span>
              <p className="text-3xl font-bold text-[#25313B] mt-1">{membersWithDues.length}</p>
              <p className="text-xs text-[#64717B] mt-1">Requires front-desk collection</p>
            </Card>

            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Average Balance per Debtor</span>
              <p className="text-3xl font-bold text-[#25313B] mt-1">
                {membersWithDues.length > 0 ? formatINR(Math.round(totalOutstandingDues / membersWithDues.length)) : '₹0'}
              </p>
              <p className="text-xs text-[#16845B] mt-1">Direct recovery opportunity</p>
            </Card>
          </div>

          {/* Dues Table Card */}
          <Card padding={false} className="p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-[#25313B]">Members with Outstanding Balances</h3>
                <p className="text-xs text-[#64717B]">
                  Separated from PT packages; represents gym membership liabilities.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <SearchInput
                  placeholder="Search member, phone, ID..."
                  value={duesSearch}
                  onChange={(e) => setDuesSearch(e.target.value)}
                  onClear={() => setDuesSearch('')}
                  className="w-48 text-xs"
                />
                <Select
                  value={duesStatusFilter}
                  onChange={(e) => setDuesStatusFilter(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Statuses' },
                    { value: 'active', label: 'Active Members' },
                    { value: 'expired', label: 'Expired Members' },
                  ]}
                  className="w-36 text-xs"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Download}
                  onClick={() => triggerExport('dues')}
                >
                  Export Dues CSV
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto border border-[#E1E6E9] rounded-xl">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#F5F7F8] border-b border-[#E1E6E9] text-[#64717B] text-xs font-semibold uppercase">
                  <tr>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Membership Status</th>
                    <th className="px-4 py-3">Expiry Date</th>
                    <th className="px-4 py-3 text-right">Total Fee</th>
                    <th className="px-4 py-3 text-right">Paid</th>
                    <th className="px-4 py-3 text-right">Balance Due</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E6E9]">
                  {filteredDuesMembers.map(m => (
                    <tr key={m.id} className="hover:bg-[#F5F7F8]/60 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => navigate(`/members/${m.id}`)}
                          className="font-bold text-[#25313B] hover:text-[#16845B] cursor-pointer text-left block text-sm"
                        >
                          {m.name}
                        </button>
                        <span className="text-[11px] font-mono text-[#64717B]">{m.id} · {m.phone}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#25313B] font-medium">{m.plan || 'General'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-[#64717B] whitespace-nowrap">{m.expiryDate || '—'}</td>
                      <td className="px-4 py-3 text-right text-xs text-[#64717B] tabular-nums">{formatINR(m.totalFee)}</td>
                      <td className="px-4 py-3 text-right text-xs text-[#16845B] font-medium tabular-nums">{formatINR(m.amountPaid)}</td>
                      <td className="px-4 py-3 text-right font-extrabold text-[#A66A00] text-sm tabular-nums whitespace-nowrap">
                        {formatINR(m.balance)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="primary"
                            icon={IndianRupee}
                            onClick={() => navigate(`/payments?record=true&memberId=${m.id}`)}
                            className="text-xs h-7 px-2"
                          >
                            Pay Dues
                          </Button>
                          <button
                            onClick={() => navigate(`/members/${m.id}`)}
                            className="p-1 rounded-lg hover:bg-[#E8F5EE] text-[#64717B] hover:text-[#16845B] cursor-pointer"
                            title="View Member Profile"
                          >
                            <ExternalLink size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredDuesMembers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-xs text-[#16845B] font-medium">
                        All members are fully paid up! No outstanding dues.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ================================================================== */}
      {/* TAB 4: MEMBERSHIP ANALYTICS                                        */}
      {/* ================================================================== */}
      {activeTab === 'membership' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Active Members</span>
              <p className="text-2xl font-bold text-[#16845B] mt-1">{activeMembersCount}</p>
              <p className="text-xs text-[#64717B] mt-1">{Math.round((activeMembersCount / (members.length || 1)) * 100)}% of total gym roster</p>
            </Card>

            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Expired Memberships</span>
              <p className="text-2xl font-bold text-[#B42318] mt-1">{expiredMembersCount}</p>
              <p className="text-xs text-[#64717B] mt-1">Eligible for win-back campaign</p>
            </Card>

            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Expiring Soon (≤5 Days)</span>
              <p className="text-2xl font-bold text-[#A66A00] mt-1">{expiring5DaysCount}</p>
              <p className="text-xs text-[#A66A00] mt-1 font-medium">{expiring3DaysCount} expiring in ≤3 days</p>
            </Card>

            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Registrations & Renewals</span>
              <p className="text-xl font-bold text-[#25313B] mt-1">+{newRegistrationsCount} New · {renewalsCount} Renewals</p>
              <p className="text-xs text-[#16845B] mt-1 font-medium">{dateRangeLabel}</p>
            </Card>
          </div>

          {/* Plan Duration Distribution Table */}
          <Card>
            <CardHeader>
              <CardTitle>{isAdmin ? "Plan Duration Distribution & Revenue" : "Plan Duration Distribution & Member Enrollment"}</CardTitle>
              <CardDescription>Overview of membership tiers preferred by gym members</CardDescription>
            </CardHeader>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#F5F7F8] border-b border-[#E1E6E9] text-[#64717B] text-xs font-semibold uppercase">
                  <tr>
                    <th className="px-4 py-3">Plan Name</th>
                    <th className="px-4 py-3">Duration</th>
                    {isAdmin && (
                      <th className="px-4 py-3">
                        Current Plan Fee
                        <span className="block text-[10px] font-normal lowercase text-[#64717B]">(catalog)</span>
                      </th>
                    )}
                    <th className="px-4 py-3">
                      Total Enrolled
                      <span className="block text-[10px] font-normal lowercase text-[#64717B]">(all-time)</span>
                    </th>
                    <th className="px-4 py-3">
                      Active Now
                      <span className="block text-[10px] font-normal lowercase text-[#16845B]">(current)</span>
                    </th>
                    {isAdmin && (
                      <th className="px-4 py-3 text-right">
                        Actual Revenue Collected
                        <span className="block text-[10px] font-normal lowercase text-[#64717B]">({dateRangeLabel})</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E6E9]">
                  {planDetailsTableData.length === 0 ? (
                    <tr>
                      <td colSpan={isAdmin ? 6 : 4} className="px-4 py-8 text-center text-xs text-[#64717B]">
                        No membership plans configured.
                      </td>
                    </tr>
                  ) : (
                    planDetailsTableData.map(plan => (
                      <tr key={plan.id} className="hover:bg-[#F5F7F8]/50">
                        <td className="px-4 py-3 font-semibold text-[#25313B]">
                          <div className="flex items-center gap-2">
                            <span>{plan.name}</span>
                            {!plan.isActive && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#F5F7F8] text-[#64717B] border border-[#E1E6E9]">
                                Inactive
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-[#64717B]">{plan.duration}</td>
                        {isAdmin && <td className="px-4 py-3 text-xs text-[#25313B] font-medium">{formatINR(plan.price)}</td>}
                        <td className="px-4 py-3 text-xs font-bold text-[#25313B]">{plan.enrolledCount} members</td>
                        <td className="px-4 py-3 text-xs font-bold text-[#16845B]">{plan.activeCount} active</td>
                        {isAdmin && <td className="px-4 py-3 text-right font-bold text-[#25313B] tabular-nums">{formatINR(plan.totalRevenue)}</td>}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ================================================================== */}
      {/* TAB 5: ATTENDANCE TRENDS                                           */}
      {/* ================================================================== */}
      {activeTab === 'attendance' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Total Check-in Events</span>
              <p className="text-3xl font-extrabold text-[#16845B] mt-1">{inRangeCheckins.length}</p>
              <p className="text-xs text-[#64717B] mt-1">In {dateRangeLabel}</p>
            </Card>

            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Unique Members Attended</span>
              <p className="text-3xl font-bold text-[#25313B] mt-1">{uniqueMembersAttending}</p>
              <p className="text-xs text-[#16845B] mt-1">Distinct gym attendees</p>
            </Card>

            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Today's Check-ins</span>
              <p className="text-3xl font-bold text-[#25313B] mt-1">{todayCheckinsList.length}</p>
              <p className="text-xs text-[#64717B] mt-1">{todayUniqueMembers} unique athletes today</p>
            </Card>

            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Engagement Rate</span>
              <p className="text-3xl font-bold text-[#16845B] mt-1">
                {activeMembersCount > 0 ? `${Math.round((uniqueMembersAttending / activeMembersCount) * 100)}%` : '0%'}
              </p>
              <p className="text-xs text-[#64717B] mt-1">Active member participation</p>
            </Card>
          </div>

          {/* Attendance Visitors Analysis */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award size={18} className="text-[#16845B]" /> Most Frequent Members
                </CardTitle>
                <CardDescription>Members with the highest verified check-in counts</CardDescription>
              </CardHeader>
              <div className="space-y-3 mt-3">
                {topFrequentMembers.map((m, idx) => (
                  <div key={m.id} className="flex items-center justify-between p-3 rounded-lg bg-[#F5F7F8] border border-[#E1E6E9]">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-[#16845B] text-white flex items-center justify-center text-xs font-bold">
                        {idx + 1}
                      </span>
                      <div>
                        <button
                          onClick={() => navigate(`/members/${m.id}`)}
                          className="text-sm font-semibold text-[#25313B] hover:text-[#16845B] cursor-pointer text-left"
                        >
                          {m.name}
                        </button>
                        <p className="text-xs text-[#64717B]">{m.plan} Plan · Last visit: {m.lastCheckinTime}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-[#16845B]">{m.visitCount} {m.visitCount === 1 ? 'visit' : 'visits'}</p>
                      <p className="text-[11px] text-[#64717B]">Regular Athlete</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle size={18} className="text-[#A66A00]" /> Low Activity / Inactive Alert
                </CardTitle>
                <CardDescription>Active members with low check-ins requiring re-engagement</CardDescription>
              </CardHeader>
              <div className="space-y-3 mt-3">
                {lowActivityMembers.map((m) => (
                  <div key={m.id} className="flex items-center justify-between p-3 rounded-lg bg-[#FFF2D8]/40 border border-[#A66A00]/20">
                    <div>
                      <p className="text-sm font-semibold text-[#25313B]">{m.name}</p>
                      <p className="text-xs text-[#64717B]">{m.phone} · {m.plan}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant="warning">{m.visitCount} {m.visitCount === 1 ? 'visit' : 'visits'}</Badge>
                      <p className="text-xs text-[#A66A00] mt-1 font-medium">Re-engagement needed</p>
                    </div>
                  </div>
                ))}
                {lowActivityMembers.length === 0 && (
                  <p className="text-xs text-[#16845B] py-6 text-center">Great engagement! No dormant active members.</p>
                )}
              </div>
            </Card>
          </div>

          {/* Attendance Log Table */}
          <Card padding={false} className="p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-[#25313B]">Check-in Attendance Records</h3>
                <p className="text-xs text-[#64717B]">Logs for {dateRangeLabel}</p>
              </div>
              <div className="flex items-center gap-2">
                <SearchInput
                  placeholder="Search attendee..."
                  value={attendanceSearch}
                  onChange={(e) => setAttendanceSearch(e.target.value)}
                  onClear={() => setAttendanceSearch('')}
                  className="w-48 text-xs"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Download}
                  onClick={() => triggerExport('attendance')}
                >
                  Export Attendance CSV
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto border border-[#E1E6E9] rounded-xl">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#F5F7F8] border-b border-[#E1E6E9] text-[#64717B] text-xs font-semibold uppercase">
                  <tr>
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3 text-center">Verification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E6E9]">
                  {filteredAttendanceLogs.map(c => (
                    <tr key={c.id} className="hover:bg-[#F5F7F8]/50">
                      <td className="px-4 py-3 font-mono text-xs text-[#16845B] font-bold">{c.id}</td>
                      <td className="px-4 py-3 text-xs text-[#64717B]">{c.date}</td>
                      <td className="px-4 py-3 text-xs text-[#25313B] font-medium">{c.time}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => c.memberId && navigate(`/members/${c.memberId}`)}
                          className="font-medium text-[#25313B] hover:text-[#16845B] cursor-pointer text-sm"
                        >
                          {c.memberName}
                        </button>
                        <span className="text-[11px] font-mono text-[#64717B] block">{c.memberId}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#64717B]">{c.plan}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={c.status} />
                      </td>
                    </tr>
                  ))}
                  {filteredAttendanceLogs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-xs text-[#64717B]">
                        No check-ins recorded for the selected period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ================================================================== */}
      {/* TAB 6: PERSONAL TRAINING                                           */}
      {/* ================================================================== */}
      {activeTab === 'pt' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">PT Total Collections</span>
              <p className="text-2xl font-bold text-[#2196F3] mt-1">{formatINR(periodPtRevenue)}</p>
              <p className="text-xs text-[#16845B] mt-1 font-medium">{dateRangeLabel}</p>
            </Card>

            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Active PT Packages</span>
              <p className="text-2xl font-bold text-[#16845B] mt-1">{activePtPackagesCount}</p>
              <p className="text-xs text-[#64717B] mt-1">{totalRemainingPtSessions} sessions left across active</p>
            </Card>

            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Sessions Delivered</span>
              <p className="text-2xl font-bold text-[#25313B] mt-1">{ptSessionsCompletedCount} Completed</p>
              <p className="text-xs text-[#64717B] mt-1">{ptSessionsScheduledCount} scheduled · {ptSessionsCancelledCount} cancelled</p>
            </Card>

            <Card padding={false} className="p-4">
              <span className="text-xs text-[#64717B] font-medium">Ending Soon / Expired</span>
              <p className="text-2xl font-bold text-[#A66A00] mt-1">{ptEndingSoonCount} Ending Soon</p>
              <p className="text-xs text-[#64717B] mt-1">{ptExpiredOrDoneCount} completed or expired</p>
            </Card>
          </div>

          {/* Trainer Workload Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Trainer Workload & Delivery Efficiency</CardTitle>
              <CardDescription>Based on verified session logs in Personal Training ledger</CardDescription>
            </CardHeader>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#F5F7F8] border-b border-[#E1E6E9] text-[#64717B] text-xs font-semibold uppercase">
                  <tr>
                    <th className="px-4 py-3">Trainer Name</th>
                    <th className="px-4 py-3">Active Clients</th>
                    <th className="px-4 py-3">Scheduled Sessions</th>
                    <th className="px-4 py-3">Completed Sessions</th>
                    <th className="px-4 py-3">Total Logged</th>
                    <th className="px-4 py-3 text-right">Completion Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E6E9]">
                  {trainerWorkloadData.map(tw => {
                    const rate = tw.totalSessions > 0 ? Math.round((tw.completedSessions / tw.totalSessions) * 100) : 0;
                    return (
                      <tr key={tw.name} className="hover:bg-[#F5F7F8]/50">
                        <td className="px-4 py-3 font-bold text-[#25313B]">{tw.name}</td>
                        <td className="px-4 py-3 font-semibold text-[#16845B]">{tw.activeClients} clients</td>
                        <td className="px-4 py-3 text-xs text-[#25313B]">{tw.scheduledSessions}</td>
                        <td className="px-4 py-3 text-xs font-bold text-[#16845B]">{tw.completedSessions}</td>
                        <td className="px-4 py-3 text-xs text-[#64717B]">{tw.totalSessions}</td>
                        <td className="px-4 py-3 text-right font-bold text-[#25313B]">
                          <span className="inline-block px-2 py-0.5 rounded bg-[#E8F5EE] text-[#16845B] text-xs">
                            {rate}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* PT Clients Table Card */}
          <Card padding={false} className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#25313B]">PT Clients Package Progress</h3>
                <p className="text-xs text-[#64717B]">Tracking total, used, and remaining session counts</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={Download}
                onClick={() => triggerExport('pt')}
              >
                Export PT CSV
              </Button>
            </div>

            <div className="overflow-x-auto border border-[#E1E6E9] rounded-xl">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#F5F7F8] border-b border-[#E1E6E9] text-[#64717B] text-xs font-semibold uppercase">
                  <tr>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Package</th>
                    <th className="px-4 py-3">Trainer</th>
                    <th className="px-4 py-3">Completed / Total</th>
                    <th className="px-4 py-3">Sessions Left</th>
                    <th className="px-4 py-3">Valid Till</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E6E9]">
                  {ptClients.map(c => (
                    <tr key={c.memberId} className="hover:bg-[#F5F7F8]/50">
                      <td className="px-4 py-3 font-semibold text-[#25313B]">{c.memberName}</td>
                      <td className="px-4 py-3 text-xs text-[#64717B]">{c.package}</td>
                      <td className="px-4 py-3 text-xs text-[#25313B]">{c.trainer || 'Coach Pravin Joshi'}</td>
                      <td className="px-4 py-3 text-xs font-medium text-[#25313B]">
                        {c.completedSessions} / {c.totalSessions}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold ${c.remainingSessions <= 3 ? 'text-[#A66A00]' : 'text-[#16845B]'}`}>
                          {c.remainingSessions} left
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#64717B]">{c.validTill}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
