import { type ElementType, useState, useEffect } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { format } from 'date-fns';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import {
  LayoutDashboard, Users, Clock, CalendarOff, Receipt, CalendarDays,
  Settings, LogOut, LayoutGrid, ClipboardList, FileText, UserPlus, Inbox,
  ReceiptText, FolderOpen, Megaphone, Building2, Calculator,
  Laptop, UserMinus, Lock, FileSearch2, GraduationCap, TrendingUp, Briefcase, BookOpen,
} from 'lucide-react';
import { auth, db } from '../../lib/firebase';
import { useAuth } from '../../features/auth/AuthContext';
import { isSuperAdmin } from '../../config/hrmsConfig';
import { VideoLogo } from '../ui/VideoLogo';
import { useUnreadAnnouncementCount, getUnseenHolidayCount } from '../../features/hrms/hooks/useAnnouncements';
import { useHolidays } from '../../features/hrms/hooks/useHolidays';
import { useMyItDeclaration, usePendingItDeclarationCount, currentFinancialYear } from '../../features/hrms/hooks/useItDeclarations';
import { useOverdueComplianceCount } from '../../features/hrms/compliance/ComplianceCalendarPage';
import { useBirthdayEmployees } from '../../features/hrms/hooks/useBirthdayEmployees';
import { useProbationBadge } from '../../features/hrms/hooks/useProbation';
import { usePendingReviewCount, useSelfAssessmentBadge, currentReviewYear } from '../../features/hrms/hooks/usePerformance';
import { useMyTrainingBadge, useTrainingAdminBadge } from '../../features/hrms/hooks/useTraining';

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

/** Count onboarding checklists that are still pending or in_progress */
function useOnboardingBadge(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(
        collection(db, 'onboarding_checklists'),
        where('status', 'in', ['pending', 'in_progress']),
      ),
      (snap) => setCount(snap.size),
      () => setCount(0),
    );
  }, [enabled]);
  return count;
}

/** Count offboarding checklists where checklist is not completed OR fnfStatus is not settled */
function useOffboardingBadge(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    // Show badge for open checklists OR unsettled FnF
    return onSnapshot(
      query(
        collection(db, 'offboarding_checklists'),
        where('fnfStatus', 'in', ['pending', 'calculated']),
      ),
      (snap) => setCount(snap.size),
      () => setCount(0),
    );
  }, [enabled]);
  return count;
}

/** Count candidates currently in an interview stage (requires scheduling attention) */
function useInterviewBadge(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(
        collection(db, 'candidates'),
        where('stage', 'in', ['interview_1', 'interview_2']),
      ),
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
  { path: '/hrms/announcements',   label: 'Announcements',  icon: Megaphone,       live: true },
  { path: '/hrms/it-declaration',  label: 'IT Declaration', icon: FileSearch2,     live: true },
  { path: '/hrms/performance',     label: 'My Review',      icon: TrendingUp,      live: true },
  { path: '/hrms/training',        label: 'My Training',    icon: BookOpen,        live: true },
  { path: '/hrms/settings',        label: 'Settings',       icon: Settings,        live: true },
];

const ADMIN_NAV: NavEntry[] = [
  { path: '/hrms/admin/access-requests',   label: 'Access Requests',      icon: Inbox,         live: true },
  { path: '/hrms/admin/import-employees',  label: 'Import Employees',     icon: UserPlus,      live: true },
  { path: '/hrms/admin/attendance',        label: 'Attendance',           icon: Clock,         live: true },
  { path: '/hrms/leave/admin',             label: 'Leave Approvals',      icon: ClipboardList, live: true },
  { path: '/hrms/admin/holidays',          label: 'Manage Holidays',      icon: CalendarDays,  live: true },
  { path: '/hrms/admin/payslips',          label: 'Generate Payslips',    icon: FileText,      live: true },
  { path: '/hrms/admin/claims',            label: 'Claims',               icon: ReceiptText,   live: true },
  { path: '/hrms/admin/documents',         label: 'Documents',            icon: FolderOpen,    live: true },
  { path: '/hrms/admin/announcements',     label: 'Announcements',        icon: Megaphone,     live: true },
  { path: '/hrms/admin/it-declarations',  label: 'IT Declarations',      icon: FileSearch2,   live: true },
  { path: '/hrms/admin/performance',     label: 'Performance Reviews',  icon: TrendingUp,    live: true },
  { path: '/hrms/admin/training',        label: 'Training',             icon: BookOpen,      live: true },
];

const LIFECYCLE_NAV: NavEntry[] = [
  { path: '/hrms/admin/recruitment',  label: 'Recruitment',  icon: Briefcase,      live: true },
  { path: '/hrms/admin/assets',       label: 'Assets',       icon: Laptop,         live: true },
  { path: '/hrms/admin/onboarding',   label: 'Onboarding',   icon: UserPlus,       live: true },
  { path: '/hrms/admin/probation',    label: 'Probation',    icon: GraduationCap,  live: true },
  { path: '/hrms/admin/offboarding',  label: 'Offboarding',  icon: UserMinus,      live: true },
];

const COMPLIANCE_NAV: NavEntry[] = [
  { path: '/hrms/admin/compliance',  label: 'Compliance Calendar', icon: Building2,   live: true },
  { path: '/hrms/admin/pf-tracker',  label: 'PF Tracker',          icon: Calculator,  live: true },
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
  '/hrms/admin/import-employees':'Import Employees',
  '/hrms/admin/attendance':      'Attendance — Admin',
  '/hrms/leave/admin':           'Leave Approvals',
  '/hrms/admin/holidays':        'Holidays — Admin',
  '/hrms/admin/payslips':        'Generate Payslips',
  '/hrms/admin/claims':          'Claims — Admin',
  '/hrms/admin/documents':       'Documents — Admin',
  '/hrms/admin/announcements':   'Announcements — Admin',
  '/hrms/it-declaration':         'IT Declaration',
  '/hrms/admin/it-declarations':  'IT Declarations — Admin',
  '/hrms/performance':            'My Performance Review',
  '/hrms/admin/performance':      'Performance Reviews',
  '/hrms/admin/compliance':       'Compliance Calendar',
  '/hrms/admin/pf-tracker':      'PF Tracker',
  '/hrms/training':              'My Training',
  '/hrms/admin/training':       'Training & Development',
  '/hrms/admin/recruitment':    'Recruitment',
  '/hrms/admin/assets':          'Asset Management',
  '/hrms/admin/onboarding':      'Onboarding',
  '/hrms/admin/probation':       'Probation Management',
  '/hrms/admin/offboarding':     'Offboarding & FnF',
  '/hrms/admin/permissions':     'Permission Manager',
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

  // Derive roles before hooks so `enabled` flags are correct from the first render.
  // Safe when profile is null (still loading): all flags default to false.
  const isAdmin        = profile?.role === 'admin';
  const isHrmsManager  = profile?.isHrmsManager === true;
  const isSA           = isSuperAdmin(user?.uid ?? '');

  // ── All hooks unconditionally at the top — Rules of Hooks ───────────────────
  // Early returns come AFTER this block. Hooks with `enabled=false` return safe
  // defaults and set up no subscriptions, so they're cheap when not needed.
  const pendingRequests     = usePendingRequestCount(isAdmin);
  const unreadAnnouncements = useUnreadAnnouncementCount(user?.uid ?? '');
  const overdueCompliance   = useOverdueComplianceCount(isAdmin || isHrmsManager);
  const onboardingBadge     = useOnboardingBadge(isAdmin || isHrmsManager);
  const offboardingBadge    = useOffboardingBadge(isAdmin || isHrmsManager);
  const probationBadge      = useProbationBadge(isAdmin || isHrmsManager);
  const interviewBadge      = useInterviewBadge(isAdmin || isHrmsManager);
  const myTrainingBadge     = useMyTrainingBadge(user?.uid ?? '');
  const trainingAdminBadge  = useTrainingAdminBadge(isAdmin || isHrmsManager);
  const _perfYear           = currentReviewYear();
  const selfAssessmentBadge = useSelfAssessmentBadge(user?.uid ?? '', _perfYear);
  const pendingReviewCount  = usePendingReviewCount(isAdmin || isHrmsManager);

  // Holidays for current year — used to compute unseen holiday badge on Announcements nav item
  const _now = new Date();
  const { holidays: _holidays } = useHolidays(_now.getFullYear());
  const holidayBadge = getUnseenHolidayCount(_holidays);

  // IT Declaration: employee badge (1 if current-FY declaration not yet submitted)
  const _currentFY = currentFinancialYear();
  const { declaration: _myItDecl, loading: _itDeclLoading } = useMyItDeclaration(user?.uid ?? '', _currentFY);
  const itDeclEmployeeBadge = !_itDeclLoading && (_myItDecl === null || _myItDecl.status === 'draft') ? 1 : 0;
  // IT Declaration: admin badge (count of submitted-but-not-accepted across all years)
  const itDeclAdminBadge = usePendingItDeclarationCount(isAdmin || isHrmsManager);

  // Birthday employees (admin/manager only — silently empty for regular employees)
  const { birthdayEmployees } = useBirthdayEmployees(isAdmin || isHrmsManager);

  // ── Guards (after all hooks) ────────────────────────────────────────────────
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.mustResetPassword) return <Navigate to="/reset-password" replace />;

  const canAccess = profile?.role === 'admin' || profile?.hrmsAccess !== false;
  if (!canAccess) return <Navigate to="/" replace />;

  // Undismissed birthdays today: read localStorage — refreshes on each navigation
  const _todayStr = format(new Date(), 'yyyy-MM-dd');
  const undismissedBirthdays = birthdayEmployees.filter(
    (emp) => {
      try { return !localStorage.getItem(`dismissed_birthday_${emp.userId}_${_todayStr}`); }
      catch { return true; }
    },
  ).length;

  // Dashboard badge = unread announcements + undismissed birthday cards
  const dashboardBadge = unreadAnnouncements + undismissedBirthdays;
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
            const badge =
              path === '/hrms/dashboard'      ? dashboardBadge                      :
              path === '/hrms/announcements'  ? unreadAnnouncements + holidayBadge  :
              path === '/hrms/it-declaration' ? itDeclEmployeeBadge                 :
              path === '/hrms/performance'    ? selfAssessmentBadge                 :
              path === '/hrms/training'       ? myTrainingBadge                     : 0;
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

              {/* Super Admin: Permission Manager — only visible to the 3 protected accounts */}
              {isSA && (
                <NavLink
                  to="/hrms/admin/permissions"
                  end
                  className={({ isActive }) =>
                    `flex items-center gap-3 py-2.5 rounded-lg transition-colors mb-0.5 ${isActive ? 'pl-2.5 border-l-2' : 'pl-3'}`
                  }
                  style={({ isActive }) =>
                    isActive
                      ? { backgroundColor: '#1B2A4E', color: '#FFFFFF', borderColor: '#C9A961' }
                      : { color: '#C9A961' }
                  }
                >
                  <Lock size={17} className="shrink-0" />
                  <span className="text-sm flex-1 font-medium">Permission Manager</span>
                </NavLink>
              )}

              {ADMIN_NAV.map(({ path, label, icon: Icon }) => {
                const badge =
                  path === '/hrms/admin/access-requests' && !onAccessRequestsPage ? pendingRequests       :
                  path === '/hrms/admin/it-declarations'                           ? itDeclAdminBadge      :
                  path === '/hrms/admin/performance'                               ? pendingReviewCount    :
                  path === '/hrms/admin/training'                                  ? trainingAdminBadge    : 0;
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

              {/* Compliance section */}
              <div className="px-3 pt-4 pb-2 flex items-center gap-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: '#475569' }}>
                  Statutory
                </p>
                {overdueCompliance > 0 && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none"
                    style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}>
                    {overdueCompliance}
                  </span>
                )}
              </div>
              {COMPLIANCE_NAV.map(({ path, label, icon: Icon }) => (
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
                </NavLink>
              ))}

              {/* Lifecycle section */}
              <div className="px-3 pt-4 pb-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: '#475569' }}>
                  Lifecycle
                </p>
              </div>
              {LIFECYCLE_NAV.map(({ path, label, icon: Icon }) => {
                const badge =
                  path === '/hrms/admin/recruitment' ? interviewBadge   :
                  path === '/hrms/admin/onboarding'  ? onboardingBadge  :
                  path === '/hrms/admin/probation'   ? probationBadge   :
                  path === '/hrms/admin/offboarding' ? offboardingBadge : 0;
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
                        style={{
                          backgroundColor: path === '/hrms/admin/offboarding' ? '#DC2626'
                                         : path === '/hrms/admin/probation'   ? '#D97706'
                                         : '#C9A961',
                          color: path === '/hrms/admin/offboarding' ? '#FFFFFF'
                               : path === '/hrms/admin/probation'   ? '#FFFFFF'
                               : '#0B1538',
                        }}>
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
