import { useState, useEffect, type ElementType } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { AnimatePresence, motion } from 'motion/react';
import {
  LayoutDashboard, FileText, GitMerge, IndianRupee, Settings, LogOut, LayoutGrid, BarChart3,
  Menu, X,
} from 'lucide-react';
import { auth } from '../../lib/firebase';
import { useAuth } from '../../features/auth/AuthContext';
import { VideoLogo } from '../ui/VideoLogo';

type NavEntry = { path: string; label: string; icon: ElementType; adminOnly: boolean };

const NAV: NavEntry[] = [
  { path: '/mis/overview',            label: 'Dashboard',      icon: BarChart3,       adminOnly: false },
  { path: '/mis/statements',          label: 'Statements',     icon: FileText,        adminOnly: false },
  { path: '/mis/reconciliation',      label: 'Reconciliation', icon: GitMerge,        adminOnly: false },
  { path: '/mis/payouts',             label: 'RM Payouts',     icon: IndianRupee,      adminOnly: false },
  { path: '/mis/admin/payout-slabs',  label: 'Payout Slabs',   icon: Settings,        adminOnly: true  },
];

function resolveMisTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (/^\/mis\/statements\/[^/]+$/.test(pathname)) return 'Statement Detail';
  if (/^\/mis\/payouts\/[^/]+$/.test(pathname)) return 'Payout Detail';
  return 'MIS · Finance';
}

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
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--navy-deep)' }}>
      <VideoLogo size="sm" showText={false} />
    </div>
  );
}

export function MisShell() {
  const { user, profile, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Mobile nav drawer state
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.mustResetPassword) return <Navigate to="/reset-password" replace />;

  const canAccess = profile?.role === 'admin' || profile?.misAccess != null;
  if (!canAccess) return <Navigate to="/" replace />;

  const isMisAdmin = profile?.role === 'admin' || profile?.misAccess === 'admin';
  const isViewer   = profile?.misAccess === 'viewer';

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login', { replace: true });
  };

  const pageTitle = resolveMisTitle(location.pathname);

  const initials = profile?.displayName
    ? profile.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  // Only show adminOnly items to mis admins (and platform admins)
  const visibleNav = NAV.filter((entry) => !entry.adminOnly || isMisAdmin);

  // ── Shared nav scroll body ────────────────────────────────────────────────────
  const navBody = (
    <div className="flex-1 px-2 space-y-0.5 overflow-y-auto pb-4">
      {visibleNav.map(({ path, label, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          end
          className={({ isActive }) =>
            `flex items-center gap-3 py-2.5 rounded-lg transition-colors ${isActive ? 'pl-2.5 border-l-2' : 'pl-3 hover:bg-[rgba(255,255,255,0.04)]'}`
          }
          style={({ isActive }) =>
            isActive
              ? { backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961', borderColor: '#C9A961' }
              : { color: 'rgba(240,236,224,0.45)' }
          }
        >
          <Icon size={17} className="shrink-0" />
          <span className="text-sm">{label}</span>
        </NavLink>
      ))}
    </div>
  );

  // ── User footer ───────────────────────────────────────────────────────────────
  const userFooter = (
    <div className="p-4 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center gap-3">
        {profile?.photoURL ? (
          <img src={profile.photoURL} alt={profile.displayName} className="w-8 h-8 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{profile?.displayName}</p>
          <p className="text-[10px] uppercase tracking-widest truncate" style={{ color: 'rgba(240,236,224,0.35)' }}>{profile?.role}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--navy-deep)' }}>

      {/* ── Desktop Sidebar — hidden on mobile ── */}
      <nav
        className="hidden md:flex md:flex-col w-60 shrink-0 glass-sidebar"
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <VideoLogo size="xs" showText={true} />
        </div>

        {/* Module label */}
        <div className="px-5 pt-5 pb-3">
          <p className="glass-module-label font-bold">
            MIS · Finance
          </p>
        </div>

        {navBody}
        {userFooter}
      </nav>

      {/* ── Mobile slide-out drawer ── */}
      <AnimatePresence>
        {mobileNavOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileNavOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 w-60 z-50 md:hidden flex flex-col glass-sidebar"
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <div className="h-16 flex items-center justify-between px-4 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <VideoLogo size="xs" showText={true} />
                <button
                  onClick={() => setMobileNavOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                  aria-label="Close navigation menu"
                >
                  <X size={18} style={{ color: 'rgba(240,236,224,0.45)' }} />
                </button>
              </div>

              <div className="px-5 pt-5 pb-3">
                <p className="glass-module-label font-bold">
                  MIS · Finance
                </p>
              </div>

              {navBody}
              {userFooter}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top nav */}
        <header className="h-16 glass-header flex items-center justify-between px-4 sm:px-6 shrink-0">
          {/* Left: hamburger (mobile) + module switcher + page title */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Hamburger — mobile only */}
            <button
              className="md:hidden p-2 -ml-1 rounded-lg hover:bg-white/10 transition-colors shrink-0"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={20} style={{ color: 'rgba(240,236,224,0.70)' }} />
            </button>

            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors hover:bg-white/10 shrink-0"
              style={{ color: 'rgba(240,236,224,0.45)' }}
              title="Back to launcher"
            >
              <LayoutGrid size={14} />
              <span className="hidden sm:block">Apps</span>
            </button>
            <div className="w-px h-4 hidden sm:block shrink-0" style={{ backgroundColor: 'rgba(255,255,255,0.10)' }} />
            <h1 className="text-base font-semibold truncate min-w-0" style={{ color: 'var(--text-primary)' }}>{pageTitle}</h1>
          </div>

          {/* Right: user + sign out */}
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {profile?.photoURL ? (
              <img src={profile.photoURL} alt={profile.displayName} className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
                {initials}
              </div>
            )}
            <span className="text-sm font-medium hidden sm:block" style={{ color: 'var(--text-primary)' }}>
              {profile?.displayName}
            </span>
            <div className="w-px h-5 hidden sm:block" style={{ backgroundColor: 'rgba(255,255,255,0.10)' }} />
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-60"
              style={{ color: 'rgba(240,236,224,0.45)' }}
              title="Sign out"
            >
              <LogOut size={15} />
              <span className="hidden sm:block">Sign out</span>
            </button>
          </div>
        </header>

        {/* Viewer banner */}
        {isViewer && (
          <div className="px-4 sm:px-8 pt-4 pb-0">
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'rgba(201,169,97,0.08)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.18)' }}>
              👁 View only — contact your MIS admin to make changes
            </div>
          </div>
        )}

        {/* Page content — fades in on route change */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8" style={{ backgroundColor: 'transparent' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
