import { useMemo, useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isWeekend, parseISO, differenceInCalendarDays,
} from 'date-fns';
import {
  Clock, CalendarOff, CalendarDays, Receipt, ChevronRight,
  AlertCircle, Megaphone, Pin, AlertTriangle, X, ReceiptText,
} from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useMyAttendance } from '../hooks/useAttendance';
import { useMyLeaveBalance, usePendingApprovals } from '../hooks/useLeave';
import { useHolidays, seedHolidays2026 } from '../hooks/useHolidays';
import { useMyPayslips } from '../hooks/usePayslips';
import { useAnnouncements, markAnnouncementRead, useUnreadAnnouncementCount } from '../hooks/useAnnouncements';
import { useBirthdayEmployees, type BirthdayEmployee, type UpcomingBirthdayEmployee } from '../hooks/useBirthdayEmployees';
import type { UserProfile, Attendance, Announcement } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function greeting(name: string): string {
  const h = new Date().getHours();
  const time = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return `Good ${time}, ${name.split(' ')[0]}.`;
}

function workingDaysInMonth(year: number, month: number, holidays: string[]): number {
  const start = startOfMonth(new Date(year, month - 1));
  const end   = endOfMonth(start);
  const holidaySet = new Set(holidays);
  return eachDayOfInterval({ start, end })
    .filter((d) => !isWeekend(d) && !holidaySet.has(format(d, 'yyyy-MM-dd')))
    .length;
}

// localStorage helpers for birthday dismissal
const todayStr = format(new Date(), 'yyyy-MM-dd');

function birthdayDismissKey(userId: string) {
  return `dismissed_birthday_${userId}_${todayStr}`;
}

function isBirthdayDismissed(userId: string): boolean {
  try { return !!localStorage.getItem(birthdayDismissKey(userId)); } catch { return false; }
}

function dismissBirthdayInStorage(userId: string) {
  try { localStorage.setItem(birthdayDismissKey(userId), '1'); } catch { /* storage unavailable */ }
}

// ─── Team Today hook (manager/admin only) ─────────────────────────────────────

function useTeamToday(enabled: boolean): { present: number; leave: number; absent: number; loading: boolean } {
  const [stats, setStats] = useState({ present: 0, leave: 0, absent: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    const today = format(new Date(), 'yyyy-MM-dd');
    const q = query(collection(db, 'attendance'), where('date', '==', today));
    getDocs(q).then((snap) => {
      let present = 0, leave = 0;
      snap.forEach((d) => {
        const s = d.data().status as string;
        if (s === 'present' || s === 'half_day') present++;
        else if (s === 'leave') leave++;
      });
      setStats({ present, leave, absent: 0 });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [enabled]);

  return { ...stats, loading };
}

// ─── Birthday Cards ───────────────────────────────────────────────────────────

function BirthdaySection({
  employees,
  onDismiss,
}: {
  employees: BirthdayEmployee[];
  onDismiss: (userId: string) => void;
}) {
  if (employees.length === 0) return null;

  return (
    <div className="mb-6">
      {employees.length > 1 && (
        <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#8B8B85' }}>
          {employees.length} birthdays today 🎉
        </p>
      )}
      <div className="space-y-2">
        {employees.map((emp) => (
          <div
            key={emp.userId}
            className="flex items-center gap-4 rounded-xl px-5 py-4"
            style={{
              borderLeft: '4px solid #C9A961',
              backgroundColor: 'rgba(201, 169, 97, 0.06)',
              border: '1px solid rgba(201, 169, 97, 0.25)',
              borderLeftWidth: '4px',
              borderLeftColor: '#C9A961',
            }}
          >
            {/* Cake icon */}
            <span className="text-2xl shrink-0 select-none" aria-hidden>🎂</span>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: '#0B1538' }}>
                Happy Birthday, {emp.displayName}! 🎉
              </p>
              {(emp.department || emp.designation) && (
                <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>
                  {[emp.department, emp.designation].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>

            {/* Right: confetti star */}
            <span className="text-xl shrink-0 select-none" aria-hidden>⭐</span>

            {/* Dismiss */}
            <button
              onClick={() => onDismiss(emp.userId)}
              className="shrink-0 p-1.5 rounded-lg hover:bg-black/5 transition-colors"
              title="Dismiss"
              aria-label={`Dismiss birthday card for ${emp.displayName}`}
            >
              <X size={14} style={{ color: '#8B8B85' }} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Upcoming Birthdays section ───────────────────────────────────────────────

function UpcomingBirthdaysSection({ employees }: { employees: UpcomingBirthdayEmployee[] }) {
  if (employees.length === 0) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
      <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#8B8B85' }}>
        Upcoming Birthdays
      </p>
      <div className="space-y-3">
        {employees.map((emp) => {
          const initials = emp.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
          return (
            <div key={emp.userId} className="flex items-center gap-3">
              {/* Avatar initial */}
              {emp.photoURL ? (
                <img
                  src={emp.photoURL}
                  alt={emp.displayName}
                  className="w-7 h-7 rounded-full object-cover shrink-0"
                />
              ) : (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#9A7E3F' }}
                >
                  {initials}
                </div>
              )}

              {/* Name + dept */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: '#0A0A0A' }}>
                  {emp.displayName}
                </p>
                {emp.designation && (
                  <p className="text-xs truncate" style={{ color: '#8B8B85' }}>{emp.designation}</p>
                )}
              </div>

              {/* Days until */}
              <span className="text-xs font-semibold whitespace-nowrap" style={{ color: '#C9A961' }}>
                in {emp.daysUntil} day{emp.daysUntil !== 1 ? 's' : ''} 🎂
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Holiday Banner ───────────────────────────────────────────────────────────
// Shows for ALL employees when a public holiday is within 3 calendar days.
// Pure date logic — no admin action needed. Dismiss per-holiday per-day via localStorage.

function HolidayBanner({ holidays }: { holidays: Array<{ id: string; date: string; name: string }> }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Read dismissal flags from localStorage whenever the holidays list changes
  useEffect(() => {
    if (holidays.length === 0) return;
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    const dis = new Set<string>();
    try {
      for (const h of holidays) {
        if (localStorage.getItem(`dismissed_holiday_${h.date}_${todayKey}`)) {
          dis.add(h.date);
        }
      }
    } catch { /* localStorage unavailable */ }
    setDismissed(dis);
  }, [holidays]);

  const today = new Date();
  const imminent = holidays
    .map((h) => ({ ...h, daysUntil: differenceInCalendarDays(parseISO(h.date), today) }))
    .filter(({ daysUntil, date }) => daysUntil >= 0 && daysUntil <= 3 && !dismissed.has(date))
    .sort((a, b) => a.daysUntil - b.daysUntil);

  if (imminent.length === 0) return null;

  function dismiss(date: string) {
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    try { localStorage.setItem(`dismissed_holiday_${date}_${todayKey}`, '1'); } catch { /* storage unavailable */ }
    setDismissed((prev) => new Set([...prev, date]));
  }

  return (
    <div className="space-y-3 mb-6">
      {imminent.map(({ id, date, name, daysUntil }) => {
        const hDate = parseISO(date);

        const pill =
          daysUntil === 0
            ? { bg: '#FEE2E2', color: '#991B1B', label: 'Today' }
            : daysUntil === 1
            ? { bg: '#FEF3C7', color: '#92400E', label: 'Tomorrow' }
            : { bg: 'rgba(201,169,97,0.15)', color: '#9A7E3F', label: `In ${daysUntil} days` };

        const subtext =
          daysUntil === 0
            ? `Today — Office closed. Wishing everyone a wonderful ${name}!`
            : daysUntil === 1
            ? `Tomorrow, ${format(hDate, 'EEE d MMM')} — Office closed.`
            : `This ${format(hDate, 'EEEE')}, ${format(hDate, 'd MMM')} — Office closed.`;

        return (
          <div
            key={id}
            className="flex items-center gap-4 rounded-xl px-5 py-4"
            style={{
              backgroundColor: 'rgba(201,169,97,0.08)',
              border: '1px solid rgba(201,169,97,0.3)',
              borderLeftWidth: '4px',
              borderLeftColor: '#C9A961',
            }}
          >
            <span className="text-2xl shrink-0 select-none" aria-hidden>🎉</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: '#0B1538' }}>{name}</p>
              <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>{subtext}</p>
            </div>
            <span
              className="text-xs font-bold px-2.5 py-1 rounded-full shrink-0"
              style={{ backgroundColor: pill.bg, color: pill.color }}
            >
              {pill.label}
            </span>
            <button
              onClick={() => dismiss(date)}
              className="shrink-0 p-1.5 rounded-lg hover:bg-black/5 transition-colors"
              title="Dismiss"
              aria-label={`Dismiss ${name} notification`}
            >
              <X size={14} style={{ color: '#8B8B85' }} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Announcements Banner ─────────────────────────────────────────────────────

function AnnouncementBanner({
  userId,
  announcements,
}: {
  userId: string;
  announcements: Announcement[];
}) {
  const unread = announcements.filter((a) => !(a.readBy ?? []).includes(userId));
  const pinned = unread.filter((a) => a.pinned || a.priority !== 'normal');

  if (pinned.length === 0) return null;

  const top = pinned[0];
  const isUrgent    = top.priority === 'urgent';
  const isImportant = top.priority === 'important';

  return (
    <div
      className="rounded-2xl border px-5 py-4 flex items-center gap-4 mb-6"
      style={{
        backgroundColor: isUrgent ? '#FFF1F2' : isImportant ? '#FFFBEB' : '#EFF6FF',
        borderColor:     isUrgent ? '#FECDD3' : isImportant ? '#FCD34D' : '#BFDBFE',
      }}
    >
      <div className="shrink-0">
        {isUrgent || isImportant ? (
          <AlertTriangle size={18} style={{ color: isUrgent ? '#BE123C' : '#92400E' }} />
        ) : (
          <Megaphone size={18} style={{ color: '#1D4ED8' }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {top.pinned && <Pin size={12} style={{ color: '#C9A961' }} />}
          <span className="text-sm font-semibold text-ink">{top.title}</span>
          {unread.length > 1 && (
            <span className="text-xs text-mute">+{unread.length - 1} more</span>
          )}
        </div>
        <p className="text-xs text-mute mt-0.5 truncate">{top.body}</p>
      </div>
      <button
        onClick={() => markAnnouncementRead(top.id, userId)}
        className="p-1.5 rounded-lg hover:bg-black/5 transition-colors shrink-0"
        title="Dismiss"
      >
        <X size={14} style={{ color: '#8B8B85' }} />
      </button>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, sub, accent, link, loading,
}: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string;
  accent?: string; link: string; loading?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(link)}
      className="group w-full text-left bg-white border border-slate-200 rounded-2xl p-6 hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: (accent ?? '#0B1538') + '15', color: accent ?? '#0B1538' }}>
          {icon}
        </div>
        <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-mute">{label}</p>
      {loading ? (
        <div className="h-8 w-24 bg-slate-100 rounded animate-pulse" />
      ) : (
        <p className="text-2xl font-bold text-ink">{value}</p>
      )}
      {sub && <p className="text-xs text-mute mt-1">{sub}</p>}
    </button>
  );
}

// ─── Leave balance mini-bars ──────────────────────────────────────────────────

function LeaveCard({ loading, balance }: {
  loading: boolean;
  balance: { casual: { remaining: number; total: number }; sick: { remaining: number; total: number }; earned: { remaining: number; total: number } } | null;
}) {
  const navigate = useNavigate();
  const types = [
    { key: 'casual' as const, label: 'Casual', color: '#C9A961' },
    { key: 'sick'   as const, label: 'Sick',   color: '#3B82F6' },
    { key: 'earned' as const, label: 'Earned', color: '#10B981' },
  ];
  return (
    <button onClick={() => navigate('/hrms/leave')}
      className="group w-full text-left bg-white border border-slate-200 rounded-2xl p-6 hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: '#C9A96115', color: '#C9A961' }}>
          <CalendarOff size={18} />
        </div>
        <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-mute">Leave Balance</p>
      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-4 bg-slate-100 rounded animate-pulse" />)}
        </div>
      ) : !balance ? (
        <p className="text-sm text-mute">No balance set yet</p>
      ) : (
        <div className="space-y-2.5">
          {types.map(({ key, label, color }) => {
            const b = balance[key];
            const pct = b.total > 0 ? (b.remaining / b.total) * 100 : 0;
            return (
              <div key={key}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-ink-soft">{label}</span>
                  <span className="font-semibold text-ink">{b.remaining} / {b.total}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </button>
  );
}

// ─── Upcoming holidays card ───────────────────────────────────────────────────

function HolidaysCard({ holidays, loading }: { holidays: { date: string; name: string; type: string }[]; loading: boolean }) {
  const navigate = useNavigate();
  const today = format(new Date(), 'yyyy-MM-dd');
  const upcoming = holidays.filter((h) => h.date >= today).slice(0, 3);
  return (
    <button onClick={() => navigate('/hrms/holidays')}
      className="group w-full text-left bg-white border border-slate-200 rounded-2xl p-6 hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: '#C9A96120', color: '#C9A961' }}>
          <CalendarDays size={18} />
        </div>
        <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-mute">Upcoming Holidays</p>
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-5 bg-slate-100 rounded animate-pulse" />)}</div>
      ) : upcoming.length === 0 ? (
        <p className="text-sm text-mute">No upcoming holidays</p>
      ) : (
        <div className="space-y-2">
          {upcoming.map((h) => (
            <div key={h.date} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">{h.name}</p>
                <p className="text-xs text-mute">{format(parseISO(h.date), 'EEE, dd MMM yyyy')}</p>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: h.type === 'national' ? '#EFF6FF' : h.type === 'regional' ? '#FFFBEB' : '#FAFAF7',
                  color:           h.type === 'national' ? '#1D4ED8' : h.type === 'regional' ? '#92400E' : '#C9A961',
                }}>
                {h.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

// ─── Team Today card ──────────────────────────────────────────────────────────

function TeamTodayCard({ present, leave, absent, loading }: { present: number; leave: number; absent: number; loading: boolean }) {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate('/hrms/admin/attendance')}
      className="group w-full text-left bg-white border border-slate-200 rounded-2xl p-6 hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: '#10B98115', color: '#065F46' }}>
          <Clock size={18} />
        </div>
        <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-mute">Team Today</p>
      {loading ? (
        <div className="h-8 w-24 bg-slate-100 rounded animate-pulse" />
      ) : (
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#16A34A' }} />
            <span className="text-ink-soft">{present} present / checked in</span>
          </div>
          {leave > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#2563EB' }} />
              <span className="text-ink-soft">{leave} on leave</span>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

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
  const { balance,  loading: balLoading }  = useMyLeaveBalance(uid, currentYear);
  const { holidays, loading: holLoading }  = useHolidays(currentYear);
  const { payslips, loading: payLoading }  = useMyPayslips(uid);
  const { applications: pendingApprovals } = usePendingApprovals();
  const unreadCount = useUnreadAnnouncementCount(uid);

  const teamToday = useTeamToday(isManager);

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
      <div className="mb-6">
        <h2 className="text-4xl mb-1 text-ink"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300 }}>
          {profile?.displayName ? greeting(profile.displayName) : 'Welcome back.'}
        </h2>
        <p className="text-sm text-mute">
          {format(today, 'EEEE, dd MMMM yyyy')}
          {myPendingLeave > 0 && (
            <span className="ml-3 inline-flex items-center gap-1 text-amber-700">
              <AlertCircle size={12} /> {myPendingLeave} leave application{myPendingLeave > 1 ? 's' : ''} pending
            </span>
          )}
        </p>
      </div>

      {/* Holiday banner — all employees; shows when a holiday is within 3 days */}
      <HolidayBanner holidays={holidays} />

      {/* Birthday cards — admin/manager only; hidden when all dismissed */}
      <BirthdaySection employees={visibleBirthdays} onDismiss={handleDismissBirthday} />

      {/* Announcements banner — pinned/urgent only */}
      <AnnouncementBanner userId={uid} announcements={announcements} />

      {/* 4-card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={<Clock size={18} />}
          label="Attendance this month"
          value={attLoading ? '…' : `${presentDays + halfDays} / ${workingDays}`}
          sub={halfDays > 0 ? `${presentDays} full · ${halfDays} half-day` : 'working days present'}
          accent="#0B1538"
          link="/hrms/attendance"
          loading={attLoading}
        />
        <LeaveCard loading={balLoading} balance={balance} />
        <HolidaysCard holidays={holidays} loading={holLoading} />
        <StatCard
          icon={<Receipt size={18} />}
          label="Latest Payslip"
          value={payLoading ? '…' : latestPayslip ? `₹${latestPayslip.netPay.toLocaleString('en-IN')}` : '—'}
          sub={latestPayslip
            ? new Date(latestPayslip.month + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' })
            : 'No payslips yet'}
          accent="#166534"
          link="/hrms/payslips"
          loading={payLoading}
        />
      </div>

      {/* Manager: pending approvals banner */}
      {isManager && pendingApprovals.length > 0 && (
        <button onClick={() => navigate('/hrms/leave/admin')}
          className="w-full group flex items-center justify-between bg-amber-50 border border-amber-200 rounded-2xl px-6 py-4 hover:shadow-sm transition-all mb-6">
          <div className="flex items-center gap-3">
            <AlertCircle size={18} className="text-amber-600" />
            <div className="text-left">
              <p className="text-sm font-semibold text-amber-900">
                {pendingApprovals.length} leave application{pendingApprovals.length > 1 ? 's' : ''} waiting for approval
              </p>
              <p className="text-xs text-amber-700">Oldest first — act before the employee's leave date</p>
            </div>
          </div>
          <ChevronRight size={16} className="text-amber-500 group-hover:translate-x-0.5 transition-transform" />
        </button>
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

      {/* Upcoming Birthdays — admin/manager only; hidden when none in next 7 days */}
      <UpcomingBirthdaysSection employees={upcomingBirthdays} />

      {/* Quick Actions */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-4 text-mute">Quick Actions</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Apply for Leave',  path: '/hrms/leave/apply',       color: '#1D4ED8' },
            { label: 'Clock In / Out',   path: '/hrms/attendance',        color: '#0B1538' },
            { label: 'Submit Claim',     path: '/hrms/claims',            color: '#7C3AED' },
            { label: 'View Payslips',    path: '/hrms/payslips',          color: '#166534' },
            { label: 'Refer a Lead',     path: '/crm/referrals/new',      color: '#C9A961' },
          ].map(({ label, path, color }) => (
            <button key={path} onClick={() => navigate(path)}
              className="px-4 py-3 rounded-xl text-sm font-semibold text-center transition-opacity hover:opacity-80"
              style={{ backgroundColor: color + '10', color }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Announcements count badge (if unread) */}
      {unreadCount > 0 && (
        <button
          onClick={() => navigate('/hrms/announcements')}
          className="w-full mt-4 group flex items-center justify-between bg-white border border-slate-200 rounded-2xl px-6 py-4 hover:shadow-sm transition-all">
          <div className="flex items-center gap-3">
            <Megaphone size={18} style={{ color: '#0B1538' }} />
            <p className="text-sm font-semibold" style={{ color: '#0B1538' }}>
              {unreadCount} unread announcement{unreadCount > 1 ? 's' : ''}
            </p>
          </div>
          <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
        </button>
      )}
    </div>
  );
}
