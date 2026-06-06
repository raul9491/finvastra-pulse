import { useMemo, useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isWeekend, parseISO, differenceInCalendarDays,
} from 'date-fns';
import {
  Clock, CalendarOff, CalendarDays, Receipt, ChevronRight,
  AlertCircle, Megaphone, Pin, AlertTriangle, X, ReceiptText, Users,
} from 'lucide-react';
import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useMyAttendance } from '../hooks/useAttendance';
import { useMyLeaveBalance, usePendingApprovals } from '../hooks/useLeave';
import { useHolidays, seedHolidays2026 } from '../hooks/useHolidays';
import { useMyPayslips } from '../hooks/usePayslips';
import { useAnnouncements, markAnnouncementRead, useUnreadAnnouncementCount } from '../hooks/useAnnouncements';
import { useBirthdayEmployees, type BirthdayEmployee, type UpcomingBirthdayEmployee } from '../hooks/useBirthdayEmployees';
import { useWorkAnniversaries, milestoneLabel, isMilestoneYear, type AnniversaryEmployee, type UpcomingAnniversaryEmployee } from '../hooks/useWorkAnniversaries';
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

// localStorage helpers for anniversary dismissal
function anniversaryDismissKey(userId: string) {
  return `dismissed_anniversary_${userId}_${todayStr}`;
}

function isAnniversaryDismissed(userId: string): boolean {
  try { return !!localStorage.getItem(anniversaryDismissKey(userId)); } catch { return false; }
}

function dismissAnniversaryInStorage(userId: string) {
  try { localStorage.setItem(anniversaryDismissKey(userId), '1'); } catch { /* storage unavailable */ }
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
        <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
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
              <p className="text-sm font-semibold" style={{ color: '#C9A961' }}>
                Happy Birthday, {emp.displayName}! 🎉
              </p>
              {(emp.department || emp.designation) && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
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
    <div className="glass-panel glass-card p-6 mb-6">
      <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
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
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {emp.displayName}
                </p>
                {emp.designation && (
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{emp.designation}</p>
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

// ─── Anniversary Cards ────────────────────────────────────────────────────────

function AnniversarySection({
  employees,
  onDismiss,
}: {
  employees: AnniversaryEmployee[];
  onDismiss: (userId: string) => void;
}) {
  if (employees.length === 0) return null;

  return (
    <div className="mb-6">
      {employees.length > 1 && (
        <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
          {employees.length} work anniversaries today 🏅
        </p>
      )}
      <div className="space-y-2">
        {employees.map((emp) => {
          const isMilestone = isMilestoneYear(emp.yearsCompleted);
          const label       = milestoneLabel(emp.yearsCompleted);
          return (
            <div
              key={emp.userId}
              className="flex items-center gap-4 rounded-xl px-5 py-4"
              style={{
                backgroundColor: isMilestone ? 'rgba(11,21,56,0.04)' : 'rgba(201,169,97,0.04)',
                border: `1px solid ${isMilestone ? 'rgba(11,21,56,0.18)' : 'rgba(201,169,97,0.20)'}`,
                borderLeftWidth: '4px',
                borderLeftColor: isMilestone ? '#0B1538' : '#C9A961',
              }}
            >
              <span className="text-2xl shrink-0 select-none" aria-hidden>
                {isMilestone ? '🏅' : '🗓️'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {emp.displayName}
                  </p>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: isMilestone ? '#0B1538' : 'rgba(201,169,97,0.20)',
                      color:           isMilestone ? '#C9A961'  : '#9A7E3F',
                    }}
                  >
                    {label}
                  </span>
                </div>
                {(emp.department || emp.designation) && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {[emp.department, emp.designation].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <span className="text-xl shrink-0 select-none" aria-hidden>🎊</span>
              <button
                onClick={() => onDismiss(emp.userId)}
                className="shrink-0 p-1.5 rounded-lg hover:bg-black/5 transition-colors"
                title="Dismiss"
                aria-label={`Dismiss anniversary card for ${emp.displayName}`}
              >
                <X size={14} style={{ color: '#8B8B85' }} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Upcoming Anniversaries section ──────────────────────────────────────────

function UpcomingAnniversariesSection({ employees }: { employees: UpcomingAnniversaryEmployee[] }) {
  if (employees.length === 0) return null;

  return (
    <div className="glass-panel glass-card p-6 mb-6">
      <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
        Upcoming Anniversaries
      </p>
      <div className="space-y-3">
        {employees.map((emp) => {
          const initials = emp.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
          const isMilestone = isMilestoneYear(emp.yearsCompleted);
          return (
            <div key={emp.userId} className="flex items-center gap-3">
              {emp.photoURL ? (
                <img src={emp.photoURL} alt={emp.displayName}
                  className="w-7 h-7 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ backgroundColor: 'rgba(11,21,56,0.1)', color: '#0B1538' }}>
                  {initials}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {emp.displayName}
                </p>
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                  {milestoneLabel(emp.yearsCompleted)}
                  {isMilestone && ' 🏅'}
                </p>
              </div>
              <span className="text-xs font-semibold whitespace-nowrap" style={{ color: '#C9A961' }}>
                in {emp.daysUntil} day{emp.daysUntil !== 1 ? 's' : ''} 🗓️
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
              <p className="text-sm font-semibold" style={{ color: '#C9A961' }}>{name}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtext}</p>
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
        backgroundColor: isUrgent ? 'rgba(248,113,113,0.10)' : isImportant ? 'rgba(201,169,97,0.10)' : 'rgba(96,165,250,0.10)',
        borderColor:     isUrgent ? 'rgba(248,113,113,0.25)' : isImportant ? 'rgba(201,169,97,0.25)' : 'rgba(96,165,250,0.20)',
      }}
    >
      <div className="shrink-0">
        {isUrgent || isImportant ? (
          <AlertTriangle size={18} style={{ color: isUrgent ? '#f87171' : '#C9A961' }} />
        ) : (
          <Megaphone size={18} style={{ color: '#60a5fa' }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {top.pinned && <Pin size={12} style={{ color: '#C9A961' }} />}
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{top.title}</span>
          {unread.length > 1 && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>+{unread.length - 1} more</span>
          )}
        </div>
        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{top.body}</p>
      </div>
      <button
        onClick={() => markAnnouncementRead(top.id, userId)}
        className="p-1.5 rounded-lg hover:bg-white/10 transition-colors shrink-0"
        title="Dismiss"
      >
        <X size={14} style={{ color: 'var(--text-muted)' }} />
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
      className="group w-full text-left glass-panel glass-card p-6 transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961' }}>
          {icon}
        </div>
        <ChevronRight size={14} style={{ color: 'rgba(240,236,224,0.25)' }} className="group-hover:opacity-70 transition-opacity" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {loading ? (
        <div className="h-8 w-24 rounded animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
      ) : (
        <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
      )}
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
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
      className="group w-full text-left glass-panel glass-card p-6 transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961' }}>
          <CalendarOff size={18} />
        </div>
        <ChevronRight size={14} style={{ color: 'rgba(240,236,224,0.25)' }} className="group-hover:opacity-70 transition-opacity" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Leave Balance</p>
      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-4 rounded animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />)}
        </div>
      ) : !balance ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No balance set yet</p>
      ) : (
        <div className="space-y-2.5">
          {types.map(({ key, label, color }) => {
            const b = balance[key];
            const pct = b.total > 0 ? (b.remaining / b.total) * 100 : 0;
            return (
              <div key={key}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{b.remaining} / {b.total}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
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
      className="group w-full text-left glass-panel glass-card p-6 transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961' }}>
          <CalendarDays size={18} />
        </div>
        <ChevronRight size={14} style={{ color: 'rgba(240,236,224,0.25)' }} className="group-hover:opacity-70 transition-opacity" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Upcoming Holidays</p>
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-5 rounded animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />)}</div>
      ) : upcoming.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No upcoming holidays</p>
      ) : (
        <div className="space-y-2">
          {upcoming.map((h) => (
            <div key={h.date} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{h.name}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{format(parseISO(h.date), 'EEE, dd MMM yyyy')}</p>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: h.type === 'national' ? 'rgba(96,165,250,0.15)' : h.type === 'regional' ? 'rgba(201,169,97,0.15)' : 'rgba(255,255,255,0.06)',
                  color:           h.type === 'national' ? '#60a5fa' : h.type === 'regional' ? '#C9A961' : 'var(--text-muted)',
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
      className="group w-full text-left glass-panel glass-card p-6 transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(52,211,153,0.12)', color: '#34d399' }}>
          <Clock size={18} />
        </div>
        <ChevronRight size={14} style={{ color: 'rgba(240,236,224,0.25)' }} className="group-hover:opacity-70 transition-opacity" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Team Today</p>
      {loading ? (
        <div className="h-8 w-24 rounded animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
      ) : (
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#34d399' }} />
            <span style={{ color: 'var(--text-muted)' }}>{present} present / checked in</span>
          </div>
          {leave > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#60a5fa' }} />
              <span style={{ color: 'var(--text-muted)' }}>{leave} on leave</span>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

// ─── Pending HR action counts (admin/manager only) ───────────────────────────
// Three real-time subscriptions: claims, IT declarations, leave encashment.
// Leave count comes from the already-loaded usePendingApprovals() in the page.

function usePendingHrCounts(enabled: boolean) {
  const [counts, setCounts] = useState({ claims: 0, itDecl: 0, encashment: 0 });

  useEffect(() => {
    if (!enabled) return;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(
      query(collection(db, 'claims'), where('status', '==', 'pending')),
      (snap) => setCounts((c) => ({ ...c, claims: snap.size })),
      () => {},
    ));
    unsubs.push(onSnapshot(
      query(collection(db, 'it_declarations'), where('status', '==', 'submitted')),
      (snap) => setCounts((c) => ({ ...c, itDecl: snap.size })),
      () => {},
    ));
    unsubs.push(onSnapshot(
      query(collection(db, 'leave_encashment_requests'), where('status', '==', 'pending')),
      (snap) => setCounts((c) => ({ ...c, encashment: snap.size })),
      () => {},
    ));

    return () => unsubs.forEach((u) => u());
  }, [enabled]);

  return counts;
}

// ─── Headcount hook (admin only) ─────────────────────────────────────────────

function useHeadcount(enabled: boolean) {
  const [data, setData] = useState<{ total: number; byDept: [string, number][] }>({ total: 0, byDept: [] });

  useEffect(() => {
    if (!enabled) return;
    getDocs(query(collection(db, 'users'), where('status', '==', 'active')))
      .then((snap) => {
        const deptMap = new Map<string, number>();
        snap.forEach((d) => {
          const dept = (d.data() as { department?: string }).department ?? 'Other';
          deptMap.set(dept, (deptMap.get(dept) ?? 0) + 1);
        });
        setData({
          total:  snap.size,
          byDept: [...deptMap.entries()].sort((a, b) => b[1] - a[1]),
        });
      })
      .catch(() => {});
  }, [enabled]);

  return data;
}

// ─── HrPendingActionsPanel ────────────────────────────────────────────────────
// Consolidated panel showing every pending HR action type in one place.

function HrPendingActionsPanel({
  leaveCount, claimsCount, itDeclCount, encashmentCount,
}: {
  leaveCount:     number;
  claimsCount:    number;
  itDeclCount:    number;
  encashmentCount: number;
}) {
  const navigate = useNavigate();

  const actions = [
    { count: leaveCount,      label: 'leave application',    labelPlural: 'leave applications',    path: '/hrms/leave/admin',              color: '#1D4ED8' },
    { count: claimsCount,     label: 'expense claim',        labelPlural: 'expense claims',         path: '/hrms/admin/claims',             color: '#7C3AED' },
    { count: itDeclCount,     label: 'IT declaration',       labelPlural: 'IT declarations',        path: '/hrms/admin/it-declarations',    color: '#0891B2' },
    { count: encashmentCount, label: 'encashment request',   labelPlural: 'encashment requests',    path: '/hrms/leave/admin',              color: '#D97706' },
  ].filter((a) => a.count > 0);

  const total = actions.reduce((s, a) => s + a.count, 0);
  if (total === 0) return null;

  return (
    <div className="glass-panel p-5 mb-6" style={{ borderColor: 'rgba(201,169,97,0.20)' }}>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: '#C9A961' }}>
        {total} pending action{total !== 1 ? 's' : ''} need your review
      </p>
      <div className="space-y-1.5">
        {actions.map(({ count, label, labelPlural, path, color }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className="group w-full flex items-center justify-between glass-panel px-4 py-2.5 transition-all">
            <div className="flex items-center gap-3">
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                style={{ backgroundColor: color + '30', color }}>
                {count}
              </span>
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {count > 1 ? `${count} ${labelPlural}` : `${count} ${label}`} pending
              </span>
            </div>
            <ChevronRight size={14} style={{ color: 'rgba(240,236,224,0.25)' }} className="group-hover:opacity-70 transition-opacity shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── HeadcountCard ────────────────────────────────────────────────────────────

function HeadcountCard({ total, byDept }: { total: number; byDept: [string, number][] }) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate('/hrms/admin/employees')}
      className="group w-full text-left glass-panel glass-card p-6 transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961' }}>
            <Users size={18} />
          </div>
          <div className="text-left">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Headcount</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{total} active</p>
          </div>
        </div>
        <ChevronRight size={14} style={{ color: 'rgba(240,236,224,0.25)' }} className="group-hover:opacity-70 transition-opacity" />
      </div>
      {byDept.length > 0 && (
        <div className="space-y-2">
          {byDept.slice(0, 5).map(([dept, count]) => (
            <div key={dept} className="flex items-center gap-2">
              <span className="text-xs w-44 truncate shrink-0 text-left" style={{ color: 'var(--text-muted)' }}>{dept}</span>
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${(count / (total || 1)) * 100}%`, backgroundColor: 'rgba(201,169,97,0.50)' }} />
              </div>
              <span className="text-xs font-semibold w-4 text-right tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>{count}</span>
            </div>
          ))}
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
      <div className="mb-6">
        <h2 className="text-4xl mb-1"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          {profile?.displayName ? greeting(profile.displayName) : 'Welcome back.'}
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {format(today, 'EEEE, dd MMMM yyyy')}
          {myPendingLeave > 0 && (
            <span className="ml-3 inline-flex items-center gap-1" style={{ color: '#C9A961' }}>
              <AlertCircle size={12} /> {myPendingLeave} leave application{myPendingLeave > 1 ? 's' : ''} pending
            </span>
          )}
        </p>
      </div>

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
          <ChevronRight size={16} style={{ color: 'rgba(240,236,224,0.25)' }} className="group-hover:opacity-70 transition-all" />
        </button>
      )}
    </div>
  );
}
