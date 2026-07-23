/**
 * Pipeline → Leads — the CRM 2.0 lead funnel (spec §6 / §14).
 *
 * Lists NEW-MODEL leads only (the orderBy(receivedAt) query naturally excludes
 * legacy docs until the migration script stamps them). Funnel filter chips,
 * overdue follow-up highlighting, duplicate banner, activity drawer, convert
 * dialog. All mutations via /api/crm2/leads* — reads are live snapshots.
 */
import { useMemo, useState } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { useEffect } from 'react';
import { Plus, AlertTriangle, Copy } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useToast } from '../../../components/ui/Toast';
import { apiCrm2, useCrm2Collection, hasCrm2Perm, useRmName } from '../lib';
import { ContactActions, PhoneLink } from '../../crm/components/ContactActions';
import { QueuePanel } from '../queue/QueuePanel';
import { useConnectors } from '../../hrms/hooks/useConnectors';
import { isSuperAdmin } from '../../../config/hrmsConfig';
import { sourceLabel, categoryLabel } from '../labels';
import { PRIORITY_META, type LeadRow, type ProductOpt } from './leadOptions';
import { NewLeadModal } from './NewLeadModal';
import { LeadDrawer } from './LeadDrawer';
import type { Crm2LeadStatus, Product, Client, SubDsa } from '../../../types/crm2';

export const STATUS_META: Record<Crm2LeadStatus, { label: string; color: string }> = {
  NEW:            { label: 'New',            color: '#60a5fa' },
  QUEUED:         { label: 'In Queue',       color: '#60a5fa' },
  ASSIGNED:       { label: 'Claimed',        color: '#C9A961' },
  ATTEMPTED:      { label: 'Attempted',      color: '#fbbf24' },
  CONTACTED:      { label: 'Contacted',      color: '#34d399' },
  QUALIFIED:      { label: 'Qualified',      color: '#C9A961' },
  JUNK_DUPLICATE: { label: 'Junk / Duplicate', color: '#8B8B85' },
  NOT_INTERESTED: { label: 'Not Interested', color: '#f87171' },
  NOT_ELIGIBLE:   { label: 'Not eligible', color: '#fb7185' },
  CONVERTED:      { label: 'Converted',      color: '#34d399' },
  DROPPED:        { label: 'Dropped',        color: '#f87171' },
};
const FUNNEL: Array<Crm2LeadStatus | 'ALL'> =
  ['ALL', 'NEW', 'ATTEMPTED', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'NOT_INTERESTED', 'NOT_ELIGIBLE', 'DROPPED', 'JUNK_DUPLICATE'];

export const fmtTsFull = (t: { toDate?: () => Date } | null | undefined) =>
  t?.toDate ? t.toDate().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// scopeFapl: null ⇒ see ALL leads (managers / super-admins). A string ⇒ only
// leads where assignedRm === that FAPL (telecallers see only what's assigned to
// them — they can't browse / mess with confirmed contacts).
export function useCrm2Leads(scopeFapl: string | null) {
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
  const rmName = useRmName();
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
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="h-display text-3xl" style={{ color: 'var(--text-primary)' }}>Leads</h1>
          </div>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {seesAll
              ? 'Qualified prospects on their way to becoming cases — received → qualified → converted.'
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
                // Reflect the ACTUAL stored priority. Website/social leads are created HOT
                // (red) by default, but a manual change in the drawer must stick + show here.
                const isHigh = r.priority === 'HOT';
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
                        <span title={`Priority: ${PRIORITY_META[r.priority]?.label ?? r.priority}`}
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: PRIORITY_META[r.priority]?.dot ?? '#8B8B85' }} />
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
                      {isHigh && (
                        <span className="ml-1.5 inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full align-middle cursor-help"
                          title="High priority — contact fast."
                          style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>HIGH</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtTsFull(r.receivedAt)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: r.assignedRm ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                      {r.assignedRm ? rmName(r.assignedRm) : 'unassigned'}
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
        <LeadDrawer lead={detail} canWrite={canWrite} canAssign={isManager} canConvert={canConvert}
          faplOptions={faplOptions} productOptions={productOptions} clients={clients}
          clientOptions={clientOptions} subDsaOptions={subDsaOptions} partnerOptions={partnerOptions} refData={refData}
          onClose={() => setDetailFor(null)} />
      )}
    </div>
  );
}
