import { useState } from 'react';
import { format } from 'date-fns';
import { Car, Smartphone, Heart, Fuel, Users, HelpCircle, Download, Check, X, Paperclip, CreditCard, Laptop, Package, FileText, IndianRupee } from 'lucide-react';
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
  cibil:                { label: 'CIBIL',                icon: CreditCard, color: '#06B6D4' },
  software:             { label: 'Software',             icon: Laptop,     color: '#6366F1' },
  office_supplies:      { label: 'Office Supplies',      icon: Package,    color: '#F97316' },
  other:                { label: 'Other',                icon: HelpCircle, color: 'var(--text-muted)' },
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

// ─── Claim Detail Modal (view bill + approve / reject) ────────────────────────

function DRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-(--text-muted) shrink-0">{label}</span>
      <span className="text-right" style={{ color: danger ? '#f87171' : 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

function ClaimDetailModal({ claim, onApprove, onReject, onMarkPaid, onClose }: {
  claim: Claim;
  onApprove:  (claim: Claim) => Promise<void>;
  onReject:   (claim: Claim, reason: string) => Promise<void>;
  onMarkPaid: (claim: Claim, reference: string) => Promise<void>;
  onClose:    () => void;
}) {
  const meta = CLAIM_TYPE_META[claim.claimType] ?? CLAIM_TYPE_META.other;
  const sty  = STATUS_STYLES[claim.status];
  const Icon = meta.icon;
  const submitted = toTs(claim.submittedAt);
  const isPdf = !!claim.receiptUrl && claim.receiptUrl.toLowerCase().includes('.pdf');
  const [busy, setBusy] = useState<'' | 'approve' | 'reject' | 'pay'>('');
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [showPay, setShowPay] = useState(false);
  const [payRef, setPayRef] = useState('');

  const doApprove  = async () => { setBusy('approve'); try { await onApprove(claim); onClose(); } catch { setBusy(''); } };
  const doReject   = async () => { if (!reason.trim()) return; setBusy('reject'); try { await onReject(claim, reason.trim()); onClose(); } catch { setBusy(''); } };
  const doMarkPaid = async () => { if (!payRef.trim()) return; setBusy('pay'); try { await onMarkPaid(claim, payRef.trim()); onClose(); } catch { setBusy(''); } };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 glass-modal-overlay">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto glass-modal-panel">
        <div className="flex items-center justify-between p-5 glass-modal-header">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: meta.color + '22', color: meta.color }}>
              <Icon size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold truncate text-(--text-primary)">{claim.employeeName}</h3>
              <p className="text-xs text-(--text-muted)">{meta.label} claim</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg nav-item-hover"><X size={16} style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-2xl font-bold text-(--text-primary)">₹{claim.amount.toLocaleString('en-IN')}</p>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide" style={{ backgroundColor: sty.bg, color: sty.color }}>{sty.label}</span>
          </div>

          <div className="space-y-2 text-sm">
            <DRow label="Description" value={claim.description} />
            <DRow label="Bill date & time" value={claim.expenseDate ? format(new Date(claim.expenseDate), 'dd MMM yyyy, h:mm a') : '—'} />
            <DRow label="Spend month"      value={claim.expenseDate ? format(new Date(claim.expenseDate), 'MMMM yyyy') : claim.month} />
            <DRow label="Submitted"        value={submitted ? format(submitted, 'dd MMM yyyy, h:mm a') : '—'} />
            {claim.travelDetails && (
              <DRow label="Route" value={`${claim.travelDetails.fromLocation} → ${claim.travelDetails.toLocation} · ${claim.travelDetails.distanceKm} km · ${claim.travelDetails.modeOfTransport}`} />
            )}
            {claim.status === 'rejected' && claim.rejectionReason && <DRow label="Rejection reason" value={claim.rejectionReason} danger />}
            {claim.status === 'paid' && claim.paymentReference && <DRow label="Payment ref" value={claim.paymentReference} />}
          </div>

          {/* Bill preview */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2 text-(--text-muted)">Attached Bill</p>
            {!claim.receiptUrl ? (
              <p className="text-sm text-(--text-muted) py-6 text-center rounded-xl" style={{ border: '1px dashed var(--shell-border)' }}>No bill attached</p>
            ) : isPdf ? (
              <a href={claim.receiptUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 py-6 rounded-xl text-sm font-semibold"
                style={{ border: '1px solid var(--shell-border)', color: '#C9A961' }}>
                <FileText size={16} /> Open PDF bill
              </a>
            ) : (
              <a href={claim.receiptUrl} target="_blank" rel="noopener noreferrer" className="block rounded-xl overflow-hidden" title="Open full size"
                style={{ border: '1px solid var(--shell-border)' }}>
                <img src={claim.receiptUrl} alt="Bill" className="w-full max-h-80 object-contain" style={{ backgroundColor: 'var(--glass-panel-bg)' }} />
              </a>
            )}
          </div>

          {/* Actions */}
          {claim.status === 'pending' && (
            !showReject ? (
              <div className="flex gap-3 pt-1">
                <button onClick={doApprove} disabled={busy !== ''}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                  style={{ backgroundColor: '#10B981', color: '#06281d' }}>
                  <Check size={15} /> {busy === 'approve' ? 'Approving…' : 'Approve'}
                </button>
                <button onClick={() => setShowReject(true)} disabled={busy !== ''}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                  style={{ backgroundColor: 'rgba(220,38,38,0.15)', color: '#f87171', border: '1px solid rgba(220,38,38,0.4)' }}>
                  <X size={15} /> Reject
                </button>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason for rejection (sent to the employee)…" className="w-full glass-inp text-sm resize-none" />
                <div className="flex gap-3">
                  <button onClick={doReject} disabled={!reason.trim() || busy !== ''}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                    style={{ backgroundColor: '#DC2626', color: '#fff' }}>
                    {busy === 'reject' ? 'Rejecting…' : 'Confirm Reject'}
                  </button>
                  <button onClick={() => { setShowReject(false); setReason(''); }}
                    className="px-4 py-2.5 rounded-xl text-sm" style={{ border: '1px solid var(--shell-border)', color: 'var(--text-muted)' }}>
                    Back
                  </button>
                </div>
              </div>
            )
          )}

          {/* Approved → mark paid right here (single claim; bulk flow still available on the table) */}
          {claim.status === 'approved' && (
            !showPay ? (
              <button onClick={() => setShowPay(true)} disabled={busy !== ''}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: '#10B981', color: '#06281d' }}>
                <IndianRupee size={15} /> Mark as Paid
              </button>
            ) : (
              <div className="space-y-2 pt-1">
                <textarea autoFocus rows={2} value={payRef} onChange={(e) => setPayRef(e.target.value)}
                  placeholder="Payment reference / note — e.g. NEFT 123456, paid from HDFC…" className="w-full glass-inp text-sm resize-none" />
                <div className="flex gap-3">
                  <button onClick={doMarkPaid} disabled={!payRef.trim() || busy !== ''}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                    style={{ backgroundColor: '#10B981', color: '#06281d' }}>
                    {busy === 'pay' ? 'Saving…' : 'Confirm Paid'}
                  </button>
                  <button onClick={() => { setShowPay(false); setPayRef(''); }}
                    className="px-4 py-2.5 rounded-xl text-sm" style={{ border: '1px solid var(--shell-border)', color: 'var(--text-muted)' }}>
                    Back
                  </button>
                </div>
              </div>
            )
          )}
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
        subject: 'Your claim has been paid',
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
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-(--text-primary)">Mark {claims.length} Claims as Paid</h3>
          <p className="text-sm text-(--text-muted) mt-1">Total: ₹{totalAmount.toLocaleString('en-IN')}</p>
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Payment Reference (NEFT / Cash) *
          </label>
          <input className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-navy/10"
            value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. NEFT123456 / Cash" />
        </div>
        <div className="flex gap-3">
          <button onClick={handlePay} disabled={!ref.trim() || saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
            style={{ backgroundColor: '#166534', color: '#FFFFFF' }}>
            {saving ? 'Marking paid…' : 'Mark Paid'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm border border-(--shell-border) hover:bg-(--glass-panel-bg)">
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
  const [detailClaim, setDetailClaim] = useState<Claim | null>(null);
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
      subject: 'Your claim has been approved',
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

  const handleReject = async (claim: Claim, reason: string) => {
    await rejectClaim(claim.id, reason);
    writeNotification(claim.employeeId, {
      type:  'claim_rejected',
      title: 'Claim Rejected',
      body:  `Your ₹${claim.amount.toLocaleString('en-IN')} ${claim.claimType} claim was rejected. Reason: ${reason}`,
      link:  '/hrms/claims',
    }).catch(() => {});
    sendHrEmailNotification({
      employeeId: claim.employeeId,
      subject: 'Update on your claim',
      htmlBody: buildHrEmailHtml({
        title: 'Your claim was not approved',
        lines: [
          { label: 'Claim Type', value: claim.claimType },
          { label: 'Amount',     value: `₹${claim.amount.toLocaleString('en-IN')}` },
        ],
        note:     reason,
        ctaLabel: 'View Claims',
        ctaLink:  'https://pulse.finvastra.com/hrms/claims',
      }),
    }).catch(() => {});
  };

  const handleMarkPaid = async (claim: Claim, reference: string) => {
    await markClaimsPaid([claim.id], reference);
    writeNotification(claim.employeeId, {
      type:  'claim_paid',
      title: 'Claim Paid',
      body:  `Your ₹${claim.amount.toLocaleString('en-IN')} ${claim.claimType} claim has been paid. Ref: ${reference}`,
      link:  '/hrms/claims',
    }).catch(() => {});
    sendHrEmailNotification({
      employeeId: claim.employeeId,
      subject: 'Claim Paid — Finvastra Pulse',
      htmlBody: buildHrEmailHtml({
        title: 'Your claim has been paid',
        lines: [
          { label: 'Claim Type',        value: claim.claimType },
          { label: 'Amount',            value: `₹${claim.amount.toLocaleString('en-IN')}` },
          { label: 'Payment Reference', value: reference },
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
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            Claims — Admin
          </h2>
          <p className="text-sm text-(--text-muted)">Review, approve, and mark claims as paid.</p>
        </div>
        <button onClick={() => exportClaimsCSV(month)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors"
          style={{ color: 'var(--text-primary)' }}>
          <Download size={16} />
          Export {month}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          className="border border-(--shell-border) rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-navy/10"
          value={month} onChange={(e) => setMonth(e.target.value)}>
          {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select
          className="border border-(--shell-border) rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-navy/10"
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
          <button onClick={() => setSelected(new Set())} className="text-sm opacity-80 hover:opacity-60 ml-auto" style={{ color: '#166534' }}>
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1,2,3,4].map(i => <div key={i} className="h-12 bg-(--glass-panel-bg) rounded-lg animate-pulse" />)}
          </div>
        ) : claims.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-(--text-muted)">No claims found for the selected filters.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--shell-border)">
                <th className="w-10 p-4" />
                <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Employee</th>
                <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Type</th>
                <th className="text-right p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Amount</th>
                <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Description</th>
                <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Submitted</th>
                <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Status</th>
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
                  <tr key={c.id} onClick={() => setDetailClaim(c)}
                    className="border-b border-(--shell-border) hover:bg-(--glass-panel-bg)/50 transition-colors cursor-pointer">
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                      {isApproved && (
                        <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)}
                          className="rounded" />
                      )}
                    </td>
                    <td className="p-4">
                      <p className="font-medium text-(--text-primary)">{c.employeeName}</p>
                    </td>
                    <td className="p-4">
                      <span className="flex items-center gap-1.5">
                        <Icon size={14} style={{ color: meta.color }} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="p-4 text-right font-semibold text-(--text-primary)">
                      ₹{c.amount.toLocaleString('en-IN')}
                    </td>
                    <td className="p-4 max-w-xs">
                      <p className="text-(--text-muted) truncate">{c.description}</p>
                      {c.receiptUrl && (
                        <a href={c.receiptUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs mt-0.5 transition-colors hover:opacity-70"
                          style={{ color: '#C9A961' }} title="View attached bill">
                          <Paperclip size={12} /> View bill
                        </a>
                      )}
                    </td>
                    <td className="p-4 text-(--text-muted) whitespace-nowrap">
                      {submittedDate ? format(submittedDate, 'dd MMM yyyy') : '—'}
                    </td>
                    <td className="p-4">
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                        style={{ backgroundColor: sty.bg, color: sty.color }}>
                        {sty.label}
                      </span>
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      <span className="text-xs font-semibold" style={{ color: c.status === 'pending' ? '#C9A961' : 'var(--text-muted)' }}>
                        {c.status === 'pending' ? 'Review →' : 'View →'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {detailClaim && (
        <ClaimDetailModal claim={detailClaim} onApprove={handleApprove} onReject={handleReject} onMarkPaid={handleMarkPaid} onClose={() => setDetailClaim(null)} />
      )}
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
