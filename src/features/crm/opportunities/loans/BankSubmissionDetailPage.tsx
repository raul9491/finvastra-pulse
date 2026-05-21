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
const STATUS_STYLES: Record<BankSubmissionStatus, { bg: string; text: string }> = {
  preparing:  { bg: '#F1F5F9', text: '#475569' },
  submitted:  { bg: '#EFF6FF', text: '#1D4ED8' },
  in_review:  { bg: '#FFFBEB', text: '#92400E' },
  sanctioned: { bg: '#F0FDF4', text: '#166534' },
  disbursed:  { bg: '#DCFCE7', text: '#14532D' },
  rejected:   { bg: '#FFF1F2', text: '#9F1239' },
};

// ─── Document status pill styles ─────────────────────────────────────────────
const DOC_STATUS_STYLES: Record<DocumentStatus, { bg: string; text: string; label: string }> = {
  pending:   { bg: '#F1F5F9', text: '#475569', label: 'Pending'   },
  collected: { bg: '#FFFBEB', text: '#92400E', label: 'Collected' },
  submitted: { bg: '#EFF6FF', text: '#1D4ED8', label: 'Submitted' },
  accepted:  { bg: '#F0FDF4', text: '#166534', label: 'Accepted'  },
  rejected:  { bg: '#FFF1F2', text: '#9F1239', label: 'Rejected'  },
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
                  backgroundColor: done ? '#0B1538' : active ? '#C9A961' : '#E2E8F0',
                  color: done ? '#C9A961' : active ? '#0B1538' : '#94A3B8',
                }}>
                {done ? '✓' : i + 1}
              </div>
              <p className="text-[9px] font-medium mt-1 text-center"
                style={{ color: active ? '#0B1538' : done ? '#475569' : '#94A3B8' }}>
                {STATUS_LABELS[status]}
              </p>
            </div>
            {i < STATUS_ORDER.length - 1 && (
              <div className="w-6 h-0.5 mb-5"
                style={{ backgroundColor: done ? '#0B1538' : '#E2E8F0' }} />
            )}
          </div>
        );
      })}
      {isRejected && (
        <div className="ml-3 self-start mt-1 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold"
          style={{ backgroundColor: '#FFF1F2', color: '#9F1239' }}>
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
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
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

  const inputClass = "w-full px-3.5 py-2.5 text-sm bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 transition-colors";

  return (
    <div className="mt-5 space-y-4">
      {needsFields && nextStatus === 'sanctioned' && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Sanctioned ₹</label>
            <input type="number" value={sanctionedAmount} onChange={(e) => setSanctionedAmount(e.target.value)} placeholder="Required" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Interest %</label>
            <input type="number" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} placeholder="8.5" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Tenure (mo.)</label>
            <input type="number" value={tenureMonths} onChange={(e) => setTenureMonths(e.target.value)} placeholder="240" className={inputClass} />
          </div>
        </div>
      )}
      {needsFields && nextStatus === 'disbursed' && (
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Disbursed Amount ₹</label>
          <input type="number" value={disbursedAmount} onChange={(e) => setDisbursedAmount(e.target.value)} placeholder="Required" className={`${inputClass} max-w-xs`} />
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
              className="text-sm px-3.5 py-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 transition-colors w-52" />
            <button onClick={doReject} disabled={loading}
              className="px-4 py-2.5 rounded-lg text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 whitespace-nowrap">
              Reject
            </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
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
        <div className="h-5 bg-slate-200 rounded w-40" />
        <div className="h-8 bg-slate-200 rounded w-56" />
        <div className="h-40 bg-slate-100 rounded-2xl" />
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
        style={{ color: '#8B8B85' }}>
        <ArrowLeft size={15} /> {opportunity?.product ?? 'Opportunity'}
      </button>

      {/* Share tracker link */}
      {canAct && (
        <div className="flex items-center gap-3 flex-wrap">
          {!trackerToken ? (
            <button
              onClick={handleGenerateTrackerLink}
              disabled={generatingToken}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
              style={{ color: '#2A2A2A' }}>
              {generatingToken ? '…' : '🔗 Share tracker with customer'}
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <code
                className="text-xs px-3 py-1.5 rounded-lg font-mono"
                style={{ backgroundColor: '#F2EFE7', color: '#0B1538' }}>
                {window.location.origin}/track/{trackerToken}
              </code>
              <button
                onClick={handleCopyLink}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                style={{ color: copySuccess ? '#166534' : '#2A2A2A' }}>
                {copySuccess ? '✓ Copied!' : 'Copy'}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Hi ${lead?.displayName ?? ''}, track your loan application here: ${window.location.origin}/track/${trackerToken}`)}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                style={{ color: '#166534' }}>
                WhatsApp
              </a>
            </div>
          )}
        </div>
      )}

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-semibold" style={{ color: '#0A0A0A' }}>
                {provider?.name ?? sub.providerId.slice(0, 8)}
              </h2>
              {sub.isPrimary && (
                <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                  <Star size={10} className="fill-current" /> Primary
                </span>
              )}
            </div>
            <p className="text-sm" style={{ color: '#8B8B85' }}>
              {lead?.displayName ?? 'Customer'} · {opportunity?.product}
            </p>
          </div>
          <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full"
            style={{ backgroundColor: st.bg, color: st.text }}>
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
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: '#8B8B85' }}>{label}</p>
              <p className="text-sm font-medium" style={{ color: '#0A0A0A' }}>{value}</p>
            </div>
          ))}
        </div>

        {sub.notes && (
          <p className="text-sm italic border-t border-slate-100 pt-3 mt-3" style={{ color: '#8B8B85' }}>
            {sub.notes}
          </p>
        )}
        {sub.rejectionReason && (
          <p className="text-sm italic mt-2" style={{ color: '#9F1239' }}>
            Rejection reason: "{sub.rejectionReason}"
          </p>
        )}
      </div>

      {/* Status stepper + controls */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: '#8B8B85' }}>Status</h3>
        <StatusStepper current={sub.status} />
        <NextActionControls sub={sub} leadId={leadId!} oppId={oppId!} canAct={canAct} hasPrimary={hasPrimary} />
      </div>

      {/* Required Documents */}
      {resolvedDocuments.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Required Documents</h3>
            <span className="text-xs" style={{ color: '#8B8B85' }}>
              {Object.values(documentStatus).filter((s) => s === 'accepted').length} / {resolvedDocuments.length} accepted
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {resolvedDocuments.map((docId) => {
              const dtLabel = docTypes.find((d) => d.id === docId)?.label ?? docId;
              const status: DocumentStatus = documentStatus[docId] ?? 'pending';
              const st = DOC_STATUS_STYLES[status];
              const canAdvance = canAct && status !== 'accepted' && status !== 'rejected';
              return (
                <div key={docId} className="flex items-center justify-between py-3 gap-3">
                  <p className="text-sm flex-1" style={{ color: '#2A2A2A' }}>{dtLabel}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full"
                      style={{ backgroundColor: st.bg, color: st.text }}>
                      {st.label}
                    </span>
                    {canAdvance && (
                      <button
                        onClick={() => advanceDocumentStatus(leadId!, oppId!, subId!, docId, status, user!.uid)}
                        className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                        style={{ color: '#2A2A2A' }}>
                        Advance
                      </button>
                    )}
                    {canAct && status !== 'rejected' && (
                      <button
                        onClick={() => rejectDocument(leadId!, oppId!, subId!, docId, status, user!.uid)}
                        className="text-xs px-2.5 py-1 rounded-lg border border-red-100 hover:bg-red-50 transition-colors"
                        style={{ color: '#9F1239' }}>
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
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: '#8B8B85' }}>History</h3>
          <div className="divide-y divide-slate-100">
            {[...sub.statusHistory].reverse().map((entry, i) => (
              <div key={i} className="py-3 flex gap-3">
                <span className="text-base shrink-0">🔄</span>
                <div>
                  <p className="text-sm" style={{ color: '#2A2A2A' }}>
                    {STATUS_LABELS[entry.from]} → {STATUS_LABELS[entry.to]}
                    {entry.notes ? ` — ${entry.notes}` : ''}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>
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
