/**
 * LoginsSection — the per-login pipeline on the case workspace (Phase 4a).
 * Lists a case's logins (cases/{id}/logins) with a derived roll-up header, an
 * Add-Login action, per-login stage steppers + edit forms + advance/early-close.
 * The disbursement stage is reserved for the money engine (Build #2).
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Plus, X, ArrowRight, Pencil } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { apiCrm2, useCrm2Collection, hasCrm2Perm } from '../lib';
import { FLabel, inp } from '../masters/MastersPage';
import { rollUpCaseStatus } from '../../../lib/crm2/logins';
import { LOGIN_STAGE_ORDER, type Login, type LoginStage, type Lender } from '../../../types/crm2';

type LoginRow = Login & { id: string };

const STAGE_LABEL: Record<LoginStage, string> = {
  FILE_LOGIN: 'File Login', CODE_LOGIN_DONE: 'Code + Login', IN_PROCESS: 'In Process',
  SANCTIONED: 'Sanctioned', DISBURSED: 'Disbursed', PDD_OTC: 'PDD / OTC', COMPLETED: 'Completed',
};
const DECISION_OPTS = [{ value: '', label: '—' }, { value: 'ACCEPTED', label: 'Accepted' }, { value: 'PENDING', label: 'Pending' }, { value: 'REJECTED', label: 'Rejected' }];
const PDD_OPTS = ['NA', 'PENDING', 'PARTIAL', 'CLEARED'].map((v) => ({ value: v, label: v }));
const OTC_OPTS = ['NA', 'PENDING', 'CLEARED'].map((v) => ({ value: v, label: v }));
const fmtMoney = (n: number | null | undefined) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);

// Stage 6 — In-Process parallel sub-processes (PLAN §4 stage 6).
const SUB_PROCS: Array<{ key: 'pd' | 'technical' | 'valuation' | 'legal' | 'credit'; label: string }> = [
  { key: 'pd', label: 'Personal Discussion (PD)' },
  { key: 'technical', label: 'Technical' },
  { key: 'valuation', label: 'Valuation' },
  { key: 'legal', label: 'Legal' },
  { key: 'credit', label: 'Credit' },
];
const SP_STATUS_OPTS = ['NA', 'PENDING', 'IN_PROGRESS', 'DONE'].map((v) => ({ value: v, label: v.replace('_', ' ') }));
const BT_MODE_OPTS = [{ value: '', label: '—' }, { value: 'cheque', label: 'Cheque' }, { value: 'e_transfer', label: 'E-transfer (NEFT/RTGS)' }];
const BT_KIND_OPTS = [{ value: '', label: '—' }, { value: 'TOPUP', label: 'Top-up' }, { value: 'FINAL', label: 'Final' }];
const SEC_MODE_OPTS = [{ value: '', label: '—' }, { value: 'physical', label: 'Physical' }, { value: 'digital', label: 'Digital / e-stamp' }];

// Stored login dates may be Firestore Timestamps (sanctionDate via optTs) or ISO
// strings (bt/secured — server passes them through raw). Normalise to yyyy-mm-dd.
function toDateInput(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
    try { return (v as { toDate: () => Date }).toDate().toISOString().slice(0, 10); } catch { return ''; }
  }
  return '';
}
const numOrNull = (s: string) => (s.trim() ? Number(s) : null);
const isoOrNull = (s: string) => (s ? new Date(s).toISOString() : null);

export function LoginsSection({ caseId, canWrite }: { caseId: string; canWrite: boolean }) {
  const toast = useToast();
  const { profile } = useAuth();
  const canDisburse = hasCrm2Perm(profile, 'payout.write');
  const { rows: lenders } = useCrm2Collection<Lender & { id: string }>('lenders');
  const [logins, setLogins] = useState<LoginRow[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<LoginRow | null>(null);
  const [disbursing, setDisbursing] = useState<LoginRow | null>(null);

  useEffect(() => {
    const qy = query(collection(db, 'cases', caseId, 'logins'), orderBy('seq', 'asc'));
    return onSnapshot(qy, (snap) => setLogins(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LoginRow)));
  }, [caseId]);

  const lenderName = (id: string | null) => (id ? (lenders.find((l) => l.id === id)?.name ?? id) : '—');
  const roll = useMemo(() => rollUpCaseStatus(logins.map((l) => ({ stage: l.stage, outcome: l.outcome }))), [logins]);

  const advance = async (l: LoginRow, to: LoginStage, outcome?: string) => {
    try {
      await apiCrm2('POST', `/api/crm2/cases/${caseId}/logins/${l.id}/stage`, { to, ...(outcome ? { outcome } : {}) });
      toast.success(`${l.id}: ${STAGE_LABEL[to]}${outcome ? ` (${outcome})` : ''}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <div className="space-y-4">
      {/* Roll-up header */}
      <div className="glass-panel p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Case roll-up</p>
          <p className="text-lg font-semibold" style={{ color: roll.allDone ? '#34d399' : '#C9A961' }}>{roll.label}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {roll.total} login{roll.total === 1 ? '' : 's'} · {roll.successful} successful · {roll.rejected} closed · {roll.active} active
          </p>
        </div>
        {canWrite && (
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            <Plus size={15} /> Add Login
          </button>
        )}
      </div>

      {logins.length === 0 ? (
        <div className="glass-panel p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No logins yet. A login = one file submitted to one bank/NBFC. {canWrite && 'Add the first one to begin the per-login pipeline.'}
        </div>
      ) : logins.map((l) => {
        const idx = LOGIN_STAGE_ORDER.indexOf(l.stage);
        const next = idx >= 0 && idx < LOGIN_STAGE_ORDER.length - 1 ? LOGIN_STAGE_ORDER[idx + 1] : null;
        const terminal = l.stage === 'COMPLETED';
        return (
          <div key={l.id} className="glass-panel p-4 space-y-3">
            {/* Card header */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-secondary)' }}>#{l.seq}</span>
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{lenderName(l.lenderId)}</span>
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{l.id}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: terminal ? (l.outcome === 'REJECTED' || l.outcome === 'WITHDRAWN' ? 'rgba(248,113,113,0.15)' : 'rgba(52,211,153,0.15)') : 'rgba(201,169,97,0.15)', color: terminal ? (l.outcome === 'REJECTED' || l.outcome === 'WITHDRAWN' ? '#f87171' : '#34d399') : '#C9A961' }}>
                  {STAGE_LABEL[l.stage]}{terminal && l.outcome && l.outcome !== 'COMPLETED' ? ` · ${l.outcome}` : ''}
                </span>
              </div>
              {canWrite && !terminal && (
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditing(l)} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border" style={{ borderColor: 'var(--shell-border)', color: 'var(--text-primary)' }}>
                    <Pencil size={12} /> Edit
                  </button>
                  {next === 'DISBURSED' ? (
                    canDisburse ? (
                      <button onClick={() => setDisbursing(l)} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                        Record Disbursement
                      </button>
                    ) : (
                      <span className="text-[11px] px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--shell-hover-soft)', color: 'var(--text-muted)' }}>
                        Disbursement needs payout.write
                      </span>
                    )
                  ) : next ? (
                    <button onClick={() => advance(l, next)} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                      Advance → {STAGE_LABEL[next]} <ArrowRight size={12} />
                    </button>
                  ) : null}
                  {l.stage !== 'COMPLETED' && (
                    <button onClick={() => { if (confirm('Close this login as rejected/withdrawn?')) advance(l, 'COMPLETED', 'REJECTED'); }}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border" style={{ borderColor: 'rgba(248,113,113,0.4)', color: '#f87171' }}>
                      Reject
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Stage stepper */}
            <div className="flex items-center gap-1 flex-wrap">
              {LOGIN_STAGE_ORDER.map((s, i) => {
                const done = i < idx, cur = i === idx;
                return (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: cur ? 'rgba(201,169,97,0.2)' : 'transparent', color: cur ? '#C9A961' : done ? '#34d399' : 'var(--text-muted)', fontWeight: cur ? 700 : 400 }}>
                    {STAGE_LABEL[s]}{i < LOGIN_STAGE_ORDER.length - 1 ? ' ›' : ''}
                  </span>
                );
              })}
            </div>

            {/* Key fields */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <KV label="Branch" v={l.branch} />
              <KV label="SM" v={l.smName ? `${l.smName}${l.smNumber ? ` · ${l.smNumber}` : ''}` : null} />
              <KV label="App No" v={l.loanApplicationNo} />
              <KV label="Requested" v={fmtMoney(l.amountRequested)} />
              {idx >= LOGIN_STAGE_ORDER.indexOf('SANCTIONED') && (
                <>
                  <KV label="Sanctioned" v={fmtMoney(l.amountSanctioned)} />
                  <KV label="ROI" v={l.roiPct != null ? `${l.roiPct}%` : null} />
                  <KV label="Tenure" v={l.tenureMonths != null ? `${l.tenureMonths} mo` : null} />
                  <KV label="Customer" v={l.customerDecision} />
                </>
              )}
            </div>

            {/* In-Process sub-process summary (stage 6 onward) */}
            {idx >= LOGIN_STAGE_ORDER.indexOf('IN_PROCESS') && l.subProcesses && (
              <div className="flex flex-wrap gap-1.5">
                {SUB_PROCS.map(({ key, label }) => {
                  const s = l.subProcesses?.[key]?.status ?? 'NA';
                  if (s === 'NA') return null;
                  const c = s === 'DONE' ? '#34d399' : s === 'IN_PROGRESS' ? '#C9A961' : 'var(--text-muted)';
                  return (
                    <span key={key} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--shell-hover-soft)', color: c }}>
                      {label.replace(/ \(.*\)/, '')}: {s.replace('_', ' ')}
                    </span>
                  );
                })}
                {(l.bt?.isBt) && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>BT</span>}
                {(l.secured?.isSecured) && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>Secured</span>}
              </div>
            )}
          </div>
        );
      })}

      {showAdd && <AddLoginModal caseId={caseId} lenders={lenders} onClose={() => setShowAdd(false)} />}
      {editing && <EditLoginModal caseId={caseId} login={editing} lenders={lenders} onClose={() => setEditing(null)} />}
      {disbursing && <DisburseLoginDialog caseId={caseId} login={disbursing} onClose={() => setDisbursing(null)} />}
    </div>
  );
}

// ─── Record a per-login disbursement → creates the payout cycle + MIS record ───
function DisburseLoginDialog({ caseId, login, onClose }: { caseId: string; login: LoginRow; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    disbursedAmount: login.amountSanctioned?.toString() ?? '', disbursementDate: '',
    loanAccountNo: '', city: '', state: '', roiPct: login.roiPct?.toString() ?? '', processingFee: login.processingFee?.toString() ?? '',
    subDsaPayoutPct: '',
  });
  const [preview, setPreview] = useState<{ slab?: { finvastraPayoutPct: number }; expected?: { expectedGross: number } | null; dsaCode?: string } | null>(null);
  const [previewErr, setPreviewErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  // Live slab preview (best-effort — needs payout.amounts.read).
  useEffect(() => {
    const amt = Number(f.disbursedAmount); if (!amt || !f.disbursementDate) { setPreview(null); setPreviewErr(''); return; }
    let cancel = false;
    apiCrm2<{ ok: boolean; slab: { finvastraPayoutPct: number }; expected: { expectedGross: number } | null; dsaCode: string }>(
      'GET', `/api/crm2/cases/${caseId}/logins/${login.id}/disburse-preview?amount=${amt}&date=${new Date(f.disbursementDate).toISOString()}`)
      .then((r) => { if (!cancel) { setPreview(r); setPreviewErr(''); } })
      .catch((e) => { if (!cancel) { setPreview(null); setPreviewErr(e instanceof Error ? e.message : ''); } });
    return () => { cancel = true; };
  }, [caseId, login.id, f.disbursedAmount, f.disbursementDate]);

  const save = async () => {
    if (!f.disbursedAmount || !f.disbursementDate || !f.loanAccountNo || !f.city || !f.state) { setErr('Amount, date, loan a/c, city and state are required'); return; }
    setBusy(true); setErr('');
    try {
      const r = await apiCrm2<{ ok: boolean; cycleId: string }>('POST', `/api/crm2/cases/${caseId}/logins/${login.id}/disburse`, {
        disbursedAmount: Number(f.disbursedAmount), disbursementDate: new Date(f.disbursementDate).toISOString(),
        loanAccountNo: f.loanAccountNo, city: f.city, state: f.state,
        roiPct: f.roiPct ? Number(f.roiPct) : null, processingFee: f.processingFee ? Number(f.processingFee) : null,
        subDsaPayoutPct: f.subDsaPayoutPct ? Number(f.subDsaPayoutPct) : null,
      });
      toast.success(`Disbursed → payout cycle ${r.cycleId} created (manage in MIS)`); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Disburse failed'); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Record Disbursement · ${login.id}`} onClose={onClose}>
      {err && <p className="text-sm" style={{ color: '#f87171' }}>{err}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div><FLabel text="Disbursed ₹" required /><input type="number" className={inp()} value={f.disbursedAmount} onChange={(e) => set('disbursedAmount', e.target.value)} /></div>
        <div><FLabel text="Disbursement Date" required /><input type="date" className={inp()} value={f.disbursementDate} onChange={(e) => set('disbursementDate', e.target.value)} /></div>
        <div className="col-span-2"><FLabel text="Loan Account No" required /><input className={inp()} value={f.loanAccountNo} onChange={(e) => set('loanAccountNo', e.target.value)} /></div>
        <div><FLabel text="City" required /><input className={inp()} value={f.city} onChange={(e) => set('city', e.target.value)} /></div>
        <div><FLabel text="State" required /><input className={inp()} value={f.state} onChange={(e) => set('state', e.target.value)} /></div>
        <div><FLabel text="ROI %" /><input type="number" className={inp()} value={f.roiPct} onChange={(e) => set('roiPct', e.target.value)} /></div>
        <div><FLabel text="Processing Fee ₹" /><input type="number" className={inp()} value={f.processingFee} onChange={(e) => set('processingFee', e.target.value)} /></div>
        <div className="col-span-2"><FLabel text="Sub-DSA payout % override (optional)" /><input type="number" className={inp()} value={f.subDsaPayoutPct} onChange={(e) => set('subDsaPayoutPct', e.target.value)} placeholder="defaults to the Connector's slab %" /></div>
      </div>
      {preview?.slab && (
        <div className="px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: 'rgba(201,169,97,0.1)', color: '#C9A961' }}>
          Slab {preview.slab.finvastraPayoutPct}% · DSA {preview.dsaCode}{preview.expected ? ` → expected ₹${preview.expected.expectedGross.toLocaleString('en-IN')}` : ''}
        </div>
      )}
      {previewErr && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{previewErr}</p>}
      <ModalButtons busy={busy} onClose={onClose} onSave={save} saveLabel="Disburse" />
    </Modal>
  );
}

function KV({ label, v }: { label: string; v: string | null | undefined }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p style={{ color: 'var(--text-primary)' }}>{v || '—'}</p>
    </div>
  );
}

function AddLoginModal({ caseId, lenders, onClose }: { caseId: string; lenders: Array<Lender & { id: string }>; onClose: () => void }) {
  const toast = useToast();
  const [lenderId, setLenderId] = useState('');
  const [branch, setBranch] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await apiCrm2<{ ok: boolean; loginId: string }>('POST', `/api/crm2/cases/${caseId}/logins`, {
        lenderId: lenderId || null, branch: branch || null, amountRequested: amount ? Number(amount) : null,
      });
      toast.success(`Login ${r.loginId} opened`); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add Login" onClose={onClose}>
      <div>
        <FLabel text="Bank / NBFC (Lender)" />
        <SearchableSelect value={lenderId} onChange={setLenderId} placeholder="Select lender…"
          options={[{ value: '', label: '— select —' }, ...lenders.filter((l) => l.status === 'ACTIVE').map((l) => ({ value: l.id, label: l.name }))]} />
      </div>
      <div><FLabel text="Branch" /><input className={inp()} value={branch} onChange={(e) => setBranch(e.target.value)} /></div>
      <div><FLabel text="Amount Requested ₹" /><input type="number" className={inp()} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <ModalButtons busy={busy} onClose={onClose} onSave={save} saveLabel="Open Login" />
    </Modal>
  );
}

type SpState = Record<string, { status: string; query: string; remarks: string }>;
type QLog = Array<{ raisedAt: unknown; detail: string; resolvedAt: unknown }>;

function EditLoginModal({ caseId, login, lenders, onClose }: { caseId: string; login: LoginRow; lenders: Array<Lender & { id: string }>; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    // Stage 4 — File Login
    lenderId: login.lenderId ?? '', branch: login.branch ?? '',
    amountRequested: login.amountRequested?.toString() ?? '',
    smName: login.smName ?? '', smNumber: login.smNumber ?? '', asmName: login.asmName ?? '', asmNumber: login.asmNumber ?? '',
    docsSent: !!login.docsSent, directFromBank: !!login.directFromBank,
    // Stage 5 — Code + Login
    codeName: login.codeName ?? '', dsaCodeUsed: login.dsaCodeUsed ?? '', loginDone: !!login.loginDone,
    loanApplicationNo: login.loanApplicationNo ?? '',
    // Stage 7 — Sanctioned
    amountSanctioned: login.amountSanctioned?.toString() ?? '', roiPct: login.roiPct?.toString() ?? '',
    tenureMonths: login.tenureMonths?.toString() ?? '', processingFee: login.processingFee?.toString() ?? '',
    insuranceAmount: login.insuranceAmount?.toString() ?? '', otherCharges: login.otherCharges?.toString() ?? '',
    sanctionDate: toDateInput(login.sanctionDate), verifiedAppNo: login.verifiedAppNo ?? '',
    customerDecision: login.customerDecision ?? '',
    // Stage 9 — PDD / OTC
    pddStatus: login.pddStatus ?? 'NA', otcStatus: login.otcStatus ?? 'NA',
    pddPendingList: (login.pddPendingList ?? []).join(', '),
    remarks: login.remarks ?? '',
  });
  const [sp, setSp] = useState<SpState>(() => {
    const base: SpState = {};
    for (const { key } of SUB_PROCS) {
      const s = login.subProcesses?.[key];
      base[key] = { status: s?.status ?? 'NA', query: s?.query ?? '', remarks: s?.remarks ?? '' };
    }
    return base;
  });
  const [bt, setBt] = useState({
    isBt: !!login.bt?.isBt, amount: login.bt?.amount?.toString() ?? '',
    date: toDateInput(login.bt?.date), mode: login.bt?.mode ?? '', kind: (login.bt?.kind as string) ?? '',
  });
  const [sec, setSec] = useState({
    isSecured: !!login.secured?.isSecured, modtDate: toDateInput(login.secured?.modtDate),
    agreementDate: toDateInput(login.secured?.agreementDate), mode: login.secured?.mode ?? '',
  });
  const [applicants, setApplicants] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [picked, setPicked] = useState<string[]>(login.applicantIds ?? []);
  const [qlog, setQlog] = useState<QLog>((login.queryLog as QLog) ?? []);
  const [newQuery, setNewQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const setSpField = (key: string, field: 'status' | 'query' | 'remarks', v: string) =>
    setSp((p) => ({ ...p, [key]: { ...p[key], [field]: v } }));

  useEffect(() => (
    onSnapshot(collection(db, 'cases', caseId, 'applicants'), (snap) =>
      setApplicants(snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? d.id, type: (d.data().type as string) ?? '' }))))
  ), [caseId]);

  // Query log raise/resolve fire their own PATCH immediately (decoupled from the main save).
  const raiseQuery = async () => {
    const q = newQuery.trim(); if (!q) return;
    try {
      await apiCrm2('PATCH', `/api/crm2/cases/${caseId}/logins/${login.id}`, { query: q });
      setQlog((p) => [...p, { raisedAt: { toDate: () => new Date() }, detail: q, resolvedAt: null }]);
      setNewQuery(''); toast.success('Query raised');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };
  const resolveQuery = async (i: number) => {
    try {
      await apiCrm2('PATCH', `/api/crm2/cases/${caseId}/logins/${login.id}`, { resolveQueryIndex: i });
      setQlog((p) => p.map((q, idx) => (idx === i ? { ...q, resolvedAt: { toDate: () => new Date() } } : q)));
      toast.success('Query resolved');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  const save = async () => {
    setBusy(true);
    try {
      await apiCrm2('PATCH', `/api/crm2/cases/${caseId}/logins/${login.id}`, {
        lenderId: f.lenderId || null, branch: f.branch || null, amountRequested: numOrNull(f.amountRequested),
        smName: f.smName || null, smNumber: f.smNumber || null, asmName: f.asmName || null, asmNumber: f.asmNumber || null,
        docsSent: f.docsSent, directFromBank: f.directFromBank, loginDone: f.loginDone,
        codeName: f.codeName || null, dsaCodeUsed: f.dsaCodeUsed || null, loanApplicationNo: f.loanApplicationNo || null,
        amountSanctioned: numOrNull(f.amountSanctioned), roiPct: numOrNull(f.roiPct),
        tenureMonths: numOrNull(f.tenureMonths), processingFee: numOrNull(f.processingFee),
        insuranceAmount: numOrNull(f.insuranceAmount), otherCharges: numOrNull(f.otherCharges),
        sanctionDate: isoOrNull(f.sanctionDate), verifiedAppNo: f.verifiedAppNo || null,
        customerDecision: f.customerDecision || null,
        pddStatus: f.pddStatus, otcStatus: f.otcStatus,
        pddPendingList: f.pddPendingList.split(',').map((s) => s.trim()).filter(Boolean),
        applicantIds: picked,
        remarks: f.remarks || null,
        subProcesses: Object.fromEntries(SUB_PROCS.map(({ key }) => [key, {
          status: sp[key].status, query: sp[key].query || null, remarks: sp[key].remarks || null,
        }])),
        bt: bt.isBt
          ? { isBt: true, amount: numOrNull(bt.amount), date: isoOrNull(bt.date), mode: bt.mode || null, kind: bt.kind || null }
          : { isBt: false, amount: null, date: null, mode: null, kind: null },
        secured: sec.isSecured
          ? { isSecured: true, modtDate: isoOrNull(sec.modtDate), agreementDate: isoOrNull(sec.agreementDate), mode: sec.mode || null }
          : { isSecured: false, modtDate: null, agreementDate: null, mode: null },
      });
      toast.success('Login updated'); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Edit ${login.id} · all stages`} onClose={onClose} wide>
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Fill any stage's data anytime — saving here does not advance the login. Use “Advance →” on the card to move stages.
      </p>

      <Section title="① File / Bank Login">
        <div className="grid grid-cols-2 gap-3">
          <div><FLabel text="Lender" /><SearchableSelect value={f.lenderId} onChange={(v) => set('lenderId', v)} options={[{ value: '', label: '—' }, ...lenders.map((l) => ({ value: l.id, label: l.name }))]} /></div>
          <div><FLabel text="Branch" /><input className={inp()} value={f.branch} onChange={(e) => set('branch', e.target.value)} /></div>
          <div><FLabel text="Amount Requested ₹" /><input type="number" className={inp()} value={f.amountRequested} onChange={(e) => set('amountRequested', e.target.value)} /></div>
          <div className="hidden sm:block" />
          <div><FLabel text="SM Name" /><input className={inp()} value={f.smName} onChange={(e) => set('smName', e.target.value)} /></div>
          <div><FLabel text="SM Number" /><input className={inp()} value={f.smNumber} onChange={(e) => set('smNumber', e.target.value)} /></div>
          <div><FLabel text="ASM Name" /><input className={inp()} value={f.asmName} onChange={(e) => set('asmName', e.target.value)} /></div>
          <div><FLabel text="ASM Number" /><input className={inp()} value={f.asmNumber} onChange={(e) => set('asmNumber', e.target.value)} /></div>
        </div>
        <div className="flex flex-wrap gap-5 pt-1">
          <Check label="Docs sent to bank" checked={f.docsSent} onChange={(b) => set('docsSent', b)} />
          <Check label="Direct from bank (bank pays Finvastra)" checked={f.directFromBank} onChange={(b) => set('directFromBank', b)} />
        </div>
      </Section>

      <Section title="② Code + Bank Login Done">
        <div className="grid grid-cols-2 gap-3">
          <div><FLabel text="Code Name" /><input className={inp()} value={f.codeName} onChange={(e) => set('codeName', e.target.value)} /></div>
          <div><FLabel text="DSA Code Used" /><SearchableSelect value={f.dsaCodeUsed} onChange={(v) => set('dsaCodeUsed', v)} options={[{ value: '', label: '—' }, { value: 'finvastra', label: "Finvastra's code" }, { value: 'connector_own', label: "Connector's own code" }]} /></div>
          <div className="col-span-2"><FLabel text="Loan Application No" /><input className={inp()} value={f.loanApplicationNo} onChange={(e) => set('loanApplicationNo', e.target.value)} /></div>
        </div>
        <Check label="Login done" checked={f.loginDone} onChange={(b) => set('loginDone', b)} />
      </Section>

      <Section title="③ In Process — parallel sub-processes">
        <div className="space-y-2">
          {SUB_PROCS.map(({ key, label }) => (
            <div key={key} className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2 items-end border-t pt-2" style={{ borderColor: 'var(--shell-border)' }}>
              <div>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{label}</p>
                <div className="grid grid-cols-2 gap-2">
                  <input className={inp()} placeholder="Query / pending" value={sp[key].query} onChange={(e) => setSpField(key, 'query', e.target.value)} />
                  <input className={inp()} placeholder="Remarks" value={sp[key].remarks} onChange={(e) => setSpField(key, 'remarks', e.target.value)} />
                </div>
              </div>
              <SearchableSelect value={sp[key].status} onChange={(v) => setSpField(key, 'status', v)} options={SP_STATUS_OPTS} />
            </div>
          ))}
        </div>
        {/* Query log */}
        <div className="space-y-1.5 pt-1">
          <FLabel text="Query log" />
          {qlog.length === 0 && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>No queries raised.</p>}
          {qlog.map((q, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--shell-hover-soft)' }}>
              <span style={{ color: 'var(--text-primary)', textDecoration: q.resolvedAt ? 'line-through' : 'none' }}>{q.detail}</span>
              {q.resolvedAt
                ? <span className="text-[10px] font-bold" style={{ color: '#34d399' }}>RESOLVED</span>
                : <button onClick={() => resolveQuery(i)} className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(201,169,97,0.18)', color: '#C9A961' }}>Resolve</button>}
            </div>
          ))}
          <div className="flex gap-2">
            <input className={inp()} placeholder="Raise a new query…" value={newQuery} onChange={(e) => setNewQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); raiseQuery(); } }} />
            <button onClick={raiseQuery} className="px-3 rounded-lg text-xs font-semibold shrink-0" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>Raise</button>
          </div>
        </div>
      </Section>

      <Section title="④ Sanctioned">
        <div className="grid grid-cols-2 gap-3">
          <div><FLabel text="Sanctioned ₹" /><input type="number" className={inp()} value={f.amountSanctioned} onChange={(e) => set('amountSanctioned', e.target.value)} /></div>
          <div><FLabel text="ROI %" /><input type="number" className={inp()} value={f.roiPct} onChange={(e) => set('roiPct', e.target.value)} /></div>
          <div><FLabel text="Tenure (months)" /><input type="number" className={inp()} value={f.tenureMonths} onChange={(e) => set('tenureMonths', e.target.value)} /></div>
          <div><FLabel text="Processing Fee ₹" /><input type="number" className={inp()} value={f.processingFee} onChange={(e) => set('processingFee', e.target.value)} /></div>
          <div><FLabel text="Insurance ₹" /><input type="number" className={inp()} value={f.insuranceAmount} onChange={(e) => set('insuranceAmount', e.target.value)} /></div>
          <div><FLabel text="Other Charges ₹" /><input type="number" className={inp()} value={f.otherCharges} onChange={(e) => set('otherCharges', e.target.value)} /></div>
          <div><FLabel text="Sanction Date" /><input type="date" className={inp()} value={f.sanctionDate} onChange={(e) => set('sanctionDate', e.target.value)} /></div>
          <div><FLabel text="Verified App No" /><input className={inp()} value={f.verifiedAppNo} onChange={(e) => set('verifiedAppNo', e.target.value)} /></div>
          <div className="col-span-2"><FLabel text="Customer Decision" /><SearchableSelect value={f.customerDecision} onChange={(v) => set('customerDecision', v)} options={DECISION_OPTS} /></div>
        </div>
      </Section>

      <Section title="⑤ Disbursement extras (BT · Secured)">
        <Check label="Balance Transfer (BT)" checked={bt.isBt} onChange={(b) => setBt((p) => ({ ...p, isBt: b }))} />
        {bt.isBt && (
          <div className="grid grid-cols-2 gap-3 pl-1">
            <div><FLabel text="BT Amount ₹" /><input type="number" className={inp()} value={bt.amount} onChange={(e) => setBt((p) => ({ ...p, amount: e.target.value }))} /></div>
            <div><FLabel text="BT Date" /><input type="date" className={inp()} value={bt.date} onChange={(e) => setBt((p) => ({ ...p, date: e.target.value }))} /></div>
            <div><FLabel text="Mode" /><SearchableSelect value={bt.mode} onChange={(v) => setBt((p) => ({ ...p, mode: v }))} options={BT_MODE_OPTS} /></div>
            <div><FLabel text="Top-up / Final" /><SearchableSelect value={bt.kind} onChange={(v) => setBt((p) => ({ ...p, kind: v }))} options={BT_KIND_OPTS} /></div>
          </div>
        )}
        <Check label="Secured (MODT / agreement / hypothecation)" checked={sec.isSecured} onChange={(b) => setSec((p) => ({ ...p, isSecured: b }))} />
        {sec.isSecured && (
          <div className="grid grid-cols-2 gap-3 pl-1">
            <div><FLabel text="MODT Date" /><input type="date" className={inp()} value={sec.modtDate} onChange={(e) => setSec((p) => ({ ...p, modtDate: e.target.value }))} /></div>
            <div><FLabel text="Agreement Date" /><input type="date" className={inp()} value={sec.agreementDate} onChange={(e) => setSec((p) => ({ ...p, agreementDate: e.target.value }))} /></div>
            <div className="col-span-2"><FLabel text="Mode" /><SearchableSelect value={sec.mode} onChange={(v) => setSec((p) => ({ ...p, mode: v }))} options={SEC_MODE_OPTS} /></div>
          </div>
        )}
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Disbursed amount / date / loan a/c are captured via “Record Disbursement” (the money engine).</p>
      </Section>

      <Section title="⑥ PDD / OTC">
        <div className="grid grid-cols-2 gap-3">
          <div><FLabel text="PDD Status" /><SearchableSelect value={f.pddStatus} onChange={(v) => set('pddStatus', v)} options={PDD_OPTS} /></div>
          <div><FLabel text="OTC Status" /><SearchableSelect value={f.otcStatus} onChange={(v) => set('otcStatus', v)} options={OTC_OPTS} /></div>
          <div className="col-span-2"><FLabel text="PDD Pending List (comma-separated)" /><input className={inp()} value={f.pddPendingList} onChange={(e) => set('pddPendingList', e.target.value)} placeholder="e.g. Original sale deed, NACH" /></div>
        </div>
      </Section>

      {applicants.length > 0 && (
        <Section title="Applicants on this file">
          <div className="flex flex-wrap gap-3">
            {applicants.map((a) => (
              <Check key={a.id} label={`${a.name}${a.type ? ` · ${a.type}` : ''}`} checked={picked.includes(a.id)}
                onChange={(b) => setPicked((p) => (b ? [...new Set([...p, a.id])] : p.filter((x) => x !== a.id)))} />
            ))}
          </div>
        </Section>
      )}

      <div><FLabel text="Remarks" /><input className={inp()} value={f.remarks} onChange={(e) => set('remarks', e.target.value)} /></div>
      <ModalButtons busy={busy} onClose={onClose} onSave={save} saveLabel="Save Changes" />
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 pt-1">
      <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#C9A961' }}>{title}</p>
      {children}
    </div>
  );
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-primary)' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: '#C9A961' }} />
      {label}
    </label>
  );
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`glass-modal-panel w-full ${wide ? 'max-w-2xl' : 'max-w-sm'} rounded-2xl max-h-[92vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4 sticky top-0 z-10">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)"><X size={17} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}
function ModalButtons({ busy, onClose, onSave, saveLabel }: { busy: boolean; onClose: () => void; onSave: () => void; saveLabel: string }) {
  return (
    <div className="flex gap-3 pt-1">
      <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
      <button onClick={onSave} disabled={busy} className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>{busy ? 'Saving…' : saveLabel}</button>
    </div>
  );
}
