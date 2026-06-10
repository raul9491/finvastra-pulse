import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Star, ChevronRight, X } from 'lucide-react';
import { useAuth } from '../../../auth/AuthContext';
import { auth } from '../../../../lib/firebase';
import { useLead } from '../../hooks/useLeads';
import { useOpportunity, useOpportunityTypes, useProviders } from '../../hooks/useOpportunities';
import { useBankSubmissions, updateSubmissionStatus, setPrimarySubmission } from '../../hooks/useBankSubmissions';
import { useDocumentTypes, useDocumentChecklist, advanceDocumentStatus, rejectDocument } from '../../hooks/useDocumentChecklist';
import type { BankSubmission, BankSubmissionStatus, DocumentStatus } from '../../../../types';

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_ORDER: BankSubmissionStatus[] = [
  'preparing', 'submitted', 'in_review', 'sanctioned', 'disbursed',
];
const STATUS_LABELS: Record<BankSubmissionStatus, string> = {
  preparing:  'Preparing',
  submitted:  'Submitted',
  in_review:  'In Review',
  sanctioned: 'Sanctioned',
  disbursed:  'Disbursed',
  rejected:   'Rejected',
};
const STATUS_STYLES: Record<BankSubmissionStatus, { bg: string; text: string; badgeClass: string }> = {
  preparing:  { bg: 'var(--shell-hover-hard)', text: 'var(--text-muted)',  badgeClass: 'badge-glass-muted'   },
  submitted:  { bg: 'rgba(96,165,250,0.12)',  text: '#60a5fa',            badgeClass: 'badge-glass-info'    },
  in_review:  { bg: 'rgba(201,169,97,0.12)', text: '#C9A961',             badgeClass: 'badge-glass-warning' },
  sanctioned: { bg: 'rgba(52,211,153,0.12)', text: '#34d399',             badgeClass: 'badge-glass-success' },
  disbursed:  { bg: 'rgba(52,211,153,0.18)', text: '#34d399',             badgeClass: 'badge-glass-success' },
  rejected:   { bg: 'rgba(248,113,113,0.12)', text: '#f87171',            badgeClass: 'badge-glass-danger'  },
};

// ─── Document status pill styles ─────────────────────────────────────────────
const DOC_STATUS_STYLES: Record<DocumentStatus, { badgeClass: string; label: string }> = {
  pending:   { badgeClass: 'badge-glass-muted',   label: 'Pending'   },
  collected: { badgeClass: 'badge-glass-warning', label: 'Collected' },
  submitted: { badgeClass: 'badge-glass-info',    label: 'Submitted' },
  accepted:  { badgeClass: 'badge-glass-success', label: 'Accepted'  },
  rejected:  { badgeClass: 'badge-glass-danger',  label: 'Rejected'  },
};

// ─── Status Stepper ───────────────────────────────────────────────────────────
function StatusStepper({ current }: { current: BankSubmissionStatus }) {
  const isRejected = current === 'rejected';
  const currentIdx = STATUS_ORDER.indexOf(current);

  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-1">
      {STATUS_ORDER.map((status, i) => {
        const done   = !isRejected && i < currentIdx;
        const active = !isRejected && i === currentIdx;
        return (
          <div key={status} className="flex items-center">
            <div className="flex flex-col items-center min-w-[72px]">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  backgroundColor: done ? '#0B1538' : active ? '#C9A961' : 'var(--shell-hover-hard)',
                  color: done ? '#C9A961' : active ? '#0B1538' : 'var(--text-dim)',
                }}>
                {done ? '✓' : i + 1}
              </div>
              <p className="text-[9px] font-medium mt-1 text-center"
                style={{ color: active ? '#C9A961' : done ? 'var(--text-muted)' : 'var(--text-dim)' }}>
                {STATUS_LABELS[status]}
              </p>
            </div>
            {i < STATUS_ORDER.length - 1 && (
              <div className="w-6 h-0.5 mb-5"
                style={{ backgroundColor: done ? '#0B1538' : 'var(--shell-hover-hard)' }} />
            )}
          </div>
        );
      })}
      {isRejected && (
        <div className="ml-3 self-start mt-1 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold badge-glass-danger">
          <X size={10} /> Rejected
        </div>
      )}
    </div>
  );
}

// ─── Next action controls ─────────────────────────────────────────────────────
function NextActionControls({
  sub, leadId, oppId, canAct, hasPrimary,
}: {
  sub: BankSubmission; leadId: string; oppId: string; canAct: boolean; hasPrimary: boolean;
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');

  // Extra fields for sanctioned/disbursed transitions
  const [sanctionedAmount, setSanctionedAmount] = useState('');
  const [disbursedAmount,  setDisbursedAmount]  = useState('');
  const [interestRate,     setInterestRate]     = useState('');
  const [tenureMonths,     setTenureMonths]     = useState('');
  const [rejectionReason,  setRejectionReason]  = useState('');

  if (!canAct || sub.status === 'disbursed' || sub.status === 'rejected') {
    if (sub.status === 'disbursed' && !sub.isPrimary && !hasPrimary && canAct) {
      return (
        <div className="mt-5">
          <button
            onClick={async () => {
              if (!window.confirm('Mark this disbursement as primary? This will close the opportunity as Won.')) return;
              setLoading(true); setError('');
              try { await setPrimarySubmission(leadId, oppId, sub.id, user!.uid); }
              catch (e) { setError(e instanceof Error ? e.message : 'Failed.'); }
              finally { setLoading(false); }
            }}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
          >
            <Star size={14} /> {loading ? '…' : 'Mark as Primary Disbursement'}
          </button>
          {error && <p className="mt-2 text-sm" style={{ color: '#f87171' }}>{error}</p>}
        </div>
      );
    }
    return null;
  }

  const currentIdx  = STATUS_ORDER.indexOf(sub.status);
  const hasNext     = currentIdx >= 0 && currentIdx < STATUS_ORDER.length - 1;
  const nextStatus  = hasNext ? STATUS_ORDER[currentIdx + 1] : null;
  const needsFields = nextStatus === 'sanctioned' || nextStatus === 'disbursed';

  const doAdvance = async () => {
    if (!nextStatus || !user) return;
    setLoading(true); setError('');
    try {
      await updateSubmissionStatus(leadId, oppId, sub.id, sub.status, nextStatus, user.uid, {
        ...(nextStatus === 'sanctioned' && sanctionedAmount ? { sanctionedAmount: Number(sanctionedAmount) } : {}),
        ...(nextStatus === 'sanctioned' && interestRate     ? { interestRate:     Number(interestRate)     } : {}),
        ...(nextStatus === 'sanctioned' && tenureMonths     ? { tenureMonths:     Number(tenureMonths)     } : {}),
        ...(nextStatus === 'disbursed'  && disbursedAmount  ? { disbursedAmount:  Number(disbursedAmount)  } : {}),
      });
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed.'); }
    finally { setLoading(false); }
  };

  const doReject = async () => {
    if (!user || !window.confirm('Mark this submission as Rejected?')) return;
    setLoading(true); setError('');
    try {
      await updateSubmissionStatus(leadId, oppId, sub.id, sub.status, 'rejected', user.uid, {
        ...(rejectionReason ? { rejectionReason } : {}),
      });
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="mt-5 space-y-4">
      {needsFields && nextStatus === 'sanctioned' && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Sanctioned ₹</label>
            <input type="number" value={sanctionedAmount} onChange={(e) => setSanctionedAmount(e.target.value)} placeholder="Required" className="glass-inp w-full text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Interest %</label>
            <input type="number" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} placeholder="8.5" className="glass-inp w-full text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Tenure (mo.)</label>
            <input type="number" value={tenureMonths} onChange={(e) => setTenureMonths(e.target.value)} placeholder="240" className="glass-inp w-full text-sm" />
          </div>
        </div>
      )}
      {needsFields && nextStatus === 'disbursed' && (
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Disbursed Amount ₹</label>
          <input type="number" value={disbursedAmount} onChange={(e) => setDisbursedAmount(e.target.value)} placeholder="Required" className="glass-inp text-sm max-w-xs" />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {hasNext && nextStatus && (
          <button onClick={doAdvance} disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            <ChevronRight size={14} /> {loading ? '…' : `Move to ${STATUS_LABELS[nextStatus]}`}
          </button>
        )}

        {/* sub.status cannot be 'disbursed' here — the early return above already handled that case */}
        <div className="flex items-end gap-2">
            <input type="text" value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Rejection reason (optional)"
              className="glass-inp text-sm w-52" />
            <button onClick={doReject} disabled={loading}
              className="px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap btn-glass-danger">
              Reject
            </button>
        </div>
      </div>

      {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function BankSubmissionDetailPage() {
  const { leadId, oppId, subId } = useParams<{ leadId: string; oppId: string; subId: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { lead } = useLead(leadId ?? null);
  const { opportunity } = useOpportunity(leadId ?? null, oppId ?? null);
  const { submissions, loading } = useBankSubmissions(leadId ?? null, oppId ?? null);
  const providers = useProviders();

  const { types } = useOpportunityTypes();
  const docTypes = useDocumentTypes();
  const typeConfig = types.find((t) => t.name === opportunity?.product);
  const { resolvedDocuments, documentStatus } = useDocumentChecklist(
    leadId ?? null,
    oppId ?? null,
    subId ?? null,
    typeConfig?.requiredDocuments ?? [],
    typeConfig?.conditionalDocuments ?? [],
    opportunity?.customFields,
  );

  const isAdmin = profile?.role === 'admin';
  const canAct  = isAdmin || user?.uid === opportunity?.ownerId;

  const [trackerToken,    setTrackerToken]    = useState<string | null>(null);
  const [copySuccess,     setCopySuccess]     = useState(false);
  const [generatingToken, setGeneratingToken] = useState(false);

  const handleGenerateTrackerLink = async () => {
    setGeneratingToken(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch(
        `/api/leads/${leadId}/opportunities/${oppId}/submissions/${subId}/tracker-token`,
        { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } },
      );
      const data = await res.json() as { token?: string };
      if (res.ok && data.token) setTrackerToken(data.token);
    } finally {
      setGeneratingToken(false);
    }
  };

  const handleCopyLink = async () => {
    if (!trackerToken) return;
    await navigator.clipboard.writeText(`${window.location.origin}/track/${trackerToken}`);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const sub = useMemo(
    () => submissions.find((s) => s.id === subId) ?? null,
    [submissions, subId],
  );
  const provider = useMemo(
    () => providers.find((p) => p.id === sub?.providerId),
    [providers, sub],
  );
  const hasPrimary = submissions.some((s) => s.id !== subId && s.isPrimary);

  const fmtDate = (ts: unknown) => {
    if (!ts) return null;
    if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
      return format((ts as { toDate: () => Date }).toDate(), 'dd MMM yyyy');
    }
    return null;
  };

  if (loading || !sub) {
    return (
      <div className="max-w-3xl mx-auto animate-pulse space-y-4">
        <div className="h-5 rounded w-40" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
        <div className="h-8 rounded w-56" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
        <div className="h-40 rounded-2xl" style={{ backgroundColor: 'var(--glass-panel-bg)' }} />
      </div>
    );
  }

  const st = STATUS_STYLES[sub.status];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <button
        onClick={() => navigate(`/crm/leads/${leadId}/opportunities/${oppId}`)}
        className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={15} /> {opportunity?.product ?? 'Opportunity'}
      </button>

      {/* Share tracker link */}
      {canAct && (
        <div className="flex items-center gap-3 flex-wrap">
          {!trackerToken ? (
            <button
              onClick={handleGenerateTrackerLink}
              disabled={generatingToken}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border transition-colors disabled:opacity-50"
              style={{ color: 'var(--text-primary)', borderColor: 'var(--shell-border-mid)', backgroundColor: 'var(--shell-hover-soft)' }}>
              {generatingToken ? '…' : '🔗 Share tracker with customer'}
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <code
                className="text-xs px-3 py-1.5 rounded-lg font-mono"
                style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961' }}>
                {window.location.origin}/track/{trackerToken}
              </code>
              <button
                onClick={handleCopyLink}
                className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                style={{
                  color: copySuccess ? '#34d399' : 'var(--text-primary)',
                  borderColor: 'var(--shell-border-mid)',
                  backgroundColor: 'var(--shell-hover-soft)',
                }}>
                {copySuccess ? '✓ Copied!' : 'Copy'}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Hi ${lead?.displayName ?? ''}, track your loan application here: ${window.location.origin}/track/${trackerToken}`)}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                style={{ color: '#34d399', borderColor: 'rgba(52,211,153,0.25)', backgroundColor: 'rgba(52,211,153,0.06)' }}>
                WhatsApp
              </a>
            </div>
          )}
        </div>
      )}

      {/* Header card */}
      <div className="glass-panel p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {provider?.name ?? sub.providerId.slice(0, 8)}
              </h2>
              {sub.isPrimary && (
                <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full badge-glass-warning">
                  <Star size={10} className="fill-current" /> Primary
                </span>
              )}
            </div>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {lead?.displayName ?? 'Customer'} · {opportunity?.product}
            </p>
          </div>
          <span className={st.badgeClass}>
            {STATUS_LABELS[sub.status]}
          </span>
        </div>

        {/* Key figures */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          {[
            { label: 'Requested',  value: sub.requestedAmount  ? `₹${sub.requestedAmount.toLocaleString('en-IN')}`  : null },
            { label: 'Sanctioned', value: sub.sanctionedAmount ? `₹${sub.sanctionedAmount.toLocaleString('en-IN')}` : null },
            { label: 'Disbursed',  value: sub.disbursedAmount  ? `₹${sub.disbursedAmount.toLocaleString('en-IN')}`  : null },
            { label: 'Rate',       value: sub.interestRate     ? `${sub.interestRate}%`                             : null },
            { label: 'Tenure',     value: sub.tenureMonths     ? `${sub.tenureMonths} mo.`                         : null },
            { label: 'Submitted',  value: fmtDate(sub.submittedAt) },
            { label: 'Decision',   value: fmtDate(sub.decisionAt) },
            { label: 'Disbursed',  value: fmtDate(sub.disbursedAt) },
          ].filter((f) => f.value !== null).map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{value}</p>
            </div>
          ))}
        </div>

        {sub.notes && (
          <p className="text-sm italic pt-3 mt-3" style={{ borderTop: '1px solid var(--shell-border)', color: 'var(--text-muted)' }}>
            {sub.notes}
          </p>
        )}
        {sub.rejectionReason && (
          <p className="text-sm italic mt-2" style={{ color: '#f87171' }}>
            Rejection reason: "{sub.rejectionReason}"
          </p>
        )}
      </div>

      {/* Status stepper + controls */}
      <div className="glass-panel p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>Status</h3>
        <StatusStepper current={sub.status} />
        <NextActionControls sub={sub} leadId={leadId!} oppId={oppId!} canAct={canAct} hasPrimary={hasPrimary} />
      </div>

      {/* Required Documents */}
      {resolvedDocuments.length > 0 && (
        <div className="glass-panel p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Required Documents</h3>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {Object.values(documentStatus).filter((s) => s === 'accepted').length} / {resolvedDocuments.length} accepted
            </span>
          </div>
          <div>
            {resolvedDocuments.map((docId) => {
              const dtLabel = docTypes.find((d) => d.id === docId)?.label ?? docId;
              const status: DocumentStatus = documentStatus[docId] ?? 'pending';
              const dst = DOC_STATUS_STYLES[status];
              const canAdvance = canAct && status !== 'accepted' && status !== 'rejected';
              return (
                <div key={docId} className="flex items-center justify-between py-3 gap-3"
                  style={{ borderBottom: '1px solid var(--shell-border)' }}>
                  <p className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{dtLabel}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={dst.badgeClass}>{dst.label}</span>
                    {canAdvance && (
                      <button
                        onClick={() => advanceDocumentStatus(leadId!, oppId!, subId!, docId, status, user!.uid)}
                        className="text-xs px-2.5 py-1 rounded-lg border transition-colors hover:bg-(--shell-hover-soft)"
                        style={{ color: 'var(--text-primary)', borderColor: 'var(--shell-border-mid)' }}>
                        Advance
                      </button>
                    )}
                    {canAct && status !== 'rejected' && (
                      <button
                        onClick={() => rejectDocument(leadId!, oppId!, subId!, docId, status, user!.uid)}
                        className="text-xs px-2.5 py-1 rounded-lg border transition-colors hover:bg-(--shell-hover-soft)"
                        style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.25)' }}>
                        Reject
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Status history */}
      {sub.statusHistory.length > 0 && (
        <div className="glass-panel p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>History</h3>
          <div>
            {[...sub.statusHistory].reverse().map((entry, i) => (
              <div key={i} className="py-3 flex gap-3"
                style={{ borderBottom: '1px solid var(--shell-border)' }}>
                <span className="text-base shrink-0">🔄</span>
                <div>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    {STATUS_LABELS[entry.from]} → {STATUS_LABELS[entry.to]}
                    {entry.notes ? ` — ${entry.notes}` : ''}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {format(new Date(entry.at), 'dd MMM yyyy, HH:mm')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
