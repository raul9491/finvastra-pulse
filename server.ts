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
import { registerNotificationRoutes } from "./server/routes/notifications.js";
import { registerAdminRoutes } from "./server/routes/admin.js";
import { registerMeetingRoutes } from "./server/routes/meetings.js";
import { registerWebhookRoutes } from "./server/routes/webhook.js";
import { registerCrmPerformanceRoutes } from "./server/routes/crmPerformance.js";
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

  registerAdminRoutes(app);


  // Import/lead-pull/phone-backfill routes -> ./server/routes/imports.ts
  registerImportRoutes(app);

  registerNotificationRoutes(app);


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
  registerCrmPerformanceRoutes(app);


  registerMeetingRoutes(app);


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

  registerWebhookRoutes(app);


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
