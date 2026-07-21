/**
 * server/lib/oauth.ts — the shared Google OAuth2 client singleton, lifted from
 * server.ts (2026-07-21, Phase 3). Its `.credentials` are set during the admin's
 * Google OAuth callback and later read by the leave→calendar sync route, so ALL
 * consumers must import THIS one instance (a per-route client would lose the
 * mutated credentials). Behavior unchanged.
 */
import { google } from "googleapis";

export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/api/auth/callback`
);
