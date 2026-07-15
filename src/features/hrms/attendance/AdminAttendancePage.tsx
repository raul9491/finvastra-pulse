import { useState, useCallback, useEffect } from 'react';
import { format, parseISO, getDaysInMonth } from 'date-fns';
import { Navigate } from 'react-router-dom';
import { Timestamp, getDocs, query, collection, where, orderBy } from 'firebase/firestore';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useTeamAttendance, adminMarkAttendance } from '../hooks/useAttendance';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import {
  useAllRegularizations,
  approveRegularization,
  rejectRegularization,
} from '../hooks/useAttendanceRegularization';
import { writeNotification, sendHrEmailNotification, buildHrEmailHtml } from '../../../lib/notifications';
import { useGeofenceConfig, saveGeofenceConfig, getCurrentPosition, mapsLink } from '../../../lib/geo';
import { MultiSearchableSelect } from '../../../components/ui/SearchableSelect';
import type { Attendance, AttendanceStatus, UserProfile, AttendanceRegularization } from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<AttendanceStatus, { bg: string; text: string; label: string }> = {
  present:  { bg: '#F0FDF4', text: '#166534', label: 'Present'  },
  half_day: { bg: '#FFFBEB', text: '#92400E', label: 'Half-day' },
  absent:   { bg: '#FFF1F2', text: '#9F1239', label: 'Absent'   },
  leave:    { bg: '#EFF6FF', text: '#1E40AF', label: 'Leave'    },
  holiday:  { bg: '#FAFAF7', text: '#C9A961', label: 'Holiday'  },
};

const ALL_STATUSES: AttendanceStatus[] = ['present', 'half_day', 'absent', 'leave', 'holiday'];

function toDate(ts: Timestamp | null | undefined): Date | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  if (typeof (ts as unknown as { toDate?: () => Date }).toDate === 'function') {
    return (ts as unknown as { toDate: () => Date }).toDate();
  }
  return null;
}

function formatTime(ts: Timestamp | null | undefined): string {
  const d = toDate(ts);
  return d ? format(d, 'HH:mm') : '—';
}

// ─── Inline Edit Row ─────────────────────────────────────────────────────────

interface EditRowProps {
  record: Attendance | null;
  userId: string;
  date: string;
  onSave: () => void;
  onCancel: () => void;
}

function EditRow({ record, userId, date, onSave, onCancel }: EditRowProps) {
  const [status, setStatus] = useState<AttendanceStatus>(record?.status ?? 'present');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [inTime, setInTime] = useState('');
  const [outTime, setOutTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      await adminMarkAttendance(record?.id ?? null, userId, date, status, notes,
        inTime || undefined, outTime || undefined);
      onSave();
    } catch (e) {
      console.error('adminMarkAttendance failed', e);
      setError('Could not save — you may not have permission, or the connection dropped. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const inp = 'text-sm border border-(--shell-border) rounded-lg px-2 py-1.5 bg-(--ss-bg)';
  return (
    <tr style={{ backgroundColor: 'var(--glass-panel-bg)' }}>
      <td colSpan={6} className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <select value={status} onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
            className={inp} style={{ color: 'var(--text-primary)' }}>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_STYLES[s].label}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            In
            <input type="time" value={inTime} onChange={(e) => setInTime(e.target.value)}
              className={inp} style={{ color: 'var(--text-primary)' }} />
          </label>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            Out
            <input type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)}
              className={inp} style={{ color: 'var(--text-primary)' }} />
          </label>
          <input type="text" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)}
            className={`${inp} flex-1 min-w-[140px]`} style={{ color: 'var(--text-primary)' }} />
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm border border-(--shell-border) hover:bg-(--shell-hover-soft)"
            style={{ color: 'var(--text-primary)' }}>
            Cancel
          </button>
        </div>
        {error && <p className="mt-2 text-xs" style={{ color: '#f87171' }}>{error}</p>}
      </td>
    </tr>
  );
}

// ─── MonthExportButton ────────────────────────────────────────────────────────
// Separate sub-component so we can call useMyAttendance per-employee only
// within the export flow without violating rules-of-hooks.

interface MonthExportProps {
  employees: UserProfile[];
  month: string; // YYYY-MM
}

// We only mount this component when the user clicks "Export Month". It reads
// all employees' month records from the hook of the first employee (demo) —
// but since hooks can't be called conditionally, we build a thin wrapper that
// collects from the hook for one employee at a time, then aggregates on the
// parent side.
//
// Given the small team size (~25 employees) we use a simpler approach: build
// the CSV from whatever records are already in-memory via the per-day query,
// accumulated across a full month using Firestore snapshot directly. The button
// triggers an imperative fetch (not a hook) to avoid complexity.

function ExportMonthButton({ employees, month }: MonthExportProps) {
  const [exporting, setExporting] = useState(false);

  // We need to do an imperative fetch of all attendance docs for the month.
  // We import getDocs directly here to keep the export self-contained.
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const startDate = `${month}-01`;
      const daysInMonth = getDaysInMonth(parseISO(`${month}-01`));
      const endDate = `${month}-${String(daysInMonth).padStart(2, '0')}`;

      const q = query(
        collection(db, 'attendance'),
        where('date', '>=', startDate),
        where('date', '<=', endDate),
        orderBy('date', 'asc'),
      );

      const snap = await getDocs(q);
      const records = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Attendance));

      // Build name lookup
      const nameMap = new Map<string, string>(
        employees.map((e) => [e.userId, e.displayName]),
      );

      const rows: string[] = [
        'Name,Date,Status,Check-in,Check-out,Hours,Notes',
      ];

      for (const r of records) {
        const name = nameMap.get(r.userId) ?? r.userId;
        const checkIn  = r.checkIn  ? format(toDate(r.checkIn)!,  'HH:mm') : '';
        const checkOut = r.checkOut ? format(toDate(r.checkOut)!, 'HH:mm') : '';
        const csvRow = [
          `"${name}"`,
          r.date,
          r.status,
          checkIn,
          checkOut,
          r.workingHours.toFixed(2),
          `"${r.notes.replace(/"/g, '""')}"`,
        ].join(',');
        rows.push(csvRow);
      }

      const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Finvastra-Attendance-${month}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [employees, month]);

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className="px-4 py-2 rounded-xl text-sm font-semibold border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors disabled:opacity-50"
      style={{ color: 'var(--text-primary)' }}
    >
      {exporting ? 'Exporting…' : 'Export Month CSV'}
    </button>
  );
}

// ─── RegularizationsTab ───────────────────────────────────────────────────────

const REG_STATUS_STYLES = {
  pending:  { label: 'Pending',  bg: '#FFFBEB', text: '#92400E', icon: Clock       },
  approved: { label: 'Approved', bg: '#F0FDF4', text: '#065F46', icon: CheckCircle2 },
  rejected: { label: 'Rejected', bg: '#FFF1F2', text: '#991B1B', icon: XCircle     },
};

interface RejectRegModalProps {
  req: AttendanceRegularization;
  reviewerName: string;
  reviewerId: string;
  onDone: () => void;
  onCancel: () => void;
}

function RejectRegModal({ req, reviewerName, reviewerId, onDone, onCancel }: RejectRegModalProps) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleReject() {
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await rejectRegularization(req.id, reviewerId, reviewerName, reason.trim());
      writeNotification(req.employeeId, {
        type: 'leave_rejected',
        title: 'Attendance Correction Rejected',
        body: `Your correction request for ${req.date} was rejected: ${reason.trim()}`,
        link: '/hrms/attendance',
      }).catch(() => {});
      sendHrEmailNotification({
        employeeId: req.employeeId,
        subject: 'Update on your attendance correction',
        htmlBody: buildHrEmailHtml({
          title: 'Your attendance correction was not approved',
          lines: [{ label: 'Date', value: req.date }],
          note:     reason.trim(),
          ctaLabel: 'View Attendance',
          ctaLink:  'https://pulse.finvastra.com/hrms/attendance',
        }),
      }).catch(() => {});
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-semibold text-(--text-primary)">Reject Correction Request</h3>
        <p className="text-xs text-(--text-muted)">
          {req.employeeName} · {req.date}
        </p>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
            Rejection Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this request rejected?"
            className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-navy/10"
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleReject}
            disabled={saving || !reason.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
            style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}
          >
            {saving ? 'Rejecting…' : 'Reject'}
          </button>
          <button onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-sm border border-(--shell-border) hover:bg-(--glass-panel-bg)">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

interface RegTabProps {
  reviewerId: string;
  reviewerName: string;
}

function RegularizationsTab({ reviewerId, reviewerName }: RegTabProps) {
  const [statusFilter, setStatusFilter] = useState('pending');
  const { requests, loading } = useAllRegularizations(statusFilter);
  const [rejectingReq, setRejectingReq] = useState<AttendanceRegularization | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  async function handleApprove(req: AttendanceRegularization) {
    setApprovingId(req.id);
    try {
      // Look up whether an attendance record already exists for this employee+date
      const existing = await getDocs(
        query(
          collection(db, 'attendance'),
          where('userId', '==', req.employeeId),
          where('date', '==', req.date),
        ),
      );
      const existingId = existing.docs[0]?.id ?? null;
      await approveRegularization(req, reviewerId, reviewerName, existingId);
      writeNotification(req.employeeId, {
        type: 'leave_approved',
        title: 'Attendance Correction Approved',
        body: `Your correction request for ${req.date} has been approved.`,
        link: '/hrms/attendance',
      }).catch(() => {});
      sendHrEmailNotification({
        employeeId: req.employeeId,
        subject: 'Your attendance correction was approved',
        htmlBody: buildHrEmailHtml({
          title: 'Your attendance correction has been approved',
          lines: [
            { label: 'Date',       value: req.date },
            { label: 'Check In',   value: req.requestedCheckIn },
            { label: 'Check Out',  value: req.requestedCheckOut },
          ],
          ctaLabel: 'View Attendance',
          ctaLink:  'https://pulse.finvastra.com/hrms/attendance',
        }),
      }).catch(() => {});
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-5">
        {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className="px-4 py-1.5 rounded-full text-xs font-semibold capitalize transition-colors border"
            style={{
              backgroundColor: statusFilter === f ? '#0B1538' : 'var(--shell-hover-hard)',
              color: statusFilter === f ? '#C9A961' : 'var(--text-secondary)',
              borderColor: statusFilter === f ? '#0B1538' : 'var(--shell-border)',
            }}
          >
            {f === 'all' ? 'All' : REG_STATUS_STYLES[f as keyof typeof REG_STATUS_STYLES].label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="py-8 text-center text-sm animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      )}

      {!loading && requests.length === 0 && (
        <div className="py-10 text-center rounded-2xl border border-(--shell-border)">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No {statusFilter !== 'all' ? statusFilter : ''} correction requests.</p>
        </div>
      )}

      {!loading && requests.length > 0 && (
        <div className="space-y-3">
          {requests.map((req) => {
            const st = REG_STATUS_STYLES[req.status];
            const Icon = st.icon;
            return (
              <div
                key={req.id}
                className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                        {req.employeeName}
                      </span>
                      <span
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                        style={{ backgroundColor: st.bg, color: st.text }}
                      >
                        <Icon size={11} />
                        {st.label}
                      </span>
                    </div>
                    <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                      {format(parseISO(req.date), 'EEEE, dd MMM yyyy')}
                      {req.existingStatus && ` · Was: ${req.existingStatus}`}
                    </p>
                    <div className="flex flex-wrap gap-4 text-xs" style={{ color: 'var(--text-primary)' }}>
                      {req.requestedCheckIn  && <span>🕐 Check-in: <strong>{req.requestedCheckIn}</strong></span>}
                      {req.requestedCheckOut && <span>🕐 Check-out: <strong>{req.requestedCheckOut}</strong></span>}
                    </div>
                    <p className="text-xs mt-2 italic" style={{ color: 'var(--text-muted)' }}>"{req.reason}"</p>
                    {req.rejectionReason && (
                      <p className="text-xs mt-1" style={{ color: '#991B1B' }}>
                        Rejected: {req.rejectionReason}
                      </p>
                    )}
                    {req.reviewedByName && req.status !== 'pending' && (
                      <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                        Reviewed by {req.reviewedByName}
                      </p>
                    )}
                  </div>

                  {/* Actions — only for pending */}
                  {req.status === 'pending' && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleApprove(req)}
                        disabled={approvingId === req.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-50"
                        style={{ backgroundColor: '#065F46', color: '#FFFFFF' }}
                      >
                        <CheckCircle2 size={12} />
                        {approvingId === req.id ? 'Approving…' : 'Approve'}
                      </button>
                      <button
                        onClick={() => setRejectingReq(req)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-red-200"
                        style={{ color: '#DC2626' }}
                      >
                        <XCircle size={12} />
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rejectingReq && (
        <RejectRegModal
          req={rejectingReq}
          reviewerId={reviewerId}
          reviewerName={reviewerName}
          onDone={() => setRejectingReq(null)}
          onCancel={() => setRejectingReq(null)}
        />
      )}
    </div>
  );
}

// ─── AdminAttendancePage ──────────────────────────────────────────────────────

// ─── Monthly View ─────────────────────────────────────────────────────────────

const MONTH_MARK: Record<string, { ch: string; color: string; bg: string }> = {
  present:  { ch: 'P', color: '#065F46', bg: 'rgba(16,122,81,0.14)' },
  half_day: { ch: '½', color: '#92400E', bg: 'rgba(217,119,6,0.14)' },
  absent:   { ch: 'A', color: '#991B1B', bg: 'rgba(220,38,38,0.14)' },
  leave:    { ch: 'L', color: '#7A6030', bg: 'rgba(201,169,97,0.18)' },
  holiday:  { ch: 'H', color: '#1E40AF', bg: 'rgba(59,130,246,0.14)' },
};

function MonthlyView({ employees, month }: { employees: UserProfile[]; month: string }) {
  const [records, setRecords] = useState<Attendance[] | null>(null);

  useEffect(() => {
    let alive = true;
    setRecords(null);
    (async () => {
      const days  = getDaysInMonth(parseISO(`${month}-01`));
      const start = `${month}-01`;
      const end   = `${month}-${String(days).padStart(2, '0')}`;
      const snap = await getDocs(query(
        collection(db, 'attendance'),
        where('date', '>=', start),
        where('date', '<=', end),
      ));
      if (alive) setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Attendance)));
    })().catch(() => { if (alive) setRecords([]); });
    return () => { alive = false; };
  }, [month]);

  const days    = getDaysInMonth(parseISO(`${month}-01`));
  const dayNums = Array.from({ length: days }, (_, i) => i + 1);
  const [year, mon] = month.split('-').map(Number);
  const weekday  = (d: number) => new Date(year, mon - 1, d).getDay();
  const isSunday = (d: number) => weekday(d) === 0;
  const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  // Highlight today's column when viewing the current month
  const now = new Date();
  const todayNum = format(now, 'yyyy-MM') === month ? now.getDate() : -1;

  const statusByKey = new Map<string, AttendanceStatus>();
  (records ?? []).forEach((r) => statusByKey.set(`${r.userId}_${Number(r.date.slice(8, 10))}`, r.status));

  if (records === null) {
    return <div className="py-16 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading month…</div>;
  }

  const sorted = [...employees].sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Sticky cells need an OPAQUE theme surface (--ss-bg: solid navy/white) —
  // a translucent panel bg lets scrolled content bleed through, and the old
  // fixed cream header was unreadable in dark mode.
  const solid = 'var(--ss-bg)';
  const sundayTint = 'var(--shell-hover-soft)';
  const todayStyle = { boxShadow: 'inset 0 0 0 1px #C9A961' } as const;

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
        {format(parseISO(`${month}-01`), 'MMMM yyyy')} &nbsp;·&nbsp; P present · ½ half · A absent · L leave · H holiday · · no record
      </p>
      <div className="overflow-auto rounded-xl border border-(--shell-border)" style={{ maxHeight: 600 }}>
        <table className="text-xs border-collapse">
          {/* Date header stays STATIC — sticky on top while rows scroll */}
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 px-3 py-2 text-left font-bold whitespace-nowrap"
                style={{ backgroundColor: solid, color: 'var(--text-muted)', minWidth: 180, boxShadow: 'inset -1px -1px 0 var(--shell-border-mid)' }}>Employee</th>
              {dayNums.map((d) => (
                <th key={d} className="sticky top-0 z-20 px-1 py-1.5 text-center font-semibold"
                  style={{
                    color: isSunday(d) ? '#f87171' : todayNum === d ? '#C9A961' : 'var(--text-muted)',
                    backgroundColor: solid,
                    minWidth: 24,
                    boxShadow: `inset 0 -1px 0 var(--shell-border-mid)${todayNum === d ? ', inset 0 0 0 1px #C9A961' : ''}`,
                  }}>
                  <span className="block leading-none">{d}</span>
                  <span className="block leading-none mt-0.5 text-[9px] font-normal opacity-70">{WD[weekday(d)]}</span>
                </th>
              ))}
              {['P', 'A', 'L'].map((h) => (
                <th key={h} className="sticky top-0 z-20 px-2 py-2 text-center font-bold"
                  style={{ color: 'var(--text-muted)', backgroundColor: solid, boxShadow: 'inset 0 -1px 0 var(--shell-border-mid)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((emp) => {
              let p = 0, a = 0, l = 0;
              const cells = dayNums.map((d) => {
                const st = statusByKey.get(`${emp.userId}_${d}`);
                if (st === 'present' || st === 'half_day') p++;
                else if (st === 'absent') a++;
                else if (st === 'leave') l++;
                const mark = st ? MONTH_MARK[st] : null;
                return (
                  <td key={d} className="px-1.5 py-1.5 text-center"
                    style={{
                      backgroundColor: mark?.bg ?? (isSunday(d) ? sundayTint : undefined),
                      ...(todayNum === d ? todayStyle : {}),
                    }}>
                    <span style={{ color: mark?.color ?? 'var(--text-muted)', fontWeight: mark ? 700 : 400 }}>{mark?.ch ?? '·'}</span>
                  </td>
                );
              });
              return (
                <tr key={emp.userId} className="border-t border-(--shell-border)">
                  <td className="sticky left-0 z-10 px-3 py-1.5 font-medium whitespace-nowrap"
                    style={{ backgroundColor: solid, color: 'var(--text-primary)', minWidth: 180, boxShadow: 'inset -1px 0 0 var(--shell-border-mid)' }}>{emp.displayName}</td>
                  {cells}
                  <td className="px-2 py-1.5 text-center font-bold" style={{ color: '#34d399' }}>{p}</td>
                  <td className="px-2 py-1.5 text-center font-bold" style={{ color: '#f87171' }}>{a}</td>
                  <td className="px-2 py-1.5 text-center font-bold" style={{ color: '#C9A961' }}>{l}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminAttendancePage() {
  const { user, profile } = useAuth();

  // ── All hooks unconditionally at the top — Rules of Hooks ───────────────────
  // Guard comes AFTER hooks. When profile is null (still loading), we skip
  // the guard and render nothing until profile resolves.
  const today = format(new Date(), 'yyyy-MM-dd');
  // Deep-linkable tab (?tab=corrections) — correction notifications + the
  // Approvals inbox land the reviewer directly on the request, not the Daily view.
  const initialTab = (() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return (t === 'month' || t === 'corrections' || t === 'geofence') ? t : 'day';
  })();
  const [activeTab, setActiveTab] = useState<'day' | 'month' | 'corrections' | 'geofence'>(initialTab);
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const { records, loading } = useTeamAttendance(selectedDate);
  const { employees: allEmployees } = useAllEmployees();
  // Attendance views track ACTIVE staff only — exited employees were cluttering
  // every row of the daily table and the monthly grid.
  const employees = allEmployees.filter((e) => e.employeeStatus !== 'inactive');

  // ── Guard (after all hooks) ─────────────────────────────────────────────────
  if (profile && profile.role !== 'admin' && !profile.isHrmsManager) {
    return <Navigate to="/hrms/dashboard" replace />;
  }

  const reviewerId   = user?.uid ?? '';
  const reviewerName = profile?.displayName ?? 'HR';

  // Build a map: userId → attendance record for the selected date
  const recordByUser = new Map<string, Attendance>(records.map((r) => [r.userId, r]));

  // The export month is derived from the selected date
  const exportMonth = selectedDate.slice(0, 7); // YYYY-MM

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Page header */}
      <PageHeader
        title="Attendance — Admin View"
        subtitle="View and override attendance records for any employee."
        pinKey="hrms.admin-attendance"
        actions={
          activeTab !== 'corrections' && activeTab !== 'geofence' ? (
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setEditingUserId(null);
                }}
                className="text-sm border border-(--shell-border) rounded-xl px-3 py-2 bg-(--glass-panel-bg)"
                style={{ color: 'var(--text-primary)' }}
              />
              <ExportMonthButton employees={employees} month={exportMonth} />
            </div>
          ) : undefined
        }
      />

      {/* Tab bar — theme-aware bg (fixed cream was unreadable in dark mode) */}
      <div className="flex flex-wrap gap-1 p-1 rounded-xl mb-6 w-fit" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
        {[
          { key: 'day',         label: 'Daily View'   },
          { key: 'month',       label: 'Monthly View' },
          { key: 'corrections', label: 'Corrections'  },
          { key: 'geofence',    label: 'Geofence'     },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as 'day' | 'month' | 'corrections' | 'geofence')}
            className="px-5 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              backgroundColor: activeTab === key ? '#0B1538' : 'transparent',
              color: activeTab === key ? '#C9A961' : 'var(--text-muted)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Day View tab ────────────────────────────────────────────────────── */}
      {activeTab === 'day' && (
        <>
          {/* Date heading */}
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
            {format(parseISO(selectedDate), 'EEEE, dd MMMM yyyy')}
          </p>

          {/* Attendance table */}
          <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-sm animate-pulse" style={{ color: 'var(--text-muted)' }}>
                Loading…
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--shell-border)" style={{ backgroundColor: 'var(--glass-panel-bg)' }}>
                    {['Employee', 'Status', 'Check-in', 'Check-out', 'Hours', 'Edit'].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                        No employees found.
                      </td>
                    </tr>
                  )}

                  {employees.map((emp) => {
                    const rec = recordByUser.get(emp.userId);
                    const isEditing = editingUserId === emp.userId;

                    return (
                      <>
                        <tr
                          key={emp.userId}
                          className="border-b border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors"
                        >
                          {/* Employee name */}
                          <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                            {emp.displayName}
                            {emp.designation && (
                              <span className="ml-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                                · {emp.designation}
                              </span>
                            )}
                          </td>

                          {/* Status pill */}
                          <td className="px-4 py-3">
                            {rec ? (
                              <span
                                className="px-2.5 py-1 rounded-full text-xs font-semibold"
                                style={{
                                  backgroundColor: STATUS_STYLES[rec.status].bg,
                                  color: STATUS_STYLES[rec.status].text,
                                }}
                              >
                                {STATUS_STYLES[rec.status].label}
                              </span>
                            ) : (
                              <span
                                className="px-2.5 py-1 rounded-full text-xs font-semibold"
                                style={{ backgroundColor: 'var(--shell-hover-soft)', color: 'var(--text-muted)' }}
                              >
                                No record
                              </span>
                            )}
                          </td>

                          {/* Check-in (+ field-clock location when captured) */}
                          <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                            {rec ? formatTime(rec.checkIn) : '—'}
                            {rec?.checkInLocation && (
                              <a href={mapsLink(rec.checkInLocation)} target="_blank" rel="noreferrer"
                                className="ml-1.5 no-underline hover:underline" title="Clock-in location"
                                style={{ color: '#C9A961' }}>📍</a>
                            )}
                          </td>

                          {/* Check-out */}
                          <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                            {rec ? formatTime(rec.checkOut) : '—'}
                            {rec?.checkOutLocation && (
                              <a href={mapsLink(rec.checkOutLocation)} target="_blank" rel="noreferrer"
                                className="ml-1.5 no-underline hover:underline" title="Clock-out location"
                                style={{ color: '#C9A961' }}>📍</a>
                            )}
                          </td>

                          {/* Hours */}
                          <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                            {rec ? rec.workingHours.toFixed(1) : '—'}
                          </td>

                          {/* Edit */}
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <button
                                onClick={() => setEditingUserId(null)}
                                className="text-xs underline"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                Cancel
                              </button>
                            ) : (
                              <button
                                onClick={() => setEditingUserId(emp.userId)}
                                className="px-3 py-1 rounded-lg text-xs font-semibold border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                Edit
                              </button>
                            )}
                          </td>
                        </tr>

                        {/* Inline edit row — rendered immediately below the employee row */}
                        {isEditing && (
                          <EditRow
                            key={`edit-${emp.userId}`}
                            record={rec ?? null}
                            userId={emp.userId}
                            date={selectedDate}
                            onSave={() => setEditingUserId(null)}
                            onCancel={() => setEditingUserId(null)}
                          />
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer summary */}
          {!loading && records.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              {(['present', 'half_day', 'absent', 'leave', 'holiday'] as AttendanceStatus[]).map((s) => {
                const count = records.filter((r) => r.status === s).length;
                if (!count) return null;
                return (
                  <span key={s}>
                    {STATUS_STYLES[s].label}: <strong style={{ color: 'var(--text-primary)' }}>{count}</strong>
                  </span>
                );
              })}
              <span>
                No record: <strong style={{ color: 'var(--text-primary)' }}>{employees.length - records.length}</strong>
              </span>
            </div>
          )}
        </>
      )}

      {/* ── Monthly View tab ────────────────────────────────────────────────── */}
      {activeTab === 'month' && (
        <MonthlyView employees={employees} month={exportMonth} />
      )}

      {/* ── Corrections tab ─────────────────────────────────────────────────── */}
      {activeTab === 'corrections' && (
        <RegularizationsTab reviewerId={reviewerId} reviewerName={reviewerName} />
      )}

      {/* ── Geofence tab — office location + radius for clock in/out ──────────── */}
      {activeTab === 'geofence' && <GeofenceTab adminUid={reviewerId} />}
    </div>
  );
}

// ─── Geofence settings — lock clock in/out to the office radius ───────────────
function GeofenceTab({ adminUid }: { adminUid: string }) {
  const { config, loading } = useGeofenceConfig();
  const { employees } = useAllEmployees();
  const [enabled, setEnabled] = useState(false);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('200');
  const [label, setLabel] = useState('');
  const [exemptUids, setExemptUids] = useState<string[]>([]);
  const [gettingLoc, setGettingLoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Hydrate the form once the config doc arrives
  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setLat(String(config.lat ?? ''));
    setLng(String(config.lng ?? ''));
    setRadius(String(config.radiusMeters ?? 200));
    setLabel(config.label ?? '');
    setExemptUids(config.exemptUids ?? []);
  }, [config]);

  const handleUseCurrentLocation = async () => {
    setGettingLoc(true);
    setMessage(null);
    try {
      const pos = await getCurrentPosition();
      setLat(pos.lat.toFixed(6));
      setLng(pos.lng.toFixed(6));
      setMessage({ kind: 'ok', text: `Location captured (±${Math.round(pos.accuracy ?? 0)} m accuracy). Save to apply.` });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Could not get location.' });
    } finally {
      setGettingLoc(false);
    }
  };

  const handleSave = async () => {
    const nLat = parseFloat(lat);
    const nLng = parseFloat(lng);
    const nRadius = parseInt(radius, 10);
    if (enabled && (Number.isNaN(nLat) || Number.isNaN(nLng))) {
      setMessage({ kind: 'err', text: 'Set the office location first — use "Use my current location" while at the office.' });
      return;
    }
    if (enabled && (Number.isNaN(nRadius) || nRadius < 50)) {
      setMessage({ kind: 'err', text: 'Radius must be at least 50 metres (GPS accuracy varies).' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveGeofenceConfig({
        enabled,
        lat: Number.isNaN(nLat) ? 0 : nLat,
        lng: Number.isNaN(nLng) ? 0 : nLng,
        radiusMeters: Number.isNaN(nRadius) ? 200 : nRadius,
        label: label.trim(),
        exemptUids,
        updatedBy: adminUid,
      });
      setMessage({ kind: 'ok', text: enabled ? 'Geofence saved — clock in/out is now locked to the office.' : 'Saved. Geofence is OFF — employees can clock in from anywhere.' });
    } catch {
      setMessage({ kind: 'err', text: 'Failed to save. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="h-40 rounded-2xl animate-pulse" style={{ backgroundColor: 'var(--glass-panel-bg)' }} />;
  }

  return (
    <div className="max-w-xl bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-6 space-y-5">
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Office Geofence</h3>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          When enabled, employees can only clock in/out within the set radius of the office.
          The captured GPS point is stored on each attendance record for audit.
        </p>
      </div>

      {/* Enable toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4" />
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Lock clock in/out to the office location
        </span>
      </label>

      {/* Office point */}
      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Office location</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleUseCurrentLocation}
            disabled={gettingLoc}
            className="text-sm px-4 py-2.5 rounded-lg border font-medium transition-colors hover:bg-(--shell-hover-soft) disabled:opacity-50"
            style={{ color: 'var(--text-primary)', borderColor: 'var(--shell-border-mid)' }}
          >
            {gettingLoc ? 'Getting location…' : '📍 Use my current location'}
          </button>
          {lat && lng && (
            <a
              href={`https://maps.google.com/?q=${lat},${lng}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs no-underline hover:underline"
              style={{ color: '#C9A961' }}
            >
              View on map →
            </a>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude"
            className="text-sm border border-(--shell-border) rounded-xl px-3 py-2 bg-(--glass-panel-bg) font-mono"
            style={{ color: 'var(--text-primary)' }} />
          <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="Longitude"
            className="text-sm border border-(--shell-border) rounded-xl px-3 py-2 bg-(--glass-panel-bg) font-mono"
            style={{ color: 'var(--text-primary)' }} />
        </div>
      </div>

      {/* Radius + label */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Radius (metres)</p>
          <input type="number" min={50} value={radius} onChange={(e) => setRadius(e.target.value)}
            className="w-full text-sm border border-(--shell-border) rounded-xl px-3 py-2 bg-(--glass-panel-bg)"
            style={{ color: 'var(--text-primary)' }} />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Label</p>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Finvastra HQ"
            className="w-full text-sm border border-(--shell-border) rounded-xl px-3 py-2 bg-(--glass-panel-bg)"
            style={{ color: 'var(--text-primary)' }} />
        </div>
      </div>

      {/* Field RMs — exempt from the radius, location still recorded */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
          Field employees (exempt from radius)
        </p>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          RMs who work outside the office can clock in/out from anywhere. Their GPS
          location is still required and recorded on every clock action.
        </p>
        <MultiSearchableSelect
          options={employees
            .filter((e) => e.employeeStatus !== 'inactive')
            .map((e) => ({ value: e.userId, label: e.displayName }))}
          value={exemptUids}
          onChange={setExemptUids}
          placeholder="Select field employees…"
          label="Field employees"
        />
      </div>

      {message && (
        <p className="text-xs px-3 py-2 rounded-lg" style={{
          backgroundColor: message.kind === 'ok' ? 'rgba(52,211,153,0.10)' : 'rgba(248,113,113,0.10)',
          color: message.kind === 'ok' ? '#34d399' : '#f87171',
          border: `1px solid ${message.kind === 'ok' ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
        }}>
          {message.text}
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50"
        style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
      >
        {saving ? 'Saving…' : 'Save Geofence'}
      </button>
    </div>
  );
}
