import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { format } from 'date-fns';
import { useAuth } from '../../auth/AuthContext';
import {
  usePendingApprovals,
  approveLeave,
  rejectLeave,
} from '../hooks/useLeave';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useToast } from '../../../components/ui/Toast';
import { db } from '../../../lib/firebase';
import type { LeaveApplication, LeaveStatus, LeaveType } from '../../../types';

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
  casual:   'Casual',
  sick:     'Sick',
  earned:   'Earned',
  lop:      'LOP',
  optional: 'Optional',
};

// ─── Reject modal ─────────────────────────────────────────────────────────────

interface RejectModalProps {
  applicationId: string;
  rejectedBy: string;
  onClose: () => void;
}

function RejectModal({ applicationId, rejectedBy, onClose }: RejectModalProps) {
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
      await rejectLeave(applicationId, reason.trim(), rejectedBy);
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
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const handleApprove = async (appId: string, employeeName: string) => {
    setApprovingId(appId);
    try {
      await approveLeave(appId, approverId);
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
                      onClick={() => handleApprove(app.id, employeeNameById(app.employeeId))}
                      disabled={approvingId === app.id}
                      className="px-3 py-1 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                      style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}
                    >
                      {approvingId === app.id ? '…' : 'Approve'}
                    </button>
                    <button
                      onClick={() => setRejectingId(app.id)}
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

      {rejectingId && (
        <RejectModal
          applicationId={rejectingId}
          rejectedBy={approverId}
          onClose={() => setRejectingId(null)}
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

// ─── AdminLeavePage ───────────────────────────────────────────────────────────

type TabId = 'pending' | 'all';

export function AdminLeavePage() {
  const { user, profile } = useAuth();
  const { employees }     = useAllEmployees();
  const [activeTab, setActiveTab] = useState<TabId>('pending');

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
          {(['pending', 'all'] as TabId[]).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className="px-6 py-4 text-sm transition-colors"
              style={tabStyle(t)}
            >
              {t === 'pending' ? 'Pending Approvals' : 'All Applications'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'pending' ? (
          <PendingTab
            approverId={user?.uid ?? ''}
            employeeNameById={employeeNameById}
          />
        ) : (
          <AllTab
            employeeNameById={employeeNameById}
            employees={employees.map((e) => ({ userId: e.userId, displayName: e.displayName }))}
          />
        )}
      </div>
    </div>
  );
}
