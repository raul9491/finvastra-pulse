/**
 * The case workspace's glance tabs and the two small stage panels:
 * Eligibility (stage 2), the Drive folder link (stage 3), Collaboration,
 * Client-ID data and Details.
 * 
 * Extracted verbatim from CaseWorkspacePage.tsx (2026-07-23) - no behaviour
 * change. NOTE: money here is DISPLAY ONLY and stays gated on
 * payout.amounts.read; every figure is server-calculated (see the crm2 money
 * pipeline in server/crm2.ts + the tested src/lib/crm2/payout.ts).
 */
import type {
  Crm2Case, Client, Lender, Aggregator, SubProduct, CasePayoutMirror, Crm2CaseTask,
} from '../../../types/crm2';
import type { WithId } from './CaseWorkspacePage';
import { fmtTs, useSubcollection } from './CaseWorkspacePage';
import { useNavigate } from 'react-router-dom';
import { Stage1Panel } from './caseStage1';
import { useEffect, useMemo, useState } from 'react';
import { apiCrm2, useRmName } from '../lib';
import { FLabel, inp } from '../formPrimitives';
import { useToast } from '../../../components/ui/Toast';
import { inr } from '../../../lib/money';
import { X, Check } from 'lucide-react';
import { SearchableSelect, MultiSearchableSelect } from '../../../components/ui/SearchableSelect';
import type { Connector } from '../../../types';

// ─── Stage 2 — Basic Docs + Eligibility (CIBIL taken + per-applicant issues) ───
export function EligibilityPanel({ caseDoc, canWrite, patchCase, onGoDocs }: {
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
export function DriveLinkCard({ caseDoc, canWrite, patchCase }: {
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
export function CollaborationTab({ caseDoc, employees, canWrite, canManage }: {
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
export function ClientIdTab({ client }: { client: (Client & { id: string }) | null }) {
  const navigate = useNavigate();
  const rmName = useRmName();
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
        <Row k="Owner RM" v={rmName(client.ownerRm)} />
        <Row k="KYC" v={client.kycStatus} />
        <Row k="Latest CIBIL" v={client.latestCibil ? String(client.latestCibil.score) : null} />
        <Row k="Registered Address" v={addr} />
      </div>
    </div>
  );
}

// ─── Details tab ──────────────────────────────────────────────────────────────
export function DetailsTab({ caseDoc, lenders, aggregators, subProducts, connectors, canWrite, canSeeMoney, mirror, patchCase }: {
  connectors: Connector[];
  caseDoc: Crm2Case & { id: string };
  lenders: Array<WithId<Lender>>; aggregators: Array<WithId<Aggregator>>;
  subProducts: Array<WithId<SubProduct>>;
  canWrite: boolean; canSeeMoney: boolean; mirror: CasePayoutMirror | null;
  patchCase: (body: Record<string, unknown>, msg: string) => Promise<void>;
}) {
  // Sub-products come from the SubProduct master, scoped to the case's product.
  const caseSubProducts = subProducts
    .filter((sp) => sp.productId === caseDoc.productId && sp.status !== 'INACTIVE')
    .map((sp) => sp.name)
    .filter((v, i, a) => v && a.indexOf(v) === i);
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
        {caseSubProducts.length > 0 && (
          <Row label="Sub-product">
            {canWrite ? (
              <SearchableSelect value={caseDoc.subProduct ?? ''} placeholder="— whole product —"
                onChange={(v) => patchCase({ subProduct: v || null }, 'Sub-product saved')}
                options={[{ value: '', label: '— whole product —' }, ...caseSubProducts.map((s) => ({ value: s, label: s }))]} />
            ) : (caseDoc.subProduct ?? '— whole product —')}
          </Row>
        )}
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
        <Row label="Connector (Sourced By)">
          {canWrite ? (
            <SearchableSelect value={caseDoc.channelPartnerId ?? ''} placeholder="— self-sourced —"
              onChange={(v) => { const p = connectors.find((c) => c.id === v);
                patchCase(p ? { channelPartnerId: p.id, channelPartnerCode: p.connectorCode, channelPartnerName: p.displayName }
                            : { channelPartnerId: null, channelPartnerCode: null, channelPartnerName: null }, 'Connector saved'); }}
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
