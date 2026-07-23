/**
 * Case workspace (spec §14) — header with the 10-stage stepper + read-only
 * payout badge; tabs: Details / Applicants / Documents / Payout / History.
 *
 * Money mirror reads from cases/{id}/private/payout (key-gated subdoc per the
 * recorded decision); shown only with payout.amounts.read and "—" until the
 * Phase 4 disburse transaction writes it. All mutations via /api/crm2/*.
 */
import { useEffect, useMemo, useState } from 'react';
import { inr } from '../../../lib/money';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, doc, onSnapshot, orderBy, query as fsQuery } from 'firebase/firestore';
import { ArrowLeft, Check, ChevronRight } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { apiCrm2, useCrm2Collection, hasCrm2Perm, useRmName } from '../lib';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { STAGE_LABEL } from './Crm2CasesPage';
import { LoginsSection } from './LoginsSection';
import { EligibilityPanel, DriveLinkCard, CollaborationTab, ClientIdTab, DetailsTab } from './caseTabs';
import { Stage1Panel } from './caseStage1';
import { ApplicantsTab } from './caseApplicants';
import { DocumentsTab } from './caseDocuments';
import { payoutStatusLabel } from '../labels';
import { useConnectors } from '../../hrms/hooks/useConnectors';
import { CASE_LEVEL_STAGE_ORDER, type CaseLevelStage, CASE_PIPELINE, activeCasePipelineStage, type LoginStage, type Login, type Crm2Case, type Applicant, type DocTrackerRow, type StageHistoryEntry, type Client, type DocumentDef, type Lender, type Aggregator, type CasePayoutMirror, type VaultDoc, type SubProduct } from '../../../types/crm2';

export type WithId<T> = T & { id: string };
export const fmtTs = (t: { toDate?: () => Date } | null | undefined) =>
  t?.toDate ? t.toDate().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export function useSubcollection<T>(path: string[], orderField?: string, enabled = true) {
  const [rows, setRows] = useState<Array<T & { id: string }>>([]);
  useEffect(() => {
    if (!enabled) return;
    const ref = collection(db, path[0], ...path.slice(1));
    const q = orderField ? fsQuery(ref, orderBy(orderField, 'asc')) : ref;
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T & { id: string })),
      () => { /* permission-denied tolerated */ });
  }, [path.join('/'), orderField, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // Lazy-load: subscribe to a master/subcollection only when the active view needs
  // it (cuts mount-time Firestore contention — perf, no behaviour change; each view
  // gets its data the moment it's opened). Eager: caseDoc/client/mirror (header) +
  // logins + lenders (the stepper badges + tooltips need them on every view).
  const stage = caseDoc?.stage as string | undefined;
  const defStageN = stage === 'OPENED' ? 1 : stage === 'BASIC_DOCS' ? 2 : stage === 'DOCS' ? 3
    : (stage === 'COMPLETED' || stage === 'CLOSED') ? 10 : 4;   // IN_PROGRESS → login zone
  const shownN = typeof view === 'number' ? view : view == null ? defStageN : 0;
  const shownTab = typeof view === 'string' ? view : null;
  const needApplicants = shownN === 1 || shownN === 3;     // Stage 1 (Opened) + Stage 3 (applicantName)
  const needDocs = shownN === 3;                            // docTracker + vaultDocs + documentMaster
  const needHistory = shownTab === 'history';
  const needRouting = shownTab === 'details';               // aggregators + connectors pickers
  const needEmployees = shownTab === 'collab';

  const { employees } = useAllEmployees(needEmployees);
  const rmName = useRmName();

  const applicants = useSubcollection<Applicant>(['cases', caseId!, 'applicants'], undefined, needApplicants);
  const logins = useSubcollection<Login>(['cases', caseId!, 'logins'], 'seq');   // eager — stepper badges
  const tracker = useSubcollection<DocTrackerRow>(['cases', caseId!, 'docTracker'], undefined, needDocs);
  const history = useSubcollection<StageHistoryEntry>(['cases', caseId!, 'stageHistory'], 'at', needHistory);
  const vaultDocs = useSubcollection<VaultDoc>(client ? ['clients', client.id, 'vaultDocs'] : ['clients', '_none', 'vaultDocs'], undefined, needDocs);
  const { rows: docDefs } = useCrm2Collection<WithId<DocumentDef>>('documentMaster', needDocs);
  const { rows: lenders } = useCrm2Collection<WithId<Lender>>('lenders');   // eager — badge tooltips + details/logins
  const { rows: aggregators } = useCrm2Collection<WithId<Aggregator>>('aggregators', needRouting);
  const { rows: subProducts } = useCrm2Collection<WithId<SubProduct>>('subProducts', needRouting);   // case sub-product picker
  const { connectors } = useConnectors(needRouting);   // connectors (FAC-)

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

  // Active banks (logins) currently sitting at each login stage — drives the
  // per-stage notification badges (count) + the bank-name tooltip. MUST be
  // declared before the early return below so the hook order stays stable
  // across the loading → loaded transition (React error #310 otherwise).
  const activeBanksByStage = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of logins) {
      if (l.outcome === 'REJECTED' || l.outcome === 'WITHDRAWN') continue;
      const names = m.get(l.stage) ?? [];
      names.push(lenders.find((x) => x.id === l.lenderId)?.name ?? (l.lenderId ?? 'Bank'));
      m.set(l.stage, names);
    }
    return m;
  }, [logins, lenders]);

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

  const totalActiveBanks = logins.filter((l) => l.outcome !== 'REJECTED' && l.outcome !== 'WITHDRAWN').length;
  const banksAt = (s: string | undefined) => (s ? (activeBanksByStage.get(s) ?? []) : []);

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
            <div className="flex items-center gap-3 pt-1">
              <span className="text-xs font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                Per-bank files · stages 4–9
              </span>
              <span className="flex-1 h-px" style={{ backgroundColor: 'var(--shell-border)' }} />
            </div>
            <p className="text-[11px] px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(201,169,97,0.08)', color: 'var(--text-muted)' }}>
              From here each <b>bank/NBFC file</b> is worked on its own card below (one file → one bank). Each runs File&nbsp;Login → Code → In&nbsp;Process → Sanctioned → Disbursed → PDD/OTC — advance each with its own button. Add as many banks as you apply to.
            </p>
            <LoginsSection caseId={caseDoc.id} caseProductId={(caseDoc as { productId?: string }).productId ?? ''} caseSubProduct={caseDoc.subProduct ?? ''} canWrite={canWrite} />
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
      {/* Header + 10-stage clickable pipeline */}
      <div className="glass-panel p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <button onClick={() => navigate('/crm/pipeline/cases')} title="Back to all cases" aria-label="Back to all cases"
              className="mt-0.5 shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-(--shell-hover-hard)"
              style={{ border: '1px solid var(--shell-border)', color: 'var(--text-muted)' }}>
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <h2 className="text-2xl truncate" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
                {client?.name ?? caseDoc.clientId}
              </h2>
              <p className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {caseDoc.id} · RM {rmName(caseDoc.handlingRm)}
                {caseDoc.dsaCode ? ` · DSA ${caseDoc.dsaCode}` : ''}
                {caseDoc.subDsaId ? ` · via ${caseDoc.subDsaId}` : ' · self-sourced'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {totalActiveBanks > 0 && (
              <span className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-full"
                title={[...activeBanksByStage.values()].flat().join(', ')}
                style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: '#3B82F6' }}>
                {totalActiveBanks} {totalActiveBanks === 1 ? 'bank' : 'banks'} active
              </span>
            )}
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full"
              title="Payout status — mirrored from the Payout Cycle (read-only)"
              style={{ backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-muted)' }}>
              Payout: {payoutStatusLabel(caseDoc.payoutStatus)}
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

        {/* ── 10-stage clickable pipeline — click any stage to open + work it ── */}
        {/* Desktop / tablet: horizontal chip path with a green progress rail that
            fills as each case stage completes (done = green, current = gold). */}
        <div className="hidden md:flex items-start overflow-x-auto pb-1">
          {CASE_PIPELINE.map((sd, i) => {
            const n = sd.n, done = n < activeN, active = n === activeN, selected = n === selStageN;
            const isLast = i === CASE_PIPELINE.length - 1;
            return (
              <div key={sd.key} className="flex items-start" style={{ flex: isLast ? '0 0 auto' : '1 1 0%' }}>
                <button onClick={() => setView(n)}
                  className="flex flex-col items-center gap-1 shrink-0 w-[88px] px-1 py-1.5 rounded-lg transition-colors"
                  style={selected ? { backgroundColor: 'rgba(201,169,97,0.12)', border: '1px solid rgba(201,169,97,0.5)' } : { border: '1px solid transparent' }}>
                  <div className="relative">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
                      style={{ backgroundColor: done ? '#34d399' : active ? '#C9A961' : 'var(--shell-hover-hard)', color: done || active ? '#0B1538' : 'var(--text-dim)' }}>
                      {done ? <Check size={13} /> : n}
                    </div>
                    {sd.level === 'login' && banksAt(sd.loginStage).length > 0 && (
                      <span title={`${banksAt(sd.loginStage).length} bank(s): ${banksAt(sd.loginStage).join(', ')}`}
                        className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full flex items-center justify-center text-[9px] font-bold"
                        style={{ backgroundColor: '#3B82F6', color: '#fff', border: '1.5px solid var(--glass-panel-bg)' }}>
                        {banksAt(sd.loginStage).length}
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] font-semibold text-center leading-tight"
                    style={{ color: active || selected ? '#C9A961' : 'var(--text-muted)' }}>{sd.label}</span>
                </button>
                {!isLast && <div className="h-0.5 flex-1 min-w-2 mt-[19px]" style={{ backgroundColor: done ? '#34d399' : 'var(--shell-hover-hard)' }} />}
              </div>
            );
          })}
        </div>

        {/* Mobile: vertical timeline — reads top→bottom, each stage tappable. */}
        <div className="md:hidden">
          {CASE_PIPELINE.map((sd, i) => {
            const n = sd.n, done = n < activeN, active = n === activeN, selected = n === selStageN;
            const isLast = i === CASE_PIPELINE.length - 1;
            const banks = sd.level === 'login' ? banksAt(sd.loginStage) : [];
            return (
              <button key={sd.key} onClick={() => setView(n)} className="w-full flex items-stretch gap-3 text-left">
                {/* timeline rail */}
                <div className="flex flex-col items-center w-7 shrink-0">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={{
                      backgroundColor: done ? '#34d399' : active ? '#C9A961' : 'var(--shell-hover-hard)',
                      color: done || active ? '#0B1538' : 'var(--text-dim)',
                      boxShadow: active ? '0 0 0 3px rgba(201,169,97,0.22)' : 'none',
                    }}>
                    {done ? <Check size={14} /> : n}
                  </div>
                  {!isLast && <div className="w-0.5 flex-1 min-h-3 my-0.5" style={{ backgroundColor: done ? '#34d399' : 'var(--shell-hover-hard)' }} />}
                </div>
                {/* stage row */}
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-colors"
                    style={selected
                      ? { backgroundColor: 'rgba(201,169,97,0.12)', border: '1px solid rgba(201,169,97,0.5)' }
                      : { border: '1px solid transparent' }}>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: active || selected ? '#C9A961' : 'var(--text-primary)' }}>{sd.label}</p>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        Stage {n}{done ? ' · done' : active ? ' · current' : ''}{banks.length > 0 ? ` · ${banks.length} bank${banks.length === 1 ? '' : 's'}` : ''}
                      </p>
                    </div>
                    {banks.length > 0
                      ? <span title={banks.join(', ')} className="shrink-0 min-w-5 h-5 px-1.5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: '#3B82F6', color: '#fff' }}>{banks.length}</span>
                      : <ChevronRight size={15} className="shrink-0" style={{ color: 'var(--text-dim)' }} />}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Glance tabs on the LEFT (in the old Close spot) · Close on the RIGHT */}
        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
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
          {canWrite && caseDoc.stage !== 'CLOSED' && caseDoc.stage !== 'COMPLETED' && (
            <button onClick={() => { const r = prompt('Close early — reason (recorded):'); if (r !== null) advance('CLOSED', r.toLowerCase().includes('withdraw') ? 'WITHDRAWN' : 'REJECTED'); }}
              className="px-4 py-2 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'rgba(248,113,113,0.4)', color: '#f87171' }}>
              Close (reject/withdraw)
            </button>
          )}
        </div>
      </div>

      {/* Main panel — either a pipeline stage workspace or a glance view */}
      {typeof effView === 'number' ? stagePanel(effView)
        : effView === 'details' ? (
          <DetailsTab caseDoc={caseDoc} lenders={lenders} aggregators={aggregators} subProducts={subProducts}
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
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{rmName(h.by)} · {fmtTs(h.at)}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
