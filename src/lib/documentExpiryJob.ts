import admin from 'firebase-admin';

interface ExpiryRule {
  docTypeId: string;
  expiryDays: number | null; // null = never expires
}

// Checks all active bank_submissions for expired documents.
// Call via POST /api/admin/run-document-expiry-check (secured to admin).
export async function runDocumentExpiryCheck(db: FirebaseFirestore.Firestore): Promise<{
  checked: number;
  expired: number;
}> {
  const now = new Date();

  // Fetch expiry rules from /document_types
  const dtSnap = await db.collection('document_types').get();
  const expiryMap = new Map<string, number | null>();
  for (const d of dtSnap.docs) {
    const data = d.data();
    expiryMap.set(d.id, typeof data.expiryDays === 'number' ? data.expiryDays : null);
  }

  // Fetch all active bank submissions (status in preparing/submitted/in_review)
  const activeStatuses = ['preparing', 'submitted', 'in_review'];

  let checked = 0, expired = 0;

  // Collection group query on bank_submissions
  const subsSnap = await db.collectionGroup('bank_submissions')
    .where('status', 'in', activeStatuses)
    .get();

  for (const subDoc of subsSnap.docs) {
    const sub = subDoc.data();
    const documentStatus = sub.documentStatus as Record<string, string> | undefined;
    if (!documentStatus) continue;

    checked++;
    const subPath = subDoc.ref.path; // leads/{leadId}/opportunities/{oppId}/bank_submissions/{subId}
    const parts = subPath.split('/');
    // parts: ['leads', leadId, 'opportunities', oppId, 'bank_submissions', subId]
    const leadId = parts[1];
    const oppId = parts[3];

    const updates: Record<string, string | admin.firestore.FieldValue> = {};
    const logEntries: object[] = [];
    const expiredDocs: string[] = [];

    for (const [docTypeId, status] of Object.entries(documentStatus)) {
      if (status !== 'collected' && status !== 'submitted') continue;

      const expiryDays = expiryMap.get(docTypeId);
      if (!expiryDays) continue; // null or 0 = never expires

      // Find when this doc was collected from the log
      const log = (sub.documentStatusLog ?? []) as Array<{ docTypeId: string; to: string; at: string }>;
      const collectedEntry = log
        .filter(e => e.docTypeId === docTypeId && e.to === 'collected')
        .sort((a, b) => b.at.localeCompare(a.at))[0];
      if (!collectedEntry) continue;

      const collectedAt = new Date(collectedEntry.at);
      const expiryDate = new Date(collectedAt.getTime() + expiryDays * 24 * 60 * 60 * 1000);

      if (now > expiryDate) {
        updates[`documentStatus.${docTypeId}`] = 'expired';
        logEntries.push({
          docTypeId,
          from: status,
          to: 'expired',
          by: 'system',
          at: now.toISOString(),
        });
        expiredDocs.push(docTypeId);
        expired++;
      }
    }

    if (expiredDocs.length > 0) {
      // Update submission
      await subDoc.ref.update({
        ...updates,
        documentStatusLog: admin.firestore.FieldValue.arrayUnion(...logEntries),
        slaBreached: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Fetch document labels for the activity message
      const dtLabels = await Promise.all(
        expiredDocs.map(id =>
          db.collection('document_types')
            .doc(id)
            .get()
            .then(d => (d.data()?.label as string | undefined) ?? id),
        ),
      );

      // Add activity to opportunity
      await db
        .collection('leads').doc(leadId)
        .collection('opportunities').doc(oppId)
        .collection('activities')
        .add({
          type: 'note',
          content: `⚠ ${expiredDocs.length} document(s) expired and need refreshing: ${dtLabels.join(', ')}`,
          by: 'system',
          at: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
  }

  return { checked, expired };
}

// Keep the interface export for potential future use (e.g. admin config page)
export type { ExpiryRule };
