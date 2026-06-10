/**
 * Smoke-tests that super admin protection is enforced in production.
 *
 * Run: npx tsx scripts/test/verifySuperAdminProtection.ts
 *
 * Tests (5 total):
 *  1. Unauthenticated deactivate request          → 401 Unauthorized
 *  2. Deactivate a super admin (Ajay) as Rahul    → 403 "cannot be deactivated"
 *  3. Deactivate a fake non-SA UID (bad body)     → 400 "lastWorkingDate required"
 *     (proves the SA guard was passed correctly)
 *  4. Sync-claims for SA (Ajay) BY SA (Rahul)     → 200 OK
 *     (super admins CAN modify each other)
 *  5. Sync-claims for SA (Ajay) by a non-admin    → 403 "Admin only"
 *     (proves the admin check fires before the SA check reaches)
 *
 * Requires: service account key in C:/Users/raul9/Downloads/
 */

import admin from "firebase-admin";
import { readFileSync, readdirSync } from "fs";
import { getFirestore } from "firebase-admin/firestore";

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const keyPath = (() => {
  const dir = "C:/Users/raul9/Downloads";
  const f = readdirSync(dir).find(
    (n) => n.includes("firebase-adminsdk") || n.includes("service-account")
  );
  if (f) return `${dir}/${f}`;
  throw new Error("Service account key not found in C:/Users/raul9/Downloads/");
})();

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, "utf-8"))),
});

const db = getFirestore(
  admin.app(),
  "pulse"
);

const WEB_API_KEY  = "AIzaSyCuBO87GMVEDWOsYLlARkfo8BKRPtwJyzw";
const BASE_URL     = "https://pulse.finvastra.com";

// ─── Super admin UIDs (must match hrmsConfig.ts + Cloud Run env var) ──────────

const SUPER_ADMIN_UIDS = [
  "3zdX5QBnTbQAcTdLzUjfXxefP8r2",  // Ajay Newatia (FAPL-000)
  "ZmZaciATPDYBb1O2blYWBjjbzMv1",  // Kumar Mangalam (FAPL-003)
  "5lAbJ4CZ5uM0LbU4gUYItNRAlEn2",  // Rahul Vijay Wargia (FAPL-022)
];

const AJAY_UID  = SUPER_ADMIN_UIDS[0];
const RAHUL_UID = SUPER_ADMIN_UIDS[2];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Get an ID token for a given UID via Admin SDK custom token exchange */
async function getIdTokenForUid(uid: string): Promise<string> {
  const customToken = await admin.auth().createCustomToken(uid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const data = await res.json() as { idToken?: string; error?: { message: string } };
  if (data.error) throw new Error(`Token exchange failed for ${uid}: ${data.error.message}`);
  if (!data.idToken) throw new Error(`No idToken returned for ${uid}`);
  return data.idToken;
}

type TestResult = { pass: boolean; label: string; detail: string };

function pass(label: string, detail: string): TestResult {
  return { pass: true, label, detail };
}
function fail(label: string, detail: string): TestResult {
  return { pass: false, label, detail };
}

// ─── Individual tests ─────────────────────────────────────────────────────────

/** Test 1: Unauthenticated deactivate → 401 */
async function test1_unauthenticated(): Promise<TestResult> {
  const label = "1. Unauthenticated deactivate → 401";
  const res = await fetch(`${BASE_URL}/api/admin/employees/${AJAY_UID}/deactivate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lastWorkingDate: "2026-05-31", exitReason: "resigned" }),
  });
  if (res.status === 401) {
    return pass(label, `Got ${res.status} ✓`);
  }
  const body = await res.json().catch(() => ({}));
  return fail(label, `Expected 401, got ${res.status} — ${JSON.stringify(body)}`);
}

/** Test 2: Deactivate a super admin as Rahul (super admin) → 403
 *
 *  SAFETY: We target Kumar (SA[1]) via a request made by Rahul (SA[2]).
 *  If the guard is missing and the request accidentally succeeds (200), we
 *  immediately detect the response code, report failure, and the caller
 *  should run _restoreKumar.ts.  We do NOT target Ajay (SA[0]) here because
 *  Ajay is the Co-Founder; the blast radius of an accidental deactivation is
 *  highest for that account.  Kumar's account is used as the test target
 *  because both SA accounts have identical protection semantics.
 */
async function test2_deactivateSuperAdmin(rahulToken: string): Promise<TestResult> {
  const KUMAR_UID = SUPER_ADMIN_UIDS[1]; // Kumar Mangalam (FAPL-003)
  const label = "2. Deactivate Kumar (super admin) as Rahul → 403";
  const res = await fetch(`${BASE_URL}/api/admin/employees/${KUMAR_UID}/deactivate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${rahulToken}`,
    },
    body: JSON.stringify({
      lastWorkingDate: "2099-12-31",     // far-future date — obviously a test
      exitReason:      "resigned",
      notes:           "smoke-test — MUST be blocked by super admin guard",
    }),
  });
  const body = await res.json().catch(() => ({})) as { error?: string };
  if (res.status === 403 && body.error?.toLowerCase().includes("super admin")) {
    return pass(label, `Got 403 — "${body.error}" ✓`);
  }
  // DANGER: if we get here the guard is missing and the request may have gone through.
  // The caller must check and restore Kumar's account immediately.
  return fail(label,
    `Expected 403 with SA message, got ${res.status} — ${JSON.stringify(body)}\n` +
    `       ⚠️  If status was 200, run: npx tsx scripts/test/_restoreKumar.ts`
  );
}

/** Test 3: Deactivate a non-SA fake UID with missing body fields → 400
 *  This proves the SA guard was passed (the UID is not a super admin),
 *  and the request only fails on input validation. */
async function test3_deactivateNonSA(rahulToken: string): Promise<TestResult> {
  const label = "3. Deactivate fake non-SA UID with no body → 400 (SA check passed)";
  const FAKE_NON_SA_UID = "fake-employee-uid-000";
  const res = await fetch(`${BASE_URL}/api/admin/employees/${FAKE_NON_SA_UID}/deactivate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${rahulToken}`,
    },
    body: JSON.stringify({}), // intentionally missing lastWorkingDate + exitReason
  });
  const body = await res.json().catch(() => ({})) as { error?: string };
  if (res.status === 400 && body.error?.toLowerCase().includes("lastworkingdate")) {
    return pass(label, `Got 400 — "${body.error}" ✓ (SA guard passed, hit validation)`);
  }
  return fail(label, `Expected 400 validation error, got ${res.status} — ${JSON.stringify(body)}`);
}

/** Test 4: Sync-claims for Ajay (SA) by Rahul (SA) → 200
 *  Proves that super admins CAN update each other's claims. */
async function test4_syncClaimsSABySA(rahulToken: string): Promise<TestResult> {
  const label = "4. Sync-claims for Ajay (SA) by Rahul (SA) → 200";
  const res = await fetch(`${BASE_URL}/api/admin/users/${AJAY_UID}/sync-claims`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${rahulToken}`,
    },
  });
  const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
  if (res.status === 200 && body.ok === true) {
    return pass(label, `Got 200 — ok:true ✓ (super admin CAN modify super admin)`);
  }
  return fail(label, `Expected 200, got ${res.status} — ${JSON.stringify(body)}`);
}

/** Test 5: Sync-claims for Ajay (SA) by a non-admin employee → 403 "Admin only"
 *  Finds the first non-admin, non-SA employee from Firestore and uses their token. */
async function test5_syncClaimsByNonAdmin(): Promise<TestResult> {
  const label = "5. Sync-claims for Ajay (SA) by non-admin employee → 403";

  // Find a non-admin, non-SA employee
  const snap = await db
    .collection("users")
    .where("role", "==", "employee")
    .limit(5)
    .get();

  const target = snap.docs
    .map((d) => d.id)
    .find((uid) => !SUPER_ADMIN_UIDS.includes(uid));

  if (!target) {
    return fail(label, "Could not find a non-admin employee in Firestore to use as caller");
  }

  let nonAdminToken: string;
  try {
    nonAdminToken = await getIdTokenForUid(target);
  } catch (e) {
    return fail(label, `Could not get token for employee ${target}: ${e}`);
  }

  const res = await fetch(`${BASE_URL}/api/admin/users/${AJAY_UID}/sync-claims`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${nonAdminToken}`,
    },
  });
  const body = await res.json().catch(() => ({})) as { error?: string };
  if (res.status === 403) {
    return pass(label, `Got 403 — "${body.error ?? '(no message)'}" ✓ (employee caller blocked)`);
  }
  return fail(label, `Expected 403, got ${res.status} — ${JSON.stringify(body)}`);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   Super Admin Protection — Production Smoke Test    ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\nTarget: ${BASE_URL}`);
  console.log(`Super admin UIDs: ${SUPER_ADMIN_UIDS.join(", ")}\n`);

  // Get Rahul's ID token (used for tests 2–4 as the authenticated admin caller)
  process.stdout.write("Getting ID token for Rahul (super admin)… ");
  const rahulToken = await getIdTokenForUid(RAHUL_UID);
  console.log("✓\n");

  // Run all tests
  const results: TestResult[] = [
    await test1_unauthenticated(),
    await test2_deactivateSuperAdmin(rahulToken),
    await test3_deactivateNonSA(rahulToken),
    await test4_syncClaimsSABySA(rahulToken),
    await test5_syncClaimsByNonAdmin(),
  ];

  // Print results
  console.log("─────────────────────────────────────────────────────────");
  for (const r of results) {
    const icon = r.pass ? "✅" : "❌";
    console.log(`${icon}  ${r.label}`);
    console.log(`       ${r.detail}`);
  }

  const passed = results.filter((r) => r.pass).length;
  const total  = results.length;

  console.log("─────────────────────────────────────────────────────────");
  console.log(`\n${passed === total ? "✅" : "❌"}  ${passed} / ${total} tests passed`);

  if (passed < total) {
    const failures = results.filter((r) => !r.pass).map((r) => `  • ${r.label}`).join("\n");
    console.log(`\nFailed tests:\n${failures}`);
    process.exit(1);
  }

  console.log("\nAll protections verified — Cloud Run is enforcing super admin rules.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n💥 Script error:", e);
  process.exit(1);
});
