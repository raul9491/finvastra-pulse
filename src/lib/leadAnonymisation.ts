import {
  doc, updateDoc, serverTimestamp, collection, getDocs, writeBatch, addDoc,
} from 'firebase/firestore';
import { db } from './firebase';

export interface RTBFResult {
  leadId: string;
  anonymisedAt: Date;
  activitiesRedacted: number;
}

export async function anonymiseLead(
  leadId: string,
  initiatedBy: string,
  reason: string,
): Promise<RTBFResult> {
  // 1. Anonymise the lead's PII fields
  const shortId = leadId.slice(-6).toUpperCase();
  await updateDoc(doc(db, 'leads', leadId), {
    displayName: `REDACTED-${shortId}`,
    phone: 'REDACTED',
    email: null,
    panRaw: null,
    panEncrypted: null,
    panMasked: null,
    rtbfApplied: true,
    rtbfDate: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // 2. Redact all activity content across all opportunities
  let activitiesRedacted = 0;
  const oppsSnap = await getDocs(collection(db, 'leads', leadId, 'opportunities'));
  const rtbfNote = `[Content redacted under DPDP Act right to erasure on ${new Date().toLocaleDateString('en-IN')}]`;

  for (const oppDoc of oppsSnap.docs) {
    const activitiesSnap = await getDocs(
      collection(db, 'leads', leadId, 'opportunities', oppDoc.id, 'activities'),
    );
    const batch = writeBatch(db);
    for (const actDoc of activitiesSnap.docs) {
      batch.update(actDoc.ref, { content: rtbfNote });
      activitiesRedacted++;
    }
    if (activitiesSnap.docs.length > 0) await batch.commit();
  }

  // 3. Write RTBF event log (records the FACT, not the original data)
  await addDoc(collection(db, 'rtbf_log'), {
    leadId,
    initiatedBy,
    initiatedAt: serverTimestamp(),
    reason,
    // NOTE: original PII is NOT stored here — only the audit fact
  });

  return { leadId, anonymisedAt: new Date(), activitiesRedacted };
}
