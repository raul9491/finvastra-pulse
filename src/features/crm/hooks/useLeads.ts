import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { Lead, ActivityType } from '../../../types';
import type { LeadFormValues } from '../leads/leadSchema';

// ─── Lead list ───────────────────────────────────────────────────────────────
export function useLeads(userId: string | null, isAdmin: boolean) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const base = collection(db, 'leads');
    const q = isAdmin
      ? query(base, where('deleted', '==', false), orderBy('createdAt', 'desc'))
      : query(base,
          where('primaryOwnerId', '==', userId),
          where('deleted', '==', false),
          orderBy('createdAt', 'desc'),
        );
    return onSnapshot(q, (snap) => {
      setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead)));
      setLoading(false);
    }, () => setLoading(false));
  }, [userId, isAdmin]);

  return { leads, loading };
}

// ─── Single lead ─────────────────────────────────────────────────────────────
export function useLead(leadId: string | null) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leadId) return;
    return onSnapshot(doc(db, 'leads', leadId), (snap) => {
      setLead(snap.exists() ? ({ id: snap.id, ...snap.data() } as Lead) : null);
      setLoading(false);
    }, () => setLoading(false));
  }, [leadId]);

  return { lead, loading };
}

// ─── Mutations ────────────────────────────────────────────────────────────────
export async function createLead(values: LeadFormValues, userId: string): Promise<string> {
  const now = serverTimestamp();
  const ref = await addDoc(collection(db, 'leads'), {
    displayName:     values.displayName,
    phone:           values.phone,
    ...(values.email  ? { email:  values.email  } : {}),
    ...(values.panRaw ? { panRaw: values.panRaw } : {}),
    source:           values.source,
    ...(values.referrerName ? { referrerName: values.referrerName } : {}),
    tags:             [],
    primaryOwnerId:   values.primaryOwnerId,
    consentGiven:     true,
    consentTimestamp: now,
    consentMethod:    values.consentMethod,
    createdAt:        now,
    createdBy:        userId,
    updatedAt:        now,
    deleted:          false,
  });
  return ref.id;
}

export async function updateLeadTags(
  leadId: string,
  tags: string[],
): Promise<void> {
  await updateDoc(doc(db, 'leads', leadId), { tags, updatedAt: serverTimestamp() });
}
