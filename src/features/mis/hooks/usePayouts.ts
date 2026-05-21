import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  getDocs,
  serverTimestamp,
  limit,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { RmPayout, RmPayoutSlab, RmPayoutLineItem, CommissionRecord, UserProfile } from '../../../types';

// ─── usePayoutSlabs ───────────────────────────────────────────────────────────

export function usePayoutSlabs(): { slabs: RmPayoutSlab[]; loading: boolean } {
  const [slabs, setSlabs] = useState<RmPayoutSlab[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'rm_payout_slabs'), orderBy('createdAt', 'desc')),
      (snap) => {
        setSlabs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RmPayoutSlab)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  return { slabs, loading };
}

// ─── createSlab ───────────────────────────────────────────────────────────────

export async function createSlab(
  slab: Omit<RmPayoutSlab, 'id' | 'createdAt'>,
): Promise<void> {
  await addDoc(collection(db, 'rm_payout_slabs'), { ...slab, createdAt: serverTimestamp() });
}

// ─── updateSlab ───────────────────────────────────────────────────────────────

export async function updateSlab(
  id: string,
  updates: Partial<Omit<RmPayoutSlab, 'id' | 'createdAt'>>,
): Promise<void> {
  await updateDoc(doc(db, 'rm_payout_slabs', id), updates);
}

// ─── toggleSlabActive ─────────────────────────────────────────────────────────

export async function toggleSlabActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(db, 'rm_payout_slabs', id), { active });
}

// ─── findActiveSlab ───────────────────────────────────────────────────────────
// Priority: specific user match overrides role match.

export function findActiveSlab(
  slabs: RmPayoutSlab[],
  rmId: string,
  crmRole: string | null,
  businessLine: string,
): RmPayoutSlab | null {
  const today = new Date().toISOString().slice(0, 10);
  const applicable = slabs.filter(
    (s) =>
      s.active &&
      s.businessLine === businessLine &&
      (s.effectiveTo === null || s.effectiveTo >= today) &&
      s.effectiveFrom <= today &&
      (s.targetId === rmId || s.targetId === crmRole),
  );
  return (
    applicable.find((s) => s.targetType === 'user' && s.targetId === rmId) ??
    applicable.find((s) => s.targetType === 'role' && s.targetId === crmRole) ??
    null
  );
}

// ─── usePayouts ───────────────────────────────────────────────────────────────
// If rmId provided (RM self-view): filter by rmId. Admin gets all.

export function usePayouts(rmId?: string): { payouts: RmPayout[]; loading: boolean } {
  const [payouts, setPayouts] = useState<RmPayout[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = rmId
      ? query(
          collection(db, 'rm_payouts'),
          where('rmId', '==', rmId),
          orderBy('generatedAt', 'desc'),
        )
      : query(collection(db, 'rm_payouts'), orderBy('generatedAt', 'desc'));

    return onSnapshot(
      q,
      (snap) => {
        setPayouts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RmPayout)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [rmId]);

  return { payouts, loading };
}

// ─── generatePayouts ─────────────────────────────────────────────────────────
// Loads all commission_records with status=paid and actualPayoutDate in the
// given period, groups by RM, applies slabs, and writes draft rm_payouts docs.
// Returns the count of payouts created.

export async function generatePayouts(
  periodStart: string,
  periodEnd: string,
  slabs: RmPayoutSlab[],
  employees: UserProfile[],
  generatedBy: string,
): Promise<number> {
  const fromDate = `${periodStart}-01`;
  const toDate   = `${periodEnd}-31`;

  const recordsSnap = await getDocs(
    query(
      collection(db, 'commission_records'),
      where('status', '==', 'paid'),
      where('actualPayoutDate', '>=', fromDate),
      where('actualPayoutDate', '<=', toDate),
    ),
  );

  const records = recordsSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as CommissionRecord & { id: string }),
  );

  // Group by rmOwnerId
  const grouped = new Map<string, (CommissionRecord & { id: string })[]>();
  for (const r of records) {
    const arr = grouped.get(r.rmOwnerId) ?? [];
    arr.push(r);
    grouped.set(r.rmOwnerId, arr);
  }

  const providersSnap = await getDocs(collection(db, 'providers'));
  const providerNames = new Map(
    providersSnap.docs.map((d) => [d.id, d.data().name as string]),
  );

  let count = 0;
  const now = serverTimestamp();

  for (const [rmId, rmRecords] of grouped) {
    const emp = employees.find((e) => e.userId === rmId);
    const crmRole = emp?.crmRole ?? null;
    const rmDisplayName = emp?.displayName ?? rmId.slice(-8);

    const lineItems: RmPayoutLineItem[] = [];
    let totalReceivedBase = 0;
    let totalPayout = 0;

    for (const rec of rmRecords) {
      // Default to 'loan' businessLine — enriched further when wealth/insurance slabs land
      const slab = findActiveSlab(slabs, rmId, crmRole, 'loan');
      const pct  = slab?.percentage ?? 0;
      const receivedAmount = rec.actualAmount ?? rec.calculatedCommission;
      const payoutAmount   = Math.round(receivedAmount * pct / 100);
      totalReceivedBase += receivedAmount;
      totalPayout       += payoutAmount;

      lineItems.push({
        commissionRecordId: rec.id,
        opportunityId:      rec.opportunityId,
        leadId:             rec.leadId,
        providerId:         rec.providerId,
        providerName:       providerNames.get(rec.providerId) ?? rec.providerId,
        product:            rec.opportunityId, // enriched in UI once opportunity data loads
        receivedAmount,
        payoutPercentage:   pct,
        payoutAmount,
      });
    }

    await addDoc(collection(db, 'rm_payouts'), {
      rmId,
      rmDisplayName,
      periodStart,
      periodEnd,
      lineItems,
      totalReceivedBase,
      totalPayout,
      status: 'draft',
      generatedAt: now,
      generatedBy,
      approvedBy: null,
      approvedAt: null,
      paidAt: null,
      paymentReference: null,
      paymentNotes: null,
    });

    count++;
  }

  return count;
}

// ─── previewPayouts ───────────────────────────────────────────────────────────
// Dry-run: same logic as generatePayouts but returns rows instead of writing.

export interface PayoutPreviewRow {
  rmId: string;
  rmDisplayName: string;
  recordCount: number;
  totalReceivedBase: number;
  slabPercentage: number;
  calculatedPayout: number;
  noSlabWarning: boolean;
}

export async function previewPayouts(
  periodStart: string,
  periodEnd: string,
  slabs: RmPayoutSlab[],
  employees: UserProfile[],
): Promise<PayoutPreviewRow[]> {
  const fromDate = `${periodStart}-01`;
  const toDate   = `${periodEnd}-31`;

  const recordsSnap = await getDocs(
    query(
      collection(db, 'commission_records'),
      where('status', '==', 'paid'),
      where('actualPayoutDate', '>=', fromDate),
      where('actualPayoutDate', '<=', toDate),
    ),
  );

  const records = recordsSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as CommissionRecord & { id: string }),
  );

  const grouped = new Map<string, (CommissionRecord & { id: string })[]>();
  for (const r of records) {
    const arr = grouped.get(r.rmOwnerId) ?? [];
    arr.push(r);
    grouped.set(r.rmOwnerId, arr);
  }

  const rows: PayoutPreviewRow[] = [];

  for (const [rmId, rmRecords] of grouped) {
    const emp = employees.find((e) => e.userId === rmId);
    const crmRole = emp?.crmRole ?? null;
    const rmDisplayName = emp?.displayName ?? rmId.slice(-8);

    const slab = findActiveSlab(slabs, rmId, crmRole, 'loan');
    const pct  = slab?.percentage ?? 0;

    let totalReceivedBase = 0;
    for (const rec of rmRecords) {
      totalReceivedBase += rec.actualAmount ?? rec.calculatedCommission;
    }

    rows.push({
      rmId,
      rmDisplayName,
      recordCount:      rmRecords.length,
      totalReceivedBase,
      slabPercentage:   pct,
      calculatedPayout: Math.round(totalReceivedBase * pct / 100),
      noSlabWarning:    slab === null,
    });
  }

  return rows;
}

// ─── approvePayout ────────────────────────────────────────────────────────────

export async function approvePayout(payoutId: string, approvedBy: string): Promise<void> {
  await updateDoc(doc(db, 'rm_payouts', payoutId), {
    status: 'approved',
    approvedBy,
    approvedAt: serverTimestamp(),
  });
}

// ─── markPayoutPaid ───────────────────────────────────────────────────────────

export async function markPayoutPaid(
  payoutId: string,
  reference: string,
  notes: string,
): Promise<void> {
  await updateDoc(doc(db, 'rm_payouts', payoutId), {
    status: 'paid',
    paidAt: serverTimestamp(),
    paymentReference: reference,
    paymentNotes: notes,
  });
}

// ─── seedDefaultSlabs ─────────────────────────────────────────────────────────
// Idempotent — does nothing if any slab already exists.

export async function seedDefaultSlabs(createdBy: string): Promise<void> {
  const existingSnap = await getDocs(query(collection(db, 'rm_payout_slabs'), limit(1)));
  if (!existingSnap.empty) return;

  const today = new Date().toISOString().slice(0, 10);
  const defaults = [
    {
      targetType: 'role' as const,
      targetId:   'lead_generator',
      businessLine: 'loan' as const,
      percentage: 20,
      effectiveFrom: today,
      effectiveTo: null,
      active: true,
      createdBy,
    },
    {
      targetType: 'role' as const,
      targetId:   'lead_convertor',
      businessLine: 'loan' as const,
      percentage: 50,
      effectiveFrom: today,
      effectiveTo: null,
      active: true,
      createdBy,
    },
    {
      targetType: 'role' as const,
      targetId:   'manager',
      businessLine: 'loan' as const,
      percentage: 30,
      effectiveFrom: today,
      effectiveTo: null,
      active: true,
      createdBy,
    },
  ];

  for (const d of defaults) {
    await addDoc(collection(db, 'rm_payout_slabs'), { ...d, createdAt: serverTimestamp() });
  }
}
