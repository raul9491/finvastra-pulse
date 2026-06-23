/**
 * DSA Code Mappings tab — one mapping per Aggregator × Lender pair (the
 * `connectorId` field is the aggregator; UI relabelled 2026-06-15), with the
 * slab timeline editor. Editing a live slab's % is impossible by design:
 * end-date it and add a successor ("end slab & add new" flow). Overlap
 * validation runs client-side for instant feedback AND server-side as the
 * authority (the API rejects overlapping saves).
 */
import { useMemo, useState } from 'react';
import { Plus, X, GitBranch, CircleStop } from 'lucide-react';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { apiCrm2, useCrm2Collection } from '../lib';
import { findSlabOverlaps, type SlabForResolution } from '../../../lib/crm2/slab';
import { FLabel, inp } from './MastersPage';
import type { DsaCodeMapping, Aggregator, Lender, Product, SubProduct, MappingSlab } from '../../../types/crm2';

type WithId<T> = T & { id: string };
type MappingRow = WithId<DsaCodeMapping>;

const fmtTs = (t: { toDate?: () => Date } | null | undefined) =>
  t?.toDate ? t.toDate().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

function slabToResolution(s: MappingSlab): SlabForResolution {
  return {
    slabId: s.slabId, productIds: s.productIds,
    finvastraPayoutPct: s.finvastraPayoutPct,
    subDsaDefaultPayoutPct: s.subDsaDefaultPayoutPct,
    tdsPct: s.tdsPct,
    effectiveFromMs: s.effectiveFrom.toMillis(),
    effectiveToMs: s.effectiveTo ? s.effectiveTo.toMillis() : null,
  };
}

export function MappingsTab({ productOptions }: { productOptions: Array<{ value: string; label: string }> }) {
  const { rows: mappings, loading } = useCrm2Collection<MappingRow>('dsaCodeMappings');
  const { rows: aggregators } = useCrm2Collection<WithId<Aggregator>>('aggregators');
  const { rows: lenders } = useCrm2Collection<WithId<Lender>>('lenders');
  const { rows: products } = useCrm2Collection<WithId<Product>>('products');
  const { rows: subProducts } = useCrm2Collection<WithId<SubProduct>>('subProducts');

  const [editorFor, setEditorFor] = useState<string | null>(null);   // mappingId
  const [showCreate, setShowCreate] = useState(false);

  const aggName = (id: string) => aggregators.find((a) => a.id === id)?.name ?? id;
  const lenderName = (id: string) => lenders.find((l) => l.id === id)?.name ?? id;
  const productName = (id: string) => {
    const p = products.find((x) => x.id === id);
    return p ? p.shortCode : id;
  };

  const editing = editorFor ? mappings.find((m) => m.id === editorFor) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          One mapping per aggregator × lender × product (optionally × sub-product). Percentages
          live in date-ranged payouts — to change a %, end the current payout and add a new one
          (frozen cases are never affected).
        </p>
        <button onClick={() => setShowCreate(true)}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
          <Plus size={15} /> Add Mapping
        </button>
      </div>

      <div className="glass-panel p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                <th className="text-left font-semibold px-4 py-2.5">ID</th>
                <th className="text-left font-semibold px-3 py-2.5">Aggregator</th>
                <th className="text-left font-semibold px-3 py-2.5">Lender</th>
                <th className="text-left font-semibold px-3 py-2.5">Product</th>
                <th className="text-left font-semibold px-3 py-2.5">DSA Code</th>
                <th className="text-left font-semibold px-3 py-2.5">Payouts</th>
                <th className="text-left font-semibold px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : mappings.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                  No mappings yet — add a connector and a lender first, then map their DSA code here.
                </td></tr>
              ) : mappings.map((m) => (
                <tr key={m.id} onClick={() => setEditorFor(m.id)}
                  className="cursor-pointer hover:bg-(--shell-hover-soft) transition-colors"
                  style={{ borderTop: '1px solid var(--shell-border)', opacity: m.status === 'ACTIVE' ? 1 : 0.55 }}>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold" style={{ color: '#C9A961' }}>{m.id}</td>
                  <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{aggName(m.connectorId)}</td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{lenderName(m.lenderId)}</td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>
                    {m.productId ? productName(m.productId) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    {m.subProduct ? <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}> · {m.subProduct}</span> : null}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{m.dsaCode}</td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>
                    {m.slabs?.length ?? 0} ({m.slabs?.filter((s) => !s.effectiveTo).length ?? 0} live)
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={m.status === 'ACTIVE' ? 'badge-glass-success' : 'badge-glass-muted'}>{m.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <CreateMappingModal
          aggregators={aggregators} lenders={lenders} products={products} subProducts={subProducts}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => setEditorFor(id)}
        />
      )}

      {editing && (
        <MappingEditorModal
          mapping={editing}
          title={`${aggName(editing.connectorId)} × ${lenderName(editing.lenderId)}`}
          productOptions={productOptions}
          productName={productName}
          onClose={() => setEditorFor(null)}
        />
      )}
    </div>
  );
}

// ─── Create mapping ───────────────────────────────────────────────────────────
function CreateMappingModal({ aggregators, lenders, products, subProducts, onClose, onCreated }: {
  aggregators: Array<WithId<Aggregator>>;
  lenders: Array<WithId<Lender>>;
  products: Array<WithId<Product>>;
  subProducts: Array<WithId<SubProduct>>;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [connectorId, setConnectorId] = useState('');
  const [lenderId, setLenderId] = useState('');
  const [productId, setProductId] = useState('');
  const [dsaCode, setDsaCode] = useState('');
  const [codeRegisteredName, setCodeRegisteredName] = useState('');
  // Payout % keyed by sub-product name; '' = whole product (no sub-product).
  const [payout, setPayout] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const selectedProduct = products.find((x) => x.id === productId);
  const selectedLender = lenders.find((x) => x.id === lenderId);
  // Product picker is scoped to the lender's offered products (the chain
  // SubProduct → Product → Lender); falls back to all products if none set.
  const lenderProductIds = selectedLender?.productsOffered ?? [];
  const productPickerOptions = (lenderProductIds.length
    ? products.filter((p) => lenderProductIds.includes(p.id))
    : products
  ).filter((p) => p.status !== 'INACTIVE').map((p) => ({ value: p.id, label: p.name }));
  // Sub-products come from the SubProduct master, scoped to the selected product.
  const subs = subProducts
    .filter((sp) => sp.productId === productId && sp.status !== 'INACTIVE')
    .map((sp) => sp.name)
    .filter((v, i, a) => v && a.indexOf(v) === i);

  // Payout rows: a product with no sub-products → ONE payout (whole product).
  // A product WITH sub-products → a payout per sub-product (+ an optional
  // whole-product fallback). The payout is specific to the product, and to the
  // sub-product when one exists.
  const rows: Array<{ key: string; label: string; required: boolean }> = subs.length === 0
    ? [{ key: '', label: 'Payout %', required: true }]
    : [{ key: '', label: 'Whole product (fallback, optional)', required: false },
       ...subs.map((s) => ({ key: s, label: `${selectedProduct?.shortCode ?? 'Product'} · ${s}`, required: false }))];

  const handleCreate = async () => {
    const e: Record<string, string> = {};
    if (!connectorId) e.connectorId = 'Required';
    if (!lenderId) e.lenderId = 'Required';
    if (!productId) e.productId = 'Required';
    if (!dsaCode.trim()) e.dsaCode = 'Required';
    // Collect filled payout rows (pct > 0).
    const filled = rows
      .map((r) => ({ ...r, pct: Number(payout[r.key]) }))
      .filter((r) => payout[r.key]?.trim() && !isNaN(r.pct) && r.pct > 0 && r.pct <= 100);
    if (rows.some((r) => payout[r.key]?.trim() && (isNaN(Number(payout[r.key])) || Number(payout[r.key]) <= 0 || Number(payout[r.key]) > 100))) {
      e.payout = 'Payouts must be > 0 and ≤ 100';
    }
    if (productId && filled.length === 0 && !e.payout) {
      e.payout = subs.length === 0 ? 'Enter the payout %' : 'Enter a payout % for at least one sub-product';
    }
    if (Object.keys(e).length > 0) { setErrs(e); return; }
    setErrs({}); setServerError(''); setBusy(true);
    try {
      let firstId = '';
      // One mapping per payout row (each keyed by its sub-product); each carries an
      // open-ended initial payout. The DSA code + registered name are shared.
      for (const r of filled) {
        const res = await apiCrm2('POST', '/api/crm2/mappings', {
          connectorId, lenderId, productId,
          subProduct: r.key || null,
          dsaCode: dsaCode.trim(),
          codeRegisteredName: codeRegisteredName.trim() || null,
          slabs: [{ productIds: [productId], finvastraPayoutPct: r.pct, effectiveFrom: today, effectiveTo: null }],
        });
        if (!firstId && res.id) firstId = res.id;
      }
      toast.success(filled.length === 1 ? 'Mapping + payout created' : `${filled.length} mappings + payouts created`);
      onClose();
      if (firstId) onCreated(firstId);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Create failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-md rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>New DSA Code Mapping</h3>
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
          <div>
            <FLabel text="Aggregator" required error={errs.connectorId} />
            <SearchableSelect
              options={aggregators.filter((a) => a.status === 'ACTIVE').map((a) => ({ value: a.id, label: a.name }))}
              value={connectorId} onChange={setConnectorId} placeholder="Select aggregator…" />
          </div>
          <div>
            <FLabel text="Lender" required error={errs.lenderId} />
            <SearchableSelect
              options={lenders.filter((l) => l.status === 'ACTIVE').map((l) => ({ value: l.id, label: l.name }))}
              value={lenderId} onChange={(v) => { setLenderId(v); setProductId(''); setPayout({}); }} placeholder="Select lender…" />
          </div>
          <div>
            <FLabel text="Product" required error={errs.productId} />
            <SearchableSelect
              options={productPickerOptions}
              value={productId}
              onChange={(v) => { setProductId(v); setPayout({}); }}
              placeholder={lenderId ? 'Select product…' : 'Select a lender first…'} />
          </div>
          <div>
            <FLabel text="DSA Code" required error={errs.dsaCode} />
            <input className={inp(!!errs.dsaCode)} value={dsaCode} onChange={(e) => setDsaCode(e.target.value)} placeholder="1033618" />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>Bank-dump match key.</p>
          </div>
          <div>
            <FLabel text="Code Registered Name (optional)" />
            <input className={inp(false)} value={codeRegisteredName}
              onChange={(e) => setCodeRegisteredName(e.target.value)} placeholder="STAR POWERZ DIGITAL TECH P" />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>If known, enter exactly as it appears in bank MIS dumps (recon string-match). Optional.</p>
          </div>
          {/* Payout — specific to the product, and to each sub-product when they exist. */}
          {productId && (
            <div>
              <FLabel text="Payout %" required error={errs.payout} />
              <p className="mb-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {subs.length === 0
                  ? `Finvastra payout for this product (e.g. LAP 1.44%).${productId ? ' This product has no sub-products — add them in the Sub Products tab if needed.' : ''}`
                  : 'This product has sub-products — set a payout per sub-product (e.g. HML · Pragati 1.55%). The whole-product row is an optional fallback.'}
              </p>
              <div className="space-y-2">
                {rows.map((r) => (
                  <div key={r.key || '__whole__'} className="flex items-center gap-2">
                    <span className="flex-1 text-sm truncate" style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
                    <div className="relative w-28">
                      <input type="number" step="0.01" inputMode="decimal"
                        className={inp(false)} value={payout[r.key] ?? ''}
                        onChange={(e) => setPayout((p) => ({ ...p, [r.key]: e.target.value }))}
                        placeholder={r.required ? '1.44' : 'optional'} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-muted)' }}>%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={handleCreate} disabled={busy}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {busy ? 'Creating…' : 'Create Mapping'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Slab timeline editor ─────────────────────────────────────────────────────
function MappingEditorModal({ mapping, title, productOptions, productName, onClose }: {
  mapping: MappingRow;
  title: string;
  productOptions: Array<{ value: string; label: string }>;
  productName: (id: string) => string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [endFor, setEndFor] = useState<string | null>(null);   // slabId

  // Timeline: newest-first by effectiveFrom; live slabs highlighted.
  const slabs = useMemo(
    () => [...(mapping.slabs ?? [])].sort((a, b) => b.effectiveFrom.toMillis() - a.effectiveFrom.toMillis()),
    [mapping.slabs]);

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-2xl rounded-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <GitBranch size={16} style={{ color: '#C9A961' }} /> {title}
            </h3>
            <p className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {mapping.id} · DSA {mapping.dsaCode}{mapping.codeRegisteredName ? ` · "${mapping.codeRegisteredName}"` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close">
            <X size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
              Payout timeline ({slabs.length})
            </p>
            <button onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              <Plus size={13} /> Add Payout
            </button>
          </div>

          {slabs.length === 0 ? (
            <div className="glass-panel p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              No payouts yet — disbursements against this code will be BLOCKED until one exists.
            </div>
          ) : (
            <div className="space-y-2">
              {slabs.map((s) => {
                const live = !s.effectiveTo;
                return (
                  <div key={s.slabId} className="rounded-xl p-3.5 border"
                    style={{ borderColor: live ? 'rgba(52,211,153,0.4)' : 'var(--shell-border)', opacity: live ? 1 : 0.7 }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold" style={{ color: '#C9A961' }}>{s.finvastraPayoutPct}%</span>
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {s.productIds.map(productName).join(', ')}
                      </span>
                      <span className={live ? 'badge-glass-success' : 'badge-glass-muted'}>
                        {live ? 'LIVE' : 'ENDED'}
                      </span>
                      <span className="text-[11px] ml-auto" style={{ color: 'var(--text-muted)' }}>
                        {fmtTs(s.effectiveFrom)} → {fmtTs(s.effectiveTo) ?? 'open'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {s.subDsaDefaultPayoutPct != null && <span>Connector default {s.subDsaDefaultPayoutPct}%</span>}
                      {s.connectorPayoutPctFromBank != null && <span>Aggregator-from-bank {s.connectorPayoutPctFromBank}%</span>}
                      {s.tdsPct != null && <span>TDS {s.tdsPct}%</span>}
                      <span className="font-mono">{s.slabId.slice(0, 8)}</span>
                      {live && (
                        <button onClick={() => setEndFor(s.slabId)}
                          className="ml-auto inline-flex items-center gap-1 font-semibold hover:underline"
                          style={{ color: '#fbbf24' }}>
                          <CircleStop size={12} /> End payout
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            A payout % is immutable — to change one, end it and add a successor.
            Disbursed cases keep their frozen payout regardless.
          </p>
        </div>

        {addOpen && (
          <AddSlabModal
            mapping={mapping} productName={productName}
            onClose={() => setAddOpen(false)}
            onSaved={() => { setAddOpen(false); toast.success('Payout added'); }}
          />
        )}
        {endFor && (
          <EndSlabModal
            mappingId={mapping.id} slabId={endFor}
            onClose={() => setEndFor(null)}
            onSaved={() => { setEndFor(null); toast.success('Payout ended'); }}
          />
        )}
      </div>
    </div>
  );
}

function AddSlabModal({ mapping, productName, onClose, onSaved }: {
  mapping: MappingRow;
  productName: (id: string) => string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const productIds = [mapping.productId];   // a mapping is for ONE product (its payout)
  const [pct, setPct] = useState('');
  const [subDsaPct, setSubDsaPct] = useState('');
  const [connPct, setConnPct] = useState('');
  const [tdsPct, setTdsPct] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    const e: Record<string, string> = {};
    const p = Number(pct);
    if (!pct || isNaN(p) || p <= 0 || p > 100) e.pct = '> 0 and ≤ 100';
    if (!from) e.from = 'Required';
    if (Object.keys(e).length > 0) { setErrs(e); return; }

    // Instant client-side overlap feedback (server re-validates as the authority).
    const candidate: SlabForResolution = {
      slabId: 'candidate', productIds, finvastraPayoutPct: p,
      subDsaDefaultPayoutPct: subDsaPct ? Number(subDsaPct) : null,
      tdsPct: tdsPct ? Number(tdsPct) : null,
      effectiveFromMs: new Date(`${from}T00:00:00`).getTime(),
      effectiveToMs: to ? new Date(`${to}T00:00:00`).getTime() : null,
    };
    const conflicts = findSlabOverlaps([...(mapping.slabs ?? []).map(slabToResolution), candidate]);
    if (conflicts.length > 0) {
      setServerError(`Overlaps an existing payout — end it first:\n${conflicts.join('\n')}`);
      return;
    }

    setErrs({}); setServerError(''); setBusy(true);
    try {
      await apiCrm2('POST', `/api/crm2/mappings/${mapping.id}/slabs`, {
        productIds, finvastraPayoutPct: p,
        subDsaDefaultPayoutPct: subDsaPct ? Number(subDsaPct) : null,
        connectorPayoutPctFromBank: connPct ? Number(connPct) : null,
        tdsPct: tdsPct ? Number(tdsPct) : null,
        effectiveFrom: from, effectiveTo: to || null,
      });
      onSaved();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Save failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-md rounded-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Add Payout</h3>
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
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Payout for <b style={{ color: 'var(--text-secondary)' }}>{productName(mapping.productId)}{mapping.subProduct ? ` · ${mapping.subProduct}` : ''}</b>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FLabel text="Finvastra Payout %" required error={errs.pct} />
              <input type="number" step="0.01" className={inp(!!errs.pct)} value={pct} onChange={(e) => setPct(e.target.value)} placeholder="1.40" />
            </div>
            <div>
              <FLabel text="Connector Default %" />
              <input type="number" step="0.01" className={inp()} value={subDsaPct} onChange={(e) => setSubDsaPct(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <FLabel text="Aggregator-from-Bank %" />
              <input type="number" step="0.01" className={inp()} value={connPct} onChange={(e) => setConnPct(e.target.value)} placeholder="transparency only" />
            </div>
            <div>
              <FLabel text="TDS % Override" />
              <input type="number" step="0.01" className={inp()} value={tdsPct} onChange={(e) => setTdsPct(e.target.value)} placeholder="blank = connector default" />
            </div>
            <div>
              <FLabel text="Effective From" required error={errs.from} />
              <input type="date" className={inp(!!errs.from)} value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <FLabel text="Effective To" />
              <input type="date" className={inp()} value={to} onChange={(e) => setTo(e.target.value)} />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>Blank = current (open-ended)</p>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={handleSave} disabled={busy}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {busy ? 'Saving…' : 'Add Payout'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EndSlabModal({ mappingId, slabId, onClose, onSaved }: {
  mappingId: string; slabId: string; onClose: () => void; onSaved: () => void;
}) {
  const [to, setTo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const handleEnd = async () => {
    if (!to) { setErr('Pick the last effective date'); return; }
    setErr(''); setBusy(true);
    try {
      await apiCrm2('POST', `/api/crm2/mappings/${mappingId}/slabs/${slabId}/end`, { effectiveTo: to });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-sm rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header px-5 py-4">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>End Payout</h3>
        </div>
        <div className="p-5 space-y-4">
          {err && <p className="text-sm" style={{ color: '#f87171' }}>{err}</p>}
          <div>
            <FLabel text="Last Effective Date" required />
            <input type="date" className={inp(!!err)} value={to} onChange={(e) => setTo(e.target.value)} />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              The payout stops applying after this date. Add the successor payout starting the next day.
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={handleEnd} disabled={busy}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#fbbf24', color: '#0B1538' }}>
              {busy ? 'Ending…' : 'End Payout'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
