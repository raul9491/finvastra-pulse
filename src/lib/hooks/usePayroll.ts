import { useState, useEffect } from 'react';
import {
  collection,
  query,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  orderBy,
  limit,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Payslip } from '../../types';

// ─── Hook: My payslips ────────────────────────────────────────────────────────
export function usePayroll(userId: string | null) {
  const [records, setRecords] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, 'payslips'),
      where('employeeId', '==', userId),
      orderBy('month', 'desc'),
      limit(12)
    );

    return onSnapshot(q, (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Payslip)));
      setLoading(false);
    });
  }, [userId]);

  return { records, loading };
}

// ─── Hook: Admin — all payslips ───────────────────────────────────────────────
export function useAllPayroll() {
  const [records, setRecords] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'payslips'),
      orderBy('month', 'desc'),
      limit(100)
    );

    return onSnapshot(q, (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Payslip)));
      setLoading(false);
    });
  }, []);

  return { records, loading };
}

// ─── Create payslip (admin only) ─────────────────────────────────────────────
// Phase 3: admin uploads CA-provided salary data; no client-side calculation.
export async function createPayrollEntry(
  data: Omit<Payslip, 'id' | 'generatedAt'>
): Promise<void> {
  await addDoc(collection(db, 'payslips'), {
    ...data,
    generatedAt: serverTimestamp(),
  });
}

// ─── Generate payslip text (plain-text fallback) ──────────────────────────────
export function generatePayslipText(record: Payslip, employeeName: string, employeeId: string, department: string): string {
  return `
==================================================
         FINVASTRA — OFFICIAL PAYSLIP
==================================================
Employee  : ${employeeName}
Emp ID    : ${employeeId}
Department: ${department}

Pay Period: ${record.month}

--------------------------------------------------
EARNINGS
--------------------------------------------------
Basic Salary          :  ₹ ${record.basicSalary.toLocaleString('en-IN')}
HRA                   :  ₹ ${record.hra.toLocaleString('en-IN')}
Conveyance Allowance  :  ₹ ${record.conveyanceAllowance.toLocaleString('en-IN')}
Medical Allowance     :  ₹ ${record.medicalAllowance.toLocaleString('en-IN')}
Other Allowances      :  ₹ ${record.otherAllowances.toLocaleString('en-IN')}
                         ─────────────────────────────
Total Earnings        :  ₹ ${record.totalEarnings.toLocaleString('en-IN')}

--------------------------------------------------
DEDUCTIONS
--------------------------------------------------
Provident Fund        : -₹ ${record.pf.toLocaleString('en-IN')}
Professional Tax      : -₹ ${record.professionalTax.toLocaleString('en-IN')}
TDS                   : -₹ ${record.tds.toLocaleString('en-IN')}
Other Deductions      : -₹ ${record.otherDeductions.toLocaleString('en-IN')}
                         ─────────────────────────────
Total Deductions      :  ₹ ${record.totalDeductions.toLocaleString('en-IN')}

Working Days: ${record.workingDays}  Present: ${record.presentDays}  LOP: ${record.lopDays}

==================================================
NET PAY               :  ₹ ${record.netPay.toLocaleString('en-IN')}
==================================================
This is a computer-generated document.
Finvastra Pulse
`.trim();
}
