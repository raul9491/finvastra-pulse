/**
 * Tests Google Workspace SMTP sending via nodemailer.
 * Run: npx tsx scripts/test/testSmtp.ts
 *
 * Requires .env.local to contain:
 *   SMTP_USER=your@finvastra.com
 *   SMTP_APP_PASSWORD=your-app-password   (Google App Password, 16-char)
 */
import nodemailer from "nodemailer";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";

// Load .env.local if present
try { dotenv.config({ path: ".env.local" }); } catch { /* ok */ }

const user = process.env.SMTP_USER;
const pass = process.env.SMTP_APP_PASSWORD;

if (!user || !pass) {
  console.error("❌  SMTP_USER and SMTP_APP_PASSWORD must be set in .env.local");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user, pass },
});

try {
  await transporter.verify();
  console.log("✅  SMTP connection verified");

  await transporter.sendMail({
    from: `"Finvastra Pulse Test" <${user}>`,
    to: user,          // send to self as a smoke test
    subject: "Pulse SMTP test",
    text: "If you received this, Google Workspace SMTP is configured correctly.",
  });

  console.log(`✅  Test email sent to ${user}`);
} catch (e) {
  console.error("❌  SMTP test failed:", e);
  process.exit(1);
}
