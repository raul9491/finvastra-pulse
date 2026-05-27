/**
 * useTraining — Training & Development data hooks + mutations.
 *
 * Collections: /training_programs  /training_records
 * Access: admin + isHrmsManager for all; employees read only own records.
 */

import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { TrainingCategory, TrainingProgram, TrainingRecord } from '../../../types';

// ── Read hooks ────────────────────────────────────────────────────────────────

export function useTrainingPrograms() {
  const [programs, setPrograms] = useState<TrainingProgram[]>([]);
  const [loading, setLoading]   = useState(true);
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'training_programs'), orderBy('name')),
      (snap) => {
        setPrograms(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TrainingProgram)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);
  return { programs, loading };
}

export function useAllTrainingRecords() {
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [loading, setLoading]  = useState(true);
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'training_records'), orderBy('createdAt', 'desc')),
      (snap) => {
        setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TrainingRecord)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);
  return { records, loading };
}

export function useMyTrainingRecords(employeeId: string) {
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [loading, setLoading]  = useState(true);
  useEffect(() => {
    if (!employeeId) return;
    return onSnapshot(
      query(
        collection(db, 'training_records'),
        where('employeeId', '==', employeeId),
        orderBy('createdAt', 'desc'),
      ),
      (snap) => {
        setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TrainingRecord)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [employeeId]);
  return { records, loading };
}

// ── Badge hooks ───────────────────────────────────────────────────────────────

/** Employee badge: number of enrolled (pending completion) training records for this employee. */
export function useMyTrainingBadge(employeeId: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!employeeId) return;
    return onSnapshot(
      query(
        collection(db, 'training_records'),
        where('employeeId', '==', employeeId),
        where('status', '==', 'enrolled'),
      ),
      (snap) => setCount(snap.size),
      () => setCount(0),
    );
  }, [employeeId]);
  return count;
}

/** Admin badge: count of enrolled (awaiting completion) records across all employees. */
export function useTrainingAdminBadge(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(collection(db, 'training_records'), where('status', '==', 'enrolled')),
      (snap) => setCount(snap.size),
      () => setCount(0),
    );
  }, [enabled]);
  return count;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function createTrainingProgram(
  data: {
    name: string;
    category: TrainingCategory;
    description: string | null;
    durationHours: number | null;
    isMandatory: boolean;
    renewalPeriodMonths: number | null;
  },
  createdBy: string,
) {
  await addDoc(collection(db, 'training_programs'), {
    ...data,
    isActive: true,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateTrainingProgram(
  id: string,
  data: Partial<{
    name: string;
    category: TrainingCategory;
    description: string | null;
    durationHours: number | null;
    isMandatory: boolean;
    renewalPeriodMonths: number | null;
    isActive: boolean;
  }>,
) {
  await updateDoc(doc(db, 'training_programs', id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function enrollEmployee(
  data: {
    programId: string;
    programName: string;
    programCategory: TrainingCategory;
    employeeId: string;
    employeeName: string;
    notes: string | null;
  },
  enrolledBy: string,
) {
  await addDoc(collection(db, 'training_records'), {
    ...data,
    status: 'enrolled',
    enrolledAt: serverTimestamp(),
    completedAt: null,
    expiresAt: null,
    certificateUrl: null,
    enrolledBy,
    completedBy: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function markTrainingComplete(
  recordId: string,
  renewalPeriodMonths: number | null,
  data: { certificateUrl: string | null; notes: string | null },
  completedBy: string,
) {
  let expiresAt: Timestamp | null = null;
  if (renewalPeriodMonths) {
    const d = new Date();
    d.setMonth(d.getMonth() + renewalPeriodMonths);
    expiresAt = Timestamp.fromDate(d);
  }
  await updateDoc(doc(db, 'training_records', recordId), {
    status: 'completed',
    completedAt: serverTimestamp(),
    expiresAt,
    certificateUrl: data.certificateUrl ?? null,
    notes: data.notes ?? null,
    completedBy,
    updatedAt: serverTimestamp(),
  });
}
