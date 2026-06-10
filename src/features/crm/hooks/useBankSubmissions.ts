import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, getDoc, getDocs,
  doc, serverTimestamp, arrayUnion, runTransaction,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { BankSubmission, BankSubmissionStatus, ActivityType, CommissionSlab } from '../../../types';
import { findMatchingSlab, calculateCommission } from './useCommissionSlabs';

// Loan stage names match the /opportunity_types seed data exactly
const LOAN_STAGE_ORDER = [
  'New', 'Contacted', 'Documents Collected',
  'Submitted to Bank', 'Under Review', 'Sanctioned', 'Disbursed',
];

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useBankSubmissions(leadId: string | null, oppId: string | null) {
  const [submissions, setSubmissions] = useState<BankSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leadId || !oppId) return;
    const q = query(
      collection(db, 'leads', leadId, 'opportunities', oppId, 'bank_submissions'),
      orderBy('createdAt', 'asc'),
    );
    return onSnapshot(q, (snap) => {
      setSubmissions(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BankSubmission)));
      setLoading(false);
    }, () => setLoading(false));
  }, [leadId, oppId]);

  return { submissions, loading };
}

// ─── Create submission ────────────────────────────────────────────────────────
export async function createSubmission(
  leadId: string,
  oppId: string,
  providerId: string,
  notes: string,
  requestedAmount: number | undefined,
  userId: string,
): Promise<string> {
  const now = serverTimestamp();
  const ref = await addDoc(
    collection(db, 'leads', leadId, 'opportunities', oppId, 'bank_submissions'),
    {
      providerId,
      status:        'preparing' as BankSubmissionStatus,
      isPrimary:     false,
      ...(notes            ? { notes }            : {}),
      ...(requestedAmount  ? { requestedAmount }  : {}),
      statusHistory: [],
      createdAt:     now,
      createdBy:     userId,
      updatedAt:     now,
    },
  );
  return ref.id;
}

// ─── Update submission status ─────────────────────────────────────────────────
export async function updateSubmissionStatus(
  leadId: string,
  oppId: string,
  subId: string,
  prevStatus: BankSubmissionStatus,
  newStatus: BankSubmissionStatus,
  userId: string,
  extra?: {
    sanctionedAmount?: number;
    disbursedAmount?: number;
    interestRate?: number;
    tenureMonths?: number;
    rejectionReason?: string;
    notes?: string;
  },
): Promise<void> {
  const now = serverTimestamp();

  // Date fields keyed by the new status
  const dateFields: Record<string, unknown> = {};
  if (newStatus === 'submitted') dateFields.submittedAt = now;
  if (newStatus === 'sanctioned' || newStatus === 'rejected') dateFields.decisionAt = now;
  if (newStatus === 'disbursed') { dateFields.disbursedAt = now; dateFields.decisionAt = now; }

  // History entry uses client ISO timestamp — serverTimestamp() can't go inside arrays
  const historyEntry = { from: prevStatus, to: newStatus, at: new Date().toISOString(), by: userId };

  await updateDoc(doc(db, 'leads', leadId, 'opportunities', oppId, 'bank_submissions', subId), {
    status:        newStatus,
    updatedAt:     now,
    statusHistory: arrayUnion(historyEntry),
    ...dateFields,
    ...(extra ?? {}),
  });

  await autoPromoteOpportunity(leadId, oppId, newStatus, userId);
}

// ─── Set primary disbursement ─────────────────────────────────────────────────
// Phase 2.8: Wrapped in runTransaction — prevents duplicate commission_records
// if two clients call setPrimary simultaneously. Firestore's optimistic locking
// retries the transaction if any read document changed between read and write.
export async function setPrimarySubmission(
  leadId: string,
  oppId: string,
  subId: string,
  userId: string,
): Promise<void> {
  const subRef = doc(db, 'leads', leadId, 'opportunities', oppId, 'bank_submissions', subId);
  const oppRef = doc(db, 'leads', leadId, 'opportunities', oppId);
  const leadRef = doc(db, 'leads', leadId);
  const todayStr = new Date().toISOString().slice(0, 10);
  const histEntry = {
    from: 'disbursed' as BankSubmissionStatus,
    to:   'disbursed' as BankSubmissionStatus,
    at:   new Date().toISOString(),
    by:   userId,
    notes: 'Marked as primary disbursement',
  };

  // Pre-read commission slabs before the transaction — collection queries are
  // not permitted inside Firestore transactions (only document reads via t.get).
  const slabsSnap = await getDocs(
    query(collection(db, 'commission_slabs'), where('active', '==', true)),
  );
  const allSlabs = slabsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as CommissionSlab));

  // Pre-generate the commission record ref so the ID is available post-transaction
  // for the activity log. The t.set() below atomically creates the document.
  const commissionRef = doc(collection(db, 'commission_records'));

  // All reads + all financial writes are atomic in one transaction.
  const { sub, opp, commissionDisplay } = await runTransaction(db, async (t) => {
    const subSnap = await t.get(subRef);
    const oppSnap = await t.get(oppRef);
    const leadSnap = await t.get(leadRef);

    if (!subSnap.exists()) throw new Error('Submission not found.');
    if (!oppSnap.exists()) throw new Error('Parent opportunity not found.');

    const subData = subSnap.data()!;
    const oppData = oppSnap.data()!;
    const leadData = leadSnap.exists() ? leadSnap.data()! : {};

    // Connector who sourced this case: opportunity's own, else the customer's (lead).
    const connectorId   = oppData.connectorId   ?? leadData.connectorId   ?? null;
    const connectorCode = oppData.connectorCode ?? leadData.connectorCode ?? null;
    const connectorName = oppData.connectorName ?? leadData.connectorName ?? null;

    if (subData.status !== 'disbursed') {
      throw new Error('Only a disbursed submission can be marked as primary.');
    }
    if (subData.isPrimary === true) {
      throw new Error('This submission is already marked as primary.');
    }
    if (oppData.status === 'won') {
      throw new Error('Another submission is already marked as the primary disbursement.');
    }

    // Calculate commission inside the transaction using pre-loaded slabs
    const basisAmount = oppData.basisOn === 'sanctioned'
      ? (subData.sanctionedAmount ?? subData.disbursedAmount ?? 0)
      : (subData.disbursedAmount  ?? subData.sanctionedAmount ?? 0);

    const disbursedDateStr = subData.disbursedAt?.toDate
      ? (subData.disbursedAt.toDate() as Date).toISOString().slice(0, 10)
      : todayStr;

    const matchedSlab          = findMatchingSlab(allSlabs, subData.providerId, oppData.product, basisAmount, disbursedDateStr);
    const calculatedCommission = matchedSlab ? calculateCommission(matchedSlab, basisAmount) : 0;
    const noSlabMatch          = matchedSlab === null;

    const payoutDate = new Date(disbursedDateStr);
    payoutDate.setDate(payoutDate.getDate() + 30);

    const now = serverTimestamp();
    t.update(subRef, { isPrimary: true, updatedAt: now, statusHistory: arrayUnion(histEntry) });
    t.update(oppRef, { stage: 'Disbursed', status: 'won', actualCloseDate: todayStr, updatedAt: now });

    // Commission record created INSIDE the transaction — rolls back atomically
    // if any other write in the transaction fails.
    t.set(commissionRef, {
      leadId,
      opportunityId:     oppId,
      submissionId:      subId,
      providerId:        subData.providerId,
      rmOwnerId:         oppData.ownerId as string,
      slabId:            matchedSlab?.id ?? null,
      basisAmount,
      calculatedCommission,
      status:            'pending',
      expectedPayoutDate: payoutDate.toISOString().slice(0, 10),
      notes:             noSlabMatch ? 'NO_SLAB_MATCH — admin review required' : null,
      ...(connectorId ? { connectorId, connectorCode, connectorName } : {}),
      createdAt:         serverTimestamp(),
    });

    const display = noSlabMatch
      ? 'No matching slab — commission to be set manually'
      : `₹${calculatedCommission.toLocaleString('en-IN')} (${matchedSlab!.percentage != null ? `${matchedSlab!.percentage}%` : `₹${matchedSlab!.flatFee} flat`} of ₹${basisAmount.toLocaleString('en-IN')})`;

    return {
      sub: { id: subSnap.id, ...subData } as BankSubmission,
      opp: oppData,
      commissionDisplay: display,
    };
  });

  // Post-transaction: non-critical activity logs only.
  // The financial record is already committed above.
  const now = serverTimestamp();
  await addDoc(collection(db, 'leads', leadId, 'opportunities', oppId, 'activities'), {
    type:    'status_change' as ActivityType,
    content: 'Opportunity stage moved to Disbursed — primary bank disbursement confirmed',
    by:  userId,
    at:  now,
  });

  await addDoc(collection(db, 'leads', leadId, 'opportunities', oppId, 'activities'), {
    type:    'commission_calculated' as ActivityType,
    content: `Expected commission: ${commissionDisplay} from ${sub.providerId} — record #${commissionRef.id}`,
    by:  userId,
    at:  now,
  });
}

// ─── Internal: auto-promote opportunity stage after a submission status change ─
async function autoPromoteOpportunity(
  leadId: string,
  oppId: string,
  newSubmissionStatus: BankSubmissionStatus,
  userId: string,
): Promise<void> {
  const oppRef  = doc(db, 'leads', leadId, 'opportunities', oppId);
  const oppSnap = await getDoc(oppRef);
  const opp = oppSnap.data();
  if (!opp) return;

  const currentIdx = LOAN_STAGE_ORDER.indexOf(opp.stage as string);
  const now = serverTimestamp();

  // Submission status → the loan stage it should promote to
  const promotionMap: Partial<Record<BankSubmissionStatus, string>> = {
    submitted: 'Submitted to Bank',
    in_review: 'Under Review',
    sanctioned: 'Sanctioned',
  };

  const targetStage = promotionMap[newSubmissionStatus];
  if (targetStage) {
    const targetIdx = LOAN_STAGE_ORDER.indexOf(targetStage);
    if (targetIdx > currentIdx) {
      await updateDoc(oppRef, { stage: targetStage, updatedAt: now });
      await addDoc(collection(db, 'leads', leadId, 'opportunities', oppId, 'activities'), {
        type:    'status_change' as ActivityType,
        content: `Opportunity stage moved to ${targetStage} by bank submission update`,
        by:  userId,
        at:  now,
      });
    }
    return;
  }

  // If all submissions are now rejected → mark opportunity as lost
  if (newSubmissionStatus === 'rejected' && opp.status !== 'lost') {
    const allSnap = await getDocs(
      collection(db, 'leads', leadId, 'opportunities', oppId, 'bank_submissions'),
    );
    const allRejected = allSnap.docs.every((d) => d.data().status === 'rejected');
    if (allRejected) {
      await updateDoc(oppRef, {
        status:          'lost',
        actualCloseDate: new Date().toISOString().slice(0, 10),
        updatedAt:       now,
      });
      await addDoc(collection(db, 'leads', leadId, 'opportunities', oppId, 'activities'), {
        type:    'status_change' as ActivityType,
        content: 'Opportunity marked as Lost — all bank submissions rejected',
        by:  userId,
        at:  now,
      });
    }
  }
}
