/**
 * The leave-approval tabs: Pending (approve / reject) and All (history), plus
 * the reject dialog and the shared status pill.
 * 
 * Extracted verbatim from AdminLeavePage.tsx (2026-07-23) - no behaviour
 * change. Approve/cancel still go through the transactional helpers in
 * hooks/useLeave, which key the balance by the LEAVE's financial year.
 */
import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '../../../lib/firebase';
import { useToast } from '../../../components/ui/Toast';
import { writeNotification, sendHrEmailNotification, buildHrEmailHtml } from '../../../lib/notifications';
import { usePendingApprovals, approveLeave, rejectLeave } from '../hooks/useLeave';
import type { LeaveApplication, LeaveStatus, LeaveType } from '../../../types';

// ─── Status pill ─────────────────────────────────────────────────────────────

export function StatusPill({ status }: { status: LeaveStatus }) {
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

export function RejectModal({ application, rejectedBy, onClose }: RejectModalProps) {
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
        subject: 'Update on your leave request',
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
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) shadow-xl p-6 w-full max-w-md space-y-4">
        <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          Reject Leave Application
        </h3>
        <div className="space-y-1.5">
          <label
            className="block text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            Reason (mandatory)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Explain why the leave is being rejected…"
            className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
            style={{ color: 'var(--text-primary)' }}
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
            style={{ color: 'var(--text-muted)' }}
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

export function PendingTab({ approverId, employeeNameById }: PendingTabProps) {
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
        subject: 'Your leave has been approved',
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
    return <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>;
  }

  if (applications.length === 0) {
    return (
      <div className="px-6 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        No pending applications.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--shell-border)">
              {['Employee', 'Type', 'Period', 'Days', 'Reason', 'Applied', ''].map((h) => (
                <th
                  key={h}
                  className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {applications.map((app) => (
              <tr key={app.id} className="border-b border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
                <td className="px-6 py-3.5 font-medium" style={{ color: 'var(--text-primary)' }}>
                  {employeeNameById(app.employeeId)}
                </td>
                <td className="px-6 py-3.5" style={{ color: 'var(--text-primary)' }}>
                  {TYPE_LABELS[app.type]}
                </td>
                <td className="px-6 py-3.5 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                  {format(new Date(app.fromDate), 'd MMM')}
                  {' – '}
                  {format(new Date(app.toDate), 'd MMM yyyy')}
                </td>
                <td className="px-6 py-3.5" style={{ color: 'var(--text-primary)' }}>
                  {app.days}
                </td>
                <td
                  className="px-6 py-3.5 max-w-xs truncate"
                  style={{ color: 'var(--text-primary)' }}
                  title={app.reason}
                >
                  {app.reason}
                </td>
                <td className="px-6 py-3.5 text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
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

export interface AllTabProps {
  employeeNameById: (id: string) => string;
  employees: { userId: string; displayName: string }[];
}

// useAllApplications — inline hook scoped to this tab component.
// Subscribes to the full leave_applications collection (latest 500 docs),
// ordered by appliedAt desc. At 25 employees × ~15 apps/year ≈ 375 docs — well
// within Firestore real-time limits.
export function useAllApplications() {
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

export function AllTab({ employeeNameById, employees }: AllTabProps) {
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
      <div className="flex flex-wrap gap-3 px-6 pt-4 pb-3 border-b border-(--shell-border)">
        <select
          value={filterEmployee}
          onChange={(e) => setFilterEmployee(e.target.value)}
          className="border border-(--shell-border) rounded-lg px-3 py-1.5 text-sm"
          style={{ color: 'var(--text-primary)' }}
        >
          <option value="">All Employees</option>
          {employees.map((emp) => (
            <option key={emp.userId} value={emp.userId}>{emp.displayName}</option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as LeaveStatus | '')}
          className="border border-(--shell-border) rounded-lg px-3 py-1.5 text-sm"
          style={{ color: 'var(--text-primary)' }}
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
          className="border border-(--shell-border) rounded-lg px-3 py-1.5 text-sm"
          style={{ color: 'var(--text-primary)' }}
        >
          <option value="">All Types</option>
          {(Object.entries(TYPE_LABELS) as [LeaveType, string][]).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No applications match the current filters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--shell-border)">
                {['Employee', 'Type', 'Period', 'Days', 'Status', 'Applied'].map((h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((app) => (
                <tr key={app.id} className="border-b border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
                  <td className="px-6 py-3.5 font-medium" style={{ color: 'var(--text-primary)' }}>
                    {employeeNameById(app.employeeId)}
                  </td>
                  <td className="px-6 py-3.5" style={{ color: 'var(--text-primary)' }}>
                    {TYPE_LABELS[app.type]}
                  </td>
                  <td className="px-6 py-3.5 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                    {format(new Date(app.fromDate), 'd MMM')}
                    {' – '}
                    {format(new Date(app.toDate), 'd MMM yyyy')}
                  </td>
                  <td className="px-6 py-3.5" style={{ color: 'var(--text-primary)' }}>
                    {app.days}
                  </td>
                  <td className="px-6 py-3.5">
                    <StatusPill status={app.status} />
                  </td>
                  <td className="px-6 py-3.5 text-xs" style={{ color: 'var(--text-muted)' }}>
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
