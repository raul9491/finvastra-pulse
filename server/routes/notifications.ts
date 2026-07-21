/**
 * server/routes/notifications.ts - auth-alert + password-reset + support + HR notify/letters + documents-upload routes, lifted from server.ts
 * (2026-07-21, Phase 3 route split). Registered via registerNotificationRoutes(app); imports its
 * helpers directly from server/lib/* + ../db.js.
 */
import express from "express";
import { getStorage } from "firebase-admin/storage";
import { db, admin } from "../db.js";
import {
  HOUR_MS,
  checkRateLimit,
  verifyFirebaseToken,
} from "../lib/auth.js";
import {
  requireAdminOrScheduler,
} from "../lib/perf.js";
import {
  buildBrandEmail,
  buildPasswordResetEmail,
  sendGmailMessage,
} from "../lib/email.js";

export function registerNotificationRoutes(app: express.Express): void {
  // ─── Auth Alerts API ─────────────────────────────────────────────────────────
  // Called by the client after detecting a new device login.
  // Sends email notification via Google Workspace SMTP (nodemailer).
  app.post("/api/auth/login-alert", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { userAgent = "", isNewDevice = false } = req.body as { userAgent?: string; isNewDevice?: boolean };
    if (!isNewDevice) return res.json({ ok: true }); // nothing to do

    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    if (!userData) return res.status(404).json({ error: "User not found" });

    const ipAddress = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    const message = `New login to Finvastra from ${(userAgent as string).slice(0, 60)} at ${timestamp} (IP: ${ipAddress})`;

    // Send email via Google Workspace SMTP if credentials are configured
    if (process.env.SMTP_USER && process.env.SMTP_APP_PASSWORD) {
      try {
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.default.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_APP_PASSWORD },
        });
        await transporter.sendMail({
          from: `"Finvastra Security" <${process.env.SMTP_USER}>`,
          to: userData.email as string,
          subject: "New device login — Finvastra",
          text: `Hello ${userData.displayName as string},\n\n${message}\n\nIf this wasn't you, change your password immediately.\n\nFinvastra Security`,
        });
      } catch (e) {
        console.error("Login alert email failed:", e);
      }
    } else {
      console.log(`[Login Alert - no SMTP config] ${userData.email as string}: ${message}`);
    }

    return res.json({ ok: true });
  });







  // ─── Password Reset (custom flow with DOB verification) ───────────────────────

  // Step 1 — Employee clicks "Forgot password" on login page.
  // Generates a Firebase reset link, extracts the oobCode, builds our own
  // pulse.finvastra.com/auth-action URL, and sends a branded Gmail.
  // Always returns { ok: true } regardless of whether the email exists — prevents
  // email enumeration attacks.
  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body as { email?: string };
    const ok = () => res.json({ ok: true });

    // Rate-limit abuse (per client IP and per normalised email). On limit exceeded
    // return the same generic { ok: true } so enumeration is not introduced.
    const fpIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const fpEmailKey = (email ?? "").trim().toLowerCase();
    if (
      !(await checkRateLimit(fpIp, "forgot-password-ip", 6, HOUR_MS)) ||
      (fpEmailKey && !(await checkRateLimit(fpEmailKey, "forgot-password-email", 6, HOUR_MS)))
    ) {
      return ok();
    }

    if (!email || !email.trim().endsWith("@finvastra.com")) return ok();

    try {
      let userRecord: admin.auth.UserRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email.trim());
      } catch {
        return ok(); // user not found — don't leak
      }

      // Block deactivated employees — their Auth account is disabled; reset would
      // succeed but sign-in would still fail, which is confusing.
      if (userRecord.disabled) return ok();

      // generatePasswordResetLink issues a valid Firebase oobCode we can reuse.
      // No continueUrl — we extract the oobCode and build our own pulse.finvastra.com/auth-action
      // URL, so continueUrl is irrelevant. Passing it requires the domain to be in Firebase's
      // authorized-domains list, which was the root cause of the "unauthorized-continue-uri" error.
      const firebaseLink = await admin.auth().generatePasswordResetLink(email.trim());

      const oobCode = new URL(firebaseLink).searchParams.get("oobCode");
      if (!oobCode) throw new Error("oobCode missing from Firebase link");

      const resetLink =
        `https://pulse.finvastra.com/auth-action?mode=resetPassword` +
        `&oobCode=${encodeURIComponent(oobCode)}`;

      const displayName =
        userRecord.displayName ?? email.split("@")[0];

      await sendGmailMessage(
        email.trim(),
        "Reset your Finvastra Pulse password",
        buildPasswordResetEmail(displayName, resetLink),
      );
    } catch (e) {
      // Log but still return ok — never surface internals to unauthenticated callers
      console.error("[forgot-password]", e);
    }

    return ok();
  });


  // Step 2 — /auth-action page verifies DOB before showing the new-password form.
  // Accepts { email, dob } where dob is "YYYY-MM-DD" (browser date-input format).
  // Compares the MM-DD portion against /user_details/{uid}.dateOfBirth (stored MM-DD).
  // Returns { dobRequired: false } when no DOB is on file (skip the check gracefully).
  app.post("/api/auth/verify-reset-dob", async (req, res) => {
    // Rate-limit brute-forcing the DOB check (per client IP).
    const vrdIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
    if (!(await checkRateLimit(vrdIp, "verify-reset-dob-ip", 10, HOUR_MS))) {
      return res.status(429).json({ error: "Too many attempts. Please try again later." });
    }

    const { email, dob } = req.body as { email?: string; dob?: string };
    if (!email || !dob) return res.status(400).json({ error: "Missing fields" });

    try {
      const userRecord = await admin.auth().getUserByEmail(email);
      const uid        = userRecord.uid;

      const snap = await db.collection("user_details").doc(uid).get();
      const storedDob = (snap.data()?.dateOfBirth as string | undefined) ?? null;

      if (!storedDob) {
        // No DOB on file — let the employee proceed without the check
        return res.json({ dobRequired: false });
      }

      // storedDob: "MM-DD"   submitted dob: "YYYY-MM-DD" — compare only the MM-DD part
      const submittedMMDD = dob.substring(5); // e.g. "1990-03-15" → "03-15"
      if (submittedMMDD !== storedDob) {
        return res.status(400).json({ error: "Date of birth does not match our records." });
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error("[verify-reset-dob]", e);
      return res.status(400).json({ error: "Could not verify. Please try again." });
    }
  });

  // ─── Support Tickets ─────────────────────────────────────────────────────────
  // Sends an email to rahulv@finvastra.com when an employee raises a support ticket.
  // The Firestore write happens client-side first; this endpoint is fire-and-forget.
  app.post("/api/support/raise", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { category, subject, description } = req.body as {
      category: string; subject: string; description: string;
    };
    if (!category || !subject || !description) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    const senderName  = (userData?.displayName as string | undefined) ?? "An employee";
    const senderEmail = (userData?.email       as string | undefined) ?? "";
    const empId       = (userData?.employeeId  as string | undefined) ?? "";

    // Send email via Google Workspace SMTP if credentials are configured
    if (process.env.SMTP_USER && process.env.SMTP_APP_PASSWORD) {
      try {
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.default.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_APP_PASSWORD },
        });
        await transporter.sendMail({
          from: `"Finvastra Pulse" <${process.env.SMTP_USER}>`,
          to: "rahulv@finvastra.com",
          subject: `[Support] ${category}: ${subject}`,
          text: [
            `Support ticket raised on Finvastra Pulse`,
            ``,
            `From     : ${senderName} (${empId}) <${senderEmail}>`,
            `Category : ${category}`,
            `Subject  : ${subject}`,
            ``,
            `Details`,
            `───────`,
            description,
            ``,
            `View all tickets in the Firestore /support_requests collection.`,
          ].join("\n"),
        });
      } catch (e) {
        console.error("[support/raise] email failed:", e);
      }
    } else {
      console.log(`[Support Ticket - no SMTP config] From: ${senderEmail} | ${category}: ${subject}`);
    }

    return res.json({ ok: true });
  });

  // ─── HR Action Email Notifications ──────────────────────────────────────────
  // POST /api/hrms/notify/email
  // Called by admin pages (leave, claims, IT declarations) after a status change.
  // Caller must be admin or isHrmsManager. Sends a branded HTML email to the
  // employee via Google Workspace SMTP. Fire-and-forget — always returns 200.
  //
  // Body: { employeeId: string, subject: string, htmlBody: string }
  app.post("/api/hrms/notify/email", async (req, res) => {
    // Auth check — admin or isHrmsManager only
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const callerSnap = await db.collection("users").doc(uid).get();
    const callerData = callerSnap.data();
    const isAdmin      = callerData?.role === "admin";
    const isHrMgr      = callerData?.isHrmsManager === true;
    if (!isAdmin && !isHrMgr) return res.status(403).json({ error: "Admin or HR Manager required" });

    const { employeeId, subject, htmlBody, pdfBase64, pdfFilename } = req.body as {
      employeeId: string; subject: string; htmlBody: string;
      pdfBase64?: string; pdfFilename?: string;
    };
    if (!employeeId || !subject || !htmlBody) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // Fetch employee email from Firebase Auth (they may not have @finvastra.com yet)
    let toEmail = "";
    try {
      const authUser = await admin.auth().getUser(employeeId);
      toEmail = authUser.email ?? "";
    } catch {
      // Employee may not have an Auth account — non-fatal, skip email
      return res.json({ ok: true, skipped: "no_auth_account" });
    }
    if (!toEmail) return res.json({ ok: true, skipped: "no_email" });

    try {
      if (pdfBase64 && pdfFilename && process.env.SMTP_USER && process.env.SMTP_APP_PASSWORD) {
        // PDF attachment path: nodemailer SMTP (Gmail API does not support attachments here)
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.default.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_APP_PASSWORD },
        });
        await transporter.sendMail({
          from: `"Finvastra Pulse" <${process.env.SMTP_USER}>`,
          to: toEmail,
          subject,
          html: htmlBody,
          attachments: [{
            filename: pdfFilename,
            content: pdfBase64,
            encoding: 'base64',
            contentType: 'application/pdf',
          }],
        });
        console.log(`[hr-notify/email] Sent "${subject}" to ${toEmail} (with PDF via SMTP)`);
      } else {
        // Plain HTML path: Gmail API via domain-wide delegation (always configured in prod)
        await sendGmailMessage(toEmail, subject, htmlBody);
        console.log(`[hr-notify/email] Sent "${subject}" to ${toEmail}`);
      }
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string | number; response?: { data?: unknown; status?: number } };
      // Non-fatal — in-app notification is the primary channel
      console.error("[hr-notify/email] send failed:", JSON.stringify({
        message: err.message, code: err.code,
        status:  err.response?.status, data: err.response?.data,
      }));
    }

    return res.json({ ok: true });
  });

  // POST /api/hrms/notify/manager — an employee notifies THEIR reporting manager
  // (server resolves the manager from the caller's user doc; client can't lie).
  // Used when an employee submits a leave / claim / attendance-correction so the
  // approver gets a bell + email of what was requested.
  // ROUTING: the active reporting manager if set; otherwise FALL BACK to HR + admins
  // (so a request is never lost when the manager is absent or unset — the "HR can do
  // it if the manager isn't available" rule).
  app.post("/api/hrms/notify/manager", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const { kind, title, intro, rows, link } = (req.body ?? {}) as {
      kind?: string; title?: string; intro?: string;
      rows?: Array<{ label: string; value: string }>; link?: string;
    };
    const snap = await db.collection("users").doc(uid).get();
    const d = snap.data() ?? {};
    const empName = (d.displayName as string) || "An employee";

    const kindWord = kind === "claim" ? "claim" : kind === "attendance" ? "attendance correction" : "leave";
    const notifType = kind === "claim" ? "claim_request" : kind === "attendance" ? "attendance_request" : "leave_request";

    // Resolve recipients: active reporting manager, else HR + admins (fallback).
    const recipients = new Set<string>();
    let routedTo = "manager";
    const managerUid = d.reportingManagerUid as string | undefined;
    if (managerUid && managerUid !== uid) {
      const m = (await db.collection("users").doc(managerUid).get()).data();
      if (m && m.employeeStatus !== "inactive") recipients.add(managerUid);
    }
    if (recipients.size === 0) {
      routedTo = "hr";
      const [hrSnap, adminSnap] = await Promise.all([
        db.collection("users").where("isHrmsManager", "==", true).get(),
        db.collection("users").where("role", "==", "admin").get(),
      ]);
      for (const s of [...hrSnap.docs, ...adminSnap.docs]) {
        if (s.id !== uid && (s.data().employeeStatus !== "inactive")) recipients.add(s.id);
      }
    }
    if (recipients.size === 0) return res.json({ ok: true, skipped: "no_recipient" });

    const safeRows = Array.isArray(rows) ? rows.filter((r) => r && r.label) : [];
    const heading = title || `${empName} — ${kindWord} request`;
    const body = safeRows.map((r) => `${r.label}: ${r.value}`).join(" · ").slice(0, 300) || `${empName} submitted a request`;
    const html = buildBrandEmail({
      title: heading,
      intro: intro || `${empName} (your team member) has submitted a ${kindWord} request. Details below.`,
      rows: safeRows,
      ctaLabel: "Review in Pulse",
      ctaLink: link ? `https://pulse.finvastra.com${link}` : undefined,
    });

    await Promise.all([...recipients].map(async (rid) => {
      // In-app bell (Admin SDK — bypasses the admin/HR-only create rule).
      await db.collection("notifications").doc(rid).collection("items").add({
        type: notifType, title: heading, body, link: link ?? null, read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
      const u = await admin.auth().getUser(rid).catch(() => null);
      if (u?.email) await sendGmailMessage(u.email, heading, html).catch(() => {});
    }));
    return res.json({ ok: true, routedTo, notified: [...recipients] });
  });

  // ─── SMTP / Gmail Test Endpoint ───────────────────────────────────────────
  // POST /api/admin/test-smtp  (admin OR scheduler OIDC)
  // Sends a BRANDED test email (new logo template) to confirm delivery + branding.
  // Body (optional): { to: "someone@finvastra.com" } — defaults to rahulv@finvastra.com.
  app.post("/api/admin/test-smtp", express.json(), async (req, res) => {
    if (!(await requireAdminOrScheduler(req, res))) return;
    const to = (req.body && typeof req.body.to === "string" && req.body.to.trim()) || "rahulv@finvastra.com";
    const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const html = buildBrandEmail({
      title: "Test email from Finvastra Pulse",
      intro: "If you can see the Finvastra logo above and this reads cleanly, the new email branding and encoding are working.",
      rows: [
        { label: "Status",   value: "Delivery OK" },
        { label: "Template", value: "Branded — logo header" },
        { label: "Sent at",  value: `${timestamp} IST` },
      ],
      ctaLabel: "Open Pulse",
      ctaLink:  "https://pulse.finvastra.com",
    });
    try {
      await sendGmailMessage(to, "Test email from Finvastra Pulse", html);
      return res.json({ ok: true, message: `Test email sent to ${to} at ${timestamp}` });
    } catch (e: unknown) {
      const err = e as {
        message?: string; code?: string | number; status?: number;
        errors?: unknown; response?: { data?: unknown; status?: number };
      };
      console.error("[test-smtp] Gmail API error:", JSON.stringify({
        message: err.message, code: err.code,
        status:  err.status ?? err.response?.status,
        errors:  err.errors, data: err.response?.data,
      }, null, 2));
      return res.status(500).json({
        ok: false, error: err.message ?? String(e), code: err.code,
        status: err.status ?? err.response?.status, details: err.errors ?? err.response?.data,
      });
    }
  });

  // ─── HR Letter Upload (server-side proxy) ──────────────────────────────────
  // POST /api/admin/hr-letters/upload
  //
  // WHY server-side: Firebase Storage rules can only read from the *default*
  // Firestore database for cross-service checks. This project uses a named DB
  // (ai-studio-...) so the Storage rules `firestore.get()` fallback never fires.
  // Admin SDK uploads bypass Storage rules entirely, so role is verified here
  // in Express against Firestore — which does work with named databases.
  //
  // Body: { employeeId: string, filename: string, base64Data: string }
  // Returns: { ok: true, downloadUrl: string }
  app.post("/api/admin/hr-letters/upload",
    express.json({ limit: "5mb" }),
    async (req, res) => {
      // 1. Auth
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });

      // 2. Role check via Firestore (works regardless of custom-claims freshness)
      const callerSnap = await db.collection("users").doc(uid).get();
      const callerData = callerSnap.data();
      if (callerData?.role !== "admin" && callerData?.isHrmsManager !== true) {
        return res.status(403).json({ error: "Admin or HR Manager required" });
      }

      const { employeeId, filename, base64Data } = req.body as {
        employeeId: string;
        filename:   string;
        base64Data: string;
      };
      if (!employeeId || !filename || !base64Data) {
        return res.status(400).json({ error: "Missing fields: employeeId, filename, base64Data" });
      }

      try {
        const STORAGE_BUCKET = "gen-lang-client-0643641184.firebasestorage.app";
        const buffer    = Buffer.from(base64Data, "base64");
        const filePath  = `hr-letters/${employeeId}/${filename}`;
        // Use getStorage() (explicit modular import) instead of admin.storage() (compat API).
        // The compat API requires storageBucket in initializeApp; getStorage() does not.
        const bucket    = getStorage().bucket(STORAGE_BUCKET);
        const fileRef   = bucket.file(filePath);

        // Generate a Firebase-style download token so the URL looks identical to
        // what getDownloadURL() would return and works permanently.
        const dlToken = crypto.randomUUID();

        await fileRef.save(buffer, {
          contentType: "application/pdf",
          resumable:   false,
          metadata: {
            // firebaseStorageDownloadTokens is the Firebase Storage mechanism for
            // token-based download URLs — same format as client getDownloadURL().
            metadata: { firebaseStorageDownloadTokens: dlToken },
          },
        });

        const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, "%2F");
        const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodedPath}?alt=media&token=${dlToken}`;

        return res.json({ ok: true, downloadUrl });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[hr-letters/upload] Storage save failed:", msg);
        return res.status(500).json({ error: `Upload failed: ${msg}` });
      }
    }
  );

  // ─── CRM Document Vault Upload ──────────────────────────────────────────────
  // POST /api/crm/documents/upload
  //
  // WHY server-side: same named-Firestore-DB problem as HR letters — Storage rules
  // cannot cross-read named databases, so client SDK uploads would be blocked.
  // Admin SDK upload bypasses Storage rules entirely; role is verified in Express.
  //
  // Body: { opportunityId: string, filename: string, base64Data: string, contentType: string }
  // Returns: { ok: true, downloadUrl: string, storagePath: string }
  app.post("/api/crm/documents/upload",
    express.json({ limit: "12mb" }),
    async (req, res) => {
      // 1. Auth
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });

      // 2. Role check — admin OR any user with crmAccess
      const callerSnap = await db.collection("users").doc(uid).get();
      const callerData = callerSnap.data();
      if (!callerData) return res.status(403).json({ error: "User not found" });
      const isAdmin   = callerData.role === "admin";
      const hasCrmAccess = callerData.crmAccess === true;
      if (!isAdmin && !hasCrmAccess) {
        return res.status(403).json({ error: "CRM access required" });
      }

      // 3. Validate body
      const { opportunityId, filename, base64Data, contentType } = req.body as {
        opportunityId?: string;
        filename?:      string;
        base64Data?:    string;
        contentType?:   string;
      };
      if (!opportunityId || !filename || !base64Data) {
        return res.status(400).json({ error: "Missing fields: opportunityId, filename, base64Data" });
      }

      // 4. Sanitise filename and prepend UUID to prevent collisions
      const safeName   = filename.replace(/[^a-zA-Z0-9._\-() ]/g, '_').slice(0, 200);
      const uniqueName = `${crypto.randomUUID()}_${safeName}`;
      const filePath   = `crm-documents/${opportunityId}/${uniqueName}`;

      try {
        const STORAGE_BUCKET = "gen-lang-client-0643641184.firebasestorage.app";
        const buffer   = Buffer.from(base64Data, "base64");
        const bucket   = getStorage().bucket(STORAGE_BUCKET);
        const fileRef  = bucket.file(filePath);
        const dlToken  = crypto.randomUUID();

        await fileRef.save(buffer, {
          contentType:  contentType || "application/octet-stream",
          resumable:    false,
          metadata: { metadata: { firebaseStorageDownloadTokens: dlToken } },
        });

        const encodedPath = encodeURIComponent(filePath);
        const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodedPath}?alt=media&token=${dlToken}`;

        return res.json({ ok: true, downloadUrl, storagePath: filePath });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[crm/documents/upload] Storage save failed:", msg);
        return res.status(500).json({ error: `Upload failed: ${msg}` });
      }
    }
  );
}
