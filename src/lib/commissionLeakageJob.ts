import admin from 'firebase-admin';

export interface LeakageRecord {
  leadId: string;
  opportunityId: string;
  submissionId: string;
  providerId: string;
  providerName: string;
  disbursedAt: Date;
  disbursedAmount: number;
  issue: 'no_commission_record' | 'no_slab_match';
}

// Calls POST /api/admin/run-commission-leakage-check (secured to admin via Bearer token).
// Finds primary disbursed submissions in the last 30 days that either have no
// commission_record or whose record has notes='NO_SLAB_MATCH'. Writes a report
// to /commission_leakage_reports for admin review.
export async function runCommissionLeakageCheck(db: FirebaseFirestore.Firestore): Promise<{
  reportId: string;
  leakageCount: number;
  totalEstimatedLoss: number;
}> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Find primary disbursed submissions. We filter by disbursedAt in-process because
  // Firestore collectionGroup queries cannot combine inequality on a nested timestamp
  // with the isPrimary equality filter without a composite index per collection path.
  const subsSnap = await db.collectionGroup('bank_submissions')
    .where('status', '==', 'disbursed')
    .where('isPrimary', '==', true)
    .get();

  const providersSnap = await db.collection('providers').get();
  const providerNames = new Map(
    providersSnap.docs.map((d) => [d.id, d.data()['name'] as string]),
  );

  const leaks: LeakageRecord[] = [];

  for (const subDoc of subsSnap.docs) {
    const sub = subDoc.data();

    // Resolve disbursedAt — stored as Firestore Timestamp on the doc
    const disbursedAt: Date | null =
      sub['disbursedAt']?.toDate?.() ?? null;

    if (!disbursedAt || disbursedAt < thirtyDaysAgo) continue;

    const path   = subDoc.ref.path.split('/');
    const leadId = path[1];
    const oppId  = path[3];
    const subId  = path[5];

    // Check if a commission_record exists for this submission
    const recordsSnap = await db
      .collection('commission_records')
      .where('submissionId', '==', subId)
      .limit(1)
      .get();

    if (recordsSnap.empty) {
      leaks.push({
        leadId,
        opportunityId: oppId,
        submissionId:  subId,
        providerId:    sub['providerId'] as string,
        providerName:  providerNames.get(sub['providerId'] as string) ?? (sub['providerId'] as string),
        disbursedAt,
        disbursedAmount: (sub['disbursedAmount'] as number | undefined) ?? 0,
        issue: 'no_commission_record',
      });
      continue;
    }

    // Check for NO_SLAB_MATCH
    const record = recordsSnap.docs[0].data();
    if (record['notes'] === 'NO_SLAB_MATCH') {
      leaks.push({
        leadId,
        opportunityId: oppId,
        submissionId:  subId,
        providerId:    sub['providerId'] as string,
        providerName:  providerNames.get(sub['providerId'] as string) ?? (sub['providerId'] as string),
        disbursedAt,
        disbursedAmount: (sub['disbursedAmount'] as number | undefined) ?? 0,
        issue: 'no_slab_match',
      });
    }
  }

  // Rough estimate: 0.5% of disbursed value as proxy for typical commission lost
  const totalEstimatedLoss = leaks.reduce((sum, l) => sum + l.disbursedAmount * 0.005, 0);

  // Write report doc — server-side only; client rules deny writes
  const reportRef = db.collection('commission_leakage_reports').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  await reportRef.set({
    runAt: now,
    periodStart: thirtyDaysAgo.toISOString(),
    periodEnd:   new Date().toISOString(),
    leakageCount: leaks.length,
    totalEstimatedLoss,
    leaks: leaks.map((l) => ({
      ...l,
      disbursedAt: l.disbursedAt.toISOString(),
    })),
  });

  return { reportId: reportRef.id, leakageCount: leaks.length, totalEstimatedLoss };
}
