/**
 * Pipeline → Leads — the CRM 2.0 lead funnel (spec §6 / §14).
 *
 * Lists NEW-MODEL leads only (the orderBy(receivedAt) query naturally excludes
 * legacy docs until the migration script stamps them). Funnel filter chips,
 * overdue follow-up highlighting, duplicate banner, activity drawer, convert
 * dialog. All mutations via /api/crm2/leads* — reads are live snapshots.
 */
import { useMemo, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot, doc, getDoc } from 'firebase/firestore';
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
import type { Crm2LeadFields, Crm2LeadStatus, Product, Client } from '../../../types/crm2';

type LeadRow = Crm2LeadFields & { id: string };

const STATUS_META: Record<Crm2LeadStatus, { label: string; color: string }> = {
  NEW:            { label: 'New',            color: '#60a5fa' },
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

const fmtTs = (t: { toDate?: () => Date } | null | undefined) =>
  t?.toDate ? t.toDate().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—';
const fmtTsFull = (t: { toDate?: () => Date } | null | undefined) =>
  t?.toDate ? t.toDate().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

function useCrm2Leads() {
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    // orderBy(receivedAt) only matches docs carrying the field → new-model leads.
    const q = query(collection(db, 'leads'), orderBy('receivedAt', 'desc'), limit(300));
    return onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LeadRow));
      setLoading(false);
    }, () => setLoading(false));
  }, []);
  return { rows, loading };
}

export function Crm2LeadsPage() {
  const { profile } = useAuth();
  const { rows, loading } = useCrm2Leads();
  const { employees } = useAllEmployees();
  const { rows: products } = useCrm2Collection<Product & { id: string }>('products');
  const { rows: clients } = useCrm2Collection<Client & { id: string }>('clients');

  const [funnel, setFunnel] = useState<Crm2LeadStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [detailFor, setDetailFor] = useState<LeadRow | null>(null);
  const [showNew, setShowNew] = useState(false);

  const canWrite = hasCrm2Perm(profile, 'crm.leads.write');
  const canConvert = hasCrm2Perm(profile, 'crm.cases.write');

  const faplOptions = useMemo(() =>
    employees
      .filter((e) => e.employeeStatus !== 'inactive' && e.employeeId)
      .map((e) => ({ value: e.employeeId!, label: `${e.displayName} (${e.employeeId})` })),
    [employees]);
  const productOptions = useMemo(() =>
    products.filter((p) => p.status === 'ACTIVE').map((p) => ({ value: p.id, label: `${p.name} (${p.shortCode})` })),
    [products]);

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
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Funnel: received → qualified → converted to client + case</p>
        </div>
        {canWrite && (
          <button onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            <Plus size={15} /> New Lead
          </button>
        )}
      </div>

      {/* Funnel chips */}
      <div className="flex gap-1.5 flex-wrap">
        {FUNNEL.map((s) => (
          <button key={s} onClick={() => setFunnel(s)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors"
            style={funnel === s
              ? { backgroundColor: 'rgba(201,169,97,0.15)', borderColor: '#C9A961', color: '#C9A961' }
              : { borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>
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
                <th className="text-left font-semibold px-3 py-2.5">RM</th>
                <th className="text-left font-semibold px-3 py-2.5">Follow-up</th>
                <th className="text-left font-semibold px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>
                  No leads{funnel !== 'ALL' ? ` in ${funnel}` : ' yet'}.
                </td></tr>
              ) : filtered.map((r) => {
                const overdue = r.nextFollowUpAt?.toMillis ? r.nextFollowUpAt.toMillis() < Date.now() : false;
                const sm = STATUS_META[r.status] ?? STATUS_META.NEW;
                return (
                  <tr key={r.id} onClick={() => setDetailFor(r)}
                    className="cursor-pointer hover:bg-(--shell-hover-soft) transition-colors"
                    style={{ borderTop: '1px solid var(--shell-border)' }}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{r.name}</p>
                          <p className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{r.id}</p>
                        </div>
                        {r.duplicateOfLeadId && (
                          <span title={`Possible duplicate of ${r.duplicateOfLeadId}`}
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>
                            <Copy size={10} /> DUP
                          </span>
                        )}
                        {r.priority === 'HOT' && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: 'rgba(248,113,113,0.15)', color: '#f87171' }}>HOT</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{r.mobile}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.category}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{r.source}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: r.assignedRm ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                      {r.assignedRm ?? 'unassigned'}
                    </td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: overdue ? '#f87171' : 'var(--text-muted)', fontWeight: overdue ? 700 : 400 }}>
                      {overdue && <AlertTriangle size={11} className="inline mr-1" />}{fmtTs(r.nextFollowUpAt)}
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
        <NewLeadModal faplOptions={faplOptions} productOptions={productOptions} onClose={() => setShowNew(false)} />
      )}
      {detail && (
        <LeadDrawer lead={detail} canWrite={canWrite} canConvert={canConvert}
          faplOptions={faplOptions} productOptions={productOptions} clients={clients}
          onClose={() => setDetailFor(null)} />
      )}
    </div>
  );
}

// ─── New lead ─────────────────────────────────────────────────────────────────
function NewLeadModal({ faplOptions, productOptions, onClose }: {
  faplOptions: Array<{ value: string; label: string }>;
  productOptions: Array<{ value: string; label: string }>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', mobile: '', email: '', city: '', category: 'LOAN', source: 'WALKIN', productId: '', amountRequired: '', assignedRm: '' });
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
        name: f.name, mobile: f.mobile, email: f.email || null, city: f.city || null,
        category: f.category, source: f.source, productId: f.productId || null,
        amountRequired: f.amountRequired ? Number(f.amountRequired) : null,
        assignedRm: f.assignedRm || null,
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
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
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
              <FLabel text="Name" required error={errs.name} />
              <input className={inp(!!errs.name)} value={f.name} onChange={(e) => set('name', e.target.value)} />
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
              <SearchableSelect value={f.category} onChange={(v) => set('category', v)}
                options={['LOAN', 'WEALTH', 'INSURANCE', 'CIBIL_CHECK', 'PARTNER_DSA', 'GENERAL'].map((c) => ({ value: c, label: c }))} />
            </div>
            <div>
              <FLabel text="Source" required />
              <SearchableSelect value={f.source} onChange={(v) => set('source', v)}
                options={['WALKIN', 'COLD_CALL', 'REFERRAL_CLIENT', 'REFERRAL_SUBDSA', 'JUSTDIAL', 'ADS', 'WEBSITE'].map((s) => ({ value: s, label: s }))} />
            </div>
            <div>
              <FLabel text="Product" />
              <SearchableSelect value={f.productId} onChange={(v) => set('productId', v)}
                options={[{ value: '', label: '—' }, ...productOptions]} placeholder="—" />
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
          </div>
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
function LeadDrawer({ lead, canWrite, canConvert, faplOptions, productOptions, clients, onClose }: {
  lead: LeadRow;
  canWrite: boolean; canConvert: boolean;
  faplOptions: Array<{ value: string; label: string }>;
  productOptions: Array<{ value: string; label: string }>;
  clients: Array<Client & { id: string }>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
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
            <p className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {lead.id} · {lead.mobile}{lead.email ? ` · ${lead.email}` : ''} · {lead.source}
            </p>
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
              </div>
              <div>
                <FLabel text="Priority" />
                <SearchableSelect value={lead.priority} disabled={busy}
                  onChange={(v) => patch({ priority: v }, `Priority → ${v}`)}
                  options={['HOT', 'WARM', 'COLD'].map((p) => ({ value: p, label: p }))} />
              </div>
              <div>
                <FLabel text="Next Follow-up" />
                <input type="datetime-local" className={inp()} disabled={busy}
                  defaultValue={lead.nextFollowUpAt?.toDate ? new Date(lead.nextFollowUpAt.toDate().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
                  onBlur={(e) => e.target.value && patch({ nextFollowUpAt: new Date(e.target.value).toISOString() }, 'Follow-up set')} />
              </div>
            </div>
          )}

          {canConvert && !lead.converted && lead.status === 'QUALIFIED' && (
            <button onClick={() => setShowConvert(true)}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              Convert {lead.category === 'PARTNER_DSA' ? 'to Sub-DSA' : 'to Client + Case'} <ArrowRight size={15} />
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
  productOptions: Array<{ value: string; label: string }>;
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
            {isPartner ? 'Convert to Sub-DSA' : 'Convert Lead → Client + Case'}
          </h3>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {isPartner
              ? 'Creates the sub-DSA master record from this partner application.'
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
                  <SearchableSelect value={productId} onChange={setProductId} options={productOptions} placeholder="Select product…" />
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
