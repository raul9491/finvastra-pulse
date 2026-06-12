import { useState, useEffect } from 'react';
import {
  collection, collectionGroup, query, orderBy, onSnapshot,
  addDoc, updateDoc, getDoc, getDocs, doc, serverTimestamp, where, writeBatch,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { appendFieldHistory } from '../../../lib/fieldHistory';
import type { Opportunity, OpportunityTypeConfig, Provider, Activity, ActivityType, CrmRole, ConvertorVertical, LostDetails, DsaCodeUsed } from '../../../types';
import { LOST_REASON_LABELS } from '../../../types';
import type { OpportunityFormValues } from '../leads/opportunitySchema';

// ─── All open opportunities (pipeline view) ───────────────────────────────────
export interface PipelineRow {
  oppId: string;
  leadId: string;
  leadDisplayName: string;
  opportunityType: Opportunity['opportunityType'];
  product: string;
  dealSize: number;
  stage: string;
  status: Opportunity['status'];
  ownerId: string;
  expectedCloseDate?: string;
  createdAt: any;
  updatedAt: any;
}

export function useAllOpenOpportunities(): { rows: PipelineRow[]; loading: boolean } {
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collectionGroup(db, 'opportunities'),
      where('status', '==', 'open'),
      orderBy('createdAt', 'desc'),
    );

    return onSnapshot(q, async (snap) => {
      // Extract unique leadIds from document paths: leads/{leadId}/opportunities/{oppId}
      const uniqueLeadIds = [...new Set(snap.docs.map((d) => d.ref.parent.parent!.id))];

      // Batch-fetch lead display names
      const leadNameMap: Record<string, string> = {};
      await Promise.all(
        uniqueLeadIds.map(async (leadId) => {
          const leadSnap = await getDoc(doc(db, 'leads', leadId));
          leadNameMap[leadId] = leadSnap.exists()
            ? ((leadSnap.data() as { displayName?: string }).displayName ?? 'Unknown')
            : 'Unknown';
        }),
      );

      setRows(
        snap.docs.map((d) => {
          const data = d.data() as Opportunity;
          const leadId = d.ref.parent.parent!.id;
          return {
            oppId:            d.id,
            leadId,
            leadDisplayName:  leadNameMap[leadId] ?? 'Unknown',
            opportunityType:  data.opportunityType,
            product:          data.product,
            dealSize:         data.dealSize,
            stage:            data.stage,
            status:           data.status,
            ownerId:          data.ownerId,
            expectedCloseDate: data.expectedCloseDate,
            createdAt:        data.createdAt,
            updatedAt:        data.updatedAt,
          };
        }),
      );
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  return { rows, loading };
}

// ─── Opportunities for a lead ─────────────────────────────────────────────────
export function useOpportunities(leadId: string | null) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leadId) return;
    const q = query(
      collection(db, 'leads', leadId, 'opportunities'),
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setOpportunities(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Opportunity)));
      setLoading(false);
    }, () => setLoading(false));
  }, [leadId]);

  return { opportunities, loading };
}

// ─── Single opportunity ───────────────────────────────────────────────────────
export function useOpportunity(leadId: string | null, oppId: string | null) {
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leadId || !oppId) return;
    return onSnapshot(doc(db, 'leads', leadId, 'opportunities', oppId), (snap) => {
      setOpportunity(snap.exists() ? ({ id: snap.id, ...snap.data() } as Opportunity) : null);
      setLoading(false);
    }, () => setLoading(false));
  }, [leadId, oppId]);

  return { opportunity, loading };
}

// ─── Activities on an opportunity ────────────────────────────────────────────
export function useActivities(leadId: string | null, oppId: string | null) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leadId || !oppId) return;
    const q = query(
      collection(db, 'leads', leadId, 'opportunities', oppId, 'activities'),
      orderBy('at', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setActivities(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Activity)));
      setLoading(false);
    }, () => setLoading(false));
  }, [leadId, oppId]);

  return { activities, loading };
}

// ─── Opportunity type configs ─────────────────────────────────────────────────
export function useOpportunityTypes() {
  const [types, setTypes] = useState<OpportunityTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'opportunity_types'), where('active', '==', true));
    return onSnapshot(q, (snap) => {
      setTypes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as OpportunityTypeConfig)));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  return { types, loading };
}

// ─── Providers ────────────────────────────────────────────────────────────────
export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'providers'), where('active', '==', true));
    return onSnapshot(q, (snap) => {
      setProviders(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Provider)));
    });
  }, []);

  return providers;
}

// ─── Mutations ────────────────────────────────────────────────────────────────
export async function createOpportunity(
  leadId: string,
  opportunityType: Opportunity['opportunityType'],
  product: string,
  firstStage: string,
  values: OpportunityFormValues,
  userId: string,
  customFields?: Record<string, unknown>,
  connector?: { id: string; code: string; name: string; dsaCodeUsed?: DsaCodeUsed } | null,
): Promise<string> {
  const now = serverTimestamp();
  const ref = await addDoc(collection(db, 'leads', leadId, 'opportunities'), {
    opportunityType,
    product,
    dealSize:            values.dealSize,
    stage:               firstStage,
    ownerId:             values.ownerId,
    status:              'open',
    ...(values.expectedCloseDate ? { expectedCloseDate: values.expectedCloseDate } : {}),
    ...(values.notes              ? { notes: values.notes }                         : {}),
    ...(customFields && Object.keys(customFields).length > 0 ? { customFields } : {}),
    ...(connector ? {
      connectorId: connector.id, connectorCode: connector.code, connectorName: connector.name,
      ...(connector.dsaCodeUsed ? { dsaCodeUsed: connector.dsaCodeUsed } : {}),
    } : {}),
    createdAt: now,
    updatedAt: now,
  });

  // Creation audit entry
  await addDoc(collection(db, 'leads', leadId, 'opportunities', ref.id, 'activities'), {
    type:    'note' as ActivityType,
    content: `Opportunity created: ${product}`,
    by:  userId,
    at:  now,
  });

  return ref.id;
}

export async function updateOpportunityStage(
  leadId: string,
  oppId: string,
  newStage: string,
  prevStage: string,
  userId: string,
  isLastStage: boolean,
  actorName = '', // Phase P — for field_history attribution
): Promise<void> {
  const now = serverTimestamp();
  const oppRef = doc(db, 'leads', leadId, 'opportunities', oppId);
  // Phase P — parent update + field_history diffs in ONE batch.
  const batch = writeBatch(db);
  batch.update(oppRef, {
    stage:     newStage,
    status:    isLastStage ? 'won' : 'open',
    updatedAt: now,
    ...(isLastStage ? { actualCloseDate: new Date().toISOString().slice(0, 10) } : {}),
  });
  const actor = { uid: userId, name: actorName };
  appendFieldHistory(batch, oppRef, 'stage', prevStage, newStage, actor, 'stage_advance');
  if (isLastStage) appendFieldHistory(batch, oppRef, 'status', 'open', 'won', actor, 'stage_advance');
  await batch.commit();

  await addDoc(collection(db, 'leads', leadId, 'opportunities', oppId, 'activities'), {
    type:    'status_change' as ActivityType,
    content: `Stage: ${prevStage} → ${newStage}`,
    by:  userId,
    at:  now,
  });
}

export async function markOpportunityLost(
  leadId: string,
  oppId: string,
  userId: string,
  lostDetails?: Omit<LostDetails, 'capturedAt' | 'capturedBy'>,
  actorName = '', // Phase P — for field_history attribution
): Promise<void> {
  const now = serverTimestamp();
  const oppRef = doc(db, 'leads', leadId, 'opportunities', oppId);
  // Phase P — parent update + field_history diff in ONE batch.
  const batch = writeBatch(db);
  batch.update(oppRef, {
    status:    'lost',
    updatedAt: now,
    ...(lostDetails ? {
      lostDetails: {
        ...lostDetails,
        capturedAt: now,
        capturedBy: userId,
      },
    } : {}),
  });
  appendFieldHistory(batch, oppRef, 'status', 'open', 'lost', { uid: userId, name: actorName }, 'mark_lost');
  await batch.commit();
  await addDoc(collection(db, 'leads', leadId, 'opportunities', oppId, 'activities'), {
    type:    'status_change' as ActivityType,
    content: `Opportunity marked as Lost${lostDetails?.reason ? ` (${LOST_REASON_LABELS[lostDetails.reason]})` : ''}`,
    by:  userId,
    at:  now,
  });
}

export async function addNote(
  leadId: string,
  oppId: string,
  content: string,
  userId: string,
): Promise<void> {
  await addDoc(collection(db, 'leads', leadId, 'opportunities', oppId, 'activities'), {
    type:    'note' as ActivityType,
    content: content.trim(),
    by:  userId,
    at:  serverTimestamp(),
  });
}

// ─── Handoff to specialist convertor ─────────────────────────────────────────
// Transfers opportunity.ownerId to a lead_convertor whose convertorVertical
// matches the opportunity type. lead.primaryOwnerId is NOT changed.
// UI for this is Phase 2.5c; this function is exposed now for future use.
export async function transferOpportunity(
  leadId: string,
  oppId: string,
  newConvertorId: string,
  currentUserId: string,
): Promise<void> {
  // Validate target user has the correct convertor role + vertical
  const targetSnap = await getDoc(doc(db, 'users', newConvertorId));
  if (!targetSnap.exists()) throw new Error('Target user not found.');
  const target = targetSnap.data() as { crmRole?: CrmRole; convertorVertical?: ConvertorVertical; convertorVerticals?: ('loan' | 'wealth' | 'insurance')[]; displayName?: string };
  if (target.crmRole !== 'lead_convertor') throw new Error('Target user is not a lead convertor.');

  const oppSnap = await getDoc(doc(db, 'leads', leadId, 'opportunities', oppId));
  if (!oppSnap.exists()) throw new Error('Opportunity not found.');
  const opp = oppSnap.data() as Opportunity;

  const targetVerticals = target.convertorVerticals ?? (target.convertorVertical ? [target.convertorVertical] : []);
  if (!targetVerticals.includes(opp.opportunityType as 'loan' | 'wealth' | 'insurance')) {
    throw new Error(`That convertor does not handle ${opp.opportunityType} deals.`);
  }

  const now = serverTimestamp();
  const oppRef = doc(db, 'leads', leadId, 'opportunities', oppId);
  // Phase P — ownerId change + field_history diff in ONE batch.
  const batch = writeBatch(db);
  batch.update(oppRef, {
    ownerId: newConvertorId,
    updatedAt: now,
  });
  appendFieldHistory(batch, oppRef, 'ownerId', opp.ownerId, newConvertorId,
    { uid: currentUserId, name: '' }, 'transfer');
  await batch.commit();

  await addDoc(collection(db, 'leads', leadId, 'opportunities', oppId, 'activities'), {
    type:    'ownership_change' as ActivityType,
    content: `Transferred to ${target.displayName ?? newConvertorId}`,
    by:  currentUserId,
    at:  now,
  });
}
