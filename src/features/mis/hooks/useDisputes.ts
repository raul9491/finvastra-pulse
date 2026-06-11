import { useEffect, useState } from 'react';
import {
  collection, query, where, onSnapshot, getDocs, getDoc, doc,
  addDoc, updateDoc, arrayUnion, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { writeNotification } from '../../../lib/notifications';
import { buildHrEmailHtml, sendHrEmailNotification } from '../../../lib/notifications';
import type { CommissionDispute, DisputePriority, DisputeStatus } from '../../../types';

// ─── Priority bands (deterministic, by absolute variance ₹) ───────────────────

export function disputePriority(absVariance: number): DisputePriority {
  if (absVariance > 10_000) return 'high';
  if (absVariance >= 1_000) return 'medium';
  return 'low';
}

// ─── Auto-create on >5% discrepancy ───────────────────────────────────────────

export interface DisputeSeed {
  commissionRecordId: string;
  statementLineId: string;
  providerId: string;
  opportunityId: string;
  leadId?: string;
  expectedAmount: number;   // record.calculatedCommission (₹)
  receivedAmount: number;   // line.parsedAmount (₹)
}

/**
 * Phase P — create a commission dispute when a reconciled line lands as a
 * DISCREPANCY with |variance| > 5% of expected. Dedupe: skip when an
 * open/investigating dispute already exists for the commission record.
 * Fire-and-forget safe — never throws into the reconciliation flow.
 */
export async function maybeCreateDispute(seed: DisputeSeed): Promise<boolean> {
  try {
    const expected = seed.expectedAmount;
    const variance = seed.receivedAmount - expected;
    const variancePct = Math.abs(variance) / Math.max(expected, 1) * 100;
    if (variancePct <= 5) return false;

    // Dedupe — any open/investigating dispute on this record?
    const dupSnap = await getDocs(query(
      collection(db, 'commission_disputes'),
      where('commissionRecordId', '==', seed.commissionRecordId),
      where('status', 'in', ['open', 'investigating']),
    ));
    if (!dupSnap.empty) return false;

    // Enrich: provider name + lead name (best-effort)
    let providerName = seed.providerId;
    let leadName = '—';
    try {
      const p = await getDoc(doc(db, 'providers', seed.providerId));
      if (p.exists()) providerName = (p.data().name as string) ?? seed.providerId;
    } catch { /* keep id */ }
    if (seed.leadId) {
      try {
        const l = await getDoc(doc(db, 'leads', seed.leadId));
        if (l.exists()) leadName = (l.data().displayName as string) ?? '—';
      } catch { /* keep dash */ }
    }

    await addDoc(collection(db, 'commission_disputes'), {
      commissionRecordId: seed.commissionRecordId,
      statementLineId:    seed.statementLineId,
      providerId:         seed.providerId,
      providerName,
      opportunityId:      seed.opportunityId,
      leadId:             seed.leadId ?? null,
      leadName,
      expectedAmount:     expected,
      receivedAmount:     seed.receivedAmount,
      variance,
      variancePct:        Math.round(variancePct * 100) / 100,
      status:             'open',
      priority:           disputePriority(Math.abs(variance)),
      assignedTo:         null,
      assignedToName:     null,
      assignedAt:         null,
      notes:              [],
      resolution:         null,
      resolvedBy:         null,
      resolvedAt:         null,
      createdAt:          serverTimestamp(),
      createdBy:          'system',
    });

    // Notify + email every MIS admin (best-effort).
    notifyMisAdmins(providerName, Math.abs(variance), leadName).catch(() => {});
    return true;
  } catch {
    return false; // never break reconciliation
  }
}

async function notifyMisAdmins(providerName: string, absVariance: number, leadName: string) {
  const admins = await getDocs(query(collection(db, 'users'), where('misAccess', '==', 'admin')));
  const title = `New commission dispute — ${providerName}`;
  const body = `₹${absVariance.toLocaleString('en-IN')} variance on ${leadName}`;
  const html = buildHrEmailHtml({
    title: 'New commission dispute raised',
    lines: [
      { label: 'Provider', value: providerName },
      { label: 'Customer', value: leadName },
      { label: 'Variance', value: `₹${absVariance.toLocaleString('en-IN')}` },
    ],
    note: 'Auto-created from reconciliation (variance above 5%). Open MIS → Disputes to investigate.',
    ctaLabel: 'Open Disputes',
    ctaLink: 'https://pulse.finvastra.com/mis/disputes',
  });
  for (const a of admins.docs) {
    writeNotification(a.id, { type: 'dispute_created', title, body, link: '/mis/disputes' }).catch(() => {});
    sendHrEmailNotification({ employeeId: a.id, subject: title, htmlBody: html }).catch(() => {});
  }
}

// ─── Live list + badge ─────────────────────────────────────────────────────────

export function useDisputes(enabled: boolean) {
  const [disputes, setDisputes] = useState<CommissionDispute[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) { setDisputes([]); setLoading(false); return; }
    const unsub = onSnapshot(collection(db, 'commission_disputes'), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CommissionDispute);
      rows.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      setDisputes(rows);
      setLoading(false);
    }, () => { setDisputes([]); setLoading(false); });
    return unsub;
  }, [enabled]);

  return { disputes, loading };
}

/** Open-dispute count for the MisShell nav badge. */
export function useOpenDisputeCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) { setCount(0); return; }
    const q = query(collection(db, 'commission_disputes'), where('status', '==', 'open'));
    return onSnapshot(q, (snap) => setCount(snap.size), () => setCount(0));
  }, [enabled]);
  return count;
}

// ─── Actions ───────────────────────────────────────────────────────────────────

export async function assignDisputeToMe(id: string, uid: string, name: string): Promise<void> {
  await updateDoc(doc(db, 'commission_disputes', id), {
    assignedTo: uid, assignedToName: name, assignedAt: serverTimestamp(),
    status: 'investigating',
  });
}

export async function addDisputeNote(id: string, text: string, uid: string, name: string): Promise<void> {
  await updateDoc(doc(db, 'commission_disputes', id), {
    notes: arrayUnion({ text, by: uid, byName: name, at: new Date() }),
  });
}

export async function setDisputeStatus(id: string, status: DisputeStatus): Promise<void> {
  await updateDoc(doc(db, 'commission_disputes', id), { status });
}

export async function resolveDispute(
  id: string, resolution: string, uid: string,
  finalStatus: 'resolved' | 'written_off' = 'resolved',
): Promise<void> {
  await updateDoc(doc(db, 'commission_disputes', id), {
    status:     finalStatus,
    resolution,
    resolvedBy: uid,
    resolvedAt: serverTimestamp(),
  });
}
