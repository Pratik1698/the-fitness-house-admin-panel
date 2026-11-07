import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge, Badge } from '../components/ui/Badge';
import { Tabs } from '../components/ui/Tabs';
import { getLocalDateString, getExpiryClassification, formatINR } from '../utils/memberUtils';
import {
  Clock, XCircle, CreditCard, Dumbbell, PhoneCall,
  ArrowRight, AlertTriangle, CheckCircle2, RotateCw
} from 'lucide-react';

export default function Attention() {
  const navigate = useNavigate();
  const { members, ptClients, followups, isAdmin } = useApp();

  const todayStr = useMemo(() => getLocalDateString(), []);

  // Classify members using shared getExpiryClassification
  const expiringMembers = useMemo(() => {
    return members
      .map(m => ({ ...m, cls: getExpiryClassification(m, todayStr) }))
      .filter(m => m.cls.tier === 'expiring_3d' || m.cls.tier === 'expiring_5d')
      .sort((a, b) => a.cls.daysLeft - b.cls.daysLeft);
  }, [members, todayStr]);

  const expiredMembers = useMemo(() => {
    return members
      .map(m => ({ ...m, cls: getExpiryClassification(m, todayStr) }))
      .filter(m => m.cls.tier === 'expired')
      .sort((a, b) => {
        const timeA = a.expiryDate ? new Date(a.expiryDate).getTime() : NaN;
        const timeB = b.expiryDate ? new Date(b.expiryDate).getTime() : NaN;
        const validA = !Number.isNaN(timeA);
        const validB = !Number.isNaN(timeB);

        // If both are valid dates, sort descending (most recently expired first)
        if (validA && validB) {
          return timeB - timeA;
        }
        // Place valid dates before missing/invalid dates
        if (validA && !validB) return -1;
        if (!validA && validB) return 1;
        // Both are missing or invalid: preserve deterministic stability
        return 0;
      });
  }, [members, todayStr]);

  const pendingPayments = useMemo(() => {
    return members
      .filter(m => Number(m.balance) > 0)
      .sort((a, b) => Number(b.balance) - Number(a.balance));
  }, [members]);

  const ptEnding = useMemo(() => {
    return ptClients
      .filter(c => c.status === 'active' && Number(c.remainingSessions) <= 3)
      .sort((a, b) => Number(a.remainingSessions) - Number(b.remainingSessions));
  }, [ptClients]);

  const followupsDue = useMemo(() => {
    const validMemberIds = new Set(members.map(m => m.id));
    return followups
      .filter(f => f.status !== 'completed' && f.status !== 'cancelled' && (validMemberIds.size === 0 || validMemberIds.has(f.memberId)))
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  }, [followups, members]);

  const totalActionItems =
    expiringMembers.length +
    expiredMembers.length +
    (isAdmin ? pendingPayments.length : 0) +
    ptEnding.length +
    followupsDue.length;

  const tabs = [
    {
      id: 'expiring',
      label: 'Expiring Soon',
      count: expiringMembers.length,
      content: (
        <div className="space-y-2">
          {expiringMembers.length > 0 ? (
            expiringMembers.map(m => {
              const isUrgent = m.cls.tier === 'expiring_3d';
              return (
                <div
                  key={m.id}
                  className={`flex items-center justify-between p-3.5 rounded-xl border transition-colors ${
                    isUrgent
                      ? 'bg-[#FFF2D8] border-[#A66A00]/25'
                      : 'bg-[#F5F7F8] border-[#E1E6E9]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold ${
                      isUrgent ? 'bg-[#A66A00] text-white' : 'bg-white border border-[#E1E6E9] text-[#25313B]'
                    }`}>
                      {m.cls.daysLeft}d
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/members/${m.id}`)}
                          className="text-sm font-semibold text-[#25313B] hover:text-[#16845B] cursor-pointer"
                        >
                          {m.name}
                        </button>
                        <span className="text-xs font-mono text-[#64717B]">({m.id})</span>
                        {isUrgent && (
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#FCE9E9] text-[#B42318] border border-[#B42318]/20">
                            Urgent (≤3d)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#64717B] mt-0.5">
                        {m.plan} • {m.cls.label} (Expiry: {m.expiryDate})
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      icon={RotateCw}
                      onClick={() => navigate(`/members/${m.id}?renew=true`)}
                      className="text-xs h-8"
                    >
                      Renew
                    </Button>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-[#64717B] py-8 text-center">No memberships expiring within 5 days.</p>
          )}
        </div>
      ),
    },
    {
      id: 'expired',
      label: 'Expired',
      count: expiredMembers.length,
      content: (
        <div className="space-y-2">
          {expiredMembers.length > 0 ? (
            expiredMembers.map(m => {
              const displayDate = m.expiryDate && !Number.isNaN(new Date(m.expiryDate).getTime())
                ? m.expiryDate
                : 'N/A';
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-3.5 rounded-xl border border-[#B42318]/20 bg-[#FCE9E9]/40"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#B42318] text-white flex items-center justify-center text-xs font-bold">
                      EXP
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/members/${m.id}`)}
                          className="text-sm font-semibold text-[#25313B] hover:text-[#16845B] cursor-pointer"
                        >
                          {m.name}
                        </button>
                        <span className="text-xs font-mono text-[#64717B]">({m.id})</span>
                      </div>
                      <p className="text-xs text-[#B42318] font-medium mt-0.5">
                        {m.cls.label} ({m.plan}) • Expired on {displayDate}
                      </p>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    icon={RotateCw}
                    onClick={() => navigate(`/members/${m.id}?renew=true`)}
                    className="text-xs h-8"
                  >
                    Renew
                  </Button>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-[#64717B] py-8 text-center">No expired memberships.</p>
          )}
        </div>
      ),
    },
    {
      id: 'payments',
      label: 'Pending Dues',
      count: isAdmin ? pendingPayments.length : '—',
      content: (
        <div className="space-y-2">
          {!isAdmin ? (
            <div className="py-8 text-center space-y-2">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#FFF2D8] text-[#A66A00] mb-1">
                <CreditCard size={20} />
              </div>
              <p className="text-sm font-semibold text-[#25313B]">Financial Access Restricted</p>
              <p className="text-xs text-[#64717B] max-w-sm mx-auto">
                Member liability and dues balances are restricted to administrators. Contact an administrator to review outstanding payments.
              </p>
            </div>
          ) : pendingPayments.length > 0 ? (
            pendingPayments.map(m => (
              <div
                key={m.id}
                className="flex items-center justify-between p-3.5 rounded-xl border border-[#A66A00]/20 bg-[#FFF2D8]/40"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#A66A00] text-white flex items-center justify-center text-xs font-bold">
                    ₹
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/members/${m.id}`)}
                        className="text-sm font-semibold text-[#25313B] hover:text-[#16845B] cursor-pointer"
                      >
                        {m.name}
                      </button>
                      <span className="text-xs font-mono text-[#64717B]">({m.id})</span>
                    </div>
                    <p className="text-xs text-[#64717B] mt-0.5">
                      Balance Due:{' '}
                      <strong className="text-[#A66A00] tabular-nums font-bold">
                        {formatINR(m.balance)}
                      </strong>{' '}
                      • {m.plan}
                    </p>
                  </div>
                </div>

                <Button
                  size="sm"
                  icon={CreditCard}
                  onClick={() => navigate(`/payments?record=true&memberId=${m.id}`)}
                  className="text-xs h-8"
                >
                  Collect Dues
                </Button>
              </div>
            ))
          ) : (
            <p className="text-sm text-[#64717B] py-8 text-center">No pending dues.</p>
          )}
        </div>
      ),
    },
    {
      id: 'pt',
      label: 'PT Ending',
      count: ptEnding.length,
      content: (
        <div className="space-y-2">
          {ptEnding.length > 0 ? (
            ptEnding.map(c => (
              <div
                key={`${c.memberId}-${c.packageId || c.package}`}
                className="flex items-center justify-between p-3.5 rounded-xl border border-[#A66A00]/20 bg-[#FFF2D8]/40"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#16845B] text-white flex items-center justify-center text-xs font-bold">
                    {c.remainingSessions}s
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/members/${c.memberId}`)}
                        className="text-sm font-semibold text-[#25313B] hover:text-[#16845B] cursor-pointer"
                      >
                        {c.memberName}
                      </button>
                      <span className="text-xs font-mono text-[#64717B]">({c.memberId})</span>
                    </div>
                    <p className="text-xs text-[#64717B] mt-0.5">
                      {c.package} •{' '}
                      <strong className="text-[#A66A00] font-semibold">
                        {c.remainingSessions} session{c.remainingSessions === 1 ? '' : 's'} remaining
                      </strong>{' '}
                      (Trainer: {c.trainer || 'Coach Pravin Joshi'})
                    </p>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(`/members/${c.memberId}`)}
                  className="text-xs h-8"
                >
                  Profile <ArrowRight size={14} />
                </Button>
              </div>
            ))
          ) : (
            <p className="text-sm text-[#64717B] py-8 text-center">No PT packages ending soon.</p>
          )}
        </div>
      ),
    },
    {
      id: 'followups',
      label: 'Follow-ups Due',
      count: followupsDue.length,
      content: (
        <div className="space-y-2">
          {followupsDue.length > 0 ? (
            followupsDue.map(f => {
              const isOverdue = f.status === 'overdue' || (f.dueDate < todayStr && f.status !== 'completed');
              return (
                <div
                  key={f.id}
                  className={`flex items-center justify-between p-3.5 rounded-xl border transition-colors ${
                    isOverdue
                      ? 'bg-[#FCE9E9]/40 border-[#B42318]/20'
                      : 'bg-white border-[#E1E6E9]'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[#25313B]">{f.memberName}</span>
                      <span className="text-xs font-mono text-[#64717B]">({f.memberId})</span>
                      <StatusBadge status={isOverdue ? 'overdue' : f.status} />
                    </div>
                    <p className="text-xs text-[#64717B] mt-0.5">
                      {f.reason} • Due: <strong className={isOverdue ? 'text-[#B42318]' : 'text-[#25313B]'}>{f.dueDate}</strong>
                    </p>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/followups')}
                    className="text-xs h-8"
                  >
                    View in Queue <ArrowRight size={14} />
                  </Button>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-[#64717B] py-8 text-center">No follow-ups due.</p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attention Required Center"
        description="Daily operational alerts: expiring passes, overdue balances, ending PT packages, and follow-ups."
        badge={<Badge variant="warning">{totalActionItems} Action Items</Badge>}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <SummaryCard icon={Clock} label="Expiring" count={expiringMembers.length} color="warning" />
        <SummaryCard icon={XCircle} label="Expired" count={expiredMembers.length} color="error" />
        <SummaryCard icon={CreditCard} label="Pending Dues" count={isAdmin ? pendingPayments.length : '—'} color="warning" />
        <SummaryCard icon={Dumbbell} label="PT Ending" count={ptEnding.length} color="default" />
        <SummaryCard icon={PhoneCall} label="Follow-ups" count={followupsDue.length} color="default" />
      </div>

      <Card>
        <Tabs tabs={tabs} defaultTab="expiring" />
      </Card>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, count, color }) {
  const colors = {
    warning: 'bg-[#FFF2D8] text-[#A66A00]',
    error: 'bg-[#FCE9E9] text-[#B42318]',
    default: 'bg-[#F5F7F8] text-[#64717B]',
  };
  return (
    <div className="bg-white border border-[#E1E6E9] rounded-xl p-3.5 flex items-center gap-3 shadow-xs">
      <div className={`p-2 rounded-lg ${colors[color]}`}><Icon size={18} /></div>
      <div>
        <p className="text-xl font-bold text-[#25313B] leading-none">{count}</p>
        <p className="text-xs text-[#64717B] mt-1">{label}</p>
      </div>
    </div>
  );
}
