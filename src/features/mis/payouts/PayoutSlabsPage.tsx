import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { usePayoutSlabs, createSlab, updateSlab, toggleSlabActive, seedDefaultSlabs } from '../hooks/usePayouts';
import { Modal } from '../../../components/ui/Modal';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import type { SearchableSelectOption } from '../../../components/ui/SearchableSelect';
import type { RmPayoutSlab } from '../../../types';

// ─── Local types ──────────────────────────────────────────────────────────────

type TargetMode = 'role' | 'user';

interface SlabFormState {
  targetMode: TargetMode;
  targetId: string;
  businessLine: 'loan' | 'wealth' | 'insurance';
  percentage: number;
  effectiveFrom: string;
  effectiveTo: string;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): SlabFormState {
  return {
    targetMode: 'role',
    targetId: '',
    businessLine: 'loan',
    percentage: 0,
    effectiveFrom: todayStr(),
    effectiveTo: '',
  };
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium" style={{ color: '#0A0A0A' }}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Status pill ─────────────────────────────────────────────────────────────

function ActivePill({ active }: { active: boolean }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
      style={
        active
          ? { backgroundColor: '#D1FAE5', color: '#065F46' }
          : { backgroundColor: '#F1F5F9', color: '#64748B' }
      }
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

// ─── AddSlabModal ─────────────────────────────────────────────────────────────

interface AddSlabModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingSlab: RmPayoutSlab | null; // null = new slab
  employees: ReturnType<typeof useAllEmployees>['employees'];
  createdBy: string;
}

function AddSlabModal({ isOpen, onClose, existingSlab, employees, createdBy }: AddSlabModalProps) {
  const [form, setForm] = useState<SlabFormState>(() =>
    existingSlab
      ? {
          targetMode:   existingSlab.targetType,
          targetId:     existingSlab.targetId,
          businessLine: existingSlab.businessLine,
          percentage:   existingSlab.percentage,
          effectiveFrom: existingSlab.effectiveFrom,
          effectiveTo:  existingSlab.effectiveTo ?? '',
        }
      : emptyForm(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens/closes or when the target slab changes
  const handleOpen = () => {
    setForm(
      existingSlab
        ? {
            targetMode:   existingSlab.targetType,
            targetId:     existingSlab.targetId,
            businessLine: existingSlab.businessLine,
            percentage:   existingSlab.percentage,
            effectiveFrom: existingSlab.effectiveFrom,
            effectiveTo:  existingSlab.effectiveTo ?? '',
          }
        : emptyForm(),
    );
    setError(null);
  };

  // Sync when isOpen flips to true
  if (isOpen && !saving && !error && form.effectiveFrom === '' && !existingSlab) {
    handleOpen();
  }

  const crmAccessEmployees = employees.filter((e) => e.crmAccess);
  const employeeOptions: SearchableSelectOption[] = crmAccessEmployees.map((e) => ({
    value: e.userId,
    label: e.displayName,
    description: e.crmRole ?? undefined,
  }));

  const roleOptions: SearchableSelectOption[] = [
    { value: 'lead_generator', label: 'Lead Generator' },
    { value: 'lead_convertor', label: 'Lead Convertor' },
    { value: 'manager', label: 'Manager' },
  ];

  async function handleSave() {
    if (!form.targetId) { setError('Please select a target.'); return; }
    if (form.percentage <= 0 || form.percentage > 100) { setError('Percentage must be between 1 and 100.'); return; }
    if (!form.effectiveFrom) { setError('Effective from date is required.'); return; }

    setSaving(true);
    setError(null);
    try {
      const payload: Omit<RmPayoutSlab, 'id' | 'createdAt'> = {
        targetType:   form.targetMode,
        targetId:     form.targetId,
        businessLine: form.businessLine,
        percentage:   form.percentage,
        effectiveFrom: form.effectiveFrom,
        effectiveTo:  form.effectiveTo || null,
        active: true,
        createdBy,
      };

      if (existingSlab) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { createdBy: _cb, ...updates } = payload;
        await updateSlab(existingSlab.id, updates);
      } else {
        await createSlab(payload);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={existingSlab ? 'Edit Payout Slab' : 'Add Payout Slab'}
      size="md"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
            style={{ color: '#0A0A0A' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
            style={{ backgroundColor: '#0B1538', color: '#FFFFFF' }}
          >
            {saving ? 'Saving…' : existingSlab ? 'Update Slab' : 'Add Slab'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">

        {/* Target type */}
        <Field label="Target type" required>
          <div className="flex gap-3">
            {(['role', 'user'] as TargetMode[]).map((mode) => (
              <label key={mode} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value={mode}
                  checked={form.targetMode === mode}
                  onChange={() => setForm((f) => ({ ...f, targetMode: mode, targetId: '' }))}
                  className="accent-[#0B1538]"
                />
                <span className="text-sm" style={{ color: '#0A0A0A' }}>
                  {mode === 'role' ? 'By CRM Role' : 'Specific User'}
                </span>
              </label>
            ))}
          </div>
        </Field>

        {/* Target ID */}
        {form.targetMode === 'role' ? (
          <Field label="CRM Role" required>
            <SearchableSelect
              options={roleOptions}
              value={form.targetId}
              onChange={(v) => setForm((f) => ({ ...f, targetId: v }))}
              placeholder="Select role…"
            />
          </Field>
        ) : (
          <Field label="Employee" required>
            <SearchableSelect
              options={employeeOptions}
              value={form.targetId}
              onChange={(v) => setForm((f) => ({ ...f, targetId: v }))}
              placeholder="Select employee…"
              emptyMessage="No CRM-enabled employees found."
            />
          </Field>
        )}

        {/* Business line */}
        <Field label="Business Line" required>
          <div className="flex gap-3">
            {(['loan', 'wealth', 'insurance'] as const).map((bl) => (
              <label key={bl} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value={bl}
                  checked={form.businessLine === bl}
                  onChange={() => setForm((f) => ({ ...f, businessLine: bl }))}
                  disabled={bl !== 'loan'}
                  className="accent-[#0B1538]"
                />
                <span
                  className="text-sm"
                  style={{ color: bl !== 'loan' ? '#8B8B85' : '#0A0A0A' }}
                >
                  {bl === 'loan' ? 'Loan' : bl === 'wealth' ? 'Wealth (coming soon)' : 'Insurance (coming soon)'}
                </span>
              </label>
            ))}
          </div>
        </Field>

        {/* Percentage */}
        <Field label="Payout Percentage (%)" required>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={form.percentage === 0 ? '' : form.percentage}
            placeholder="e.g. 50"
            onChange={(e) =>
              setForm((f) => ({ ...f, percentage: parseFloat(e.target.value) || 0 }))
            }
            className="px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538] w-full"
          />
        </Field>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Effective From" required>
            <input
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
              className="px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538]"
            />
          </Field>
          <Field label="Effective To">
            <input
              type="date"
              value={form.effectiveTo}
              onChange={(e) => setForm((f) => ({ ...f, effectiveTo: e.target.value }))}
              className="px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538]"
              placeholder="Leave blank = open-ended"
            />
            <span className="text-xs" style={{ color: '#8B8B85' }}>Leave blank for open-ended.</span>
          </Field>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}
      </div>
    </Modal>
  );
}

// ─── PayoutSlabsPage ──────────────────────────────────────────────────────────

export function PayoutSlabsPage() {
  const { profile } = useAuth();
  const { slabs, loading } = usePayoutSlabs();
  const { employees } = useAllEmployees();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editSlab, setEditSlab] = useState<RmPayoutSlab | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  // Guard: MIS admin or platform admin only
  if (profile?.misAccess !== 'admin' && profile?.role !== 'admin') {
    return <Navigate to="/mis/overview" replace />;
  }

  const createdBy = profile?.userId ?? '';

  async function handleToggleActive(slab: RmPayoutSlab) {
    await toggleSlabActive(slab.id, !slab.active);
  }

  async function handleSeedDefaults() {
    setSeeding(true);
    setSeedMsg(null);
    try {
      await seedDefaultSlabs(createdBy);
      setSeedMsg('Default slabs seeded successfully.');
    } catch {
      setSeedMsg('Seeding failed — check console.');
    } finally {
      setSeeding(false);
    }
  }

  function targetLabel(slab: RmPayoutSlab): string {
    if (slab.targetType === 'role') {
      const map: Record<string, string> = {
        lead_generator: 'Lead Generator',
        lead_convertor: 'Lead Convertor',
        manager: 'Manager',
        admin: 'Admin',
      };
      return map[slab.targetId] ?? slab.targetId;
    }
    const emp = employees.find((e) => e.userId === slab.targetId);
    return emp?.displayName ?? slab.targetId.slice(-8);
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1
            className="text-3xl mb-1"
            style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: '#0B1538' }}
          >
            Payout Slabs
          </h1>
          <p className="text-sm" style={{ color: '#8B8B85' }}>
            Configure RM payout percentages by role or individual. Applied when generating monthly payouts.
          </p>
        </div>
        <div className="flex gap-2">
          {import.meta.env.DEV && (
            <button
              onClick={handleSeedDefaults}
              disabled={seeding}
              className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
              style={{ color: '#8B8B85' }}
            >
              {seeding ? 'Seeding…' : 'Seed Defaults'}
            </button>
          )}
          <button
            onClick={() => { setEditSlab(null); setShowAddModal(true); }}
            className="px-4 py-2 text-sm font-semibold rounded-lg transition-colors"
            style={{ backgroundColor: '#0B1538', color: '#FFFFFF' }}
          >
            + Add Slab
          </button>
        </div>
      </div>

      {seedMsg && (
        <div className="mb-4 px-4 py-2.5 rounded-lg text-sm" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
          {seedMsg}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="px-8 py-12 text-center text-sm" style={{ color: '#8B8B85' }}>
            Loading slabs…
          </div>
        ) : slabs.length === 0 ? (
          <div className="px-8 py-12 text-center">
            <p className="text-sm font-medium mb-1" style={{ color: '#0A0A0A' }}>No slabs configured</p>
            <p className="text-sm" style={{ color: '#8B8B85' }}>
              Add a slab above, or seed the defaults to get started.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#F2EFE7' }}>
                <th className="px-5 py-3 text-left font-semibold text-xs uppercase tracking-wide" style={{ color: '#0B1538' }}>Target</th>
                <th className="px-5 py-3 text-left font-semibold text-xs uppercase tracking-wide" style={{ color: '#0B1538' }}>Type</th>
                <th className="px-5 py-3 text-left font-semibold text-xs uppercase tracking-wide" style={{ color: '#0B1538' }}>Business Line</th>
                <th className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wide" style={{ color: '#0B1538' }}>%</th>
                <th className="px-5 py-3 text-left font-semibold text-xs uppercase tracking-wide" style={{ color: '#0B1538' }}>From</th>
                <th className="px-5 py-3 text-left font-semibold text-xs uppercase tracking-wide" style={{ color: '#0B1538' }}>To</th>
                <th className="px-5 py-3 text-center font-semibold text-xs uppercase tracking-wide" style={{ color: '#0B1538' }}>Status</th>
                <th className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wide" style={{ color: '#0B1538' }}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {slabs.map((slab, idx) => (
                <tr key={slab.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#FAFAF7]'}>
                  <td className="px-5 py-3 font-medium" style={{ color: '#0A0A0A' }}>
                    {targetLabel(slab)}
                  </td>
                  <td className="px-5 py-3 text-xs capitalize" style={{ color: '#8B8B85' }}>
                    {slab.targetType}
                  </td>
                  <td className="px-5 py-3 capitalize" style={{ color: '#0A0A0A' }}>
                    {slab.businessLine}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold" style={{ color: '#0B1538' }}>
                    {slab.percentage}%
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: '#8B8B85' }}>
                    {slab.effectiveFrom}
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: '#8B8B85' }}>
                    {slab.effectiveTo ?? <span style={{ color: '#C9A961' }}>Open-ended</span>}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <ActivePill active={slab.active} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleToggleActive(slab)}
                        className="text-xs px-2.5 py-1 rounded-md border border-slate-200 hover:bg-slate-50 transition-colors"
                        style={{ color: '#8B8B85' }}
                      >
                        {slab.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => { setEditSlab(slab); setShowAddModal(true); }}
                        className="text-xs px-2.5 py-1 rounded-md border border-slate-200 hover:bg-slate-50 transition-colors"
                        style={{ color: '#0B1538' }}
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add/Edit modal */}
      <AddSlabModal
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setEditSlab(null); }}
        existingSlab={editSlab}
        employees={employees}
        createdBy={createdBy}
      />
    </div>
  );
}
