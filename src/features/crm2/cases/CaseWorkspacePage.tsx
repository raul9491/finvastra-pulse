/**
 * Case workspace (spec §14) — header with the 10-stage stepper + read-only
 * payout badge; tabs: Details / Applicants / Documents / Payout / History.
 *
 * Money mirror reads from cases/{id}/private/payout (key-gated subdoc per the
 * recorded decision); shown only with payout.amounts.read and "—" until the
 * Phase 4 disburse transaction writes it. All mutations via /api/crm2/*.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, doc, onSnapshot, orderBy, query as fsQuery } from 'firebase/firestore';
import { ArrowLeft, Plus, X, Check, AlertTriangle, FileText, Upload, IndianRupee } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { apiCrm2, useCrm2Collection, hasCrm2Perm } from '../lib';
import { FLabel, inp } from '../masters/MastersPage';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { MultiSearchableSelect } from '../../../components/ui/SearchableSelect';
import { STAGE_LABEL } from './Crm2CasesPage';
import { LoginsSection } from './LoginsSection';
import { useConnectors } from '../../hrms/hooks/useConnectors';
import type { Connector } from '../../../types';
import {
  CASE_LEVEL_STAGE_ORDER, type CaseLevelStage,
  CASE_PIPELINE, activeCasePipelineStage, type LoginStage, type Login,
  type Crm2Case, type Applicant, type DocTrackerRow,
  type StageHistoryEntry, type Client, type DocumentDef, type Lender, type Aggregator,
  type CasePayoutMirror, type VaultDoc, type CaseStage1, type CaseEligibility, type Crm2CaseTask,
} from '../../../types/crm2';

type WithId<T> = T & { id: string };
const fmtTs = (t: { toDate?: () => Date } | null | undefined) =>
  t?.toDate ? t.toDate().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const inr = (n: number | null | undefined) => n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';

function useSubcollection<T>(path: string[], orderField?: string) {
  const [rows, setRows] = useState<Array<T & { id: string }>>([]);
  useEffect(() => {
    const ref = collection(db, path[0], ...path.slice(1));
    const q = orderField ? fsQuery(ref, orderBy(orderField, 'asc')) : ref;
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T & { id: string })),
      () => { /* permission-denied tolerated */ });
  }, [path.join('/'), orderField]); // eslint-disable-line react-hooks/exhaustive-deps
  return rows;
}

export function CaseWorkspacePage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const toast = useToast();

  const [caseDoc, setCaseDoc] = useState<(Crm2Case & { id: string }) | null>(null);
  const [client, setClient] = useState<(Client & { id: string }) | null>(null);
  const [mirror, setMirror] = useState<CasePayoutMirror | null>(null);
  // view = a pipeline stage number (1..10) or a cross-cutting glance tab; null = follow the active stage.
  type GlanceTab = 'details' | 'collab' | 'clientid' | 'history';
  const [view, setView] = useState<number | GlanceTab | null>(null);
  const { employees } = useAllEmployees();

  const applicants = useSubcollection<Applicant>(['cases', caseId!, 'applicants']);
  const logins = useSubcollection<Login>(['cases', caseId!, 'logins'], 'seq');
  const tracker = useSubcollection<DocTrackerRow>(['cases', caseId!, 'docTracker']);
  const history = useSubcollection<StageHistoryEntry>(['cases', caseId!, 'stageHistory'], 'at');
  const vaultDocs = useSubcollection<VaultDoc>(client ? ['clients', client.id, 'vaultDocs'] : ['clients', '_none', 'vaultDocs']);
  const { rows: docDefs } = useCrm2Collection<WithId<DocumentDef>>('documentMaster');
  const { rows: lenders } = useCrm2Collection<WithId<Lender>>('lenders');
  const { rows: aggregators } = useCrm2Collection<WithId<Aggregator>>('aggregators');
  const { connectors } = useConnectors();   // HRMS Sub-DSAs (FAC-)

  const canWrite = hasCrm2Perm(profile, 'crm.cases.write');
  const canSeeMoney = hasCrm2Perm(profile, 'payout.amounts.read');

  useEffect(() => {
    if (!caseId) return;
    return onSnapshot(doc(db, 'cases', caseId), (s) =>
      setCaseDoc(s.exists() ? ({ id: s.id, ...s.data() } as Crm2Case & { id: string }) : null));
  }, [caseId]);
  useEffect(() => {
    if (!caseDoc?.clientId) return;
    return onSnapshot(doc(db, 'clients', caseDoc.clientId), (s) =>
      setClient(s.exists() ? ({ id: s.id, ...s.data() } as Client & { id: string }) : null));
  }, [caseDoc?.clientId]);
  useEffect(() => {
    if (!caseId || !canSeeMoney) return;
    return onSnapshot(doc(db, 'cases', caseId, 'private', 'payout'),
      (s) => setMirror(s.exists() ? (s.data() as CasePayoutMirror) : null),
      () => { /* denied without payout.amounts.read */ });
  }, [caseId, canSeeMoney]);

  const defName = (id: string) => docDefs.find((d) => d.id === id)?.name ?? id;
  const applicantName = (id: string | null) =>
    id === null ? 'Entity' : (applicants.find((a) => a.id === id)?.name ?? id);

  const patchCase = async (body: Record<string, unknown>, okMsg: string) => {
    try { await apiCrm2('PATCH', `/api/crm2/cases/${caseId}`, body); toast.success(okMsg); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Update failed'); }
  };

  if (!caseDoc) {
    return <div className="glass-panel p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading case…</div>;
  }

  const advance = async (to: CaseLevelStage | 'CLOSED', outcome?: string) => {
    try {
      await apiCrm2('POST', `/api/crm2/cases/${caseId}/stage`, { to, outcome });
      toast.success(`Stage → ${STAGE_LABEL[to] ?? to}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Transition failed');
    }
  };

  const loginStages = logins.map((l) => l.stage as LoginStage);
  const activeN = activeCasePipelineStage(caseDoc.stage, loginStages);
  const effView: number | GlanceTab = view ?? activeN;
  const selStageN = typeof effView === 'number' ? effView : 0;
  const caseIdxNow = CASE_LEVEL_STAGE_ORDER.indexOf(caseDoc.stage as CaseLevelStage);
  const nextCaseStage = caseDoc.stage !== 'CLOSED' && caseIdxNow >= 0 && caseIdxNow < CASE_LEVEL_STAGE_ORDER.length - 1
    ? CASE_LEVEL_STAGE_ORDER[caseIdxNow + 1] : null;
  const canManageCollab = canWrite && (profile?.role === 'admin' || profile?.crmRole === 'manager' || caseDoc.handlingRm === profile?.employeeId);

  // The working panel for one of the 10 pipeline stages.
  const stagePanel = (n: number) => {
    const sd = CASE_PIPELINE[n - 1];
    const isCurrentCaseStage = sd.level === 'case' && sd.caseStage === caseDoc.stage;
    const showAdvance = canWrite && caseDoc.stage !== 'CLOSED' && caseDoc.stage !== 'COMPLETED'
      && ((isCurrentCaseStage && !!nextCaseStage) || (n === 10 && caseDoc.stage === 'IN_PROGRESS'));
    const advanceTo: CaseLevelStage | null = n === 10 ? 'COMPLETED' : nextCaseStage;
    const advanceLabel = advanceTo === 'IN_PROGRESS' ? 'Submit & start File Login →'
      : advanceTo === 'COMPLETED' ? 'Mark case Completed'
      : advanceTo ? `Submit & advance to ${STAGE_LABEL[advanceTo] ?? advanceTo} →` : '';
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            <span style={{ color: '#C9A961' }}>Stage {n}</span> — {sd.label}
          </h3>
          {sd.level === 'login' && (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-muted)' }}>
              Worked per login
            </span>
          )}
        </div>

        {n === 1 && (
          <>
            <div className="glass-panel p-4 flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Amount required</span>
              {canWrite ? (
                <input type="number" className="glass-inp text-sm w-48" defaultValue={caseDoc.amountRequested ?? ''}
                  onBlur={(e) => { const v = e.target.value; if (v !== String(caseDoc.amountRequested ?? '')) patchCase({ amountRequested: v ? Number(v) : null }, 'Amount saved'); }} />
              ) : <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{inr(caseDoc.amountRequested)}</span>}
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>· Routing, product &amp; sourcing are on the <b>Details</b> tab</span>
            </div>
            <ApplicantsTab caseId={caseDoc.id} applicants={applicants} canWrite={canWrite} />
            <Stage1Panel caseDoc={caseDoc} canWrite={canWrite} patchCase={patchCase} />
          </>
        )}
        {n === 2 && <EligibilityPanel caseDoc={caseDoc} canWrite={canWrite} patchCase={patchCase} onGoDocs={() => setView(3)} />}
        {n === 3 && (
          <>
            <DriveLinkCard caseDoc={caseDoc} canWrite={canWrite} patchCase={patchCase} />
            <DocumentsTab caseId={caseDoc.id} tracker={tracker} vaultDocs={vaultDocs}
              clientId={caseDoc.clientId} defName={defName} applicantName={applicantName}
              docDefs={docDefs} applicants={applicants} canWrite={canWrite} />
          </>
        )}
        {n >= 4 && n <= 9 && (
          <>
            <p className="text-[11px] px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(201,169,97,0.08)', color: 'var(--text-muted)' }}>
              Stages 4–9 are worked <b>per login</b> (one file → one bank/NBFC). Each login below runs File&nbsp;Login → Code → In&nbsp;Process → Sanctioned → Disbursed → PDD/OTC — advance each with its own button.
            </p>
            <LoginsSection caseId={caseDoc.id} canWrite={canWrite} />
          </>
        )}
        {n === 10 && (
          <div className="glass-panel p-6 space-y-2 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {caseDoc.stage === 'COMPLETED' ? 'This case is completed.' : caseDoc.stage === 'CLOSED' ? 'This case is closed.' : 'Mark the case completed once every login has been disbursed and its PDD/OTC cleared (or closed).'}
            </p>
            {caseDoc.outcome && (
              <span className="inline-block text-xs font-bold px-3 py-1 rounded-full"
                style={{ backgroundColor: caseDoc.outcome === 'COMPLETED' ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)', color: caseDoc.outcome === 'COMPLETED' ? '#34d399' : '#f87171' }}>
                {caseDoc.outcome}
              </span>
            )}
          </div>
        )}

        {showAdvance && advanceTo && (
          <div className="flex justify-end pt-1">
            <button onClick={() => advance(advanceTo)} className="px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {advanceLabel}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/crm/pipeline/cases')}
        className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={14} /> All cases
      </button>

      {/* Header + 10-stage clickable pipeline */}
      <div className="glass-panel p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
              {client?.name ?? caseDoc.clientId}
            </h2>
            <p className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {caseDoc.id} · RM {caseDoc.handlingRm}
              {caseDoc.dsaCode ? ` · DSA ${caseDoc.dsaCode}` : ''}
              {caseDoc.subDsaId ? ` · via ${caseDoc.subDsaId}` : ' · self-sourced'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-full"
              title="Payout status — mirrored from the Payout Cycle (read-only)"
              style={{ backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-muted)' }}>
              Payout: {caseDoc.payoutStatus}
            </span>
            {caseDoc.outcome && (
              <span className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-full"
                style={{ backgroundColor: caseDoc.outcome === 'COMPLETED' ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)',
                         color: caseDoc.outcome === 'COMPLETED' ? '#34d399' : '#f87171' }}>
                {caseDoc.outcome}
              </span>
            )}
          </div>
        </div>

        {/* 10-stage clickable pipeline — click any stage to open and work it */}
        <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
          {CASE_PIPELINE.map((sd) => {
            const n = sd.n, done = n < activeN, active = n === activeN, selected = n === selStageN;
            return (
              <button key={sd.key} onClick={() => setView(n)}
                className="flex flex-col items-center gap-1 shrink-0 w-[94px] px-1 py-1.5 rounded-lg transition-colors"
                style={selected ? { backgroundColor: 'rgba(201,169,97,0.12)', border: '1px solid rgba(201,169,97,0.5)' } : { border: '1px solid transparent' }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
                  style={{ backgroundColor: done || active ? '#C9A961' : 'var(--shell-hover-hard)', color: done || active ? '#0B1538' : 'var(--text-dim)' }}>
                  {done ? <Check size={13} /> : n}
                </div>
                <span className="text-[9px] font-semibold text-center leading-tight"
                  style={{ color: active || selected ? '#C9A961' : 'var(--text-muted)' }}>{sd.label}</span>
              </button>
            );
          })}
        </div>

        {canWrite && caseDoc.stage !== 'CLOSED' && caseDoc.stage !== 'COMPLETED' && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { const r = prompt('Close early — reason (recorded):'); if (r !== null) advance('CLOSED', r.toLowerCase().includes('withdraw') ? 'WITHDRAWN' : 'REJECTED'); }}
              className="px-4 py-2 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'rgba(248,113,113,0.4)', color: '#f87171' }}>
              Close (reject/withdraw)
            </button>
          </div>
        )}
      </div>

      {/* Glance tabs (cross-stage views) */}
      <div className="flex gap-1.5 flex-wrap">
        {([['details', 'Details'], ['collab', 'Collaboration'], ['clientid', 'Client-ID data'], ['history', 'History']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setView(t)}
            className="px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={effView === t
              ? { backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' }
              : { color: 'var(--text-muted)', border: '1px solid var(--shell-border)' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Main panel — either a pipeline stage workspace or a glance view */}
      {typeof effView === 'number' ? stagePanel(effView)
        : effView === 'details' ? (
          <DetailsTab caseDoc={caseDoc} lenders={lenders} aggregators={aggregators}
            connectors={connectors} canWrite={canWrite} canSeeMoney={canSeeMoney} mirror={mirror} patchCase={patchCase} />
        ) : effView === 'collab' ? (
          <CollaborationTab caseDoc={caseDoc} employees={employees} canWrite={canWrite} canManage={canManageCollab} />
        ) : effView === 'clientid' ? (
          <ClientIdTab client={client} />
        ) : (
          <div className="glass-panel p-5 space-y-2">
            {history.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No transitions yet.</p>
            ) : [...history].reverse().map((h) => (
              <div key={h.id} className="px-3 py-2 rounded-lg flex items-center gap-3" style={{ border: '1px solid var(--shell-border)' }}>
                <span className="text-xs font-semibold" style={{ color: '#C9A961' }}>
                  {h.from ? `${STAGE_LABEL[h.from] ?? h.from} →` : ''} {STAGE_LABEL[h.to] ?? h.to}
                </span>
                <span className="text-[11px] flex-1" style={{ color: 'var(--text-muted)' }}>{h.note ?? ''}</span>
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{h.by} · {fmtTs(h.at)}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ─── Stage 2 — Basic Docs + Eligibility (CIBIL taken + per-applicant issues) ───
function EligibilityPanel({ caseDoc, canWrite, patchCase, onGoDocs }: {
  caseDoc: Crm2Case & { id: string }; canWrite: boolean;
  patchCase: (body: Record<string, unknown>, msg: string) => Promise<void>; onGoDocs: () => void;
}) {
  const e0 = caseDoc.eligibility ?? null;
  const [cibilTaken, setCibilTaken] = useState(!!e0?.cibilTaken);
  type Row = { name: string; score: string; overdue: string; settlement: string; writtenOff: string; dpd: string };
  const [rows, setRows] = useState<Row[]>(
    e0?.issues?.length ? e0.issues.map((x) => ({ name: x.name, score: x.score?.toString() ?? '', overdue: x.overdue, settlement: x.settlement, writtenOff: x.writtenOff, dpd: x.dpd }))
      : [{ name: '', score: '', overdue: '', settlement: '', writtenOff: '', dpd: '' }]);
  const [busy, setBusy] = useState(false);
  const upd = (i: number, k: keyof Row, v: string) => setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => {
    setBusy(true);
    try {
      await patchCase({ eligibility: { cibilTaken, issues: rows.map((r) => ({ name: r.name.trim(), score: r.score ? Number(r.score) : null, overdue: r.overdue.trim(), settlement: r.settlement.trim(), writtenOff: r.writtenOff.trim(), dpd: r.dpd.trim() })).filter((r) => r.name || r.score != null || r.overdue || r.settlement || r.writtenOff || r.dpd) } }, 'Eligibility saved');
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="glass-panel p-5 flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Basic docs collected?</span>
        <button onClick={onGoDocs} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' }}>
          Add / view docs (Stage 3) →
        </button>
      </div>
      <div className="glass-panel p-5 space-y-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-primary)' }}>
          <input type="checkbox" checked={cibilTaken} onChange={(e) => setCibilTaken(e.target.checked)} style={{ accentColor: '#C9A961' }} disabled={!canWrite} />
          CIBIL taken (for applicants / owners)
        </label>
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#C9A961' }}>CIBIL issues — overdue · settlement · written-off · DPD</p>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1.2fr_70px_1fr_1fr_1fr_1fr_24px] gap-2 items-center">
              <input className="glass-inp text-sm" placeholder="Applicant / owner" value={r.name} onChange={(e) => upd(i, 'name', e.target.value)} disabled={!canWrite} />
              <input type="number" className="glass-inp text-sm" placeholder="Score" value={r.score} onChange={(e) => upd(i, 'score', e.target.value)} disabled={!canWrite} />
              <input className="glass-inp text-sm" placeholder="Overdue" value={r.overdue} onChange={(e) => upd(i, 'overdue', e.target.value)} disabled={!canWrite} />
              <input className="glass-inp text-sm" placeholder="Settlement" value={r.settlement} onChange={(e) => upd(i, 'settlement', e.target.value)} disabled={!canWrite} />
              <input className="glass-inp text-sm" placeholder="Written-off" value={r.writtenOff} onChange={(e) => upd(i, 'writtenOff', e.target.value)} disabled={!canWrite} />
              <input className="glass-inp text-sm" placeholder="DPD" value={r.dpd} onChange={(e) => upd(i, 'dpd', e.target.value)} disabled={!canWrite} />
              {canWrite && <button onClick={() => setRows((p) => p.filter((_, j) => j !== i))} className="p-1 rounded hover:bg-(--shell-hover-hard)"><X size={13} style={{ color: '#f87171' }} /></button>}
            </div>
          ))}
          {canWrite && (
            <div className="flex items-center justify-between pt-1">
              <button onClick={() => setRows((p) => [...p, { name: '', score: '', overdue: '', settlement: '', writtenOff: '', dpd: '' }])} className="text-xs font-semibold" style={{ color: '#C9A961' }}>+ Add row</button>
              <button onClick={save} disabled={busy} className="text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>{busy ? 'Saving…' : 'Save eligibility'}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Stage 3 — Google Drive client folder link ───────────────────────────────
function DriveLinkCard({ caseDoc, canWrite, patchCase }: {
  caseDoc: Crm2Case & { id: string }; canWrite: boolean;
  patchCase: (body: Record<string, unknown>, msg: string) => Promise<void>;
}) {
  return (
    <div className="glass-panel p-5 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Client document folder (Google Drive)</p>
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Name the Drive folder with the client id: <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{caseDoc.clientId}</span></p>
      {canWrite ? (
        <input className="glass-inp text-sm w-full" placeholder="https://drive.google.com/drive/folders/…" defaultValue={caseDoc.docsFolderUrl ?? ''}
          onBlur={(e) => { if (e.target.value !== (caseDoc.docsFolderUrl ?? '')) patchCase({ docsFolderUrl: e.target.value.trim() || null }, 'Drive link saved'); }} />
      ) : caseDoc.docsFolderUrl ? (
        <a href={caseDoc.docsFolderUrl} target="_blank" rel="noreferrer" className="text-sm underline" style={{ color: '#C9A961' }}>Open folder ↗</a>
      ) : <span className="text-sm" style={{ color: 'var(--text-muted)' }}>—</span>}
      {canWrite && caseDoc.docsFolderUrl && (
        <a href={caseDoc.docsFolderUrl} target="_blank" rel="noreferrer" className="inline-block text-xs underline" style={{ color: '#C9A961' }}>Open current folder ↗</a>
      )}
    </div>
  );
}

// ─── Collaboration tab (Phase 6 — multi-RM sharing + task/update thread) ──────
function CollaborationTab({ caseDoc, employees, canWrite, canManage }: {
  caseDoc: Crm2Case & { id: string };
  employees: Array<{ employeeId?: string; displayName?: string; employeeStatus?: string }>;
  canWrite: boolean; canManage: boolean;
}) {
  const toast = useToast();
  const tasks = useSubcollection<Crm2CaseTask>(['cases', caseDoc.id, 'tasks'], 'createdAt');
  const nameOf = (fapl: string) => employees.find((e) => e.employeeId === fapl)?.displayName ?? fapl;
  const opts = useMemo(() => employees
    .filter((e) => e.employeeId && e.employeeStatus !== 'inactive' && e.employeeId !== caseDoc.handlingRm)
    .map((e) => ({ value: e.employeeId!, label: `${e.displayName} (${e.employeeId})` })), [employees, caseDoc.handlingRm]);

  const [collab, setCollab] = useState<string[]>(caseDoc.collaborators ?? []);
  const [savingCollab, setSavingCollab] = useState(false);
  useEffect(() => setCollab(caseDoc.collaborators ?? []), [caseDoc.collaborators]);
  const collabDirty = JSON.stringify([...collab].sort()) !== JSON.stringify([...(caseDoc.collaborators ?? [])].sort());
  const saveCollab = async () => {
    setSavingCollab(true);
    try { await apiCrm2('POST', `/api/crm2/cases/${caseDoc.id}/collaborators`, { collaborators: collab }); toast.success('Collaborators updated'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setSavingCollab(false); }
  };

  const [kind, setKind] = useState<'update' | 'task'>('update');
  const [text, setText] = useState('');
  const [assignee, setAssignee] = useState('');
  const [posting, setPosting] = useState(false);
  const post = async () => {
    if (text.trim().length < 2) return;
    setPosting(true);
    try {
      await apiCrm2('POST', `/api/crm2/cases/${caseDoc.id}/tasks`, {
        kind, text: text.trim(), assignedTo: kind === 'task' ? (assignee || null) : null });
      setText(''); setAssignee('');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setPosting(false); }
  };
  const toggleTask = async (t: Crm2CaseTask & { id: string }) => {
    try { await apiCrm2('PATCH', `/api/crm2/cases/${caseDoc.id}/tasks/${t.id}`, { status: t.status === 'done' ? 'open' : 'done' }); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <div className="space-y-4">
      {/* Collaborators */}
      <div className="glass-panel p-5 space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Working this case</p>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
            {nameOf(caseDoc.handlingRm)} · owner
          </span>
          {(caseDoc.collaborators ?? []).map((f) => (
            <span key={f} className="text-xs px-2.5 py-1 rounded-full" style={{ backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-secondary)' }}>{nameOf(f)}</span>
          ))}
          {(caseDoc.collaborators ?? []).length === 0 && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No collaborators yet.</span>}
        </div>
        {canManage && (
          <div className="space-y-2 pt-1">
            <FLabel text="Add / remove collaborators" />
            <MultiSearchableSelect value={collab} onChange={setCollab} options={opts} placeholder="Select teammates…" />
            {collabDirty && (
              <button onClick={saveCollab} disabled={savingCollab}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                {savingCollab ? 'Saving…' : 'Save collaborators'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Thread */}
      <div className="glass-panel p-5 space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Thread</p>
        <div className="space-y-2 max-h-105 overflow-y-auto">
          {tasks.length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No updates or tasks yet.</p>}
          {tasks.map((t) => (
            <div key={t.id} className="px-3 py-2 rounded-lg" style={{ border: '1px solid var(--shell-border)' }}>
              <div className="flex items-start gap-2">
                {t.kind === 'task' && (
                  <button onClick={() => canWrite && toggleTask(t)} disabled={!canWrite}
                    className="mt-0.5 w-4 h-4 rounded shrink-0 flex items-center justify-center"
                    style={{ border: `1.5px solid ${t.status === 'done' ? '#34d399' : 'var(--shell-border-mid)'}`, backgroundColor: t.status === 'done' ? '#34d399' : 'transparent' }}>
                    {t.status === 'done' && <Check size={11} style={{ color: '#0B1538' }} />}
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm" style={{ color: 'var(--text-primary)', textDecoration: t.kind === 'task' && t.status === 'done' ? 'line-through' : 'none' }}>{t.text}</p>
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {t.kind === 'task' ? '✓ Task' : '💬 Update'} · {t.createdByName}
                    {t.assignedToName ? ` → ${t.assignedToName}` : ''} · {fmtTs(t.createdAt)}
                    {t.status === 'done' && t.doneBy ? ` · done` : ''}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
        {canWrite && (
          <div className="space-y-2 pt-1" style={{ borderTop: '1px solid var(--shell-border)' }}>
            <div className="flex gap-1.5 pt-2">
              {(['update', 'task'] as const).map((k) => (
                <button key={k} onClick={() => setKind(k)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg capitalize"
                  style={kind === k ? { backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' } : { color: 'var(--text-muted)', border: '1px solid var(--shell-border)' }}>
                  {k === 'update' ? '💬 Update' : '✓ Task'}
                </button>
              ))}
            </div>
            <textarea className={inp()} rows={2} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={kind === 'task' ? 'Describe the task…' : 'Post an update…'} />
            <div className="flex flex-wrap items-center gap-2">
              {kind === 'task' && (
                <div className="flex-1 min-w-45">
                  <SearchableSelect value={assignee} onChange={setAssignee}
                    options={[{ value: '', label: 'Unassigned' }, { value: caseDoc.handlingRm, label: `${nameOf(caseDoc.handlingRm)} (owner)` }, ...opts]}
                    placeholder="Assign to…" />
                </div>
              )}
              <button onClick={post} disabled={posting || text.trim().length < 2}
                className="text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 ml-auto" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                {posting ? 'Posting…' : kind === 'task' ? 'Add task' : 'Post update'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Client-ID data tab (decision B — the case's client master at a glance) ────
function ClientIdTab({ client }: { client: (Client & { id: string }) | null }) {
  const navigate = useNavigate();
  if (!client) return <div className="glass-panel p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Loading client…</div>;
  const addr = [client.regAddress?.line, client.regAddress?.city, client.regAddress?.state, client.regAddress?.pincode].filter(Boolean).join(', ');
  const Row = ({ k, v }: { k: string; v: string | null | undefined }) => (
    <div><p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{k}</p><p className="text-sm" style={{ color: 'var(--text-primary)' }}>{v || '—'}</p></div>
  );
  return (
    <div className="glass-panel p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{client.name}</p>
          <p className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{client.id} · {client.constitution}</p>
        </div>
        <button onClick={() => navigate(`/crm/pipeline/clients/${client.id}`)} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
          Open client master →
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Row k="Industry" v={client.industry} />
        <Row k="PAN" v={client.panLast4 ? `••••••${client.panLast4}` : null} />
        <Row k="GSTIN" v={client.gstin} />
        <Row k="Contact" v={client.primaryContact?.name} />
        <Row k="Mobile" v={client.primaryContact?.mobile} />
        <Row k="Email" v={client.primaryContact?.email} />
        <Row k="Owner RM" v={client.ownerRm} />
        <Row k="KYC" v={client.kycStatus} />
        <Row k="Latest CIBIL" v={client.latestCibil ? String(client.latestCibil.score) : null} />
        <Row k="Registered Address" v={addr} />
      </div>
    </div>
  );
}

// ─── Details tab ──────────────────────────────────────────────────────────────
function DetailsTab({ caseDoc, lenders, aggregators, connectors, canWrite, canSeeMoney, mirror, patchCase }: {
  connectors: Connector[];
  caseDoc: Crm2Case & { id: string };
  lenders: Array<WithId<Lender>>; aggregators: Array<WithId<Aggregator>>;
  canWrite: boolean; canSeeMoney: boolean; mirror: CasePayoutMirror | null;
  patchCase: (body: Record<string, unknown>, msg: string) => Promise<void>;
}) {
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: '1px solid var(--shell-border)' }}>
      <span className="text-xs shrink-0 w-36" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <div className="flex-1 text-right text-sm" style={{ color: 'var(--text-primary)' }}>{children}</div>
    </div>
  );
  const editNum = (field: string, value: number | null, label: string) => canWrite ? (
    <input type="number" className="glass-inp text-sm w-44 text-right" defaultValue={value ?? ''}
      onBlur={(e) => { const v = e.target.value; if (v !== String(value ?? '')) patchCase({ [field]: v ? Number(v) : null }, `${label} saved`); }} />
  ) : <span>{inr(value)}</span>;
  const editStr = (field: string, value: string | null, label: string) => canWrite ? (
    <input className="glass-inp text-sm w-52 text-right" defaultValue={value ?? ''}
      onBlur={(e) => { if (e.target.value !== (value ?? '')) patchCase({ [field]: e.target.value || null }, `${label} saved`); }} />
  ) : <span>{value ?? '—'}</span>;

  return (
    <div className="space-y-4">
    <div className="grid md:grid-cols-2 gap-4">
      <div className="glass-panel p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Routing</p>
        <Row label="Lender">
          {canWrite ? (
            <SearchableSelect value={caseDoc.lenderId ?? ''} placeholder="—"
              onChange={(v) => patchCase({ lenderId: v || null }, 'Lender saved')}
              options={[{ value: '', label: '—' }, ...lenders.filter((l) => l.status === 'ACTIVE').map((l) => ({ value: l.id, label: l.name }))]} />
          ) : (lenders.find((l) => l.id === caseDoc.lenderId)?.name ?? '—')}
        </Row>
        <Row label="Aggregator (Routed Via)">
          {canWrite ? (
            <SearchableSelect value={caseDoc.connectorId ?? ''} placeholder="—"
              onChange={(v) => patchCase({ connectorId: v || null }, 'Aggregator saved')}
              options={[{ value: '', label: '—' }, ...aggregators.filter((a) => a.status === 'ACTIVE').map((a) => ({ value: a.id, label: a.name }))]} />
          ) : (aggregators.find((a) => a.id === caseDoc.connectorId)?.name ?? '—')}
        </Row>
        <Row label="Sub DSA (Sourced By)">
          {canWrite ? (
            <SearchableSelect value={caseDoc.channelPartnerId ?? ''} placeholder="— self-sourced —"
              onChange={(v) => { const p = connectors.find((c) => c.id === v);
                patchCase(p ? { channelPartnerId: p.id, channelPartnerCode: p.connectorCode, channelPartnerName: p.displayName }
                            : { channelPartnerId: null, channelPartnerCode: null, channelPartnerName: null }, 'Sub DSA saved'); }}
              options={[{ value: '', label: '— self-sourced —' }, ...connectors.filter((c) => c.status === 'active').map((c) => ({ value: c.id, label: `${c.displayName} (${c.connectorCode})` }))]} />
          ) : (caseDoc.channelPartnerName ?? '— self-sourced —')}
        </Row>
        <Row label="DSA Code (frozen)"><span className="font-mono text-xs">{caseDoc.dsaCode ?? '— set at disbursement'}</span></Row>
        <Row label="Bank Application No">{editStr('bankApplicationNo', caseDoc.bankApplicationNo, 'App no')}</Row>
        <Row label="Loan Account No">{editStr('loanAccountNo', caseDoc.loanAccountNo, 'Loan a/c')}</Row>
        <Row label="Aggregator Case Ref">{editStr('connectorCaseRef', caseDoc.connectorCaseRef, 'Ref')}</Row>
      </div>

      <div className="glass-panel p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Amounts & terms</p>
        <Row label="Requested">{editNum('amountRequested', caseDoc.amountRequested, 'Requested')}</Row>
        <Row label="Sanctioned">{editNum('amountSanctioned', caseDoc.amountSanctioned, 'Sanctioned')}</Row>
        <Row label="Disbursed (server)"><span>{inr(caseDoc.amountDisbursed)}</span></Row>
        <Row label="ROI %">{editNum('roiPct', caseDoc.roiPct, 'ROI')}</Row>
        <Row label="Tenure (months)">{editNum('tenureMonths', caseDoc.tenureMonths, 'Tenure')}</Row>
        <Row label="Processing Fee">{editNum('processingFee', caseDoc.processingFee, 'PF')}</Row>
      </div>

      <div className="glass-panel p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>PDD / OTC</p>
        <Row label="PDD Status">
          {canWrite ? (
            <SearchableSelect value={caseDoc.pddStatus}
              onChange={(v) => patchCase({ pddStatus: v }, 'PDD status saved')}
              options={['NA', 'PENDING', 'PARTIAL', 'CLEARED'].map((s) => ({ value: s, label: s }))} />
          ) : caseDoc.pddStatus}
        </Row>
        <Row label="OTC Status">
          {canWrite ? (
            <SearchableSelect value={caseDoc.otcStatus}
              onChange={(v) => patchCase({ otcStatus: v }, 'OTC status saved')}
              options={['NA', 'PENDING', 'CLEARED'].map((s) => ({ value: s, label: s }))} />
          ) : caseDoc.otcStatus}
        </Row>
        <Row label="Next Action">{editStr('nextAction', caseDoc.nextAction, 'Next action')}</Row>
        <Row label="Remarks">{editStr('remarks', caseDoc.remarks, 'Remarks')}</Row>
      </div>

      <div className="glass-panel p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
          Expected payout {canSeeMoney ? '' : '(restricted)'}
        </p>
        {canSeeMoney ? (
          <>
            <Row label="Finvastra %"><span>{mirror?.finvastraPayoutPct != null ? `${mirror.finvastraPayoutPct}%` : '—'}</span></Row>
            <Row label="Expected Gross"><span>{inr(mirror?.finvastraPayoutExpected)}</span></Row>
            <Row label="Connector Expected"><span>{inr(mirror?.subDsaPayoutExpected)}</span></Row>
            <Row label="Net Margin Expected"><span style={{ color: '#34d399' }}>{inr(mirror?.netMarginExpected)}</span></Row>
            {!mirror && <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>Populated at disbursement (Phase 4).</p>}
          </>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Amounts are visible to payout.amounts.read holders only. You can see the payout
            status badge above.
          </p>
        )}
      </div>
    </div>

    <Stage1Panel caseDoc={caseDoc} canWrite={canWrite} patchCase={patchCase} />
    </div>
  );
}

// ─── Stage-1 (Opened) underwriting panel ──────────────────────────────────────
function Stage1Panel({ caseDoc, canWrite, patchCase }: {
  caseDoc: Crm2Case & { id: string }; canWrite: boolean;
  patchCase: (body: Record<string, unknown>, msg: string) => Promise<void>;
}) {
  const [edit, setEdit] = useState(false);
  const s1 = caseDoc.stage1 ?? null;
  const hasData = !!s1 && (
    !!s1.property || (s1.turnover?.length ?? 0) > 0 || !!s1.gstTurnover ||
    (s1.existingLoans?.length ?? 0) > 0 || !!s1.income || (s1.references?.length ?? 0) > 0 || !!s1.notes
  );
  return (
    <div className="glass-panel p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Stage 1 — Underwriting (Opened)
        </p>
        {canWrite && (
          <button onClick={() => setEdit(true)} className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' }}>
            {hasData ? 'Edit Stage-1 data' : '+ Add Stage-1 data'}
          </button>
        )}
      </div>
      {!hasData ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          No underwriting data captured yet — property, turnover, income, existing loans & references.
        </p>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          {s1?.property && (
            <S1Block title="Property">
              <S1Line k="Description" v={s1.property.description} />
              <S1Line k="Address" v={s1.property.address} />
              <S1Line k="Market value" v={s1.property.marketValue != null ? inr(s1.property.marketValue) : null} />
            </S1Block>
          )}
          {(s1?.turnover?.length ?? 0) > 0 && (
            <S1Block title="Turnover (3 yrs)">
              {s1!.turnover.map((t, i) => <S1Line key={i} k={t.fy || `Year ${i + 1}`} v={inr(t.amount)} />)}
            </S1Block>
          )}
          {s1?.gstTurnover && (
            <S1Block title="GST turnover">
              <S1Line k={s1.gstTurnover.period || 'Period'} v={s1.gstTurnover.amount != null ? inr(s1.gstTurnover.amount) : null} />
            </S1Block>
          )}
          {s1?.income && (
            <S1Block title="Income">
              <S1Line k="Company" v={s1.income.company != null ? inr(s1.income.company) : null} />
              <S1Line k="Individual" v={s1.income.individual != null ? inr(s1.income.individual) : null} />
              <S1Line k="Rental" v={s1.income.rental != null ? inr(s1.income.rental) : null} />
            </S1Block>
          )}
          {(s1?.existingLoans?.length ?? 0) > 0 && (
            <S1Block title="Existing loans">
              {s1!.existingLoans.map((l, i) => (
                <S1Line key={i} k={`${l.lender || '—'}${l.loanType ? ` · ${l.loanType}` : ''}`} v={`${inr(l.outstanding)} · EMI ${inr(l.emi)}`} />
              ))}
            </S1Block>
          )}
          {(s1?.references?.length ?? 0) > 0 && (
            <S1Block title="References">
              {s1!.references.map((r, i) => <S1Line key={i} k={r.name || `Ref ${i + 1}`} v={`${r.mobile || ''}${r.relation ? ` · ${r.relation}` : ''}`} />)}
            </S1Block>
          )}
          {s1?.notes && (
            <S1Block title="Notes (partner / director details)">
              <p style={{ color: 'var(--text-primary)' }}>{s1.notes}</p>
            </S1Block>
          )}
        </div>
      )}
      {edit && <Stage1Modal caseDoc={caseDoc} patchCase={patchCase} onClose={() => setEdit(false)} />}
    </div>
  );
}
function S1Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-3" style={{ border: '1px solid var(--shell-border)' }}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: '#C9A961' }}>{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
function S1Line({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span style={{ color: 'var(--text-muted)' }}>{k}</span>
      <span className="text-right" style={{ color: 'var(--text-primary)' }}>{v || '—'}</span>
    </div>
  );
}

// ─── Stage-1 edit modal — property, turnover, GST, loans, income, references ───
function Stage1Modal({ caseDoc, patchCase, onClose }: {
  caseDoc: Crm2Case & { id: string };
  patchCase: (body: Record<string, unknown>, msg: string) => Promise<void>;
  onClose: () => void;
}) {
  const s0 = caseDoc.stage1 ?? null;
  const [prop, setProp] = useState({
    description: s0?.property?.description ?? '', address: s0?.property?.address ?? '',
    marketValue: s0?.property?.marketValue?.toString() ?? '',
  });
  const [turnover, setTurnover] = useState<Array<{ fy: string; amount: string }>>(
    s0?.turnover?.length ? s0.turnover.map((t) => ({ fy: t.fy, amount: String(t.amount) })) : [{ fy: '', amount: '' }, { fy: '', amount: '' }, { fy: '', amount: '' }]);
  const [gst, setGst] = useState({ period: s0?.gstTurnover?.period ?? '', amount: s0?.gstTurnover?.amount?.toString() ?? '' });
  const [income, setIncome] = useState({
    company: s0?.income?.company?.toString() ?? '', individual: s0?.income?.individual?.toString() ?? '', rental: s0?.income?.rental?.toString() ?? '',
  });
  const [loans, setLoans] = useState<Array<{ lender: string; loanType: string; outstanding: string; emi: string }>>(
    s0?.existingLoans?.length ? s0.existingLoans.map((l) => ({ lender: l.lender, loanType: l.loanType, outstanding: String(l.outstanding), emi: String(l.emi) })) : [{ lender: '', loanType: '', outstanding: '', emi: '' }]);
  const [refs, setRefs] = useState<Array<{ name: string; mobile: string; relation: string }>>(
    s0?.references?.length ? s0.references.map((r) => ({ ...r })) : [{ name: '', mobile: '', relation: '' }, { name: '', mobile: '', relation: '' }]);
  const [notes, setNotes] = useState(s0?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const n = (s: string) => (s.trim() ? Number(s) : null);

  const save = async () => {
    setBusy(true);
    try {
      await patchCase({
        stage1: {
          property: (prop.description || prop.address || prop.marketValue)
            ? { description: prop.description || null, address: prop.address || null, marketValue: n(prop.marketValue) } : null,
          turnover: turnover.map((t) => ({ fy: t.fy.trim(), amount: n(t.amount) ?? 0 })).filter((t) => t.fy || t.amount),
          gstTurnover: (gst.period || gst.amount) ? { period: gst.period || null, amount: n(gst.amount) } : null,
          existingLoans: loans.map((l) => ({ lender: l.lender.trim(), loanType: l.loanType.trim(), outstanding: n(l.outstanding) ?? 0, emi: n(l.emi) ?? 0 })).filter((l) => l.lender || l.outstanding || l.emi),
          income: (income.company || income.individual || income.rental) ? { company: n(income.company), individual: n(income.individual), rental: n(income.rental) } : null,
          references: refs.map((r) => ({ name: r.name.trim(), mobile: r.mobile.trim(), relation: r.relation.trim() })).filter((r) => r.name || r.mobile),
          notes: notes.trim() || null,
        },
      }, 'Stage-1 data saved');
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-2xl rounded-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4 sticky top-0 z-10">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Stage 1 — Underwriting · {caseDoc.id}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)"><X size={17} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <div className="p-5 space-y-5">
          <S1Section title="Property">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><FLabel text="Description" /><input className={inp()} value={prop.description} onChange={(e) => setProp({ ...prop, description: e.target.value })} /></div>
              <div className="col-span-2"><FLabel text="Address" /><input className={inp()} value={prop.address} onChange={(e) => setProp({ ...prop, address: e.target.value })} /></div>
              <div><FLabel text="Market Value ₹" /><input type="number" className={inp()} value={prop.marketValue} onChange={(e) => setProp({ ...prop, marketValue: e.target.value })} /></div>
            </div>
          </S1Section>

          <S1Section title="Turnover — last 3 financial years">
            {turnover.map((t, i) => (
              <div key={i} className="grid grid-cols-[120px_1fr] gap-2 mb-2">
                <input className={inp()} placeholder="FY (e.g. 2024-25)" value={t.fy} onChange={(e) => setTurnover((p) => p.map((x, j) => j === i ? { ...x, fy: e.target.value } : x))} />
                <input type="number" className={inp()} placeholder="Amount ₹" value={t.amount} onChange={(e) => setTurnover((p) => p.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div><FLabel text="GST turnover period" /><input className={inp()} value={gst.period} onChange={(e) => setGst({ ...gst, period: e.target.value })} placeholder="e.g. Apr–Dec 2025" /></div>
              <div><FLabel text="GST turnover ₹" /><input type="number" className={inp()} value={gst.amount} onChange={(e) => setGst({ ...gst, amount: e.target.value })} /></div>
            </div>
          </S1Section>

          <S1Section title="Income">
            <div className="grid grid-cols-3 gap-3">
              <div><FLabel text="Company ₹" /><input type="number" className={inp()} value={income.company} onChange={(e) => setIncome({ ...income, company: e.target.value })} /></div>
              <div><FLabel text="Individual ₹" /><input type="number" className={inp()} value={income.individual} onChange={(e) => setIncome({ ...income, individual: e.target.value })} /></div>
              <div><FLabel text="Rental ₹" /><input type="number" className={inp()} value={income.rental} onChange={(e) => setIncome({ ...income, rental: e.target.value })} /></div>
            </div>
          </S1Section>

          <S1Section title="Existing loans" onAdd={() => setLoans((p) => [...p, { lender: '', loanType: '', outstanding: '', emi: '' }])}>
            {loans.map((l, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_1fr_24px] gap-2 mb-2 items-center">
                <input className={inp()} placeholder="Lender" value={l.lender} onChange={(e) => setLoans((p) => p.map((x, j) => j === i ? { ...x, lender: e.target.value } : x))} />
                <input className={inp()} placeholder="Type" value={l.loanType} onChange={(e) => setLoans((p) => p.map((x, j) => j === i ? { ...x, loanType: e.target.value } : x))} />
                <input type="number" className={inp()} placeholder="Outstanding ₹" value={l.outstanding} onChange={(e) => setLoans((p) => p.map((x, j) => j === i ? { ...x, outstanding: e.target.value } : x))} />
                <input type="number" className={inp()} placeholder="EMI ₹" value={l.emi} onChange={(e) => setLoans((p) => p.map((x, j) => j === i ? { ...x, emi: e.target.value } : x))} />
                <button onClick={() => setLoans((p) => p.filter((_, j) => j !== i))} className="p-1 rounded hover:bg-(--shell-hover-hard)"><X size={13} style={{ color: '#f87171' }} /></button>
              </div>
            ))}
          </S1Section>

          <S1Section title="References (2)">
            {refs.map((r, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                <input className={inp()} placeholder="Name" value={r.name} onChange={(e) => setRefs((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input className={inp()} placeholder="Mobile" value={r.mobile} onChange={(e) => setRefs((p) => p.map((x, j) => j === i ? { ...x, mobile: e.target.value } : x))} />
                <input className={inp()} placeholder="Relation" value={r.relation} onChange={(e) => setRefs((p) => p.map((x, j) => j === i ? { ...x, relation: e.target.value } : x))} />
              </div>
            ))}
          </S1Section>

          <div><FLabel text="Notes — partner / director-as-applicant details, etc." /><textarea className={inp()} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={save} disabled={busy} className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>{busy ? 'Saving…' : 'Save Stage-1 data'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
function S1Section({ title, onAdd, children }: { title: string; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#C9A961' }}>{title}</p>
        {onAdd && <button onClick={onAdd} className="text-[11px] font-semibold" style={{ color: '#C9A961' }}>+ Add row</button>}
      </div>
      {children}
    </div>
  );
}

// ─── Applicants tab ───────────────────────────────────────────────────────────
function ApplicantsTab({ caseId, applicants, canWrite }: {
  caseId: string; applicants: Array<WithId<Applicant>>; canWrite: boolean;
}) {
  const toast = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState({ name: '', type: 'CO_APPLICANT', relationshipToPrimary: 'OTHER', mobile: '', pan: '', aadhaarLast4: '' });
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (f.name.trim().length < 2) { setServerError('Name required'); return; }
    setBusy(true); setServerError('');
    try {
      const r = await apiCrm2<{ ok: boolean; newTrackerRows: number }>('POST', `/api/crm2/cases/${caseId}/applicants`, f);
      toast.success(`Applicant added — ${r.newTrackerRows} document row(s) expanded`);
      setShowAdd(false); setF({ name: '', type: 'CO_APPLICANT', relationshipToPrimary: 'OTHER', mobile: '', pan: '', aadhaarLast4: '' });
    } catch (e) { setServerError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };

  const remove = async (aid: string, name: string) => {
    if (!confirm(`Remove applicant "${name}"? Tracker rows with files are kept.`)) return;
    try {
      const r = await apiCrm2<{ ok: boolean; removedRows: number; keptRowsWithFiles: number }>(
        'DELETE', `/api/crm2/cases/${caseId}/applicants/${aid}`);
      toast.success(`Removed — ${r.removedRows} empty row(s) deleted, ${r.keptRowsWithFiles} kept (have files)`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <div className="space-y-3">
      {canWrite && (
        <button onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
          <Plus size={15} /> Add Applicant
        </button>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        {applicants.map((a) => (
          <div key={a.id} className="glass-panel p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{a.name}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {a.type.replace('_', ' ')} · {a.relationshipToPrimary}
                </p>
              </div>
              {canWrite && a.type !== 'PRIMARY' && (
                <button onClick={() => remove(a.id, a.name)} className="p-1 rounded hover:bg-(--shell-hover-hard)" aria-label="Remove">
                  <X size={14} style={{ color: '#f87171' }} />
                </button>
              )}
            </div>
            <div className="mt-2 text-[11px] space-y-0.5" style={{ color: 'var(--text-muted)' }}>
              <p>Mobile: {a.mobile || '—'}</p>
              <p>PAN: {a.panLast4 ? `••••••${a.panLast4}` : '—'} · Aadhaar: {a.aadhaarLast4 ? `••••••••${a.aadhaarLast4}` : '—'}</p>
            </div>
          </div>
        ))}
        {applicants.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No applicants yet.</p>
        )}
      </div>

      {showAdd && (
        <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="glass-modal-panel w-full max-w-md rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="glass-modal-header px-5 py-4">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Add Applicant</h3>
            </div>
            <div className="p-5 space-y-3">
              {serverError && <p className="text-sm" style={{ color: '#f87171' }}>{serverError}</p>}
              <div><FLabel text="Name" required /><input className={inp()} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FLabel text="Type" required />
                  <SearchableSelect value={f.type} onChange={(v) => setF({ ...f, type: v })}
                    options={['CO_APPLICANT', 'GUARANTOR'].map((t) => ({ value: t, label: t.replace('_', ' ') }))} />
                </div>
                <div>
                  <FLabel text="Relationship" />
                  <SearchableSelect value={f.relationshipToPrimary} onChange={(v) => setF({ ...f, relationshipToPrimary: v })}
                    options={['SPOUSE', 'FATHER', 'MOTHER', 'PARTNER', 'DIRECTOR', 'OTHER'].map((r) => ({ value: r, label: r }))} />
                </div>
                <div><FLabel text="Mobile" /><input className={inp()} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></div>
                <div><FLabel text="PAN" /><input className={inp()} value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" /></div>
                <div>
                  <FLabel text="Aadhaar — LAST 4 ONLY" />
                  <input className={inp()} value={f.aadhaarLast4} maxLength={4}
                    onChange={(e) => setF({ ...f, aadhaarLast4: e.target.value.replace(/\D/g, '') })} placeholder="1234" />
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowAdd(false)} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
                  style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
                <button onClick={add} disabled={busy}
                  className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
                  style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                  {busy ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Documents tab — tracker grouped by stage + vault picker ─────────────────
const TRACKER_STATUSES = ['PENDING', 'REQUESTED', 'RECEIVED', 'VERIFIED', 'REJECTED_REUPLOAD', 'EXPIRED'];
const STAGE_GROUPS: Array<{ key: string; label: string; gate: string | null }> = [
  { key: 'LOGIN', label: 'Login documents', gate: 'Blocks stage → LOGIN until all VERIFIED' },
  { key: 'SANCTION', label: 'Sanction documents', gate: null },
  { key: 'DISBURSEMENT', label: 'Disbursement documents', gate: 'Checked by the disburse endpoint (Phase 4)' },
  { key: 'PDD', label: 'PDD documents', gate: 'Blocks PDD status → CLEARED until all VERIFIED' },
];

function DocumentsTab({ caseId, tracker, vaultDocs, clientId, defName, applicantName, docDefs, applicants, canWrite }: {
  caseId: string;
  tracker: Array<WithId<DocTrackerRow>>;
  vaultDocs: Array<WithId<VaultDoc>>;
  clientId: string;
  defName: (id: string) => string;
  applicantName: (id: string | null) => string;
  docDefs: Array<WithId<DocumentDef>>;
  applicants: Array<WithId<Applicant>>;
  canWrite: boolean;
}) {
  const toast = useToast();
  const [pickerFor, setPickerFor] = useState<WithId<DocTrackerRow> | null>(null);

  const patchRow = async (rowId: string, body: Record<string, unknown>, msg: string) => {
    try { await apiCrm2('PATCH', `/api/crm2/cases/${caseId}/doc-tracker/${rowId}`, body); toast.success(msg); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <div className="space-y-4">
      {STAGE_GROUPS.map((g) => {
        const rows = tracker.filter((r) => r.requiredByStage === g.key);
        if (rows.length === 0) return null;
        const verified = rows.filter((r) => r.status === 'VERIFIED').length;
        const gated = g.gate && verified < rows.length;
        return (
          <div key={g.key} className="glass-panel p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText size={14} style={{ color: '#C9A961' }} />
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{g.label}</h3>
              <span className="text-xs" style={{ color: verified === rows.length ? '#34d399' : 'var(--text-muted)' }}>
                {verified}/{rows.length} verified
              </span>
              {gated && (
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: '#fbbf24' }}>
                  <AlertTriangle size={11} /> {g.gate}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {rows.map((r) => {
                const linked = vaultDocs.find((v) => v.id === r.vaultDocId);
                return (
                  <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg" style={{ border: '1px solid var(--shell-border)' }}>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{defName(r.documentDefId)}</p>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {applicantName(r.applicantId)}
                        {linked ? <> · <a href={(linked as VaultDoc & { downloadUrl?: string }).downloadUrl} target="_blank" rel="noreferrer" className="underline" style={{ color: '#C9A961' }}>{linked.fileName}</a></> : ' · no file linked'}
                        {r.verifiedBy ? ` · verified by ${r.verifiedBy}` : ''}
                      </p>
                    </div>
                    {canWrite ? (
                      <>
                        <button onClick={() => setPickerFor(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border"
                          style={{ borderColor: 'rgba(201,169,97,0.35)', color: '#C9A961' }}>
                          <Upload size={11} /> {r.vaultDocId ? 'Change file' : 'Attach'}
                        </button>
                        <select className="glass-inp text-xs py-1.5" value={r.status}
                          onChange={(e) => patchRow(r.id, { status: e.target.value }, `→ ${e.target.value}`)}>
                          {TRACKER_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                        </select>
                      </>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: r.status === 'VERIFIED' ? 'rgba(52,211,153,0.15)' : 'var(--shell-hover-hard)',
                                 color: r.status === 'VERIFIED' ? '#34d399' : 'var(--text-muted)' }}>{r.status}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {tracker.length === 0 && (
        <div className="glass-panel p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No document requirements — link document types to this product in Masters → Documents.
        </div>
      )}

      {pickerFor && (
        <VaultPickerModal row={pickerFor} clientId={clientId} caseId={caseId}
          vaultDocs={vaultDocs} defName={defName} docDefs={docDefs} applicants={applicants}
          onClose={() => setPickerFor(null)}
          onLinked={(vid) => { patchRow(pickerFor.id, { vaultDocId: vid, status: 'RECEIVED' }, 'File linked'); setPickerFor(null); }} />
      )}
    </div>
  );
}

/** Pick an existing vault doc (upload once, reference everywhere) or upload new. */
function VaultPickerModal({ row, clientId, vaultDocs, defName, onClose, onLinked }: {
  row: WithId<DocTrackerRow>; clientId: string; caseId: string;
  vaultDocs: Array<WithId<VaultDoc>>; defName: (id: string) => string;
  docDefs: Array<WithId<DocumentDef>>; applicants: Array<WithId<Applicant>>;
  onClose: () => void; onLinked: (vaultDocId: string) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const candidates = vaultDocs.filter((v) => v.documentDefId === row.documentDefId && v.status === 'VALID');

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const res = await apiCrm2<{ ok: boolean; vaultDocId: string }>('POST', `/api/crm2/clients/${clientId}/vault`, {
        documentDefId: row.documentDefId, applicantId: row.applicantId,
        fileName: file.name, contentBase64: b64, contentType: file.type || 'application/octet-stream',
      });
      toast.success('Uploaded to vault');
      onLinked(res.vaultDocId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-md rounded-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{defName(row.documentDefId)}</h3>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Pick from the client vault or upload — files are stored once and referenced.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close">
            <X size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {candidates.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>In the vault</p>
              {candidates.map((v) => (
                <button key={v.id} onClick={() => onLinked(v.id)}
                  className="w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-2 hover:bg-(--shell-hover-soft) transition-colors"
                  style={{ border: '1px solid var(--shell-border)' }}>
                  <FileText size={14} style={{ color: '#C9A961' }} />
                  <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{v.fileName}</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{fmtTs(v.uploadedAt)}</span>
                </button>
              ))}
            </div>
          )}
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Upload new (max 10 MB)</span>
            <input type="file" disabled={busy} className="mt-1.5 block w-full text-xs" style={{ color: 'var(--text-muted)' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
          </label>
          {busy && <p className="text-xs" style={{ color: '#C9A961' }}>Uploading…</p>}
        </div>
      </div>
    </div>
  );
}
