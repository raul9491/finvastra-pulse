import { useState, useCallback, useEffect } from 'react';
import { format, parseISO, getDaysInMonth } from 'date-fns';
import { Navigate } from 'react-router-dom';
import { Timestamp, getDocs, query, collection, where, orderBy } from 'firebase/firestore';
import { CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
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
import type { Attendance, AttendanceStatus, UserProfile, AttendanceRegularization } from '../../../types';

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
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await adminMarkAttendance(record?.id ?? null, userId, date, status, notes);
      onSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr style={{ backgroundColor: '#FAFAF7' }}>
      <td colSpan={4} />
      <td colSpan={2} className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
            className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
            style={{ color: '#0A0A0A' }}
          >
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_STYLES[s].label}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white flex-1 min-w-[140px]"
            style={{ color: '#0A0A0A' }}
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm border border-slate-200 hover:bg-slate-50"
            style={{ color: '#2A2A2A' }}
          >
            Cancel
          </button>
        </div>
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
      className="px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
      style={{ color: '#2A2A2A' }}
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
        subject: 'Attendance Correction Update — Finvastra Pulse',
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-semibold text-ink">Reject Correction Request</h3>
        <p className="text-xs text-mute">
          {req.employeeName} · {req.date}
        </p>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#8B8B85' }}>
            Rejection Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this request rejected?"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-navy/10"
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
            className="px-4 py-2.5 rounded-xl text-sm border border-slate-200 hover:bg-slate-50">
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
        subject: 'Attendance Correction Approved — Finvastra Pulse',
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
            className="px-4 py-1.5 rounded-full text-xs font-semibold capitalize transition-colors"
            style={{
              backgroundColor: statusFilter === f ? '#0B1538' : '#F2EFE7',
              color: statusFilter === f ? '#C9A961' : '#2A2A2A',
            }}
          >
            {f === 'all' ? 'All' : REG_STATUS_STYLES[f as keyof typeof REG_STATUS_STYLES].label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="py-8 text-center text-sm animate-pulse" style={{ color: '#8B8B85' }}>Loading…</div>
      )}

      {!loading && requests.length === 0 && (
        <div className="py-10 text-center rounded-2xl border border-slate-200">
          <p className="text-sm" style={{ color: '#8B8B85' }}>No {statusFilter !== 'all' ? statusFilter : ''} correction requests.</p>
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
                className="bg-white rounded-2xl border border-slate-200 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm" style={{ color: '#0A0A0A' }}>
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
                    <p className="text-xs mb-2" style={{ color: '#8B8B85' }}>
                      {format(parseISO(req.date), 'EEEE, dd MMM yyyy')}
                      {req.existingStatus && ` · Was: ${req.existingStatus}`}
                    </p>
                    <div className="flex flex-wrap gap-4 text-xs" style={{ color: '#2A2A2A' }}>
                      {req.requestedCheckIn  && <span>🕐 Check-in: <strong>{req.requestedCheckIn}</strong></span>}
                      {req.requestedCheckOut && <span>🕐 Check-out: <strong>{req.requestedCheckOut}</strong></span>}
                    </div>
                    <p className="text-xs mt-2 italic" style={{ color: '#8B8B85' }}>"{req.reason}"</p>
                    {req.rejectionReason && (
                      <p className="text-xs mt-1" style={{ color: '#991B1B' }}>
                        Rejected: {req.rejectionReason}
                      </p>
                    )}
                    {req.reviewedByName && req.status !== 'pending' && (
                      <p className="text-[11px] mt-1" style={{ color: '#8B8B85' }}>
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
  const isSunday = (d: number) => new Date(year, mon - 1, d).getDay() === 0;

  const statusByKey = new Map<string, AttendanceStatus>();
  (records ?? []).forEach((r) => statusByKey.set(`${r.userId}_${Number(r.date.slice(8, 10))}`, r.status));

  if (records === null) {
    return <div className="py-16 text-center text-sm" style={{ color: '#8B8B85' }}>Loading month…</div>;
  }

  const sorted = [...employees].sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#8B8B85' }}>
        {format(parseISO(`${month}-01`), 'MMMM yyyy')} &nbsp;·&nbsp; P present · ½ half · A absent · L leave · H holiday · · no record
      </p>
      <div className="overflow-auto rounded-xl border border-slate-200" style={{ maxHeight: 600 }}>
        <table className="text-xs border-collapse">
          <thead>
            <tr style={{ backgroundColor: '#F2EFE7' }}>
              <th className="sticky left-0 z-20 px-3 py-2 text-left font-bold whitespace-nowrap"
                style={{ backgroundColor: '#F2EFE7', color: '#8B8B85', minWidth: 180 }}>Employee</th>
              {dayNums.map((d) => (
                <th key={d} className="px-1.5 py-2 text-center font-semibold"
                  style={{ color: isSunday(d) ? '#B45454' : '#8B8B85', backgroundColor: isSunday(d) ? 'rgba(0,0,0,0.04)' : undefined, minWidth: 22 }}>{d}</th>
              ))}
              {['P', 'A', 'L'].map((h) => (
                <th key={h} className="px-2 py-2 text-center font-bold sticky right-0" style={{ color: '#8B8B85', backgroundColor: '#F2EFE7' }}>{h}</th>
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
                    style={{ backgroundColor: mark?.bg ?? (isSunday(d) ? 'rgba(0,0,0,0.04)' : undefined) }}>
                    <span style={{ color: mark?.color ?? '#CBD5E1', fontWeight: mark ? 700 : 400 }}>{mark?.ch ?? '·'}</span>
                  </td>
                );
              });
              return (
                <tr key={emp.userId} className="border-t border-slate-100">
                  <td className="sticky left-0 z-10 px-3 py-1.5 font-medium whitespace-nowrap"
                    style={{ backgroundColor: '#FFFFFF', color: '#0A0A0A', minWidth: 180 }}>{emp.displayName}</td>
                  {cells}
                  <td className="px-2 py-1.5 text-center font-bold sticky right-0" style={{ color: '#065F46', backgroundColor: '#FFFFFF' }}>{p}</td>
                  <td className="px-2 py-1.5 text-center font-bold" style={{ color: '#991B1B' }}>{a}</td>
                  <td className="px-2 py-1.5 text-center font-bold" style={{ color: '#7A6030' }}>{l}</td>
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
  const [activeTab, setActiveTab] = useState<'day' | 'month' | 'corrections'>('day');
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const { records, loading } = useTeamAttendance(selectedDate);
  const { employees } = useAllEmployees();

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
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h2
            className="text-3xl mb-1"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}
          >
            Attendance — Admin View
          </h2>
          <p className="text-sm" style={{ color: '#8B8B85' }}>
            View and override attendance records for any employee.
          </p>
        </div>

        {activeTab !== 'corrections' && (
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setEditingUserId(null);
              }}
              className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white"
              style={{ color: '#0A0A0A' }}
            />
            <ExportMonthButton employees={employees} month={exportMonth} />
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-xl mb-6 w-fit" style={{ backgroundColor: '#F2EFE7' }}>
        {[
          { key: 'day',         label: 'Daily View'   },
          { key: 'month',       label: 'Monthly View' },
          { key: 'corrections', label: 'Corrections'  },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as 'day' | 'month' | 'corrections')}
            className="px-5 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              backgroundColor: activeTab === key ? '#0B1538' : 'transparent',
              color: activeTab === key ? '#C9A961' : '#8B8B85',
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
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#8B8B85' }}>
            {format(parseISO(selectedDate), 'EEEE, dd MMMM yyyy')}
          </p>

          {/* Attendance table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-sm animate-pulse" style={{ color: '#8B8B85' }}>
                Loading…
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100" style={{ backgroundColor: '#FAFAF7' }}>
                    {['Employee', 'Status', 'Check-in', 'Check-out', 'Hours', 'Edit'].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider"
                        style={{ color: '#8B8B85' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-sm" style={{ color: '#8B8B85' }}>
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
                          className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                        >
                          {/* Employee name */}
                          <td className="px-4 py-3 font-medium" style={{ color: '#0A0A0A' }}>
                            {emp.displayName}
                            {emp.designation && (
                              <span className="ml-1 text-xs" style={{ color: '#8B8B85' }}>
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
                                style={{ backgroundColor: '#F8F9FA', color: '#8B8B85' }}
                              >
                                No record
                              </span>
                            )}
                          </td>

                          {/* Check-in */}
                          <td className="px-4 py-3" style={{ color: '#2A2A2A' }}>
                            {rec ? formatTime(rec.checkIn) : '—'}
                          </td>

                          {/* Check-out */}
                          <td className="px-4 py-3" style={{ color: '#2A2A2A' }}>
                            {rec ? formatTime(rec.checkOut) : '—'}
                          </td>

                          {/* Hours */}
                          <td className="px-4 py-3" style={{ color: '#2A2A2A' }}>
                            {rec ? rec.workingHours.toFixed(1) : '—'}
                          </td>

                          {/* Edit */}
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <button
                                onClick={() => setEditingUserId(null)}
                                className="text-xs underline"
                                style={{ color: '#8B8B85' }}
                              >
                                Cancel
                              </button>
                            ) : (
                              <button
                                onClick={() => setEditingUserId(emp.userId)}
                                className="px-3 py-1 rounded-lg text-xs font-semibold border border-slate-200 hover:bg-slate-50 transition-colors"
                                style={{ color: '#2A2A2A' }}
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
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs" style={{ color: '#8B8B85' }}>
              {(['present', 'half_day', 'absent', 'leave', 'holiday'] as AttendanceStatus[]).map((s) => {
                const count = records.filter((r) => r.status === s).length;
                if (!count) return null;
                return (
                  <span key={s}>
                    {STATUS_STYLES[s].label}: <strong style={{ color: '#2A2A2A' }}>{count}</strong>
                  </span>
                );
              })}
              <span>
                No record: <strong style={{ color: '#2A2A2A' }}>{employees.length - records.length}</strong>
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
    </div>
  );
}
