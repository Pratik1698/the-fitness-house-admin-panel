import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Select, Textarea } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import {
  Building2, CreditCard, Dumbbell, Bell, Shield, User,
  Check, Save, Clock, Phone, Mail, MapPin, Plus, Lock, Key,
  AlertCircle, AlertTriangle, Loader2, Power, RefreshCw, UserPlus, UserCheck, UserX,
  ShieldAlert, History,
} from 'lucide-react';
import { ChangePasswordModal } from '../components/auth/ChangePasswordModal';
import { PlanEditorModal } from '../components/settings/PlanEditorModal';
import { PtPackageEditorModal } from '../components/settings/PtPackageEditorModal';
import { InviteStaffModal } from '../components/settings/InviteStaffModal';
import { StaffStatusModal } from '../components/settings/StaffStatusModal';
import { StaffRoleModal } from '../components/settings/StaffRoleModal';
import { Modal } from '../components/ui/Modal';
import { getStaffStatusFeedback } from '../services/staffService';

export default function Settings() {
  const {
    gymInfo, updateGymInfo, gymInfoLoading, gymInfoError, gymInfoMigrationPending, refreshGymInfo,
    user, role,
    membershipPlans, allMembershipPlans, plansLoading, plansError, reloadPlans,
    createPlan, updatePlan, togglePlanStatus,
    ptPackages, allPtPackages, ptPackagesLoading, ptPackagesError, reloadPtPackages,
    createPtPackage, updatePtPackage, togglePtPackageStatus,
    reminderSettings, reminderSettingsLoading, reminderSettingsError, reloadReminderSettings,
    updateReminderSettings,
    staffRoster, pendingInvitations, securityAuditLogs, staffLoading, staffError, refreshStaffRoster,
    inviteStaffMember, updateStaffRole, toggleStaffStatus, revokeInvitation, resendInvitation,
    isSupabaseConfigured,
  } = useApp();

  const [activeSection, setActiveSection] = useState('gym');
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  // ── Staff & Security modal & action state (Phase 5) ────────────────────────
  const [inviteStaffOpen, setInviteStaffOpen] = useState(false);
  const [staffStatusTarget, setStaffStatusTarget] = useState(null); // { staff, targetActive }
  const [staffRoleTarget, setStaffRoleTarget] = useState(null); // { staff, targetRole }
  const [staffFeedback, setStaffFeedback] = useState(null);
  const [revokingInviteId, setRevokingInviteId] = useState(null);
  const [resendingInviteId, setResendingInviteId] = useState(null);

  // ── Membership Plans modal & action state ──────────────────────────────────
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [planFeedback, setPlanFeedback] = useState(null);
  const [planToToggle, setPlanToToggle] = useState(null);
  const [togglingPlanId, setTogglingPlanId] = useState(null);

  // ── PT Packages modal & action state (Phase 3) ────────────────────────────
  const [ptPackageModalOpen, setPtPackageModalOpen] = useState(false);
  const [editingPtPackage, setEditingPtPackage] = useState(null);
  const [ptPackageFeedback, setPtPackageFeedback] = useState(null);
  const [ptPackageToToggle, setPtPackageToToggle] = useState(null);
  const [togglingPtPackageId, setTogglingPtPackageId] = useState(null);

  // ── Gym Profile form state ─────────────────────────────────────────────────
  const [gymForm, setGymForm] = useState({
    name:      gymInfo.name      ?? '',
    tagline:   gymInfo.tagline   ?? '',
    location:  gymInfo.location  ?? '',
    address:   gymInfo.address   ?? '',
    phone:     gymInfo.phone     ?? '',
    whatsapp:  gymInfo.whatsapp  ?? '',
    email:     gymInfo.email     ?? '',
    timings:   gymInfo.timings   ?? '',
  });

  // ── Reminder Automation state (Phase 4: Supabase-backed) ───────────────────
  const [reminders, setReminders] = useState({
    fiveDay:       Boolean(reminderSettings?.fiveDay ?? true),
    threeDay:      Boolean(reminderSettings?.threeDay ?? true),
    oneDay:        Boolean(reminderSettings?.oneDay ?? true),
    expiryDay:     Boolean(reminderSettings?.expiryDay ?? true),
    paymentAlerts: Boolean(reminderSettings?.paymentAlerts ?? true),
    autoWhatsApp:  Boolean(reminderSettings?.autoWhatsApp ?? false),
    smsFallback:   Boolean(reminderSettings?.smsFallback ?? false),
  });

  const remindersDirty = useRef(false);
  const [reminderFeedback, setReminderFeedback] = useState(null);
  const [savingReminders, setSavingReminders] = useState(false);

  useEffect(() => {
    if (!remindersDirty.current && reminderSettings) {
      setReminders({
        fiveDay:       Boolean(reminderSettings.fiveDay),
        threeDay:      Boolean(reminderSettings.threeDay),
        oneDay:        Boolean(reminderSettings.oneDay),
        expiryDay:     Boolean(reminderSettings.expiryDay),
        paymentAlerts: Boolean(reminderSettings.paymentAlerts),
        autoWhatsApp:  Boolean(reminderSettings.autoWhatsApp),
        smsFallback:   Boolean(reminderSettings.smsFallback),
      });
    }
  }, [reminderSettings]);

  // Track whether the user has made unsaved edits so we do not overwrite them
  // when a background refresh comes in after a successful save.
  const formIsDirty = useRef(false);

  // When gymInfo loads from Supabase (or changes after a successful save),
  // repopulate the form — but only if there are no unsaved edits.
  useEffect(() => {
    if (!formIsDirty.current) {
      setGymForm({
        name:     gymInfo.name      ?? '',
        tagline:  gymInfo.tagline   ?? '',
        location: gymInfo.location  ?? '',
        address:  gymInfo.address   ?? '',
        phone:    gymInfo.phone     ?? '',
        whatsapp: gymInfo.whatsapp  ?? '',
        email:    gymInfo.email     ?? '',
        timings:  gymInfo.timings   ?? '',
      });
    }
  }, [gymInfo]);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const isAdmin = role === 'admin';

  const handleFieldChange = (field, value) => {
    formIsDirty.current = true;
    setSaveSuccess(false);
    setSaveError(null);
    setGymForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveGymInfo = async (e) => {
    e.preventDefault();
    if (!isAdmin) return; // Extra guard — RLS enforces this server-side too
    if (saving) return;   // Prevent duplicate submissions

    setSaving(true);
    setSaveSuccess(false);
    setSaveError(null);

    try {
      await updateGymInfo(gymForm);
      formIsDirty.current = false;
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err) {
      setSaveSuccess(false);
      setSaveError(
        err?.message || 'Failed to save gym profile. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  // ── Plan Action Handlers ──────────────────────────────────────────────────
  const handleOpenCreatePlan = () => {
    if (!isAdmin) return;
    setEditingPlan(null);
    setPlanModalOpen(true);
  };

  const handleOpenEditPlan = (plan) => {
    if (!isAdmin) return;
    setEditingPlan(plan);
    setPlanModalOpen(true);
  };

  const handleSavePlan = async (planData, planId) => {
    if (!isAdmin) {
      return { error: 'Permission denied: only administrators can modify membership plans.' };
    }
    try {
      const res = planId
        ? await updatePlan(planId, planData)
        : await createPlan(planData);

      if (res.error) {
        return { error: res.error.message || 'Failed to save plan.' };
      }

      setPlanFeedback({
        type: 'success',
        message: planId
          ? `Membership plan "${res.data?.name || planData.name}" updated successfully.`
          : `Membership plan "${res.data?.name || planData.name}" created and published.`,
      });
      setTimeout(() => setPlanFeedback(null), 4000);
      return { success: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'An unexpected error occurred while saving plan.' };
    }
  };

  const handleConfirmToggleStatus = async () => {
    if (!planToToggle || !isAdmin) return;
    const { plan, targetActive } = planToToggle;
    setTogglingPlanId(plan.id);
    try {
      const res = await togglePlanStatus(plan.id, plan.is_active);
      if (res.error) {
        setPlanFeedback({
          type: 'error',
          message: res.error.message || `Failed to ${targetActive ? 'activate' : 'deactivate'} plan.`,
        });
      } else {
        setPlanFeedback({
          type: 'success',
          message: `Plan "${plan.name}" has been ${targetActive ? 'activated' : 'deactivated'}. ${
            targetActive
              ? 'It is now available for member onboarding and renewals.'
              : 'It is now hidden from new registrations and renewal options.'
          }`,
        });
        setTimeout(() => setPlanFeedback(null), 4000);
      }
    } catch (err) {
      setPlanFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update plan status.',
      });
    } finally {
      setTogglingPlanId(null);
      setPlanToToggle(null);
    }
  };

  // ── PT Package Action Handlers (Phase 3) ───────────────────────────────────
  const handleOpenCreatePtPackage = () => {
    if (!isAdmin) return;
    setEditingPtPackage(null);
    setPtPackageModalOpen(true);
  };

  const handleOpenEditPtPackage = (pkg) => {
    if (!isAdmin) return;
    setEditingPtPackage(pkg);
    setPtPackageModalOpen(true);
  };

  const handleSavePtPackage = async (pkgData, pkgId) => {
    if (!isAdmin) {
      return { error: 'Permission denied: only administrators can modify PT packages.' };
    }
    try {
      const res = pkgId
        ? await updatePtPackage(pkgId, pkgData)
        : await createPtPackage(pkgData);

      if (res.error) {
        return { error: res.error.message || 'Failed to save PT package.' };
      }

      setPtPackageFeedback({
        type: 'success',
        message: pkgId
          ? `PT package "${res.data?.name || pkgData.name}" updated successfully.`
          : `PT package "${res.data?.name || pkgData.name}" created and published.`,
      });
      setTimeout(() => setPtPackageFeedback(null), 4000);
      return { success: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'An unexpected error occurred while saving package.' };
    }
  };

  const handleConfirmTogglePtPackageStatus = async () => {
    if (!ptPackageToToggle || !isAdmin) return;
    const { pkg, targetActive } = ptPackageToToggle;
    setTogglingPtPackageId(pkg.id);
    try {
      const res = await togglePtPackageStatus(pkg.id, pkg.isActive || pkg.is_active);
      if (res.error) {
        setPtPackageFeedback({
          type: 'error',
          message: res.error.message || `Failed to ${targetActive ? 'activate' : 'deactivate'} PT package.`,
        });
      } else {
        setPtPackageFeedback({
          type: 'success',
          message: `PT package "${pkg.name}" has been ${targetActive ? 'activated' : 'deactivated'}. ${
            targetActive
              ? 'It is now available for personal training assignments.'
              : 'It is now hidden from new assignments.'
          }`,
        });
        setTimeout(() => setPtPackageFeedback(null), 4000);
      }
    } catch (err) {
      setPtPackageFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update PT package status.',
      });
    } finally {
      setTogglingPtPackageId(null);
      setPtPackageToToggle(null);
    }
  };

  // ── Reminder Automation Handlers (Phase 4) ─────────────────────────────────
  const handleReminderToggle = (key, checked) => {
    if (!isAdmin) return;
    remindersDirty.current = true;
    setReminderFeedback(null);
    setReminders(prev => ({ ...prev, [key]: checked }));
  };

  const handleSaveReminders = async () => {
    if (!isAdmin) return;
    setSavingReminders(true);
    setReminderFeedback(null);
    try {
      const res = await updateReminderSettings(reminders);
      if (res.error) {
        setReminderFeedback({
          type: 'error',
          message: res.error.message || 'Failed to save reminder preferences to Supabase.',
        });
      } else {
        remindersDirty.current = false;
        setReminderFeedback({
          type: 'success',
          message: 'Reminder preferences saved successfully to database.',
        });
        setTimeout(() => setReminderFeedback(null), 4000);
      }
    } catch (err) {
      setReminderFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'An unexpected error occurred saving preferences.',
      });
    } finally {
      setSavingReminders(false);
    }
  };

  // ── Staff & Security Action Handlers (Phase 5) ────────────────────────────
  const handleInviteStaffAction = async ({ email, fullName }) => {
    if (!isAdmin) return { error: 'Permission denied: Only administrators can invite staff.' };
    return await inviteStaffMember({ email, fullName });
  };

  const handleConfirmStaffStatus = async (userId, targetActive) => {
    if (!isAdmin) return { error: 'Permission denied: Only administrators can modify account status.' };
    const res = await toggleStaffStatus({ userId, isActive: targetActive });
    const feedback = getStaffStatusFeedback({ targetActive, res });
    setStaffFeedback(feedback);
    if (feedback.type !== 'error') {
      setTimeout(() => setStaffFeedback(null), feedback.type === 'warning' ? 6000 : 4000);
    }
    if (targetActive && !res.error && !res.data?.gotrueUnbanSucceeded) {
      return {
        data: res.data,
        error: new Error(feedback.message),
      };
    }
    return res;
  };

  const handleConfirmStaffRole = async (userId, targetRole) => {
    if (!isAdmin) return { error: 'Permission denied: Only administrators can modify roles.' };
    const res = await updateStaffRole({ userId, role: targetRole });
    if (!res.error) {
      setStaffFeedback({
        type: 'success',
        message: `Role successfully updated to ${targetRole}.`,
      });
      setTimeout(() => setStaffFeedback(null), 4000);
    }
    return res;
  };

  const handleRevokeInvitationAction = async (invitationId) => {
    if (!isAdmin || revokingInviteId) return;
    setRevokingInviteId(invitationId);
    try {
      const res = await revokeInvitation({ invitationId });
      if (res.error) {
        setStaffFeedback({ type: 'error', message: res.error.message || 'Failed to revoke invitation.' });
      } else {
        setStaffFeedback({ type: 'success', message: 'Staff invitation revoked.' });
        setTimeout(() => setStaffFeedback(null), 3000);
      }
    } finally {
      setRevokingInviteId(null);
    }
  };

  const handleResendInvitationAction = async (invite) => {
    if (!isAdmin || resendingInviteId) return;
    setResendingInviteId(invite.id);
    try {
      const res = await resendInvitation({
        invitationId: invite.id,
        email: invite.email,
        fullName: invite.fullName,
      });
      if (res.error) {
        setStaffFeedback({ type: 'error', message: res.error.message || 'Failed to resend invitation.' });
      } else {
        setStaffFeedback({ type: 'success', message: `Invitation resent to ${invite.email}.` });
        setTimeout(() => setStaffFeedback(null), 3000);
      }
    } finally {
      setResendingInviteId(null);
    }
  };

  const displayPlans = allMembershipPlans && allMembershipPlans.length > 0 ? allMembershipPlans : membershipPlans;
  const displayPtPackages = allPtPackages && allPtPackages.length > 0 ? allPtPackages : ptPackages;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Facility & System Settings"
        description="Configure facility details, subscription pricing, PT tiers, automated reminders, and admin security."
        badge={
          saveSuccess ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#E8F5EE] text-[#16845B] text-xs font-semibold">
              <Check size={14} /> Saved successfully!
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Navigation Sidebar */}
        <div className="space-y-1">
          {[
            { id: 'gym', label: 'Gym Profile & Info', icon: Building2, desc: 'Contact, location & timings' },
            { id: 'plans', label: 'Membership Plans', icon: CreditCard, desc: 'Tiers, duration & pricing' },
            { id: 'pt', label: 'Personal Training', icon: Dumbbell, desc: 'Package tiers & validity' },
            { id: 'notifications', label: 'Reminder Automation', icon: Bell, desc: 'Expiry & payment dispatch' },
            { id: 'admin', label: 'Admin & Staff Security', icon: Shield, desc: 'Roles & access control' },
          ].map(item => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-center gap-3.5 ${
                  active
                    ? 'bg-white border-[#16845B] shadow-sm text-[#16845B]'
                    : 'bg-white/60 border-[#E1E6E9] hover:bg-white text-[#64717B]'
                }`}
              >
                <div className={`p-2 rounded-lg ${active ? 'bg-[#E8F5EE] text-[#16845B]' : 'bg-[#F5F7F8] text-[#64717B]'}`}>
                  <Icon size={18} />
                </div>
                <div>
                  <p className={`text-sm font-semibold ${active ? 'text-[#16845B]' : 'text-[#25313B]'}`}>{item.label}</p>
                  <p className="text-xs text-[#64717B]">{item.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Settings Body */}
        <div className="lg:col-span-3">
          {/* Section 1: Gym Info */}
          {activeSection === 'gym' && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Gym Information & Facility Profile</CardTitle>
                  <CardDescription>
                    These details appear on member payment invoices, renewal receipts, and WhatsApp message headers.
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  onClick={handleSaveGymInfo}
                  disabled={saving || !isAdmin || gymInfoLoading}
                  icon={saving ? Loader2 : !isAdmin ? Lock : Save}
                  className={saving ? '[&>svg]:animate-spin' : ''}
                >
                  {saving ? 'Saving...' : !isAdmin ? 'Save Changes (Admin Only)' : 'Save Changes'}
                </Button>
              </CardHeader>

              {/* Status / Feedback Banners */}
              <div className="space-y-3 mt-4">
                {gymInfoLoading && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] text-xs text-[#64717B]">
                    <Loader2 size={16} className="animate-spin text-[#16845B]" />
                    <span>Loading authoritative facility profile from Supabase...</span>
                  </div>
                )}

                {/* Migration Warning Banner: Distinguishes schema migration pending from transient network errors */}
                {gymInfoMigrationPending && !saveSuccess && (
                  <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#FFF9F5] border border-[#FEE4D2] text-xs text-[#B93815]">
                    <AlertCircle size={16} className="shrink-0 mt-0.5 text-[#B93815]" />
                    <div className="space-y-1">
                      <p className="font-semibold text-[#7A271A]">
                        Database Migration Pending for Extended Facility Fields
                      </p>
                      <p className="text-[11px] leading-relaxed text-[#7A271A]">
                        Extended profile fields (WhatsApp helpline, operating hours, location) cannot synchronize to Supabase until database migration <code className="font-mono font-semibold px-1 py-0.5 bg-[#FEE4D2] rounded text-[#B93815]">20261101000000_phase1_gym_info_missing_columns.sql</code> is applied. Base profile fields (name, phone, email, address) continue to synchronize safely.
                      </p>
                    </div>
                  </div>
                )}

                {gymInfoError && (
                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#FEF3F2] border border-[#FECDCA] text-xs text-[#B42318]">
                    <div className="flex items-center gap-2">
                      <AlertCircle size={16} className="shrink-0" />
                      <span>{gymInfoError}</span>
                    </div>
                    {refreshGymInfo && (
                      <Button variant="secondary" size="sm" onClick={refreshGymInfo}>
                        Retry
                      </Button>
                    )}
                  </div>
                )}

                {saveError && (
                  <div className="flex items-center gap-2 p-3.5 rounded-xl bg-[#FEF3F2] border border-[#FECDCA] text-xs text-[#B42318]">
                    <AlertCircle size={16} className="shrink-0" />
                    <span>{saveError}</span>
                  </div>
                )}

                {saveSuccess && (
                  <div className="flex items-center gap-2 p-3.5 rounded-xl bg-[#E8F5EE] border border-[#16845B]/20 text-xs font-semibold text-[#16845B]">
                    <Check size={16} className="shrink-0" />
                    <span>Gym facility profile saved to database and synchronized across all environments!</span>
                  </div>
                )}

                {!isAdmin && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] text-xs text-[#64717B]">
                    <Lock size={14} className="shrink-0 text-[#64717B]" />
                    <span>
                      Staff View (Read-Only): Administrator privileges are required to update gym facility details.
                    </span>
                  </div>
                )}
              </div>

              <form onSubmit={handleSaveGymInfo} className="space-y-4 mt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Gym Name"
                    value={gymForm.name}
                    onChange={(e) => handleFieldChange('name', e.target.value)}
                    disabled={!isAdmin || saving || gymInfoLoading}
                  />
                  <Input
                    label="Tagline / Department"
                    value={gymForm.tagline}
                    onChange={(e) => handleFieldChange('tagline', e.target.value)}
                    disabled={!isAdmin || saving || gymInfoLoading}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Input
                    label="Primary Phone"
                    value={gymForm.phone}
                    onChange={(e) => handleFieldChange('phone', e.target.value)}
                    icon={Phone}
                    disabled={!isAdmin || saving || gymInfoLoading}
                  />
                  <Input
                    label="WhatsApp Helpline"
                    value={gymForm.whatsapp}
                    onChange={(e) => handleFieldChange('whatsapp', e.target.value)}
                    icon={Phone}
                    disabled={!isAdmin || saving || gymInfoLoading}
                  />
                  <Input
                    label="Official Email"
                    value={gymForm.email}
                    onChange={(e) => handleFieldChange('email', e.target.value)}
                    icon={Mail}
                    disabled={!isAdmin || saving || gymInfoLoading}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Location / Town"
                    value={gymForm.location}
                    onChange={(e) => handleFieldChange('location', e.target.value)}
                    icon={MapPin}
                    disabled={!isAdmin || saving || gymInfoLoading}
                  />
                  <Input
                    label="Gym Operating Hours"
                    value={gymForm.timings}
                    onChange={(e) => handleFieldChange('timings', e.target.value)}
                    icon={Clock}
                    disabled={!isAdmin || saving || gymInfoLoading}
                  />
                </div>

                <Textarea
                  label="Full Street Address"
                  value={gymForm.address}
                  onChange={(e) => handleFieldChange('address', e.target.value)}
                  disabled={!isAdmin || saving || gymInfoLoading}
                />
              </form>
            </Card>
          )}

          {/* Section 2: Membership Plans */}
          {activeSection === 'plans' && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Configured Membership Plans</CardTitle>
                  <CardDescription>
                    Base subscription tiers selectable when registering members or issuing plan renewals.
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  onClick={handleOpenCreatePlan}
                  disabled={!isAdmin}
                  icon={!isAdmin ? Lock : Plus}
                >
                  {!isAdmin ? 'Add Plan (Admin Only)' : 'Add Plan'}
                </Button>
              </CardHeader>

              {/* Status / Feedback Banners */}
              <div className="space-y-3 mt-4">
                {planFeedback && (
                  <div className={`flex items-center gap-2 p-3.5 rounded-xl border text-xs font-semibold ${
                    planFeedback.type === 'success'
                      ? 'bg-[#E8F5EE] border-[#16845B]/20 text-[#16845B]'
                      : 'bg-[#FEF3F2] border-[#FECDCA] text-[#B42318]'
                  }`}>
                    {planFeedback.type === 'success' ? <Check size={16} className="shrink-0" /> : <AlertCircle size={16} className="shrink-0" />}
                    <span>{planFeedback.message}</span>
                  </div>
                )}

                {!isAdmin && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] text-xs text-[#64717B]">
                    <Lock size={14} className="shrink-0 text-[#64717B]" />
                    <span>
                      Staff View (Read-Only): Administrator privileges are required to configure, edit, or toggle membership plans.
                    </span>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto mt-4">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F5F7F8] border-b border-[#E1E6E9] text-[#64717B] text-xs font-semibold uppercase">
                    <tr>
                      <th className="px-4 py-3">Plan Name</th>
                      <th className="px-4 py-3">Duration (Days)</th>
                      <th className="px-4 py-3">Standard Fee</th>
                      <th className="px-4 py-3">Freeze Privilege</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E1E6E9]">
                    {plansLoading ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-xs text-[#64717B]">
                          <div className="flex items-center justify-center gap-2">
                            <Loader2 size={16} className="animate-spin text-[#16845B]" />
                            <span>Loading membership plans from database...</span>
                          </div>
                        </td>
                      </tr>
                    ) : plansError ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-xs text-[#B42318]">
                          <p className="font-semibold mb-2">Failed to load membership plans: {plansError}</p>
                          <Button variant="secondary" size="sm" onClick={reloadPlans}>
                            Retry
                          </Button>
                        </td>
                      </tr>
                    ) : displayPlans.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-xs text-[#64717B]">
                          No membership plans found in database. {isAdmin ? 'Click "Add Plan" to create one.' : ''}
                        </td>
                      </tr>
                    ) : (
                      displayPlans.map(p => (
                        <tr
                          key={p.id}
                          className={`hover:bg-[#F5F7F8]/50 transition-colors ${!p.is_active ? 'bg-[#F9FAFA]/60 opacity-80' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold text-[#25313B]">{p.name}</div>
                            {p.description && (
                              <p className="text-[11px] text-[#64717B] truncate max-w-xs">{p.description}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[#64717B]">{p.duration} days</td>
                          <td className="px-4 py-3 font-bold text-[#16845B]">₹{p.price.toLocaleString('en-IN')}</td>
                          <td className="px-4 py-3 text-xs text-[#64717B]">
                            {p.duration >= 180 ? 'Up to 15 days freeze' : 'No freeze allowed'}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={p.is_active ? "success" : "default"}>
                              {p.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {isAdmin ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenEditPlan(p)}
                                  disabled={Boolean(togglingPlanId)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setPlanToToggle({ plan: p, targetActive: !p.is_active })}
                                  disabled={Boolean(togglingPlanId)}
                                  className={p.is_active
                                    ? "text-[#B42318] hover:text-[#911d13] hover:bg-[#FEF3F2]"
                                    : "text-[#16845B] hover:text-[#126B4A] hover:bg-[#E8F5EE]"
                                  }
                                >
                                  {p.is_active ? "Deactivate" : "Activate"}
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-[#64717B] italic">Read-Only</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Section 3: Personal Training */}
          {activeSection === 'pt' && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Personal Training Packages</CardTitle>
                  <CardDescription>
                    Trainer packages with session limits and validity caps stored in Supabase.
                  </CardDescription>
                </div>
                {isAdmin && (
                  <Button size="sm" onClick={handleOpenCreatePtPackage} icon={Plus}>
                    Add PT Package
                  </Button>
                )}
              </CardHeader>

              {/* PT Package Feedback Banner */}
              {ptPackageFeedback && (
                <div className={`mt-3 flex items-center gap-2 p-3 rounded-lg text-xs font-medium ${
                  ptPackageFeedback.type === 'error'
                    ? 'bg-[#FEF3F2] text-[#B42318] border border-[#FECDCA]'
                    : 'bg-[#E8F5EE] text-[#16845B] border border-[#A6F4C5]'
                }`}>
                  <CheckCircle2 size={16} className={ptPackageFeedback.type === 'error' ? 'text-[#B42318]' : 'text-[#16845B]'} />
                  <span>{ptPackageFeedback.message}</span>
                </div>
              )}

              {ptPackagesLoading ? (
                <div className="py-12 flex flex-col items-center justify-center text-xs text-[#64717B]">
                  <Loader2 size={24} className="animate-spin text-[#16845B] mb-2" />
                  <span>Loading personal training packages from database...</span>
                </div>
              ) : ptPackagesError ? (
                <div className="py-8 text-center text-xs text-[#B42318]">
                  <p className="font-semibold mb-2">Failed to load PT packages: {ptPackagesError}</p>
                  <Button variant="secondary" size="sm" onClick={reloadPtPackages}>
                    Retry
                  </Button>
                </div>
              ) : displayPtPackages.length === 0 ? (
                <div className="py-10 text-center text-xs text-[#64717B]">
                  No personal training packages found in database. {isAdmin ? 'Click "Add PT Package" to create one.' : ''}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                  {displayPtPackages.map(pkg => {
                    const isActive = pkg.isActive !== undefined ? pkg.isActive : pkg.is_active;
                    const total = pkg.totalSessions || pkg.total_sessions || pkg.sessions || 0;
                    const validity = pkg.validityDays || pkg.validity_days || pkg.validity || 30;
                    const ratePerSession = total > 0 ? Math.round(pkg.price / total) : 0;

                    return (
                      <div
                        key={pkg.id}
                        className={`p-4 rounded-xl border border-[#E1E6E9] bg-white flex flex-col justify-between transition-all ${
                          !isActive ? 'bg-[#F9FAFA] opacity-75 border-dashed' : 'hover:border-[#16845B]/40'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <Badge variant={isActive ? "success" : "default"}>
                              {isActive ? "Active Tier" : "Inactive Tier"}
                            </Badge>
                            <span className="text-xs text-[#64717B] font-medium">{validity} days validity</span>
                          </div>
                          <h4 className="text-base font-bold text-[#25313B]">{pkg.name}</h4>
                          <p className="text-xs text-[#64717B] mt-1">{total} one-on-one guided sessions</p>
                          {pkg.description && (
                            <p className="text-xs text-[#64717B] mt-1.5 italic line-clamp-2">{pkg.description}</p>
                          )}
                          <p className="text-2xl font-bold text-[#16845B] mt-3">₹{pkg.price.toLocaleString('en-IN')}</p>
                        </div>

                        <div className="mt-4 pt-3 border-t border-[#E1E6E9] flex items-center justify-between">
                          <span className="text-xs text-[#64717B]">₹{ratePerSession} / session</span>
                          {isAdmin ? (
                            <div className="flex items-center gap-1.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEditPtPackage(pkg)}
                                disabled={Boolean(togglingPtPackageId)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPtPackageToToggle({ pkg, targetActive: !isActive })}
                                disabled={Boolean(togglingPtPackageId)}
                                className={isActive
                                  ? "text-[#B42318] hover:text-[#911d13] hover:bg-[#FEF3F2]"
                                  : "text-[#16845B] hover:text-[#126B4A] hover:bg-[#E8F5EE]"
                                }
                              >
                                {isActive ? "Deactivate" : "Activate"}
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-[#64717B] italic">Read-Only</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {/* Section 4: Notification Settings */}
          {activeSection === 'notifications' && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Reminder Triggers & Channel Automation</CardTitle>
                  <CardDescription>
                    Enable or disable automatic reminders sent to members ahead of plan expiry.
                  </CardDescription>
                </div>
                {isAdmin ? (
                  <Button
                    size="sm"
                    onClick={handleSaveReminders}
                    disabled={savingReminders}
                    icon={savingReminders ? Loader2 : Save}
                    className={savingReminders ? '[&>svg]:animate-spin' : ''}
                  >
                    {savingReminders ? 'Saving...' : 'Save Preferences'}
                  </Button>
                ) : (
                  <span className="text-xs text-[#64717B] italic px-2 py-1 bg-gray-100 rounded">Read-Only View</span>
                )}
              </CardHeader>

              {/* Staff Read-Only Notice */}
              {!isAdmin && (
                <div className="mt-3 p-3 rounded-lg bg-[#F8FAFB] border border-[#E1E6E9] text-xs text-[#64717B] flex items-center gap-2">
                  <Shield size={16} className="text-[#64717B] shrink-0" />
                  <span>Viewing in read-only mode. Only administrators can save reminder preferences to Supabase.</span>
                </div>
              )}

              {/* Reminder Feedback Banner */}
              {reminderFeedback && (
                <div className={`mt-3 flex items-center gap-2 p-3 rounded-lg text-xs font-medium ${
                  reminderFeedback.type === 'error'
                    ? 'bg-[#FEF3F2] text-[#B42318] border border-[#FECDCA]'
                    : 'bg-[#E8F5EE] text-[#16845B] border border-[#A6F4C5]'
                }`}>
                  {reminderFeedback.type === 'error' ? <AlertCircle size={16} /> : <Check size={16} />}
                  <span>{reminderFeedback.message}</span>
                </div>
              )}

              <div className="space-y-4 mt-4">
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#64717B]">Expiry Alert Schedule</h4>

                  {[
                    { key: 'fiveDay', label: '5 Days Before Expiry', desc: 'Generate courtesy reminder 5 days prior to membership expiry' },
                    { key: 'threeDay', label: '3 Days Before Expiry', desc: 'Generate renewal prompt with current fee details' },
                    { key: 'oneDay', label: '1 Day Before Expiry', desc: 'Urgent final courtesy alert 24 hours before pass expiration' },
                    { key: 'expiryDay', label: 'On Expiry Date', desc: 'Send expiration notice and renewal link on date of expiry' },
                    { key: 'paymentAlerts', label: 'Outstanding Balance Due Alert', desc: 'Alert members with positive unpaid balances on their membership dues' },
                  ].map(item => (
                    <div key={item.key} className="flex items-center justify-between p-3 rounded-lg border border-[#E1E6E9] bg-white">
                      <div>
                        <p className="text-sm font-semibold text-[#25313B]">{item.label}</p>
                        <p className="text-xs text-[#64717B]">{item.desc}</p>
                      </div>
                      <label className={`relative inline-flex items-center ${isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                        <input
                          type="checkbox"
                          checked={Boolean(reminders[item.key])}
                          onChange={(e) => handleReminderToggle(item.key, e.target.checked)}
                          disabled={!isAdmin || savingReminders}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#16845B]" />
                      </label>
                    </div>
                  ))}
                </div>

                <div className="space-y-3 pt-4 border-t border-[#E1E6E9]">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#64717B]">Gateway Channels</h4>

                  <div className="flex items-center justify-between p-3 rounded-lg border border-[#E1E6E9] bg-white">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-[#25313B]">Auto-Send via WhatsApp Business</p>
                        <Badge variant="default" className="text-[10px] py-0 px-1.5 font-normal">Integration Required</Badge>
                      </div>
                      <p className="text-xs text-[#64717B]">Channel readiness preference (requires external API gateway integration)</p>
                      <p className="text-[11px] text-[#85949F] mt-0.5 italic">Note: WhatsApp messaging currently operates via staff-initiated click-to-chat links.</p>
                    </div>
                    <label className={`relative inline-flex items-center ${isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(reminders.autoWhatsApp)}
                        onChange={(e) => handleReminderToggle('autoWhatsApp', e.target.checked)}
                        disabled={!isAdmin || savingReminders}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#16845B]" />
                    </label>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border border-[#E1E6E9] bg-white">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-[#25313B]">Transactional SMS Fallback</p>
                        <Badge variant="default" className="text-[10px] py-0 px-1.5 font-normal">Integration Required</Badge>
                      </div>
                      <p className="text-xs text-[#64717B]">Channel readiness preference (requires external API gateway integration)</p>
                      <p className="text-[11px] text-[#85949F] mt-0.5 italic">Note: Direct SMS dispatch requires future SMS gateway provider integration.</p>
                    </div>
                    <label className={`relative inline-flex items-center ${isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(reminders.smsFallback)}
                        onChange={(e) => handleReminderToggle('smsFallback', e.target.checked)}
                        disabled={!isAdmin || savingReminders}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#16845B]" />
                    </label>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Section 5: Admin & Security */}
          {activeSection === 'admin' && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Administrator Profile & Staff Accounts</CardTitle>
                  <CardDescription>
                    Manage login credentials, security preferences, and staff role permissions.
                  </CardDescription>
                </div>
              </CardHeader>

              <div className="space-y-6 mt-4">
                {/* Admin credentials */}
                <div className="p-4 border border-[#E1E6E9] rounded-xl bg-white space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#16845B] text-white flex items-center justify-center font-bold text-sm">
                        {user?.email ? user.email.charAt(0).toUpperCase() : (role === 'admin' ? 'A' : 'S')}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-[#25313B]">
                          {user?.user_metadata?.full_name || (role === 'admin' ? 'Administrator' : 'Staff Member')}
                        </h4>
                        <p className="text-xs text-[#64717B]">{user?.email || 'pravinjoshi2707@gmail.com'}</p>
                      </div>
                    </div>
                    <Badge variant={role === 'admin' ? 'success' : 'default'}>
                      {role === 'admin' ? 'Administrator' : 'Staff Role'}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-[#E1E6E9]">
                    <Input
                      label="Account Name"
                      defaultValue={user?.user_metadata?.full_name || (role === 'admin' ? 'Gym Administrator' : 'Staff Member')}
                      disabled
                    />
                    <Input
                      label="Account Email"
                      defaultValue={user?.email || 'pravinjoshi2707@gmail.com'}
                      disabled
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <Button variant="secondary" size="sm" onClick={() => setChangePasswordOpen(true)}>
                      <Key size={14} /> Change Password
                    </Button>
                  </div>
                </div>

                {/* Staff Feedback Alert */}
                {staffFeedback && (
                  <div className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                    staffFeedback.type === 'error'
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : staffFeedback.type === 'warning'
                      ? 'bg-[#FFF9F5] border-[#FEE4D2] text-[#B93815]'
                      : 'bg-[#E8F5EE] border-[#16845B]/20 text-[#16845B]'
                  }`}>
                    <div className="flex items-center gap-2">
                      {staffFeedback.type === 'error' ? (
                        <AlertCircle size={16} />
                      ) : staffFeedback.type === 'warning' ? (
                        <AlertTriangle size={16} />
                      ) : (
                        <Check size={16} />
                      )}
                      <span>{staffFeedback.message}</span>
                    </div>
                    <button
                      onClick={() => setStaffFeedback(null)}
                      className="text-xs hover:underline cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Staff Roster Management */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="text-sm font-semibold text-[#25313B]">Staff Accounts & Permissions</h4>
                      <p className="text-xs text-[#64717B]">
                        {isAdmin
                          ? 'Role-based access, account lifecycle, and staff invitations'
                          : 'Read-only directory of authorized gym staff and trainers'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={refreshStaffRoster}
                        disabled={staffLoading}
                        icon={RefreshCw}
                        className={staffLoading ? '[&>svg]:animate-spin' : ''}
                      >
                        Refresh
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => setInviteStaffOpen(true)}
                          icon={UserPlus}
                        >
                          Invite Staff
                        </Button>
                      )}
                    </div>
                  </div>

                  {!isAdmin && (
                    <div className="mb-3 p-3 rounded-lg bg-[#F8FAFB] border border-[#E1E6E9] text-xs text-[#64717B] flex items-center gap-2">
                      <Lock size={14} className="text-[#85949F] shrink-0" />
                      <span>
                        <strong>Read-Only Coworker Directory:</strong> Only administrators can dispatch staff invitations, modify roles, or deactivate accounts.
                      </span>
                    </div>
                  )}

                  {staffLoading && staffRoster.length === 0 ? (
                    <div className="p-8 text-center text-xs text-[#64717B] border border-dashed border-[#E1E6E9] rounded-xl bg-[#F5F7F8]">
                      <Loader2 size={24} className="animate-spin mx-auto mb-2 text-[#16845B]" />
                      Loading staff roster from database...
                    </div>
                  ) : staffRoster.length === 0 ? (
                    <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-300 rounded-xl">
                      <User size={36} className="text-slate-400 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-slate-700">No staff accounts found in database</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {isAdmin ? 'Click "Invite Staff" above to send an official invitation.' : 'No other staff accounts currently listed.'}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-[#E1E6E9] bg-white">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#F5F7F8] border-b border-[#E1E6E9] text-[#64717B] font-semibold">
                          <tr>
                            <th className="px-4 py-3">Staff Member</th>
                            <th className="px-4 py-3">Role</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Joined</th>
                            {isAdmin && <th className="px-4 py-3 text-right">Actions</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E1E6E9]">
                          {staffRoster.map((member) => {
                            const isCurrentUser = member.id === user?.id;
                            const isTargetAdmin = member.role === 'admin';

                            return (
                              <tr key={member.id} className="hover:bg-[#F9FAFB] transition-colors">
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                                      member.isActive ? 'bg-[#16845B] text-white' : 'bg-slate-300 text-slate-600'
                                    }`}>
                                      {member.fullName ? member.fullName.charAt(0).toUpperCase() : 'S'}
                                    </div>
                                    <div>
                                      <p className="font-semibold text-[#25313B]">
                                        {member.fullName || 'Staff Member'}
                                        {isCurrentUser && (
                                          <span className="ml-1.5 text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-normal">
                                            You
                                          </span>
                                        )}
                                      </p>
                                      {member.email && (
                                        <p className="text-[11px] text-[#64717B]">{member.email}</p>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <Badge variant={member.role === 'admin' ? 'success' : 'default'}>
                                    {member.role === 'admin' ? 'Administrator' : 'Staff Role'}
                                  </Badge>
                                </td>
                                <td className="px-4 py-3">
                                  {member.isActive ? (
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#E8F5EE] text-[#16845B]">
                                      <span className="w-1.5 h-1.5 rounded-full bg-[#16845B]" />
                                      Active
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700">
                                      <span className="w-1.5 h-1.5 rounded-full bg-red-600" />
                                      Deactivated
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-[#64717B] text-[11px]">
                                  {member.createdAt
                                    ? new Date(member.createdAt).toLocaleDateString('en-IN', {
                                        day: 'numeric',
                                        month: 'short',
                                        year: 'numeric',
                                      })
                                    : '—'}
                                </td>
                                {isAdmin && (
                                  <td className="px-4 py-3 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      {/* Change Role Button */}
                                      <Button
                                        variant="secondary"
                                        size="xs"
                                        onClick={() =>
                                          setStaffRoleTarget({
                                            staff: member,
                                            targetRole: isTargetAdmin ? 'staff' : 'admin',
                                          })
                                        }
                                        disabled={isCurrentUser}
                                        title={isCurrentUser ? "You cannot modify your own role" : "Change staff role"}
                                      >
                                        {isTargetAdmin ? 'Demote to Staff' : 'Promote to Admin'}
                                      </Button>

                                      {/* Deactivate / Reactivate Button */}
                                      <Button
                                        variant={member.isActive ? 'secondary' : 'primary'}
                                        size="xs"
                                        onClick={() =>
                                          setStaffStatusTarget({
                                            staff: member,
                                            targetActive: !member.isActive,
                                          })
                                        }
                                        disabled={isCurrentUser}
                                        icon={member.isActive ? Power : Check}
                                        title={isCurrentUser ? "You cannot deactivate your own account" : member.isActive ? "Deactivate account" : "Reactivate account"}
                                      >
                                        {member.isActive ? 'Deactivate' : 'Reactivate'}
                                      </Button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Pending Invitations Section (Admin Only) */}
                {isAdmin && pendingInvitations.length > 0 && (
                  <div className="pt-4 border-t border-[#E1E6E9] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-[#85949F]" />
                        <h4 className="text-xs font-bold text-[#25313B] uppercase tracking-wider">
                          Pending Invitations ({pendingInvitations.length})
                        </h4>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-[#E1E6E9] bg-white">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#F8FAFB] border-b border-[#E1E6E9] text-[#64717B] font-semibold">
                          <tr>
                            <th className="px-4 py-2.5">Email</th>
                            <th className="px-4 py-2.5">Invited Name</th>
                            <th className="px-4 py-2.5">Role</th>
                            <th className="px-4 py-2.5">Sent On</th>
                            <th className="px-4 py-2.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E1E6E9]">
                          {pendingInvitations.map((invite) => (
                            <tr key={invite.id} className="hover:bg-[#F9FAFB]">
                              <td className="px-4 py-2.5 font-medium text-[#25313B]">{invite.email}</td>
                              <td className="px-4 py-2.5 text-[#64717B]">{invite.fullName}</td>
                              <td className="px-4 py-2.5">
                                <Badge variant="default">Staff</Badge>
                              </td>
                              <td className="px-4 py-2.5 text-[#64717B] text-[11px]">
                                {invite.createdAt ? new Date(invite.createdAt).toLocaleDateString('en-IN') : '—'}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <Button
                                    variant="secondary"
                                    size="xs"
                                    onClick={() => handleResendInvitationAction(invite)}
                                    disabled={resendingInviteId === invite.id}
                                  >
                                    {resendingInviteId === invite.id ? 'Resending...' : 'Resend'}
                                  </Button>
                                  <Button
                                    variant="danger"
                                    size="xs"
                                    onClick={() => handleRevokeInvitationAction(invite.id)}
                                    disabled={revokingInviteId === invite.id}
                                  >
                                    {revokingInviteId === invite.id ? 'Revoking...' : 'Revoke'}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Recent Security Activity Audit (Admin Only) */}
                {isAdmin && securityAuditLogs.length > 0 && (
                  <div className="pt-4 border-t border-[#E1E6E9] space-y-2.5">
                    <div className="flex items-center gap-2 text-xs font-bold text-[#25313B] uppercase tracking-wider">
                      <History size={14} className="text-[#85949F]" />
                      <span>Recent Security Activity</span>
                    </div>
                    <div className="bg-[#F8FAFB] rounded-xl border border-[#E1E6E9] p-3 divide-y divide-[#E1E6E9] max-h-48 overflow-y-auto">
                      {securityAuditLogs.slice(0, 5).map((log) => (
                        <div key={log.id} className="py-2 first:pt-0 last:pb-0 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-semibold text-[#25313B] capitalize">
                              {log.action ? log.action.replace(/_/g, ' ') : 'Security Event'}
                            </span>
                            {log.details?.target_email && (
                              <span className="text-[#64717B] ml-1.5">({log.details.target_email})</span>
                            )}
                          </div>
                          <span className="text-[11px] text-[#85949F]">
                            {log.created_at ? new Date(log.created_at).toLocaleString('en-IN') : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Self-Service Change Password Modal */}
      <ChangePasswordModal
        isOpen={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />

      {/* Plan Configuration & Editor Modal (Phase 2) */}
      <PlanEditorModal
        isOpen={planModalOpen}
        onClose={() => {
          setPlanModalOpen(false);
          setEditingPlan(null);
        }}
        plan={editingPlan}
        onSave={handleSavePlan}
      />

      {/* Confirmation Modal for Plan Deactivation / Reactivation */}
      {planToToggle && (
        <Modal
          isOpen={Boolean(planToToggle)}
          onClose={() => setPlanToToggle(null)}
          title={planToToggle.targetActive ? "Activate Membership Plan" : "Deactivate Membership Plan"}
          size="sm"
          footer={
            <div className="flex items-center justify-end gap-2.5 w-full">
              <Button
                variant="secondary"
                onClick={() => setPlanToToggle(null)}
                disabled={Boolean(togglingPlanId)}
              >
                Cancel
              </Button>
              <Button
                variant={planToToggle.targetActive ? "primary" : "danger"}
                onClick={handleConfirmToggleStatus}
                disabled={Boolean(togglingPlanId)}
                icon={togglingPlanId ? Loader2 : planToToggle.targetActive ? Check : Power}
              >
                {togglingPlanId
                  ? "Updating..."
                  : planToToggle.targetActive
                  ? "Confirm Activation"
                  : "Confirm Deactivation"}
              </Button>
            </div>
          }
        >
          <div className="space-y-3 text-xs text-[#25313B]">
            <p>
              {planToToggle.targetActive ? (
                <>
                  Are you sure you want to reactivate the <strong>{planToToggle.plan.name}</strong> plan?
                </>
              ) : (
                <>
                  Are you sure you want to deactivate the <strong>{planToToggle.plan.name}</strong> plan?
                </>
              )}
            </p>
            <div className={`p-3 rounded-xl border text-xs leading-relaxed ${
              planToToggle.targetActive
                ? "bg-[#E8F5EE] border-[#16845B]/20 text-[#16845B]"
                : "bg-[#FFF9F5] border-[#FEE4D2] text-[#B93815]"
            }`}>
              {planToToggle.targetActive
                ? "Once reactivated, this plan will immediately be selectable for new member registration and renewal subscriptions."
                : "Inactive plans are hidden from member onboarding and renewal dropdowns. Existing member subscriptions will not be modified or deleted."}
            </div>
          </div>
        </Modal>
      )}

      {/* PT Package Modal (Phase 3: Create & Edit) */}
      <PtPackageEditorModal
        isOpen={ptPackageModalOpen}
        onClose={() => {
          setPtPackageModalOpen(false);
          setEditingPtPackage(null);
        }}
        pkg={editingPtPackage}
        onSave={handleSavePtPackage}
      />

      {/* Confirmation Modal for PT Package Deactivation / Reactivation */}
      {ptPackageToToggle && (
        <Modal
          isOpen={Boolean(ptPackageToToggle)}
          onClose={() => setPtPackageToToggle(null)}
          title={ptPackageToToggle.targetActive ? "Activate PT Package" : "Deactivate PT Package"}
          size="sm"
          footer={
            <div className="flex items-center justify-end gap-2.5 w-full">
              <Button
                variant="secondary"
                onClick={() => setPtPackageToToggle(null)}
                disabled={Boolean(togglingPtPackageId)}
              >
                Cancel
              </Button>
              <Button
                variant={ptPackageToToggle.targetActive ? "primary" : "danger"}
                onClick={handleConfirmTogglePtPackageStatus}
                disabled={Boolean(togglingPtPackageId)}
                icon={togglingPtPackageId ? Loader2 : ptPackageToToggle.targetActive ? Check : Power}
              >
                {togglingPtPackageId
                  ? "Updating..."
                  : ptPackageToToggle.targetActive
                  ? "Confirm Activation"
                  : "Confirm Deactivation"}
              </Button>
            </div>
          }
        >
          <div className="space-y-3 text-xs text-[#25313B]">
            <p>
              {ptPackageToToggle.targetActive ? (
                <>
                  Are you sure you want to reactivate the <strong>{ptPackageToToggle.pkg.name}</strong> package?
                </>
              ) : (
                <>
                  Are you sure you want to deactivate the <strong>{ptPackageToToggle.pkg.name}</strong> package?
                </>
              )}
            </p>
            <div className={`p-3 rounded-xl border text-xs leading-relaxed ${
              ptPackageToToggle.targetActive
                ? "bg-[#E8F5EE] border-[#16845B]/20 text-[#16845B]"
                : "bg-[#FFF9F5] border-[#FEE4D2] text-[#B93815]"
            }`}>
              {ptPackageToToggle.targetActive
                ? "Once reactivated, this package will immediately be available for personal training client assignments."
                : "Inactive packages are hidden from member onboarding and trainer assignment dropdowns. Existing member assignments will not be modified or deleted."}
            </div>
          </div>
        </Modal>
      )}

      {/* Invite Staff Modal (Phase 5) */}
      <InviteStaffModal
        isOpen={inviteStaffOpen}
        onClose={() => setInviteStaffOpen(false)}
        onInvite={handleInviteStaffAction}
      />

      {/* Staff Status Confirmation Modal (Phase 5: Deactivate / Reactivate) */}
      <StaffStatusModal
        isOpen={Boolean(staffStatusTarget)}
        onClose={() => setStaffStatusTarget(null)}
        staffMember={staffStatusTarget?.staff}
        targetActive={staffStatusTarget?.targetActive}
        onConfirm={handleConfirmStaffStatus}
      />

      {/* Staff Role Confirmation Modal (Phase 5: Admin <-> Staff) */}
      <StaffRoleModal
        isOpen={Boolean(staffRoleTarget)}
        onClose={() => setStaffRoleTarget(null)}
        staffMember={staffRoleTarget?.staff}
        targetRole={staffRoleTarget?.targetRole}
        isSelf={staffRoleTarget?.staff?.id === user?.id}
        onConfirm={handleConfirmStaffRole}
      />
    </div>
  );
}
