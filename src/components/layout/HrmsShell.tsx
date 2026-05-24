import { type ElementType, useState, useEffect } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import {
  LayoutDashboard, Users, Clock, CalendarOff, Receipt, CalendarDays,
  Settings, LogOut, LayoutGrid, ClipboardList, FileText, ShieldCheck, UserPlus, Inbox,
  ReceiptText, FolderOpen, Megaphone,
} from 'lucide-react';
import { auth, db } from '../../lib/firebase';
import { useAuth } from '../../features/auth/AuthContext';
import { VideoLogo } from '../ui/VideoLogo';
import { useUnreadAnnouncementCount } from '../../features/hrms/hooks/useAnnouncements';

function usePendingRequestCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(collection(db, 'access_requests'), where('status', '==', 'pending')),
      (snap) => setCount(snap.size),
      () => setCount(0),
    );
  }, [enabled]);
  return count;
}

type NavEntry = { path: string; label: string; icon: ElementType; live: boolean };

const NAV: NavEntry[] = [
  { path: '/hrms/dashboard',      label: 'Dashboard',      icon: LayoutDashboard, live: true },
  { path: '/hrms/employees',      label: 'Employees',      icon: Users,           live: true },
  { path: '/hrms/attendance',     label: 'Attendance',     icon: Clock,           live: true },
  { path: '/hrms/leave',          label: 'Leave',          icon: CalendarOff,     live: true },
  { path: '/hrms/payslips',       label: 'Payslips',       icon: Receipt,         live: true },
  { path: '/hrms/holidays',       label: 'Holidays',       icon: CalendarDays,    live: true },
  { path: '/hrms/claims',         label: 'My Claims',      icon: ReceiptText,     live: true },
  { path: '/hrms/documents',      label: 'Documents',      icon: FolderOpen,      live: true },
  { path: '/hrms/announcements',  label: 'Announcements',  icon: Megaphone,       live: true },
  { path: '/hrms/settings',       label: 'Settings',       icon: Settings,        live: true },
];

const ADMIN_NAV: NavEntry[] = [
  { path: '/hrms/admin/access-requests',   label: 'Access Requests',      icon: Inbox,         live: true },
  { path: '/hrms/admin/access',            label: 'Access & Permissions', icon: ShieldCheck,   live: true },
  { path: '/hrms/admin/import-employees',  label: 'Import Employees',     icon: UserPlus,      live: true },
  { path: '/hrms/admin/attendance',        label: 'Attendance',           icon: Clock,         live: true },
  { path: '/hrms/leave/admin',             label: 'Leave Approvals',      icon: ClipboardList, live: true },
  { path: '/hrms/admin/holidays',          label: 'Manage Holidays',      icon: CalendarDays,  live: true },
  { path: '/hrms/admin/payslips',          label: 'Generate Payslips',    icon: FileText,      live: true },
  { path: '/hrms/admin/claims',            label: 'Claims',               icon: ReceiptText,   live: true },
  { path: '/hrms/admin/documents',         label: 'Documents',            icon: FolderOpen,    live: true },
  { path: '/hrms/admin/announcements',     label: 'Announcements',        icon: Megaphone,     live: true },
];

const PAGE_TITLES: Record<string, string> = {
  '/hrms/dashboard':             'Dashboard',
  '/hrms/employees':             'Employees',
  '/hrms/attendance':            'Attendance',
  '/hrms/leave':                 'Leave',
  '/hrms/leave/apply':           'Apply for Leave',
  '/hrms/payslips':              'Payslips',
  '/hrms/holidays':              'Holidays',
  '/hrms/claims':                'My Claims',
  '/hrms/documents':             'Documents',
  '/hrms/announcements':         'Announcements',
  '/hrms/settings':              'Settings',
  '/hrms/admin/access-requests': 'Access Requests',
  '/hrms/admin/access':          'Access & Permissions',
  '/hrms/admin/import-employees':'Import Employees',
  '/hrms/admin/attendance':      'Attendance — Admin',
  '/hrms/leave/admin':           'Leave Approvals',
  '/hrms/admin/holidays':        'Holidays — Admin',
  '/hrms/admin/payslips':        'Generate Payslips',
  '/hrms/admin/claims':          'Claims — Admin',
  '/hrms/admin/documents':       'Documents — Admin',
  '/hrms/admin/announcements':   'Announcements — Admin',
};

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAFAF7' }}>
      <VideoLogo size="sm" showText={false} />
    </div>
  );
}

export function HrmsShell() {
  const { user, profile, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.mustResetPassword) return <Navigate to="/reset-password" replace />;

  const canAccess = profile?.role === 'admin' || profile?.hrmsAccess !== false;
  if (!canAccess) return <Navigate to="/" replace />;

  const isAdmin = profile?.role === 'admin';
  const isHrmsManager = profile?.isHrmsManager === true;

  const pendingRequests = usePendingRequestCount(isAdmin);
  const unreadAnnouncements = useUnreadAnnouncementCount(user?.uid ?? '');
  const onAccessRequestsPage = location.pathname === '/hrms/admin/access-requests';

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login', { replace: true });
  };

  const pageTitle = PAGE_TITLES[location.pathname]
    ?? (/^\/hrms\/employees\/[^/]+$/.test(location.pathname) ? 'Employee Profile' : 'HR & Operations');

  const initials = profile?.displayName
    ? profile.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#FAFAF7' }}>

      {/* ── Sidebar ── */}
      <nav
        className="w-60 flex flex-col shrink-0"
        style={{ backgroundColor: '#0B1538', borderRight: '1px solid #1B2A4E' }}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 shrink-0" style={{ borderBottom: '1px solid #1B2A4E' }}>
          <VideoLogo size="xs" showText={true} />
        </div>

        {/* Module label */}
        <div className="px-5 pt-5 pb-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: '#C9A961' }}>
            HR &amp; Operations
          </p>
        </div>

        {/* Nav */}
        <div className="flex-1 px-2 space-y-0.5 overflow-y-auto pb-4">
          {NAV.map(({ path, label, icon: Icon }) => {
            const badge = path === '/hrms/announcements' ? unreadAnnouncements : 0;
            return (
              <NavLink
                key={path}
                to={path}
                end
                className={({ isActive }) =>
                  `flex items-center gap-3 py-2.5 rounded-lg transition-colors ${isActive ? 'pl-2.5 border-l-2' : 'pl-3'}`
                }
                style={({ isActive }) =>
                  isActive
                    ? { backgroundColor: '#1B2A4E', color: '#FFFFFF', borderColor: '#C9A961' }
                    : { color: '#94A3B8' }
                }
              >
                <Icon size={17} className="shrink-0" />
                <span className="text-sm flex-1">{label}</span>
                {badge > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full mr-1 leading-none"
                    style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                    {badge}
                  </span>
                )}
              </NavLink>
            );
          })}

          {(isAdmin || isHrmsManager) && (
            <>
              <div className="px-3 pt-4 pb-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: '#475569' }}>Admin</p>
              </div>
              {ADMIN_NAV.map(({ path, label, icon: Icon }) => {
                const badge = path === '/hrms/admin/access-requests' && !onAccessRequestsPage
                  ? pendingRequests : 0;
                return (
                  <NavLink key={path} to={path} end
                    className={({ isActive }) =>
                      `flex items-center gap-3 py-2.5 rounded-lg transition-colors ${isActive ? 'pl-2.5 border-l-2' : 'pl-3'}`
                    }
                    style={({ isActive }) =>
                      isActive
                        ? { backgroundColor: '#1B2A4E', color: '#FFFFFF', borderColor: '#C9A961' }
                        : { color: '#94A3B8' }
                    }
                  >
                    <Icon size={17} className="shrink-0" />
                    <span className="text-sm flex-1">{label}</span>
                    {badge > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full mr-1 leading-none"
                        style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}>
                        {badge}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </>
          )}
        </div>

        {/* User footer */}
        <div className="p-4 shrink-0" style={{ borderTop: '1px solid #1B2A4E' }}>
          <div className="flex items-center gap-3">
            {profile?.photoURL ? (
              <img src={profile.photoURL} alt={profile.displayName} className="w-8 h-8 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{ backgroundColor: '#1B2A4E', color: '#C9A961' }}>
                {initials}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: '#FFFFFF' }}>{profile?.displayName}</p>
              <p className="text-[10px] uppercase tracking-widest truncate" style={{ color: '#475569' }}>{profile?.role}</p>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top nav */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
          {/* Left: module switcher + page title */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors hover:bg-slate-100"
              style={{ color: '#8B8B85' }}
              title="Back to launcher"
            >
              <LayoutGrid size={14} />
              <span>Apps</span>
            </button>
            <div className="w-px h-4 bg-slate-200" />
            <h1 className="text-base font-semibold" style={{ color: '#0A0A0A' }}>{pageTitle}</h1>
          </div>

          {/* Right: user + sign out */}
          <div className="flex items-center gap-4">
            {profile?.photoURL ? (
              <img src={profile.photoURL} alt={profile.displayName} className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                {initials}
              </div>
            )}
            <span className="text-sm font-medium hidden sm:block" style={{ color: '#2A2A2A' }}>
              {profile?.displayName}
            </span>
            <div className="w-px h-5 bg-slate-200" />
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-60"
              style={{ color: '#8B8B85' }}
              title="Sign out"
            >
              <LogOut size={15} />
              <span className="hidden sm:block">Sign out</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-8" style={{ backgroundColor: '#FAFAF7' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
