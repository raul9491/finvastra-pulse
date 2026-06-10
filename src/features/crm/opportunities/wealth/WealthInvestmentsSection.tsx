import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useAuth } from '../../../auth/AuthContext';
import {
  useWealthInvestments,
  addWealthInvestment,
  type AddInvestmentPayload,
} from '../../hooks/useWealthInvestments';
import type { WealthInvestment, WealthInvestmentType } from '../../../../types';
import { WEALTH_INVESTMENT_TYPE_LABELS } from '../../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAmount(n: number | undefined): string {
  if (!n) return '—';
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000)    return `₹${(n / 100_000).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

const STATUS_STYLES: Record<WealthInvestment['status'], React.CSSProperties> = {
  active:   { backgroundColor: '#F0FDF4', color: '#166534' },
  redeemed: { backgroundColor: 'var(--glass-panel-bg)', color: 'var(--text-muted)' },
  paused:   { backgroundColor: '#FFFBEB', color: '#92400E' },
};

// ─── Add Investment Modal ─────────────────────────────────────────────────────

function AddInvestmentModal({
  onSave,
  onClose,
}: {
  onSave: (payload: AddInvestmentPayload) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<AddInvestmentPayload>({
    investmentType: 'mf_sip',
    schemeName:     '',
    investedAmount: 0,
    purchaseDate:   format(new Date(), 'yyyy-MM-dd'),
    status:         'active',
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof AddInvestmentPayload>(k: K, v: AddInvestmentPayload[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (!form.schemeName.trim())    errs.schemeName    = 'Required';
    if (!form.investedAmount)       errs.investedAmount = 'Required';
    if (!form.purchaseDate)         errs.purchaseDate  = 'Required';
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    try { await onSave(form); onClose(); }
    catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const inp = (field?: string) =>
    `w-full text-sm px-3.5 py-2.5 border rounded-lg outline-none focus:ring-2 bg-(--ss-bg) transition-colors ${
      field && errors[field]
        ? 'border-red-400 focus:ring-red-200/50'
        : 'border-(--shell-border-mid) focus:ring-2'
    }`;

  const isSip = form.investmentType === 'mf_sip' || form.investmentType === 'mf_lumpsum';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="glass-modal-panel p-6 w-full max-w-md mx-4 space-y-4 overflow-y-auto max-h-[90vh]">
        <h3 className="text-base font-semibold text-(--text-primary)">Add Investment</h3>

        {/* Type */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-(--text-muted) mb-1">Type *</label>
          <select className={inp()} value={form.investmentType}
            onChange={(e) => set('investmentType', e.target.value as WealthInvestmentType)}>
            {(Object.entries(WEALTH_INVESTMENT_TYPE_LABELS) as [WealthInvestmentType, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>

        {/* Scheme Name */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-1"
            style={{ color: errors.schemeName ? '#DC2626' : '#8B8B85' }}>
            Scheme / Fund Name *
            {errors.schemeName && <span className="ml-1 font-medium normal-case tracking-normal text-red-500">— {errors.schemeName}</span>}
          </label>
          <input className={inp('schemeName')} value={form.schemeName}
            onChange={(e) => set('schemeName', e.target.value)}
            placeholder="e.g. Mirae Asset Large Cap Fund" />
        </div>

        {/* Folio number (MF only) */}
        {isSip && (
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-(--text-muted) mb-1">Folio Number</label>
            <input className={inp()} value={form.folioNumber ?? ''}
              onChange={(e) => set('folioNumber', e.target.value || undefined)}
              placeholder="Optional" />
          </div>
        )}

        {/* SIP amount (SIP only) */}
        {form.investmentType === 'mf_sip' && (
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-(--text-muted) mb-1">Monthly SIP Amount (₹)</label>
            <input type="number" className={inp()} value={form.sipAmount ?? ''}
              onChange={(e) => set('sipAmount', parseFloat(e.target.value) || undefined)}
              placeholder="5000" />
          </div>
        )}

        {/* Invested amount */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-1"
            style={{ color: errors.investedAmount ? '#DC2626' : '#8B8B85' }}>
            Total Invested (₹) *
            {errors.investedAmount && <span className="ml-1 font-medium normal-case tracking-normal text-red-500">— {errors.investedAmount}</span>}
          </label>
          <input type="number" className={inp('investedAmount')} value={form.investedAmount || ''}
            onChange={(e) => set('investedAmount', parseFloat(e.target.value) || 0)}
            placeholder="100000" />
        </div>

        {/* Units + NAV (equity/MF) */}
        {(isSip || form.investmentType === 'direct_equity') && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-(--text-muted) mb-1">Units / Shares</label>
              <input type="number" className={inp()} value={form.units ?? ''}
                onChange={(e) => set('units', parseFloat(e.target.value) || undefined)}
                placeholder="123.456" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-(--text-muted) mb-1">Purchase NAV/Price</label>
              <input type="number" className={inp()} value={form.purchaseNAV ?? ''}
                onChange={(e) => set('purchaseNAV', parseFloat(e.target.value) || undefined)}
                placeholder="55.23" />
            </div>
          </div>
        )}

        {/* Current value */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-(--text-muted) mb-1">Current Value (₹) <span className="normal-case font-normal">(optional)</span></label>
          <input type="number" className={inp()} value={form.currentValue ?? ''}
            onChange={(e) => set('currentValue', parseFloat(e.target.value) || undefined)}
            placeholder="115000" />
        </div>

        {/* Purchase date */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-1"
            style={{ color: errors.purchaseDate ? '#DC2626' : '#8B8B85' }}>
            Purchase / Start Date *
          </label>
          <input type="date" className={inp('purchaseDate')} value={form.purchaseDate}
            onChange={(e) => set('purchaseDate', e.target.value)} />
        </div>

        {/* Status */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-(--text-muted) mb-1">Status</label>
          <select className={inp()} value={form.status}
            onChange={(e) => set('status', e.target.value as AddInvestmentPayload['status'])}>
            <option value="active">Active</option>
            <option value="paused">Paused (SIP)</option>
            <option value="redeemed">Redeemed / Exited</option>
          </select>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-(--text-muted) mb-1">Notes</label>
          <textarea className={`${inp()} resize-none`} rows={2} value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value || undefined)}
            placeholder="Optional" />
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm border border-(--shell-border-mid) rounded-xl hover:bg-(--shell-hover-soft) text-(--text-primary)">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {saving ? 'Saving…' : 'Add Investment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── WealthInvestmentsSection ─────────────────────────────────────────────────

export function WealthInvestmentsSection({
  leadId,
  oppId,
  canWrite,
}: {
  leadId: string;
  oppId:  string;
  canWrite: boolean;
}) {
  const { user } = useAuth();
  const { investments, loading } = useWealthInvestments(leadId, oppId);
  const [showAdd, setShowAdd] = useState(false);

  const handleAdd = async (payload: AddInvestmentPayload) => {
    if (!user) return;
    await addWealthInvestment(leadId, oppId, payload, user.uid);
  };

  // Summary stats
  const totalInvested = investments.reduce((s, i) => s + (i.investedAmount || 0), 0);
  const totalCurrent  = investments.reduce((s, i) => s + (i.currentValue ?? i.investedAmount ?? 0), 0);
  const gain          = totalCurrent - totalInvested;
  const gainPct       = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;

  return (
    <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border-mid) p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-(--text-muted)">Investments</h3>
        {canWrite && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: '#0B153810', color: '#0B1538' }}>
            <Plus size={13} /> Add
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <div key={i} className="h-12 bg-(--shell-hover-hard) rounded-xl animate-pulse" />)}
        </div>
      ) : investments.length === 0 ? (
        <p className="text-sm text-(--text-muted) py-2">No investments recorded yet.</p>
      ) : (
        <>
          {/* Summary strip */}
          {investments.length > 1 && (
            <div className="grid grid-cols-3 gap-3 mb-4 p-3 bg-(--shell-hover-soft) rounded-xl">
              <div>
                <p className="text-[10px] text-(--text-muted) font-medium uppercase tracking-widest">Invested</p>
                <p className="text-sm font-semibold text-(--text-primary)">{fmtAmount(totalInvested)}</p>
              </div>
              <div>
                <p className="text-[10px] text-(--text-muted) font-medium uppercase tracking-widest">Current</p>
                <p className="text-sm font-semibold text-(--text-primary)">{fmtAmount(totalCurrent)}</p>
              </div>
              <div>
                <p className="text-[10px] text-(--text-muted) font-medium uppercase tracking-widest">Return</p>
                <div className="flex items-center gap-1">
                  {gain > 0
                    ? <TrendingUp size={13} className="text-green-600" />
                    : gain < 0
                    ? <TrendingDown size={13} className="text-red-500" />
                    : <Minus size={13} className="text-(--text-muted)" />
                  }
                  <p className="text-sm font-semibold"
                    style={{ color: gain > 0 ? '#166534' : gain < 0 ? '#991B1B' : '#8B8B85' }}>
                    {gainPct >= 0 ? '+' : ''}{gainPct.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Investment rows */}
          <div className="divide-y divide-(--shell-border)">
            {investments.map((inv) => {
              const s = STATUS_STYLES[inv.status];
              const currentVal = inv.currentValue ?? inv.investedAmount;
              const g = currentVal - inv.investedAmount;
              return (
                <div key={inv.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-(--text-primary) truncate">{inv.schemeName}</span>
                        <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: '#EFF6FF', color: '#1D4ED8' }}>
                          {WEALTH_INVESTMENT_TYPE_LABELS[inv.investmentType]}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                          style={s}>
                          {inv.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-(--text-muted) flex-wrap">
                        <span>Invested: <strong className="text-(--text-primary)">{fmtAmount(inv.investedAmount)}</strong></span>
                        {inv.currentValue !== undefined && (
                          <span>Current: <strong className="text-(--text-primary)">{fmtAmount(inv.currentValue)}</strong></span>
                        )}
                        {inv.units && <span>{inv.units.toFixed(3)} units</span>}
                        {inv.folioNumber && <span>Folio: {inv.folioNumber}</span>}
                        <span>{format(parseISO(inv.purchaseDate), 'dd MMM yyyy')}</span>
                      </div>
                    </div>
                    {inv.currentValue !== undefined && (
                      <div className="text-right shrink-0">
                        <div className="flex items-center gap-1 justify-end">
                          {g > 0
                            ? <TrendingUp size={12} className="text-green-600" />
                            : g < 0
                            ? <TrendingDown size={12} className="text-red-500" />
                            : null
                          }
                          <span className="text-xs font-semibold"
                            style={{ color: g > 0 ? '#166534' : g < 0 ? '#991B1B' : '#8B8B85' }}>
                            {g >= 0 ? '+' : ''}{fmtAmount(Math.abs(g))}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  {inv.notes && (
                    <p className="text-xs text-(--text-muted) mt-1.5 italic">{inv.notes}</p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {showAdd && (
        <AddInvestmentModal onSave={handleAdd} onClose={() => setShowAdd(false)} />
      )}
    </div>
  );
}
