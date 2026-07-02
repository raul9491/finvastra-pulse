import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  runTransaction,
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
//
// Deterministic doc id `{employeeId}_{month}` + a transaction guarantee at
// most ONE payslip per employee per month (the old addDoc random id allowed
// silent duplicates on double-click / re-generation). Payslips created before
// this change under random ids remain fully valid — every reader queries by
// the employeeId/month FIELDS, never by document id.
export async function createPayslip(data: Omit<Payslip, 'id'>): Promise<string> {
  const id  = `${data.employeeId}_${data.month}`;
  const ref = doc(db, 'payslips', id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      throw new Error('A payslip for this employee and month already exists.');
    }
    tx.set(ref, data);
  });
  return id;
}
