/**
 * Go-live config seed — writes the three app_config docs for the lead pipeline.
 *
 * IDEMPOTENT / create-if-absent: an existing doc is NEVER overwritten (re-running is
 * a no-op for docs already present). To force-rewrite a doc, delete it first in the
 * Firebase Console, or run with OVERWRITE=true.
 *
 *   app_config/business_hours  — IST, 10:00–18:30, Mon–Sat except 1st & 2nd Sat, Sun off
 *   app_config/sla             — warm 15m/30m · cold 48h/24h · manual 0/30m (NO escalationUids:
 *                                Stage-1/backlog recipients resolve LIVE to active
 *                                crmRole:'manager' users, super admins as fallback)
 *   app_config/queues          — a single shared ['*'] FIFO queue
 *
 * Usage (repo root):
 *   npx tsx scripts/seed/seedGoLiveConfig.ts              # create-if-absent
 *   DRY_RUN=true   npx tsx scripts/seed/seedGoLiveConfig.ts
 *   OVERWRITE=true npx tsx scripts/seed/seedGoLiveConfig.ts   # replace existing too
 *
 * Targets the named `pulse` database. Requires GOOGLE_APPLICATION_CREDENTIALS
 * (or emulator: FIRESTORE_EMULATOR_HOST).
 */

import admin from 'firebase-admin';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'gen-lang-client-0643641184';
const FIRESTORE_DB = 'pulse';
const DRY_RUN = process.env.DRY_RUN === 'true';
const OVERWRITE = process.env.OVERWRITE === 'true';

if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('[seedGoLiveConfig] Set GOOGLE_APPLICATION_CREDENTIALS (or FIRESTORE_EMULATOR_HOST).');
  process.exit(1);
}
if (!admin.apps.length) {
  admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST
    ? { projectId: process.env.GCLOUD_PROJECT ?? PROJECT_ID }
    : { credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
}
const db: Firestore = process.env.FIRESTORE_EMULATOR_HOST
  ? getFirestore(admin.app())
  : getFirestore(admin.app(), FIRESTORE_DB);

const MIN = 60_000, HOUR = 3_600_000;

const DOCS: Record<string, Record<string, unknown>> = {
  business_hours: {
    tzOffsetMinutes: 330,          // IST (+5:30, no DST)
    startMinutes: 600,             // 10:00
    endMinutes: 1110,              // 18:30
    workingDows: [1, 2, 3, 4, 5, 6],   // Mon–Sat (Sun off)
    offSaturdayOrdinals: [1, 2],   // 1st & 2nd Saturdays off
  },
  sla: {
    WARM: { stage1Ms: 15 * MIN, stage2Ms: 30 * MIN },
    COLD: { stage1Ms: 48 * HOUR, stage2Ms: 24 * HOUR },
    MANUAL: { stage1Ms: 0, stage2Ms: 30 * MIN },
    // NO escalationUids — recipients resolve live (active crmRole:'manager' → super-admin fallback).
  },
  queues: {
    queues: [
      { id: 'shared', name: 'Shared', skill: 'GENERAL', productFilter: ['*'] },
    ],
  },
};

async function main() {
  console.log(`[seedGoLiveConfig] DB=${process.env.FIRESTORE_EMULATOR_HOST ? 'emulator' : FIRESTORE_DB}`
    + ` · DRY_RUN=${DRY_RUN} · OVERWRITE=${OVERWRITE}\n`);
  for (const [id, data] of Object.entries(DOCS)) {
    const ref = db.collection('app_config').doc(id);
    const exists = (await ref.get()).exists;
    if (exists && !OVERWRITE) { console.log(`  • app_config/${id}: exists — skipped (create-if-absent)`); continue; }
    if (DRY_RUN) { console.log(`  • app_config/${id}: WOULD ${exists ? 'overwrite' : 'create'} →`, JSON.stringify(data)); continue; }
    await ref.set({ ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: 'go-live-seed' }, { merge: false });
    console.log(`  ✓ app_config/${id}: ${exists ? 'overwritten' : 'created'}`);
  }
  console.log('\nDone. Verify the three docs in the Firebase Console → Firestore → app_config.');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
