import { useState, useCallback } from 'react';
import { format, parseISO, getDaysInMonth } from 'date-fns';
import { Navigate } from 'react-router-dom';
import { Timestamp, getDocs, query, collection, where, orderBy } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useTeamAttendance, adminMarkAttendance } from '../hooks/useAttendance';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import type { Attendance, AttendanceStatus, UserProfile } from '../../../types';

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

// ─── AdminAttendancePage ──────────────────────────────────────────────────────

export function AdminAttendancePage() {
  const { profile } = useAuth();

  // ── All hooks unconditionally at the top — Rules of Hooks ───────────────────
  // Guard comes AFTER hooks. When profile is null (still loading), we skip
  // the guard and render nothing until profile resolves.
  const today = format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const { records, loading } = useTeamAttendance(selectedDate);
  const { employees } = useAllEmployees();

  // ── Guard (after all hooks) ─────────────────────────────────────────────────
  if (profile && profile.role !== 'admin' && !profile.isHrmsManager) {
    return <Navigate to="/hrms/dashboard" replace />;
  }

  // Build a map: userId → attendance record for the selected date
  const recordByUser = new Map<string, Attendance>(records.map((r) => [r.userId, r]));

  // The export month is derived from the selected date
  const exportMonth = selectedDate.slice(0, 7); // YYYY-MM

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
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
      </div>

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
    </div>
  );
}
