import { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Edit2, Copy } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '../../auth/AuthContext';
import { useCommissionSlabs, createSlab, updateSlab, toggleSlabActive, copySlabsToProvider } from '../hooks/useCommissionSlabs';
import { useOpportunityTypes, useProviders } from '../hooks/useOpportunities';
import { Modal } from '../../../components/ui/Modal';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import type { CommissionSlab } from '../../../types';

// ─── Slab form schema ─────────────────────────────────────────────────────────
const slabSchema = z.object({
  providerId:    z.string().min(1, 'Select a bank'),
  product:       z.string().min(1, 'Select a product'),
  minTicket:     z.number().min(0, 'Min ticket must be ≥ 0'),
  maxTicket:     z.number().nullable().optional(),
  rateType:      z.enum(['percentage', 'flatFee']),
  rateValue:     z.number().min(0.001, 'Rate must be > 0'),
  basisOn:       z.enum(['sanctioned', 'disbursed']),
  effectiveFrom: z.string().min(1, 'Required'),
  effectiveTo:   z.string().nullable().optional(),
  notes:         z.string().max(500).optional(),
}).refine(
  (d) => d.maxTicket == null || d.maxTicket > d.minTicket,
  { message: 'Max ticket must be greater than min ticket', path: ['maxTicket'] },
);
type SlabFormValues = z.infer<typeof slabSchema>;

// ─── Slab form modal ──────────────────────────────────────────────────────────
function SlabFormModal({ slab, onClose, userId }: {
  slab: CommissionSlab | null;  // null = create mode
  onClose: () => void;
  userId: string;
}) {
  const providers = useProviders();
  const { types } = useOpportunityTypes();
  const banks = providers.filter((p) => p.type === 'bank');
  const loanProducts = types.filter((t) => t.businessLine === 'loan');

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<SlabFormValues>({
    resolver: zodResolver(slabSchema),
    defaultValues: {
      providerId:    slab?.providerId    ?? '',
      product:       slab?.product       ?? '',
      minTicket:     slab?.minTicket     ?? 0,
      maxTicket:     slab?.maxTicket     ?? null,
      rateType:      slab?.percentage != null ? 'percentage' : 'flatFee',
      rateValue:     slab?.percentage    ?? slab?.flatFee   ?? 0,
      basisOn:       slab?.basisOn       ?? 'disbursed',
      effectiveFrom: slab?.effectiveFrom ?? new Date().toISOString().slice(0, 10),
      effectiveTo:   slab?.effectiveTo   ?? null,
      notes:         slab?.notes         ?? '',
    },
  });

  const rateType = watch('rateType');

  const onSubmit = async (values: SlabFormValues) => {
    setSaving(true); setError('');
    try {
      const input = {
        providerId: values.providerId,  product: values.product,
        minTicket:  values.minTicket,   maxTicket: values.maxTicket ?? null,
        ...(values.rateType === 'percentage' ? { percentage: values.rateValue } : { flatFee: values.rateValue }),
        basisOn:       values.basisOn,
        effectiveFrom: values.effectiveFrom,
        effectiveTo:   values.effectiveTo ?? null,
        notes:         values.notes || undefined,
        active:        true,
      };
      if (slab) await updateSlab(slab.id, input, userId);
      else       await createSlab(input, userId);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed.'); setSaving(false); }
  };

  const inputClass = "w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:bg-white transition-colors";

  return (
    <Modal isOpen onClose={onClose} title={slab ? 'Edit Commission Slab' : 'Add Commission Slab'} size="md"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-slate-200 rounded-xl hover:bg-slate-50" style={{ color: '#2A2A2A' }}>Cancel</button>
          <button onClick={handleSubmit(onSubmit)} disabled={saving}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {saving ? 'Saving…' : slab ? 'Update' : 'Create Slab'}
          </button>
        </>
      }>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Bank *</label>
            <Controller
              name="providerId"
              control={control}
              render={({ field }) => (
                <SearchableSelect
                  options={banks.map((b) => ({ value: b.id, label: b.name }))}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Select…"
                  label="Bank"
                />
              )}
            />
            {errors.providerId && <p className="mt-1 text-xs text-red-500">{errors.providerId.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Product *</label>
            <Controller
              name="product"
              control={control}
              render={({ field }) => (
                <SearchableSelect
                  options={loanProducts.map((t) => ({ value: t.name, label: t.name }))}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Select…"
                  label="Product"
                />
              )}
            />
            {errors.product && <p className="mt-1 text-xs text-red-500">{errors.product.message}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Min Ticket ₹ *</label>
            <input type="number" {...register('minTicket', { valueAsNumber: true })} className={inputClass} placeholder="0" />
            {errors.minTicket && <p className="mt-1 text-xs text-red-500">{errors.minTicket.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Max Ticket ₹ (blank = no limit)</label>
            <input type="number" {...register('maxTicket', { setValueAs: v => v === '' ? null : Number(v) })} className={inputClass} placeholder="No limit" />
            {errors.maxTicket && <p className="mt-1 text-xs text-red-500">{errors.maxTicket.message}</p>}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#8B8B85' }}>Rate Type *</label>
            <div className="flex gap-4">
              {(['percentage', 'flatFee'] as const).map((rt) => (
                <label key={rt} className="flex items-center gap-1.5 text-sm cursor-pointer" style={{ color: '#2A2A2A' }}>
                  <input type="radio" {...register('rateType')} value={rt} />
                  {rt === 'percentage' ? '% Rate' : 'Flat ₹'}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>
              {rateType === 'percentage' ? 'Rate (%)' : 'Flat Fee (₹)'} *
            </label>
            <input type="number" step="0.01" {...register('rateValue', { valueAsNumber: true })}
              className={inputClass} placeholder={rateType === 'percentage' ? '0.50' : '5000'} />
            {errors.rateValue && <p className="mt-1 text-xs text-red-500">{errors.rateValue.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#8B8B85' }}>Basis On *</label>
            <div className="flex gap-4">
              {(['disbursed', 'sanctioned'] as const).map((b) => (
                <label key={b} className="flex items-center gap-1.5 text-sm cursor-pointer capitalize" style={{ color: '#2A2A2A' }}>
                  <input type="radio" {...register('basisOn')} value={b} /> {b}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Effective From *</label>
            <input type="date" {...register('effectiveFrom')} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Effective To (blank = open-ended)</label>
            <input type="date" {...register('effectiveTo', { setValueAs: v => v === '' ? null : v })} className={inputClass} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Notes</label>
          <input type="text" {...register('notes')} className={inputClass} placeholder="Optional" />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Copy bank modal ──────────────────────────────────────────────────────────
function CopyBankModal({ onClose, userId }: { onClose: () => void; userId: string }) {
  const providers = useProviders();
  const banks = providers.filter((p) => p.type === 'bank');
  const [from, setFrom] = useState('');
  const [to,   setTo]   = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState('');

  const handleCopy = async () => {
    setSaving(true);
    try {
      const n = await copySlabsToProvider(from, to, userId);
      setResult(`Copied ${n} slab(s) successfully.`);
    } catch (e) { setResult(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  };

  return (
    <Modal isOpen onClose={onClose} title="Copy Slabs Between Banks" size="sm"
      footer={result ? (
        <button onClick={onClose} className="px-6 py-2.5 text-sm font-semibold rounded-xl" style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>Done</button>
      ) : (
        <>
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-slate-200 rounded-xl" style={{ color: '#2A2A2A' }}>Cancel</button>
          <button onClick={handleCopy} disabled={!from || !to || from === to || saving}
            className="px-6 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50" style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {saving ? 'Copying…' : 'Copy Active Slabs'}
          </button>
        </>
      )}>
      {result ? (
        <p className="text-sm" style={{ color: result.startsWith('Error') ? '#EF4444' : '#166534' }}>{result}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: '#8B8B85' }}>Creates copies of all active slabs from the source bank under the target bank.</p>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>From Bank</label>
            <SearchableSelect
              options={banks.map((b) => ({ value: b.id, label: b.name }))}
              value={from}
              onChange={(v) => setFrom(v)}
              placeholder="Select source…"
              label="From Bank"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>To Bank</label>
            <SearchableSelect
              options={banks.filter((b) => b.id !== from).map((b) => ({ value: b.id, label: b.name }))}
              value={to}
              onChange={(v) => setTo(v)}
              placeholder="Select target…"
              label="To Bank"
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function CommissionSlabsPage() {
  const { user, profile } = useAuth();
  const { slabs, loading } = useCommissionSlabs();
  const providers = useProviders();

  const [slabModalOpen, setSlabModalOpen] = useState(false);
  const [editingSlab,   setEditingSlab]   = useState<CommissionSlab | null>(null);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [filterBank,    setFilterBank]    = useState('');
  const [showInactive,  setShowInactive]  = useState(false);

  if (profile?.role !== 'admin') return <Navigate to="/crm/dashboard" replace />;

  const banks = providers.filter((p) => p.type === 'bank');
  const providerMap = useMemo(() => new Map(providers.map((p) => [p.id, p.name])), [providers]);

  const filtered = useMemo(() =>
    slabs.filter((s) => {
      if (filterBank    && s.providerId !== filterBank) return false;
      if (!showInactive && !s.active)                    return false;
      return true;
    }), [slabs, filterBank, showInactive]);

  const openCreate = () => { setEditingSlab(null); setSlabModalOpen(true); };
  const openEdit   = (s: CommissionSlab) => { setEditingSlab(s); setSlabModalOpen(true); };
  const closeModal = () => { setSlabModalOpen(false); setEditingSlab(null); };

  const fmtTicket = (n: number | null | undefined) =>
    n != null ? `₹${(n / 100000).toFixed(0)}L` : 'No limit';
  const fmtRate = (s: CommissionSlab) =>
    s.percentage != null ? `${s.percentage}%` : `₹${s.flatFee?.toLocaleString('en-IN')} flat`;
  const fmtDate = (d: string | null) =>
    d ? format(new Date(d), 'dd MMM yy') : '—';

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
              Commission Slabs
            </h2>
            <p className="text-sm" style={{ color: '#8B8B85' }}>
              {slabs.filter(s => s.active).length} active — admin only
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setCopyModalOpen(true)}
              className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
              style={{ color: '#2A2A2A' }}>
              <Copy size={14} /> Copy Bank
            </button>
            <button onClick={openCreate}
              className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg font-semibold"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              <Plus size={15} /> Add Slab
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <SearchableSelect
            options={[
              { value: '', label: 'All Banks' },
              ...banks.map((b) => ({ value: b.id, label: b.name })),
            ]}
            value={filterBank}
            onChange={(v) => setFilterBank(v)}
            label="Filter by bank"
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#2A2A2A' }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="animate-pulse divide-y divide-slate-100">
              {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-slate-50" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm" style={{ color: '#8B8B85' }}>No slabs match your filters.</p>
              <button onClick={openCreate} className="mt-2 text-sm font-semibold underline" style={{ color: '#0B1538' }}>
                Add the first slab →
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr style={{ backgroundColor: '#FAFAF7', borderBottom: '1px solid #E2E8F0' }}>
                    {['Bank', 'Product', 'Ticket Range', 'Rate', 'Basis', 'Effective', 'Active', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-medium" style={{ color: '#0A0A0A' }}>
                        {providerMap.get(s.providerId) ?? s.providerId.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>{s.product}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>
                        {fmtTicket(s.minTicket)} – {fmtTicket(s.maxTicket)}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold" style={{ color: '#0A0A0A' }}>{fmtRate(s)}</td>
                      <td className="px-4 py-3 text-sm capitalize" style={{ color: '#2A2A2A' }}>{s.basisOn}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#8B8B85' }}>
                        {fmtDate(s.effectiveFrom)} – {fmtDate(s.effectiveTo)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleSlabActive(s.id, !s.active, user!.uid)}
                          className="text-xs font-semibold px-2.5 py-1 rounded-full"
                          style={{ backgroundColor: s.active ? '#F0FDF4' : '#F1F5F9', color: s.active ? '#166534' : '#64748B' }}
                        >
                          {s.active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => openEdit(s)} className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors">
                          <Edit2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {slabModalOpen && (
        <SlabFormModal slab={editingSlab} onClose={closeModal} userId={user!.uid} />
      )}
      {copyModalOpen && (
        <CopyBankModal onClose={() => setCopyModalOpen(false)} userId={user!.uid} />
      )}
    </>
  );
}
