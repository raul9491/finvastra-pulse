import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { db } from "./server/db.js";
import { registerCrm2Routes } from "./server/crm2.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase Admin init + the named Firestore handle (`db`) now live in
// ./server/db.ts so route/helper modules can import them directly. `admin` above
// is the same singleton db.ts initializes; `useEmulator` is re-exported from there.

import { verifySchedulerOIDC, validateServerEnv } from "./server/lib/auth.js";
import { buildBrandEmail, sendGmailMessage } from "./server/lib/email.js";
import { registerImportRoutes } from "./server/routes/imports.js";
import { registerJobRoutes } from "./server/routes/jobs.js";
import { registerOAuthRoutes } from "./server/routes/oauth.js";
import { registerMisRoutes } from "./server/routes/mis.js";
import { registerEmployeeRoutes } from "./server/routes/employees.js";
import { registerTrackerRoutes } from "./server/routes/tracker.js";
import { registerNotificationRoutes } from "./server/routes/notifications.js";
import { registerAdminRoutes } from "./server/routes/admin.js";
import { registerPartnerRoutes } from "./server/routes/partner.js";
import { registerMeetingRoutes } from "./server/routes/meetings.js";
import { registerWebhookRoutes } from "./server/routes/webhook.js";
import { registerCrmPerformanceRoutes } from "./server/routes/crmPerformance.js";
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
  registerPartnerRoutes(app);   // connector (channel-partner) self-service


  // Import/lead-pull/phone-backfill routes -> ./server/routes/imports.ts
  registerImportRoutes(app);

  registerNotificationRoutes(app);


  registerJobRoutes(app);
  registerCrmPerformanceRoutes(app);
  registerMeetingRoutes(app);


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
