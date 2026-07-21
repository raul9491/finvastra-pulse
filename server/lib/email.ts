/**
 * server/lib/email.ts - Gmail (domain-wide-delegation) send + branded HTML email
 * templates + Calendar DWD client + the app_config notification on/off toggles,
 * lifted from server.ts (2026-07-21, Phase 3). getGmailClient/sendGmailMessage/
 * sendGmailWithAttachment (Gmail API), buildBrandEmail/buildPasswordResetEmail/
 * escapeHtml/encodeEmailSubject (templates), getCalendarClient (meetings), and
 * notificationsEnabled (60s-cached gate). Pure move - behavior unchanged.
 */
import fs from "fs";
import { google } from "googleapis";
import { JWT } from "google-auth-library";
import { db, useEmulator } from "../db.js";
import { getServiceAccountPath } from "./imports.js";

// ─── Gmail helper ─────────────────────────────────────────────────────────────
// Builds a Gmail API client using domain-wide delegation so the server can send
// email as admin@finvastra.com without storing a password.
// Local dev:  uses the service-account JSON key found by getServiceAccountPath()
// Cloud Run:  uses GOOGLE_SA_JSON_BASE64 env var (base64 of the same JSON key)
async function getGmailClient() {
  const senderEmail = process.env.GMAIL_SENDER ?? "admin@finvastra.com";
  let authClient: JWT;

  if (process.env.GOOGLE_SA_JSON_BASE64) {
    const keyData = JSON.parse(
      Buffer.from(process.env.GOOGLE_SA_JSON_BASE64, "base64").toString("utf-8")
    ) as { client_email: string; private_key: string };
    authClient = new JWT({
      email:   keyData.client_email,
      key:     keyData.private_key,
      scopes:  ["https://www.googleapis.com/auth/gmail.send"],
      subject: senderEmail,
    });
  } else {
    const keyFile = getServiceAccountPath();
    if (!keyFile) throw new Error("No service-account key available for Gmail DWD");
    const keyData = JSON.parse(fs.readFileSync(keyFile, "utf-8")) as { client_email: string; private_key: string };
    authClient = new JWT({
      email:   keyData.client_email,
      key:     keyData.private_key,
      scopes:  ["https://www.googleapis.com/auth/gmail.send"],
      subject: senderEmail,
    });
  }
  return google.gmail({ version: "v1", auth: authClient });
}

// ─── Calendar helper ──────────────────────────────────────────────────────────
// Builds a Google Calendar client via the SAME domain-wide-delegation service
// account as Gmail, but impersonating the RM (subjectEmail) so the event lands on
// THAT rep's own Workspace calendar. Requires the Workspace admin to authorise the
// scope https://www.googleapis.com/auth/calendar.events for the SA's client id.
function getCalendarClient(subjectEmail: string) {
  let keyData: { client_email: string; private_key: string };
  if (process.env.GOOGLE_SA_JSON_BASE64) {
    keyData = JSON.parse(Buffer.from(process.env.GOOGLE_SA_JSON_BASE64, "base64").toString("utf-8"));
  } else {
    const keyFile = getServiceAccountPath();
    if (!keyFile) throw new Error("No service-account key available for Calendar DWD");
    keyData = JSON.parse(fs.readFileSync(keyFile, "utf-8"));
  }
  const authClient = new JWT({
    email:   keyData.client_email,
    key:     keyData.private_key,
    scopes:  ["https://www.googleapis.com/auth/calendar.events"],
    subject: subjectEmail,
  });
  return google.calendar({ version: "v3", auth: authClient });
}

// Sends an HTML email via the Gmail API (domain-wide delegation).
// Falls back to console.log when the SA key is not configured (emulator mode).
// RFC 2047-encode the Subject header so non-ASCII (em-dash, emoji, accents) is
// never mangled into mojibake (e.g. "—" → "Ã¢Â€Â"") by the receiving client.
const encodeEmailSubject = (s: string) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

// ─── Automated-notification on/off switches ───────────────────────────────
// Global toggles per automated notification, stored in app_config/notification_settings
// and managed on the super-admin Notifications settings page. Default ENABLED unless a
// key is explicitly `false`. Cached 60s so a burst of scheduled jobs doesn't re-read.
let _notifCache: { at: number; data: Record<string, boolean> } | null = null;

async function notificationsEnabled(key: string): Promise<boolean> {
  const now = Date.now();
  if (!_notifCache || now - _notifCache.at > 60_000) {
    try {
      const snap = await db.collection("app_config").doc("notification_settings").get();
      _notifCache = { at: now, data: (snap.data() ?? {}) as Record<string, boolean> };
    } catch { _notifCache = { at: now, data: {} }; }
  }
  return _notifCache.data[key] !== false;   // absent/true = on; only explicit false disables
}

async function sendGmailMessage(to: string, subject: string, htmlBody: string) {
  const senderEmail  = process.env.GMAIL_SENDER ?? "admin@finvastra.com";
  const senderName   = "Finvastra Pulse";

  if (useEmulator && !process.env.GOOGLE_SA_JSON_BASE64 && !getServiceAccountPath()) {
    console.log(`[Gmail stub] To: ${to} | Subject: ${subject}`);
    return;
  }

  const raw = [
    `From: ${senderName} <${senderEmail}>`,
    `To: ${to}`,
    `Subject: ${encodeEmailSubject(subject)}`,
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

  const gmail = await getGmailClient();
  await gmail.users.messages.send({ userId: "me", requestBody: { raw: encoded } });
}

// Branded HTML email template for password reset.
function buildPasswordResetEmail(displayName: string, resetLink: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F2EFE7;font-family:'DM Sans',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2EFE7;padding:32px 0;">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

    <!-- Header -->
    <tr><td style="background:linear-gradient(135deg,#0B1538 0%,#1B2A4E 100%);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;">
      <img src="https://pulse.finvastra.com/favicon.png" alt="Finvastra" width="64" height="64"
        style="border-radius:12px;object-fit:contain;display:block;margin:0 auto 12px;" />
      <div style="color:#C9A961;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">FINVASTRA PULSE</div>
    </td></tr>

    <!-- Body -->
    <tr><td style="background:#ffffff;padding:40px;">
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#0A0A0A;margin:0 0 8px 0;">
        Reset your password
      </h1>
      <p style="font-size:15px;color:#2A2A2A;line-height:1.7;margin:0 0 8px 0;">Hi ${displayName},</p>
      <p style="font-size:15px;color:#2A2A2A;line-height:1.7;margin:0 0 28px 0;">
        We received a request to reset your Finvastra Pulse password. Click the button below —
        you'll be asked to verify your date of birth before setting a new password.
      </p>

      <!-- CTA -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td align="center" style="padding:0 0 32px 0;">
          <a href="${resetLink}"
            style="display:inline-block;background:linear-gradient(135deg,#0B1538,#1B2A4E);color:#C9A961;
                   padding:14px 44px;border-radius:12px;text-decoration:none;font-weight:700;
                   font-size:15px;letter-spacing:0.5px;">
            Reset my password &rarr;
          </a>
        </td></tr>
      </table>

      <div style="border-top:1px solid #E2E8F0;padding-top:20px;">
        <p style="font-size:13px;color:#8B8B85;line-height:1.6;margin:0 0 8px 0;">
          &#9200; This link expires in <strong>1 hour</strong>.
        </p>
        <p style="font-size:13px;color:#8B8B85;line-height:1.6;margin:0;">
          If you didn&rsquo;t request a password reset, you can safely ignore this email &mdash; your password won&rsquo;t change.
        </p>
      </div>
    </td></tr>

    <!-- Footer -->
    <tr><td style="background:#F2EFE7;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
      <p style="font-size:12px;color:#8B8B85;margin:0 0 4px 0;">Finvastra Financial Services Pvt. Ltd.</p>
      <p style="font-size:11px;color:#8B8B85;margin:0;">Access restricted to Finvastra team members only.</p>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
}

// Branded HTML email (navy/gold) — server-side builder (no client buildHrEmailHtml available here).
// Escape user-controlled plain-text before interpolating into email HTML,
// so a value like "<script>" can't inject markup into the branded template.
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildBrandEmail(opts: { title: string; intro: string; rows: Array<{ label: string; value: string }>; note?: string; ctaLabel?: string; ctaLink?: string }): string {
  // title / intro / row label+value / note are caller-supplied plain text — escape them.
  // ctaLink / ctaLabel are system-built (never caller HTML) and left as-is.
  const rowsHtml = opts.rows.map((r) =>
    `<tr><td style="padding:6px 0;color:#8B8B85;font-size:13px;">${escapeHtml(r.label)}</td><td style="padding:6px 0;color:#0A0A0A;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(r.value)}</td></tr>`).join("");
  const noteHtml = opts.note
    ? `<div style="margin-top:20px;padding:14px 16px;background:#FAF6EC;border-left:3px solid #C9A961;border-radius:8px;color:#2A2A2A;font-size:14px;"><strong>Priority:</strong> ${escapeHtml(opts.note)}</div>` : "";
  const ctaHtml = opts.ctaLink
    ? `<table width="100%"><tr><td align="center" style="padding-top:24px;"><a href="${opts.ctaLink}" style="display:inline-block;background:linear-gradient(135deg,#0B1538,#1B2A4E);color:#C9A961;padding:12px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">${opts.ctaLabel ?? "Open"} &rarr;</a></td></tr></table>` : "";
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F2EFE7;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#F2EFE7;padding:32px 0;"><tr><td align="center"><table width="600" style="max-width:600px;width:100%;"><tr><td style="background:#ffffff;border-radius:16px 16px 0 0;padding:26px 40px 18px;text-align:center;border-bottom:3px solid #C9A961;"><img src="https://pulse.finvastra.com/images/logo-finvastra.png" alt="Finvastra" width="150" style="display:block;width:150px;max-width:60%;height:auto;border:0;margin:0 auto;"/></td></tr><tr><td style="background:#fff;padding:36px 40px;"><h1 style="font-family:Georgia,serif;font-size:22px;color:#0A0A0A;margin:0 0 6px;">${escapeHtml(opts.title)}</h1><p style="font-size:14px;color:#2A2A2A;margin:0 0 18px;">${escapeHtml(opts.intro)}</p><table width="100%" style="border-collapse:collapse;">${rowsHtml}</table>${noteHtml}${ctaHtml}</td></tr><tr><td style="padding:18px 40px;text-align:center;color:#8B8B85;font-size:11px;">Finvastra Advisors Pvt. Ltd. &middot; Finvastra Pulse</td></tr></table></td></tr></table></body></html>`;
}

// Send a branded email WITH a PDF attachment (multipart MIME via Gmail API).
async function sendGmailWithAttachment(to: string, subject: string, htmlBody: string, attachment: { filename: string; base64: string }) {
  const senderEmail = process.env.GMAIL_SENDER ?? "admin@finvastra.com";
  if (useEmulator && !process.env.GOOGLE_SA_JSON_BASE64 && !getServiceAccountPath()) {
    console.log(`[Gmail stub w/attach] To: ${to} | Subject: ${subject} | File: ${attachment.filename}`);
    return;
  }
  const boundary = "fvbnd_" + Math.random().toString(36).slice(2);
  const raw = [
    `From: Finvastra Pulse <${senderEmail}>`, `To: ${to}`, `Subject: ${encodeEmailSubject(subject)}`,
    "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "", htmlBody, "",
    `--${boundary}`, `Content-Type: application/pdf; name="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${attachment.filename}"`, "",
    attachment.base64, "", `--${boundary}--`,
  ].join("\r\n");
  const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const gmail = await getGmailClient();
  await gmail.users.messages.send({ userId: "me", requestBody: { raw: encoded } });
}

export { getGmailClient, getCalendarClient, encodeEmailSubject, notificationsEnabled, sendGmailMessage, buildPasswordResetEmail, escapeHtml, buildBrandEmail, sendGmailWithAttachment };
