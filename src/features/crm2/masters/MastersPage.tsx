/**
 * Pipeline → Masters — CRUD screens for the CRM 2.0 master collections:
 * Lenders · Products · Aggregators (the `aggregators` collection — PLAN.md
 * decision 1; UI relabelled "Aggregators" 2026-06-15) · Connectors (the
 * `subDsas` collection — relabelled "Connectors") · Documents · DSA Code
 * Mappings (slab timeline). NOTE: collection keys/field names (`aggregators`,
 * `subDsas`, `connectorId`) are unchanged — only the user-facing labels moved.
 *
 * Reads are live Firestore subscriptions; every mutation goes through
 * /api/crm2/* (clients can never write these collections — rules deny).
 * Generic schema-driven forms keep the five simple masters compact; the
 * mapping editor (slab timeline, end-and-add flow) is purpose-built.
 */
import { useMemo, useState, useEffect } from 'react';
import { Plus, Pencil, X, Landmark, Package, Network, FileText, GitBranch, Handshake, Layers, Gauge } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect, MultiSearchableSelect } from '../../../components/ui/SearchableSelect';
import { apiCrm2, useCrm2Collection } from '../lib';
import { isSuperAdmin } from '../../../config/hrmsConfig';
import { MappingsTab } from './MappingsTab';
import {
  useConnectors, nextConnectorCode, setConnectorStatus, getConnectorFinancial,
} from '../../hrms/hooks/useConnectors';
import { CONSTITUTION_OPTS } from '../clients/ClientFormModal';
import { computePartnerScore, computeOnboardingProgress, computePracticalAssessment, sanitizePartnerRubric, type PartnerRubric } from '../../../lib/crm2/partnerScoring';
import type { Connector, ConnectorVertical, ConnectorFinancial } from '../../../types';
import type { Lender, Product, Aggregator, DocumentDef, SubProduct } from '../../../types/crm2';

type WithId<T> = T & { id: string };

// ─── Schema-driven form definition ───────────────────────────────────────────
export interface FieldDef {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'select' | 'multiselect' | 'date' | 'rows' | 'taglist' | 'stringlist';
  required?: boolean;
  options?: Array<{ value: string; label: string }>;   // select/multiselect
  rowFields?: Array<{ key: string; label: string; kind?: 'text' | 'number' | 'select'; options?: Array<{ value: string; label: string }> }>;  // for kind: 'rows'
  addLabel?: string;        // for kind: 'stringlist' — the add-button text
  hint?: string;
  placeholder?: string;
  createOnly?: boolean;     // not editable after create (e.g. raw PAN re-entry optional)
}

// Repeating object-rows editor (aggregator contacts/emails, lender SM/ASM list).
function RowsEditor({ rowFields, value, onChange }: {
  rowFields: NonNullable<FieldDef['rowFields']>;
  value: Array<Record<string, string>>;
  onChange: (v: Array<Record<string, string>>) => void;
}) {
  const rows = Array.isArray(value) ? value : [];
  const upd = (i: number, k: string, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => onChange([...rows, Object.fromEntries(rowFields.map((f) => [f.key, '']))]);
  const del = (i: number) => onChange(rows.filter((_, j) => j !== i));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap gap-2 items-center">
          {rowFields.map((rf) => (
            <div key={rf.key} className="flex-1 min-w-24">
              {rf.kind === 'select' ? (
                <SearchableSelect value={String(r[rf.key] ?? '')} onChange={(v) => upd(i, rf.key, v)} options={rf.options ?? []} placeholder={rf.label} />
              ) : (
                <input className={inp()} type={rf.kind === 'number' ? 'number' : 'text'} placeholder={rf.label}
                  value={String(r[rf.key] ?? '')} onChange={(e) => upd(i, rf.key, e.target.value)} />
              )}
            </div>
          ))}
          <button onClick={() => del(i)} className="p-1 rounded hover:bg-(--shell-hover-hard)" aria-label="Remove row">
            <X size={13} style={{ color: '#f87171' }} />
          </button>
        </div>
      ))}
      <button onClick={add} className="text-xs font-semibold" style={{ color: '#C9A961' }}>+ Add</button>
    </div>
  );
}

// Explicit string-list editor (e.g. a product's sub-products): one input per item,
// add/remove rows — clearer than a comma-separated field.
function StringListEditor({ value, onChange, placeholder, addLabel }: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}) {
  const items = Array.isArray(value) ? value : [];
  const upd = (i: number, v: string) => onChange(items.map((x, j) => (j === i ? v : x)));
  const add = () => onChange([...items, '']);
  const del = (i: number) => onChange(items.filter((_, j) => j !== i));
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <input className={inp()} placeholder={placeholder} value={it} onChange={(e) => upd(i, e.target.value)} />
          <button onClick={() => del(i)} className="p-1 rounded hover:bg-(--shell-hover-hard)" aria-label="Remove">
            <X size={13} style={{ color: '#f87171' }} />
          </button>
        </div>
      ))}
      <button onClick={add} className="text-xs font-semibold" style={{ color: '#C9A961' }}>+ {addLabel ?? 'Add'}</button>
    </div>
  );
}

const STATUS_AI = [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }];

// ─── Partner intake funnel — option lists + badge styling ─────────────────────
const opt = (v: string) => ({ value: v, label: v });
const PARTNER_FUNNEL_OPTS = ['Inquiry', 'Screening', 'KYC Collection', 'Agreement Sent', 'Agreement Signed', 'Training', 'Active', 'Rejected', 'On Hold'].map(opt);
const PARTNER_LEAD_SOURCE_OPTS = ['Website Form', 'WhatsApp Inquiry', 'Referral', 'Walk-in', 'Other'].map(opt);
const PARTNER_NETWORK_TYPE_OPTS = ['CA / Accountant', 'Property Dealer / Broker', 'Insurance Agent', 'HR / Corporate Contact', 'Society / RWA Office Bearer', 'Freelance Loan Agent', 'Other / Unclear'].map(opt);
const PARTNER_NETWORK_SIZE_OPTS = ['>100 contacts', '30-100 contacts', '<30 contacts', 'Not Shared'].map(opt);
const PARTNER_FIT_OPTS = ['Strong Fit', 'Partial Fit', 'Unclear'].map(opt);
const PARTNER_TRACK_OPTS = ['Proven with Examples', 'Some Experience', 'None'].map(opt);
const PARTNER_VOLUME_OPTS = ['>5 cases/month', '2-5 cases/month', '<2 cases/month', 'Not Shared'].map(opt);
const PARTNER_KYC_OPTS = ['Ready', 'Partial', 'Not Ready'].map(opt);
const PARTNER_NEXT_ACTION_OPTS = ['Send Screening Call', 'Collect KYC Docs', 'Send Agreement', 'Schedule Training', 'Grant Pulse Access', 'Reject', 'On Hold'].map(opt);

const PRACTICAL_OPTS = {
  productKnowledge: ['Strong', 'Adequate', 'Weak'].map(opt),
  sampleCaseQuality: ['Complete & clean', 'Minor gaps', 'Poor'].map(opt),
  responsiveness: ['Prompt', 'Acceptable', 'Slow'].map(opt),
  processUnderstanding: ['Clear', 'Partial', 'None'].map(opt),
};

// The italic "ask this" line under a screening field — the tab doubles as the
// call script so nobody needs a separate question sheet.
function AskQ({ q }: { q: string }) {
  return <p className="text-[11px] italic mb-1" style={{ color: 'var(--text-dim)' }}>Ask: “{q}”</p>;
}

const TIER_STYLE: Record<string, { color: string; bg: string }> = {
  Hot: { color: '#34d399', bg: 'rgba(52,211,153,0.14)' },
  Warm: { color: '#fbbf24', bg: 'rgba(251,191,36,0.14)' },
  Cold: { color: '#f87171', bg: 'rgba(248,113,113,0.14)' },
};
function TierBadge({ tier }: { tier?: string }) {
  if (!tier) return <span style={{ color: 'var(--text-dim)' }}>—</span>;
  const s = TIER_STYLE[tier] ?? { color: 'var(--text-muted)', bg: 'var(--shell-hover-hard)' };
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>{tier}</span>;
}
// Colour a funnel stage: settled-good (Active) green, terminal-bad (Rejected) red,
// holding amber, in-progress neutral gold.
function funnelColor(f?: string): string {
  if (f === 'Active') return '#34d399';
  if (f === 'Rejected') return '#f87171';
  if (f === 'On Hold') return '#fbbf24';
  return '#C9A961';
}

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
      else if (f.kind === 'rows') v[f.key] = Array.isArray(cur) ? cur : [];
      else if (f.kind === 'stringlist') v[f.key] = Array.isArray(cur) ? cur : [];
      else if (f.kind === 'taglist') v[f.key] = Array.isArray(cur) ? cur.join(', ') : (cur ?? '');
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
      if ((f.kind === 'multiselect' || f.kind === 'stringlist' || f.kind === 'rows') ? (v as unknown[]).length === 0 : !String(v ?? '').trim()) {
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
        else if (f.kind === 'multiselect' || f.kind === 'rows') out[f.key] = v;
        else if (f.kind === 'stringlist') out[f.key] = (Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean);
        else if (f.kind === 'taglist') out[f.key] = String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
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
              ) : f.kind === 'rows' ? (
                <RowsEditor rowFields={f.rowFields ?? []} value={values[f.key] as Array<Record<string, string>>} onChange={(v) => set(f.key, v)} />
              ) : f.kind === 'stringlist' ? (
                <StringListEditor value={values[f.key] as string[]} onChange={(v) => set(f.key, v)} placeholder={f.placeholder} addLabel={f.addLabel} />
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

// ─── Read-only detail popup (click a row to see everything entered) ───────────
function fmtDetailValue(f: FieldDef, row: Record<string, unknown>): React.ReactNode {
  const v = row[f.key];
  if (f.kind === 'select') return f.options?.find((o) => o.value === v)?.label ?? (v ? String(v) : '—');
  if (f.kind === 'multiselect') {
    const arr = Array.isArray(v) ? v : [];
    return arr.length ? arr.map((x) => f.options?.find((o) => o.value === x)?.label ?? String(x)).join(', ') : '—';
  }
  if (f.kind === 'taglist' || f.kind === 'stringlist') { const arr = Array.isArray(v) ? v : []; return arr.length ? arr.join(', ') : '—'; }
  if (f.kind === 'rows') {
    const rows = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
    if (!rows.length) return '—';
    return (
      <table className="w-full text-xs mt-1">
        <thead><tr className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>
          {f.rowFields?.map((rf) => <th key={rf.key} className="text-left py-0.5 pr-3">{rf.label}</th>)}
        </tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} style={{ borderTop: '1px solid var(--shell-border)' }}>
            {f.rowFields?.map((rf) => <td key={rf.key} className="py-0.5 pr-3" style={{ color: 'var(--text-secondary)' }}>{String(r[rf.key] ?? '') || '—'}</td>)}
          </tr>
        ))}</tbody>
      </table>
    );
  }
  if (f.kind === 'date') {
    const ts = v as { toDate?: () => Date } | string | null;
    if (!ts) return '—';
    if (typeof ts === 'string') return ts;
    if (ts.toDate) { try { return ts.toDate().toLocaleDateString('en-IN'); } catch { return '—'; } }
    return '—';
  }
  return (v === 0 || v) ? String(v) : '—';
}

function MasterDetailModal({ title, fields, row, onClose, onEdit }: {
  title: string; fields: FieldDef[]; row: Record<string, unknown> & { id: string; status?: string };
  onClose: () => void; onEdit: () => void;
}) {
  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}><Pencil size={12} /> Edit</button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close">
              <X size={17} style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>ID</p>
            <p className="font-mono font-semibold text-sm" style={{ color: '#C9A961' }}>{row.id}</p>
          </div>
          {fields.map((f) => (
            <div key={f.key}>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{f.label}</p>
              <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{fmtDetailValue(f, row)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Generic master tab (list + add/edit) ────────────────────────────────────
function MasterTab<T extends { id: string; name: string; status: string }>({
  type, label, fields, columns, expand, transform,
}: {
  type: string;                       // API master type == collection name
  label: string;
  fields: FieldDef[];
  columns: Array<{ header: string; render: (row: T) => React.ReactNode }>;
  expand?: (row: T) => Record<string, unknown>;        // flatten nested → form keys (edit)
  transform?: (values: Record<string, unknown>) => Record<string, unknown>;  // reassemble before submit
}) {
  const { rows, loading, error } = useCrm2Collection<T>(type);
  const toast = useToast();
  const [modal, setModal] = useState<{ initial: (Record<string, unknown> & { id?: string }) | null } | null>(null);
  const [detail, setDetail] = useState<(Record<string, unknown> & { id: string }) | null>(null);
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
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3 + columns.length} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={3 + columns.length} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                  No {label.toLowerCase()} yet — add the first one.
                </td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id} onClick={() => setDetail(r as unknown as Record<string, unknown> & { id: string })}
                  className="cursor-pointer hover:bg-(--shell-hover-soft) transition-colors"
                  style={{ borderTop: '1px solid var(--shell-border)', opacity: r.status === 'ACTIVE' ? 1 : 0.55 }}>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold" style={{ color: '#C9A961' }}>{r.id}</td>
                  <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{r.name}</td>
                  {columns.map((c) => <td key={c.header} className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{c.render(r)}</td>)}
                  <td className="px-3 py-2.5">
                    <span className={r.status === 'ACTIVE' ? 'badge-glass-success' : 'badge-glass-muted'}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <MasterDetailModal
          title={detail.id}
          fields={fields}
          row={detail}
          onClose={() => setDetail(null)}
          onEdit={() => { setModal({ initial: detail }); setDetail(null); }}
        />
      )}

      {modal && (
        <MasterFormModal
          title={modal.initial ? `Edit ${modal.initial.id}` : `New ${label.replace(/s$/, '')}`}
          fields={fields}
          initial={modal.initial && expand ? { ...modal.initial, ...expand(modal.initial as unknown as T) } : modal.initial}
          onClose={() => setModal(null)}
          onSubmit={async (values) => {
            const payload = transform ? transform(values) : values;
            if (modal.initial?.id) {
              await apiCrm2('PATCH', `/api/crm2/masters/${type}/${modal.initial.id}`, payload);
              toast.success('Saved');
            } else {
              const r = await apiCrm2('POST', `/api/crm2/masters/${type}`, payload);
              toast.success(`Created ${r.id}`);
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Connectors (CON-) tab ────────────────────────────────────────────────────
// The ONE place to add/manage connectors (channel partners who source customers).
// Backed by `/connectors` (read by the Add Customer picker). Create/edit go via
// the server so PAN + bank account are encrypted (last-4 shown) and Aadhaar is
// last-4 only. The CON-### code is auto-assigned; super admins toggle status.
const VERTICAL_OPTS: Array<{ value: ConnectorVertical; label: string }> = [
  { value: 'loan', label: 'Loan' }, { value: 'wealth', label: 'Wealth' }, { value: 'insurance', label: 'Insurance' },
];
const EMPTY_BANK = { bankName: '', accountHolderName: '', ifsc: '', accountNo: '', branchName: '' };

// Firestore Timestamp (or null) → yyyy-mm-dd for a <input type="date">.
function tsToInput(ts: unknown): string {
  const d = (ts as { toDate?: () => Date } | null | undefined)?.toDate?.();
  return d ? d.toISOString().slice(0, 10) : '';
}
const SectionLabel = ({ text }: { text: string }) => (
  <p className="text-[11px] font-bold uppercase tracking-widest pt-1" style={{ color: '#C9A961' }}>{text}</p>
);

function ConnectorFormModal({ initial, autoCode, onClose, onSaved }: {
  initial: Connector | null;
  autoCode: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [entityType, setEntityType] = useState<string>(initial?.entityType ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [mobiles, setMobiles] = useState<string[]>(initial?.mobiles?.length ? initial.mobiles : [initial?.mobile ?? '']);
  const [email, setEmail] = useState(initial?.email ?? '');
  const [firmName, setFirmName] = useState(initial?.firmName ?? '');
  const [gstin, setGstin] = useState(initial?.gstin ?? '');
  const [verticals, setVerticals] = useState<ConnectorVertical[]>(initial?.verticals ?? []);
  const [pan, setPan] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  const [bank, setBank] = useState({ ...EMPTY_BANK });
  const [tdsPct, setTdsPct] = useState('');
  const [fin, setFin] = useState<ConnectorFinancial | null>(null);   // existing — for last-4 hints
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  // On edit, load the admin-only financial sub-doc for last-4 hints + prefills.
  useEffect(() => {
    if (!initial) return;
    getConnectorFinancial(initial.id).then((f) => {
      if (!f) return;
      setFin(f);
      setAadhaar(f.aadhaarLast4 ?? '');
      setTdsPct(f.tdsPct != null ? String(f.tdsPct) : '');
      if (f.payoutBank) setBank({
        bankName: f.payoutBank.bankName ?? '', accountHolderName: f.payoutBank.accountHolderName ?? '',
        ifsc: f.payoutBank.ifsc ?? '', accountNo: '', branchName: f.payoutBank.branchName ?? '',
      });
    });
  }, [initial]);

  // ── Partner funnel state ──
  const [tab, setTab] = useState<'details' | 'screening' | 'assessment' | 'onboarding'>('details');
  // Legacy connectors have no funnelStatus — default to Active when they're already
  // active (an established partner) so editing them doesn't silently deactivate them.
  const [funnelStatus, setFunnelStatus] = useState<string>(
    initial?.funnelStatus ?? (initial?.status === 'active' ? 'Active' : 'Inquiry'));
  const [owner, setOwner] = useState(initial?.owner ?? '');
  const [leadSource, setLeadSource] = useState(initial?.leadSource ?? '');
  const [occupation, setOccupation] = useState(initial?.occupation ?? '');
  const [networkType, setNetworkType] = useState(initial?.networkType ?? '');
  const [networkSize, setNetworkSize] = useState(initial?.networkSize ?? '');
  const [productInterestStated, setProductInterestStated] = useState(initial?.productInterestStated ?? '');
  const [productDemandFit, setProductDemandFit] = useState(initial?.productDemandFit ?? '');
  const [priorTrackRecord, setPriorTrackRecord] = useState(initial?.priorTrackRecord ?? '');
  const [trackRecordNotes, setTrackRecordNotes] = useState(initial?.trackRecordNotes ?? '');
  const [expectedMonthlyVolume, setExpectedMonthlyVolume] = useState(initial?.expectedMonthlyVolume ?? '');
  const [kycReadinessInput, setKycReadinessInput] = useState(initial?.kycReadinessInput ?? '');
  const [existingDsaCodeElsewhere, setExistingDsa] = useState(!!initial?.existingDsaCodeElsewhere);
  const [conflictNotes, setConflictNotes] = useState(initial?.conflictNotes ?? '');
  const [screeningCallDone, setScreeningCallDone] = useState(!!initial?.screeningCallDone);
  const [screeningCallDate, setScreeningCallDate] = useState(tsToInput(initial?.screeningCallDate));
  const [nextAction, setNextAction] = useState(initial?.nextAction ?? '');
  const oc0 = initial?.onboardingChecklist;
  const [onb, setOnb] = useState({
    panCollected: !!oc0?.panCollected, aadhaarCollected: !!oc0?.aadhaarCollected,
    bankDetailsCollected: !!oc0?.bankDetailsCollected, trainingCompleted: !!oc0?.trainingCompleted,
    pulseAccessCreated: !!oc0?.pulseAccessCreated, firstCaseLogged: !!oc0?.firstCaseLogged,
    agreementSentDate: tsToInput(oc0?.agreementSentDate), agreementSignedDate: tsToInput(oc0?.agreementSignedDate),
  });
  const pa0 = initial?.practicalAssessment;
  const [pa, setPa] = useState({
    productKnowledge: pa0?.productKnowledge ?? '',
    sampleCaseQuality: pa0?.sampleCaseQuality ?? '',
    responsiveness: pa0?.responsiveness ?? '',
    processUnderstanding: pa0?.processUnderstanding ?? '',
    assessorNotes: pa0?.assessorNotes ?? '',
  });
  const [rubric, setRubric] = useState<PartnerRubric | null>(null);
  useEffect(() => { apiCrm2<{ config: PartnerRubric }>('GET', '/api/crm2/partner-scoring-config').then((r) => setRubric(r.config)).catch(() => {}); }, []);

  // Live score preview from the current screening answers (never a black box).
  const preview = useMemo(() => {
    if (!rubric) return null;
    return computePartnerScore({ networkType, networkSize, productDemandFit, priorTrackRecord, expectedMonthlyVolume, kycReadinessInput, existingDsaCodeElsewhere }, rubric);
  }, [rubric, networkType, networkSize, productDemandFit, priorTrackRecord, expectedMonthlyVolume, kycReadinessInput, existingDsaCodeElsewhere]);
  const onbProgress = computeOnboardingProgress({ ...onb, agreementSignedDate: onb.agreementSignedDate || null });
  const paPreview = useMemo(() => (rubric ? computePracticalAssessment(pa, rubric) : null), [rubric, pa]);

  const toggleV = (v: ConnectorVertical) => setVerticals((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  const setMobileAt = (i: number, v: string) => setMobiles((p) => p.map((m, j) => (j === i ? v : m)));
  const setB = (k: keyof typeof EMPTY_BANK, v: string) => setBank((p) => ({ ...p, [k]: v }));

  const save = async () => {
    const e: Record<string, string> = {};
    if (!displayName.trim()) e.displayName = 'Required';
    const cleanMobiles = mobiles.map((m) => m.replace(/[\s-]/g, '').replace(/^\+91/, '')).filter(Boolean);
    if (cleanMobiles.length === 0) e.mobile = 'At least one mobile';
    else if (cleanMobiles.some((m) => !/^[6-9]\d{9}$/.test(m))) e.mobile = 'Each must be a 10-digit mobile';
    if (verticals.length === 0) e.verticals = 'Pick at least one';
    const panUp = pan.trim().toUpperCase();
    // PAN is optional now (a candidate can be logged at Inquiry before KYC).
    if (panUp && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panUp)) e.pan = 'Invalid PAN (ABCDE1234F)';
    if (aadhaar.trim() && !/^\d{4}$/.test(aadhaar.trim())) e.aadhaar = 'Last 4 digits only';
    if (bank.ifsc.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank.ifsc.trim().toUpperCase())) e.ifsc = 'Invalid IFSC';
    if (bank.accountNo.trim() && !/^\d{6,20}$/.test(bank.accountNo.replace(/\s/g, ''))) e.accountNo = '6–20 digits';
    if (Object.keys(e).length) { setErrs(e); setTab('details'); return; }
    setErrs({}); setServerError(''); setBusy(true);
    try {
      const payload = {
        entityType: entityType || null, displayName: displayName.trim(), mobiles: cleanMobiles,
        email: email.trim() || null, firmName: firmName.trim() || null, gstin: gstin.trim() || null,
        verticals,
        // Screening / funnel (status is DERIVED server-side from funnelStatus)
        funnelStatus, owner: owner.trim() || null, leadSource: leadSource || null,
        occupation, networkType: networkType || null, networkSize: networkSize || null,
        productInterestStated, productDemandFit: productDemandFit || null,
        priorTrackRecord: priorTrackRecord || null, trackRecordNotes,
        expectedMonthlyVolume: expectedMonthlyVolume || null, kycReadinessInput: kycReadinessInput || null,
        existingDsaCodeElsewhere, conflictNotes,
        screeningCallDone, screeningCallDate: screeningCallDate || null, nextAction: nextAction || null,
        practicalAssessment: {
          productKnowledge: pa.productKnowledge || null,
          sampleCaseQuality: pa.sampleCaseQuality || null,
          responsiveness: pa.responsiveness || null,
          processUnderstanding: pa.processUnderstanding || null,
          assessorNotes: pa.assessorNotes,
        },
        onboardingChecklist: {
          panCollected: onb.panCollected, aadhaarCollected: onb.aadhaarCollected,
          bankDetailsCollected: onb.bankDetailsCollected, trainingCompleted: onb.trainingCompleted,
          pulseAccessCreated: onb.pulseAccessCreated, firstCaseLogged: onb.firstCaseLogged,
          agreementSentDate: onb.agreementSentDate || null, agreementSignedDate: onb.agreementSignedDate || null,
        },
        ...(panUp ? { pan: panUp } : {}),
        aadhaarLast4: aadhaar.trim() || null,
        tdsPct: tdsPct.trim() ? Number(tdsPct) : null,
        bank: {
          bankName: bank.bankName.trim(), accountHolderName: bank.accountHolderName.trim(),
          ifsc: bank.ifsc.trim().toUpperCase(), branchName: bank.branchName.trim(),
          ...(bank.accountNo.trim() ? { accountNo: bank.accountNo.replace(/\s/g, '') } : {}),
        },
      };
      if (initial) { await apiCrm2('PATCH', `/api/crm2/connectors/${initial.id}`, payload); onSaved('Saved'); }
      else { const r = await apiCrm2<{ ok: boolean; id: string; connectorCode: string }>('POST', '/api/crm2/connectors', payload); onSaved(`Created ${r.connectorCode}`); }
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Save failed');
    } finally { setBusy(false); }
  };

  const TABS: Array<{ k: typeof tab; label: string }> = [
    { k: 'details', label: '1 · Details' },
    { k: 'screening', label: '2 · Screening' },
    { k: 'assessment', label: `3 · Assessment${paPreview ? (paPreview.result === 'Pass' ? ' ✓' : paPreview.result === 'Fail' ? ' ✗' : '') : ''}` },
    { k: 'onboarding', label: `4 · Onboarding · ${onbProgress}%` },
  ];

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              {initial ? `Edit ${initial.connectorCode}` : 'New Partner / Connector'}
              {preview && <TierBadge tier={preview.tier} />}
            </h3>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Code <span className="font-mono font-semibold" style={{ color: '#C9A961' }}>{initial?.connectorCode ?? autoCode}</span> · auto-assigned
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close">
            <X size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Funnel stage selector + tab pills */}
        <div className="px-5 pt-3 flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Stage</span>
            <span className="w-44"><SearchableSelect options={PARTNER_FUNNEL_OPTS} value={funnelStatus} onChange={setFunnelStatus} /></span>
          </div>
          <div className="flex items-center gap-1.5">
            {TABS.map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                style={tab === t.k ? { backgroundColor: '#0B1538', color: '#E5C97C' } : { backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-secondary)' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 space-y-4">
          {serverError && (
            <div className="px-3.5 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#f87171' }}>
              {serverError}
            </div>
          )}

          {tab === 'details' && <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FLabel text="Name" required error={errs.displayName} />
              <input className={inp(!!errs.displayName)} value={displayName}
                onChange={(e) => setDisplayName(e.target.value)} placeholder="Connector's name" />
            </div>
            <div>
              <FLabel text="Entity Type" />
              <SearchableSelect options={[{ value: '', label: '—' }, ...CONSTITUTION_OPTS]} value={entityType} onChange={setEntityType} placeholder="—" />
            </div>
          </div>

          {/* Mobiles — one or more, with + to add */}
          <div>
            <FLabel text="Mobile" required error={errs.mobile} />
            <div className="space-y-2">
              {mobiles.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={inp(!!errs.mobile)} value={m} maxLength={13}
                    onChange={(e) => setMobileAt(i, e.target.value)} placeholder="9876543210" />
                  {mobiles.length > 1 && (
                    <button type="button" onClick={() => setMobiles((p) => p.filter((_, j) => j !== i))}
                      className="p-2 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Remove">
                      <X size={14} style={{ color: '#f87171' }} />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setMobiles((p) => [...p, ''])}
                className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#C9A961' }}>
                <Plus size={13} /> Add another mobile
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FLabel text="Email" />
              <input className={inp()} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <FLabel text="Firm / DSA Entity" />
              <input className={inp()} value={firmName} onChange={(e) => setFirmName(e.target.value)} placeholder="optional" />
            </div>
          </div>

          <div>
            <FLabel text="Verticals" required error={errs.verticals} />
            <div className="flex gap-2">
              {VERTICAL_OPTS.map(({ value, label }) => {
                const on = verticals.includes(value);
                return (
                  <button key={value} type="button" onClick={() => toggleV(value)}
                    className="px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors"
                    style={on
                      ? { backgroundColor: 'rgba(201,169,97,0.15)', borderColor: '#C9A961', color: '#C9A961' }
                      : { borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>
                    {on ? '✓ ' : ''}{label}
                  </button>
                );
              })}
            </div>
          </div>

          <SectionLabel text="KYC" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FLabel text="PAN" error={errs.pan} />
              <input className={`${inp(!!errs.pan)} uppercase`} value={pan} maxLength={10}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                placeholder={fin?.panLast4 ? `current ••••${fin.panLast4} — blank keeps it` : 'optional'} />
            </div>
            <div>
              <FLabel text="Aadhaar (last 4)" error={errs.aadhaar} />
              <input className={inp(!!errs.aadhaar)} value={aadhaar} maxLength={4}
                onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ''))} placeholder="1234" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FLabel text="GSTIN" />
              <input className={`${inp()} uppercase`} value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="optional" />
            </div>
          </div>

          <SectionLabel text="Payout Account" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FLabel text="Bank Name" />
              <input className={inp()} value={bank.bankName} onChange={(e) => setB('bankName', e.target.value)} placeholder="HDFC Bank" />
            </div>
            <div>
              <FLabel text="Name as per Account" />
              <input className={inp()} value={bank.accountHolderName} onChange={(e) => setB('accountHolderName', e.target.value)} />
            </div>
            <div>
              <FLabel text="Account Number" error={errs.accountNo} />
              <input className={inp(!!errs.accountNo)} value={bank.accountNo}
                onChange={(e) => setB('accountNo', e.target.value)}
                placeholder={fin?.payoutBank?.accountNoLast4 ? `current ••••${fin.payoutBank.accountNoLast4} — blank keeps it` : '6–20 digits'} />
            </div>
            <div>
              <FLabel text="IFSC Code" error={errs.ifsc} />
              <input className={`${inp(!!errs.ifsc)} uppercase`} value={bank.ifsc} onChange={(e) => setB('ifsc', e.target.value.toUpperCase())} placeholder="HDFC0001234" />
            </div>
            <div>
              <FLabel text="Branch Name" />
              <input className={inp()} value={bank.branchName} onChange={(e) => setB('branchName', e.target.value)} placeholder="optional" />
            </div>
            <div>
              <FLabel text="TDS %" />
              <input type="number" className={inp()} value={tdsPct} onChange={(e) => setTdsPct(e.target.value)} placeholder="e.g. 5" />
            </div>
          </div>

          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Active/inactive is derived from the funnel <strong>Stage</strong> above — a candidate becomes pickable by RMs only when the stage is <strong>Active</strong>.
          </p>
          </>}

          {tab === 'screening' && <>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              This tab IS the screening call script — work top to bottom, ask each question as written, pick the answer.
              The score updates live below; no separate question sheet needed.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div><FLabel text="Lead Source" /><SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_LEAD_SOURCE_OPTS]} value={leadSource} onChange={setLeadSource} /></div>
              <div><FLabel text="Owner (who's handling)" /><input className={inp()} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="FAPL-… or name" /></div>
              <div>
                <FLabel text="1 · Occupation" />
                <AskQ q="What do you do currently — your main line of work?" />
                <input className={inp()} value={occupation} onChange={(e) => setOccupation(e.target.value)} placeholder="e.g. Practising CA" />
              </div>
              <div>
                <FLabel text="2 · Network Type" />
                <AskQ q="Who is in your circle — CAs, property dealers, corporates, societies…?" />
                <SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_NETWORK_TYPE_OPTS]} value={networkType} onChange={setNetworkType} />
              </div>
              <div>
                <FLabel text="3 · Network Size" />
                <AskQ q="Roughly how many people could you realistically refer from your network?" />
                <SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_NETWORK_SIZE_OPTS]} value={networkSize} onChange={setNetworkSize} />
              </div>
              <div>
                <FLabel text="4 · Product Interest (stated)" />
                <AskQ q="Which products do you want to work on — home loans, LAP, insurance…?" />
                <input className={inp()} value={productInterestStated} onChange={(e) => setProductInterestStated(e.target.value)} placeholder="e.g. Home Loans, LAP" />
              </div>
              <div>
                <FLabel text="5 · Product / Demand Fit" />
                <AskQ q="(your read) Does what they bring match what we actually sell?" />
                <SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_FIT_OPTS]} value={productDemandFit} onChange={setProductDemandFit} />
              </div>
              <div>
                <FLabel text="6 · Prior Track Record" />
                <AskQ q="Have you sourced loans or insurance before? Give me one or two examples." />
                <SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_TRACK_OPTS]} value={priorTrackRecord} onChange={setPriorTrackRecord} />
              </div>
              <div>
                <FLabel text="7 · Expected Volume" />
                <AskQ q="How many cases a month do you honestly expect to bring?" />
                <SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_VOLUME_OPTS]} value={expectedMonthlyVolume} onChange={setExpectedMonthlyVolume} />
              </div>
              <div>
                <FLabel text="8 · KYC Readiness" />
                <AskQ q="Do you have PAN, Aadhaar and bank details ready to share?" />
                <SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_KYC_OPTS]} value={kycReadinessInput} onChange={setKycReadinessInput} />
              </div>
            </div>
            <div><FLabel text="Track Record Notes" /><textarea className={`${inp()} min-h-13`} value={trackRecordNotes} onChange={(e) => setTrackRecordNotes(e.target.value)} placeholder="Examples / references they gave" /></div>
            <div>
              <AskQ q="9 · Do you already hold a DSA code with any other company?" />
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={existingDsaCodeElsewhere} onChange={(e) => setExistingDsa(e.target.checked)} />
                Already holds a DSA code elsewhere (applies a scoring penalty)
              </label>
            </div>
            {existingDsaCodeElsewhere && <div><FLabel text="Conflict Notes" /><input className={inp()} value={conflictNotes} onChange={(e) => setConflictNotes(e.target.value)} placeholder="Which lender / arrangement?" /></div>}
            <div className="grid grid-cols-2 gap-3">
              <div><FLabel text="Next Action" /><SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_NEXT_ACTION_OPTS]} value={nextAction} onChange={setNextAction} /></div>
              <div><FLabel text="Screening Call Date" /><input type="date" className={inp()} value={screeningCallDate} onChange={(e) => setScreeningCallDate(e.target.value)} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={screeningCallDone} onChange={(e) => setScreeningCallDone(e.target.checked)} />
              Screening call done
            </label>

            {/* Read-only score breakdown — the tier is never a black box */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Score breakdown</span>
                {preview ? <span className="flex items-center gap-2"><TierBadge tier={preview.tier} /><span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{preview.totalScore} pts</span></span> : <span className="text-xs" style={{ color: 'var(--text-dim)' }}>loading rubric…</span>}
              </div>
              {preview && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {[['Network type', preview.networkTypeScore], ['Network size', preview.networkSizeScore], ['Product fit', preview.productFitScore], ['Track record', preview.trackRecordScore], ['Volume', preview.volumeScore], ['KYC readiness', preview.kycScore], ['DSA conflict', preview.conflictPenalty]].map(([k, v]) => (
                    <div key={k as string} className="flex justify-between"><span>{k}</span><span className="font-semibold" style={{ color: (v as number) < 0 ? '#f87171' : 'var(--text-primary)' }}>{v as number > 0 ? '+' : ''}{v as number}</span></div>
                  ))}
                </div>
              )}
              <p className="text-[10px] mt-2" style={{ color: 'var(--text-dim)' }}>Saved after you click {initial ? 'Save Changes' : 'Create'} — thresholds are set in the Partner Scoring tab.</p>
            </div>
          </>}

          {tab === 'assessment' && <>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Stage 2 — the hands-on check after screening. Give them a sample case brief, watch how they work,
              then rate each item below. All four ratings + a passing score are required before this candidate can be made <strong>Active</strong>.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FLabel text="Product knowledge" />
                <AskQ q="Walk me through how you'd pitch the products you want to work on." />
                <SearchableSelect options={[{ value: '', label: '— not rated —' }, ...PRACTICAL_OPTS.productKnowledge]} value={pa.productKnowledge} onChange={(v) => setPa((x) => ({ ...x, productKnowledge: v }))} />
              </div>
              <div>
                <FLabel text="Sample case quality" />
                <AskQ q="Here's a sample customer — send me the file you'd log for them." />
                <SearchableSelect options={[{ value: '', label: '— not rated —' }, ...PRACTICAL_OPTS.sampleCaseQuality]} value={pa.sampleCaseQuality} onChange={(v) => setPa((x) => ({ ...x, sampleCaseQuality: v }))} />
              </div>
              <div>
                <FLabel text="Responsiveness" />
                <AskQ q="(observe) How quickly did they respond through this process?" />
                <SearchableSelect options={[{ value: '', label: '— not rated —' }, ...PRACTICAL_OPTS.responsiveness]} value={pa.responsiveness} onChange={(v) => setPa((x) => ({ ...x, responsiveness: v }))} />
              </div>
              <div>
                <FLabel text="Process understanding" />
                <AskQ q="What documents does a home-loan file need, and what happens after login?" />
                <SearchableSelect options={[{ value: '', label: '— not rated —' }, ...PRACTICAL_OPTS.processUnderstanding]} value={pa.processUnderstanding} onChange={(v) => setPa((x) => ({ ...x, processUnderstanding: v }))} />
              </div>
            </div>
            <div>
              <FLabel text="Assessor Notes" />
              <textarea className={inp() + ' min-h-13'} value={pa.assessorNotes} onChange={(e) => setPa((x) => ({ ...x, assessorNotes: e.target.value }))} placeholder="What stood out, concerns, anything promised" />
            </div>
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Assessment result</span>
                {paPreview ? (
                  <span className="text-sm font-bold" style={{ color: paPreview.result === 'Pass' ? '#34d399' : paPreview.result === 'Fail' ? '#f87171' : '#fbbf24' }}>
                    {paPreview.result === 'Pending' ? `Pending — rate all four (${paPreview.totalScore}/${paPreview.maxScore} so far)` : `${paPreview.result} · ${paPreview.totalScore}/${paPreview.maxScore} (need ≥ ${rubric?.practical?.passThreshold ?? '—'})`}
                  </span>
                ) : <span className="text-xs" style={{ color: 'var(--text-dim)' }}>loading rubric…</span>}
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-dim)' }}>
                The chain: Screening score triages (Hot/Warm/Cold) → this assessment must PASS → agreement signed + PAN collected → only then can the stage be set to Active. Pulse enforces it — no side sheet needed.
              </p>
            </div>
          </>}

          {tab === 'onboarding' && <>
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Onboarding progress</span>
                <span className="text-sm font-bold" style={{ color: onbProgress === 100 ? '#34d399' : '#C9A961' }}>{onbProgress}%</span>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${onbProgress}%`, backgroundColor: onbProgress === 100 ? '#34d399' : '#C9A961' }} />
              </div>
            </div>
            {([
              ['panCollected', 'PAN collected'], ['aadhaarCollected', 'Aadhaar collected'], ['bankDetailsCollected', 'Bank details collected'],
              ['trainingCompleted', 'Training completed'], ['pulseAccessCreated', 'Pulse access created'], ['firstCaseLogged', 'First case logged'],
            ] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={onb[k]} onChange={(e) => setOnb((p) => ({ ...p, [k]: e.target.checked }))} /> {label}
              </label>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div><FLabel text="Agreement Sent" /><input type="date" className={inp()} value={onb.agreementSentDate} onChange={(e) => setOnb((p) => ({ ...p, agreementSentDate: e.target.value }))} /></div>
              <div><FLabel text="Agreement Signed" /><input type="date" className={inp()} value={onb.agreementSignedDate} onChange={(e) => setOnb((p) => ({ ...p, agreementSignedDate: e.target.value }))} /></div>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>KYC boxes flag that you've collected the docs; the actual PAN/Aadhaar/bank are stored (encrypted) in the Details tab.</p>
          </>}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={save} disabled={busy}
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

// ─── Partner Scoring rubric settings (super-admin) ────────────────────────────
// Editable weights + thresholds. Save bumps the version and batch-recomputes every
// non-terminal candidate server-side. The score maps are edited as-is (each answer
// option → points); the pure lib clamps/validates on the server.
const RUBRIC_SECTIONS: Array<{ key: keyof PartnerRubric; label: string; opts: string[] }> = [
  { key: 'networkType', label: 'Network type', opts: PARTNER_NETWORK_TYPE_OPTS.map((o) => o.value) },
  { key: 'networkSize', label: 'Network size', opts: PARTNER_NETWORK_SIZE_OPTS.map((o) => o.value) },
  { key: 'productDemandFit', label: 'Product / demand fit', opts: PARTNER_FIT_OPTS.map((o) => o.value) },
  { key: 'priorTrackRecord', label: 'Prior track record', opts: PARTNER_TRACK_OPTS.map((o) => o.value) },
  { key: 'expectedMonthlyVolume', label: 'Expected volume', opts: PARTNER_VOLUME_OPTS.map((o) => o.value) },
  { key: 'kycReadiness', label: 'KYC readiness', opts: PARTNER_KYC_OPTS.map((o) => o.value) },
];

function PartnerScoringTab() {
  const toast = useToast();
  const [cfg, setCfg] = useState<PartnerRubric | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiCrm2<{ config: PartnerRubric }>('GET', '/api/crm2/partner-scoring-config').then((r) => setCfg(r.config)).catch(() => toast.error('Could not load rubric')); }, [toast]);

  const setWeight = (section: keyof PartnerRubric, opt: string, v: string) =>
    setCfg((p) => p ? { ...p, [section]: { ...(p[section] as Record<string, number>), [opt]: Number(v) || 0 } } : p);

  const save = async () => {
    if (!cfg) return;
    setBusy(true);
    try {
      // sanitize client-side too (server re-sanitizes) so the payload is clean.
      const clean = sanitizePartnerRubric(cfg, cfg);
      const r = await apiCrm2<{ ok: boolean; version: number; recomputed: number }>('PATCH', '/api/crm2/partner-scoring-config', clean);
      toast.success(`Saved (v${r.version}) — re-scored ${r.recomputed} candidate${r.recomputed === 1 ? '' : 's'}`);
      const fresh = await apiCrm2<{ config: PartnerRubric }>('GET', '/api/crm2/partner-scoring-config');
      setCfg(fresh.config);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  };

  if (!cfg) return <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading rubric…</p>;

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Points per screening answer → a total, mapped to <TierBadge tier="Hot" /> / <TierBadge tier="Warm" /> / <TierBadge tier="Cold" />.
        Saving re-scores every candidate that isn't already Active or Rejected. Config version <strong>v{cfg.version}</strong>.
      </p>

      {RUBRIC_SECTIONS.map(({ key, label, opts }) => (
        <div key={key}>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{label}</p>
          <div className="grid grid-cols-2 gap-2">
            {opts.map((o) => (
              <div key={o} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--shell-hover-soft)' }}>
                <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{o}</span>
                <input type="number" className="glass-inp w-16 text-sm text-right"
                  value={(cfg[key] as Record<string, number>)[o] ?? 0}
                  onChange={(e) => setWeight(key, o, e.target.value)} />
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="text-xs font-bold uppercase tracking-wider pt-2" style={{ color: '#C9A961' }}>Practical assessment (stage 2 — gates Active)</p>
      {(['productKnowledge', 'sampleCaseQuality', 'responsiveness', 'processUnderstanding'] as const).map((k) => (
        <div key={k}>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{k === 'productKnowledge' ? 'Product knowledge' : k === 'sampleCaseQuality' ? 'Sample case quality' : k === 'responsiveness' ? 'Responsiveness' : 'Process understanding'}</p>
          <div className="grid grid-cols-3 gap-2">
            {Object.keys((cfg.practical ?? { productKnowledge: {}, sampleCaseQuality: {}, responsiveness: {}, processUnderstanding: {}, passThreshold: 7 })[k] ?? {}).map((o) => (
              <div key={o} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--shell-hover-soft)' }}>
                <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{o}</span>
                <input type="number" className="glass-inp w-14 text-sm text-right"
                  value={cfg.practical?.[k]?.[o] ?? 0}
                  onChange={(e) => setCfg((p) => p ? { ...p, practical: { ...p.practical, [k]: { ...p.practical[k], [o]: Number(e.target.value) || 0 } } } : p)} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-3 gap-3">
        <div><FLabel text="Practical pass threshold (≥)" /><input type="number" className="glass-inp w-full text-sm" value={cfg.practical?.passThreshold ?? 7} onChange={(e) => setCfg((p) => p ? { ...p, practical: { ...p.practical, passThreshold: Number(e.target.value) || 0 } } : p)} /></div>
      </div>

      <div className="grid grid-cols-3 gap-3 pt-1">
        <div><FLabel text="DSA conflict penalty" /><input type="number" className="glass-inp w-full text-sm" value={cfg.conflictPenalty} onChange={(e) => setCfg((p) => p ? { ...p, conflictPenalty: Number(e.target.value) || 0 } : p)} /></div>
        <div><FLabel text="Hot threshold (≥)" /><input type="number" className="glass-inp w-full text-sm" value={cfg.tierThresholds.hot} onChange={(e) => setCfg((p) => p ? { ...p, tierThresholds: { ...p.tierThresholds, hot: Number(e.target.value) || 0 } } : p)} /></div>
        <div><FLabel text="Warm threshold (≥)" /><input type="number" className="glass-inp w-full text-sm" value={cfg.tierThresholds.warm} onChange={(e) => setCfg((p) => p ? { ...p, tierThresholds: { ...p.tierThresholds, warm: Number(e.target.value) || 0 } } : p)} /></div>
      </div>

      <button onClick={save} disabled={busy}
        className="px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
        style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
        {busy ? 'Saving & recomputing…' : 'Save rubric & recompute'}
      </button>
    </div>
  );
}

function ConnectorsMasterTab() {
  const { connectors, loading } = useConnectors();
  const toast = useToast();
  const [filter, setFilter] = useState<'active' | 'inactive' | 'all'>('all');
  const [tierFilter, setTierFilter] = useState<'all' | 'Hot' | 'Warm' | 'Cold'>('all');
  const [funnelFilter, setFunnelFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ initial: Connector | null } | null>(null);

  const autoCode = nextConnectorCode(connectors);
  const activeN = connectors.filter((c) => c.status === 'active').length;
  const inactiveN = connectors.filter((c) => c.status === 'inactive').length;
  const filtered = connectors.filter((c) =>
    (filter === 'all' || c.status === filter) &&
    (tierFilter === 'all' || c.partnerScoring?.tier === tierFilter) &&
    (!funnelFilter || c.funnelStatus === funnelFilter) &&
    (!search || c.displayName.toLowerCase().includes(search.toLowerCase()) || c.connectorCode.toLowerCase().includes(search.toLowerCase())));

  const toggleStatus = async (c: Connector) => {
    const next = c.status === 'active' ? 'inactive' : 'active';
    try { await setConnectorStatus(c.id, next); toast.success(next === 'active' ? 'Activated' : 'Deactivated'); }
    catch { toast.error('Could not update status'); }
  };

  // Legacy codes were FAC-/CONN-### — offer a one-time rename to CON-###.
  const [migBusy, setMigBusy] = useState(false);
  const legacyCount = connectors.filter((c) => /^(?:FAC|CONN)-/.test(c.connectorCode ?? '')).length;
  const renameCodes = async () => {
    setMigBusy(true);
    try {
      const r = await apiCrm2<{ ok: boolean; migrated: unknown[] }>('POST', '/api/crm2/admin/migrate-connector-codes', {});
      toast.success(`Renamed ${r.migrated.length} connector code(s) to CON-`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Rename failed'); }
    finally { setMigBusy(false); }
  };

  const FILTERS: Array<{ key: typeof filter; label: string }> = [
    { key: 'active', label: `Active (${activeN})` },
    { key: 'inactive', label: `Inactive (${inactiveN})` },
    { key: 'all', label: `All (${connectors.length})` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={filter === f.key
                ? { backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' }
                : { color: 'var(--text-muted)', border: '1px solid var(--shell-border)' }}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <input className="glass-inp text-sm w-56" placeholder="Search connectors…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <button onClick={() => setModal({ initial: null })}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            <Plus size={15} /> Add Partner
          </button>
        </div>
      </div>

      {/* Tier + funnel-stage filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'Hot', 'Warm', 'Cold'] as const).map((t) => (
          <button key={t} onClick={() => setTierFilter(t)}
            className="px-3 py-1 rounded-lg text-xs font-semibold transition-colors"
            style={tierFilter === t
              ? (t === 'all' ? { backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' } : { backgroundColor: (TIER_STYLE[t]?.bg), color: TIER_STYLE[t]?.color, border: `1px solid ${TIER_STYLE[t]?.color}55` })
              : { color: 'var(--text-muted)', border: '1px solid var(--shell-border)' }}>
            {t === 'all' ? 'All tiers' : t}
          </button>
        ))}
        <span className="w-48"><SearchableSelect options={[{ value: '', label: 'All stages' }, ...PARTNER_FUNNEL_OPTS]} value={funnelFilter} onChange={setFunnelFilter} placeholder="All stages" /></span>
      </div>

      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Partners / connectors source customers. Next code: <span className="font-mono font-semibold" style={{ color: '#C9A961' }}>{autoCode}</span>.
        A candidate becomes pickable by RMs only once its funnel stage is <strong>Active</strong>.
      </p>

      {legacyCount > 0 && (
        <div className="rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3"
          style={{ backgroundColor: 'rgba(201,169,97,0.10)', border: '1px solid rgba(201,169,97,0.3)' }}>
          <span className="text-sm" style={{ color: '#C9A961' }}>
            {legacyCount} connector{legacyCount > 1 ? 's' : ''} still use an old <strong>FAC-/CONN-</strong> code. Rename to <strong>CON-</strong>?
          </span>
          <button onClick={renameCodes} disabled={migBusy}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            {migBusy ? 'Renaming…' : 'Rename to CON-'}
          </button>
        </div>
      )}

      <div className="glass-panel p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                <th className="text-left font-semibold px-4 py-2.5">Code</th>
                <th className="text-left font-semibold px-3 py-2.5">Name</th>
                <th className="text-left font-semibold px-3 py-2.5">Tier</th>
                <th className="text-left font-semibold px-3 py-2.5">Stage</th>
                <th className="text-left font-semibold px-3 py-2.5">Mobile</th>
                <th className="text-left font-semibold px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                  No connectors {filter !== 'all' ? `(${filter})` : ''} yet — add the first one.
                </td></tr>
              ) : filtered.map((c) => (
                <tr key={c.id} onClick={() => setModal({ initial: c })}
                  className="cursor-pointer hover:bg-(--shell-hover-soft) transition-colors"
                  style={{ borderTop: '1px solid var(--shell-border)', opacity: c.status === 'active' ? 1 : 0.55 }}>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold" style={{ color: '#C9A961' }}>{c.connectorCode}</td>
                  <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>
                    {c.displayName}{c.firmName ? <span className="text-xs" style={{ color: 'var(--text-muted)' }}> · {c.firmName}</span> : null}
                  </td>
                  <td className="px-3 py-2.5"><TierBadge tier={c.partnerScoring?.tier} /></td>
                  <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: funnelColor(c.funnelStatus) }}>{c.funnelStatus ?? '—'}</td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{c.mobile}{c.mobiles && c.mobiles.length > 1 ? <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}> +{c.mobiles.length - 1}</span> : null}</td>
                  <td className="px-3 py-2.5">
                    <span className={c.status === 'active' ? 'badge-glass-success' : 'badge-glass-muted'}>{c.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button onClick={(e) => { e.stopPropagation(); toggleStatus(c); }}
                      className="text-xs font-semibold transition-opacity hover:opacity-80"
                      style={{ color: c.status === 'active' ? '#f87171' : '#34d399' }}>
                      {c.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <ConnectorFormModal
          initial={modal.initial}
          autoCode={autoCode}
          onClose={() => setModal(null)}
          onSaved={(msg) => toast.success(msg)}
        />
      )}
    </div>
  );
}

// One-time helper: aggregators historically minted as CONN-### are renamed to
// AGG-### (reference-safe, server-side). Button shows only while a CONN- exists.
function AggregatorMigrationBanner() {
  const { rows } = useCrm2Collection<{ id: string }>('aggregators');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const legacy = rows.filter((r) => /^CONN-/.test(r.id));
  if (legacy.length === 0) return null;
  const run = async () => {
    setBusy(true);
    try {
      const r = await apiCrm2<{ ok: boolean; migrated: unknown[] }>('POST', '/api/crm2/admin/migrate-aggregator-ids', {});
      toast.success(`Renamed ${r.migrated.length} aggregator id(s) to AGG-`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Rename failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3"
      style={{ backgroundColor: 'rgba(201,169,97,0.10)', border: '1px solid rgba(201,169,97,0.3)' }}>
      <span className="text-sm" style={{ color: '#C9A961' }}>
        {legacy.length} aggregator{legacy.length > 1 ? 's' : ''} still use the old <strong>CONN-</strong> code. Rename to <strong>AGG-</strong>?
      </span>
      <button onClick={run} disabled={busy}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
        style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
        {busy ? 'Renaming…' : 'Rename to AGG-'}
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'connectors',     label: 'Connectors', Icon: Handshake },
  { key: 'lenders',        label: 'Lenders',    Icon: Landmark },
  { key: 'products',       label: 'Products',   Icon: Package },
  { key: 'subProducts',    label: 'Sub Products', Icon: Layers },
  { key: 'aggregators',    label: 'Aggregators', Icon: Network },
  { key: 'mappings',       label: 'DSA Codes',  Icon: GitBranch },
  { key: 'documentMaster', label: 'Documents',  Icon: FileText },
  { key: 'partnerScoring', label: 'Partner Scoring', Icon: Gauge },
] as const;

export function Crm2MastersPage() {
  const { profile, user } = useAuth();
  const [tab, setTab] = useState<typeof TABS[number]['key']>('connectors');

  const { rows: products } = useCrm2Collection<WithId<Product>>('products');
  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: `${p.name} (${p.shortCode})` })), [products]);
  const { rows: docDefs } = useCrm2Collection<WithId<DocumentDef>>('documentMaster');
  const docOptions = useMemo(
    () => docDefs.map((d) => ({ value: d.id, label: d.name })), [docDefs]);

  // Masters add + view is super-admin only. Lender contacts/login-email etc. are
  // surfaced read-only to RMs/managers inside the case (see LoginsSection).
  const canWrite = isSuperAdmin(user?.uid ?? '', profile);

  if (!canWrite) {
    // NOTHING LOCKED rule: this page is only reachable via direct URL without access.
    return (
      <div className="glass-panel p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        Masters is restricted to <strong>super admins</strong>.
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
          Connectors, lenders, products, aggregators, DSA code mappings and the document checklist
        </p>
        <div className="mt-2 text-[11px] px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(201,169,97,0.08)', color: 'var(--text-muted)' }}>
          <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>How it fits together:</span>{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>Aggregator</strong> (the company that sends us cases) →{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>Lender</strong> →{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>Product</strong> →{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>Sub-Product</strong> →{' '}
          a <strong style={{ color: 'var(--text-secondary)' }}>DSA code + payout %</strong> (set in “DSA Codes”).{' '}
          A <strong style={{ color: 'var(--text-secondary)' }}>Connector</strong> is the partner who referred the customer.
        </div>
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

      {tab === 'connectors' && <ConnectorsMasterTab />}

      {tab === 'lenders' && (
        <MasterTab<WithId<Lender>>
          type="lenders" label="Lenders"
          columns={[
            { header: 'Type', render: (r) => r.type?.replace('_', ' ') },
            { header: 'Login Email', render: (r) => r.loginEmail || '—' },
            { header: 'Contacts', render: (r) => r.contacts?.length ? `${r.contacts.length} contact${r.contacts.length > 1 ? 's' : ''}` : '—' },
            { header: 'TAT (days)', render: (r) => r.tatBenchmarkDays ?? '—' },
          ]}
          fields={[
            { key: 'name', label: 'Lender Name', kind: 'text', required: true, placeholder: 'Fedbank Financial Services' },
            { key: 'type', label: 'Type', kind: 'select', required: true,
              options: [{ value: 'PSU_BANK', label: 'PSU Bank' }, { value: 'PRIVATE_BANK', label: 'Private Bank' }, { value: 'NBFC', label: 'NBFC' }, { value: 'HFC', label: 'HFC' }] },
            { key: 'productsOffered', label: 'Products Offered', kind: 'multiselect', options: productOptions },
            { key: 'loginEmail', label: 'Login Email', kind: 'text', hint: 'File-submission inbox, e.g. iob0432@iob.in' },
            { key: 'tatBenchmarkDays', label: 'TAT Benchmark (days)', kind: 'number', hint: 'Login → sanction SLA' },
            { key: 'contacts', label: 'Bank SM / ASM Contacts', kind: 'rows',
              rowFields: [
                { key: 'name', label: 'Name' },
                { key: 'role', label: 'Role', kind: 'select', options: [{ value: 'SM', label: 'SM' }, { value: 'ASM', label: 'ASM' }, { value: 'RM', label: 'RM' }, { value: 'OTHER', label: 'Other' }] },
                { key: 'mobile', label: 'Mobile' }, { key: 'email', label: 'Email' }, { key: 'branch', label: 'Branch' },
              ],
              hint: 'Auto-grows from Stage-4 login SM/ASM entries; add manually here too.' },
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
            { header: 'Category', render: (r) => r.category ?? '—' },
          ]}
          fields={[
            { key: 'name', label: 'Product Name', kind: 'text', required: true, placeholder: 'Loan Against Property' },
            { key: 'shortCode', label: 'Short Code', kind: 'text', required: true, placeholder: 'LAP' },
            { key: 'vertical', label: 'Vertical', kind: 'select', required: true,
              options: [{ value: 'LOANS', label: 'Loans' }, { value: 'WEALTH', label: 'Wealth' }, { value: 'INSURANCE', label: 'Insurance' }, { value: 'CHANNEL_PARTNER', label: 'Channel Partner' }, { value: 'VAS', label: 'VAS' }] },
            { key: 'category', label: 'Lead Category', kind: 'select',
              options: [{ value: '', label: '— none —' }, { value: 'LOAN', label: 'Loan' }, { value: 'WEALTH', label: 'Wealth' }, { value: 'INSURANCE', label: 'Insurance' }, { value: 'CIBIL_CHECK', label: 'CIBIL Check' }, { value: 'PARTNER_DSA', label: 'Partner DSA' }, { value: 'GENERAL', label: 'General' }],
              hint: 'Filters the product list when an agent adds a lead of this category.' },
            { key: 'defaultDocChecklist', label: 'Default Documents', kind: 'multiselect', options: docOptions, hint: 'Auto-attached to the doc tracker for cases on this product' },
            { key: 'defaultRoiRange', label: 'Default ROI Range', kind: 'text', placeholder: '9.5%–12% (display only)' },
            { key: 'status', label: 'Status', kind: 'select', options: STATUS_AI },
          ]}
        />
      )}

      {tab === 'subProducts' && (
        <MasterTab<WithId<SubProduct>>
          type="subProducts" label="Sub Products"
          columns={[
            { header: 'Product', render: (r) => productOptions.find((p) => p.value === r.productId)?.label ?? r.productId },
          ]}
          fields={[
            { key: 'name', label: 'Sub-product Name', kind: 'text', required: true, placeholder: 'Pragati Ashiyana HL' },
            { key: 'productId', label: 'Product', kind: 'select', required: true, options: productOptions,
              hint: 'The product this sub-product belongs to (SubProduct → Product → Lender → DSA code).' },
            { key: 'status', label: 'Status', kind: 'select', options: STATUS_AI },
          ]}
        />
      )}

      {tab === 'aggregators' && <AggregatorMigrationBanner />}
      {tab === 'aggregators' && (
        <MasterTab<WithId<Aggregator>>
          type="aggregators" label="Aggregators"
          columns={[
            { header: 'Type', render: (r) => r.type === 'MASTER_AGGREGATOR' ? 'Master' : 'Sub' },
            { header: 'TDS %', render: (r) => r.standardTdsPct ?? '—' },
            { header: 'Payout', render: (r) => r.payoutFrequency },
          ]}
          fields={[
            { key: 'name', label: 'Aggregator Name', kind: 'text', required: true, placeholder: 'Ruloans' },
            { key: 'type', label: 'Type', kind: 'select', required: true,
              options: [{ value: 'MASTER_AGGREGATOR', label: 'Master Aggregator' }, { value: 'SUB_AGGREGATOR', label: 'Sub Aggregator' }] },
            { key: 'empanelmentDate', label: 'Empanelment Date', kind: 'date' },
            { key: 'contacts', label: 'Phone Contacts', kind: 'rows',
              rowFields: [{ key: 'name', label: 'Name' }, { key: 'dept', label: 'Dept' }, { key: 'mobile', label: 'Mobile' }],
              hint: 'Multiple ops / claims / accounts contacts' },
            { key: 'emails', label: 'Email Contacts', kind: 'rows',
              rowFields: [{ key: 'name', label: 'Name' }, { key: 'dept', label: 'Dept' }, { key: 'email', label: 'Email' }] },
            { key: 'claimsEmail', label: 'Claims Email (primary)', kind: 'text', placeholder: 'needconfirmation@ruloans.vip' },
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
      {tab === 'partnerScoring' && <PartnerScoringTab />}

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
