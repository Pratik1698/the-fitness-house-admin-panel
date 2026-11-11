import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, Menu, ChevronRight, User, LogOut, Settings, Calendar, Key } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ChangePasswordModal } from '../auth/ChangePasswordModal';

const pageTitles = {
  '/': 'Dashboard',
  '/members': 'Members Directory',
  '/personal-training': 'Personal Training',
  '/payments': 'Payments & Transactions',
  '/checkins': 'Check-in Desk',
  '/attention': 'Attention Required',
  '/notifications': 'Reminders & Messaging',
  '/followups': 'Member Follow-ups',
  '/reports': 'Reports & Analytics',
  '/settings': 'Facility Settings',
  '/login': 'Login',
};

export function TopNav({ onMenuToggle }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { members, notifications, user, role, logout } = useApp();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const searchRef = useRef(null);
  const profileRef = useRef(null);

  const pageTitle = pageTitles[location.pathname] ||
    (location.pathname.startsWith('/members/') ? 'Member Profile' : 'Overview');

  const breadcrumbs = location.pathname === '/'
    ? [{ label: 'Dashboard' }]
    : [
        { label: 'Dashboard', path: '/' },
        ...location.pathname.split('/').filter(Boolean).map((seg, i, arr) => ({
          label: seg.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          path: '/' + arr.slice(0, i + 1).join('/'),
        }))
      ];

  const todayFormatted = new Date().toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  });

  // Global search lookup
  const searchResults = searchQuery.trim().length >= 2
    ? members.filter(m =>
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.phone.includes(searchQuery)
      ).slice(0, 5)
    : [];

  // Click outside listener
  useEffect(() => {
    const handleClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-[#E1E6E9] h-[68px] flex items-center">
      <div className="w-full px-4 lg:px-8 flex items-center justify-between">
        {/* Left Side: Mobile Menu + Title & Breadcrumb */}
        <div className="flex items-center gap-3.5">
          <button
            onClick={onMenuToggle}
            className="p-2 rounded-xl hover:bg-[#F5F7F8] text-[#64717B] lg:hidden cursor-pointer"
            aria-label="Open sidebar"
          >
            <Menu size={20} />
          </button>

          <div>
            <div className="flex items-center gap-1.5 text-xs text-[#64717B]">
              {breadcrumbs.map((bc, idx) => (
                <span key={idx} className="flex items-center gap-1.5">
                  {idx > 0 && <ChevronRight size={12} className="text-[#CBD5E1]" />}
                  {bc.path && idx < breadcrumbs.length - 1 ? (
                    <button
                      onClick={() => navigate(bc.path)}
                      className="hover:text-[#16845B] transition-colors cursor-pointer"
                    >
                      {bc.label}
                    </button>
                  ) : (
                    <span className="font-medium text-[#25313B]">{bc.label}</span>
                  )}
                </span>
              ))}
            </div>
            <h2 className="text-lg font-bold text-[#25313B] tracking-tight leading-tight mt-0.5">
              {pageTitle}
            </h2>
          </div>
        </div>

        {/* Right Side: Search + Date + Notification + Admin Menu */}
        <div className="flex items-center gap-3">
          {/* Quick Search */}
          <div ref={searchRef} className="relative">
            <div className="relative">
              <input
                type="text"
                placeholder="Search member, ID, or phone..."
                value={searchQuery}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                className="hidden sm:block w-64 lg:w-72 pl-9 pr-3.5 py-2 text-xs border border-[#E1E6E9] rounded-xl bg-[#F5F7F8] text-[#25313B] placeholder-[#64717B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] transition-all"
              />
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64717B] pointer-events-none" />
            </div>

            {/* Mobile search trigger */}
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className="sm:hidden p-2 rounded-xl hover:bg-[#F5F7F8] text-[#64717B] cursor-pointer"
              aria-label="Toggle member search"
            >
              <Search size={18} />
            </button>

            {/* Search Dropdown Results */}
            {searchOpen && searchQuery.length >= 2 && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl border border-[#E1E6E9] shadow-xl overflow-hidden z-50">
                <div className="p-3 bg-[#F5F7F8] border-b border-[#E1E6E9] text-[11px] font-semibold text-[#64717B] uppercase tracking-wider">
                  Member Matches
                </div>
                {searchResults.length > 0 ? (
                  <div className="divide-y divide-[#E1E6E9] max-h-64 overflow-y-auto">
                    {searchResults.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          navigate(`/members/${m.id}`);
                          setSearchOpen(false);
                          setSearchQuery('');
                        }}
                        className="w-full flex items-center justify-between p-3 hover:bg-[#E8F5EE]/40 text-left transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-[#E8F5EE] text-[#16845B] font-bold text-xs flex items-center justify-center shrink-0">
                            {m.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-[#25313B]">{m.name}</p>
                            <p className="text-[11px] text-[#64717B]">{m.id} · {m.phone}</p>
                          </div>
                        </div>
                        <span className="text-[11px] font-medium text-[#16845B]">{m.plan}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-xs text-[#64717B]">
                    No members found matching "{searchQuery}"
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Current Date Badge */}
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F5F7F8] border border-[#E1E6E9] text-xs font-medium text-[#64717B]">
            <Calendar size={13} className="text-[#16845B]" />
            <span>{todayFormatted}</span>
          </div>

          {/* Notification Bell */}
          {(() => {
            const unreadCount = (notifications || []).filter(
              n => n.status === 'unread' || (!n.isRead && n.status !== 'read')
            ).length;
            return (
              <button
                onClick={() => navigate('/notifications')}
                className="relative p-2 rounded-xl hover:bg-[#F5F7F8] text-[#64717B] hover:text-[#25313B] transition-colors cursor-pointer"
                title={`Notifications & Alerts (${unreadCount} unread)`}
                aria-label="Notifications"
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#B42318] text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            );
          })()}

          {/* Administrator Profile Menu */}
          <div ref={profileRef} className="relative">
            <button
              onClick={() => setProfileOpen(!profileOpen)}
              className="flex items-center gap-2 p-1 rounded-xl hover:bg-[#F5F7F8] transition-colors cursor-pointer"
              aria-label="User menu"
            >
              <div className="w-8 h-8 rounded-full bg-[#16845B] text-white flex items-center justify-center text-xs font-bold shadow-xs">
                {user?.email ? user.email.charAt(0).toUpperCase() : (role === 'admin' ? 'A' : 'S')}
              </div>
            </button>

            {profileOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl border border-[#E1E6E9] shadow-xl overflow-hidden py-1.5 z-50 animate-in">
                <div className="px-4 py-3 border-b border-[#E1E6E9] bg-[#F5F7F8]/50">
                  <div className="flex items-center justify-between gap-1.5">
                    <p className="text-xs font-bold text-[#25313B] truncate">
                      {user?.user_metadata?.full_name || (role ? (role === 'admin' ? 'Administrator' : 'Staff Member') : 'Team Member')}
                    </p>
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-[#E8F5EE] text-[#16845B] shrink-0">
                      {role || 'staff'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#64717B] truncate mt-0.5">{user?.email || 'pravinjoshi2707@gmail.com'}</p>
                </div>

                <div className="p-1">
                  <button
                    onClick={() => { navigate('/settings'); setProfileOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-[#25313B] rounded-lg hover:bg-[#F5F7F8] transition-colors cursor-pointer"
                  >
                    <Settings size={15} className="text-[#64717B]" />
                    Facility Settings
                  </button>
                  <button
                    onClick={() => { navigate('/notifications'); setProfileOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-[#25313B] rounded-lg hover:bg-[#F5F7F8] transition-colors cursor-pointer"
                  >
                    <Bell size={15} className="text-[#64717B]" />
                    Notification Logs
                  </button>
                  <button
                    onClick={() => { setChangePasswordOpen(true); setProfileOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-[#25313B] rounded-lg hover:bg-[#F5F7F8] transition-colors cursor-pointer"
                  >
                    <Key size={15} className="text-[#64717B]" />
                    Change Password
                  </button>
                </div>

                <div className="p-1 border-t border-[#E1E6E9]">
                  <button
                    onClick={async () => {
                      setProfileOpen(false);
                      await logout();
                      navigate('/login', { replace: true });
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-[#B42318] rounded-lg hover:bg-[#FCE9E9] transition-colors cursor-pointer"
                  >
                    <LogOut size={15} />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Self-Service Change Password Modal */}
      <ChangePasswordModal
        isOpen={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />
    </header>
  );
}
