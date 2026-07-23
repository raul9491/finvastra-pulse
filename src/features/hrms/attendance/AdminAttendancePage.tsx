import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Navigate } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import { useAuth } from '../../auth/AuthContext';
import { useTeamAttendance, adminMarkAttendance } from '../hooks/useAttendance';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { mapsLink } from '../../../lib/geo';
import type { Attendance, AttendanceStatus } from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';
import { RegularizationsTab } from './attendanceRegularizations';
import { MonthlyView, ExportMonthButton } from './attendanceMonthly';
import { GeofenceTab } from './attendanceGeofence';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<AttendanceStatus, { bg: string; text: string; label: string }> = {
  present:  { bg: '#F0FDF4', text: '#166534', label: 'Present'  },
  half_day: { bg: '#FFFBEB', text: '#92400E', label: 'Half-day' },
  absent:   { bg: '#FFF1F2', text: '#9F1239', label: 'Absent'   },
  leave:    { bg: '#EFF6FF', text: '#1E40AF', label: 'Leave'    },
  holiday:  { bg: '#FAFAF7', text: '#C9A961', label: 'Holiday'  },
};

const ALL_STATUSES: AttendanceStatus[] = ['present', 'half_day', 'absent', 'leave', 'holiday'];

export function toDate(ts: Timestamp | null | undefined): Date | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  if (typeof (ts as unknown as { toDate?: () => Date }).toDate === 'function') {
    return (ts as unknown as { toDate: () => Date }).toDate();
  }
  return null;
}

export function formatTime(ts: Timestamp | null | undefined): string {
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
