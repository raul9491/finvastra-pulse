/**
 * Pipeline → Cases — list + manual case open (walk-ins). Row click → workspace.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { Plus, X } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { isSuperAdmin } from '../../../config/hrmsConfig';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { apiCrm2, useCrm2Collection, hasCrm2Perm } from '../lib';
import { FLabel, inp } from '../masters/MastersPage';
import { CASE_LEVEL_STAGE_ORDER, type Crm2Case, type Client, type Product } from '../../../types/crm2';

type CaseRow = Crm2Case & { id: string };

// Case-level stage labels (Phase 4 cutover). Legacy + login-stage keys are kept as
// fallbacks so the shared stageHistory timeline renders any value cleanly.
export const STAGE_LABEL: Record<string, string> = {
  OPENED: 'Opened', BASIC_DOCS: 'Basic Docs', DOCS: 'Docs', IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed', CLOSED: 'Closed',
  ELIGIBILITY: 'Eligibility', DOC_COLLECTION: 'Docs', CODE_ASSIGNMENT: 'Code', LOGIN: 'Login',
  UNDER_PROCESS: 'In Process', SANCTIONED: 'Sanctioned', DISBURSED: 'Disbursed', PDD_OTC: 'PDD/OTC',
  FILE_LOGIN: 'File Login', CODE_LOGIN_DONE: 'Code+Login',
};
export const caseStageLabel = (s: string) => STAGE_LABEL[s] ?? s;

// Role-scoped cases (same model as the Leads page): managers / super-admins see
// ALL cases; everyone else sees only cases they handle (handlingRm) or are a
// collaborator on (Phase 6) — merged from two live queries, deduped.
function useScopedCases(seesAll: boolean, myFapl: string) {
  const [all, setAll] = useState<CaseRow[]>([]);
  const [mine, setMine] = useState<CaseRow[]>([]);
  const [collab, setCollab] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const map = (s: { docs: { id: string; data: () => unknown }[] }) =>
    s.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as CaseRow);

  useEffect(() => {
    const base = collection(db, 'cases');
    if (seesAll) {
      setLoading(true);
      return onSnapshot(query(base, orderBy('updatedAt', 'desc'), limit(200)),
        (s) => { setAll(map(s)); setLoading(false); }, () => setLoading(false));
    }
    setLoading(true);
    let a = false, b = false; const done = () => { if (a && b) setLoading(false); };
    const u1 = onSnapshot(query(base, where('handlingRm', '==', myFapl), orderBy('updatedAt', 'desc'), limit(200)),
      (s) => { setMine(map(s)); a = true; done(); }, () => { a = true; done(); });
    const u2 = onSnapshot(query(base, where('collaborators', 'array-contains', myFapl), orderBy('updatedAt', 'desc'), limit(200)),
      (s) => { setCollab(map(s)); b = true; done(); }, () => { b = true; done(); });
    return () => { u1(); u2(); };
  }, [seesAll, myFapl]);

  const rows = useMemo(() => {
    if (seesAll) return all;
    const m = new Map<string, CaseRow>();
    for (const r of [...mine, ...collab]) m.set(r.id, r);
    return [...m.values()].sort((x, y) => ((y.updatedAt as { toMillis?: () => number })?.toMillis?.() ?? 0) - ((x.updatedAt as { toMillis?: () => number })?.toMillis?.() ?? 0));
  }, [seesAll, all, mine, collab]);

  return { rows, loading };
}

export function Crm2CasesPage() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const { rows: clients } = useCrm2Collection<Client & { id: string }>('clients');
  const { rows: products } = useCrm2Collection<Product & { id: string }>('products');

  const isManager = profile?.role === 'admin' || profile?.crmRole === 'manager';
  // Managers / super-admins see ALL cases; everyone else only their own.
  const seesAll = isManager || isSuperAdmin(user?.uid ?? '', profile);
  const { rows, loading } = useScopedCases(seesAll, profile?.employeeId ?? '__none__');

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
  const productCode = (id: string) => products.find((p) => p.id === id)?.shortCode ?? id;
  const canWrite = hasCrm2Perm(profile, 'crm.cases.write');

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(r.stage, (c.get(r.stage) ?? 0) + 1);
    return c;
  }, [rows]);

  const filtered = rows.filter((r) =>
    (stageFilter === 'ALL' || r.stage === stageFilter)
    && (!search || r.id.toLowerCase().includes(search.toLowerCase())
        || clientName(r.clientId).toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            Pipeline Cases
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {seesAll ? '10-stage pipeline: opened → disbursed → closed' : 'Showing cases assigned to you or shared with you.'}
          </p>
        </div>
        {canWrite && (
          <button onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            <Plus size={15} /> Open Case
          </button>
        )}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {(['ALL', ...CASE_LEVEL_STAGE_ORDER, 'CLOSED'] as string[]).map((s) => (
          <button key={s} onClick={() => setStageFilter(s)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors"
            style={stageFilter === s
              ? { backgroundColor: 'rgba(201,169,97,0.15)', borderColor: '#C9A961', color: '#C9A961' }
              : { borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>
            {s === 'ALL' ? `All (${rows.length})` : `${STAGE_LABEL[s]} (${counts.get(s) ?? 0})`}
          </button>
        ))}
        <input className="glass-inp text-sm ml-auto w-56" placeholder="Search case / client…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="glass-panel p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                <th className="text-left font-semibold px-4 py-2.5">Case</th>
                <th className="text-left font-semibold px-3 py-2.5">Client</th>
                <th className="text-left font-semibold px-3 py-2.5">Product</th>
                <th className="text-left font-semibold px-3 py-2.5">RM</th>
                <th className="text-right font-semibold px-3 py-2.5">Requested ₹</th>
                <th className="text-right font-semibold px-3 py-2.5">Docs %</th>
                <th className="text-left font-semibold px-3 py-2.5">Stage</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>No cases yet.</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/crm/pipeline/cases/${r.id}`)}
                  className="cursor-pointer hover:bg-(--shell-hover-soft) transition-colors"
                  style={{ borderTop: '1px solid var(--shell-border)' }}>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold" style={{ color: '#C9A961' }}>{r.id}</td>
                  <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{clientName(r.clientId)}</td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{productCode(r.productId)}</td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.handlingRm}</td>
                  <td className="px-3 py-2.5 text-right text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {r.amountRequested ? `₹${Number(r.amountRequested).toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold"
                    style={{ color: r.docsCompletePct === 100 ? '#34d399' : 'var(--text-muted)' }}>
                    {r.docsCompletePct}%
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961' }}>{STAGE_LABEL[r.stage]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && canWrite && (
        <NewCaseModal clients={clients} products={products} onClose={() => setShowNew(false)}
          onCreated={(id) => navigate(`/crm/pipeline/cases/${id}`)} />
      )}
    </div>
  );
}

function NewCaseModal({ clients, products, onClose, onCreated }: {
  clients: Array<Client & { id: string }>;
  products: Array<Product & { id: string }>;
  onClose: () => void; onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const { employees } = useAllEmployees();
  const [clientId, setClientId] = useState('');
  const [productId, setProductId] = useState('');
  const [handlingRm, setHandlingRm] = useState('');
  const [amount, setAmount] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [applicantMobile, setApplicantMobile] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const faplOptions = employees
    .filter((e) => e.employeeStatus !== 'inactive' && e.employeeId)
    .map((e) => ({ value: e.employeeId!, label: `${e.displayName} (${e.employeeId})` }));

  const save = async () => {
    const e: Record<string, string> = {};
    if (!clientId) e.clientId = 'Required';
    if (!productId) e.productId = 'Required';
    if (Object.keys(e).length > 0) { setErrs(e); return; }
    setBusy(true); setServerError('');
    try {
      const r = await apiCrm2<{ ok: boolean; caseId: string }>('POST', '/api/crm2/cases', {
        clientId, productId, handlingRm: handlingRm || null,
        amountRequested: amount ? Number(amount) : null,
        primaryApplicant: applicantName.trim()
          ? { name: applicantName, mobile: applicantMobile } : null,
      });
      toast.success(`Case ${r.caseId} opened`);
      onClose(); onCreated(r.caseId);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-md rounded-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Open Case (walk-in)</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close">
            <X size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {serverError && <p className="text-sm" style={{ color: '#f87171' }}>{serverError}</p>}
          <div>
            <FLabel text="Client" required error={errs.clientId} />
            <SearchableSelect value={clientId} onChange={setClientId} placeholder="Select client…"
              options={clients.filter((c) => c.status === 'ACTIVE').map((c) => ({ value: c.id, label: `${c.name} (${c.id})` }))} />
          </div>
          <div>
            <FLabel text="Product" required error={errs.productId} />
            <SearchableSelect value={productId} onChange={setProductId} placeholder="Select product…"
              options={products.filter((p) => p.status === 'ACTIVE').map((p) => ({ value: p.id, label: `${p.name} (${p.shortCode})` }))} />
          </div>
          <div>
            <FLabel text="Handling RM" />
            <SearchableSelect value={handlingRm} onChange={setHandlingRm} placeholder="Client owner (default)"
              options={[{ value: '', label: 'Client owner (default)' }, ...faplOptions]} />
          </div>
          <div>
            <FLabel text="Amount Requested ₹" />
            <input type="number" className={inp()} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FLabel text="Primary Applicant" />
              <input className={inp()} value={applicantName} onChange={(e) => setApplicantName(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <FLabel text="Applicant Mobile" />
              <input className={inp()} value={applicantMobile} onChange={(e) => setApplicantMobile(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={save} disabled={busy}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {busy ? 'Opening…' : 'Open Case'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
