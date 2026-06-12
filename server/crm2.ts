/**
 * CRM 2.0 / Pipeline — server module (Phase 1: counters, audit, perms, masters).
 *
 * Registered from server.ts via registerCrm2Routes(app, { db, admin }).
 * See PLAN.md for the authoritative spec mapping; signed-off decisions:
 *  - Upstream aggregators live in `aggregators/{CONN-xxx}` (field name stays connectorId).
 *  - Permission keys come from users/{uid}.perms, mirrored into custom claims.
 *  - All mutations here; Firestore rules deny client writes on every new collection.
 *
 * Conventions:
 *  - People fields store FAPL-xxx employee codes (resolved from the caller's uid).
 *  - Human-readable doc IDs minted by transactional counters (counters/{counterId}).
 *  - *Enc fields hold EncryptedField objects from src/lib/encryption.
 */

import type express from "express";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type adminNs from "firebase-admin";
import crypto from "crypto";
import { encryptField } from "../src/lib/encryption.js";
import { findSlabOverlaps, resolveSlab, SlabResolutionError, type SlabForResolution } from "../src/lib/crm2/slab.js";
import type { Crm2PermKey } from "../src/types/crm2.js";

interface Deps {
  db: Firestore;
  admin: typeof adminNs;
}

/** Typed 4xx error — handlers throw it; the wrapper maps it to a JSON response. */
class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const MOBILE_RE = /^[6-9]\d{9}$/;

export function registerCrm2Routes(app: express.Express, { db, admin }: Deps): void {
  const { FieldValue, Timestamp } = admin.firestore;

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

  // ─── Validation helpers ──────────────────────────────────────────────────────

  const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  function reqStr(body: Record<string, unknown>, field: string): string {
    const v = body[field];
    if (!isStr(v)) throw new ApiError(400, `${field} is required`);
    return v.trim();
  }
  function optStr(body: Record<string, unknown>, field: string): string | null {
    const v = body[field];
    return isStr(v) ? v.trim() : null;
  }
  function reqEnum<T extends string>(body: Record<string, unknown>, field: string, allowed: readonly T[]): T {
    const v = body[field];
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
      throw new ApiError(400, `${field} must be one of: ${allowed.join(", ")}`);
    }
    return v as T;
  }
  function optNum(body: Record<string, unknown>, field: string): number | null {
    const v = body[field];
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    if (isNaN(n)) throw new ApiError(400, `${field} must be a number`);
    return n;
  }
  function strArr(body: Record<string, unknown>, field: string): string[] {
    const v = body[field];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new ApiError(400, `${field} must be an array of strings`);
    }
    return v as string[];
  }
  /** ISO date string → Timestamp (null passthrough). */
  function optTs(body: Record<string, unknown>, field: string) {
    const v = body[field];
    if (v === undefined || v === null || v === "") return null;
    const d = new Date(v as string);
    if (isNaN(d.getTime())) throw new ApiError(400, `${field} must be an ISO date`);
    return Timestamp.fromDate(d);
  }
  /** Hard guardrail: reject anything that looks like a full Aadhaar number. */
  function rejectFullAadhaar(body: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "string" && /^\d{12}$/.test(v.replace(/[\s-]/g, "")) && /aadhaar/i.test(k)) {
        throw new ApiError(400, `${k}: full Aadhaar numbers are never stored — send only the last 4 digits`);
      }
    }
  }

  /** Wrap a handler: ApiError → its status; anything else → 500. */
  const route = (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
    async (req: express.Request, res: express.Response) => {
      try { await fn(req, res); }
      catch (e) {
        if (e instanceof ApiError) { res.status(e.status).json({ error: e.message, details: e.details ?? null }); return; }
        console.error("crm2 error:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
      }
    };

  // ─── Masters config ──────────────────────────────────────────────────────────
  // Generic create/update for the simple masters; mappings have dedicated routes.

  type Sanitizer = (body: Record<string, unknown>, isCreate: boolean) => Record<string, unknown>;

  const sanitizeLender: Sanitizer = (b, isCreate) => {
    const out: Record<string, unknown> = {};
    if (isCreate || b.name !== undefined) out.name = reqStr(b, "name");
    if (isCreate || b.type !== undefined) out.type = reqEnum(b, "type", ["PSU_BANK", "PRIVATE_BANK", "NBFC", "HFC"] as const);
    if (isCreate || b.productsOffered !== undefined) out.productsOffered = strArr(b, "productsOffered");
    if (isCreate || b.contacts !== undefined) {
      const contacts = Array.isArray(b.contacts) ? b.contacts : [];
      out.contacts = contacts.map((c: Record<string, unknown>) => ({
        name: String(c.name ?? "").trim(), role: ["SM", "RM", "ASM", "OTHER"].includes(String(c.role)) ? c.role : "OTHER",
        email: String(c.email ?? "").trim(), mobile: String(c.mobile ?? "").trim(), branch: String(c.branch ?? "").trim(),
      }));
    }
    if (isCreate || b.loginEmail !== undefined) out.loginEmail = optStr(b, "loginEmail") ?? "";
    if (isCreate || b.tatBenchmarkDays !== undefined) out.tatBenchmarkDays = optNum(b, "tatBenchmarkDays");
    if (isCreate || b.status !== undefined) out.status = reqEnum({ status: b.status ?? "ACTIVE" }, "status", ["ACTIVE", "INACTIVE"] as const);
    return out;
  };

  const sanitizeProduct: Sanitizer = (b, isCreate) => {
    const out: Record<string, unknown> = {};
    if (isCreate || b.name !== undefined) out.name = reqStr(b, "name");
    if (isCreate || b.shortCode !== undefined) out.shortCode = reqStr(b, "shortCode").toUpperCase();
    if (isCreate || b.vertical !== undefined) out.vertical = reqEnum(b, "vertical", ["LOANS", "WEALTH", "INSURANCE", "CHANNEL_PARTNER", "VAS"] as const);
    if (isCreate || b.defaultDocChecklist !== undefined) out.defaultDocChecklist = strArr(b, "defaultDocChecklist");
    if (isCreate || b.defaultRoiRange !== undefined) out.defaultRoiRange = optStr(b, "defaultRoiRange");
    if (isCreate || b.status !== undefined) out.status = reqEnum({ status: b.status ?? "ACTIVE" }, "status", ["ACTIVE", "INACTIVE"] as const);
    return out;
  };

  const sanitizeAggregator: Sanitizer = (b, isCreate) => {
    const out: Record<string, unknown> = {};
    if (isCreate || b.name !== undefined) out.name = reqStr(b, "name");
    if (isCreate || b.type !== undefined) out.type = reqEnum(b, "type", ["MASTER_AGGREGATOR", "SUB_AGGREGATOR"] as const);
    if (isCreate || b.empanelmentDate !== undefined) out.empanelmentDate = optTs(b, "empanelmentDate");
    if (isCreate || b.opsPoc !== undefined) {
      const p = b.opsPoc as Record<string, unknown> | null;
      out.opsPoc = p && isStr(p.name)
        ? { name: String(p.name).trim(), email: String(p.email ?? "").trim(), mobile: String(p.mobile ?? "").trim() }
        : null;
    }
    if (isCreate || b.claimsEmail !== undefined) out.claimsEmail = optStr(b, "claimsEmail");
    if (isCreate || b.accountsEmail !== undefined) out.accountsEmail = optStr(b, "accountsEmail");
    if (isCreate || b.billingEntityName !== undefined) out.billingEntityName = optStr(b, "billingEntityName");
    if (isCreate || b.billingGstin !== undefined) out.billingGstin = optStr(b, "billingGstin");
    if (isCreate || b.payoutFrequency !== undefined) out.payoutFrequency = reqEnum({ payoutFrequency: b.payoutFrequency ?? "MONTHLY" }, "payoutFrequency", ["MONTHLY", "PER_CASE"] as const);
    if (isCreate || b.standardTdsPct !== undefined) {
      const n = optNum(b, "standardTdsPct");
      if (isCreate && n === null) throw new ApiError(400, "standardTdsPct is required");
      if (n !== null) out.standardTdsPct = n;
    }
    if (isCreate || b.status !== undefined) out.status = reqEnum({ status: b.status ?? "ACTIVE" }, "status", ["ACTIVE", "INACTIVE"] as const);
    return out;
  };

  const sanitizeSubDsa: Sanitizer = (b, isCreate) => {
    rejectFullAadhaar(b);
    const out: Record<string, unknown> = {};
    if (isCreate || b.name !== undefined) out.name = reqStr(b, "name");
    if (isCreate || b.type !== undefined) out.type = reqEnum(b, "type", ["INDIVIDUAL", "CORPORATE", "REFERRAL_CLIENT", "WALKIN_REFERRER"] as const);
    if (isCreate || b.sourceLeadId !== undefined) out.sourceLeadId = optStr(b, "sourceLeadId");
    if (isCreate || b.mobile !== undefined) {
      const m = reqStr(b, "mobile").replace(/[\s-]/g, "").replace(/^\+91/, "");
      if (!MOBILE_RE.test(m)) throw new ApiError(400, "mobile must be a 10-digit Indian mobile");
      out.mobile = m;
    }
    if (isCreate || b.email !== undefined) out.email = optStr(b, "email");
    if (isCreate || b.city !== undefined) out.city = optStr(b, "city") ?? "";
    if (isCreate || b.state !== undefined) out.state = optStr(b, "state") ?? "";
    // PAN arrives raw over HTTPS; stored only encrypted + last4.
    if (b.pan !== undefined) {
      const pan = String(b.pan ?? "").trim().toUpperCase();
      if (pan) {
        if (!PAN_RE.test(pan)) throw new ApiError(400, "pan format invalid (expected ABCDE1234F)");
        out.panEnc = encryptField(pan);
        out.panLast4 = pan.slice(-4);
      } else if (!isCreate) { out.panEnc = null; out.panLast4 = null; }
    } else if (isCreate) { out.panEnc = null; out.panLast4 = null; }
    if (isCreate || b.gstin !== undefined) out.gstin = optStr(b, "gstin");
    // Bank account arrives raw; stored encrypted + last4.
    if (b.payoutBank !== undefined) {
      const pb = b.payoutBank as Record<string, unknown> | null;
      if (pb && isStr(pb.accountNo)) {
        const acc = String(pb.accountNo).replace(/\s/g, "");
        if (!/^\d{6,20}$/.test(acc)) throw new ApiError(400, "payoutBank.accountNo must be 6–20 digits");
        const ifsc = String(pb.ifsc ?? "").trim().toUpperCase();
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new ApiError(400, "payoutBank.ifsc format invalid");
        out.payoutBank = {
          accountNoEnc: encryptField(acc), accountNoLast4: acc.slice(-4),
          ifsc, bankName: String(pb.bankName ?? "").trim(),
        };
      } else {
        out.payoutBank = null;
      }
    } else if (isCreate) { out.payoutBank = null; }
    if (isCreate || b.payoutSlabs !== undefined) {
      const slabs = Array.isArray(b.payoutSlabs) ? b.payoutSlabs : [];
      out.payoutSlabs = slabs.map((s: Record<string, unknown>) => {
        const pct = Number(s.payoutPct);
        if (isNaN(pct) || pct < 0 || pct > 100) throw new ApiError(400, "payoutSlabs.payoutPct must be 0–100");
        return { productIds: strArr(s, "productIds"), payoutPct: pct };
      });
    }
    if (isCreate || b.relationshipOwner !== undefined) out.relationshipOwner = reqStr(b, "relationshipOwner"); // FAPL-xxx
    if (isCreate || b.onboardingDate !== undefined) out.onboardingDate = optTs(b, "onboardingDate");
    if (isCreate || b.status !== undefined) out.status = reqEnum({ status: b.status ?? "ACTIVE" }, "status", ["ACTIVE", "INACTIVE", "BLACKLISTED"] as const);
    return out;
  };

  const sanitizeDocumentDef: Sanitizer = (b, isCreate) => {
    const out: Record<string, unknown> = {};
    if (isCreate || b.name !== undefined) out.name = reqStr(b, "name");
    if (isCreate || b.category !== undefined) out.category = reqEnum(b, "category", ["ENTITY_KYC", "INDIVIDUAL_KYC", "FINANCIALS", "PROPERTY", "POST_SANCTION_PDD"] as const);
    if (isCreate || b.applicableTo !== undefined) out.applicableTo = reqEnum(b, "applicableTo", ["ENTITY", "EACH_APPLICANT", "GUARANTOR", "PROPERTY"] as const);
    if (isCreate || b.mandatoryForProducts !== undefined) out.mandatoryForProducts = strArr(b, "mandatoryForProducts");
    if (isCreate || b.validityDays !== undefined) out.validityDays = optNum(b, "validityDays");
    if (isCreate || b.requiredByStage !== undefined) out.requiredByStage = reqEnum(b, "requiredByStage", ["LOGIN", "SANCTION", "DISBURSEMENT", "PDD"] as const);
    if (isCreate || b.status !== undefined) out.status = reqEnum({ status: b.status ?? "ACTIVE" }, "status", ["ACTIVE", "INACTIVE"] as const);
    return out;
  };

  const MASTERS: Record<string, { collection: string; counterId: string; prefix: string; pad: number; sanitize: Sanitizer }> = {
    lenders:        { collection: "lenders",        counterId: "lenders",        prefix: "LEN-",  pad: 3, sanitize: sanitizeLender },
    products:       { collection: "products",       counterId: "products",       prefix: "PRD-",  pad: 3, sanitize: sanitizeProduct },
    // Spec's upstream "connectors" — stored in `aggregators` (PLAN.md decision 1).
    aggregators:    { collection: "aggregators",    counterId: "aggregators",    prefix: "CONN-", pad: 3, sanitize: sanitizeAggregator },
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

  // ─── DSA Code Mappings (the payout engine) ───────────────────────────────────
  // Slab edit policy (spec §11): a live slab's % is never edited in place —
  // end-date it and add a successor. Endpoints: create mapping (with initial
  // slabs), patch identity fields, add slab, end slab. Every slab change is
  // validated against overlaps before commit.

  interface SlabBody {
    productIds: string[]; finvastraPayoutPct: number;
    connectorPayoutPctFromBank: number | null; subDsaDefaultPayoutPct: number | null;
    tdsPct: number | null; effectiveFrom: FirebaseFirestore.Timestamp;
    effectiveTo: FirebaseFirestore.Timestamp | null;
  }

  function sanitizeSlab(b: Record<string, unknown>): SlabBody {
    const productIds = strArr(b, "productIds");
    if (productIds.length === 0) throw new ApiError(400, "productIds must have at least one product");
    const pct = optNum(b, "finvastraPayoutPct");
    if (pct === null || pct <= 0 || pct > 100) throw new ApiError(400, "finvastraPayoutPct must be > 0 and ≤ 100");
    const from = optTs(b, "effectiveFrom");
    if (!from) throw new ApiError(400, "effectiveFrom is required");
    const to = optTs(b, "effectiveTo");
    if (to && to.toMillis() < from.toMillis()) throw new ApiError(400, "effectiveTo must be on/after effectiveFrom");
    return {
      productIds,
      finvastraPayoutPct: pct,
      connectorPayoutPctFromBank: optNum(b, "connectorPayoutPctFromBank"),
      subDsaDefaultPayoutPct: optNum(b, "subDsaDefaultPayoutPct"),
      tdsPct: optNum(b, "tdsPct"),
      effectiveFrom: from,
      effectiveTo: to,
    };
  }

  const toResolution = (s: Record<string, unknown>): SlabForResolution => ({
    slabId: s.slabId as string,
    productIds: s.productIds as string[],
    finvastraPayoutPct: s.finvastraPayoutPct as number,
    subDsaDefaultPayoutPct: (s.subDsaDefaultPayoutPct as number | null) ?? null,
    tdsPct: (s.tdsPct as number | null) ?? null,
    effectiveFromMs: (s.effectiveFrom as FirebaseFirestore.Timestamp).toMillis(),
    effectiveToMs: s.effectiveTo ? (s.effectiveTo as FirebaseFirestore.Timestamp).toMillis() : null,
  });

  function assertNoOverlaps(slabs: Array<Record<string, unknown>>): void {
    const conflicts = findSlabOverlaps(slabs.map(toResolution));
    if (conflicts.length > 0) {
      throw new ApiError(400, "Slab date ranges overlap — end-date the old slab first", conflicts);
    }
  }

  app.post("/api/crm2/mappings", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    const b = req.body ?? {};
    const connectorId = reqStr(b, "connectorId");
    const lenderId = reqStr(b, "lenderId");
    const dsaCode = reqStr(b, "dsaCode");
    const codeRegisteredName = reqStr(b, "codeRegisteredName");
    const slabBodies: Array<Record<string, unknown>> = Array.isArray(b.slabs) ? b.slabs : [];
    const slabs = slabBodies.map((s) => ({ slabId: crypto.randomUUID(), ...sanitizeSlab(s) }));
    assertNoOverlaps(slabs as unknown as Array<Record<string, unknown>>);

    const [agg, lender] = await Promise.all([
      db.collection("aggregators").doc(connectorId).get(),
      db.collection("lenders").doc(lenderId).get(),
    ]);
    if (!agg.exists) throw new ApiError(400, `Connector ${connectorId} not found`);
    if (!lender.exists) throw new ApiError(400, `Lender ${lenderId} not found`);

    const id = await db.runTransaction(async (tx) => {
      // One mapping per connector × lender pair.
      const dup = await tx.get(
        db.collection("dsaCodeMappings")
          .where("connectorId", "==", connectorId)
          .where("lenderId", "==", lenderId).limit(1),
      );
      if (!dup.empty) {
        throw new ApiError(409, `A mapping for this connector × lender already exists (${dup.docs[0].id}) — add slabs to it instead`);
      }
      const newId = await nextIdInTx(tx, "dsaCodeMappings", "MAP-", 3);
      tx.set(db.collection("dsaCodeMappings").doc(newId), {
        connectorId, lenderId, dsaCode, codeRegisteredName,
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
    if (b.codeRegisteredName !== undefined) fields.codeRegisteredName = reqStr(b, "codeRegisteredName");
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
