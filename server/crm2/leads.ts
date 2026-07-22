/**
 * server/crm2/leads.ts - shared lead-domain helpers, lifted from server/crm2.ts
 * (2026-07-22): rateLimit (per-key Firestore sliding window, fail-open),
 * findDuplicate (dupeKeys intersect across leads+clients, flag-not-block),
 * leadYearCounter. Self-contained (db + FieldValue). Used by lead routes + the
 * meta/whatsapp intake processors.
 */
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../db.js";

async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const ref = db.collection("rate_limits").doc(key.replace(/[/]/g, "_"));
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const d = snap.data();
      if (!d || now - (d.windowStart as number) > windowMs) {
        tx.set(ref, { count: 1, windowStart: now, updatedAt: FieldValue.serverTimestamp() });
        return true;
      }
      if ((d.count as number) >= max) return false;
      tx.update(ref, { count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
      return true;
    });
  } catch { return true; } // fail open — a transient error must not block intake
}

/** First lead/client whose dupeKeys intersect — used to FLAG, never block. */
async function findDuplicate(dupeKeys: string[], excludeLeadId?: string):
  Promise<{ collection: "leads" | "clients"; id: string } | null> {
  for (const key of dupeKeys) {
    for (const coll of ["leads", "clients"] as const) {
      const snap = await db.collection(coll)
        .where("dupeKeys", "array-contains", key).limit(2).get();
      const hit = snap.docs.find((d) => d.id !== excludeLeadId);
      if (hit) return { collection: coll, id: hit.id };
    }
  }
  return null;
}

const leadYearCounter = () => `leads-${new Date().getFullYear()}`;

export { rateLimit, findDuplicate, leadYearCounter };
