import { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { Edit2, Check, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useProviders } from '../hooks/useOpportunities';
import { db } from '../../../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import type { Provider, ProviderType } from '../../../types';

// ─── SLA fields shown only for bank-type providers ────────────────────────────

interface SLAValues {
  submitted_to_in_review: number;
  in_review_to_sanctioned: number;
  sanctioned_to_disbursed: number;
}

// typicalTurnaroundDays is now on the base Provider type
type ProviderWithSLA = Provider;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  bank:            'Bank',
  amc:             'AMC',
  life_insurer:    'Life Insurer',
  general_insurer: 'General Insurer',
};

const DEFAULT_SLA: SLAValues = {
  submitted_to_in_review: 3,
  in_review_to_sanctioned: 7,
  sanctioned_to_disbursed: 5,
};

// ─── Editable SLA row ─────────────────────────────────────────────────────────

function SLARowEdit({
  provider,
  onSave,
  onCancel,
}: {
  provider: ProviderWithSLA;
  onSave: (values: SLAValues) => Promise<void>;
  onCancel: () => void;
}) {
  const sla = provider.typicalTurnaroundDays ?? DEFAULT_SLA;
  const [values, setValues] = useState<SLAValues>({ ...sla });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(values);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
      setSaving(false);
    }
  };

  const inputClass =
    'w-20 px-2 py-1 text-sm text-center bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:bg-white transition-colors';

  return (
    <>
      <td className="px-4 py-3 text-sm font-medium" style={{ color: '#0A0A0A' }}>
        {provider.name}
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>
        {PROVIDER_TYPE_LABELS[provider.type]}
      </td>
      <td className="px-4 py-3">
        <input
          type="number"
          min={1}
          value={values.submitted_to_in_review}
          onChange={(e) => setValues((v) => ({ ...v, submitted_to_in_review: Number(e.target.value) }))}
          className={inputClass}
          aria-label="Submitted to In-Review days"
        />
      </td>
      <td className="px-4 py-3">
        <input
          type="number"
          min={1}
          value={values.in_review_to_sanctioned}
          onChange={(e) => setValues((v) => ({ ...v, in_review_to_sanctioned: Number(e.target.value) }))}
          className={inputClass}
          aria-label="In-Review to Sanctioned days"
        />
      </td>
      <td className="px-4 py-3">
        <input
          type="number"
          min={1}
          value={values.sanctioned_to_disbursed}
          onChange={(e) => setValues((v) => ({ ...v, sanctioned_to_disbursed: Number(e.target.value) }))}
          className={inputClass}
          aria-label="Sanctioned to Disbursed days"
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-red-500">{error}</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 transition-colors"
            title="Save"
          >
            <Check size={14} />
          </button>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
            title="Cancel"
          >
            <X size={14} />
          </button>
        </div>
      </td>
    </>
  );
}

// ─── Read-only row ────────────────────────────────────────────────────────────

function SLARowRead({
  provider,
  onEdit,
}: {
  provider: ProviderWithSLA;
  onEdit: () => void;
}) {
  const sla = provider.typicalTurnaroundDays ?? DEFAULT_SLA;
  const isBank = provider.type === 'bank';

  return (
    <>
      <td className="px-4 py-3 text-sm font-medium" style={{ color: '#0A0A0A' }}>
        {provider.name}
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>
        {PROVIDER_TYPE_LABELS[provider.type]}
      </td>
      {isBank ? (
        <>
          <td className="px-4 py-3 text-sm text-center" style={{ color: '#2A2A2A' }}>
            {sla.submitted_to_in_review}d
          </td>
          <td className="px-4 py-3 text-sm text-center" style={{ color: '#2A2A2A' }}>
            {sla.in_review_to_sanctioned}d
          </td>
          <td className="px-4 py-3 text-sm text-center" style={{ color: '#2A2A2A' }}>
            {sla.sanctioned_to_disbursed}d
          </td>
        </>
      ) : (
        <td className="px-4 py-3 text-xs text-center" colSpan={3} style={{ color: '#8B8B85' }}>
          N/A — not a bank
        </td>
      )}
      <td className="px-4 py-3">
        {isBank && (
          <button
            onClick={onEdit}
            className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors"
            title="Edit SLA config"
          >
            <Edit2 size={14} />
          </button>
        )}
      </td>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ProvidersPage() {
  const { profile } = useAuth();
  const providers = useProviders() as ProviderWithSLA[];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<ProviderType | ''>('');

  // Admin gate
  if (profile !== null && profile.role !== 'admin') {
    return <Navigate to="/crm/dashboard" replace />;
  }

  const filtered = useMemo(() => {
    if (!filterType) return providers;
    return providers.filter((p) => p.type === filterType);
  }, [providers, filterType]);

  const handleSaveSLA = async (providerId: string, values: SLAValues) => {
    await updateDoc(doc(db, 'providers', providerId), {
      typicalTurnaroundDays: values,
    });
    setEditingId(null);
  };

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div>
        <h2
          className="text-3xl mb-1"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}
        >
          Providers
        </h2>
        <p className="text-sm" style={{ color: '#8B8B85' }}>
          Active providers and bank SLA turnaround configuration — admin only.
        </p>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#8B8B85' }}>
          Type
        </label>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as ProviderType | '')}
          className="px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg outline-none hover:border-slate-300 transition-colors"
          style={{ color: filterType ? '#0A0A0A' : '#8B8B85' }}
        >
          <option value="">All types</option>
          <option value="bank">Bank</option>
          <option value="amc">AMC</option>
          <option value="life_insurer">Life Insurer</option>
          <option value="general_insurer">General Insurer</option>
        </select>
        <span className="text-xs" style={{ color: '#8B8B85' }}>
          {filtered.length} provider{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: '#8B8B85' }}>No providers found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ backgroundColor: '#FAFAF7', borderBottom: '1px solid #E2E8F0' }}>
                  {[
                    'Provider Name',
                    'Type',
                    'SLA: Submitted → Review',
                    'SLA: Review → Sanctioned',
                    'SLA: Sanctioned → Disbursed',
                    '',
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-center first:text-left"
                      style={{ color: '#8B8B85' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((provider) => (
                  <tr
                    key={provider.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
                  >
                    {editingId === provider.id && provider.type === 'bank' ? (
                      <SLARowEdit
                        provider={provider}
                        onSave={(values) => handleSaveSLA(provider.id, values)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <SLARowRead
                        provider={provider}
                        onEdit={() => setEditingId(provider.id)}
                      />
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs" style={{ color: '#8B8B85' }}>
        SLA values are used by the Bank SLA job to flag overdue submissions. Only bank-type providers support turnaround configuration.
      </p>
    </div>
  );
}
