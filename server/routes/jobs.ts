/**
 * server/routes/jobs.ts - scheduled Cloud-Scheduler jobs (SLA/leakage/expiry/reminders/digests/scorecards), lifted from server.ts
 * (2026-07-21, Phase 3 route split). Registered via registerJobRoutes(app); imports its
 * helpers directly from server/lib/* + ../db.js.
 */
import express from "express";
import { inrRound as inr } from "../../src/lib/money.js";
import { db, admin } from "../db.js";
import {
  SUPER_ADMIN_UIDS_LIST,
  verifyFirebaseToken,
  verifySchedulerOIDC,
} from "../lib/auth.js";
import {
  accumulatePerf,
  activeRmFilter,
  cachedJson,
  computeActualsServer,
  computeTeamSummary,
  latestActivity,
  requireAdminOrScheduler,
} from "../lib/perf.js";
import {
  buildBrandEmail,
  notificationsEnabled,
  sendGmailMessage,
} from "../lib/email.js";
import {
  generateAndDeliverScorecard,
} from "../lib/scorecard.js";
import { leadName } from "../../src/lib/crm2/leadModel.js";

export function registerJobRoutes(app: express.Express): void {
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
      const { runBankSLACheck } = await import("../../src/lib/bankSLAJob");
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
      const { runCommissionLeakageCheck } = await import("../../src/lib/commissionLeakageJob");
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
      const { runDocumentExpiryCheck } = await import("../../src/lib/documentExpiryJob");
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
      const { runLeaveYearReset } = await import("../../src/lib/leaveYearResetJob");
      const result = await runLeaveYearReset(db, year, callerUid, callerName);
      return res.json(result);
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // ─── Performance & Target Tracking (Phase N) ──────────────────────────────────
  // (money formatting via shared inrRound, imported at top as `inr`)




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
}
