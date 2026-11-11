import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge, Badge } from '../components/ui/Badge';
import { SearchInput, Select, Textarea, Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import {
  Bell, MessageSquare, Send, CheckCircle2, Clock, AlertCircle,
  Smartphone, Mail, Check, RefreshCw, Info, Edit3, Eye,
  ExternalLink, ShieldAlert, FileText, RotateCcw, AlertTriangle,
  IndianRupee, UserCheck, Calendar
} from 'lucide-react';
import {
  formatINR,
  formatISTDateTime,
  generateNotificationMessage,
  normalizeIndianMobile,
  DEFAULT_GYM_PHONE,
  getLocalDateString,
  calculateNotificationDaysRemaining,
  formatDaysRemainingLabel,
} from '../utils/memberUtils';

export default function Notifications() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    notifications,
    notificationsLoading,
    notificationsError,
    latestReminderJobStatus,
    refreshingReminders,
    reloadNotifications,
    triggerManualReminderRefresh,
    markNotificationRead,
    markAllNotificationsRead,
    markNotificationWhatsAppSent,
    updateNotification,
    members,
    gymInfo,
  } = useApp();

  const [filterChannel, setFilterChannel] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all' | 'unread' | 'read' | 'wa_sent' | 'wa_pending'
  const [markingSentId, setMarkingSentId] = useState(null);
  const [filterType, setFilterType] = useState(() => searchParams.get('filter') || 'all'); // 'all' | 'unread' | 'expiry' | 'payment'
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('history'); // 'history' | 'sequence' | 'templates' | 'channels'
  const [templateChannel, setTemplateChannel] = useState('whatsapp');

  // Preview / Dispatch Modal
  const [previewItem, setPreviewItem] = useState(null);
  const [previewMsg, setPreviewMsg] = useState('');
  const [previewChannel, setPreviewChannel] = useState('WhatsApp');
  const [notice, setNotice] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Current local date in Asia/Kolkata timezone (dynamically maintained across midnight)
  const [currentDate, setCurrentDate] = useState(() => getLocalDateString());

  useEffect(() => {
    // Check every 30 seconds if local date in Asia/Kolkata has changed (e.g. crossing midnight)
    const interval = setInterval(() => {
      const freshDate = getLocalDateString();
      setCurrentDate(prev => (prev !== freshDate ? freshDate : prev));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Sync query param changes
  useEffect(() => {
    const f = searchParams.get('filter');
    if (f && ['all', 'unread', 'expiry', 'payment'].includes(f)) {
      setFilterType(f);
    }
  }, [searchParams]);

  const handleFilterTypeChange = (newType) => {
    setFilterType(newType);
    const newParams = new URLSearchParams(searchParams);
    if (newType === 'all') {
      newParams.delete('filter');
    } else {
      newParams.set('filter', newType);
    }
    setSearchParams(newParams, { replace: true });
  };

  // Automated 4-stage reminder sequence settings
  const [sequence, setSequence] = useState([
    {
      id: 'seq-5',
      days: 5,
      title: '5 Days Before Expiry',
      desc: 'First gentle reminder regarding upcoming renewal',
      channel: 'WhatsApp',
      enabled: true,
      template: 'Hi {{name}}, your Fitness House membership will expire in 5 days on {{expiry_date}}. Please renew early to maintain uninterrupted access to the gym!',
    },
    {
      id: 'seq-3',
      days: 3,
      title: '3 Days Before Expiry',
      desc: 'Follow-up alert highlighting renewal offers',
      channel: 'WhatsApp & SMS',
      enabled: true,
      template: 'Hi {{name}}, just 3 days remaining on your The Fitness House membership! Speak to reception today to renew with your current plan.',
    },
    {
      id: 'seq-0',
      days: 0,
      title: 'On Expiry Date',
      desc: 'Expiry confirmation and simple renewal prompt',
      channel: 'WhatsApp',
      enabled: true,
      template: 'Hi {{name}}, your membership has expired today. We miss seeing you! Renew online or visit the front desk to reactivate your pass.',
    },
    {
      id: 'seq-due',
      days: null,
      title: 'Outstanding Dues Notice',
      desc: 'Payment reminder for members with pending balances',
      channel: 'WhatsApp',
      enabled: true,
      template: 'Hi {{name}}, you have an outstanding balance of {{balance}} at The Fitness House. Please clear your dues at the gym counter.',
    },
  ]);

  const toggleSequence = (id) => {
    setSequence(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  };

  // Filtered Notifications List
  const filteredNotifications = useMemo(() => {
    const q = search.trim().toLowerCase();

    return (notifications || []).filter(n => {
      // 1. Search text match
      const matchSearch =
        !q ||
        (n.memberName && n.memberName.toLowerCase().includes(q)) ||
        (n.memberCode && n.memberCode.toLowerCase().includes(q)) ||
        (n.memberId && String(n.memberId).toLowerCase().includes(q)) ||
        (n.message && n.message.toLowerCase().includes(q)) ||
        (n.title && n.title.toLowerCase().includes(q)) ||
        (n.phone && n.phone.includes(q)) ||
        (n.planName && n.planName.toLowerCase().includes(q));

      // 2. Channel match
      const matchChannel =
        filterChannel === 'all' ||
        (n.channel && n.channel.toLowerCase() === filterChannel.toLowerCase());

      // 3. Status match ('all' | 'unread' | 'read' | 'wa_sent' | 'wa_pending')
      let matchStatus = true;
      if (filterStatus === 'unread') {
        matchStatus = n.status === 'unread' || (!n.isRead && n.status !== 'read');
      } else if (filterStatus === 'read') {
        matchStatus = n.status === 'read' || n.isRead;
      } else if (filterStatus === 'wa_sent') {
        matchStatus = Boolean(n.isWhatsAppSent);
      } else if (filterStatus === 'wa_pending') {
        matchStatus = !n.isWhatsAppSent;
      }

      // 4. Type filter ('all' | 'unread' | 'expiry' | 'payment')
      let matchType = true;
      if (filterType === 'unread') {
        matchType = n.status === 'unread' || (!n.isRead && n.status !== 'read');
      } else if (filterType === 'expiry') {
        const type = (n.notificationType || n.type || '').toLowerCase();
        matchType = type.includes('expir') || type === 'expired';
      } else if (filterType === 'payment') {
        const type = (n.notificationType || n.type || '').toLowerCase();
        matchType = type.includes('pay') || type.includes('due') || type.includes('balance');
      }

      return matchSearch && matchChannel && matchStatus && matchType;
    });
  }, [notifications, search, filterChannel, filterStatus, filterType]);

  // Derived Statistics
  const unreadCount = useMemo(() => {
    return (notifications || []).filter(
      n => n.status === 'unread' || (!n.isRead && n.status !== 'read')
    ).length;
  }, [notifications]);

  const expiryCount = useMemo(() => {
    return (notifications || []).filter(n => {
      const type = (n.notificationType || n.type || '').toLowerCase();
      return type.includes('expir') || type === 'expired';
    }).length;
  }, [notifications]);

  const paymentCount = useMemo(() => {
    return (notifications || []).filter(n => {
      const type = (n.notificationType || n.type || '').toLowerCase();
      return type.includes('pay') || type.includes('due') || type.includes('balance');
    }).length;
  }, [notifications]);

  const readCount = useMemo(() => {
    return (notifications || []).filter(n => n.status === 'read' || n.isRead).length;
  }, [notifications]);

  const waSentCount = useMemo(() => {
    return (notifications || []).filter(n => n.isWhatsAppSent).length;
  }, [notifications]);

  // Handlers
  const handleMarkAsRead = async (item) => {
    try {
      if (markNotificationRead) {
        await markNotificationRead(item.id);
        setNotice(`Marked alert for ${item.memberName || 'member'} as read.`);
      }
    } catch (err) {
      setNotice(`Failed to update read state: ${err.message || String(err)}`);
    }
    setTimeout(() => setNotice(null), 4000);
  };

  const handleMarkAllAsRead = async () => {
    try {
      if (markAllNotificationsRead) {
        await markAllNotificationsRead();
        setNotice('All active notifications marked as read.');
      }
    } catch (err) {
      setNotice(`Failed to mark all as read: ${err.message || String(err)}`);
    }
    setTimeout(() => setNotice(null), 4000);
  };

  // Explicit staff action: records manual WhatsApp dispatch
  const handleMarkWhatsAppSent = async (item) => {
    if (!item?.id) return;
    setMarkingSentId(item.id);
    try {
      if (markNotificationWhatsAppSent) {
        const res = await markNotificationWhatsAppSent(item.id);
        const recordedBy = res?.whatsapp_sent_by_name || 'Staff';
        setNotice({
          type: 'success',
          text: `Marked WhatsApp reminder as sent for ${item.memberName || 'member'} (recorded by ${recordedBy}). Note: Staff action only; delivery was not automatically verified.`,
        });

        if (previewItem && previewItem.id === item.id) {
          setPreviewItem(prev => ({
            ...prev,
            isWhatsAppSent: true,
            whatsappSentAt: res?.whatsapp_sent_at || new Date().toISOString(),
            whatsappSentBy: res?.whatsapp_sent_by || null,
            whatsappSentByName: recordedBy,
          }));
        }
      }
    } catch (err) {
      setNotice({
        type: 'error',
        text: `Failed to mark WhatsApp as sent: ${err.message || String(err)}`,
      });
    } finally {
      setMarkingSentId(null);
    }
    setTimeout(() => setNotice(null), 5000);
  };

  const handleRefreshReminders = async () => {
    try {
      if (triggerManualReminderRefresh) {
        const result = await triggerManualReminderRefresh();
        const genCount = Number(result?.generated_reminders ?? 0);
        const scannedCount = Number(result?.scanned_members ?? 0);
        if (genCount > 0) {
          setNotice({
            type: 'success',
            text: `Reminder generation completed: ${genCount} new reminder${genCount === 1 ? '' : 's'} generated across ${scannedCount} member record${scannedCount === 1 ? '' : 's'}.`,
          });
        } else {
          setNotice({
            type: 'info',
            text: `Reminder check completed: No new reminders required. All ${scannedCount} member subscription${scannedCount === 1 ? '' : 's'} and balance records are up to date.`,
          });
        }
      }
    } catch (err) {
      setNotice({
        type: 'error',
        text: `Failed to generate reminders: ${err.message || String(err)}`,
      });
    }
  };

  const handleReloadList = async () => {
    try {
      if (reloadNotifications) {
        await reloadNotifications();
        setNotice({
          type: 'info',
          text: 'Persisted notifications list and execution status reloaded from PostgreSQL.',
        });
      }
    } catch (err) {
      setNotice({
        type: 'error',
        text: `Failed to reload notifications: ${err.message || String(err)}`,
      });
    }
  };

  // Open Preview Modal with rich personalized copy
  const handleOpenPreview = (item) => {
    setPreviewItem(item);
    const dynamicDaysLeft = calculateNotificationDaysRemaining(item, currentDate);
    const memberObj = (members || []).find(m => m.id === item.memberId) || {
      name: item.memberName,
      phone: item.phone,
      plan: item.planName,
      expiryDate: item.expiryDate || item.targetDate,
      balance: item.currentBalance,
    };
    const richMsg = generateNotificationMessage({
      type: item.notificationType,
      member: memberObj,
      daysLeft: dynamicDaysLeft !== null ? dynamicDaysLeft : item.daysRemaining,
      balance: item.currentBalance,
      gymPhone: gymInfo?.phone || DEFAULT_GYM_PHONE,
    });
    setPreviewMsg(richMsg || item.message || '');
    setPreviewChannel(item.channel || 'WhatsApp');
  };

  const previewMember = useMemo(() => {
    if (!previewItem) return null;
    return (members || []).find(m => m.id === previewItem.memberId) || null;
  }, [previewItem, members]);

  // Normalized phone info (handles +91, 0, and non-digit characters safely)
  const phoneInfo = useMemo(() => {
    if (!previewItem) return { valid: false, phone: '', display: 'No phone provided', reason: 'missing' };
    const raw = previewMember?.phone || previewItem?.phone || '';
    return normalizeIndianMobile(raw);
  }, [previewItem, previewMember]);

  // Open WhatsApp Web with Pre-filled Message (Honest staff dispatch)
  const handleOpenWhatsApp = () => {
    if (!previewItem) return;
    if (phoneInfo.valid) {
      const url = `https://wa.me/91${phoneInfo.phone}?text=${encodeURIComponent(previewMsg)}`;
      window.open(url, '_blank');
      setNotice({
        type: 'success',
        text: `Opened WhatsApp Web draft for ${previewItem.memberName} (+91 ${phoneInfo.phone}).`,
      });
    } else {
      setNotice({
        type: 'error',
        text: `Cannot open WhatsApp: Invalid mobile number (${previewItem.phone || 'missing'}). A valid 10-digit Indian mobile number is required.`,
      });
    }
    setPreviewItem(null);
    setTimeout(() => setNotice(null), 5000);
  };

  // Save as Draft
  const handleSaveDraft = () => {
    if (!previewItem) return;
    if (updateNotification) {
      updateNotification(previewItem.id, {
        message: previewMsg,
        channel: previewChannel,
        status: 'draft',
      });
    }
    setNotice({
      type: 'info',
      text: `Saved message preview draft for ${previewItem.memberName}`,
    });
    setPreviewItem(null);
    setTimeout(() => setNotice(null), 5000);
  };

  const hasActiveFilters = search || filterChannel !== 'all' || filterStatus !== 'all' || filterType !== 'all';

  const resetFilters = () => {
    setSearch('');
    setFilterChannel('all');
    setFilterStatus('all');
    handleFilterTypeChange('all');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reminders & Messaging Automation"
        description="Monitor persistent membership expiry alerts, dues notifications, and member messaging records in Asia/Kolkata timezone."
        badge={
          <Badge variant={unreadCount > 0 ? 'warning' : 'success'}>
            {unreadCount} Unread Alert{unreadCount === 1 ? '' : 's'}
          </Badge>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={RotateCcw}
              onClick={handleReloadList}
              disabled={refreshingReminders || notificationsLoading}
              className="text-xs"
              title="Reload notifications from database without generating new ones"
            >
              {notificationsLoading ? 'Loading...' : 'Reload List'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={RefreshCw}
              onClick={handleRefreshReminders}
              disabled={refreshingReminders || notificationsLoading}
              className={`text-xs ${refreshingReminders ? 'animate-pulse' : ''}`}
            >
              {refreshingReminders ? 'Generating Reminders...' : 'Refresh Reminders'}
            </Button>
            {unreadCount > 0 && (
              <Button
                variant="secondary"
                size="sm"
                icon={Check}
                onClick={handleMarkAllAsRead}
                className="text-xs"
              >
                Mark All Read
              </Button>
            )}
          </div>
        }
      />

      {/* Scheduler Observability & Status Card */}
      <div className="p-4 rounded-xl bg-white border border-[#E2E8F0] shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-[#F1F5F9] text-[#0F172A] mt-0.5 shrink-0">
              <Calendar size={18} />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-[#0F172A]">Automated Daily Schedule:</span>
                <Badge variant="success">9:00 AM Asia/Kolkata (IST)</Badge>
                <span className="text-[11px] text-[#64748B]">(Active via PostgreSQL pg_cron)</span>
              </div>
              <p className="text-xs text-[#64748B]">
                Runs independently of any open browser every day at 09:00 IST (03:30 UTC). Authorized staff may also trigger on-demand refresh anytime.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#F1F5F9]">
            <div className="text-left md:text-right">
              <div className="text-[11px] font-medium text-[#64748B]">Last Run Execution</div>
              <div className="text-xs font-semibold text-[#0F172A] flex items-center md:justify-end gap-1.5 mt-0.5">
                {latestReminderJobStatus?.has_run ? (
                  <>
                    <StatusBadge
                      status={
                        latestReminderJobStatus.status === 'succeeded'
                          ? 'active'
                          : latestReminderJobStatus.status === 'running'
                          ? 'expiring'
                          : 'expired'
                      }
                      customLabel={
                        latestReminderJobStatus.status === 'succeeded'
                          ? 'Succeeded'
                          : latestReminderJobStatus.status === 'running'
                          ? 'Running'
                          : 'Failed'
                      }
                    />
                    <span>{formatISTDateTime(latestReminderJobStatus.started_at)}</span>
                  </>
                ) : (
                  <span className="text-[#94A3B8]">No previous execution logged</span>
                )}
              </div>
              {latestReminderJobStatus?.has_run && (
                <div className="text-[10px] text-[#64748B] mt-0.5">
                  Trigger: <span className="capitalize font-medium">{latestReminderJobStatus.triggered_by}</span> | Scanned: {latestReminderJobStatus.scanned_count} | New: {latestReminderJobStatus.generated_count}
                </div>
              )}
            </div>
          </div>
        </div>

        {latestReminderJobStatus?.status === 'failed' && (
          <div className="mt-3 p-2.5 rounded-lg bg-[#FEF3F2] border border-[#FECDCA] text-[#B42318] text-xs flex items-center justify-between gap-2">
            <span>Last scheduled execution error: {latestReminderJobStatus.error_message || 'Unknown database error'}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefreshReminders}
              disabled={refreshingReminders}
              className="border-[#FDA29B] text-[#B42318] hover:bg-[#FEE4E2] text-[11px] py-1 px-2 shrink-0"
            >
              Retry Generation
            </Button>
          </div>
        )}
      </div>

      {/* Notice Banner */}
      {notice && (
        <div className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between shadow-xs ${
          notice.type === 'error'
            ? 'bg-[#FEF3F2] border-[#FECDCA] text-[#B42318]'
            : notice.type === 'info'
            ? 'bg-[#EFF8FF] border-[#B2DDFF] text-[#175CD3]'
            : 'bg-[#E8F5EE] border-[#16845B]/25 text-[#16845B]'
        }`}>
          <div className="flex items-center gap-2">
            {notice.type === 'error' ? (
              <AlertCircle size={16} />
            ) : notice.type === 'info' ? (
              <Info size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}
            <span>{typeof notice === 'string' ? notice : notice.text}</span>
          </div>
          <button onClick={() => setNotice(null)} className="hover:opacity-75 cursor-pointer">✕</button>
        </div>
      )}

      {/* SMS Gateway Configuration State Notice */}
      <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#CBD5E1] text-[#334155] text-xs flex items-start gap-3 shadow-xs">
        <Info size={18} className="text-[#64748B] shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[#1E293B]">Delivery Channels Configuration:</span>
            <Badge variant="default">SMS Gateway: Not Configured</Badge>
            <Badge variant="success">In-App Alerts: Active</Badge>
            <Badge variant="accent">WhatsApp Direct: Ready</Badge>
          </div>
          <p className="text-[#64748B] leading-relaxed">
            Running in local development environment. Third-party paid SMS gateway is not configured. Membership expiry and dues reminders are tracked in-app via PostgreSQL, and staff can dispatch messages directly via WhatsApp Web links.
          </p>
        </div>
      </div>

      {/* Database Error Alert */}
      {notificationsError && (
        <div className="p-4 rounded-xl bg-[#FEF3F2] border border-[#FECDCA] text-[#B42318] flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={18} className="shrink-0 text-[#D92D20]" />
            <div>
              <p className="text-xs font-bold">Failed to synchronize reminders with database</p>
              <p className="text-xs text-[#B42318]/90">{notificationsError}</p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefreshReminders}
            disabled={refreshingReminders}
            className="border-[#FDA29B] text-[#B42318] hover:bg-[#FEE4E2] shrink-0"
          >
            Retry Generation
          </Button>
        </div>
      )}

      {/* KPI Stats (5 Summary Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* Card 1: Unread Alerts */}
        <Card
          padding={false}
          className={`p-4 cursor-pointer transition-all ${
            filterType === 'unread' ? 'ring-2 ring-[#A66A00]' : 'hover:border-[#CBD5E1]'
          }`}
          onClick={() => handleFilterTypeChange(filterType === 'unread' ? 'all' : 'unread')}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#64717B] truncate" title="Unread Reminders">Unread Reminders</span>
            <span className={`p-1.5 rounded-lg shrink-0 ${unreadCount > 0 ? 'bg-[#FFF2D8] text-[#A66A00]' : 'bg-[#E8F5EE] text-[#16845B]'}`}>
              <Bell size={16} />
            </span>
          </div>
          <p className="text-2xl font-bold text-[#25313B] mt-2 truncate">{unreadCount}</p>
          <p className="text-xs text-[#A66A00] font-medium mt-1 truncate" title="Requires staff review">Requires staff review</p>
        </Card>

        {/* Card 2: Expiry Alerts */}
        <Card
          padding={false}
          className={`p-4 cursor-pointer transition-all ${
            filterType === 'expiry' ? 'ring-2 ring-[#16845B]' : 'hover:border-[#CBD5E1]'
          }`}
          onClick={() => handleFilterTypeChange(filterType === 'expiry' ? 'all' : 'expiry')}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#64717B] truncate" title="Membership Expiry">Membership Expiry</span>
            <span className="p-1.5 rounded-lg bg-[#E8F5EE] text-[#16845B] shrink-0">
              <Clock size={16} />
            </span>
          </div>
          <p className="text-2xl font-bold text-[#25313B] mt-2 truncate">{expiryCount}</p>
          <p className="text-xs text-[#16845B] font-medium mt-1 truncate" title="5d, 3d, today & expired">5d, 3d, today & expired</p>
        </Card>

        {/* Card 3: Pending Dues */}
        <Card
          padding={false}
          className={`p-4 cursor-pointer transition-all ${
            filterType === 'payment' ? 'ring-2 ring-[#B42318]' : 'hover:border-[#CBD5E1]'
          }`}
          onClick={() => handleFilterTypeChange(filterType === 'payment' ? 'all' : 'payment')}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#64717B] truncate" title="Pending Dues Notices">Pending Dues Notices</span>
            <span className="p-1.5 rounded-lg bg-[#FCE9E9] text-[#B42318] shrink-0">
              <IndianRupee size={16} />
            </span>
          </div>
          <p className="text-2xl font-bold text-[#25313B] mt-2 truncate">{paymentCount}</p>
          <p className="text-xs text-[#B42318] font-medium mt-1 truncate" title="Outstanding balances">Outstanding balances</p>
        </Card>

        {/* Card 4: Acknowledged & Read */}
        <Card
          padding={false}
          className={`p-4 cursor-pointer transition-all ${
            filterStatus === 'read' ? 'ring-2 ring-[#16845B]' : 'hover:border-[#CBD5E1]'
          }`}
          onClick={() => setFilterStatus(prev => prev === 'read' ? 'all' : 'read')}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#64717B] truncate" title="Acknowledged & Read">Acknowledged & Read</span>
            <span className="p-1.5 rounded-lg bg-[#F5F7F8] text-[#64717B] shrink-0">
              <CheckCircle2 size={16} />
            </span>
          </div>
          <p className="text-2xl font-bold text-[#25313B] mt-2 truncate">{readCount}</p>
          <p className="text-xs text-[#64717B] mt-1 truncate" title="Processed notifications">Processed notifications</p>
        </Card>

        {/* Card 5: WhatsApp Messages Sent */}
        <Card
          padding={false}
          className={`p-4 cursor-pointer transition-all ${
            filterStatus === 'wa_sent' ? 'ring-2 ring-[#16845B]' : 'hover:border-[#CBD5E1]'
          }`}
          onClick={() => setFilterStatus(prev => prev === 'wa_sent' ? 'all' : 'wa_sent')}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#64717B] truncate" title="WhatsApp Messages Sent">WhatsApp Messages Sent</span>
            <span className="p-1.5 rounded-lg bg-[#E8F5EE] text-[#16845B] shrink-0">
              <MessageSquare size={16} />
            </span>
          </div>
          <p className="text-2xl font-bold text-[#25313B] mt-2 truncate">{waSentCount}</p>
          <p className="text-xs text-[#16845B] font-medium mt-1 truncate" title="Staff-marked dispatches">Staff-marked dispatches</p>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-[#E1E6E9] pb-px overflow-x-auto min-w-0 max-w-full scrollbar-thin">
        {[
          { id: 'history', label: 'Alerts & Reminders Queue', count: (notifications || []).length },
          { id: 'sequence', label: 'Automated Expiry Sequence', count: sequence.length },
          { id: 'templates', label: 'Message Templates' },
          { id: 'channels', label: 'Delivery Channels & Architecture' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-[#16845B] text-[#16845B]'
                : 'border-transparent text-[#64717B] hover:text-[#25313B]'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                activeTab === tab.id ? 'bg-[#E8F5EE] text-[#16845B]' : 'bg-[#F5F7F8] text-[#64717B]'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab 1: Alerts & Reminders Queue */}
      {activeTab === 'history' && (
        <Card padding={false}>
          {/* Filters Bar */}
          <div className="p-4 border-b border-[#E1E6E9] flex flex-col lg:flex-row gap-3 items-center justify-between">
            <SearchInput
              placeholder="Search member, ID, phone, title, or message..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch('')}
              className="w-full lg:w-80"
            />
            <div className="flex items-center gap-2 w-full lg:w-auto flex-wrap">
              {/* Type Filter */}
              <Select
                value={filterType}
                onChange={(e) => handleFilterTypeChange(e.target.value)}
                options={[
                  { value: 'all', label: 'All Types' },
                  { value: 'unread', label: 'Unread Only' },
                  { value: 'expiry', label: 'Expiry Alerts' },
                  { value: 'payment', label: 'Pending Dues' },
                ]}
                className="w-40"
              />

              {/* Status Filter */}
              <Select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                options={[
                  { value: 'all', label: 'All Statuses' },
                  { value: 'unread', label: 'Unread' },
                  { value: 'read', label: 'Read' },
                  { value: 'wa_sent', label: 'WhatsApp Sent' },
                  { value: 'wa_pending', label: 'WhatsApp Pending' },
                ]}
                className="w-40"
              />

              {/* Channel Filter */}
              <Select
                value={filterChannel}
                onChange={(e) => setFilterChannel(e.target.value)}
                options={[
                  { value: 'all', label: 'All Channels' },
                  { value: 'in-app', label: 'In-App' },
                  { value: 'whatsapp', label: 'WhatsApp' },
                  { value: 'sms', label: 'SMS' },
                ]}
                className="w-36"
              />

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

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#F5F7F8] border-b border-[#E1E6E9] text-[#64717B] text-xs font-semibold uppercase">
                <tr>
                  <th className="px-4 py-3 text-center">State</th>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Type & Plan</th>
                  <th className="px-4 py-3">Reminder Title & Message</th>
                  <th className="px-4 py-3 text-center">Expiry / Target</th>
                  <th className="px-4 py-3 text-center">Channel</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E6E9]">
                {/* Database Loading State */}
                {notificationsLoading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-[#64717B]">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="w-6 h-6 border-2 border-[#16845B] border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs font-medium">Synchronizing persistent reminders from PostgreSQL...</span>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Notifications Table Rows */}
                {!notificationsLoading && filteredNotifications.map(item => {
                  const isUnread = item.status === 'unread' || (!item.isRead && item.status !== 'read');
                  const isExpiry = (item.notificationType || '').includes('expir') || item.notificationType === 'expired';
                  const isPayment = (item.notificationType || '').includes('pay') || (item.notificationType || '').includes('due');
                  const effectiveDays = calculateNotificationDaysRemaining(item, currentDate);
                  const daysLabel = formatDaysRemainingLabel(effectiveDays);

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        isUnread ? 'bg-white hover:bg-[#F5F7F8]/80 font-medium' : 'bg-[#FAFAFA] hover:bg-[#F5F7F8]/50 opacity-90'
                      }`}
                    >
                      {/* Read / Unread Indicator */}
                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        {isUnread ? (
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full bg-[#A66A00] ring-2 ring-[#FFF2D8]"
                            title="Unread reminder"
                          />
                        ) : (
                          <CheckCircle2 size={16} className="inline-block text-[#16845B]" title="Read" />
                        )}
                      </td>

                      {/* Member Identification */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          {item.memberId ? (
                            <button
                              onClick={() => navigate(`/members/${item.memberId}`)}
                              className="font-semibold text-xs text-[#25313B] hover:text-[#16845B] hover:underline cursor-pointer flex items-center gap-1"
                            >
                              {item.memberName}
                              <ExternalLink size={10} className="text-[#64717B]" />
                            </button>
                          ) : (
                            <span className="font-semibold text-xs text-[#25313B]">
                              {item.memberName}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] font-mono text-[#64717B]">
                          <span>{item.memberCode || item.memberId || 'N/A'}</span>
                          {item.phone && <span>· {item.phone}</span>}
                        </div>
                      </td>

                      {/* Type, Plan & Contract State */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold uppercase w-fit ${
                              item.notificationType === 'expired'
                                ? 'bg-[#FCE9E9] text-[#B42318] border border-[#B42318]/25'
                                : item.notificationType === 'expiry_today'
                                ? 'bg-[#FCE9E9] text-[#B42318] border border-[#B42318]/25'
                                : item.notificationType === 'payment_due'
                                ? 'bg-[#FFF2D8] text-[#A66A00] border border-[#A66A00]/25'
                                : 'bg-[#E8F5EE] text-[#16845B] border border-[#16845B]/25'
                            }`}
                          >
                            {item.notificationType ? item.notificationType.replace(/_/g, ' ') : 'Reminder'}
                          </span>
                          <span className="text-xs text-[#64717B] font-medium">
                            {item.planName || 'Membership'}
                          </span>
                          {item.isSuperseded && (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-semibold border border-gray-200 w-fit">
                              Renewed / Prior Contract
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Reminder Title & Message */}
                      <td className="px-4 py-3.5 max-w-sm">
                        <p className="text-xs font-bold text-[#25313B] leading-tight">
                          {item.title}
                        </p>
                        <p className="text-xs text-[#64717B] mt-0.5 leading-relaxed">
                          {item.message}
                        </p>
                      </td>

                      {/* Expiry / Target Date */}
                      <td className="px-4 py-3.5 text-center text-xs text-[#64717B] whitespace-nowrap tabular-nums">
                        <span className="font-semibold block text-[#25313B]">
                          {item.targetDate || item.scheduledDate || 'N/A'}
                        </span>
                        {daysLabel && (
                          <span className="text-[11px] text-[#A66A00] font-medium">
                            {daysLabel}
                          </span>
                        )}
                      </td>

                      {/* Channel & WhatsApp Sent Status */}
                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        <div className="flex flex-col items-center gap-1">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#25313B]">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                item.channel?.toLowerCase().includes('whatsapp')
                                  ? 'bg-[#16845B]'
                                  : item.channel?.toLowerCase().includes('sms')
                                  ? 'bg-[#2196F3]'
                                  : 'bg-[#64717B]'
                              }`}
                            />
                            {item.channel || 'In-App'}
                          </span>
                          {item.isWhatsAppSent ? (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#E8F5EE] text-[#16845B] border border-[#16845B]/20"
                              title={`Staff marked as sent on ${formatISTDateTime(item.whatsappSentAt)}${item.whatsappSentByName ? ` by ${item.whatsappSentByName}` : ''}. Delivery not automatically verified.`}
                            >
                              <Check size={11} className="stroke-[3]" />
                              WA Sent
                            </span>
                          ) : (
                            <span
                              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#F1F5F9] text-[#64748B] border border-[#E2E8F0]"
                              title="WhatsApp message has not been marked as sent by staff"
                            >
                              WA Pending
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Mark Read Button */}
                          {isUnread && (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={Check}
                              onClick={() => handleMarkAsRead(item)}
                              className="text-xs h-7 px-2 text-[#16845B] hover:bg-[#E8F5EE]"
                              title="Mark this reminder as read"
                            >
                              Read
                            </Button>
                          )}

                          {/* Member Navigation */}
                          {item.memberId && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => navigate(`/members/${item.memberId}`)}
                              className="text-xs h-7 px-2"
                              title="Open Member Profile"
                            >
                              Profile
                            </Button>
                          )}

                          {/* Dues Collection Navigation */}
                          {isPayment && item.memberId && (
                            <Button
                              variant="primary"
                              size="sm"
                              icon={IndianRupee}
                              onClick={() => navigate(`/payments?record=true&memberId=${item.memberId}`)}
                              className="text-xs h-7 px-2 bg-[#16845B] hover:bg-[#126b49] text-white"
                              title="Collect Outstanding Dues"
                            >
                              Collect
                            </Button>
                          )}

                          {/* Mark WhatsApp Sent Action Button */}
                          {!item.isWhatsAppSent ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleMarkWhatsAppSent(item)}
                              disabled={markingSentId === item.id}
                              className="text-xs h-7 px-2 text-[#16845B] hover:bg-[#E8F5EE] border-[#16845B]/30"
                              title="Explicitly record that staff sent this reminder on WhatsApp"
                            >
                              {markingSentId === item.id ? '...' : 'Mark Sent'}
                            </Button>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#16845B] px-2 py-1 bg-[#E8F5EE] rounded border border-[#16845B]/20 cursor-default"
                              title={`Staff marked as sent on ${formatISTDateTime(item.whatsappSentAt)}${item.whatsappSentByName ? ` by ${item.whatsappSentByName}` : ''}. Delivery not automatically verified.`}
                            >
                              <Check size={12} className="stroke-[2.5]" />
                              Sent
                            </span>
                          )}

                          {/* Preview Dispatch */}
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={Eye}
                            onClick={() => handleOpenPreview(item)}
                            className="text-xs h-7 px-2 text-[#64717B]"
                            title="Preview Message Template & WhatsApp Action"
                          >
                            Preview
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* Empty State */}
                {!notificationsLoading && filteredNotifications.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12">
                      <EmptyState
                        icon={Bell}
                        title={hasActiveFilters ? 'No notifications match the filter' : 'No notifications in queue'}
                        description={
                          hasActiveFilters
                            ? 'Try clearing the search query or adjusting the type and status filters.'
                            : 'All membership subscriptions are current and all dues reminders are up to date.'
                        }
                        action={
                          hasActiveFilters ? (
                            <Button variant="secondary" size="sm" icon={RotateCcw} onClick={resetFilters}>
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
        </Card>
      )}

      {/* Tab 2: Expiry Sequence */}
      {activeTab === 'sequence' && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Automated Expiry Reminder Rules</CardTitle>
              <CardDescription>
                System sequence that generates reminders leading up to and on membership expiry. Operates in Asia/Kolkata timezone.
              </CardDescription>
            </div>
          </CardHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {sequence.map((stage) => (
              <div
                key={stage.id}
                className={`p-4 rounded-xl border transition-all ${
                  stage.enabled
                    ? 'bg-white border-[#E1E6E9] shadow-xs'
                    : 'bg-[#F5F7F8]/50 border-dashed border-[#CBD5E1] opacity-75'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold ${
                      stage.enabled ? 'bg-[#E8F5EE] text-[#16845B]' : 'bg-[#E1E6E9] text-[#64717B]'
                    }`}>
                      {stage.days !== null ? `${stage.days}d` : 'Dues'}
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-[#25313B]">{stage.title}</h4>
                      <p className="text-xs text-[#64717B]">{stage.desc}</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stage.enabled}
                      onChange={() => toggleSequence(stage.id)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#16845B]" />
                  </label>
                </div>

                <div className="mt-3 p-3 bg-[#F5F7F8] rounded-lg border border-[#E1E6E9] text-xs text-[#25313B] leading-relaxed">
                  <p className="font-medium text-[#64717B] mb-1">Message Preview:</p>
                  <p className="italic font-mono">{stage.template}</p>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-[#64717B]">
                  <span>Channel: <strong className="text-[#25313B]">{stage.channel}</strong></span>
                  <span className="text-[11px] text-[#16845B] font-semibold">Active In Engine</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Tab 3: Templates */}
      {activeTab === 'templates' && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Dynamic Message Templates</CardTitle>
              <CardDescription>
                Live preview showing how variables resolve to real gym member and facility data.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {['whatsapp', 'sms'].map(ch => (
                <Button
                  key={ch}
                  variant={templateChannel === ch ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setTemplateChannel(ch)}
                  className="capitalize"
                >
                  {ch}
                </Button>
              ))}
            </div>
          </CardHeader>

          <div className="space-y-4 mt-4">
            <div className="p-4 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9]">
              <h4 className="text-sm font-semibold text-[#25313B] mb-1">Standard 5-Day Expiry Notification</h4>
              <p className="text-xs text-[#64717B] mb-3">Dispatched 5 days before active subscription expiry.</p>
              <div className="p-3 bg-white rounded-lg border border-[#E1E6E9] text-xs font-mono text-[#25313B]">
                "Hi Rohit Sharma, your The Fitness House membership expires in 5 days on 2026-11-19. Renew today to maintain continuous gym access!"
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9]">
              <h4 className="text-sm font-semibold text-[#25313B] mb-1">Outstanding Dues Reminder</h4>
              <p className="text-xs text-[#64717B] mb-3">Sent to members with positive balance due.</p>
              <div className="p-3 bg-white rounded-lg border border-[#E1E6E9] text-xs font-mono text-[#25313B]">
                "Hi Member, you have an outstanding balance of ₹500 for Monthly membership at The Fitness House. Please clear your dues at the counter."
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Tab 4: Delivery Channels */}
      {activeTab === 'channels' && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Delivery Channels & Security Architecture</CardTitle>
              <CardDescription>
                Overview of persistent reminders, PostgreSQL triggers, and safe messaging dispatch.
              </CardDescription>
            </div>
          </CardHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
            <div className="p-4 rounded-xl border border-[#E1E6E9] bg-white">
              <div className="w-8 h-8 rounded-lg bg-[#E8F5EE] text-[#16845B] flex items-center justify-center mb-3">
                <Bell size={16} />
              </div>
              <h4 className="text-sm font-semibold text-[#25313B]">In-App Persistence</h4>
              <p className="text-xs text-[#64717B] mt-1 leading-relaxed">
                Reminders are stored in PostgreSQL with strict uniqueness constraints preventing duplicates on page refreshes.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-[#E1E6E9] bg-white">
              <div className="w-8 h-8 rounded-lg bg-[#E8F5EE] text-[#16845B] flex items-center justify-center mb-3">
                <Smartphone size={16} />
              </div>
              <h4 className="text-sm font-semibold text-[#25313B]">WhatsApp Direct Links</h4>
              <p className="text-xs text-[#64717B] mt-1 leading-relaxed">
                Staff can click Preview & Send to open pre-filled WhatsApp web links with formatted member reminder copy.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC]">
              <div className="w-8 h-8 rounded-lg bg-[#F1F5F9] text-[#64748B] flex items-center justify-center mb-3">
                <Mail size={16} />
              </div>
              <div className="flex items-center gap-1.5">
                <h4 className="text-sm font-semibold text-[#1E293B]">SMS Gateway</h4>
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 bg-[#E2E8F0] text-[#475569] rounded">
                  Not Configured
                </span>
              </div>
              <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                Local development environment. No third-party provider credentials (Fast2SMS / Twilio) are connected.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-[#E1E6E9] bg-white">
              <div className="w-8 h-8 rounded-lg bg-[#F5F7F8] text-[#64717B] flex items-center justify-center mb-3">
                <ShieldAlert size={16} />
              </div>
              <h4 className="text-sm font-semibold text-[#25313B]">Least Privilege & RLS</h4>
              <p className="text-xs text-[#64717B] mt-1 leading-relaxed">
                Anonymous direct table writes are revoked. All mutations execute via authorized SECURITY DEFINER RPCs.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Preview & Dispatch Modal */}
      {previewItem && (
        <Modal
          isOpen={true}
          onClose={() => setPreviewItem(null)}
          title="Reminder Preview & Direct Message"
          size="md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setPreviewItem(null)}>
                Cancel
              </Button>
              {phoneInfo.valid ? (
                <Button
                  onClick={handleOpenWhatsApp}
                  className="bg-[#16845B] hover:bg-[#126b49] text-white"
                  icon={Send}
                >
                  Open WhatsApp Web
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled
                  title={phoneInfo.reason === 'invalid_format' ? 'Invalid 10-digit Indian mobile number' : 'No phone number provided'}
                >
                  {phoneInfo.reason === 'invalid_format' ? 'Invalid Phone Number' : 'No Phone Number'}
                </Button>
              )}
              {previewItem.isWhatsAppSent ? (
                <Button
                  variant="secondary"
                  disabled
                  className="text-xs bg-[#E8F5EE] text-[#16845B] border-[#16845B]/30 cursor-default"
                  title={`Recorded on ${formatISTDateTime(previewItem.whatsappSentAt)}${previewItem.whatsappSentByName ? ` by ${previewItem.whatsappSentByName}` : ''}`}
                >
                  ✓ Staff Marked Sent
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => handleMarkWhatsAppSent(previewItem)}
                  disabled={markingSentId === previewItem.id}
                  className="text-xs border-[#16845B] text-[#16845B] hover:bg-[#E8F5EE]"
                  icon={Check}
                >
                  {markingSentId === previewItem.id ? 'Recording...' : 'Mark WhatsApp Sent'}
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-4">
            <div className="p-3.5 bg-[#F5F7F8] rounded-xl border border-[#E1E6E9]">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-xs text-[#25313B]">{previewItem.memberName}</h4>
                  <div className="text-[11px] font-mono text-[#64717B]">
                    {phoneInfo.valid ? (
                      <span className="text-[#16845B] font-semibold">+91 {phoneInfo.phone}</span>
                    ) : phoneInfo.reason === 'invalid_format' ? (
                      <span className="text-[#B42318] font-semibold">{phoneInfo.display} (Invalid Indian mobile format)</span>
                    ) : (
                      <span className="text-[#94A3B8]">No phone provided</span>
                    )}
                  </div>
                </div>
                <span className="text-xs font-medium text-[#16845B] bg-[#E8F5EE] px-2.5 py-0.5 rounded-full">
                  {previewItem.planName || 'Membership'}
                </span>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#25313B] block mb-1.5">
                Message Content
              </label>
              <Textarea
                rows={4}
                value={previewMsg}
                onChange={(e) => setPreviewMsg(e.target.value)}
                className="w-full text-xs font-mono"
              />
            </div>

            {previewItem.isWhatsAppSent ? (
              <div className="p-3 bg-[#E8F5EE] rounded-xl border border-[#16845B]/30 text-xs text-[#16845B] flex items-start gap-2">
                <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-[#16845B]" />
                <div className="space-y-0.5">
                  <p className="font-semibold">Staff recorded message as sent manually via WhatsApp</p>
                  <p className="text-[11px] text-[#16845B]/90">
                    Recorded at: {formatISTDateTime(previewItem.whatsappSentAt)}
                    {previewItem.whatsappSentByName ? ` by ${previewItem.whatsappSentByName}` : ''}
                  </p>
                  <p className="text-[10px] text-[#16845B]/80 italic">
                    Status indicates staff action only. WhatsApp delivery or receipt is not verified automatically.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-[#F8FAFC] rounded-xl border border-[#CBD5E1] text-xs text-[#475569] flex items-start gap-2">
                <Info size={16} className="shrink-0 mt-0.5 text-[#64748B]" />
                <div className="space-y-0.5">
                  <span>
                    Click <strong>Open WhatsApp Web</strong> to draft the message, then click <strong>Mark WhatsApp Sent</strong> once dispatched.
                  </span>
                  <p className="text-[10px] text-[#64748B] italic">
                    Opening the link or previewing does not mark the reminder as sent.
                  </p>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
