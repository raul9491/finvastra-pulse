import { useState, useEffect, useCallback, useRef } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  parseISO,
  addMonths,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, Clock, X } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { UserProfile } from '../../../types';
import { useMyAttendance, useTodayAttendance, checkIn, checkOut } from '../hooks/useAttendance';
import { useGeofenceConfig, enforceGeofence } from '../../../lib/geo';
import { isWorkingDay } from '../../../lib/workingDays';
import { isSuperAdmin } from '../../../config/hrmsConfig';
import type { AttendanceStatus, Attendance } from '../../../types';
import {
  useMyRegularizations, submitRegularization,
  type SubmitRegularizationInput,
} from '../hooks/useAttendanceRegularization';
import { notifyManagerOfRequest } from '../../../lib/notifications';
import type { AttendanceRegularization } from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<AttendanceStatus, { bg: string; dot: string; label: string }> = {
  present:  { bg: 'rgba(52,211,153,0.12)',  dot: '#34d399', label: 'Present'  },
  half_day: { bg: 'rgba(251,191,36,0.12)',  dot: '#fbbf24', label: 'Half-day' },
  absent:   { bg: 'rgba(248,113,113,0.12)', dot: '#f87171', label: 'Absent'   },
  leave:    { bg: 'rgba(96,165,250,0.12)',  dot: '#60a5fa', label: 'Leave'    },
  holiday:  { bg: 'rgba(201,169,97,0.12)',  dot: '#C9A961', label: 'Holiday'  },
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
      {/* gradient banner */}
      <div
        className="h-28 rounded-2xl"
        style={{
          background: 'linear-gradient(135deg, rgba(11,21,56,0.80) 0%, rgba(27,42,78,0.70) 100%)',
          border: '1px solid var(--shell-border-mid)',
        }}
      />
      {/* Avatar overlapping banner bottom by 52px */}
      <div className="absolute left-6" style={{ bottom: '-52px' }}>
        {profile.photoURL ? (
          <img
            src={profile.photoURL}
            alt={profile.displayName}
            className="w-26 h-26 rounded-3xl object-cover"
            style={{ width: 104, height: 104, border: '3px solid rgba(201,169,97,0.40)', boxShadow: '0 4px 20px rgba(0,0,0,0.40)' }}
          />
        ) : (
          <div
            className="flex items-center justify-center text-2xl font-bold"
            style={{ width: 104, height: 104, borderRadius: 24, backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '3px solid rgba(201,169,97,0.40)', boxShadow: '0 4px 20px rgba(0,0,0,0.40)' }}
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
        className="text-2xl"
        style={{ fontFamily: '"Fraunces", Georgia, serif', fontWeight: 600, color: 'var(--text-primary)' }}
      >
        {profile.displayName}
      </h2>
      <div className="flex flex-wrap items-center gap-2 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        {profile.designation && <span>{profile.designation}</span>}
        {profile.designation && profile.department && <span style={{ color: 'var(--text-dim)' }}>·</span>}
        {profile.department && <span>{profile.department}</span>}
        {(profile.designation || profile.department) && <span style={{ color: 'var(--text-dim)' }}>·</span>}
        <span className="font-mono">
          {profile.employeeId ?? profile.userId.slice(-8).toUpperCase()}
        </span>
      </div>
    </div>
  );
}

// ─── Regularize Modal ─────────────────────────────────────────────────────────

const REG_STATUS_STYLES: Record<AttendanceRegularization['status'], { label: string; color: string; icon: typeof Clock }> = {
  pending:  { label: 'Pending Review', color: '#fbbf24', icon: Clock },
  approved: { label: 'Approved',       color: '#34d399', icon: CheckCircle2 },
  rejected: { label: 'Rejected',       color: '#f87171', icon: AlertCircle },
};

interface RegularizeModalProps {
  date:            string;           // YYYY-MM-DD
  existingRecord:  Attendance | null;
  employeeId:      string;
  employeeName:    string;
  existingReqForDate: AttendanceRegularization | null;
  onClose:         () => void;
}

function RegularizeModal({
  date, existingRecord, employeeId, employeeName, existingReqForDate, onClose,
}: RegularizeModalProps) {
  const [checkInTime,  setCheckInTime]  = useState('09:00');
  const [checkOutTime, setCheckOutTime] = useState('18:00');
  const [reason,       setReason]       = useState('');
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');

  const friendlyDate = format(parseISO(date), 'EEEE, dd MMM yyyy');
  const isPending = existingReqForDate?.status === 'pending';

  async function handleSubmit() {
    if (!reason.trim()) { setError('Please provide a reason.'); return; }
    if (!checkInTime && !checkOutTime) { setError('Please enter at least one time.'); return; }
    setSaving(true);
    try {
      const input: SubmitRegularizationInput = {
        employeeId,
        employeeName,
        date,
        requestedCheckIn:  checkInTime  || null,
        requestedCheckOut: checkOutTime || null,
        reason:            reason.trim(),
        existingStatus:    existingRecord?.status ?? null,
      };
      await submitRegularization(input);
      // Notify the reporting manager (HR/admins as fallback) that a correction is
      // pending review — fire-and-forget, must not block the submit.
      notifyManagerOfRequest({
        kind: 'attendance',
        rows: [
          { label: 'Date', value: date },
          { label: 'Requested', value: [checkInTime && `In ${checkInTime}`, checkOutTime && `Out ${checkOutTime}`].filter(Boolean).join(' · ') || '—' },
          { label: 'Reason', value: reason.trim() },
        ],
        link: '/hrms/admin/attendance?tab=corrections',
      }).catch(() => {});
      onClose();
    } catch {
      setError('Failed to submit. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.60)', backdropFilter: 'blur(4px)' }}
    >
      <div className="glass-modal-panel w-full max-w-sm p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Request Attendance Correction
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{friendlyDate}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg transition-colors hover:bg-(--shell-hover-mid)"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* If already has a pending/approved/rejected request for this date */}
        {existingReqForDate && (
          <div
            className="rounded-xl px-4 py-3 text-sm"
            style={{
              backgroundColor: existingReqForDate.status === 'approved' ? 'rgba(52,211,153,0.12)'
                              : existingReqForDate.status === 'rejected' ? 'rgba(248,113,113,0.12)'
                              : 'rgba(251,191,36,0.12)',
              color: REG_STATUS_STYLES[existingReqForDate.status].color,
              border: `1px solid ${existingReqForDate.status === 'approved' ? 'rgba(52,211,153,0.25)'
                                 : existingReqForDate.status === 'rejected' ? 'rgba(248,113,113,0.25)'
                                 : 'rgba(251,191,36,0.25)'}`,
            }}
          >
            <p className="font-semibold">{REG_STATUS_STYLES[existingReqForDate.status].label}</p>
            {existingReqForDate.rejectionReason && (
              <p className="text-xs mt-1">Reason: {existingReqForDate.rejectionReason}</p>
            )}
            {isPending && (
              <p className="text-xs mt-1 opacity-75">A request is already pending for this date.</p>
            )}
          </div>
        )}

        {!isPending && (
          <>
            {/* Current status */}
            {existingRecord && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Current: {STATUS_STYLES[existingRecord.status].label}
                {existingRecord.checkIn && ` · In: ${formatTime(existingRecord.checkIn)}`}
                {existingRecord.checkOut && ` · Out: ${formatTime(existingRecord.checkOut)}`}
              </p>
            )}

            {/* Time inputs */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Check-in Time
                </label>
                <input
                  type="time"
                  value={checkInTime}
                  onChange={(e) => setCheckInTime(e.target.value)}
                  className="glass-inp w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                  Check-out Time
                </label>
                <input
                  type="time"
                  value={checkOutTime}
                  onChange={(e) => setCheckOutTime(e.target.value)}
                  className="glass-inp w-full text-sm"
                />
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                Reason <span style={{ color: '#f87171' }}>*</span>
              </label>
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => { setReason(e.target.value); setError(''); }}
                placeholder="Explain why you need this correction…"
                className="glass-inp w-full text-sm resize-none"
              />
            </div>

            {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={handleSubmit}
                disabled={saving || !reason.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 transition-all hover:brightness-110"
                style={{
                  background: 'linear-gradient(135deg, rgba(201,169,97,0.85), rgba(154,126,63,0.85))',
                  color: '#0B1538',
                  border: '1px solid rgba(201,169,97,0.40)',
                }}
              >
                {saving ? 'Submitting…' : 'Submit Request'}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-sm transition-colors hover:bg-(--shell-hover-mid)"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--shell-border-mid)' }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
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

  // ── Office geofence (admin-set) — clock in/out locked to the office radius ──
  const { config: geofence } = useGeofenceConfig();

  // ── Regularization state ───────────────────────────────────────────────────
  const [regularizeDate, setRegularizeDate] = useState<string | null>(null);
  const { requests: myRegularizations } = useMyRegularizations(userId, currentMonth);
  const regularizationMap = new Map(myRegularizations.map((r) => [r.date, r]));

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
      // Geofence check first — throws a readable error when outside the office
      // radius (or when location is denied while the geofence is enabled).
      // Field RMs on the exempt list clock from anywhere; GPS still recorded.
      const location = await enforceGeofence(geofence, userId);
      await checkIn(userId, location);
    } catch (err) {
      console.error('[AttendancePage] checkIn error:', err);
      showClockError(err instanceof Error ? err.message : 'Check-in failed. Please try again.');
    } finally {
      setCheckingIn(false);
    }
  }, [userId, geofence]);

  const handleCheckOut = useCallback(async () => {
    if (!todayRecord) return;
    const checkInDate = toDate(todayRecord.checkIn);
    if (!checkInDate) {
      showClockError('Cannot check out — no check-in time recorded.');
      return;
    }
    setCheckingOut(true);
    try {
      const location = await enforceGeofence(geofence, userId);
      await checkOut(todayRecord.id, checkInDate, location);
    } catch (err) {
      console.error('[AttendancePage] checkOut error:', err);
      showClockError(err instanceof Error ? err.message : 'Check-out failed. Please try again.');
    } finally {
      setCheckingOut(false);
    }
  }, [todayRecord, geofence]);

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
      <PageHeader
        title="Attendance"
        subtitle="Your clock-in history and monthly summary."
        pinKey="hrms.attendance"
      />

      {/* ── Today Card — mobile-first large clock-in ───────────────────── */}
      <div className="glass-panel overflow-hidden mb-6">
        {/* Dark header strip with live time */}
        <div className="px-6 pt-5 pb-4" style={{ background: 'linear-gradient(135deg, rgba(11,21,56,0.90) 0%, rgba(27,42,78,0.80) 100%)', borderBottom: '1px solid var(--shell-border)' }}>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] mb-2" style={{ color: '#C9A961' }}>
            Today — {format(today, 'EEEE, dd MMM yyyy')}
          </p>
          <p className="text-3xl font-mono font-semibold" style={{ color: '#f0ece0', letterSpacing: '0.05em' }}>
            {format(today, 'HH:mm')}
          </p>
        </div>

        <div className="p-6">
          {clockError && (
            <div className="mb-4 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}>
              {clockError}
            </div>
          )}

          {geofence?.enabled && (() => {
            const isFieldWorker = (geofence.exemptUids ?? []).includes(userId);
            // Location-recording detail is shown ONLY to super admins —
            // employees just see a friendly field-mode note (or the radius rule).
            const isSA = isSuperAdmin(userId, profile ?? undefined);
            if (isFieldWorker && !isSA) return null;
            return (
              <p className="mb-3 text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                {isFieldWorker
                  ? '📍 Field mode — you can clock in/out from anywhere; your location is recorded.'
                  : `📍 Clock in/out works within ${geofence.radiusMeters} m of ${geofence.label || 'the office'}.`}
              </p>
            );
          })()}

          {todayLoading && (
            <div className="h-14 rounded-2xl animate-pulse" style={{ backgroundColor: 'var(--glass-panel-bg)' }} />
          )}

          {/* Not yet clocked in — big full-width button */}
          {!todayLoading && !todayRecord && (
            <button
              onClick={handleCheckIn}
              disabled={checkingIn}
              className="w-full py-4 rounded-2xl font-bold transition-all hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-3"
              style={{
                background: 'linear-gradient(135deg, rgba(201,169,97,0.85), rgba(154,126,63,0.85))',
                color: '#0B1538',
                border: '1px solid rgba(201,169,97,0.40)',
                fontSize: '1.1rem',
              }}
            >
              <span style={{ fontSize: '1.4rem' }}>🕐</span>
              {checkingIn ? 'Checking in…' : 'Clock In'}
            </button>
          )}

          {/* Clocked in, not out */}
          {!todayLoading && todayRecord && !todayRecord.checkOut && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl px-5 py-4" style={{ backgroundColor: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.20)' }}>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: '#34d399' }}>Clocked in</p>
                  <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatTime(todayRecord.checkIn)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-muted)' }}>Duration</p>
                  <p className="text-2xl font-mono font-bold" style={{ color: '#C9A961' }}>{liveDuration}</p>
                </div>
              </div>
              <button
                onClick={handleCheckOut}
                disabled={checkingOut}
                className="w-full py-3.5 rounded-2xl font-bold transition-all hover:brightness-110 disabled:opacity-50"
                style={{
                  background: 'var(--glass-panel-bg)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--shell-border-mid)',
                  fontSize: '1rem',
                }}
              >
                {checkingOut ? 'Checking out…' : 'Clock Out'}
              </button>
            </div>
          )}

          {/* Done for the day — animated draw-in check */}
          {!todayLoading && todayRecord?.checkOut && (
            <div className="rounded-xl px-5 py-4 flex items-center gap-4" style={{ backgroundColor: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.20)' }}>
              <span className="shrink-0" style={{ animation: 'fv-pop 0.5s ease-out both' }}>
                <svg width="46" height="46" viewBox="0 0 52 52" aria-hidden="true">
                  <circle cx="26" cy="26" r="23" fill="none" stroke="#C9A961" strokeWidth="2" opacity="0.45"
                    strokeDasharray="145" strokeDashoffset="145"
                    style={{ animation: 'fv-draw 0.7s ease-out 0.1s forwards' }} />
                  <circle cx="26" cy="26" r="23" fill="rgba(52,211,153,0.10)" stroke="none" />
                  <path d="M16 27l7 7 14-15" fill="none" stroke="#34d399" strokeWidth="3.5"
                    strokeLinecap="round" strokeLinejoin="round"
                    strokeDasharray="34" strokeDashoffset="34"
                    style={{ animation: 'fv-draw 0.45s ease-out 0.5s forwards' }} />
                </svg>
              </span>
              <div>
                <p className="text-sm font-semibold" style={{ color: '#34d399' }}>Present today</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {formatTime(todayRecord.checkIn)} → {formatTime(todayRecord.checkOut)}
                  {' · '}{todayRecord.workingHours.toFixed(1)} hours
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Monthly Calendar ───────────────────────────────────────────────── */}
      <div className="glass-panel p-6">
        {/* Month nav */}
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={goPrev}
            className="p-1.5 rounded-lg transition-colors hover:bg-(--shell-hover-mid)"
            aria-label="Previous month"
          >
            <ChevronLeft size={18} style={{ color: 'var(--text-primary)' }} />
          </button>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {format(viewDate, 'MMMM yyyy')}
          </span>
          <button
            onClick={goNext}
            className="p-1.5 rounded-lg transition-colors hover:bg-(--shell-hover-mid)"
            aria-label="Next month"
            disabled={isSameDay(endOfMonth(viewDate), endOfMonth(today)) || viewDate > today}
          >
            <ChevronRight size={18} style={{ color: 'var(--text-primary)' }} />
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div
              key={d}
              className="text-center text-xs font-semibold py-1"
              style={{ color: 'var(--text-muted)' }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        {monthLoading ? (
          <div className="h-40 flex items-center justify-center">
            <span className="text-sm animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading…</span>
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
              // Finvastra works Mon-SAT: only Sunday is off. Using date-fns isWeekend
              // here excluded Saturdays, so a Saturday absence could never be
              // regularized (fixed 2026-07-23 — see src/lib/workingDays.ts).
              const isWknd = !isWorkingDay(day);
              const regReq = regularizationMap.get(dateStr);

              // Eligible for regularization: past working day that's absent OR missing check-in/out
              const isPastWorkDay = !isToday && !isFuture && !isWknd;
              const needsCorrection = isPastWorkDay && (
                !rec || rec.status === 'absent' || !rec.checkIn || !rec.checkOut
              );
              // Don't show if status is leave/holiday — no correction needed
              const isLeaveOrHoliday = rec?.status === 'leave' || rec?.status === 'holiday';
              const canRegularize = needsCorrection && !isLeaveOrHoliday;

              let bgColor = 'var(--shell-hover-soft)';
              let dotColor: string | null = null;

              if (rec) {
                const st = STATUS_STYLES[rec.status];
                bgColor = st.bg;
                dotColor = st.dot;
              } else if (isWknd) {
                bgColor = 'var(--shell-hover-soft)';
              }

              // Pending reg request turns the cell amber-tinted
              if (regReq?.status === 'pending') bgColor = 'rgba(251,191,36,0.12)';
              if (regReq?.status === 'approved') bgColor = 'rgba(52,211,153,0.12)';

              return (
                <div
                  key={dateStr}
                  className="relative flex flex-col items-center justify-center rounded-lg py-2 text-xs"
                  style={{
                    backgroundColor: bgColor,
                    border: isToday ? '2px solid #C9A961'
                          : regReq?.status === 'pending' ? '2px solid rgba(251,191,36,0.50)'
                          : '2px solid transparent',
                    opacity: isFuture ? 0.35 : 1,
                    minHeight: 44,
                  }}
                  title={rec ? STATUS_STYLES[rec.status].label : isWknd ? 'Weekend' : ''}
                >
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {format(day, 'd')}
                  </span>
                  {dotColor && (
                    <span
                      className="mt-0.5 w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: dotColor }}
                    />
                  )}
                  {/* Regularize button for eligible days */}
                  {canRegularize && !regReq && (
                    <button
                      onClick={() => setRegularizeDate(dateStr)}
                      className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold transition-opacity hover:opacity-80"
                      style={{ backgroundColor: 'rgba(201,169,97,0.20)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.40)' }}
                      title="Request attendance correction"
                    >?</button>
                  )}
                  {/* Pending indicator */}
                  {regReq?.status === 'pending' && (
                    <span
                      className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full"
                      style={{ backgroundColor: '#fbbf24' }}
                      title="Correction request pending"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Summary row ────────────────────────────────────────────────── */}
        <div className="mt-5 pt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs" style={{ borderTop: '1px solid var(--shell-border)', color: 'var(--text-muted)' }}>
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
              {label} <strong style={{ color: 'var(--text-primary)' }}>{summary[s] ?? 0}</strong>
            </span>
          ))}
        </div>

        {/* Regularize hint */}
        <p className="mt-3 text-[11px]" style={{ color: 'var(--text-dim)' }}>
          Tap the <strong style={{ color: '#C9A961' }}>?</strong> button on past days with missing or incorrect attendance to request a correction.
        </p>
      </div>

      {/* ── Correction Requests this month ────────────────────────────────────── */}
      {myRegularizations.length > 0 && (
        <div className="mt-6 glass-panel p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            My Correction Requests — {format(viewDate, 'MMMM yyyy')}
          </h3>
          <div className="space-y-3">
            {myRegularizations.map((req) => {
              const st = REG_STATUS_STYLES[req.status];
              const Icon = st.icon;
              return (
                <div
                  key={req.id}
                  className="flex items-start gap-3 rounded-xl px-4 py-3 text-xs"
                  style={{
                    backgroundColor: req.status === 'approved' ? 'rgba(52,211,153,0.10)'
                                   : req.status === 'rejected' ? 'rgba(248,113,113,0.10)'
                                   : 'rgba(251,191,36,0.10)',
                    border: `1px solid ${req.status === 'approved' ? 'rgba(52,211,153,0.25)'
                                       : req.status === 'rejected' ? 'rgba(248,113,113,0.25)'
                                       : 'rgba(251,191,36,0.25)'}`,
                  }}
                >
                  <Icon size={14} style={{ color: st.color, marginTop: 2, flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {format(parseISO(req.date), 'EEE, dd MMM')}
                      </span>
                      <span className="font-semibold uppercase tracking-wide" style={{ color: st.color }}>
                        {st.label}
                      </span>
                    </div>
                    <p style={{ color: 'var(--text-muted)' }}>
                      {req.requestedCheckIn && `In: ${req.requestedCheckIn}`}
                      {req.requestedCheckIn && req.requestedCheckOut && ' · '}
                      {req.requestedCheckOut && `Out: ${req.requestedCheckOut}`}
                    </p>
                    <p className="mt-0.5 truncate" style={{ color: 'var(--text-dim)' }}>{req.reason}</p>
                    {req.rejectionReason && (
                      <p className="mt-1 italic" style={{ color: '#f87171' }}>
                        HR note: {req.rejectionReason}
                      </p>
                    )}
                    {/* Rejected requests can be re-submitted */}
                    {req.status === 'rejected' && (
                      <button
                        onClick={() => setRegularizeDate(req.date)}
                        className="mt-1.5 text-[10px] font-semibold underline"
                        style={{ color: '#C9A961' }}
                      >
                        Submit a new request
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Regularize modal */}
      {regularizeDate && (
        <RegularizeModal
          date={regularizeDate}
          existingRecord={recordMap.get(regularizeDate) ?? null}
          employeeId={userId}
          employeeName={profile?.displayName ?? 'Employee'}
          existingReqForDate={regularizationMap.get(regularizeDate) ?? null}
          onClose={() => setRegularizeDate(null)}
        />
      )}
    </div>
  );
}
