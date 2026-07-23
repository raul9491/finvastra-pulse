import {
  doc, updateDoc, serverTimestamp, collection, getDocs, writeBatch, addDoc, deleteField,
} from 'firebase/firestore';
import { db } from './firebase';

export interface RTBFResult {
  leadId: string;
  anonymisedAt: Date;
  activitiesRedacted: number;
  messagesRedacted: number;
}

/**
 * DPDP Act right to erasure.
 *
 * `/leads` holds TWO document shapes (see src/lib/crm2/leadModel.ts): the old-CRM
 * "Customer" (displayName / phone) and the CRM 2.0 lead (name / mobile). This
 * clears BOTH sets of keys unconditionally — a lead is only ever one shape, so
 * writing the other shape's keys is harmless, and covering both is what keeps
 * erasure model-proof as the funnel evolves.
 *
 * FIXED 2026-07-23: this previously cleared only displayName/phone/email/PAN and
 * walked only `opportunities/*​/activities`. That left a CRM 2.0 lead's name,
 * mobile, alt phones, imported sheet columns and WhatsApp history fully intact,
 * and left the LEAD-LEVEL activity feed (added in Phase P) unredacted for BOTH
 * models. Every new lead is CRM 2.0, so the gap was widening daily.
 */
export async function anonymiseLead(
  leadId: string,
  initiatedBy: string,
  reason: string,
): Promise<RTBFResult> {
  const shortId = leadId.slice(-6).toUpperCase();
  const rtbfNote = `[Content redacted under DPDP Act right to erasure on ${new Date().toLocaleDateString('en-IN')}]`;

  // 1. The lead document — both models' PII field names.
  await updateDoc(doc(db, 'leads', leadId), {
    // Old-CRM (Customer) shape
    displayName: `REDACTED-${shortId}`,
    phone: 'REDACTED',
    // CRM 2.0 shape
    name: `REDACTED-${shortId}`,
    customerName: `REDACTED-${shortId}`,
    mobile: 'REDACTED',
    // Shared
    email: null,
    panRaw: null,
    panEncrypted: null,
    panMasked: null,
    // Secondary carriers of the person's number — all added AFTER the original
    // helper was written, which is exactly why they were being missed.
    altPhones: [],
    phoneOriginal: deleteField(),
    dupeKeys: [],                     // hashes derived from phone/email
    // Free-form carriers of customer detail.
    importExtras: deleteField(),      // every unmapped column from the source sheet
    customerProfile: null,            // business name / turnover / requirements
    notes: rtbfNote,
    nextFollowUpNote: null,
    activityLog: [],                  // CRM 2.0 keeps its call log inline on the doc
    meetingLocation: deleteField(),   // GPS of where the customer was met
    rtbfApplied: true,
    rtbfDate: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  let activitiesRedacted = 0;

  // 2a. Lead-level activity feed (Phase P). NOT covered before, so call notes
  //     survived erasure on every lead — old-model included.
  activitiesRedacted += await redactActivityContent(
    collection(db, 'leads', leadId, 'activities'), rtbfNote,
  );

  // 2b. Activities under each opportunity (old-CRM deal model).
  const oppsSnap = await getDocs(collection(db, 'leads', leadId, 'opportunities'));
  for (const oppDoc of oppsSnap.docs) {
    activitiesRedacted += await redactActivityContent(
      collection(db, 'leads', leadId, 'opportunities', oppDoc.id, 'activities'), rtbfNote,
    );
  }

  // 3. WhatsApp thread — the bodies are the customer's own words and from/to are
  //    their number.
  let messagesRedacted = 0;
  const waSnap = await getDocs(collection(db, 'leads', leadId, 'whatsapp'));
  if (!waSnap.empty) {
    const batch = writeBatch(db);
    for (const m of waSnap.docs) {
      batch.update(m.ref, { body: rtbfNote, from: 'REDACTED', to: 'REDACTED' });
      messagesRedacted++;
    }
    await batch.commit();
  }

  // 4. RTBF event log — records the FACT, never the original data.
  await addDoc(collection(db, 'rtbf_log'), {
    leadId,
    initiatedBy,
    initiatedAt: serverTimestamp(),
    reason,
    activitiesRedacted,
    messagesRedacted,
  });

  return { leadId, anonymisedAt: new Date(), activitiesRedacted, messagesRedacted };
}

/** Redact the free text of every activity in a collection. Returns the count. */
async function redactActivityContent(
  ref: ReturnType<typeof collection>, rtbfNote: string,
): Promise<number> {
  const snap = await getDocs(ref);
  if (snap.empty) return 0;
  const batch = writeBatch(db);
  for (const d of snap.docs) batch.update(d.ref, { content: rtbfNote });
  await batch.commit();
  return snap.docs.length;
}
