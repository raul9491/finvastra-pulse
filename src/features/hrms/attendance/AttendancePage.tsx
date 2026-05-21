import { useState, useEffect, useCallback, useRef } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isWeekend,
  isSameDay,
  parseISO,
  addMonths,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { UserProfile } from '../../../types';
import { useMyAttendance, useTodayAttendance, checkIn, checkOut } from '../hooks/useAttendance';
import type { AttendanceStatus, Attendance } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<AttendanceStatus, { bg: string; dot: string; label: string }> = {
  present:  { bg: '#F0FDF4', dot: '#16A34A', label: 'Present'  },
  half_day: { bg: '#FFFBEB', dot: '#D97706', label: 'Half-day' },
  absent:   { bg: '#FFF1F2', dot: '#E11D48', label: 'Absent'   },
  leave:    { bg: '#EFF6FF', dot: '#2563EB', label: 'Leave'    },
  holiday:  { bg: '#FAFAF7', dot: '#C9A961', label: 'Holiday'  },
};

function toDate(ts: Timestamp | null | undefined): Date | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  // Firestore sometimes returns a plain object with toDate as a function
  if (typeof (ts as unknown as { toDate?: () => Date }).toDate === 'function') {
    return (ts as unknown as { toDate: () => Date }).toDate();
  }
  return null;
}

function formatTime(ts: Timestamp | null | undefined): string {
  const d = toDate(ts);
  return d ? format(d, 'HH:mm') : '—';
}

function formatLiveDuration(startDate: Date): string {
  const totalSeconds = Math.floor((Date.now() - startDate.getTime()) / 1000);
  const hh = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
  const mm = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const ss = (totalSeconds % 60).toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ─── AttendancePage ───────────────────────────────────────────────────────────

// ─── Profile banner ───────────────────────────────────────────────────────────

function ProfileBanner({ profile }: { profile: UserProfile }) {
  const initials = (profile.displayName ?? 'U')
    .split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="relative mb-14">
      {/* 120px gradient banner */}
      <div
        className="h-28 rounded-2xl"
        style={{ background: 'linear-gradient(135deg, #0B1538 0%, #1B2A4E 100%)' }}
      />
      {/* Avatar overlapping banner bottom by 52px */}
      <div className="absolute left-6" style={{ bottom: '-52px' }}>
        {profile.photoURL ? (
          <img
            src={profile.photoURL}
            alt={profile.displayName}
            className="w-26 h-26 rounded-3xl object-cover"
            style={{ width: 104, height: 104, border: '4px solid white', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}
          />
        ) : (
          <div
            className="flex items-center justify-center text-2xl font-bold text-gold"
            style={{ width: 104, height: 104, borderRadius: 24, backgroundColor: '#0B1538', border: '4px solid white', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}
          >
            {initials}
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileMeta({ profile }: { profile: UserProfile }) {
  return (
    <div className="px-2 pb-6">
      <h2
        className="text-2xl text-ink"
        style={{ fontFamily: '"Fraunces", Georgia, serif', fontWeight: 600 }}
      >
        {profile.displayName}
      </h2>
      <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-mute">
        {profile.designation && <span>{profile.designation}</span>}
        {profile.designation && profile.department && <span className="text-slate-300">·</span>}
        {profile.department && <span>{profile.department}</span>}
        {(profile.designation || profile.department) && <span className="text-slate-300">·</span>}
        <span className="font-mono">
          {profile.employeeId ?? profile.userId.slice(-8).toUpperCase()}
        </span>
      </div>
    </div>
  );
}

// ─── AttendancePage ───────────────────────────────────────────────────────────

export function AttendancePage() {
  const { user, profile } = useAuth();
  const userId = user?.uid ?? '';

  // ── Month navigation state (YYYY-MM) ──────────────────────────────────────
  const [viewDate, setViewDate] = useState<Date>(new Date());
  const currentMonth = format(viewDate, 'yyyy-MM');

  const { records, loading: monthLoading } = useMyAttendance(userId, currentMonth);
  const { record: todayRecord, loading: todayLoading } = useTodayAttendance(userId);

  // ── Check-in / check-out loading flags + error ───────────────────────────
  const [checkingIn,  setCheckingIn]  = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [clockError,  setClockError]  = useState('');
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Live duration ticker ───────────────────────────────────────────────────
  const [liveDuration, setLiveDuration] = useState('');

  useEffect(() => {
    if (!todayRecord || todayRecord.checkOut) {
      setLiveDuration('');
      return;
    }
    const checkInDate = toDate(todayRecord.checkIn);
    if (!checkInDate) return;

    setLiveDuration(formatLiveDuration(checkInDate));
    const timer = setInterval(() => setLiveDuration(formatLiveDuration(checkInDate)), 1000);
    return () => clearInterval(timer);
  }, [todayRecord]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function showClockError(msg: string) {
    setClockError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setClockError(''), 5000);
  }

  const handleCheckIn = useCallback(async () => {
    if (!userId) return;
    setCheckingIn(true);
    try {
      await checkIn(userId);
    } catch (err) {
      console.error('[AttendancePage] checkIn error:', err);
      showClockError('Check-in failed. Please try again.');
    } finally {
      setCheckingIn(false);
    }
  }, [userId]);

  const handleCheckOut = useCallback(async () => {
    if (!todayRecord) return;
    const checkInDate = toDate(todayRecord.checkIn);
    if (!checkInDate) {
      showClockError('Cannot check out — no check-in time recorded.');
      return;
    }
    setCheckingOut(true);
    try {
      await checkOut(todayRecord.id, checkInDate);
    } catch (err) {
      console.error('[AttendancePage] checkOut error:', err);
      showClockError('Check-out failed. Please try again.');
    } finally {
      setCheckingOut(false);
    }
  }, [todayRecord]);

  // ── Calendar helpers ───────────────────────────────────────────────────────
  const recordMap = new Map<string, Attendance>(records.map((r) => [r.date, r]));

  const monthStart = startOfMonth(viewDate);
  const monthEnd   = endOfMonth(viewDate);
  const allDays    = eachDayOfInterval({ start: monthStart, end: monthEnd });
  // Pad the start so the grid starts on Sunday (0)
  const startPad   = monthStart.getDay(); // 0=Sun ... 6=Sat
  const today      = new Date();

  // ── Summary counts ─────────────────────────────────────────────────────────
  const summary = records.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<AttendanceStatus, number>,
  );

  // ── Month navigation ───────────────────────────────────────────────────────
  const goPrev = () => setViewDate((d) => subMonths(d, 1));
  const goNext = () => setViewDate((d) => addMonths(d, 1));

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Profile banner */}
      {profile && <ProfileBanner profile={profile as UserProfile} />}
      {profile && <ProfileMeta  profile={profile as UserProfile} />}

      {/* Page heading */}
      <h2
        className="text-3xl mb-1"
        style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}
      >
        Attendance
      </h2>
      <p className="mb-8 text-sm" style={{ color: '#8B8B85' }}>Your clock-in history and monthly summary.</p>

      {/* ── Today Card ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <h3
          className="text-xs font-bold uppercase tracking-widest mb-4"
          style={{ color: '#8B8B85' }}
        >
          Today — {format(today, 'dd MMM yyyy')}
        </h3>

        {clockError && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
            {clockError}
          </div>
        )}

        {todayLoading && (
          <div className="h-10 rounded-lg animate-pulse" style={{ background: '#F2EFE7', width: 180 }} />
        )}

        {!todayLoading && !todayRecord && (
          <button
            onClick={handleCheckIn}
            disabled={checkingIn}
            className="px-8 py-3 rounded-xl text-base font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
          >
            {checkingIn ? 'Checking in…' : '🕐 Check In'}
          </button>
        )}

        {!todayLoading && todayRecord && !todayRecord.checkOut && (
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-sm" style={{ color: '#8B8B85' }}>Checked in at</p>
              <p className="text-xl font-semibold" style={{ color: '#0A0A0A' }}>
                {formatTime(todayRecord.checkIn)}
              </p>
            </div>
            <div>
              <p className="text-sm mb-1" style={{ color: '#8B8B85' }}>Duration</p>
              <p className="text-lg font-mono" style={{ color: '#C9A961' }}>{liveDuration}</p>
            </div>
            <button
              onClick={handleCheckOut}
              disabled={checkingOut}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
              style={{ color: '#2A2A2A' }}
            >
              {checkingOut ? 'Checking out…' : 'Check Out'}
            </button>
          </div>
        )}

        {!todayLoading && todayRecord?.checkOut && (
          <p className="text-base font-medium" style={{ color: '#166534' }}>
            ✓ Present today — {todayRecord.workingHours.toFixed(1)} hours
          </p>
        )}
      </div>

      {/* ── Monthly Calendar ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        {/* Month nav */}
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={goPrev}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft size={18} style={{ color: '#2A2A2A' }} />
          </button>
          <span className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>
            {format(viewDate, 'MMMM yyyy')}
          </span>
          <button
            onClick={goNext}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="Next month"
            disabled={isSameDay(endOfMonth(viewDate), endOfMonth(today)) || viewDate > today}
          >
            <ChevronRight size={18} style={{ color: '#2A2A2A' }} />
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div
              key={d}
              className="text-center text-xs font-semibold py-1"
              style={{ color: '#8B8B85' }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        {monthLoading ? (
          <div className="h-40 flex items-center justify-center">
            <span className="text-sm animate-pulse" style={{ color: '#8B8B85' }}>Loading…</span>
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {/* Leading blank cells */}
            {Array.from({ length: startPad }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}

            {allDays.map((day) => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const rec = recordMap.get(dateStr);
              const isToday = isSameDay(day, today);
              const isFuture = day > today;
              const isWknd = isWeekend(day);

              let bgColor = '#FFFFFF';
              let dotColor: string | null = null;

              if (rec) {
                const style = STATUS_STYLES[rec.status];
                bgColor = style.bg;
                dotColor = style.dot;
              } else if (isWknd) {
                bgColor = '#F8F9FA';
              }

              return (
                <div
                  key={dateStr}
                  className="relative flex flex-col items-center justify-center rounded-lg py-2 text-xs"
                  style={{
                    backgroundColor: bgColor,
                    border: isToday ? '2px solid #C9A961' : '2px solid transparent',
                    opacity: isFuture ? 0.4 : 1,
                    minHeight: 44,
                  }}
                  title={rec ? STATUS_STYLES[rec.status].label : isWknd ? 'Weekend' : ''}
                >
                  <span className="font-medium" style={{ color: '#2A2A2A' }}>
                    {format(day, 'd')}
                  </span>
                  {dotColor && (
                    <span
                      className="mt-0.5 w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: dotColor }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Summary row ────────────────────────────────────────────────── */}
        <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap gap-x-5 gap-y-2 text-xs" style={{ color: '#2A2A2A' }}>
          {(
            [
              ['present',  'Present'],
              ['half_day', 'Half-day'],
              ['absent',   'Absent'],
              ['leave',    'Leave'],
            ] as [AttendanceStatus, string][]
          ).map(([s, label]) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: STATUS_STYLES[s].dot }}
              />
              {label} <strong>{summary[s] ?? 0}</strong>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
