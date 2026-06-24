/**
 * Pipeline → Leads — the CRM 2.0 lead funnel (spec §6 / §14).
 *
 * Lists NEW-MODEL leads only (the orderBy(receivedAt) query naturally excludes
 * legacy docs until the migration script stamps them). Funnel filter chips,
 * overdue follow-up highlighting, duplicate banner, activity drawer, convert
 * dialog. All mutations via /api/crm2/leads* — reads are live snapshots.
 */
import { useMemo, useState } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, AlertTriangle, ArrowRight, Copy } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { apiCrm2, useCrm2Collection, hasCrm2Perm } from '../lib';
import { FLabel, inp } from '../masters/MastersPage';
import { useClientForm, ClientFieldsGrid, stateFromLead } from '../clients/ClientFormModal';
import { ContactActions, PhoneLink } from '../../crm/components/ContactActions';
import { QueuePanel } from '../queue/QueuePanel';
import { useQueueActions } from '../queue/useQueue';
import { useConnectors } from '../../hrms/hooks/useConnectors';
import { isSuperAdmin } from '../../../config/hrmsConfig';
import { sourceLabel, categoryLabel } from '../labels';
import type { Connector } from '../../../types';
import type { Crm2LeadFields, Crm2LeadStatus, Product, Client, SubDsa } from '../../../types/crm2';

/** Resolve a connector (FAC-) id → the channelPartner* attribution fields. */
function buildChannelPartner(partnerId: string, connectors: Connector[]) {
  const p = connectors.find((c) => c.id === partnerId);
  return p
    ? { channelPartnerId: p.id, channelPartnerCode: p.connectorCode, channelPartnerName: p.displayName }
    : { channelPartnerId: null, channelPartnerCode: null, channelPartnerName: null };
}

type LeadRow = Crm2LeadFields & { id: string };

// Priority shown as a Red / Yellow / Green traffic light (enum values unchanged).
const PRIORITY_META: Record<'HOT' | 'WARM' | 'COLD', { label: string; color: string; dot: string }> = {
  HOT:  { label: 'High',   color: '#f87171', dot: '#ef4444' },
  WARM: { label: 'Medium', color: '#fbbf24', dot: '#f59e0b' },
  COLD: { label: 'Low',    color: '#34d399', dot: '#22c55e' },
};
const PRIORITY_OPTS = (['HOT', 'WARM', 'COLD'] as const).map((p) => ({ value: p, label: `${PRIORITY_META[p].label} (${p === 'HOT' ? 'Red' : p === 'WARM' ? 'Yellow' : 'Green'})` }));

const STATUS_META: Record<Crm2LeadStatus, { label: string; color: string }> = {
  NEW:            { label: 'New',            color: '#60a5fa' },
  QUEUED:         { label: 'In Queue',       color: '#60a5fa' },
  ASSIGNED:       { label: 'Claimed',        color: '#C9A961' },
  ATTEMPTED:      { label: 'Attempted',      color: '#fbbf24' },
  CONTACTED:      { label: 'Contacted',      color: '#34d399' },
  QUALIFIED:      { label: 'Qualified',      color: '#C9A961' },
  JUNK_DUPLICATE: { label: 'Junk/Dup',       color: '#8B8B85' },
  NOT_INTERESTED: { label: 'Not Interested', color: '#f87171' },
  CONVERTED:      { label: 'Converted',      color: '#34d399' },
  DROPPED:        { label: 'Dropped',        color: '#f87171' },
};
const FUNNEL: Array<Crm2LeadStatus | 'ALL'> =
  ['ALL', 'NEW', 'ATTEMPTED', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'NOT_INTERESTED', 'DROPPED', 'JUNK_DUPLICATE'];
// Website + social leads are time-critical → always shown as HIGH (red) priority.
const HOT_SOURCES = new Set<string>(['WEBSITE', 'ADS']);

const fmtTsFull = (t: { toDate?: () => Date } | null | undefined) =>
  t?.toDate ? t.toDate().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// scopeFapl: null ⇒ see ALL leads (managers / super-admins). A string ⇒ only
// leads where assignedRm === that FAPL (telecallers see only what's assigned to
// them — they can't browse / mess with confirmed contacts).
function useCrm2Leads(scopeFapl: string | null) {
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    // orderBy(receivedAt) only matches docs carrying the field → new-model leads.
    const base = collection(db, 'leads');
    const q = scopeFapl
      ? query(base, where('assignedRm', '==', scopeFapl), orderBy('receivedAt', 'desc'), limit(300))
      : query(base, orderBy('receivedAt', 'desc'), limit(300));
    setLoading(true);
    return onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LeadRow));
      setLoading(false);
    }, () => setLoading(false));
  }, [scopeFapl]);
  return { rows, loading };
}

export function Crm2LeadsPage() {
  const { profile, user } = useAuth();
  const toast = useToast();
  const canWrite = hasCrm2Perm(profile, 'crm.leads.write');
  const canConvert = hasCrm2Perm(profile, 'crm.cases.write');
  const isManager = profile?.role === 'admin' || profile?.crmRole === 'manager';
  // Managers / super-admins see ALL leads; everyone else sees only their assigned.
  const seesAll = isManager || isSuperAdmin(user?.uid ?? '', profile);
  const scopeFapl = seesAll ? null : (profile?.employeeId ?? '__none__');
  const { rows, loading } = useCrm2Leads(scopeFapl);
  const { employees } = useAllEmployees();
  const { rows: products } = useCrm2Collection<Product & { id: string }>('products');
  const { rows: clients } = useCrm2Collection<Client & { id: string }>('clients');
  const { rows: subDsas } = useCrm2Collection<SubDsa & { id: string }>('subDsas');
  const { connectors } = useConnectors();   // connectors (FAC-)

  const [funnel, setFunnel] = useState<Crm2LeadStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [detailFor, setDetailFor] = useState<LeadRow | null>(null);
  const [showNew, setShowNew] = useState(false);

  const faplOptions = useMemo(() =>
    employees
      .filter((e) => e.employeeStatus !== 'inactive' && e.employeeId)
      .map((e) => ({ value: e.employeeId!, label: `${e.displayName} (${e.employeeId})` })),
    [employees]);
  const productOptions = useMemo<ProductOpt[]>(() =>
    products.filter((p) => p.status === 'ACTIVE').map((p) => ({ value: p.id, label: `${p.name} (${p.shortCode})`, cat: p.category ?? null })),
    [products]);
  const clientOptions = useMemo(() =>
    clients.filter((c) => c.status !== 'BLACKLISTED').map((c) => ({ value: c.id, label: `${c.name} · ${c.id}` })),
    [clients]);
  const subDsaOptions = useMemo(() =>
    subDsas.filter((s) => s.status === 'ACTIVE').map((s) => ({ value: s.id, label: `${s.name} (${s.id})` })),
    [subDsas]);
  const partnerOptions = useMemo(() =>
    connectors.filter((c) => c.status === 'active').map((c) => ({ value: c.id, label: `${c.displayName} (${c.connectorCode})` })),
    [connectors]);
  const refData = useMemo(() => ({ clients, subDsas, connectors }), [clients, subDsas, connectors]);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(r.status, (c.get(r.status) ?? 0) + 1);
    return c;
  }, [rows]);

  const filtered = rows.filter((r) =>
    (funnel === 'ALL' || r.status === funnel)
    && (!search || r.name?.toLowerCase().includes(search.toLowerCase())
        || r.mobile?.includes(search) || r.id.toLowerCase().includes(search.toLowerCase())));

  // Live detail row (snapshot keeps rows fresh; re-derive the selected one)
  const detail = detailFor ? rows.find((r) => r.id === detailFor.id) ?? detailFor : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            Pipeline Leads
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {seesAll
              ? 'Funnel: received → qualified → converted to client + case'
              : 'Showing leads assigned to you. Use “Get next lead”, or ask your manager to assign more.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isManager && rows.some((r) => !r.leadCode && !/^LD-\d{4}-\d+$/.test(r.id)) && (
            <button
              onClick={async () => {
                try {
                  const r = await apiCrm2<{ ok: boolean; coded: number; minted: number }>('POST', '/api/crm2/admin/backfill-lead-codes');
                  toast.success(`Lead codes assigned — ${r.minted} minted, ${r.coded} linked`);
                } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
              }}
              title="Give every lead an LD-YYYY-##### code (promoted customers keep their original record id)"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-primary)' }}>
              Assign LD- codes
            </button>
          )}
          {canWrite && (
            <button onClick={() => setShowNew(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              <Plus size={15} /> New Lead
            </button>
          )}
        </div>
      </div>

      {/* FIFO pull queue — Get next lead + (managers) live monitor */}
      <QueuePanel canWrite={canWrite} isManager={isManager}
        onOpenLead={(id) => { const r = rows.find((x) => x.id === id); if (r) setDetailFor(r); }} />

      {/* Funnel chips */}
      <div className="flex gap-1.5 flex-wrap">
        {FUNNEL.map((s) => (
          <button key={s} onClick={() => setFunnel(s)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors"
            style={funnel === s
              ? { backgroundColor: 'rgba(201,169,97,0.15)', borderColor: '#C9A961', color: '#C9A961' }
              : { borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>
            {s !== 'ALL' && <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_META[s].color }} />}
            {s === 'ALL' ? `All (${rows.length})` : `${STATUS_META[s].label} (${counts.get(s) ?? 0})`}
          </button>
        ))}
        <input className="glass-inp text-sm ml-auto w-56" placeholder="Search name / mobile / ID…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="glass-panel p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                <th className="text-left font-semibold px-4 py-2.5">Lead</th>
                <th className="text-left font-semibold px-3 py-2.5">Mobile</th>
                <th className="text-left font-semibold px-3 py-2.5">Category</th>
                <th className="text-left font-semibold px-3 py-2.5">Source</th>
                <th className="text-left font-semibold px-3 py-2.5">Received</th>
                <th className="text-left font-semibold px-3 py-2.5">RM</th>
                <th className="text-left font-semibold px-3 py-2.5">Follow-up</th>
                <th className="text-left font-semibold px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>
                  No leads{funnel !== 'ALL' ? ` in ${funnel}` : ' yet'}.
                </td></tr>
              ) : filtered.map((r) => {
                const overdue = r.nextFollowUpAt?.toMillis ? r.nextFollowUpAt.toMillis() < Date.now() : false;
                const sm = STATUS_META[r.status] ?? STATUS_META.NEW;
                const hotSource = HOT_SOURCES.has(r.source);   // website/social → red high priority
                return (
                  <tr key={r.id} onClick={() => setDetailFor(r)}
                    className="cursor-pointer hover:bg-(--shell-hover-soft) transition-colors"
                    style={{ borderTop: '1px solid var(--shell-border)' }}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{r.name}</p>
                          {r.customerName && r.customerName !== r.name && (
                            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Contact: {r.customerName}</p>
                          )}
                          <p className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{r.leadCode ?? r.id}</p>
                        </div>
                        {r.duplicateOfLeadId && (
                          <span title={`Possible duplicate of ${r.duplicateOfLeadId}`}
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>
                            <Copy size={10} /> DUP
                          </span>
                        )}
                        <span title={hotSource ? 'High priority · website/social lead' : `Priority: ${PRIORITY_META[r.priority]?.label ?? r.priority}`}
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: hotSource ? '#ef4444' : (PRIORITY_META[r.priority]?.dot ?? '#8B8B85') }} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <PhoneLink phone={r.mobile} className="text-xs" />
                        <ContactActions phone={r.mobile} email={r.email} name={r.name} size="sm" />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{categoryLabel(r.category)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {sourceLabel(r.source)}
                      {hotSource && (
                        <span className="ml-1.5 inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full align-middle cursor-help"
                          title="High priority — website / social lead. Contact fast."
                          style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>HIGH</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtTsFull(r.receivedAt)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: r.assignedRm ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                      {r.assignedRm ?? 'unassigned'}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: overdue ? '#f87171' : 'var(--text-muted)', fontWeight: overdue ? 700 : 400 }}>
                      {overdue && <AlertTriangle size={11} className="inline mr-1" />}{fmtTsFull(r.nextFollowUpAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: `${sm.color}1f`, color: sm.color }}>{sm.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && canWrite && (
        <NewLeadModal faplOptions={faplOptions} productOptions={productOptions}
          clientOptions={clientOptions} subDsaOptions={subDsaOptions} partnerOptions={partnerOptions} refData={refData}
          onClose={() => setShowNew(false)} />
      )}
      {detail && (
        <LeadDrawer lead={detail} canWrite={canWrite} canConvert={canConvert}
          faplOptions={faplOptions} productOptions={productOptions} clients={clients}
          clientOptions={clientOptions} subDsaOptions={subDsaOptions} partnerOptions={partnerOptions} refData={refData}
          onClose={() => setDetailFor(null)} />
      )}
    </div>
  );
}

// Shared option/data props for the lead forms.
type Opt = { value: string; label: string };
type ProductOpt = Opt & { cat: string | null };   // cat = product's lead category (filters the picker)
// Products whose category matches the lead's category (uncategorised show for all — legacy-safe).
const filterProductsByCat = (opts: ProductOpt[], cat: string) => opts.filter((o) => !o.cat || o.cat === cat);
type RefData = { clients: Array<Client & { id: string }>; subDsas: Array<SubDsa & { id: string }>; connectors: Connector[] };
const CATEGORY_OPTS = ['LOAN', 'WEALTH', 'INSURANCE', 'CIBIL_CHECK', 'PARTNER_DSA', 'GENERAL'].map((c) => ({ value: c, label: categoryLabel(c) }));
const SOURCE_OPTS = ['WALKIN', 'COLD_CALL', 'REFERRAL_CLIENT', 'REFERRAL_SUBDSA', 'JUSTDIAL', 'ADS', 'WEBSITE'].map((s) => ({ value: s, label: sourceLabel(s) }));
const CONSTITUTION_LEAD_OPTS = [{ value: '', label: '—' }, ...['INDIVIDUAL', 'PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PVT_LTD', 'HUF'].map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))];

/** Builds the referral payload (referredBy*) from the chosen source + picker value. */
function buildReferral(source: string, refSubDsaId: string, refClientId: string, refData: RefData) {
  if (source === 'REFERRAL_SUBDSA' && refSubDsaId) {
    const s = refData.subDsas.find((x) => x.id === refSubDsaId);
    return { referredById: refSubDsaId, referredByType: 'SUBDSA', referredByName: s?.name ?? null, referredByCode: refSubDsaId };
  }
  if (source === 'REFERRAL_CLIENT' && refClientId) {
    const c = refData.clients.find((x) => x.id === refClientId);
    return { referredById: refClientId, referredByType: 'CLIENT', referredByName: c?.name ?? null, referredByCode: null };
  }
  return { referredById: null, referredByType: null, referredByName: null, referredByCode: null };
}

// ─── New lead ─────────────────────────────────────────────────────────────────
function NewLeadModal({ faplOptions, productOptions, clientOptions, subDsaOptions, partnerOptions, refData, onClose }: {
  faplOptions: Opt[]; productOptions: ProductOpt[]; clientOptions: Opt[]; subDsaOptions: Opt[]; partnerOptions: Opt[];
  refData: RefData; onClose: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    name: '', customerName: '', mobile: '', email: '', city: '', category: 'LOAN', source: 'WALKIN',
    productId: '', amountRequired: '', assignedRm: '',
    linkedExistingClientId: '', refSubDsaId: '', refClientId: '', channelPartnerId: '',
    cpConstitution: '', cpBusinessName: '', cpTurnover: '', cpRequirements: '',
  });
  const [sameAsEntity, setSameAsEntity] = useState(true);
  const [showMore, setShowMore] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof f, v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errs[k]) setErrs((p) => { const n = { ...p }; delete n[k]; return n; });
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = 'Required';
    if (!/^[6-9]\d{9}$/.test(f.mobile.replace(/[\s-]/g, '').replace(/^\+91/, ''))) e.mobile = '10-digit mobile';
    if (Object.keys(e).length > 0) { setErrs(e); return; }
    setBusy(true); setServerError('');
    try {
      const r = await apiCrm2<{ ok: boolean; id: string; duplicateOf: { id: string } | null }>('POST', '/api/crm2/leads', {
        name: f.name, customerName: (sameAsEntity ? f.name : f.customerName.trim()) || f.name,
        mobile: f.mobile, email: f.email || null, city: f.city || null,
        category: f.category, source: f.source, productId: f.productId || null,
        amountRequired: f.amountRequired ? Number(f.amountRequired) : null,
        assignedRm: f.assignedRm || null,
        linkedExistingClientId: f.linkedExistingClientId || null,
        ...buildReferral(f.source, f.refSubDsaId, f.refClientId, refData),
        ...buildChannelPartner(f.channelPartnerId, refData.connectors),
        customerProfile: {
          constitution: f.cpConstitution || null, businessName: f.cpBusinessName || null,
          annualTurnover: f.cpTurnover ? Number(f.cpTurnover) : null, requirements: f.cpRequirements || null,
        },
      });
      toast.success(`Lead ${r.id} created${r.duplicateOf ? ' — flagged as possible duplicate' : ''}`);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Create failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4 sticky top-0 z-10">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>New Lead</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close">
            <X size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {serverError && (
            <div className="px-3.5 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#f87171' }}>
              {serverError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <FLabel text="Entity Name" required error={errs.name} />
              <input className={inp(!!errs.name)} value={f.name} onChange={(e) => set('name', e.target.value)}
                placeholder="Business / applicant entity" />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>Entity = the business / applicant. Customer = the person we actually call.</p>
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={sameAsEntity} onChange={(e) => setSameAsEntity(e.target.checked)} className="w-4 h-4 rounded" />
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Customer name same as entity name
                </span>
              </label>
              {!sameAsEntity && (
                <input className={inp()} value={f.customerName} onChange={(e) => set('customerName', e.target.value)}
                  placeholder="Contact person's name" />
              )}
            </div>
            <div>
              <FLabel text="Mobile" required error={errs.mobile} />
              <input className={inp(!!errs.mobile)} value={f.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="9876543210" />
            </div>
            <div>
              <FLabel text="Email" />
              <input className={inp()} value={f.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div>
              <FLabel text="Category" required />
              <SearchableSelect value={f.category} onChange={(v) => { set('category', v); set('productId', ''); }} options={CATEGORY_OPTS} />
            </div>
            <div>
              <FLabel text="Source" required />
              <SearchableSelect value={f.source} onChange={(v) => set('source', v)} options={SOURCE_OPTS} />
            </div>
            {/* Source-specific referral picker */}
            {f.source === 'REFERRAL_SUBDSA' && (
              <div className="col-span-2">
                <FLabel text="Referred by (Connector)" />
                <SearchableSelect value={f.refSubDsaId} onChange={(v) => set('refSubDsaId', v)}
                  options={[{ value: '', label: '— select —' }, ...subDsaOptions]} placeholder="— select —" />
              </div>
            )}
            {f.source === 'REFERRAL_CLIENT' && (
              <div className="col-span-2">
                <FLabel text="Referred by (Client)" />
                <SearchableSelect value={f.refClientId} onChange={(v) => set('refClientId', v)}
                  options={[{ value: '', label: '— select —' }, ...clientOptions]} placeholder="— select —" />
              </div>
            )}
            <div className="col-span-2 flex items-center gap-3 pt-1">
              <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Optional details</span>
              <span className="flex-1 h-px" style={{ backgroundColor: 'var(--shell-border)' }} />
            </div>
            <div>
              <FLabel text="Product" />
              <SearchableSelect value={f.productId} onChange={(v) => set('productId', v)}
                options={[{ value: '', label: '—' }, ...filterProductsByCat(productOptions, f.category)]} placeholder="—" />
            </div>
            <div>
              <FLabel text="Amount Required ₹" />
              <input type="number" className={inp()} value={f.amountRequired} onChange={(e) => set('amountRequired', e.target.value)} />
            </div>
            <div className="col-span-2">
              <FLabel text="Assign RM" />
              <SearchableSelect value={f.assignedRm} onChange={(v) => set('assignedRm', v)}
                options={[{ value: '', label: 'Unassigned' }, ...faplOptions]} placeholder="Unassigned" />
            </div>
            <div className="col-span-2">
              <FLabel text="Sourced by Connector" />
              <SearchableSelect value={f.channelPartnerId} onChange={(v) => set('channelPartnerId', v)}
                options={[{ value: '', label: '— none (self-sourced) —' }, ...partnerOptions]} placeholder="— none —" />
            </div>
            <div className="col-span-2">
              <FLabel text="Link existing client (optional)" />
              <SearchableSelect value={f.linkedExistingClientId} onChange={(v) => set('linkedExistingClientId', v)}
                options={[{ value: '', label: '— none —' }, ...clientOptions]} placeholder="— none —" />
            </div>
          </div>

          {/* Optional bigger client details */}
          <button type="button" onClick={() => setShowMore((v) => !v)}
            className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: '#C9A961' }}>
            {showMore ? '− Hide' : '+ More'} customer details
          </button>
          {showMore && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FLabel text="Constitution" />
                <SearchableSelect value={f.cpConstitution} onChange={(v) => set('cpConstitution', v)} options={CONSTITUTION_LEAD_OPTS} />
              </div>
              <div>
                <FLabel text="Business name" />
                <input className={inp()} value={f.cpBusinessName} onChange={(e) => set('cpBusinessName', e.target.value)} />
              </div>
              <div>
                <FLabel text="Annual turnover ₹" />
                <input type="number" className={inp()} value={f.cpTurnover} onChange={(e) => set('cpTurnover', e.target.value)} />
              </div>
              <div className="col-span-2">
                <FLabel text="Requirements" />
                <input className={inp()} value={f.cpRequirements} onChange={(e) => set('cpRequirements', e.target.value)} placeholder="e.g. ₹50L LAP, 10yr tenure" />
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={save} disabled={busy}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {busy ? 'Creating…' : 'Create Lead'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Detail drawer (activity log + actions + convert) ───────────────────────
/** Release a claimed lead back to the FIFO queue (preserves its place; bumps releaseCount). */
function ReleaseControl({ leadId, onReleased }: { leadId: string; onReleased: () => void }) {
  const { release } = useQueueActions();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try {
      const r = await release(leadId, reason.trim());
      onReleased();
      if (r.flagged) toast.error(`Released ${r.releaseCount}× — flagged for a manager`);
      setOpen(false); setReason('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Release failed');
    } finally { setBusy(false); }
  };
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        title="Return this lead to the shared queue so another agent can pick it up"
        className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border"
        style={{ borderColor: 'rgba(248,113,113,0.5)', color: '#f87171' }}>
        ↩ Release to queue
      </button>
    );
  }
  return (
    <div className="mt-1.5 space-y-1.5">
      <input className="glass-inp text-xs w-full" placeholder="Reason (optional)…"
        value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy}
          className="text-xs font-semibold px-3 py-1 rounded disabled:opacity-50" style={{ backgroundColor: '#f87171', color: '#fff' }}>
          {busy ? '…' : 'Release'}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs" style={{ color: 'var(--text-muted)' }}>Cancel</button>
      </div>
    </div>
  );
}

function LeadDrawer({ lead, canWrite, canConvert, faplOptions, productOptions, clients, clientOptions, subDsaOptions, partnerOptions, refData, onClose }: {
  lead: LeadRow;
  canWrite: boolean; canConvert: boolean;
  faplOptions: Opt[]; productOptions: ProductOpt[];
  clients: Array<Client & { id: string }>;
  clientOptions: Opt[]; subDsaOptions: Opt[]; partnerOptions: Opt[]; refData: RefData;
  onClose: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [followUpNote, setFollowUpNote] = useState(lead.nextFollowUpNote ?? '');
  const [busy, setBusy] = useState(false);
  const [showConvert, setShowConvert] = useState(false);

  const patch = async (body: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await apiCrm2('PATCH', `/api/crm2/leads/${lead.id}`, body);
      toast.success(okMsg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally { setBusy(false); }
  };

  const sm = STATUS_META[lead.status] ?? STATUS_META.NEW;
  const log = [...(lead.activityLog ?? [])].reverse();

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-xl rounded-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-start justify-between px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{lead.name}</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${sm.color}1f`, color: sm.color }}>{sm.label}</span>
            </div>
            {lead.customerName && lead.customerName !== lead.name && (
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Contact: <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{lead.customerName}</span></p>
            )}
            <p className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {lead.leadCode ?? lead.id} · {lead.mobile}{lead.email ? ` · ${lead.email}` : ''} · {sourceLabel(lead.source)}
            </p>
            {(lead.referredByName || lead.linkedExistingClientId || lead.channelPartnerName) && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {lead.channelPartnerName && <>Connector <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{lead.channelPartnerName}{lead.channelPartnerCode ? ` (${lead.channelPartnerCode})` : ''}</span></>}
                {lead.referredByName && <>{lead.channelPartnerName ? ' · ' : ''}Referred by <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{lead.referredByName}{lead.referredByCode ? ` (${lead.referredByCode})` : ''}</span></>}
                {lead.linkedExistingClientId && <> · Linked client <span className="font-mono" style={{ color: '#C9A961' }}>{lead.linkedExistingClientId}</span></>}
              </p>
            )}
            <div className="mt-2"><ContactActions phone={lead.mobile} email={lead.email} name={lead.name} size="sm" /></div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close">
            <X size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {lead.duplicateOfLeadId && (
            <div className="px-3.5 py-2.5 rounded-lg text-sm flex items-center gap-2"
              style={{ backgroundColor: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24' }}>
              <Copy size={14} /> Possible duplicate of <span className="font-mono">{lead.duplicateOfLeadId}</span> — review before working it.
            </div>
          )}
          {lead.converted && (
            <div className="px-3.5 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399' }}>
              Converted → {lead.linkedSubDsaId
                ? <span className="font-mono">{lead.linkedSubDsaId} (sub-DSA)</span>
                : <span className="font-mono">{lead.linkedClientId} / {lead.linkedCaseId}</span>}
            </div>
          )}

          {canWrite && !lead.converted && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FLabel text="Status" />
                <SearchableSelect value={lead.status} disabled={busy}
                  onChange={(v) => patch({ status: v }, `Status → ${v}`)}
                  options={(Object.keys(STATUS_META) as Crm2LeadStatus[])
                    .filter((s) => s !== 'CONVERTED')
                    .map((s) => ({ value: s, label: STATUS_META[s].label }))} />
              </div>
              <div>
                <FLabel text="Assigned RM" />
                <SearchableSelect value={lead.assignedRm ?? ''} disabled={busy}
                  onChange={(v) => patch({ assignedRm: v || null }, 'RM updated')}
                  options={[{ value: '', label: 'Unassigned' }, ...faplOptions]} placeholder="Unassigned" />
                {canWrite && lead.assignedRm && (
                  <ReleaseControl leadId={lead.id} onReleased={() => toast.success('Released back to the queue')} />
                )}
              </div>
              <div>
                <FLabel text="Priority" />
                <SearchableSelect value={lead.priority} disabled={busy}
                  onChange={(v) => patch({ priority: v }, `Priority → ${PRIORITY_META[v as 'HOT'].label}`)}
                  options={PRIORITY_OPTS} />
              </div>
              <div>
                <FLabel text="Next Follow-up" />
                <input type="datetime-local" className={inp()} disabled={busy}
                  defaultValue={lead.nextFollowUpAt?.toDate ? new Date(lead.nextFollowUpAt.toDate().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
                  onBlur={(e) => e.target.value && patch({ nextFollowUpAt: new Date(e.target.value).toISOString(), nextFollowUpNote: followUpNote || null }, 'Follow-up set — reminder will email you')} />
              </div>
              <div className="col-span-2">
                <FLabel text="Follow-up remark (emailed with the reminder)" />
                <input className={inp()} value={followUpNote} disabled={busy}
                  onChange={(e) => setFollowUpNote(e.target.value)}
                  onBlur={() => { if ((followUpNote ?? '') !== (lead.nextFollowUpNote ?? '')) patch({ nextFollowUpNote: followUpNote || null }, 'Remark saved'); }}
                  placeholder="e.g. Confirm income docs, discuss 9.2% offer" />
              </div>
              <div>
                <FLabel text="Sourced by Connector" />
                <SearchableSelect value={lead.channelPartnerId ?? ''} disabled={busy}
                  onChange={(v) => patch(v ? buildChannelPartner(v, refData.connectors) : { channelPartnerId: null, channelPartnerCode: null, channelPartnerName: null }, 'Connector updated')}
                  options={[{ value: '', label: '— none —' }, ...partnerOptions]} placeholder="— none —" />
              </div>
              <div>
                <FLabel text="Link existing client" />
                <SearchableSelect value={lead.linkedExistingClientId ?? ''} disabled={busy}
                  onChange={(v) => patch({ linkedExistingClientId: v || null }, v ? 'Client linked' : 'Client unlinked')}
                  options={[{ value: '', label: '— none —' }, ...clientOptions]} placeholder="— none —" />
              </div>
              {lead.source === 'REFERRAL_SUBDSA' && (
                <div className="col-span-2">
                  <FLabel text="Referred by (Connector)" />
                  <SearchableSelect value={lead.referredById ?? ''} disabled={busy}
                    onChange={(v) => patch(buildReferral('REFERRAL_SUBDSA', v, '', refData), 'Referral updated')}
                    options={[{ value: '', label: '— none —' }, ...subDsaOptions]} placeholder="— none —" />
                </div>
              )}
              {lead.source === 'REFERRAL_CLIENT' && (
                <div className="col-span-2">
                  <FLabel text="Referred by (Client)" />
                  <SearchableSelect value={lead.referredById ?? ''} disabled={busy}
                    onChange={(v) => patch(buildReferral('REFERRAL_CLIENT', '', v, refData), 'Referral updated')}
                    options={[{ value: '', label: '— none —' }, ...clientOptions]} placeholder="— none —" />
                </div>
              )}
            </div>
          )}

          {canConvert && !lead.converted && lead.status === 'QUALIFIED' && (
            <button onClick={() => setShowConvert(true)}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              Convert {lead.category === 'PARTNER_DSA' ? 'to Connector' : 'to Client + Case'} <ArrowRight size={15} />
            </button>
          )}
          {canConvert && !lead.converted && lead.status !== 'QUALIFIED' && (
            <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>
              Mark the lead QUALIFIED to enable conversion.
            </p>
          )}

          {/* Activity log */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
              Activity ({log.length})
            </p>
            {canWrite && (
              <div className="flex gap-2 mb-3">
                <input className={inp()} value={note} placeholder="Log a call / note…"
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && note.trim().length >= 3) { patch({ activity: { note, action: 'note' }, incrementAttempts: true }, 'Logged'); setNote(''); } }} />
                <button disabled={busy || note.trim().length < 3}
                  onClick={() => { patch({ activity: { note, action: 'note' }, incrementAttempts: true }, 'Logged'); setNote(''); }}
                  className="shrink-0 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
                  style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                  Log
                </button>
              </div>
            )}
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {log.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No activity yet.</p>
              ) : log.map((a, i) => (
                <div key={i} className="px-3 py-2 rounded-lg" style={{ border: '1px solid var(--shell-border)' }}>
                  <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{a.note}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {a.by} · {a.action} · {fmtTsFull(a.at)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {showConvert && (
          <ConvertModal lead={lead} faplOptions={faplOptions} productOptions={productOptions} clients={clients}
            onClose={() => setShowConvert(false)} onDone={onClose} />
        )}
      </div>
    </div>
  );
}

// ─── Convert wizard (resolve client → case) ─────────────────────────────────
function ConvertModal({ lead, faplOptions, productOptions, clients, onClose, onDone }: {
  lead: LeadRow;
  faplOptions: Array<{ value: string; label: string }>;
  productOptions: ProductOpt[];
  clients: Array<Client & { id: string }>;
  onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const isPartner = lead.category === 'PARTNER_DSA';

  // Suggest an existing client if one already matches the lead's mobile/email.
  const suggested = useMemo(() => {
    const keys = new Set<string>();
    if (lead.mobile) keys.add(`m:${lead.mobile.replace(/[\s-]/g, '').replace(/^\+91/, '')}`);
    if (lead.email) keys.add(`e:${lead.email.trim().toLowerCase()}`);
    return clients.find((c) => (c.dupeKeys ?? []).some((k) => keys.has(k)));
  }, [clients, lead.mobile, lead.email]);

  const [mode, setMode] = useState<'existing' | 'new'>(suggested ? 'existing' : 'new');
  const [productId, setProductId] = useState(lead.productId ?? '');
  const [handlingRm, setHandlingRm] = useState(lead.assignedRm ?? '');
  const [existingClientId, setExistingClientId] = useState(suggested?.id ?? '');
  const [caseLookup, setCaseLookup] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const form = useClientForm(stateFromLead(lead));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const clientOptions = useMemo(() =>
    clients.filter((c) => c.status !== 'BLACKLISTED').map((c) => ({
      value: c.id,
      label: `${c.name} · ${c.id}${c.primaryContact?.mobile ? ` · ${c.primaryContact.mobile}` : ''}`,
    })), [clients]);

  // Resolve an existing client from an old Case ID (FIN-CASE-…) or a Client ID.
  const resolveByCase = async () => {
    const id = caseLookup.trim();
    if (!id) return;
    setLookupBusy(true); setError('');
    try {
      const up = id.toUpperCase();
      if (up.startsWith('FCL-') || up.startsWith('CL-')) {   // FCL- (new) or legacy CL- client ids
        const cs = await getDoc(doc(db, 'clients', id));
        if (cs.exists()) { setExistingClientId(id); toast.success(`Client ${id} selected`); }
        else setError(`Client ${id} not found`);
      } else {
        const cs = await getDoc(doc(db, 'cases', id));
        const cid = cs.exists() ? (cs.data().clientId as string | undefined) : undefined;
        if (cid) { setExistingClientId(cid); toast.success(`Resolved to client ${cid}`); }
        else setError(`Case ${id} not found`);
      }
    } catch {
      setError('Lookup failed');
    } finally { setLookupBusy(false); }
  };

  const run = async () => {
    setError('');
    let body: Record<string, unknown>;
    if (isPartner) {
      body = { relationshipOwner: handlingRm || null };
    } else {
      if (!productId) { setError('Pick the product for the case'); return; }
      if (mode === 'existing') {
        if (!existingClientId) { setError('Select the existing client'); return; }
        body = { clientId: existingClientId, productId, handlingRm: handlingRm || null };
      } else {
        if (!form.validate()) { setError('Fix the highlighted client fields'); return; }
        body = { newClient: form.payload(), productId, handlingRm: handlingRm || null };
      }
    }
    setBusy(true);
    try {
      const r = await apiCrm2<{ ok: boolean; clientId?: string; caseId?: string; subDsaId?: string }>(
        'POST', `/api/crm2/leads/${lead.id}/convert`, body);
      if (r.subDsaId) {
        toast.success(`Sub-DSA ${r.subDsaId} created`);
        onClose(); onDone();
      } else {
        toast.success(`Converted → ${r.clientId} / ${r.caseId}`);
        onClose(); onDone();
        if (r.caseId) navigate(`/crm/pipeline/cases/${r.caseId}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conversion failed');
    } finally { setBusy(false); }
  };

  const wide = !isPartner && mode === 'new';

  return (
    <div className="glass-modal-overlay fixed inset-0 z-60 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`glass-modal-panel w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl max-h-[92vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header px-5 py-4 sticky top-0 z-10">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isPartner ? 'Convert to Connector' : 'Convert Lead → Client + Case'}
          </h3>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {isPartner
              ? 'Creates the connector master record from this partner application.'
              : 'Resolve the client (new or existing), then open the case in one transaction.'}
          </p>
        </div>
        <div className="p-5 space-y-4">
          {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}

          {!isPartner && (
            <>
              {/* Step 1 — new vs existing client */}
              <div className="grid grid-cols-2 gap-2">
                {(['existing', 'new'] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className="px-3 py-2 rounded-lg text-sm font-semibold border transition-colors"
                    style={mode === m
                      ? { backgroundColor: 'rgba(201,169,97,0.15)', borderColor: '#C9A961', color: '#C9A961' }
                      : { borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>
                    {m === 'existing' ? 'Existing client' : 'New client'}
                  </button>
                ))}
              </div>

              {mode === 'existing' ? (
                <div className="space-y-3">
                  <div>
                    <FLabel text="Client" required />
                    <SearchableSelect value={existingClientId} onChange={setExistingClientId}
                      options={clientOptions} placeholder="Search by name / client id / mobile…" />
                    {suggested && existingClientId === suggested.id && (
                      <p className="text-[11px] mt-1" style={{ color: '#34d399' }}>Matched this lead’s contact automatically.</p>
                    )}
                  </div>
                  <div>
                    <FLabel text="…or resolve by old Case ID / Client ID" />
                    <div className="flex gap-2">
                      <input className={inp()} value={caseLookup} onChange={(e) => setCaseLookup(e.target.value)}
                        placeholder="FIN-CASE-2026-0001 or FCL-2026-00001" />
                      <button onClick={resolveByCase} disabled={lookupBusy || !caseLookup.trim()}
                        className="shrink-0 px-3 py-2 rounded-lg text-sm font-semibold border disabled:opacity-40"
                        style={{ borderColor: 'var(--shell-border)', color: 'var(--text-primary)' }}>
                        {lookupBusy ? '…' : 'Find'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <ClientFieldsGrid form={form} />
              )}

              {/* Step 2 — case basics */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <FLabel text="Product" required />
                  <SearchableSelect value={productId} onChange={setProductId} options={filterProductsByCat(productOptions, lead.category)} placeholder="Select product…" />
                </div>
                <div>
                  <FLabel text="Handling RM" />
                  <SearchableSelect value={handlingRm} onChange={setHandlingRm}
                    options={[{ value: '', label: lead.assignedRm ? `Lead RM (${lead.assignedRm})` : 'Me' }, ...faplOptions]}
                    placeholder="Default" />
                </div>
              </div>
            </>
          )}

          {isPartner && (
            <div>
              <FLabel text="Relationship Owner" />
              <SearchableSelect value={handlingRm} onChange={setHandlingRm}
                options={[{ value: '', label: lead.assignedRm ? `Lead RM (${lead.assignedRm})` : 'Me' }, ...faplOptions]}
                placeholder="Default" />
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={run} disabled={busy}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {busy ? 'Converting…' : 'Convert'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
