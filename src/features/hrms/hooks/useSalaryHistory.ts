/**
 * useSalaryHistory — Salary revision history hooks + mutations.
 *
 * Collection: /salary_history
 * Access: admin + isHrmsManager only (salary data is confidential).
 */

import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { SalaryHistory, SalaryRevisionReason } from '../../../types';

// ── Read hooks ────────────────────────────────────────────────────────────────

/** All salary history records, sorted most-recent first. Admin only. */
export function useAllSalaryHistory() {
  const [records, setRecords] = useState<SalaryHistory[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'salary_history'), orderBy('effectiveDate', 'desc')),
      (snap) => {
        setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SalaryHistory)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);
  return { records, loading };
}

/** Salary history for a single employee, sorted most-recent first. */
export function useEmployeeSalaryHistory(employeeId: string) {
  const [records, setRecords] = useState<SalaryHistory[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!employeeId) return;
    return onSnapshot(
      query(
        collection(db, 'salary_history'),
        where('employeeId', '==', employeeId),
        orderBy('effectiveDate', 'desc'),
      ),
      (snap) => {
        setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SalaryHistory)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [employeeId]);
  // Latest (first) record = current salary
  return { records, loading, currentSalary: records[0] ?? null };
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function recordSalaryRevision(
  data: {
    employeeId: string;
    employeeName: string;
    effectiveDate: string;
    grossSalary: number;
    basicSalary: number | null;
    hra: number | null;
    otherAllowances: number | null;
    reason: SalaryRevisionReason;
    incrementPercentage: number | null;
    previousGrossSalary: number | null;
    relatedPerformanceReviewId: string | null;
    notes: string | null;
  },
  recordedBy: string,
) {
  await addDoc(collection(db, 'salary_history'), {
    ...data,
    recordedBy,
    recordedAt: serverTimestamp(),
  });
}
