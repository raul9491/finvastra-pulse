/**
 * Case workspace → Payout tab + Disburse dialog (Phase 4).
 *
 * The disburse dialog shows a live slab preview before confirm. The Payout tab
 * renders the 10-step vertical timeline with milestone entry forms; money is
 * shown only with payout.amounts.read (the cycle is fetched via the money-aware
 * API which strips amounts otherwise).
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, X, AlertTriangle, IndianRupee } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { apiCrm2, hasCrm2Perm } from '../lib';
import { FLabel, inp } from '../masters/MastersPage';
import type { Crm2Case, PayoutCycle, PayoutCycleStatus } from '../../../types/crm2';
import { PAYOUT_STATUS_LABEL } from '../labels';

const inr = (n: number | null | undefined) => n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';
const fmtTs = (t: { toDate?: () => Date; _seconds?: number } | null | undefined) => {
  if (!t) return null;
  const ms = t.toDate ? t.toDate().getTime() : (t._seconds != null ? t._seconds * 1000 : null);
  return ms ? new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : null;
};

// Single source of truth for payout-status wording lives in ../labels.
export const CYCLE_STATUS_LABEL: Record<PayoutCycleStatus, string> = PAYOUT_STATUS_LABEL;

// The 10 steps (step 1 = disbursement, already done when a cycle exists).
const STEPS: Array<{ step: number; label: string; anchor: keyof PayoutCycle; fields: Array<{ key: string; label: string; type: 'text' | 'number' | 'date'; money?: boolean }> }> = [
  { step: 2, label: 'Data shared with aggregator', anchor: 'dataSharedAt', fields: [
    { key: 'dataSharedAt', label: 'Date shared', type: 'date' }, { key: 'dataSharedTo', label: 'Shared to', type: 'text' } ] },
  { step: 3, label: 'Confirmation raised to bank SM', anchor: 'confirmationRaisedAt', fields: [
    { key: 'confirmationRaisedAt', label: 'Date raised', type: 'date' }, { key: 'bankSmAddressed', label: 'Bank SM', type: 'text' }, { key: 'connectorCaseRef', label: 'Aggregator ref', type: 'text' } ] },
  { step: 4, label: 'Banker confirmation', anchor: 'bankerConfirmedAt', fields: [
    { key: 'bankerConfirmedAt', label: 'Date confirmed', type: 'date' }, { key: 'confirmedAmount', label: 'Confirmed amount', type: 'number', money: true }, { key: 'confirmedDsaCode', label: 'Confirmed DSA code', type: 'text' } ] },
  { step: 5, label: 'PDD/OTC clearance', anchor: 'pddOtcClearedMonth', fields: [
    { key: 'pddOtcClearedMonth', label: 'Cleared month (YYYY-MM)', type: 'text' } ] },
  { step: 6, label: 'Payout confirmed by aggregator', anchor: 'payoutConfirmedAt', fields: [
    { key: 'payoutConfirmedAt', label: 'Date confirmed', type: 'date' }, { key: 'confirmedPayoutPct', label: 'Confirmed payout %', type: 'number', money: true }, { key: 'confirmedGross', label: 'Confirmed gross', type: 'number', money: true } ] },
  { step: 7, label: 'Bill raised', anchor: 'billSentAt', fields: [
    { key: 'billNo', label: 'Bill no', type: 'text' }, { key: 'billDate', label: 'Bill date', type: 'date' }, { key: 'billGross', label: 'Bill gross', type: 'number', money: true }, { key: 'billGst', label: 'GST', type: 'number', money: true }, { key: 'billSentAt', label: 'Sent date', type: 'date' } ] },
  { step: 8, label: 'Payout received', anchor: 'receivedAt', fields: [
    { key: 'receivedAt', label: 'Date received', type: 'date' }, { key: 'receivedNet', label: 'Received net', type: 'number', money: true }, { key: 'tdsDeducted', label: 'TDS deducted', type: 'number', money: true }, { key: 'utr', label: 'UTR', type: 'text' } ] },
  { step: 9, label: 'Connector paid', anchor: 'subDsaPaidAt', fields: [
    { key: 'subDsaPaidAt', label: 'Date paid', type: 'date' }, { key: 'subDsaPaidAmount', label: 'Amount paid', type: 'number', money: true }, { key: 'subDsaTds', label: 'TDS', type: 'number', money: true }, { key: 'subDsaUtr', label: 'UTR', type: 'text' } ] },
  { step: 10, label: 'Closure', anchor: 'closedAt', fields: [
    { key: 'closedAt', label: 'Closed date', type: 'date' } ] },
];

// Legacy per-case wrapper (kept for any login-less case). Per-login cycles use
// <CycleMilestones> directly (e.g. from the MIS Payout board).
export function PayoutTab({ caseDoc }: { caseDoc: Crm2Case & { id: string } }) {
  if (!caseDoc.payoutCycleId) {
    return <div className="glass-panel p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
      No payout cycle yet — it is created automatically when the case/login is disbursed.
    </div>;
  }
  return <CycleMilestones cycleId={caseDoc.payoutCycleId} />;
}

/** The 9-step payout milestone timeline + forms for ONE cycle (per-login or legacy). */
export function CycleMilestones({ cycleId }: { cycleId: string }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [cycle, setCycle] = useState<(PayoutCycle & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [openStep, setOpenStep] = useState<number | null>(null);

  const canWrite = hasCrm2Perm(profile, 'payout.write');
  const canMoney = hasCrm2Perm(profile, 'payout.amounts.read');

  const load = async () => {
    try {
      const r = await apiCrm2<{ ok: boolean; cycle: PayoutCycle & { id: string } }>('GET', `/api/crm2/payout-cycles/${cycleId}`);
      setCycle(r.cycle);
    } catch { /* ignore */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [cycleId]);

  if (loading) return <div className="glass-panel p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading payout cycle…</div>;
  if (!cycle) return <div className="glass-panel p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Payout cycle not found.</div>;

  const anchorMs = (k: keyof PayoutCycle) => {
    const v = cycle[k] as { _seconds?: number; seconds?: number } | string | null;
    if (!v) return null;
    if (typeof v === 'string') return v; // month strings
    return (v._seconds ?? v.seconds) ?? null;
  };

  const submitStep = async (step: number, payload: Record<string, unknown>, override?: string) => {
    try {
      await apiCrm2('PATCH', `/api/crm2/payout-cycles/${cycle.id}/milestone`, { step, payload, ...(override ? { override: { reason: override } } : {}) });
      toast.success(`Step ${step} recorded`);
      setOpenStep(null);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed';
      if (/out of order|requires milestone/i.test(msg)) {
        const reason = prompt(`${msg}\n\nProceed out of order? Enter a reason (logged):`);
        if (reason) return submitStep(step, payload, reason);
      } else toast.error(msg);
    }
  };

  return (
    <div className="space-y-4">
      {/* Cycle header */}
      <div className="glass-panel p-4 flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm font-semibold" style={{ color: '#C9A961' }}>{cycle.id}</span>
        <span className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-full"
          style={{ backgroundColor: cycle.status === 'DISPUTED' ? 'rgba(248,113,113,0.15)' : 'rgba(201,169,97,0.12)', color: cycle.status === 'DISPUTED' ? '#f87171' : '#C9A961' }}>
          {CYCLE_STATUS_LABEL[cycle.status]}
        </span>
        {canMoney && <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Expected {inr(cycle.expectedGross)} @ {cycle.finvastraPayoutPct}%</span>}
        {cycle.bankerMismatch && <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: '#fbbf24' }}><AlertTriangle size={12} /> banker mismatch</span>}
        {cycle.pctVariance && <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: '#fbbf24' }}><AlertTriangle size={12} /> % variance</span>}
        {canMoney && cycle.amountVariance != null && cycle.amountVariance !== 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: '#f87171' }}><AlertTriangle size={12} /> Δ {inr(cycle.amountVariance)}</span>
        )}
        {canMoney && cycle.netMarginRealised != null && <span className="text-sm" style={{ color: '#34d399' }}>Margin {inr(cycle.netMarginRealised)}</span>}
      </div>

      {/* Vertical timeline */}
      <div className="glass-panel p-5">
        <div className="space-y-1">
          {STEPS.map((s) => {
            const done = anchorMs(s.anchor) != null || (s.step === 5 && cycle.holdFlag);
            const ts = fmtTs(cycle[s.anchor] as { toDate?: () => Date } | null);
            return (
              <div key={s.step}>
                <div className="flex items-center gap-3 py-2">
                  {done ? <CheckCircle2 size={18} style={{ color: '#34d399' }} className="shrink-0" />
                        : <Circle size={18} style={{ color: 'var(--shell-text-dim)' }} className="shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: done ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      <span className="font-mono text-[10px] mr-1.5" style={{ color: 'var(--text-muted)' }}>{s.step}</span>{s.label}
                    </p>
                    {ts && <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{typeof ts === 'string' ? ts : ts}</p>}
                  </div>
                  {canWrite && cycle.status !== 'CLOSED' && (
                    <button onClick={() => setOpenStep(openStep === s.step ? null : s.step)}
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg border"
                      style={{ borderColor: 'rgba(201,169,97,0.35)', color: '#C9A961' }}>
                      {done ? 'Edit' : 'Record'}
                    </button>
                  )}
                </div>
                {openStep === s.step && (
                  <StepForm step={s} canMoney={canMoney} onSubmit={(payload) => submitStep(s.step, payload)} onCancel={() => setOpenStep(null)} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StepForm({ step, canMoney, onSubmit, onCancel }: {
  step: typeof STEPS[number]; canMoney: boolean;
  onSubmit: (payload: Record<string, unknown>) => void; onCancel: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));
  const submit = () => {
    const payload: Record<string, unknown> = {};
    for (const f of step.fields) {
      if (f.money && !canMoney) continue;
      const v = vals[f.key];
      if (v === undefined || v === '') continue;
      payload[f.key] = f.type === 'number' ? Number(v) : v;
    }
    onSubmit(payload);
  };
  return (
    <div className="ml-7 mb-2 p-3 rounded-xl space-y-2" style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}>
      <div className="grid grid-cols-2 gap-2">
        {step.fields.map((f) => (f.money && !canMoney) ? null : (
          <div key={f.key}>
            <FLabel text={f.label} />
            <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} className={inp()}
              value={vals[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-semibold border" style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
        <button onClick={submit} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>Save Step {step.step}</button>
      </div>
    </div>
  );
}

// ─── Disburse dialog (shown on SANCTIONED cases) ─────────────────────────────
export function DisburseDialog({ caseDoc, onClose, onDone }: {
  caseDoc: Crm2Case & { id: string }; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const { profile } = useAuth();
  const canMoney = hasCrm2Perm(profile, 'payout.amounts.read');
  const [f, setF] = useState({ disbursedAmount: '', disbursementDate: '', loanAccountNo: '', city: '', state: '', roiPct: '', processingFee: '' });
  const [preview, setPreview] = useState<{ ok?: boolean; error?: string; connectorName?: string; lenderName?: string; productCode?: string; slab?: { finvastraPayoutPct: number; effectiveFromMs: number }; expected?: { expectedGross: number } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  // Live slab preview when amount + date are filled.
  useEffect(() => {
    if (!canMoney || !f.disbursementDate || !f.disbursedAmount) { setPreview(null); return; }
    let cancel = false;
    (async () => {
      try {
        const r = await apiCrm2<typeof preview>('GET', `/api/crm2/cases/${caseDoc.id}/disburse-preview?amount=${Number(f.disbursedAmount)}&date=${f.disbursementDate}`);
        if (!cancel) setPreview(r);
      } catch (e) { if (!cancel) setPreview({ error: e instanceof Error ? e.message : 'No slab' }); }
    })();
    return () => { cancel = true; };
  }, [f.disbursedAmount, f.disbursementDate, caseDoc.id, canMoney]);

  const submit = async () => {
    setBusy(true); setServerError('');
    try {
      const r = await apiCrm2<{ ok: boolean; cycleId: string; expectedGross: number }>('POST', `/api/crm2/cases/${caseDoc.id}/disburse`, {
        disbursedAmount: Number(f.disbursedAmount), disbursementDate: f.disbursementDate,
        loanAccountNo: f.loanAccountNo, city: f.city, state: f.state,
        roiPct: f.roiPct ? Number(f.roiPct) : null, processingFee: f.processingFee ? Number(f.processingFee) : null,
      });
      toast.success(`Disbursed → ${r.cycleId} (expected ₹${r.expectedGross.toLocaleString('en-IN')})`);
      onClose(); onDone();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Disbursement failed');
    } finally { setBusy(false); }
  };

  const fmtFrom = (ms?: number) => ms ? new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-md rounded-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <h3 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <IndianRupee size={16} style={{ color: '#C9A961' }} /> Record Disbursement
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close"><X size={17} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <div className="p-5 space-y-4">
          {serverError && <div className="px-3.5 py-2.5 rounded-lg text-sm" style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#f87171' }}>{serverError}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><FLabel text="Disbursed Amount ₹" required /><input type="number" className={inp()} value={f.disbursedAmount} onChange={(e) => set('disbursedAmount', e.target.value)} /></div>
            <div><FLabel text="Disbursement Date" required /><input type="date" className={inp()} value={f.disbursementDate} onChange={(e) => set('disbursementDate', e.target.value)} /></div>
            <div className="col-span-2"><FLabel text="Loan Account No" required /><input className={inp()} value={f.loanAccountNo} onChange={(e) => set('loanAccountNo', e.target.value)} /></div>
            <div><FLabel text="City" required /><input className={inp()} value={f.city} onChange={(e) => set('city', e.target.value)} /></div>
            <div><FLabel text="State" required /><input className={inp()} value={f.state} onChange={(e) => set('state', e.target.value)} /></div>
            <div><FLabel text="ROI %" /><input type="number" className={inp()} value={f.roiPct} onChange={(e) => set('roiPct', e.target.value)} /></div>
            <div><FLabel text="Processing Fee" /><input type="number" className={inp()} value={f.processingFee} onChange={(e) => set('processingFee', e.target.value)} /></div>
          </div>

          {/* Slab preview */}
          {canMoney && preview && (
            preview.error ? (
              <div className="px-3.5 py-2.5 rounded-lg text-sm" style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#f87171' }}>{preview.error}</div>
            ) : preview.slab ? (
              <div className="px-3.5 py-2.5 rounded-lg text-sm" style={{ backgroundColor: 'rgba(201,169,97,0.08)', border: '1px solid rgba(201,169,97,0.3)', color: 'var(--text-primary)' }}>
                Slab: <strong>{preview.connectorName} × {preview.lenderName} × {preview.productCode}</strong> — {preview.slab.finvastraPayoutPct}% w.e.f. {fmtFrom(preview.slab.effectiveFromMs)}
                {preview.expected && <> → expected <strong style={{ color: '#C9A961' }}>₹{preview.expected.expectedGross.toLocaleString('en-IN')}</strong></>}
              </div>
            ) : null
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={submit} disabled={busy || !f.disbursedAmount || !f.disbursementDate || !f.loanAccountNo || !f.city || !f.state}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {busy ? 'Recording…' : 'Confirm Disbursement'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
