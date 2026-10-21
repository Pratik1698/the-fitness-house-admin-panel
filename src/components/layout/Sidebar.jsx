import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Dumbbell, CreditCard, UserCheck,
  AlertTriangle, Bell, PhoneCall, BarChart3, Settings,
  LogOut, X
} from 'lucide-react';
import { useAuth } from '../../context/AppContext';

const navGroups = [
  {
    group: 'MAIN OPERATIONS',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/' },
      { id: 'members', label: 'Members Directory', icon: Users, path: '/members' },
      { id: 'checkins', label: 'Check-in Desk', icon: UserCheck, path: '/checkins' },
      { id: 'payments', label: 'Payments & Dues', icon: CreditCard, path: '/payments' },
      { id: 'personal-training', label: 'Personal Training', icon: Dumbbell, path: '/personal-training' },
    ],
  },
  {
    group: 'ALERTS & TASKS',
    items: [
      { id: 'attention', label: 'Attention Required', icon: AlertTriangle, path: '/attention' },
      { id: 'notifications', label: 'Reminders & SMS', icon: Bell, path: '/notifications' },
      { id: 'followups', label: 'Member Follow-ups', icon: PhoneCall, path: '/followups' },
    ],
  },
  {
    group: 'ANALYTICS & SYSTEM',
    items: [
      { id: 'reports', label: 'Reports & Revenue', icon: BarChart3, path: '/reports' },
      { id: 'settings', label: 'Facility Settings', icon: Settings, path: '/settings' },
    ],
  },
];

export function Sidebar({ isOpen, onToggle }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, role, logout } = useAuth();

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleNav = (path) => {
    navigate(path);
    if (window.innerWidth < 1024) onToggle?.();
  };

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 lg:hidden transition-opacity"
          onClick={onToggle}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Panel */}
      <aside
        className={`fixed top-0 bottom-0 left-0 w-64 bg-white border-r border-[#E1E6E9] z-50 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Area */}
        <div className="h-[68px] px-5 flex items-center justify-between border-b border-[#E1E6E9] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#E8F5EE] border border-[#16845B]/20 text-[#16845B] flex items-center justify-center shrink-0">
              <Dumbbell size={18} strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="text-sm font-bold text-[#25313B] tracking-tight leading-none">
                THE FITNESS HOUSE
              </h1>
              <p className="text-[11px] font-medium text-[#64717B] mt-1">
                Gym Management · Arag
              </p>
            </div>
          </div>

          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg hover:bg-[#F5F7F8] text-[#64717B] lg:hidden cursor-pointer"
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3.5 py-4 overflow-y-auto space-y-6">
          {navGroups.map((group, groupIdx) => (
            <div key={groupIdx} className="space-y-1">
              <p className="px-3 text-[11px] font-bold text-[#64717B] uppercase tracking-wider mb-2">
                {group.group}
              </p>
              {group.items.map((item) => {
                const active = isActive(item.path);
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNav(item.path)}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 cursor-pointer text-left ${
                      active
                        ? 'bg-[#E8F5EE] text-[#16845B] font-semibold shadow-xs'
                        : 'text-[#64717B] hover:bg-[#F5F7F8] hover:text-[#25313B]'
                    }`}
                  >
                    <Icon size={18} strokeWidth={active ? 2.2 : 1.75} className="shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Admin Profile Footer */}
        <div className="p-3 border-t border-[#E1E6E9] shrink-0 bg-white">
          <div className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-[#F5F7F8] transition-colors">
            <div className="w-9 h-9 rounded-full bg-[#16845B] text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
              {user?.email ? user.email.charAt(0).toUpperCase() : (role === 'admin' ? 'A' : 'S')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#25313B] truncate leading-tight">
                {user?.user_metadata?.full_name || (role ? (role === 'admin' ? 'Administrator' : 'Staff') : 'Staff')}
              </p>
              <p className="text-xs text-[#64717B] truncate">
                {user?.email || 'pravinjoshi2707@gmail.com'}
              </p>
            </div>
            <button
              onClick={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
              className="p-1.5 rounded-lg hover:bg-[#FCE9E9] text-[#64717B] hover:text-[#B42318] transition-colors cursor-pointer shrink-0"
              title="Logout"
              aria-label="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
