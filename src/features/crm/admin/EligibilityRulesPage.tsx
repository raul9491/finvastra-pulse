import { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { Edit2, Check, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useProviders } from '../hooks/useOpportunities';
import { db } from '../../../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import type { Provider, EligibilityRule } from '../../../types';

// ─── Editable row ─────────────────────────────────────────────────────────────

interface EditValues {
  minMonthlyIncome: string;
  maxFoirPct: string;
  maxTicketSizeJson: string; // JSON string for the partial record
  notes: string;
}

function ruleToEditValues(rule: EligibilityRule | undefined): EditValues {
  return {
    minMonthlyIncome:  rule?.minMonthlyIncome  ? String(rule.minMonthlyIncome)  : '',
    maxFoirPct:        rule?.maxFoirPct        ? String(rule.maxFoirPct)        : '',
    maxTicketSizeJson: rule?.maxTicketSize     ? JSON.stringify(rule.maxTicketSize, null, 2) : '',
    notes:             rule?.notes             ?? '',
  };
}

function editValuesToRule(values: EditValues): EligibilityRule {
  const rule: EligibilityRule = {};
  if (values.minMonthlyIncome) rule.minMonthlyIncome = Number(values.minMonthlyIncome);
  if (values.maxFoirPct)       rule.maxFoirPct       = Number(values.maxFoirPct);
  if (values.notes.trim())     rule.notes            = values.notes.trim();
  if (values.maxTicketSizeJson.trim()) {
    try {
      rule.maxTicketSize = JSON.parse(values.maxTicketSizeJson) as Partial<Record<string, number>>;
    } catch {
      // ignore invalid JSON — validation is shown in the UI
    }
  }
  return rule;
}

function isValidJson(str: string): boolean {
  if (!str.trim()) return true;
  try { JSON.parse(str); return true; } catch { return false; }
}

// ─── Edit form row ─────────────────────────────────────────────────────────────

function EligibilityEditRow({
  provider,
  onSave,
  onCancel,
}: {
  provider: Provider;
  onSave: (rule: EligibilityRule) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<EditValues>(() => ruleToEditValues(provider.eligibilityRules));
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const jsonValid = isValidJson(values.maxTicketSizeJson);

  const handleSave = async () => {
    if (!jsonValid) { setError('Max ticket size must be valid JSON'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(editValuesToRule(values));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
      setSaving(false);
    }
  };

  const inputClass =
    'w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 transition-colors bg-white';

  return (
    <>
      <td className="px-4 py-3 text-sm font-medium align-top" style={{ color: '#0A0A0A' }}>
        {provider.name}
      </td>
      <td className="px-4 py-3 align-top">
        <input
          type="number"
          value={values.minMonthlyIncome}
          onChange={e => setValues(v => ({ ...v, minMonthlyIncome: e.target.value }))}
          placeholder="e.g. 25000"
          className={inputClass}
          aria-label="Min monthly income"
        />
      </td>
      <td className="px-4 py-3 align-top">
        <input
          type="number"
          value={values.maxFoirPct}
          onChange={e => setValues(v => ({ ...v, maxFoirPct: e.target.value }))}
          placeholder="e.g. 50"
          min={1}
          max={100}
          className={inputClass}
          aria-label="Max FOIR %"
        />
      </td>
      <td className="px-4 py-3 align-top">
        <textarea
          value={values.maxTicketSizeJson}
          onChange={e => setValues(v => ({ ...v, maxTicketSizeJson: e.target.value }))}
          placeholder={'{"home_loan": 10000000}'}
          rows={3}
          className={`${inputClass} resize-none font-mono text-xs ${!jsonValid ? 'border-red-400 focus:ring-red-200' : ''}`}
          aria-label="Max ticket size JSON"
        />
        {!jsonValid && (
          <p className="text-xs text-red-500 mt-0.5">Invalid JSON</p>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <input
          type="text"
          value={values.notes}
          onChange={e => setValues(v => ({ ...v, notes: e.target.value }))}
          placeholder="Optional notes"
          className={inputClass}
          aria-label="Notes"
        />
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-col items-start gap-1.5">
          {error && <span className="text-xs text-red-500">{error}</span>}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !jsonValid}
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
        </div>
      </td>
    </>
  );
}

// ─── Read-only row ─────────────────────────────────────────────────────────────

function EligibilityReadRow({
  provider,
  onEdit,
}: {
  provider: Provider;
  onEdit: () => void;
}) {
  const rule = provider.eligibilityRules;

  return (
    <>
      <td className="px-4 py-3 text-sm font-medium" style={{ color: '#0A0A0A' }}>
        {provider.name}
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>
        {rule?.minMonthlyIncome ? `₹${rule.minMonthlyIncome.toLocaleString('en-IN')}` : <span style={{ color: '#8B8B85' }}>—</span>}
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>
        {rule?.maxFoirPct ? `${rule.maxFoirPct}%` : <span style={{ color: '#8B8B85' }}>—</span>}
      </td>
      <td className="px-4 py-3 text-sm font-mono text-xs" style={{ color: '#2A2A2A' }}>
        {rule?.maxTicketSize
          ? <span style={{ color: '#475569' }}>{JSON.stringify(rule.maxTicketSize)}</span>
          : <span style={{ color: '#8B8B85' }}>—</span>}
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>
        {rule?.notes ?? <span style={{ color: '#8B8B85' }}>—</span>}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={onEdit}
          className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors"
          title="Edit eligibility rules"
        >
          <Edit2 size={14} />
        </button>
      </td>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function EligibilityRulesPage() {
  const { profile } = useAuth();
  const allProviders = useProviders();
  const [editingId, setEditingId] = useState<string | null>(null);

  // Admin gate
  if (profile !== null && profile.role !== 'admin') {
    return <Navigate to="/crm/dashboard" replace />;
  }

  // Only banks have eligibility rules for loan products
  const bankProviders = useMemo(
    () => allProviders.filter(p => p.type === 'bank'),
    [allProviders],
  );

  const handleSave = async (providerId: string, rule: EligibilityRule) => {
    await updateDoc(doc(db, 'providers', providerId), {
      eligibilityRules: rule,
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
          Bank Eligibility Rules
        </h2>
        <p className="text-sm" style={{ color: '#8B8B85' }}>
          Configure per-bank eligibility criteria used for the FOIR and eligibility snapshot — admin only.
        </p>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {bankProviders.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: '#8B8B85' }}>No bank providers found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ backgroundColor: '#FAFAF7', borderBottom: '1px solid #E2E8F0' }}>
                  {[
                    'Bank',
                    'Min Monthly Income',
                    'Max FOIR %',
                    'Max Ticket Size (JSON)',
                    'Notes',
                    '',
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: '#8B8B85' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bankProviders.map((provider) => (
                  <tr
                    key={provider.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
                  >
                    {editingId === provider.id ? (
                      <EligibilityEditRow
                        provider={provider}
                        onSave={(rule) => handleSave(provider.id, rule)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <EligibilityReadRow
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

      <div className="space-y-1">
        <p className="text-xs" style={{ color: '#8B8B85' }}>
          <strong>Max Ticket Size</strong> is a JSON object mapping product keys to ₹ amounts, e.g.{' '}
          <code className="bg-slate-100 px-1 rounded">{"{ \"home_loan\": 10000000, \"lap\": 5000000 }"}</code>.
          Product keys must match the opportunity product name (lowercased, spaces replaced with underscores).
        </p>
        <p className="text-xs" style={{ color: '#8B8B85' }}>
          Rules are evaluated at display time only — no bank is auto-disqualified from submission.
        </p>
      </div>
    </div>
  );
}
