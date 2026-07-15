import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { appendFieldHistory } from '../../../lib/fieldHistory';
import type { Lead } from '../../../types';
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

// ─── Team leads (manager view) ───────────────────────────────────────────────
// A CRM manager sees their direct reports' leads (HRMS reporting line — the same
// relationship the rules' isManagerOf() checks). One query per report so each
// query pins primaryOwnerId to a single value, which the list rule can evaluate.
// Team size is small (a handful of telecallers per manager) so the listener
// count stays trivial. Peers never see each other — only the manager fans out.
export function useTeamLeads(managerUid: string | null, enabled: boolean) {
  const [teamUids, setTeamUids] = useState<string[]>([]);
  const [leadsByOwner, setLeadsByOwner] = useState<Record<string, Lead[]>>({});
  const [loading, setLoading] = useState(true);

  // Resolve direct reports once
  useEffect(() => {
    if (!managerUid || !enabled) { setTeamUids([]); setLoading(false); return; }
    getDocs(query(collection(db, 'users'), where('reportingManagerUid', '==', managerUid)))
      .then((snap) => {
        const uids = snap.docs
          .filter((d) => d.data().employeeStatus !== 'inactive')
          .map((d) => d.id);
        setTeamUids(uids);
        if (uids.length === 0) setLoading(false);
      })
      .catch(() => { setTeamUids([]); setLoading(false); });
  }, [managerUid, enabled]);

  // One leads subscription per report
  useEffect(() => {
    if (!enabled || teamUids.length === 0) return;
    setLeadsByOwner({});
    const unsubs = teamUids.map((uid) =>
      onSnapshot(
        query(
          collection(db, 'leads'),
          where('primaryOwnerId', '==', uid),
          where('deleted', '==', false),
          orderBy('createdAt', 'desc'),
        ),
        (snap) => {
          setLeadsByOwner((prev) => ({
            ...prev,
            [uid]: snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead)),
          }));
          setLoading(false);
        },
        () => setLoading(false),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [enabled, teamUids.join('|')]);   // eslint-disable-line react-hooks/exhaustive-deps

  const leads = Object.values(leadsByOwner).flat()
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

  return { leads, teamUids, loading };
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
export async function createLead(
  values: LeadFormValues,
  userId: string,
  connector?: { id: string; code: string; name: string } | null,
  // Field ops — GPS point captured by the RM when adding a customer at a meeting
  meetingLocation?: { lat: number; lng: number } | null,
): Promise<string> {
  const now = serverTimestamp();
  const ref = await addDoc(collection(db, 'leads'), {
    displayName:     values.displayName,
    phone:           values.phone,
    ...(values.email  ? { email:  values.email  } : {}),
    ...(values.panRaw ? { panRaw: values.panRaw } : {}),
    source:           values.source,
    ...(values.referrerName ? { referrerName: values.referrerName } : {}),
    ...(connector ? { connectorId: connector.id, connectorCode: connector.code, connectorName: connector.name } : {}),
    ...(meetingLocation
      ? { meetingLocation: { lat: meetingLocation.lat, lng: meetingLocation.lng, capturedAt: new Date().toISOString() } }
      : {}),
    tags:             [],
    primaryOwnerId:   values.primaryOwnerId,
    assignedToCurrentOwnerAt: now,   // anchors "time with owner" for the team view
    consentGiven:     true,
    consentTimestamp: now,
    consentMethod:    values.consentMethod,
    createdAt:        now,
    createdBy:        userId,
    updatedAt:        now,
    deleted:          false,
    firstContactedAt: null,   // Stage-2 SLA end — stamped once on first contact
  });
  return ref.id;
}

export async function updateLeadTags(
  leadId: string,
  tags: string[],
  // Phase P — optional actor + previous tags for field_history attribution
  actor?: { uid: string; name: string },
  prevTags?: string[],
): Promise<void> {
  if (actor) {
    const leadRef = doc(db, 'leads', leadId);
    const batch = writeBatch(db);
    batch.update(leadRef, { tags, updatedAt: serverTimestamp() });
    appendFieldHistory(batch, leadRef, 'tags', prevTags ?? null, tags, actor, 'tags_edit');
    await batch.commit();
    return;
  }
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
 * @deprecated DO NOT USE — was setting primaryOwnerId to the submitter's own UID
 * (an HRMS employee, not a CRM RM), so leads went to nobody's queue.
 *
 * Replaced by POST /api/leads/referral/submit which uses workload-aware assignment.
 * SubmitReferralPage now calls that endpoint directly.
 * Kept here only so ImportReferralsPage (bulk CSV) can be migrated separately.
 */
export async function createReferralLead(
  values: ReferralLeadValues,
  uid: string,
  displayName: string,
): Promise<string> {
  const now = serverTimestamp();
  const tags: string[] = values.productInterest ? [values.productInterest] : [];

  const ref = await addDoc(collection(db, 'leads'), {
    displayName:      values.displayName,
    phone:            values.phone,
    ...(values.email  ? { email: values.email }   : {}),
    ...(values.notes  ? { notes: values.notes }   : {}),
    source:           'employee_referral',
    referredBy:       uid,
    referredByName:   displayName,
    tags,
    // BUG WAS HERE: primaryOwnerId was uid (submitter), not an RM.
    // This function is deprecated — use /api/leads/referral/submit instead.
    primaryOwnerId:   'UNASSIGNED',
    consentGiven:     true,
    consentTimestamp: now,
    consentMethod:    values.consentMethod,
    createdAt:        now,
    createdBy:        uid,
    updatedAt:        now,
    deleted:          false,
  });

  return ref.id;
}
