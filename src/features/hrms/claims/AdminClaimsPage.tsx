import { useState } from 'react';
import { format } from 'date-fns';
import { Car, Smartphone, Heart, Fuel, Users, HelpCircle, Download, Check, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAllClaims, approveClaim, rejectClaim, markClaimsPaid, exportClaimsCSV } from '../hooks/useClaims';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { writeNotification, sendHrEmailNotification, buildHrEmailHtml } from '../../../lib/notifications';
import type { ClaimType, ClaimStatus, Claim } from '../../../types';

// ─── Helpers (same as ClaimsPage) ─────────────────────────────────────────────

const CLAIM_TYPE_META: Record<ClaimType, { label: string; icon: typeof Car; color: string }> = {
  travel:               { label: 'Travel',               icon: Car,        color: '#3B82F6' },
  mobile:               { label: 'Mobile',               icon: Smartphone, color: '#8B5CF6' },
  medical:              { label: 'Medical',              icon: Heart,      color: '#EF4444' },
  petrol:               { label: 'Petrol',               icon: Fuel,       color: '#F59E0B' },
  client_entertainment: { label: 'Client Entertainment', icon: Users,      color: '#10B981' },
  other:                { label: 'Other',                icon: HelpCircle, color: '#8B8B85' },
};

const STATUS_STYLES: Record<ClaimStatus, { label: string; bg: string; color: string }> = {
  pending:  { label: 'Pending',  bg: '#FFFBEB', color: '#92400E' },
  approved: { label: 'Approved', bg: '#EFF6FF', color: '#1D4ED8' },
  rejected: { label: 'Rejected', bg: '#FFF1F2', color: '#BE123C' },
  paid:     { label: 'Paid',     bg: '#F0FDF4', color: '#166534' },
};

function toTs(ts: any): Date | null {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  return null;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(); d.setMonth(d.getMonth() - i);
  return d.toISOString().slice(0, 7);
});

// ─── Reject Modal ─────────────────────────────────────────────────────────────

function RejectModal({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleReject = async () => {
    if (!reason.trim()) return;
    setSaving(true);
    await rejectClaim(claim.id, reason.trim());
    writeNotification(claim.employeeId, {
      type:  'claim_rejected',
      title: 'Claim Rejected',
      body:  `Your ₹${claim.amount.toLocaleString('en-IN')} ${claim.claimType} claim was rejected. Reason: ${reason.trim()}`,
      link:  '/hrms/claims',
    }).catch(() => {});
    sendHrEmailNotification({
      employeeId: claim.employeeId,
      subject: 'Claim Update — Finvastra Pulse',
      htmlBody: buildHrEmailHtml({
        title: 'Your claim was not approved',
        lines: [
          { label: 'Claim Type', value: claim.claimType },
          { label: 'Amount',     value: `₹${claim.amount.toLocaleString('en-IN')}` },
        ],
        note:     reason.trim(),
        ctaLabel: 'View Claims',
        ctaLink:  'https://pulse.finvastra.com/hrms/claims',
      }),
    }).catch(() => {});
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-semibold text-ink">Reject Claim</h3>
        <textarea
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-red-200"
          rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejection (required)…" />
        <div className="flex gap-3">
          <button onClick={handleReject} disabled={!reason.trim() || saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
            style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}>
            {saving ? 'Rejecting…' : 'Reject'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm border border-slate-200 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Mark Paid Modal ──────────────────────────────────────────────────────────

function MarkPaidModal({ claims, totalAmount, onClose }: { claims: Claim[]; totalAmount: number; onClose: () => void }) {
  const [ref, setRef] = useState('');
  const [saving, setSaving] = useState(false);

  const handlePay = async () => {
    if (!ref.trim()) return;
    setSaving(true);
    await markClaimsPaid(claims.map((c) => c.id), ref.trim());
    claims.forEach((c) => {
      writeNotification(c.employeeId, {
        type:  'claim_paid',
        title: 'Claim Paid',
        body:  `Your ₹${c.amount.toLocaleString('en-IN')} ${c.claimType} claim has been paid. Ref: ${ref.trim()}`,
        link:  '/hrms/claims',
      }).catch(() => {});
      sendHrEmailNotification({
        employeeId: c.employeeId,
        subject: 'Claim Paid — Finvastra Pulse',
        htmlBody: buildHrEmailHtml({
          title: 'Your claim has been paid',
          lines: [
            { label: 'Claim Type',         value: c.claimType },
            { label: 'Amount',             value: `₹${c.amount.toLocaleString('en-IN')}` },
            { label: 'Payment Reference',  value: ref.trim() },
          ],
          ctaLabel: 'View Claims',
          ctaLink:  'https://pulse.finvastra.com/hrms/claims',
        }),
      }).catch(() => {});
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-ink">Mark {claims.length} Claims as Paid</h3>
          <p className="text-sm text-mute mt-1">Total: ₹{totalAmount.toLocaleString('en-IN')}</p>
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
            Payment Reference (NEFT / Cash) *
          </label>
          <input className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-navy/10"
            value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. NEFT123456 / Cash" />
        </div>
        <div className="flex gap-3">
          <button onClick={handlePay} disabled={!ref.trim() || saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
            style={{ backgroundColor: '#166534', color: '#FFFFFF' }}>
            {saving ? 'Marking paid…' : 'Mark Paid'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm border border-slate-200 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AdminClaimsPage ──────────────────────────────────────────────────────────

export function AdminClaimsPage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [statusFilter, setStatusFilter] = useState('');
  const [empFilter, setEmpFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectingClaim, setRejectingClaim] = useState<Claim | null>(null);
  const [showMarkPaid, setShowMarkPaid] = useState(false);

  const { claims, loading } = useAllClaims(month, statusFilter || undefined, empFilter || undefined);
  const { employees } = useAllEmployees();

  const employeeOptions = employees.map((e) => ({ value: e.userId, label: e.displayName }));
  const approvedSelected = claims.filter((c) => selected.has(c.id) && c.status === 'approved');

  const toggleSelect = (id: string) => {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleApprove = async (claim: Claim) => {
    if (!user) return;
    await approveClaim(claim.id, user.uid);
    writeNotification(claim.employeeId, {
      type:  'claim_approved',
      title: 'Claim Approved',
      body:  `Your ₹${claim.amount.toLocaleString('en-IN')} ${claim.claimType} claim has been approved.`,
      link:  '/hrms/claims',
    }).catch(() => {});
    sendHrEmailNotification({
      employeeId: claim.employeeId,
      subject: 'Claim Approved — Finvastra Pulse',
      htmlBody: buildHrEmailHtml({
        title: 'Your claim has been approved',
        lines: [
          { label: 'Claim Type', value: claim.claimType },
          { label: 'Amount',     value: `₹${claim.amount.toLocaleString('en-IN')}` },
        ],
        ctaLabel: 'View Claims',
        ctaLink:  'https://pulse.finvastra.com/hrms/claims',
      }),
    }).catch(() => {});
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl mb-1"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
            Claims — Admin
          </h2>
          <p className="text-sm text-mute">Review, approve, and mark claims as paid.</p>
        </div>
        <button onClick={() => exportClaimsCSV(month)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 hover:bg-slate-50 transition-colors"
          style={{ color: '#2A2A2A' }}>
          <Download size={16} />
          Export {month}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-navy/10"
          value={month} onChange={(e) => setMonth(e.target.value)}>
          {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-navy/10"
          value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="paid">Paid</option>
        </select>
        <div className="w-56">
          <SearchableSelect
            options={[{ value: '', label: 'All employees' }, ...employeeOptions]}
            value={empFilter}
            onChange={setEmpFilter}
            placeholder="All employees"
          />
        </div>
      </div>

      {/* Bulk action bar */}
      {approvedSelected.length > 0 && (
        <div className="flex items-center gap-4 px-5 py-3 rounded-xl border border-green-200"
          style={{ backgroundColor: '#F0FDF4' }}>
          <span className="text-sm font-medium" style={{ color: '#166534' }}>
            {approvedSelected.length} approved claim{approvedSelected.length > 1 ? 's' : ''} selected
            · ₹{approvedSelected.reduce((s, c) => s + c.amount, 0).toLocaleString('en-IN')}
          </span>
          <button onClick={() => setShowMarkPaid(true)}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: '#166534', color: '#FFFFFF' }}>
            Mark as Paid
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-mute hover:opacity-70 ml-auto">
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1,2,3,4].map(i => <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />)}
          </div>
        ) : claims.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-mute">No claims found for the selected filters.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="w-10 p-4" />
                <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-mute">Employee</th>
                <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-mute">Type</th>
                <th className="text-right p-4 text-[10px] font-bold uppercase tracking-widest text-mute">Amount</th>
                <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-mute">Description</th>
                <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-mute">Submitted</th>
                <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-mute">Status</th>
                <th className="p-4" />
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => {
                const meta = CLAIM_TYPE_META[c.claimType];
                const sty = STATUS_STYLES[c.status];
                const Icon = meta.icon;
                const submittedDate = toTs(c.submittedAt);
                const isApproved = c.status === 'approved';
                return (
                  <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                    <td className="p-4">
                      {isApproved && (
                        <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)}
                          className="rounded" />
                      )}
                    </td>
                    <td className="p-4">
                      <p className="font-medium text-ink">{c.employeeName}</p>
                    </td>
                    <td className="p-4">
                      <span className="flex items-center gap-1.5">
                        <Icon size={14} style={{ color: meta.color }} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="p-4 text-right font-semibold text-ink">
                      ₹{c.amount.toLocaleString('en-IN')}
                    </td>
                    <td className="p-4 text-mute max-w-xs truncate">{c.description}</td>
                    <td className="p-4 text-mute whitespace-nowrap">
                      {submittedDate ? format(submittedDate, 'dd MMM yyyy') : '—'}
                    </td>
                    <td className="p-4">
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                        style={{ backgroundColor: sty.bg, color: sty.color }}>
                        {sty.label}
                      </span>
                    </td>
                    <td className="p-4">
                      {c.status === 'pending' && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleApprove(c)}
                            className="p-1.5 rounded-lg hover:bg-green-50 transition-colors" title="Approve">
                            <Check size={16} style={{ color: '#166534' }} />
                          </button>
                          <button onClick={() => setRejectingClaim(c)}
                            className="p-1.5 rounded-lg hover:bg-red-50 transition-colors" title="Reject">
                            <X size={16} style={{ color: '#DC2626' }} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {rejectingClaim && <RejectModal claim={rejectingClaim} onClose={() => setRejectingClaim(null)} />}
      {showMarkPaid && (
        <MarkPaidModal
          claims={approvedSelected}
          totalAmount={approvedSelected.reduce((s, c) => s + c.amount, 0)}
          onClose={() => { setShowMarkPaid(false); setSelected(new Set()); }}
        />
      )}
    </div>
  );
}
