/**
 * Checks the Firebase Auth provider type for each @finvastra.com employee.
 * Run: npx tsx scripts/test/checkAuthProviders.ts
 *
 * This shows whether each account is email/password or Google OAuth.
 * generatePasswordResetLink() only works for email/password accounts.
 */
import admin from "firebase-admin";
import { readFileSync, readdirSync } from "fs";

// Find and load the service account key
const keyPath = (() => {
  const dir = "C:/Users/raul9/Downloads";
  const f = readdirSync(dir).find(n => n.includes("firebase-adminsdk") || n.includes("service-account"));
  if (f) return `${dir}/${f}`;
  throw new Error("Service account key not found");
})();

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, "utf-8"))),
  databaseURL: `https://gen-lang-client-0643641184.firebaseio.com`,
});

const EMAILS = [
  "rahulv@finvastra.com",
  "kalyan@finvastra.com",
];

async function main() {
  console.log("\nChecking Firebase Auth providers for each account:\n");
  for (const email of EMAILS) {
    try {
      const user = await admin.auth().getUserByEmail(email);
      const providers = user.providerData.map(p => p.providerId);
      const canReset  = providers.includes("password");
      console.log(`${email}`);
      console.log(`  UID:       ${user.uid}`);
      console.log(`  Disabled:  ${user.disabled}`);
      console.log(`  Providers: ${providers.join(", ") || "(none)"}`);
      console.log(`  Can reset password: ${canReset ? "✅ YES" : "❌ NO — not an email/password account"}`);
      console.log();
    } catch (e) {
      console.log(`${email}: NOT FOUND in Firebase Auth\n`);
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
