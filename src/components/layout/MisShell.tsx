import { useState, useEffect, type ElementType } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { AnimatePresence, motion } from 'motion/react';
import {
  LayoutDashboard, FileText, GitMerge, IndianRupee, Settings, LogOut, LayoutGrid, BarChart3,
  Menu, X, User, AlertTriangle, GraduationCap,
} from 'lucide-react';
import { useOpenDisputeCount } from '../../features/mis/hooks/useDisputes';
import { useAutoStartTour } from '../../features/learn/useTour';
import { MobileTabBar } from '../ui/MobileTabBar';
import { auth } from '../../lib/firebase';
import { useAuth } from '../../features/auth/AuthContext';
import { VideoLogo } from '../ui/VideoLogo';
import { ThemeToggle, useTheme } from '../ui/ThemeProvider';
import { UserMenu } from '../ui/UserMenu';
import { AppsMenu } from '../ui/AppsMenu';
import { CommandPalette, CommandSearchButton } from '../ui/CommandPalette';
import { ModuleSidebar } from './ModuleSidebar';
import { buildNavCtx } from '../../config/navigation';
import { SharePageButton } from '../ui/SharePageButton';
import { SharedNavSection, locationCoveredByShares } from './SharedNavSection';
import { useMyShares } from '../../features/auth/hooks/useMyShares';
import { resolvePageKey } from '../../config/shareablePages';

type NavEntry = { path: string; label: string; icon: ElementType; adminOnly: boolean; dataTour?: string; section?: 'archive' };

const NAV: NavEntry[] = [
  // CRM 2.0 financial pages (primary) — moved here from the CRM Pipeline group.
  { path: '/mis/cases-mis',           label: 'Case Financials', icon: BarChart3,      adminOnly: false, dataTour: 'mis-overview' },
  { path: '/mis/recon',               label: 'Reconciliation', icon: GitMerge,        adminOnly: false, dataTour: 'mis-reconciliation' },
  { path: '/mis/payout-cycles',       label: 'Payout Cycles',  icon: IndianRupee,     adminOnly: false },
  { path: '/mis/learn',               label: 'Learn',          icon: GraduationCap,   adminOnly: false, dataTour: 'learn' },
  // Archive — old-CRM MIS + commissions (kept for reference; CRM 2.0 supersedes).
  { path: '/mis/overview',            label: 'Overview',       icon: BarChart3,       adminOnly: false, section: 'archive', dataTour: 'mis-overview' },
  { path: '/mis/statements',          label: 'Statements',     icon: FileText,        adminOnly: false, section: 'archive', dataTour: 'mis-statements' },
  { path: '/mis/reconciliation',      label: 'Reconciliation', icon: GitMerge,        adminOnly: false, section: 'archive' },
  { path: '/mis/disputes',            label: 'Disputes',       icon: AlertTriangle,   adminOnly: false, section: 'archive', dataTour: 'mis-disputes' },
  { path: '/mis/payouts',             label: 'RM Payouts',     icon: IndianRupee,     adminOnly: false, section: 'archive', dataTour: 'mis-payouts' },
  { path: '/mis/commissions',         label: 'Commissions',    icon: IndianRupee,     adminOnly: false, section: 'archive' },
  { path: '/mis/admin/payout-slabs',  label: 'Payout Slabs',   icon: Settings,        adminOnly: true,  section: 'archive' },
  { path: '/mis/admin/statement-templates', label: 'Statement Templates', icon: Settings, adminOnly: true, section: 'archive' },
];

function resolveMisTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (/^\/mis\/statements\/[^/]+$/.test(pathname)) return 'Statement Detail';
  if (/^\/mis\/payouts\/[^/]+$/.test(pathname)) return 'Payout Detail';
  return 'MIS · Finance';
}

const PAGE_TITLES: Record<string, string> = {
  '/mis/cases-mis':          'Case Financials',
  '/mis/recon':              'Reconciliation',
  '/mis/payout-cycles':      'Payout Cycles',
  '/mis/commissions':        'Commissions (archive)',
  '/mis/overview':           'MIS Overview',
  '/mis/statements':         'Commission Statements',
  '/mis/statements/upload':  'Upload Statement',
  '/mis/reconciliation':     'Reconciliation',
  '/mis/disputes':           'Commission Disputes',
  '/mis/learn':              'Learn MIS',
  '/mis/payouts':            'RM Payouts',
  '/mis/payouts/generate':   'Generate Payouts',
  '/mis/admin/payout-slabs': 'Payout Slabs',
  '/mis/admin/statement-templates': 'Statement Templates',
};

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--navy-deep)' }}>
      <VideoLogo size="sm" showText />
    </div>
  );
}

export function MisShell() {
  const { user, profile, loading } = useAuth();
  const { theme } = useTheme();   // wordmark needs dark text on the light-mode header
  const location = useLocation();
  const navigate = useNavigate();

  // Mobile nav drawer state
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Phase P — active page shares (exception grants for users without misAccess).
  const myShares = useMyShares(user?.uid);

  // First-run guided tour for MIS (auto-shows once, then remembered per user).
  useAutoStartTour('mis');

  // Phase P — red badge: open commission disputes.
  const openDisputes = useOpenDisputeCount(
    profile?.role === 'admin' || profile?.misAccess != null,
  );

  // Close mobile drawer on route change
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.mustResetPassword) return <Navigate to="/reset-password" replace />;

  const hasDirectAccess = profile?.role === 'admin' || profile?.misAccess != null;

  // Phase P — never redirect while shares are still loading (hard-refresh race).
  if (!hasDirectAccess && myShares.loading) return <FullPageLoader />;

  const misShares   = myShares.sharesByModule.mis;
  const isShareOnly = !hasDirectAccess && misShares.length > 0;
  const canAccess   = hasDirectAccess || isShareOnly;
  if (!canAccess) return <Navigate to="/" replace />;

  // Phase P — share-only users may open ONLY their shared pages (+ drill-downs).
  if (isShareOnly) {
    const key = resolvePageKey(location.pathname, location.search);
    if (!locationCoveredByShares(misShares, key, location.pathname)) {
      return <Navigate to={misShares[0].pageRoute} replace />;
    }
  }

  const isMisAdmin = profile?.role === 'admin' || profile?.misAccess === 'admin';
  const isViewer   = profile?.misAccess === 'viewer';

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login', { replace: true });
  };

  const pageTitle = resolveMisTitle(location.pathname);
  const navCtx = buildNavCtx(user, profile);

  const initials = profile?.displayName
    ? profile.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  // Only show adminOnly items to mis admins (and platform admins). The legacy
  // "Archive · old MIS" section (superseded by CRM 2.0) is hidden from regular
  // users to cut clutter — its routes stay live for admins who need the history.
  const visibleNav = NAV.filter((entry) =>
    (!entry.adminOnly || isMisAdmin) && (entry.section !== 'archive' || isMisAdmin));

  // ── Shared nav scroll body ────────────────────────────────────────────────────
  const navBody = (
    <div className="flex-1 px-2 space-y-0.5 overflow-y-auto pb-4">
      {isShareOnly ? (
        /* Phase P — share-only users see ONLY their shared pages */
        <SharedNavSection shares={misShares} />
      ) : (
        /* Unified registry-driven sidebar (Phase 2) */
        <>
          <ModuleSidebar
            module="mis"
            navCtx={navCtx}
            pathname={location.pathname}
            itemBadges={{ '/mis/disputes': openDisputes }}
          />
          {/* Phase P — full-access user who ALSO holds shares (edge case) */}
          <SharedNavSection shares={misShares} />
        </>
      )}
    </div>
  );

  // ── User footer ───────────────────────────────────────────────────────────────
  const userFooter = (
    <div className="p-4 shrink-0" style={{ borderTop: '1px solid var(--shell-border)' }}>
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
          <p className="text-[10px] uppercase tracking-widest truncate" style={{ color: 'var(--shell-text-dim)' }}>{profile?.role}</p>
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
        <div className="h-16 flex items-center px-4 shrink-0" style={{ borderBottom: '1px solid var(--shell-border)' }}>
          <VideoLogo size="xs" showText={true} dark={theme === 'light'} />
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
              <div className="h-16 flex items-center justify-between px-4 shrink-0" style={{ borderBottom: '1px solid var(--shell-border)' }}>
                <VideoLogo size="xs" showText={true} dark={theme === 'light'} />
                <button
                  onClick={() => setMobileNavOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard) transition-colors"
                  aria-label="Close navigation menu"
                >
                  <X size={18} style={{ color: 'var(--shell-text-secondary)' }} />
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
              className="md:hidden p-2 -ml-1 rounded-lg hover:bg-(--shell-hover-hard) transition-colors shrink-0"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={20} style={{ color: 'var(--shell-text-icon)' }} />
            </button>

            <AppsMenu profile={profile} currentModule="mis" />
            <div className="w-px h-4 hidden sm:block shrink-0" style={{ backgroundColor: 'var(--shell-border-mid)' }} />
            <h1 className="text-base font-semibold truncate min-w-0" style={{ color: 'var(--text-primary)' }}>{pageTitle}</h1>
          </div>

          {/* Right: share + theme toggle + user menu */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <CommandSearchButton />
            <SharePageButton pageKey={resolvePageKey(location.pathname, location.search)} />
            <ThemeToggle />
            <UserMenu
              displayName={profile?.displayName ?? ''}
              photoURL={profile?.photoURL}
              initials={initials}
              roleLabel={isMisAdmin ? 'MIS Admin' : 'Viewer'}
              links={[
                { label: 'My HR Profile',  path: `/hrms/employees/${user?.uid}`, Icon: User     },
                { label: 'MIS Settings',   path: '/mis/admin/payout-slabs',      Icon: Settings },
              ]}
              onLogout={handleLogout}
            />
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
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 pb-24 md:p-8" style={{ backgroundColor: 'transparent' }}>
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

      {/* Phase R — app-style bottom tabs on phones (share-only users use the drawer) */}
      {!isShareOnly && (
        <MobileTabBar
          tabs={[
            { label: 'Financials', path: '/mis/cases-mis',    Icon: BarChart3 },
            { label: 'Reconcile', path: '/mis/recon',         Icon: GitMerge, end: true },
            { label: 'Payouts',   path: '/mis/payout-cycles', Icon: IndianRupee },
            { label: 'Overview',  path: '/mis/overview',      Icon: LayoutDashboard },
          ]}
          onMenu={() => setMobileNavOpen(true)}
        />
      )}

      {/* Global ⌘K command palette */}
      <CommandPalette />
    </div>
  );
}
