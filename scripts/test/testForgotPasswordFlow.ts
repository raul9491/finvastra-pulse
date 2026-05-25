/**
 * Tests the full forgot-password server flow locally — without sending an email.
 * Run: npx tsx scripts/test/testForgotPasswordFlow.ts
 *
 * This mimics exactly what server.ts does in the forgot-password endpoint.
 * If generatePasswordResetLink fails, we'll see the real error here.
 */
import admin from "firebase-admin";
import { readFileSync, readdirSync } from "fs";

const keyPath = (() => {
  const dir = "C:/Users/raul9/Downloads";
  const f = readdirSync(dir).find(n => n.includes("firebase-adminsdk") || n.includes("service-account"));
  if (f) return `${dir}/${f}`;
  throw new Error("Service account key not found");
})();

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, "utf-8"))),
});

const EMAILS = ["rahulv@finvastra.com", "kalyan@finvastra.com"];

async function main() {
  for (const email of EMAILS) {
    console.log(`\n─── Testing: ${email} ───`);
    try {
      const userRecord = await admin.auth().getUserByEmail(email.trim());
      console.log(`  UID: ${userRecord.uid}`);
      console.log(`  Disabled: ${userRecord.disabled}`);

      if (userRecord.disabled) {
        console.log(`  → Skipped: account is disabled`);
        continue;
      }

      console.log(`  Generating password reset link (no continueUrl)...`);
      const firebaseLink = await admin.auth().generatePasswordResetLink(email.trim());
      console.log(`  Firebase link: ${firebaseLink}`);

      const oobCode = new URL(firebaseLink).searchParams.get("oobCode");
      console.log(`  oobCode: ${oobCode ? `✅ Found (${oobCode.slice(0, 20)}...)` : `❌ MISSING — this is the bug`}`);

      if (oobCode) {
        const resetLink =
          `https://pulse.finvastra.com/auth-action?mode=resetPassword` +
          `&oobCode=${encodeURIComponent(oobCode)}`;
        console.log(`  Reset link would be: ${resetLink.slice(0, 80)}...`);
        console.log(`  ✅ Flow would succeed — email would be sent to ${email}`);
      }
    } catch (e) {
      const err = e as { code?: string; message?: string };
      console.log(`  ❌ ERROR: ${err.code ?? "unknown"} — ${err.message ?? String(e)}`);
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
