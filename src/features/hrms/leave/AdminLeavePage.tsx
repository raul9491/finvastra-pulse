import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { format } from 'date-fns';
import { Coins, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { writeNotification, sendHrEmailNotification, buildHrEmailHtml } from '../../../lib/notifications';
import {
  usePendingApprovals,
  approveLeave,
  rejectLeave,
} from '../hooks/useLeave';
import {
  useAllEncashmentRequests,
  approveEncashmentRequest,
  rejectEncashmentRequest,
} from '../hooks/useLeaveEncashment';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { db } from '../../../lib/firebase';
import type { LeaveApplication, LeaveBalance, LeaveStatus, LeaveType, LeaveEncashmentRequest } from '../../../types';

// ─── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: LeaveStatus }) {
  const config: Record<LeaveStatus, { label: string; color: string; bg: string }> = {
    pending:   { label: 'Pending',   color: '#92400E', bg: '#FEF3C7' },
    approved:  { label: 'Approved',  color: '#065F46', bg: '#D1FAE5' },
    rejected:  { label: 'Rejected',  color: '#991B1B', bg: '#FEE2E2' },
    cancelled: { label: 'Cancelled', color: '#374151', bg: '#F3F4F6' },
  };
  const { label, color, bg } = config[status];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ color, backgroundColor: bg }}
    >
      {label}
    </span>
  );
}

const TYPE_LABELS: Record<LeaveType, string> = {
  casual:    'Casual',
  sick:      'Sick',
  earned:    'Earned',
  comp_off:  'Comp Off',
  maternity: 'Maternity',
  lop:       'LOP',
  optional:  'Optional',
};

// ─── Reject modal ─────────────────────────────────────────────────────────────

interface RejectModalProps {
  application: LeaveApplication;
  rejectedBy: string;
  onClose: () => void;
}

function RejectModal({ application, rejectedBy, onClose }: RejectModalProps) {
  const [reason,     setReason]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const handleReject = async () => {
    if (!reason.trim()) {
      setError('A rejection reason is required.');
      return;
    }
    setSubmitting(true);
    try {
      await rejectLeave(application.id, reason.trim(), rejectedBy);
      writeNotification(application.employeeId, {
        type:  'leave_rejected',
        title: 'Leave Rejected',
        body:  `Your ${application.days}-day ${application.type} leave (${application.fromDate} – ${application.toDate}) was rejected. Reason: ${reason.trim()}`,
        link:  '/hrms/leave',
      }).catch(() => {});
      sendHrEmailNotification({
        employeeId: application.employeeId,
        subject: 'Leave Request Update — Finvastra Pulse',
        htmlBody: buildHrEmailHtml({
          title: 'Your leave request was not approved',
          lines: [
            { label: 'Leave Type', value: application.type },
            { label: 'From',       value: application.fromDate },
            { label: 'To',         value: application.toDate },
          ],
          note:     reason.trim(),
          ctaLabel: 'View Leave',
          ctaLink:  'https://pulse.finvastra.com/hrms/leave',
        }),
      }).catch(() => {});
      onClose();
    } catch (err) {
      console.error('[AdminLeavePage] rejectLeave error:', err);
      setError(err instanceof Error ? err.message : 'Failed to reject.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-6 w-full max-w-md space-y-4">
        <h3 className="text-base font-semibold" style={{ color: '#0A0A0A' }}>
          Reject Leave Application
        </h3>
        <div className="space-y-1.5">
          <label
            className="block text-xs font-semibold uppercase tracking-wide"
            style={{ color: '#8B8B85' }}
          >
            Reason (mandatory)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Explain why the leave is being rejected…"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
            style={{ color: '#0A0A0A' }}
          />
        </div>
        {error && (
          <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={handleReject}
            disabled={submitting || !reason.trim()}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: '#DC2626',
              color: '#FFFFFF',
              opacity: submitting || !reason.trim() ? 0.5 : 1,
              cursor: submitting || !reason.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Rejecting…' : 'Reject'}
          </button>
          <button
            onClick={onClose}
            className="text-sm transition-opacity hover:opacity-60"
            style={{ color: '#8B8B85' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pending approvals tab ─────────────────────────────────────────────────────

interface PendingTabProps {
  approverId: string;
  employeeNameById: (id: string) => string;
}

function PendingTab({ approverId, employeeNameById }: PendingTabProps) {
  const { applications, loading } = usePendingApprovals();
  const toast = useToast();
  const [rejectingApp, setRejectingApp] = useState<LeaveApplication | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const handleApprove = async (app: LeaveApplication, employeeName: string) => {
    setApprovingId(app.id);
    try {
      await approveLeave(app.id, approverId);
      writeNotification(app.employeeId, {
        type:  'leave_approved',
        title: 'Leave Approved',
        body:  `Your ${app.days}-day ${app.type} leave (${app.fromDate} – ${app.toDate}) has been approved.`,
        link:  '/hrms/leave',
      }).catch(() => {});
      sendHrEmailNotification({
        employeeId: app.employeeId,
        subject: 'Leave Approved — Finvastra Pulse',
        htmlBody: buildHrEmailHtml({
          title: 'Your leave has been approved',
          lines: [
            { label: 'Leave Type', value: app.type },
            { label: 'From',       value: app.fromDate },
            { label: 'To',         value: app.toDate },
            { label: 'Days',       value: String(app.days) },
          ],
          ctaLabel: 'View Leave',
          ctaLink:  'https://pulse.finvastra.com/hrms/leave',
        }),
      }).catch(() => {});
      toast.success(`Leave approved for ${employeeName}`);
    } catch (err) {
      console.error('[AdminLeavePage] approveLeave error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to approve leave');
    } finally {
      setApprovingId(null);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm" style={{ color: '#8B8B85' }}>Loading…</div>;
  }

  if (applications.length === 0) {
    return (
      <div className="px-6 py-10 text-center text-sm" style={{ color: '#8B8B85' }}>
        No pending applications.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              {['Employee', 'Type', 'Period', 'Days', 'Reason', 'Applied', ''].map((h) => (
                <th
                  key={h}
                  className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: '#8B8B85' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {applications.map((app) => (
              <tr key={app.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                <td className="px-6 py-3.5 font-medium" style={{ color: '#0A0A0A' }}>
                  {employeeNameById(app.employeeId)}
                </td>
                <td className="px-6 py-3.5" style={{ color: '#2A2A2A' }}>
                  {TYPE_LABELS[app.type]}
                </td>
                <td className="px-6 py-3.5 whitespace-nowrap" style={{ color: '#2A2A2A' }}>
                  {format(new Date(app.fromDate), 'd MMM')}
                  {' – '}
                  {format(new Date(app.toDate), 'd MMM yyyy')}
                </td>
                <td className="px-6 py-3.5" style={{ color: '#2A2A2A' }}>
                  {app.days}
                </td>
                <td
                  className="px-6 py-3.5 max-w-xs truncate"
                  style={{ color: '#2A2A2A' }}
                  title={app.reason}
                >
                  {app.reason}
                </td>
                <td className="px-6 py-3.5 text-xs whitespace-nowrap" style={{ color: '#8B8B85' }}>
                  {app.appliedAt
                    ? format(
                        (app.appliedAt as import('firebase/firestore').Timestamp).toDate(),
                        'd MMM yyyy',
                      )
                    : '—'}
                </td>
                <td className="px-6 py-3.5">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleApprove(app, employeeNameById(app.employeeId))}
                      disabled={approvingId === app.id}
                      className="px-3 py-1 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                      style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}
                    >
                      {approvingId === app.id ? '…' : 'Approve'}
                    </button>
                    <button
                      onClick={() => setRejectingApp(app)}
                      className="px-3 py-1 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                      style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rejectingApp && (
        <RejectModal
          application={rejectingApp}
          rejectedBy={approverId}
          onClose={() => setRejectingApp(null)}
        />
      )}
    </>
  );
}

// ─── All applications tab ─────────────────────────────────────────────────────

interface AllTabProps {
  employeeNameById: (id: string) => string;
  employees: { userId: string; displayName: string }[];
}

// useAllApplications — inline hook scoped to this tab component.
// Subscribes to the full leave_applications collection (latest 500 docs),
// ordered by appliedAt desc. At 25 employees × ~15 apps/year ≈ 375 docs — well
// within Firestore real-time limits.
function useAllApplications() {
  const [applications, setApplications] = useState<LeaveApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'leave_applications'),
      orderBy('appliedAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setApplications(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeaveApplication)));
      setLoading(false);
    });
  }, []);

  return { applications, loading };
}

function AllTab({ employeeNameById, employees }: AllTabProps) {
  const { applications, loading } = useAllApplications();

  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterStatus,   setFilterStatus]   = useState<LeaveStatus | ''>('');
  const [filterType,     setFilterType]     = useState<LeaveType | ''>('');

  const filtered = applications.filter((app) => {
    if (filterEmployee && app.employeeId !== filterEmployee) return false;
    if (filterStatus   && app.status    !== filterStatus)   return false;
    if (filterType     && app.type      !== filterType)     return false;
    return true;
  });

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 px-6 pt-4 pb-3 border-b border-slate-100">
        <select
          value={filterEmployee}
          onChange={(e) => setFilterEmployee(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
          style={{ color: '#0A0A0A' }}
        >
          <option value="">All Employees</option>
          {employees.map((emp) => (
            <option key={emp.userId} value={emp.userId}>{emp.displayName}</option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as LeaveStatus | '')}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
          style={{ color: '#0A0A0A' }}
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as LeaveType | '')}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
          style={{ color: '#0A0A0A' }}
        >
          <option value="">All Types</option>
          {(Object.entries(TYPE_LABELS) as [LeaveType, string][]).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="p-6 text-sm" style={{ color: '#8B8B85' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm" style={{ color: '#8B8B85' }}>
          No applications match the current filters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                {['Employee', 'Type', 'Period', 'Days', 'Status', 'Applied'].map((h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: '#8B8B85' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((app) => (
                <tr key={app.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-3.5 font-medium" style={{ color: '#0A0A0A' }}>
                    {employeeNameById(app.employeeId)}
                  </td>
                  <td className="px-6 py-3.5" style={{ color: '#2A2A2A' }}>
                    {TYPE_LABELS[app.type]}
                  </td>
                  <td className="px-6 py-3.5 whitespace-nowrap" style={{ color: '#2A2A2A' }}>
                    {format(new Date(app.fromDate), 'd MMM')}
                    {' – '}
                    {format(new Date(app.toDate), 'd MMM yyyy')}
                  </td>
                  <td className="px-6 py-3.5" style={{ color: '#2A2A2A' }}>
                    {app.days}
                  </td>
                  <td className="px-6 py-3.5">
                    <StatusPill status={app.status} />
                  </td>
                  <td className="px-6 py-3.5 text-xs" style={{ color: '#8B8B85' }}>
                    {app.appliedAt
                      ? format(
                          (app.appliedAt as import('firebase/firestore').Timestamp).toDate(),
                          'd MMM yyyy',
                        )
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── EditLeaveBalanceModal ────────────────────────────────────────────────────

interface EditLeaveBalanceModalProps {
  employees: { userId: string; displayName: string; employeeId?: string }[];
  currentYear: number;
  actorUid: string;
  actorName: string;
  onClose: () => void;
}

type LeaveTypeEditable = 'casual' | 'sick' | 'earned' | 'comp_off';

interface BalanceRow {
  type: LeaveTypeEditable;
  label: string;
  current: number;
  newTotal: string;
}

function EditLeaveBalanceModal({
  employees,
  currentYear,
  actorUid,
  actorName,
  onClose,
}: EditLeaveBalanceModalProps) {
  const toast = useToast();

  const [selectedUid, setSelectedUid]   = useState('');
  const [year,        setYear]          = useState(String(currentYear));
  const [loading,     setLoading]       = useState(false);
  const [saving,      setSaving]        = useState(false);
  const [balance,     setBalance]       = useState<LeaveBalance | null>(null);
  const [rows,        setRows]          = useState<BalanceRow[]>([]);
  const [reason,      setReason]        = useState('');
  const [serverError, setServerError]   = useState('');
  const [fieldErrors, setFieldErrors]   = useState<Record<string, string>>({});

  // Fetch balance whenever employee or year changes
  useEffect(() => {
    if (!selectedUid) { setBalance(null); setRows([]); return; }
    const docId = `${selectedUid}_${year}`;
    setLoading(true);
    getDoc(doc(db, 'leave_balances', docId)).then((snap) => {
      if (snap.exists()) {
        const b = snap.data() as LeaveBalance;
        setBalance(b);
        setRows([
          { type: 'casual',   label: 'Casual Leave',       current: b.casual.total,            newTotal: String(b.casual.total) },
          { type: 'sick',     label: 'Sick Leave',          current: b.sick.total,              newTotal: String(b.sick.total) },
          { type: 'earned',   label: 'Earned Leave',        current: b.earned.total,            newTotal: String(b.earned.total) },
          { type: 'comp_off', label: 'Compensatory Off',    current: b.comp_off?.total ?? 0,    newTotal: String(b.comp_off?.total ?? 0) },
        ]);
      } else {
        setBalance(null);
        setRows([
          { type: 'casual',   label: 'Casual Leave',      current: 0, newTotal: '8'  },
          { type: 'sick',     label: 'Sick Leave',         current: 0, newTotal: '7'  },
          { type: 'earned',   label: 'Earned Leave',       current: 0, newTotal: '15' },
          { type: 'comp_off', label: 'Compensatory Off',   current: 0, newTotal: '0'  },
        ]);
      }
      setLoading(false);
    }).catch((e) => {
      console.error('[EditLeaveBalanceModal] fetch error:', e);
      setLoading(false);
    });
  }, [selectedUid, year]);

  const setRowValue = (type: LeaveTypeEditable, val: string) => {
    setRows((prev) => prev.map((r) => r.type === type ? { ...r, newTotal: val } : r));
    if (fieldErrors[type]) setFieldErrors((prev) => { const n = { ...prev }; delete n[type]; return n; });
  };

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (!selectedUid) errs.employee = 'Select an employee';
    if (!reason.trim()) errs.reason = 'Reason is required';
    rows.forEach((r) => {
      const v = parseInt(r.newTotal, 10);
      if (r.newTotal === '' || isNaN(v) || v < 0 || v > 365) {
        errs[r.type] = 'Enter a number 0–365';
      }
    });
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }
    setFieldErrors({});
    setServerError('');
    setSaving(true);

    try {
      const docId = `${selectedUid}_${year}`;
      const yearNum = parseInt(year, 10);
      const existing = balance ?? {
        employeeId: selectedUid, year: yearNum,
        casual: { total: 0, used: 0, remaining: 0 },
        sick:   { total: 0, used: 0, remaining: 0 },
        earned: { total: 0, used: 0, remaining: 0 },
      };

      // Build updated balance, recomputing remaining = total - used
      const updatedBalance: LeaveBalance = {
        ...existing,
        year: yearNum,
      };
      const adjustments: { type: string; oldTotal: number; newTotal: number; delta: number }[] = [];

      for (const r of rows) {
        const newTotalNum  = parseInt(r.newTotal, 10);
        const existingSlot = existing[r.type] ?? { total: 0, used: 0, remaining: 0 };
        const oldTotal     = existingSlot.total;
        const used         = existingSlot.used;
        const newRemaining = Math.max(0, newTotalNum - used);
        updatedBalance[r.type] = { total: newTotalNum, used, remaining: newRemaining };
        if (newTotalNum !== oldTotal) {
          adjustments.push({ type: r.type, oldTotal, newTotal: newTotalNum, delta: newTotalNum - oldTotal });
        }
      }

      // Only write if something changed
      if (adjustments.length === 0) {
        toast.success('No changes to save');
        setSaving(false);
        onClose();
        return;
      }

      // 1. Upsert leave_balances
      await setDoc(doc(db, 'leave_balances', docId), updatedBalance, { merge: true });

      // 2. Write audit record for each changed leave type
      for (const adj of adjustments) {
        await addDoc(collection(db, 'leave_balance_adjustments'), {
          employeeId:   selectedUid,
          year:         yearNum,
          leaveType:    adj.type,
          oldTotal:     adj.oldTotal,
          newTotal:     adj.newTotal,
          delta:        adj.delta,
          reason:       reason.trim(),
          adjustedBy:   actorUid,
          adjustedByName: actorName,
          adjustedAt:   serverTimestamp(),
        });
      }

      toast.success('Leave balances updated');
      onClose();
    } catch (e) {
      console.error('[EditLeaveBalanceModal] save error:', e);
      setServerError(e instanceof Error ? e.message : 'Failed to save');
      setSaving(false);
    }
  };

  const baseInp = 'w-full text-sm px-3.5 py-2.5 border rounded-lg outline-none focus:ring-2 bg-white transition-colors';
  const inp = (field?: string) =>
    `${baseInp} ${field && fieldErrors[field]
      ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30'
      : 'border-slate-200 focus:ring-gold'}`;

  const fLabel = (text: string, field?: string, required = false) => (
    <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
      style={{ color: field && fieldErrors[field] ? '#DC2626' : '#8B8B85' }}>
      {text}{required && <span className="text-red-500 ml-0.5">*</span>}
      {field && fieldErrors[field] && (
        <span className="ml-2 text-red-500 font-medium normal-case tracking-normal">
          — {fieldErrors[field]}
        </span>
      )}
    </label>
  );

  const empOptions = employees.map((e) => ({
    value: e.userId,
    label: `${e.displayName}${e.employeeId ? ` (${e.employeeId})` : ''}`,
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-lg flex flex-col max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <h3 className="text-base font-semibold" style={{ color: '#0A0A0A' }}>
            Edit Leave Balances
          </h3>
          <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>
            Adjust annual leave totals. Changes are logged with a reason for audit purposes.
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {serverError && (
            <div className="rounded-lg px-4 py-3 text-sm bg-red-50 border border-red-200" style={{ color: '#DC2626' }}>
              {serverError}
            </div>
          )}

          {/* Employee selector */}
          <div>
            {fLabel('Employee', 'employee', true)}
            <SearchableSelect
              options={empOptions}
              value={selectedUid}
              onChange={(v) => {
                setSelectedUid(v);
                if (fieldErrors.employee) setFieldErrors((p) => { const n = { ...p }; delete n.employee; return n; });
              }}
              placeholder="Search employees…"
              className={fieldErrors.employee ? 'ring-1 ring-red-400 rounded-lg' : ''}
            />
          </div>

          {/* Year */}
          <div>
            {fLabel('Year')}
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className={inp()}
            >
              {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Balance rows */}
          {selectedUid && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
              <div className="grid grid-cols-3 min-w-70 text-xs font-semibold uppercase tracking-wide px-4 py-2 border-b border-slate-100" style={{ color: '#8B8B85', backgroundColor: '#FAFAF7' }}>
                <span>Leave Type</span>
                <span className="text-center">Current Total</span>
                <span className="text-center">New Total</span>
              </div>
              {loading ? (
                <div className="px-4 py-6 text-sm text-center" style={{ color: '#8B8B85' }}>Loading current balances…</div>
              ) : (
                rows.map((r) => (
                  <div key={r.type} className="grid grid-cols-3 min-w-70 items-center px-4 py-3 border-b border-slate-50 last:border-0">
                    <span className="text-sm font-medium" style={{ color: '#0A0A0A' }}>{r.label}</span>
                    <span className="text-center text-sm" style={{ color: '#8B8B85' }}>{r.current} days</span>
                    <div className="flex justify-center">
                      <input
                        type="number"
                        min="0"
                        max="365"
                        value={r.newTotal}
                        onChange={(e) => setRowValue(r.type, e.target.value)}
                        className={`w-20 text-center text-sm px-2 py-1.5 border rounded-lg outline-none focus:ring-2 transition-colors ${
                          fieldErrors[r.type]
                            ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30'
                            : 'border-slate-200 focus:ring-gold'
                        }`}
                      />
                    </div>
                  </div>
                ))
              )}
              </div>{/* /overflow-x-auto */}
            </div>
          )}
          {selectedUid && rows.some((r) => fieldErrors[r.type]) && (
            <p className="text-xs" style={{ color: '#DC2626' }}>
              {rows.map((r) => fieldErrors[r.type] && `${r.label}: ${fieldErrors[r.type]}`).filter(Boolean).join(' · ')}
            </p>
          )}

          {/* Reason */}
          <div>
            {fLabel('Reason for adjustment', 'reason', true)}
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (fieldErrors.reason) setFieldErrors((p) => { const n = { ...p }; delete n.reason; return n; });
              }}
              placeholder="e.g. Annual reset, carry-forward from previous year, correction…"
              className={`${inp('reason')} resize-none`}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || loading || !selectedUid}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: '#C9A961',
              color: '#0B1538',
              opacity: saving || loading || !selectedUid ? 0.5 : 1,
              cursor: saving || loading || !selectedUid ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            onClick={onClose}
            className="text-sm transition-opacity hover:opacity-60"
            style={{ color: '#8B8B85' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── BalancesTab ──────────────────────────────────────────────────────────────

interface AdjustmentRecord {
  id: string;
  employeeId: string;
  year: number;
  leaveType: string;
  oldTotal: number;
  newTotal: number;
  delta: number;
  reason: string;
  adjustedBy: string;
  adjustedByName: string;
  adjustedAt: import('firebase/firestore').Timestamp;
}

function useAdjustmentHistory() {
  const [records, setRecords]   = useState<AdjustmentRecord[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'leave_balance_adjustments'), orderBy('adjustedAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AdjustmentRecord)));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  return { records, loading };
}

interface BalancesTabProps {
  employees: { userId: string; displayName: string; employeeId?: string }[];
  actorUid: string;
  actorName: string;
  isAdmin: boolean;
  isHrmsManager: boolean;
}

function BalancesTab({ employees, actorUid, actorName }: BalancesTabProps) {
  const currentYear = new Date().getFullYear();
  const [showEditModal, setShowEditModal] = useState(false);
  const { records, loading } = useAdjustmentHistory();

  const employeeNameById = (uid: string): string =>
    employees.find((e) => e.userId === uid)?.displayName ?? uid.slice(0, 8);

  const leaveTypeLabel: Record<string, string> = {
    casual: 'Casual', sick: 'Sick', earned: 'Earned',
  };

  return (
    <div>
      {/* Action bar */}
      <div className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-slate-100">
        <p className="text-sm" style={{ color: '#8B8B85' }}>
          History of manual leave balance adjustments
        </p>
        <button
          onClick={() => setShowEditModal(true)}
          className="px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
        >
          Edit Balances
        </button>
      </div>

      {/* Adjustment history */}
      {loading ? (
        <div className="p-6 text-sm" style={{ color: '#8B8B85' }}>Loading…</div>
      ) : records.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm" style={{ color: '#8B8B85' }}>
          No adjustments recorded yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                {['Employee', 'Year', 'Type', 'Old Total', 'New Total', 'Delta', 'Reason', 'Adjusted By', 'Date'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: '#8B8B85' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium" style={{ color: '#0A0A0A' }}>
                    {employeeNameById(r.employeeId)}
                  </td>
                  <td className="px-4 py-3" style={{ color: '#2A2A2A' }}>{r.year}</td>
                  <td className="px-4 py-3" style={{ color: '#2A2A2A' }}>
                    {leaveTypeLabel[r.leaveType] ?? r.leaveType}
                  </td>
                  <td className="px-4 py-3 text-center" style={{ color: '#2A2A2A' }}>{r.oldTotal}</td>
                  <td className="px-4 py-3 text-center" style={{ color: '#2A2A2A' }}>{r.newTotal}</td>
                  <td className="px-4 py-3 text-center font-semibold"
                    style={{ color: r.delta > 0 ? '#065F46' : r.delta < 0 ? '#991B1B' : '#8B8B85' }}>
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate" style={{ color: '#2A2A2A' }} title={r.reason}>
                    {r.reason}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#8B8B85' }}>
                    {r.adjustedByName}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: '#8B8B85' }}>
                    {r.adjustedAt ? format(r.adjustedAt.toDate(), 'd MMM yyyy') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showEditModal && (
        <EditLeaveBalanceModal
          employees={employees}
          currentYear={currentYear}
          actorUid={actorUid}
          actorName={actorName}
          onClose={() => setShowEditModal(false)}
        />
      )}
    </div>
  );
}

// ─── AdminLeavePage ───────────────────────────────────────────────────────────

// ─── EncashmentTab ────────────────────────────────────────────────────────────

function EncashmentTab({ actorUid }: { actorUid: string }) {
  const { requests, loading } = useAllEncashmentRequests();
  const [actionId,  setActionId]  = useState<string | null>(null);
  const [rejReason, setRejReason] = useState('');
  const [showRej,   setShowRej]   = useState<string | null>(null);
  const [busy,      setBusy]      = useState<string | null>(null);
  const [toast,     setToast]     = useState('');

  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const otherRequests   = requests.filter((r) => r.status !== 'pending');

  const handleApprove = async (id: string) => {
    setBusy(id);
    try {
      await approveEncashmentRequest(id, actorUid);
      setToast('Encashment request approved.');
    } catch { setToast('Failed to approve.'); }
    finally { setBusy(null); }
  };

  const handleReject = async (id: string) => {
    if (!rejReason.trim()) return;
    setBusy(id);
    try {
      await rejectEncashmentRequest(id, actorUid, rejReason.trim());
      setShowRej(null);
      setRejReason('');
      setToast('Encashment request rejected.');
    } catch { setToast('Failed to reject.'); }
    finally { setBusy(null); }
  };

  const toTs = (ts: any): Date | null => ts?.toDate?.() ?? null;

  return (
    <div className="p-6 space-y-5">
      {toast && (
        <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: '#F0FDF4' }}>
          <CheckCircle2 size={14} style={{ color: '#059669' }} />
          <p className="text-sm" style={{ color: '#065F46' }}>{toast}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[1,2,3].map((i) => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}</div>
      ) : pendingRequests.length === 0 && otherRequests.length === 0 ? (
        <div className="py-10 text-center">
          <Coins size={32} className="mx-auto mb-3 text-slate-200" />
          <p className="text-sm text-mute">No encashment requests yet.</p>
        </div>
      ) : (
        <>
          {pendingRequests.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#92400E' }}>
                Pending ({pendingRequests.length})
              </h4>
              <div className="space-y-3">
                {pendingRequests.map((r) => (
                  <div key={r.id} className="p-4 rounded-2xl border border-amber-200 bg-amber-50/40">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-ink">{r.employeeName}</p>
                        <p className="text-xs text-mute mt-0.5">
                          {r.leaveDays} day{r.leaveDays !== 1 ? 's' : ''} · ₹{r.dailyRate.toLocaleString('en-IN')}/day · Total: <strong>₹{r.totalAmount.toLocaleString('en-IN')}</strong>
                        </p>
                        <p className="text-xs text-mute">Month: {r.month} · "{r.reason}"</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => handleApprove(r.id)} disabled={busy === r.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                          style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                          Approve
                        </button>
                        <button onClick={() => { setShowRej(r.id); setRejReason(''); }} disabled={busy === r.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                          style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                          Reject
                        </button>
                      </div>
                    </div>
                    {showRej === r.id && (
                      <div className="mt-3 flex gap-2">
                        <input className="flex-1 text-sm px-3 py-1.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-red-200"
                          placeholder="Rejection reason…" value={rejReason} onChange={(e) => setRejReason(e.target.value)} />
                        <button onClick={() => handleReject(r.id)} disabled={!rejReason.trim() || busy === r.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                          style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}>
                          Confirm
                        </button>
                        <button onClick={() => setShowRej(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50">
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {otherRequests.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#475569' }}>
                Processed
              </h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Employee', 'Month', 'Days', 'Amount', 'Status', 'Date'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-mute">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {otherRequests.slice(0, 20).map((r) => {
                    const d = toTs(r.approvedAt);
                    const statusCfg: Record<string, { label: string; color: string; bg: string }> = {
                      approved: { label: 'Approved', color: '#065F46', bg: '#D1FAE5' },
                      rejected: { label: 'Rejected', color: '#991B1B', bg: '#FEE2E2' },
                      paid:     { label: 'Paid',     color: '#1D4ED8', bg: '#DBEAFE' },
                    };
                    const cfg = statusCfg[r.status] ?? { label: r.status, color: '#374151', bg: '#F3F4F6' };
                    return (
                      <tr key={r.id} className="border-b border-slate-50">
                        <td className="px-3 py-2.5 font-medium text-ink">{r.employeeName}</td>
                        <td className="px-3 py-2.5 text-mute">{r.month}</td>
                        <td className="px-3 py-2.5 text-mute">{r.leaveDays}</td>
                        <td className="px-3 py-2.5 font-semibold">₹{r.totalAmount.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ color: cfg.color, backgroundColor: cfg.bg }}>{cfg.label}</span>
                        </td>
                        <td className="px-3 py-2.5 text-mute text-xs">{d ? format(d, 'd MMM yyyy') : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type TabId = 'pending' | 'all' | 'balances' | 'encashment';

export function AdminLeavePage() {
  const { user, profile } = useAuth();
  const { employees }     = useAllEmployees();
  const [activeTab, setActiveTab] = useState<TabId>('pending');

  // Must be called unconditionally — before any early returns (Rules of Hooks)
  const { requests: encashPending } = useAllEncashmentRequests();
  const pendingEncashCount = encashPending.filter((r) => r.status === 'pending').length;

  // Guard: admin or HRMS manager only
  if (profile?.role !== 'admin' && !profile?.isHrmsManager) {
    return <Navigate to="/hrms/dashboard" replace />;
  }

  const employeeNameById = (id: string): string =>
    employees.find((e) => e.userId === id)?.displayName ?? id.slice(0, 8);

  const tabStyle = (t: TabId): React.CSSProperties =>
    activeTab === t
      ? { borderBottom: '2px solid #C9A961', color: '#0A0A0A', fontWeight: 600 }
      : { borderBottom: '2px solid transparent', color: '#8B8B85' };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ── Header ── */}
      <div>
        <h2
          className="text-3xl mb-1"
          style={{
            fontFamily: '"Fraunces", Georgia, serif',
            fontStyle: 'italic',
            fontVariationSettings: '"SOFT" 30',
            fontWeight: 300,
            color: '#0A0A0A',
          }}
        >
          Leave Management
        </h2>
        <p className="text-sm" style={{ color: '#8B8B85' }}>
          Review and act on leave applications
        </p>
      </div>

      {/* ── Card with tabs ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-slate-100">
          {([
            ['pending',    'Pending Approvals'],
            ['all',        'All Applications'],
            ['balances',   'Balances'],
            ['encashment', 'Encashment'],
          ] as [TabId, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className="relative px-6 py-4 text-sm transition-colors"
              style={tabStyle(t)}
            >
              {label}
              {t === 'encashment' && pendingEncashCount > 0 && (
                <span className="absolute top-2 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none"
                  style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}>
                  {pendingEncashCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'pending' && (
          <PendingTab
            approverId={user?.uid ?? ''}
            employeeNameById={employeeNameById}
          />
        )}
        {activeTab === 'all' && (
          <AllTab
            employeeNameById={employeeNameById}
            employees={employees.map((e) => ({ userId: e.userId, displayName: e.displayName }))}
          />
        )}
        {activeTab === 'balances' && (
          <BalancesTab
            employees={employees.map((e) => ({ userId: e.userId, displayName: e.displayName, employeeId: e.employeeId }))}
            actorUid={user?.uid ?? ''}
            actorName={profile?.displayName ?? 'Admin'}
            isAdmin={profile?.role === 'admin'}
            isHrmsManager={!!profile?.isHrmsManager}
          />
        )}
        {activeTab === 'encashment' && (
          <EncashmentTab actorUid={user?.uid ?? ''} />
        )}
      </div>
    </div>
  );
}
