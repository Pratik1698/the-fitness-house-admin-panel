import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Select, SearchInput, Textarea } from '../components/ui/Input';
import { StatusBadge, Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import {
  getMembershipStatus,
  getDaysDifference,
  getLocalDateString,
  getMemberInitials,
  calculateExpiryDate,
  isValidIndianPhone,
  isValidEmail,
} from '../utils/memberUtils';
import { exportMembersCSV } from '../utils/exportUtils';
import {
  Plus, Eye, IndianRupee, RotateCw, ChevronLeft, ChevronRight,
  Download, Users, CheckCircle2, User, Phone, Mail, MapPin, AlertCircle
} from 'lucide-react';

export default function Members() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    members,
    addMember,
    membershipPlans,
    plansLoading,
    plansError,
    reloadPlans,
    membersLoading,
    membersError,
    reloadMembers,
    initialDataLoading,
    isAdmin,
  } = useApp();

  const todayStr = useMemo(() => getLocalDateString(), []);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [successToast, setSuccessToast] = useState(null);
  const [exportNotice, setExportNotice] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const perPage = 8;

  // Fresh UUID idempotency key per logical registration attempt
  const [idempotencyKey, setIdempotencyKey] = useState(() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `IDEMP-${Date.now()}`));

  // Add Member Form State
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    gender: 'Male',
    dob: '',
    address: 'Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra',
    planId: '',
    startDate: todayStr,
    amountPaid: '',
    paymentMethod: 'UPI',
    notes: '',
  });
  const [formErrors, setFormErrors] = useState({});

  useEffect(() => {
    if (searchParams.get('add') === 'true') {
      setShowAddModal(true);
    }
    const statusParam = searchParams.get('status');
    if (statusParam && ['all', 'active', 'expired', 'expiring', 'balance'].includes(statusParam)) {
      setStatusFilter(statusParam);
    }
  }, [searchParams]);

  // Synchronize default plan selection when database plans load
  useEffect(() => {
    if (membershipPlans.length > 0) {
      setFormData(prev => {
        const planExists = membershipPlans.some(p => p.id === prev.planId);
        if (!planExists) {
          const defaultPlan = membershipPlans[0];
          return {
            ...prev,
            planId: defaultPlan.id,
            amountPaid: prev.amountPaid === '' ? String(defaultPlan.price) : prev.amountPaid,
          };
        }
        return prev;
      });
    }
  }, [membershipPlans]);

  // Derived selected plan info from active database plans
  const selectedPlanObj = useMemo(() => {
    if (!membershipPlans || membershipPlans.length === 0) return null;
    return membershipPlans.find(p => p.id === formData.planId) || membershipPlans[0] || null;
  }, [membershipPlans, formData.planId]);

  const calculatedTotalFee = selectedPlanObj ? selectedPlanObj.price : 0;
  const parsedAmountPaid = formData.amountPaid === '' ? 0 : parseFloat(formData.amountPaid) || 0;
  const calculatedBalance = Math.max(0, calculatedTotalFee - parsedAmountPaid);
  const calculatedExpiryDate = selectedPlanObj
    ? calculateExpiryDate(formData.startDate, selectedPlanObj.duration)
    : '';

  // Filter members using shared status calculation
  const filtered = members.filter(m => {
    const searchLower = search.toLowerCase();
    const matchSearch =
      !search ||
      (m.name && m.name.toLowerCase().includes(searchLower)) ||
      (m.member_code && m.member_code.toLowerCase().includes(searchLower)) ||
      (m.id && m.id.toLowerCase().includes(searchLower)) ||
      (m.phone && m.phone.includes(search));

    const effectiveStatus = getMembershipStatus(m, todayStr);

    let matchStatus = true;
    if (statusFilter === 'active') {
      matchStatus = effectiveStatus === 'active';
    } else if (statusFilter === 'expiring') {
      matchStatus = effectiveStatus === 'expiring';
    } else if (statusFilter === 'expired') {
      matchStatus = effectiveStatus === 'expired';
    } else if (statusFilter === 'balance') {
      matchStatus = m.balance > 0;
    }

    const selectedFilterPlan = membershipPlans.find(p => p.id === planFilter);
    const matchPlan =
      planFilter === 'all' ||
      m.planId === planFilter ||
      (selectedFilterPlan && m.plan && m.plan.toLowerCase() === selectedFilterPlan.name.toLowerCase());
    return matchSearch && matchStatus && matchPlan;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paged = filtered.slice((page - 1) * perPage, page * perPage);

  const handlePlanChange = (planId) => {
    const plan = membershipPlans.find(p => p.id === planId) || membershipPlans[0];
    if (!plan) return;
    setFormData(prev => ({
      ...prev,
      planId: plan.id,
      amountPaid: String(plan.price),
    }));
    setFormErrors(prev => ({ ...prev, amountPaid: undefined }));
  };

  const validateForm = () => {
    const errors = {};
    if (!formData.name.trim()) {
      errors.name = 'Full member name is required';
    }

    if (!formData.phone.trim()) {
      errors.phone = 'Phone number is required';
    } else if (!isValidIndianPhone(formData.phone)) {
      errors.phone = 'Enter a valid 10-digit Indian mobile number';
    }

    if (formData.email.trim() && !isValidEmail(formData.email)) {
      errors.email = 'Enter a valid email address';
    }

    if (!formData.startDate) {
      errors.startDate = 'Start date is required';
    }

    if (!formData.planId || !selectedPlanObj) {
      errors.planId = 'Please select a valid membership plan';
    }

    if (formData.amountPaid === '' || isNaN(Number(formData.amountPaid))) {
      errors.amountPaid = 'Please enter a valid payment amount';
    } else if (parsedAmountPaid < 0) {
      errors.amountPaid = 'Payment amount cannot be negative';
    } else if (parsedAmountPaid > calculatedTotalFee) {
      errors.amountPaid = `Payment cannot exceed total plan fee of ₹${calculatedTotalFee.toLocaleString('en-IN')}`;
    }

    if (parsedAmountPaid > 0 && !formData.paymentMethod) {
      errors.paymentMethod = 'Please select a payment method';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleFormSubmit = async (e) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;
    if (!validateForm()) return;

    setIsSubmitting(true);
    setFormErrors(prev => ({ ...prev, general: undefined }));

    try {
      const result = await addMember({
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim(),
        gender: formData.gender,
        dob: formData.dob,
        address: formData.address.trim(),
        plan: selectedPlanObj.name,
        planId: selectedPlanObj.id,
        startDate: formData.startDate,
        amountPaid: parsedAmountPaid,
        paymentMethod: formData.paymentMethod,
        notes: formData.notes.trim(),
        idempotencyKey: idempotencyKey,
      });

      setShowAddModal(false);
      const receiptNotice = result.receipt_number ? ` · Receipt: ${result.receipt_number}` : '';
      setSuccessToast(`Member ${formData.name.trim()} successfully registered! Member Code: ${result.member_code}${receiptNotice}`);
      setTimeout(() => setSuccessToast(null), 7000);

      // Reset form and generate fresh idempotency key for next registration
      setFormData({
        name: '',
        phone: '',
        email: '',
        gender: 'Male',
        dob: '',
        address: 'Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra',
        planId: membershipPlans[0]?.id || '',
        startDate: todayStr,
        amountPaid: membershipPlans[0] ? String(membershipPlans[0].price) : '',
        paymentMethod: 'UPI',
        notes: '',
      });
      setFormErrors({});
      setIdempotencyKey(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `IDEMP-${Date.now()}`);
    } catch (err) {
      console.error('Failed to register member:', err);
      // Preserve idempotency key across retries of this identical attempt
      setFormErrors(prev => ({
        ...prev,
        general: err?.message || 'Failed to complete registration. Please check inputs and retry.',
      }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportRoster = () => {
    if (!members || members.length === 0) {
      setExportNotice({
        type: 'warning',
        message: 'No member records available to export.',
      });
      setTimeout(() => setExportNotice(null), 5000);
      return;
    }

    if (filtered.length === 0) {
      setExportNotice({
        type: 'warning',
        message: 'No members match the current filters to export.',
      });
      setTimeout(() => setExportNotice(null), 5000);
      return;
    }

    const filename = `fitness-house-members-${todayStr}.csv`;
    exportMembersCSV(filtered, filename, todayStr);

    const count = filtered.length;
    setExportNotice({
      type: 'success',
      message: `Exported ${count} member ${count === 1 ? 'record' : 'records'} to CSV.`,
    });
    setTimeout(() => setExportNotice(null), 5000);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Members Directory"
        description="Comprehensive management of gym members, subscriptions, renewals, and balances."
        badge={
          <Badge variant="success">
            {members.length} Enrolled
          </Badge>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              icon={RotateCw}
              onClick={reloadMembers}
              disabled={membersLoading}
              title="Refresh member records from database"
            >
              Refresh
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={Download}
              onClick={handleExportRoster}
              title="Export filtered member roster to CSV"
            >
              Export Roster
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={Plus}
              onClick={() => setShowAddModal(true)}
              className="bg-[#16845B] hover:bg-[#126b49] text-white shadow-xs font-semibold"
            >
              Add New Member
            </Button>
          </>
        }
      />

      {/* Database Error Notification */}
      {membersError && (
        <div className="p-4 rounded-xl bg-[#FEF3F2] border border-[#FECDCA] text-[#B42318] flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle size={18} className="shrink-0 text-[#D92D20]" />
            <div>
              <p className="text-xs font-bold">Failed to load member records from database</p>
              <p className="text-xs text-[#B42318]/90">{membersError}</p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={reloadMembers}
            className="border-[#FDA29B] text-[#B42318] hover:bg-[#FEE4E2] shrink-0"
          >
            <RotateCw size={14} className="mr-1.5" />
            Retry
          </Button>
        </div>
      )}

      {/* Success Notification */}
      {successToast && (
        <div className="p-3.5 rounded-xl bg-[#E8F5EE] border border-[#16845B]/25 text-[#16845B] text-xs font-semibold flex items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{successToast}</span>
          </div>
          <button onClick={() => setSuccessToast(null)} className="text-[#16845B] hover:text-[#126b49] cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* Export Notification */}
      {exportNotice && (
        <div
          role="status"
          aria-live="polite"
          className={`p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 shadow-xs transition-all ${
            exportNotice.type === 'warning'
              ? 'bg-[#FFFAEB] border border-[#FEDF89] text-[#B54708]'
              : 'bg-[#E8F5EE] border border-[#16845B]/25 text-[#16845B]'
          }`}
        >
          <div className="flex items-center gap-2">
            {exportNotice.type === 'warning' ? (
              <AlertCircle size={16} className="shrink-0 text-[#F79009]" />
            ) : (
              <CheckCircle2 size={16} className="shrink-0 text-[#16845B]" />
            )}
            <span>{exportNotice.message}</span>
          </div>
          <button
            onClick={() => setExportNotice(null)}
            className={`cursor-pointer transition-colors ${
              exportNotice.type === 'warning'
                ? 'text-[#B54708] hover:text-[#7A271A]'
                : 'text-[#16845B] hover:text-[#126b49]'
            }`}
            aria-label="Dismiss export notice"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filter Toolbar Card */}
      <Card padding={false} className="p-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3.5">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
            <SearchInput
              placeholder="Search by name, ID, or phone..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              onClear={() => setSearch('')}
              className="w-full sm:w-72 lg:w-80"
            />

            <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
              <Select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                options={[
                  { value: 'all', label: 'All Statuses' },
                  { value: 'active', label: 'Active Members' },
                  { value: 'expiring', label: 'Expiring Soon (≤5d)' },
                  { value: 'expired', label: 'Expired' },
                  ...(isAdmin ? [{ value: 'balance', label: 'Outstanding Balance' }] : []),
                ]}
                className="w-full sm:w-44"
              />

              <Select
                value={planFilter}
                onChange={(e) => { setPlanFilter(e.target.value); setPage(1); }}
                options={[
                  { value: 'all', label: 'All Plans' },
                  ...membershipPlans.map(p => ({ value: p.id, label: `${p.name} Plan` })),
                ]}
                className="w-full sm:w-44"
              />

              {(search || statusFilter !== 'all' || planFilter !== 'all') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch('');
                    setStatusFilter('all');
                    setPlanFilter('all');
                    setPage(1);
                  }}
                  className="text-xs"
                >
                  Reset Filters
                </Button>
              )}
            </div>
          </div>

          <div className="text-xs text-[#64717B] font-medium self-end lg:self-center shrink-0">
            Showing <strong className="text-[#25313B]">{filtered.length}</strong> of {members.length} members
          </div>
        </div>
      </Card>

      {/* Main Members Data Table Card */}
      <Card padding={false} className="overflow-hidden">
        {(membersLoading || initialDataLoading) ? (
          <div className="py-20 text-center">
            <RotateCw size={28} className="animate-spin text-[#16845B] mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#25313B]">Loading members from database...</p>
            <p className="text-xs text-[#64717B] mt-1">Please wait while active member records are fetched.</p>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title={members.length === 0 ? "No active members found" : "No members match your criteria"}
            description={members.length === 0 ? "Register a new member to begin tracking subscriptions." : "Try modifying your search query or reset the active status and plan filters."}
            action={
              members.length === 0 ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setShowAddModal(true)}
                  className="bg-[#16845B] hover:bg-[#126b49] text-white"
                >
                  <Plus size={14} className="mr-1" /> Add Member
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { setSearch(''); setStatusFilter('all'); setPlanFilter('all'); }}
                >
                  Clear all filters
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F5F7F8] border-b border-[#E1E6E9]">
                  <th className="py-3.5 px-4 text-xs font-bold text-[#64717B] uppercase tracking-wider">Member Details</th>
                  <th className="py-3.5 px-4 text-xs font-bold text-[#64717B] uppercase tracking-wider">Contact</th>
                  <th className="py-3.5 px-4 text-xs font-bold text-[#64717B] uppercase tracking-wider">Plan Details</th>
                  <th className="py-3.5 px-4 text-xs font-bold text-[#64717B] uppercase tracking-wider">Expiry Date</th>
                  <th className="py-3.5 px-4 text-xs font-bold text-[#64717B] uppercase tracking-wider text-right">Balance</th>
                  <th className="py-3.5 px-4 text-xs font-bold text-[#64717B] uppercase tracking-wider text-center">Status</th>
                  <th className="py-3.5 px-4 text-xs font-bold text-[#64717B] uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E6E9]">
                {paged.map((m) => {
                  const daysLeft = getDaysDifference(m.expiryDate, todayStr);
                  const displayStatus = getMembershipStatus(m, todayStr);

                  return (
                    <tr
                      key={m.id}
                      className="hover:bg-[#F5F7F8]/60 transition-colors duration-100 group"
                    >
                      {/* Member Info */}
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[#E8F5EE] text-[#16845B] font-bold text-xs flex items-center justify-center shrink-0 border border-[#16845B]/20 shadow-xs">
                            {getMemberInitials(m.name)}
                          </div>
                          <div>
                            <p
                              onClick={() => navigate(`/members/${m.id}`)}
                              className="text-sm font-bold text-[#25313B] group-hover:text-[#16845B] cursor-pointer transition-colors"
                            >
                              {m.name}
                            </p>
                            <span className="inline-block text-[11px] font-mono font-medium text-[#64717B]">
                              {m.member_code || m.id}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Contact */}
                      <td className="py-4 px-4">
                        <p className="text-sm font-medium text-[#25313B]">{m.phone}</p>
                        <p className="text-xs text-[#64717B] truncate max-w-[140px]">
                          {m.email || m.address || 'Near Vitthal Mandir, Arag'}
                        </p>
                      </td>

                      {/* Plan */}
                      <td className="py-4 px-4">
                        <p className="text-sm font-semibold text-[#25313B]">{m.plan}</p>
                        <p className="text-xs text-[#64717B]">Joined: {m.joinDate || m.startDate}</p>
                      </td>

                      {/* Expiry */}
                      <td className="py-4 px-4">
                        <p className="text-sm font-medium text-[#25313B]">{m.expiryDate}</p>
                        <p className={`text-xs font-semibold ${
                          displayStatus === 'expired' ? 'text-[#B42318]' :
                          displayStatus === 'expiring' ? 'text-[#A66A00]' : 'text-[#16845B]'
                        }`}>
                          {displayStatus === 'expired'
                            ? (daysLeft < 0 ? `Expired (${Math.abs(daysLeft)}d ago)` : 'Expired')
                            : `${daysLeft} days remaining`}
                        </p>
                      </td>

                      {/* Balance */}
                      <td className="py-4 px-4 text-right">
                        {!isAdmin || m.balance === null || m.balance === undefined ? (
                          <span className="text-xs font-medium text-[#64717B]">Restricted</span>
                        ) : m.balance > 0 ? (
                          <div>
                            <span className="text-sm font-bold text-[#B42318] tabular-nums">
                              ₹{m.balance.toLocaleString('en-IN')}
                            </span>
                            <p className="text-[11px] text-[#A66A00] font-medium">Pending</p>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold text-[#16845B] bg-[#E8F5EE] px-2 py-0.5 rounded-md">
                            Paid
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-4 px-4 text-center">
                        <StatusBadge status={displayStatus} />
                      </td>

                      {/* Action Buttons */}
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => navigate(`/members/${m.id}`)}
                            title="View Member Profile"
                          >
                            <Eye size={14} /> View
                          </Button>

                          {isAdmin && m.balance > 0 ? (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => navigate(`/payments?memberId=${m.id}&record=true`)}
                              title="Collect Payment"
                              className="bg-[#16845B] hover:bg-[#126b49] text-white"
                            >
                              <IndianRupee size={14} /> Pay
                            </Button>
                          ) : displayStatus === 'expired' || displayStatus === 'expiring' ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => navigate(`/members/${m.id}?renew=true`)}
                              title="Renew Membership"
                            >
                              <RotateCw size={14} /> Renew
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {filtered.length > 0 && (
          <div className="px-6 py-4 bg-[#F5F7F8]/40 border-t border-[#E1E6E9] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#64717B]">
            <div>
              Showing <strong className="text-[#25313B]">{(page - 1) * perPage + 1}</strong> to{' '}
              <strong className="text-[#25313B]">{Math.min(page * perPage, filtered.length)}</strong> of{' '}
              <strong className="text-[#25313B]">{filtered.length}</strong> members
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft size={14} /> Previous
              </Button>

              {Array.from({ length: totalPages }).map((_, idx) => (
                <button
                  key={idx + 1}
                  onClick={() => setPage(idx + 1)}
                  className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    page === idx + 1
                      ? 'bg-[#16845B] text-white shadow-xs'
                      : 'bg-white border border-[#E1E6E9] text-[#25313B] hover:bg-[#F5F7F8]'
                  }`}
                >
                  {idx + 1}
                </button>
              ))}

              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Next <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Add Member Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => { if (!isSubmitting) setShowAddModal(false); }}
        title="Register New Gym Member"
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setShowAddModal(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleFormSubmit}
              disabled={isSubmitting || plansLoading || !selectedPlanObj}
              className="bg-[#16845B] hover:bg-[#126b49] text-white shadow-xs font-semibold"
            >
              {isSubmitting ? 'Registering Member...' : 'Complete Registration'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleFormSubmit} className="space-y-4">
          {formErrors.general && (
            <div className="p-3.5 rounded-xl bg-[#FEE4E2] border border-[#B42318]/30 text-xs text-[#B42318] flex items-start gap-2.5 font-medium">
              <AlertCircle size={16} className="text-[#B42318] shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-bold block">Registration Error</span>
                <span>{formErrors.general}</span>
              </div>
            </div>
          )}

          {/* Member Name and Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Full Member Name *"
              icon={User}
              placeholder="e.g. Rahul Sharma"
              value={formData.name}
              onChange={(e) => {
                setFormData({ ...formData, name: e.target.value });
                setFormErrors(prev => ({ ...prev, name: undefined }));
              }}
              error={formErrors.name}
              autoFocus
            />

            <Input
              label="Phone Number (10 digits) *"
              icon={Phone}
              placeholder="10-digit mobile number"
              value={formData.phone}
              onChange={(e) => {
                setFormData({ ...formData, phone: e.target.value });
                setFormErrors(prev => ({ ...prev, phone: undefined }));
              }}
              error={formErrors.phone}
            />
          </div>

          {/* Email, Gender, DOB */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="Email Address (Optional)"
              type="email"
              icon={Mail}
              placeholder="name@email.com"
              value={formData.email}
              onChange={(e) => {
                setFormData({ ...formData, email: e.target.value });
                setFormErrors(prev => ({ ...prev, email: undefined }));
              }}
              error={formErrors.email}
            />

            <Select
              label="Gender"
              value={formData.gender}
              onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
              options={[
                { value: 'Male', label: 'Male' },
                { value: 'Female', label: 'Female' },
                { value: 'Other', label: 'Other' },
              ]}
            />

            <Input
              label="Date of Birth"
              type="date"
              value={formData.dob}
              onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
            />
          </div>

          {/* Address */}
          <Input
            label="Residential Address"
            icon={MapPin}
            placeholder="e.g. Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          />

          {/* Subscription & Fee Details */}
          <div className="p-4 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-[#25313B] uppercase tracking-wider">
                Membership Subscription & Fee Details
              </h4>
              {plansLoading && (
                <span className="text-[11px] font-medium text-[#16845B] animate-pulse">
                  Updating plans...
                </span>
              )}
            </div>

            {plansError && (
              <div className="p-3 rounded-xl bg-[#FEE4E2] border border-[#B42318]/30 text-xs text-[#B42318] flex items-center justify-between gap-2">
                <span>Failed to load plans from database: {plansError}</span>
                <button
                  type="button"
                  onClick={reloadPlans}
                  className="px-2 py-1 rounded bg-[#B42318] text-white text-[11px] font-semibold hover:bg-[#911d13] cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Select
                label="Select Plan *"
                value={formData.planId}
                onChange={(e) => handlePlanChange(e.target.value)}
                disabled={plansLoading || membershipPlans.length === 0}
                error={formErrors.planId}
                options={
                  membershipPlans.length > 0
                    ? membershipPlans.map(p => ({
                        value: p.id,
                        label: `${p.name} (₹${p.price.toLocaleString('en-IN')} / ${p.duration}d)`,
                      }))
                    : [{ value: '', label: plansLoading ? 'Loading plans...' : 'No active plans available' }]
                }
              />

              <Input
                label="Start Date *"
                type="date"
                value={formData.startDate}
                onChange={(e) => {
                  setFormData({ ...formData, startDate: e.target.value });
                  setFormErrors(prev => ({ ...prev, startDate: undefined }));
                }}
                error={formErrors.startDate}
              />

              <div>
                <label className="block text-xs font-semibold text-[#25313B] mb-1.5">
                  Calculated Expiry
                </label>
                <div className="h-10 px-3.5 flex items-center rounded-xl bg-white border border-[#E1E6E9] text-sm font-semibold text-[#16845B]">
                  {calculatedExpiryDate}
                </div>
              </div>
            </div>

            {/* Fee and Payment Row */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-1">
              <div>
                <label className="block text-xs font-semibold text-[#25313B] mb-1.5">
                  Total Plan Fee
                </label>
                <div className="h-10 px-3.5 flex items-center rounded-xl bg-white border border-[#E1E6E9] text-sm font-bold text-[#25313B]">
                  ₹{calculatedTotalFee.toLocaleString('en-IN')}
                </div>
              </div>

              <Input
                label="Amount Paid Today (₹) *"
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={formData.amountPaid}
                onChange={(e) => {
                  setFormData({ ...formData, amountPaid: e.target.value });
                  setFormErrors(prev => ({ ...prev, amountPaid: undefined }));
                }}
                error={formErrors.amountPaid}
              />

              <Select
                label="Payment Method"
                value={formData.paymentMethod}
                onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                error={formErrors.paymentMethod}
                options={[
                  { value: 'UPI', label: 'UPI / QR Code' },
                  { value: 'Cash', label: 'Cash' },
                  { value: 'Card', label: 'Debit / Credit Card' },
                ]}
              />

              <div>
                <label className="block text-xs font-semibold text-[#25313B] mb-1.5">
                  Remaining Balance
                </label>
                <div className={`h-10 px-3.5 flex items-center rounded-xl bg-white border border-[#E1E6E9] text-sm font-bold ${
                  calculatedBalance > 0 ? 'text-[#B42318]' : 'text-[#16845B]'
                }`}>
                  {calculatedBalance > 0 ? `₹${calculatedBalance.toLocaleString('en-IN')}` : '₹0 (Paid in Full)'}
                </div>
              </div>
            </div>
          </div>

          {/* Member Notes */}
          <Textarea
            label="Notes / Emergency Contact (Optional)"
            rows={2}
            placeholder="e.g. Emergency contact person, fitness goals, existing medical condition..."
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          />
        </form>
      </Modal>
    </div>
  );
}

