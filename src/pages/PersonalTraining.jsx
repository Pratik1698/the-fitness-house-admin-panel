import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge, Badge } from '../components/ui/Badge';
import { KPICard } from '../components/shared/KPICard';
import { SearchInput, Select, Input, Textarea } from '../components/ui/Input';
import { Tabs } from '../components/ui/Tabs';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { PT_PACKAGES } from '../data/sampleData';
import {
  formatINR,
  getLocalDateString,
  getDaysDifference,
  calculateExpiryDate,
} from '../utils/memberUtils';
import {
  Users, Calendar, CheckCircle, IndianRupee, AlertTriangle,
  Dumbbell, Eye, Target, TrendingUp, Clock, Plus,
  Edit2, Check, X, RotateCcw, FileText, CheckCircle2,
  XCircle, AlertCircle, Sparkles, Filter
} from 'lucide-react';

export default function PersonalTraining() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    members,
    payments,
    ptClients,
    ptSessions,
    addPtClient,
    updatePtClient,
    addPtSession,
    updatePtSessionStatus,
    updatePtSession,
  } = useApp();

  const todayStr = useMemo(() => getLocalDateString(), []);

  // Active Tab state
  const initialTab = searchParams.get('tab') || 'clients';
  const [activeTab, setActiveTab] = useState(initialTab);

  // Client search and filter state
  const [clientSearch, setClientSearch] = useState('');
  const [clientStatusFilter, setClientStatusFilter] = useState('all'); // 'all' | 'active' | 'ending_soon' | 'completed'

  // Session search and filter state
  const [sessionSearch, setSessionSearch] = useState('');
  const [sessionStatusFilter, setSessionStatusFilter] = useState('all'); // 'all' | 'scheduled' | 'completed' | 'cancelled' | 'no-show'
  const [sessionDateFilter, setSessionDateFilter] = useState('all'); // 'all' | 'today' | 'upcoming' | 'past'

  // Modals state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [preselectedPackage, setPreselectedPackage] = useState(null);
  const [editingClient, setEditingClient] = useState(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [schedulingForMember, setSchedulingForMember] = useState(null);
  const [editingSession, setEditingSession] = useState(null);
  const [notice, setNotice] = useState(null);

  // Sync tab with URL if needed
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // ==========================================
  // KPIs & Metrics
  // ==========================================
  const activeClients = useMemo(() => {
    return ptClients.filter(c => c.status === 'active');
  }, [ptClients]);

  const todaySessions = useMemo(() => {
    return ptSessions.filter(s => s.date === todayStr);
  }, [ptSessions, todayStr]);

  const completedSessions = useMemo(() => {
    return ptSessions.filter(s => s.status === 'completed');
  }, [ptSessions]);

  // Dynamic PT Revenue from shared payments ledger
  const ptRevenue = useMemo(() => {
    return payments
      .filter(p => p.category === 'Personal Training')
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  }, [payments]);

  // Packages ending soon (<= 3 sessions remaining OR validity expiring in <= 5 days)
  const endingSoonClients = useMemo(() => {
    return ptClients.filter(c => {
      if (c.status !== 'active') return false;
      const isLowSessions = Number(c.remainingSessions) <= 3;
      const days = c.validTill ? getDaysDifference(c.validTill, todayStr) : null;
      const isExpiringValidity = days !== null && days <= 5;
      return isLowSessions || isExpiringValidity;
    });
  }, [ptClients, todayStr]);

  // ==========================================
  // Filtered Clients
  // ==========================================
  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    return ptClients.filter(c => {
      // Search matches name, member ID, trainer, or package
      const matchSearch =
        !q ||
        (c.memberName && c.memberName.toLowerCase().includes(q)) ||
        (c.memberId && c.memberId.toLowerCase().includes(q)) ||
        (c.trainer && c.trainer.toLowerCase().includes(q)) ||
        (c.package && c.package.toLowerCase().includes(q));

      if (!matchSearch) return false;

      // Status Filter
      if (clientStatusFilter === 'active') {
        return c.status === 'active';
      }
      if (clientStatusFilter === 'ending_soon') {
        if (c.status !== 'active') return false;
        const isLow = Number(c.remainingSessions) <= 3;
        const days = c.validTill ? getDaysDifference(c.validTill, todayStr) : null;
        return isLow || (days !== null && days <= 5);
      }
      if (clientStatusFilter === 'completed') {
        return c.status === 'completed' || c.status === 'expired' || Number(c.remainingSessions) === 0;
      }

      return true;
    });
  }, [ptClients, clientSearch, clientStatusFilter, todayStr]);

  // ==========================================
  // Filtered Sessions
  // ==========================================
  const filteredSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    return ptSessions.filter(s => {
      const matchSearch =
        !q ||
        (s.memberName && s.memberName.toLowerCase().includes(q)) ||
        (s.memberId && s.memberId.toLowerCase().includes(q)) ||
        (s.trainer && s.trainer.toLowerCase().includes(q)) ||
        (s.notes && s.notes.toLowerCase().includes(q));

      if (!matchSearch) return false;

      // Status filter
      if (sessionStatusFilter !== 'all' && s.status !== sessionStatusFilter) {
        return false;
      }

      // Date filter
      if (sessionDateFilter === 'today' && s.date !== todayStr) return false;
      if (sessionDateFilter === 'upcoming' && s.date <= todayStr) return false;
      if (sessionDateFilter === 'past' && s.date >= todayStr) return false;

      return true;
    }).sort((a, b) => {
      // Sort by date desc, then time desc
      if (a.date !== b.date) return new Date(b.date) - new Date(a.date);
      return (b.time || '').localeCompare(a.time || '');
    });
  }, [ptSessions, sessionSearch, sessionStatusFilter, sessionDateFilter, todayStr]);

  // ==========================================
  // Session Status Handlers
  // ==========================================
  const handleMarkCompleted = (session) => {
    if (session.status === 'completed') return;

    // Check if client has remaining sessions
    const client = ptClients.find(c => c.memberId === session.memberId);
    if (client && Number(client.remainingSessions) <= 0) {
      alert(`Cannot mark session completed: ${client.memberName} has 0 remaining sessions in their package. Please assign a new PT package.`);
      return;
    }

    updatePtSessionStatus(session.id, 'completed');
    setNotice(`Session for ${session.memberName} marked as Completed. Remaining sessions updated.`);
    setTimeout(() => setNotice(null), 5000);
  };

  const handleMarkCancelled = (session) => {
    if (session.status === 'cancelled') return;
    updatePtSessionStatus(session.id, 'cancelled');
    setNotice(`Session for ${session.memberName} marked as Cancelled. No sessions deducted.`);
    setTimeout(() => setNotice(null), 5000);
  };

  const handleMarkNoShow = (session) => {
    if (session.status === 'no-show') return;
    updatePtSessionStatus(session.id, 'no-show');
    setNotice(`Session for ${session.memberName} marked as No-show. No sessions deducted.`);
    setTimeout(() => setNotice(null), 5000);
  };

  const handleQuickAssignPackage = (pkg) => {
    setPreselectedPackage(pkg);
    setShowAssignModal(true);
  };

  const handleQuickScheduleForClient = (client) => {
    setSchedulingForMember(client);
    setShowScheduleModal(true);
  };

  // ==========================================
  // Tab Definitions
  // ==========================================
  const tabs = [
    {
      id: 'clients',
      label: 'PT Clients',
      count: ptClients.length,
      content: (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <SearchInput
              placeholder="Search by member, ID, trainer, package..."
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              onClear={() => setClientSearch('')}
              className="w-full sm:max-w-xs"
            />
            <div className="flex items-center gap-2">
              <Select
                value={clientStatusFilter}
                onChange={e => setClientStatusFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Packages' },
                  { value: 'active', label: 'Active Packages' },
                  { value: 'ending_soon', label: 'Ending Soon (≤3 left)' },
                  { value: 'completed', label: 'Completed / Expired' },
                ]}
                className="w-48"
              />
              {(clientSearch || clientStatusFilter !== 'all') && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={RotateCcw}
                  onClick={() => {
                    setClientSearch('');
                    setClientStatusFilter('all');
                  }}
                  className="text-xs"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>

          {/* PT Clients Table */}
          <div className="overflow-x-auto border border-[#E1E6E9] rounded-xl bg-white">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E1E6E9] bg-[#F5F7F8]/60">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64717B] uppercase tracking-wider">Member</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64717B] uppercase tracking-wider">Package</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#64717B] uppercase tracking-wider">Total</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#64717B] uppercase tracking-wider">Done</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#64717B] uppercase tracking-wider">Left</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64717B] uppercase tracking-wider hidden md:table-cell">Valid Till</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#64717B] uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[#64717B] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E6E9]">
                {filteredClients.map(c => {
                  const isEndingSoon = c.status === 'active' && Number(c.remainingSessions) <= 3;
                  const progressPct = Math.min(100, Math.round(((c.completedSessions || 0) / (c.totalSessions || 1)) * 100));

                  return (
                    <tr key={c.memberId + (c.packageId || '')} className="hover:bg-[#F5F7F8]/80 transition-colors">
                      {/* Member Info */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[#E8F5EE] border border-[#16845B]/20 flex items-center justify-center text-[#16845B] text-xs font-bold shrink-0">
                            {c.memberName?.charAt(0) || 'M'}
                          </div>
                          <div>
                            <button
                              onClick={() => navigate(`/members/${c.memberId}`)}
                              className="text-sm font-semibold text-[#25313B] hover:text-[#16845B] cursor-pointer text-left block"
                            >
                              {c.memberName}
                            </button>
                            <div className="flex items-center gap-2 text-xs text-[#64717B]">
                              <span className="font-mono text-[11px]">{c.memberId}</span>
                              <span>·</span>
                              <span className="font-medium text-[#25313B]">{c.trainer || 'Coach Pravin Joshi'}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Package & Progress Bar */}
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-[#25313B]">{c.package}</p>
                        <div className="w-28 sm:w-36 mt-1.5">
                          <div className="h-1.5 bg-[#E1E6E9] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#16845B] rounded-full transition-all"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-[#64717B]">{progressPct}% completed</span>
                        </div>
                      </td>

                      {/* Total Sessions */}
                      <td className="px-4 py-3 text-sm text-center font-medium text-[#25313B] tabular-nums">
                        {c.totalSessions}
                      </td>

                      {/* Done Sessions */}
                      <td className="px-4 py-3 text-sm text-center font-bold text-[#16845B] tabular-nums">
                        {c.completedSessions}
                      </td>

                      {/* Left Sessions */}
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold tabular-nums ${
                          c.remainingSessions === 0
                            ? 'bg-[#FCE9E9] text-[#B42318]'
                            : isEndingSoon
                            ? 'bg-[#FFF2D8] text-[#A66A00]'
                            : 'bg-[#E8F5EE] text-[#16845B]'
                        }`}>
                          {c.remainingSessions}
                        </span>
                      </td>

                      {/* Validity Date */}
                      <td className="px-4 py-3 text-sm text-[#64717B] hidden md:table-cell whitespace-nowrap">
                        <div>
                          <p className="text-xs text-[#25313B] font-medium">{c.validTill || '—'}</p>
                          <p className="text-[11px] text-[#64717B]">Start: {c.startDate || '—'}</p>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <StatusBadge status={c.status} />
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {c.status === 'active' && c.remainingSessions > 0 && (
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={Calendar}
                              onClick={() => handleQuickScheduleForClient(c)}
                              className="text-xs h-7 px-2"
                              title="Schedule Training Session"
                            >
                              Session
                            </Button>
                          )}
                          <button
                            onClick={() => setEditingClient(c)}
                            className="p-1.5 rounded-lg hover:bg-[#F5F7F8] text-[#64717B] hover:text-[#25313B] cursor-pointer"
                            title="Edit Assignment"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => navigate(`/members/${c.memberId}`)}
                            className="p-1.5 rounded-lg hover:bg-[#E8F5EE] text-[#64717B] hover:text-[#16845B] cursor-pointer"
                            title="View Member Profile"
                          >
                            <Eye size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredClients.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12">
                      <EmptyState
                        icon={Users}
                        title="No PT clients found"
                        description={
                          clientSearch || clientStatusFilter !== 'all'
                            ? "Try adjusting your search criteria or filter options."
                            : "No personal training clients have been assigned yet."
                        }
                        action={
                          <Button
                            variant="primary"
                            size="sm"
                            icon={Plus}
                            onClick={() => setShowAssignModal(true)}
                          >
                            Assign PT Package
                          </Button>
                        }
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      id: 'sessions',
      label: 'Sessions Ledger',
      count: ptSessions.length,
      content: (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <SearchInput
              placeholder="Search by member, ID, trainer, notes..."
              value={sessionSearch}
              onChange={e => setSessionSearch(e.target.value)}
              onClear={() => setSessionSearch('')}
              className="w-full sm:max-w-xs"
            />
            <div className="flex items-center gap-2 flex-wrap">
              {/* Status Filter */}
              <Select
                value={sessionStatusFilter}
                onChange={e => setSessionStatusFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Statuses' },
                  { value: 'scheduled', label: 'Scheduled' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'cancelled', label: 'Cancelled' },
                  { value: 'no-show', label: 'No-show' },
                ]}
                className="w-36"
              />

              {/* Date Filter */}
              <Select
                value={sessionDateFilter}
                onChange={e => setSessionDateFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Dates' },
                  { value: 'today', label: 'Today' },
                  { value: 'upcoming', label: 'Upcoming' },
                  { value: 'past', label: 'Past' },
                ]}
                className="w-32"
              />

              {(sessionSearch || sessionStatusFilter !== 'all' || sessionDateFilter !== 'all') && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={RotateCcw}
                  onClick={() => {
                    setSessionSearch('');
                    setSessionStatusFilter('all');
                    setSessionDateFilter('all');
                  }}
                  className="text-xs"
                >
                  Reset
                </Button>
              )}

              <Button
                size="sm"
                icon={Plus}
                onClick={() => {
                  setSchedulingForMember(null);
                  setShowScheduleModal(true);
                }}
              >
                Schedule Session
              </Button>
            </div>
          </div>

          {/* Sessions Table */}
          <div className="overflow-x-auto border border-[#E1E6E9] rounded-xl bg-white">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E1E6E9] bg-[#F5F7F8]/60">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64717B] uppercase tracking-wider">Session ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64717B] uppercase tracking-wider">Date & Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64717B] uppercase tracking-wider">Member</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64717B] uppercase tracking-wider hidden sm:table-cell">Trainer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64717B] uppercase tracking-wider hidden md:table-cell">Notes</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#64717B] uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[#64717B] uppercase tracking-wider">Action / Update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E6E9]">
                {filteredSessions.map(s => {
                  const client = ptClients.find(c => c.memberId === s.memberId);
                  const hasRemaining = client ? Number(client.remainingSessions) > 0 : true;

                  return (
                    <tr key={s.id} className="hover:bg-[#F5F7F8]/80 transition-colors">
                      {/* Session ID */}
                      <td className="px-4 py-3 text-xs font-mono font-bold text-[#16845B]">
                        {s.id}
                      </td>

                      {/* Date & Time */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock size={13} className="text-[#64717B]" />
                          <div>
                            <p className="text-xs font-semibold text-[#25313B]">{s.date}</p>
                            <p className="text-[11px] text-[#64717B]">{s.time}</p>
                          </div>
                        </div>
                      </td>

                      {/* Member */}
                      <td className="px-4 py-3">
                        <button
                          onClick={() => s.memberId && navigate(`/members/${s.memberId}`)}
                          className="text-sm font-semibold text-[#25313B] hover:text-[#16845B] cursor-pointer text-left block"
                        >
                          {s.memberName}
                        </button>
                        <span className="text-[11px] font-mono text-[#64717B]">{s.memberId}</span>
                      </td>

                      {/* Trainer */}
                      <td className="px-4 py-3 text-sm text-[#25313B] hidden sm:table-cell">
                        {s.trainer || 'Coach Pravin Joshi'}
                      </td>

                      {/* Notes */}
                      <td className="px-4 py-3 text-xs text-[#64717B] hidden md:table-cell max-w-xs truncate">
                        {s.notes || '—'}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <StatusBadge status={s.status} />
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {s.status === 'scheduled' && (
                            <>
                              <Button
                                size="sm"
                                variant="primary"
                                icon={Check}
                                onClick={() => handleMarkCompleted(s)}
                                disabled={!hasRemaining}
                                className="text-xs h-7 px-2.5 bg-[#16845B] hover:bg-[#12704D]"
                                title={hasRemaining ? "Mark session Completed (deducts 1 session)" : "No sessions remaining in package"}
                              >
                                Complete
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                icon={X}
                                onClick={() => handleMarkCancelled(s)}
                                className="text-xs h-7 px-2 text-[#64717B] hover:text-[#B42318]"
                                title="Cancel session (does not deduct sessions)"
                              >
                                Cancel
                              </Button>
                            </>
                          )}

                          {s.status === 'completed' && (
                            <span className="text-xs text-[#16845B] font-medium flex items-center gap-1 mr-1">
                              <CheckCircle2 size={13} /> Completed
                            </span>
                          )}

                          {s.status === 'cancelled' && (
                            <span className="text-xs text-[#64717B] font-medium flex items-center gap-1 mr-1">
                              <XCircle size={13} /> Cancelled
                            </span>
                          )}

                          {s.status === 'no-show' && (
                            <span className="text-xs text-[#A66A00] font-medium flex items-center gap-1 mr-1">
                              <AlertCircle size={13} /> No-show
                            </span>
                          )}

                          <button
                            onClick={() => setEditingSession(s)}
                            className="p-1 rounded-lg hover:bg-[#F5F7F8] text-[#64717B] hover:text-[#25313B] cursor-pointer"
                            title="Edit / Correct Session"
                          >
                            <Edit2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredSessions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12">
                      <EmptyState
                        icon={Calendar}
                        title="No sessions found"
                        description={
                          sessionSearch || sessionStatusFilter !== 'all' || sessionDateFilter !== 'all'
                            ? "Try adjusting your search criteria or date filter."
                            : "No personal training sessions recorded yet."
                        }
                        action={
                          <Button
                            variant="primary"
                            size="sm"
                            icon={Plus}
                            onClick={() => {
                              setSchedulingForMember(null);
                              setShowScheduleModal(true);
                            }}
                          >
                            Schedule First Session
                          </Button>
                        }
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      id: 'packages',
      label: 'Packages & Pricing',
      content: (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#64717B]">
              Standard personal training packages offered at The Fitness House. Select a package to quickly assign it to a gym member.
            </p>
            <Badge variant="accent">3 Active Packages</Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {PT_PACKAGES.map(pkg => (
              <Card key={pkg.id} className="text-center hover:border-[#16845B]/40 transition-all flex flex-col justify-between p-6">
                <div>
                  <div className="p-3 w-14 h-14 mx-auto rounded-2xl bg-[#E8F5EE] text-[#16845B] flex items-center justify-center mb-4">
                    <Dumbbell size={28} />
                  </div>
                  <h3 className="text-xl font-bold text-[#25313B]">{pkg.name}</h3>
                  <p className="text-3xl font-extrabold text-[#16845B] mt-2">{formatINR(pkg.price)}</p>
                  <div className="mt-4 py-3 border-y border-[#E1E6E9] space-y-1.5 text-xs text-[#64717B]">
                    <p className="font-semibold text-[#25313B]">{pkg.sessions} Personal Training Sessions</p>
                    <p>{pkg.validity} Days Package Validity</p>
                    <p>Dedicated 1-on-1 Coach Pravin Joshi Guidance</p>
                  </div>
                </div>

                <div className="mt-6 pt-2">
                  <Button
                    variant="primary"
                    className="w-full"
                    icon={Plus}
                    onClick={() => handleQuickAssignPackage(pkg)}
                  >
                    Assign This Package
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: 'progress',
      label: 'Trainer & Progress',
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Trainer Roster</CardTitle>
                <CardDescription>Certified personal trainers at The Fitness House</CardDescription>
              </CardHeader>
              <div className="p-4 rounded-xl border border-[#E1E6E9] bg-[#F5F7F8]/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#16845B] text-white flex items-center justify-center font-bold text-base">
                    PJ
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[#25313B]">Coach Pravin Joshi</h4>
                    <p className="text-xs text-[#64717B]">Head Coach & Owner · Strength & Conditioning</p>
                    <p className="text-[11px] text-[#16845B] font-medium mt-0.5">
                      {activeClients.filter(c => (c.trainer || 'Coach Pravin Joshi').includes('Pravin')).length} Active Clients
                    </p>
                  </div>
                </div>
                <Badge variant="success">On Duty</Badge>
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>PT Operational Metrics</CardTitle>
                <CardDescription>Session delivery & completion efficiency</CardDescription>
              </CardHeader>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#64717B]">Total PT Sessions Logged:</span>
                  <span className="font-bold text-[#25313B]">{ptSessions.length}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#64717B]">Completion Rate:</span>
                  <span className="font-bold text-[#16845B]">
                    {ptSessions.length > 0
                      ? `${Math.round((completedSessions.length / ptSessions.length) * 100)}%`
                      : '0%'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#64717B]">Total PT Revenue Collected:</span>
                  <span className="font-bold text-[#16845B]">{formatINR(ptRevenue)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#64717B]">Active PT Client Roster:</span>
                  <span className="font-bold text-[#25313B]">{activeClients.length} members</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Personal Training Hub"
        description="Manage trainer assignments, active PT packages, session tracking ledgers, and package renewals."
        badge={<Badge variant="success">{activeClients.length} Active Clients</Badge>}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              icon={Calendar}
              onClick={() => {
                setSchedulingForMember(null);
                setShowScheduleModal(true);
              }}
            >
              Schedule Session
            </Button>
            <Button icon={Plus} onClick={() => { setPreselectedPackage(null); setShowAssignModal(true); }}>
              Assign PT Package
            </Button>
          </div>
        }
      />

      {/* Success / Notification Banner */}
      {notice && (
        <div className="p-3.5 rounded-xl bg-[#E8F5EE] border border-[#16845B]/25 text-[#16845B] text-xs font-semibold flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} />
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice(null)} className="hover:text-[#12704D] cursor-pointer">✕</button>
        </div>
      )}

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          icon={Users}
          label="Active PT Clients"
          value={activeClients.length}
          subtitle="Currently enrolled"
          variant="accent"
        />
        <KPICard
          icon={Calendar}
          label="Sessions Today"
          value={todaySessions.length}
          subtitle={`${todaySessions.filter(s => s.status === 'completed').length} completed`}
          variant="accent"
        />
        <KPICard
          icon={CheckCircle}
          label="Sessions Completed"
          value={completedSessions.length}
          subtitle="Total delivered"
          variant="default"
        />
        <KPICard
          icon={IndianRupee}
          label="PT Revenue"
          value={formatINR(ptRevenue)}
          subtitle="From PT payments"
          variant="accent"
        />
        <KPICard
          icon={AlertTriangle}
          label="Ending Soon"
          value={endingSoonClients.length}
          subtitle="≤3 sessions or ≤5 days"
          variant={endingSoonClients.length > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* Main Tabs Card */}
      <Card>
        <Tabs tabs={tabs} defaultTab={activeTab} />
      </Card>

      {/* Modals */}
      {showAssignModal && (
        <AssignPtModal
          isOpen={showAssignModal}
          onClose={() => {
            setShowAssignModal(false);
            setPreselectedPackage(null);
          }}
          members={members}
          preselectedPackage={preselectedPackage}
          onSave={(clientData, paymentData) => {
            addPtClient(clientData, paymentData);
            setShowAssignModal(false);
            setPreselectedPackage(null);
            setNotice(`PT package "${clientData.package}" successfully assigned to ${clientData.memberName}!`);
            setTimeout(() => setNotice(null), 6000);
          }}
        />
      )}

      {editingClient && (
        <EditPtModal
          isOpen={Boolean(editingClient)}
          onClose={() => setEditingClient(null)}
          client={editingClient}
          onSave={(memberId, updates) => {
            updatePtClient(memberId, updates);
            setEditingClient(null);
            setNotice(`PT assignment for ${editingClient.memberName} updated successfully.`);
            setTimeout(() => setNotice(null), 5000);
          }}
        />
      )}

      {showScheduleModal && (
        <ScheduleSessionModal
          isOpen={showScheduleModal}
          onClose={() => {
            setShowScheduleModal(false);
            setSchedulingForMember(null);
          }}
          ptClients={ptClients}
          preselectedClient={schedulingForMember}
          onSave={(sessionData) => {
            addPtSession(sessionData);
            setShowScheduleModal(false);
            setSchedulingForMember(null);
            setNotice(`Session scheduled for ${sessionData.memberName} on ${sessionData.date} at ${sessionData.time}!`);
            setTimeout(() => setNotice(null), 5000);
          }}
        />
      )}

      {editingSession && (
        <EditSessionModal
          isOpen={Boolean(editingSession)}
          onClose={() => setEditingSession(null)}
          session={editingSession}
          onSave={(sessionId, updates) => {
            updatePtSession(sessionId, updates);
            setEditingSession(null);
            setNotice(`Session ${sessionId} updated successfully.`);
            setTimeout(() => setNotice(null), 5000);
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Modal 1: Assign PT Package Modal
// ============================================================================
function AssignPtModal({ isOpen, onClose, members, preselectedPackage, onSave }) {
  const today = getLocalDateString();
  const defaultPkg = preselectedPackage || PT_PACKAGES[0];

  const [form, setForm] = useState({
    memberId: '',
    packageId: defaultPkg.id,
    package: defaultPkg.name,
    totalSessions: defaultPkg.sessions,
    trainer: 'Coach Pravin Joshi',
    startDate: today,
    validTill: calculateExpiryDate(today, defaultPkg.validity),
    recordPayment: true,
    paymentAmount: String(defaultPkg.price),
    paymentMethod: 'Cash',
    notes: '',
  });

  const [errors, setErrors] = useState({});

  // When preselected package changes
  useEffect(() => {
    if (preselectedPackage) {
      setForm(prev => ({
        ...prev,
        packageId: preselectedPackage.id,
        package: preselectedPackage.name,
        totalSessions: preselectedPackage.sessions,
        validTill: calculateExpiryDate(prev.startDate || today, preselectedPackage.validity),
        paymentAmount: String(preselectedPackage.price),
      }));
    }
  }, [preselectedPackage]);

  const handlePackageChange = (pkgId) => {
    const pkg = PT_PACKAGES.find(p => p.id === pkgId);
    if (pkg) {
      setForm(prev => ({
        ...prev,
        packageId: pkg.id,
        package: pkg.name,
        totalSessions: pkg.sessions,
        validTill: calculateExpiryDate(prev.startDate || today, pkg.validity),
        paymentAmount: String(pkg.price),
      }));
    }
  };

  const handleStartDateChange = (newStartDate) => {
    const pkg = PT_PACKAGES.find(p => p.id === form.packageId);
    const validity = pkg ? pkg.validity : 30;
    setForm(prev => ({
      ...prev,
      startDate: newStartDate,
      validTill: calculateExpiryDate(newStartDate, validity),
    }));
  };

  const validate = () => {
    const errs = {};
    if (!form.memberId) errs.memberId = 'Please select a gym member';
    if (!form.trainer.trim()) errs.trainer = 'Trainer name is required';
    if (!form.startDate) errs.startDate = 'Start date is required';
    if (!form.validTill) errs.validTill = 'Validity date is required';
    if (form.startDate && form.validTill && form.validTill < form.startDate) {
      errs.validTill = 'Validity date cannot be before start date';
    }
    if (Number(form.totalSessions) < 1) {
      errs.totalSessions = 'Sessions must be at least 1';
    }
    if (form.recordPayment) {
      const amt = Number(form.paymentAmount);
      if (!form.paymentAmount || isNaN(amt) || amt <= 0) {
        errs.paymentAmount = 'Enter a valid payment amount';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    const member = members.find(m => m.id === form.memberId);
    const clientData = {
      memberId: form.memberId,
      memberName: member?.name || 'Member',
      packageId: form.packageId,
      package: form.package,
      totalSessions: Number(form.totalSessions),
      completedSessions: 0,
      remainingSessions: Number(form.totalSessions),
      startDate: form.startDate,
      validTill: form.validTill,
      trainer: form.trainer.trim(),
      status: 'active',
    };

    const paymentData = form.recordPayment
      ? {
          amount: Number(form.paymentAmount),
          method: form.paymentMethod,
          notes: form.notes,
        }
      : null;

    onSave(clientData, paymentData);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Assign Personal Training Package"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            Confirm Assignment
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Member Selection */}
        <Select
          label="Select Member *"
          value={form.memberId}
          onChange={e => {
            setForm(f => ({ ...f, memberId: e.target.value }));
            setErrors(prev => ({ ...prev, memberId: undefined }));
          }}
          error={errors.memberId}
          options={[
            { value: '', label: 'Choose gym member...' },
            ...members.map(m => ({
              value: m.id,
              label: `${m.name} (${m.id}) ${m.hasPT ? '• [Existing PT]' : ''}`,
            }))
          ]}
        />

        {/* Package & Trainer */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="PT Package *"
            value={form.packageId}
            onChange={e => handlePackageChange(e.target.value)}
            options={PT_PACKAGES.map(pkg => ({
              value: pkg.id,
              label: `${pkg.name} — ${formatINR(pkg.price)}`,
            }))}
          />
          <Input
            label="Assigned Trainer *"
            value={form.trainer}
            onChange={e => setForm(f => ({ ...f, trainer: e.target.value }))}
            error={errors.trainer}
            placeholder="e.g. Coach Pravin Joshi"
          />
        </div>

        {/* Total Sessions & Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input
            label="Total Sessions *"
            type="number"
            min="1"
            value={form.totalSessions}
            onChange={e => setForm(f => ({ ...f, totalSessions: e.target.value }))}
            error={errors.totalSessions}
          />
          <Input
            label="Start Date *"
            type="date"
            value={form.startDate}
            onChange={e => handleStartDateChange(e.target.value)}
            error={errors.startDate}
          />
          <Input
            label="Valid Till Date *"
            type="date"
            value={form.validTill}
            onChange={e => setForm(f => ({ ...f, validTill: e.target.value }))}
            error={errors.validTill}
          />
        </div>

        {/* Payment Integration Section */}
        <div className="pt-3 border-t border-[#E1E6E9]">
          <div className="flex items-center gap-2 mb-3">
            <input
              type="checkbox"
              id="recordPaymentCheck"
              checked={form.recordPayment}
              onChange={e => setForm(f => ({ ...f, recordPayment: e.target.checked }))}
              className="w-4 h-4 text-[#16845B] rounded border-[#CBD5E1] focus:ring-[#16845B]"
            />
            <label htmlFor="recordPaymentCheck" className="text-xs font-bold text-[#25313B] cursor-pointer">
              Record PT Package Payment Now
            </label>
          </div>

          {form.recordPayment && (
            <div className="p-3.5 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Payment Amount (₹) *"
                  type="number"
                  min="1"
                  value={form.paymentAmount}
                  onChange={e => setForm(f => ({ ...f, paymentAmount: e.target.value }))}
                  error={errors.paymentAmount}
                />
                <Select
                  label="Payment Method *"
                  value={form.paymentMethod}
                  onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}
                  options={[
                    { value: 'Cash', label: 'Cash' },
                    { value: 'UPI', label: 'UPI / QR' },
                    { value: 'Card', label: 'Debit / Credit Card' },
                  ]}
                />
              </div>
              <p className="text-[11px] text-[#16845B] font-medium">
                Payment will be logged in the payments ledger under "Personal Training" revenue without affecting regular gym membership balances.
              </p>
            </div>
          )}
        </div>

        {/* Notes */}
        <Textarea
          label="Optional Notes"
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          placeholder="Fitness goals, health considerations, schedule preferences..."
          rows={2}
        />
      </form>
    </Modal>
  );
}

// ============================================================================
// Modal 2: Edit PT Assignment Modal
// ============================================================================
function EditPtModal({ isOpen, onClose, client, onSave }) {
  const [form, setForm] = useState({
    trainer: client?.trainer || 'Coach Pravin Joshi',
    totalSessions: client?.totalSessions || 8,
    validTill: client?.validTill || '',
    status: client?.status || 'active',
    package: client?.package || '',
  });

  const [errors, setErrors] = useState({});

  const validate = () => {
    const errs = {};
    if (!form.trainer.trim()) errs.trainer = 'Trainer name is required';
    if (!form.validTill) errs.validTill = 'Valid till date is required';
    const total = Number(form.totalSessions);
    const completed = Number(client?.completedSessions || 0);
    if (isNaN(total) || total < 1) {
      errs.totalSessions = 'Total sessions must be at least 1';
    } else if (total < completed) {
      errs.totalSessions = `Total sessions cannot be less than completed sessions (${completed})`;
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    onSave(client.memberId, {
      trainer: form.trainer.trim(),
      totalSessions: Number(form.totalSessions),
      validTill: form.validTill,
      status: form.status,
      package: form.package.trim() || client.package,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit PT Assignment — ${client?.memberName}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            Save Changes
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 bg-[#E8F5EE] border border-[#16845B]/20 rounded-xl text-xs space-y-1">
          <p className="font-bold text-[#16845B]">{client?.memberName} ({client?.memberId})</p>
          <p className="text-[#25313B]">
            Currently completed: <span className="font-bold">{client?.completedSessions}</span> sessions | Remaining: <span className="font-bold">{client?.remainingSessions}</span>
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Package Name"
            value={form.package}
            onChange={e => setForm(f => ({ ...f, package: e.target.value }))}
          />
          <Input
            label="Assigned Trainer *"
            value={form.trainer}
            onChange={e => setForm(f => ({ ...f, trainer: e.target.value }))}
            error={errors.trainer}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Total Sessions *"
            type="number"
            min={client?.completedSessions || 1}
            value={form.totalSessions}
            onChange={e => setForm(f => ({ ...f, totalSessions: e.target.value }))}
            error={errors.totalSessions}
          />
          <Input
            label="Valid Till Date *"
            type="date"
            value={form.validTill}
            onChange={e => setForm(f => ({ ...f, validTill: e.target.value }))}
            error={errors.validTill}
          />
        </div>

        <Select
          label="Assignment Status"
          value={form.status}
          onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'completed', label: 'Completed' },
            { value: 'expired', label: 'Expired' },
          ]}
        />
      </form>
    </Modal>
  );
}

// ============================================================================
// Modal 3: Schedule PT Session Modal
// ============================================================================
function ScheduleSessionModal({ isOpen, onClose, ptClients, preselectedClient, onSave }) {
  const today = getLocalDateString();
  const activeClients = ptClients.filter(c => c.status === 'active' && Number(c.remainingSessions) > 0);
  const initialClient = preselectedClient || activeClients[0] || null;

  const [form, setForm] = useState({
    memberId: initialClient ? initialClient.memberId : '',
    trainer: initialClient ? (initialClient.trainer || 'Coach Pravin Joshi') : 'Coach Pravin Joshi',
    date: today,
    time: '07:00 AM',
    status: 'scheduled',
    notes: '',
  });

  const [errors, setErrors] = useState({});

  const handleMemberChange = (memberId) => {
    const cl = activeClients.find(c => c.memberId === memberId);
    setForm(prev => ({
      ...prev,
      memberId,
      trainer: cl ? (cl.trainer || 'Coach Pravin Joshi') : prev.trainer,
    }));
  };

  const validate = () => {
    const errs = {};
    if (!form.memberId) errs.memberId = 'Please select a PT client';
    if (!form.date) errs.date = 'Date is required';
    if (!form.time) errs.time = 'Time is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    const cl = ptClients.find(c => c.memberId === form.memberId);
    onSave({
      memberId: form.memberId,
      memberName: cl ? cl.memberName : 'Member',
      trainer: form.trainer,
      date: form.date,
      time: form.time,
      status: form.status,
      notes: form.notes,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Schedule Training Session"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            Schedule Session
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {activeClients.length === 0 ? (
          <div className="p-4 bg-[#FFF2D8] border border-[#A66A00]/25 rounded-xl text-xs text-[#25313B]">
            <p className="font-bold text-[#A66A00]">No Active PT Clients with Remaining Sessions</p>
            <p className="mt-1">All clients have either completed their sessions or are expired. Please assign a new PT package first.</p>
          </div>
        ) : (
          <>
            <Select
              label="Select PT Client *"
              value={form.memberId}
              onChange={e => handleMemberChange(e.target.value)}
              error={errors.memberId}
              options={[
                { value: '', label: 'Select client...' },
                ...activeClients.map(c => ({
                  value: c.memberId,
                  label: `${c.memberName} (${c.remainingSessions} sessions left) — ${c.trainer || 'Coach Pravin Joshi'}`,
                }))
              ]}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Date *"
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                error={errors.date}
              />
              <Select
                label="Time Slot *"
                value={form.time}
                onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                options={[
                  { value: '06:00 AM', label: '06:00 AM' },
                  { value: '07:00 AM', label: '07:00 AM' },
                  { value: '08:00 AM', label: '08:00 AM' },
                  { value: '09:00 AM', label: '09:00 AM' },
                  { value: '10:00 AM', label: '10:00 AM' },
                  { value: '05:00 PM', label: '05:00 PM' },
                  { value: '06:00 PM', label: '06:00 PM' },
                  { value: '07:00 PM', label: '07:00 PM' },
                  { value: '08:00 PM', label: '08:00 PM' },
                ]}
              />
            </div>

            <Input
              label="Trainer *"
              value={form.trainer}
              onChange={e => setForm(f => ({ ...f, trainer: e.target.value }))}
              placeholder="e.g. Coach Pravin Joshi"
            />

            <Input
              label="Workout Focus / Notes"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. Chest & Triceps, Leg day, Core conditioning..."
            />

            <p className="text-[11px] text-[#64717B]">
              Scheduling a session does not deduct from remaining sessions. Sessions are deducted only when marked Completed.
            </p>
          </>
        )}
      </form>
    </Modal>
  );
}

// ============================================================================
// Modal 4: Edit Session Record Modal
// ============================================================================
function EditSessionModal({ isOpen, onClose, session, onSave }) {
  const [form, setForm] = useState({
    date: session?.date || '',
    time: session?.time || '',
    trainer: session?.trainer || 'Coach Pravin Joshi',
    status: session?.status || 'scheduled',
    notes: session?.notes || '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(session.id, {
      date: form.date,
      time: form.time,
      trainer: form.trainer,
      status: form.status,
      notes: form.notes,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit Session — ${session?.id} (${session?.memberName})`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            Save Changes
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Date"
            type="date"
            value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
          />
          <Input
            label="Time"
            value={form.time}
            onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Trainer"
            value={form.trainer}
            onChange={e => setForm(f => ({ ...f, trainer: e.target.value }))}
          />
          <Select
            label="Status"
            value={form.status}
            onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
            options={[
              { value: 'scheduled', label: 'Scheduled' },
              { value: 'completed', label: 'Completed' },
              { value: 'cancelled', label: 'Cancelled' },
              { value: 'no-show', label: 'No-show' },
            ]}
          />
        </div>

        <Textarea
          label="Notes / Workout Summary"
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          rows={3}
        />

        <p className="text-[11px] text-[#64717B] bg-[#F5F7F8] p-2.5 rounded-lg border border-[#E1E6E9]">
          Note: Transitioning status to "Completed" automatically decrements the member's remaining sessions by 1. Changing away from "Completed" restores the session count.
        </p>
      </form>
    </Modal>
  );
}
