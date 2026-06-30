/**
 * notifications.ts — shared helpers for in-app and email notifications.
 *
 * In-app schema: /notifications/{uid}/items/{itemId}
 *   type:      NotificationType
 *   title:     string   — short heading
 *   body:      string   — one-line summary
 *   link?:     string   — route to navigate on click
 *   read:      boolean
 *   createdAt: Timestamp
 *
 * Email is delivered via POST /api/hrms/notify/email (server handles SMTP).
 * All notification writes are fire-and-forget — callers .catch(() => {}).
 */

import {
  addDoc, collection, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { getAuth } from 'firebase/auth';

export type NotificationType =
  | 'new_lead'
  | 'leave_approved'
  | 'leave_rejected'
  | 'claim_approved'
  | 'claim_rejected'
  | 'claim_paid'
  | 'it_decl_revision'
  | 'it_decl_accepted'
  | 'follow_up_needed'
  // Phase P
  | 'share_granted'
  | 'share_revoked'
  | 'dispute_created'
  // employee → reporting-manager request alerts
  | 'leave_request'
  | 'claim_request'
  | 'attendance_request';

export interface AppNotification {
  id:        string;
  type:      NotificationType;
  title:     string;
  body:      string;
  link?:     string;
  read:      boolean;
  createdAt: unknown;
}

// ─── In-app notification ──────────────────────────────────────────────────────

/**
 * Write a single in-app notification to /notifications/{targetUid}/items.
 * Always call with .catch(() => {}) — must never block the primary action.
 */
export function writeNotification(
  targetUid: string,
  payload: {
    type:  NotificationType;
    title: string;
    body:  string;
    link?: string;
  },
): Promise<void> {
  return addDoc(collection(db, 'notifications', targetUid, 'items'), {
    ...payload,
    read:      false,
    createdAt: serverTimestamp(),
  }).then(() => undefined);
}

// ─── Email notification ───────────────────────────────────────────────────────

const BRAND_HEADER = `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
  <tr><td align="center" style="padding:30px 32px 22px;">
    <img src="https://pulse.finvastra.com/images/logo-finvastra.png" alt="Finvastra"
         width="158" style="display:block;width:158px;max-width:62%;height:auto;border:0;margin:0 auto;" />
  </td></tr>
  <tr><td style="height:3px;line-height:3px;font-size:0;background:#C9A961;">&nbsp;</td></tr>
</table>`;

const BRAND_FOOTER = `
<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:#F2EFE7;border-top:1px solid #e7e2d6;">
  <tr>
    <td style="font-family:'DM Sans',Arial,sans-serif;font-size:11px;color:#8B8B85;
               text-align:center;padding:18px 32px;line-height:1.7;">
      Sent with care by the Finvastra team &middot;
      <a href="https://pulse.finvastra.com" style="color:#9A7E3F;text-decoration:none;">pulse.finvastra.com</a><br/>
      Finvastra Advisors Pvt. Ltd.
    </td>
  </tr>
</table>`;

/**
 * Build a branded HTML email body.
 * @param title  — headline (e.g. "Leave Application Approved")
 * @param lines  — array of { label, value } rows shown in a table
 * @param note   — optional paragraph below the table (e.g. rejection reason)
 * @param ctaLabel — text for the CTA button (default "Open Pulse")
 * @param ctaLink  — URL for the button (default pulse.finvastra.com)
 */
export function buildHrEmailHtml(opts: {
  title:     string;
  lines:     { label: string; value: string }[];
  note?:     string;
  ctaLabel?: string;
  ctaLink?:  string;
}): string {
  const { title, lines, note, ctaLabel = 'Open Pulse', ctaLink = 'https://pulse.finvastra.com' } = opts;

  const rows = lines
    .map(
      ({ label, value }) => `
      <tr>
        <td style="padding:6px 0;font-family:'DM Sans',Arial,sans-serif;font-size:13px;
                   color:#8B8B85;width:160px;vertical-align:top;">${label}</td>
        <td style="padding:6px 0;font-family:'DM Sans',Arial,sans-serif;font-size:13px;
                   color:#0A0A0A;font-weight:500;">${value}</td>
      </tr>`,
    )
    .join('');

  const noteHtml = note
    ? `<p style="font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:#374151;
                 margin:16px 0 0;padding:12px 16px;background:#FEF3C7;
                 border-left:4px solid #D97706;border-radius:4px;">${note}</p>`
    : '';

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#FAFAF7;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFAF7;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0"
             style="background:#fff;border-radius:12px;overflow:hidden;
                    box-shadow:0 1px 8px rgba(0,0,0,0.08);">
        <tr><td>${BRAND_HEADER}</td></tr>
        <tr><td style="padding:28px 32px;">
          <h2 style="margin:0 0 20px;font-family:'DM Sans',Arial,sans-serif;
                     font-size:18px;font-weight:700;color:#0B1538;">${title}</h2>
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tbody>${rows}</tbody>
          </table>
          ${noteHtml}
          <div style="margin-top:28px;">
            <a href="${ctaLink}"
               style="display:inline-block;padding:10px 24px;border-radius:8px;
                      background:#0B1538;color:#C9A961;font-family:'DM Sans',Arial,sans-serif;
                      font-size:13px;font-weight:600;text-decoration:none;letter-spacing:0.3px;">
              ${ctaLabel}
            </a>
          </div>
        </td></tr>
        <tr><td>${BRAND_FOOTER}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Send an HR action email notification via POST /api/hrms/notify/email.
 * Fire-and-forget — call with .catch(() => {}).
 * Requires the current Firebase user to be admin or HR manager.
 */
export async function sendHrEmailNotification(opts: {
  employeeId:  string;
  subject:     string;
  htmlBody:    string;
  pdfBase64?:  string;   // base64-encoded PDF to attach
  pdfFilename?: string;  // e.g. "Finvastra-Payslip-April-2026.pdf"
}): Promise<void> {
  const token = await getAuth().currentUser?.getIdToken();
  if (!token) return;

  await fetch('/api/hrms/notify/email', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify({
      employeeId:  opts.employeeId,
      subject:     opts.subject,
      htmlBody:    opts.htmlBody,
      pdfBase64:   opts.pdfBase64,
      pdfFilename: opts.pdfFilename,
    }),
  });
}

/**
 * Notify the CURRENT employee's reporting manager that they submitted a leave /
 * claim request — bell + branded email. The server resolves the manager from the
 * caller's user doc (the client can't choose it). Fire-and-forget; no-op when the
 * employee has no reporting manager set. Any signed-in employee may call it.
 */
export async function notifyManagerOfRequest(opts: {
  kind:    'leave' | 'claim' | 'attendance';
  title?:  string;
  intro?:  string;
  rows:    { label: string; value: string }[];
  link?:   string;
}): Promise<void> {
  const token = await getAuth().currentUser?.getIdToken();
  if (!token) return;
  await fetch('/api/hrms/notify/manager', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify(opts),
  });
}
