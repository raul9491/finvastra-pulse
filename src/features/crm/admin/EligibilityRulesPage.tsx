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

  return (
    <>
      <td className="px-4 py-3 text-sm font-medium align-top" style={{ color: 'var(--text-primary)' }}>
        {provider.name}
      </td>
      <td className="px-4 py-3 align-top">
        <input
          type="number"
          value={values.minMonthlyIncome}
          onChange={e => setValues(v => ({ ...v, minMonthlyIncome: e.target.value }))}
          placeholder="e.g. 25000"
          className="glass-inp w-full text-sm"
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
          className="glass-inp w-full text-sm"
          aria-label="Max FOIR %"
        />
      </td>
      <td className="px-4 py-3 align-top">
        <textarea
          value={values.maxTicketSizeJson}
          onChange={e => setValues(v => ({ ...v, maxTicketSizeJson: e.target.value }))}
          placeholder={'{"home_loan": 10000000}'}
          rows={3}
          className={`glass-inp w-full text-sm resize-none font-mono text-xs${!jsonValid ? ' border-red-400' : ''}`}
          aria-label="Max ticket size JSON"
        />
        {!jsonValid && (
          <p className="text-xs mt-0.5" style={{ color: '#f87171' }}>Invalid JSON</p>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <input
          type="text"
          value={values.notes}
          onChange={e => setValues(v => ({ ...v, notes: e.target.value }))}
          placeholder="Optional notes"
          className="glass-inp w-full text-sm"
          aria-label="Notes"
        />
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-col items-start gap-1.5">
          {error && <span className="text-xs" style={{ color: '#f87171' }}>{error}</span>}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !jsonValid}
              className="p-1.5 rounded-lg hover:bg-(--shell-hover-soft) disabled:opacity-50 transition-colors"
              style={{ color: '#34d399' }}
              title="Save"
            >
              <Check size={14} />
            </button>
            <button
              onClick={onCancel}
              className="p-1.5 rounded-lg hover:bg-(--shell-hover-soft) transition-colors"
              style={{ color: 'var(--text-muted)' }}
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
      <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {provider.name}
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>
        {rule?.minMonthlyIncome ? `₹${rule.minMonthlyIncome.toLocaleString('en-IN')}` : <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>
        {rule?.maxFoirPct ? `${rule.maxFoirPct}%` : <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </td>
      <td className="px-4 py-3 text-sm font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
        {rule?.maxTicketSize
          ? <span style={{ color: '#C9A961' }}>{JSON.stringify(rule.maxTicketSize)}</span>
          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>
        {rule?.notes ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg hover:bg-(--shell-hover-soft) transition-colors"
          style={{ color: 'var(--text-muted)' }}
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

  // Only banks have eligibility rules for loan products
  const bankProviders = useMemo(
    () => allProviders.filter(p => p.type === 'bank'),
    [allProviders],
  );

  // Admin gate — returned after every hook so the hook count stays stable
  // between renders (an early return above a hook is React #310).
  if (profile !== null && profile.role !== 'admin') {
    return <Navigate to="/crm/dashboard" replace />;
  }

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
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}
        >
          Bank Eligibility Rules
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Configure per-bank eligibility criteria used for the FOIR and eligibility snapshot — admin only.
        </p>
      </div>

      {/* Table */}
      <div className="glass-panel overflow-hidden">
        {bankProviders.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No bank providers found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ backgroundColor: 'var(--shell-hover-soft)', borderBottom: '1px solid var(--shell-border)' }}>
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
                      style={{ color: 'var(--text-muted)' }}
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
                    className="hover:bg-(--shell-hover-soft) transition-colors"
                    style={{ borderBottom: '1px solid var(--shell-border)' }}
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
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          <strong>Max Ticket Size</strong> is a JSON object mapping product keys to ₹ amounts, e.g.{' '}
          <code className="px-1 rounded" style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961' }}>{"{ \"home_loan\": 10000000, \"lap\": 5000000 }"}</code>.
          Product keys must match the opportunity product name (lowercased, spaces replaced with underscores).
        </p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Rules are evaluated at display time only — no bank is auto-disqualified from submission.
        </p>
      </div>
    </div>
  );
}
