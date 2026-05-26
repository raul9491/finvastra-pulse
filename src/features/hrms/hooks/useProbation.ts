import { useState, useEffect } from 'react';
import {
  collection, doc, getDoc, onSnapshot, query,
  setDoc, updateDoc, serverTimestamp, where,
} from 'firebase/firestore';
import { addMonths, addDays, format, parseISO } from 'date-fns';
import { db } from '../../../lib/firebase';
import type { ProbationRecord } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Finvastra standard: 6-month probation from joining date */
export function computeProbationEndDate(joiningDate: string): string {
  return format(addMonths(parseISO(joiningDate), 6), 'yyyy-MM-dd');
}

// ─── Subscription hook ────────────────────────────────────────────────────────

export function useProbationRecords(enabled: boolean): {
  records: ProbationRecord[];
  loading: boolean;
} {
  const [records, setRecords] = useState<ProbationRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    return onSnapshot(
      collection(db, 'probation_records'),
      (snap) => {
        setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ProbationRecord));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [enabled]);

  return { records, loading };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a probation record for an employee if one doesn't already exist.
 * Called on page load for backfill, and by server.ts on new employee creation.
 */
export async function ensureProbationRecord(employee: {
  userId: string;
  displayName: string;
  employeeId?: string;
  department?: string;
  designation?: string;
  joiningDate: string;
}): Promise<void> {
  const ref = doc(db, 'probation_records', employee.userId);
  const existing = await getDoc(ref);
  if (existing.exists()) return;

  await setDoc(ref, {
    employeeId: employee.userId,
    employeeName: employee.displayName,
    employeeCode: employee.employeeId ?? null,
    department: employee.department ?? null,
    designation: employee.designation ?? null,
    joiningDate: employee.joiningDate,
    probationStartDate: employee.joiningDate,
    probationEndDate: computeProbationEndDate(employee.joiningDate),
    status: 'on_probation',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function submitProbationEvaluation(
  userId: string,
  evaluation: {
    reportingManagerName: string;
    workQuality: number;
    communication: number;
    attendance: number;
    teamwork: number;
    learning: number;
    overallRating: number;
    recommendation: 'confirm' | 'extend' | 'terminate';
    notes: string | null;
  },
  submittedByUid: string,
): Promise<void> {
  await updateDoc(doc(db, 'probation_records', userId), {
    evaluation: {
      ...evaluation,
      submittedBy: submittedByUid,
      submittedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
}

export async function confirmProbation(
  userId: string,
  byUid: string,
  notes: string,
): Promise<void> {
  await updateDoc(doc(db, 'probation_records', userId), {
    status: 'confirmed',
    confirmedAt: serverTimestamp(),
    confirmedBy: byUid,
    confirmationNotes: notes.trim() || null,
    updatedAt: serverTimestamp(),
  });
}

export async function extendProbation(
  userId: string,
  byUid: string,
  extensionEndDate: string,
  reason: string,
): Promise<void> {
  await updateDoc(doc(db, 'probation_records', userId), {
    status: 'extended',
    probationEndDate: extensionEndDate,   // also update main sort key
    extensionEndDate,
    extensionReason: reason.trim(),
    extendedAt: serverTimestamp(),
    extendedBy: byUid,
    updatedAt: serverTimestamp(),
  });
}

// ─── Badge hook ───────────────────────────────────────────────────────────────

/**
 * Returns count of on_probation / extended employees whose probation ends
 * within the next 30 days (including overdue).
 * Used by HrmsShell to show a gold badge on the Probation nav link.
 */
export function useProbationBadge(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(
        collection(db, 'probation_records'),
        where('status', 'in', ['on_probation', 'extended']),
      ),
      (snap) => {
        const threshold = addDays(new Date(), 30);
        const due = snap.docs.filter((d) => {
          const end = d.data().probationEndDate as string | undefined;
          if (!end) return false;
          return parseISO(end) <= threshold;
        });
        setCount(due.length);
      },
      () => setCount(0),
    );
  }, [enabled]);

  return count;
}
