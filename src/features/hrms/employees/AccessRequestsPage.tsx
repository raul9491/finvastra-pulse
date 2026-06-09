import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  doc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { Modal } from '../../../components/ui/Modal';
import type { AccessRequest, AccessRequestStatus, CrmRole, MisAccess } from '../../../types';

// ─── Hook ─────────────────────────────────────────────────────────────────────

function useAccessRequests(statusFilter: AccessRequestStatus | 'all') {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const base = collection(db, 'access_requests');
    const q = statusFilter === 'all'
      ? query(base, orderBy('submittedAt', 'desc'))
      : query(base, where('status', '==', statusFilter), orderBy('submittedAt', 'desc'));

    return onSnapshot(q,
      (snap) => {
        setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AccessRequest)));
        setLoading(false);
      },
      (err) => {
        console.error('[AccessRequests] onSnapshot error:', err);
        setLoading(false);
      },
    );
  }, [statusFilter]);

  return { requests, loading };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: AccessRequestStatus }) {
  const styles: Record<AccessRequestStatus, { bg: string; text: string }> = {
    pending:  { bg: '#FFFBEB', text: '#92400E' },
    approved: { bg: '#D1FAE5', text: '#065F46' },
    rejected: { bg: '#FEE2E2', text: '#991B1B' },
  };
  const s = styles[status];
  return (
    <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
      style={{ backgroundColor: s.bg, color: s.text }}>
      {status}
    </span>
  );
}

function formatTs(ts: AccessRequest['submittedAt'] | null): string {
  if (!ts?.toDate) return '—';
  return ts.toDate().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Approve modal ────────────────────────────────────────────────────────────

interface ApproveForm {
  officialEmail: string;
  employeeId: string;
  role: 'admin' | 'employee';
  hrmsAccess: boolean;
  crmAccess: boolean;
  crmRole: CrmRole;
  misAccess: MisAccess | null;
}

function ApproveModal({
  request, onClose, adminToken,
}: {
  request: AccessRequest;
  onClose: () => void;
  adminToken: () => Promise<string>;
}) {
  const [form, setForm] = useState<ApproveForm>({
    officialEmail: '',
    employeeId:    '',
    role:          'employee',
    hrmsAccess:    true,
    crmAccess:     false,
    crmRole:       null,
    misAccess:     null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const emailValid = form.officialEmail.trim().endsWith('@finvastra.com');
  const codeValid  = /^[A-Z]{2,4}-\d{3,}$/.test(form.employeeId.trim());

  const handleApprove = async () => {
    if (!emailValid || !codeValid) { setError('Check official email and employee code format.'); return; }
    setError(''); setSubmitting(true);
    try {
      const token = await adminToken();
      const res = await fetch('/api/admin/employees/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          displayName:      request.fullName,
          email:            form.officialEmail.trim(),
          employeeId:       form.employeeId.trim(),
          department:       request.department,
          designation:      request.designation,
          role:             form.role,
          hrmsAccess:       form.hrmsAccess,
          crmAccess:        form.crmAccess,
          crmRole:          form.crmRole,
          convertorVertical:null,
          isHrmsManager:    false,
          misAccess:        form.misAccess,
        }),
      });
      const data = await res.json() as { uid?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Create failed');

      await updateDoc(doc(db, 'access_requests', request.id), {
        status:     'approved',
        reviewedAt: serverTimestamp(),
        createdUid: data.uid ?? null,
      });
      onClose();
    } catch (err) {
      console.error('[ApproveModal] error:', err);
      setError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setSubmitting(false);
    }
  };

  const inp = 'w-full px-3.5 py-2.5 text-sm bg-(--glass-panel-bg) border border-(--shell-border) rounded-lg outline-none focus:ring-2';
  const sel = `${inp} cursor-pointer`;

  return (
    <Modal isOpen onClose={onClose} title={`Approve — ${request.fullName}`} size="sm"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-(--shell-border) rounded-xl"
            style={{ color: 'var(--text-primary)' }}>Cancel</button>
          <button onClick={handleApprove} disabled={submitting || !emailValid || !codeValid}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {submitting ? 'Creating…' : 'Create Account'}
          </button>
        </>
      }>
      <div className="space-y-3">
        {error && <p className="text-sm text-red-500 px-1">{error}</p>}

        <div className="rounded-xl px-4 py-3 text-xs space-y-0.5" style={{ backgroundColor: 'var(--glass-panel-bg)' }}>
          <p style={{ color: 'var(--text-muted)' }}>{request.department} · {request.designation}</p>
          <p style={{ color: 'var(--text-muted)' }}>Personal: {request.personalEmail} · {request.mobileNumber}</p>
          {request.message && <p style={{ color: 'var(--text-muted)' }}>"{request.message}"</p>}
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1"
            style={{ color: 'var(--text-muted)' }}>Official Email *</label>
          <input value={form.officialEmail} onChange={(e) => setForm((f) => ({ ...f, officialEmail: e.target.value }))}
            placeholder="name@finvastra.com" className={inp} style={{ color: 'var(--text-primary)' }} />
          {form.officialEmail.length > 0 && !emailValid && (
            <p className="mt-0.5 text-xs text-red-500">Must end with @finvastra.com</p>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1"
            style={{ color: 'var(--text-muted)' }}>Employee Code *</label>
          <input value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
            placeholder="FAPL-023" className={inp} style={{ color: 'var(--text-primary)' }} />
          {form.employeeId.length > 0 && !codeValid && (
            <p className="mt-0.5 text-xs text-red-500">Format: FAPL-001 or similar</p>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1"
            style={{ color: 'var(--text-muted)' }}>Platform Role</label>
          <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as 'admin' | 'employee' }))}
            className={sel} style={{ color: 'var(--text-primary)' }}>
            <option value="employee">Employee</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={form.crmAccess}
              onChange={(e) => setForm((f) => ({ ...f, crmAccess: e.target.checked, crmRole: e.target.checked ? f.crmRole : null }))}
              className="w-4 h-4 rounded" />
            CRM Access
          </label>
          {form.crmAccess && (
            <select value={form.crmRole ?? ''} onChange={(e) => setForm((f) => ({ ...f, crmRole: (e.target.value || null) as CrmRole }))}
              className="text-sm px-2 py-1 border border-(--shell-border) rounded-lg bg-(--glass-panel-bg)" style={{ color: 'var(--text-primary)' }}>
              <option value="">No role</option>
              <option value="lead_generator">Generator</option>
              <option value="lead_convertor">Convertor</option>
              <option value="manager">Manager</option>
              <option value="admin">CRM Admin</option>
            </select>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1"
            style={{ color: 'var(--text-muted)' }}>MIS Access</label>
          <select value={form.misAccess ?? ''} onChange={(e) => setForm((f) => ({ ...f, misAccess: (e.target.value || null) as MisAccess | null }))}
            className={sel} style={{ color: 'var(--text-primary)' }}>
            <option value="">None</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}

// ─── Reject modal ─────────────────────────────────────────────────────────────

function RejectModal({
  request, onClose, adminUid,
}: {
  request: AccessRequest;
  onClose: () => void;
  adminUid: string;
}) {
  const [reason,     setReason]     = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleReject = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'access_requests', request.id), {
        status:          'rejected',
        rejectionReason: reason.trim(),
        reviewedBy:      adminUid,
        reviewedAt:      serverTimestamp(),
      });
      onClose();
    } catch (err) {
      console.error('[RejectModal] error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Reject — ${request.fullName}`} size="sm"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-(--shell-border) rounded-xl"
            style={{ color: 'var(--text-primary)' }}>Cancel</button>
          <button onClick={handleReject} disabled={!reason.trim() || submitting}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#991B1B', color: '#FFFFFF' }}>
            {submitting ? 'Rejecting…' : 'Reject'}
          </button>
        </>
      }>
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Provide a reason. This will be logged against the request.
        </p>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
          placeholder="Reason for rejection…"
          className="w-full px-3.5 py-2.5 text-sm bg-(--glass-panel-bg) border border-(--shell-border) rounded-lg outline-none focus:ring-2 resize-none"
          style={{ color: 'var(--text-primary)' }} />
      </div>
    </Modal>
  );
}

// ─── AccessRequestsPage ───────────────────────────────────────────────────────

const TABS: { label: string; value: AccessRequestStatus | 'all' }[] = [
  { label: 'All',      value: 'all'      },
  { label: 'Pending',  value: 'pending'  },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
];

export function AccessRequestsPage() {
  const { user } = useAuth();
  const [tab,         setTab]         = useState<AccessRequestStatus | 'all'>('pending');
  const [approving,   setApproving]   = useState<AccessRequest | null>(null);
  const [rejecting,   setRejecting]   = useState<AccessRequest | null>(null);

  const { requests, loading } = useAccessRequests(tab);

  const getToken = async () => {
    const t = await user?.getIdToken();
    if (!t) throw new Error('Not authenticated');
    return t;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div>
        <h2 className="text-3xl mb-1"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          Access Requests
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Review and approve or reject employee account requests.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-(--glass-panel-bg) rounded-xl p-1 w-fit">
        {TABS.map(({ label, value }) => (
          <button key={value} onClick={() => setTab(value)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={tab === value
              ? { backgroundColor: 'var(--glass-panel-bg)', color: 'var(--text-primary)', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }
              : { color: 'var(--text-muted)' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : requests.length === 0 ? (
          <div className="p-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No {tab === 'all' ? '' : tab} requests.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--glass-panel-bg)', borderBottom: '1px solid #E2E8F0' }}>
                  {['Name', 'Department', 'Designation', 'Personal Email', 'Mobile', 'Submitted', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr key={req.id} className="border-b border-slate-50 last:border-0 hover:bg-(--glass-panel-bg) transition-colors">
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{req.fullName}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{req.department}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{req.designation}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{req.personalEmail}</td>
                    <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{req.mobileNumber}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{formatTs(req.submittedAt)}</td>
                    <td className="px-4 py-3"><StatusPill status={req.status} /></td>
                    <td className="px-4 py-3">
                      {req.status === 'pending' && (
                        <div className="flex gap-2">
                          <button onClick={() => setApproving(req)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg"
                            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                            Approve
                          </button>
                          <button onClick={() => setRejecting(req)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200"
                            style={{ color: '#991B1B' }}>
                            Reject
                          </button>
                        </div>
                      )}
                      {req.status === 'rejected' && req.rejectionReason && (
                        <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}
                          title={req.rejectionReason}>
                          "{req.rejectionReason.slice(0, 30)}{req.rejectionReason.length > 30 ? '…' : ''}"
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {approving && (
        <ApproveModal
          request={approving}
          onClose={() => setApproving(null)}
          adminToken={getToken}
        />
      )}
      {rejecting && user && (
        <RejectModal
          request={rejecting}
          onClose={() => setRejecting(null)}
          adminUid={user.uid}
        />
      )}
    </div>
  );
}
