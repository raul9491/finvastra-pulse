/**
 * server/crm2/context.ts - CRM 2.0 per-request auth/identity/audit helpers,
 * lifted from server/crm2.ts (2026-07-22): decodeToken, resolveFapl (uid->FAPL,
 * cached), requirePerm (claims-first perm gate), getCallerMeta, the audit-stamp
 * builders, and nextIdInTx (transactional counter). Closes over db/admin from
 * ../db.js (same singletons server.ts passes into registerCrm2Routes). Unchanged.
 */
import type express from "express";
import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { db, admin } from "../db.js";
import type { Crm2PermKey } from "../../src/types/crm2.js";

// ─── Auth + permissions ──────────────────────────────────────────────────────

async function decodeToken(req: express.Request) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  try { return await admin.auth().verifyIdToken(h.slice(7)); }
  catch { return null; }
}

// uid → FAPL-xxx (employeeId on the user doc; uid as last resort so audit never breaks)
const faplCache = new Map<string, string>();
async function resolveFapl(uid: string): Promise<string> {
  const hit = faplCache.get(uid);
  if (hit) return hit;
  const snap = await db.collection("users").doc(uid).get();
  const fapl = (snap.data()?.employeeId as string | undefined) || uid;
  faplCache.set(uid, fapl);
  return fapl;
}

/** Verify token + permission key. Platform admins (incl. super admins) hold all keys.
 *  Claims-first; falls back to the users doc for sessions whose token predates the
 *  perms sync. Returns the caller identity or null (response already sent). */
async function requirePerm(
  req: express.Request, res: express.Response, key: Crm2PermKey,
): Promise<{ uid: string; fapl: string } | null> {
  const decoded = await decodeToken(req);
  if (!decoded) { res.status(401).json({ error: "Unauthorized" }); return null; }

  let allowed = decoded.role === "admin"
    || (decoded.perms as Record<string, boolean> | undefined)?.[key] === true;
  if (!allowed) {
    const snap = await db.collection("users").doc(decoded.uid).get();
    const u = snap.data();
    allowed = u?.role === "admin" || u?.perms?.[key] === true;
  }
  if (!allowed) {
    res.status(403).json({ error: `Missing permission: ${key}` });
    return null;
  }
  return { uid: decoded.uid, fapl: await resolveFapl(decoded.uid) };
}

/** Caller's platform role + CRM role — for ownership/assign-RM access on clients. */
async function getCallerMeta(uid: string): Promise<{ isAdmin: boolean; isManager: boolean }> {
  const snap = await db.collection("users").doc(uid).get();
  const u = snap.data() ?? {};
  const isAdmin = u.role === "admin";
  return { isAdmin, isManager: isAdmin || u.crmRole === "manager" };
}

// ─── Audit fields ────────────────────────────────────────────────────────────

const createAudit = (fapl: string) => ({
  createdAt: FieldValue.serverTimestamp(), createdBy: fapl,
  updatedAt: FieldValue.serverTimestamp(), updatedBy: fapl,
});
const updateAudit = (fapl: string) => ({
  updatedAt: FieldValue.serverTimestamp(), updatedBy: fapl,
});

// ─── Transactional counters (counters/{counterId}) ──────────────────────────
// Read → increment → format, inside the CALLER's transaction so the counter
// bump and the document create are atomic. Year-scoped counters roll over
// lazily (a missing counter doc starts at 1).

async function nextIdInTx(
  tx: Transaction, counterId: string, prefix: string, pad: number,
): Promise<string> {
  const ref = db.collection("counters").doc(counterId);
  const snap = await tx.get(ref);
  const seq = ((snap.data()?.seq as number | undefined) ?? 0) + 1;
  tx.set(ref, { seq, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return `${prefix}${String(seq).padStart(pad, "0")}`;
}

export { decodeToken, resolveFapl, requirePerm, getCallerMeta, createAudit, updateAudit, nextIdInTx };
