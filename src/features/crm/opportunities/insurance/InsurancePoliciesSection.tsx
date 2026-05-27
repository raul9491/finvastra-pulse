import { useState } from 'react';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { Plus, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../../auth/AuthContext';
import {
  useInsurancePolicies,
  addInsurancePolicy,
  type AddPolicyPayload,
} from '../../hooks/useInsurancePolicies';
import type { InsurancePolicy, InsurancePolicyType } from '../../../../types';
import { INSURANCE_POLICY_TYPE_LABELS } from '../../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAmount(n: number | undefined): string {
  if (!n) return '—';
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000)    return `₹${(n / 100_000).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

const STATUS_STYLES: Record<InsurancePolicy['status'], React.CSSProperties> = {
  active:    { backgroundColor: '#F0FDF4', color: '#166534' },
  lapsed:    { backgroundColor: '#FEF2F2', color: '#991B1B' },
  matured:   { backgroundColor: '#F8FAFC', color: '#475569' },
  cancelled: { backgroundColor: '#FEF2F2', color: '#6B7280' },
};

const FREQ_LABELS: Record<string, string> = {
  annual:       'Annual',
  semi_annual:  'Semi-annual',
  quarterly:    'Quarterly',
  monthly:      'Monthly',
};

// ─── Add Policy Modal ─────────────────────────────────────────────────────────

function AddPolicyModal({
  onSave,
  onClose,
}: {
  onSave: (payload: AddPolicyPayload) => Promise<void>;
  onClose: () => void;
}) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [form, setForm] = useState<AddPolicyPayload>({
    policyNumber:     '',
    insurerName:      '',
    productName:      '',
    policyType:       'term',
    sumAssured:       0,
    annualPremium:    0,
    premiumFrequency: 'annual',
    commencementDate: today,
    renewalDate:      today,
    status:           'active',
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof AddPolicyPayload>(k: K, v: AddPolicyPayload[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (!form.policyNumber.trim())  errs.policyNumber  = 'Required';
    if (!form.insurerName.trim())   errs.insurerName   = 'Required';
    if (!form.productName.trim())   errs.productName   = 'Required';
    if (!form.sumAssured)           errs.sumAssured    = 'Required';
    if (!form.annualPremium)        errs.annualPremium = 'Required';
    if (!form.commencementDate)     errs.commencementDate = 'Required';
    if (!form.renewalDate)          errs.renewalDate   = 'Required';
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    try { await onSave(form); onClose(); }
    catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const inp = (field?: string) =>
    `w-full text-sm px-3.5 py-2.5 border rounded-lg outline-none focus:ring-2 bg-white transition-colors ${
      field && errors[field]
        ? 'border-red-400 focus:ring-red-200/50'
        : 'border-slate-200'
    }`;

  const isSavings = ['endowment', 'ulip', 'pension'].includes(form.policyType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl space-y-4 overflow-y-auto max-h-[90vh]">
        <h3 className="text-base font-semibold text-ink">Add Insurance Policy</h3>

        {/* Policy Type */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-mute mb-1">Policy Type *</label>
          <select className={inp()} value={form.policyType}
            onChange={(e) => set('policyType', e.target.value as InsurancePolicyType)}>
            {(Object.entries(INSURANCE_POLICY_TYPE_LABELS) as [InsurancePolicyType, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>

        {/* Insurer + Product */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-1"
              style={{ color: errors.insurerName ? '#DC2626' : '#8B8B85' }}>
              Insurer *
            </label>
            <input className={inp('insurerName')} value={form.insurerName}
              onChange={(e) => set('insurerName', e.target.value)}
              placeholder="LIC, HDFC Life…" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-1"
              style={{ color: errors.productName ? '#DC2626' : '#8B8B85' }}>
              Product Name *
            </label>
            <input className={inp('productName')} value={form.productName}
              onChange={(e) => set('productName', e.target.value)}
              placeholder="Jeevan Anand…" />
          </div>
        </div>

        {/* Policy Number */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-1"
            style={{ color: errors.policyNumber ? '#DC2626' : '#8B8B85' }}>
            Policy Number *
          </label>
          <input className={inp('policyNumber')} value={form.policyNumber}
            onChange={(e) => set('policyNumber', e.target.value)}
            placeholder="Policy number" />
        </div>

        {/* Sum Assured + Annual Premium */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-1"
              style={{ color: errors.sumAssured ? '#DC2626' : '#8B8B85' }}>
              Sum Assured (₹) *
            </label>
            <input type="number" className={inp('sumAssured')} value={form.sumAssured || ''}
              onChange={(e) => set('sumAssured', parseFloat(e.target.value) || 0)}
              placeholder="1000000" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-1"
              style={{ color: errors.annualPremium ? '#DC2626' : '#8B8B85' }}>
              Annual Premium (₹) *
            </label>
            <input type="number" className={inp('annualPremium')} value={form.annualPremium || ''}
              onChange={(e) => set('annualPremium', parseFloat(e.target.value) || 0)}
              placeholder="25000" />
          </div>
        </div>

        {/* Frequency */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-mute mb-1">Premium Frequency</label>
          <select className={inp()} value={form.premiumFrequency}
            onChange={(e) => set('premiumFrequency', e.target.value as AddPolicyPayload['premiumFrequency'])}>
            <option value="annual">Annual</option>
            <option value="semi_annual">Semi-annual</option>
            <option value="quarterly">Quarterly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-1"
              style={{ color: errors.commencementDate ? '#DC2626' : '#8B8B85' }}>
              Start Date *
            </label>
            <input type="date" className={inp('commencementDate')} value={form.commencementDate}
              onChange={(e) => set('commencementDate', e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-1"
              style={{ color: errors.renewalDate ? '#DC2626' : '#8B8B85' }}>
              Renewal Date *
            </label>
            <input type="date" className={inp('renewalDate')} value={form.renewalDate}
              onChange={(e) => set('renewalDate', e.target.value)} />
          </div>
        </div>

        {/* Maturity Date (savings products) */}
        {isSavings && (
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-mute mb-1">Maturity Date</label>
            <input type="date" className={inp()} value={form.maturityDate ?? ''}
              onChange={(e) => set('maturityDate', e.target.value || undefined)} />
          </div>
        )}

        {/* Status */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-mute mb-1">Status</label>
          <select className={inp()} value={form.status}
            onChange={(e) => set('status', e.target.value as AddPolicyPayload['status'])}>
            <option value="active">Active</option>
            <option value="lapsed">Lapsed</option>
            <option value="matured">Matured</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-mute mb-1">Notes</label>
          <textarea className={`${inp()} resize-none`} rows={2} value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value || undefined)} placeholder="Optional" />
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm border border-slate-200 rounded-xl hover:bg-slate-50 text-ink-soft">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {saving ? 'Saving…' : 'Add Policy'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── InsurancePoliciesSection ─────────────────────────────────────────────────

export function InsurancePoliciesSection({
  leadId,
  oppId,
  canWrite,
}: {
  leadId: string;
  oppId:  string;
  canWrite: boolean;
}) {
  const { user } = useAuth();
  const { policies, loading } = useInsurancePolicies(leadId, oppId);
  const [showAdd, setShowAdd] = useState(false);

  const handleAdd = async (payload: AddPolicyPayload) => {
    if (!user) return;
    await addInsurancePolicy(leadId, oppId, payload, user.uid);
  };

  const today = new Date();

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-mute">Insurance Policies</h3>
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
          {[1, 2].map((i) => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      ) : policies.length === 0 ? (
        <p className="text-sm text-mute py-2">No policies recorded yet.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {policies.map((pol) => {
            const s = STATUS_STYLES[pol.status];
            const daysToRenewal = differenceInCalendarDays(parseISO(pol.renewalDate), today);
            const renewalSoon = pol.status === 'active' && daysToRenewal >= 0 && daysToRenewal <= 30;
            return (
              <div key={pol.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-ink">{pol.productName}</span>
                      <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: '#FFF7ED', color: '#9A3412' }}>
                        {INSURANCE_POLICY_TYPE_LABELS[pol.policyType]}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                        style={s}>
                        {pol.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-mute flex-wrap">
                      <span>{pol.insurerName}</span>
                      <span>Policy: {pol.policyNumber}</span>
                      <span>SA: <strong className="text-ink">{fmtAmount(pol.sumAssured)}</strong></span>
                      <span>Premium: <strong className="text-ink">{fmtAmount(pol.annualPremium)}</strong>/{FREQ_LABELS[pol.premiumFrequency]}</span>
                      <span>From: {format(parseISO(pol.commencementDate), 'dd MMM yyyy')}</span>
                    </div>
                    {renewalSoon && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-700">
                        <AlertTriangle size={11} />
                        Renewal {daysToRenewal === 0 ? 'today' : `in ${daysToRenewal} day${daysToRenewal !== 1 ? 's' : ''}`}
                        {' '}({format(parseISO(pol.renewalDate), 'dd MMM yyyy')})
                      </div>
                    )}
                  </div>
                  {!renewalSoon && pol.status === 'active' && (
                    <div className="text-right shrink-0 text-xs text-mute">
                      <p>Renews</p>
                      <p className="font-medium text-ink">{format(parseISO(pol.renewalDate), 'dd MMM yyyy')}</p>
                    </div>
                  )}
                </div>
                {pol.notes && (
                  <p className="text-xs text-mute mt-1.5 italic">{pol.notes}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <AddPolicyModal onSave={handleAdd} onClose={() => setShowAdd(false)} />
      )}
    </div>
  );
}
