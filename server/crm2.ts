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
import { buildDupeKeys, normaliseMobile } from "../src/lib/crm2/dedupe.js";
import { extractClientIp } from "../src/lib/crm2/http.js";
import {
  validateTransition, gateForStage, keyDateForStage,
} from "../src/lib/crm2/stages.js";
import type { Crm2PermKey } from "../src/types/crm2.js";

type CaseStageT =
  | "OPENED" | "ELIGIBILITY" | "DOC_COLLECTION" | "CODE_ASSIGNMENT" | "LOGIN"
  | "UNDER_PROCESS" | "SANCTIONED" | "DISBURSED" | "PDD_OTC" | "CLOSED";

interface StageTrackerRow {
  rowId: string; documentDefId: string; applicantId: string | null;
  requiredByStage: "LOGIN" | "SANCTION" | "DISBURSEMENT" | "PDD";
  status: "PENDING" | "REQUESTED" | "RECEIVED" | "VERIFIED" | "REJECTED_REUPLOAD" | "EXPIRED";
  vaultDocId: string | null;
}

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

  // ═══ Phase 2 — Leads: public intake, internal CRUD, dedupe, convert ═══════════

  const LEAD_CATEGORIES = ["LOAN", "WEALTH", "INSURANCE", "CIBIL_CHECK", "PARTNER_DSA", "GENERAL"] as const;
  const LEAD_SOURCES = ["WEBSITE", "JUSTDIAL", "REFERRAL_CLIENT", "REFERRAL_SUBDSA", "ADS", "WALKIN", "COLD_CALL"] as const;
  const LEAD_STATUSES = ["NEW", "ATTEMPTED", "CONTACTED", "QUALIFIED", "JUNK_DUPLICATE", "NOT_INTERESTED", "CONVERTED", "DROPPED"] as const;
  const DROP_REASONS = ["RATE", "AVAILED_ELSEWHERE", "NOT_ELIGIBLE", "UNREACHABLE", "DOCS_ISSUE"] as const;

  /** Firestore-transaction rate limit (multi-instance safe) — same pattern as the
   *  existing /rate_limits collection. Returns false when over the limit. */
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

  // ─── Public intake (finvastra.com forms) — no auth, rate-limited, honeypot ───
  app.post("/api/public/leads", route(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;

    // Honeypot: bots fill the hidden "website" field — pretend success, write nothing.
    if (isStr(b.website)) { res.json({ ok: true }); return; }

    // Real client IP: Cloud Run appends it as the LAST X-Forwarded-For entry
    // (first-entry parsing is client-spoofable). req.ip agrees via trust proxy=1.
    const ip = extractClientIp(req.headers["x-forwarded-for"], req.ip);
    if (!(await rateLimit(`crm2pub:${ip}`, 20, 60 * 60 * 1000))) {
      throw new ApiError(429, "Too many submissions — try again later");
    }

    // Strict payload validation
    const name = reqStr(b, "name");
    if (name.length < 2 || name.length > 120) throw new ApiError(400, "name must be 2–120 chars");
    const mobile = normaliseMobile(String(b.mobile ?? ""));
    if (!mobile) throw new ApiError(400, "mobile must be a valid 10-digit Indian mobile");
    const email = optStr(b, "email");
    const category = (LEAD_CATEGORIES as readonly string[]).includes(String(b.category))
      ? String(b.category) : "GENERAL";
    const amountRequired = optNum(b, "amountRequired");
    const utmRaw = (b.utm ?? null) as Record<string, unknown> | null;
    const utm = utmRaw && typeof utmRaw === "object"
      ? {
          ...(isStr(utmRaw.source) ? { source: String(utmRaw.source).slice(0, 100) } : {}),
          ...(isStr(utmRaw.medium) ? { medium: String(utmRaw.medium).slice(0, 100) } : {}),
          ...(isStr(utmRaw.campaign) ? { campaign: String(utmRaw.campaign).slice(0, 100) } : {}),
        }
      : null;

    const dupeKeys = buildDupeKeys(mobile, email);
    const duplicate = await findDuplicate(dupeKeys);

    const id = await db.runTransaction(async (tx) => {
      const newId = await nextIdInTx(tx, leadYearCounter(), `LD-${new Date().getFullYear()}-`, 5);
      tx.set(db.collection("leads").doc(newId), {
        receivedAt: FieldValue.serverTimestamp(),
        category, productId: null,
        name, mobile, email: email ?? null,
        city: optStr(b, "city"),
        source: "WEBSITE",
        sourceMeta: {
          formId: optStr(b, "formId"),
          sourceUrl: optStr(b, "sourceUrl")?.slice(0, 500) ?? null,
          utm: utm && Object.keys(utm).length > 0 ? utm : null,
        },
        amountRequired,
        referredById: null, referredByType: null,
        assignedRm: null, assignedAt: null,
        status: "NEW", priority: "WARM",
        nextFollowUpAt: null, attempts: 0,
        activityLog: [], dropReason: null,
        converted: false, convertedAt: null,
        linkedClientId: null, linkedCaseId: null, linkedSubDsaId: null,
        duplicateOfLeadId: duplicate?.collection === "leads" ? duplicate.id : null,
        dupeKeys,
        ...createAudit("public:website"),
      });
      return newId;
    });
    res.json({ ok: true, id });
  }));

  // ─── Internal lead create ─────────────────────────────────────────────────────
  app.post("/api/crm2/leads", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.leads.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;

    const name = reqStr(b, "name");
    const mobile = normaliseMobile(String(b.mobile ?? ""));
    if (!mobile) throw new ApiError(400, "mobile must be a valid 10-digit Indian mobile");
    const email = optStr(b, "email");
    const category = reqEnum(b, "category", LEAD_CATEGORIES);
    const source = reqEnum(b, "source", LEAD_SOURCES);
    const assignedRm = optStr(b, "assignedRm");
    const dupeKeys = buildDupeKeys(mobile, email);
    const duplicate = await findDuplicate(dupeKeys);

    const id = await db.runTransaction(async (tx) => {
      const newId = await nextIdInTx(tx, leadYearCounter(), `LD-${new Date().getFullYear()}-`, 5);
      tx.set(db.collection("leads").doc(newId), {
        receivedAt: FieldValue.serverTimestamp(),
        category,
        productId: optStr(b, "productId"),
        name, mobile, email: email ?? null,
        city: optStr(b, "city"),
        source,
        sourceMeta: { formId: null, sourceUrl: null, utm: null },
        amountRequired: optNum(b, "amountRequired"),
        referredById: optStr(b, "referredById"),
        referredByType: b.referredByType === "SUBDSA" || b.referredByType === "CLIENT" ? b.referredByType : null,
        assignedRm, assignedAt: assignedRm ? FieldValue.serverTimestamp() : null,
        status: "NEW",
        priority: ["HOT", "WARM", "COLD"].includes(String(b.priority)) ? b.priority : "WARM",
        nextFollowUpAt: optTs(b, "nextFollowUpAt"), attempts: 0,
        activityLog: [], dropReason: null,
        converted: false, convertedAt: null,
        linkedClientId: null, linkedCaseId: null, linkedSubDsaId: null,
        duplicateOfLeadId: duplicate?.collection === "leads" ? duplicate.id : null,
        dupeKeys,
        ...createAudit(caller.fapl),
      });
      return newId;
    });
    res.json({ ok: true, id, duplicateOf: duplicate });
  }));

  // ─── Internal lead update + activity log ─────────────────────────────────────
  app.patch("/api/crm2/leads/:id", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.leads.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ref = db.collection("leads").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, `${req.params.id} not found`);
    const cur = snap.data()!;

    const fields: Record<string, unknown> = {};
    if (b.status !== undefined) {
      const status = reqEnum(b, "status", LEAD_STATUSES);
      if (status === "CONVERTED") throw new ApiError(400, "CONVERTED is set by the convert endpoint, not directly");
      fields.status = status;
    }
    if (b.priority !== undefined) fields.priority = reqEnum(b, "priority", ["HOT", "WARM", "COLD"] as const);
    if (b.assignedRm !== undefined) {
      fields.assignedRm = optStr(b, "assignedRm");
      if (fields.assignedRm && fields.assignedRm !== cur.assignedRm) fields.assignedAt = FieldValue.serverTimestamp();
    }
    if (b.nextFollowUpAt !== undefined) fields.nextFollowUpAt = optTs(b, "nextFollowUpAt");
    if (b.productId !== undefined) fields.productId = optStr(b, "productId");
    if (b.category !== undefined) fields.category = reqEnum(b, "category", LEAD_CATEGORIES);
    if (b.amountRequired !== undefined) fields.amountRequired = optNum(b, "amountRequired");
    if (b.city !== undefined) fields.city = optStr(b, "city");
    if (b.dropReason !== undefined) {
      fields.dropReason = b.dropReason === null ? null : reqEnum(b, "dropReason", DROP_REASONS);
    }
    if (b.name !== undefined) fields.name = reqStr(b, "name");
    if (b.mobile !== undefined || b.email !== undefined) {
      const mobile = b.mobile !== undefined ? normaliseMobile(String(b.mobile ?? "")) : (cur.mobile as string | null);
      if (b.mobile !== undefined && !mobile) throw new ApiError(400, "mobile must be a valid 10-digit Indian mobile");
      const email = b.email !== undefined ? optStr(b, "email") : (cur.email as string | null);
      if (b.mobile !== undefined) fields.mobile = mobile;
      if (b.email !== undefined) fields.email = email;
      fields.dupeKeys = buildDupeKeys(mobile, email);
    }
    if (b.incrementAttempts === true) fields.attempts = FieldValue.increment(1);

    const activity = (b.activity ?? null) as { note?: unknown; action?: unknown } | null;
    if (activity && isStr(activity.note)) {
      fields.activityLog = FieldValue.arrayUnion({
        at: Timestamp.now(),   // arrayUnion cannot hold serverTimestamp()
        by: caller.fapl,
        note: String(activity.note).slice(0, 2000),
        action: isStr(activity.action) ? String(activity.action).slice(0, 60) : "note",
      });
    }
    if (Object.keys(fields).length === 0) throw new ApiError(400, "No editable fields in payload");
    await ref.update({ ...fields, ...updateAudit(caller.fapl) });
    res.json({ ok: true });
  }));

  // ─── docTracker expansion (idempotent; reused by Phase 3 applicant changes) ──
  // For each ACTIVE documentDef mandatory for the product: ENTITY/PROPERTY → one
  // row; EACH_APPLICANT → one per applicant; GUARANTOR → one per guarantor.
  // Deterministic row ids (docDefId_applicantId) make re-expansion idempotent.
  function expandDocTracker(
    tx: Transaction,
    caseRef: FirebaseFirestore.DocumentReference,
    docDefs: Array<{ id: string; applicableTo: string; requiredByStage: string }>,
    applicants: Array<{ id: string; type: string }>,
    existingRowIds: Set<string>,
    fapl: string,
  ): number {
    let createdRows = 0;
    const mk = (defId: string, applicantId: string | null, stage: string) => {
      const rowId = `${defId}_${applicantId ?? "entity"}`;
      if (existingRowIds.has(rowId)) return;
      tx.set(caseRef.collection("docTracker").doc(rowId), {
        documentDefId: defId, applicantId,
        requiredByStage: stage, status: "PENDING",
        vaultDocId: null, requestedAt: null, receivedAt: null,
        verifiedBy: null, remarks: null,
        ...createAudit(fapl),
      });
      createdRows++;
    };
    for (const def of docDefs) {
      if (def.applicableTo === "EACH_APPLICANT") {
        for (const a of applicants) mk(def.id, a.id, def.requiredByStage);
      } else if (def.applicableTo === "GUARANTOR") {
        for (const a of applicants.filter((x) => x.type === "GUARANTOR")) mk(def.id, a.id, def.requiredByStage);
      } else {
        mk(def.id, null, def.requiredByStage);   // ENTITY / PROPERTY
      }
    }
    return createdRows;
  }

  // ─── Convert — ONE transaction ───────────────────────────────────────────────
  app.post("/api/crm2/leads/:id/convert", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const year = new Date().getFullYear();
    const leadRef = db.collection("leads").doc(req.params.id);

    const result = await db.runTransaction(async (tx) => {
      const leadSnap = await tx.get(leadRef);
      if (!leadSnap.exists) throw new ApiError(404, `${req.params.id} not found`);
      const lead = leadSnap.data()!;
      if (lead.converted === true) throw new ApiError(409, "Lead is already converted");
      if (lead.status !== "QUALIFIED") {
        throw new ApiError(400, `Only QUALIFIED leads can be converted (current status: ${lead.status ?? "—"})`);
      }
      const convertActivity = (note: string) => FieldValue.arrayUnion({
        at: Timestamp.now(), by: caller.fapl, note, action: "convert",
      });

      // PARTNER_DSA leads become sub-DSAs, not client+case.
      if (lead.category === "PARTNER_DSA") {
        const subDsaId = await nextIdInTx(tx, "subDsas", "SDSA-", 3);
        tx.set(db.collection("subDsas").doc(subDsaId), {
          name: lead.name, type: "INDIVIDUAL",
          sourceLeadId: leadRef.id,
          mobile: lead.mobile ?? "", email: lead.email ?? null,
          city: lead.city ?? "", state: "",
          panEnc: null, panLast4: null, gstin: null, payoutBank: null,
          payoutSlabs: [],
          relationshipOwner: optStr(b, "relationshipOwner") ?? lead.assignedRm ?? caller.fapl,
          onboardingDate: FieldValue.serverTimestamp(),
          status: "ACTIVE",
          ...createAudit(caller.fapl),
        });
        tx.update(leadRef, {
          converted: true, convertedAt: FieldValue.serverTimestamp(),
          status: "CONVERTED", linkedSubDsaId: subDsaId,
          activityLog: convertActivity(`Converted to sub-DSA ${subDsaId}`),
          ...updateAudit(caller.fapl),
        });
        return { subDsaId };
      }

      // Standard conversion: client + case + PRIMARY applicant + docTracker.
      const productId = optStr(b, "productId") ?? (lead.productId as string | null);
      if (!productId) throw new ApiError(400, "productId is required (set it on the lead or pass it in the payload)");
      const productSnap = await tx.get(db.collection("products").doc(productId));
      if (!productSnap.exists) throw new ApiError(400, `Product ${productId} not found`);

      const handlingRm = optStr(b, "handlingRm") ?? (lead.assignedRm as string | null) ?? caller.fapl;

      // Doc defs mandatory for this product (read inside the tx — before writes).
      const defsSnap = await tx.get(
        db.collection("documentMaster")
          .where("mandatoryForProducts", "array-contains", productId)
          .where("status", "==", "ACTIVE"),
      );
      const docDefs = defsSnap.docs.map((d) => ({
        id: d.id,
        applicableTo: d.data().applicableTo as string,
        requiredByStage: d.data().requiredByStage as string,
      }));

      // Client: explicit id → validate; else dedupe-match against clients; else create.
      // NOTE: Firestore transactions require ALL reads before ANY write, so the
      // counter documents are READ here and INCREMENTED below with the other writes
      // (nextIdInTx would interleave a counter write before the cases-counter read).
      let clientId = optStr(b, "clientId");
      if (clientId) {
        const c = await tx.get(db.collection("clients").doc(clientId));
        if (!c.exists) throw new ApiError(400, `Client ${clientId} not found`);
      } else {
        const dupeKeys: string[] = (lead.dupeKeys as string[] | undefined) ?? buildDupeKeys(lead.mobile, lead.email);
        for (const key of dupeKeys) {
          const hit = await tx.get(db.collection("clients").where("dupeKeys", "array-contains", key).limit(1));
          if (!hit.empty) { clientId = hit.docs[0].id; break; }
        }
      }
      let createdClient = false;
      let clientCounterRef: FirebaseFirestore.DocumentReference | null = null;
      let clientSeq = 0;
      if (!clientId) {
        clientCounterRef = db.collection("counters").doc(`clients-${year}`);
        clientSeq = (((await tx.get(clientCounterRef)).data()?.seq as number | undefined) ?? 0) + 1;
        clientId = `CL-${year}-${String(clientSeq).padStart(5, "0")}`;
        createdClient = true;
      }
      const casesCounterRef = db.collection("counters").doc(`cases-${year}`);
      const caseSeq = (((await tx.get(casesCounterRef)).data()?.seq as number | undefined) ?? 0) + 1;
      const caseId = `FIN-CASE-${year}-${String(caseSeq).padStart(4, "0")}`;
      const caseRef = db.collection("cases").doc(caseId);

      // ── All reads complete — writes begin here ──
      if (clientCounterRef) {
        tx.set(clientCounterRef, { seq: clientSeq, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      tx.set(casesCounterRef, { seq: caseSeq, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      const subDsaId = lead.referredByType === "SUBDSA" ? (lead.referredById as string | null) : null;
      const emptyAddress = { line: "", city: lead.city ?? "", state: "", pincode: "" };

      if (createdClient) {
        tx.set(db.collection("clients").doc(clientId), {
          constitution: ["INDIVIDUAL", "PROPRIETORSHIP", "PARTNERSHIP", "LLP", "PVT_LTD", "HUF"].includes(String(b.constitution))
            ? b.constitution : "INDIVIDUAL",
          name: lead.name, industry: optStr(b, "industry"),
          panEnc: null, panLast4: null,
          gstin: null, udyam: null, cin: null, incorporationDate: null,
          regAddress: emptyAddress, commAddress: emptyAddress,
          primaryContact: { name: lead.name, mobile: lead.mobile ?? "", email: lead.email ?? null },
          latestCibil: null, existingRelationships: [],
          sourceLeadId: leadRef.id, sourcedById: subDsaId,
          ownerRm: handlingRm, kycStatus: "PENDING", status: "ACTIVE",
          dupeKeys: (lead.dupeKeys as string[] | undefined) ?? buildDupeKeys(lead.mobile, lead.email),
          ...createAudit(caller.fapl),
        });
      }

      tx.set(caseRef, {
        clientId, leadId: leadRef.id, productId,
        handlingRm, subDsaId,
        lenderId: null, connectorId: null,
        mappingId: null, slabId: null, dsaCode: null,
        connectorCaseRef: null, bankApplicationNo: null, loanAccountNo: null,
        amountRequested: (lead.amountRequired as number | null) ?? 0,
        amountSanctioned: null, amountDisbursed: null,
        roiPct: null, tenureMonths: null, processingFee: null,
        disbursalCity: null, disbursalState: null,
        stage: "OPENED", outcome: null, rejectionReason: null,
        keyDates: { opened: FieldValue.serverTimestamp(), docsComplete: null, login: null,
                    sanction: null, disbursement: null, pddCleared: null, otcCleared: null, closed: null },
        bankContact: null,
        pddStatus: "NA", otcStatus: "NA", pddPendingList: [], queryLog: [],
        payoutStatus: "NOT_DUE", payoutCycleId: null,
        wealth: null, insurance: null,
        docsCompletePct: 0, nextAction: null, remarks: null,
        ...createAudit(caller.fapl),
      });

      // PRIMARY applicant from the lead contact.
      const applicantRef = caseRef.collection("applicants").doc();
      tx.set(applicantRef, {
        type: "PRIMARY", relationshipToPrimary: "SELF",
        name: lead.name,
        panEnc: null, panLast4: null, aadhaarLast4: null,
        dob: null, mobile: lead.mobile ?? "", email: lead.email ?? null,
        address: null, occupation: null, incomeMonthly: null, cibil: null,
        ...createAudit(caller.fapl),
      });

      const rowCount = expandDocTracker(
        tx, caseRef, docDefs,
        [{ id: applicantRef.id, type: "PRIMARY" }],
        new Set(), caller.fapl,
      );

      tx.set(caseRef.collection("stageHistory").doc(), {
        from: null, to: "OPENED", at: FieldValue.serverTimestamp(), by: caller.fapl, note: `Converted from lead ${leadRef.id}`,
      });

      tx.update(leadRef, {
        converted: true, convertedAt: FieldValue.serverTimestamp(),
        status: "CONVERTED", linkedClientId: clientId, linkedCaseId: caseId,
        activityLog: convertActivity(`Converted → ${clientId} / ${caseId}`),
        ...updateAudit(caller.fapl),
      });

      return { clientId, caseId, createdClient, docTrackerRows: rowCount };
    });

    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: "crm2_convert_lead",
      targetPath: `/leads/${req.params.id}`, after: result, at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, ...result });
  }));

  // ─── Permission editor backend — set a user's perms map + resync claims ──────
  // Admin-only (matches the existing Permission Manager guard model).
  app.post("/api/crm2/perms/:uid", route(async (req, res) => {
    const decoded = await decodeToken(req);
    if (!decoded) { res.status(401).json({ error: "Unauthorized" }); return; }
    const callerSnap = await db.collection("users").doc(decoded.uid).get();
    if (decoded.role !== "admin" && callerSnap.data()?.role !== "admin") {
      res.status(403).json({ error: "Admin only" }); return;
    }
    const fapl = await resolveFapl(decoded.uid);

    const raw = (req.body?.perms ?? {}) as Record<string, unknown>;
    const VALID_KEYS = [
      "crm.leads.read", "crm.leads.write", "crm.cases.read", "crm.cases.write",
      "crm.masters.write", "payout.read", "payout.write", "payout.amounts.read",
      "mis.read", "recon.read",
    ];
    const perms: Record<string, boolean> = {};
    for (const k of VALID_KEYS) if (raw[k] === true) perms[k] = true;

    const userRef = db.collection("users").doc(req.params.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) throw new ApiError(404, "User not found");
    const p = userSnap.data()!;

    await userRef.update({ perms, updatedAt: FieldValue.serverTimestamp() });
    await admin.auth().setCustomUserClaims(req.params.uid, {
      role: p.role ?? "employee", hrmsAccess: p.hrmsAccess ?? true,
      crmAccess: p.crmAccess ?? false, crmRole: p.crmRole ?? null,
      isHrmsManager: p.isHrmsManager ?? false, misAccess: p.misAccess ?? null,
      perms,
    });
    // Force the target's open sessions to refresh their token (see AuthContext).
    await userRef.update({ claimsRefreshedAt: FieldValue.serverTimestamp() });

    await db.collection("audit_logs").add({
      actor: decoded.uid, actorFapl: fapl, action: "crm2_set_perms",
      targetPath: `/users/${req.params.uid}`, after: { perms }, at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, perms });
  }));

  // ═══ Phase 3 — Cases: CRUD, stage machine, applicants, docTracker, vault ══════

  const CASE_EDITABLE_FIELDS = new Set([
    "handlingRm", "subDsaId", "lenderId", "connectorId",
    "amountRequested", "amountSanctioned", "roiPct", "tenureMonths", "processingFee",
    "bankApplicationNo", "loanAccountNo", "connectorCaseRef",
    "bankContact", "nextAction", "remarks", "rejectionReason",
    "pddStatus", "otcStatus", "pddPendingList",
  ]);
  // Server-calculated / frozen / payout-mirror fields — REJECTED on client input.
  const CASE_PROTECTED_FIELDS = new Set([
    "stage", "outcome", "keyDates", "payoutStatus", "payoutCycleId",
    "docsCompletePct", "mappingId", "slabId", "dsaCode",
    "amountDisbursed", "disbursalCity", "disbursalState",
    "clientId", "leadId", "productId",
    "finvastraPayoutPct", "finvastraPayoutExpected", "subDsaPayoutPct",
    "subDsaPayoutExpected", "netMarginExpected",
    "createdAt", "createdBy", "updatedAt", "updatedBy",
  ]);

  async function readTrackerRows(
    tx: Transaction, caseRef: FirebaseFirestore.DocumentReference,
  ): Promise<Array<StageTrackerRow>> {
    const snap = await tx.get(caseRef.collection("docTracker"));
    return snap.docs.map((d) => ({
      rowId: d.id,
      documentDefId: d.data().documentDefId as string,
      applicantId: (d.data().applicantId as string | null) ?? null,
      requiredByStage: d.data().requiredByStage as StageTrackerRow["requiredByStage"],
      status: d.data().status as StageTrackerRow["status"],
      vaultDocId: (d.data().vaultDocId as string | null) ?? null,
    }));
  }

  // ─── Manual case open (walk-ins) ─────────────────────────────────────────────
  app.post("/api/crm2/cases", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const clientId = reqStr(b, "clientId");
    const productId = reqStr(b, "productId");
    const year = new Date().getFullYear();

    const result = await db.runTransaction(async (tx) => {
      // ALL READS FIRST (Firestore tx requirement)
      const [clientSnap, productSnap] = await Promise.all([
        tx.get(db.collection("clients").doc(clientId)),
        tx.get(db.collection("products").doc(productId)),
      ]);
      if (!clientSnap.exists) throw new ApiError(400, `Client ${clientId} not found`);
      if (!productSnap.exists) throw new ApiError(400, `Product ${productId} not found`);
      const client = clientSnap.data()!;

      const defsSnap = await tx.get(
        db.collection("documentMaster")
          .where("mandatoryForProducts", "array-contains", productId)
          .where("status", "==", "ACTIVE"),
      );
      const docDefs = defsSnap.docs.map((d) => ({
        id: d.id, applicableTo: d.data().applicableTo as string,
        requiredByStage: d.data().requiredByStage as string,
      }));

      const counterRef = db.collection("counters").doc(`cases-${year}`);
      const seq = (((await tx.get(counterRef)).data()?.seq as number | undefined) ?? 0) + 1;
      const caseId = `FIN-CASE-${year}-${String(seq).padStart(4, "0")}`;
      const caseRef = db.collection("cases").doc(caseId);

      // ── Writes ──
      tx.set(counterRef, { seq, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(caseRef, {
        clientId, leadId: optStr(b, "leadId"),
        productId,
        handlingRm: optStr(b, "handlingRm") ?? (client.ownerRm as string | undefined) ?? caller.fapl,
        subDsaId: optStr(b, "subDsaId") ?? (client.sourcedById as string | null) ?? null,
        lenderId: optStr(b, "lenderId"), connectorId: optStr(b, "connectorId"),
        mappingId: null, slabId: null, dsaCode: null,
        connectorCaseRef: null, bankApplicationNo: null, loanAccountNo: null,
        amountRequested: optNum(b, "amountRequested") ?? 0,
        amountSanctioned: null, amountDisbursed: null,
        roiPct: null, tenureMonths: null, processingFee: null,
        disbursalCity: null, disbursalState: null,
        stage: "OPENED", outcome: null, rejectionReason: null,
        keyDates: { opened: FieldValue.serverTimestamp(), docsComplete: null, login: null,
                    sanction: null, disbursement: null, pddCleared: null, otcCleared: null, closed: null },
        bankContact: null,
        pddStatus: "NA", otcStatus: "NA", pddPendingList: [], queryLog: [],
        payoutStatus: "NOT_DUE", payoutCycleId: null,
        wealth: null, insurance: null,
        docsCompletePct: 0, nextAction: null, remarks: null,
        ...createAudit(caller.fapl),
      });

      // Optional PRIMARY applicant straight from the open dialog.
      const pa = (b.primaryApplicant ?? null) as Record<string, unknown> | null;
      let applicants: Array<{ id: string; type: string }> = [];
      if (pa && isStr(pa.name)) {
        const applicantRef = caseRef.collection("applicants").doc();
        tx.set(applicantRef, {
          type: "PRIMARY", relationshipToPrimary: "SELF",
          name: String(pa.name).trim(),
          panEnc: null, panLast4: null, aadhaarLast4: null,
          dob: null, mobile: String(pa.mobile ?? "").trim(), email: isStr(pa.email) ? String(pa.email).trim() : null,
          address: null, occupation: null, incomeMonthly: null, cibil: null,
          ...createAudit(caller.fapl),
        });
        applicants = [{ id: applicantRef.id, type: "PRIMARY" }];
      }

      expandDocTracker(tx, caseRef, docDefs, applicants, new Set(), caller.fapl);
      tx.set(caseRef.collection("stageHistory").doc(), {
        from: null, to: "OPENED", at: FieldValue.serverTimestamp(), by: caller.fapl,
        note: optStr(b, "note") ?? "Case opened manually",
      });
      return { caseId };
    });
    res.json({ ok: true, ...result });
  }));

  // ─── Case PATCH — non-derived fields ONLY ────────────────────────────────────
  app.patch("/api/crm2/cases/:id", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;

    // HARD reject any protected/derived field by name — not silently dropped.
    const offending = Object.keys(b).filter((k) => CASE_PROTECTED_FIELDS.has(k));
    if (offending.length > 0) {
      throw new ApiError(400, `Server-calculated/frozen fields cannot be set by clients: ${offending.join(", ")}`);
    }
    const unknown = Object.keys(b).filter((k) => !CASE_EDITABLE_FIELDS.has(k) && k !== "query" && k !== "resolveQueryIndex");
    if (unknown.length > 0) throw new ApiError(400, `Unknown fields: ${unknown.join(", ")}`);

    const caseRef = db.collection("cases").doc(req.params.id);

    await db.runTransaction(async (tx) => {
      const caseSnap = await tx.get(caseRef);
      if (!caseSnap.exists) throw new ApiError(404, `${req.params.id} not found`);
      const cur = caseSnap.data()!;

      const fields: Record<string, unknown> = {};
      for (const k of Object.keys(b)) {
        if (!CASE_EDITABLE_FIELDS.has(k)) continue;
        if (["amountRequested", "amountSanctioned", "roiPct", "tenureMonths", "processingFee"].includes(k)) {
          fields[k] = optNum(b, k);
        } else if (k === "bankContact") {
          const c = b.bankContact as Record<string, unknown> | null;
          fields.bankContact = c && isStr(c.name)
            ? { name: String(c.name).trim(), email: String(c.email ?? "").trim(), mobile: String(c.mobile ?? "").trim() }
            : null;
        } else if (k === "pddPendingList") {
          fields.pddPendingList = strArr(b, "pddPendingList");
        } else if (k === "pddStatus") {
          const v = reqEnum(b, "pddStatus", ["NA", "PENDING", "PARTIAL", "CLEARED"] as const);
          if (v === "CLEARED" && cur.pddStatus !== "CLEARED") {
            const rows = await tx.get(caseRef.collection("docTracker"));
            const pending = rows.docs
              .map((d) => ({
                rowId: d.id,
                documentDefId: d.data().documentDefId as string,
                requiredByStage: d.data().requiredByStage as string,
                status: d.data().status as string,
              }))
              .filter((r) => r.requiredByStage === "PDD" && r.status !== "VERIFIED");
            if (pending.length > 0) {
              throw new ApiError(422, `${pending.length} PDD document(s) still pending — cannot mark CLEARED`,
                pending.map((p) => ({ rowId: p.rowId, documentDefId: p.documentDefId, status: p.status })));
            }
            fields["keyDates.pddCleared"] = FieldValue.serverTimestamp();
          }
          fields.pddStatus = v;
        } else if (k === "otcStatus") {
          const v = reqEnum(b, "otcStatus", ["NA", "PENDING", "CLEARED"] as const);
          if (v === "CLEARED" && cur.otcStatus !== "CLEARED") fields["keyDates.otcCleared"] = FieldValue.serverTimestamp();
          fields.otcStatus = v;
        } else {
          fields[k] = optStr(b, k);
        }
      }
      // Query log: append or resolve
      const q = (b.query ?? null) as { detail?: unknown } | null;
      if (q && isStr(q.detail)) {
        fields.queryLog = FieldValue.arrayUnion({ raisedAt: Timestamp.now(), detail: String(q.detail).slice(0, 2000), resolvedAt: null });
      }
      if (typeof b.resolveQueryIndex === "number") {
        const log = [...((cur.queryLog as Array<Record<string, unknown>>) ?? [])];
        const idx = b.resolveQueryIndex as number;
        if (log[idx] && !log[idx].resolvedAt) { log[idx] = { ...log[idx], resolvedAt: Timestamp.now() }; fields.queryLog = log; }
      }
      if (Object.keys(fields).length === 0) throw new ApiError(400, "No editable fields in payload");
      tx.update(caseRef, { ...fields, ...updateAudit(caller.fapl) });
    });
    res.json({ ok: true });
  }));

  // ─── Stage transition — order validation + doc gating + keyDates + history ──
  app.post("/api/crm2/cases/:id/stage", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const to = reqStr(b, "to") as CaseStageT;
    const outcome = optStr(b, "outcome");
    const caseRef = db.collection("cases").doc(req.params.id);

    const result = await db.runTransaction(async (tx) => {
      const caseSnap = await tx.get(caseRef);
      if (!caseSnap.exists) throw new ApiError(404, `${req.params.id} not found`);
      const cur = caseSnap.data()!;
      const from = cur.stage as CaseStageT;

      const order = validateTransition(from, to, outcome);
      if (!order.ok) throw new ApiError(400, order.reason!);

      // Doc gating (reads happen before writes)
      const rows = await readTrackerRows(tx, caseRef);
      const gate = gateForStage(to, rows);
      if (!gate.ok) {
        throw new ApiError(422, gate.reason!,
          gate.pendingDocs!.map((p) => ({ rowId: p.rowId, documentDefId: p.documentDefId, applicantId: p.applicantId, status: p.status })));
      }

      const fields: Record<string, unknown> = { stage: to };
      const kd = keyDateForStage(to);
      if (kd) fields[`keyDates.${kd}`] = FieldValue.serverTimestamp();
      if (to === "CLOSED") {
        fields.outcome = outcome ?? (from === "PDD_OTC" ? "COMPLETED" : null);
        if (outcome === "REJECTED") fields.rejectionReason = optStr(b, "rejectionReason");
      }
      tx.update(caseRef, { ...fields, ...updateAudit(caller.fapl) });
      tx.set(caseRef.collection("stageHistory").doc(), {
        from, to, at: FieldValue.serverTimestamp(), by: caller.fapl, note: optStr(b, "note"),
      });
      return { from, to };
    });
    res.json({ ok: true, ...result });
  }));

  // ─── Applicants CRUD (re-expands docTracker idempotently) ───────────────────
  function sanitizeApplicant(b: Record<string, unknown>, isCreate: boolean): Record<string, unknown> {
    rejectFullAadhaar(b);
    const out: Record<string, unknown> = {};
    if (isCreate || b.type !== undefined) out.type = reqEnum(b, "type", ["PRIMARY", "CO_APPLICANT", "GUARANTOR"] as const);
    if (isCreate || b.relationshipToPrimary !== undefined) {
      out.relationshipToPrimary = reqEnum({ relationshipToPrimary: b.relationshipToPrimary ?? "OTHER" },
        "relationshipToPrimary", ["SELF", "SPOUSE", "FATHER", "MOTHER", "PARTNER", "DIRECTOR", "OTHER"] as const);
    }
    if (isCreate || b.name !== undefined) out.name = reqStr(b, "name");
    if (b.pan !== undefined) {
      const pan = String(b.pan ?? "").trim().toUpperCase();
      if (pan) {
        if (!PAN_RE.test(pan)) throw new ApiError(400, "pan format invalid (expected ABCDE1234F)");
        out.panEnc = encryptField(pan); out.panLast4 = pan.slice(-4);
      }
    } else if (isCreate) { out.panEnc = null; out.panLast4 = null; }
    if (b.aadhaarLast4 !== undefined) {
      const a = String(b.aadhaarLast4 ?? "").trim();
      if (a && !/^\d{4}$/.test(a)) {
        throw new ApiError(400, "aadhaarLast4 must be EXACTLY the last 4 digits — full Aadhaar numbers are never stored");
      }
      out.aadhaarLast4 = a || null;
    } else if (isCreate) { out.aadhaarLast4 = null; }
    if (isCreate || b.dob !== undefined) out.dob = optTs(b, "dob");
    if (isCreate || b.mobile !== undefined) out.mobile = optStr(b, "mobile") ?? "";
    if (isCreate || b.email !== undefined) out.email = optStr(b, "email");
    if (isCreate || b.occupation !== undefined) out.occupation = optStr(b, "occupation");
    if (isCreate || b.incomeMonthly !== undefined) out.incomeMonthly = optNum(b, "incomeMonthly");
    return out;
  }

  app.post("/api/crm2/cases/:id/applicants", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const fields = sanitizeApplicant((req.body ?? {}) as Record<string, unknown>, true);
    const caseRef = db.collection("cases").doc(req.params.id);

    const result = await db.runTransaction(async (tx) => {
      const caseSnap = await tx.get(caseRef);
      if (!caseSnap.exists) throw new ApiError(404, `${req.params.id} not found`);
      const productId = caseSnap.data()!.productId as string;

      const [defsSnap, applicantsSnap, rowsSnap] = await Promise.all([
        tx.get(db.collection("documentMaster")
          .where("mandatoryForProducts", "array-contains", productId)
          .where("status", "==", "ACTIVE")),
        tx.get(caseRef.collection("applicants")),
        tx.get(caseRef.collection("docTracker")),
      ]);

      const applicantRef = caseRef.collection("applicants").doc();
      tx.set(applicantRef, { ...fields, address: null, cibil: null, ...createAudit(caller.fapl) });

      // Idempotent re-expansion: existing row ids are preserved; only new
      // (docDefId × applicant) combinations are created.
      const docDefs = defsSnap.docs.map((d) => ({
        id: d.id, applicableTo: d.data().applicableTo as string, requiredByStage: d.data().requiredByStage as string,
      }));
      const allApplicants = [
        ...applicantsSnap.docs.map((d) => ({ id: d.id, type: d.data().type as string })),
        { id: applicantRef.id, type: fields.type as string },
      ];
      const created = expandDocTracker(
        tx, caseRef, docDefs, allApplicants,
        new Set(rowsSnap.docs.map((d) => d.id)), caller.fapl,
      );
      return { applicantId: applicantRef.id, newTrackerRows: created };
    });
    res.json({ ok: true, ...result });
  }));

  app.patch("/api/crm2/cases/:id/applicants/:aid", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const fields = sanitizeApplicant((req.body ?? {}) as Record<string, unknown>, false);
    if (Object.keys(fields).length === 0) throw new ApiError(400, "No editable fields in payload");
    const ref = db.collection("cases").doc(req.params.id).collection("applicants").doc(req.params.aid);
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, "Applicant not found");
    await ref.update({ ...fields, ...updateAudit(caller.fapl) });
    res.json({ ok: true });
  }));

  app.delete("/api/crm2/cases/:id/applicants/:aid", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const caseRef = db.collection("cases").doc(req.params.id);

    const result = await db.runTransaction(async (tx) => {
      const aRef = caseRef.collection("applicants").doc(req.params.aid);
      const [aSnap, rowsSnap] = await Promise.all([tx.get(aRef), tx.get(caseRef.collection("docTracker"))]);
      if (!aSnap.exists) throw new ApiError(404, "Applicant not found");

      tx.delete(aRef);
      // Remove the applicant's tracker rows — but NEVER delete a row that has a file.
      let removed = 0, kept = 0;
      const remaining: Array<{ status: string }> = [];
      for (const d of rowsSnap.docs) {
        if (d.data().applicantId === req.params.aid) {
          if (d.data().vaultDocId) { kept++; remaining.push({ status: d.data().status as string }); continue; }
          tx.delete(d.ref); removed++;
        } else {
          remaining.push({ status: d.data().status as string });
        }
      }
      const pct = remaining.length === 0 ? 100
        : Math.round((remaining.filter((r) => r.status === "VERIFIED").length / remaining.length) * 100);
      tx.update(caseRef, { docsCompletePct: pct, ...updateAudit(caller.fapl) });
      return { removedRows: removed, keptRowsWithFiles: kept };
    });
    res.json({ ok: true, ...result });
  }));

  // ─── DocTracker row update → recompute docsCompletePct ───────────────────────
  app.patch("/api/crm2/cases/:id/doc-tracker/:rowId", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const caseRef = db.collection("cases").doc(req.params.id);
    const rowRef = caseRef.collection("docTracker").doc(req.params.rowId);

    await db.runTransaction(async (tx) => {
      // ALL READS FIRST
      const [caseSnap, rowSnap, rowsSnap] = await Promise.all([
        tx.get(caseRef), tx.get(rowRef), tx.get(caseRef.collection("docTracker")),
      ]);
      if (!caseSnap.exists) throw new ApiError(404, `${req.params.id} not found`);
      if (!rowSnap.exists) throw new ApiError(404, "Tracker row not found");
      const cur = caseSnap.data()!;

      const fields: Record<string, unknown> = {};
      let newStatus = rowSnap.data()!.status as string;
      if (b.status !== undefined) {
        newStatus = reqEnum(b, "status", ["PENDING", "REQUESTED", "RECEIVED", "VERIFIED", "REJECTED_REUPLOAD", "EXPIRED"] as const);
        fields.status = newStatus;
        if (newStatus === "REQUESTED") fields.requestedAt = FieldValue.serverTimestamp();
        if (newStatus === "RECEIVED") fields.receivedAt = FieldValue.serverTimestamp();
        fields.verifiedBy = newStatus === "VERIFIED" ? caller.fapl : null;
      }
      if (b.vaultDocId !== undefined) {
        const vid = optStr(b, "vaultDocId");
        if (vid) {
          // The vault doc must exist under the case's client (reference, never copy).
          const v = await tx.get(db.collection("clients").doc(cur.clientId as string).collection("vaultDocs").doc(vid));
          if (!v.exists) throw new ApiError(400, `Vault doc ${vid} not found under client ${cur.clientId}`);
        }
        fields.vaultDocId = vid;
      }
      if (b.remarks !== undefined) fields.remarks = optStr(b, "remarks");
      if (Object.keys(fields).length === 0) throw new ApiError(400, "No editable fields in payload");

      // Recompute completeness over the post-update row set.
      const rows = rowsSnap.docs.map((d) => ({
        rowId: d.id,
        requiredByStage: d.data().requiredByStage as string,
        status: d.id === req.params.rowId ? newStatus : (d.data().status as string),
      }));
      const pct = rows.length === 0 ? 100
        : Math.round((rows.filter((r) => r.status === "VERIFIED").length / rows.length) * 100);
      const loginRows = rows.filter((r) => r.requiredByStage === "LOGIN");
      const loginAllVerified = loginRows.length > 0 && loginRows.every((r) => r.status === "VERIFIED");

      const caseFields: Record<string, unknown> = { docsCompletePct: pct, ...updateAudit(caller.fapl) };
      const kd = cur.keyDates as Record<string, unknown> | undefined;
      if (loginAllVerified && !kd?.docsComplete) {
        caseFields["keyDates.docsComplete"] = FieldValue.serverTimestamp();   // first time only
      }
      tx.update(rowRef, { ...fields, ...updateAudit(caller.fapl) });
      tx.update(caseRef, caseFields);
    });
    res.json({ ok: true });
  }));

  // ─── Client vault upload — upload once, reference everywhere ─────────────────
  const VAULT_BUCKET = "gen-lang-client-0643641184.firebasestorage.app";

  app.post("/api/crm2/clients/:id/vault", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const documentDefId = reqStr(b, "documentDefId");
    const fileName = reqStr(b, "fileName").replace(/[^\w.\- ]/g, "_").slice(0, 120);
    const applicantId = optStr(b, "applicantId");
    const contentBase64 = reqStr(b, "contentBase64");
    const contentType = optStr(b, "contentType") ?? "application/octet-stream";

    const buf = Buffer.from(contentBase64, "base64");
    if (buf.length === 0) throw new ApiError(400, "Empty file");
    if (buf.length > 10 * 1024 * 1024) throw new ApiError(400, "File exceeds 10 MB");

    const clientRef = db.collection("clients").doc(req.params.id);
    const [clientSnap, defSnap] = await Promise.all([
      clientRef.get(), db.collection("documentMaster").doc(documentDefId).get(),
    ]);
    if (!clientSnap.exists) throw new ApiError(404, `Client ${req.params.id} not found`);
    if (!defSnap.exists) throw new ApiError(400, `Document type ${documentDefId} not found`);
    const validityDays = (defSnap.data()!.validityDays as number | null) ?? null;

    const vaultRef = clientRef.collection("vaultDocs").doc();
    const storagePath = `clients/${req.params.id}/vault/${vaultRef.id}`;

    // Upload to Storage with a permanent token URL (same pattern as HR letters).
    const dlToken = crypto.randomUUID();
    await (await import("firebase-admin/storage")).getStorage().bucket(VAULT_BUCKET).file(storagePath).save(buf, {
      contentType,
      metadata: { metadata: { firebaseStorageDownloadTokens: dlToken } },
    });
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${VAULT_BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=${dlToken}`;

    // Vault doc + REPLACED chain in one batch (the prior VALID doc for the same
    // def + applicant becomes REPLACED, pointing at its successor).
    const batch = db.batch();
    const priorSnap = await clientRef.collection("vaultDocs")
      .where("documentDefId", "==", documentDefId)
      .where("status", "==", "VALID").get();
    for (const d of priorSnap.docs) {
      if (((d.data().applicantId as string | null) ?? null) === (applicantId ?? null)) {
        batch.update(d.ref, { status: "REPLACED", replacedByVaultDocId: vaultRef.id, ...updateAudit(caller.fapl) });
      }
    }
    batch.set(vaultRef, {
      documentDefId, applicantId: applicantId ?? null,
      fileName, storagePath, downloadUrl,
      uploadedAt: FieldValue.serverTimestamp(),
      validUntil: validityDays ? Timestamp.fromDate(new Date(Date.now() + validityDays * 86400000)) : null,
      status: "VALID", replacedByVaultDocId: null,
      ...createAudit(caller.fapl),
    });
    await batch.commit();
    res.json({ ok: true, vaultDocId: vaultRef.id, storagePath, downloadUrl });
  }));
}
