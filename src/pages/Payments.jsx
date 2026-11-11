import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge, Badge } from '../components/ui/Badge';
import { KPICard } from '../components/shared/KPICard';
import { Modal } from '../components/ui/Modal';
import { Input, Select, SearchInput, Textarea } from '../components/ui/Input';
import { EmptyState } from '../components/ui/EmptyState';
import { PaymentReceiptModal } from '../components/shared/PaymentReceiptModal';
import {
  getLocalDateString,
  getDaysDifference,
  formatINR,
  getPaymentPurpose,
  isCurrentMonth,
} from '../utils/memberUtils';
import {
  IndianRupee, CreditCard, AlertTriangle, Plus,
  ChevronLeft, ChevronRight, Receipt, Calendar,
  Printer, ArrowUpDown, CheckCircle2, RotateCcw,
  ExternalLink, Info
} from 'lucide-react';

export default function Payments() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    members,
    payments,
    recordDuesPayment,
    paymentsLoading,
    paymentsError,
    reloadPayments,
    initialDataLoading,
  } = useApp();

  const isPaymentsDataLoading = paymentsLoading || initialDataLoading;

  // Filters & Search State
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [page, setPage] = useState(1);
  const perPage = 10;

  // Active Tab: 'transactions' | 'pending'
  const currentTab = searchParams.get('tab') === 'pending' ? 'pending' : 'transactions';
  const handleTabChange = (newTab) => {
    const newParams = new URLSearchParams(searchParams);
    if (newTab === 'transactions') {
      newParams.delete('tab');
    } else {
      newParams.set('tab', newTab);
    }
    setSearchParams(newParams, { replace: true });
  };

  // Pending Payments Search, Filter & Sort State
  const [pendingSearch, setPendingSearch] = useState('');
  const [pendingStatusFilter, setPendingStatusFilter] = useState('all'); // 'all' | 'unpaid' | 'partial'
  const [pendingSortBy, setPendingSortBy] = useState('balance_desc'); // 'balance_desc' | 'balance_asc' | 'date_asc' | 'date_desc'
  const [pendingPage, setPendingPage] = useState(1);
  const pendingPerPage = 10;

  // Modal States
  const [showRecord, setShowRecord] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [successNotice, setSuccessNotice] = useState(null);

  const todayStr = useMemo(() => getLocalDateString(), []);

  // Pre-open record payment modal if query param is set
  useEffect(() => {
    if (searchParams.get('record') === 'true') {
      setShowRecord(true);
    }
  }, [searchParams]);

  // Handle modal close & URL search param cleanup
  const handleCloseRecord = () => {
    setShowRecord(false);
    if (searchParams.get('record')) {
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('record');
      newParams.delete('memberId');
      setSearchParams(newParams, { replace: true });
    }
  };

  const handleCollectDuesFromRow = (member) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('record', 'true');
    newParams.set('memberId', member.id);
    setSearchParams(newParams, { replace: true });
    setShowRecord(true);
  };

  // ==========================================
  // Section 2: Payments Dashboard Calculations
  // ==========================================
  // 1. Today's collections (completed payments only)
  const todayPayments = useMemo(() => {
    return payments.filter(p => p.status === 'completed' && p.date === todayStr);
  }, [payments, todayStr]);
  const todayCollection = useMemo(() => {
    return todayPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }, [todayPayments]);

  // 2. Current Month collections (completed payments only)
  const monthPayments = useMemo(() => {
    return payments.filter(p => p.status === 'completed' && isCurrentMonth(p.date, todayStr));
  }, [payments, todayStr]);
  const monthCollection = useMemo(() => {
    return monthPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }, [monthPayments]);

  // 3. Total amount received all time (completed payments only)
  const totalCollection = useMemo(() => {
    return payments
      .filter(p => p.status === 'completed')
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }, [payments]);

  // 4. Outstanding member dues (live from members state from v_active_members)
  const membersWithDues = useMemo(() => {
    return members.filter(m => (Number(m.balance) || 0) > 0);
  }, [members]);
  const totalOutstanding = useMemo(() => {
    return membersWithDues.reduce((s, m) => s + (Number(m.balance) || 0), 0);
  }, [membersWithDues]);

  // 5. Total transactions count
  const totalTransactions = payments.length;

  // ==========================================
  // Section 3: Filter, Search & Sort Logic
  // ==========================================
  const filteredPayments = useMemo(() => {
    const q = search.trim().toLowerCase();

    return payments.filter(p => {
      // Search match
      const matchSearch =
        !q ||
        (p.memberName && p.memberName.toLowerCase().includes(q)) ||
        (p.memberCode && p.memberCode.toLowerCase().includes(q)) ||
        (p.receiptNumber && p.receiptNumber.toLowerCase().includes(q)) ||
        (p.id && String(p.id).toLowerCase().includes(q)) ||
        (p.memberId && String(p.memberId).toLowerCase().includes(q)) ||
        (p.notes && p.notes.toLowerCase().includes(q));

      // Method match
      const matchMethod = methodFilter === 'all' || p.method === methodFilter;

      // Category match
      const matchCat = categoryFilter === 'all' || p.category === categoryFilter;

      // Date match
      let matchDate = true;
      if (dateFilter === 'today') {
        matchDate = p.date === todayStr;
      } else if (dateFilter === '7days') {
        const diff = getDaysDifference(todayStr, p.date);
        matchDate = diff >= 0 && diff <= 7;
      } else if (dateFilter === 'month') {
        matchDate = isCurrentMonth(p.date, todayStr);
      }

      return matchSearch && matchMethod && matchCat && matchDate;
    }).sort((a, b) => {
      if (sortBy === 'date_desc') {
        const dDiff = new Date(b.date) - new Date(a.date);
        return dDiff !== 0 ? dDiff : b.id.localeCompare(a.id);
      }
      if (sortBy === 'date_asc') {
        const dDiff = new Date(a.date) - new Date(b.date);
        return dDiff !== 0 ? dDiff : a.id.localeCompare(b.id);
      }
      if (sortBy === 'amount_desc') {
        return (Number(b.amount) || 0) - (Number(a.amount) || 0);
      }
      if (sortBy === 'amount_asc') {
        return (Number(a.amount) || 0) - (Number(b.amount) || 0);
      }
      return 0;
    });
  }, [payments, search, methodFilter, categoryFilter, dateFilter, sortBy, todayStr]);

  const totalPages = Math.max(1, Math.ceil(filteredPayments.length / perPage));
  const pagedPayments = filteredPayments.slice((page - 1) * perPage, page * perPage);

  const resetFilters = () => {
    setSearch('');
    setDateFilter('all');
    setMethodFilter('all');
    setCategoryFilter('all');
    setSortBy('date_desc');
    setPage(1);
  };

  const hasActiveFilters = search || dateFilter !== 'all' || methodFilter !== 'all' || categoryFilter !== 'all' || sortBy !== 'date_desc';

  // ----------------------------------------------------------------------------
  // Pending Dues Accounts (Derived directly from authoritative member balances)
  // ----------------------------------------------------------------------------
  const filteredPendingAccounts = useMemo(() => {
    const q = pendingSearch.trim().toLowerCase();

    return members
      .filter(m => (Number(m.balance) || 0) > 0)
      .filter(m => {
        const matchSearch =
          !q ||
          (m.name && m.name.toLowerCase().includes(q)) ||
          (m.member_code && m.member_code.toLowerCase().includes(q)) ||
          (m.id && String(m.id).toLowerCase().includes(q)) ||
          (m.phone && m.phone.includes(q)) ||
          (m.plan && m.plan.toLowerCase().includes(q));

        const matchStatus =
          pendingStatusFilter === 'all' ||
          (pendingStatusFilter === 'unpaid' && m.paymentStatus === 'unpaid') ||
          (pendingStatusFilter === 'partial' && m.paymentStatus === 'partial');

        return matchSearch && matchStatus;
      })
      .sort((a, b) => {
        if (pendingSortBy === 'balance_desc') {
          return (Number(b.balance) || 0) - (Number(a.balance) || 0);
        }
        if (pendingSortBy === 'balance_asc') {
          return (Number(a.balance) || 0) - (Number(b.balance) || 0);
        }
        if (pendingSortBy === 'date_asc') {
          return (a.expiryDate || a.startDate || '').localeCompare(b.expiryDate || b.startDate || '');
        }
        if (pendingSortBy === 'date_desc') {
          return (b.expiryDate || b.startDate || '').localeCompare(a.expiryDate || a.startDate || '');
        }
        return 0;
      });
  }, [members, pendingSearch, pendingStatusFilter, pendingSortBy]);

  const totalPendingPages = Math.max(1, Math.ceil(filteredPendingAccounts.length / pendingPerPage));
  const pagedPendingAccounts = filteredPendingAccounts.slice(
    (pendingPage - 1) * pendingPerPage,
    pendingPage * pendingPerPage
  );

  const resetPendingFilters = () => {
    setPendingSearch('');
    setPendingStatusFilter('all');
    setPendingSortBy('balance_desc');
    setPendingPage(1);
  };

  const hasActivePendingFilters = pendingSearch || pendingStatusFilter !== 'all' || pendingSortBy !== 'balance_desc';

  // Get member for currently selected receipt
  const receiptMember = useMemo(() => {
    if (!selectedReceipt || !selectedReceipt.memberId) return null;
    return members.find(m => m.id === selectedReceipt.memberId || m.member_code === selectedReceipt.memberCode);
  }, [selectedReceipt, members]);

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      <PageHeader
        title="Payments & Collections"
        description="Audit ledger receipts, record dues collections, and generate printed member receipts."
        badge={<Badge variant="success">{formatINR(todayCollection)} Today</Badge>}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="secondary"
              icon={RotateCcw}
              onClick={reloadPayments}
              disabled={paymentsLoading}
              title="Refresh payment records from database"
            >
              Refresh
            </Button>
            <Button icon={Plus} onClick={() => setShowRecord(true)}>
              Record Payment
            </Button>
          </div>
        }
      />

      {/* Database Error Alert */}
      {paymentsError && (
        <div className="p-4 rounded-xl bg-[#FEF3F2] border border-[#FECDCA] text-[#B42318] flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={18} className="shrink-0 text-[#D92D20]" />
            <div>
              <p className="text-xs font-bold">Failed to load payment transactions from database</p>
              <p className="text-xs text-[#B42318]/90">{paymentsError}</p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={reloadPayments}
            className="border-[#FDA29B] text-[#B42318] hover:bg-[#FEE4E2] shrink-0"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Success Notification */}
      {successNotice && (
        <div className="p-3.5 rounded-xl bg-[#E8F5EE] border border-[#16845B]/25 text-[#16845B] text-xs font-semibold flex items-center justify-between gap-2 shadow-xs animate-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{successNotice.message}</span>
          </div>
          <div className="flex items-center gap-2">
            {successNotice.payment && (
              <button
                onClick={() => setSelectedReceipt(successNotice.payment)}
                className="underline hover:text-[#126b49] cursor-pointer flex items-center gap-1 font-bold"
              >
                <Printer size={13} />
                View Receipt ({successNotice.payment.id})
              </button>
            )}
            <button
              onClick={() => setSuccessNotice(null)}
              className="text-[#16845B] hover:text-[#126b49] cursor-pointer ml-2"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Section 2: Payments Dashboard KPIs (5 Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          icon={IndianRupee}
          label="Today's Collection"
          value={formatINR(todayCollection)}
          subtitle={`${todayPayments.length} transaction${todayPayments.length === 1 ? '' : 's'} today`}
          variant="accent"
        />
        <KPICard
          icon={Calendar}
          label="This Month"
          value={formatINR(monthCollection)}
          subtitle={`${monthPayments.length} transaction${monthPayments.length === 1 ? '' : 's'} this month`}
          variant="default"
        />
        <KPICard
          icon={IndianRupee}
          label="Total Received"
          value={formatINR(totalCollection)}
          subtitle="All-time recorded"
          variant="default"
        />
        <KPICard
          icon={AlertTriangle}
          label="Outstanding Dues"
          value={formatINR(totalOutstanding)}
          subtitle={`${membersWithDues.length} member${membersWithDues.length === 1 ? '' : 's'} pending`}
          variant="warning"
        />
        <KPICard
          icon={Receipt}
          label="Total Receipts"
          value={totalTransactions}
          subtitle="Processed entries"
          variant="default"
        />
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-[#E1E6E9] pb-px overflow-x-auto">
        <button
          onClick={() => handleTabChange('transactions')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
            currentTab === 'transactions'
              ? 'border-[#16845B] text-[#16845B]'
              : 'border-transparent text-[#64717B] hover:text-[#25313B]'
          }`}
        >
          <Receipt size={16} />
          <span>Transactions History</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            currentTab === 'transactions' ? 'bg-[#E8F5EE] text-[#16845B]' : 'bg-[#F5F7F8] text-[#64717B]'
          }`}>
            {totalTransactions}
          </span>
        </button>

        <button
          onClick={() => handleTabChange('pending')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
            currentTab === 'pending'
              ? 'border-[#16845B] text-[#16845B]'
              : 'border-transparent text-[#64717B] hover:text-[#25313B]'
          }`}
        >
          <AlertTriangle size={16} className={membersWithDues.length > 0 ? 'text-[#A66A00]' : ''} />
          <span>Pending Payments & Outstanding Dues</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
            currentTab === 'pending'
              ? (membersWithDues.length > 0 ? 'bg-[#FFF2D8] text-[#A66A00]' : 'bg-[#E8F5EE] text-[#16845B]')
              : (membersWithDues.length > 0 ? 'bg-[#FFF2D8] text-[#A66A00]' : 'bg-[#F5F7F8] text-[#64717B]')
          }`}>
            {membersWithDues.length}
          </span>
        </button>
      </div>

      {/* Tab 1: Transactions History */}
      {currentTab === 'transactions' && (
        <>
          <Card padding={false} className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Search Input */}
            <SearchInput
              placeholder="Search by member, ID, or receipt..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              onClear={() => { setSearch(''); setPage(1); }}
              className="w-full md:max-w-xs"
            />

            {/* Filter Dropdowns */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Date Filter */}
              <Select
                value={dateFilter}
                onChange={e => { setDateFilter(e.target.value); setPage(1); }}
                options={[
                  { value: 'all', label: 'All Dates' },
                  { value: 'today', label: 'Today' },
                  { value: '7days', label: 'Last 7 Days' },
                  { value: 'month', label: 'This Month' },
                ]}
                className="w-32"
              />

              {/* Method Filter */}
              <Select
                value={methodFilter}
                onChange={e => { setMethodFilter(e.target.value); setPage(1); }}
                options={[
                  { value: 'all', label: 'All Methods' },
                  { value: 'Cash', label: 'Cash' },
                  { value: 'UPI', label: 'UPI' },
                  { value: 'Card', label: 'Card' },
                  { value: 'Other', label: 'Other' },
                ]}
                className="w-32"
              />

              {/* Category Filter */}
              <Select
                value={categoryFilter}
                onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
                options={[
                  { value: 'all', label: 'All Categories' },
                  { value: 'Membership', label: 'Membership' },
                  { value: 'Personal Training', label: 'Personal Training' },
                  { value: 'Other', label: 'Other' },
                ]}
                className="w-40 hidden sm:block"
              />

              {/* Sort By */}
              <Select
                value={sortBy}
                onChange={e => { setSortBy(e.target.value); setPage(1); }}
                options={[
                  { value: 'date_desc', label: 'Date: Newest First' },
                  { value: 'date_asc', label: 'Date: Oldest First' },
                  { value: 'amount_desc', label: 'Amount: High to Low' },
                  { value: 'amount_asc', label: 'Amount: Low to High' },
                ]}
                className="w-44"
              />

              {/* Clear filters button if active */}
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={RotateCcw}
                  onClick={resetFilters}
                  className="text-xs"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Section 3: Payment Transaction Table */}
      <Card padding={false}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#E1E6E9] bg-[#F5F7F8]/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#64717B] uppercase tracking-wider">Receipt ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#64717B] uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#64717B] uppercase tracking-wider">Member</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#64717B] uppercase tracking-wider hidden md:table-cell">Purpose / Plan</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[#64717B] uppercase tracking-wider">Amount</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-[#64717B] uppercase tracking-wider hidden sm:table-cell">Method</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-[#64717B] uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-[#64717B] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E6E9]">
              {isPaymentsDataLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-[#64717B]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RotateCcw className="animate-spin text-[#16845B]" size={20} />
                      <span className="font-medium text-xs">Loading payment transactions from database...</span>
                    </div>
                  </td>
                </tr>
              )}

              {!isPaymentsDataLoading && pagedPayments.map(p => {
                const purpose = getPaymentPurpose(p);
                return (
                  <tr key={p.id} className="hover:bg-[#F5F7F8] transition-colors">
                    {/* Receipt ID */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelectedReceipt(p)}
                        className="text-xs font-mono font-bold text-[#16845B] hover:underline cursor-pointer flex items-center gap-1"
                        title="View printable receipt"
                      >
                        <Receipt size={13} className="text-[#16845B]/80" />
                        {p.receiptNumber || p.id}
                      </button>
                    </td>

                    {/* Date */}
                    <td className="px-4 py-3 text-sm text-[#64717B] whitespace-nowrap">
                      {p.date}
                    </td>

                    {/* Member */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <button
                          onClick={() => p.memberId && navigate(`/members/${p.memberId}`)}
                          className="text-sm font-semibold text-[#25313B] hover:text-[#16845B] cursor-pointer text-left"
                        >
                          {p.memberName}
                        </button>
                        <div className="flex items-center gap-1 mt-0.5">
                          {p.memberCode && (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-[#E8F5EE] border border-[#16845B]/20 text-[10px] font-mono font-bold text-[#16845B]">
                              {p.memberCode}
                            </span>
                          )}
                          {p.memberId && !p.memberCode && (
                            <span className="text-[11px] font-mono text-[#64717B] truncate max-w-[120px]">
                              {p.memberId}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Purpose / Plan */}
                    <td className="px-4 py-3 text-sm text-[#64717B] hidden md:table-cell">
                      <div>
                        <p className="text-xs font-medium text-[#25313B]">{purpose}</p>
                        <p className="text-[11px] text-[#64717B]">
                          {p.category} {p.relatedPlan ? `• ${p.relatedPlan}` : ''}
                        </p>
                      </div>
                    </td>

                    {/* Amount */}
                    <td className="px-4 py-3 text-sm text-right font-bold text-[#25313B] tabular-nums whitespace-nowrap">
                      {formatINR(p.amount)}
                    </td>

                    {/* Method */}
                    <td className="px-4 py-3 text-sm text-center text-[#64717B] hidden sm:table-cell">
                      <span className="inline-block px-2 py-0.5 rounded-md bg-[#F5F7F8] border border-[#E1E6E9] text-xs font-medium">
                        {p.method}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <StatusBadge status={p.status || 'completed'} />
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={Printer}
                        onClick={() => setSelectedReceipt(p)}
                        className="text-xs h-7 px-2.5"
                        title="Print Receipt"
                      >
                        Receipt
                      </Button>
                    </td>
                  </tr>
                );
              })}

              {/* Empty and No Results States */}
              {!isPaymentsDataLoading && pagedPayments.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12">
                    <EmptyState
                      icon={Receipt}
                      title={hasActiveFilters ? "No matching payments found" : "No payment records yet"}
                      description={
                        hasActiveFilters
                          ? "Try adjusting your search query, date filter, or payment method."
                          : "Record membership dues or initial registration payments to start tracking transactions."
                      }
                      action={
                        hasActiveFilters ? (
                          <Button variant="secondary" size="sm" icon={RotateCcw} onClick={resetFilters}>
                            Clear Filters
                          </Button>
                        ) : (
                          <Button icon={Plus} size="sm" onClick={() => setShowRecord(true)}>
                            Record Payment
                          </Button>
                        )
                      }
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filteredPayments.length > perPage && (
          <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 border-t border-[#E1E6E9] gap-3">
            <p className="text-xs text-[#64717B]">
              Showing <span className="font-semibold text-[#25313B]">{(page - 1) * perPage + 1}</span>–
              <span className="font-semibold text-[#25313B]">{Math.min(page * perPage, filteredPayments.length)}</span> of{' '}
              <span className="font-semibold text-[#25313B]">{filteredPayments.length}</span> transactions
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-[#F5F7F8] text-[#64717B] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed border border-[#E1E6E9]"
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-xs font-semibold cursor-pointer border transition-all ${
                    p === page
                      ? 'bg-[#16845B] border-[#16845B] text-white shadow-xs'
                      : 'border-[#E1E6E9] hover:bg-[#F5F7F8] text-[#64717B]'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg hover:bg-[#F5F7F8] text-[#64717B] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed border border-[#E1E6E9]"
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </Card>
      </>
      )}

      {/* Tab 2: Pending Payments & Outstanding Dues View */}
      {currentTab === 'pending' && (
        <Card padding={false} className="p-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Search by Member Name or Code */}
              <SearchInput
                placeholder="Search member name, code, phone, or plan..."
                value={pendingSearch}
                onChange={e => { setPendingSearch(e.target.value); setPendingPage(1); }}
                onClear={() => { setPendingSearch(''); setPendingPage(1); }}
                className="w-full md:max-w-xs"
              />

              {/* Filters & Sorting */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Status Filter */}
                <Select
                  value={pendingStatusFilter}
                  onChange={e => { setPendingStatusFilter(e.target.value); setPendingPage(1); }}
                  options={[
                    { value: 'all', label: 'All Dues (Unpaid & Partial)' },
                    { value: 'unpaid', label: 'Unpaid Accounts Only' },
                    { value: 'partial', label: 'Partially Paid Only' },
                  ]}
                  className="w-48"
                />

                {/* Sort By */}
                <Select
                  value={pendingSortBy}
                  onChange={e => { setPendingSortBy(e.target.value); setPendingPage(1); }}
                  options={[
                    { value: 'balance_desc', label: 'Balance: Highest First' },
                    { value: 'balance_asc', label: 'Balance: Lowest First' },
                    { value: 'date_asc', label: 'Due Date: Oldest First' },
                    { value: 'date_desc', label: 'Due Date: Newest First' },
                  ]}
                  className="w-48"
                />

                {/* Clear Filters */}
                {hasActivePendingFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={RotateCcw}
                    onClick={resetPendingFilters}
                    className="text-xs"
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>

            {/* Results count & total info */}
            <div className="flex items-center justify-between text-xs text-[#64717B] pt-2 border-t border-[#E1E6E9]">
              <span>
                Showing <strong className="text-[#25313B]">{filteredPendingAccounts.length}</strong> members with outstanding dues
                {hasActivePendingFilters && ' (filtered)'}
              </span>
              <span>
                Total Outstanding:{' '}
                <strong className="text-[#B42318]">
                  {formatINR(filteredPendingAccounts.reduce((s, m) => s + (Number(m.balance) || 0), 0))}
                </strong>
              </span>
            </div>
          </div>

          {/* Pending Dues Table */}
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#F5F7F8] border-b border-[#E1E6E9] text-[#64717B] text-xs font-semibold uppercase">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3 text-right">Total Fee</th>
                  <th className="px-4 py-3 text-right">Amount Paid</th>
                  <th className="px-4 py-3 text-right">Outstanding Balance</th>
                  <th className="px-4 py-3 text-center">Payment Status</th>
                  <th className="px-4 py-3 text-center">Due / Expiry</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E6E9]">
                {pagedPendingAccounts.map(m => {
                  const isUnpaid = m.paymentStatus === 'unpaid';
                  return (
                    <tr key={m.id} className="hover:bg-[#F5F7F8]/50 transition-colors">
                      {/* Member Details */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => navigate(`/members/${m.id}`)}
                            className="font-semibold text-xs text-[#25313B] hover:text-[#16845B] hover:underline cursor-pointer flex items-center gap-1"
                          >
                            {m.name}
                            <ExternalLink size={10} className="text-[#64717B]" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[#64717B] font-mono mt-0.5">
                          <span>{m.member_code || m.id}</span>
                          {m.phone && <span>· {m.phone}</span>}
                        </div>
                      </td>

                      {/* Plan */}
                      <td className="px-4 py-3.5">
                        <span className="text-xs font-semibold text-[#25313B] block">
                          {m.plan}
                        </span>
                        <span className="text-[11px] text-[#64717B]">
                          Contract: {m.startDate || 'N/A'}
                        </span>
                      </td>

                      {/* Total Fee */}
                      <td className="px-4 py-3.5 text-right font-medium text-xs text-[#25313B] whitespace-nowrap tabular-nums">
                        {formatINR(m.totalFee || 0)}
                      </td>

                      {/* Amount Paid */}
                      <td className="px-4 py-3.5 text-right font-medium text-xs text-[#16845B] whitespace-nowrap tabular-nums">
                        {formatINR(m.amountPaid || 0)}
                      </td>

                      {/* Outstanding Balance */}
                      <td className="px-4 py-3.5 text-right font-bold text-sm text-[#B42318] whitespace-nowrap tabular-nums">
                        {formatINR(m.balance || 0)}
                      </td>

                      {/* Payment Status Badge */}
                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${
                            isUnpaid
                              ? 'bg-[#FCE9E9] text-[#B42318] border border-[#B42318]/25'
                              : 'bg-[#FFF2D8] text-[#A66A00] border border-[#A66A00]/25'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isUnpaid ? 'bg-[#B42318]' : 'bg-[#A66A00]'
                            }`}
                          />
                          {m.paymentStatus || 'unpaid'}
                        </span>
                      </td>

                      {/* Expiry / Due Date */}
                      <td className="px-4 py-3.5 text-center text-xs text-[#64717B] whitespace-nowrap tabular-nums">
                        {m.expiryDate || m.startDate || 'N/A'}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="primary"
                            icon={IndianRupee}
                            onClick={() => handleCollectDuesFromRow(m)}
                            className="text-xs h-7 px-2.5 bg-[#16845B] hover:bg-[#126b49] text-white"
                          >
                            Collect Dues
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => navigate(`/members/${m.id}`)}
                            className="text-xs h-7 px-2"
                          >
                            Profile
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* Empty State */}
                {pagedPendingAccounts.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12">
                      <EmptyState
                        icon={CheckCircle2}
                        title={
                          hasActivePendingFilters
                            ? 'No matching pending accounts found'
                            : 'All membership dues are settled!'
                        }
                        description={
                          hasActivePendingFilters
                            ? 'Try clearing the search query or adjusting the payment status filter.'
                            : 'Every registered active member account is fully paid up with zero outstanding balance.'
                        }
                        action={
                          hasActivePendingFilters ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={RotateCcw}
                              onClick={resetPendingFilters}
                            >
                              Clear Filters
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

          {/* Pending Pagination */}
          {filteredPendingAccounts.length > pendingPerPage && (
            <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 border-t border-[#E1E6E9] gap-3">
              <p className="text-xs text-[#64717B]">
                Showing{' '}
                <span className="font-semibold text-[#25313B]">
                  {(pendingPage - 1) * pendingPerPage + 1}
                </span>
                –
                <span className="font-semibold text-[#25313B]">
                  {Math.min(pendingPage * pendingPerPage, filteredPendingAccounts.length)}
                </span>{' '}
                of{' '}
                <span className="font-semibold text-[#25313B]">
                  {filteredPendingAccounts.length}
                </span>{' '}
                accounts
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPendingPage(p => Math.max(1, p - 1))}
                  disabled={pendingPage === 1}
                  className="p-1.5 rounded-lg hover:bg-[#F5F7F8] text-[#64717B] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed border border-[#E1E6E9]"
                  aria-label="Previous pending page"
                >
                  <ChevronLeft size={16} />
                </button>
                {Array.from({ length: totalPendingPages }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    onClick={() => setPendingPage(p)}
                    className={`w-8 h-8 rounded-lg text-xs font-semibold cursor-pointer border transition-all ${
                      p === pendingPage
                        ? 'bg-[#16845B] border-[#16845B] text-white shadow-xs'
                        : 'border-[#E1E6E9] hover:bg-[#F5F7F8] text-[#64717B]'
                    }`}
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setPendingPage(p => Math.min(totalPendingPages, p + 1))}
                  disabled={pendingPage === totalPendingPages}
                  className="p-1.5 rounded-lg hover:bg-[#F5F7F8] text-[#64717B] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed border border-[#E1E6E9]"
                  aria-label="Next pending page"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Record Payment Modal */}
      <RecordPaymentModal
        isOpen={showRecord}
        onClose={handleCloseRecord}
        members={members}
        initialMemberId={searchParams.get('memberId') || ''}
        onSave={(paymentData) => {
          handleCloseRecord();
          setSuccessNotice({
            message: `Payment of ${formatINR(paymentData.amount)} recorded for ${paymentData.memberName}!`,
            payment: paymentData,
          });
          setTimeout(() => setSuccessNotice(null), 8000);
        }}
      />

      {/* Printable Receipt Modal */}
      {selectedReceipt && (
        <PaymentReceiptModal
          isOpen={Boolean(selectedReceipt)}
          onClose={() => setSelectedReceipt(null)}
          payment={selectedReceipt}
          member={receiptMember}
        />
      )}
    </div>
  );
}

/**
 * RecordPaymentModal Component
 * Implements Section 4 validation, member preselection, and balance settlement via record_dues_payment RPC
 */
function RecordPaymentModal({ isOpen, onClose, members, initialMemberId = '', onSave }) {
  const { recordDuesPayment } = useApp();
  const [form, setForm] = useState({
    memberId: initialMemberId,
    category: 'Membership',
    relatedPlan: '',
    amount: '',
    method: 'Cash',
    notes: '',
  });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => (
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `IDEMP-PAY-${Date.now()}`
  ));

  // Sync member when initialMemberId changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setIdempotencyKey(
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `IDEMP-PAY-${Date.now()}`
      );
      setSubmitError(null);
      const targetId = initialMemberId || form.memberId;
      const mem = members.find(m => m.id === targetId || m.member_code === targetId);
      if (mem) {
        setForm(f => ({
          ...f,
          memberId: mem.id,
          amount: mem.balance > 0 ? String(mem.balance) : '',
          relatedPlan: mem.plan || f.relatedPlan,
        }));
      }
      setErrors({});
      setIsSubmitting(false);
    }
  }, [isOpen, initialMemberId, members]);

  // Selected member object
  const selectedMember = useMemo(() => {
    return members.find(m => m.id === form.memberId || m.member_code === form.memberId) || null;
  }, [members, form.memberId]);

  // Handle member selection change
  const handleMemberChange = (newMemberId) => {
    const mem = members.find(m => m.id === newMemberId);
    setForm(f => ({
      ...f,
      memberId: newMemberId,
      amount: mem && mem.balance > 0 ? String(mem.balance) : '',
      relatedPlan: mem ? mem.plan : '',
    }));
    setSubmitError(null);
    setErrors(prev => ({ ...prev, memberId: undefined, amount: undefined }));
  };

  // Form Validation
  const validate = () => {
    const errs = {};
    if (!form.memberId) {
      errs.memberId = 'Please select a member';
    }

    const numAmount = Number(form.amount);
    if (!form.amount || isNaN(numAmount) || numAmount <= 0) {
      errs.amount = 'Enter a valid payment amount greater than zero';
    } else if (form.category === 'Membership' && selectedMember) {
      const memberBalance = Number(selectedMember.balance) || 0;
      if (memberBalance <= 0) {
        errs.amount = 'Member has no outstanding balance (₹0 due). Cannot record dues payment.';
      } else if (numAmount > memberBalance) {
        errs.amount = `Payment cannot exceed the outstanding balance of ${formatINR(memberBalance)}`;
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;

    if (!validate()) return;

    setIsSubmitting(true);
    setSubmitError(null);
    const numAmount = Number(form.amount);

    try {
      const result = await recordDuesPayment({
        memberId: form.memberId,
        subscriptionId: selectedMember?.currentSubscriptionId,
        amount: numAmount,
        paymentMethod: form.method,
        notes: form.notes,
        idempotencyKey,
      });

      if (onSave) {
        onSave({
          ...result,
          id: result?.receipt_number || result?.payment_id || `TFH-PAY-${Date.now()}`,
          receiptNumber: result?.receipt_number,
          date: getLocalDateString(),
          amount: numAmount,
          method: form.method,
          memberName: selectedMember?.name,
          memberId: selectedMember?.id,
          memberCode: selectedMember?.member_code,
          category: form.category,
          relatedPlan: selectedMember?.plan,
          status: (result?.remaining_balance === 0 || Number(result?.remaining_balance) === 0) ? 'completed' : 'partial',
          purpose: form.notes ? form.notes : 'Outstanding Dues Settlement',
        });
      }
    } catch (err) {
      console.error('Record payment failed:', err);
      setSubmitError(err.message || 'Failed to record payment transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const amountNumber = Number(form.amount) || 0;
  const isPTCategory = form.category === 'Personal Training';
  const balanceAfter = selectedMember && !isPTCategory
    ? Math.max(0, (Number(selectedMember.balance) || 0) - amountNumber)
    : 0;

  const isZeroBalanceMembership = form.category === 'Membership' && selectedMember && (Number(selectedMember.balance) || 0) <= 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={isSubmitting ? undefined : onClose}
      title="Record Member Payment"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || isZeroBalanceMembership || !form.memberId}
            className="bg-[#16845B] hover:bg-[#126b49] text-white"
          >
            {isSubmitting ? 'Recording...' : 'Record Payment'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Error Alert */}
        {submitError && (
          <div className="p-3.5 rounded-xl bg-[#FEE4E2] border border-[#B42318]/30 text-xs text-[#B42318] flex items-start gap-2.5 font-medium">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-[#B42318]" />
            <div className="space-y-0.5">
              <span className="font-bold block">Payment Submission Failed</span>
              <span>{submitError}</span>
            </div>
          </div>
        )}

        {/* Member Selector */}
        <Select
          label="Select Member *"
          value={form.memberId}
          onChange={e => handleMemberChange(e.target.value)}
          error={errors.memberId}
          options={[
            { value: '', label: 'Choose member...' },
            ...members.map(m => ({
              value: m.id,
              label: `${m.name} (${m.member_code || m.id}) ${m.balance > 0 ? `— Due: ${formatINR(m.balance)}` : '— (No Dues)'}`,
            }))
          ]}
        />

        {/* Member Current Status & Outstanding Balance Callout */}
        {selectedMember && (
          <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
            selectedMember.balance > 0
              ? 'bg-[#FFF2D8] border-[#A66A00]/25 text-[#25313B]'
              : 'bg-[#E8F5EE] border-[#16845B]/25 text-[#25313B]'
          }`}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                Plan: <span className="font-normal">{selectedMember.plan || 'General'}</span>
              </span>
              <span className="font-semibold">
                Current Dues:{' '}
                <span className={`font-bold tabular-nums ${selectedMember.balance > 0 ? 'text-[#A66A00]' : 'text-[#16845B]'}`}>
                  {formatINR(selectedMember.balance)}
                </span>
              </span>
            </div>

            {selectedMember.balance > 0 ? (
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-[#64717B]">
                  Click to prefill full outstanding balance:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setForm(f => ({ ...f, amount: String(selectedMember.balance) }));
                    setErrors(prev => ({ ...prev, amount: undefined }));
                  }}
                  className="text-xs font-bold text-[#16845B] hover:underline cursor-pointer bg-white px-2 py-0.5 rounded border border-[#16845B]/30"
                >
                  Pay Full {formatINR(selectedMember.balance)}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[#16845B] text-xs pt-1 font-medium">
                <CheckCircle2 size={14} />
                <span>This member has no pending dues (balance is ₹0). All payments are settled.</span>
              </div>
            )}
          </div>
        )}

        {/* Category & Plan */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Payment Category"
            value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            options={[
              { value: 'Membership', label: 'Membership Dues' },
              { value: 'Personal Training', label: 'Personal Training' },
              { value: 'Other', label: 'Other Gym Service' },
            ]}
          />
          <Input
            label="Related Plan / Purpose"
            value={form.relatedPlan}
            onChange={e => setForm(f => ({ ...f, relatedPlan: e.target.value }))}
            placeholder="e.g. Quarterly Membership"
          />
        </div>

        {/* Amount Input */}
        <div>
          <Input
            label="Amount (₹) *"
            type="number"
            min="1"
            placeholder="Enter payment amount in ₹"
            value={form.amount}
            onChange={e => {
              setForm(f => ({ ...f, amount: e.target.value }));
              setErrors(prev => ({ ...prev, amount: undefined }));
            }}
            error={errors.amount}
          />
          {selectedMember && amountNumber > 0 && !errors.amount && (
            isPTCategory ? (
              <p className="text-[11px] text-[#16845B] font-medium mt-1">
                Personal Training fee (recorded under PT revenue; does not modify membership dues or expiry date).
              </p>
            ) : (
              <p className="text-[11px] text-[#64717B] mt-1">
                Remaining balance after this payment:{' '}
                <span className={`font-semibold tabular-nums ${balanceAfter === 0 ? 'text-[#16845B]' : 'text-[#A66A00]'}`}>
                  {formatINR(balanceAfter)}
                </span>
              </p>
            )
          )}
        </div>

        {/* Payment Method */}
        <Select
          label="Payment Method *"
          value={form.method}
          onChange={e => setForm(f => ({ ...f, method: e.target.value }))}
          options={[
            { value: 'Cash', label: 'Cash' },
            { value: 'UPI', label: 'UPI / GPay / PhonePe / Paytm' },
            { value: 'Card', label: 'Credit / Debit Card' },
            { value: 'Other', label: 'Bank Transfer / Other' },
          ]}
        />

        {/* Notes */}
        <Textarea
          label="Transaction Notes / Reference (Optional)"
          placeholder="e.g. UPI Ref: 4210394851 or Cash handed to Coach Pravin Joshi"
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          rows={2}
        />
      </form>
    </Modal>
  );
}
