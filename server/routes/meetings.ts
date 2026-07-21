/**
 * server/routes/meetings.ts - CRM meetings -> scheduler Google Calendar (create/update), lifted from server.ts
 * (2026-07-21, Phase 3 route split). Registered via registerMeetingRoutes(app); imports its
 * helpers directly from server/lib/* + ../db.js.
 */
import express from "express";
import { db, admin, useEmulator } from "../db.js";
import {
  verifyFirebaseToken,
} from "../lib/auth.js";
import {
  getCalendarClient,
} from "../lib/email.js";
import { leadName } from "../../src/lib/crm2/leadModel.js";

export function registerMeetingRoutes(app: express.Express): void {
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
}
