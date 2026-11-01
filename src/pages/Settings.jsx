import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Select, Textarea } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { PT_PACKAGES } from '../data/sampleData';
import {
  Building2, CreditCard, Dumbbell, Bell, Shield, User,
  Check, Save, Clock, Phone, Mail, MapPin, Plus, Lock, Key,
  AlertCircle, Loader2,
} from 'lucide-react';
import { ChangePasswordModal } from '../components/auth/ChangePasswordModal';

export default function Settings() {
  const {
    gymInfo, updateGymInfo, gymInfoLoading, gymInfoError, gymInfoMigrationPending, refreshGymInfo,
    user, role,
    membershipPlans, plansLoading, plansError, reloadPlans,
    isSupabaseConfigured,
  } = useApp();

  const [activeSection, setActiveSection] = useState('gym');
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

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

  // Notification toggles (demo state preserved)
  const [reminders, setReminders] = useState({
    fiveDay: true,
    threeDay: true,
    oneDay: true,
    expiryDay: true,
    paymentAlerts: true,
    autoWhatsApp: true,
    smsFallback: true,
  });

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
                <Button size="sm" onClick={() => alert('New plan configuration modal (Demo preview)')} icon={Plus}>
                  Add Plan
                </Button>
              </CardHeader>

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
                          Loading membership plans from database...
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
                    ) : membershipPlans.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-xs text-[#64717B]">
                          No active membership plans found in database.
                        </td>
                      </tr>
                    ) : (
                      membershipPlans.map(p => (
                        <tr key={p.id} className="hover:bg-[#F5F7F8]/50">
                          <td className="px-4 py-3 font-semibold text-[#25313B]">{p.name}</td>
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
                            <Button variant="ghost" size="sm" onClick={() => alert(`Edit plan ${p.name}`)}>Edit</Button>
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
                    Trainer packages with session limits and validity caps.
                  </CardDescription>
                </div>
                <Button size="sm" onClick={() => alert('New PT package configuration modal (Demo preview)')} icon={Plus}>
                  Add PT Package
                </Button>
              </CardHeader>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                {PT_PACKAGES.map(pkg => (
                  <div key={pkg.id} className="p-4 rounded-xl border border-[#E1E6E9] bg-white flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="success">Active Tier</Badge>
                        <span className="text-xs text-[#64717B] font-medium">{pkg.validity} days validity</span>
                      </div>
                      <h4 className="text-base font-bold text-[#25313B]">{pkg.name}</h4>
                      <p className="text-xs text-[#64717B] mt-1">{pkg.sessions} one-on-one guided sessions</p>
                      <p className="text-2xl font-bold text-[#16845B] mt-3">₹{pkg.price.toLocaleString()}</p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-[#E1E6E9] flex items-center justify-between">
                      <span className="text-xs text-[#64717B]">₹{Math.round(pkg.price / pkg.sessions)} / session</span>
                      <Button variant="secondary" size="sm" onClick={() => alert(`Edit ${pkg.name}`)}>
                        Edit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
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
                <Button size="sm" onClick={() => alert('Reminder preferences saved successfully!')} icon={Save}>
                  Save Preferences
                </Button>
              </CardHeader>

              <div className="space-y-4 mt-4">
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#64717B]">Expiry Alert Schedule</h4>

                  {[
                    { key: 'fiveDay', label: '5 Days Before Expiry', desc: 'Send first courtesy reminder via WhatsApp' },
                    { key: 'threeDay', label: '3 Days Before Expiry', desc: 'Send renewal prompt with current fee details' },
                    { key: 'oneDay', label: '1 Day Before Expiry', desc: 'Urgent final alert before facility pass expires' },
                    { key: 'expiryDay', label: 'On Expiry Date', desc: 'Send expiration notice and reactivation link' },
                  ].map(item => (
                    <div key={item.key} className="flex items-center justify-between p-3 rounded-lg border border-[#E1E6E9] bg-white">
                      <div>
                        <p className="text-sm font-semibold text-[#25313B]">{item.label}</p>
                        <p className="text-xs text-[#64717B]">{item.desc}</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={reminders[item.key]}
                          onChange={(e) => setReminders({ ...reminders, [item.key]: e.target.checked })}
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
                      <p className="text-sm font-semibold text-[#25313B]">Auto-Send via WhatsApp Business</p>
                      <p className="text-xs text-[#64717B]">Deliver verified messages to members with high open rate</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reminders.autoWhatsApp}
                        onChange={(e) => setReminders({ ...reminders, autoWhatsApp: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#16845B]" />
                    </label>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border border-[#E1E6E9] bg-white">
                    <div>
                      <p className="text-sm font-semibold text-[#25313B]">Transactional SMS Fallback</p>
                      <p className="text-xs text-[#64717B]">Dispatch SMS if WhatsApp message is unacknowledged after 6 hours</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reminders.smsFallback}
                        onChange={(e) => setReminders({ ...reminders, smsFallback: e.target.checked })}
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

                {/* Staff roles placeholder */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="text-sm font-semibold text-[#25313B]">Staff Accounts & Permissions</h4>
                      <p className="text-xs text-[#64717B]">Role-based access for desk staff and trainers</p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => alert('Invite Staff Member (Demo preview)')} icon={Plus}>
                      Add Staff
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 rounded-lg border border-[#E1E6E9] bg-[#F5F7F8]">
                      <div>
                        <p className="text-sm font-semibold text-[#25313B]">Coach Pravin Joshi (Head Coach & Owner)</p>
                        <p className="text-xs text-[#64717B]">pravinjoshi2707@gmail.com · Permissions: Full Access, PT Management</p>
                      </div>
                      <Badge variant="default">Coach & Owner</Badge>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg border border-[#E1E6E9] bg-[#F5F7F8]">
                      <div>
                        <p className="text-sm font-semibold text-[#25313B]">Front Desk Arag (Reception)</p>
                        <p className="text-xs text-[#64717B]">pravinjoshi2707@gmail.com · Permissions: Check-ins, Member Lookup</p>
                      </div>
                      <Badge variant="default">Front Desk</Badge>
                    </div>
                  </div>
                </div>
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
    </div>
  );
}
