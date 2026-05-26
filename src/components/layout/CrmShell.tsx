import type { ElementType } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import {
  LayoutDashboard, TrendingUp, GitBranch, IndianRupee,
  Upload, Settings, LogOut, LayoutGrid, Inbox, Clock, Bookmark, Plus,
} from 'lucide-react';
import { auth } from '../../lib/firebase';
import { useAuth } from '../../features/auth/AuthContext';
import { useMyLeads } from '../../features/crm/hooks/useMyLeads';
import { VideoLogo } from '../ui/VideoLogo';

type NavEntry = { path: string; label: string; icon: ElementType; live: boolean; end?: boolean; badge?: number };

const NAV: NavEntry[] = [
  { path: '/crm/dashboard',   label: 'Dashboard',   icon: LayoutDashboard, live: true,  end: true  },
  { path: '/crm/my-queue',    label: 'My Queue',    icon: Inbox,           live: true,  end: true  },
  { path: '/crm/leads',       label: 'Customers',   icon: TrendingUp,      live: true,  end: false },
  { path: '/crm/import',      label: 'Import',      icon: Upload,          live: true,  end: false },
  { path: '/crm/commissions', label: 'Commissions', icon: IndianRupee,      live: true,  end: true  },
  { path: '/crm/pipeline',    label: 'Pipeline',    icon: GitBranch,       live: true,  end: true  },
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
  '/crm/dashboard':                      'Dashboard',
  '/crm/import/history':                 'Import History',
  '/crm/my-queue':                       'My Queue',
  '/crm/leads':                          'Customers',
  '/crm/commissions':                    'Commissions',
  '/crm/import':                         'Bulk Import',
  '/crm/pipeline':                       'Pipeline',
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
};

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAFAF7' }}>
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
        `flex items-center gap-3 py-2.5 rounded-lg transition-colors ${a ? 'pl-2.5 border-l-2' : 'pl-3'}`
      }
      style={({ isActive: a }) =>
        a ? { backgroundColor: '#1B2A4E', color: '#FFFFFF', borderColor: '#C9A961' }
          : { color: '#94A3B8' }
      }
    >
      <Icon size={17} className="shrink-0" />
      <span className="text-sm flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full mr-2 leading-none"
          style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}
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
      <Icon size={17} className="shrink-0" style={{ color: '#8B8B85' }} />
      <span className="text-sm flex-1" style={{ color: '#8B8B85' }}>{label}</span>
      <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mr-1"
        style={{ color: '#C9A961', backgroundColor: '#1B2A4E' }}>Soon</span>
    </div>
  );
}

export function CrmShell() {
  const { user, profile, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Only subscribe to the queue when the user is a lead_generator — keeps
  // the hook call unconditional (Rules of Hooks) while skipping the Firestore
  // query for other roles by passing an empty userId string.
  const isGenerator = profile?.crmRole === 'lead_generator';
  const { overdue: queueOverdue } = useMyLeads(isGenerator ? (user?.uid ?? '') : '');

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
  const isViewer  = profile?.crmRole === 'viewer' && !isAdmin;
  const canImport = isAdmin || profile?.crmRole === 'manager' || profile?.crmCanImport === true;

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login', { replace: true });
  };

  const pageTitle = resolveCrmTitle(location.pathname);

  const initials = profile?.displayName
    ? profile.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#FAFAF7' }}>

      {/* ── Sidebar ── */}
      <nav className="w-60 flex flex-col shrink-0"
        style={{ backgroundColor: '#0B1538', borderRight: '1px solid #1B2A4E' }}>

        <div className="h-16 flex items-center px-4 shrink-0" style={{ borderBottom: '1px solid #1B2A4E' }}>
          <VideoLogo size="xs" showText={true} />
        </div>

        <div className="px-5 pt-5 pb-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: '#C9A961' }}>
            {isReferralOnly ? 'Referrals' : 'CRM & Leads'}
          </p>
        </div>

        {/* Main nav */}
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
                  if (entry.path === '/crm/import') return canImport;
                  if (entry.path === '/crm/my-queue') return isGenerator || isAdmin;
                  return true;
                })
                .map((entry) => {
                  const enriched: NavEntry =
                    entry.path === '/crm/my-queue' && isGenerator
                      ? { ...entry, badge: queueOverdue }
                      : entry;
                  return enriched.live
                    ? <NavItemLive key={enriched.path} entry={enriched} isActive={location.pathname.startsWith(enriched.path)} />
                    : <NavItemSoon key={enriched.path} entry={enriched} />;
                })}

              {/* Admin-only section */}
              {isAdmin && (
                <>
                  <div className="px-3 pt-4 pb-2">
                    <p className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: '#475569' }}>Admin</p>
                  </div>
                  {ADMIN_NAV.map((entry) => (
                    <NavItemLive key={entry.path} entry={entry} isActive={location.pathname === entry.path} />
                  ))}
                </>
              )}
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
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors hover:bg-slate-100"
              style={{ color: '#8B8B85' }} title="Back to launcher">
              <LayoutGrid size={14} />
              <span>Apps</span>
            </button>
            <div className="w-px h-4 bg-slate-200" />
            <h1 className="text-base font-semibold" style={{ color: '#0A0A0A' }}>{pageTitle}</h1>
          </div>

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
            <button onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-60"
              style={{ color: '#8B8B85' }} title="Sign out">
              <LogOut size={15} />
              <span className="hidden sm:block">Sign out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto" style={{ backgroundColor: '#FAFAF7' }}>
          {/* Referral mode info banner */}
          {isReferralOnly && (
            <div className="px-8 pt-4">
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm"
                style={{ backgroundColor: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
                🔖 <strong>Referral Mode</strong> — submit leads and track their progress through the pipeline.
                Contact your admin to request full CRM access.
              </div>
            </div>
          )}
          {/* View-only banner for CRM viewers */}
          {isViewer && !isReferralOnly && (
            <div className="px-8 pt-4">
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm"
                style={{ backgroundColor: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
                👁 View only — you can see all CRM data but cannot create or edit records.
                Contact your admin to change your access level.
              </div>
            </div>
          )}
          <div className="p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
