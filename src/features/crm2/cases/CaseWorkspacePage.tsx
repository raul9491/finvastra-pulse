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
import { STAGE_LABEL } from './Crm2CasesPage';
import { LoginsSection } from './LoginsSection';
import {
  CASE_LEVEL_STAGE_ORDER, type CaseLevelStage,
  type Crm2Case, type Applicant, type DocTrackerRow,
  type StageHistoryEntry, type Client, type DocumentDef, type Lender, type Aggregator,
  type CasePayoutMirror, type VaultDoc,
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
  const [tab, setTab] = useState<'details' | 'applicants' | 'documents' | 'logins' | 'clientid' | 'history'>('details');

  const applicants = useSubcollection<Applicant>(['cases', caseId!, 'applicants']);
  const tracker = useSubcollection<DocTrackerRow>(['cases', caseId!, 'docTracker']);
  const history = useSubcollection<StageHistoryEntry>(['cases', caseId!, 'stageHistory'], 'at');
  const vaultDocs = useSubcollection<VaultDoc>(client ? ['clients', client.id, 'vaultDocs'] : ['clients', '_none', 'vaultDocs']);
  const { rows: docDefs } = useCrm2Collection<WithId<DocumentDef>>('documentMaster');
  const { rows: lenders } = useCrm2Collection<WithId<Lender>>('lenders');
  const { rows: aggregators } = useCrm2Collection<WithId<Aggregator>>('aggregators');

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

  const stageIdx = CASE_LEVEL_STAGE_ORDER.indexOf(caseDoc.stage as CaseLevelStage);
  const nextStage = caseDoc.stage !== 'CLOSED' && stageIdx >= 0 && stageIdx < CASE_LEVEL_STAGE_ORDER.length - 1
    ? CASE_LEVEL_STAGE_ORDER[stageIdx + 1] : null;

  const advance = async (to: CaseLevelStage | 'CLOSED', outcome?: string) => {
    try {
      await apiCrm2('POST', `/api/crm2/cases/${caseId}/stage`, { to, outcome });
      toast.success(`Stage → ${STAGE_LABEL[to]}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Transition failed');
    }
  };

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/crm/pipeline/cases')}
        className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={14} /> All cases
      </button>

      {/* Header */}
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

        {/* Case-level stage stepper (sanction/disburse/PDD are per-login → Logins tab) */}
        <div className="flex items-center gap-0 overflow-x-auto pb-1">
          {CASE_LEVEL_STAGE_ORDER.map((s, i) => {
            const done = i < stageIdx, active = i === stageIdx;
            return (
              <div key={s} className="flex items-center shrink-0">
                <div className="flex flex-col items-center gap-1 w-[84px]">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                    style={{ backgroundColor: done || active ? '#C9A961' : 'var(--shell-hover-hard)',
                             color: done || active ? '#0B1538' : 'var(--text-dim)' }}>
                    {done ? <Check size={12} /> : i + 1}
                  </div>
                  <span className="text-[9px] font-semibold text-center"
                    style={{ color: active ? '#C9A961' : 'var(--text-muted)' }}>{STAGE_LABEL[s]}</span>
                </div>
                {i < CASE_LEVEL_STAGE_ORDER.length - 1 && (
                  <div className="w-4 h-px mt-[-14px]" style={{ backgroundColor: done ? '#C9A961' : 'var(--shell-hover-hard)' }} />
                )}
              </div>
            );
          })}
        </div>

        {canWrite && caseDoc.stage !== 'CLOSED' && caseDoc.stage !== 'COMPLETED' && (
          <div className="flex flex-wrap gap-2">
            {nextStage && (
              <button onClick={() => advance(nextStage)}
                className="px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                {nextStage === 'IN_PROGRESS' ? 'Start logins (In Progress)' : nextStage === 'COMPLETED' ? 'Mark case Completed' : `Advance → ${STAGE_LABEL[nextStage]}`}
              </button>
            )}
            <button onClick={() => { const r = prompt('Close early — reason (recorded):'); if (r !== null) advance('CLOSED', r.toLowerCase().includes('withdraw') ? 'WITHDRAWN' : 'REJECTED'); }}
              className="px-4 py-2 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'rgba(248,113,113,0.4)', color: '#f87171' }}>
              Close (reject/withdraw)
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {(['details', 'applicants', 'documents', 'logins', 'clientid', 'history'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-3.5 py-2 rounded-lg text-sm font-semibold capitalize transition-colors"
            style={tab === t
              ? { backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' }
              : { color: 'var(--text-muted)', border: '1px solid var(--shell-border)' }}>
            {t === 'clientid' ? 'Client-ID data' : t}{t === 'documents' ? ` (${caseDoc.docsCompletePct}%)` : ''}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <DetailsTab caseDoc={caseDoc} lenders={lenders} aggregators={aggregators}
          canWrite={canWrite} canSeeMoney={canSeeMoney} mirror={mirror} patchCase={patchCase} />
      )}
      {tab === 'applicants' && (
        <ApplicantsTab caseId={caseDoc.id} applicants={applicants} canWrite={canWrite} />
      )}
      {tab === 'documents' && (
        <DocumentsTab caseId={caseDoc.id} tracker={tracker} vaultDocs={vaultDocs}
          clientId={caseDoc.clientId} defName={defName} applicantName={applicantName}
          docDefs={docDefs} applicants={applicants} canWrite={canWrite} />
      )}
      {tab === 'logins' && <LoginsSection caseId={caseDoc.id} canWrite={canWrite} />}
      {tab === 'clientid' && <ClientIdTab client={client} />}
      {tab === 'history' && (
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
function DetailsTab({ caseDoc, lenders, aggregators, canWrite, canSeeMoney, mirror, patchCase }: {
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
