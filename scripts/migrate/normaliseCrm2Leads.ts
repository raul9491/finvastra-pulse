/**
 * One-off migration — normalise EXISTING lead docs to the CRM 2.0 shape (spec §6).
 *
 * STRICTLY ADDITIVE: no old field is removed or renamed; the script only adds
 * the new fields (name/mobile/receivedAt/category/source/status/dupeKeys/…)
 * derived from the legacy ones (displayName/phone/createdAt/leadStatus/source).
 * Docs that already carry `dupeKeys` are skipped (idempotent re-runs).
 *
 * Usage (repo root):
 *   DRY_RUN=true npx tsx scripts/migrate/normaliseCrm2Leads.ts   # report only
 *   npx tsx scripts/migrate/normaliseCrm2Leads.ts                # write
 *
 * Targets the named `pulse` database (or the emulator when
 * FIRESTORE_EMULATOR_HOST is set). Requires GOOGLE_APPLICATION_CREDENTIALS.
 */

import admin from 'firebase-admin';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { buildDupeKeys } from '../../src/lib/crm2/dedupe.js';

const PROJECT_ID   = 'gen-lang-client-0643641184';
const FIRESTORE_DB = 'pulse';
const DRY_RUN      = process.env.DRY_RUN === 'true';

if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('[normaliseCrm2Leads] Set GOOGLE_APPLICATION_CREDENTIALS (or FIRESTORE_EMULATOR_HOST).');
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

// Legacy → spec mappings ------------------------------------------------------

const STATUS_MAP: Record<string, { status: string; dropReason?: string }> = {
  new:            { status: 'NEW' },
  interested:     { status: 'CONTACTED' },
  callback:       { status: 'ATTEMPTED' },
  not_interested: { status: 'NOT_INTERESTED' },
  no_response:    { status: 'DROPPED', dropReason: 'UNREACHABLE' },
  wrong_number:   { status: 'DROPPED', dropReason: 'UNREACHABLE' },
  converted:      { status: 'CONVERTED' },
};

const SOURCE_MAP: Record<string, string> = {
  website: 'WEBSITE',
  walkin: 'WALKIN',
  referral: 'REFERRAL_CLIENT',
  employee_referral: 'REFERRAL_CLIENT',
  broker: 'REFERRAL_SUBDSA',
  instagram: 'ADS',
  facebook: 'ADS',
  social_meta: 'ADS',
  offline_bulk: 'COLD_CALL',
};

async function main() {
  console.log(`Normalising legacy leads → CRM 2.0 shape ${DRY_RUN ? '(DRY RUN — no writes)' : ''}`);
  const snap = await db.collection('leads').get();
  console.log(`${snap.size} lead docs total`);

  let migrated = 0, skipped = 0, errors = 0;
  const statusTally: Record<string, number> = {};
  const sourceTally: Record<string, number> = {};

  for (const doc of snap.docs) {
    const d = doc.data();
    if (Array.isArray(d.dupeKeys)) { skipped++; continue; }   // already migrated / new-model

    try {
      const legacyStatus = String(d.leadStatus ?? 'new');
      const mapped = STATUS_MAP[legacyStatus] ?? { status: 'NEW' };
      const legacySource = String(d.source ?? '');
      const source = SOURCE_MAP[legacySource] ?? 'COLD_CALL';
      const name = String(d.displayName ?? d.name ?? '').trim() || '(unnamed)';
      const mobile = String(d.phone ?? d.mobile ?? '');
      const email = (d.email as string | undefined) ?? null;
      const receivedAt: Timestamp =
        (d.createdAt as Timestamp | undefined) ?? Timestamp.now();

      const fields: Record<string, unknown> = {
        receivedAt,
        category: 'LOAN',                 // legacy CRM is the loan book
        productId: null,
        name, mobile, email,
        city: (d.address as string | undefined)?.split(',').pop()?.trim() ?? null,
        source,
        sourceMeta: { formId: null, sourceUrl: null, utm: null },
        amountRequired: null,
        referredById: null, referredByType: null,
        assignedRm: null,                 // legacy ownership stays in primaryOwnerId (uid)
        assignedAt: null,
        status: mapped.status,
        priority: 'WARM',
        nextFollowUpAt: (d.callbackAt ? Timestamp.fromDate(new Date(d.callbackAt as string)) : null),
        attempts: 0,
        activityLog: [],
        dropReason: mapped.dropReason ?? null,
        converted: mapped.status === 'CONVERTED',
        convertedAt: null,
        linkedClientId: null, linkedCaseId: null, linkedSubDsaId: null,
        duplicateOfLeadId: null,
        dupeKeys: buildDupeKeys(mobile, email),
      };

      statusTally[`${legacyStatus} → ${mapped.status}`] = (statusTally[`${legacyStatus} → ${mapped.status}`] ?? 0) + 1;
      sourceTally[`${legacySource || '(none)'} → ${source}`] = (sourceTally[`${legacySource || '(none)'} → ${source}`] ?? 0) + 1;

      if (!DRY_RUN) await doc.ref.update(fields);
      migrated++;
      if (migrated <= 3) {
        console.log(`  ${DRY_RUN ? '[dry] ' : ''}${doc.id}: "${name}" ${legacyStatus}→${mapped.status} ${legacySource}→${source} keys=${JSON.stringify(fields.dupeKeys)}`);
      }
    } catch (e) {
      errors++;
      console.error(`  ✗ ${doc.id}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`\n${migrated} migrated, ${skipped} skipped (already have dupeKeys), ${errors} errors`);
  console.log('Status mappings:', statusTally);
  console.log('Source mappings:', sourceTally);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
