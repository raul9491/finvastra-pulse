/**
 * server/routes/oauth.ts - Google OAuth URL/callback + calendar proxy + leave->calendar sync, lifted from server.ts
 * (2026-07-21, Phase 3 route split). Registered via registerOAuthRoutes(app); imports its
 * helpers directly from server/lib/* + ../db.js.
 */
import express from "express";
import { google } from "googleapis";
import { db, admin } from "../db.js";
import {
  HOUR_MS,
  checkRateLimit,
  verifyFirebaseToken,
} from "../lib/auth.js";
import {
  oauth2Client,
} from "../lib/oauth.js";

export function registerOAuthRoutes(app: express.Express): void {
  // Google OAuth Configuration
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
}
