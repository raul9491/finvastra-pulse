import { useState, useMemo, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import { serverTimestamp, getDoc, doc } from 'firebase/firestore';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useAllPayslips, createPayslip } from '../hooks/usePayslips';
import { writeNotification, sendHrEmailNotification, buildHrEmailHtml } from '../../../lib/notifications';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { generatePayslipPdf } from './payslipPdf';
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

/** Telangana Professional Tax slabs (Financial Year 2025-26 and onwards).
 *  ≤₹15,000: ₹0  |  ₹15,001–₹20,000: ₹150  |  >₹20,000: ₹200
 *  February surcharge: +₹100 if PT > 0 (annual adjustment per the PT Act).
 */
function computePT(grossSalary: number, monthStr: string): number {
  const monthNum = parseInt(monthStr.split('-')[1], 10);
  let pt = 0;
  if (grossSalary <= 15000) pt = 0;
  else if (grossSalary <= 20000) pt = 150;
  else pt = 200;
  if (monthNum === 2 && pt > 0) pt += 100;
  return pt;
}

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

  // ── All hooks unconditionally at the top — Rules of Hooks ───────────────────
  // Guard comes AFTER hooks. When profile is null (still loading) the guard
  // is skipped and the page renders nothing meaningful, which is correct.
  const currentMonth = format(new Date(), 'yyyy-MM');
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth);

  const { employees, loading: employeesLoading } = useAllEmployees();
  const { payslips: existingPayslips, loading: payslipsLoading } = useAllPayslips(selectedMonth);

  // Map<userId, PayslipFormValues>
  const [formState, setFormState] = useState<Map<string, PayslipFormValues>>(new Map());

  // Track which rows are being saved / emailing
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [sendingEmail, setSendingEmail] = useState<Set<string>>(new Set());
  const [emailSent, setEmailSent] = useState<Set<string>>(new Set());
  const [generateAllBusy, setGenerateAllBusy] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // MIS payout suggestions: Map<userId, payoutAmount> for approved/paid payouts this month
  const [misPayouts,  setMisPayouts]  = useState<Map<string, number>>(new Map());
  const [misDismissed, setMisDismissed] = useState<Set<string>>(new Set());
  // Encashment suggestions: map of employeeId → { amount, requestId }
  const [encashAmounts,   setEncashAmounts]   = useState<Map<string, { amount: number; reqId: string }>>(new Map());
  const [encashDismissed, setEncashDismissed] = useState<Set<string>>(new Set());

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

  // Pre-fill salary components from employee_sensitive — admin can always override.
  // Only fills fields that are still at their default (0) so existing edits are preserved.
  useEffect(() => {
    if (employees.length === 0) return;
    let cancelled = false;

    async function prefillSalary() {
      try {
        const results = await Promise.all(
          employees.map((emp) =>
            getDoc(doc(db, 'employee_sensitive', emp.userId)).then((snap) => ({
              userId: emp.userId,
              data: snap.exists() ? (snap.data() as {
                salaryBasic?: number; salaryHra?: number; salaryConveyance?: number;
                salaryMedical?: number; salaryOther?: number; grossSalary?: number;
              }) : null,
            })),
          ),
        );
        if (cancelled) return;
        setFormState((prev) => {
          const next = new Map(prev);
          for (const { userId, data } of results) {
            if (!data?.grossSalary) continue; // no salary on file — skip
            const existing = next.get(userId) ?? defaultValues();
            // Only fill if all earning fields are still at 0 (untouched by admin)
            const untouched =
              existing.basicSalary === 0 && existing.hra === 0 &&
              existing.conveyanceAllowance === 0 && existing.medicalAllowance === 0 &&
              existing.otherAllowances === 0;
            if (!untouched) continue;
            const gross = (data.salaryBasic ?? 0) + (data.salaryHra ?? 0) +
              (data.salaryConveyance ?? 0) + (data.salaryMedical ?? 0) + (data.salaryOther ?? 0);
            next.set(userId, {
              ...existing,
              basicSalary:         data.salaryBasic      ?? 0,
              hra:                 data.salaryHra         ?? 0,
              conveyanceAllowance: data.salaryConveyance  ?? 0,
              medicalAllowance:    data.salaryMedical     ?? 0,
              otherAllowances:     data.salaryOther       ?? 0,
              professionalTax:     computePT(gross, selectedMonth),
            });
          }
          return next;
        });
      } catch { /* salary pre-fill is non-fatal — admin can still enter manually */ }
    }

    prefillSalary();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees.length, selectedMonth]);

  // Fetch MIS payouts for the selected month — suggestion only, admin can override
  useEffect(() => {
    if (!selectedMonth) return;
    let cancelled = false;

    async function fetchMisPayouts() {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'rm_payouts'),
            where('periodStart', '>=', selectedMonth),
            where('periodStart', '<=', selectedMonth),
          )
        );
        const map = new Map<string, number>();
        for (const d of snap.docs) {
          const data = d.data() as { rmId?: string; status?: string; totalPayout?: number };
          if ((data.status === 'approved' || data.status === 'paid') && data.rmId && data.totalPayout) {
            map.set(data.rmId, data.totalPayout);
          }
        }
        if (!cancelled) {
          setMisPayouts(map);
          setMisDismissed(new Set()); // reset dismissed when month changes
        }
      } catch { /* MIS read is non-fatal */ }
    }

    fetchMisPayouts();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  // Fetch approved encashment requests for the selected payslip month
  useEffect(() => {
    if (!selectedMonth) return;
    let cancelled = false;
    async function fetchEncashment() {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'leave_encashment_requests'),
            where('month', '==', selectedMonth),
            where('status', '==', 'approved'),
          ),
        );
        const map = new Map<string, { amount: number; reqId: string }>();
        for (const d of snap.docs) {
          const data = d.data() as { employeeId?: string; totalAmount?: number };
          if (data.employeeId && data.totalAmount) {
            map.set(data.employeeId, { amount: data.totalAmount, reqId: d.id });
          }
        }
        if (!cancelled) {
          setEncashAmounts(map);
          setEncashDismissed(new Set());
        }
      } catch { /* non-fatal */ }
    }
    fetchEncashment();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  // ─── Field update helper ──────────────────────────────────────────────────

  const EARNING_FIELDS: (keyof PayslipFormValues)[] = [
    'basicSalary', 'hra', 'conveyanceAllowance', 'medicalAllowance', 'otherAllowances',
  ];

  function updateField<K extends keyof PayslipFormValues>(
    userId: string,
    field: K,
    value: PayslipFormValues[K],
  ) {
    setFormState((prev) => {
      const next = new Map(prev);
      const current = next.get(userId) ?? defaultValues();
      const updated = { ...current, [field]: value };
      // Auto-recompute PT when any earning field changes
      if (EARNING_FIELDS.includes(field)) {
        const grossSalary =
          updated.basicSalary + updated.hra + updated.conveyanceAllowance +
          updated.medicalAllowance + updated.otherAllowances;
        updated.professionalTax = computePT(grossSalary, selectedMonth);
      }
      next.set(userId, updated);
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

      // Notify employee — fire and forget
      const monthLabel = format(new Date(`${selectedMonth}-01`), 'MMMM yyyy');
      writeNotification(emp.userId, {
        type: 'leave_approved',   // reusing closest available type — plain status update
        title: `Payslip ready — ${monthLabel}`,
        body: `Your payslip for ${monthLabel} (₹${netPay.toLocaleString('en-IN')}) has been generated.`,
        link: '/hrms/payslips',
      }).catch(() => {});
      sendHrEmailNotification({
        employeeId: emp.userId,
        subject: `Your payslip for ${monthLabel} is ready`,
        htmlBody: buildHrEmailHtml({
          title: `Payslip Ready — ${monthLabel}`,
          lines: [
            { label: 'Month',        value: monthLabel },
            { label: 'Net Pay',      value: `₹${netPay.toLocaleString('en-IN')}` },
            { label: 'Working Days', value: `${values.presentDays} / ${values.workingDays}` },
          ],
          ctaLabel: 'View Payslip',
          ctaLink: 'https://pulse.finvastra.com/hrms/payslips',
        }),
      }).catch(() => {});
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

  // ── Guard (after all hooks) ─────────────────────────────────────────────────
  if (profile && profile.role !== 'admin') {
    return <Navigate to="/hrms/dashboard" replace />;
  }

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

  // ─── Download existing payslip (admin side) ───────────────────────────────

  function handleDownloadExisting(emp: UserProfile, payslip: Payslip) {
    generatePayslipPdf(payslip, emp, 'save');
  }

  // ─── Send payslip PDF by email ────────────────────────────────────────────

  async function handleSendEmail(emp: UserProfile, payslip: Payslip) {
    setSendingEmail((prev) => new Set(prev).add(emp.userId));
    try {
      const base64 = generatePayslipPdf(payslip, emp, 'base64') as string;
      const fname  = emp.displayName.replace(/\s+/g, '-');
      const monthLabel = format(new Date(`${payslip.month}-01`), 'MMMM yyyy');
      const filename   = `Finvastra-Payslip-${fname}-${payslip.month}.pdf`;

      await sendHrEmailNotification({
        employeeId:  emp.userId,
        subject:     `Your payslip for ${monthLabel} is ready`,
        htmlBody:    buildHrEmailHtml({
          title: `Payslip — ${monthLabel}`,
          lines: [
            { label: 'Month',        value: monthLabel },
            { label: 'Net Pay',      value: `₹${payslip.netPay.toLocaleString('en-IN')}` },
            { label: 'Working Days', value: `${payslip.presentDays} / ${payslip.workingDays}` },
          ],
          note:     'Your payslip is attached to this email as a PDF.',
          ctaLabel: 'View on Pulse',
          ctaLink:  'https://pulse.finvastra.com/hrms/payslips',
        }),
        pdfBase64:  base64,
        pdfFilename: filename,
      });

      setEmailSent((prev) => new Set(prev).add(emp.userId));
      // Reset the "sent" indicator after 4 seconds
      setTimeout(() => {
        setEmailSent((prev) => { const n = new Set(prev); n.delete(emp.userId); return n; });
      }, 4000);
    } catch {
      // Non-fatal — UI shows nothing special on failure
    } finally {
      setSendingEmail((prev) => { const n = new Set(prev); n.delete(emp.userId); return n; });
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
                        {/* Action — Download + Send Email */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="flex flex-col gap-1.5">
                            {/* Download PDF */}
                            <button
                              onClick={() => existing && handleDownloadExisting(emp, existing)}
                              disabled={!existing}
                              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
                              title="Download payslip PDF"
                            >
                              ↓ PDF
                            </button>

                            {/* Send Email */}
                            {(() => {
                              const isSending = sendingEmail.has(emp.userId);
                              const wasSent   = emailSent.has(emp.userId);
                              return (
                                <button
                                  onClick={() => existing && handleSendEmail(emp, existing)}
                                  disabled={isSending || !existing}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                                  style={{
                                    backgroundColor: wasSent ? '#D1FAE5' : '#F0FDF4',
                                    color:           wasSent ? '#065F46' : '#15803D',
                                    border: '1px solid #BBF7D0',
                                  }}
                                  title="Email payslip PDF to employee"
                                >
                                  {isSending ? '…' : wasSent ? '✓ Sent' : '✉ Email'}
                                </button>
                              );
                            })()}
                          </div>
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
                          {/* MIS payout suggestion — shown when an approved/paid payout exists */}
                          {(() => {
                            const payoutAmt = misPayouts.get(emp.userId);
                            if (!payoutAmt || misDismissed.has(emp.userId)) return null;
                            return (
                              <div className="mt-1.5 rounded-lg px-2 py-1.5 text-[10px] leading-tight"
                                style={{ backgroundColor: '#FEF3C7', border: '1px solid #C9A961', color: '#92400E' }}>
                                <p className="font-semibold">MIS Payout Available</p>
                                <p>₹{payoutAmt.toLocaleString('en-IN')} approved payout for {emp.displayName}</p>
                                <div className="flex gap-1.5 mt-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      updateField(emp.userId, 'otherAllowances', payoutAmt);
                                      setMisDismissed((prev) => new Set([...prev, emp.userId]));
                                    }}
                                    className="px-2 py-0.5 rounded font-semibold transition-opacity hover:opacity-80"
                                    style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
                                  >
                                    Add ₹{payoutAmt.toLocaleString('en-IN')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setMisDismissed((prev) => new Set([...prev, emp.userId]))}
                                    className="px-2 py-0.5 rounded border transition-opacity hover:opacity-80"
                                    style={{ borderColor: '#C9A961', color: '#92400E' }}
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                          {/* Leave Encashment suggestion — approved encashment for this payroll month */}
                          {(() => {
                            const enc = encashAmounts.get(emp.userId);
                            if (!enc || encashDismissed.has(emp.userId)) return null;
                            return (
                              <div className="mt-1.5 rounded-lg px-2 py-1.5 text-[10px] leading-tight"
                                style={{ backgroundColor: '#F0FDF4', border: '1px solid #6EE7B7', color: '#065F46' }}>
                                <p className="font-semibold">Leave Encashment Approved</p>
                                <p>₹{enc.amount.toLocaleString('en-IN')} encashment for {emp.displayName}</p>
                                <div className="flex gap-1.5 mt-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      updateField(emp.userId, 'otherAllowances', enc.amount);
                                      setEncashDismissed((prev) => new Set([...prev, emp.userId]));
                                    }}
                                    className="px-2 py-0.5 rounded font-semibold transition-opacity hover:opacity-80"
                                    style={{ backgroundColor: '#059669', color: '#FFFFFF' }}
                                  >
                                    Add ₹{enc.amount.toLocaleString('en-IN')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEncashDismissed((prev) => new Set([...prev, emp.userId]))}
                                    className="px-2 py-0.5 rounded border transition-opacity hover:opacity-80"
                                    style={{ borderColor: '#6EE7B7', color: '#065F46' }}
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
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
                          <p className="text-[9px] mt-0.5 leading-tight" style={{ color: '#8B8B85' }}>
                            Auto-calc · TG PT Act
                          </p>
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
