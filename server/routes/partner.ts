/**
 * server/routes/partner.ts — the connector (channel partner) self-service API.
 *
 * A connector is an EXTERNAL channel partner issued a @finvastra.com login, so the
 * identity alone does not distinguish them from staff — `connectorId` does (stamped
 * into custom claims by sync-claims; see the "Connector isolation" section of
 * CLAUDE.md).
 *
 * Their leads / cases / payouts are read straight from Firestore by the client,
 * because firestore.rules already scopes those to `channelPartnerId == own` and a
 * live subscription is nicer than polling. This module exists for the ONE thing the
 * client must NOT read directly: `/connectors/{id}/private/financial`, which holds
 * the ENCRYPTED PAN and account number. That doc stays admin/HR-only in the rules;
 * this endpoint returns the LAST-4 ONLY, so ciphertext never leaves the server and
 * a full PAN or account number can never be reconstructed client-side.
 *
 * Everything here is self-scoped: the caller's own connectorId is the only key
 * used, and is taken from the verified token — never from the request.
 */
import type express from "express";
import { db } from "../db.js";
import { route, ApiError } from "../crm2/core.js";
import { decodeToken } from "../crm2/context.js";

/** The caller's own CON-### id, or null when they are staff. Claims-first with a
 *  doc fallback so a freshly-created connector works before their token refreshes. */
async function callerConnectorId(req: express.Request): Promise<string | null> {
  const decoded = await decodeToken(req);
  if (!decoded) return null;
  const fromClaim = (decoded as { connectorId?: unknown }).connectorId;
  if (typeof fromClaim === "string" && fromClaim) return fromClaim;
  const snap = await db.collection("users").doc(decoded.uid).get();
  const v = snap.data()?.connectorId;
  return typeof v === "string" && v ? v : null;
}

/** 401 for "not signed in", 403 for "signed in but not a connector". */
async function requireConnector(req: express.Request): Promise<string> {
  const decoded = await decodeToken(req);
  if (!decoded) throw new ApiError(401, "Unauthorized");
  const id = await callerConnectorId(req);
  if (!id) throw new ApiError(403, "This area is for channel partners only");
  return id;
}

export function registerPartnerRoutes(app: express.Express): void {
  /**
   * GET /api/crm2/partner/me — the caller's own partner profile.
   *
   * Returns last-4 for PAN / Aadhaar / bank account and NOTHING else sensitive:
   * `panEnc` and `payoutBank.accountNoEnc` are deliberately never read into the
   * response shape, so no ciphertext is shipped to a browser.
   */
  app.get("/api/crm2/partner/me", route(async (req, res) => {
    const connectorId = await requireConnector(req);

    const [mainSnap, finSnap] = await Promise.all([
      db.collection("connectors").doc(connectorId).get(),
      db.collection("connectors").doc(connectorId).collection("private").doc("financial").get(),
    ]);
    if (!mainSnap.exists) throw new ApiError(404, "Partner record not found");

    const m = mainSnap.data() ?? {};
    const f = finSnap.exists ? (finSnap.data() ?? {}) : {};
    const bank = (f.payoutBank ?? {}) as Record<string, unknown>;

    res.json({
      connector: {
        id: connectorId,
        connectorCode: m.connectorCode ?? connectorId,
        displayName: m.displayName ?? null,
        firmName: m.firmName ?? null,
        entityType: m.entityType ?? null,
        mobile: m.mobile ?? null,
        mobiles: Array.isArray(m.mobiles) ? m.mobiles : (m.mobile ? [m.mobile] : []),
        email: m.email ?? null,
        verticals: Array.isArray(m.verticals) ? m.verticals : [],
        status: m.status ?? null,
        funnelStatus: m.funnelStatus ?? null,
        gstin: m.gstin ?? null,
      },
      // LAST-4 ONLY — the encrypted values are never included.
      kyc: {
        panLast4: (f.panLast4 as string | null) ?? null,
        aadhaarLast4: (f.aadhaarLast4 as string | null) ?? null,
      },
      bank: {
        bankName: (bank.bankName as string | null) ?? null,
        accountHolderName: (bank.accountHolderName as string | null) ?? null,
        ifsc: (bank.ifsc as string | null) ?? null,
        accountNoLast4: (bank.accountNoLast4 as string | null) ?? null,
        branchName: (bank.branchName as string | null) ?? null,
      },
      tdsPct: (f.tdsPct as number | null) ?? null,
    });
  }));

  /**
   * GET /api/crm2/partner/summary — headline counts + payout totals for the
   * caller's own book. Served here rather than computed client-side so a partner
   * never needs a broad query to produce their own numbers.
   */
  app.get("/api/crm2/partner/summary", route(async (req, res) => {
    const connectorId = await requireConnector(req);

    const [leadsSnap, casesSnap, payoutsSnap] = await Promise.all([
      db.collection("leads").where("channelPartnerId", "==", connectorId).get(),
      db.collection("cases").where("channelPartnerId", "==", connectorId).get(),
      db.collection("connector_payouts").where("connectorId", "==", connectorId).get(),
    ]);

    const leads = leadsSnap.docs.map((d) => d.data()).filter((l) => l.deleted !== true);
    const cases = casesSnap.docs.map((d) => d.data());

    let pending = 0, paid = 0;
    for (const d of payoutsSnap.docs) {
      const p = d.data();
      const amt = typeof p.amount === "number" ? p.amount : 0;
      if (p.status === "paid") paid += amt; else pending += amt;
    }

    res.json({
      connectorId,
      leads: { total: leads.length, converted: leads.filter((l) => l.converted === true).length },
      cases: {
        total: cases.length,
        open: cases.filter((c) => c.stage !== "COMPLETED" && c.stage !== "CLOSED").length,
        completed: cases.filter((c) => c.stage === "COMPLETED").length,
      },
      payouts: { pending, paid, total: pending + paid, count: payoutsSnap.size },
    });
  }));
}
