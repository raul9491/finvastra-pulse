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
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { apiCrm2, useCrm2Collection } from '../lib';
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

export function LoginsSection({ caseId, canWrite }: { caseId: string; canWrite: boolean }) {
  const toast = useToast();
  const { rows: lenders } = useCrm2Collection<Lender & { id: string }>('lenders');
  const [logins, setLogins] = useState<LoginRow[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<LoginRow | null>(null);

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
                    <span className="text-[11px] px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--shell-hover-soft)', color: 'var(--text-muted)' }}>
                      Disbursement → money engine (next build)
                    </span>
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
          </div>
        );
      })}

      {showAdd && <AddLoginModal caseId={caseId} lenders={lenders} onClose={() => setShowAdd(false)} />}
      {editing && <EditLoginModal caseId={caseId} login={editing} lenders={lenders} onClose={() => setEditing(null)} />}
    </div>
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

function EditLoginModal({ caseId, login, lenders, onClose }: { caseId: string; login: LoginRow; lenders: Array<Lender & { id: string }>; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    lenderId: login.lenderId ?? '', branch: login.branch ?? '',
    smName: login.smName ?? '', smNumber: login.smNumber ?? '', asmName: login.asmName ?? '', asmNumber: login.asmNumber ?? '',
    codeName: login.codeName ?? '', dsaCodeUsed: login.dsaCodeUsed ?? '', loanApplicationNo: login.loanApplicationNo ?? '',
    amountSanctioned: login.amountSanctioned?.toString() ?? '', roiPct: login.roiPct?.toString() ?? '',
    tenureMonths: login.tenureMonths?.toString() ?? '', processingFee: login.processingFee?.toString() ?? '',
    customerDecision: login.customerDecision ?? '', pddStatus: login.pddStatus ?? 'NA', otcStatus: login.otcStatus ?? 'NA',
    remarks: login.remarks ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      await apiCrm2('PATCH', `/api/crm2/cases/${caseId}/logins/${login.id}`, {
        lenderId: f.lenderId || null, branch: f.branch || null,
        smName: f.smName || null, smNumber: f.smNumber || null, asmName: f.asmName || null, asmNumber: f.asmNumber || null,
        codeName: f.codeName || null, dsaCodeUsed: f.dsaCodeUsed || null, loanApplicationNo: f.loanApplicationNo || null,
        amountSanctioned: f.amountSanctioned ? Number(f.amountSanctioned) : null,
        roiPct: f.roiPct ? Number(f.roiPct) : null, tenureMonths: f.tenureMonths ? Number(f.tenureMonths) : null,
        processingFee: f.processingFee ? Number(f.processingFee) : null,
        customerDecision: f.customerDecision || null, pddStatus: f.pddStatus, otcStatus: f.otcStatus, remarks: f.remarks || null,
      });
      toast.success('Login updated'); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Edit ${login.id}`} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <div><FLabel text="Lender" /><SearchableSelect value={f.lenderId} onChange={(v) => set('lenderId', v)} options={[{ value: '', label: '—' }, ...lenders.map((l) => ({ value: l.id, label: l.name }))]} /></div>
        <div><FLabel text="Branch" /><input className={inp()} value={f.branch} onChange={(e) => set('branch', e.target.value)} /></div>
        <div><FLabel text="SM Name" /><input className={inp()} value={f.smName} onChange={(e) => set('smName', e.target.value)} /></div>
        <div><FLabel text="SM Number" /><input className={inp()} value={f.smNumber} onChange={(e) => set('smNumber', e.target.value)} /></div>
        <div><FLabel text="ASM Name" /><input className={inp()} value={f.asmName} onChange={(e) => set('asmName', e.target.value)} /></div>
        <div><FLabel text="ASM Number" /><input className={inp()} value={f.asmNumber} onChange={(e) => set('asmNumber', e.target.value)} /></div>
        <div><FLabel text="Code Name" /><input className={inp()} value={f.codeName} onChange={(e) => set('codeName', e.target.value)} /></div>
        <div><FLabel text="DSA Code Used" /><SearchableSelect value={f.dsaCodeUsed} onChange={(v) => set('dsaCodeUsed', v)} options={[{ value: '', label: '—' }, { value: 'finvastra', label: "Finvastra's code" }, { value: 'connector_own', label: "Connector's own code" }]} /></div>
        <div className="col-span-2"><FLabel text="Loan Application No" /><input className={inp()} value={f.loanApplicationNo} onChange={(e) => set('loanApplicationNo', e.target.value)} /></div>
        <div><FLabel text="Sanctioned ₹" /><input type="number" className={inp()} value={f.amountSanctioned} onChange={(e) => set('amountSanctioned', e.target.value)} /></div>
        <div><FLabel text="ROI %" /><input type="number" className={inp()} value={f.roiPct} onChange={(e) => set('roiPct', e.target.value)} /></div>
        <div><FLabel text="Tenure (months)" /><input type="number" className={inp()} value={f.tenureMonths} onChange={(e) => set('tenureMonths', e.target.value)} /></div>
        <div><FLabel text="Processing Fee ₹" /><input type="number" className={inp()} value={f.processingFee} onChange={(e) => set('processingFee', e.target.value)} /></div>
        <div><FLabel text="Customer Decision" /><SearchableSelect value={f.customerDecision} onChange={(v) => set('customerDecision', v)} options={DECISION_OPTS} /></div>
        <div><FLabel text="PDD Status" /><SearchableSelect value={f.pddStatus} onChange={(v) => set('pddStatus', v)} options={PDD_OPTS} /></div>
        <div><FLabel text="OTC Status" /><SearchableSelect value={f.otcStatus} onChange={(v) => set('otcStatus', v)} options={OTC_OPTS} /></div>
        <div className="col-span-2"><FLabel text="Remarks" /><input className={inp()} value={f.remarks} onChange={(e) => set('remarks', e.target.value)} /></div>
      </div>
      <ModalButtons busy={busy} onClose={onClose} onSave={save} saveLabel="Save Changes" />
    </Modal>
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
