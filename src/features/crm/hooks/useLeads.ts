import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, getDocs, writeBatch,
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

// ─── Employee referral hooks ──────────────────────────────────────────────────

/** Real-time list of leads submitted by the given HRMS employee. */
export function useMyReferrals(uid: string) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'leads'),
      where('referredBy', '==', uid),
      where('deleted', '==', false),
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead)));
      setLoading(false);
    }, () => setLoading(false));
  }, [uid]);

  return { leads, loading };
}

export interface ReferralLeadValues {
  displayName: string;
  phone: string;
  email?: string;
  /** Stored as a tag, e.g. "Home Loan ₹50L" */
  productInterest?: string;
  notes?: string;
  consentMethod: 'verbal' | 'written' | 'digital' | 'offline_collection';
}

/**
 * Creates a lead with source='employee_referral'. After Firestore write, pushes a
 * new_referral notification to every active lead_generator so they see incoming
 * employee referrals in their queue.
 */
export async function createReferralLead(
  values: ReferralLeadValues,
  uid: string,
  displayName: string,
): Promise<string> {
  const now = serverTimestamp();
  const tags: string[] = values.productInterest
    ? [values.productInterest]
    : [];

  const ref = await addDoc(collection(db, 'leads'), {
    displayName:     values.displayName,
    phone:           values.phone,
    ...(values.email ? { email: values.email } : {}),
    source:          'employee_referral',
    referredBy:      uid,
    tags,
    primaryOwnerId:  uid,
    consentGiven:    true,
    consentTimestamp: now,
    consentMethod:   values.consentMethod,
    createdAt:       now,
    createdBy:       uid,
    updatedAt:       now,
    deleted:         false,
  });

  // Notify all active lead_generators about the new referral.
  // Non-fatal — the lead is already created above; notification failure is logged only.
  try {
    const genSnap = await getDocs(
      query(
        collection(db, 'users'),
        where('crmRole', '==', 'lead_generator'),
        where('employeeStatus', '==', 'active'),
      ),
    );
    if (!genSnap.empty) {
      const batch = writeBatch(db);
      for (const genDoc of genSnap.docs) {
        const notifRef = doc(collection(db, 'notifications', genDoc.id, 'items'));
        batch.set(notifRef, {
          type:        'new_referral',
          leadId:      ref.id,
          leadName:    values.displayName,
          submittedBy: displayName,
          createdAt:   now,
          read:        false,
        });
      }
      await batch.commit();
    }
  } catch (err) {
    console.warn('[createReferralLead] notification batch failed (non-fatal):', err);
  }

  return ref.id;
}
