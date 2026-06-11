import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, doc, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { appendFieldHistory } from '../../../lib/fieldHistory';
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
// Phase P — financial status/amount changes write field_history diffs in the
// SAME batch (actor + prev are optional so existing call sites stay valid).
export async function markCommissionPaid(
  recordId: string,
  actualAmount: number,
  actualPayoutDate: string,
  notes: string,
  actor?: { uid: string; name: string },
  prev?: { status?: string; actualAmount?: number | null },
): Promise<void> {
  const now = serverTimestamp();
  const ref = doc(db, 'commission_records', recordId);
  const batch = writeBatch(db);
  batch.update(ref, {
    status:            'paid' as CommissionRecordStatus,
    actualAmount,
    actualPayoutDate,
    notes:             notes || undefined,
    paidAt:            now,
    updatedAt:         now,
  });
  if (actor) {
    appendFieldHistory(batch, ref, 'status', prev?.status ?? 'pending', 'paid', actor, 'mark_paid');
    appendFieldHistory(batch, ref, 'actualAmount', prev?.actualAmount ?? null, actualAmount, actor, 'mark_paid');
  }
  await batch.commit();
}

export async function markCommissionClawback(
  recordId: string,
  clawbackReason: string,
  actor?: { uid: string; name: string },
  prevStatus?: string,
): Promise<void> {
  const ref = doc(db, 'commission_records', recordId);
  const batch = writeBatch(db);
  batch.update(ref, {
    status:          'clawed_back' as CommissionRecordStatus,
    clawbackReason,
    updatedAt:       serverTimestamp(),
  });
  if (actor) {
    appendFieldHistory(batch, ref, 'status', prevStatus ?? 'paid', 'clawed_back', actor, 'clawback');
  }
  await batch.commit();
}
