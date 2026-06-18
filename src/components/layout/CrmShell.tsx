import { useState, useEffect, type ElementType, type ReactNode } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { AnimatePresence, motion } from 'motion/react';
import {
  LayoutDashboard, TrendingUp,
  Upload, Settings, Inbox, Clock, Bookmark, Plus, Webhook, User,
  Menu, X, PackageOpen, Target, BarChart3, UsersRound, Briefcase,
  ChevronDown, ListChecks, Building2,
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { useAuth } from '../../features/auth/AuthContext';
import { useMyLeads } from '../../features/crm/hooks/useMyLeads';
import { useImportHistory } from '../../features/crm/hooks/useImportJobs';
import { ImportProgressDock } from '../../features/crm/import/ImportProgressDock';
import { VideoLogo } from '../ui/VideoLogo';
import { NotificationBell } from '../ui/NotificationBell';
import { ThemeToggle, useTheme } from '../ui/ThemeProvider';
import { UserMenu } from '../ui/UserMenu';
import { AppsMenu } from '../ui/AppsMenu';
import { CommandPalette, CommandSearchButton } from '../ui/CommandPalette';
import { SharePageButton } from '../ui/SharePageButton';
import { MobileTabBar, type MobileTab } from '../ui/MobileTabBar';
import { SharedNavSection, locationCoveredByShares } from './SharedNavSection';
import { useMyShares } from '../../features/auth/hooks/useMyShares';
import { resolvePageKey } from '../../config/shareablePages';
import { useAutoStartTour } from '../../features/learn/useTour';

type NavEntry = { path: string; label: string; icon: ElementType; live: boolean; end?: boolean; badge?: number; dataTour?: string };

// Admin nav (super-admin / admin). Legacy old-CRM config pages (Commission Slabs,
// Providers & SLA, Document Types, Eligibility Rules, Rate Memory) were removed
// from the sidebar 2026-06-15 per the business doc — CRM 2.0 Masters supersedes
// them. Their routes remain (old CRM still reads that config) but are unlisted.
const ADMIN_NAV: NavEntry[] = [
  { path: '/crm/import/history',                label: 'Import History',      icon: Clock,    live: true, end: true },
  { path: '/crm/admin/commission-leakage',     label: 'Commission Leakage',  icon: Settings, live: true, end: true },
  { path: '/crm/admin/competitor-intelligence',label: 'Competitor Intel',    icon: Settings, live: true, end: true },
  { path: '/crm/admin/referrers',              label: 'Referral Intel',      icon: Settings, live: true, end: true },
  { path: '/crm/admin/access-logs',            label: 'Access Logs',         icon: Settings, live: true, end: true },
  { path: '/crm/admin/right-to-be-forgotten',  label: 'Right to Erasure',    icon: Settings, live: true, end: true },
  { path: '/crm/admin/webhooks',               label: 'Webhooks',            icon: Webhook,  live: true, end: true },
];

function resolveCrmTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (/^\/crm\/leads\/[^/]+\/opportunities\/[^/]+\/submissions\/[^/]+$/.test(pathname)) return 'Submission Detail';
  if (/^\/crm\/leads\/[^/]+\/opportunities\/new$/.test(pathname)) return 'New Opportunity';
  if (/^\/crm\/leads\/[^/]+\/opportunities\/[^/]+$/.test(pathname)) return 'Opportunity';
  if (/^\/crm\/leads\/[^/]+$/.test(pathname)) return 'Lead Detail';
  return 'CRM & Leads';
}

const PAGE_TITLES: Record<string, string> = {
  '/crm/referrals':                       'My Referrals',
  '/crm/referrals/new':                   'Submit a Lead',
  '/crm/referrals/import':                'Import from CSV',
  '/crm/command-centre':                 'Command Centre',
  '/crm/team':                           'My Team',
  '/crm/dashboard':                      'Dashboard',
  '/crm/import/history':                 'Import History',
  '/crm/my-queue':                       'My Queue',
  '/crm/leads':                          'Customers',
  '/crm/commissions':                    'Commissions',
  '/crm/import':                         'Bulk Import',
  '/crm/import/queue':                   'Import Queue',
  '/crm/pipeline':                       'Pipeline',
  '/crm/meetings':                       'Meetings',
  '/crm/targets':                        'Targets',
  '/crm/reports/aging':                  'Lead Aging',
  '/crm/pipeline/masters':               'Pipeline Masters',
  '/crm/tasks':                          'Tasks',
  '/crm/pipeline/leads':                 'Leads',
  '/crm/pipeline/clients':               'Clients',
  '/crm/pipeline/cases':                 'Pipeline Cases',
  '/crm/pipeline/payouts':               'Payout Cycles',
  '/crm/pipeline/mis':                   'MIS',
  '/crm/pipeline/recon':                 'Reconciliation',
  '/crm/pipeline/dashboards':            'Dashboards',
  '/crm/pipeline/permissions':           'Pipeline Permissions',
  '/crm/admin/commission-slabs':         'Commission Slabs',
  '/crm/admin/providers':                'Providers & SLA',
  '/crm/admin/document-types':           'Document Types',
  '/crm/admin/eligibility-rules':        'Eligibility Rules',
  '/crm/admin/commission-leakage':       'Commission Leakage',
  '/crm/admin/competitor-intelligence':  'Competitor Intelligence',
  '/crm/admin/referrers':                'Referral Intelligence',
  '/crm/admin/rate-memory':              'Rate Memory',
  '/crm/admin/access-logs':              'Access Logs',
  '/crm/admin/right-to-be-forgotten':    'Right to Erasure',
  '/crm/admin/webhooks':                 'Webhook Configuration',
};

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--navy-deep)' }}>
      <VideoLogo size="sm" showText />
    </div>
  );
}

function NavItemLive({ entry, isActive }: { entry: NavEntry; isActive: boolean }) {
  const { icon: Icon, path, label, end, badge } = entry;
  return (
    <NavLink
      to={path}
      data-tour={entry.dataTour}
      end={end ?? true}
      className={({ isActive: a }) =>
        `flex items-center gap-3 py-2.5 rounded-lg transition-colors ${a ? 'pl-2.5 border-l-2' : 'pl-3 nav-item-hover'}`
      }
      style={({ isActive: a }) =>
        a ? { backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961', borderColor: '#C9A961' }
          : { color: 'var(--shell-text-secondary)' }
      }
    >
      <Icon size={17} className="shrink-0" />
      <span className="text-sm flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full mr-2 leading-none"
          style={{ backgroundColor: 'rgba(248,113,113,0.20)', color: '#f87171' }}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );
}

// Collapsible nav group — section header that toggles its children. Keeps the
// CRM sidebar tidy: daily Workspace open, Admin & Config collapsed by default.
function NavGroup({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 pt-4 pb-2 nav-item-hover rounded-lg"
      >
        <span className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: 'var(--shell-text-dim)' }}>{title}</span>
        <ChevronDown
          size={12}
          className="shrink-0 transition-transform"
          style={{ color: 'var(--shell-text-dim)', transform: open ? 'none' : 'rotate(-90deg)' }}
        />
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

export function CrmShell() {
  const { user, profile, loading } = useAuth();
  const { theme } = useTheme();   // wordmark needs dark text on the light-mode header
  const location = useLocation();
  const navigate = useNavigate();

  // Mobile nav drawer state
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [targetMissing, setTargetMissing] = useState(false);

  // Only subscribe to the queue when the user is a lead_generator — keeps
  // the hook call unconditional (Rules of Hooks) while skipping the Firestore
  // query for other roles by passing an empty userId string.
  const isGenerator = profile?.crmRole === 'lead_generator';
  const { overdue: queueOverdue } = useMyLeads(isGenerator ? (user?.uid ?? '') : '');

  // Import Queue badge — batches imported but not yet distributed (admin sees all; others their own).
  const { jobs: importJobs } = useImportHistory(profile?.role === 'admin');

  // Phase P — active page shares (exception grants for users without crmAccess).
  const myShares = useMyShares(user?.uid);

  // First-run guided tour for CRM (auto-shows once, then remembered per user).
  useAutoStartTour('crm');

  // Targets badge — is the current month's target unset for this user?
  useEffect(() => {
    if (!user?.uid) return;
    const period = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    getDoc(doc(db, 'rm_targets', `${user.uid}_${period}`))
      .then((s) => setTargetMissing(!s.exists()))
      .catch(() => setTargetMissing(false));
  }, [user?.uid]);

  // (Command Centre — with its pending-approvals badge — moved to the new
  // Command & Compliance Center module; its badge logic lives there now.)

  // Close mobile drawer on route change
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.mustResetPassword) return <Navigate to="/reset-password" replace />;

  // Full CRM access: admin or explicit crmAccess flag.
  const canFullAccess  = profile?.role === 'admin' || profile?.crmAccess === true;

  // Phase P — route-guard race: on hard refresh the share snapshot lands after
  // auth. Never redirect a non-full-access user while shares are still loading.
  if (!canFullAccess && myShares.loading) return <FullPageLoader />;

  const crmShares    = myShares.sharesByModule.crm;
  const isShareOnly  = !canFullAccess && crmShares.length > 0;
  // Referral-only access: any HRMS employee (hrmsAccess absent = true by default)
  // without full CRM and without shares.
  const isReferralOnly = !canFullAccess && !isShareOnly && (profile?.hrmsAccess !== false);
  const canEnter       = canFullAccess || isShareOnly || isReferralOnly;
  if (!canEnter) return <Navigate to="/" replace />;

  // Phase P — share-only users may open ONLY their shared pages (+ drill-downs).
  if (isShareOnly) {
    const key = resolvePageKey(location.pathname, location.search);
    if (!locationCoveredByShares(crmShares, key, location.pathname)) {
      return <Navigate to={crmShares[0].pageRoute} replace />;
    }
  }

  // Redirect referral-only users away from full-CRM pages they can't see
  if (isReferralOnly && !location.pathname.startsWith('/crm/referrals')) {
    return <Navigate to="/crm/referrals" replace />;
  }

  const isAdmin   = profile?.role === 'admin';
  const isManager = profile?.crmRole === 'manager';
  const isViewer  = profile?.crmRole === 'viewer' && !isAdmin;
  const canImport = isAdmin || profile?.crmRole === 'manager' || profile?.crmCanImport === true;
  const queueAwaiting = importJobs.filter(
    (j) => !!j.importName && j.distributed !== true && (j.successCount ?? 0) > 0 && (j.status === 'completed' || j.status === 'partial'),
  ).length;

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login', { replace: true });
  };

  const pageTitle = resolveCrmTitle(location.pathname);

  const initials = profile?.displayName
    ? profile.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  // ── Shared nav scroll body ────────────────────────────────────────────────────
  const navBody = (
    <div className="flex-1 px-2 space-y-0.5 overflow-y-auto pb-4">
      {isShareOnly ? (
        /* Phase P — share-only users see ONLY their shared pages */
        <SharedNavSection shares={crmShares} />
      ) : isReferralOnly ? (
        /* Referral-mode minimal nav */
        <>
          <NavItemLive
            entry={{ path: '/crm/referrals', label: 'My Referrals', icon: Bookmark, live: true, end: true }}
            isActive={location.pathname === '/crm/referrals'}
          />
          <NavItemLive
            entry={{ path: '/crm/referrals/new', label: 'Submit a Lead', icon: Plus, live: true, end: true }}
            isActive={location.pathname === '/crm/referrals/new'}
          />
        </>
      ) : (
        /* Full CRM nav — regrouped: Dashboard · Workspace · Pipeline · Team · Admin */
        <>
          {/* Dashboard — top, ungrouped (existing CRM dashboard; merge with CRM 2.0
              Dashboards is a Phase-2+ content task per business doc) */}
          <NavItemLive entry={{ path: '/crm/dashboard', label: 'Dashboard', icon: LayoutDashboard, live: true, end: true, dataTour: 'crm-dashboard' }} isActive={location.pathname === '/crm/dashboard'} />

          {/* WORKSPACE — Tasks (My Queue + Meetings) + Targets */}
          <NavGroup title="Workspace">
            <NavItemLive entry={{ path: '/crm/tasks', label: 'Tasks', icon: ListChecks, live: true, end: true, badge: isGenerator ? queueOverdue : 0 }} isActive={location.pathname === '/crm/tasks'} />
            <NavItemLive entry={{ path: '/crm/targets', label: 'Targets', icon: Target, live: true, end: true, badge: targetMissing ? 1 : 0, dataTour: 'crm-targets' }} isActive={location.pathname === '/crm/targets'} />
          </NavGroup>

          {/* Customers — cold-lead dump (manual + social/website auto-route) */}
          <NavItemLive entry={{ path: '/crm/leads', label: 'Customers', icon: TrendingUp, live: true, end: false, dataTour: 'crm-customers' }} isActive={location.pathname.startsWith('/crm/leads')} />

          {/* PIPELINE (CRM 2.0): Leads · Clients · Cases. NOTHING LOCKED. */}
          {(() => {
            const perms = (profile as { perms?: Record<string, boolean> } | null)?.perms ?? {};
            const showLeads = isAdmin || perms['crm.leads.read'] === true;
            const showClients = isAdmin || perms['crm.leads.read'] === true || perms['crm.cases.read'] === true;
            const showCases = isAdmin || perms['crm.cases.read'] === true;
            if (!showLeads && !showClients && !showCases) return null;
            return (
              <NavGroup title="Pipeline">
                {showLeads && (
                  <NavItemLive entry={{ path: '/crm/pipeline/leads', label: 'Leads', icon: Inbox, live: true, end: true }} isActive={location.pathname === '/crm/pipeline/leads'} />
                )}
                {showClients && (
                  <NavItemLive entry={{ path: '/crm/pipeline/clients', label: 'Clients', icon: Building2, live: true, end: true }} isActive={location.pathname === '/crm/pipeline/clients'} />
                )}
                {showCases && (
                  <NavItemLive entry={{ path: '/crm/pipeline/cases', label: 'Cases', icon: Briefcase, live: true, end: true }} isActive={location.pathname.startsWith('/crm/pipeline/cases')} />
                )}
              </NavGroup>
            );
          })()}

          {/* TEAMS — managers / admins */}
          {(isAdmin || isManager || canImport) && (
            <NavGroup title="Teams">
              {(isManager || isAdmin) && (
                <NavItemLive entry={{ path: '/crm/team', label: 'My Team', icon: UsersRound, live: true, end: true, dataTour: 'crm-team' }} isActive={location.pathname === '/crm/team'} />
              )}
              {(isAdmin || isManager) && (
                <NavItemLive entry={{ path: '/crm/reports/aging', label: 'Reports', icon: BarChart3, live: true, end: true }} isActive={location.pathname === '/crm/reports/aging'} />
              )}
              {canImport && (
                <NavItemLive entry={{ path: '/crm/import', label: 'Import', icon: Upload, live: true, end: true }} isActive={location.pathname === '/crm/import'} />
              )}
              {canImport && (
                <NavItemLive entry={{ path: '/crm/import/queue', label: 'Import Queue', icon: PackageOpen, live: true, end: true, badge: queueAwaiting }} isActive={location.pathname === '/crm/import/queue'} />
              )}
            </NavGroup>
          )}

          {/* ADMIN — Masters + Permissions + config (admin only, collapsed) */}
          {isAdmin && (
            <NavGroup title="Admin" defaultOpen={false}>
              <NavItemLive entry={{ path: '/crm/pipeline/masters', label: 'Masters', icon: Settings, live: true, end: true }} isActive={location.pathname === '/crm/pipeline/masters'} />
              <NavItemLive entry={{ path: '/crm/pipeline/permissions', label: 'Permissions', icon: User, live: true, end: true }} isActive={location.pathname === '/crm/pipeline/permissions'} />
              <NavItemLive entry={{ path: '/crm/pipeline/dashboards', label: 'CRM 2.0 Dashboards', icon: LayoutDashboard, live: true, end: true }} isActive={location.pathname === '/crm/pipeline/dashboards'} />
              {ADMIN_NAV.map((entry) => (
                <NavItemLive key={entry.path} entry={entry} isActive={location.pathname === entry.path} />
              ))}
            </NavGroup>
          )}

          {/* Phase P — full-access user who ALSO holds shares (edge case) */}
          <SharedNavSection shares={crmShares} />
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
      <nav className="hidden md:flex md:flex-col w-60 shrink-0 glass-sidebar">

        <div className="h-16 flex items-center px-4 shrink-0" style={{ borderBottom: '1px solid var(--shell-border)' }}>
          <VideoLogo size="xs" showText={true} dark={theme === 'light'} />
        </div>

        <div className="px-5 pt-5 pb-3">
          <p className="glass-module-label font-bold">
            {isReferralOnly ? 'Referrals' : 'CRM & Leads'}
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
                  {isReferralOnly ? 'Referrals' : 'CRM & Leads'}
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
        <header className="h-16 glass-header flex items-center justify-between px-4 sm:px-6 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Hamburger — mobile only */}
            <button
              className="md:hidden p-2 -ml-1 rounded-lg hover:bg-(--shell-hover-hard) transition-colors shrink-0"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={20} style={{ color: 'var(--shell-text-icon)' }} />
            </button>

            <AppsMenu profile={profile} currentModule="crm" />
            <div className="w-px h-4 hidden sm:block shrink-0" style={{ backgroundColor: 'var(--shell-border-mid)' }} />
            <h1 className="text-base font-semibold truncate min-w-0" style={{ color: 'var(--text-primary)' }}>{pageTitle}</h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <CommandSearchButton />
            <SharePageButton pageKey={resolvePageKey(location.pathname, location.search)} />
            <ThemeToggle />
            {user && <NotificationBell uid={user.uid} />}
            <UserMenu
              displayName={profile?.displayName ?? ''}
              photoURL={profile?.photoURL}
              initials={initials}
              roleLabel={profile?.crmRole ?? profile?.role ?? 'employee'}
              links={[
                { label: 'My HR Profile', path: `/hrms/employees/${user?.uid}`, Icon: User     },
                { label: 'CRM Settings',  path: '/crm/admin/webhooks',          Icon: Settings },
              ]}
              onLogout={handleLogout}
            />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden" style={{ backgroundColor: 'transparent' }}>
          {/* Referral mode info banner */}
          {isReferralOnly && (
            <div className="px-4 sm:px-8 pt-4">
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm"
                style={{ backgroundColor: 'rgba(201,169,97,0.10)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.20)' }}>
                🔖 <strong>Referral Mode</strong> — submit leads and track their progress through the pipeline.
                Contact your admin to request full CRM access.
              </div>
            </div>
          )}
          {/* View-only banner for CRM viewers */}
          {isViewer && !isReferralOnly && (
            <div className="px-4 sm:px-8 pt-4">
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm"
                style={{ backgroundColor: 'rgba(201,169,97,0.08)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.18)' }}>
                👁 View only — you can see all CRM data but cannot create or edit records.
                Contact your admin to change your access level.
              </div>
            </div>
          )}
          <div className="p-4 pb-24 md:p-8">
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
          </div>
        </main>
      </div>

      {/* Phase R — app-style bottom tabs on phones (share-only users use the drawer) */}
      {!isShareOnly && (
        <MobileTabBar
          tabs={
            isReferralOnly
              ? ([
                  { label: 'Referrals', path: '/crm/referrals', Icon: Bookmark, end: true },
                  { label: 'Submit',    path: '/crm/referrals/new', Icon: Plus },
                ] as MobileTab[])
              : ([
                  { label: 'Dashboard', path: '/crm/dashboard', Icon: LayoutDashboard, end: true },
                  { label: 'Tasks',     path: '/crm/tasks',     Icon: ListChecks, end: true },
                  { label: 'Customers', path: '/crm/leads',     Icon: Inbox },
                  { label: 'Cases',     path: '/crm/pipeline/cases', Icon: Briefcase },
                ] as MobileTab[])
          }
          onMenu={() => setMobileNavOpen(true)}
        />
      )}

      {/* Global import progress — persists across CRM pages while a bulk import runs */}
      {canImport && <ImportProgressDock jobs={importJobs} />}

      {/* Global ⌘K command palette */}
      <CommandPalette />
    </div>
  );
}
