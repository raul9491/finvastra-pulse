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
import { oauth2Client } from "./server/lib/oauth.js";
import { registerImportRoutes } from "./server/routes/imports.js";
import { registerOAuthRoutes } from "./server/routes/oauth.js";
import { registerMisRoutes } from "./server/routes/mis.js";
import { _stagedParsedData, cleanStagedData, parseCsvLine, detectColumns, parseFlexibleDate, parseAmount } from "./server/lib/mis.js";
import { registerEmployeeRoutes } from "./server/routes/employees.js";
import { registerTrackerRoutes } from "./server/routes/tracker.js";
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

  registerOAuthRoutes(app);


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

  registerTrackerRoutes(app);


  // ─── MIS: Statement Upload & Processing ──────────────────────────────────────

  registerMisRoutes(app);


  registerEmployeeRoutes(app);


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
