import admin from 'firebase-admin';

interface SLAConfig {
  submitted_to_in_review: number;   // days
  in_review_to_sanctioned: number;
  sanctioned_to_disbursed: number;
}

// Maps status → the transition key we're checking
const STATUS_TRANSITION_MAP: Partial<Record<string, keyof SLAConfig>> = {
  in_review:  'submitted_to_in_review',
  sanctioned: 'in_review_to_sanctioned',
  disbursed:  'sanctioned_to_disbursed',
};

// Default SLA if provider has no config
const DEFAULT_SLA: SLAConfig = {
  submitted_to_in_review: 3,
  in_review_to_sanctioned: 7,
  sanctioned_to_disbursed: 5,
};

// Calls POST /api/admin/run-bank-sla-check (secured to admin via Bearer token).
// Scans all active bank submissions, marks slaBreached=true when the current
// status has exceeded the provider's typical turnaround, and writes an activity note.
export async function runBankSLACheck(db: FirebaseFirestore.Firestore): Promise<{
  checked: number;
  breached: number;
}> {
  const activeStatuses = ['submitted', 'in_review', 'sanctioned'];
  const subsSnap = await db.collectionGroup('bank_submissions')
    .where('status', 'in', activeStatuses)
    .get();

  // Load all providers into a map
  const providersSnap = await db.collection('providers').get();
  const providerSLA = new Map<string, SLAConfig>();
  for (const d of providersSnap.docs) {
    const data = d.data();
    // typicalTurnaroundDays is an optional object on the provider doc with the
    // same shape as SLAConfig. Fall back to DEFAULT_SLA if absent.
    providerSLA.set(d.id, (data['typicalTurnaroundDays'] as SLAConfig | undefined) ?? DEFAULT_SLA);
  }

  let checked = 0, breached = 0;
  const now = new Date();

  for (const subDoc of subsSnap.docs) {
    const sub = subDoc.data();
    checked++;

    const transitionKey = STATUS_TRANSITION_MAP[sub['status'] as string];
    if (!transitionKey) continue;

    const sla = providerSLA.get(sub['providerId'] as string) ?? DEFAULT_SLA;
    const maxDays = sla[transitionKey];

    // Get timestamp of when this status started.
    // Use the most recent statusHistory entry matching the current status.
    const history = (sub['statusHistory'] ?? []) as Array<{ to: string; at: string }>;
    const entry = history
      .filter((h) => h.to === sub['status'])
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!entry) continue;

    const statusStarted = new Date(entry.at);
    const daysInStatus = (now.getTime() - statusStarted.getTime()) / 86400000;

    if (daysInStatus > maxDays && !sub['slaBreached']) {
      const path = subDoc.ref.path.split('/');
      const leadId = path[1];
      const oppId  = path[3];

      await subDoc.ref.update({
        slaBreached: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Add activity warning on the opportunity
      const providerName =
        providersSnap.docs.find((d) => d.id === sub['providerId'])?.data()['name'] as string | undefined
        ?? (sub['providerId'] as string);

      await db
        .collection('leads').doc(leadId)
        .collection('opportunities').doc(oppId)
        .collection('activities')
        .add({
          type: 'note',
          content: `⏰ ${providerName} has had this in "${sub['status'] as string}" for ${Math.floor(daysInStatus)} days. Typical: ${maxDays} days. Follow up recommended.`,
          by: 'system',
          at: admin.firestore.FieldValue.serverTimestamp(),
        });

      breached++;
    }
  }

  return { checked, breached };
}
