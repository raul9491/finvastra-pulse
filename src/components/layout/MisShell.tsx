import type { ElementType } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import {
  LayoutDashboard, FileText, GitMerge, IndianRupee, Settings, LogOut, LayoutGrid, BarChart3,
} from 'lucide-react';
import { auth } from '../../lib/firebase';
import { useAuth } from '../../features/auth/AuthContext';
import { VastraLogo } from '../VastraLogo';

type NavEntry = { path: string; label: string; icon: ElementType; adminOnly: boolean };

const NAV: NavEntry[] = [
  { path: '/mis/overview',            label: 'Dashboard',      icon: BarChart3,       adminOnly: false },
  { path: '/mis/statements',          label: 'Statements',     icon: FileText,        adminOnly: false },
  { path: '/mis/reconciliation',      label: 'Reconciliation', icon: GitMerge,        adminOnly: false },
  { path: '/mis/payouts',             label: 'RM Payouts',     icon: IndianRupee,      adminOnly: false },
  { path: '/mis/admin/payout-slabs',  label: 'Payout Slabs',   icon: Settings,        adminOnly: true  },
];

const PAGE_TITLES: Record<string, string> = {
  '/mis/overview':           'MIS Overview',
  '/mis/statements':         'Commission Statements',
  '/mis/statements/upload':  'Upload Statement',
  '/mis/reconciliation':     'Reconciliation',
  '/mis/payouts':            'RM Payouts',
  '/mis/payouts/generate':   'Generate Payouts',
  '/mis/admin/payout-slabs': 'Payout Slabs',
};

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAFAF7' }}>
      <VastraLogo size="lg" iconOnly />
    </div>
  );
}

export function MisShell() {
  const { user, profile, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;

  const canAccess = profile?.role === 'admin' || profile?.misAccess != null;
  if (!canAccess) return <Navigate to="/" replace />;

  const isMisAdmin = profile?.role === 'admin' || profile?.misAccess === 'admin';
  const isViewer   = profile?.misAccess === 'viewer';

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login', { replace: true });
  };

  const pageTitle = PAGE_TITLES[location.pathname] ?? 'MIS · Finance';

  const initials = profile?.displayName
    ? profile.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  // Only show adminOnly items to mis admins (and platform admins)
  const visibleNav = NAV.filter((entry) => !entry.adminOnly || isMisAdmin);

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#FAFAF7' }}>

      {/* ── Sidebar ── */}
      <nav
        className="w-60 flex flex-col shrink-0"
        style={{ backgroundColor: '#0B1538', borderRight: '1px solid #1B2A4E' }}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 shrink-0" style={{ borderBottom: '1px solid #1B2A4E' }}>
          <VastraLogo size="sm" light />
        </div>

        {/* Module label */}
        <div className="px-5 pt-5 pb-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: '#C9A961' }}>
            MIS · Finance
          </p>
        </div>

        {/* Nav */}
        <div className="flex-1 px-2 space-y-0.5 overflow-y-auto pb-4">
          {visibleNav.map(({ path, label, icon: Icon }) => (
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
              <span className="text-sm">{label}</span>
            </NavLink>
          ))}
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

        {/* Viewer banner */}
        {isViewer && (
          <div className="px-8 pt-4 pb-0">
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
              👁 View only — contact your MIS admin to make changes
            </div>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-8" style={{ backgroundColor: '#FAFAF7' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
