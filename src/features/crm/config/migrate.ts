import {
  collection, getDocs, query, where,
  addDoc, updateDoc, doc, serverTimestamp, deleteField,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';

/**
 * One-off migration: converts Phase 2.1 lead docs (with embedded deal fields)
 * to the new Lead-Opportunity model (lead = person, opportunity = deal).
 *
 * Reads: all non-deleted leads that still have the old 'product' field.
 * Writes: new /leads/{id}/opportunities/{newId} + updates lead doc.
 * Run once as admin via the CRM dashboard button.
 */
export async function migrateLeads(): Promise<{ migrated: number }> {
  const snap = await getDocs(
    query(collection(db, 'leads'), where('deleted', '==', false)),
  );

  let migrated = 0;

  for (const leadDoc of snap.docs) {
    const data = leadDoc.data();

    // Skip already-migrated leads (no old 'product' field)
    if (!data['product']) continue;

    const leadId = leadDoc.id;
    const now = serverTimestamp();

    // Determine status from old stage field
    const oldStage = (data['stage'] ?? 'new') as string;
    const status =
      oldStage === 'disbursed' ? 'won' :
      oldStage === 'lost'      ? 'lost' : 'open';

    // Map old stage names to new stage display names
    const stageMap: Record<string, string> = {
      new:                  'New',
      contacted:            'Contacted',
      documents_collected:  'Documents Collected',
      submitted:            'Submitted to Bank',
      sanctioned:           'Sanctioned',
      disbursed:            'Disbursed',
      lost:                 'New', // reset to New if lost status
    };
    const mappedStage = stageMap[oldStage] ?? 'New';

    // Create the opportunity from old deal fields
    await addDoc(collection(db, 'leads', leadId, 'opportunities'), {
      opportunityType: 'loan',
      product:   data['product'] ?? 'Home Loan',
      dealSize:  data['ticketSize'] ?? 0,
      stage:     mappedStage,
      ownerId:   data['ownerRmId'] ?? data['createdBy'],
      status,
      createdAt: data['createdAt'] ?? now,
      updatedAt: now,
    });

    // Update lead doc: rename fields + remove deal fields
    await updateDoc(doc(db, 'leads', leadId), {
      // Rename person fields to new schema
      displayName:    data['customerName'] ?? data['displayName'] ?? '',
      primaryOwnerId: data['ownerRmId']    ?? data['primaryOwnerId'] ?? data['createdBy'],
      panRaw:         data['pan']          ?? data['panRaw']         ?? deleteField(),
      tags:           data['tags']         ?? [],
      updatedAt:      now,

      // Remove old deal fields
      customerName: deleteField(),
      ownerRmId:    deleteField(),
      pan:          deleteField(),
      product:      deleteField(),
      ticketSize:   deleteField(),
      stage:        deleteField(),
    });

    migrated++;
  }

  return { migrated };
}
