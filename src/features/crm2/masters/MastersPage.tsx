/**
 * Pipeline → Masters — CRUD screens for the CRM 2.0 master collections:
 * Lenders · Products · Connectors (the `aggregators` collection — PLAN.md
 * decision 1) · Sub-DSAs · Documents · DSA Code Mappings (slab timeline).
 *
 * Reads are live Firestore subscriptions; every mutation goes through
 * /api/crm2/* (clients can never write these collections — rules deny).
 * Generic schema-driven forms keep the five simple masters compact; the
 * mapping editor (slab timeline, end-and-add flow) is purpose-built.
 */
import { useMemo, useState } from 'react';
import { Plus, Pencil, X, Landmark, Package, Network, Users2, FileText, GitBranch } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect, MultiSearchableSelect } from '../../../components/ui/SearchableSelect';
import { apiCrm2, useCrm2Collection, hasCrm2Perm } from '../lib';
import { MappingsTab } from './MappingsTab';
import type { Lender, Product, Aggregator, SubDsa, DocumentDef } from '../../../types/crm2';

type WithId<T> = T & { id: string };

// ─── Schema-driven form definition ───────────────────────────────────────────
export interface FieldDef {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'select' | 'multiselect' | 'date';
  required?: boolean;
  options?: Array<{ value: string; label: string }>;   // select/multiselect
  hint?: string;
  placeholder?: string;
  createOnly?: boolean;     // not editable after create (e.g. raw PAN re-entry optional)
}

const STATUS_AI = [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }];

export const inp = (bad?: boolean) =>
  `glass-inp w-full text-sm ${bad ? 'border-red-400! focus:ring-red-200/50!' : ''}`;

export function FLabel({ text, required, error }: { text: string; required?: boolean; error?: string }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
      style={{ color: error ? '#DC2626' : 'var(--text-muted)' }}>
      {text}{required && <span className="text-red-500 ml-0.5">*</span>}
      {error && <span className="ml-2 text-red-500 font-medium normal-case tracking-normal">— {error}</span>}
    </label>
  );
}

// ─── Generic master modal ─────────────────────────────────────────────────────
function MasterFormModal({ title, fields, initial, onSubmit, onClose }: {
  title: string;
  fields: FieldDef[];
  initial: Record<string, unknown> | null;     // null = create
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const f of fields) {
      const cur = initial?.[f.key];
      if (f.kind === 'multiselect') v[f.key] = Array.isArray(cur) ? cur : [];
      else if (f.kind === 'date') {
        const ts = cur as { toDate?: () => Date } | null;
        v[f.key] = ts?.toDate ? ts.toDate().toISOString().slice(0, 10) : (cur ?? '');
      }
      else v[f.key] = cur ?? '';
    }
    return v;
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: unknown) => {
    setValues((p) => ({ ...p, [k]: v }));
    if (errs[k]) setErrs((p) => { const n = { ...p }; delete n[k]; return n; });
  };

  const handleSave = async () => {
    const e: Record<string, string> = {};
    for (const f of fields) {
      if (!f.required) continue;
      const v = values[f.key];
      if (f.kind === 'multiselect' ? (v as string[]).length === 0 : !String(v ?? '').trim()) {
        e[f.key] = 'Required';
      }
    }
    if (Object.keys(e).length > 0) { setErrs(e); return; }
    setErrs({}); setServerError(''); setBusy(true);
    try {
      const out: Record<string, unknown> = {};
      for (const f of fields) {
        if (initial && f.createOnly) continue;
        const v = values[f.key];
        if (f.kind === 'number') out[f.key] = String(v ?? '').trim() === '' ? null : Number(v);
        else if (f.kind === 'multiselect') out[f.key] = v;
        else out[f.key] = String(v ?? '').trim() || null;
      }
      await onSubmit(out);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Save failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close">
            <X size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {serverError && (
            <div className="px-3.5 py-2.5 rounded-lg text-sm whitespace-pre-line"
              style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#f87171' }}>
              {serverError}
            </div>
          )}
          {fields.map((f) => (initial && f.createOnly) ? null : (
            <div key={f.key}>
              <FLabel text={f.label} required={f.required} error={errs[f.key]} />
              {f.kind === 'select' ? (
                <SearchableSelect
                  options={f.options ?? []}
                  value={String(values[f.key] ?? '')}
                  onChange={(v) => set(f.key, v)}
                  placeholder={f.placeholder ?? 'Select…'}
                />
              ) : f.kind === 'multiselect' ? (
                <MultiSearchableSelect
                  options={f.options ?? []}
                  value={values[f.key] as string[]}
                  onChange={(v) => set(f.key, v)}
                  placeholder={f.placeholder ?? 'Select…'}
                />
              ) : (
                <input
                  type={f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'}
                  className={inp(!!errs[f.key])}
                  value={String(values[f.key] ?? '')}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
              {f.hint && <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>{f.hint}</p>}
            </div>
          ))}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={handleSave} disabled={busy}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {busy ? 'Saving…' : initial ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Generic master tab (list + add/edit) ────────────────────────────────────
function MasterTab<T extends { id: string; name: string; status: string }>({
  type, label, fields, columns,
}: {
  type: string;                       // API master type == collection name
  label: string;
  fields: FieldDef[];
  columns: Array<{ header: string; render: (row: T) => React.ReactNode }>;
}) {
  const { rows, loading, error } = useCrm2Collection<T>(type);
  const toast = useToast();
  const [modal, setModal] = useState<{ initial: (Record<string, unknown> & { id?: string }) | null } | null>(null);
  const [search, setSearch] = useState('');

  const filtered = rows.filter((r) =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input className="glass-inp text-sm w-64" placeholder={`Search ${label.toLowerCase()}…`}
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <button onClick={() => setModal({ initial: null })}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
          <Plus size={15} /> Add {label.replace(/s$/, '')}
        </button>
      </div>

      {error && <div className="glass-panel p-4 text-sm" style={{ color: '#f87171' }}>{error}</div>}

      <div className="glass-panel p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                <th className="text-left font-semibold px-4 py-2.5">ID</th>
                <th className="text-left font-semibold px-3 py-2.5">Name</th>
                {columns.map((c) => <th key={c.header} className="text-left font-semibold px-3 py-2.5">{c.header}</th>)}
                <th className="text-left font-semibold px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4 + columns.length} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4 + columns.length} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                  No {label.toLowerCase()} yet — add the first one.
                </td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--shell-border)', opacity: r.status === 'ACTIVE' ? 1 : 0.55 }}>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold" style={{ color: '#C9A961' }}>{r.id}</td>
                  <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{r.name}</td>
                  {columns.map((c) => <td key={c.header} className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{c.render(r)}</td>)}
                  <td className="px-3 py-2.5">
                    <span className={r.status === 'ACTIVE' ? 'badge-glass-success' : 'badge-glass-muted'}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button onClick={() => setModal({ initial: r as unknown as Record<string, unknown> & { id: string } })}
                      className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Edit">
                      <Pencil size={14} style={{ color: 'var(--text-muted)' }} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <MasterFormModal
          title={modal.initial ? `Edit ${modal.initial.id}` : `New ${label.replace(/s$/, '')}`}
          fields={fields}
          initial={modal.initial}
          onClose={() => setModal(null)}
          onSubmit={async (values) => {
            if (modal.initial?.id) {
              await apiCrm2('PATCH', `/api/crm2/masters/${type}/${modal.initial.id}`, values);
              toast.success('Saved');
            } else {
              const r = await apiCrm2('POST', `/api/crm2/masters/${type}`, values);
              toast.success(`Created ${r.id}`);
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'lenders',        label: 'Lenders',    Icon: Landmark },
  { key: 'products',       label: 'Products',   Icon: Package },
  { key: 'aggregators',    label: 'Connectors', Icon: Network },
  { key: 'mappings',       label: 'DSA Codes',  Icon: GitBranch },
  { key: 'subDsas',        label: 'Sub-DSAs',   Icon: Users2 },
  { key: 'documentMaster', label: 'Documents',  Icon: FileText },
] as const;

export function Crm2MastersPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<typeof TABS[number]['key']>('lenders');

  const { rows: products } = useCrm2Collection<WithId<Product>>('products');
  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: `${p.name} (${p.shortCode})` })), [products]);

  const canWrite = hasCrm2Perm(profile, 'crm.masters.write');

  if (!canWrite) {
    // NOTHING LOCKED rule: this page is only reachable via direct URL without the perm.
    return (
      <div className="glass-panel p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        Masters access not granted. Ask an admin for the <strong>crm.masters.write</strong> permission.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          Pipeline Masters
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Lenders, products, connectors, DSA code mappings, sub-DSAs and the document checklist
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={tab === key
              ? { backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' }
              : { color: 'var(--text-muted)', border: '1px solid var(--shell-border)' }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'lenders' && (
        <MasterTab<WithId<Lender>>
          type="lenders" label="Lenders"
          columns={[
            { header: 'Type', render: (r) => r.type?.replace('_', ' ') },
            { header: 'TAT (days)', render: (r) => r.tatBenchmarkDays ?? '—' },
          ]}
          fields={[
            { key: 'name', label: 'Lender Name', kind: 'text', required: true, placeholder: 'Fedbank Financial Services' },
            { key: 'type', label: 'Type', kind: 'select', required: true,
              options: [{ value: 'PSU_BANK', label: 'PSU Bank' }, { value: 'PRIVATE_BANK', label: 'Private Bank' }, { value: 'NBFC', label: 'NBFC' }, { value: 'HFC', label: 'HFC' }] },
            { key: 'productsOffered', label: 'Products Offered', kind: 'multiselect', options: productOptions },
            { key: 'loginEmail', label: 'Login Email', kind: 'text', hint: 'File-submission inbox, e.g. iob0432@iob.in' },
            { key: 'tatBenchmarkDays', label: 'TAT Benchmark (days)', kind: 'number', hint: 'Login → sanction SLA' },
            { key: 'status', label: 'Status', kind: 'select', options: STATUS_AI },
          ]}
        />
      )}

      {tab === 'products' && (
        <MasterTab<WithId<Product>>
          type="products" label="Products"
          columns={[
            { header: 'Code', render: (r) => r.shortCode },
            { header: 'Vertical', render: (r) => r.vertical },
          ]}
          fields={[
            { key: 'name', label: 'Product Name', kind: 'text', required: true, placeholder: 'Loan Against Property' },
            { key: 'shortCode', label: 'Short Code', kind: 'text', required: true, placeholder: 'LAP' },
            { key: 'vertical', label: 'Vertical', kind: 'select', required: true,
              options: [{ value: 'LOANS', label: 'Loans' }, { value: 'WEALTH', label: 'Wealth' }, { value: 'INSURANCE', label: 'Insurance' }, { value: 'CHANNEL_PARTNER', label: 'Channel Partner' }, { value: 'VAS', label: 'VAS' }] },
            { key: 'defaultRoiRange', label: 'Default ROI Range', kind: 'text', placeholder: '9.5%–12% (display only)' },
            { key: 'status', label: 'Status', kind: 'select', options: STATUS_AI },
          ]}
        />
      )}

      {tab === 'aggregators' && (
        <MasterTab<WithId<Aggregator>>
          type="aggregators" label="Connectors"
          columns={[
            { header: 'Type', render: (r) => r.type === 'MASTER_AGGREGATOR' ? 'Master' : 'Sub' },
            { header: 'TDS %', render: (r) => r.standardTdsPct ?? '—' },
            { header: 'Payout', render: (r) => r.payoutFrequency },
          ]}
          fields={[
            { key: 'name', label: 'Connector Name', kind: 'text', required: true, placeholder: 'Ruloans' },
            { key: 'type', label: 'Type', kind: 'select', required: true,
              options: [{ value: 'MASTER_AGGREGATOR', label: 'Master Aggregator' }, { value: 'SUB_AGGREGATOR', label: 'Sub Aggregator' }] },
            { key: 'empanelmentDate', label: 'Empanelment Date', kind: 'date' },
            { key: 'claimsEmail', label: 'Claims Email', kind: 'text', placeholder: 'needconfirmation@ruloans.vip' },
            { key: 'accountsEmail', label: 'Accounts Email', kind: 'text' },
            { key: 'billingEntityName', label: 'Billing Entity', kind: 'text', hint: 'Entity Finvastra invoices' },
            { key: 'billingGstin', label: 'Billing GSTIN', kind: 'text' },
            { key: 'payoutFrequency', label: 'Payout Frequency', kind: 'select', required: true,
              options: [{ value: 'MONTHLY', label: 'Monthly' }, { value: 'PER_CASE', label: 'Per Case' }] },
            { key: 'standardTdsPct', label: 'Standard TDS %', kind: 'number', required: true },
            { key: 'status', label: 'Status', kind: 'select', options: STATUS_AI },
          ]}
        />
      )}

      {tab === 'mappings' && <MappingsTab productOptions={productOptions} />}

      {tab === 'subDsas' && (
        <MasterTab<WithId<SubDsa>>
          type="subDsas" label="Sub-DSAs"
          columns={[
            { header: 'Type', render: (r) => r.type.replace('_', ' ') },
            { header: 'Mobile', render: (r) => r.mobile },
            { header: 'PAN', render: (r) => r.panLast4 ? `••••${r.panLast4}` : '—' },
          ]}
          fields={[
            { key: 'name', label: 'Name', kind: 'text', required: true },
            { key: 'type', label: 'Type', kind: 'select', required: true,
              options: [{ value: 'INDIVIDUAL', label: 'Individual' }, { value: 'CORPORATE', label: 'Corporate' }, { value: 'REFERRAL_CLIENT', label: 'Referral Client' }, { value: 'WALKIN_REFERRER', label: 'Walk-in Referrer' }] },
            { key: 'mobile', label: 'Mobile', kind: 'text', required: true, placeholder: '9876543210' },
            { key: 'email', label: 'Email', kind: 'text' },
            { key: 'city', label: 'City', kind: 'text' },
            { key: 'state', label: 'State', kind: 'text' },
            { key: 'pan', label: 'PAN', kind: 'text', createOnly: false, placeholder: 'ABCDE1234F',
              hint: 'Stored encrypted; only the last 4 are shown. Leave blank to keep the existing PAN.' },
            { key: 'gstin', label: 'GSTIN', kind: 'text' },
            { key: 'relationshipOwner', label: 'Relationship Owner (FAPL-xxx)', kind: 'text', required: true, placeholder: 'FAPL-012' },
            { key: 'onboardingDate', label: 'Onboarding Date', kind: 'date' },
            { key: 'status', label: 'Status', kind: 'select',
              options: [...STATUS_AI, { value: 'BLACKLISTED', label: 'Blacklisted' }] },
          ]}
        />
      )}

      {tab === 'documentMaster' && (
        <MasterTab<WithId<DocumentDef>>
          type="documentMaster" label="Documents"
          columns={[
            { header: 'Category', render: (r) => r.category.replace(/_/g, ' ') },
            { header: 'Applies To', render: (r) => r.applicableTo.replace(/_/g, ' ') },
            { header: 'Stage', render: (r) => r.requiredByStage },
            { header: 'Validity', render: (r) => r.validityDays ? `${r.validityDays}d` : '—' },
          ]}
          fields={[
            { key: 'name', label: 'Document Name', kind: 'text', required: true, placeholder: 'GST Certificate' },
            { key: 'category', label: 'Category', kind: 'select', required: true,
              options: [{ value: 'ENTITY_KYC', label: 'Entity KYC' }, { value: 'INDIVIDUAL_KYC', label: 'Individual KYC' }, { value: 'FINANCIALS', label: 'Financials' }, { value: 'PROPERTY', label: 'Property' }, { value: 'POST_SANCTION_PDD', label: 'Post-Sanction / PDD' }] },
            { key: 'applicableTo', label: 'Applies To', kind: 'select', required: true,
              options: [{ value: 'ENTITY', label: 'Entity' }, { value: 'EACH_APPLICANT', label: 'Each Applicant' }, { value: 'GUARANTOR', label: 'Guarantor' }, { value: 'PROPERTY', label: 'Property' }] },
            { key: 'mandatoryForProducts', label: 'Mandatory For Products', kind: 'multiselect', options: productOptions },
            { key: 'validityDays', label: 'Validity (days)', kind: 'number', hint: 'e.g. 30 for bank statements' },
            { key: 'requiredByStage', label: 'Required By Stage', kind: 'select', required: true,
              options: [{ value: 'LOGIN', label: 'Login' }, { value: 'SANCTION', label: 'Sanction' }, { value: 'DISBURSEMENT', label: 'Disbursement' }, { value: 'PDD', label: 'PDD' }] },
            { key: 'status', label: 'Status', kind: 'select', options: STATUS_AI },
          ]}
        />
      )}
    </div>
  );
}
