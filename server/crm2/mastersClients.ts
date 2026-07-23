/**
 * server/crm2/mastersClients.ts - the generic master-collection CRUD and the
 * Client Master (FCL-YYYY-#####).
 *
 * Extracted verbatim from server/crm2.ts (2026-07-23); only the dedent and
 * registerMastersClientRoutes(app). NOT on the money path: this edits the
 * reference data (lenders/products/aggregators/sub-products/documents) and the
 * client records, while the DSA-code mappings and their payout slabs - which the
 * disburse path reads through resolveMapping - deliberately stay in crm2.ts
 * until the money groups are extracted one at a time.
 *
 * MASTERS is the single registry mapping a master `type` to its collection,
 * counter, id prefix and sanitizer; every master route goes through masterCfg()
 * so an unknown type is rejected rather than silently writing a new collection.
 *
 * Client writes stay server-only (rules deny client writes); ownerRm assignment
 * and blacklisting are manager/admin, detail edits are owner-or-admin.
 */
import type express from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../db.js';
import { route, ApiError, optStr, isStr } from './core.js';
import { requirePerm, getCallerMeta, createAudit, updateAudit, nextIdInTx } from './context.js';
import {
  type Sanitizer, sanitizeLender, sanitizeProduct, sanitizeSubProduct,
  sanitizeAggregator, sanitizeSubDsa, sanitizeDocumentDef, sanitizeClient,
} from './sanitizers.js';

export function registerMastersClientRoutes(app: express.Express): void {
  // ─── Masters config ──────────────────────────────────────────────────────────
  // Generic create/update for the simple masters; mappings have dedicated routes.


  const MASTERS: Record<string, { collection: string; counterId: string; prefix: string; pad: number; sanitize: Sanitizer }> = {
    lenders:        { collection: "lenders",        counterId: "lenders",        prefix: "LEN-",  pad: 3, sanitize: sanitizeLender },
    products:       { collection: "products",       counterId: "products",       prefix: "PRD-",  pad: 3, sanitize: sanitizeProduct },
    subProducts:    { collection: "subProducts",    counterId: "subProducts",    prefix: "SUBP-", pad: 3, sanitize: sanitizeSubProduct },
    // Spec's upstream "connectors" — stored in `aggregators` (PLAN.md decision 1).
    aggregators:    { collection: "aggregators",    counterId: "aggregators",    prefix: "AGG-",  pad: 3, sanitize: sanitizeAggregator },
    subDsas:        { collection: "subDsas",        counterId: "subDsas",        prefix: "SDSA-", pad: 3, sanitize: sanitizeSubDsa },
    documentMaster: { collection: "documentMaster", counterId: "documentMaster", prefix: "DOC-",  pad: 3, sanitize: sanitizeDocumentDef },
  };

  function masterCfg(type: string) {
    const cfg = MASTERS[type];
    if (!cfg) throw new ApiError(404, `Unknown master type '${type}'`);
    return cfg;
  }

  // ─── Masters CRUD ────────────────────────────────────────────────────────────

  app.post("/api/crm2/masters/:type", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    const cfg = masterCfg(req.params.type);
    const fields = cfg.sanitize(req.body ?? {}, true);

    const id = await db.runTransaction(async (tx) => {
      const newId = await nextIdInTx(tx, cfg.counterId, cfg.prefix, cfg.pad);
      tx.set(db.collection(cfg.collection).doc(newId), { ...fields, ...createAudit(caller.fapl) });
      return newId;
    });

    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: `crm2_create_${cfg.collection}`,
      targetPath: `/${cfg.collection}/${id}`, at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, id });
  }));

  app.patch("/api/crm2/masters/:type/:id", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    const cfg = masterCfg(req.params.type);
    const ref = db.collection(cfg.collection).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, `${req.params.id} not found`);
    const fields = cfg.sanitize(req.body ?? {}, false);
    if (Object.keys(fields).length === 0) throw new ApiError(400, "No editable fields in payload");
    await ref.update({ ...fields, ...updateAudit(caller.fapl) });
    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: `crm2_update_${cfg.collection}`,
      targetPath: `/${cfg.collection}/${req.params.id}`, at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true });
  }));

  // ─── One-time: rename legacy aggregator ids CONN-### → AGG-### ────────────────
  // Aggregators were historically minted with a CONN- prefix (PLAN decision E).
  // They are now AGG-. This migrates any existing CONN- aggregator doc to the same
  // number under AGG-, repointing every `connectorId` reference (mappings, cases,
  // logins, misRecords, payoutCycles). Idempotent + reference-safe; super-admin UI.
  app.post("/api/crm2/admin/migrate-aggregator-ids", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    const snap = await db.collection("aggregators").get();
    const legacy = snap.docs.filter((d) => /^CONN-\d+$/.test(d.id));
    const migrated: Array<{ old: string; new: string; repointed: number; skipped?: string }> = [];

    for (const d of legacy) {
      const newId = d.id.replace(/^CONN-/, "AGG-");
      const newRef = db.collection("aggregators").doc(newId);
      if ((await newRef.get()).exists) { migrated.push({ old: d.id, new: newId, repointed: 0, skipped: "target exists" }); continue; }
      await newRef.set(d.data()!);
      let repointed = 0;
      // Top-level collections that store the aggregator ref as `connectorId`.
      for (const coll of ["dsaCodeMappings", "cases", "misRecords", "payoutCycles"]) {
        const refs = await db.collection(coll).where("connectorId", "==", d.id).get();
        for (let i = 0; i < refs.docs.length; i += 400) {
          const batch = db.batch();
          refs.docs.slice(i, i + 400).forEach((r) => batch.update(r.ref, { connectorId: newId }));
          await batch.commit();
        }
        repointed += refs.size;
      }
      // Logins live under cases/{id}/logins — iterate each case's subcollection.
      const cases = await db.collection("cases").get();
      for (const c of cases.docs) {
        const lg = await c.ref.collection("logins").where("connectorId", "==", d.id).get();
        if (lg.empty) continue;
        const batch = db.batch();
        lg.docs.forEach((r) => batch.update(r.ref, { connectorId: newId }));
        await batch.commit();
        repointed += lg.size;
      }
      await d.ref.delete();
      migrated.push({ old: d.id, new: newId, repointed });
    }
    res.json({ ok: true, migrated });
  }));


  // ─── Clients — direct CRUD (Client Master) ───────────────────────────────────
  // FCL-YYYY-##### ids. RMs manage their OWN clients; assign-RM + blacklist are
  // manager/admin only. Reads are rule-scoped (crm.leads.read/cases.read); writes
  // are server-only here.

  app.post("/api/crm2/clients", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const fields = sanitizeClient(b, true);
    const meta = await getCallerMeta(caller.uid);
    // RM owns the clients they create; only an admin may set an explicit owner.
    const ownerRm = (meta.isAdmin && isStr(b.ownerRm)) ? String(b.ownerRm).trim() : caller.fapl;
    const year = new Date().getFullYear();

    const id = await db.runTransaction(async (tx) => {
      const counterRef = db.collection("counters").doc(`clients-${year}`);
      const seq = (((await tx.get(counterRef)).data()?.seq as number | undefined) ?? 0) + 1;
      const newId = `FCL-${year}-${String(seq).padStart(5, "0")}`;
      tx.set(counterRef, { seq, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(db.collection("clients").doc(newId), {
        ...fields, ownerRm, sourceLeadId: null, ...createAudit(caller.fapl),
      });
      return newId;
    });

    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: "crm2_create_clients",
      targetPath: `/clients/${id}`, at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, id });
  }));

  app.patch("/api/crm2/clients/:id", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ref = db.collection("clients").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, `${req.params.id} not found`);
    const client = snap.data()!;
    const meta = await getCallerMeta(caller.uid);
    const isOwner = client.ownerRm === caller.fapl;

    // Split privileged keys (assign-RM, blacklist) from ordinary detail edits.
    const PRIVILEGED = new Set(["ownerRm", "status"]);
    const privilegedPresent = Object.keys(b).filter((k) => PRIVILEGED.has(k));
    const detailKeys = Object.keys(b).filter((k) => !PRIVILEGED.has(k));
    if (privilegedPresent.length > 0 && !meta.isManager) {
      throw new ApiError(403, `Assign-RM / blacklist require a manager or admin: ${privilegedPresent.join(", ")}`);
    }
    if (detailKeys.length > 0 && !(meta.isAdmin || isOwner)) {
      throw new ApiError(403, "You can only edit your own clients");
    }

    const fields = sanitizeClient(b, false);   // status handled here; gated above
    if (b.ownerRm !== undefined) {
      const rm = optStr(b, "ownerRm");
      if (!rm) throw new ApiError(400, "ownerRm cannot be empty");
      fields.ownerRm = rm;
    }
    if (Object.keys(fields).length === 0) throw new ApiError(400, "No editable fields in payload");
    await ref.update({ ...fields, ...updateAudit(caller.fapl) });

    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: "crm2_update_clients",
      targetPath: `/clients/${req.params.id}`, at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true });
  }));
}
