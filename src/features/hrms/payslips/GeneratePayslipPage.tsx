import { useState, useMemo, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import { serverTimestamp } from 'firebase/firestore';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useAllPayslips, createPayslip } from '../hooks/usePayslips';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import type { Payslip, UserProfile, Attendance } from '../../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PayslipFormValues {
  basicSalary: number;
  hra: number;
  conveyanceAllowance: number;
  medicalAllowance: number;
  otherAllowances: number;
  pf: number;
  professionalTax: number;
  tds: number;
  otherDeductions: number;
  workingDays: number;
  presentDays: number;
  lopDays: number;
  notes: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultValues(): PayslipFormValues {
  return {
    basicSalary: 0,
    hra: 0,
    conveyanceAllowance: 0,
    medicalAllowance: 0,
    otherAllowances: 0,
    pf: 0,
    professionalTax: 0,
    tds: 0,
    otherDeductions: 0,
    workingDays: 26,
    presentDays: 26,
    lopDays: 0,
    notes: '',
  };
}

function computeNetPay(v: PayslipFormValues): {
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
} {
  const totalEarnings =
    v.basicSalary + v.hra + v.conveyanceAllowance + v.medicalAllowance + v.otherAllowances;
  const totalDeductions = v.pf + v.professionalTax + v.tds + v.otherDeductions;
  return { totalEarnings, totalDeductions, netPay: totalEarnings - totalDeductions };
}

function formatCurrency(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

// ─── NumberInput ──────────────────────────────────────────────────────────────
// Thin wrapper: renders a compact number input; converts empty string → 0.

interface NumberInputProps {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}

function NumberInput({ value, onChange, disabled = false }: NumberInputProps) {
  return (
    <input
      type="number"
      min={0}
      value={value === 0 ? '' : value}
      placeholder="0"
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      className="w-20 px-2 py-1 rounded text-right text-xs"
      style={{
        border: '1px solid #E5E7EB',
        backgroundColor: disabled ? '#F9FAFB' : '#FFFFFF',
        color: '#0A0A0A',
        outline: 'none',
      }}
    />
  );
}

// ─── ConfirmModal ─────────────────────────────────────────────────────────────

interface ConfirmModalProps {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({ count, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
    >
      <div
        className="rounded-2xl p-8 max-w-sm w-full mx-4"
        style={{ backgroundColor: '#FFFFFF', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
      >
        <h3
          className="text-xl mb-2"
          style={{
            fontFamily: '"Fraunces", Georgia, serif',
            fontStyle: 'italic',
            fontWeight: 400,
            color: '#0B1538',
          }}
        >
          Generate All Payslips
        </h3>
        <p className="mb-6 text-sm" style={{ color: '#2A2A2A' }}>
          This will generate payslips for{' '}
          <span className="font-semibold" style={{ color: '#0B1538' }}>
            {count} employee{count !== 1 ? 's' : ''}
          </span>{' '}
          who don&apos;t have a payslip for this month yet. Proceed?
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ border: '1px solid #E5E7EB', color: '#2A2A2A', backgroundColor: '#FFFFFF' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
          >
            Generate {count}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── GeneratePayslipPage ──────────────────────────────────────────────────────

export function GeneratePayslipPage() {
  const { user, profile } = useAuth();

  // Admin guard
  if (profile?.role !== 'admin') {
    return <Navigate to="/hrms/dashboard" replace />;
  }

  const currentMonth = format(new Date(), 'yyyy-MM');
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth);

  const { employees, loading: employeesLoading } = useAllEmployees();
  const { payslips: existingPayslips, loading: payslipsLoading } = useAllPayslips(selectedMonth);

  // Map<userId, PayslipFormValues>
  const [formState, setFormState] = useState<Map<string, PayslipFormValues>>(new Map());

  // Track which rows are being saved
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [generateAllBusy, setGenerateAllBusy] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Build set of already-generated employeeIds for this month
  const generatedSet = useMemo<Set<string>>(() => {
    return new Set(existingPayslips.map((p) => p.employeeId));
  }, [existingPayslips]);

  // Initialise form state whenever employees or month changes
  useEffect(() => {
    setFormState((prev) => {
      const next = new Map<string, PayslipFormValues>();
      for (const emp of employees) {
        // Preserve any values the admin has already typed
        next.set(emp.userId, prev.get(emp.userId) ?? defaultValues());
      }
      return next;
    });
  }, [employees, selectedMonth]);

  // Fetch attendance for the selected month to pre-fill presentDays
  useEffect(() => {
    if (!selectedMonth || employees.length === 0) return;

    async function prefillAttendance() {
      const startDate = `${selectedMonth}-01`;
      const endDate = `${selectedMonth}-31`;

      const q = query(
        collection(db, 'attendance'),
        where('date', '>=', startDate),
        where('date', '<=', endDate),
      );

      const snap = await getDocs(q);
      const records = snap.docs.map((d) => d.data() as Omit<Attendance, 'id'>);

      // Count present days: present = 1.0, half_day = 0.5, absent = 0
      const presentCount = new Map<string, number>();
      for (const r of records) {
        if (r.status === 'present') {
          presentCount.set(r.userId, (presentCount.get(r.userId) ?? 0) + 1.0);
        } else if (r.status === 'half_day') {
          presentCount.set(r.userId, (presentCount.get(r.userId) ?? 0) + 0.5);
        }
      }

      setFormState((prev) => {
        const next = new Map(prev);
        for (const emp of employees) {
          const existing = next.get(emp.userId) ?? defaultValues();
          const presentDays = presentCount.get(emp.userId) ?? existing.presentDays;
          next.set(emp.userId, { ...existing, presentDays });
        }
        return next;
      });
    }

    prefillAttendance().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, employees.length]);

  // ─── Field update helper ──────────────────────────────────────────────────

  function updateField<K extends keyof PayslipFormValues>(
    userId: string,
    field: K,
    value: PayslipFormValues[K],
  ) {
    setFormState((prev) => {
      const next = new Map(prev);
      const current = next.get(userId) ?? defaultValues();
      next.set(userId, { ...current, [field]: value });
      return next;
    });
  }

  // ─── Generate one payslip ─────────────────────────────────────────────────

  async function handleGenerate(emp: UserProfile) {
    const values = formState.get(emp.userId) ?? defaultValues();
    const { totalEarnings, totalDeductions, netPay } = computeNetPay(values);

    setSaving((prev) => new Set(prev).add(emp.userId));
    try {
      const payslipData: Omit<Payslip, 'id'> = {
        employeeId: emp.userId,
        month: selectedMonth,
        basicSalary: values.basicSalary,
        hra: values.hra,
        conveyanceAllowance: values.conveyanceAllowance,
        medicalAllowance: values.medicalAllowance,
        otherAllowances: values.otherAllowances,
        totalEarnings,
        pf: values.pf,
        professionalTax: values.professionalTax,
        tds: values.tds,
        otherDeductions: values.otherDeductions,
        totalDeductions,
        netPay,
        workingDays: values.workingDays,
        presentDays: values.presentDays,
        lopDays: values.lopDays,
        generatedAt: serverTimestamp() as unknown as import('firebase/firestore').Timestamp,
        generatedBy: user?.uid ?? '',
        notes: values.notes,
      };
      await createPayslip(payslipData);
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(emp.userId);
        return next;
      });
    }
  }

  // ─── Generate All ─────────────────────────────────────────────────────────

  const pendingEmployees = useMemo(
    () => employees.filter((e) => !generatedSet.has(e.userId)),
    [employees, generatedSet],
  );

  async function handleGenerateAll() {
    setShowConfirm(false);
    setGenerateAllBusy(true);
    try {
      for (const emp of pendingEmployees) {
        await handleGenerate(emp);
      }
    } finally {
      setGenerateAllBusy(false);
    }
  }

  // ─── Loading state ────────────────────────────────────────────────────────

  const isLoading = employeesLoading || payslipsLoading;

  return (
    <div className="p-6 max-w-full">
      {/* Title */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h2
            className="text-4xl mb-1"
            style={{
              fontFamily: '"Fraunces", Georgia, serif',
              fontStyle: 'italic',
              fontWeight: 300,
              color: '#0A0A0A',
            }}
          >
            Generate Payslips
          </h2>
          <p className="text-sm" style={{ color: '#8B8B85' }}>
            Enter salary figures provided by CA
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Month selector */}
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm"
            style={{
              border: '1px solid #E5E7EB',
              backgroundColor: '#FFFFFF',
              color: '#0A0A0A',
            }}
          />

          {/* Generate All button */}
          <button
            onClick={() => setShowConfirm(true)}
            disabled={generateAllBusy || pendingEmployees.length === 0 || isLoading}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
          >
            {generateAllBusy
              ? 'Generating…'
              : `Generate All (${pendingEmployees.length} pending)`}
          </button>
        </div>
      </div>

      {/* Confirm modal */}
      {showConfirm && (
        <ConfirmModal
          count={pendingEmployees.length}
          onConfirm={handleGenerateAll}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {/* Loading */}
      {isLoading && (
        <div className="text-sm py-12 text-center" style={{ color: '#8B8B85' }}>
          Loading employees…
        </div>
      )}

      {/* Table */}
      {!isLoading && (
        <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid #E5E7EB' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                {[
                  'Employee',
                  'Basic',
                  'HRA',
                  'Conveyance',
                  'Medical',
                  'Other Allow.',
                  'PF',
                  'Prof Tax',
                  'TDS',
                  'Other Ded.',
                  'Working Days',
                  'Present Days',
                  'LOP Days',
                  'Net Pay',
                  'Notes',
                  'Action',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-3 text-left font-semibold whitespace-nowrap"
                    style={{ color: '#0B1538' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp, idx) => {
                const isGenerated = generatedSet.has(emp.userId);
                const existing = existingPayslips.find((p) => p.employeeId === emp.userId);
                const values = formState.get(emp.userId) ?? defaultValues();
                const { totalEarnings, totalDeductions, netPay } = computeNetPay(values);
                const isSaving = saving.has(emp.userId);

                return (
                  <tr
                    key={emp.userId}
                    style={{
                      borderTop: idx > 0 ? '1px solid #F3F4F6' : undefined,
                      backgroundColor: isGenerated ? '#F9FAFB' : '#FFFFFF',
                    }}
                  >
                    {/* Employee name */}
                    <td className="px-3 py-3 whitespace-nowrap" style={{ color: '#0A0A0A' }}>
                      <div className="font-medium">{emp.displayName}</div>
                      {emp.designation && (
                        <div className="text-xs" style={{ color: '#8B8B85' }}>
                          {emp.designation}
                        </div>
                      )}
                    </td>

                    {isGenerated ? (
                      // Already generated — show summary spanning input columns
                      <>
                        {[
                          'basicSalary',
                          'hra',
                          'conveyanceAllowance',
                          'medicalAllowance',
                          'otherAllowances',
                          'pf',
                          'professionalTax',
                          'tds',
                          'otherDeductions',
                          'workingDays',
                          'presentDays',
                          'lopDays',
                        ].map((field) => (
                          <td key={field} className="px-3 py-3 text-right" style={{ color: '#8B8B85' }}>
                            {existing
                              ? existing[field as keyof Payslip] as React.ReactNode
                              : '—'}
                          </td>
                        ))}
                        {/* Net pay */}
                        <td
                          className="px-3 py-3 text-right font-semibold"
                          style={{ color: '#C9A961' }}
                        >
                          {existing ? formatCurrency(existing.netPay) : '—'}
                        </td>
                        {/* Notes */}
                        <td className="px-3 py-3" style={{ color: '#8B8B85' }}>
                          {existing?.notes || '—'}
                        </td>
                        {/* Action */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className="text-xs font-medium" style={{ color: '#16A34A' }}>
                            ✓ Generated
                          </span>
                        </td>
                      </>
                    ) : (
                      // Not yet generated — show editable inputs
                      <>
                        {/* Earnings */}
                        <td className="px-3 py-3">
                          <NumberInput
                            value={values.basicSalary}
                            onChange={(v) => updateField(emp.userId, 'basicSalary', v)}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <NumberInput
                            value={values.hra}
                            onChange={(v) => updateField(emp.userId, 'hra', v)}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <NumberInput
                            value={values.conveyanceAllowance}
                            onChange={(v) => updateField(emp.userId, 'conveyanceAllowance', v)}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <NumberInput
                            value={values.medicalAllowance}
                            onChange={(v) => updateField(emp.userId, 'medicalAllowance', v)}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <NumberInput
                            value={values.otherAllowances}
                            onChange={(v) => updateField(emp.userId, 'otherAllowances', v)}
                          />
                        </td>

                        {/* Deductions */}
                        <td className="px-3 py-3">
                          <NumberInput
                            value={values.pf}
                            onChange={(v) => updateField(emp.userId, 'pf', v)}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <NumberInput
                            value={values.professionalTax}
                            onChange={(v) => updateField(emp.userId, 'professionalTax', v)}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <NumberInput
                            value={values.tds}
                            onChange={(v) => updateField(emp.userId, 'tds', v)}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <NumberInput
                            value={values.otherDeductions}
                            onChange={(v) => updateField(emp.userId, 'otherDeductions', v)}
                          />
                        </td>

                        {/* Attendance */}
                        <td className="px-3 py-3">
                          <NumberInput
                            value={values.workingDays}
                            onChange={(v) => updateField(emp.userId, 'workingDays', v)}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <NumberInput
                            value={values.presentDays}
                            onChange={(v) => updateField(emp.userId, 'presentDays', v)}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <NumberInput
                            value={values.lopDays}
                            onChange={(v) => updateField(emp.userId, 'lopDays', v)}
                          />
                        </td>

                        {/* Net Pay — auto-calculated, shown in gold */}
                        <td
                          className="px-3 py-3 text-right font-semibold whitespace-nowrap"
                          style={{ color: '#C9A961' }}
                        >
                          {formatCurrency(netPay)}
                          <div className="text-xs font-normal" style={{ color: '#8B8B85' }}>
                            E: {formatCurrency(totalEarnings)}
                          </div>
                          <div className="text-xs font-normal" style={{ color: '#8B8B85' }}>
                            D: {formatCurrency(totalDeductions)}
                          </div>
                        </td>

                        {/* Notes */}
                        <td className="px-3 py-3">
                          <input
                            type="text"
                            value={values.notes}
                            placeholder="Optional"
                            onChange={(e) => updateField(emp.userId, 'notes', e.target.value)}
                            className="px-2 py-1 rounded text-xs w-24"
                            style={{
                              border: '1px solid #E5E7EB',
                              backgroundColor: '#FFFFFF',
                              color: '#0A0A0A',
                            }}
                          />
                        </td>

                        {/* Generate button */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          <button
                            onClick={() => handleGenerate(emp)}
                            disabled={isSaving}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity disabled:opacity-50"
                            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
                          >
                            {isSaving ? 'Saving…' : 'Generate'}
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}

              {employees.length === 0 && (
                <tr>
                  <td
                    colSpan={16}
                    className="px-6 py-12 text-center text-sm"
                    style={{ color: '#8B8B85' }}
                  >
                    No employees found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
