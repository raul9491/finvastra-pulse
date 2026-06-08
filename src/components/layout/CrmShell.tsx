import { useState, useEffect, type ElementType } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { AnimatePresence, motion } from 'motion/react';
import {
  LayoutDashboard, TrendingUp, GitBranch, IndianRupee,
  Upload, Settings, LogOut, LayoutGrid, Inbox, Clock, Bookmark, Plus, Webhook, User,
  Menu, X, PackageOpen, Target, BarChart3, Command,
} from 'lucide-react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { useAuth } from '../../features/auth/AuthContext';
import { useMyLeads } from '../../features/crm/hooks/useMyLeads';
import { useImportHistory } from '../../features/crm/hooks/useImportJobs';
import { ImportProgressDock } from '../../features/crm/import/ImportProgressDock';
import { VideoLogo } from '../ui/VideoLogo';
import { NotificationBell } from '../ui/NotificationBell';
import { ThemeToggle } from '../ui/ThemeProvider';
import { UserMenu } from '../ui/UserMenu';
import { AppsMenu } from '../ui/AppsMenu';

type NavEntry = { path: string; label: string; icon: ElementType; live: boolean; end?: boolean; badge?: number };

const NAV: NavEntry[] = [
  { path: '/crm/command-centre', label: 'Command Centre', icon: Command, live: true, end: true },
  { path: '/crm/dashboard',   label: 'Dashboard',   icon: LayoutDashboard, live: true,  end: true  },
  { path: '/crm/my-queue',    label: 'My Queue',    icon: Inbox,           live: true,  end: true  },
  { path: '/crm/leads',       label: 'Customers',   icon: TrendingUp,      live: true,  end: false },
  { path: '/crm/import',      label: 'Import',      icon: Upload,          live: true,  end: true  },
  { path: '/crm/import/queue',label: 'Import Queue',icon: PackageOpen,     live: true,  end: true  },
  { path: '/crm/commissions', label: 'Commissions', icon: IndianRupee,      live: true,  end: true  },
  { path: '/crm/pipeline',    label: 'Pipeline',    icon: GitBranch,       live: true,  end: true  },
  { path: '/crm/targets',     label: 'Targets',     icon: Target,          live: true,  end: true  },
];

const ADMIN_NAV: NavEntry[] = [
  { path: '/crm/import/history',                label: 'Import History',      icon: Clock,    live: true, end: true },
  { path: '/crm/admin/commission-slabs',       label: 'Commission Slabs',    icon: Settings, live: true, end: true },
  { path: '/crm/admin/providers',              label: 'Providers & SLA',     icon: Settings, live: true, end: true },
  { path: '/crm/admin/document-types',         label: 'Document Types',      icon: Settings, live: true, end: true },
  { path: '/crm/admin/eligibility-rules',      label: 'Eligibility Rules',   icon: Settings, live: true, end: true },
  { path: '/crm/admin/commission-leakage',     label: 'Commission Leakage',  icon: Settings, live: true, end: true },
  { path: '/crm/admin/competitor-intelligence',label: 'Competitor Intel',    icon: Settings, live: true, end: true },
  { path: '/crm/admin/referrers',              label: 'Referral Intel',      icon: Settings, live: true, end: true },
  { path: '/crm/admin/rate-memory',            label: 'Rate Memory',         icon: Settings, live: true, end: true },
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
  '/crm/dashboard':                      'Dashboard',
  '/crm/import/history':                 'Import History',
  '/crm/my-queue':                       'My Queue',
  '/crm/leads':                          'Customers',
  '/crm/commissions':                    'Commissions',
  '/crm/import':                         'Bulk Import',
  '/crm/import/queue':                   'Import Queue',
  '/crm/pipeline':                       'Pipeline',
  '/crm/targets':                        'Targets',
  '/crm/reports/aging':                  'Lead Aging',
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
      <VideoLogo size="sm" showText={false} />
    </div>
  );
}

function NavItemLive({ entry, isActive }: { entry: NavEntry; isActive: boolean }) {
  const { icon: Icon, path, label, end, badge } = entry;
  return (
    <NavLink
      to={path}
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

function NavItemSoon({ entry }: { entry: NavEntry }) {
  const { icon: Icon, label } = entry;
  return (
    <div className="flex items-center gap-3 pl-3 py-2.5 rounded-lg" style={{ opacity: 0.35, cursor: 'not-allowed' }}>
      <Icon size={17} className="shrink-0" style={{ color: 'var(--shell-text-secondary)' }} />
      <span className="text-sm flex-1" style={{ color: 'var(--shell-text-secondary)' }}>{label}</span>
      <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mr-1"
        style={{ color: '#C9A961', backgroundColor: 'rgba(201,169,97,0.15)' }}>Soon</span>
    </div>
  );
}

export function CrmShell() {
  const { user, profile, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Mobile nav drawer state
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [targetMissing, setTargetMissing] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  // Only subscribe to the queue when the user is a lead_generator — keeps
  // the hook call unconditional (Rules of Hooks) while skipping the Firestore
  // query for other roles by passing an empty userId string.
  const isGenerator = profile?.crmRole === 'lead_generator';
  const { overdue: queueOverdue } = useMyLeads(isGenerator ? (user?.uid ?? '') : '');

  // Import Queue badge — batches imported but not yet distributed (admin sees all; others their own).
  const { jobs: importJobs } = useImportHistory(profile?.role === 'admin');

  // Targets badge — is the current month's target unset for this user?
  useEffect(() => {
    if (!user?.uid) return;
    const period = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    getDoc(doc(db, 'rm_targets', `${user.uid}_${period}`))
      .then((s) => setTargetMissing(!s.exists()))
      .catch(() => setTargetMissing(false));
  }, [user?.uid]);

  // Command Centre badge — total pending approvals (admin/manager only)
  useEffect(() => {
    const can = profile?.role === 'admin' || profile?.crmRole === 'manager';
    if (!can) return;
    (async () => {
      const snaps = await Promise.all([
        getDocs(query(collection(db, 'leave_applications'), where('status', '==', 'pending'))),
        getDocs(query(collection(db, 'claims'), where('status', '==', 'pending'))),
        getDocs(query(collection(db, 'it_declarations'), where('status', '==', 'submitted'))),
        getDocs(query(collection(db, 'attendance_regularizations'), where('status', '==', 'pending'))),
        getDocs(query(collection(db, 'leave_encashment_requests'), where('status', '==', 'pending'))),
      ]);
      setPendingApprovals(snaps.reduce((s, c) => s + c.size, 0));
    })().catch(() => setPendingApprovals(0));
  }, [profile?.role, profile?.crmRole]);

  // Close mobile drawer on route change
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.mustResetPassword) return <Navigate to="/reset-password" replace />;

  // Full CRM access: admin or explicit crmAccess flag.
  // Referral-only access: any HRMS employee (hrmsAccess absent = true by default) without full CRM.
  const canFullAccess  = profile?.role === 'admin' || profile?.crmAccess === true;
  const isReferralOnly = !canFullAccess && (profile?.hrmsAccess !== false);
  const canEnter       = canFullAccess || isReferralOnly;
  if (!canEnter) return <Navigate to="/" replace />;

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
      {isReferralOnly ? (
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
        /* Full CRM nav */
        <>
          {NAV
            // Hide Import from viewers and from users without import access
            .filter((entry) => {
              if (entry.path === '/crm/command-centre') return isAdmin || isManager;
              if (entry.path === '/crm/import') return canImport;
              if (entry.path === '/crm/import/queue') return canImport;
              if (entry.path === '/crm/my-queue') return isGenerator || isAdmin;
              return true;
            })
            .map((entry) => {
              let enriched: NavEntry = entry;
              if (entry.path === '/crm/my-queue' && isGenerator) enriched = { ...entry, badge: queueOverdue };
              else if (entry.path === '/crm/import/queue')       enriched = { ...entry, badge: queueAwaiting };
              else if (entry.path === '/crm/targets')            enriched = { ...entry, badge: targetMissing ? 1 : 0 };
              else if (entry.path === '/crm/command-centre')     enriched = { ...entry, badge: pendingApprovals };
              // Exact match for /crm/import so it doesn't also light up on /crm/import/queue
              const isActive = entry.path === '/crm/import'
                ? location.pathname === '/crm/import'
                : location.pathname.startsWith(entry.path);
              return enriched.live
                ? <NavItemLive key={enriched.path} entry={enriched} isActive={isActive} />
                : <NavItemSoon key={enriched.path} entry={enriched} />;
            })}

          {/* Admin-only section */}
          {isAdmin && (
            <>
              <div className="px-3 pt-4 pb-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: 'var(--shell-text-dim)' }}>Admin</p>
              </div>
              {ADMIN_NAV.map((entry) => (
                <NavItemLive key={entry.path} entry={entry} isActive={location.pathname === entry.path} />
              ))}
            </>
          )}

          {/* Reports — admin + manager */}
          {(isAdmin || isManager) && (
            <>
              <div className="px-3 pt-4 pb-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: 'var(--shell-text-dim)' }}>Reports</p>
              </div>
              <NavItemLive entry={{ path: '/crm/reports/aging', label: 'Lead Aging', icon: BarChart3, live: true, end: true }} isActive={location.pathname === '/crm/reports/aging'} />
            </>
          )}
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
          <VideoLogo size="xs" showText={true} />
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
                <VideoLogo size="xs" showText={true} />
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

        <main className="flex-1 overflow-y-auto" style={{ backgroundColor: 'transparent' }}>
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
          <div className="p-4 md:p-8">
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

      {/* Global import progress — persists across CRM pages while a bulk import runs */}
      {canImport && <ImportProgressDock jobs={importJobs} />}
    </div>
  );
}
