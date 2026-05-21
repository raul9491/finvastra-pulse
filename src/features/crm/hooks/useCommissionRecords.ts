import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { CommissionRecord, CommissionRecordStatus } from '../../../types';

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useCommissionRecords(userId: string | null, isAdmin: boolean) {
  const [records, setRecords] = useState<CommissionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const base = collection(db, 'commission_records');
    const q = isAdmin
      ? query(base, orderBy('createdAt', 'desc'))
      : query(base, where('rmOwnerId', '==', userId), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CommissionRecord)));
      setLoading(false);
    }, () => setLoading(false));
  }, [userId, isAdmin]);

  return { records, loading };
}

// ─── Create (called by useBankSubmissions on primary disbursal) ───────────────
export async function createCommissionRecord(
  data: Omit<CommissionRecord, 'id' | 'createdAt' | 'paidAt'>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'commission_records'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// ─── Admin mutations ──────────────────────────────────────────────────────────
export async function markCommissionPaid(
  recordId: string,
  actualAmount: number,
  actualPayoutDate: string,
  notes: string,
): Promise<void> {
  const now = serverTimestamp();
  await updateDoc(doc(db, 'commission_records', recordId), {
    status:            'paid' as CommissionRecordStatus,
    actualAmount,
    actualPayoutDate,
    notes:             notes || undefined,
    paidAt:            now,
    updatedAt:         now,
  });
}

export async function markCommissionClawback(
  recordId: string,
  clawbackReason: string,
): Promise<void> {
  await updateDoc(doc(db, 'commission_records', recordId), {
    status:          'clawed_back' as CommissionRecordStatus,
    clawbackReason,
    updatedAt:       serverTimestamp(),
  });
}
