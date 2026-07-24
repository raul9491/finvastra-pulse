/**
 * server/crm2/mappingRoutes.ts - DSA-code mapping CRUD + payout-slab timeline.
 *
 *   POST  /api/crm2/mappings                    create (aggregator x lender x product)
 *   PATCH /api/crm2/mappings/:id
 *   POST  /api/crm2/mappings/:id/slabs          add a slab (payout %) with dates
 *   GET   /api/crm2/mappings/:id/resolve-slab    live preview for the disburse dialog
 *   POST  /api/crm2/mappings/:id/slabs/:slabId/end
 *
 * MONEY-ADJACENT but a CLEAN extraction: these are the ADMIN CRUD for the
 * DSA-code mappings and their payout slabs. The disburse path's resolveMapping()
 * (which picks the mapping at disbursement and is read at four call sites)
 * DELIBERATELY STAYS in crm2.ts next to disburse - it is untouched by this move.
 * These routes use only the tested slab libs (slab.js resolveSlab/findSlabOverlaps,
 * slabs.js sanitizeSlab/toResolution/assertNoOverlaps), so no crm2.ts-local helper
 * is threaded. Verified with the money gate all the same.
 *
 * Extracted verbatim from server/crm2.ts (2026-07-23); only the dedent +
 * registerMappingRoutes(app).
 */
import type express from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../db.js';
import { route, ApiError, reqStr, optStr, reqEnum, optTs } from './core.js';
import { requirePerm, createAudit, updateAudit, nextIdInTx } from './context.js';
import { resolveSlab, SlabResolutionError } from '../../src/lib/crm2/slab.js';
import { sanitizeSlab, toResolution, assertNoOverlaps } from './slabs.js';

export function registerMappingRoutes(app: express.Express): void {
  app.post("/api/crm2/mappings", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    const b = req.body ?? {};
    const connectorId = reqStr(b, "connectorId");   // aggregator id
    const lenderId = reqStr(b, "lenderId");
    const productId = reqStr(b, "productId");
    const subProduct = optStr(b, "subProduct");      // optional finer grain
    const dsaCode = reqStr(b, "dsaCode");
    const codeRegisteredName = optStr(b, "codeRegisteredName");   // OPTIONAL
    const slabBodies: Array<Record<string, unknown>> = Array.isArray(b.slabs) ? b.slabs : [];
    const slabs = slabBodies.map((s) => ({ slabId: crypto.randomUUID(), ...sanitizeSlab(s) }));
    assertNoOverlaps(slabs as unknown as Array<Record<string, unknown>>);

    const [agg, lender, product] = await Promise.all([
      db.collection("aggregators").doc(connectorId).get(),
      db.collection("lenders").doc(lenderId).get(),
      db.collection("products").doc(productId).get(),
    ]);
    if (!agg.exists) throw new ApiError(400, `Aggregator ${connectorId} not found`);
    if (!lender.exists) throw new ApiError(400, `Lender ${lenderId} not found`);
    if (!product.exists) throw new ApiError(400, `Product ${productId} not found`);

    const id = await db.runTransaction(async (tx) => {
      // One mapping per aggregator × lender × product (× sub-product).
      const dup = await tx.get(
        db.collection("dsaCodeMappings")
          .where("connectorId", "==", connectorId)
          .where("lenderId", "==", lenderId)
          .where("productId", "==", productId),
      );
      const clash = dup.docs.find((d) => (d.data().subProduct ?? null) === (subProduct ?? null));
      if (clash) {
        const grain = subProduct ? ` × ${subProduct}` : "";
        throw new ApiError(409, `A mapping for this aggregator × lender × product${grain} already exists (${clash.id}) — edit it / add slabs instead`);
      }
      const newId = await nextIdInTx(tx, "dsaCodeMappings", "MAP-", 3);
      tx.set(db.collection("dsaCodeMappings").doc(newId), {
        connectorId, lenderId, productId, subProduct: subProduct ?? null,
        dsaCode, codeRegisteredName: codeRegisteredName ?? null,
        status: "ACTIVE", slabs, ...createAudit(caller.fapl),
      });
      return newId;
    });

    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: "crm2_create_dsaCodeMappings",
      targetPath: `/dsaCodeMappings/${id}`, at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, id });
  }));

  // Identity fields only — slabs are managed exclusively by the slab endpoints.
  app.patch("/api/crm2/mappings/:id", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    const b = req.body ?? {};
    const fields: Record<string, unknown> = {};
    if (b.dsaCode !== undefined) fields.dsaCode = reqStr(b, "dsaCode");
    if (b.codeRegisteredName !== undefined) fields.codeRegisteredName = optStr(b, "codeRegisteredName");
    if (b.status !== undefined) fields.status = reqEnum(b, "status", ["ACTIVE", "INACTIVE"] as const);
    if (b.slabs !== undefined) throw new ApiError(400, "Slabs are edited via the slab endpoints, never patched directly");
    if (Object.keys(fields).length === 0) throw new ApiError(400, "No editable fields in payload");
    const ref = db.collection("dsaCodeMappings").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, `${req.params.id} not found`);
    await ref.update({ ...fields, ...updateAudit(caller.fapl) });
    res.json({ ok: true });
  }));

  app.post("/api/crm2/mappings/:id/slabs", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    const newSlab = { slabId: crypto.randomUUID(), ...sanitizeSlab(req.body ?? {}) };

    await db.runTransaction(async (tx) => {
      const ref = db.collection("dsaCodeMappings").doc(req.params.id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new ApiError(404, `${req.params.id} not found`);
      const slabs = [...(snap.data()!.slabs ?? []), newSlab];
      assertNoOverlaps(slabs);
      tx.update(ref, { slabs, ...updateAudit(caller.fapl) });
    });

    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: "crm2_add_slab",
      targetPath: `/dsaCodeMappings/${req.params.id}`, after: { slabId: newSlab.slabId },
      at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, slabId: newSlab.slabId });
  }));

  // Slab-resolution preview — the disburse dialog's "Slab: X × Y × Z — 1.40%
  // w.e.f. … → expected ₹N" line, and the wiring smoke test's target. Returns the
  // exact slab the disburse endpoint would freeze, or the typed resolution error.
  // Money data → payout.amounts.read.
  app.get("/api/crm2/mappings/:id/resolve-slab", route(async (req, res) => {
    const caller = await requirePerm(req, res, "payout.amounts.read");
    if (!caller) return;
    const productId = String(req.query.productId ?? "");
    const dateStr = String(req.query.date ?? "");
    if (!productId) throw new ApiError(400, "productId query param is required");
    const date = new Date(dateStr);
    if (!dateStr || isNaN(date.getTime())) throw new ApiError(400, "date query param must be an ISO date");

    const snap = await db.collection("dsaCodeMappings").doc(req.params.id).get();
    if (!snap.exists) throw new ApiError(404, `${req.params.id} not found`);
    const m = snap.data()!;

    const [agg, lender, product] = await Promise.all([
      db.collection("aggregators").doc(m.connectorId).get(),
      db.collection("lenders").doc(m.lenderId).get(),
      db.collection("products").doc(productId).get(),
    ]);
    try {
      const slab = resolveSlab(
        (m.slabs ?? []).map(toResolution),
        productId,
        date.getTime(),
        {
          connectorName: agg.data()?.name ?? m.connectorId,
          lenderName: lender.data()?.name ?? m.lenderId,
          productName: product.data()?.shortCode ?? productId,
        },
      );
      res.json({ ok: true, slab });
    } catch (e) {
      if (e instanceof SlabResolutionError) {
        res.status(422).json({ error: e.message, kind: e.kind });
        return;
      }
      throw e;
    }
  }));

  app.post("/api/crm2/mappings/:id/slabs/:slabId/end", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    const effectiveTo = optTs(req.body ?? {}, "effectiveTo");
    if (!effectiveTo) throw new ApiError(400, "effectiveTo is required");

    await db.runTransaction(async (tx) => {
      const ref = db.collection("dsaCodeMappings").doc(req.params.id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new ApiError(404, `${req.params.id} not found`);
      const slabs: Array<Record<string, unknown>> = [...(snap.data()!.slabs ?? [])];
      const idx = slabs.findIndex((s) => s.slabId === req.params.slabId);
      if (idx === -1) throw new ApiError(404, `Slab ${req.params.slabId} not found on ${req.params.id}`);
      const slab = slabs[idx];
      if ((slab.effectiveFrom as FirebaseFirestore.Timestamp).toMillis() > effectiveTo.toMillis()) {
        throw new ApiError(400, "effectiveTo must be on/after the slab's effectiveFrom");
      }
      slabs[idx] = { ...slab, effectiveTo };
      assertNoOverlaps(slabs);
      tx.update(ref, { slabs, ...updateAudit(caller.fapl) });
    });

    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: "crm2_end_slab",
      targetPath: `/dsaCodeMappings/${req.params.id}`, after: { slabId: req.params.slabId },
      at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true });
  }));
}
