/**
 * server/lib/auth.ts - request-auth + rate-limit + super-admin + env-validation
 * helpers, lifted from server.ts (2026-07-21, Phase 3). verifyFirebaseToken (ID
 * token), verifySchedulerOIDC (Cloud Scheduler OIDC), isSuperAdmin, checkRateLimit
 * (Firestore sliding-window), validateServerEnv, plus HOUR_MS + SUPER_ADMIN_UIDS_LIST.
 * These are foundational — the perf/email/route modules depend on them — so they
 * live in a shared module the whole server can import. Pure move, behavior unchanged.
 * (validateServerEnv is exported; server.ts still makes the startup CALL.)
 */
import type express from "express";
import { OAuth2Client } from "google-auth-library";
import { db, admin } from "../db.js";

// ─── Auth middleware ───────────────────────────────────────────────────────────
async function verifyFirebaseToken(req: express.Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    return decoded.uid;
  } catch {
    return null;
  }
}

// ─── Cloud Scheduler OIDC auth ────────────────────────────────────────────────
// Cloud Scheduler sends an OIDC token, not a Firebase ID token.
// Verify it with google-auth-library and confirm the issuing service account
// matches the one attached to the pulse-api Cloud Run service.
const _schedulerOidcClient = new OAuth2Client();
const SCHEDULER_SA_EMAIL = "787616231546-compute@developer.gserviceaccount.com";

async function verifySchedulerOIDC(req: express.Request): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return false;
  try {
    const ticket = await _schedulerOidcClient.verifyIdToken({ idToken: authHeader.slice(7) });
    const payload = ticket.getPayload();
    return payload?.email === SCHEDULER_SA_EMAIL && payload?.email_verified === true;
  } catch {
    return false;
  }
}

// ─── Server env validation ────────────────────────────────────────────────────
function validateServerEnv(): void {
  if (process.env.NODE_ENV !== "production") return;
  const missing: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID)     missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!process.env.PAN_ENCRYPTION_KEY || process.env.PAN_ENCRYPTION_KEY.length < 64) {
    missing.push("PAN_ENCRYPTION_KEY (must be 64 hex chars / 32 bytes)");
  }
  if (missing.length > 0) {
    throw new Error(
      `[server] Missing required production env vars: ${missing.join(", ")}. ` +
      "Add them to Cloud Run environment configuration before deploying."
    );
  }
}

// ─── Super admin protection ───────────────────────────────────────────────────
// These three accounts cannot be deactivated or have their roles changed by
// non-super-admins — enforced here and in firestore.rules.
const SUPER_ADMIN_UIDS_LIST = (process.env.SUPER_ADMIN_UIDS || '')
  .split(',').map((u: string) => u.trim()).filter(Boolean);
function isSuperAdmin(uid: string): boolean {
  return SUPER_ADMIN_UIDS_LIST.includes(uid);
}

// ─── Firestore-based rate limiter (sliding window, multi-instance safe) ───────
// Keyed by "{endpoint}:{userId or IP}" in the /rate_limits collection.
// Uses Firestore transactions so concurrent requests across Cloud Run instances
// share the same counter — replaces the previous single-instance in-memory store.
const HOUR_MS = 60 * 60 * 1000;

async function checkRateLimit(
  identifier: string,
  endpoint: string,
  maxRequests: number,
  windowMs: number,
): Promise<boolean> {
  const key = `${endpoint}:${identifier}`;
  const ref = db.collection("rate_limits").doc(key);
  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    const allowed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      let count = 0;
      let wStart = now;

      if (snap.exists) {
        const data = snap.data()!;
        wStart = data.windowStart ?? now;
        count  = data.count ?? 0;
        // Reset window if it has expired
        if (wStart < windowStart) { count = 0; wStart = now; }
      }

      if (count >= maxRequests) return false;
      tx.set(ref, { count: count + 1, windowStart: wStart, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
    return allowed;
  } catch {
    // On Firestore error, fail open so a transient error doesn't block all uploads.
    return true;
  }
}

export { verifyFirebaseToken, verifySchedulerOIDC, validateServerEnv, isSuperAdmin, checkRateLimit, SUPER_ADMIN_UIDS_LIST, HOUR_MS };
