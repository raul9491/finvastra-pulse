/**
 * The Corrections tab: employee regularization requests, with approve / reject.
 * 
 * Approving writes the corrected attendance record — which is why the /attendance
 * CREATE rule had to allow admin/HR (fixed 2026-07-03; a self-only create rule
 * silently denied an admin marking someone else present on a no-record day).
 * 
 * Extracted verbatim from AdminAttendancePage.tsx (2026-07-23).
 */
import { useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { format, parseISO } from 'date-fns';
import { db } from '../../../lib/firebase';
import { writeNotification, sendHrEmailNotification, buildHrEmailHtml } from '../../../lib/notifications';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useAllRegularizations, approveRegularization, rejectRegularization } from '../hooks/useAttendanceRegularization';
import type { AttendanceRegularization } from '../../../types';

// ─── RegularizationsTab ───────────────────────────────────────────────────────

export const REG_STATUS_STYLES = {
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

export function RejectRegModal({ req, reviewerName, reviewerId, onDone, onCancel }: RejectRegModalProps) {
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

export function RegularizationsTab({ reviewerId, reviewerName }: RegTabProps) {
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

