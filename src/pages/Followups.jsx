import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge, Badge } from '../components/ui/Badge';
import { SearchInput, Select, Input, Textarea } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { getLocalDateString } from '../utils/memberUtils';
import {
  PhoneCall, CheckCircle, Clock, AlertTriangle, Plus,
  User, Calendar, Check, ArrowRight, MessageSquare, Phone,
  RotateCcw, ShieldAlert, Sparkles, History, Edit3, Send
} from 'lucide-react';

export default function Followups() {
  const navigate = useNavigate();
  const {
    followups,
    members,
    addFollowup,
    updateFollowup,
    rescheduleFollowup,
    recordFollowupOutcome,
    followupsLoading,
    initialDataLoading,
  } = useApp();

  // Filters State
  const [filterStatus, setFilterStatus] = useState('pending'); // 'pending' | 'today' | 'overdue' | 'upcoming' | 'completed' | 'all'
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [search, setSearch] = useState('');

  // Modals State
  const [showAddModal, setShowAddModal] = useState(false);
  const [rescheduleItem, setRescheduleItem] = useState(null);
  const [outcomeItem, setOutcomeItem] = useState(null);
  const [notice, setNotice] = useState(null);

  // New Follow-up Form
  const [newForm, setNewForm] = useState({
    memberId: '',
    category: 'expiry',
    reason: 'Renewal Reminder',
    priority: 'high',
    dueDate: getLocalDateString(),
    notes: '',
  });

  // Reschedule Form State
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleNotes, setRescheduleNotes] = useState('');

  // Outcome Form State
  const [outcomeText, setOutcomeText] = useState('');
  const [outcomeMarkDone, setOutcomeMarkDone] = useState(true);

  const todayStr = useMemo(() => getLocalDateString(), []);

  // Filtered Followups
  const filteredFollowups = useMemo(() => {
    const q = search.trim().toLowerCase();

    return followups.filter(f => {
      // Search: member name, member ID, phone, or reason
      const matchSearch =
        !q ||
        (f.memberName && f.memberName.toLowerCase().includes(q)) ||
        (f.memberId && f.memberId.toLowerCase().includes(q)) ||
        (f.phone && f.phone.includes(q)) ||
        (f.reason && f.reason.toLowerCase().includes(q)) ||
        (f.notes && f.notes.toLowerCase().includes(q));

      if (!matchSearch) return false;

      // Member Directory verification: ignore orphaned test fixtures or deleted members
      const validMemberIds = new Set(members.map(m => m.id));
      if (validMemberIds.size > 0 && !validMemberIds.has(f.memberId)) {
        return false;
      }

      // Status Filter
      const isOverdue = f.status === 'overdue' || (f.dueDate < todayStr && f.status !== 'completed');
      if (filterStatus === 'pending' && f.status === 'completed') return false;
      if (filterStatus === 'today' && (f.dueDate !== todayStr || f.status === 'completed')) return false;
      if (filterStatus === 'overdue' && !isOverdue) return false;
      if (filterStatus === 'upcoming' && (f.dueDate <= todayStr || f.status === 'completed')) return false;
      if (filterStatus === 'completed' && f.status !== 'completed') return false;

      // Category Filter
      if (filterCategory !== 'all' && f.category !== filterCategory) return false;

      // Priority Filter
      if (filterPriority !== 'all' && f.priority !== filterPriority) return false;

      return true;
    }).sort((a, b) => {
      // Prioritize: pending/overdue first, then by priority (urgent > high > medium > low), then by dueDate
      if (a.status === 'completed' && b.status !== 'completed') return 1;
      if (a.status !== 'completed' && b.status === 'completed') return -1;

      const prioOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      const aPrio = prioOrder[a.priority] ?? 2;
      const bPrio = prioOrder[b.priority] ?? 2;
      if (aPrio !== bPrio) return aPrio - bPrio;

      return new Date(a.dueDate) - new Date(b.dueDate);
    });
  }, [followups, search, filterStatus, filterCategory, filterPriority, todayStr]);

  // Counts
  const countToday = useMemo(() => {
    return followups.filter(f => f.dueDate === todayStr && f.status !== 'completed').length;
  }, [followups, todayStr]);

  const countOverdue = useMemo(() => {
    return followups.filter(f => f.status === 'overdue' || (f.dueDate < todayStr && f.status !== 'completed')).length;
  }, [followups, todayStr]);

  const countUpcoming = useMemo(() => {
    return followups.filter(f => f.dueDate > todayStr && f.status !== 'completed').length;
  }, [followups, todayStr]);

  const countCompleted = useMemo(() => {
    return followups.filter(f => f.status === 'completed').length;
  }, [followups]);

  const countUrgent = useMemo(() => {
    return followups.filter(f => f.status !== 'completed' && (f.priority === 'urgent' || f.priority === 'high')).length;
  }, [followups]);

  // Handlers
  const handleCreateFollowup = (e) => {
    if (e) e.preventDefault();
    const targetMember = members.find(m => m.id === newForm.memberId);
    if (!targetMember) {
      alert('Please select a member');
      return;
    }

    addFollowup({
      memberId: targetMember.id,
      memberName: targetMember.name,
      phone: targetMember.phone || '',
      category: newForm.category,
      reason: newForm.reason,
      priority: newForm.priority,
      dueDate: newForm.dueDate,
      notes: newForm.notes,
    });

    setShowAddModal(false);
    setNewForm({
      memberId: '',
      category: 'expiry',
      reason: 'Renewal Reminder',
      priority: 'high',
      dueDate: todayStr,
      notes: '',
    });

    setNotice(`Scheduled new follow-up task for ${targetMember.name}`);
    setTimeout(() => setNotice(null), 5000);
  };

  const handleOpenReschedule = (item, e) => {
    e?.stopPropagation?.();
    setRescheduleItem(item);
    setRescheduleDate(item.dueDate);
    setRescheduleNotes('');
  };

  const handleConfirmReschedule = async () => {
    if (!rescheduleItem || !rescheduleDate) return;
    try {
      await rescheduleFollowup(rescheduleItem.id, rescheduleDate, rescheduleItem.reason, rescheduleNotes);
      setNotice(`Rescheduled follow-up for ${rescheduleItem.memberName} to ${rescheduleDate}`);
    } catch (err) {
      setNotice(`Failed to reschedule: ${err.message || String(err)}`);
    }
    setRescheduleItem(null);
    setTimeout(() => setNotice(null), 5000);
  };

  const handleOpenOutcome = (item, e) => {
    e?.stopPropagation?.();
    setOutcomeItem(item);
    setOutcomeText('');
    setOutcomeMarkDone(true);
  };

  const handleConfirmOutcome = async () => {
    if (!outcomeItem || !outcomeText.trim()) return;
    try {
      await recordFollowupOutcome(outcomeItem.id, outcomeText, outcomeMarkDone);
      setNotice(
        outcomeMarkDone
          ? `Task for ${outcomeItem.memberName} marked as completed with recorded outcome!`
          : `Contact outcome recorded for ${outcomeItem.memberName}`
      );
    } catch (err) {
      setNotice(`Failed to record outcome: ${err.message || String(err)}`);
    }
    setOutcomeItem(null);
    setTimeout(() => setNotice(null), 5000);
  };

  const handleQuickComplete = async (id, memberName, e) => {
    e?.stopPropagation?.();
    try {
      await updateFollowup(id, { status: 'completed' });
      setNotice(`Marked task for ${memberName} as completed!`);
    } catch (err) {
      setNotice(`Failed to complete: ${err.message || String(err)}`);
    }
    setTimeout(() => setNotice(null), 4000);
  };

  const resetFilters = () => {
    setSearch('');
    setFilterStatus('pending');
    setFilterCategory('all');
    setFilterPriority('all');
  };

  const hasFilters = search || filterStatus !== 'pending' || filterCategory !== 'all' || filterPriority !== 'all';

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Member Follow-ups Queue"
        description="Daily contact queue for membership renewals, outstanding balance recovery, and PT inquiries."
        badge={<Badge variant="warning">{countUrgent} High Priority</Badge>}
        actions={
          <Button onClick={() => setShowAddModal(true)} icon={Plus}>
            Add Follow-up
          </Button>
        }
      />

      {/* Notice Banner */}
      {notice && (
        <div className="p-3.5 rounded-xl bg-[#E8F5EE] border border-[#16845B]/25 text-[#16845B] text-xs font-semibold flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <Check size={16} />
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice(null)} className="hover:text-[#12704D] cursor-pointer">✕</button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => setFilterStatus('today')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            filterStatus === 'today'
              ? 'bg-[#FFF2D8] border-[#A66A00] ring-1 ring-[#A66A00]'
              : 'bg-white border-[#E1E6E9] hover:border-[#CBD5E1]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#64717B]">Due Today</span>
            <span className="p-1.5 rounded-lg bg-[#FFF2D8] text-[#A66A00]"><Clock size={16} /></span>
          </div>
          <p className="text-2xl font-bold text-[#25313B] mt-2">{countToday}</p>
          <p className="text-xs text-[#A66A00] font-medium mt-1">Contact scheduled</p>
        </div>

        <div
          onClick={() => setFilterStatus('overdue')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            filterStatus === 'overdue'
              ? 'bg-[#FCE9E9] border-[#B42318] ring-1 ring-[#B42318]'
              : 'bg-white border-[#E1E6E9] hover:border-[#CBD5E1]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#64717B]">Overdue Tasks</span>
            <span className="p-1.5 rounded-lg bg-[#FCE9E9] text-[#B42318]"><AlertTriangle size={16} /></span>
          </div>
          <p className="text-2xl font-bold text-[#25313B] mt-2">{countOverdue}</p>
          <p className="text-xs text-[#B42318] font-medium mt-1">Requires urgent action</p>
        </div>

        <div
          onClick={() => setFilterStatus('upcoming')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            filterStatus === 'upcoming'
              ? 'bg-[#E8F5EE] border-[#16845B] ring-1 ring-[#16845B]'
              : 'bg-white border-[#E1E6E9] hover:border-[#CBD5E1]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#64717B]">Upcoming</span>
            <span className="p-1.5 rounded-lg bg-[#E8F5EE] text-[#16845B]"><Calendar size={16} /></span>
          </div>
          <p className="text-2xl font-bold text-[#25313B] mt-2">{countUpcoming}</p>
          <p className="text-xs text-[#16845B] font-medium mt-1">Scheduled ahead</p>
        </div>

        <div
          onClick={() => setFilterStatus('completed')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            filterStatus === 'completed'
              ? 'bg-[#E8F5EE] border-[#16845B] ring-1 ring-[#16845B]'
              : 'bg-white border-[#E1E6E9] hover:border-[#CBD5E1]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#64717B]">Completed</span>
            <span className="p-1.5 rounded-lg bg-[#E8F5EE] text-[#16845B]"><CheckCircle size={16} /></span>
          </div>
          <p className="text-2xl font-bold text-[#25313B] mt-2">{countCompleted}</p>
          <p className="text-xs text-[#64717B] mt-1">Resolved queue</p>
        </div>
      </div>

      {/* Main Filter & Action Bar */}
      <Card padding={false} className="p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <SearchInput
            placeholder="Search member, phone, or reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
            className="w-full md:max-w-xs"
          />

          <div className="flex items-center gap-2 flex-wrap">
            {/* Status Filter */}
            <Select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              options={[
                { value: 'pending', label: 'Pending Queue' },
                { value: 'today', label: 'Due Today' },
                { value: 'overdue', label: 'Overdue' },
                { value: 'upcoming', label: 'Upcoming' },
                { value: 'completed', label: 'Completed' },
                { value: 'all', label: 'All Follow-ups' },
              ]}
              className="w-36"
            />

            {/* Category Filter */}
            <Select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              options={[
                { value: 'all', label: 'All Categories' },
                { value: 'expiry', label: 'Expiry Alerts' },
                { value: 'balance', label: 'Dues Collection' },
                { value: 'pt', label: 'PT Packages' },
                { value: 'general', label: 'General' },
              ]}
              className="w-36"
            />

            {/* Priority Filter */}
            <Select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              options={[
                { value: 'all', label: 'All Priorities' },
                { value: 'urgent', label: 'Urgent' },
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'low', label: 'Low' },
              ]}
              className="w-32"
            />

            {hasFilters && (
              <Button variant="ghost" size="sm" icon={RotateCcw} onClick={resetFilters}>
                Reset
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Follow-up Queue List */}
      <Card padding={false}>
        {(followupsLoading || initialDataLoading) ? (
          <div className="py-20 text-center">
            <RotateCcw size={28} className="animate-spin text-[#16845B] mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#25313B]">Loading follow-ups from database...</p>
            <p className="text-xs text-[#64717B] mt-1">Please wait while the follow-up queue is loaded.</p>
          </div>
        ) : filteredFollowups.length === 0 ? (
          <EmptyState
            icon={PhoneCall}
            title={hasFilters ? "No follow-ups match your filters" : "Follow-up queue is completely clear"}
            description={
              hasFilters
                ? "Try clearing filters or searching with a different term."
                : "No members currently require phone or WhatsApp follow-up."
            }
            action={
              hasFilters ? (
                <Button variant="secondary" size="sm" icon={RotateCcw} onClick={resetFilters}>
                  Clear Filters
                </Button>
              ) : (
                <Button icon={Plus} size="sm" onClick={() => setShowAddModal(true)}>
                  Schedule New Follow-up
                </Button>
              )
            }
          />
        ) : (
          <div className="divide-y divide-[#E1E6E9]">
            {filteredFollowups.map((item) => {
              const isOverdue = item.status === 'overdue' || (item.dueDate < todayStr && item.status !== 'completed');
              const isDone = item.status === 'completed';
              const cleanPhone = (item.phone || '').replace(/\D/g, '');

              // Priority badge styling
              const priorityBadges = {
                urgent: 'bg-[#FCE9E9] text-[#B42318] border-[#B42318]/30',
                high: 'bg-[#FFF2D8] text-[#A66A00] border-[#A66A00]/30',
                medium: 'bg-[#E8F5EE] text-[#16845B] border-[#16845B]/30',
                low: 'bg-[#F5F7F8] text-[#64717B] border-[#E1E6E9]',
              };

              return (
                <div
                  key={item.id}
                  className={`p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
                    isDone
                      ? 'bg-white opacity-70'
                      : isOverdue
                      ? 'bg-[#FCE9E9]/20 hover:bg-[#FCE9E9]/40'
                      : 'bg-white hover:bg-[#F5F7F8]/60'
                  }`}
                >
                  {/* Left Column: Complete Checkbox & Details */}
                  <div className="flex items-start gap-3.5 flex-1 min-w-0">
                    <button
                      onClick={(e) => handleQuickComplete(item.id, item.memberName, e)}
                      disabled={isDone}
                      className={`w-6 h-6 rounded-lg border mt-0.5 flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                        isDone
                          ? 'bg-[#16845B] border-[#16845B] text-white'
                          : 'border-[#CBD5E1] hover:border-[#16845B] text-transparent hover:text-[#16845B] bg-white'
                      }`}
                      title={isDone ? 'Completed' : 'Mark Completed'}
                    >
                      <Check size={14} />
                    </button>

                    <div className="min-w-0 space-y-1">
                      {/* Name, Member ID, Phone & Badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => item.memberId && navigate(`/members/${item.memberId}`)}
                          className="font-bold text-sm text-[#25313B] hover:text-[#16845B] cursor-pointer text-left hover:underline"
                        >
                          {item.memberName}
                        </button>
                        {item.memberId && (
                          <span className="text-xs font-mono text-[#64717B]">({item.memberId})</span>
                        )}
                        {item.phone && (
                          <span className="text-xs text-[#64717B]">📞 +91 {item.phone}</span>
                        )}

                        {/* Priority Badge */}
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                          priorityBadges[item.priority] || priorityBadges.medium
                        }`}>
                          {item.priority || 'medium'}
                        </span>

                        {/* Status Badge */}
                        <StatusBadge status={isDone ? 'completed' : isOverdue ? 'overdue' : item.status} />
                      </div>

                      {/* Reason */}
                      <p className="text-sm font-semibold text-[#25313B]">
                        {item.reason}
                      </p>

                      {/* Notes & Recorded Contact Outcome */}
                      <div className="flex flex-wrap gap-2 text-xs text-[#64717B] pt-0.5">
                        {item.notes && (
                          <span className="bg-[#F5F7F8] px-2 py-0.5 rounded border border-[#E1E6E9]">
                            {item.notes}
                          </span>
                        )}
                        {item.lastContactDate && (
                          <span className="bg-[#E8F5EE] text-[#16845B] px-2 py-0.5 rounded border border-[#16845B]/20 font-medium">
                            Last Contact: {item.lastContactDate}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Due Date & Action Buttons */}
                  <div className="flex items-center justify-between md:justify-end gap-3 shrink-0 pl-9 md:pl-0">
                    <div className="text-right">
                      <p className="text-[11px] text-[#64717B]">Due Date</p>
                      <p className={`text-xs font-bold tabular-nums ${isOverdue ? 'text-[#B42318]' : 'text-[#25313B]'}`}>
                        {item.dueDate}
                      </p>
                    </div>

                    {/* Interactive Action Buttons */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* WhatsApp Web Direct Link */}
                      {cleanPhone && (
                        <a
                          href={`https://wa.me/91${cleanPhone}?text=${encodeURIComponent(
                            `Hi ${item.memberName}, greeting from The Fitness House, Arag. Re: ${item.reason}.`
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg border border-[#E1E6E9] hover:bg-[#E8F5EE] hover:text-[#16845B] text-[#64717B] transition-colors"
                          title="Open WhatsApp Chat"
                        >
                          <MessageSquare size={15} />
                        </a>
                      )}

                      {/* Phone Call Link */}
                      {cleanPhone && (
                        <a
                          href={`tel:${cleanPhone}`}
                          className="p-1.5 rounded-lg border border-[#E1E6E9] hover:bg-[#F5F7F8] text-[#64717B] transition-colors"
                          title="Call Member"
                        >
                          <Phone size={15} />
                        </a>
                      )}

                      {/* Log Outcome */}
                      {!isDone && (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={Edit3}
                          onClick={(e) => handleOpenOutcome(item, e)}
                          className="text-xs h-8 px-2"
                          title="Record Contact Outcome"
                        >
                          Outcome
                        </Button>
                      )}

                      {/* Reschedule */}
                      {!isDone && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Calendar}
                          onClick={(e) => handleOpenReschedule(item, e)}
                          className="text-xs h-8 px-2"
                          title="Reschedule Follow-up"
                        >
                          Reschedule
                        </Button>
                      )}

                      {/* View Profile */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => item.memberId && navigate(`/members/${item.memberId}`)}
                        className="text-xs h-8 px-2"
                      >
                        Profile <ArrowRight size={13} />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Modal 1: Reschedule Follow-up */}
      {rescheduleItem && (
        <Modal
          isOpen={Boolean(rescheduleItem)}
          onClose={() => setRescheduleItem(null)}
          title={`Reschedule Follow-up: ${rescheduleItem.memberName}`}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setRescheduleItem(null)}>Cancel</Button>
              <Button onClick={handleConfirmReschedule}>Confirm Reschedule</Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-[#64717B]">
              Current reason: <strong className="text-[#25313B]">{rescheduleItem.reason}</strong>
            </p>
            <Input
              label="New Due Date *"
              type="date"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
            />
            <Textarea
              label="Reschedule Note / Reason"
              placeholder="e.g. Member requested to call back on Friday after 6 PM..."
              value={rescheduleNotes}
              onChange={(e) => setRescheduleNotes(e.target.value)}
              rows={2}
            />
          </div>
        </Modal>
      )}

      {/* Modal 2: Record Outcome */}
      {outcomeItem && (
        <Modal
          isOpen={Boolean(outcomeItem)}
          onClose={() => setOutcomeItem(null)}
          title={`Log Outcome: ${outcomeItem.memberName}`}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setOutcomeItem(null)}>Cancel</Button>
              <Button onClick={handleConfirmOutcome}>Save Outcome</Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-[#64717B]">
              Logging contact regarding: <strong className="text-[#25313B]">{outcomeItem.reason}</strong>
            </p>
            <Textarea
              label="Contact Outcome Details *"
              placeholder="e.g. Spoke to member. Agreed to visit tomorrow morning to pay dues and renew."
              value={outcomeText}
              onChange={(e) => setOutcomeText(e.target.value)}
              rows={3}
            />
            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[#25313B] select-none pt-1">
              <input
                type="checkbox"
                checked={outcomeMarkDone}
                onChange={(e) => setOutcomeMarkDone(e.target.checked)}
                className="w-4 h-4 rounded text-[#16845B] focus:ring-[#16845B] border-[#CBD5E1]"
              />
              Mark this follow-up task as Completed
            </label>
          </div>
        </Modal>
      )}

      {/* Modal 3: Schedule New Follow-up */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Schedule New Member Follow-up"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAddModal(false)}>Cancel</Button>
            <Button onClick={handleCreateFollowup}>Create Follow-up</Button>
          </>
        }
      >
        <form onSubmit={handleCreateFollowup} className="space-y-4">
          <Select
            label="Select Gym Member *"
            value={newForm.memberId}
            onChange={(e) => setNewForm(f => ({ ...f, memberId: e.target.value }))}
            options={[
              { value: '', label: '-- Choose a gym member --' },
              ...members.map(m => ({
                value: m.id,
                label: `${m.name} (${m.id}) — ${m.plan || 'Pass'} ${m.phone ? `• ${m.phone}` : ''}`,
              })),
            ]}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Category"
              value={newForm.category}
              onChange={(e) => setNewForm(f => ({ ...f, category: e.target.value }))}
              options={[
                { value: 'expiry', label: 'Membership Expiry' },
                { value: 'balance', label: 'Pending Dues' },
                { value: 'pt', label: 'PT Package Renewal' },
                { value: 'general', label: 'General / Inquiry' },
              ]}
            />
            <Select
              label="Priority"
              value={newForm.priority}
              onChange={(e) => setNewForm(f => ({ ...f, priority: e.target.value }))}
              options={[
                { value: 'urgent', label: 'Urgent' },
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'low', label: 'Low' },
              ]}
            />
          </div>

          <Select
            label="Follow-up Reason *"
            value={newForm.reason}
            onChange={(e) => setNewForm(f => ({ ...f, reason: e.target.value }))}
            options={[
              { value: 'Renewal Reminder', label: 'Membership Renewal Reminder' },
              { value: 'Payment Due Collection', label: 'Payment Due Collection' },
              { value: 'PT Package Inquiry', label: 'PT Package Inquiry' },
              { value: 'Inactive Member Attendance Check', label: 'Attendance Check / Inactive' },
              { value: 'Fitness Goal Consultation', label: 'Fitness Goal Consultation' },
              { value: 'Other Inquiry', label: 'Other' },
            ]}
          />

          <Input
            label="Due Date *"
            type="date"
            value={newForm.dueDate}
            onChange={(e) => setNewForm(f => ({ ...f, dueDate: e.target.value }))}
          />

          <Textarea
            label="Internal Notes"
            placeholder="Key discussion points, member preferences, or background context..."
            value={newForm.notes}
            onChange={(e) => setNewForm(f => ({ ...f, notes: e.target.value }))}
            rows={2}
          />
        </form>
      </Modal>
    </div>
  );
}
