import { useMemo, useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Clock, Receipt, ChevronRight, AlertCircle, Megaphone } from 'lucide-react';
import { workingDaysInMonth } from '../../../lib/workingDays';
import {
  greeting, useTeamToday, BirthdaySection, UpcomingBirthdaysSection,
  AnniversarySection, UpcomingAnniversariesSection, isBirthdayDismissed,
  dismissBirthdayInStorage, isAnniversaryDismissed, dismissAnniversaryInStorage,
} from './dashboardCelebrations';
import { HolidayBanner, AnnouncementBanner } from './dashboardBanners';
import { LeaveCard, HolidaysCard, TeamTodayCard } from './dashboardCards';
import {
  usePendingHrCounts, useHeadcount, MyRequestsCard, HrPendingActionsPanel, HeadcountCard, fmtClock,
} from './dashboardAdminPanels';
import { useAuth } from '../../auth/AuthContext';
import { StatCard, PageHeader } from '../../../components/ui/primitives';
import { useMyAttendance, useTodayAttendance } from '../hooks/useAttendance';
import { useMyLeaveBalance, usePendingApprovals } from '../hooks/useLeave';
import { useHolidays, seedHolidays2026 } from '../hooks/useHolidays';
import { useMyPayslips } from '../hooks/usePayslips';
import { useAnnouncements, markAnnouncementRead, useUnreadAnnouncementCount } from '../hooks/useAnnouncements';
import { useBirthdayEmployees } from '../hooks/useBirthdayEmployees';
import { useWorkAnniversaries } from '../hooks/useWorkAnniversaries';

// ─── HrmsDashboardPage ────────────────────────────────────────────────────────

export function HrmsDashboardPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin   = profile?.role === 'admin';
  const isManager = isAdmin || profile?.isHrmsManager === true;

  const uid = user?.uid ?? '';
  const today       = new Date();
  const currentMonth = format(today, 'yyyy-MM');
  const currentYear  = today.getFullYear();

  const { records: attendanceRecords, loading: attLoading } = useMyAttendance(uid, currentMonth);
  const { record: todayAttendance } = useTodayAttendance(uid);
  const { balance,  loading: balLoading }  = useMyLeaveBalance(uid, currentYear);
  const { holidays, loading: holLoading }  = useHolidays(currentYear);
  const { payslips, loading: payLoading }  = useMyPayslips(uid);
  const { applications: pendingApprovals } = usePendingApprovals();
  const unreadCount = useUnreadAnnouncementCount(uid);

  const teamToday    = useTeamToday(isManager);
  const pendingCounts = usePendingHrCounts(isManager);
  const headcount    = useHeadcount(isAdmin);

  // Hoist announcements so we can drive the auto-read effect + banner in one subscription
  const { announcements, loading: announcementsLoading } = useAnnouncements();

  // Birthday data — only fetched for admin/manager (employee_profiles is restricted)
  const { birthdayEmployees: allBirthdays, upcomingBirthdays } = useBirthdayEmployees(isManager);

  // Dismissal state for today's birthday cards
  const [dismissedBirthdays, setDismissedBirthdays] = useState<Set<string>>(new Set());

  // When birthday list loads, read dismissal flags from localStorage
  useEffect(() => {
    if (allBirthdays.length === 0) return;
    const dismissed = new Set<string>();
    for (const emp of allBirthdays) {
      if (isBirthdayDismissed(emp.userId)) dismissed.add(emp.userId);
    }
    setDismissedBirthdays(dismissed);
  }, [allBirthdays]);

  const visibleBirthdays = allBirthdays.filter((emp) => !dismissedBirthdays.has(emp.userId));

  function handleDismissBirthday(userId: string) {
    dismissBirthdayInStorage(userId);
    setDismissedBirthdays((prev) => new Set([...prev, userId]));
  }

  // Work anniversary data — only fetched for admin/manager
  const { anniversaryEmployees: allAnniversaries, upcomingAnniversaries } = useWorkAnniversaries(isManager);

  // Dismissal state for today's anniversary cards
  const [dismissedAnniversaries, setDismissedAnniversaries] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (allAnniversaries.length === 0) return;
    const dismissed = new Set<string>();
    for (const emp of allAnniversaries) {
      if (isAnniversaryDismissed(emp.userId)) dismissed.add(emp.userId);
    }
    setDismissedAnniversaries(dismissed);
  }, [allAnniversaries]);

  const visibleAnniversaries = allAnniversaries.filter((emp) => !dismissedAnniversaries.has(emp.userId));

  function handleDismissAnniversary(userId: string) {
    dismissAnniversaryInStorage(userId);
    setDismissedAnniversaries((prev) => new Set([...prev, userId]));
  }

  // ── Auto-read: mark all unread announcements as read after 3 s ───────────────
  // Only fires once per page load (ref guard). Gives the user time to actually see it.
  const autoReadFired = useRef(false);

  useEffect(() => {
    if (autoReadFired.current || announcementsLoading || !uid) return;

    const unread = announcements.filter(
      (a) => a.isActive && !(a.readBy ?? []).includes(uid),
    );
    if (unread.length === 0) {
      autoReadFired.current = true;
      return;
    }

    const timer = setTimeout(() => {
      autoReadFired.current = true;
      for (const a of unread) {
        markAnnouncementRead(a.id, uid).catch(() => {});
      }
    }, 3000);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcements, announcementsLoading, uid]);

  // Auto-seed 2026 holidays if collection is empty (non-blocking)
  useEffect(() => { seedHolidays2026().catch((e) => console.error('[seedHolidays2026]', e)); }, []);

  // ── Attendance stats ───────────────────────────────────────────────────────
  const { presentDays, halfDays, workingDays } = useMemo(() => {
    const holidayDates = holidays.map((h) => h.date);
    return {
      presentDays:  attendanceRecords.filter((r) => r.status === 'present').length,
      halfDays:     attendanceRecords.filter((r) => r.status === 'half_day').length,
      workingDays:  workingDaysInMonth(today.getFullYear(), today.getMonth() + 1, holidayDates),
    };
  }, [attendanceRecords, holidays]);

  const latestPayslip  = payslips[0] ?? null;
  const myPendingLeave = pendingApprovals.filter((a) => a.employeeId === uid).length;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Greeting */}
      <PageHeader
        title={profile?.displayName ? greeting(profile.displayName) : 'Welcome back.'}
        pinKey="hrms.dashboard"
        subtitle={
          <>
            {format(today, 'EEEE, dd MMMM yyyy')}
            {myPendingLeave > 0 && (
              <span className="ml-3 inline-flex items-center gap-1" style={{ color: '#C9A961' }}>
                <AlertCircle size={12} /> {myPendingLeave} leave application{myPendingLeave > 1 ? 's' : ''} pending
              </span>
            )}
          </>
        }
      />

      {/* Quick Actions — pinned at top below greeting */}
      <div className="glass-panel p-4 mb-6">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Quick Actions</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { label: 'Apply for Leave',  path: '/hrms/leave/apply',       color: '#60a5fa' },
            { label: 'Clock In / Out',   path: '/hrms/attendance',        color: '#34d399' },
            { label: 'Submit Claim',     path: '/hrms/claims',            color: '#a78bfa' },
            { label: 'View Payslips',    path: '/hrms/payslips',          color: '#34d399' },
            { label: 'Refer a Lead',     path: '/crm/referrals/new',      color: '#C9A961' },
          ].map(({ label, path, color }) => (
            <button key={path} onClick={() => navigate(path)}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-center transition-opacity hover:opacity-80 glass-panel"
              style={{ color }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Holiday banner — all employees; shows when a holiday is within 3 days */}
      <HolidayBanner holidays={holidays} />

      {/* Birthday cards — admin/manager only; hidden when all dismissed */}
      <BirthdaySection employees={visibleBirthdays} onDismiss={handleDismissBirthday} />

      {/* Anniversary cards — admin/manager only; hidden when all dismissed */}
      <AnniversarySection employees={visibleAnniversaries} onDismiss={handleDismissAnniversary} />

      {/* Announcements banner — pinned/urgent only */}
      <AnnouncementBanner userId={uid} announcements={announcements} />

      {/* 4-card grid — 1 col on mobile, 2 on tablet, 4 on desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={<Clock size={18} />}
          label="Attendance this month"
          value={`${presentDays + halfDays} / ${workingDays}`}
          sub={todayAttendance?.checkIn
            ? (todayAttendance.checkOut ? 'Today: done for the day ✓' : `Today: clocked in ${fmtClock(todayAttendance.checkIn)}`)
            : 'Today: not clocked in yet'}
          accent={todayAttendance?.checkIn ? '#5B9BD5' : '#F59E0B'}
          link="/hrms/attendance"
          loading={attLoading}
        />
        <LeaveCard loading={balLoading} balance={balance} />
        <HolidaysCard holidays={holidays} loading={holLoading} />
        <StatCard
          icon={<Receipt size={18} />}
          label="Latest Payslip"
          value={latestPayslip ? `₹${latestPayslip.netPay.toLocaleString('en-IN')}` : '—'}
          sub={latestPayslip
            ? new Date(latestPayslip.month + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' })
            : 'No payslips yet'}
          accent="#34A853"
          link="/hrms/payslips"
          loading={payLoading}
        />
      </div>

      {/* Employee: status of everything I've requested (hidden when nothing pending) */}
      <MyRequestsCard uid={uid} />

      {/* Manager: consolidated pending actions panel (leave + claims + IT decl + encashment) */}
      {isManager && (
        <HrPendingActionsPanel
          leaveCount={pendingApprovals.length}
          claimsCount={pendingCounts.claims}
          itDeclCount={pendingCounts.itDecl}
          encashmentCount={pendingCounts.encashment}
        />
      )}

      {/* Team Today — managers only */}
      {isManager && (
        <div className="mb-6">
          <TeamTodayCard
            present={teamToday.present}
            leave={teamToday.leave}
            absent={teamToday.absent}
            loading={teamToday.loading}
          />
        </div>
      )}

      {/* Headcount summary — admin only */}
      {isAdmin && headcount.total > 0 && (
        <div className="mb-6">
          <HeadcountCard total={headcount.total} byDept={headcount.byDept} />
        </div>
      )}

      {/* Upcoming Birthdays — admin/manager only; hidden when none in next 7 days */}
      <UpcomingBirthdaysSection employees={upcomingBirthdays} />

      {/* Upcoming Anniversaries — admin/manager only; hidden when none in next 7 days */}
      <UpcomingAnniversariesSection employees={upcomingAnniversaries} />

      {/* Announcements count badge (if unread) */}
      {unreadCount > 0 && (
        <button
          onClick={() => navigate('/hrms/announcements')}
          className="w-full mt-4 group flex items-center justify-between glass-panel glass-card px-6 py-4 transition-all">
          <div className="flex items-center gap-3">
            <Megaphone size={18} style={{ color: '#C9A961' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {unreadCount} unread announcement{unreadCount > 1 ? 's' : ''}
            </p>
          </div>
          <ChevronRight size={16} style={{ color: 'var(--text-dim)' }} className="group-hover:opacity-70 transition-all" />
        </button>
      )}
    </div>
  );
}
