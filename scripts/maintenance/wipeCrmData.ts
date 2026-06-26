/**
 * ONE-OFF DESTRUCTIVE MAINTENANCE — wipe CRM customers / leads / cases for a fresh start.
 *
 * Approved scope (full clean slate, 2026-06-25): delete EVERY document in
 *   • leads        — old "Customers" + CRM 2.0 "Leads" (+ all subcollections:
 *                    opportunities/*, activities, whatsapp, field_history, …)
 *   • cases        — (+ applicants, docTracker, stageHistory, logins, private/payout,
 *                    tasks, field_history)
 *   • clients      — FCL-/CL- client master (+ vaultDocs)
 *   • payoutCycles — money cycles derived from disbursed logins
 *   • misRecords   — MIS rows derived from disbursals
 *   • import_jobs  — bulk-import provenance (incl. the "Unity" batch)
 *
 * NEVER touches: masters (aggregators, lenders, products, subProducts, dsaCodeMappings,
 * documentMaster), connectors, users, HRMS/MIS config, counters, or anything else.
 * Counters are LEFT INTACT on purpose — fresh data keeps incrementing (LD-2026-0000N+1),
 * so no id is ever reused/collided. Reset them only as a separate, deliberate step.
 *
 * SAFE BY DEFAULT: dry run unless `--confirm` is passed. Recurses all subcollections.
 *
 * Usage (repo root, on the maintainer's machine — needs prod credentials):
 *   1. TAKE A BACKUP FIRST (managed export):
 *        gcloud firestore export gs://gen-lang-client-0643641184-fs-backup/wipe-$(date +%F) \
 *          --database=pulse
 *      (7-day point-in-time recovery is also enabled as a second safety net.)
 *   2. Dry run — prints exact per-collection counts, deletes NOTHING:
 *        set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
 *        npx tsx scripts/maintenance/wipeCrmData.ts
 *   3. Review the counts, then actually delete:
 *        npx tsx scripts/maintenance/wipeCrmData.ts --confirm
 */

import admin from 'firebase-admin';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const PROJECT_ID   = 'gen-lang-client-0643641184';
const FIRESTORE_DB = 'pulse';
const CONFIRM      = process.argv.includes('--confirm');

// EXACTLY the collections approved for the wipe. Nothing else is ever touched.
const TARGETS = ['leads', 'cases', 'clients', 'payoutCycles', 'misRecords', 'import_jobs'] as const;

// Recon / log collections that REFERENCE the above but are out of the approved scope.
// Reported (counts only) so the maintainer can decide — never deleted by this script.
const OUT_OF_SCOPE = [
  'bankMisImports', 'reconSnapshots', 'meta_lead_events', 'meta_lead_deadletters',
  'whatsapp_message_events', 'whatsapp_message_deadletters', 'lead_view_logs', 'crm2_reminder_logs',
] as const;

if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('[wipeCrmData] Set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON (or FIRESTORE_EMULATOR_HOST for the emulator).');
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

const count = async (name: string): Promise<number> => {
  try { return (await db.collection(name).count().get()).data().count; }
  catch { return -1; }
};

async function main() {
  const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  CRM DATA WIPE — customers / leads / cases (full clean slate)');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Project : ${PROJECT_ID}`);
  console.log(`  Database: ${onEmulator ? 'EMULATOR' : FIRESTORE_DB}`);
  console.log(`  Mode    : ${CONFIRM ? '🔴 LIVE DELETE (--confirm)' : '🟢 DRY RUN (no deletes)'}`);
  console.log('──────────────────────────────────────────────────────────────');

  // Per-collection top-level counts (subcollections are deleted too, not counted here).
  console.log('  In scope (will be DELETED — top-level doc counts):');
  let total = 0;
  for (const c of TARGETS) {
    const n = await count(c);
    total += Math.max(0, n);
    console.log(`    • ${c.padEnd(14)} ${n < 0 ? '(error reading)' : n} doc(s)${n > 0 ? ' + their subcollections' : ''}`);
  }
  console.log(`    ─ total top-level docs: ${total}`);

  console.log('\n  Out of scope (LEFT ALONE — counts shown so you can decide separately):');
  for (const c of OUT_OF_SCOPE) {
    const n = await count(c);
    if (n !== 0) console.log(`    • ${c.padEnd(26)} ${n < 0 ? '(error reading)' : n} doc(s)`);
  }
  console.log('  Masters / connectors / users / counters / HRMS / MIS config: NOT touched.');
  console.log('──────────────────────────────────────────────────────────────');

  if (!CONFIRM) {
    console.log('  DRY RUN — nothing deleted. Re-run with --confirm to delete.');
    console.log('  (Take a `gcloud firestore export` backup first.)\n');
    return;
  }

  console.log('  🔴 LIVE DELETE starting in 5s — press Ctrl+C to abort…\n');
  await new Promise((r) => setTimeout(r, 5000));

  for (const c of TARGETS) {
    process.stdout.write(`  Deleting ${c} (recursive)… `);
    // recursiveDelete on a CollectionReference removes every doc + all nested subcollections.
    await db.recursiveDelete(db.collection(c));
    const left = await count(c);
    console.log(left === 0 ? 'done ✓' : `done (re-count: ${left})`);
  }

  console.log('\n  ✅ Wipe complete. Customers, Leads, Cases and their derived records are empty.');
  console.log('  Counters were left intact — fresh uploads keep incrementing ids safely.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error('\n[wipeCrmData] FAILED:', e); process.exit(1); });
