import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { Payslip } from '../../../types';

// ─── useMyPayslips ────────────────────────────────────────────────────────────
// Real-time subscription to all payslips for the given employee,
// ordered newest month first. Used by the employee self-service view.
export function useMyPayslips(userId: string): { payslips: Payslip[]; loading: boolean } {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    const q = query(
      collection(db, 'payslips'),
      where('employeeId', '==', userId),
      orderBy('month', 'desc'),
    );

    return onSnapshot(q, (snap) => {
      setPayslips(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Payslip)));
      setLoading(false);
    });
  }, [userId]);

  return { payslips, loading };
}

// ─── useAllPayslips ───────────────────────────────────────────────────────────
// Real-time subscription to all payslips for a given month (YYYY-MM).
// Admin only — used by GeneratePayslipPage to detect already-generated records.
export function useAllPayslips(month: string): { payslips: Payslip[]; loading: boolean } {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!month) return;

    const q = query(
      collection(db, 'payslips'),
      where('month', '==', month),
    );

    return onSnapshot(q, (snap) => {
      setPayslips(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Payslip)));
      setLoading(false);
    });
  }, [month]);

  return { payslips, loading };
}

// ─── createPayslip ────────────────────────────────────────────────────────────
// Admin only. Writes a new payslip document and returns its Firestore ID.
export async function createPayslip(data: Omit<Payslip, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, 'payslips'), data);
  return ref.id;
}
