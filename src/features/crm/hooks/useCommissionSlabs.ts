import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { CommissionSlab } from '../../../types';

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useCommissionSlabs(activeOnly = false) {
  const [slabs, setSlabs] = useState<CommissionSlab[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = activeOnly
      ? query(collection(db, 'commission_slabs'), where('active', '==', true), orderBy('providerId'))
      : query(collection(db, 'commission_slabs'), orderBy('providerId'));
    return onSnapshot(q, (snap) => {
      setSlabs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CommissionSlab)));
      setLoading(false);
    }, () => setLoading(false));
  }, [activeOnly]);

  return { slabs, loading };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Find the first active slab that matches provider, product, amount, and date. */
export function findMatchingSlab(
  slabs: CommissionSlab[],
  providerId: string,
  product: string,
  basisAmount: number,
  date: string, // yyyy-MM-dd
): CommissionSlab | null {
  return slabs.find((s) =>
    s.active &&
    s.providerId === providerId &&
    s.product === product &&
    basisAmount >= s.minTicket &&
    (s.maxTicket == null || basisAmount <= s.maxTicket) &&
    date >= s.effectiveFrom &&
    (s.effectiveTo == null || date <= s.effectiveTo),
  ) ?? null;
}

/** Calculate the commission amount in ₹. Rounds to whole rupees. */
export function calculateCommission(slab: CommissionSlab, basisAmount: number): number {
  if (slab.percentage != null) {
    return Math.round(basisAmount * slab.percentage / 100);
  }
  return slab.flatFee ?? 0;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

interface SlabInput {
  providerId: string;
  product: string;
  minTicket: number;
  maxTicket: number | null;
  percentage?: number;
  flatFee?: number;
  basisOn: 'sanctioned' | 'disbursed';
  effectiveFrom: string;
  effectiveTo: string | null;
  notes?: string;
  active: boolean;
}

export async function createSlab(input: SlabInput, userId: string): Promise<string> {
  const now = serverTimestamp();
  const ref = await addDoc(collection(db, 'commission_slabs'), {
    ...input,
    lastModifiedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function updateSlab(slabId: string, input: Partial<SlabInput>, userId: string): Promise<void> {
  await updateDoc(doc(db, 'commission_slabs', slabId), {
    ...input,
    lastModifiedBy: userId,
    updatedAt: serverTimestamp(),
  });
}

export async function toggleSlabActive(slabId: string, active: boolean, userId: string): Promise<void> {
  await updateDoc(doc(db, 'commission_slabs', slabId), {
    active,
    lastModifiedBy: userId,
    updatedAt: serverTimestamp(),
  });
}

/** Copy all active slabs from one provider to another. */
export async function copySlabsToProvider(
  fromProviderId: string,
  toProviderId: string,
  userId: string,
): Promise<number> {
  const snap = await getDocs(
    query(collection(db, 'commission_slabs'),
      where('providerId', '==', fromProviderId),
      where('active', '==', true)),
  );
  const now = serverTimestamp();
  let count = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as CommissionSlab;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, createdAt: _c, updatedAt: _u, lastModifiedBy: _m, ...rest } = data;
    await addDoc(collection(db, 'commission_slabs'), {
      ...rest,
      providerId: toProviderId,
      notes: `Copied from ${fromProviderId}${data.notes ? ` — ${data.notes}` : ''}`,
      lastModifiedBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    count++;
  }
  return count;
}
