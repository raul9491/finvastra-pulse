/**
 * Generic, schema-driven master CRUD machinery - the `FieldDef` schema plus the
 * form / detail / list-tab components every simple master (Lenders, Products,
 * Aggregators, Sub Products, Connectors-as-SubDsas, Documents) is rendered from.
 * 
 * Extracted verbatim from MastersPage.tsx (2026-07-22) - no behaviour change.
 * MastersPage now only owns the tab registry and the page shell.
 */
import { useState } from 'react';
import { Plus, Pencil, X } from 'lucide-react';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect, MultiSearchableSelect } from '../../../components/ui/SearchableSelect';
import { apiCrm2, useCrm2Collection } from '../lib';
import { FLabel, inp } from '../formPrimitives';

export type WithId<T> = T & { id: string };

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
export function MasterTab<T extends { id: string; name: string; status: string }>({
  type, label, fields, columns, expand, transform, noun, singular, intro,
}: {
  type: string;                       // API master type == collection name
  label: string;
  fields: FieldDef[];
  columns: Array<{ header: string; render: (row: T) => React.ReactNode }>;
  expand?: (row: T) => Record<string, unknown>;        // flatten nested → form keys (edit)
  transform?: (values: Record<string, unknown>) => Record<string, unknown>;  // reassemble before submit
  noun?: string;                      // display noun for search/empty copy (acronyms keep their casing)
  singular?: string;                  // Add-button noun
  intro?: React.ReactNode;            // definition/help line rendered between the toolbar and the table
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
        <input className="glass-inp text-sm w-64" placeholder={`Search ${noun ?? label.toLowerCase()}…`}
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <button onClick={() => setModal({ initial: null })}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
          <Plus size={15} /> Add {singular ?? label.replace(/s$/, '')}
        </button>
      </div>

      {intro && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{intro}</p>}

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
                  No {noun ?? label.toLowerCase()} yet — add the first one.
                </td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id} onClick={() => setDetail(r as unknown as Record<string, unknown> & { id: string })}
                  className="cursor-pointer hover:bg-(--shell-hover-soft) transition-colors"
                  style={{ borderTop: '1px solid var(--shell-border)', opacity: r.status === 'ACTIVE' ? 1 : 0.55 }}>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold" style={{ color: '#C9A961' }}>{r.id}</td>
                  <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{r.name}</td>
                  {columns.map((c) => <td key={c.header} className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{c.render(r)}</td>)}
                  <td className="px-3 py-2.5">
                    <span className={r.status === 'ACTIVE' ? 'badge-glass-success' : 'badge-glass-muted'}>
                      {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                    </span>
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
