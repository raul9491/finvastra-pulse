import { type ElementType, useState, useEffect } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { format } from 'date-fns';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { AnimatePresence, motion } from 'motion/react';
import {
  LayoutDashboard, Users, Clock, CalendarOff, Receipt, CalendarDays,
  Settings, LogOut, LayoutGrid, ClipboardList, FileText, UserPlus, Inbox,
  ReceiptText, FolderOpen, Megaphone, Building2, Calculator,
  Laptop, UserMinus, Lock, FileSearch2, GraduationCap, TrendingUp, Briefcase, BookOpen, LifeBuoy,
  BookUser, RotateCcw, ScrollText, HelpCircle, Database, User, Handshake,
  Menu, X, ChevronDown, Search, Network,
} from 'lucide-react';
import { auth, db } from '../../lib/firebase';
import { useAuth } from '../../features/auth/AuthContext';
import { isSuperAdmin } from '../../config/hrmsConfig';
import { VideoLogo } from '../ui/VideoLogo';
import { NotificationBell } from '../ui/NotificationBell';
import { ThemeToggle, useTheme } from '../ui/ThemeProvider';
import { UserMenu } from '../ui/UserMenu';
import { AppsMenu } from '../ui/AppsMenu';
import { CommandPalette, CommandSearchButton } from '../ui/CommandPalette';
import { ModuleSidebar } from './ModuleSidebar';
import { buildNavCtx } from '../../config/navigation';
import { SharePageButton } from '../ui/SharePageButton';
import { MobileTabBar } from '../ui/MobileTabBar';
import { SharedNavSection, locationCoveredByShares } from './SharedNavSection';
import { useMyShares } from '../../features/auth/hooks/useMyShares';
import { resolvePageKey } from '../../config/shareablePages';
import { useAutoStartTour } from '../../features/learn/useTour';
import { useUnreadAnnouncementCount, getUnseenHolidayCount } from '../../features/hrms/hooks/useAnnouncements';
import { useHolidays } from '../../features/hrms/hooks/useHolidays';
import { useMyItDeclaration, usePendingItDeclarationCount, currentFinancialYear } from '../../features/hrms/hooks/useItDeclarations';
import { useOverdueComplianceCount } from '../../features/hrms/compliance/ComplianceCalendarPage';
import { useLeaveYearResetBadge } from '../../features/hrms/hooks/useLeaveYearReset';
import { usePendingEncashmentCount } from '../../features/hrms/hooks/useLeaveEncashment';
import { useBirthdayEmployees } from '../../features/hrms/hooks/useBirthdayEmployees';
import { useWorkAnniversaries } from '../../features/hrms/hooks/useWorkAnniversaries';
import { useProbationBadge } from '../../features/hrms/hooks/useProbation';
import { usePendingReviewCount, useSelfAssessmentBadge, currentReviewYear } from '../../features/hrms/hooks/usePerformance';
import { useMyTrainingBadge, useTrainingAdminBadge } from '../../features/hrms/hooks/useTraining';
import { useMyOpenTicketCount, useOpenTicketCount } from '../../features/hrms/hooks/useHrTickets';
import { usePendingAcknowledgementCount } from '../../features/hrms/hooks/useDocumentAcknowledgements';
import { usePendingRegularizationCount } from '../../features/hrms/hooks/useAttendanceRegularization';

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

// Employee self-service nav — "Employees" omitted here; rendered conditionally below (admin/HR only)
const NAV: NavEntry[] = [
  { path: '/hrms/dashboard',     label: 'Dashboard',      icon: LayoutDashboard, live: true },
  { path: '/hrms/directory',     label: 'Directory',      icon: BookUser,        live: true },
  { path: '/hrms/attendance',    label: 'Attendance',     icon: Clock,           live: true },
  { path: '/hrms/leave',         label: 'Leave',          icon: CalendarOff,     live: true },
  { path: '/hrms/payslips',      label: 'Payslips',       icon: Receipt,         live: true },
  { path: '/hrms/claims',        label: 'My Claims',      icon: ReceiptText,     live: true },
  { path: '/hrms/documents',     label: 'Documents',      icon: FolderOpen,      live: true },
  { path: '/hrms/announcements', label: 'Announcements',  icon: Megaphone,       live: true },
  { path: '/hrms/it-declaration',label: 'IT Declaration', icon: FileSearch2,     live: true },
  { path: '/hrms/performance',   label: 'My Review',      icon: TrendingUp,      live: true },
  { path: '/hrms/training',      label: 'My Training',    icon: BookOpen,        live: true },
  { path: '/hrms/hr-helpdesk',   label: 'HR Helpdesk',    icon: LifeBuoy,        live: true },
  { path: '/hrms/guide',         label: 'Pulse Guide',    icon: HelpCircle,      live: true },
  { path: '/hrms/settings',      label: 'Settings',       icon: Settings,        live: true },
];

// Admin nav split into sub-groups for scannability
type AdminNavGroup = { label: string; items: NavEntry[] };
const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    label: 'People',
    items: [
      { path: '/hrms/employees',              label: 'Employees',        icon: Users,         live: true },
      { path: '/hrms/admin/access-requests',  label: 'Access Requests',  icon: Inbox,         live: true },
      { path: '/hrms/admin/import-employees', label: 'Import Employees', icon: UserPlus,      live: true },
    ],
  },
  {
    label: 'Time & Leave',
    items: [
      { path: '/hrms/admin/attendance',      label: 'Attendance',       icon: Clock,         live: true },
      { path: '/hrms/leave/admin',           label: 'Leave Approvals',  icon: ClipboardList, live: true },
      { path: '/hrms/admin/comp-off',        label: 'Comp Off Credits', icon: CalendarDays,  live: true },
      { path: '/hrms/admin/leave-year-end',  label: 'Year-End Reset',   icon: RotateCcw,     live: true },
      { path: '/hrms/admin/holidays',        label: 'Manage Holidays',  icon: CalendarDays,  live: true },
    ],
  },
  {
    label: 'Payroll & Finance',
    items: [
      { path: '/hrms/admin/payslips',        label: 'Generate Payslips', icon: FileText,    live: true },
      { path: '/hrms/admin/claims',          label: 'Claims',            icon: ReceiptText, live: true },
      { path: '/hrms/admin/salary-history',  label: 'Salary History',    icon: TrendingUp,  live: true },
      { path: '/hrms/admin/it-declarations', label: 'IT Declarations',   icon: FileSearch2, live: true },
    ],
  },
  {
    label: 'Content',
    items: [
      { path: '/hrms/admin/letters',       label: 'HR Letters',    icon: ScrollText, live: true },
      { path: '/hrms/admin/documents',     label: 'Documents',     icon: FolderOpen, live: true },
      { path: '/hrms/admin/announcements', label: 'Announcements', icon: Megaphone,  live: true },
    ],
  },
  {
    label: 'Performance',
    items: [
      { path: '/hrms/admin/performance', label: 'Performance Reviews', icon: TrendingUp, live: true },
      { path: '/hrms/admin/training',    label: 'Training',            icon: BookOpen,   live: true },
      { path: '/hrms/admin/hr-helpdesk', label: 'HR Helpdesk',         icon: LifeBuoy,   live: true },
    ],
  },
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
  '/hrms/directory':             'Employee Directory',
  '/hrms/attendance':            'Attendance',
  '/hrms/leave':                 'Leave',
  '/hrms/leave/apply':           'Apply for Leave',
  '/hrms/leave/team-calendar':   'Team Leave Calendar',
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
  '/hrms/admin/comp-off':        'Comp Off Credits',
  '/hrms/admin/holidays':        'Holidays — Admin',
  '/hrms/admin/payslips':        'Generate Payslips',
  '/hrms/admin/claims':          'Claims — Admin',
  '/hrms/admin/claims-analytics':'Claims Analytics',
  '/hrms/admin/documents':       'Documents — Admin',
  '/hrms/admin/announcements':   'Announcements — Admin',
  '/hrms/it-declaration':         'IT Declaration',
  '/hrms/admin/it-declarations':  'IT Declarations — Admin',
  '/hrms/performance':            'My Performance Review',
  '/hrms/admin/performance':      'Performance Reviews',
  '/hrms/admin/compliance':       'Compliance Calendar',
  '/hrms/admin/pf-tracker':      'PF Tracker',
  '/hrms/training':              'My Training',
  '/hrms/hr-helpdesk':          'HR Helpdesk',
  '/hrms/admin/training':       'Training & Development',
  '/hrms/admin/salary-history': 'Salary History',
  '/hrms/admin/hr-helpdesk':   'HR Helpdesk — Admin',
  '/hrms/admin/recruitment':    'Recruitment',
  '/hrms/admin/assets':          'Asset Management',
  '/hrms/admin/onboarding':      'Onboarding',
  '/hrms/admin/probation':       'Probation Management',
  '/hrms/admin/offboarding':     'Offboarding & FnF',
  '/hrms/admin/permissions':     'Permission Manager',
  '/hrms/org-chart':             'Organisation Chart',
  '/hrms/admin/leave-year-end':  'Leave Year-End Reset',
  '/hrms/admin/letters':         'HR Letter Generator',
  '/hrms/admin/data-import':     'Data Import',
};

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--navy-deep)' }}>
      <VideoLogo size="sm" showText />
    </div>
  );
}

export function HrmsShell() {
  const { user, profile, loading } = useAuth();
  const { theme } = useTheme();   // wordmark needs dark text on the light-mode header
  const location = useLocation();
  const navigate = useNavigate();

  // Mobile nav drawer state
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Derive roles before hooks so `enabled` flags are correct from the first render.
  // Safe when profile is null (still loading): all flags default to false.
  const isAdmin        = profile?.role === 'admin';
  const isHrmsManager  = profile?.isHrmsManager === true;
  const isSA           = isSuperAdmin(user?.uid ?? '', profile);

  // ── All hooks unconditionally at the top — Rules of Hooks ───────────────────
  // Early returns come AFTER this block. Hooks with `enabled=false` return safe
  // defaults and set up no subscriptions, so they're cheap when not needed.
  const pendingRequests     = usePendingRequestCount(isAdmin);
  const unreadAnnouncements = useUnreadAnnouncementCount(user?.uid ?? '');
  const leaveResetBadge     = useLeaveYearResetBadge(isAdmin || isHrmsManager);
  const pendingEncashCount  = usePendingEncashmentCount(isAdmin || isHrmsManager);
  const overdueCompliance   = useOverdueComplianceCount(isAdmin || isHrmsManager);
  const onboardingBadge     = useOnboardingBadge(isAdmin || isHrmsManager);
  const offboardingBadge    = useOffboardingBadge(isAdmin || isHrmsManager);
  const probationBadge      = useProbationBadge(isAdmin || isHrmsManager);
  const interviewBadge      = useInterviewBadge(isAdmin || isHrmsManager);
  const myTrainingBadge     = useMyTrainingBadge(user?.uid ?? '');
  const trainingAdminBadge  = useTrainingAdminBadge(isAdmin || isHrmsManager);
  const myOpenTickets       = useMyOpenTicketCount(user?.uid ?? '');
  const openTicketCount     = useOpenTicketCount(isAdmin || isHrmsManager);
  const pendingAckCount           = usePendingAcknowledgementCount(user?.uid ?? '');
  const pendingRegularizations    = usePendingRegularizationCount(isAdmin || isHrmsManager);
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
  // Work anniversary employees (admin/manager only)
  const { anniversaryEmployees } = useWorkAnniversaries(isAdmin || isHrmsManager);

  // Phase P — active page shares (exception grants for users without hrmsAccess).
  const myShares = useMyShares(user?.uid);

  // First-run guided tour for HRMS (auto-shows once, then remembered per user).
  useAutoStartTour('hrms');

  // Close mobile drawer automatically when the user navigates to a different page
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  // ── Guards (after all hooks) ────────────────────────────────────────────────
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.mustResetPassword) return <Navigate to="/reset-password" replace />;

  const hasDirectAccess = profile?.role === 'admin' || profile?.hrmsAccess !== false;

  // Phase P — never redirect while shares are still loading (hard-refresh race).
  if (!hasDirectAccess && myShares.loading) return <FullPageLoader />;

  const hrmsShares  = myShares.sharesByModule.hrms;
  const isShareOnly = !hasDirectAccess && hrmsShares.length > 0;
  const canAccess   = hasDirectAccess || isShareOnly;
  if (!canAccess) return <Navigate to="/" replace />;

  // Phase P — share-only users may open ONLY their shared pages (+ drill-downs).
  if (isShareOnly) {
    const key = resolvePageKey(location.pathname, location.search);
    if (!locationCoveredByShares(hrmsShares, key, location.pathname)) {
      return <Navigate to={hrmsShares[0].pageRoute} replace />;
    }
  }

  // Undismissed birthdays today: read localStorage — refreshes on each navigation
  const _todayStr = format(new Date(), 'yyyy-MM-dd');
  const undismissedBirthdays = birthdayEmployees.filter(
    (emp) => {
      try { return !localStorage.getItem(`dismissed_birthday_${emp.userId}_${_todayStr}`); }
      catch { return true; }
    },
  ).length;

  // Undismissed work anniversaries today: same localStorage pattern
  const undismissedAnniversaries = anniversaryEmployees.filter(
    (emp) => {
      try { return !localStorage.getItem(`dismissed_anniversary_${emp.userId}_${_todayStr}`); }
      catch { return true; }
    },
  ).length;

  // Dashboard badge = unread announcements + undismissed birthdays + undismissed anniversaries
  const dashboardBadge = unreadAnnouncements + undismissedBirthdays + undismissedAnniversaries;
  const onAccessRequestsPage = location.pathname === '/hrms/admin/access-requests';

  // ── Badge maps for the unified ModuleSidebar (computed in-shell; same values as
  //    the old hand-rolled nav) ───────────────────────────────────────────────
  const navCtx = buildNavCtx(user, profile);
  const hrmsSectionBadges = {
    'My Work':            { count: pendingRegularizations, color: 'gold' as const },
    'Company':            { count: unreadAnnouncements + holidayBadge + pendingAckCount, color: 'gold' as const },
    'Growth':             { count: itDeclEmployeeBadge + selfAssessmentBadge + myTrainingBadge, color: 'gold' as const },
    'Support':            { count: myOpenTickets, color: 'gold' as const },
    'People':             { count: pendingRequests, color: 'red' as const },
    'Time & Leave':       { count: pendingRegularizations + pendingEncashCount + leaveResetBadge, color: 'red' as const },
    'Payroll & Finance':  { count: itDeclAdminBadge, color: 'red' as const },
    'Performance':        { count: pendingReviewCount + trainingAdminBadge + openTicketCount, color: 'red' as const },
    'Statutory':          { count: overdueCompliance, color: 'red' as const },
    'Lifecycle':          { count: interviewBadge + onboardingBadge + probationBadge + offboardingBadge, color: 'amber' as const },
  };
  const hrmsItemBadges = {
    '/hrms/dashboard':              { count: dashboardBadge, color: 'gold' as const },
    '/hrms/documents':              { count: pendingAckCount, color: 'gold' as const },
    '/hrms/announcements':          { count: unreadAnnouncements + holidayBadge, color: 'gold' as const },
    '/hrms/it-declaration':         { count: itDeclEmployeeBadge, color: 'gold' as const },
    '/hrms/performance':            { count: selfAssessmentBadge, color: 'gold' as const },
    '/hrms/training':               { count: myTrainingBadge, color: 'gold' as const },
    '/hrms/hr-helpdesk':            { count: myOpenTickets, color: 'gold' as const },
    '/hrms/admin/access-requests':  { count: !onAccessRequestsPage ? pendingRequests : 0, color: 'red' as const },
    '/hrms/admin/attendance':       { count: pendingRegularizations, color: 'red' as const },
    '/hrms/leave/admin':            { count: pendingEncashCount, color: 'red' as const },
    '/hrms/admin/leave-year-end':   { count: leaveResetBadge, color: 'red' as const },
    '/hrms/admin/it-declarations':  { count: itDeclAdminBadge, color: 'red' as const },
    '/hrms/admin/performance':      { count: pendingReviewCount, color: 'red' as const },
    '/hrms/admin/training':         { count: trainingAdminBadge, color: 'red' as const },
    '/hrms/admin/hr-helpdesk':      { count: openTicketCount, color: 'red' as const },
    '/hrms/admin/recruitment':      { count: interviewBadge, color: 'gold' as const },
    '/hrms/admin/onboarding':       { count: onboardingBadge, color: 'gold' as const },
    '/hrms/admin/probation':        { count: probationBadge, color: 'amber' as const },
    '/hrms/admin/offboarding':      { count: offboardingBadge, color: 'red' as const },
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login', { replace: true });
  };

  const pageTitle = PAGE_TITLES[location.pathname]
    ?? (/^\/hrms\/employees\/[^/]+$/.test(location.pathname) ? 'Employee Profile' : 'HR & Operations');

  const initials = profile?.displayName
    ? profile.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  const navBody = (
    <div className="flex-1 px-2 overflow-y-auto pb-4 space-y-0.5">
      {isShareOnly ? (
        /* Phase P — share-only users see ONLY their shared pages */
        <SharedNavSection shares={hrmsShares} />
      ) : (
        <>
          <ModuleSidebar
            module="hrms"
            navCtx={navCtx}
            pathname={location.pathname}
            itemBadges={hrmsItemBadges}
            sectionBadges={hrmsSectionBadges}
          />
          {/* Phase P — full-access user who ALSO holds shares (edge case) */}
          <SharedNavSection shares={hrmsShares} />
        </>
      )}
    </div>
  );

  // ── User footer — same in sidebar and drawer ─────────────────────────────────
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
          <p className="text-[10px] uppercase tracking-widest truncate" style={{ color: isSA ? '#C9A961' : 'var(--shell-text-dim)' }}>
            {isSA ? '★ Super Admin' : profile?.role}
          </p>
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

        {navBody}
        {userFooter}
      </nav>

      {/* ── Mobile slide-out drawer ── */}
      <AnimatePresence>
        {mobileNavOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileNavOpen(false)}
            />
            {/* Drawer panel */}
            <motion.aside
              className="fixed inset-y-0 left-0 w-60 z-50 md:hidden flex flex-col glass-sidebar"
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              {/* Logo + close button */}
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

            <AppsMenu profile={profile} currentModule="hrms" />
            <div className="w-px h-4 hidden sm:block shrink-0" style={{ backgroundColor: 'var(--shell-border-mid)' }} />
            <h1 className="text-base font-semibold truncate min-w-0" style={{ color: 'var(--text-primary)' }}>{pageTitle}</h1>
          </div>

          {/* Right: share + notifications + user menu */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <CommandSearchButton />
            <SharePageButton pageKey={resolvePageKey(location.pathname, location.search)} />
            <ThemeToggle />
            {user && <NotificationBell uid={user.uid} />}
            <UserMenu
              displayName={profile?.displayName ?? ''}
              photoURL={profile?.photoURL}
              initials={initials}
              roleLabel={isSA ? '★ Super Admin' : (profile?.role ?? 'employee')}
              isSA={isSA}
              links={[
                { label: 'My Profile',      path: `/hrms/employees/${user?.uid}`, Icon: User       },
                { label: 'My Payslips',     path: '/hrms/payslips',               Icon: Receipt    },
                { label: 'My Leave',        path: '/hrms/leave',                  Icon: CalendarOff},
                { label: 'IT Declaration',  path: '/hrms/it-declaration',         Icon: FileSearch2},
                { label: 'Settings',        path: '/hrms/settings',               Icon: Settings   },
              ]}
              onLogout={handleLogout}
            />
          </div>
        </header>

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
            { label: 'Home',       path: '/hrms/dashboard',  Icon: LayoutDashboard, end: true },
            { label: 'Attendance', path: '/hrms/attendance', Icon: Clock, end: true },
            { label: 'Leave',      path: '/hrms/leave',      Icon: CalendarDays },
            { label: 'Claims',     path: '/hrms/claims',     Icon: Receipt, end: true },
          ]}
          onMenu={() => setMobileNavOpen(true)}
        />
      )}

      {/* Global ⌘K command palette */}
      <CommandPalette />
    </div>
  );
}
