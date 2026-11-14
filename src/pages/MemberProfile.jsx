import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Card, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Tabs } from '../components/ui/Tabs';
import { RenewMembershipModal } from '../components/shared/RenewMembershipModal';
import { EditMemberModal } from '../components/shared/EditMemberModal';
import { PaymentReceiptModal } from '../components/shared/PaymentReceiptModal';
import { WhatsAppConfirmationModal } from '../components/shared/WhatsAppConfirmationModal';
import {
  getMembershipStatus,
  getDaysDifference,
  getLocalDateString,
  getMemberInitials,
} from '../utils/memberUtils';
import {
  ArrowLeft, LogIn, IndianRupee, RotateCw, Edit3,
  User, Calendar, CreditCard, Activity, Phone, Mail, MapPin, CheckCircle2,
  Printer, MessageSquare
} from 'lucide-react';

export default function MemberProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    members,
    payments,
    checkins,
    ptClients,
    ptSessions,
    followups,
    addCheckin,
    checkoutMember,
    isAdmin,
    membershipPlans = [],
  } = useApp();
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [selectedReceiptPayment, setSelectedReceiptPayment] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (searchParams.get('renew') === 'true') {
      setShowRenewModal(true);
    }
  }, [searchParams]);

  const member = members.find(m => m.id === id || m.member_code === id);
  if (!member) {
    return (
      <div className="text-center py-20">
        <p className="text-lg text-[#64717B]">Member not found.</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/members')}>
          <ArrowLeft size={16} /> Back to Members
        </Button>
      </div>
    );
  }

  const todayStr = getLocalDateString();
  const memberPayments = payments.filter(p => p.memberId === id || (member && (p.memberId === member.id || p.memberId === member.member_code)));
  const memberCheckins = checkins.filter(c => c.memberId === id || (member && (c.memberId === member.id || c.memberId === member.member_code)));
  const memberPT = ptClients.filter(c => c.memberId === id || (member && (c.memberId === member.id || c.memberId === member.member_code)));
  const memberPTSessions = ptSessions.filter(s => s.memberId === id || (member && (s.memberId === member.id || s.memberId === member.member_code)));
  const memberFollowups = followups.filter(f => f.memberId === id || (member && (f.memberId === member.id || f.memberId === member.member_code)));

  const daysLeft = getDaysDifference(member.expiryDate, todayStr);
  const displayStatus = getMembershipStatus(member, todayStr);
  const isFinancialRestricted = !isAdmin || member.totalFee === null;

  const handleCheckin = async () => {
    if (displayStatus === 'expired') {
      setNotice('Cannot check in — membership has expired. Please renew first.');
      setTimeout(() => setNotice(null), 4000);
      return;
    }
    try {
      const res = await addCheckin({ memberId: member.id, memberName: member.name, plan: member.plan, status: 'valid' });
      setNotice(`${member.name} checked in successfully! Pass #${res?.checkin_code || res?.id || ''}`);
      setTimeout(() => setNotice(null), 4000);
    } catch (err) {
      setNotice(`Check-in failed: ${err.message}`);
      setTimeout(() => setNotice(null), 5000);
    }
  };

  const tabs = [
    {
      id: 'overview', label: 'Overview', content: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <InfoCard label="Membership Plan" value={member.plan} />
            <InfoCard label="Start Date" value={member.startDate} />
            <InfoCard label="Expiry Date" value={member.expiryDate} highlight={displayStatus !== 'active'} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <InfoCard
              label="Total Fee"
              value={isFinancialRestricted ? 'Financial information restricted' : `₹${member.totalFee?.toLocaleString() || '0'}`}
              restricted={isFinancialRestricted}
            />
            <InfoCard
              label="Amount Paid"
              value={isFinancialRestricted ? 'Financial information restricted' : `₹${member.amountPaid?.toLocaleString() || '0'}`}
              restricted={isFinancialRestricted}
            />
            <InfoCard
              label="Outstanding"
              value={isFinancialRestricted ? 'Financial information restricted' : (member.balance > 0 ? `₹${member.balance.toLocaleString()}` : '—')}
              error={!isFinancialRestricted && member.balance > 0}
              restricted={isFinancialRestricted}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <InfoCard label="Total Check-ins" value={memberCheckins.length || member.totalCheckins || 0} />
            <InfoCard label="Days Remaining" value={daysLeft > 0 ? daysLeft : 0} highlight={daysLeft <= 5} />
            <InfoCard label="Member Since" value={member.joinDate || member.startDate} />
          </div>
          {member.notes && (
            <Card className="bg-[#F5F7F8]">
              <p className="text-sm text-[#64717B]"><strong>Notes:</strong> {member.notes}</p>
            </Card>
          )}
        </div>
      )
    },
    {
      id: 'membership', label: 'Membership', content: (
        <div className="space-y-4">
          <Card>
            <CardTitle className="mb-3">Current Membership Subscription</CardTitle>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div><p className="text-xs text-[#64717B]">Plan</p><p className="text-sm font-semibold text-[#25313B]">{member.plan}</p></div>
              <div><p className="text-xs text-[#64717B]">Start Date</p><p className="text-sm font-medium text-[#25313B]">{member.startDate}</p></div>
              <div><p className="text-xs text-[#64717B]">Expiry Date</p><p className="text-sm font-medium text-[#25313B]">{member.expiryDate}</p></div>
              <div><p className="text-xs text-[#64717B]">Current Status</p><StatusBadge status={displayStatus} /></div>
            </div>
            {member.lastRenewalDate && (
              <p className="text-xs text-[#16845B] font-medium mt-3 pt-3 border-t border-[#E1E6E9]">
                Last renewed on: {member.lastRenewalDate}
              </p>
            )}
          </Card>
        </div>
      )
    },
    {
      id: 'payments', label: 'Payments', count: isAdmin ? memberPayments.length : undefined, content: (
        <div>
          {!isAdmin ? (
            <div className="py-8 text-center space-y-2">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#FFF2D8] text-[#A66A00] mb-1">
                <CreditCard size={20} />
              </div>
              <p className="text-sm font-semibold text-[#25313B]">Financial information restricted</p>
              <p className="text-xs text-[#64717B] max-w-sm mx-auto">
                Payment history and financial receipts are restricted to administrators. Contact an administrator to review payment records.
              </p>
            </div>
          ) : memberPayments.length > 0 ? (
            <div className="space-y-2">
              {memberPayments.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 bg-[#F5F7F8] rounded-xl border border-[#E1E6E9]">
                  <div>
                    <p className="text-sm font-semibold text-[#25313B]">₹{p.amount.toLocaleString()} — {p.category}</p>
                    <p className="text-xs text-[#64717B]">{p.date} · {p.method} {p.notes ? `· ${p.notes}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-[#64717B]">{p.id}</span>
                    <StatusBadge status={p.status} />
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={Printer}
                      onClick={() => setSelectedReceiptPayment(p)}
                      className="text-xs h-7 px-2"
                      title="View & Print Receipt"
                    >
                      Receipt
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-[#64717B] py-8 text-center">No payment records yet.</p>}
        </div>
      )
    },
    {
      id: 'checkins', label: 'Check-ins', count: memberCheckins.length, content: (
        <div>
          {memberCheckins.length > 0 ? (
            <div className="space-y-2">
              {memberCheckins.map(c => {
                const isInGym = !c.checkedOutAt && c.rawStatus !== 'checked_out';
                return (
                  <div key={c.id || c.checkinId} className="flex items-center justify-between p-3 bg-[#F5F7F8] rounded-xl border border-[#E1E6E9]">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-[#25313B]">{c.date}</p>
                        <span className="text-[11px] font-mono text-[#64717B]">#{c.checkinCode || c.id}</span>
                      </div>
                      <p className="text-xs text-[#64717B] mt-0.5">
                        In: {c.time} {c.checkedOutTime ? `· Out: ${c.checkedOutTime}` : isInGym ? '· Active in Gym' : ''}
                        {c.actorName ? ` · Logged by ${c.actorName}` : ''}
                      </p>
                    </div>
                    <div>
                      {isInGym ? (
                        <Badge variant="accent">In Gym</Badge>
                      ) : (
                        <StatusBadge status={c.status || 'valid'} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-sm text-[#64717B] py-8 text-center">No check-in records yet.</p>}
        </div>
      )
    },
    {
      id: 'pt', label: 'Personal Training', content: (
        <div className="space-y-4">
          {memberPT.length > 0 ? (
            <div className="space-y-4">
              {memberPT.map((pt, idx) => (
                <Card key={pt.packageId || idx}>
                  <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#E1E6E9]">
                    <div>
                      <h4 className="text-sm font-bold text-[#25313B]">{pt.package}</h4>
                      <p className="text-xs text-[#64717B]">Trainer: <span className="font-semibold text-[#25313B]">{pt.trainer || 'Coach Pravin Joshi'}</span></p>
                    </div>
                    <StatusBadge status={pt.status} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div><p className="text-[#64717B]">Start Date</p><p className="font-semibold text-[#25313B]">{pt.startDate || '—'}</p></div>
                    <div><p className="text-[#64717B]">Valid Till</p><p className="font-semibold text-[#25313B]">{pt.validTill || '—'}</p></div>
                    <div><p className="text-[#64717B]">Sessions Done</p><p className="font-bold text-[#16845B]">{pt.completedSessions} / {pt.totalSessions}</p></div>
                    <div>
                      <p className="text-[#64717B]">Sessions Left</p>
                      <p className={`font-bold ${pt.remainingSessions <= 3 ? 'text-[#A66A00]' : 'text-[#25313B]'}`}>{pt.remainingSessions}</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="h-2 bg-[#E1E6E9] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#16845B] rounded-full transition-all"
                        style={{ width: `${Math.min(100, (pt.completedSessions / (pt.totalSessions || 1)) * 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[11px] text-[#64717B] mt-1">
                      <span>{Math.round((pt.completedSessions / (pt.totalSessions || 1)) * 100)}% completed</span>
                      {pt.remainingSessions <= 3 && pt.status === 'active' && (
                        <span className="text-[#A66A00] font-medium">Ending soon · Renewal recommended</span>
                      )}
                    </div>
                  </div>
                </Card>
              ))}

              {/* Member's Session History */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-[#64717B] uppercase tracking-wider">Session Ledger</h4>
                  <button
                    onClick={() => navigate('/personal-training')}
                    className="text-xs font-semibold text-[#16845B] hover:underline cursor-pointer"
                  >
                    Manage in PT Hub →
                  </button>
                </div>
                {memberPTSessions.length > 0 ? (
                  <div className="space-y-2">
                    {memberPTSessions.map(s => (
                      <div key={s.id} className="flex items-center justify-between p-3 bg-[#F5F7F8] rounded-xl border border-[#E1E6E9]">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#E8F5EE] flex items-center justify-center text-[#16845B] text-xs font-bold">
                            PT
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-[#25313B]">{s.date} · {s.time}</p>
                            <p className="text-[11px] text-[#64717B]">Trainer: {s.trainer || 'Coach Pravin Joshi'} {s.notes ? `• ${s.notes}` : ''}</p>
                          </div>
                        </div>
                        <StatusBadge status={s.status} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#64717B] py-4 text-center bg-[#F5F7F8] rounded-xl">
                    No PT session records yet for this member.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-[#64717B] mb-3">No personal training packages assigned to this member.</p>
              <Button size="sm" onClick={() => navigate('/personal-training')}>
                Assign PT in PT Hub
              </Button>
            </div>
          )}
        </div>
      )
    },
    {
      id: 'activity', label: 'Activity', content: (
        <div className="space-y-2">
          {[...(isAdmin ? memberPayments.map(p => ({ type: 'payment', date: p.date, desc: `Payment ₹${p.amount.toLocaleString()} (${p.category})` })) : []),
            ...memberCheckins.map(c => ({ type: 'checkin', date: c.date, desc: `Checked in at ${c.time}` }))
          ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10).map((item, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-[#F5F7F8] rounded-xl border border-[#E1E6E9]">
              <div className="p-2 rounded-lg bg-[#E8F5EE] text-[#16845B]">
                {item.type === 'payment' ? <IndianRupee size={14} /> : <LogIn size={14} />}
              </div>
              <div className="flex-1">
                <p className="text-sm text-[#25313B] font-medium">{item.desc}</p>
                <p className="text-xs text-[#64717B]">{item.date}</p>
              </div>
            </div>
          ))}
          {(!isAdmin || memberPayments.length === 0) && memberCheckins.length === 0 && (
            <p className="text-sm text-[#64717B] py-8 text-center">No activity history yet.</p>
          )}
        </div>
      )
    },
  ];

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Button variant="ghost" onClick={() => navigate('/members')} className="-ml-2">
        <ArrowLeft size={16} /> Back to Members
      </Button>

      {/* Header */}
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-[#E8F5EE] border border-[#16845B]/25 flex items-center justify-center text-[#16845B] text-xl font-bold shrink-0 shadow-xs">
            {getMemberInitials(member.name)}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-[#25313B]">{member.name}</h2>
              <StatusBadge status={displayStatus} />
              {member.hasPT && <Badge variant="accent">PT Active</Badge>}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-[#64717B] flex-wrap">
              <span className="flex items-center gap-1"><User size={14} /> {member.member_code || member.id}</span>
              <span className="flex items-center gap-1"><Phone size={14} /> {member.phone}</span>
              {member.email && <span className="flex items-center gap-1"><Mail size={14} /> {member.email}</span>}
              {member.address && <span className="flex items-center gap-1"><MapPin size={14} /> {member.address}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" icon={LogIn} onClick={handleCheckin}>Check In</Button>
            <Button size="sm" variant="secondary" icon={Edit3} onClick={() => setShowEditModal(true)}>Edit Member</Button>
            {isAdmin && (
              <Button
                size="sm"
                variant="secondary"
                icon={IndianRupee}
                onClick={() => navigate(`/payments?record=true&memberId=${member.id}`)}
              >
                Record Payment
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={RotateCw} onClick={() => setShowRenewModal(true)}>Renew</Button>
            {isAdmin && (
              <Button
                size="sm"
                variant="secondary"
                icon={MessageSquare}
                onClick={() => setShowWhatsAppModal(true)}
                title="Send WhatsApp Registration Confirmation"
              >
                WhatsApp Confirmation
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Feedback Notification */}
      {notice && (
        <div className="p-3.5 rounded-xl bg-[#E8F5EE] border border-[#16845B]/25 text-[#16845B] text-xs font-semibold flex items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice(null)} className="text-[#16845B] hover:text-[#126b49] cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* Tabs */}
      <Tabs tabs={tabs} defaultTab="overview" />

      {/* Edit Member Modal */}
      {member && (
        <EditMemberModal
          isOpen={showEditModal}
          member={member}
          onClose={() => setShowEditModal(false)}
          onSuccess={(updates) => {
            setNotice(`Member profile updated successfully for ${updates.name}!`);
            setTimeout(() => setNotice(null), 5000);
          }}
        />
      )}

      {/* Renew Membership Modal */}
      {member && (
        <RenewMembershipModal
          isOpen={showRenewModal}
          member={member}
          onClose={() => setShowRenewModal(false)}
          onSuccess={(res) => {
            setNotice(`Membership successfully renewed on ${res.planName} plan until ${res.newExpiryDate}!`);
            setTimeout(() => setNotice(null), 6000);
          }}
        />
      )}

      {/* Payment Receipt Modal */}
      {selectedReceiptPayment && (
        <PaymentReceiptModal
          isOpen={Boolean(selectedReceiptPayment)}
          onClose={() => setSelectedReceiptPayment(null)}
          payment={selectedReceiptPayment}
          member={member}
        />
      )}

      {/* WhatsApp Registration Confirmation Modal */}
      {member && (
        <WhatsAppConfirmationModal
          isOpen={showWhatsAppModal}
          onClose={() => setShowWhatsAppModal(false)}
          member={member}
          membershipPlans={membershipPlans}
          isAdmin={isAdmin}
          onDispatched={() => {
            setNotice(`WhatsApp chat opened for ${member.name}. Review and click Send in WhatsApp.`);
            setTimeout(() => setNotice(null), 6000);
          }}
        />
      )}
    </div>
  );
}

function InfoCard({ label, value, highlight, error, restricted }) {
  return (
    <div className={`p-3.5 rounded-xl border ${error ? 'border-[#B42318]/20 bg-[#FCE9E9]' : highlight ? 'border-[#A66A00]/20 bg-[#FFF2D8]' : 'border-[#E1E6E9] bg-[#F5F7F8]'}`}>
      <p className="text-xs text-[#64717B] font-medium">{label}</p>
      <p className={`mt-0.5 ${error ? 'text-[#B42318] text-sm font-bold' : highlight ? 'text-[#A66A00] text-sm font-bold' : restricted ? 'text-xs font-medium text-[#64717B] italic' : 'text-sm font-bold text-[#25313B]'}`}>{value}</p>
    </div>
  );
}

