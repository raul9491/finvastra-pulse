/**
 * Calls the admin-only /api/auth/debug-gmail endpoint on Cloud Run.
 * This exposes the actual Gmail DWD error (unlike forgot-password which swallows errors).
 * Run: npx tsx scripts/test/debugGmailCloudRun.ts
 *
 * Requires: service account key in C:/Users/raul9/Downloads/
 * The script signs in as rahulv@finvastra.com via Firebase REST API to get an ID token.
 */
import admin from "firebase-admin";
import { readFileSync, readdirSync } from "fs";

// Load service account key
const keyPath = (() => {
  const dir = "C:/Users/raul9/Downloads";
  const f = readdirSync(dir).find(n => n.includes("firebase-adminsdk") || n.includes("service-account"));
  if (f) return `${dir}/${f}`;
  throw new Error("Service account key not found");
})();

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, "utf-8"))),
});

// Firebase project Web API key (from firebase-applet-config.json)
const WEB_API_KEY = "AIzaSyCuBO87GMVEDWOsYLlARkfo8BKRPtwJyzw";
// Use Firebase Hosting URL — it rewrites /api/** to Cloud Run
const CLOUD_RUN_URL = "https://pulse.finvastra.com";

async function getIdToken(email: string, password: string): Promise<string> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json() as { idToken?: string; error?: { message: string } };
  if (data.error) throw new Error(`Firebase sign-in failed: ${data.error.message}`);
  if (!data.idToken) throw new Error("No idToken in response");
  return data.idToken;
}

async function main() {
  console.log("Getting ID token for rahulv@finvastra.com ...");

  // Use admin SDK to create a custom token, then exchange for ID token
  const customToken = await admin.auth().createCustomToken("5lAbJ4CZ5uM0LbU4gUYItNRAlEn2"); // rahulv UID

  // Exchange custom token for ID token via Firebase REST API
  const exchangeRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const exchangeData = await exchangeRes.json() as { idToken?: string; error?: { message: string } };
  if (exchangeData.error) throw new Error(`Token exchange failed: ${exchangeData.error.message}`);
  if (!exchangeData.idToken) throw new Error("No idToken from exchange");

  const idToken = exchangeData.idToken;
  console.log("✓ Got ID token");

  // Now call the debug endpoint on Cloud Run
  const cloudRunUrl = `${CLOUD_RUN_URL}/api/auth/debug-gmail`;
  console.log(`\nCalling: POST ${cloudRunUrl}`);

  const debugRes = await fetch(cloudRunUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify({}),
  });

  const debugData = await debugRes.json();
  console.log("\n=== Debug endpoint response ===");
  console.log(JSON.stringify(debugData, null, 2));

  if (debugData.ok) {
    console.log("\n✅ Gmail DWD is WORKING on Cloud Run!");
    console.log(`   Message ID: ${debugData.messageId}`);
    console.log(`   Sent from:  ${debugData.sender}`);
    console.log(`   SA email:   ${debugData.sa}`);
  } else {
    console.log("\n❌ Gmail DWD FAILED on Cloud Run");
    console.log(`   Error: ${debugData.error}`);
    if (debugData.details) {
      console.log(`   Details: ${JSON.stringify(debugData.details, null, 2)}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error("Script error:", e); process.exit(1); });
