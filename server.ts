import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { JWT, OAuth2Client } from "google-auth-library";
import admin from "firebase-admin";
import { getStorage } from "firebase-admin/storage";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { encryptField, decryptField } from "./src/lib/encryption.js";
import { isCrm2Lead, isLeadDeleted, isLeadTerminal, leadBucket, leadOwner, leadName, leadMobile, leadCreatedMs, leadAttempted } from "./src/lib/crm2/leadModel.js";
import { db, useEmulator } from "./server/db.js";
import { registerCrm2Routes } from "./server/crm2.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase Admin init + the named Firestore handle (`db`) now live in
// ./server/db.ts so route/helper modules can import them directly. `admin` above
// is the same singleton db.ts initializes; `useEmulator` is re-exported from there.

import {
  getSheetsClient,
  getServiceAccountEmail,
  extractSheetId,
  getServiceAccountPath,
  fetchEmployeeMasterRows,
  parseEmployeeRow,
  splitPhones,
  canonicalPhone,
  salvagePhoneFromName,
  validateCells,
  validateRow,
  buildImportHash,
  buildImportHashLegacy,
  findExistingImportHashes,
  detectColumnMapping,
  extractCells,
  writeImportedLead,
  processImportBatch,
  distributeBatch,
  TEMPLATE_SHEET_URL,
} from "./server/lib/imports.js";
import type { ColumnMapping } from "./server/lib/imports.js";
import { verifyFirebaseToken, verifySchedulerOIDC, validateServerEnv, isSuperAdmin, checkRateLimit, SUPER_ADMIN_UIDS_LIST, HOUR_MS } from "./server/lib/auth.js";
import {
  computeActualsServer, latestActivity, requireAdminOrScheduler, activeRmFilter,
  computeDownline, isElevatedUser, periodStartMs, sumTeamTotals, accumulatePerf,
  computeTeamSummary, cachedJson,
} from "./server/lib/perf.js";
import {
  getGmailClient, getCalendarClient, encodeEmailSubject, notificationsEnabled,
  sendGmailMessage, buildPasswordResetEmail, escapeHtml, buildBrandEmail, sendGmailWithAttachment,
} from "./server/lib/email.js";
import { normaliseIndianPhone, workloadAwareAssign, writeWebhookLog, processInboundLead } from "./server/lib/webhook.js";
import { registerImportRoutes } from "./server/routes/imports.js";
import { createOnboardingChecklist, createOffboardingChecklist } from "./server/lib/employee.js";
validateServerEnv();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 8080;

  // Cloud Run sits behind exactly ONE Google front-end proxy hop: trust it so
  // req.ip resolves to the real client (the right-most X-Forwarded-For entry,
  // which the front end appends) instead of the proxy address, and
  // req.protocol reflects X-Forwarded-Proto. Required for per-IP rate limits.
  app.set("trust proxy", 1);

  // ─── CORS ─────────────────────────────────────────────────────────────────
  const ALLOWED_ORIGINS = process.env.NODE_ENV === "production"
    ? ["https://pulse.finvastra.com", "https://finvastra.com"]
    : ["https://pulse.finvastra.com", "https://finvastra.com", "http://localhost:3000"];

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    next();
  });

  // Capture raw body bytes before JSON parsing — required for Meta webhook HMAC verification.
  app.use(express.json({
    limit: "10mb",
    verify: (req: express.Request & { rawBody?: Buffer }, _res: express.Response, buf: Buffer) => {
      req.rawBody = buf;
    },
  }));
  app.use(cookieParser());

  // Google OAuth Configuration
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/api/auth/callback`
  );

  // Auth URL endpoint
  app.get("/api/auth/google/url", (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/calendar",
      ],
      prompt: "consent",
    });
    res.json({ url });
  });

  // OAuth Callback
  app.get(["/api/auth/callback", "/api/auth/callback/"], async (req, res) => {
    const { code } = req.query;
    const appOrigin =
      process.env.APP_ORIGIN ||
      (process.env.NODE_ENV === "production"
        ? "https://pulse.finvastra.com"
        : "http://localhost:3000");
    try {
      const { tokens } = await oauth2Client.getToken(code as string);
      res.send(`
        <html><body><script>
          if (window.opener) {
            window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', tokens: ${JSON.stringify(tokens)} }, '${appOrigin}');
            window.close();
          } else { window.location.href = '/'; }
        </script><p>Authentication successful.</p></body></html>
      `);
    } catch (error) {
      console.error("OAuth Error:", error);
      res.status(500).send("Authentication failed");
    }
  });

  // Calendar events proxy
  app.post("/api/calendar/events", async (req, res) => {
    const { tokens } = req.body;
    if (!tokens) return res.status(401).json({ error: "No tokens" });
    const client = new google.auth.OAuth2();
    client.setCredentials(tokens);
    const calendar = google.calendar({ version: "v3", auth: client });
    try {
      const response = await calendar.events.list({
        calendarId: "primary",
        timeMin: new Date().toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: "startTime",
      });
      res.json(response.data.items);
    } catch (error) {
      console.error("Calendar API Error:", error);
      res.status(500).json({ error: "Failed to fetch calendar" });
    }
  });

  // ─── HRMS: Leave Calendar Sync ──────────────────────────────────────────────
  // POST /api/hrms/leave/sync-calendar
  // Called by the client after approving a leave application.
  // Creates an all-day event on the approving admin's primary Google Calendar.
  app.post("/api/hrms/leave/sync-calendar", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    if (!(await checkRateLimit(uid, "leave-calendar-sync", 20, HOUR_MS))) {
      return res.status(429).json({ error: "Too many requests. Maximum 20 calendar syncs per hour." });
    }

    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    const canApprove = userData?.role === "admin" || userData?.isHrmsManager === true;
    if (!canApprove) return res.status(403).json({ error: "Not authorised to approve leave" });

    const { applicationId } = req.body as { applicationId?: string };
    if (!applicationId) return res.status(400).json({ error: "applicationId required" });

    const appSnap = await db.collection("leave_applications").doc(applicationId).get();
    if (!appSnap.exists) return res.status(404).json({ error: "Application not found" });
    const application = appSnap.data()!;

    // Fetch the employee's display name for the calendar event title
    const empSnap = await db.collection("users").doc(application.employeeId as string).get();
    const empName: string = (empSnap.data()?.displayName as string | undefined) ?? "Employee";

    // Use the shared oauth2Client credentials set during the admin's Google OAuth flow.
    // If no credentials are stored (admin hasn't connected Calendar), skip gracefully.
    try {
      if (!oauth2Client.credentials?.access_token) {
        console.warn("[Leave Calendar] No Google OAuth credentials — skipping calendar sync");
        return res.json({ ok: true, calendarEventId: null });
      }

      const calendar = google.calendar({ version: "v3", auth: oauth2Client });
      const event = await calendar.events.insert({
        calendarId: "primary",
        requestBody: {
          summary: `${empName} — On Leave`,
          start: { date: application.fromDate as string },
          end:   { date: application.toDate   as string },
          description: `${(application.type as string).charAt(0).toUpperCase() + (application.type as string).slice(1)} Leave · ${application.days as number} day(s)`,
          colorId: "7",  // blue
        },
      });

      const calendarEventId = event.data.id ?? null;
      if (calendarEventId) {
        await db.collection("leave_applications").doc(applicationId).update({ calendarEventId });
      }
      return res.json({ ok: true, calendarEventId });
    } catch (e) {
      console.error("[Leave Calendar] Failed to create calendar event:", e);
      // Non-fatal — calendar sync failure must not break the approval flow
      return res.json({ ok: true, calendarEventId: null });
    }
  });

  // Health check
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // Deep health check — actually touches Firestore so uptime monitoring catches
  // DB/quota/rules outages (a plain HTTP 200 check would miss them: in the
  // 2026-06-10 incident index.html stayed 200 while every Firestore read 429'd).
  // Returns 200 only if a real read succeeds; 503 otherwise. ~1 read/min = trivial.
  app.get("/api/health/deep", async (_req, res) => {
    try {
      await db.collection("users").limit(1).get();
      return res.json({ status: "ok", firestore: "ok" });
    } catch (e) {
      console.error("deep health check failed:", e);
      return res.status(503).json({ status: "degraded", firestore: "error",
        message: e instanceof Error ? e.message : "read failed" });
    }
  });

  // ─── Bootstrap admin ─────────────────────────────────────────────────────────
  // Promotes the caller to admin if their email is in the hardcoded allowlist.
  // Safe to expose: the allowlist is server-side only; no client can self-promote.
  app.post("/api/dev/bootstrap-admin", async (req, res) => {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Sign in first, then call this endpoint." });

      const userRecord = await admin.auth().getUser(uid);
      const profileRef = db.collection("users").doc(uid);
      const snap = await profileRef.get();

      const profile = {
        userId:      uid,
        email:       userRecord.email ?? "",
        displayName: userRecord.displayName ?? userRecord.email ?? "Admin",
        role:        "admin",
        photoURL:    userRecord.photoURL ?? "",
        department:  "Management",
        designation: "Admin",
        joiningDate: new Date().toISOString().slice(0, 10),
        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      };

      // Only allow known admin emails to use this endpoint
      const ADMIN_EMAILS = ["rahulv@finvastra.com"];
      if (!ADMIN_EMAILS.includes(userRecord.email ?? "")) {
        return res.status(403).json({ error: "Email not in admin allowlist." });
      }

      if (snap.exists) {
        await profileRef.update({ role: "admin", crmAccess: true });
        return res.json({ message: "Role updated to admin.", uid, existing: true });
      } else {
        await profileRef.set(profile);
        return res.json({ message: "Admin profile created.", uid, existing: false });
      }
    });

  // ─── Custom Claims Sync ──────────────────────────────────────────────────────
  // POST /api/admin/users/:uid/sync-claims
  // Reads the user's Firestore profile and stamps matching Firebase Auth custom claims.
  // Called by Add Employee and by AccessManagementPage on role/access changes.
  // Claims set: { role, hrmsAccess, crmAccess, crmRole, isHrmsManager, misAccess }
  app.post("/api/admin/users/:uid/sync-claims", async (req, res) => {
    try {
      const callerUid = await verifyFirebaseToken(req);
      if (!callerUid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(callerUid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const { uid } = req.params;

      // Protect super admin accounts: only another super admin can sync their claims
      if (isSuperAdmin(uid) && !isSuperAdmin(callerUid)) {
        return res.status(403).json({ error: "Only a super admin can modify another super admin's claims." });
      }

      const snap = await db.collection("users").doc(uid).get();
      if (!snap.exists) return res.status(404).json({ error: "User not found" });
      const p = snap.data()!;

      await admin.auth().setCustomUserClaims(uid, {
        role:           p.role          ?? "employee",
        hrmsAccess:     p.hrmsAccess    ?? true,
        crmAccess:      p.crmAccess     ?? false,
        crmRole:        p.crmRole       ?? null,
        isHrmsManager:  p.isHrmsManager ?? false,
        misAccess:      p.misAccess     ?? null,
        perms:          p.perms         ?? {},   // CRM 2.0 permission keys (PLAN.md decision 2)
      });

      // Signal the target user's open sessions to force-refresh their ID token —
      // without this, a REVOKED permission lingers in the stale claims for up to
      // 1h (grants were already instant via the rules/API get() fallbacks).
      await db.collection("users").doc(uid).update({
        claimsRefreshedAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});

      await db.collection("audit_logs").add({
        actor:      callerUid,
        action:     "sync_custom_claims",
        targetPath: `/users/${uid}`,
        at:         admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ ok: true, uid });
    } catch (e) {
      console.error("sync-claims error:", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
    }
  });

  // POST /api/admin/sync-all-claims
  // Bulk re-stamp custom claims for EVERY user from their Firestore profile.
  // Run once after the 2026-06-10 claims-first rules change so every token carries
  // claims (then the rules skip the per-request /users read for that user).
  app.post("/api/admin/sync-all-claims", async (req, res) => {
    try {
      const callerUid = await verifyFirebaseToken(req);
      if (!callerUid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(callerUid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });
      const callerIsSuper = isSuperAdmin(callerUid);

      const usersSnap = await db.collection("users").get();
      let synced = 0, skipped = 0, noAuth = 0;
      for (const docu of usersSnap.docs) {
        const uid = docu.id;
        // Only a super admin may modify a super admin's claims.
        if (isSuperAdmin(uid) && !callerIsSuper) { skipped++; continue; }
        const p = docu.data();
        try {
          await admin.auth().setCustomUserClaims(uid, {
            role:          p.role          ?? "employee",
            hrmsAccess:    p.hrmsAccess    ?? true,
            crmAccess:     p.crmAccess     ?? false,
            crmRole:       p.crmRole       ?? null,
            isHrmsManager: p.isHrmsManager ?? false,
            misAccess:     p.misAccess     ?? null,
            perms:         p.perms         ?? {},   // CRM 2.0 permission keys
          });
          await docu.ref.update({
            claimsRefreshedAt: admin.firestore.FieldValue.serverTimestamp(),
          }).catch(() => {});
          synced++;
        } catch {
          // No Firebase Auth account yet (e.g. needsEmailSetup) — nothing to stamp.
          noAuth++;
        }
      }

      await db.collection("audit_logs").add({
        actor:      callerUid,
        action:     "sync_all_custom_claims",
        targetPath: "/users",
        at:         admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ ok: true, synced, skipped, noAuth, total: usersSnap.size });
    } catch (e) {
      console.error("sync-all-claims error:", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
    }
  });

  // ─── PAN Decryption API ──────────────────────────────────────────────────────
  // POST /api/leads/:leadId/pan — decrypt PAN and log the access.
  // Auth: admin OR the lead's primaryOwnerId OR any opportunity owner on the lead.
  app.post("/api/leads/:leadId/pan", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { leadId } = req.params;
    const leadSnap = await db.collection("leads").doc(leadId).get();
    if (!leadSnap.exists) return res.status(404).json({ error: "Lead not found" });
    const lead = leadSnap.data()!;

    // Authorisation: admin OR primaryOwner OR any opportunity owner
    const userSnap = await db.collection("users").doc(uid).get();
    const isAdmin = userSnap.data()?.role === "admin";
    const isPrimaryOwner = lead.primaryOwnerId === uid;

    let isOppOwner = false;
    if (!isAdmin && !isPrimaryOwner) {
      const oppsSnap = await db.collection("leads").doc(leadId).collection("opportunities").get();
      isOppOwner = oppsSnap.docs.some((d) => d.data().ownerId === uid);
    }

    if (!isAdmin && !isPrimaryOwner && !isOppOwner) {
      return res.status(403).json({ error: "Not authorised to view this PAN" });
    }

    // Decrypt — prefer panEncrypted; fall back to legacy panRaw during migration period
    let panPlain: string | null = null;
    if (lead.panEncrypted) {
      try {
        panPlain = decryptField(lead.panEncrypted as Parameters<typeof decryptField>[0]);
      } catch {
        return res.status(500).json({ error: "Decryption failed" });
      }
    } else if (lead.panRaw) {
      panPlain = lead.panRaw as string;
    }

    if (!panPlain) return res.status(404).json({ error: "No PAN on record" });

    // Log the access — Admin SDK bypasses Firestore rules (allow create: if false on access_logs)
    await db.collection("access_logs").add({
      actorId:    uid,
      actorEmail: userSnap.data()?.email ?? "",
      action:     "pan_view",
      targetType: "lead",
      targetId:   leadId,
      accessedAt: admin.firestore.FieldValue.serverTimestamp(),
      ipAddress:  req.ip ?? req.socket.remoteAddress ?? "",
      userAgent:  req.headers["user-agent"] ?? "",
    });

    return res.json({ pan: panPlain });
  });

  // POST /api/admin/migrate-pan-encryption — encrypts all leads with plaintext panRaw.
  // Admin-only. Run once per environment after setting PAN_ENCRYPTION_KEY.
  app.post("/api/admin/migrate-pan-encryption", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

    let migrated = 0, skipped = 0, failed = 0;
    try {
      const snap = await db.collection("leads").where("panRaw", "!=", null).get();
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        if (!data.panRaw || data.panEncrypted) { skipped++; continue; }
        try {
          const enc = encryptField(data.panRaw as string);
          const raw = data.panRaw as string;
          const masked = raw.length === 10
            ? raw.slice(0, 5) + "****" + raw.slice(-1)
            : "*".repeat(raw.length);
          await docSnap.ref.update({
            panEncrypted: enc,
            panMasked:    masked,
            panRaw:       admin.firestore.FieldValue.delete(),
          });
          migrated++;
        } catch {
          failed++;
        }
      }
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
    return res.json({ migrated, skipped, failed });
  });

  // Import/lead-pull/phone-backfill routes -> ./server/routes/imports.ts
  registerImportRoutes(app);

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

  // ─── Scheduled Jobs API ─────────────────────────────────────────────────────
  // All three endpoints are triggered daily by Cloud Scheduler (HTTP target).
  // Manual admin trigger also available from the dashboard.

  // POST /api/admin/run-bank-sla-check
  // Accepts: Firebase admin token (dashboard) OR Cloud Scheduler OIDC token.
  app.post("/api/admin/run-bank-sla-check", async (req, res) => {
    const fromScheduler = await verifySchedulerOIDC(req);
    if (!fromScheduler) {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const userSnap = await db.collection("users").doc(uid).get();
      if (userSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    }
    if (!(await notificationsEnabled("bank_sla_check"))) return res.json({ ok: true, skipped: "notifications_disabled" });
    try {
      const { runBankSLACheck } = await import("./src/lib/bankSLAJob");
      const result = await runBankSLACheck(db);
      return res.json(result);
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // POST /api/admin/run-commission-leakage-check
  // Accepts: Firebase admin token (dashboard) OR Cloud Scheduler OIDC token.
  app.post("/api/admin/run-commission-leakage-check", async (req, res) => {
    const fromScheduler = await verifySchedulerOIDC(req);
    if (!fromScheduler) {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const userSnap = await db.collection("users").doc(uid).get();
      if (userSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    }
    if (!(await notificationsEnabled("commission_leakage_check"))) return res.json({ ok: true, skipped: "notifications_disabled" });
    try {
      const { runCommissionLeakageCheck } = await import("./src/lib/commissionLeakageJob");
      const result = await runCommissionLeakageCheck(db);
      return res.json(result);
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // POST /api/admin/run-document-expiry-check
  // Triggered daily by Cloud Scheduler (HTTP + OIDC). Manual trigger from admin dashboard.
  // Accepts: Firebase admin token (dashboard) OR Cloud Scheduler OIDC token.
  app.post("/api/admin/run-document-expiry-check", async (req, res) => {
    const fromScheduler = await verifySchedulerOIDC(req);
    if (!fromScheduler) {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const userSnap = await db.collection("users").doc(uid).get();
      if (userSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    }
    if (!(await notificationsEnabled("document_expiry_check"))) return res.json({ ok: true, skipped: "notifications_disabled" });
    try {
      const { runDocumentExpiryCheck } = await import("./src/lib/documentExpiryJob");
      const result = await runDocumentExpiryCheck(db);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  });

  // POST /api/admin/run-leave-year-reset
  // Triggered on April 1 by Cloud Scheduler (OIDC auth). Manual trigger from admin UI.
  // Accepts: Firebase admin token (dashboard) OR Cloud Scheduler OIDC token.
  // Body: { year?: number }  — defaults to current FY start year.
  app.post("/api/admin/run-leave-year-reset", async (req, res) => {
    const fromScheduler = await verifySchedulerOIDC(req);
    let callerUid  = "scheduler";
    let callerName = "Cloud Scheduler";

    if (!fromScheduler) {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const userSnap = await db.collection("users").doc(uid).get();
      if (userSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });
      callerUid  = uid;
      callerName = userSnap.data()?.displayName ?? uid;
    }

    // Resolve target FY year — defaults to current FY year (April convention)
    const { year: yearParam } = req.body ?? {};
    const now = new Date();
    const currentFyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const year = typeof yearParam === "number" && yearParam > 2020 ? yearParam : currentFyYear;

    // Idempotency guard — prevent double reset
    const resetSnap = await db.collection("leave_year_resets").doc(String(year)).get();
    if (resetSnap.exists) {
      return res.status(409).json({ error: `Year-end reset for FY ${year} already completed.` });
    }

    try {
      const { runLeaveYearReset } = await import("./src/lib/leaveYearResetJob");
      const result = await runLeaveYearReset(db, year, callerUid, callerName);
      return res.json(result);
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // ─── Performance & Target Tracking (Phase N) ──────────────────────────────────
  const inr = (n: number) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");




  // Performance/aggregation helpers (computeActualsServer, accumulatePerf,
  // computeTeamSummary, cachedJson, …) now live in ./server/lib/perf.ts.

  // GET /api/crm/team/performance?period=YYYY-MM[&managerUid=UID][&fresh=1]
  // Everyone gets their OWN numbers (head row) + their agent team (empty team →
  // own numbers only — managers/admins/SAs generate business too). An admin/
  // super-admin may pass ?managerUid to view ANY person's head+team; a non-admin's
  // managerUid param is ignored — they only ever see themselves + their reports.
  app.get("/api/crm/team/performance", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const q = req.query.period;
      const period = typeof q === "string" && /^\d{4}-\d{2}$/.test(q) ? q : new Date().toISOString().slice(0, 7);
      const callerDoc = await db.collection("users").doc(uid).get();
      const callerIsAdmin = callerDoc.data()?.role === "admin" || isSuperAdmin(uid);
      const reqMgr = req.query.managerUid;
      const targetUid = (callerIsAdmin && typeof reqMgr === "string" && reqMgr) ? reqMgr : uid;
      const fresh = req.query.fresh === "1";
      return res.json(await cachedJson(`team:${targetUid}:${period}`, fresh,
        () => computeTeamSummary(targetUid, period, /* includeHead */ true)));
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // GET /api/crm/team/all-teams?period=YYYY-MM — admin/super-admin only.
  // The top-down view: every CRM manager with their OWN numbers (managers generate
  // business too) + their agents' rows + the combined team total, plus agents not
  // assigned to any manager. Single accumulation pass — no N×4 collection reads.
  app.get("/api/crm/team/all-teams", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerDoc = await db.collection("users").doc(uid).get();
      if (callerDoc.data()?.role !== "admin" && !isSuperAdmin(uid)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const q = req.query.period;
      const period = typeof q === "string" && /^\d{4}-\d{2}$/.test(q) ? q : new Date().toISOString().slice(0, 7);
      const fresh = req.query.fresh === "1";
      return res.json(await cachedJson(`allteams:${period}`, fresh, async () => {

      const usersSnap = await db.collection("users").get();
      const users = usersSnap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
      const active = users.filter((u: any) => u.employeeStatus !== "inactive");
      const heads = active.filter((u: any) => u.crmRole === "manager");
      const headSet = new Set(heads.map((h: any) => h.uid));
      const agents = active.filter((u: any) => !isElevatedUser(u) && activeRmFilter(u));

      const { rows } = await accumulatePerf([...heads, ...agents], period);
      const rowBy = new Map(rows.map((r: any) => [r.uid, r]));

      const teams = heads.map((h: any) => {
        const memberRows = agents
          .filter((a: any) => a.reportingManagerUid === h.uid)
          .map((a: any) => rowBy.get(a.uid)).filter(Boolean)
          .sort((x: any, y: any) => y.disbursalAmount - x.disbursalAmount);
        const managerRow = { ...(rowBy.get(h.uid) ?? {}), isHead: true };
        return { manager: managerRow, members: memberRows, totals: sumTeamTotals([managerRow, ...memberRows]) };
      }).sort((a: any, b: any) => b.totals.disbursalAmount - a.totals.disbursalAmount);

      const unassigned = agents
        .filter((a: any) => !a.reportingManagerUid || !headSet.has(a.reportingManagerUid))
        .map((a: any) => rowBy.get(a.uid)).filter(Boolean)
        .sort((x: any, y: any) => y.disbursalAmount - x.disbursalAmount);

      return { teams, unassigned, period };
      }));
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // GET /api/crm/team/all — admin/super-admin only. Lists every manager (a user
  // with ≥1 direct report) so the super admin can pick any team to inspect.
  app.get("/api/crm/team/all", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerDoc = await db.collection("users").doc(uid).get();
      if (callerDoc.data()?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
      const usersSnap = await db.collection("users").get();
      const users = usersSnap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
      const byUid = new Map(users.map((u) => [u.uid, u]));
      const directCount = new Map<string, number>();
      for (const u of users) {
        if (u.employeeStatus === "inactive") continue;
        const mgr = u.reportingManagerUid;
        if (mgr) directCount.set(mgr, (directCount.get(mgr) ?? 0) + 1);
      }
      const managers = [...directCount.entries()]
        .map(([mgrUid, count]) => ({ uid: mgrUid, name: byUid.get(mgrUid)?.displayName ?? "—", memberCount: count }))
        .filter((m) => byUid.has(m.uid))
        .sort((a, b) => a.name.localeCompare(b.name));
      return res.json({ managers });
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // GET /api/crm/imports/performance[?fresh=1] — the "which data worked" view for
  // management. Groups ALL leads by their import (importName, falling back to the
  // batch id; manually-added customers form their own bucket) and reports the
  // tagged → attempted → outcome funnel per import: leads, still-unassigned,
  // attempted, untouched, disposition mix, converted, dead (no-response +
  // not-interested + wrong-number). Auth: admin / CRM manager / crmCanImport.
  app.get("/api/crm/imports/performance", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerDoc = await db.collection("users").doc(uid).get();
      const caller: any = callerDoc.data() ?? {};
      const allowed = caller.role === "admin" || isSuperAdmin(uid) || caller.crmRole === "manager" || caller.crmCanImport === true;
      if (!allowed) return res.status(403).json({ error: "Forbidden" });
      const fresh = req.query.fresh === "1";

      return res.json(await cachedJson("importperf", fresh, async () => {
        const leadsSnap = await db.collection("leads").where("deleted", "==", false).get();
        const groups = new Map<string, any>();
        const groupFor = (key: string, label: string, batchId: string | null) => {
          let g = groups.get(key);
          if (!g) {
            g = {
              key, name: label, batchId, leads: 0, unassigned: 0, attempted: 0, untouched: 0,
              converted: 0, interested: 0, callbackDue: 0, dead: 0,
              status: { new: 0, interested: 0, callback: 0, not_interested: 0, no_response: 0, wrong_number: 0, not_eligible: 0, converted: 0 } as Record<string, number>,
              firstMs: 0, lastMs: 0,
            };
            groups.set(key, g);
          }
          return g;
        };
        const DEAD = new Set(["not_interested", "no_response", "wrong_number", "not_eligible"]);
        leadsSnap.forEach((d) => {
          const l: any = d.data();
          const batchId = typeof l.importBatchId === "string" && l.importBatchId ? l.importBatchId : null;
          const name = typeof l.importName === "string" && l.importName ? l.importName : (batchId ? `Batch ${batchId}` : "Manually added");
          const g = groupFor(batchId ?? "__manual__:" + name, name, batchId);
          g.leads++;
          if (l.primaryOwnerId === "UNASSIGNED" || !l.primaryOwnerId) g.unassigned++;
          const st = (typeof l.leadStatus === "string" && l.leadStatus) ? l.leadStatus : "new";
          g.status[st] = (g.status[st] ?? 0) + 1;
          if (st === "converted") g.converted++;
          if (st === "interested" || st === "callback") g.interested++;
          if (DEAD.has(st)) g.dead++;
          if (l.firstContactedAt) g.attempted++;
          else if (st === "new" && l.primaryOwnerId && l.primaryOwnerId !== "UNASSIGNED") g.untouched++;
          const cMs = l.createdAt?.toMillis ? l.createdAt.toMillis() : 0;
          if (cMs && (!g.firstMs || cMs < g.firstMs)) g.firstMs = cMs;
          if (cMs > g.lastMs) g.lastMs = cMs;
        });
        const imports = [...groups.values()]
          .map((g) => ({
            ...g,
            attemptedPct: g.leads > 0 ? Math.round((g.attempted / g.leads) * 100) : 0,
            deadPct: g.attempted > 0 ? Math.round((g.dead / g.attempted) * 100) : 0,
          }))
          .sort((a, b) => b.lastMs - a.lastMs);
        return { imports, generatedAtMs: Date.now() };
      }));
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // ── Workload — who is handling what RIGHT NOW, across all three entity
  // types (old-model customers, CRM 2.0 leads, cases). One row per person;
  // managers/admins/SAs get the complete roster + the unassigned bucket.
  app.get("/api/crm/workload", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerDoc = await db.collection("users").doc(uid).get();
      const caller: any = callerDoc.data() ?? {};
      const allowed = caller.role === "admin" || isSuperAdmin(uid) || caller.crmRole === "manager";
      if (!allowed) return res.status(403).json({ error: "Forbidden" });
      const fresh = req.query.fresh === "1";

      return res.json(await cachedJson("workload", fresh, async () => {
        const [leadsSnap, casesSnap, usersSnap] = await Promise.all([
          db.collection("leads").get(),
          db.collection("cases").get(),
          db.collection("users").get(),
        ]);
        // "Open" definitions — mirrors the app's terminal sets.
        const OLD_CLOSED = new Set(["not_interested", "no_response", "wrong_number", "not_eligible", "converted"]);
        const CRM2_TERMINAL = new Set(["NOT_INTERESTED", "NOT_ELIGIBLE", "JUNK_DUPLICATE", "DROPPED", "CONVERTED"]);
        const CASE_DONE = new Set(["COMPLETED", "CLOSED"]);

        const byUid = new Map<string, { customers: number }>();
        const byFapl = new Map<string, { leads: number; cases: number; shared: number }>();
        const bump = <K, T extends Record<string, number>>(m: Map<K, T>, k: K, blank: T, f: keyof T) => {
          const cur = m.get(k) ?? { ...blank };
          (cur[f] as number)++;
          m.set(k, cur);
        };
        const unassigned = { customers: 0, leads: 0, cases: 0 };

        for (const d of leadsSnap.docs) {
          const l: any = d.data();
          if (l.receivedAt != null) {
            // CRM 2.0 lead
            if (l.converted === true || CRM2_TERMINAL.has(String(l.status ?? ""))) continue;
            if (typeof l.assignedRm === "string" && l.assignedRm) bump(byFapl, l.assignedRm, { leads: 0, cases: 0, shared: 0 }, "leads");
            else unassigned.leads++;
          } else {
            // old-model customer
            if (l.deleted === true) continue;
            if (OLD_CLOSED.has(String(l.leadStatus ?? ""))) continue;
            const owner = l.primaryOwnerId;
            if (typeof owner === "string" && owner && owner !== "UNASSIGNED") bump(byUid, owner, { customers: 0 }, "customers");
            else unassigned.customers++;
          }
        }
        for (const d of casesSnap.docs) {
          const c: any = d.data();
          if (CASE_DONE.has(String(c.stage ?? ""))) continue;
          if (typeof c.handlingRm === "string" && c.handlingRm) bump(byFapl, c.handlingRm, { leads: 0, cases: 0, shared: 0 }, "cases");
          else unassigned.cases++;
          for (const col of (Array.isArray(c.collaborators) ? c.collaborators : [])) {
            if (typeof col === "string" && col) bump(byFapl, col, { leads: 0, cases: 0, shared: 0 }, "shared");
          }
        }

        const rows: any[] = [];
        let idle = 0;
        for (const d of usersSnap.docs) {
          const u: any = d.data();
          if (u.employeeStatus === "inactive") continue;
          const own = byUid.get(d.id) ?? { customers: 0 };
          const fap = (u.employeeId && byFapl.get(u.employeeId)) || { leads: 0, cases: 0, shared: 0 };
          const total = own.customers + fap.leads + fap.cases;
          const crmPerson = u.crmAccess === true || u.crmRole != null || total > 0;
          if (!crmPerson) continue;
          if (total === 0 && fap.shared === 0) { idle++; continue; }
          rows.push({
            uid: d.id, name: u.displayName ?? d.id,
            customers: own.customers, leads: fap.leads, cases: fap.cases, shared: fap.shared,
            total,
          });
        }
        rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
        return { rows, unassigned, idle };
      }));
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // ── Not-eligible register — every rejected customer/lead across BOTH models,
  // with the CIBIL score / reason, who marked it and when. Managers + admins +
  // super admins get the complete view; the data lives on the lead docs.
  app.get("/api/crm/not-eligible", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerDoc = await db.collection("users").doc(uid).get();
      const caller: any = callerDoc.data() ?? {};
      const allowed = caller.role === "admin" || isSuperAdmin(uid) || caller.crmRole === "manager";
      if (!allowed) return res.status(403).json({ error: "Forbidden" });
      const fresh = req.query.fresh === "1";

      return res.json(await cachedJson("noteligible", fresh, async () => {
        const [oldSnap, newSnap, usersSnap] = await Promise.all([
          db.collection("leads").where("leadStatus", "==", "not_eligible").get(),
          db.collection("leads").where("status", "==", "NOT_ELIGIBLE").get(),
          db.collection("users").get(),
        ]);
        const nameByUid = new Map<string, string>();
        const nameByFapl = new Map<string, string>();
        for (const d of usersSnap.docs) {
          const u: any = d.data();
          nameByUid.set(d.id, u.displayName ?? d.id);
          if (u.employeeId) nameByFapl.set(u.employeeId, u.displayName ?? u.employeeId);
        }
        const anyName = (v: string | null | undefined) =>
          v ? (nameByFapl.get(v) ?? nameByUid.get(v) ?? v) : null;
        const ms = (v: any) => (v?.toMillis ? v.toMillis() : null);

        const rows: any[] = [];
        for (const d of oldSnap.docs) {
          const l: any = d.data();
          if (l.deleted === true) continue;
          rows.push({
            id: d.id, model: "customer",
            name: l.displayName ?? d.id, mobile: l.phone ?? null,
            creditScore: l.creditScore ?? null, reason: l.notEligibleReason ?? null,
            markedBy: anyName(l.leadStatusBy), markedAt: ms(l.leadStatusAt) ?? ms(l.updatedAt),
            owner: anyName(l.primaryOwnerId),
            link: `/crm/leads/${d.id}`,
          });
        }
        for (const d of newSnap.docs) {
          const l: any = d.data();
          rows.push({
            id: d.id, model: "lead",
            name: l.name ?? l.leadCode ?? d.id, mobile: l.mobile ?? null,
            creditScore: l.creditScore ?? null, reason: l.notEligibleReason ?? null,
            markedBy: anyName(l.updatedBy), markedAt: ms(l.updatedAt),
            owner: anyName(l.assignedRm),
            link: "/crm/pipeline/leads",
          });
        }
        rows.sort((a, b) => (b.markedAt ?? 0) - (a.markedAt ?? 0));
        return { rows, total: rows.length };
      }));
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });


  // GET /api/crm/activity/summary?period=YYYY-MM[&uid=UID]
  // The outbound-call activity view for ONE person: tagged → attempted → outcome.
  // Powers /crm/my-activity. Anyone may view THEMSELVES; a CRM manager may view
  // anyone in their downline; admin/super-admin may view anyone. Pure aggregation
  // via Admin SDK over the person's owned leads + their logged activities (the
  // existing activities (by, at) collection-group index).
  app.get("/api/crm/activity/summary", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const q = req.query.period;
      const period = typeof q === "string" && /^\d{4}-\d{2}$/.test(q) ? q : new Date().toISOString().slice(0, 7);
      const reqUid = typeof req.query.uid === "string" && req.query.uid ? req.query.uid : uid;

      let target = uid;
      if (reqUid !== uid) {
        const callerDoc = await db.collection("users").doc(uid).get();
        const caller: any = callerDoc.data() ?? {};
        if (caller.role === "admin" || isSuperAdmin(uid)) target = reqUid;
        else if (caller.crmRole === "manager") {
          const usersSnap = await db.collection("users").get();
          const users = usersSnap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
          if (!computeDownline(users, uid).has(reqUid)) return res.status(403).json({ error: "Not your team member" });
          target = reqUid;
        } else return res.status(403).json({ error: "Forbidden" });
      }

      const startMs = periodStartMs(period);
      const endMs = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1).getTime();
      const TOUCH_TYPES = ["call", "whatsapp", "email", "meeting"];
      const [leadsSnap, actSnap, targetDoc] = await Promise.all([
        db.collection("leads").where("primaryOwnerId", "==", target).where("deleted", "==", false).get(),
        db.collectionGroup("activities").where("by", "==", target).orderBy("at", "desc").limit(5000).get(),
        db.collection("users").doc(target).get(),
      ]);

      // CRM 2.0 leads are keyed by assignedRm (the person's FAPL), not
      // primaryOwnerId — pull them too so the activity view reflects ALL the
      // leads this person actually handles (not just old-model customers).
      const targetFapl = (targetDoc.data()?.employeeId as string | undefined) ?? null;
      const crm2Snap = targetFapl
        ? await db.collection("leads").where("assignedRm", "==", targetFapl).get()
        : null;

      // Optional import filter: restrict everything (counts, statuses, untouched
      // list, and the activity log below) to leads from ONE import file — so
      // management can judge a specific data set. importNames is always the
      // person's full distinct list (for the dropdown), computed before filtering.
      const importFilter = typeof req.query.importName === "string" && req.query.importName ? req.query.importName : null;
      const importNamesSet = new Set<string>();
      const filteredLeadIds = importFilter ? new Set<string>() : null;

      // Owned customers: total tagged, tagged this period (when the data was
      // handed to them), attempted (first contact stamped), disposition mix, and
      // the untouched list — status still 'new' AND never contacted.
      const status: Record<string, number> = { new: 0, interested: 0, callback: 0, not_interested: 0, no_response: 0, wrong_number: 0, not_eligible: 0, converted: 0 };
      let tagged = 0, taggedInPeriod = 0, attempted = 0;
      const untouched: Array<{ leadId: string; name: string; taggedAtMs: number | null; importName: string | null }> = [];
      // Per-contact drill-down: clicking a status chip in the UI opens these.
      const contacts: Array<{ leadId: string; name: string; mobile: string | null; status: string; model: "customer" | "lead" }> = [];
      leadsSnap.forEach((d) => {
        const l: any = d.data();
        const leadImport = typeof l.importName === "string" && l.importName ? l.importName : null;
        if (leadImport) importNamesSet.add(leadImport);
        if (importFilter) {
          if (leadImport !== importFilter) return;
          filteredLeadIds!.add(d.id);
        }
        tagged++;
        const st = (typeof l.leadStatus === "string" && l.leadStatus) ? l.leadStatus : "new";
        status[st] = (status[st] ?? 0) + 1;
        contacts.push({ leadId: d.id, name: l.displayName ?? "Customer", mobile: l.phone ?? null, status: st, model: "customer" });
        const tMs = l.assignedToCurrentOwnerAt?.toMillis ? l.assignedToCurrentOwnerAt.toMillis()
          : (l.createdAt?.toMillis ? l.createdAt.toMillis() : 0);
        if (tMs >= startMs && tMs < endMs) taggedInPeriod++;
        if (l.firstContactedAt) attempted++;
        else if (st === "new") untouched.push({ leadId: d.id, name: l.displayName ?? "Lead", taggedAtMs: tMs || null, importName: l.importName ?? null });
      });
      // CRM 2.0 leads have no importName → skip entirely under an import filter
      // (imports are an old-model concept), but always count them otherwise.
      if (crm2Snap && !importFilter) {
        crm2Snap.forEach((d) => {
          const l: any = d.data();
          tagged++;
          const bucket = leadBucket(l);   // single source: src/lib/crm2/leadModel.ts
          status[bucket] = (status[bucket] ?? 0) + 1;
          contacts.push({ leadId: d.id, name: l.name ?? l.leadCode ?? "Lead", mobile: l.mobile ?? null, status: bucket, model: "lead" });
          const tMs = l.receivedAt?.toMillis ? l.receivedAt.toMillis() : 0;
          if (tMs >= startMs && tMs < endMs) taggedInPeriod++;
          if (l.firstContactedAt) attempted++;
          else if (bucket === "new") untouched.push({ leadId: d.id, name: l.name ?? l.leadCode ?? "Lead", taggedAtMs: tMs || null, importName: null });
        });
      }
      untouched.sort((a, b) => (a.taggedAtMs ?? 0) - (b.taggedAtMs ?? 0)); // oldest data first

      // Activity in the period: counts by type, per-IST-day outreach, unique
      // customers touched, and a recent drill-down list.
      const byType: Record<string, number> = { call: 0, whatsapp: 0, email: 0, meeting: 0, note: 0, status_change: 0 };
      const daily = new Map<string, number>();
      const touchedLeads = new Set<string>();
      const recent: any[] = [];
      actSnap.forEach((d) => {
        const a: any = d.data();
        const atMs = a.at?.toMillis ? a.at.toMillis() : 0;
        if (atMs < startMs || atMs >= endMs) return;
        const type = typeof a.type === "string" ? a.type : "note";
        const segs = d.ref.path.split("/");
        const leadId = segs[0] === "leads" ? segs[1] : null;
        // Import filter also scopes the activity log — only touches on that
        // import's leads count.
        if (filteredLeadIds && (!leadId || !filteredLeadIds.has(leadId))) return;
        byType[type] = (byType[type] ?? 0) + 1;
        if (TOUCH_TYPES.includes(type)) {
          if (leadId) touchedLeads.add(leadId);
          const istDay = new Date(atMs + 330 * 60000).toISOString().slice(0, 10);
          daily.set(istDay, (daily.get(istDay) ?? 0) + 1);
        }
        if (recent.length < 150) recent.push({ leadId, type, atMs, content: typeof a.content === "string" ? a.content.slice(0, 140) : "" });
      });
      const nameById = new Map(leadsSnap.docs.map((d) => [d.id, (d.data() as any).displayName ?? "Customer"]));
      for (const r of recent) r.leadName = (r.leadId && nameById.get(r.leadId)) || "Customer";

      return res.json({
        period, uid: target, name: targetDoc.data()?.displayName ?? "—",
        importFilter, importNames: [...importNamesSet].sort(),
        tagged, taggedInPeriod, attempted, status,
        untouchedCount: untouched.length, untouched: untouched.slice(0, 100),
        byType, totalTouches: TOUCH_TYPES.reduce((s, t) => s + byType[t], 0),
        uniqueCustomersTouched: touchedLeads.size,
        daily: [...daily.entries()].sort().map(([date, count]) => ({ date, count })),
        recent,
        contacts: contacts.slice(0, 2000),
      });
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // ─── CRM Meetings → the SCHEDULER's own Google Calendar ──────────────────────
  // POST /api/crm/meetings — ANY CRM user can schedule a meeting against a customer.
  // The event lands on the SCHEDULER's own Workspace calendar (impersonated via DWD);
  // the customer's RM is added as a guest when they're not the scheduler, so the
  // owner stays in the loop. Also writes /crm_meetings + a 'meeting' activity.
  // Calendar sync is non-fatal: the meeting saves regardless.
  app.post("/api/crm/meetings", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const { leadId, title, startAt, durationMins, location, notes } = req.body ?? {};
      if (typeof leadId !== "string" || !leadId) return res.status(400).json({ error: "leadId required" });
      if (typeof startAt !== "string" || isNaN(Date.parse(startAt))) return res.status(400).json({ error: "valid startAt (ISO) required" });

      const leadSnap = await db.collection("leads").doc(leadId).get();
      if (!leadSnap.exists) return res.status(404).json({ error: "Lead not found" });
      const lead: any = leadSnap.data();

      // Authz: anyone with CRM access (company-wide), not just the lead's RM.
      const callerDoc = await db.collection("users").doc(uid).get();
      const caller = callerDoc.data();
      const allowed = caller?.role === "admin" || caller?.crmAccess === true;
      if (!allowed) return res.status(403).json({ error: "CRM access required to schedule a meeting" });

      // The meeting lands on the SCHEDULER's calendar (ownerId = the caller).
      const schedulerEmail = (await admin.auth().getUser(uid).catch(() => null))?.email ?? null;
      // The customer's RM becomes a guest when different from the scheduler.
      const rmId: string | null = (lead.primaryOwnerId && lead.primaryOwnerId !== "UNASSIGNED") ? lead.primaryOwnerId : null;
      const rmEmail = (rmId && rmId !== uid) ? (await admin.auth().getUser(rmId).catch(() => null))?.email ?? null : null;

      const dur = Number.isFinite(durationMins) && durationMins > 0 ? Math.min(480, durationMins) : 30;
      const startMs = Date.parse(startAt);
      const endAt = new Date(startMs + dur * 60000).toISOString();
      const meetingTitle = (typeof title === "string" && title.trim()) ? title.trim().slice(0, 200) : `Meeting · ${lead.displayName ?? "Customer"}`;

      // Try the calendar insert on the scheduler's calendar (non-fatal).
      let calendarEventId: string | null = null;
      let calendarSyncStatus: "synced" | "failed" | "skipped" = "skipped";
      if (schedulerEmail && !useEmulator) {
        try {
          const calendar = getCalendarClient(schedulerEmail);
          const ev = await calendar.events.insert({
            calendarId: "primary",
            sendUpdates: rmEmail ? "all" : "none",   // invite the RM guest if present (internal only)
            requestBody: {
              summary: meetingTitle,
              description: `Customer: ${lead.displayName ?? "-"}\nPhone: ${lead.phone ?? "-"}\n${notes ? `Notes: ${notes}\n` : ""}\nOpen in Pulse: https://pulse.finvastra.com/crm/leads/${leadId}\n\n— Scheduled via Finvastra Pulse`,
              start: { dateTime: startAt, timeZone: "Asia/Kolkata" },
              end:   { dateTime: endAt,   timeZone: "Asia/Kolkata" },
              ...(typeof location === "string" && location ? { location } : {}),
              ...(rmEmail ? { attendees: [{ email: rmEmail }] } : {}),
              reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }, { method: "email", minutes: 30 }] },
            },
          });
          calendarEventId = ev.data.id ?? null;
          calendarSyncStatus = calendarEventId ? "synced" : "failed";
        } catch (e) {
          console.error("[meetings] calendar insert failed", String(e));
          calendarSyncStatus = "failed";
        }
      }

      const meetingRef = db.collection("crm_meetings").doc();
      await meetingRef.set({
        leadId, leadName: lead.displayName ?? "",
        ownerId: uid, ownerEmail: schedulerEmail,   // ownerId = the scheduler (whose calendar holds it)
        leadOwnerId: rmId,                            // the customer's RM (guest), for traceability
        title: meetingTitle, startAt, endAt,
        ...(typeof location === "string" && location ? { location } : { location: null }),
        ...(typeof notes === "string" && notes ? { notes: notes.slice(0, 2000) } : { notes: null }),
        status: "scheduled",
        calendarEventId, calendarSyncStatus, reminderSent: false,
        createdBy: uid, createdByName: caller?.displayName ?? "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const whenStr = new Date(startMs).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
      // Activity trail on the lead.
      db.collection("leads").doc(leadId).collection("activities").add({
        type: "meeting",
        content: `📅 Meeting scheduled for ${whenStr}${meetingTitle ? ` — ${meetingTitle}` : ""}`,
        by: uid, byName: caller?.displayName ?? "", at: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
      // Bell to the scheduler (it's on their calendar).
      db.collection("notifications").doc(uid).collection("items").add({
        type: "follow_up_needed",
        title: `Meeting scheduled — ${lead.displayName ?? "Customer"}`,
        body: `${whenStr}${calendarSyncStatus === "synced" ? " · added to your Google Calendar" : ""}`,
        link: `/crm/leads/${leadId}`, read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
      // Bell to the customer's RM when a colleague scheduled it.
      if (rmId && rmId !== uid) {
        db.collection("notifications").doc(rmId).collection("items").add({
          type: "follow_up_needed",
          title: `Meeting on your customer — ${lead.displayName ?? "Customer"}`,
          body: `${caller?.displayName ?? "A colleague"} scheduled a meeting for ${whenStr}${rmEmail ? " · you're invited" : ""}`,
          link: `/crm/leads/${leadId}`, read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});
      }

      return res.json({ ok: true, id: meetingRef.id, calendarSyncStatus });
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // PATCH /api/crm/meetings/:id — reschedule / mark done / cancel (+ sync the event).
  app.patch("/api/crm/meetings/:id", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const ref = db.collection("crm_meetings").doc(req.params.id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Meeting not found" });
      const m: any = snap.data();
      const callerDoc = await db.collection("users").doc(uid).get();
      const callerIsAdmin = callerDoc.data()?.role === "admin";
      let allowed = callerIsAdmin || uid === m.ownerId || uid === m.createdBy;
      if (!allowed && m.ownerId) {
        const ownerDoc = await db.collection("users").doc(m.ownerId).get();
        allowed = ownerDoc.data()?.reportingManagerUid === uid;
      }
      if (!allowed) return res.status(403).json({ error: "Not allowed" });

      const { startAt, durationMins, status, location, notes } = req.body ?? {};
      const update: any = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      let newStart = m.startAt, newEnd = m.endAt;
      if (typeof startAt === "string" && !isNaN(Date.parse(startAt))) {
        newStart = startAt;
        const dur = Number.isFinite(durationMins) && durationMins > 0 ? durationMins : Math.max(15, Math.round((Date.parse(m.endAt) - Date.parse(m.startAt)) / 60000) || 30);
        newEnd = new Date(Date.parse(startAt) + dur * 60000).toISOString();
        update.startAt = newStart; update.endAt = newEnd;
      }
      if (status === "scheduled" || status === "done" || status === "cancelled") update.status = status;
      if (typeof location === "string") update.location = location || null;
      if (typeof notes === "string") update.notes = notes.slice(0, 2000) || null;

      // Mirror to the calendar (best-effort).
      if (m.ownerEmail && m.calendarEventId && !useEmulator) {
        try {
          const calendar = getCalendarClient(m.ownerEmail);
          if (update.status === "cancelled") {
            await calendar.events.delete({ calendarId: "primary", eventId: m.calendarEventId });
            update.calendarEventId = null; update.calendarSyncStatus = "skipped";
          } else if (update.startAt) {
            await calendar.events.patch({
              calendarId: "primary", eventId: m.calendarEventId,
              requestBody: { start: { dateTime: newStart, timeZone: "Asia/Kolkata" }, end: { dateTime: newEnd, timeZone: "Asia/Kolkata" } },
            });
          }
        } catch (e) { console.error("[meetings] calendar patch failed", String(e)); }
      }

      await ref.update(update);
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // POST /api/admin/run-weekly-team-digest (OIDC or admin). Fridays — bell + email per manager.
  app.post("/api/admin/run-weekly-team-digest", async (req, res) => {
    if (!(await requireAdminOrScheduler(req, res))) return;
    if (!(await notificationsEnabled("weekly_team_digest"))) return res.json({ ok: true, skipped: "notifications_disabled" });
    try {
      const period = new Date().toISOString().slice(0, 7);
      const usersSnap = await db.collection("users").get();
      const users = usersSnap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
      const managers = users.filter((u: any) =>
        u.employeeStatus !== "inactive" &&
        users.some((r: any) => r.reportingManagerUid === u.uid && r.employeeStatus !== "inactive"));
      const fmt = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
      let sent = 0;
      for (const mgr of managers as any[]) {
        const summary = await computeTeamSummary(mgr.uid, period);
        if (summary.members.length === 0) continue;
        const t = summary.totals;
        await db.collection("notifications").doc(mgr.uid).collection("items").add({
          type: "follow_up_needed",
          title: "Weekly team review",
          body: `${summary.members.length} reports · ${t.dueCallbacks} callbacks due · ${t.overdueSla} SLA breaches · ${fmt(t.disbursalAmount)} disbursed`,
          link: "/crm/team",
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});
        const authUser = await admin.auth().getUser(mgr.uid).catch(() => null);
        if (authUser?.email) {
          const html = buildBrandEmail({
            title: "Your weekly team review",
            intro: `Performance snapshot for your team of ${summary.members.length} for ${period}.`,
            rows: [
              { label: "Disbursed this month", value: fmt(t.disbursalAmount) },
              { label: "Open pipeline", value: `${fmt(t.pipelineValue)} (${t.openOpps} deals)` },
              { label: "Callbacks due now", value: String(t.dueCallbacks) },
              { label: "Leads past SLA", value: String(t.overdueSla) },
              { label: "Total active leads", value: String(t.leads) },
            ],
            note: (t.dueCallbacks + t.overdueSla) > 0
              ? `${t.dueCallbacks} customers are waiting on a scheduled callback and ${t.overdueSla} leads have breached SLA. Review these with your team today.`
              : undefined,
            ctaLabel: "Open Team dashboard",
            ctaLink: "https://pulse.finvastra.com/crm/team",
          });
          await sendGmailMessage(authUser.email, "Finvastra Pulse — Weekly team review", html).catch(() => {});
        }
        sent++;
      }
      return res.json({ managers: managers.length, sent });
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // ─── PART 2 — Smart follow-up reminders ──────────────────────────────────────
  // POST /api/admin/run-followup-check (OIDC or admin). Daily 09:00 IST.
  app.post("/api/admin/run-followup-check", async (req, res) => {
    if (!(await requireAdminOrScheduler(req, res))) return;
    if (!(await notificationsEnabled("followup_reminders"))) return res.json({ ok: true, skipped: "notifications_disabled" });
    try {
      const now = Date.now();
      const staleCutoff = now - 3 * 86400000;

      // Active = lead has at least one open opportunity
      const openOpps = await db.collectionGroup("opportunities").where("status", "==", "open").get();
      const activeLeadIds = new Set<string>();
      openOpps.forEach((d) => { const id = d.ref.parent.parent?.id; if (id) activeLeadIds.add(id); });

      // Dedup — leads already logged today
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const logs = await db.collection("follow_up_logs").where("sentAt", ">=", admin.firestore.Timestamp.fromDate(todayStart)).get();
      const alreadyToday = new Set<string>();
      logs.forEach((d) => ((d.data().leadIds ?? []) as string[]).forEach((id) => alreadyToday.add(id)));

      const leadsSnap = await db.collection("leads").where("deleted", "==", false).get();
      const byRm = new Map<string, Array<{ id: string; name: string; daysSince: number; lastType: string }>>();
      let processed = 0;
      for (const d of leadsSnap.docs) {
        const id = d.id; const l: any = d.data();
        if (!activeLeadIds.has(id) || alreadyToday.has(id)) continue;
        processed++;
        const { atMs, type } = await latestActivity(id);
        if (atMs > staleCutoff) continue;
        const rm = l.primaryOwnerId;
        if (!rm || rm === "UNASSIGNED") continue;
        const daysSince = atMs ? Math.floor((now - atMs) / 86400000) : 999;
        if (!byRm.has(rm)) byRm.set(rm, []);
        byRm.get(rm)!.push({ id, name: l.displayName ?? "Lead", daysSince, lastType: type });
      }

      let notified = 0, emails = 0;
      for (const [rm, leads] of byRm) {
        for (const ld of leads) {
          await db.collection("notifications").doc(rm).collection("items").add({
            type: "follow_up_needed",
            title: `Follow-up needed — ${ld.name}`,
            body: `No activity for ${ld.daysSince} days. Last: ${ld.lastType}`,
            link: `/crm/leads/${ld.id}`,
            read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          }).catch(() => {});
          notified++;
        }
        const authUser = await admin.auth().getUser(rm).catch(() => null);
        if (authUser?.email) {
          const html = buildBrandEmail({
            title: "Leads need follow-up",
            intro: `You have ${leads.length} lead(s) with no recent activity.`,
            rows: leads.map((ld) => ({ label: ld.name, value: `${ld.daysSince}d silent · last: ${ld.lastType}` })),
            ctaLabel: "Open My Queue", ctaLink: "https://pulse.finvastra.com/crm/my-queue",
          });
          await sendGmailMessage(authUser.email, `Action needed — ${leads.length} leads need follow-up`, html).catch(() => {});
          emails++;
        }
        await db.collection("follow_up_logs").add({
          rmId: rm, leadIds: leads.map((l) => l.id),
          sentAt: admin.firestore.FieldValue.serverTimestamp(), staleCount: leads.length,
        });
      }
      return res.json({ processed, notified, emails_sent: emails });
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // ─── Callback reminders — fire when a scheduled callback time arrives ─────────
  // POST /api/admin/run-callback-reminders (OIDC or admin). Run every ~15 min.
  app.post("/api/admin/run-callback-reminders", async (req, res) => {
    if (!(await requireAdminOrScheduler(req, res))) return;
    if (!(await notificationsEnabled("callback_reminders"))) return res.json({ ok: true, skipped: "notifications_disabled" });
    try {
      const nowMs = Date.now();
      const LEAD_MS = 15 * 60 * 1000;   // fire ~15 minutes BEFORE the scheduled callback
      const snap = await db.collection("leads")
        .where("leadStatus", "==", "callback")
        .where("deleted", "==", false)
        .get();
      let notified = 0;
      for (const d of snap.docs) {
        const l: any = d.data();
        if (l.callbackReminderSent === true) continue;
        if (typeof l.callbackAt !== "string") continue;
        const cbMs = new Date(l.callbackAt).getTime();
        if (isNaN(cbMs) || cbMs > nowMs + LEAD_MS) continue; // more than 15 min away → not yet
        const rm = l.primaryOwnerId;
        if (!rm || rm === "UNASSIGNED") continue;

        await db.collection("notifications").doc(rm).collection("items").add({
          type:      "follow_up_needed",
          title:     `Callback soon — ${l.displayName ?? "Lead"}`,
          body:      "Your scheduled callback is in about 15 minutes.",
          link:      `/crm/leads/${d.id}`,
          read:      false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});

        const authUser = await admin.auth().getUser(rm).catch(() => null);
        if (authUser?.email) {
          const html = buildBrandEmail({
            title: "Callback coming up",
            intro: `Your scheduled callback for ${l.displayName ?? "a lead"} is in about 15 minutes.`,
            rows: [
              { label: "Customer", value: l.displayName ?? "-" },
              { label: "Phone", value: l.phone ?? "-" },
            ],
            ctaLabel: "Open lead", ctaLink: `https://pulse.finvastra.com/crm/leads/${d.id}`,
          });
          await sendGmailMessage(authUser.email, `Callback soon — ${l.displayName ?? "Lead"}`, html).catch(() => {});
        }

        await d.ref.update({ callbackReminderSent: true });
        notified++;
      }
      return res.json({ checked: snap.size, notified });
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // ─── CRM 2.0 Lead follow-up reminders (Phase 3) ───────────────────────────────
  // POST /api/admin/run-crm2-followup-reminders (OIDC or admin). Run every ~15 min.
  // New-model leads (receivedAt) carry `nextFollowUpAt` (Timestamp) + an optional
  // `nextFollowUpNote` (the remark, emailed). assignedRm is a FAPL code → resolve to
  // the user's uid+email. Deduped via `followUpReminderSent` (re-armed on edit).
  app.post("/api/admin/run-crm2-followup-reminders", async (req, res) => {
    if (!(await requireAdminOrScheduler(req, res))) return;
    if (!(await notificationsEnabled("crm2_followup_reminders"))) return res.json({ ok: true, skipped: "notifications_disabled" });
    try {
      const now = Date.now();
      const snap = await db.collection("leads").where("followUpReminderSent", "==", false).get();
      const faplCache = new Map<string, { uid: string; email: string | null } | null>();
      const resolveRm = async (fapl: string) => {
        if (faplCache.has(fapl)) return faplCache.get(fapl)!;
        const u = await db.collection("users").where("employeeId", "==", fapl).limit(1).get();
        const hit = u.empty ? null : { uid: u.docs[0].id, email: (u.docs[0].data().email as string | undefined) ?? null };
        faplCache.set(fapl, hit);
        return hit;
      };
      let notified = 0;
      for (const d of snap.docs) {
        const l: any = d.data();
        if (l.converted === true) continue;
        const due = l.nextFollowUpAt?.toMillis ? l.nextFollowUpAt.toMillis() : null;
        if (due === null || due > now) continue;            // not due yet / no follow-up set
        const fapl = l.assignedRm;
        if (!fapl) continue;
        const rm = await resolveRm(String(fapl));
        if (!rm) { await d.ref.update({ followUpReminderSent: true }).catch(() => {}); continue; }

        await db.collection("notifications").doc(rm.uid).collection("items").add({
          type:      "follow_up_needed",
          title:     `Follow up now — ${l.name ?? "Lead"}`,
          body:      l.nextFollowUpNote ? String(l.nextFollowUpNote).slice(0, 140) : "Your scheduled follow-up is due.",
          link:      `/crm/pipeline/leads`,
          read:      false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});

        if (rm.email) {
          const html = buildBrandEmail({
            title: "Time to follow up",
            intro: `Your scheduled follow-up for ${l.name ?? "a lead"} is due now.`,
            rows: [
              { label: "Lead", value: l.name ?? "-" },
              { label: "Mobile", value: l.mobile ?? "-" },
              ...(l.nextFollowUpNote ? [{ label: "Your note", value: String(l.nextFollowUpNote) }] : []),
            ],
            ctaLabel: "Open Pipeline Leads", ctaLink: "https://pulse.finvastra.com/crm/pipeline/leads",
          });
          await sendGmailMessage(rm.email, `Follow up now — ${l.name ?? "Lead"}`, html).catch(() => {});
        }

        await d.ref.update({ followUpReminderSent: true });
        notified++;
      }

      // ── Partner candidates (connectors in the intake funnel) ─────────────────
      // Same contract: nextFollowUpAt due + reminder not yet sent → bell + email.
      // Audience = super admins (screening lives in the SA-only Masters screen).
      let partnerNotified = 0;
      const connSnap = await db.collection("connectors")
        .where("followUpReminderSent", "==", false).get();
      const saUids = [...new Set(SUPER_ADMIN_UIDS_LIST)];
      for (const d of connSnap.docs) {
        const c: any = d.data();
        if (c.deleted === true) continue;
        if (!c.funnelStatus || ["Active", "Rejected"].includes(String(c.funnelStatus))) continue;
        const due = c.nextFollowUpAt?.toMillis ? c.nextFollowUpAt.toMillis() : null;
        if (due === null || due > now) continue;
        for (const uid of saUids) {
          await db.collection("notifications").doc(uid).collection("items").add({
            type: "partner_candidate",
            title: `Partner follow-up due — ${c.displayName ?? "Candidate"}`,
            body: c.nextFollowUpNote ? String(c.nextFollowUpNote).slice(0, 140) : "They asked to be contacted again — the follow-up is due now.",
            link: "/crm/pipeline/masters",
            read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          }).catch(() => {});
          try {
            const u = await admin.auth().getUser(uid);
            if (u.email) {
              const html = buildBrandEmail({
                title: "Partner follow-up due",
                intro: `You scheduled a follow-up with partner candidate ${c.displayName ?? "-"} (${c.connectorCode ?? "-"}) — it's due now.`,
                rows: [
                  { label: "Candidate", value: c.displayName ?? "-" },
                  { label: "Code", value: c.connectorCode ?? "-" },
                  { label: "Mobile", value: c.mobile ?? "-" },
                  ...(c.nextFollowUpNote ? [{ label: "Your note", value: String(c.nextFollowUpNote) }] : []),
                ],
                ctaLabel: "Open Connectors", ctaLink: "https://pulse.finvastra.com/crm/pipeline/masters",
              });
              await sendGmailMessage(u.email, `Partner follow-up due — ${c.displayName ?? "Candidate"}`, html).catch(() => {});
            }
          } catch { /* no auth user / email — bell already delivered */ }
        }
        await d.ref.update({ followUpReminderSent: true }).catch(() => {});
        partnerNotified++;
      }

      // ── Ad-hoc task reminders (crm_tasks) — due within 15 min or overdue ─────
      // Bell + email the assignee once per due time (reminderSent re-arms when
      // the task's dueAt changes). Open tasks are few → whole-collection filter.
      let taskNotified = 0;
      const taskSnap = await db.collection("crm_tasks").where("status", "==", "open").get();
      for (const d of taskSnap.docs) {
        const t: any = d.data();
        if (t.reminderSent === true) continue;
        const due = t.dueAt?.toMillis ? t.dueAt.toMillis() : null;
        if (due === null || due > now + 15 * 60_000) continue;
        const uid = t.assignedTo as string | undefined;
        if (!uid) { await d.ref.update({ reminderSent: true }).catch(() => {}); continue; }
        const label = String(t.title || t.text || "task").slice(0, 60);

        await db.collection("notifications").doc(uid).collection("items").add({
          type:      "task_assigned",
          title:     `Task due — ${label}`,
          body:      "Your task is due now. Open Tasks to mark it done.",
          link:      "/crm/tasks",
          read:      false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});

        try {
          const uDoc = await db.collection("users").doc(uid).get();
          const email = uDoc.data()?.email as string | undefined;
          if (email) {
            const html = buildBrandEmail({
              title: "Task reminder",
              intro: "A task on your Pulse To-Do list is due.",
              rows: [
                { label: "Task", value: String(t.title || t.text || "-").slice(0, 300) },
                ...(t.createdByName && t.createdBy !== uid ? [{ label: "From", value: String(t.createdByName) }] : []),
              ],
              ctaLabel: "Open Tasks", ctaLink: "https://pulse.finvastra.com/crm/tasks",
            });
            await sendGmailMessage(email, `Task due — ${label}`, html).catch(() => {});
          }
        } catch { /* bell already delivered */ }

        await d.ref.update({ reminderSent: true }).catch(() => {});
        taskNotified++;
      }

      return res.json({ checked: snap.size, notified, partnerChecked: connSnap.size, partnerNotified, taskChecked: taskSnap.size, taskNotified });
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // ─── Meeting reminders — fire ~30 min before a scheduled CRM meeting ──────────
  // POST /api/admin/run-meeting-reminders (OIDC or admin). Run every ~15 min.
  // Bell + email to the RM. The Google Calendar event carries its own native
  // reminders too; this is the in-app/Pulse channel. Deduped via reminderSent.
  app.post("/api/admin/run-meeting-reminders", async (req, res) => {
    if (!(await requireAdminOrScheduler(req, res))) return;
    if (!(await notificationsEnabled("meeting_reminders"))) return res.json({ ok: true, skipped: "notifications_disabled" });
    try {
      const nowMs = Date.now();
      const LEAD_MS = 30 * 60000;   // fire when start is within the next 30 min
      const GRACE_MS = 60 * 60000;  // don't fire for meetings already >1h past
      // Single equality filter (status) → auto-indexed; time/reminderSent filtered in memory.
      const snap = await db.collection("crm_meetings").where("status", "==", "scheduled").get();
      let notified = 0;
      for (const d of snap.docs) {
        const mt: any = d.data();
        if (mt.reminderSent === true) continue;
        const startMs = typeof mt.startAt === "string" ? Date.parse(mt.startAt) : 0;
        if (!startMs) continue;
        if (startMs - nowMs > LEAD_MS) continue;   // too early
        if (startMs < nowMs - GRACE_MS) { await d.ref.update({ reminderSent: true }); continue; } // stale — close it out
        const rm = mt.ownerId;
        if (!rm) continue;

        db.collection("notifications").doc(rm).collection("items").add({
          type: "follow_up_needed",
          title: `Meeting soon — ${mt.leadName ?? "Customer"}`,
          body: `Starts ${new Date(startMs).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`,
          link: `/crm/leads/${mt.leadId}`, read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});

        const email = mt.ownerEmail ?? (await admin.auth().getUser(rm).catch(() => null))?.email;
        if (email) {
          const html = buildBrandEmail({
            title: "Meeting reminder",
            intro: `Your meeting with ${mt.leadName ?? "a customer"} starts soon.`,
            rows: [
              { label: "Customer", value: mt.leadName ?? "-" },
              { label: "When", value: new Date(startMs).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" }) },
              ...(mt.location ? [{ label: "Location", value: String(mt.location) }] : []),
            ],
            ctaLabel: "Open customer", ctaLink: `https://pulse.finvastra.com/crm/leads/${mt.leadId}`,
          });
          await sendGmailMessage(email, `Meeting soon — ${mt.leadName ?? "Customer"}`, html).catch(() => {});
        }
        await d.ref.update({ reminderSent: true });
        notified++;
      }
      return res.json({ checked: snap.size, notified });
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // ─── PART 3 — Daily RM briefing email ────────────────────────────────────────
  // POST /api/admin/run-daily-briefing (OIDC or admin). Daily 08:30 IST.
  app.post("/api/admin/run-daily-briefing", async (req, res) => {
    if (!(await requireAdminOrScheduler(req, res))) return;
    if (!(await notificationsEnabled("daily_briefing"))) return res.json({ ok: true, skipped: "notifications_disabled" });
    try {
      const now = Date.now();
      const d0 = new Date();
      const period = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}`;
      const daysLeft = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate() - d0.getDate();

      const usersSnap = await db.collection("users").get();
      const rms = usersSnap.docs.filter((d) => activeRmFilter(d.data()));
      let sent = 0;
      for (const rmDoc of rms) {
        const uid = rmDoc.id; const u: any = rmDoc.data();
        const leadsSnap = await db.collection("leads").where("primaryOwnerId", "==", uid).where("deleted", "==", false).get();
        if (leadsSnap.empty) continue; // new joiner — skip

        const overdue: Array<{ name: string; hours: number }> = [];
        leadsSnap.forEach((d) => {
          const l: any = d.data(); const dl = l.slaDeadline?.toMillis ? l.slaDeadline.toMillis() : 0;
          if (dl && dl < now) overdue.push({ name: l.displayName ?? "Lead", hours: Math.floor((now - dl) / 3600000) });
        });
        overdue.sort((a, b) => b.hours - a.hours);

        const stale: Array<{ name: string; daysSince: number }> = [];
        for (const d of leadsSnap.docs) {
          const { atMs } = await latestActivity(d.id);
          if (atMs <= now - 3 * 86400000) stale.push({ name: (d.data() as any).displayName ?? "Lead", daysSince: atMs ? Math.floor((now - atMs) / 86400000) : 999 });
        }

        const tSnap = await db.collection("rm_targets").doc(`${uid}_${period}`).get();
        const target: any = tSnap.exists ? tSnap.data() : null;
        const actuals = await computeActualsServer(uid, period);
        const disbTarget = target?.targets?.disbursalAmount ?? 0;
        const disbPct = disbTarget > 0 ? Math.min(100, Math.round((actuals.disbursalAmount / disbTarget) * 100)) : 0;
        const convTarget = target?.targets?.leadsConverted ?? 0;

        let action: string;
        if (overdue.length) action = `Call ${overdue[0].name} — SLA overdue by ${overdue[0].hours}h`;
        else if (stale.length) action = `Follow up with ${stale[0].name} — ${stale[0].daysSince} days silent`;
        else if (disbTarget > 0 && disbPct < 50 && daysLeft < 15) action = "Focus on conversions — below 50% with under 15 days left";
        else action = "Good pace — keep going";

        const authUser = await admin.auth().getUser(uid).catch(() => null);
        if (authUser?.email) {
          const dayStr = d0.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
          const html = buildBrandEmail({
            title: `Good morning, ${u.displayName ?? "there"}`,
            intro: "Here is your day at a glance.",
            rows: [
              { label: "SLA Overdue", value: `${overdue.length} leads` },
              { label: "Need Follow-up", value: `${stale.length} leads` },
              { label: "Disbursals this month", value: `${inr(actuals.disbursalAmount)} / ${inr(disbTarget)} (${disbPct}%)` },
              { label: "Conversions", value: `${actuals.leadsConverted} / ${convTarget}` },
            ],
            note: action,
            ctaLabel: "Open My Queue", ctaLink: "https://pulse.finvastra.com/crm/my-queue",
          });
          sendGmailMessage(authUser.email, `Your Finvastra Pulse Briefing — ${dayStr}`, html).catch(() => {});
          sent++;
        }
      }
      return res.json({ rms: rms.length, emails_sent: sent });
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // ─── PART 5 — RM monthly scorecard PDF ───────────────────────────────────────
  async function generateAndDeliverScorecard(uid: string, period: string, generatedBy: string): Promise<{ storageUrl: string }> {
    const STORAGE_BUCKET = "gen-lang-client-0643641184.firebasestorage.app";
    const userDoc = await db.collection("users").doc(uid).get();
    const u: any = userDoc.data() ?? {};
    const empCode = u.empCode ?? u.employeeCode ?? uid;
    const rmName = u.displayName ?? uid;
    const designation = u.designation ?? "";
    const target: any = (await db.collection("rm_targets").doc(`${uid}_${period}`).get()).data();
    const actuals = await computeActualsServer(uid, period);

    // Pipeline snapshot (open opps for this RM)
    const oppsSnap = await db.collectionGroup("opportunities").where("status", "==", "open").get();
    const mine = oppsSnap.docs.filter((d) => (d.data() as any).ownerId === uid);
    const pipeline: Array<{ name: string; product: string; stage: string; value: number }> = [];
    for (const d of mine.slice(0, 30)) {
      const o: any = d.data(); const leadRef = d.ref.parent.parent;
      let name = "Lead";
      if (leadRef) { try { const ls = await leadRef.get(); name = (ls.data() as any)?.displayName ?? "Lead"; } catch { /* ignore */ } }
      pipeline.push({ name, product: o.product ?? "—", stage: o.stage ?? "—", value: Number(o.dealSize ?? 0) });
    }
    pipeline.sort((a, b) => b.value - a.value);

    // Activity summary (best-effort — needs a collection-group index on activities.by)
    let calls = 0, meetings = 0, leadsAdded = actuals.newLeads;
    try {
      const startMs = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1).getTime();
      const actSnap = await db.collectionGroup("activities").where("by", "==", uid).get();
      actSnap.forEach((d) => { const a: any = d.data(); const ms = a.at?.toMillis ? a.at.toMillis() : 0; if (ms >= startMs) { if (a.type === "call") calls++; if (a.type === "meeting") meetings++; } });
    } catch { /* index missing — leave zeros */ }

    // Metrics
    const metrics = [
      { label: "New Leads", target: target?.targets?.newLeads ?? 0, actual: actuals.newLeads, money: false },
      { label: "Conversions", target: target?.targets?.leadsConverted ?? 0, actual: actuals.leadsConverted, money: false },
      { label: "Disbursals", target: target?.targets?.disbursalAmount ?? 0, actual: actuals.disbursalAmount, money: true },
      { label: "Commission", target: target?.targets?.commissionGenerated ?? 0, actual: actuals.commissionGenerated, money: true },
    ];
    const pct = (a: number, t: number) => (t > 0 ? Math.min(100, Math.round((a / t) * 100)) : 0);
    const overall = Math.round(metrics.reduce((s, m) => s + pct(m.actual, m.target), 0) / metrics.length);

    // Build PDF
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default as any;
    const docp: any = new jsPDF();
    docp.setFillColor(11, 21, 56); docp.rect(0, 0, 210, 30, "F");
    docp.setTextColor(201, 169, 97); docp.setFontSize(16); docp.setFont("helvetica", "bold");
    docp.text("FINVASTRA ADVISORS PVT. LTD.", 14, 14);
    docp.setTextColor(255, 255, 255); docp.setFontSize(10); docp.setFont("helvetica", "normal");
    docp.text(`RM Performance Scorecard — ${period}`, 14, 22);

    docp.setTextColor(10, 10, 10); docp.setFontSize(12); docp.setFont("helvetica", "bold");
    docp.text(rmName, 14, 42);
    docp.setFontSize(9); docp.setFont("helvetica", "normal"); docp.setTextColor(90, 90, 90);
    docp.text(`${designation || "RM"}  ·  Emp ${empCode}  ·  Period ${period}`, 14, 48);
    docp.setFontSize(11); docp.setTextColor(11, 21, 56); docp.setFont("helvetica", "bold");
    docp.text(`Overall achievement: ${overall}%`, 14, 57);

    autoTable(docp, {
      startY: 64,
      head: [["Metric", "Target", "Actual", "Achievement %"]],
      body: metrics.map((m) => [m.label, m.money ? inr(m.target) : String(m.target), m.money ? inr(m.actual) : String(m.actual), `${pct(m.actual, m.target)}%`]),
      headStyles: { fillColor: [11, 21, 56], textColor: [201, 169, 97] },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.column.index === 3) {
          const p = pct(metrics[data.row.index].actual, metrics[data.row.index].target);
          data.cell.styles.textColor = p >= 100 ? [16, 122, 81] : p >= 75 ? [180, 130, 20] : [200, 50, 50];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });

    let y = (docp.lastAutoTable?.finalY ?? 90) + 10;
    docp.setFontSize(11); docp.setTextColor(11, 21, 56); docp.setFont("helvetica", "bold");
    docp.text("Pipeline snapshot (open)", 14, y); y += 2;
    autoTable(docp, {
      startY: y + 2,
      head: [["Deal", "Product", "Stage", "Value"]],
      body: pipeline.slice(0, 10).map((p) => [p.name, p.product, p.stage, inr(p.value)]),
      headStyles: { fillColor: [27, 42, 78], textColor: [255, 255, 255] },
      styles: { fontSize: 8 },
    });

    y = (docp.lastAutoTable?.finalY ?? y + 20) + 10;
    docp.setFontSize(11); docp.setTextColor(11, 21, 56); docp.setFont("helvetica", "bold");
    docp.text("Activity summary", 14, y);
    docp.setFontSize(9); docp.setFont("helvetica", "normal"); docp.setTextColor(60, 60, 60);
    docp.text(`Calls logged: ${calls}    Meetings: ${meetings}    Leads added: ${leadsAdded}`, 14, y + 7);

    docp.setFontSize(8); docp.setTextColor(140, 140, 140);
    docp.text(`Generated by Finvastra Pulse on ${new Date().toISOString().slice(0, 10)}`, 14, 285);

    const buf = Buffer.from(docp.output("arraybuffer"));
    const filename = `Scorecard_${empCode}_${period}.pdf`;
    const filePath = `scorecards/${uid}/${filename}`;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await getStorage().bucket(STORAGE_BUCKET).file(filePath).save(buf, {
      metadata: { contentType: "application/pdf", metadata: { firebaseStorageDownloadTokens: token } },
    });
    const storageUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;

    const b64 = buf.toString("base64");
    const html = buildBrandEmail({
      title: `Performance Scorecard — ${period}`,
      intro: `Hi ${rmName}, your monthly scorecard is attached. Overall achievement: ${overall}%.`,
      rows: metrics.map((m) => ({ label: m.label, value: `${m.money ? inr(m.actual) : m.actual} / ${m.money ? inr(m.target) : m.target} (${pct(m.actual, m.target)}%)` })),
      ctaLabel: "Open Targets", ctaLink: "https://pulse.finvastra.com/crm/targets",
    });
    const authUser = await admin.auth().getUser(uid).catch(() => null);
    if (authUser?.email) await sendGmailWithAttachment(authUser.email, `Your Finvastra Scorecard — ${period}`, html, { filename, base64: b64 }).catch(() => {});
    await sendGmailWithAttachment("rahulv@finvastra.com", `Scorecard — ${rmName} — ${period}`, html, { filename, base64: b64 }).catch(() => {});

    await db.collection("scorecard_logs").add({ rmId: uid, period, storageUrl, sentAt: admin.firestore.FieldValue.serverTimestamp(), generatedBy });
    return { storageUrl };
  }

  // POST /api/admin/run-monthly-scorecards (OIDC or admin). 1st of month 07:00 IST — prior month.
  app.post("/api/admin/run-monthly-scorecards", async (req, res) => {
    if (!(await requireAdminOrScheduler(req, res))) return;
    if (!(await notificationsEnabled("monthly_scorecards"))) return res.json({ ok: true, skipped: "notifications_disabled" });
    try {
      const pm = new Date(); pm.setDate(1); pm.setMonth(pm.getMonth() - 1);
      const period = `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, "0")}`;
      const usersSnap = await db.collection("users").get();
      const rms = usersSnap.docs.filter((d) => activeRmFilter(d.data()));
      // Respond immediately — generate in the background (PDF + email per RM is slow)
      res.json({ scheduled: rms.length, period });
      (async () => {
        for (const rmDoc of rms) {
          const leads = await db.collection("leads").where("primaryOwnerId", "==", rmDoc.id).where("deleted", "==", false).limit(1).get();
          if (leads.empty) continue; // skip RMs with no leads
          await generateAndDeliverScorecard(rmDoc.id, period, "scheduler").catch((e) => console.error("scorecard failed", rmDoc.id, e));
        }
      })().catch(() => {});
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // POST /api/admin/generate-scorecard/:uid/:period — manual single-RM (admin only).
  app.post("/api/admin/generate-scorecard/:uid/:period", async (req, res) => {
    const caller = await verifyFirebaseToken(req);
    if (!caller) return res.status(401).json({ error: "Unauthorized" });
    const cu = await db.collection("users").doc(caller).get();
    if (cu.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const { uid, period } = req.params;
    if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: "period must be YYYY-MM" });
    try {
      const result = await generateAndDeliverScorecard(uid, period, caller);
      return res.json(result);
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // ─── Public Application Tracker ──────────────────────────────────────────────
  // GET /api/track/:token — unauthenticated, returns minimal public-safe data
  app.get("/api/track/:token", async (req, res) => {
    const { token } = req.params;
    if (!token || token.length < 20) return res.status(400).json({ error: "Invalid link" });

    const linkSnap = await db.collection("public_tracker_links").doc(token).get();
    if (!linkSnap.exists) return res.status(404).json({ error: "Link not found or expired" });

    const link = linkSnap.data()!;

    // Check expiry
    const expiresAt = link.expiresAt?.toDate?.() ?? null;
    if (expiresAt && new Date() > expiresAt) {
      return res.status(410).json({ error: "This link has expired. Please contact your advisor." });
    }

    // Fetch submission + opportunity + lead
    const leadId = link.leadId, oppId = link.opportunityId, subId = link.submissionId;
    const [subSnap, oppSnap, leadSnap] = await Promise.all([
      db.collection("leads").doc(leadId).collection("opportunities").doc(oppId)
        .collection("bank_submissions").doc(subId).get(),
      db.collection("leads").doc(leadId).collection("opportunities").doc(oppId).get(),
      db.collection("leads").doc(leadId).get(),
    ]);

    if (!subSnap.exists || !oppSnap.exists || !leadSnap.exists) {
      return res.status(404).json({ error: "Application not found" });
    }

    const sub = subSnap.data()!, opp = oppSnap.data()!, lead = leadSnap.data()!;

    // Fetch provider name
    let bankName = "Bank";
    const providerSnap = await db.collection("providers").doc(sub.providerId).get();
    if (providerSnap.exists) bankName = providerSnap.data()!.name;

    // Sanitise: only return first name and non-PII data
    const fullName: string = lead.displayName ?? "Applicant";
    const firstName = fullName.split(" ")[0];

    const dealSize: number = opp.dealSize ?? 0;
    const ticketSizeL = Math.round(dealSize / 100000 * 10) / 10;

    // Expected decision date (submittedAt + 7 days as default)
    let expectedDecisionDate: string | null = null;
    if (sub.submittedAt?.toDate) {
      const exp = new Date(sub.submittedAt.toDate());
      exp.setDate(exp.getDate() + 7);
      expectedDecisionDate = exp.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    }

    const submittedDate = sub.submittedAt?.toDate
      ? sub.submittedAt.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : "";

    const lastUpdated = sub.updatedAt?.toDate
      ? sub.updatedAt.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : submittedDate;

    // Increment view count (fire-and-forget)
    linkSnap.ref.update({
      viewCount: admin.firestore.FieldValue.increment(1),
      lastViewedAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    return res.json({
      applicantFirstName: firstName,
      loanType: opp.product ?? "Loan",
      ticketSizeL,
      bankName,
      currentStatus: sub.status,
      submittedDate,
      expectedDecisionDate,
      referenceId: subId.slice(-8).toUpperCase(),
      lastUpdated,
    });
  });

  // POST /api/leads/:leadId/opportunities/:oppId/submissions/:subId/tracker-token
  // Generate (or retrieve) the public tracker token for a submission.
  app.post("/api/leads/:leadId/opportunities/:oppId/submissions/:subId/tracker-token", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { leadId, oppId, subId } = req.params;
    const subRef = db.collection("leads").doc(leadId).collection("opportunities").doc(oppId)
      .collection("bank_submissions").doc(subId);
    const subSnap = await subRef.get();
    if (!subSnap.exists) return res.status(404).json({ error: "Submission not found" });

    const existing = subSnap.data()!.publicTrackerToken;
    if (existing) {
      return res.json({ token: existing, url: `/track/${existing}` });
    }

    // Generate new token (32 random bytes → base64url)
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    await db.runTransaction(async (t) => {
      t.update(subRef, { publicTrackerToken: token });
      t.set(db.collection("public_tracker_links").doc(token), {
        submissionId: subId,
        leadId,
        opportunityId: oppId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        viewCount: 0,
        lastViewedAt: null,
      });
    });

    return res.json({ token, url: `/track/${token}` });
  });

  // ─── MIS: Statement Upload & Processing ──────────────────────────────────────

  // In-memory staging store for parsed CSV data between upload and process steps.
  // Keyed by statementId, cleaned up after 5 min TTL.
  const _stagedParsedData = new Map<string, {
    rows: Array<{ rawDate: string; rawDescription: string; rawAmount: string }>;
    detectedColumns: { dateCol: number; descCol: number; amountCol: number };
    headers: string[];
    expiresAt: number;
  }>();

  function cleanStagedData() {
    const now = Date.now();
    for (const [key, val] of _stagedParsedData.entries()) {
      if (val.expiresAt < now) _stagedParsedData.delete(key);
    }
  }

  // Simple RFC-4180 compliant CSV row parser
  function parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  }

  function detectColumns(headers: string[]): { dateCol: number; descCol: number; amountCol: number } {
    const lower = headers.map(h => h.toLowerCase());
    const dateKw    = ['date','on','at','period','dt'];
    const descKw    = ['desc','narration','remark','name','ref','particular','detail'];
    const amountKw  = ['amount','commission','payment','credit','debit','inr','₹','total'];
    const find = (kws: string[]) => lower.findIndex(h => kws.some(k => h.includes(k)));
    return {
      dateCol:   find(dateKw),
      descCol:   find(descKw),
      amountCol: find(amountKw),
    };
  }

  function parseFlexibleDate(raw: string): string {
    const s = raw.trim().replace(/\//g, '-');
    // Try YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Try DD-MM-YYYY
    const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
    // Try MM-DD-YYYY
    const mdy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
    return s; // return as-is if unparseable
  }

  function parseAmount(raw: string): number {
    const cleaned = raw.replace(/[₹,\s]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : Math.abs(n);
  }

  // POST /api/mis/statements/upload
  // Body: { csvBase64, fileName, providerId, periodStart, periodEnd, statementDate, receivedDate }
  // Returns: { detectedHeaders, detectedColumns, previewRows, tempId }
  app.post("/api/mis/statements/upload", async (req, res) => {
    cleanStagedData();
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    if (!(await checkRateLimit(uid, "mis-upload", 10, HOUR_MS))) {
      return res.status(429).json({ error: "Too many uploads. Maximum 10 per hour." });
    }
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    if (userData?.role !== "admin" && userData?.misAccess !== "admin") {
      return res.status(403).json({ error: "MIS admin access required" });
    }
    const { csvBase64, fileName, providerId, periodStart, periodEnd, statementDate, receivedDate } = req.body;
    if (!csvBase64 || !providerId || !periodStart) {
      return res.status(400).json({ error: "csvBase64, providerId and periodStart are required" });
    }
    try {
      const csvText = Buffer.from(csvBase64, "base64").toString("utf-8");
      const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length < 2) return res.status(400).json({ error: "CSV must have at least a header row and one data row" });
      const headers = parseCsvLine(lines[0]);
      const detected = detectColumns(headers);
      const previewRows = lines.slice(1, 6).map(l => parseCsvLine(l));
      const tempId = db.collection("_temp").doc().id; // just a random ID
      _stagedParsedData.set(tempId, {
        rows: lines.slice(1).map(l => {
          const cells = parseCsvLine(l);
          return {
            rawDate:        detected.dateCol   >= 0 ? (cells[detected.dateCol]   ?? '') : '',
            rawDescription: detected.descCol   >= 0 ? (cells[detected.descCol]   ?? '') : '',
            rawAmount:      detected.amountCol >= 0 ? (cells[detected.amountCol] ?? '') : '',
          };
        }),
        detectedColumns: detected,
        headers,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      return res.json({
        tempId,
        headers,
        detectedColumns: detected,
        previewRows,
        fileName: fileName ?? "upload.csv",
        periodStart, periodEnd, statementDate, receivedDate, providerId,
      });
    } catch (e) {
      return res.status(500).json({ error: `Parse error: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  // POST /api/mis/statements/process
  // Body: { tempId, confirmedColumns: { dateCol, descCol, amountCol }, providerId, periodStart,
  //         periodEnd, statementDate, receivedDate, fileName }
  app.post("/api/mis/statements/process", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    if (userData?.role !== "admin" && userData?.misAccess !== "admin") {
      return res.status(403).json({ error: "MIS admin access required" });
    }
    const { tempId, confirmedColumns, providerId, periodStart, periodEnd, statementDate, receivedDate, fileName } = req.body;
    const staged = _stagedParsedData.get(tempId);
    if (!staged) return res.status(400).json({ error: "Upload session expired. Please re-upload." });
    if (Date.now() > staged.expiresAt) {
      _stagedParsedData.delete(tempId);
      return res.status(400).json({ error: "Upload session expired. Please re-upload." });
    }
    // confirmedColumns is accepted but unused here — rows were already sliced by detected columns
    void confirmedColumns;
    try {
      // Re-parse using confirmed columns (or re-use staged rows which already have the fields)
      const rows = staged.rows;
      const parsedRows = rows.map(r => ({
        rawDate:        r.rawDate,
        rawDescription: r.rawDescription,
        rawAmount:      r.rawAmount,
        parsedDate:     parseFlexibleDate(r.rawDate),
        parsedAmount:   parseAmount(r.rawAmount),
      })).filter(r => r.parsedAmount > 0);
      const totalAmount = parsedRows.reduce((s, r) => s + r.parsedAmount, 0);
      const now = admin.firestore.FieldValue.serverTimestamp();
      // Create statement doc
      const stmtRef = db.collection("commission_statements").doc();
      const stmtData = {
        providerId, source: "bank",
        periodStart, periodEnd, statementDate, receivedDate,
        fileName: fileName ?? "upload.csv",
        fileUploadedAt: now,
        totalAmount,
        lineCount: parsedRows.length,
        matchedCount: 0, discrepancyCount: 0, unmatchedCount: parsedRows.length,
        status: "imported",
        importedBy: uid, importedAt: now,
        closedBy: null, closedAt: null, notes: "",
      };
      const batch = db.batch();
      batch.set(stmtRef, stmtData);
      for (const r of parsedRows) {
        const lineRef = stmtRef.collection("lines").doc();
        batch.set(lineRef, {
          statementId: stmtRef.id, providerId,
          rawDate: r.rawDate, rawDescription: r.rawDescription, rawAmount: r.rawAmount,
          parsedDate: r.parsedDate, parsedAmount: r.parsedAmount,
          matchedCommissionRecordId: null, matchedOpportunityId: null,
          discrepancyAmount: null, status: "unmatched",
          reconciledBy: null, reconciledAt: null, notes: "",
        });
      }
      await batch.commit();
      _stagedParsedData.delete(tempId);
      return res.json({ statementId: stmtRef.id, lineCount: parsedRows.length, totalAmount });
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  });

  // POST /api/mis/statements/:statementId/lines — manual single line entry
  app.post("/api/mis/statements/:statementId/lines", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    if (userData?.role !== "admin" && userData?.misAccess !== "admin") {
      return res.status(403).json({ error: "MIS admin access required" });
    }
    const { statementId } = req.params;
    const { rawDate, rawDescription, rawAmount } = req.body;
    if (!rawDate || !rawDescription || !rawAmount) {
      return res.status(400).json({ error: "rawDate, rawDescription and rawAmount required" });
    }
    const stmtSnap = await db.collection("commission_statements").doc(statementId).get();
    if (!stmtSnap.exists) return res.status(404).json({ error: "Statement not found" });
    const lineRef = db.collection("commission_statements").doc(statementId).collection("lines").doc();
    await lineRef.set({
      statementId, providerId: stmtSnap.data()!.providerId,
      rawDate, rawDescription, rawAmount,
      parsedDate: parseFlexibleDate(rawDate),
      parsedAmount: parseAmount(rawAmount),
      matchedCommissionRecordId: null, matchedOpportunityId: null,
      discrepancyAmount: null, status: "unmatched",
      reconciledBy: null, reconciledAt: null, notes: "",
    });
    await db.collection("commission_statements").doc(statementId).update({
      lineCount: admin.firestore.FieldValue.increment(1),
      unmatchedCount: admin.firestore.FieldValue.increment(1),
    });
    return res.json({ lineId: lineRef.id });
  });

  // ─── Admin: create employee (spec-compliant) ─────────────────────────────────
  // Validates @finvastra.com domain, creates Auth + Firestore doc, sends reset link.
  app.post("/api/admin/employees/create", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(uid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const {
        displayName, email, employeeId, department, designation,
        reportingManagerName, reportingManagerUid, joiningDate, phone, personalEmail,
        officialPhone, location, employeeStatus = "active",
        lastWorkingDate,
        dateOfBirth, gender, bloodGroup, fatherMotherName, spouseName,
        presentAddress, permanentAddress,
        salaryBasic, salaryHra, salaryConveyance, salaryMedical, salaryOther, grossSalary,
        role = "employee", hrmsAccess = true, crmAccess = false,
        crmRole = null, convertorVertical = null,
        isHrmsManager = false, misAccess = null,
      } = req.body as Record<string, unknown>;

      if (!displayName || typeof displayName !== "string") {
        return res.status(400).json({ error: "displayName is required" });
      }
      if (!email || typeof email !== "string") {
        return res.status(400).json({ error: "email is required" });
      }
      if (!email.endsWith("@finvastra.com")) {
        return res.status(400).json({ error: "Email must be a @finvastra.com address" });
      }

      // Guardrail: managers/admins must never sit INSIDE a CRM manager's team —
      // their numbers would leak into that manager's team view. (Super admins are
      // admins, so this covers them too.)
      if (typeof reportingManagerUid === "string" && reportingManagerUid &&
          (role === "admin" || crmRole === "manager")) {
        const mgrSnap = await db.collection("users").doc(reportingManagerUid).get();
        if (mgrSnap.data()?.crmRole === "manager") {
          return res.status(400).json({ error: "Managers, admins and super admins cannot be placed inside a manager's team. Pick a different reporting manager." });
        }
      }

      // Create Firebase Auth account with fixed temp password
      let newUid: string;
      try {
        const existing = await admin.auth().getUserByEmail(email);
        newUid = existing.uid;
      } catch {
        const authUser = await admin.auth().createUser({
          email, displayName, password: "Finvastra@2026", emailVerified: false,
        });
        newUid = authUser.uid;
      }

      // Generate password reset link so employee sets their own password
      let resetLink: string | null = null;
      try {
        resetLink = await admin.auth().generatePasswordResetLink(email);
      } catch { /* non-fatal — admin can resend later */ }

      // Create Firestore profile — public directory fields only
      await db.collection("users").doc(newUid).set({
        userId:               newUid,
        displayName,
        email,
        ...(location             ? { location }             : {}),
        ...(employeeId           ? { employeeId }           : {}),
        ...(department           ? { department }           : {}),
        ...(designation          ? { designation }          : {}),
        ...(reportingManagerName ? { reportingManagerName } : {}),
        ...(reportingManagerUid  ? { reportingManagerUid }  : {}),
        ...(joiningDate          ? { joiningDate }          : {}),
        role,
        hrmsAccess,
        crmAccess,
        crmRole,
        convertorVertical,
        isHrmsManager,
        misAccess,
        employeeStatus:      employeeStatus ?? "active",
        needsEmailSetup:     false,
        mustResetPassword:   true,
        photoURL:            null,
        createdAt:           admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Write personal details to /user_details/{uid} (admin/HR-only collection)
      const personalData: Record<string, unknown> = {};
      if (phone)           personalData.phone          = phone;
      if (officialPhone)   personalData.officialPhone  = officialPhone;
      if (personalEmail)   personalData.personalEmail  = personalEmail;
      if (dateOfBirth)     personalData.dateOfBirth    = dateOfBirth;
      if (lastWorkingDate) personalData.lastWorkingDate = lastWorkingDate;
      if (gender)          personalData.gender         = gender;
      if (bloodGroup)      personalData.bloodGroup     = bloodGroup;
      if (fatherMotherName) personalData.fatherMotherName = fatherMotherName;
      if (spouseName)      personalData.spouseName     = spouseName;
      if (presentAddress)  personalData.presentAddress = presentAddress;
      if (permanentAddress) personalData.permanentAddress = permanentAddress;
      if (Object.keys(personalData).length > 0) {
        await db.collection("user_details").doc(newUid).set(personalData, { merge: true });
      }

      // Write salary to employee_sensitive (access-controlled; not world-readable)
      const salaryData: Record<string, unknown> = {};
      if (salaryBasic)      salaryData.salaryBasic      = salaryBasic;
      if (salaryHra)        salaryData.salaryHra        = salaryHra;
      if (salaryConveyance) salaryData.salaryConveyance = salaryConveyance;
      if (salaryMedical)    salaryData.salaryMedical    = salaryMedical;
      if (salaryOther)      salaryData.salaryOther      = salaryOther;
      if (grossSalary)      salaryData.grossSalary      = grossSalary;
      if (Object.keys(salaryData).length > 0) {
        await db.collection("employee_sensitive").doc(newUid).set(salaryData, { merge: true });
      }

      // Try to generate a password reset link so employee sets their own password.
      // Fire-and-forget; mustResetPassword flag is the primary enforcement.
      try {
        const resetLink = await admin.auth().generatePasswordResetLink(email as string);
        console.log(`[create-employee] Password reset link for ${email}: ${resetLink}`);
      } catch (e) {
        console.warn(`[create-employee] Could not generate reset link for ${email}:`, e);
      }

      // Audit log
      await db.collection("audit_logs").add({
        actor:        uid,
        action:       "employee_created",
        targetEmail:  email,
        targetPath:   `/users/${newUid}`,
        at:           admin.firestore.FieldValue.serverTimestamp(),
      });

      // Stamp custom claims immediately so the new employee's first token has the right role
      try {
        await admin.auth().setCustomUserClaims(newUid, {
          role:          role ?? "employee",
          hrmsAccess:    hrmsAccess ?? true,
          crmAccess:     crmAccess ?? false,
          crmRole:       crmRole ?? null,
          isHrmsManager: isHrmsManager ?? false,
          misAccess:     misAccess ?? null,
        });
      } catch (e) {
        console.warn("[create-employee] setCustomUserClaims failed (non-fatal):", e);
      }

      // Auto-create onboarding checklist (non-fatal — HR can create manually if this fails)
      try {
        await createOnboardingChecklist(
          newUid,
          typeof displayName === "string" ? displayName : String(displayName),
          typeof joiningDate === "string" ? joiningDate : null,
          uid,
        );
      } catch (e) {
        console.warn("[create-employee] createOnboardingChecklist failed (non-fatal):", e);
      }

      return res.json({ uid: newUid, email, empCode: employeeId ?? null, resetLink });
    } catch (e) {
      console.error("create employee error:", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
    }
  });

  // ─── Checklist helpers ────────────────────────────────────────────────────────


  // ─── Deactivate employee ──────────────────────────────────────────────────────
  // Disables Firebase Auth account, revokes sessions, updates Firestore,
  // creates offboarding checklist doc, writes audit log.
  app.post("/api/admin/employees/:uid/deactivate", async (req, res) => {
    try {
      const callerUid = await verifyFirebaseToken(req);
      if (!callerUid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(callerUid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const { uid } = req.params;

      // Super admin accounts are permanently protected — cannot be deactivated by anyone
      if (isSuperAdmin(uid)) {
        return res.status(403).json({ error: "Super admin accounts cannot be deactivated." });
      }

      const { lastWorkingDate, exitReason, notes } = req.body as Record<string, string>;

      if (!lastWorkingDate) return res.status(400).json({ error: "lastWorkingDate is required" });
      if (!exitReason)       return res.status(400).json({ error: "exitReason is required" });

      // 1+2. Disable the Auth account + revoke sessions. SKIPPED when the
      // employee has no login account at all (needsEmailSetup staff — no
      // workspace email was ever created): there is nothing to disable, and
      // the HR exit must still complete. Any OTHER auth error still aborts so
      // an active login is never left behind on a marked-exited employee.
      try {
        await admin.auth().updateUser(uid, { disabled: true });
        await admin.auth().revokeRefreshTokens(uid);
      } catch (e) {
        if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
      }

      // 3. Update Firestore /users doc
      const empSnap = await db.collection("users").doc(uid).get();
      const empName = empSnap.data()?.displayName ?? uid;
      await db.collection("users").doc(uid).update({
        employeeStatus: "inactive",
        lwd:            lastWorkingDate,
        exitReason,
        deactivatedAt:  admin.firestore.FieldValue.serverTimestamp(),
        deactivatedBy:  callerUid,
      });

      // 4. Check for open CRM items that need reassignment before exit
      // Query leads — filter deleted in-memory to avoid requiring a composite index
      const leadsSnap = await db.collection("leads")
        .where("primaryOwnerId", "==", uid)
        .get();
      const openLeadsCount = leadsSnap.docs.filter((d) => d.data().deleted !== true).length;

      // Query opportunities across all leads via collectionGroup — filter status in-memory
      const oppsSnap = await db.collectionGroup("opportunities")
        .where("ownerId", "==", uid)
        .get();
      const openOppsCount = oppsSnap.docs.filter((d) => d.data().status === "open").length;

      // Build an extra checklist item if any open CRM work exists
      const extraItems: object[] = [];
      if (openLeadsCount > 0 || openOppsCount > 0) {
        extraItems.push({
          id:          "crm_reassignment",
          category:    "crm",
          task:        `Reassign ${openLeadsCount} open lead${openLeadsCount !== 1 ? "s" : ""} and ${openOppsCount} open opportunit${openOppsCount !== 1 ? "ies" : "y"} before exit`,
          completed:   false,
          completedAt: null,
          completedBy: null,
          notes:       null,
          required:    true,
          metadata: {
            openLeadsCount,
            openOpportunitiesCount: openOppsCount,
            reassignUrl: `/crm/leads?ownerId=${uid}`,
          },
        });
      }

      // 5. Create offboarding checklist (CRM item prepended via extraItems)
      await createOffboardingChecklist(uid, empName, lastWorkingDate, exitReason, callerUid, extraItems);

      // 6. Audit log
      await db.collection("audit_logs").add({
        actor:      callerUid,
        action:     "employee_deactivated",
        targetPath: `/users/${uid}`,
        after:      { employeeStatus: "inactive", lwd: lastWorkingDate, exitReason, notes: notes ?? null },
        at:         admin.firestore.FieldValue.serverTimestamp(),
      });

      const warning = openLeadsCount > 0 || openOppsCount > 0
        ? "Employee has open CRM items that need reassignment"
        : null;

      return res.json({ ok: true, warning, openLeads: openLeadsCount, openOpportunities: openOppsCount });
    } catch (e) {
      console.error("[deactivate-employee]", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
    }
  });

  // ─── Reactivate employee ──────────────────────────────────────────────────────
  // Re-enables Firebase Auth account, updates Firestore, creates onboarding checklist.
  app.post("/api/admin/employees/:uid/reactivate", async (req, res) => {
    try {
      const callerUid = await verifyFirebaseToken(req);
      if (!callerUid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(callerUid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const { uid } = req.params;
      const { newJoiningDate, notes } = req.body as Record<string, string>;

      // 1. Re-enable the Auth account — skipped when the employee never had a
      // login (no workspace email); the HR record still reactivates.
      try {
        await admin.auth().updateUser(uid, { disabled: false });
      } catch (e) {
        if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
      }

      // 2. Update Firestore /users doc
      const empSnap = await db.collection("users").doc(uid).get();
      const empName = empSnap.data()?.displayName ?? uid;
      const joiningDate = newJoiningDate || (empSnap.data()?.joiningDate ?? null);
      await db.collection("users").doc(uid).update({
        employeeStatus:  "active",
        lwd:             null,
        exitReason:      null,
        reactivatedAt:   admin.firestore.FieldValue.serverTimestamp(),
        reactivatedBy:   callerUid,
        mustResetPassword: true,   // fresh login required
      });

      // 3. Create new onboarding checklist (fresh start)
      await createOnboardingChecklist(uid, empName, joiningDate, callerUid);

      // 4. Audit log
      await db.collection("audit_logs").add({
        actor:      callerUid,
        action:     "employee_reactivated",
        targetPath: `/users/${uid}`,
        after:      { employeeStatus: "active", newJoiningDate: newJoiningDate ?? null, notes: notes ?? null },
        at:         admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ ok: true });
    } catch (e) {
      console.error("[reactivate-employee]", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
    }
  });

  // ─── Create single employee ───────────────────────────────────────────────────
  // Creates Firebase Auth account (email/password) + Firestore /users doc.
  // Returns the generated uid and a temporary password for distribution.
  app.post("/api/hrms/employees/create", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const callerSnap = await db.collection("users").doc(uid).get();
    if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

    const {
      displayName, officialEmail, employeeId, employeeStatus = "active",
      phone, officialPhone, personalEmail, department, designation,
      reportingManagerName, reportingManagerUid, location, joiningDate, dateOfBirth,
      gender, bloodGroup, fatherMotherName, spouseName,
      presentAddress, permanentAddress, grossSalary, lastWorkingDate,
      salaryBasic, salaryHra, salaryConveyance, salaryMedical, salaryOther,
      bankData,
    } = req.body as Record<string, string | number | Record<string, unknown> | undefined>;

    if (!displayName) return res.status(400).json({ error: "displayName is required" });

    const genPwd = () => {
      const ch = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
      let p = ""; const b = crypto.randomBytes(12);
      for (let i = 0; i < 12; i++) p += ch[b[i] % ch.length];
      return p;
    };

    // Public directory fields only — no personal data in /users
    const profileData: Record<string, unknown> = {
      displayName,
      role: "employee",
      photoURL: "",
      employeeStatus,
      ...(employeeId           ? { employeeId }           : {}),
      ...(department           ? { department }           : {}),
      ...(designation          ? { designation }          : {}),
      ...(location             ? { location }             : {}),
      ...(reportingManagerName ? { reportingManagerName } : {}),
      ...(joiningDate          ? { joiningDate }          : {}),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Personal details — goes to /user_details (admin/HR-only)
    const personalDetails: Record<string, unknown> = {};
    if (phone)            personalDetails.phone           = phone;
    if (officialPhone)    personalDetails.officialPhone   = officialPhone;
    if (personalEmail)    personalDetails.personalEmail   = personalEmail;
    if (dateOfBirth)      personalDetails.dateOfBirth     = dateOfBirth;
    if (gender)           personalDetails.gender          = gender;
    if (bloodGroup)       personalDetails.bloodGroup      = bloodGroup;
    if (fatherMotherName) personalDetails.fatherMotherName = fatherMotherName;
    if (spouseName)       personalDetails.spouseName      = spouseName;
    if (presentAddress)   personalDetails.presentAddress  = presentAddress;
    if (permanentAddress) personalDetails.permanentAddress = permanentAddress;
    if (lastWorkingDate)  personalDetails.lastWorkingDate = lastWorkingDate;

    let newUid: string;
    let tempPassword: string | null = null;

    if (officialEmail) {
      // Check for existing auth account
      try {
        const existing = await admin.auth().getUserByEmail(String(officialEmail));
        newUid = existing.uid;
        const existingSnap = await db.collection("users").doc(newUid).get();
        if (existingSnap.exists) {
          await existingSnap.ref.update(profileData);
        } else {
          await db.collection("users").doc(newUid).set({ ...profileData, email: officialEmail, userId: newUid });
        }
      } catch {
        tempPassword = genPwd();
        const authUser = await admin.auth().createUser({
          email: String(officialEmail),
          password: tempPassword,
          displayName: String(displayName),
          disabled: employeeStatus === "inactive",
        });
        newUid = authUser.uid;
        await db.collection("users").doc(newUid).set({ ...profileData, email: officialEmail, userId: newUid });
      }
    } else {
      // No login email — profile-only record
      const docRef = db.collection("users").doc();
      newUid = docRef.id;
      await docRef.set({ ...profileData, email: "", userId: newUid });
    }

    // Write personal details to /user_details (admin/HR-only collection)
    if (Object.keys(personalDetails).length > 0) {
      await db.collection("user_details").doc(newUid).set(
        { ...personalDetails, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    // Store salary data in /employee_sensitive (admin-only collection)
    const salaryFields: Record<string, unknown> = {};
    if (salaryBasic)      salaryFields.salaryBasic      = Number(salaryBasic);
    if (salaryHra)        salaryFields.salaryHra        = Number(salaryHra);
    if (salaryConveyance) salaryFields.salaryConveyance = Number(salaryConveyance);
    if (salaryMedical)    salaryFields.salaryMedical    = Number(salaryMedical);
    if (salaryOther)      salaryFields.salaryOther      = Number(salaryOther);
    if (grossSalary)      salaryFields.grossSalary      = Number(grossSalary);
    const sensitivePayload: Record<string, unknown> = { ...salaryFields };
    if (bankData) Object.assign(sensitivePayload, bankData as Record<string, unknown>);
    if (Object.keys(sensitivePayload).length > 0) {
      await db.collection("employee_sensitive").doc(newUid).set(
        { ...sensitivePayload, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    await db.collection("audit_logs").add({
      actor: uid, action: "create_employee",
      targetPath: `/users/${newUid}`,
      before: null, after: { displayName, email: officialEmail ?? "" },
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ uid: newUid, tempPassword });
  });

  // ─── Employee master import (service-account Sheets API) ────────────────────

  // Preview: reads sheet via SA, returns parsed employee list. No writes.
  app.post("/api/admin/employees/import-preview", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(uid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const rows = await fetchEmployeeMasterRows();
      const employees = rows
        .map(parseEmployeeRow)
        .filter((e) => e.empCode && e.name);

      return res.json({
        employees: employees.map(({ panRaw: _, personalBankAcct: _2, officialBankAcct: _3, ...rest }) => rest),
        total:    employees.length,
        active:   employees.filter((e) => e.status === "active").length,
        inactive: employees.filter((e) => e.status === "inactive").length,
      });
    } catch (e) {
      console.error("[import-preview]", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Preview failed" });
    }
  });

  // Confirm: re-reads sheet via SA, creates Auth + Firestore + encrypted profile docs.
  app.post("/api/admin/employees/import-confirm", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(uid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const rows = await fetchEmployeeMasterRows();
      const parsed = rows.map(parseEmployeeRow).filter((e) => e.empCode && e.name);

      let created = 0, updated = 0, skipped = 0;
      const errors: string[] = [];

      for (const emp of parsed) {
        try {
          const docId     = emp.status === "active" && emp.officialEmail ? null : emp.empCode;
          // Public directory fields only
          const profileBase: Record<string, unknown> = {
            employeeId:           emp.empCode,
            displayName:          emp.name,
            email:                emp.officialEmail ?? "",
            department:           emp.department,
            designation:          emp.designation,
            reportingManagerName: emp.reportingManager,
            joiningDate:          emp.doj,
            employeeStatus:       emp.status,
            needsEmailSetup:      emp.needsEmailSetup,
            photoURL:             null,
            ...emp.roleAttrs,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };

          // Personal details → /user_details (admin/HR-only)
          const importUserDetails: Record<string, unknown> = {};
          if (emp.officialPhone ?? emp.phone) importUserDetails.phone = emp.officialPhone ?? emp.phone;
          if (emp.personalEmail)              importUserDetails.personalEmail = emp.personalEmail;
          if (emp.dob)                        importUserDetails.dateOfBirth   = emp.dob;
          if (emp.presentAddress)             importUserDetails.presentAddress = emp.presentAddress;
          if (emp.permanentAddress)           importUserDetails.permanentAddress = emp.permanentAddress;
          if (emp.status === "inactive" && emp.lwd) importUserDetails.lastWorkingDate = emp.lwd;

          // Aadhaar column (index 13) is intentionally skipped — UIDAI prohibition.
          const sensitiveDoc: Record<string, unknown> = {
            uid:              emp.empCode,
            dob:              emp.dob,
            uan:              emp.uan,
            presentAddress:   emp.presentAddress,
            permanentAddress: emp.permanentAddress,
            personalEmail:    emp.personalEmail,
            personalPhone:    emp.phone,
            personalBankName:    emp.personalBankName,
            personalBankBranch:  emp.personalBankBranch,
            personalBankIfsc:    emp.personalBankIfsc,
            officialBankName:    emp.officialBankName,
            officialBankBranch:  emp.officialBankBranch,
            officialBankIfsc:    emp.officialBankIfsc,
            grossSalary:         emp.grossSalary,
            aadhaarVerified:     false,
            aadhaarVerifiedOn:   null,
            aadhaarVerifiedBy:   null,
            aadhaarDriveLink:    null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          if (emp.panRaw) sensitiveDoc.panEncrypted = encryptField(emp.panRaw);
          if (emp.personalBankAcct) sensitiveDoc.personalBankAccountEncrypted = encryptField(emp.personalBankAcct);
          if (emp.officialBankAcct) sensitiveDoc.officialBankAccountEncrypted = encryptField(emp.officialBankAcct);

          if (emp.status === "inactive" || !emp.officialEmail) {
            // No Auth account — use empCode as doc ID
            const ref  = db.collection("users").doc(emp.empCode);
            const snap = await ref.get();
            if (snap.exists) {
              await ref.set({ ...profileBase, userId: emp.empCode, createdAt: snap.data()!.createdAt }, { merge: false });
              updated++;
            } else {
              await ref.set({ ...profileBase, userId: emp.empCode, createdAt: admin.firestore.FieldValue.serverTimestamp() });
              created++;
            }
            if (Object.keys(importUserDetails).length > 0) {
              await db.collection("user_details").doc(emp.empCode).set(
                { ...importUserDetails, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
              );
            }
            await db.collection("employee_profiles").doc(emp.empCode).set(
              { ...sensitiveDoc, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
            );
            if (emp.status === "inactive") { skipped++; created--; }
            continue;
          }

          // Active + has email → Auth account
          let authUid: string;
          let authExisted = false;
          try {
            const existing = await admin.auth().getUserByEmail(emp.officialEmail);
            authUid     = existing.uid;
            authExisted = true;
          } catch {
            const newUser = await admin.auth().createUser({
              email: emp.officialEmail, displayName: emp.name,
              password: "Finvastra@2026", emailVerified: false, disabled: false,
            });
            authUid = newUser.uid;
          }

          const userRef  = db.collection("users").doc(authUid);
          const userSnap = await userRef.get();
          if (userSnap.exists) {
            await userRef.set({ ...profileBase, userId: authUid, email: emp.officialEmail, createdAt: userSnap.data()!.createdAt }, { merge: false });
            updated++;
          } else {
            // New Auth account → force password reset on first login
            const resetFlag = !authExisted ? { mustResetPassword: true } : {};
            await userRef.set({ ...profileBase, ...resetFlag, userId: authUid, email: emp.officialEmail, createdAt: admin.firestore.FieldValue.serverTimestamp() });
            if (!authExisted) created++;
            else updated++;
          }

          if (Object.keys(importUserDetails).length > 0) {
            await db.collection("user_details").doc(authUid).set(
              { ...importUserDetails, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
            );
          }
          await db.collection("employee_profiles").doc(emp.empCode).set(
            { ...sensitiveDoc, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
          );
          await db.collection("audit_logs").add({
            actor: uid, action: "import_employee",
            targetPath: `/users/${authUid}`,
            before: null, after: { email: emp.officialEmail, displayName: emp.name },
            at: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (rowErr) {
          errors.push(`${emp.empCode} ${emp.name}: ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`);
        }
      }

      return res.json({ created, updated, skipped, errors });
    } catch (e) {
      console.error("[import-confirm]", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Import failed" });
    }
  });

  // ─── Employee master import from Google Sheet (legacy — kept for compat) ─────
  // Original endpoint used public CSV; new flow uses /api/admin/employees/import-preview
  // and /api/admin/employees/import-confirm above. This endpoint is no longer called
  // by the UI but preserved in case it's needed via API directly.
  app.post("/api/hrms/employees/import-from-sheet", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(uid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const { sheetUrl, dryRun = false } = req.body as { sheetUrl: string; dryRun?: boolean };
      if (!sheetUrl) return res.status(400).json({ error: "sheetUrl required" });

      // ── helpers ──
      const norm = (s: string | undefined) => { const t = (s ?? "").trim(); return (!t || t === "NA") ? null : t; };
      const ddToISO  = (s: string) => { const m = s.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}` : null; };
      const ddToMMDD = (s: string) => { const m = s.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); return m ? `${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}` : null; };
      const parseSalary = (s: string) => { const n = Number((s ?? "").replace(/,/g,"")); return isNaN(n) || n === 0 ? null : n; };
      const genPwd = () => { const ch = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"; let p = ""; const b = crypto.randomBytes(12); for(let i=0;i<12;i++) p+=ch[b[i]%ch.length]; return p; };

      // ── CSV parser (handles quoted fields with embedded commas) ──
      function parseCSV(text: string): string[][] {
        const rows: string[][] = []; let row: string[] = [], field = "", inQ = false;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (inQ) { if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
          else if (ch === '"') { inQ = true; }
          else if (ch === ',') { row.push(field); field = ""; }
          else if (ch === '\n') { row.push(field); field = ""; if (row.some(c=>c.trim())) rows.push(row); row = []; }
          else if (ch !== '\r') { field += ch; }
        }
        if (field || row.length > 0) { row.push(field); if (row.some(c=>c.trim())) rows.push(row); }
        return rows;
      }

      // ── Fetch sheet as CSV ──
      let csvText: string;
      try {
        const sheetId = extractSheetId(sheetUrl);
        const gidMatch = sheetUrl.match(/gid=(\d+)/);
        const gid = gidMatch ? gidMatch[1] : "0";
        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
        const fetchRes = await fetch(csvUrl, { redirect: "follow" });
        if (!fetchRes.ok) return res.status(400).json({ error: `Could not fetch sheet (HTTP ${fetchRes.status}). Make sure the sheet is set to "Anyone with the link can view".` });
        csvText = await fetchRes.text();
      } catch (e) {
        return res.status(400).json({ error: `Sheet fetch failed: ${e instanceof Error ? e.message : String(e)}` });
      }

      const allRows = parseCSV(csvText);
      // Row 0 = main headers, Row 1 = bank sub-headers, data from Row 2
      const dataRows = allRows.slice(2).filter(r => norm(r[2]) || norm(r[3]));

      // Column indices (0-based, Finvastra employee master sheet)
      const C = {
        status:1, empCode:2, name:3, dob:4, phone:5, personalEmail:6, doj:7,
        officialEmail:8, officialPhone:9, dept:10, designation:11, manager:12,
        // 13=Aadhaar SKIP, 14=PAN SKIP, 15=UAN SKIP
        presentAddr:16, permanentAddr:17,
        // Bank accounts (stored in /employee_sensitive)
        personalBankName:18, personalBankBranch:19, personalBankAcct:20, personalBankIfsc:21,
        officialBankName:22, officialBankBranch:23, officialBankAcct:24, officialBankIfsc:25,
        lwd:26, salary:27,
      };

      const results: Array<{
        empCode: string; name: string; email: string | null;
        status: "created" | "exists" | "no_email" | "error";
        tempPassword?: string; error?: string;
      }> = [];

      for (const row of dataRows) {
        try {
          const empCode       = norm(row[C.empCode]) ?? "";
          const name          = norm(row[C.name]) ?? "";
          const officialEmail = norm(row[C.officialEmail]);
          const statusStr     = (norm(row[C.status]) ?? "active").toLowerCase();

          if (!name) continue;

          const dobRaw = norm(row[C.dob]);
          const dojRaw = norm(row[C.doj]);
          const lwdRaw = norm(row[C.lwd]);

          const profileData: Record<string, unknown> = {
            displayName:    name,
            employeeId:     empCode || null,
            role:           "employee",
            photoURL:       "",
            employeeStatus: statusStr === "inactive" ? "inactive" : "active",
            ...(norm(row[C.phone])         ? { phone: norm(row[C.phone]) }                          : {}),
            ...(norm(row[C.officialPhone]) ? { officialPhone: norm(row[C.officialPhone]) }          : {}),
            ...(norm(row[C.personalEmail]) ? { personalEmail: norm(row[C.personalEmail]) }          : {}),
            ...(norm(row[C.dept])          ? { department: norm(row[C.dept]) }                      : {}),
            ...(norm(row[C.designation])   ? { designation: norm(row[C.designation]) }              : {}),
            ...(norm(row[C.manager])       ? { reportingManagerName: norm(row[C.manager]) }         : {}),
            ...(dobRaw                     ? { dateOfBirth: ddToMMDD(dobRaw) }                      : {}),
            ...(dojRaw                     ? { joiningDate:  ddToISO(dojRaw) }                      : {}),
            ...(norm(row[C.presentAddr])   ? { presentAddress: norm(row[C.presentAddr]) }           : {}),
            ...(norm(row[C.permanentAddr]) ? { permanentAddress: norm(row[C.permanentAddr]) }       : {}),
            ...(lwdRaw                     ? { lastWorkingDate: ddToISO(lwdRaw) }                   : {}),
            ...(parseSalary(row[C.salary] ?? "") !== null ? { grossSalary: parseSalary(row[C.salary] ?? "") } : {}),
            importedAt: admin.firestore.FieldValue.serverTimestamp(),
          };

          // Sensitive bank data → /employee_sensitive/{uid}
          const personalBank = {
            name: norm(row[C.personalBankName]),
            branch: norm(row[C.personalBankBranch]),
            accountNumber: norm(row[C.personalBankAcct]),
            ifsc: norm(row[C.personalBankIfsc]),
          };
          const officialBank = {
            name: norm(row[C.officialBankName]),
            branch: norm(row[C.officialBankBranch]),
            accountNumber: norm(row[C.officialBankAcct]),
            ifsc: norm(row[C.officialBankIfsc]),
          };
          const hasBankData = Object.values(personalBank).some(Boolean) || Object.values(officialBank).some(Boolean);

          if (!officialEmail) {
            if (!dryRun) {
              const docRef = db.collection("users").doc();
              await docRef.set({ ...profileData, email: "", userId: docRef.id });
              if (hasBankData) {
                await db.collection("employee_sensitive").doc(docRef.id).set(
                  { personalBank, officialBank, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                  { merge: true }
                );
              }
            }
            results.push({ empCode, name, email: null, status: "no_email" });
            continue;
          }

          // Check for existing Firebase Auth account
          let existingUid: string | null = null;
          try {
            const existingAuth = await admin.auth().getUserByEmail(officialEmail);
            existingUid = existingAuth.uid;
          } catch { /* user does not exist */ }

          if (existingUid) {
            if (!dryRun) {
              await db.collection("users").doc(existingUid).set(
                { ...profileData, email: officialEmail, userId: existingUid },
                { merge: true }
              );
              if (hasBankData) {
                await db.collection("employee_sensitive").doc(existingUid).set(
                  { personalBank, officialBank, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                  { merge: true }
                );
              }
            }
            results.push({ empCode, name, email: officialEmail, status: "exists" });
          } else {
            const tempPassword = genPwd();
            if (!dryRun) {
              const authUser = await admin.auth().createUser({
                email: officialEmail,
                password: tempPassword,
                displayName: name,
                disabled: statusStr === "inactive",
              });
              await db.collection("users").doc(authUser.uid).set({
                ...profileData, email: officialEmail, userId: authUser.uid,
              });
              if (hasBankData) {
                await db.collection("employee_sensitive").doc(authUser.uid).set(
                  { personalBank, officialBank, updatedAt: admin.firestore.FieldValue.serverTimestamp() }
                );
              }
              await db.collection("audit_logs").add({
                actor: uid, action: "import_employee",
                targetPath: `/users/${authUser.uid}`,
                before: null, after: { email: officialEmail, displayName: name },
                at: admin.firestore.FieldValue.serverTimestamp(),
              });
            }
            results.push({ empCode, name, email: officialEmail, status: "created", tempPassword });
          }
        } catch (rowErr) {
          const empCode = norm(row[2]) ?? "";
          const name    = norm(row[3]) ?? "Unknown";
          console.error(`Import row error (${empCode} ${name}):`, rowErr);
          results.push({ empCode, name, email: null, status: "error",
            error: rowErr instanceof Error ? rowErr.message : String(rowErr) });
        }
      }

      const summary = {
        total:   results.length,
        created: results.filter(r => r.status === "created").length,
        exists:  results.filter(r => r.status === "exists").length,
        noEmail: results.filter(r => r.status === "no_email").length,
        errors:  results.filter(r => r.status === "error").length,
      };
      return res.json({ dryRun, summary, results });

    } catch (e) {
      console.error("Import-from-sheet fatal error:", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // ─── Webhook Intake: helpers ────────────────────────────────────────────────────


  // ─── POST /api/leads/intake/website — Website form webhook ────────────────────
  // Called by the Finvastra website contact/enquiry form.
  // Auth: X-Finvastra-Webhook-Secret header must match WEBSITE_WEBHOOK_SECRET env var.
  // Always returns 200 on duplicate so the website doesn't retry unnecessarily.
  app.post("/api/leads/intake/website", async (req, res) => {
    const secret = process.env.WEBSITE_WEBHOOK_SECRET;
    // Constant-time secret comparison (guard undefined + length mismatch first).
    const providedSecret = req.headers["x-finvastra-webhook-secret"];
    const providedSecretStr = typeof providedSecret === "string" ? providedSecret : "";
    let webhookSecretOk = false;
    if (secret && providedSecretStr) {
      const a = Buffer.from(providedSecretStr);
      const b = Buffer.from(secret);
      webhookSecretOk = a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    if (!webhookSecretOk) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { name, phone, email, loanProduct, loanAmount, city, utmSource, utmCampaign, formId } =
      req.body as Record<string, unknown>;

    if (!name || typeof name !== "string") {
      await writeWebhookLog("website", "invalid", null, "name missing", null);
      return res.status(400).json({ error: "name is required" });
    }
    if (!phone || typeof phone !== "string") {
      await writeWebhookLog("website", "invalid", null, "phone missing", null);
      return res.status(400).json({ error: "phone is required" });
    }

    // Kick off processing async — respond quickly, then write Firestore
    res.json({ success: true });

    try {
      const outcome = await processInboundLead({
        name:        String(name),
        phone:       String(phone),
        email:       email   ? String(email)   : undefined,
        loanProduct: loanProduct ? String(loanProduct) : undefined,
        loanAmount:  typeof loanAmount === "number" ? loanAmount : undefined,
        city:        city   ? String(city)   : undefined,
        utmSource:   utmSource   ? String(utmSource)   : undefined,
        utmCampaign: utmCampaign ? String(utmCampaign) : undefined,
        formId:      formId ? String(formId) : undefined,
        source:      "website",
      });
      await writeWebhookLog("website", outcome.result, outcome.leadId, outcome.errorMessage, outcome.assignedTo);
    } catch (e) {
      console.error("[webhook/website] processing error:", e);
      await writeWebhookLog("website", "error", null, String(e), null);
    }
  });

  // ─── GET /api/leads/intake/meta — Meta webhook verification handshake ─────────
  // Meta sends this request when the webhook URL is first configured in Meta Business Suite.
  app.get("/api/leads/intake/meta", (req, res) => {
    const mode      = req.query["hub.mode"];
    const token     = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const secret    = process.env.META_WEBHOOK_SECRET;

    if (mode === "subscribe" && token === secret) {
      console.log("[webhook/meta] Webhook verified by Meta");
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: "Verification failed" });
  });

  // ─── POST /api/leads/intake/meta — Meta Lead Ads webhook intake ───────────────
  // Receives new lead form submissions from Meta Lead Ads.
  // Auth: X-Hub-Signature-256 HMAC verification using META_WEBHOOK_SECRET.
  // Always returns 200 — Meta retries on any non-200 response.
  app.post("/api/leads/intake/meta", async (req, res) => {
    const secret = process.env.META_WEBHOOK_SECRET;

    // HMAC verification — uses rawBody captured by express.json verify option.
    // Fail closed: with no configured secret there is no way to authenticate the
    // caller, so reject rather than processing (and creating leads from) unsigned input.
    if (!secret) {
      console.warn("[webhook/meta] META_WEBHOOK_SECRET not set — rejecting (fail closed)");
      return res.status(403).json({ error: "Webhook not configured" });
    }
    {
      const sig = req.headers["x-hub-signature-256"] as string | undefined;
      const rawBuf = (req as express.Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
      const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBuf).digest("hex");
      if (!sig || sig !== expected) {
        console.warn("[webhook/meta] HMAC mismatch — rejected");
        return res.status(403).json({ error: "Signature mismatch" });
      }
    }

    // Always ACK immediately — Meta retries on non-200
    res.status(200).json({ ok: true });

    // Parse Meta payload structure
    const body = req.body as {
      object?: string;
      entry?: Array<{
        changes?: Array<{
          value?: {
            leadgen_id?: string;
            page_id?:   string;
            form_id?:   string;
            field_data?: Array<{ name: string; values: string[] }>;
          };
        }>;
      }>;
    };

    if (body.object !== "page" || !Array.isArray(body.entry)) {
      await writeWebhookLog("social_meta", "invalid", null, "unexpected payload structure", null);
      return;
    }

    for (const entry of body.entry) {
      for (const change of entry.changes ?? []) {
        const val = change.value;
        if (!val?.field_data) continue;

        // Extract fields — Meta form field names vary; check common variants
        const get = (keys: string[]) => {
          for (const key of keys) {
            const found = val.field_data!.find((f) => f.name.toLowerCase() === key.toLowerCase());
            if (found?.values?.[0]) return found.values[0];
          }
          return undefined;
        };

        const name        = get(["full_name", "name", "first_name"]);
        const phone       = get(["phone_number", "phone", "mobile"]);
        const email       = get(["email"]);
        const loanProduct = get(["loan_type", "product", "loan_product"]);
        const loanAmtRaw  = get(["loan_amount", "amount"]);
        const loanAmount  = loanAmtRaw ? parseFloat(loanAmtRaw.replace(/[^0-9.]/g, "")) || undefined : undefined;

        if (!name || !phone) {
          await writeWebhookLog("social_meta", "invalid", null,
            `missing name or phone in leadgen_id=${val.leadgen_id}`, null);
          continue;
        }

        try {
          const outcome = await processInboundLead({
            name, phone, email,
            loanProduct, loanAmount,
            formId:        val.form_id,
            metaLeadgenId: val.leadgen_id,
            source:        "social_meta",
          });
          await writeWebhookLog("social_meta", outcome.result, outcome.leadId,
            outcome.errorMessage, outcome.assignedTo);
        } catch (e) {
          console.error("[webhook/meta] processing error:", e);
          await writeWebhookLog("social_meta", "error", null, String(e), null);
        }
      }
    }
  });

  // ─── POST /api/leads/referral/submit — Employee referral lead intake ─────────
  //
  // Called by SubmitReferralPage when an HRMS employee submits a referral.
  // Uses workload-aware assignment so the lead lands in a real RM's queue.
  //
  // WHY server-side: the client-side createReferralLead() was setting
  // primaryOwnerId = referrer's own UID (an HRMS employee, not an RM), so leads
  // went nowhere. Server handles assignment correctly.
  //
  // Auth: Firebase ID token in Authorization header.
  // Body: { displayName, phone, email?, productInterest?, notes?, consentMethod }
  app.post("/api/leads/referral/submit", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { displayName, phone, email, productInterest, notes, consentMethod } =
      req.body as Record<string, unknown>;

    // Validate required fields
    if (!displayName || typeof displayName !== "string" || displayName.trim().length < 2) {
      return res.status(400).json({ error: "displayName must be at least 2 characters" });
    }
    if (!phone || typeof phone !== "string") {
      return res.status(400).json({ error: "phone is required" });
    }
    const validConsentMethods = ["verbal", "written", "digital", "offline_collection"];
    if (!consentMethod || !validConsentMethods.includes(String(consentMethod))) {
      return res.status(400).json({ error: "valid consentMethod is required" });
    }

    // Normalise phone
    const normPhone = normaliseIndianPhone(String(phone));
    if (!normPhone) {
      return res.status(400).json({ error: `Invalid Indian mobile number: '${phone}'` });
    }

    // Duplicate check
    const dupSnap = await db.collection("leads")
      .where("phone", "==", normPhone)
      .where("deleted", "==", false)
      .limit(1)
      .get();
    if (!dupSnap.empty) {
      return res.json({ ok: true, duplicate: true, leadId: dupSnap.docs[0].id });
    }

    // Workload-aware assignment to a lead_generator
    const assignedTo = await workloadAwareAssign();

    // SLA: 24 hours for employee referrals
    const slaDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Get referrer's display name for the notification
    let referrerName = "An employee";
    try {
      const referrerSnap = await db.collection("users").doc(uid).get();
      referrerName = referrerSnap.data()?.displayName ?? referrerName;
    } catch { /* non-fatal */ }

    const tags: string[] = productInterest && typeof productInterest === "string" && productInterest.trim()
      ? [productInterest.trim()]
      : [];

    const leadRef = db.collection("leads").doc();
    await leadRef.set({
      displayName:      displayName.trim(),
      phone:            normPhone,
      ...(email && typeof email === "string" && email.trim() ? { email: email.trim() } : {}),
      ...(notes && typeof notes === "string" && notes.trim()  ? { notes: notes.trim() } : {}),
      source:           "employee_referral",
      referredBy:       uid,
      referredByName:   referrerName,
      tags,
      primaryOwnerId:   assignedTo,
      consentGiven:     true,
      consentMethod:    String(consentMethod),
      consentTimestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt:        admin.firestore.FieldValue.serverTimestamp(),
      createdBy:        `referral:${uid}`,
      updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
      deleted:          false,
      slaDeadline:      admin.firestore.Timestamp.fromDate(slaDeadline),
    });

    // Notify the assigned RM (and all generators so anyone can action if RM misses it)
    try {
      const genSnap = await db.collection("users")
        .where("crmRole", "==", "lead_generator")
        .where("crmAccess", "==", true)
        .where("employeeStatus", "==", "active")
        .get();

      if (!genSnap.empty) {
        const batch = db.batch();
        for (const genDoc of genSnap.docs) {
          const notifRef = db.collection("notifications").doc(genDoc.id).collection("items").doc();
          batch.set(notifRef, {
            type:        "new_referral",
            title:       `New referral — ${displayName.trim()}`,
            body:        `Referred by ${referrerName}${tags.length ? ` · ${tags[0]}` : ""}`,
            link:        `/crm/leads/${leadRef.id}`,
            leadId:      leadRef.id,
            leadName:    displayName.trim(),
            submittedBy: referrerName,
            createdAt:   admin.firestore.FieldValue.serverTimestamp(),
            read:        false,
          });
        }
        await batch.commit();
      }
    } catch (e) {
      console.warn("[referral/submit] notification batch failed (non-fatal):", e);
    }

    return res.json({ ok: true, duplicate: false, leadId: leadRef.id, assignedTo });
  });

  // ─── Webhook logs read API ────────────────────────────────────────────────────
  // GET /api/admin/webhook-logs — returns latest 20 entries, admin only.
  // Firestore rules deny client access; this endpoint acts as the proxy.
  app.get("/api/admin/webhook-logs", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

    const snap = await db.collection("webhook_logs")
      .orderBy("receivedAt", "desc")
      .limit(20)
      .get();

    const logs = snap.docs.map((d) => {
      const data = d.data();
      return {
        id:           d.id,
        source:       data.source,
        result:       data.result,
        leadId:       data.leadId,
        errorMessage: data.errorMessage,
        assignedTo:   data.assignedTo,
        receivedAt:   data.receivedAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    return res.json({ logs });
  });

  // ─── CRM 2.0 / Pipeline routes (server/crm2.ts — see PLAN.md) ─────────────────
  registerCrm2Routes(app, {
    db, admin, verifyScheduler: verifySchedulerOIDC,
    sendBrandedEmail: async (to, subject, body) => {
      // Skip when Gmail DWD isn't configured (dev/emulator) — getGmailClient would
      // otherwise fall through to the GCE metadata server and hang. In-app bell is
      // the primary channel; email is best-effort.
      if (!process.env.GOOGLE_SA_JSON_BASE64) return;
      await sendGmailMessage(to, subject, buildBrandEmail(body)).catch(() => {});
    },
  });

  // ─── Vite / static serving ───────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
