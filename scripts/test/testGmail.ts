/**
 * Quick test — runs the Gmail DWD send directly from your local machine.
 * Usage:  npx tsx scripts/test/testGmail.ts
 *
 * Sends a test email to rahulv@finvastra.com via admin@finvastra.com.
 * Look for errors here to diagnose DWD setup issues.
 */
import { google } from "googleapis";
import { JWT }    from "google-auth-library";
import path       from "path";
import fs         from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Find the service account key
const keyFile = (() => {
  const candidates = [
    path.resolve(__dirname, "../../gen-lang-client-0643641184-firebase-adminsdk-fbsvc-04fbf4c625.json"),
    "C:/Users/raul9/Downloads/gen-lang-client-0643641184-firebase-adminsdk-fbsvc-04fbf4c625.json",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("Service account key not found");
})();

const SENDER = "admin@finvastra.com";
const TEST_TO = "rahulv@finvastra.com";

async function main() {
  console.log("Key file:", keyFile);
  console.log("Sender (DWD subject):", SENDER);

  const keyData = JSON.parse(fs.readFileSync(keyFile, "utf-8")) as { client_email: string; private_key: string };
  const auth = new JWT({
    email:   keyData.client_email,
    key:     keyData.private_key,
    scopes:  ["https://www.googleapis.com/auth/gmail.send"],
    subject: SENDER,
  });

  console.log("Authorising JWT...");
  await auth.authorize();
  console.log("✓ JWT authorised");

  const gmail = google.gmail({ version: "v1", auth });

  const subject  = "Finvastra Pulse — Gmail DWD test";
  const htmlBody = "<h2>Test email from Finvastra Pulse</h2><p>If you see this, Gmail domain-wide delegation is working correctly.</p>";

  const raw = [
    `From: Finvastra Pulse <${SENDER}>`,
    `To: ${TEST_TO}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    htmlBody,
  ].join("\r\n");

  const encoded = Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  console.log("Sending email...");
  const result = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });

  console.log("✓ Email sent! Message ID:", result.data.id);
}

main().catch((err) => {
  console.error("✗ FAILED:", err.message ?? err);
  if (err.response?.data) {
    console.error("API error details:", JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
