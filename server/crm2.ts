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
import { findSlabOverlaps, resolveSlab, computeExpectedAmounts, SlabResolutionError, type SlabForResolution } from "../src/lib/crm2/slab.js";
import { resolveChannelPartnerRule, computeChannelPartnerPayout, sanitizeChannelPartnerRule } from "../src/lib/crm2/channelPartnerPayout.js";
import { computePartnerScore, computeOnboardingProgress, sanitizePartnerRubric, computePracticalAssessment, DEFAULT_PARTNER_RUBRIC, type PartnerRubric } from "../src/lib/crm2/partnerScoring.js";
import { buildDupeKeys, normaliseMobile } from "../src/lib/crm2/dedupe.js";
import { extractClientIp } from "../src/lib/crm2/http.js";
import { verifyMetaSignature, extractLeadgenEvents, mapMetaFields, type MetaLeadgenEvent } from "../src/lib/crm2/meta.js";
import { extractWhatsAppMessages, extractWhatsAppStatuses, type WhatsAppInbound } from "../src/lib/crm2/whatsapp.js";
import { evaluateSla, slaConfigFromDoc, toMs, type SlaConfig } from "../src/lib/crm2/sla.js";
import { DEFAULT_BUSINESS_HOURS, elapsedWorkingMs, type BusinessHoursConfig } from "../src/lib/crm2/businessHours.js";
import { queueConfigFromDoc, eligibleQueues, leadEligibleForSkills, queueForLead, isQueueableLead, type QueueDef } from "../src/lib/crm2/queue.js";
import { validateTransition, gateForStage, keyDateForStage } from "../src/lib/crm2/stages.js";
import { validateLoginTransition, keyDateForLoginStage, validateCaseLevelTransition, type LoginLite } from "../src/lib/crm2/logins.js";
import { deriveCycleStatus, computeAgeing, computeBankerMismatch, computePctVariance, computeAmountVariance, computeNetMarginRealised, canClose, validateMilestoneOrder, MILESTONE_STEPS, type MilestoneStep } from "../src/lib/crm2/payout.js";
import { matchDumpRow, computeSnapshot, type DumpRow, type MisLite, type CycleLite } from "../src/lib/crm2/recon.js";
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
  /** Verifies a Cloud Scheduler OIDC token (from server.ts). Used by the
   *  daily reminder + vault-expiry job endpoints. */
  verifyScheduler: (req: express.Request) => Promise<boolean>;
  /** Sends a branded HTML email (server.ts wraps buildBrandEmail + sendGmailMessage).
   *  Used by job endpoints that escalate to managers/telecallers. Fire-and-forget. */
  sendBrandedEmail: (to: string, subject: string, body: {
    title: string; intro: string; rows: Array<{ label: string; value: string }>;
    note?: string; ctaLabel?: string; ctaLink?: string;
  }) => Promise<void>;
}

/** Typed 4xx error — handlers throw it; the wrapper maps it to a JSON response. */
class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const MOBILE_RE = /^[6-9]\d{9}$/;

export function registerCrm2Routes(app: express.Express, { db, admin, verifyScheduler, sendBrandedEmail }: Deps): void {
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
    if (!Number.isFinite(n)) throw new ApiError(400, `${field} must be a finite number`);
    return n;
  }
  /** Client-supplied money AMOUNT: finite and never negative (reject, don't clamp). */
  function optMoney(body: Record<string, unknown>, field: string): number | null {
    const n = optNum(body, field);
    if (n != null && n < 0) throw new ApiError(400, `${field} must not be negative`);
    return n;
  }
  /** Client-supplied PERCENTAGE: finite and within 0–100 (reject, don't clamp). */
  function optPct(body: Record<string, unknown>, field: string): number | null {
    const n = optNum(body, field);
    if (n != null && (n < 0 || n > 100)) throw new ApiError(400, `${field} must be between 0 and 100`);
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
    if (isCreate || b.category !== undefined) {
      const c = optStr(b, "category");
      out.category = c && ["LOAN", "WEALTH", "INSURANCE", "CIBIL_CHECK", "PARTNER_DSA", "GENERAL"].includes(c) ? c : null;
    }
    if (isCreate || b.subProducts !== undefined) out.subProducts = strArr(b, "subProducts");
    if (isCreate || b.defaultDocChecklist !== undefined) out.defaultDocChecklist = strArr(b, "defaultDocChecklist");
    if (isCreate || b.defaultRoiRange !== undefined) out.defaultRoiRange = optStr(b, "defaultRoiRange");
    if (isCreate || b.status !== undefined) out.status = reqEnum({ status: b.status ?? "ACTIVE" }, "status", ["ACTIVE", "INACTIVE"] as const);
    return out;
  };

  // Sub-product master — just a name, mapped to a product (SubProduct → Product → Lender).
  const sanitizeSubProduct: Sanitizer = (b, isCreate) => {
    const out: Record<string, unknown> = {};
    if (isCreate || b.name !== undefined) out.name = reqStr(b, "name");
    if (isCreate || b.productId !== undefined) out.productId = reqStr(b, "productId");
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
    if (isCreate || b.contacts !== undefined) {
      const arr = Array.isArray(b.contacts) ? b.contacts : [];
      out.contacts = arr.slice(0, 50).map((c: Record<string, unknown>) => ({
        name: String(c?.name ?? "").trim(), dept: String(c?.dept ?? "").trim(), mobile: String(c?.mobile ?? "").trim(),
      })).filter((c) => c.name || c.mobile);
    }
    if (isCreate || b.emails !== undefined) {
      const arr = Array.isArray(b.emails) ? b.emails : [];
      out.emails = arr.slice(0, 50).map((c: Record<string, unknown>) => ({
        name: String(c?.name ?? "").trim(), dept: String(c?.dept ?? "").trim(), email: String(c?.email ?? "").trim(),
      })).filter((c) => c.name || c.email);
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
    if (isCreate || b.tdsPct !== undefined) out.tdsPct = optNum(b, "tdsPct");
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

  // ─── Client (§4.1 Client/Account template) ──────────────────────────────────
  // Dedicated sanitizer (NOT a generic master): FCL-#### ids, RM ownership,
  // encrypted PAN, nested addresses/contact/relationships. dupeKeys recomputed
  // from primaryContact.mobile+email whenever the contact is set.
  const CONSTITUTIONS = ["INDIVIDUAL", "PROPRIETORSHIP", "PARTNERSHIP", "LLP", "PVT_LTD", "HUF"] as const;

  function sanitizeAddress(v: unknown): Record<string, string> {
    const a = (v ?? {}) as Record<string, unknown>;
    return {
      line: String(a.line ?? "").trim(), city: String(a.city ?? "").trim(),
      state: String(a.state ?? "").trim(), pincode: String(a.pincode ?? "").trim(),
    };
  }

  const sanitizeClient: Sanitizer = (b, isCreate) => {
    rejectFullAadhaar(b);
    const out: Record<string, unknown> = {};
    if (isCreate || b.constitution !== undefined) out.constitution = reqEnum(b, "constitution", CONSTITUTIONS);
    if (isCreate || b.name !== undefined) out.name = reqStr(b, "name");
    if (isCreate || b.industry !== undefined) out.industry = optStr(b, "industry");
    // PAN arrives raw over HTTPS; stored only encrypted + last4.
    if (b.pan !== undefined) {
      const pan = String(b.pan ?? "").trim().toUpperCase();
      if (pan) {
        if (!PAN_RE.test(pan)) throw new ApiError(400, "pan format invalid (expected ABCDE1234F)");
        out.panEnc = encryptField(pan); out.panLast4 = pan.slice(-4);
      } else if (!isCreate) { out.panEnc = null; out.panLast4 = null; }
    } else if (isCreate) { out.panEnc = null; out.panLast4 = null; }
    if (isCreate || b.gstin !== undefined) out.gstin = optStr(b, "gstin");
    if (isCreate || b.udyam !== undefined) out.udyam = optStr(b, "udyam");
    if (isCreate || b.cin !== undefined) out.cin = optStr(b, "cin");
    if (isCreate || b.incorporationDate !== undefined) out.incorporationDate = optTs(b, "incorporationDate");
    if (isCreate || b.regAddress !== undefined) out.regAddress = sanitizeAddress(b.regAddress);
    if (isCreate || b.commAddress !== undefined) out.commAddress = sanitizeAddress(b.commAddress);
    if (isCreate || b.primaryContact !== undefined) {
      const pc = (b.primaryContact ?? {}) as Record<string, unknown>;
      const mobile = String(pc.mobile ?? "").replace(/[\s-]/g, "").replace(/^\+91/, "");
      if (isCreate && !MOBILE_RE.test(mobile)) throw new ApiError(400, "primaryContact.mobile must be a 10-digit Indian mobile");
      if (mobile && !MOBILE_RE.test(mobile)) throw new ApiError(400, "primaryContact.mobile must be a 10-digit Indian mobile");
      const email = isStr(pc.email) ? String(pc.email).trim() : null;
      const name = isStr(pc.name) ? String(pc.name).trim() : ((out.name as string | undefined) ?? "");
      out.primaryContact = { name, mobile, email };
      out.dupeKeys = buildDupeKeys(mobile || null, email);
    }
    if (isCreate || b.latestCibil !== undefined) {
      const c = (b.latestCibil ?? null) as Record<string, unknown> | null;
      if (c && c.score !== undefined && c.score !== null && c.score !== "") {
        const score = Number(c.score);
        if (isNaN(score)) throw new ApiError(400, "latestCibil.score must be a number");
        out.latestCibil = { score, pulledAt: optTs(c, "pulledAt") ?? Timestamp.now() };
      } else { out.latestCibil = null; }
    }
    if (isCreate || b.existingRelationships !== undefined) {
      const arr = Array.isArray(b.existingRelationships) ? b.existingRelationships : [];
      out.existingRelationships = arr
        .filter((r: Record<string, unknown>) => isStr(r.bank) || isStr(r.facility))
        .map((r: Record<string, unknown>) => ({
          bank: String(r.bank ?? "").trim(), facility: String(r.facility ?? "").trim(),
          outstanding: Number(r.outstanding) || 0, emi: Number(r.emi) || 0,
        }));
    }
    if (isCreate || b.sourcedById !== undefined) out.sourcedById = optStr(b, "sourcedById");
    if (isCreate || b.kycStatus !== undefined) out.kycStatus = reqEnum({ kycStatus: b.kycStatus ?? "PENDING" }, "kycStatus", ["PENDING", "PARTIAL", "COMPLETE"] as const);
    if (isCreate || b.status !== undefined) out.status = reqEnum({ status: b.status ?? "ACTIVE" }, "status", ["ACTIVE", "INACTIVE", "BLACKLISTED"] as const);
    return out;
  };

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

  // ─── Connector master (HRMS /connectors, CON-###) — rich, encrypted ──────────
  // PAN encrypted (last-4 shown), Aadhaar last-4 ONLY (UIDAI — full never stored),
  // bank account encrypted (last-4 shown). Sensitive financial lives in the
  // admin/HR-only /connectors/{id}/private/financial sub-doc; the main doc holds
  // display-safe fields (read by CRM users for the Add Customer picker).
  const CONNECTOR_ENTITY_TYPES = ["INDIVIDUAL", "PROPRIETORSHIP", "PARTNERSHIP", "LLP", "PVT_LTD", "HUF"];
  const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

  async function nextConnectorCodeServer(): Promise<string> {
    const snap = await db.collection("connectors").get();
    let max = 0;
    snap.docs.forEach((d) => {
      const m = /^(?:CON|CONN|FAC)-(\d+)$/.exec(String(d.data().connectorCode ?? ""));
      if (m) max = Math.max(max, Number(m[1]));
    });
    return `CON-${String(max + 1).padStart(3, "0")}`;
  }

  // ─── Partner intake funnel (fields ON the connector; see src/lib/crm2/partnerScoring) ──
  const PARTNER_FUNNEL = ["Inquiry", "Screening", "KYC Collection", "Agreement Sent", "Agreement Signed", "Training", "Active", "Rejected", "On Hold"];
  const PARTNER_TERMINAL = new Set(["Active", "Rejected"]);   // config recompute skips these
  const PARTNER_NETWORK_TYPE = ["CA / Accountant", "Property Dealer / Broker", "Insurance Agent", "HR / Corporate Contact", "Society / RWA Office Bearer", "Freelance Loan Agent", "Other / Unclear"];
  const PARTNER_NETWORK_SIZE = [">100 contacts", "30-100 contacts", "<30 contacts", "Not Shared"];
  const PARTNER_FIT = ["Strong Fit", "Partial Fit", "Unclear"];
  const PARTNER_TRACK = ["Proven with Examples", "Some Experience", "None"];
  const PARTNER_VOLUME = [">5 cases/month", "2-5 cases/month", "<2 cases/month", "Not Shared"];
  const PARTNER_KYC = ["Ready", "Partial", "Not Ready"];
  const PARTNER_LEAD_SOURCE = ["Website Form", "WhatsApp Inquiry", "Referral", "Walk-in", "Other"];
  const PARTNER_NEXT_ACTION = ["Send Screening Call", "Collect KYC Docs", "Send Agreement", "Schedule Training", "Grant Pulse Access", "Reject", "On Hold"];

  const optBool = (b: Record<string, unknown>, f: string): boolean | undefined =>
    (b[f] === undefined ? undefined : b[f] === true);
  const optEnum = (b: Record<string, unknown>, f: string, allowed: string[]): string | null | undefined => {
    if (b[f] === undefined) return undefined;
    if (b[f] === null || b[f] === "") return null;
    const v = String(b[f]);
    if (!allowed.includes(v)) throw new ApiError(400, `${f} must be one of: ${allowed.join(", ")}`);
    return v;
  };

  // Screening/funnel fields the client may set on a connector (allowlist). Scoring
  // fields (partnerScoring) are NEVER read from the body — always recomputed.
  function partnerScreeningFields(b: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const set = (k: string, v: unknown) => { if (v !== undefined) out[k] = v; };
    set("funnelStatus", optEnum(b, "funnelStatus", PARTNER_FUNNEL));
    set("owner", optStr(b, "owner") === null && b.owner === undefined ? undefined : (optStr(b, "owner") ?? null));
    set("leadSource", optEnum(b, "leadSource", PARTNER_LEAD_SOURCE));
    set("occupation", b.occupation === undefined ? undefined : (optStr(b, "occupation") ?? ""));
    set("networkType", optEnum(b, "networkType", PARTNER_NETWORK_TYPE));
    set("networkSize", optEnum(b, "networkSize", PARTNER_NETWORK_SIZE));
    set("productInterestStated", b.productInterestStated === undefined ? undefined : (optStr(b, "productInterestStated") ?? ""));
    set("productDemandFit", optEnum(b, "productDemandFit", PARTNER_FIT));
    set("priorTrackRecord", optEnum(b, "priorTrackRecord", PARTNER_TRACK));
    set("trackRecordNotes", b.trackRecordNotes === undefined ? undefined : (optStr(b, "trackRecordNotes") ?? ""));
    set("expectedMonthlyVolume", optEnum(b, "expectedMonthlyVolume", PARTNER_VOLUME));
    set("kycReadinessInput", optEnum(b, "kycReadinessInput", PARTNER_KYC));
    set("existingDsaCodeElsewhere", optBool(b, "existingDsaCodeElsewhere"));
    set("conflictNotes", b.conflictNotes === undefined ? undefined : (optStr(b, "conflictNotes") ?? ""));
    set("screeningCallDone", optBool(b, "screeningCallDone"));
    set("nextAction", optEnum(b, "nextAction", PARTNER_NEXT_ACTION));
    if (b.screeningCallDate !== undefined) {
      out.screeningCallDate = isStr(b.screeningCallDate) && b.screeningCallDate
        ? Timestamp.fromDate(new Date(String(b.screeningCallDate))) : null;
    }
    if (b.notes !== undefined) out.notes = optStr(b, "notes") ?? "";
    if (b.ownDsaCode !== undefined) out.ownDsaCode = optStr(b, "ownDsaCode");
    return out;
  }

  // Onboarding checklist fields (booleans/dates); progressPct is recomputed, never set here.
  function partnerOnboardingFields(b: Record<string, unknown>): Record<string, unknown> | undefined {
    const oc = b.onboardingChecklist;
    if (!oc || typeof oc !== "object") return undefined;
    const o = oc as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const setB = (k: string) => { if (o[k] !== undefined) out[k] = o[k] === true; };
    const setD = (k: string) => {
      if (o[k] !== undefined) out[k] = isStr(o[k]) && o[k] ? Timestamp.fromDate(new Date(String(o[k]))) : null;
    };
    setB("panCollected"); setB("aadhaarCollected"); setB("bankDetailsCollected");
    setB("trainingCompleted"); setB("pulseAccessCreated"); setB("firstCaseLogged");
    setD("agreementSentDate"); setD("agreementSignedDate");
    return out;
  }

  const PRACTICAL_KNOWLEDGE = ["Strong", "Adequate", "Weak"];
  const PRACTICAL_CASE = ["Complete & clean", "Minor gaps", "Poor"];
  const PRACTICAL_RESP = ["Prompt", "Acceptable", "Slow"];
  const PRACTICAL_PROC = ["Clear", "Partial", "None"];

  // Practical-assessment ratings (fixed choices) + notes; scores/result are NEVER
  // read from the body — recomputed from these ratings x the rubric.
  function partnerPracticalFields(b: Record<string, unknown>): Record<string, unknown> | undefined {
    const pa = b.practicalAssessment;
    if (!pa || typeof pa !== "object") return undefined;
    const o = pa as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const setE = (k: string, allowed: string[]) => {
      if (o[k] === undefined) return;
      if (o[k] === null || o[k] === "") { out[k] = null; return; }
      const v = String(o[k]);
      if (!allowed.includes(v)) throw new ApiError(400, `practicalAssessment.${k} must be one of: ${allowed.join(", ")}`);
      out[k] = v;
    };
    setE("productKnowledge", PRACTICAL_KNOWLEDGE);
    setE("sampleCaseQuality", PRACTICAL_CASE);
    setE("responsiveness", PRACTICAL_RESP);
    setE("processUnderstanding", PRACTICAL_PROC);
    if (o.assessorNotes !== undefined) out.assessorNotes = isStr(o.assessorNotes) ? String(o.assessorNotes).slice(0, 2000) : "";
    return out;
  }

  /** The onboarding chain gate: what still blocks a candidate from going Active.
   *  Returns a human list of missing items (empty = clear to activate). Legacy
   *  connectors (already Active / pre-funnel actives) are never re-gated. */
  function activationBlockers(merged: Record<string, unknown>, panLast4Present: boolean): string[] {
    const missing: string[] = [];
    const pa = merged.practicalAssessment as Record<string, unknown> | undefined;
    if (!pa || pa.result !== "Pass") {
      missing.push(pa?.result === "Fail"
        ? "practical assessment is FAILED — re-assess before activating"
        : "practical assessment not passed yet (complete all 4 ratings in the Assessment tab)");
    }
    const oc = merged.onboardingChecklist as Record<string, unknown> | undefined;
    if (!oc?.agreementSignedDate) missing.push("agreement not signed (Onboarding tab)");
    if (!oc?.panCollected && !panLast4Present) missing.push("PAN not collected (Details/Onboarding tab)");
    return missing;
  }

  const EMPTY_ONBOARDING = {
    panCollected: false, aadhaarCollected: false, bankDetailsCollected: false,
    agreementSentDate: null, agreementSignedDate: null,
    trainingCompleted: false, pulseAccessCreated: false, firstCaseLogged: false,
    onboardingCompleteDate: null, progressPct: 0,
  };

  /** Load the rubric config, seeding partnerScoringConfig/default on first read. */
  async function getPartnerRubric(): Promise<PartnerRubric> {
    const ref = db.collection("partnerScoringConfig").doc("default");
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({ ...DEFAULT_PARTNER_RUBRIC, updatedAt: FieldValue.serverTimestamp(), updatedBy: "system:seed" });
      return DEFAULT_PARTNER_RUBRIC;
    }
    return snap.data() as PartnerRubric;
  }

  /** Score fields for a merged connector doc — stamps computedAt server-side. */
  function scoreFor(merged: Record<string, unknown>, rubric: PartnerRubric): Record<string, unknown> {
    const s = computePartnerScore(merged as never, rubric);
    return { ...s, computedAt: FieldValue.serverTimestamp() };
  }

  function connectorMainFields(b: Record<string, unknown>, isCreate: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (isCreate || b.displayName !== undefined) out.displayName = reqStr(b, "displayName");
    if (isCreate || b.entityType !== undefined) {
      const et = optStr(b, "entityType");
      if (et && !CONNECTOR_ENTITY_TYPES.includes(et)) throw new ApiError(400, "invalid entityType");
      out.entityType = et;
    }
    if (isCreate || b.mobiles !== undefined || b.mobile !== undefined) {
      const raw = Array.isArray(b.mobiles) ? b.mobiles.map(String) : (b.mobile ? [String(b.mobile)] : []);
      const arr = raw.map((m) => m.replace(/[\s-]/g, "").replace(/^\+91/, "")).filter(Boolean);
      if (isCreate && arr.length === 0) throw new ApiError(400, "at least one mobile is required");
      for (const m of arr) if (!MOBILE_RE.test(m)) throw new ApiError(400, `mobile ${m} must be a 10-digit Indian mobile`);
      out.mobiles = arr;
      out.mobile = arr[0] ?? "";   // back-compat for the Add Customer / case pickers
    }
    if (isCreate || b.email !== undefined) out.email = optStr(b, "email") ?? "";
    if (isCreate || b.firmName !== undefined) out.firmName = optStr(b, "firmName");
    if (isCreate || b.gstin !== undefined) out.gstin = optStr(b, "gstin");
    if (isCreate || b.verticals !== undefined) {
      const v = Array.isArray(b.verticals) ? b.verticals.filter((x) => ["loan", "wealth", "insurance"].includes(String(x))) : [];
      if (isCreate && v.length === 0) throw new ApiError(400, "pick at least one vertical");
      out.verticals = v;
    }
    if (isCreate || b.status !== undefined) out.status = b.status === "inactive" ? "inactive" : "active";
    // Per-product auto-payout rules (the CON- partner's share, paid FROM our
    // payout at disbursement). Sanitized rule-by-rule; invalid rows dropped.
    if (b.payoutRules !== undefined) {
      const raw = Array.isArray(b.payoutRules) ? b.payoutRules : [];
      out.payoutRules = raw.map((r) => sanitizeChannelPartnerRule(r)).filter(Boolean).slice(0, 20);
    }
    return out;
  }

  // Merge/encrypt the payout bank. `raw` null clears it; a blank accountNo keeps
  // the existing encrypted account; other fields merge over `existing`.
  function buildPayoutBank(raw: unknown, existing: Record<string, unknown> | null): Record<string, unknown> | null {
    if (raw === null) return null;
    if (!raw || typeof raw !== "object") return existing;
    const pb = raw as Record<string, unknown>;
    const ex = existing ?? {};
    const bankName = isStr(pb.bankName) ? String(pb.bankName).trim() : String(ex.bankName ?? "");
    const accountHolderName = isStr(pb.accountHolderName) ? String(pb.accountHolderName).trim() : String(ex.accountHolderName ?? "");
    const branchName = isStr(pb.branchName) ? (String(pb.branchName).trim() || null) : ((ex.branchName as string | null) ?? null);
    const ifsc = isStr(pb.ifsc) && String(pb.ifsc).trim() ? String(pb.ifsc).trim().toUpperCase() : String(ex.ifsc ?? "");
    let accountNoEnc = (ex.accountNoEnc as unknown) ?? null;
    let accountNoLast4 = (ex.accountNoLast4 as string | null) ?? null;
    if (isStr(pb.accountNo) && String(pb.accountNo).trim()) {
      const acc = String(pb.accountNo).replace(/\s/g, "");
      if (!/^\d{6,20}$/.test(acc)) throw new ApiError(400, "bank.accountNo must be 6–20 digits");
      accountNoEnc = encryptField(acc); accountNoLast4 = acc.slice(-4);
    }
    if (!bankName && !accountHolderName && !ifsc && !accountNoEnc) return existing;
    if (ifsc && !IFSC_RE.test(ifsc)) throw new ApiError(400, "bank.ifsc format invalid (e.g. HDFC0001234)");
    return { bankName, accountHolderName, ifsc, accountNoEnc, accountNoLast4, branchName };
  }

  app.post("/api/crm2/connectors", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    rejectFullAadhaar(b);
    const main = connectorMainFields(b, true);
    const screening = partnerScreeningFields(b);
    const onboardingIn = partnerOnboardingFields(b);

    // Financial (private) — PAN is now OPTIONAL (a minimal Inquiry candidate can be
    // logged with just name+mobile+source; PAN/KYC is collected as they progress).
    const pan = String(b.pan ?? "").trim().toUpperCase();
    const fin: Record<string, unknown> = { aadhaarLast4: null, panEnc: null, panLast4: null, payoutBank: null, tdsPct: null };
    if (pan) {
      if (!PAN_RE.test(pan)) throw new ApiError(400, "PAN format invalid (expected ABCDE1234F)");
      fin.panEnc = encryptField(pan); fin.panLast4 = pan.slice(-4);
    }
    const a = String(b.aadhaarLast4 ?? "").trim();
    if (a && !/^\d{4}$/.test(a)) throw new ApiError(400, "aadhaarLast4 must be exactly 4 digits — full Aadhaar is never stored");
    fin.aadhaarLast4 = a || null;
    fin.tdsPct = optNum(b, "tdsPct");
    fin.payoutBank = buildPayoutBank(b.bank, null);

    // Funnel defaults: a new candidate starts at Inquiry, inactive (hidden from RM
    // pickers) until it reaches Active. `status` is DERIVED from funnelStatus.
    const funnelStatus = (screening.funnelStatus as string | undefined) ?? "Inquiry";
    const onboarding = { ...EMPTY_ONBOARDING, ...(onboardingIn ?? {}) };
    onboarding.progressPct = computeOnboardingProgress(onboarding as never);
    const merged = { ...main, ...screening, funnelStatus };
    const rubric = await getPartnerRubric();
    const partnerScoring = scoreFor(merged, rubric);
    const status = funnelStatus === "Active" ? "active" : "inactive";

    const code = await nextConnectorCodeServer();
    const ref = db.collection("connectors").doc();
    await ref.set({
      connectorCode: code, address: "", ownDsaCode: null, payoutRules: [], deleted: false,
      ...main, ...screening, funnelStatus, status,
      onboardingChecklist: onboarding, partnerScoring,
      ...createAudit(caller.fapl),
    });
    await ref.collection("private").doc("financial").set({ ...fin, updatedAt: FieldValue.serverTimestamp() });
    res.json({ ok: true, id: ref.id, connectorCode: code });
  }));

  app.patch("/api/crm2/connectors/:id", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    rejectFullAadhaar(b);
    const ref = db.collection("connectors").doc(req.params.id);
    const cur = (await ref.get()).data();
    if (!cur) throw new ApiError(404, "connector not found");
    const main = connectorMainFields(b, false);
    const screening = partnerScreeningFields(b);
    const onboardingIn = partnerOnboardingFields(b);

    // Merge the incoming changes over the current doc so scoring/status derive from
    // the FULL picture (a lone screening edit still re-tiers correctly).
    const merged: Record<string, unknown> = { ...cur, ...main, ...screening };
    const update: Record<string, unknown> = { ...main, ...screening };

    // Recompute the rubric score whenever any scored screening field changed.
    const SCORED = ["networkType", "networkSize", "productDemandFit", "priorTrackRecord", "expectedMonthlyVolume", "kycReadinessInput", "existingDsaCodeElsewhere"];
    if (SCORED.some((k) => k in screening)) {
      update.partnerScoring = scoreFor(merged, await getPartnerRubric());
    }

    // Practical assessment: merge ratings, recompute score/result server-side.
    const practicalIn = partnerPracticalFields(b);
    if (practicalIn) {
      const curPa = (cur.practicalAssessment as Record<string, unknown>) ?? {};
      const paMerged = { ...curPa, ...practicalIn };
      const computed = computePracticalAssessment(paMerged as never, await getPartnerRubric());
      update.practicalAssessment = {
        ...paMerged, ...computed,
        assessedBy: caller.fapl, assessedAt: FieldValue.serverTimestamp(),
      };
      merged.practicalAssessment = update.practicalAssessment;
    }

    // Onboarding checklist: merge, recompute progressPct, stamp completion date.
    if (onboardingIn) {
      const curOc = (cur.onboardingChecklist as Record<string, unknown>) ?? EMPTY_ONBOARDING;
      const oc = { ...EMPTY_ONBOARDING, ...curOc, ...onboardingIn };
      oc.progressPct = computeOnboardingProgress(oc as never);
      oc.onboardingCompleteDate = oc.progressPct === 100
        ? (curOc.onboardingCompleteDate ?? FieldValue.serverTimestamp())
        : null;
      update.onboardingChecklist = oc;
    }

    // Follow-up scheduling (mirrors the CRM 2.0 lead pattern): setting/changing
    // the time re-arms the 15-min reminder sweep, which bells+emails super admins.
    if (b.nextFollowUpAt !== undefined) {
      update.nextFollowUpAt = optTs(b, "nextFollowUpAt");
      update.followUpReminderSent = false;
    }
    if (b.nextFollowUpNote !== undefined) update.nextFollowUpNote = optStr(b, "nextFollowUpNote");

    // Quick activity log — call / whatsapp / email / note entries appended to the
    // candidate's timeline (arrayUnion; screening histories stay small).
    const activity = (b.activity ?? null) as { note?: unknown; action?: unknown } | null;
    if (activity && isStr(activity.note) && String(activity.note).trim()) {
      update.activityLog = FieldValue.arrayUnion({
        at: Timestamp.now(),   // arrayUnion cannot hold serverTimestamp()
        by: caller.fapl,
        note: String(activity.note).slice(0, 2000),
        action: isStr(activity.action) ? String(activity.action).slice(0, 60) : "note",
      });
    }

    // Derive the picker gate from funnelStatus whenever it's set (Active → active,
    // anything else → inactive). Legacy connectors without funnelStatus are untouched.
    if ("funnelStatus" in screening) {
      // ONBOARDING GATE: a candidate can only TRANSITION to Active when the chain
      // is complete — practical assessment passed, agreement signed, PAN in.
      // Legacy bypass: a connector that is already Active (or was active before
      // the funnel existed) is never re-gated by an ordinary edit.
      const alreadyActive = cur.funnelStatus === "Active"
        || (cur.status === "active" && !cur.funnelStatus);
      if (screening.funnelStatus === "Active" && !alreadyActive) {
        if (onboardingIn && !update.onboardingChecklist) {
          // (ordering safety — onboarding merge happens above; nothing to do)
        }
        const mergedForGate = { ...merged, ...(update.onboardingChecklist ? { onboardingChecklist: update.onboardingChecklist } : {}) };
        const finSnap = await ref.collection("private").doc("financial").get();
        const panPresent = !!(finSnap.data()?.panLast4) || isStr(b.pan);
        const missing = activationBlockers(mergedForGate, panPresent);
        if (missing.length) {
          throw new ApiError(422, `Cannot activate yet — ${missing.join("; ")}`);
        }
      }
      update.status = screening.funnelStatus === "Active" ? "active" : "inactive";
    }

    if (Object.keys(update).length) await ref.update({ ...update, ...updateAudit(caller.fapl) });

    // Private financial sub-doc (PAN optional on edit; blank keeps existing enc).
    const finRef = ref.collection("private").doc("financial");
    const curFin = (await finRef.get()).data() ?? {};
    const fin: Record<string, unknown> = {};
    if (isStr(b.pan) && String(b.pan).trim()) {
      const pan = String(b.pan).trim().toUpperCase();
      if (!PAN_RE.test(pan)) throw new ApiError(400, "PAN format invalid (expected ABCDE1234F)");
      fin.panEnc = encryptField(pan); fin.panLast4 = pan.slice(-4);
    }
    if (b.aadhaarLast4 !== undefined) {
      const av = String(b.aadhaarLast4 ?? "").trim();
      if (av && !/^\d{4}$/.test(av)) throw new ApiError(400, "aadhaarLast4 must be exactly 4 digits — full Aadhaar is never stored");
      fin.aadhaarLast4 = av || null;
    }
    if (b.tdsPct !== undefined) fin.tdsPct = optNum(b, "tdsPct");
    if (b.bank !== undefined) fin.payoutBank = buildPayoutBank(b.bank, (curFin.payoutBank as Record<string, unknown> | null) ?? null);
    if (Object.keys(fin).length) await finRef.set({ ...fin, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ ok: true });
  }));

  // ─── Partner scoring rubric config (partnerScoringConfig/default) ──────────────
  app.get("/api/crm2/partner-scoring-config", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    res.json({ ok: true, config: await getPartnerRubric() });
  }));

  app.patch("/api/crm2/partner-scoring-config", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    const prev = await getPartnerRubric();
    const next = sanitizePartnerRubric(req.body ?? {}, prev);
    next.version = (prev.version ?? 0) + 1;   // bump → triggers recompute
    await db.collection("partnerScoringConfig").doc("default").set({
      ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.fapl,
    });

    // Re-tier every NON-TERMINAL candidate (skip Active/Rejected — settled).
    const snap = await db.collection("connectors").where("deleted", "==", false).get();
    let recomputed = 0;
    const chunks: FirebaseFirestore.WriteBatch[] = [db.batch()];
    for (const doc of snap.docs) {
      const d = doc.data();
      if (!d.funnelStatus || PARTNER_TERMINAL.has(String(d.funnelStatus))) continue;
      chunks[chunks.length - 1].update(doc.ref, { partnerScoring: scoreFor(d, next) });
      recomputed++;
      if (recomputed % 400 === 0) chunks.push(db.batch());
    }
    if (recomputed > 0) await Promise.all(chunks.map((c) => c.commit()));
    res.json({ ok: true, version: next.version, recomputed });
  }));

  // ─── One-time: rename legacy connector codes FAC-/CONN-### → CON-### ──────────
  // Connectors (HRMS `/connectors`) are now coded CON-### (CON- chosen by Rahul;
  // earlier FAC-/CONN-). connectorCode is a display FIELD (the real link is the
  // doc id / channelPartnerId), so this rewrites the code on the connector + the
  // denormalised channelPartnerCode on leads/cases/logins. Idempotent; SA UI.
  app.post("/api/crm2/admin/migrate-connector-codes", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    const snap = await db.collection("connectors").get();
    const legacy = snap.docs.filter((d) => /^(?:FAC|CONN)-\d+$/.test(String(d.data().connectorCode ?? "")));
    const migrated: Array<{ id: string; old: string; new: string; repointed: number }> = [];

    for (const d of legacy) {
      const oldCode = String(d.data().connectorCode);
      const newCode = oldCode.replace(/^(?:FAC|CONN)-/, "CON-");
      await d.ref.update({ connectorCode: newCode, updatedAt: FieldValue.serverTimestamp() });
      let repointed = 0;
      // Denormalised channelPartnerCode (keyed by channelPartnerId == connector doc id).
      for (const coll of ["leads", "cases"]) {
        const refs = await db.collection(coll).where("channelPartnerId", "==", d.id).get();
        for (let i = 0; i < refs.docs.length; i += 400) {
          const batch = db.batch();
          refs.docs.slice(i, i + 400).forEach((r) => batch.update(r.ref, { channelPartnerCode: newCode }));
          await batch.commit();
        }
        repointed += refs.size;
      }
      const cases = await db.collection("cases").get();
      for (const c of cases.docs) {
        const lg = await c.ref.collection("logins").where("channelPartnerId", "==", d.id).get();
        if (lg.empty) continue;
        const batch = db.batch();
        lg.docs.forEach((r) => batch.update(r.ref, { channelPartnerCode: newCode }));
        await batch.commit();
        repointed += lg.size;
      }
      migrated.push({ id: d.id, old: oldCode, new: newCode, repointed });
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

  // Resolve the DSA-code mapping for a case/login. Payout is per product, and per
  // sub-product when sub-products exist, so the precedence is:
  //   (agg × lender × product × subProduct)  →  (agg × lender × product, whole)
  //   →  any product mapping  →  legacy product-less mapping.
  // Deterministic — money is never guessed. If more than one mapping remains at the
  // matched tier (after preferring ACTIVE), we hard-fail 409 naming the conflicting
  // mapping ids, mirroring the resolveSlab hard-fail style. All four call sites
  // (per-case + per-login disburse and both previews) surface this to the caller.
  function pickUnambiguousMapping(
    docs: FirebaseFirestore.QueryDocumentSnapshot[], tierDesc: string,
  ): FirebaseFirestore.QueryDocumentSnapshot {
    if (docs.length === 1) return docs[0];
    const active = docs.filter((d) => d.data().status === "ACTIVE");
    const pool = active.length > 0 ? active : docs;
    if (pool.length === 1) return pool[0];
    throw new ApiError(409,
      `Ambiguous DSA-code mapping — ${pool.length} mappings match ${tierDesc} (${pool.map((d) => d.id).join(", ")}). ` +
      `Deactivate or merge the duplicates in Masters → DSA Codes so exactly one applies.`,
      { kind: "AMBIGUOUS_MAPPING", candidates: pool.map((d) => d.id) });
  }
  async function resolveMapping(connectorId: string, lenderId: string, productId?: string | null, subProduct?: string | null) {
    if (productId) {
      const prodDocs = (await db.collection("dsaCodeMappings")
        .where("connectorId", "==", connectorId).where("lenderId", "==", lenderId)
        .where("productId", "==", productId).get()).docs;
      if (prodDocs.length) {
        if (subProduct) {
          const exact = prodDocs.filter((d) => (d.data().subProduct ?? null) === subProduct);
          if (exact.length) return pickUnambiguousMapping(exact, `this aggregator × lender × product × ${subProduct}`);
        }
        const whole = prodDocs.filter((d) => !d.data().subProduct);
        if (whole.length) return pickUnambiguousMapping(whole, "this aggregator × lender × product");
        return pickUnambiguousMapping(prodDocs, "this aggregator × lender × product (sub-product mappings only)");
      }
    }
    const all = await db.collection("dsaCodeMappings")
      .where("connectorId", "==", connectorId).where("lenderId", "==", lenderId).get();
    if (all.empty) return null;
    const legacy = all.docs.filter((d) => !d.data().productId);
    if (legacy.length) return pickUnambiguousMapping(legacy, "this aggregator × lender (legacy product-less)");
    return pickUnambiguousMapping(all.docs, "this aggregator × lender");
  }

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

  // ═══ Phase 2 — Leads: public intake, internal CRUD, dedupe, convert ═══════════

  const LEAD_CATEGORIES = ["LOAN", "WEALTH", "INSURANCE", "CIBIL_CHECK", "PARTNER_DSA", "GENERAL"] as const;
  const LEAD_SOURCES = ["WEBSITE", "JUSTDIAL", "REFERRAL_CLIENT", "REFERRAL_SUBDSA", "ADS", "WALKIN", "COLD_CALL"] as const;
  const LEAD_STATUSES = ["NEW", "QUEUED", "ASSIGNED", "ATTEMPTED", "CONTACTED", "QUALIFIED", "JUNK_DUPLICATE", "NOT_INTERESTED", "NOT_ELIGIBLE", "CONVERTED", "DROPPED"] as const;
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

    // A TRUSTED server-to-server caller (e.g. the website's Google Apps Script) may
    // present the shared secret to bypass the per-IP rate limit — Apps Script egress
    // shares Google IPs, so the public 20/h cap would otherwise drop legit campaign
    // leads. Browser posts (no secret) stay rate-limited + honeypotted as before.
    const trusted = !!process.env.WEBSITE_WEBHOOK_SECRET
      && req.headers["x-finvastra-webhook-secret"] === process.env.WEBSITE_WEBHOOK_SECRET;

    // Real client IP: Cloud Run appends it as the LAST X-Forwarded-For entry
    // (first-entry parsing is client-spoofable). req.ip agrees via trust proxy=1.
    const ip = extractClientIp(req.headers["x-forwarded-for"], req.ip);
    if (!trusted && !(await rateLimit(`crm2pub:${ip}`, 20, 60 * 60 * 1000))) {
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
        receivedAt: FieldValue.serverTimestamp(), leadCode: newId,
        category, productId: null,
        name, mobile, email: email ?? null,
        city: optStr(b, "city"),
        source: "WEBSITE",
        sourceMeta: {
          formId: optStr(b, "formId"),
          sourceUrl: optStr(b, "sourceUrl")?.slice(0, 500) ?? null,
          utm: utm && Object.keys(utm).length > 0 ? utm : null,
          via: trusted ? "apps_script" : "web",
        },
        amountRequired,
        referredById: null, referredByType: null,
        assignedRm: null, assignedAt: null,
        status: "NEW", priority: "HOT",   // website / social leads = high (red) priority
        nextFollowUpAt: null, attempts: 0,
        activityLog: [], dropReason: null,
        converted: false, convertedAt: null,
        linkedClientId: null, linkedCaseId: null, linkedSubDsaId: null,
        duplicateOfLeadId: duplicate?.collection === "leads" ? duplicate.id : null,
        dupeKeys,
        firstContactedAt: null,   // Stage-2 SLA end — stamped once on first contact
        ...createAudit("public:website"),
      });
      return newId;
    });

    // Partner-intent auto-detect: a submission from the "become a partner" form/
    // page is STAMPED as category PARTNER_DSA so it's visibly a partner request —
    // but it stays a normal LEAD. The initial calls/screening happen on the Leads
    // page like any contact; a CON- code is minted ONLY when someone qualified is
    // manually moved to Masters → Connectors (promote-partner). No code is ever
    // spent on an unvetted inquiry.
    if (category !== "PARTNER_DSA"
        && isPartnerIntent(category, optStr(b, "formId"), optStr(b, "sourceUrl"))) {
      await db.collection("leads").doc(id).update({
        category: "PARTNER_DSA",
        activityLog: FieldValue.arrayUnion({
          at: Timestamp.now(), by: "system",
          note: "Marked as a PARTNER request (website partner form) — screen from Leads, then Move to Partner funnel if qualified",
          action: "note",
        }),
      }).catch((e) => console.error("[partner stamp failed]", e));
    }
    res.json({ ok: true, id });
  }));

  // ─── Public PARTNER intake (finvastra.com "become a partner" form) ────────────
  // People asking to become a Finvastra partner / use our DSA code. Lands as an
  // Inquiry-stage Connector (status:'inactive' — hidden from RM pickers until
  // Active), scored by the current rubric. Same guards as the leads intake:
  // honeypot, per-IP rate limit (trusted Apps-Script secret bypasses it).
  /** Create an Inquiry-stage partner candidate (a Connector doc, status inactive,
   *  scored by the current rubric). Shared by the public partner form, the
   *  website-lead auto-detect, and the promote-from-lead action. */
  async function createPartnerCandidate(input: {
    name: string; mobile: string; email?: string | null; firmName?: string | null;
    leadSource?: string; occupation?: unknown; networkType?: unknown; networkSize?: unknown;
    productInterestStated?: unknown; createdBy: string;
  }): Promise<{ id: string; code: string }> {
    const screening = partnerScreeningFields({
      leadSource: PARTNER_LEAD_SOURCE.includes(String(input.leadSource)) ? input.leadSource : "Website Form",
      occupation: input.occupation, networkType: input.networkType, networkSize: input.networkSize,
      productInterestStated: input.productInterestStated,
    });
    const merged = { ...screening, funnelStatus: "Inquiry" };
    const partnerScoring = scoreFor(merged, await getPartnerRubric());
    const code = await nextConnectorCodeServer();
    const ref = db.collection("connectors").doc();
    await ref.set({
      connectorCode: code, displayName: input.name, mobile: input.mobile, mobiles: [input.mobile],
      email: input.email ?? "", address: "", firmName: input.firmName ?? "",
      gstin: null, ownDsaCode: null, verticals: [], payoutRules: [], deleted: false,
      status: "inactive", funnelStatus: "Inquiry", ...screening,
      onboardingChecklist: { ...EMPTY_ONBOARDING }, partnerScoring,
      ...createAudit(input.createdBy),
    });
    await ref.collection("private").doc("financial").set({
      panEnc: null, panLast4: null, aadhaarLast4: null, payoutBank: null, tdsPct: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    void notifyPartnerCandidate(input.name, code, input.mobile,
      String(input.leadSource ?? "Website Form"));
    return { id: ref.id, code };
  }

  /** Deterministic partner-intent detector for website submissions: explicit
   *  PARTNER_DSA category, or the submitting form/page names itself "partner". */
  function isPartnerIntent(category: string, formId: string | null, sourceUrl: string | null): boolean {
    if (category === "PARTNER_DSA") return true;
    const hay = ((formId ?? "") + " " + (sourceUrl ?? "")).toLowerCase();
    // "partner" catches the finvastra.com/partner page URL; the rest are the
    // page's actual form ids observed in production submissions.
    return /partner|individual[-_ ]?dsa|corporate[-_ ]?dsa|institutional|co[-_ ]?sourcing|dsa[-_ ]?code|become[-_ ]?a[-_ ]?agent/.test(hay);
  }

  /** Active super admins (env list ∪ users.superAdmin flag) — the audience for
   *  partner-candidate alerts, since Masters (where screening happens) is SA-only. */
  async function resolveSuperAdminUids(): Promise<string[]> {
    const sa = new Set(superAdminUidsFromEnv());
    try {
      const snap = await db.collection("users").where("superAdmin", "==", true).get();
      for (const u of snap.docs) if (u.data().employeeStatus !== "inactive") sa.add(u.id);
    } catch { /* env list is the reliable fallback */ }
    return [...sa];
  }

  /** Bell + email every super admin about a new partner candidate. Fire-and-forget
   *  (never blocks intake); togglable via notification settings key partner_candidates. */
  async function notifyPartnerCandidate(name: string, code: string, mobile: string, source: string): Promise<void> {
    try {
      if (!(await notificationsEnabled("partner_candidates"))) return;
      const uids = await resolveSuperAdminUids();
      for (const uid of uids) {
        await notify(uid, {
          type: "partner_candidate",
          title: `New partner candidate — ${name}`,
          body: `${code} · ${mobile} · via ${source}. Screen them in Masters → Connectors.`,
          link: "/crm/pipeline/masters",
        });
        const e = await userEmail(uid);
        if (e) await sendBrandedEmail(e, `New partner candidate — ${name}`, {
          title: "New partner candidate",
          intro: `${name} has asked to become a Finvastra partner. They are logged as ${code} at the Inquiry stage — run the screening call from the Screening tab.`,
          rows: [
            { label: "Code", value: code },
            { label: "Name", value: name },
            { label: "Mobile", value: mobile },
            { label: "Source", value: source },
          ],
          ctaLabel: "Open Connectors",
          ctaLink: "https://pulse.finvastra.com/crm/pipeline/masters",
        });
      }
    } catch (e) { console.error("[partner candidate notify failed]", e); }
  }

  app.post("/api/public/partner-inquiry", route(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (isStr(b.website)) { res.json({ ok: true }); return; }   // honeypot -> no write
    const trusted = !!process.env.WEBSITE_WEBHOOK_SECRET
      && req.headers["x-finvastra-webhook-secret"] === process.env.WEBSITE_WEBHOOK_SECRET;
    const ip = extractClientIp(req.headers["x-forwarded-for"], req.ip);
    if (!trusted && !(await rateLimit(`partnerpub:${ip}`, 20, 60 * 60 * 1000))) {
      throw new ApiError(429, "Too many submissions — try again later");
    }
    const name = reqStr(b, "name");
    if (name.length < 2 || name.length > 120) throw new ApiError(400, "name must be 2–120 chars");
    const mobile = normaliseMobile(String(b.mobile ?? ""));
    if (!mobile) throw new ApiError(400, "mobile must be a valid 10-digit Indian mobile");
    const email = optStr(b, "email");

    // Lands as a normal PARTNER_DSA LEAD — screened from the Leads page; a CON-
    // code is minted only on the manual move to Masters (promote-partner).
    const dupeKeys = buildDupeKeys(mobile, email);
    const duplicate = await findDuplicate(dupeKeys);
    const id = await db.runTransaction(async (tx) => {
      const counterRef = db.collection("counters").doc(leadYearCounter());
      const seq = (((await tx.get(counterRef)).data()?.seq as number | undefined) ?? 0) + 1;
      const newId = `LD-${new Date().getFullYear()}-${String(seq).padStart(5, "0")}`;
      tx.set(counterRef, { seq, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(db.collection("leads").doc(newId), {
        leadCode: newId,
        name, customerName: name, mobile, email,
        category: "PARTNER_DSA", productId: null,
        source: "WEBSITE", status: "NEW", priority: "HOT",
        receivedAt: FieldValue.serverTimestamp(),
        sourceMeta: {
          formId: optStr(b, "formId") ?? "partner-inquiry",
          sourceUrl: optStr(b, "sourceUrl")?.slice(0, 500) ?? null,
          utm: null, via: trusted ? "apps_script" : "web",
          productInterest: optStr(b, "productInterestStated") ?? optStr(b, "productInterest"),
        },
        assignedRm: null, assignedAt: null,
        amountRequired: null, city: optStr(b, "city"),
        nextFollowUpAt: null, nextFollowUpNote: null, followUpReminderSent: false, attempts: 0,
        activityLog: [],
        converted: false, convertedAt: null,
        linkedClientId: null, linkedCaseId: null, linkedSubDsaId: null, linkedConnectorId: null,
        duplicateOfLeadId: duplicate?.collection === "leads" ? duplicate.id : null,
        dupeKeys,
        firstContactedAt: null,
        ...createAudit("public:partner-form"),
      });
      return newId;
    });
    res.json({ ok: true, id });
  }));

  // ─── Promote a CRM 2.0 lead into the partner funnel ───────────────────────────
  // A telecaller gauging a lead who turns out to be a PARTNER request pushes them
  // into the funnel with one click — details auto-picked from the lead. Screening,
  // scoring and (especially) ACTIVATION stay super-admin-only in Masters →
  // Connectors; this action only logs the candidate.
  app.post("/api/crm2/leads/:id/promote-partner", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.leads.write");
    if (!caller) return;
    const leadRef = db.collection("leads").doc(req.params.id);
    const snap = await leadRef.get();
    if (!snap.exists) throw new ApiError(404, "lead not found");
    const lead = snap.data() as Record<string, unknown>;
    if (lead.converted || lead.linkedConnectorId) {
      throw new ApiError(409, "This lead is already converted / already in the partner funnel");
    }
    // Only Partner Sign-up leads enter the funnel — a loan/wealth/general lead
    // must never be moved. If this really is a partner request, set the lead's
    // Category to "Partner Sign-up" first (drawer Category picker), then move.
    if (lead.category !== "PARTNER_DSA") {
      throw new ApiError(400, "Only Partner Sign-up leads can move to the partner funnel — change the lead's Category to 'Partner Sign-up' first if this is genuinely a partner request");
    }
    const mobile = normaliseMobile(String(lead.mobile ?? "")) || String(lead.mobile ?? "");
    if (!mobile) throw new ApiError(400, "lead has no usable mobile");
    const SRC_TO_PARTNER: Record<string, string> = {
      WEBSITE: "Website Form", WALKIN: "Walk-in",
      REFERRAL_CLIENT: "Referral", REFERRAL_SUBDSA: "Referral",
    };
    const { id, code } = await createPartnerCandidate({
      name: String(lead.customerName ?? lead.name ?? "Partner candidate"),
      mobile, email: (lead.email as string | null) ?? null,
      firmName: (lead.entityName as string | null) ?? null,
      leadSource: SRC_TO_PARTNER[String(lead.source)] ?? "Other",
      productInterestStated: (lead.sourceMeta as Record<string, unknown> | null)?.productInterest,
      createdBy: caller.fapl,
    });
    await leadRef.update({
      converted: true, convertedAt: FieldValue.serverTimestamp(),
      status: "CONVERTED", linkedConnectorId: id, category: "PARTNER_DSA",
      activityLog: FieldValue.arrayUnion({
        at: Timestamp.now(), by: caller.fapl,
        note: `Moved to partner funnel as ${code} (Inquiry)`, action: "convert",
      }),
      ...updateAudit(caller.fapl),
    });
    res.json({ ok: true, connectorId: id, connectorCode: code });
  }));

  // ─── Return a partner candidate to the Leads page ─────────────────────────────
  // Undo for a premature move: re-opens the source lead (or recreates one) and
  // HARD-DELETES the candidate's connector doc so the CON- code is freed (the
  // code minter takes max+1 over remaining docs). Only pre-Active candidates —
  // an Active partner may already be referenced by cases and cannot be returned.
  app.post("/api/crm2/connectors/:id/return-to-lead", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    const ref = db.collection("connectors").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, "connector not found");
    const c = snap.data() as Record<string, unknown>;
    if (!c.funnelStatus) throw new ApiError(400, "This is a legacy connector, not a funnel candidate");
    if (c.funnelStatus === "Active") {
      throw new ApiError(422, "An Active partner cannot be returned to Leads — deactivate instead");
    }

    // Re-open the linked lead, or recreate one for public-form candidates.
    const linked = await db.collection("leads")
      .where("linkedConnectorId", "==", req.params.id).limit(1).get();
    let leadId: string;
    if (!linked.empty) {
      leadId = linked.docs[0].id;
      await linked.docs[0].ref.update({
        converted: false, convertedAt: null, status: "NEW",
        linkedConnectorId: null, category: "PARTNER_DSA",
        activityLog: FieldValue.arrayUnion({
          at: Timestamp.now(), by: caller.fapl,
          note: `Returned from the partner funnel (${c.connectorCode}) — continue screening from Leads`,
          action: "note",
        }),
        ...updateAudit(caller.fapl),
      });
    } else {
      const mobile = String(c.mobile ?? "");
      const email = (c.email as string | null) || null;
      const dupeKeys = buildDupeKeys(mobile || null, email);
      leadId = await db.runTransaction(async (tx) => {
        const counterRef = db.collection("counters").doc(leadYearCounter());
        const seq = (((await tx.get(counterRef)).data()?.seq as number | undefined) ?? 0) + 1;
        const newId = `LD-${new Date().getFullYear()}-${String(seq).padStart(5, "0")}`;
        tx.set(counterRef, { seq, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        tx.set(db.collection("leads").doc(newId), {
          leadCode: newId, name: String(c.displayName ?? "Partner candidate"),
          customerName: String(c.displayName ?? "Partner candidate"),
          mobile, email, category: "PARTNER_DSA", productId: null,
          source: "WEBSITE", status: "NEW", priority: "HOT",
          receivedAt: FieldValue.serverTimestamp(),
          sourceMeta: { formId: "returned-from-funnel", sourceUrl: null, utm: null, via: "internal", productInterest: null },
          assignedRm: null, assignedAt: null, amountRequired: null, city: null,
          nextFollowUpAt: null, nextFollowUpNote: null, followUpReminderSent: false, attempts: 0,
          activityLog: [], converted: false, convertedAt: null,
          linkedClientId: null, linkedCaseId: null, linkedSubDsaId: null, linkedConnectorId: null,
          duplicateOfLeadId: null, dupeKeys, firstContactedAt: null,
          ...createAudit(caller.fapl),
        });
        return newId;
      });
    }

    // Hard-delete the candidate (Admin SDK bypasses the delete:false rule) —
    // private sub-doc first, then the main doc. Frees the CON- code.
    await ref.collection("private").doc("financial").delete().catch(() => {});
    await ref.delete();
    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: "partner_return_to_lead",
      targetPath: `/connectors/${req.params.id}`,
      before: { connectorCode: c.connectorCode, displayName: c.displayName, funnelStatus: c.funnelStatus },
      after: { leadId }, at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, leadId, freedCode: c.connectorCode });
  }));

  // ─── Graduate a Connector → Sub DSA ───────────────────────────────────────────
  // The "start assisted, become independent" path: a Connector (we do the legwork)
  // who has proven they can run cases alone becomes a Sub DSA (they work cases
  // themselves on the code, higher share). One transaction: mints SDSA-###
  // carrying name/contact/KYC/bank/TDS over, and RETIRES the Connector record
  // (status inactive + graduatedToSubDsaId marker — kept for history; past
  // connector_payouts stay on the ledger). Payout slabs on the new Sub DSA start
  // empty — the higher share is negotiated fresh.
  app.post("/api/crm2/connectors/:id/graduate-to-subdsa", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.masters.write");
    if (!caller) return;
    const ref = db.collection("connectors").doc(req.params.id);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new ApiError(404, "connector not found");
      const c = snap.data() as Record<string, unknown>;
      if (c.deleted) throw new ApiError(404, "connector not found");
      if (c.graduatedToSubDsaId) {
        throw new ApiError(409, `Already graduated to ${c.graduatedToSubDsaId}`);
      }
      const finSnap = await tx.get(ref.collection("private").doc("financial"));
      const fin = (finSnap.data() ?? {}) as Record<string, unknown>;

      const subDsaId = await nextIdInTx(tx, "subDsas", "SDSA-", 3);
      const pb = fin.payoutBank as Record<string, unknown> | null;
      tx.set(db.collection("subDsas").doc(subDsaId), {
        name: c.displayName ?? "Partner",
        type: c.entityType === "INDIVIDUAL" || !c.entityType ? "INDIVIDUAL" : "CORPORATE",
        sourceLeadId: null,
        mobile: c.mobile ?? "", email: c.email || null,
        city: "", state: "",
        panEnc: fin.panEnc ?? null, panLast4: fin.panLast4 ?? null,
        gstin: c.gstin ?? null,
        payoutBank: pb && pb.accountNoEnc ? {
          accountNoEnc: pb.accountNoEnc, accountNoLast4: pb.accountNoLast4 ?? null,
          ifsc: pb.ifsc ?? "", bankName: pb.bankName ?? "",
        } : null,
        tdsPct: fin.tdsPct ?? null,
        payoutSlabs: [],
        relationshipOwner: (typeof c.owner === "string" && /^FAPL-/i.test(c.owner)) ? c.owner : caller.fapl,
        onboardingDate: FieldValue.serverTimestamp(),
        status: "ACTIVE",
        graduatedFromConnectorId: req.params.id,
        ...createAudit(caller.fapl),
      });
      tx.update(ref, {
        status: "inactive",
        graduatedToSubDsaId: subDsaId,
        activityLog: FieldValue.arrayUnion({
          at: Timestamp.now(), by: caller.fapl,
          note: `Graduated to Sub DSA ${subDsaId} — now works cases independently (higher share tier)`,
          action: "note",
        }),
        ...updateAudit(caller.fapl),
      });
      return { subDsaId, code: c.connectorCode };
    });

    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: "partner_graduate_subdsa",
      targetPath: `/connectors/${req.params.id}`,
      after: { subDsaId: result.subDsaId }, at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, subDsaId: result.subDsaId });
  }));

  // ═══ Meta Lead Ads → CRM 2.0 lead — Phase 1 (capture + queue) ═════════════════
  //
  // Meta delivers ONLY a leadgen_id; the real answers must be pulled from the Graph
  // API. Flow: verify HMAC over the raw bytes → persist-first to a write-ahead store
  // (meta_lead_events/{leadgen_id}) → ACK fast → async pull + map + upsert a CRM 2.0
  // lead (source ADS, status NEW). A scheduler retry pass reprocesses pending/failed
  // events. Phase 2 (routing + SLA) is OUT OF SCOPE here.
  //
  // SECURITY: the verify token, app secret, and page token are read from env ONLY —
  // never hardcoded or logged. Unsigned / badly-signed POSTs are rejected (403).
  const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "";
  const META_APP_SECRET = process.env.META_APP_SECRET || "";
  const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || "";
  const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
  // Graph API base — overridable so the emulator gate can point it at a local mock
  // (offline/CI). Defaults to the real Graph host in every real environment.
  const META_GRAPH_BASE = (process.env.META_GRAPH_BASE || "https://graph.facebook.com").replace(/\/$/, "");
  const META_MAX_ATTEMPTS = 5;

  type MetaEvt = MetaLeadgenEvent;

  /** Write-ahead: create the event doc (id = leadgen_id) only if absent. Returns
   *  true when newly queued (redelivered webhooks return false → not re-queued). */
  async function persistMetaEvent(evt: MetaEvt): Promise<boolean> {
    const ref = db.collection("meta_lead_events").doc(evt.leadgenId);
    return db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return false;
      tx.set(ref, {
        leadgenId: evt.leadgenId, pageId: evt.pageId, formId: evt.formId,
        adId: evt.adId, createdTime: evt.createdTime,
        status: "pending", attempts: 0, lastError: null, leadId: null, terminal: false,
        receivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
  }

  async function logMetaWebhook(
    result: "success" | "duplicate" | "invalid" | "error",
    leadId: string | null, errorMessage: string | null,
  ): Promise<void> {
    await db.collection("webhook_logs").add({
      source: "social_meta", result, leadId, errorMessage, assignedTo: null,
      receivedAt: FieldValue.serverTimestamp(),
    }).catch((e) => console.error("[meta webhook_log write failed]", e));
  }

  /** A leadgen event has exhausted retries (or is permanently unusable). Surface it
   *  to a human: an error-severity STRUCTURED log (Cloud Logging → alertable) + a
   *  durable doc in `meta_lead_deadletters` an admin view can query. Never logs the
   *  token or full PII (only the leadgen_id + reason). */
  async function deadLetterMeta(leadgenId: string, attempts: number, reason: string): Promise<void> {
    // Structured, error-severity — a log-based alert policy fires on this (see GO-LIVE.md).
    console.error(JSON.stringify({
      severity: "ERROR", event: "meta_lead_deadletter",
      leadgenId, attempts, reason: reason.slice(0, 300),
    }));
    await db.collection("meta_lead_deadletters").doc(leadgenId).set({
      leadgenId, attempts, reason: reason.slice(0, 500),
      resolved: false, deadLetteredAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch((e) => console.error("[meta deadletter write failed]", e));
  }

  /** Pull the full lead (field_data) from the Graph API by leadgen_id. */
  async function fetchMetaLead(leadgenId: string): Promise<{
    fieldData: Array<{ name?: unknown; values?: unknown }>;
    createdTime: string | null; adId: string | null; formId: string | null; campaignId: string | null;
  }> {
    if (!META_PAGE_ACCESS_TOKEN) throw new Error("META_PAGE_ACCESS_TOKEN unset");
    const fields = "field_data,created_time,ad_id,form_id,campaign_id,is_organic";
    // NOTE: never log this URL — it carries the access token.
    const url = `${META_GRAPH_BASE}/${META_GRAPH_VERSION}/${encodeURIComponent(leadgenId)}`
      + `?fields=${fields}&access_token=${encodeURIComponent(META_PAGE_ACCESS_TOKEN)}`;
    const resp = await fetch(url, { method: "GET" });
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      const err = (json?.error as { message?: string } | undefined)?.message || `HTTP ${resp.status}`;
      throw new Error(`Graph fetch failed: ${err}`);
    }
    return {
      fieldData: Array.isArray(json.field_data) ? json.field_data as Array<{ name?: unknown; values?: unknown }> : [],
      createdTime: isStr(json.created_time) ? String(json.created_time) : null,
      adId: isStr(json.ad_id) ? String(json.ad_id) : null,
      formId: isStr(json.form_id) ? String(json.form_id) : null,
      campaignId: isStr(json.campaign_id) ? String(json.campaign_id) : null,
    };
  }

  /** Worker: pull → map → upsert. Idempotent via the event doc state machine. Called
   *  from the webhook (async, post-ACK) and the scheduler retry pass. */
  async function processMetaLeadgen(leadgenId: string): Promise<void> {
    const ref = db.collection("meta_lead_events").doc(leadgenId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const evt = snap.data() as Record<string, unknown>;
    if (evt.status === "done" || evt.terminal === true) return;

    const attempts = ((evt.attempts as number | undefined) ?? 0) + 1;
    await ref.update({ attempts, status: "fetching", updatedAt: FieldValue.serverTimestamp() });

    // 1. Pull the answers from the Graph API. Transient failure → retryable (job re-runs).
    let pulled: Awaited<ReturnType<typeof fetchMetaLead>>;
    try {
      pulled = await fetchMetaLead(leadgenId);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      const terminal = attempts >= META_MAX_ATTEMPTS;
      await ref.update({
        status: "failed", lastError: msg, terminal,
        ...(terminal ? { deadLetter: true } : {}), updatedAt: FieldValue.serverTimestamp(),
      });
      if (terminal) { await deadLetterMeta(leadgenId, attempts, `graph fetch: ${msg}`); await logMetaWebhook("error", null, msg); }
      return;
    }

    // 2. Defensive field mapping + minimal validation.
    const m = mapMetaFields(pulled.fieldData);
    if (!m.name || !m.mobile) {
      // Graph fetch worked but the lead is unusable — retrying won't help → terminal.
      const why = `${!m.name ? "missing name " : ""}${!m.mobile ? "missing/invalid mobile" : ""}`.trim();
      await ref.update({ status: "failed", terminal: true, deadLetter: true, lastError: `invalid lead: ${why}`, updatedAt: FieldValue.serverTimestamp() });
      await deadLetterMeta(leadgenId, attempts, `invalid lead: ${why}`);
      await logMetaWebhook("invalid", null, `leadgen ${leadgenId}: ${why}`);
      return;
    }

    // 3. Soft person-dedup (FLAG, never drop) + atomic lead upsert guarded on the
    //    event doc so redeliveries / retries never create a second lead.
    const dupeKeys = buildDupeKeys(m.mobile, m.email);
    const duplicate = await findDuplicate(dupeKeys);
    const year = new Date().getFullYear();

    const leadId = await db.runTransaction(async (tx) => {
      const e = (await tx.get(ref)).data() as Record<string, unknown> | undefined;
      if (!e) return null;
      if (e.status === "done") return (e.leadId as string | null) ?? null;   // already upserted
      const newId = await nextIdInTx(tx, leadYearCounter(), `LD-${year}-`, 5);
      tx.set(db.collection("leads").doc(newId), {
        receivedAt: FieldValue.serverTimestamp(), leadCode: newId,
        // Deterministic keyword inference of the vertical from the form's product
        // answer (no AI). GENERAL when the Instant Form asked no product question.
        category: m.category ?? "GENERAL", productId: null,
        name: m.name, mobile: m.mobile, email: m.email ?? null, city: m.city ?? null,
        source: "ADS",
        sourceMeta: {
          formId: pulled.formId ?? (e.formId as string | null) ?? null,
          sourceUrl: null,
          utm: pulled.campaignId ? { campaign: pulled.campaignId } : null,
          // The raw product answer (Phase 2 routing keys off this; its absence is a
          // go-live blocker flagged by the inspect helper).
          productInterest: m.productInterest ?? null,
          // Meta provenance (extra keys — schemaless; for traceability/recon).
          leadgenId, adId: pulled.adId ?? (e.adId as string | null) ?? null,
          pageId: (e.pageId as string | null) ?? null,
          campaignId: pulled.campaignId ?? null,
          metaCreatedTime: pulled.createdTime ?? (e.createdTime as string | null) ?? null,
        },
        amountRequired: null,
        referredById: null, referredByType: null, referredByName: null, referredByCode: null,
        channelPartnerId: null, channelPartnerCode: null, channelPartnerName: null,
        linkedExistingClientId: null,
        customerProfile: null,
        assignedRm: null, assignedAt: null,
        status: "NEW", priority: "HOT",   // website / social leads = high (red) priority
        nextFollowUpAt: null, nextFollowUpNote: null, followUpReminderSent: false,
        attempts: 0, activityLog: [], dropReason: null,
        converted: false, convertedAt: null,
        linkedClientId: null, linkedCaseId: null, linkedSubDsaId: null,
        duplicateOfLeadId: duplicate?.collection === "leads" ? duplicate.id : null,
        dupeKeys,
        firstContactedAt: null,   // Stage-2 SLA end — stamped once on first contact
        ...createAudit("webhook:meta"),
      });
      tx.update(ref, {
        status: "done", leadId: newId, lastError: null, terminal: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return newId;
    });

    if (leadId) await logMetaWebhook(duplicate ? "duplicate" : "success", leadId, null);
  }

  // GET — Meta subscription handshake (hub.challenge echo, verify-token gated).
  app.get("/api/webhooks/meta/leadgen", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && META_VERIFY_TOKEN && token === META_VERIFY_TOKEN) {
      res.status(200).send(String(challenge ?? ""));
      return;
    }
    res.sendStatus(403);
  });

  // POST — signed leadgen delivery. Persist-first, ACK fast, process async.
  app.post("/api/webhooks/meta/leadgen", route(async (req, res) => {
    const raw = (req as express.Request & { rawBody?: Buffer }).rawBody;
    if (!META_APP_SECRET) console.error("[meta] META_APP_SECRET unset — rejecting webhook");
    if (!verifyMetaSignature(raw, req.headers["x-hub-signature-256"], META_APP_SECRET)) {
      res.sendStatus(403); return;
    }
    const events = extractLeadgenEvents(req.body);
    // Write-ahead BEFORE the ACK so a crash never loses an event (retry job recovers).
    const fresh: MetaEvt[] = [];
    for (const evt of events) {
      try { if (await persistMetaEvent(evt)) fresh.push(evt); }
      catch (e) { console.error("[meta] persist failed", evt.leadgenId, e); }
    }
    // Meta only needs a 200 — never block it on Graph pulls.
    res.status(200).json({ ok: true, received: events.length, queued: fresh.length });
    // CPU stays allocated (Cloud Run --no-cpu-throttling) so post-response work runs.
    for (const evt of fresh) void processMetaLeadgen(evt.leadgenId).catch((e) => console.error("[meta] process failed", evt.leadgenId, e));
  }));

  // POST — scheduler retry pass: reprocess pending / non-terminal failed events.
  app.post("/api/crm2/jobs/run-meta-retry", route(async (req, res) => {
    const caller = await requireSchedulerOrAdmin(req, res);
    if (!caller) return;
    const snap = await db.collection("meta_lead_events")
      .where("status", "in", ["pending", "failed", "fetching"]).limit(100).get();
    let processed = 0, skipped = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.terminal === true || ((d.attempts as number | undefined) ?? 0) >= META_MAX_ATTEMPTS) { skipped++; continue; }
      await processMetaLeadgen(doc.id).catch((e) => console.error("[meta] retry failed", doc.id, e));
      processed++;
    }
    res.json({ ok: true, scanned: snap.size, processed, skipped });
  }));

  // ═══ WhatsApp Cloud API → Social Media inbox ══════════════════════════════════
  //
  // Mirrors the Meta leadgen engine: verify HMAC over the RAW bytes → persist-first
  // to a write-ahead store (whatsapp_message_events/{waMessageId}) → ACK fast → async
  // resolve the sender phone → a lead (create a minimal one if unknown) → append the
  // message to /leads/{leadId}/whatsapp. Outbound replies go through
  // POST /api/crm2/whatsapp/send (Graph API), free-text only inside the 24h window.
  // Secrets from env ONLY; unsigned / badly-signed POSTs → 403.
  const WA_VERIFY_TOKEN = process.env.META_WHATSAPP_VERIFY_TOKEN || "";
  const WA_APP_SECRET = process.env.META_WHATSAPP_APP_SECRET || "";
  const WA_ACCESS_TOKEN = process.env.META_WHATSAPP_ACCESS_TOKEN || "";
  const WA_PHONE_NUMBER_ID = process.env.META_WHATSAPP_PHONE_NUMBER_ID || "";
  const WA_MAX_ATTEMPTS = 5;

  /** Write-ahead: create the inbound event doc (id = waMessageId) only if absent.
   *  Returns true when newly queued (redelivered webhooks return false). */
  async function persistWaEvent(msg: WhatsAppInbound): Promise<boolean> {
    const ref = db.collection("whatsapp_message_events").doc(msg.waMessageId);
    return db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return false;
      tx.set(ref, {
        waMessageId: msg.waMessageId, from: msg.from, phoneNumberId: msg.phoneNumberId,
        type: msg.type, text: msg.text, mediaId: msg.mediaId,
        contactName: msg.contactName, timestamp: msg.timestamp,
        status: "pending", attempts: 0, lastError: null, leadId: null, terminal: false,
        receivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
  }

  async function deadLetterWa(waMessageId: string, attempts: number, reason: string): Promise<void> {
    console.error(JSON.stringify({
      severity: "ERROR", event: "whatsapp_deadletter", waMessageId, attempts, reason: reason.slice(0, 300),
    }));
    await db.collection("whatsapp_message_deadletters").doc(waMessageId).set({
      waMessageId, attempts, reason: reason.slice(0, 500), resolved: false,
      deadLetteredAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch((e) => console.error("[wa deadletter write failed]", e));
  }

  /** Worker: resolve lead (create a minimal one if unknown) → append the message →
   *  bump the lead's inbox fields. Idempotent via the event doc + the message doc id. */
  async function processWaMessage(waMessageId: string): Promise<void> {
    const ref = db.collection("whatsapp_message_events").doc(waMessageId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const evt = snap.data() as Record<string, unknown>;
    if (evt.status === "done" || evt.terminal === true) return;
    const attempts = ((evt.attempts as number | undefined) ?? 0) + 1;
    await ref.update({ attempts, status: "processing", updatedAt: FieldValue.serverTimestamp() });

    try {
      const mobile = normaliseMobile(String(evt.from ?? ""));
      if (!mobile) {
        await ref.update({ status: "failed", terminal: true, deadLetter: true, lastError: "uninterpretable sender number", updatedAt: FieldValue.serverTimestamp() });
        await deadLetterWa(waMessageId, attempts, "uninterpretable sender number");
        return;
      }
      const text = (evt.text as string | null) ?? (evt.mediaId ? `[${String(evt.type ?? "media")}]` : null);
      const year = new Date().getFullYear();

      // Resolve an existing lead, else mint a minimal CRM 2.0 lead (source WHATSAPP).
      // Lookup + mint run in ONE transaction (tx.get on the phone queries) so two
      // concurrent inbound messages from a NEW number can't both miss the lookup
      // and mint duplicate leads — the lookup and the create are atomic.
      const leadId = await db.runTransaction(async (tx) => {
        const [byMobile, byPhone] = await Promise.all([
          tx.get(db.collection("leads").where("mobile", "==", mobile).limit(5)),
          tx.get(db.collection("leads").where("phone", "==", mobile).limit(5)),
        ]);
        let best: { id: string; t: number } | null = null;
        for (const d of [...byMobile.docs, ...byPhone.docs]) {
          const data = d.data();
          if (data.deleted === true) continue;
          const ts = (data.receivedAt ?? data.createdAt) as { toMillis?: () => number } | undefined;
          best = !best || (ts?.toMillis?.() ?? 0) > best.t ? { id: d.id, t: ts?.toMillis?.() ?? 0 } : best;
        }
        if (best) return best.id;
        {
          const newId = await nextIdInTx(tx, leadYearCounter(), `LD-${year}-`, 5);
          tx.set(db.collection("leads").doc(newId), {
            receivedAt: FieldValue.serverTimestamp(), leadCode: newId,
            category: "GENERAL", productId: null,
            name: (evt.contactName as string | null) || mobile, customerName: (evt.contactName as string | null) ?? null,
            mobile, email: null, city: null,
            source: "WHATSAPP",
            sourceMeta: { formId: null, sourceUrl: null, utm: null, via: "whatsapp" },
            amountRequired: null,
            referredById: null, referredByType: null, referredByName: null, referredByCode: null,
            channelPartnerId: null, channelPartnerCode: null, channelPartnerName: null,
            linkedExistingClientId: null, customerProfile: null,
            assignedRm: null, assignedAt: null,
            status: "NEW", priority: "WARM",
            nextFollowUpAt: null, nextFollowUpNote: null, followUpReminderSent: false,
            attempts: 0, activityLog: [], dropReason: null,
            converted: false, convertedAt: null,
            linkedClientId: null, linkedCaseId: null, linkedSubDsaId: null,
            duplicateOfLeadId: null, dupeKeys: buildDupeKeys(mobile, null),
            firstContactedAt: null,
            waLastInboundAt: FieldValue.serverTimestamp(), waLastMessageAt: FieldValue.serverTimestamp(),
            waLastMessageText: text, waUnread: 0,
            ...createAudit("webhook:whatsapp"),
          });
          return newId;
        }
      });

      // Append the message + bump the lead, guarded on the event doc + message doc id.
      const leadRef = db.collection("leads").doc(leadId);
      const msgRef = leadRef.collection("whatsapp").doc(waMessageId);
      await db.runTransaction(async (tx) => {
        const e = (await tx.get(ref)).data() as Record<string, unknown> | undefined;
        if (!e || e.status === "done") return;
        if (!(await tx.get(msgRef)).exists) {
          tx.set(msgRef, {
            waMessageId, direction: "in", from: mobile, to: "business",
            type: String(evt.type ?? "text"), body: text, mediaId: (evt.mediaId as string | null) ?? null,
            status: "received", by: null, byName: null, error: null,
            at: FieldValue.serverTimestamp(),
          });
        }
        tx.set(leadRef, {
          waLastInboundAt: FieldValue.serverTimestamp(), waLastMessageAt: FieldValue.serverTimestamp(),
          waLastMessageText: text, waUnread: FieldValue.increment(1),
        }, { merge: true });
        tx.update(ref, { status: "done", leadId, lastError: null, updatedAt: FieldValue.serverTimestamp() });
      });
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      const terminal = attempts >= WA_MAX_ATTEMPTS;
      await ref.update({ status: "failed", lastError: msg, terminal, ...(terminal ? { deadLetter: true } : {}), updatedAt: FieldValue.serverTimestamp() });
      if (terminal) await deadLetterWa(waMessageId, attempts, msg);
    }
  }

  // GET — WhatsApp webhook subscription handshake.
  app.get("/api/webhooks/whatsapp", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && WA_VERIFY_TOKEN && token === WA_VERIFY_TOKEN) {
      res.status(200).send(String(challenge ?? "")); return;
    }
    res.sendStatus(403);
  });

  // POST — signed message delivery. Persist-first, ACK fast, process async.
  app.post("/api/webhooks/whatsapp", route(async (req, res) => {
    const raw = (req as express.Request & { rawBody?: Buffer }).rawBody;
    if (!WA_APP_SECRET) console.error("[whatsapp] META_WHATSAPP_APP_SECRET unset — rejecting webhook");
    if (!verifyMetaSignature(raw, req.headers["x-hub-signature-256"], WA_APP_SECRET)) {
      res.sendStatus(403); return;
    }
    const messages = extractWhatsAppMessages(req.body);
    const statuses = extractWhatsAppStatuses(req.body);   // delivery receipts (Phase 2 applies them)
    const fresh: WhatsAppInbound[] = [];
    for (const m of messages) {
      try { if (await persistWaEvent(m)) fresh.push(m); }
      catch (e) { console.error("[whatsapp] persist failed", m.waMessageId, e); }
    }
    res.status(200).json({ ok: true, received: messages.length, queued: fresh.length, statuses: statuses.length });
    for (const m of fresh) void processWaMessage(m.waMessageId).catch((e) => console.error("[whatsapp] process failed", m.waMessageId, e));
  }));

  // POST — outbound reply. Free-text only inside the 24h customer-care window.
  app.post("/api/crm2/whatsapp/send", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.leads.write");
    if (!caller) return;
    const { leadId, text } = (req.body ?? {}) as { leadId?: unknown; text?: unknown };
    if (!isStr(leadId) || !isStr(text)) throw new ApiError(400, "leadId and text are required");
    const body = String(text).trim().slice(0, 4096);
    if (!body) throw new ApiError(400, "empty message");

    const leadRef = db.collection("leads").doc(String(leadId));
    const leadSnap = await leadRef.get();
    if (!leadSnap.exists) throw new ApiError(404, "lead not found");
    const lead = leadSnap.data() as Record<string, unknown>;
    const to = normaliseMobile(String(lead.mobile ?? lead.phone ?? ""));
    if (!to) throw new ApiError(400, "lead has no valid mobile");

    // 24h free-reply window: free text allowed only if the customer messaged in <24h.
    const lastIn = (lead.waLastInboundAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    if (!(lastIn > 0 && Date.now() - lastIn < 24 * 3600 * 1000)) {
      throw new ApiError(409, "Outside the 24-hour reply window — an approved template message is required (coming in Phase 2).");
    }
    if (!WA_ACCESS_TOKEN || !WA_PHONE_NUMBER_ID) throw new ApiError(503, "WhatsApp is not configured (META_WHATSAPP_* env vars unset).");

    const toE164 = to.length === 10 ? `91${to}` : to;
    const url = `${META_GRAPH_BASE}/${META_GRAPH_VERSION}/${encodeURIComponent(WA_PHONE_NUMBER_ID)}/messages`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: toE164, type: "text", text: { preview_url: false, body } }),
    });
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      const err = (json?.error as { message?: string } | undefined)?.message || `HTTP ${resp.status}`;
      throw new ApiError(502, `WhatsApp send failed: ${err}`);
    }
    const waMessageId = ((json.messages as Array<{ id?: string }> | undefined)?.[0]?.id) || `out-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    await leadRef.collection("whatsapp").doc(waMessageId).set({
      waMessageId, direction: "out", from: "business", to,
      type: "text", body, mediaId: null, status: "sent",
      by: caller.fapl, byName: null, error: null, at: FieldValue.serverTimestamp(),
    });
    await leadRef.set({
      waLastMessageAt: FieldValue.serverTimestamp(), waLastMessageText: body, waUnread: 0,
    }, { merge: true });
    res.json({ ok: true, waMessageId });
  }));

  // POST — mark a conversation read (clear the unread counter). Owner/manager/admin.
  app.post("/api/crm2/whatsapp/:leadId/read", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.leads.read");
    if (!caller) return;
    await db.collection("leads").doc(req.params.leadId).set({ waUnread: 0 }, { merge: true });
    res.json({ ok: true });
  }));

  // POST — scheduler retry pass: reprocess pending / non-terminal failed messages.
  app.post("/api/crm2/jobs/run-whatsapp-retry", route(async (req, res) => {
    const caller = await requireSchedulerOrAdmin(req, res);
    if (!caller) return;
    const snap = await db.collection("whatsapp_message_events")
      .where("status", "in", ["pending", "failed", "processing"]).limit(100).get();
    let processed = 0, skipped = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.terminal === true || ((d.attempts as number | undefined) ?? 0) >= WA_MAX_ATTEMPTS) { skipped++; continue; }
      await processWaMessage(doc.id).catch((e) => console.error("[whatsapp] retry failed", doc.id, e));
      processed++;
    }
    res.json({ ok: true, scanned: snap.size, processed, skipped });
  }));

  // ═══ Two-stage lead SLA — sweep job (measure + alert; NOTIFY-ONLY) ════════════
  // Stage 1 = time-to-assign (capture → manager assigns). Stage 2 = time-to-first-
  // contact (anchor → telecaller logs a first attempt). Working-time clocks across
  // BOTH lead models. Windows from app_config/sla, business hours from
  // app_config/business_hours (defaults if absent). No auto-reassign.

  async function loadSlaConfig(): Promise<SlaConfig> {
    const snap = await db.collection("app_config").doc("sla").get();
    return slaConfigFromDoc(snap.exists ? (snap.data() as Record<string, unknown>) : null);
  }
  async function loadBusinessHours(): Promise<BusinessHoursConfig> {
    const snap = await db.collection("app_config").doc("business_hours").get();
    const d = snap.exists ? (snap.data() as Partial<BusinessHoursConfig>) : null;
    if (!d) return DEFAULT_BUSINESS_HOURS;
    const D = DEFAULT_BUSINESS_HOURS;
    return {
      tzOffsetMinutes: typeof d.tzOffsetMinutes === "number" ? d.tzOffsetMinutes : D.tzOffsetMinutes,
      startMinutes: typeof d.startMinutes === "number" ? d.startMinutes : D.startMinutes,
      endMinutes: typeof d.endMinutes === "number" ? d.endMinutes : D.endMinutes,
      workingDows: Array.isArray(d.workingDows) ? (d.workingDows as number[]) : D.workingDows,
      offSaturdayOrdinals: Array.isArray(d.offSaturdayOrdinals) ? (d.offSaturdayOrdinals as number[]) : D.offSaturdayOrdinals,
    };
  }

  const leadName = (d: Record<string, unknown>) => String(d.name ?? d.displayName ?? "Lead");
  const leadLink = (id: string, d: Record<string, unknown>) =>
    d.receivedAt != null ? "/crm/pipeline/leads" : `/crm/leads/${id}`;

  async function ownerUidForLead(d: Record<string, unknown>): Promise<string | null> {
    if (d.receivedAt != null) return isStr(d.assignedRm) ? await faplToUid(String(d.assignedRm)) : null;
    const po = d.primaryOwnerId;
    return isStr(po) && po !== "UNASSIGNED" ? String(po) : null;
  }
  async function managerUidForOwner(ownerUid: string | null): Promise<string | null> {
    if (!ownerUid) return null;
    const m = (await db.collection("users").doc(ownerUid).get()).data()?.reportingManagerUid;
    return isStr(m) ? String(m) : null;
  }
  async function userEmail(uid: string): Promise<string | null> {
    // Hard timeout so a slow/unreachable auth lookup can never stall the sweep.
    try {
      const got = await Promise.race([
        admin.auth().getUser(uid).then((u) => u.email ?? null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      return got;
    } catch { return null; }
  }
  const superAdminUidsFromEnv = (): string[] =>
    (process.env.SUPER_ADMIN_UIDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  // Stage-1 / queue-backlog alert recipients — resolved LIVE, never hardcoded:
  // active CRM managers (crmRole === 'manager'); super admins as the fallback when
  // no manager exists (and they remain the overview/report overseers via admin access).
  async function resolveEscalationUids(): Promise<string[]> {
    const snap = await db.collection("users").where("crmRole", "==", "manager").get();
    const managers = snap.docs.filter((u) => u.data().employeeStatus !== "inactive").map((u) => u.id);
    if (managers.length) return managers;
    const sa = new Set(superAdminUidsFromEnv());
    try {
      const saSnap = await db.collection("users").where("superAdmin", "==", true).get();
      for (const u of saSnap.docs) if (u.data().employeeStatus !== "inactive") sa.add(u.id);
    } catch { /* superAdmin field/index may be absent — env list is the reliable fallback */ }
    return [...sa];
  }
  // Once-per-breach dedup marker (belt; the per-lead breach stamp is the primary guard).
  async function claimSlaAlert(leadId: string, stage: 1 | 2): Promise<boolean> {
    try {
      await db.collection("crm2_reminder_logs").doc(`sla${stage}_${leadId}`)
        .create({ leadId, stage, at: FieldValue.serverTimestamp() });
      return true;
    } catch { return false; }
  }
  async function deliverSla(
    uids: string[], notif: { title: string; body: string; link: string },
    email: { subject: string; title: string; intro: string; rows: Array<{ label: string; value: string }>; note?: string; ctaLink: string },
  ): Promise<void> {
    for (const uid of [...new Set(uids)]) {
      await notify(uid, { type: "sla_breach", ...notif });
      const e = await userEmail(uid);
      if (e) await sendBrandedEmail(e, email.subject, {
        title: email.title, intro: email.intro, rows: email.rows, note: email.note,
        ctaLabel: "Open lead", ctaLink: `https://pulse.finvastra.com${email.ctaLink}`,
      });
    }
  }

  app.post("/api/crm2/jobs/run-lead-sla-sweep", route(async (req, res) => {
    const caller = await requireSchedulerOrAdmin(req, res);
    if (!caller) return;
    if (!(await notificationsEnabled("lead_sla_sweep"))) { res.json({ ok: true, skipped: "notifications_disabled" }); return; }
    const cfg = await loadSlaConfig();
    const bh = await loadBusinessHours();
    const nowMs = Date.now();

    // Uncontacted candidates from both (disjoint) schemas: CRM2 has `converted`,
    // old-model has `deleted`. firstContactedAt==null ⇒ no first contact yet.
    const [crm2Snap, oldSnap] = await Promise.all([
      db.collection("leads").where("firstContactedAt", "==", null).where("converted", "==", false).limit(500).get(),
      db.collection("leads").where("firstContactedAt", "==", null).where("deleted", "==", false).limit(500).get(),
    ]);
    const seen = new Set<string>();
    const docs = [...crm2Snap.docs, ...oldSnap.docs].filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));

    let scanned = 0, backfilled = 0, stage1Alerts = 0, stage2Alerts = 0;
    for (const d of docs) {
      scanned++;
      const data = d.data() as Record<string, unknown>;

      // Old-model authoritative backfill: a contact may exist as an activity doc
      // without the stamp (client stamp missed / legacy). Stamp from the earliest.
      if (data.receivedAt == null && data.firstContactedAt == null) {
        const act = await d.ref.collection("activities").orderBy("at", "asc").limit(1).get();
        if (!act.empty) {
          await d.ref.update({ firstContactedAt: act.docs[0].get("at") ?? FieldValue.serverTimestamp() });
          backfilled++;
          continue;   // contacted — no Stage-2 breach
        }
      }

      const ev = evaluateSla(data, nowMs, cfg, bh);

      // Stage 1 — unassigned past window → alert manager / duty admin (no owner yet).
      if (ev.stage1.breached && data.slaStage1BreachedAt == null && await claimSlaAlert(d.id, 1)) {
        await d.ref.update({ slaStage1BreachedAt: FieldValue.serverTimestamp() });
        const mins = Math.round(ev.stage1.elapsedMs / 60000);
        const name = leadName(data), link = leadLink(d.id, data);
        const targets = await resolveEscalationUids();
        await deliverSla(targets,
          { title: `Unassigned lead past SLA — ${name}`, body: `${ev.tier} lead unassigned ${mins} working-min. Assign now.`, link },
          { subject: `Lead SLA — assign ${name}`, title: "Lead waiting for assignment",
            intro: `${name} (${ev.tier}) is unassigned past the time-to-assign SLA.`,
            rows: [{ label: "Working time unassigned", value: `${mins} min` }, { label: "Tier", value: ev.tier }],
            note: "Assign it to a telecaller from the queue.", ctaLink: link });
        stage1Alerts++;
        await logSla(d.id, "stage1", `${ev.tier} unassigned ${mins}m`);
      }

      // Stage 2 — no first contact past window → owner + manager, with attribution.
      if (ev.stage2.breached && data.slaStage2BreachedAt == null && await claimSlaAlert(d.id, 2)) {
        await d.ref.update({ slaStage2BreachedAt: FieldValue.serverTimestamp() });
        const mins = Math.round(ev.stage2.elapsedMs / 60000);
        const name = leadName(data), link = leadLink(d.id, data);
        const attribution = ev.lateAssignment
          ? "Assignment was late — queue/manager to expedite." : "Assignment was timely — telecaller to make contact.";
        const ownerUid = await ownerUidForLead(data);
        const mgrUid = await managerUidForOwner(ownerUid);
        let targets = [ownerUid, mgrUid].filter((x): x is string => !!x);
        if (!targets.length) targets = await resolveEscalationUids();
        await deliverSla(targets,
          { title: `No first contact — ${name}`, body: `${mins} working-min, no contact attempt. ${attribution}`, link },
          { subject: `Lead SLA — contact ${name}`, title: "Lead awaiting first contact",
            intro: `${name} (${ev.tier}) has had no contact attempt past the time-to-first-contact SLA.`,
            rows: [{ label: "Working time since due", value: `${mins} min` }, { label: "Tier", value: ev.tier },
                   { label: "Attribution", value: ev.lateAssignment ? "Late assignment" : "Timely assignment" }],
            note: attribution, ctaLink: link });
        stage2Alerts++;
        await logSla(d.id, "stage2", `${ev.tier} no-contact ${mins}m ${ev.lateAssignment ? "late-assign" : "on-time"}`);
      }
    }
    res.json({ ok: true, scanned, backfilled, stage1Alerts, stage2Alerts });
  }));

  // Audit row (webhook_logs-style) for an SLA breach alert.
  async function logSla(leadId: string, stage: string, detail: string): Promise<void> {
    await db.collection("webhook_logs").add({
      source: "sla_sweep", result: stage, leadId, errorMessage: detail, assignedTo: null,
      receivedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
  }

  // ═══ FIFO pull-queue work model ═══════════════════════════════════════════════
  // Warm-inbound CRM 2.0 leads (ADS + website) sit unassigned, oldest-first. A free
  // telecaller pulls the FRONT of the line (serve-don't-browse); the claim stamps
  // owner + assignedAt in a TRANSACTION so two concurrent claims never grab the same
  // lead. Sits on top of the SLA engine — Stage 1 now measures time-in-queue.

  async function loadQueues(): Promise<QueueDef[]> {
    const snap = await db.collection("app_config").doc("queues").get();
    return queueConfigFromDoc(snap.exists ? (snap.data() as Record<string, unknown>) : null);
  }
  async function callerQueueSkills(uid: string): Promise<string[]> {
    const u = (await db.collection("users").doc(uid).get()).data();
    const s = u?.queueSkills;
    return Array.isArray(s) ? (s as unknown[]).filter((x) => isStr(x)).map(String) : [];
  }
  const CRM2_TERMINAL_STATUS = new Set(["NOT_INTERESTED", "NOT_ELIGIBLE", "JUNK_DUPLICATE", "DROPPED", "CONVERTED"]);
  // An unassigned, non-terminal, warm-inbound CRM 2.0 lead waiting in the queue.
  function isWaiting(d: Record<string, unknown>): boolean {
    return d.assignedRm == null && d.converted !== true
      && !CRM2_TERMINAL_STATUS.has(String(d.status ?? "")) && isQueueableLead(d);
  }

  // POST /api/crm2/queue/claim — pull the oldest eligible waiting lead (FIFO by
  // receivedAt) and claim it atomically. Assigns to the CALLER (self-serve).
  app.post("/api/crm2/queue/claim", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.leads.write");
    if (!caller) return;
    const [queues, skills] = await Promise.all([loadQueues(), callerQueueSkills(caller.uid)]);
    if (eligibleQueues(queues, skills).length === 0) { res.json({ ok: true, lead: null, reason: "no eligible queues" }); return; }

    // Oldest unassigned CRM 2.0 leads first; filter to eligible + waiting in memory.
    const snap = await db.collection("leads")
      .where("assignedRm", "==", null).where("converted", "==", false)
      .orderBy("receivedAt", "asc").limit(50).get();

    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (!isWaiting(d) || !leadEligibleForSkills(queues, skills, d)) continue;
      // Atomic claim: only succeeds if still unassigned (loser falls through to next).
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        const fd = fresh.data();
        if (!fd || fd.assignedRm != null) return false;
        tx.update(doc.ref, {
          assignedRm: caller.fapl, assignedAt: FieldValue.serverTimestamp(),
          status: "ASSIGNED", queueClaimedAt: FieldValue.serverTimestamp(),
          ...updateAudit(caller.fapl),
        });
        return true;
      });
      if (claimed) { res.json({ ok: true, lead: { id: doc.id, ...(await doc.ref.get()).data() } }); return; }
    }
    res.json({ ok: true, lead: null, reason: "queue empty" });
  }));

  // POST /api/crm2/queue/release — return a claimed lead to the queue. Preserves
  // receivedAt (captureAt) so an aging lead keeps its place; bumps releaseCount;
  // flags for the manager at >= 3.
  app.post("/api/crm2/queue/release", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.leads.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const leadId = reqStr(b, "leadId");
    const reason = optStr(b, "reason");
    const ref = db.collection("leads").doc(leadId);
    const meta = await getCallerMeta(caller.uid);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new ApiError(404, `${leadId} not found`);
      const d = snap.data() as Record<string, unknown>;
      // Owner (current assignee) or a manager/admin may release.
      if (!(meta.isAdmin || meta.isManager || d.assignedRm === caller.fapl)) {
        throw new ApiError(403, "Only the lead's owner or a manager can release it");
      }
      if (d.assignedRm == null) throw new ApiError(400, "Lead is already in the queue");
      const releaseCount = ((d.releaseCount as number | undefined) ?? 0) + 1;
      tx.update(ref, {
        assignedRm: null, assignedAt: null, status: "QUEUED",   // receivedAt UNCHANGED → keeps its place
        releaseCount, lastReleaseReason: reason ?? null,
        ...(releaseCount >= 3 ? { queueFlagged: true } : {}),
        ...updateAudit(caller.fapl),
      });
      return { releaseCount, flagged: releaseCount >= 3, name: leadName(d) };
    });

    if (result.flagged) {
      // Flag the manager: the lead has bounced too many times.
      const targets = await resolveEscalationUids();
      for (const uid of targets) {
        await notify(uid, {
          type: "queue_flag", title: `Lead released ${result.releaseCount}×: ${result.name}`,
          body: `Bounced back to the queue ${result.releaseCount} times — needs manager attention.`,
          link: "/crm/pipeline/leads",
        });
      }
    }
    res.json({ ok: true, releaseCount: result.releaseCount, flagged: result.flagged });
  }));

  // GET /api/crm2/queue/state — per-queue depth, oldest-lead age, SLA countdown, and
  // active telecallers (claimed-but-uncontacted). For ~10s client polling.
  app.get("/api/crm2/queue/state", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.leads.read");
    if (!caller) return;
    const [queues, cfg, bh] = await Promise.all([loadQueues(), loadSlaConfig(), loadBusinessHours()]);
    const nowMs = Date.now();

    // All waiting (unassigned) warm leads, oldest first → bucket by queue.
    const waitingSnap = await db.collection("leads")
      .where("assignedRm", "==", null).where("converted", "==", false)
      .orderBy("receivedAt", "asc").limit(500).get();
    const waiting = waitingSnap.docs.map((d) => ({ id: d.id, d: d.data() as Record<string, unknown> }))
      .filter((x) => isWaiting(x.d));

    const queueState = queues.map((q) => {
      const inQ = waiting.filter((x) => queueForLead(queues, x.d)?.id === q.id);
      const oldest = inQ[0];
      let oldestAgeMs = 0, oldestWallMs = 0, slaCountdownMs: number | null = null;
      if (oldest) {
        const capMs = toMs(oldest.d.receivedAt);
        if (capMs != null) {
          oldestWallMs = nowMs - capMs;
          oldestAgeMs = elapsedWorkingMs(capMs, nowMs, bh);
          slaCountdownMs = cfg.WARM.stage1Ms - oldestAgeMs;   // <0 = breached
        }
      }
      return { id: q.id, name: q.name, depth: inQ.length, oldestLeadId: oldest?.id ?? null,
        oldestWorkingAgeMs: oldestAgeMs, oldestWallAgeMs: oldestWallMs, slaCountdownMs };
    });

    // Active telecallers: assigned + not yet contacted (claimed, working).
    const activeSnap = await db.collection("leads")
      .where("firstContactedAt", "==", null).where("converted", "==", false)
      .limit(500).get();
    const byRm = new Map<string, number>();
    for (const doc of activeSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (d.assignedRm != null && isQueueableLead(d) && !CRM2_TERMINAL_STATUS.has(String(d.status ?? ""))) {
        const rm = String(d.assignedRm);
        byRm.set(rm, (byRm.get(rm) ?? 0) + 1);
      }
    }
    const activeTelecallers = [...byRm.entries()].map(([fapl, openClaims]) => ({ fapl, openClaims }));

    res.json({ ok: true, queues: queueState, totalWaiting: waiting.length, activeTelecallers });
  }));

  // GET — admin inspect a leadgen event + the lead it produced (go-live verification).
  // Prints the event state machine + every mapped lead field, and ASSERTS product
  // interest is present (its absence ⇒ the Instant Form is missing the product
  // question, which Phase 2 routing depends on).
  app.get("/api/crm2/admin/meta-event/:leadgenId", route(async (req, res) => {
    const decoded = await decodeToken(req);
    if (!decoded) { res.status(401).json({ error: "Unauthorized" }); return; }
    const isAdmin = decoded.role === "admin"
      || (await db.collection("users").doc(decoded.uid).get()).data()?.role === "admin";
    if (!isAdmin) { res.status(403).json({ error: "Admin only" }); return; }

    const leadgenId = req.params.leadgenId;
    const evtSnap = await db.collection("meta_lead_events").doc(leadgenId).get();
    if (!evtSnap.exists) { res.status(404).json({ error: `No meta_lead_events doc for ${leadgenId}` }); return; }
    const evt = evtSnap.data() as Record<string, unknown>;
    const dlSnap = await db.collection("meta_lead_deadletters").doc(leadgenId).get();

    let lead: Record<string, unknown> | null = null;
    if (isStr(evt.leadId)) {
      const leadSnap = await db.collection("leads").doc(String(evt.leadId)).get();
      lead = leadSnap.exists ? (leadSnap.data() as Record<string, unknown>) : null;
    }

    const sourceMeta = (lead?.sourceMeta ?? null) as Record<string, unknown> | null;
    const productInterest = (sourceMeta?.productInterest as string | null) ?? null;
    const category = (lead?.category as string | null) ?? null;
    const productInterestPresent = !!productInterest || (category != null && category !== "GENERAL");

    res.json({
      leadgenId,
      event: {
        status: evt.status ?? null, attempts: evt.attempts ?? 0,
        terminal: evt.terminal ?? false, deadLetter: evt.deadLetter ?? false,
        lastError: evt.lastError ?? null, leadId: evt.leadId ?? null,
      },
      deadLetter: dlSnap.exists ? dlSnap.data() : null,
      lead: lead && {
        id: evt.leadId, name: lead.name, mobile: lead.mobile, email: lead.email,
        city: lead.city, source: lead.source, status: lead.status,
        category, productInterest, sourceMeta, duplicateOfLeadId: lead.duplicateOfLeadId ?? null,
      },
      productInterestPresent,
      productInterestMessage: productInterestPresent
        ? "OK — product interest captured; Phase 2 routing has a signal."
        : "BLOCKER — landed lead has NO product/interest field. Add a product question to "
          + "the Meta Instant Form (e.g. 'Which product?' → Loan/LAP/SIP/Insurance); Phase 2 routing depends on it.",
    });
  }));

  // GET — admin inspect a lead's SLA + pull-queue timeline (go-live verification).
  // Read-only; prints captureAt / assignedAt / firstContactedAt / breach stamps /
  // queue state so the smoke test can watch a lead move through the lifecycle.
  app.get("/api/crm2/admin/lead/:id", route(async (req, res) => {
    const decoded = await decodeToken(req);
    if (!decoded) { res.status(401).json({ error: "Unauthorized" }); return; }
    const isAdmin = decoded.role === "admin"
      || (await db.collection("users").doc(decoded.uid).get()).data()?.role === "admin";
    if (!isAdmin) { res.status(403).json({ error: "Admin only" }); return; }

    const snap = await db.collection("leads").doc(req.params.id).get();
    if (!snap.exists) { res.status(404).json({ error: `No lead ${req.params.id}` }); return; }
    const d = snap.data() as Record<string, unknown>;
    const iso = (v: unknown) => { const m = toMs(v); return m == null ? null : new Date(m).toISOString(); };
    const captureMs = toMs(d.receivedAt) ?? toMs(d.createdAt);
    const model = d.receivedAt != null ? "CRM2" : "OLD";

    res.json({
      id: req.params.id, model,
      name: d.name ?? d.displayName ?? null,
      source: d.source ?? null, category: d.category ?? null,
      productInterest: (d.sourceMeta as { productInterest?: string } | undefined)?.productInterest ?? null,
      status: d.status ?? d.leadStatus ?? null,
      assignedRm: d.assignedRm ?? d.primaryOwnerId ?? null,
      converted: d.converted ?? false,
      queue: {
        releaseCount: d.releaseCount ?? 0, queueFlagged: d.queueFlagged ?? false,
        lastReleaseReason: d.lastReleaseReason ?? null,
      },
      sla: {
        captureAt: captureMs == null ? null : new Date(captureMs).toISOString(),
        assignedAt: iso(d.assignedAt) ?? iso(d.assignedToCurrentOwnerAt),
        firstContactedAt: iso(d.firstContactedAt),
        stage1BreachedAt: iso(d.slaStage1BreachedAt),
        stage2BreachedAt: iso(d.slaStage2BreachedAt),
      },
    });
  }));

  // ─── Internal lead create ─────────────────────────────────────────────────────
  // Optional "bigger client details" captured on a lead (Phase 3). Returns null
  // when nothing meaningful was provided.
  function sanitizeCustomerProfile(v: unknown): Record<string, unknown> | null {
    if (!v || typeof v !== "object") return null;
    const p = v as Record<string, unknown>;
    const turnoverRaw = p.annualTurnover;
    const annualTurnover = turnoverRaw === undefined || turnoverRaw === null || turnoverRaw === ""
      ? null : (isNaN(Number(turnoverRaw)) ? null : Number(turnoverRaw));
    const out = {
      constitution: isStr(p.constitution) ? String(p.constitution).trim() : null,
      businessName: isStr(p.businessName) ? String(p.businessName).trim() : null,
      annualTurnover,
      requirements: isStr(p.requirements) ? String(p.requirements).trim() : null,
    };
    if (!out.constitution && !out.businessName && out.annualTurnover === null && !out.requirements) return null;
    return out;
  }
  const refType = (v: unknown) => (v === "SUBDSA" || v === "CLIENT" ? v : null);

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
        receivedAt: FieldValue.serverTimestamp(), leadCode: newId,
        category,
        productId: optStr(b, "productId"),
        name, customerName: optStr(b, "customerName") ?? name, mobile, email: email ?? null,
        city: optStr(b, "city"),
        source,
        sourceMeta: { formId: null, sourceUrl: null, utm: null },
        amountRequired: optNum(b, "amountRequired"),
        referredById: optStr(b, "referredById"),
        referredByType: refType(b.referredByType),
        referredByName: optStr(b, "referredByName"),
        referredByCode: optStr(b, "referredByCode"),
        channelPartnerId: optStr(b, "channelPartnerId"),
        channelPartnerCode: optStr(b, "channelPartnerCode"),
        channelPartnerName: optStr(b, "channelPartnerName"),
        linkedExistingClientId: optStr(b, "linkedExistingClientId"),
        customerProfile: sanitizeCustomerProfile(b.customerProfile),
        assignedRm, assignedAt: assignedRm ? FieldValue.serverTimestamp() : null,
        status: "NEW",
        priority: ["HOT", "WARM", "COLD"].includes(String(b.priority)) ? b.priority : "WARM",
        nextFollowUpAt: optTs(b, "nextFollowUpAt"), nextFollowUpNote: optStr(b, "nextFollowUpNote"),
        followUpReminderSent: false, attempts: 0,
        activityLog: [], dropReason: null,
        converted: false, convertedAt: null,
        linkedClientId: null, linkedCaseId: null, linkedSubDsaId: null,
        duplicateOfLeadId: duplicate?.collection === "leads" ? duplicate.id : null,
        dupeKeys,
        firstContactedAt: null,   // Stage-2 SLA end — stamped once on first contact
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
      const newAssignedRm = optStr(b, "assignedRm");
      // Ownership changes are a MANAGER action — a crm.leads.write holder must not
      // self-assign (or re-route) leads via PATCH, bypassing the FIFO queue and
      // manager control. The queue claim/release endpoints are the telecaller path.
      if ((newAssignedRm ?? null) !== ((cur.assignedRm as string | null) ?? null)) {
        const meta = await getCallerMeta(caller.uid);
        if (!meta.isManager) {
          throw new ApiError(403, "Only a manager or admin can change a lead's assigned RM — use the queue's Get-next-lead to claim, or ask a manager to reassign");
        }
      }
      fields.assignedRm = newAssignedRm;
      if (fields.assignedRm && fields.assignedRm !== cur.assignedRm) fields.assignedAt = FieldValue.serverTimestamp();
    }
    if (b.nextFollowUpAt !== undefined) {
      fields.nextFollowUpAt = optTs(b, "nextFollowUpAt");
      fields.followUpReminderSent = false;            // re-arm the email reminder
    }
    if (b.nextFollowUpNote !== undefined) fields.nextFollowUpNote = optStr(b, "nextFollowUpNote");
    if (b.creditScore !== undefined) {
      // CIBIL confirmation for NOT_ELIGIBLE — 300-900 (null clears it).
      const cs = optNum(b, "creditScore");
      if (cs !== null && (cs < 300 || cs > 900)) throw new ApiError(400, "creditScore must be between 300 and 900");
      fields.creditScore = cs;
    }
    if (b.notEligibleReason !== undefined) {
      fields.notEligibleReason = (optStr(b, "notEligibleReason") ?? "").slice(0, 500) || null;
    }
    if (b.linkedExistingClientId !== undefined) fields.linkedExistingClientId = optStr(b, "linkedExistingClientId");
    if (b.customerProfile !== undefined) fields.customerProfile = sanitizeCustomerProfile(b.customerProfile);
    if (b.referredById !== undefined) fields.referredById = optStr(b, "referredById");
    if (b.referredByType !== undefined) fields.referredByType = refType(b.referredByType);
    if (b.referredByName !== undefined) fields.referredByName = optStr(b, "referredByName");
    if (b.referredByCode !== undefined) fields.referredByCode = optStr(b, "referredByCode");
    if (b.channelPartnerId !== undefined) fields.channelPartnerId = optStr(b, "channelPartnerId");
    if (b.channelPartnerCode !== undefined) fields.channelPartnerCode = optStr(b, "channelPartnerCode");
    if (b.channelPartnerName !== undefined) fields.channelPartnerName = optStr(b, "channelPartnerName");
    if (b.productId !== undefined) fields.productId = optStr(b, "productId");
    if (b.category !== undefined) fields.category = reqEnum(b, "category", LEAD_CATEGORIES);
    if (b.amountRequired !== undefined) fields.amountRequired = optNum(b, "amountRequired");
    if (b.city !== undefined) fields.city = optStr(b, "city");
    if (b.dropReason !== undefined) {
      fields.dropReason = b.dropReason === null ? null : reqEnum(b, "dropReason", DROP_REASONS);
    }
    if (b.name !== undefined) fields.name = reqStr(b, "name");
    if (b.customerName !== undefined) fields.customerName = optStr(b, "customerName");
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
    // First-contact stamp (Stage-2 SLA end) — set ONCE, on the first ATTEMPT:
    // status→ATTEMPTED/CONTACTED, an attempts bump, or a logged activity. Never overwritten.
    const contactTrigger =
      fields.status === "ATTEMPTED" || fields.status === "CONTACTED"
      || b.incrementAttempts === true
      || !!(activity && isStr(activity.note));
    if (contactTrigger && cur.firstContactedAt == null) {
      fields.firstContactedAt = FieldValue.serverTimestamp();
    }
    if (Object.keys(fields).length === 0) throw new ApiError(400, "No editable fields in payload");
    await ref.update({ ...fields, ...updateAudit(caller.fapl) });

    // Bell the new RM when a manager (re)assigns a lead, so the handover is
    // visible immediately (their Tasks → To-Do tab also lists the lead).
    const newRm = fields.assignedRm as string | null | undefined;
    if (typeof newRm === "string" && newRm && newRm !== cur.assignedRm && newRm !== caller.fapl) {
      const rmUid = await faplToUid(newRm);
      if (rmUid) {
        await notify(rmUid, {
          type: "new_lead",
          title: "Lead assigned to you",
          body: `${(cur.name as string) ?? "A lead"} — open Tasks to action it`,
          link: "/crm/tasks",
        });
      }
    }
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
    // NEW client from the convert wizard (§4.1 template). Validated outside the tx
    // so a bad payload fails fast. Short-circuits the dedupe/create-from-lead path.
    const newClientRaw = (b.newClient ?? null) as Record<string, unknown> | null;
    const newClientFields = newClientRaw ? sanitizeClient(newClientRaw, true) : null;

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
      } else if (!newClientFields) {
        // Dedupe-match only on the legacy create-from-lead path; an explicit
        // newClient always mints a fresh client.
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
        clientId = `FCL-${year}-${String(clientSeq).padStart(5, "0")}`;
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
        const clientDoc = newClientFields
          ? {
              // NEW client from the wizard — §4.1 template, RM-owned, lead-linked.
              ...newClientFields,
              ownerRm: handlingRm, sourceLeadId: leadRef.id,
              sourcedById: (newClientFields.sourcedById as string | null) ?? subDsaId,
              ...createAudit(caller.fapl),
            }
          : {
              // Legacy create-from-lead — minimal client from the lead contact.
              constitution: ["INDIVIDUAL", "PROPRIETORSHIP", "PARTNERSHIP", "LLP", "PVT_LTD", "HUF"].includes(String(b.constitution))
                ? b.constitution : "INDIVIDUAL",
              name: lead.name, industry: optStr(b, "industry"),
              panEnc: null, panLast4: null,
              gstin: null, udyam: null, cin: null, incorporationDate: null,
              regAddress: emptyAddress, commAddress: emptyAddress,
              primaryContact: { name: (lead.customerName as string | null) ?? lead.name, mobile: lead.mobile ?? "", email: lead.email ?? null },
              latestCibil: null, existingRelationships: [],
              sourceLeadId: leadRef.id, sourcedById: subDsaId,
              ownerRm: handlingRm, kycStatus: "PENDING", status: "ACTIVE",
              dupeKeys: (lead.dupeKeys as string[] | undefined) ?? buildDupeKeys(lead.mobile, lead.email),
              ...createAudit(caller.fapl),
            };
        tx.set(db.collection("clients").doc(clientId), clientDoc);
      }

      tx.set(caseRef, {
        clientId, leadId: leadRef.id, productId, subProduct: null,
        handlingRm, subDsaId,
        // Carry the sourcing Sub DSA (FAC-) from the lead → case (attribution).
        channelPartnerId: (lead.channelPartnerId as string | null) ?? null,
        channelPartnerCode: (lead.channelPartnerCode as string | null) ?? null,
        channelPartnerName: (lead.channelPartnerName as string | null) ?? null,
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
        docsCompletePct: 0, nextAction: null, remarks: null, stage1: null,
        eligibility: null, docsFolderUrl: null,
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

  // ─── Promote a Customer (old-CRM lead) → CRM 2.0 Lead (in place) ──────────────
  // Phase 3 funnel spine. The SAME `/leads/{id}` doc is stamped with new-model
  // fields (receivedAt is the discriminator) — one record, no duplicate, keeps its
  // id. Old fields are left intact (additive); the doc just leaves the Customers
  // list and appears in Pipeline Leads. Idempotent: a doc already carrying
  // receivedAt is rejected (409).
  const OLD_TO_NEW_SOURCE: Record<string, typeof LEAD_SOURCES[number]> = {
    website: "WEBSITE", instagram: "ADS", facebook: "ADS", social_meta: "ADS",
    walkin: "WALKIN", referral: "REFERRAL_CLIENT", employee_referral: "REFERRAL_CLIENT",
    sub_dsa: "REFERRAL_SUBDSA", broker: "REFERRAL_SUBDSA", offline_bulk: "COLD_CALL",
  };
  const TRIAGE_TO_PRIORITY: Record<string, "HOT" | "WARM" | "COLD"> = {
    high: "HOT", medium: "WARM", low: "COLD",
  };

  app.post("/api/crm2/leads/:id/promote", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.leads.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const category = reqEnum(b, "category", LEAD_CATEGORIES);
    const productId = optStr(b, "productId");
    const ref = db.collection("leads").doc(req.params.id);

    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, `${req.params.id} not found`);
    const old = snap.data()!;
    if (old.receivedAt) throw new ApiError(409, "This record is already a CRM 2.0 lead");
    if (old.deleted === true) throw new ApiError(400, "Cannot promote a deleted customer");

    const mobile = normaliseMobile(String(old.phone ?? old.mobile ?? ""));
    if (!mobile) throw new ApiError(400, "Customer has no valid 10-digit mobile to promote");
    const email = optStr(old as Record<string, unknown>, "email");
    const name = isStr(old.displayName) ? String(old.displayName).trim()
      : isStr(old.name) ? String(old.name).trim() : "Customer";

    // Resolve assignedRm: explicit body → the old owner's FAPL → null.
    let assignedRm = optStr(b, "assignedRm");
    if (!assignedRm && isStr(old.primaryOwnerId) && old.primaryOwnerId !== "UNASSIGNED") {
      const ownerSnap = await db.collection("users").doc(String(old.primaryOwnerId)).get();
      assignedRm = (ownerSnap.data()?.employeeId as string | undefined) ?? null;
    }

    const source = OLD_TO_NEW_SOURCE[String(old.source)] ?? "WALKIN";
    const priority = TRIAGE_TO_PRIORITY[String(old.triagePriority)] ?? "WARM";
    // Carry over a scheduled callback as the first CRM 2.0 follow-up.
    const followUp = isStr(old.callbackAt) ? Timestamp.fromDate(new Date(String(old.callbackAt))) : null;
    const dupeKeys = buildDupeKeys(mobile, email);
    // Promoted Customers keep their original (random) doc id, so mint a separate
    // LD-YYYY-##### code from the shared lead counter for a consistent display id.
    const promoteYear = new Date().getFullYear();
    const leadCode = await db.runTransaction(async (tx) => nextIdInTx(tx, `leads-${promoteYear}`, `LD-${promoteYear}-`, 5));

    await ref.update({
      // ── new-model fields ──
      receivedAt: FieldValue.serverTimestamp(), leadCode,
      category, productId,
      name, mobile, email: email ?? null,
      city: optStr(old as Record<string, unknown>, "city"),
      source,
      sourceMeta: { formId: null, sourceUrl: null, utm: null },
      amountRequired: typeof old.monthlyIncome === "number" ? null : (optNum(b, "amountRequired") ?? null),
      referredById: null, referredByType: null, referredByName: null, referredByCode: null,
      // Carry the customer's connector (FAC-) straight through as the lead's
      // sourcing channel partner — it flows on to the Case, so the rep never
      // re-picks a connector the customer was already sourced by.
      channelPartnerId: optStr(old as Record<string, unknown>, "connectorId"),
      channelPartnerCode: optStr(old as Record<string, unknown>, "connectorCode"),
      channelPartnerName: optStr(old as Record<string, unknown>, "connectorName"),
      linkedExistingClientId: null, customerProfile: null,
      assignedRm, assignedAt: assignedRm ? FieldValue.serverTimestamp() : null,
      status: "NEW", priority,
      nextFollowUpAt: followUp, nextFollowUpNote: null, followUpReminderSent: false,
      attempts: 0,
      activityLog: [{
        at: Timestamp.now(), by: caller.fapl,
        note: "Promoted from Customer → Lead", action: "promote",
      }],
      dropReason: null,
      converted: false, convertedAt: null,
      linkedClientId: null, linkedCaseId: null, linkedSubDsaId: null,
      duplicateOfLeadId: null, dupeKeys,
      // A promoted Customer is interested ⇒ already contacted: preserve any prior
      // stamp, else mark contact now so it doesn't spuriously Stage-2-breach.
      firstContactedAt: old.firstContactedAt ?? FieldValue.serverTimestamp(),
      promotedFromCustomer: true,
      // ── keep the old disposition coherent ──
      leadStatus: "interested", leadStatusAt: FieldValue.serverTimestamp(), leadStatusBy: caller.uid,
      promotedAt: FieldValue.serverTimestamp(), promotedBy: caller.fapl,
      ...updateAudit(caller.fapl),
    });

    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: "crm2_promote_lead",
      targetPath: `/leads/${req.params.id}`, at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, id: req.params.id, leadCode });
  }));

  // ─── One-time backfill: give every CRM 2.0 lead a leadCode (LD-YYYY-#####) ─────
  // Natively-created leads already have an LD- doc id (leadCode = id); promoted
  // Customers kept a random doc id and get a freshly-minted code. Idempotent
  // (skips leads that already have a leadCode). Admin/manager only.
  app.post("/api/crm2/admin/backfill-lead-codes", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.leads.write");
    if (!caller) return;
    const meta = await getCallerMeta(caller.uid);
    if (!meta.isAdmin && !meta.isManager) throw new ApiError(403, "Admin or manager only");
    const snap = await db.collection("leads").get();
    let coded = 0, minted = 0, skipped = 0;
    for (const d of snap.docs) {
      const data = d.data();
      if (!data.receivedAt) { skipped++; continue; }          // old-model Customer, not a CRM 2.0 lead
      if (isStr(data.leadCode)) { skipped++; continue; }      // already has a code
      if (/^LD-\d{4}-\d+$/.test(d.id)) {
        await d.ref.update({ leadCode: d.id });               // native lead — id is already the code
        coded++;
      } else {
        const year = (data.receivedAt?.toDate?.() ?? new Date()).getFullYear();
        const code = await db.runTransaction(async (tx) => nextIdInTx(tx, `leads-${year}`, `LD-${year}-`, 5));
        await d.ref.update({ leadCode: code });
        minted++;
      }
    }
    res.json({ ok: true, coded, minted, skipped, total: snap.size });
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
      "mis.read", "recon.read", "recon.write",
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
    "handlingRm", "subDsaId", "channelPartnerId", "channelPartnerCode", "channelPartnerName",
    "lenderId", "connectorId", "subProduct",
    "amountRequested", "amountSanctioned", "roiPct", "tenureMonths", "processingFee",
    "bankApplicationNo", "loanAccountNo", "connectorCaseRef",
    "bankContact", "nextAction", "remarks", "rejectionReason",
    "pddStatus", "otcStatus", "pddPendingList", "stage1", "eligibility", "docsFolderUrl",
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

  // Shape the rich Stage-1 (Opened) underwriting object — bounded arrays, typed
  // scalars; never trusts client field count. Returns null for a non-object.
  const s1num = (v: unknown): number | null => {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v); return Number.isFinite(n) ? n : null;
  };
  const s1str = (v: unknown, max = 500): string | null =>
    isStr(v) && String(v).trim() ? String(v).trim().slice(0, max) : null;
  function sanitizeStage1(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, Record<string, unknown> & unknown[]>;
    const obj = (x: unknown) => (x && typeof x === "object" ? (x as Record<string, unknown>) : null);
    const p = obj(r.property);
    const g = obj(r.gstTurnover);
    const inc = obj(r.income);
    return {
      property: p ? { description: s1str(p.description), address: s1str(p.address, 1000), marketValue: s1num(p.marketValue) } : null,
      turnover: Array.isArray(r.turnover)
        ? r.turnover.slice(0, 5).map((t) => ({ fy: s1str((t as Record<string, unknown>)?.fy, 20) ?? "", amount: s1num((t as Record<string, unknown>)?.amount) ?? 0 }))
            .filter((t) => t.fy || t.amount) : [],
      gstTurnover: g ? { period: s1str(g.period, 40), amount: s1num(g.amount) } : null,
      existingLoans: Array.isArray(r.existingLoans)
        ? r.existingLoans.slice(0, 20).map((l) => { const o = l as Record<string, unknown>;
            return { lender: s1str(o?.lender) ?? "", loanType: s1str(o?.loanType) ?? "", outstanding: s1num(o?.outstanding) ?? 0, emi: s1num(o?.emi) ?? 0 }; })
            .filter((l) => l.lender || l.outstanding || l.emi) : [],
      income: inc ? { company: s1num(inc.company), individual: s1num(inc.individual), rental: s1num(inc.rental) } : null,
      references: Array.isArray(r.references)
        ? r.references.slice(0, 4).map((x) => { const o = x as Record<string, unknown>;
            return { name: s1str(o?.name) ?? "", mobile: s1str(o?.mobile, 20) ?? "", relation: s1str(o?.relation, 60) ?? "" }; })
            .filter((x) => x.name || x.mobile) : [],
      notes: s1str(r.notes, 4000),
    };
  }

  // Shape the Stage-2 eligibility object (CIBIL taken + per-applicant issues table).
  function sanitizeEligibility(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    return {
      cibilTaken: r.cibilTaken === true,
      issues: Array.isArray(r.issues)
        ? r.issues.slice(0, 20).map((x) => { const o = x as Record<string, unknown>;
            return { name: s1str(o?.name) ?? "", score: s1num(o?.score), overdue: s1str(o?.overdue, 500) ?? "",
              settlement: s1str(o?.settlement, 500) ?? "", writtenOff: s1str(o?.writtenOff, 500) ?? "", dpd: s1str(o?.dpd, 500) ?? "" }; })
            .filter((x) => x.name || x.score != null || x.overdue || x.settlement || x.writtenOff || x.dpd)
        : [],
    };
  }

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
        productId, subProduct: optStr(b, "subProduct"),
        handlingRm: optStr(b, "handlingRm") ?? (client.ownerRm as string | undefined) ?? caller.fapl,
        subDsaId: optStr(b, "subDsaId") ?? (client.sourcedById as string | null) ?? null,
        channelPartnerId: optStr(b, "channelPartnerId"),
        channelPartnerCode: optStr(b, "channelPartnerCode"),
        channelPartnerName: optStr(b, "channelPartnerName"),
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
        docsCompletePct: 0, nextAction: null, remarks: null, stage1: null,
        eligibility: null, docsFolderUrl: null,
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
        } else if (k === "stage1") {
          fields.stage1 = sanitizeStage1(b.stage1);
        } else if (k === "eligibility") {
          fields.eligibility = sanitizeEligibility(b.eligibility);
        } else if (k === "docsFolderUrl") {
          fields.docsFolderUrl = optStr(b, "docsFolderUrl");
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
  // Phase 4 cutover — the CASE stage is now case-level only (stages 1–3 + the
  // logins roll-up). Sanction/disburse/PDD live on each LOGIN, not the case.
  app.post("/api/crm2/cases/:id/stage", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const to = reqEnum(b, "to", ["OPENED", "BASIC_DOCS", "DOCS", "IN_PROGRESS", "COMPLETED", "CLOSED"] as const);
    const outcome = optStr(b, "outcome");
    const caseRef = db.collection("cases").doc(req.params.id);

    const result = await db.runTransaction(async (tx) => {
      const caseSnap = await tx.get(caseRef);
      if (!caseSnap.exists) throw new ApiError(404, `${req.params.id} not found`);
      const cur = caseSnap.data()!;
      const from = cur.stage as string;

      // COMPLETED requires every login COMPLETED → read them first (before writes).
      let logins: LoginLite[] = [];
      if (to === "COMPLETED") {
        const lsnap = await tx.get(caseRef.collection("logins"));
        logins = lsnap.docs.map((d) => ({ stage: d.data().stage, outcome: d.data().outcome ?? null }));
      }
      const order = validateCaseLevelTransition(from as never, to as never, outcome, logins);
      if (!order.ok) throw new ApiError(400, order.reason!);

      const fields: Record<string, unknown> = { stage: to };
      if (to === "DOCS") fields["keyDates.docsComplete"] = FieldValue.serverTimestamp();
      if (to === "COMPLETED") { fields.outcome = "COMPLETED"; fields["keyDates.closed"] = FieldValue.serverTimestamp(); }
      if (to === "CLOSED") {
        fields.outcome = outcome ?? null;
        fields["keyDates.closed"] = FieldValue.serverTimestamp();
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

  // ═══ Phase 6 — Case collaboration (collaborators + task/update thread) ════════
  // Case access is already permission-wide (crm.cases.read); collaboration adds
  // attribution (who's working it → their Tasks page) + a comms thread. Server-only
  // writes. Bells the counterparties so a task by one is seen + actionable by another.

  async function notifyFapls(fapls: Iterable<string>, payload: Record<string, unknown>): Promise<void> {
    const seen = new Set<string>();
    for (const f of fapls) {
      if (!f || seen.has(f)) continue; seen.add(f);
      const uid = await faplToUid(f);
      if (uid) await notify(uid, payload);
    }
  }

  // POST collaborators — set the full collaborator set (admin/manager/owner only).
  app.post("/api/crm2/cases/:id/collaborators", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const meta = await getCallerMeta(caller.uid);
    const caseRef = db.collection("cases").doc(req.params.id);
    const snap = await caseRef.get();
    if (!snap.exists) throw new ApiError(404, `${req.params.id} not found`);
    const c = snap.data()!;
    const handlingRm = c.handlingRm as string;
    if (!(meta.isAdmin || meta.isManager || handlingRm === caller.fapl)) {
      throw new ApiError(403, "Only an admin, a manager, or the handling RM can change collaborators");
    }
    const raw = Array.isArray((req.body ?? {}).collaborators) ? (req.body as Record<string, unknown>).collaborators as unknown[] : [];
    const next = [...new Set(raw.map((x) => String(x).trim()).filter((x) => /^FAPL-\d+$/.test(x)))]
      .filter((f) => f !== handlingRm).slice(0, 12);
    const prev = ((c.collaborators as string[]) ?? []);
    await caseRef.update({ collaborators: next, ...updateAudit(caller.fapl) });
    const added = next.filter((f) => !prev.includes(f));
    if (added.length) {
      const byName = await faplDisplayName(caller.fapl);
      await notifyFapls(added, {
        type: "new_lead", title: `Added to a case by ${byName}`,
        body: `${req.params.id} — ${(c as Record<string, unknown>).clientId ?? ""}`, link: `/crm/pipeline/cases/${req.params.id}`,
      });
    }
    res.json({ ok: true, collaborators: next });
  }));

  // POST a task/update onto the case thread.
  app.post("/api/crm2/cases/:id/tasks", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const kind = reqEnum(b, "kind", ["task", "update"] as const);
    const text = reqStr(b, "text").slice(0, 2000);
    const assignedTo = kind === "task" && isStr(b.assignedTo) && /^FAPL-\d+$/.test(String(b.assignedTo)) ? String(b.assignedTo) : null;
    const caseRef = db.collection("cases").doc(req.params.id);
    const snap = await caseRef.get();
    if (!snap.exists) throw new ApiError(404, `${req.params.id} not found`);
    const c = snap.data()!;
    const clientSnap = await db.collection("clients").doc(c.clientId as string).get();
    const clientName = (clientSnap.data()?.name as string | null) ?? null;
    const assignedToName = assignedTo ? await faplDisplayName(assignedTo) : null;
    const createdByName = await faplDisplayName(caller.fapl);

    const ref = await caseRef.collection("tasks").add({
      caseId: req.params.id, clientName, kind, text,
      assignedTo, assignedToName, status: kind === "task" ? "open" : "done",
      doneAt: kind === "update" ? FieldValue.serverTimestamp() : null, doneBy: null,
      createdByName, ...createAudit(caller.fapl),
    });
    // Bell the counterparties (handling RM + collaborators + assignee), minus the author.
    const audience = new Set<string>([c.handlingRm as string, ...((c.collaborators as string[]) ?? []), ...(assignedTo ? [assignedTo] : [])]);
    audience.delete(caller.fapl);
    await notifyFapls(audience, {
      type: "new_lead",
      title: kind === "task" ? `New task on ${req.params.id}` : `Update on ${req.params.id}`,
      body: `${createdByName}: ${text.slice(0, 120)}`, link: `/crm/pipeline/cases/${req.params.id}`,
    });
    res.json({ ok: true, taskId: ref.id });
  }));

  // PATCH a task — toggle open/done (tasks only).
  app.patch("/api/crm2/cases/:id/tasks/:taskId", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const status = reqEnum((req.body ?? {}) as Record<string, unknown>, "status", ["open", "done"] as const);
    const ref = db.collection("cases").doc(req.params.id).collection("tasks").doc(req.params.taskId);
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, "Task not found");
    if (snap.data()!.kind !== "task") throw new ApiError(400, "Only tasks can be marked done");
    await ref.update({
      status,
      doneAt: status === "done" ? FieldValue.serverTimestamp() : null,
      doneBy: status === "done" ? caller.fapl : null,
      ...updateAudit(caller.fapl),
    });
    res.json({ ok: true });
  }));

  // GET my open case-tasks (across all cases) — powers the Tasks page section.
  app.get("/api/crm2/my-case-tasks", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.read");
    if (!caller) return;
    const snap = await db.collectionGroup("tasks").where("assignedTo", "==", caller.fapl).get();
    const ms = (v: unknown) => (v as { toMillis?: () => number })?.toMillis?.() ?? 0;
    const tasks = snap.docs
      .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
      .filter((r) => r.data.status === "open" && r.data.kind === "task")
      .sort((a, b) => ms(b.data.createdAt) - ms(a.data.createdAt))
      .map((r) => ({ id: r.id, caseId: r.data.caseId, clientName: r.data.clientName, text: r.data.text,
        createdByName: r.data.createdByName, createdAt: ms(r.data.createdAt) || null }));
    res.json({ ok: true, tasks });
  }));

  // Keep-style task extras — colour accent + optional checklist items.
  const TASK_COLORS = new Set(["default", "red", "orange", "yellow", "green", "teal", "blue", "purple"]);
  function sanitizeTaskColor(v: unknown): string {
    return isStr(v) && TASK_COLORS.has(String(v)) ? String(v) : "default";
  }
  function sanitizeTaskItems(v: unknown): Array<{ id: string; text: string; done: boolean }> | null {
    if (!Array.isArray(v)) return null;
    const out = v.slice(0, 50).map((raw, i) => {
      const it = (raw ?? {}) as Record<string, unknown>;
      return {
        id: isStr(it.id) ? String(it.id).slice(0, 40) : `i${i}_${Math.abs(i * 2654435761 % 100000)}`,
        text: String(it.text ?? "").slice(0, 300),
        done: it.done === true,
      };
    }).filter((it) => it.text.trim() !== "");
    return out.length ? out : null;
  }

  // ═══ Ad-hoc tasks — a manager/admin assigns a to-do to any specific person ═══
  // Collection /crm_tasks — server-only writes (rules: write false); the assignee,
  // the creator, and managers/admins can read. Assignment bells + emails the
  // assignee and the task sits on their Tasks → To-Do tab until marked done.
  app.post("/api/crm2/tasks", route(async (req, res) => {
    const decoded = await decodeToken(req);
    if (!decoded) throw new ApiError(401, "Unauthorized");

    const b = (req.body ?? {}) as Record<string, unknown>;
    const assignedTo = reqStr(b, "assignedTo");
    // Anyone may add a task for THEMSELVES (personal to-do); assigning to
    // someone else stays a manager/admin action.
    if (assignedTo !== decoded.uid) {
      const meta = await getCallerMeta(decoded.uid);
      if (!meta.isManager) throw new ApiError(403, "Only a manager or admin can assign tasks to someone else");
    }
    const text = (optStr(b, "text") ?? "").slice(0, 4000);
    const title = (optStr(b, "title") ?? "").slice(0, 200) || null;
    const color = sanitizeTaskColor(b.color);
    const items = sanitizeTaskItems(b.items);
    if (!text.trim() && !title && !(items && items.length)) throw new ApiError(400, "Task needs a title, text or checklist items");
    const dueAt = optTs(b, "dueAt");
    const link = optStr(b, "link");

    const [uSnap, callerSnap] = await Promise.all([
      db.collection("users").doc(assignedTo).get(),
      db.collection("users").doc(decoded.uid).get(),
    ]);
    if (!uSnap.exists) throw new ApiError(404, "Assignee not found");
    const assignee = uSnap.data() ?? {};
    const callerName = (callerSnap.data()?.displayName as string) ?? decoded.uid;

    const taskRef = await db.collection("crm_tasks").add({
      assignedTo,
      assignedToName: (assignee.displayName as string) ?? assignedTo,
      text,
      title,
      color,
      items,
      reminderSent: false,
      dueAt: dueAt ?? null,
      link: link ? link.slice(0, 500) : null,
      status: "open",
      createdBy: decoded.uid,
      createdByName: callerName,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      doneAt: null, doneBy: null,
    });

    if (assignedTo !== decoded.uid) await notify(assignedTo, {
      type: "task_assigned",
      title: `New task from ${callerName}`,
      body: (title || text).slice(0, 140),
      link: "/crm/tasks",
    });
    const email = assignee.email as string | undefined;
    if (email && assignedTo !== decoded.uid) {
      void sendBrandedEmail(email, `New task from ${callerName}`, {
        title: "You have a new task",
        intro: `${callerName} assigned you a task on Pulse.`,
        rows: [
          { label: "Task", value: (title ? `${title} — ${text}` : text).slice(0, 300) },
          ...(dueAt ? [{ label: "Due", value: dueAt.toDate().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) }] : []),
        ],
        ctaLabel: "Open Tasks", ctaLink: "https://pulse.finvastra.com/crm/tasks",
      }).catch(() => {});
    }
    res.json({ ok: true, id: taskRef.id });
  }));

  // Mark done / reopen — assignee, creator, or a manager/admin.
  app.patch("/api/crm2/tasks/:id", route(async (req, res) => {
    const decoded = await decodeToken(req);
    if (!decoded) throw new ApiError(401, "Unauthorized");
    const taskRef = db.collection("crm_tasks").doc(req.params.id);
    const snap = await taskRef.get();
    if (!snap.exists) throw new ApiError(404, "Task not found");
    const t = snap.data() ?? {};
    if (t.assignedTo !== decoded.uid && t.createdBy !== decoded.uid) {
      const meta = await getCallerMeta(decoded.uid);
      if (!meta.isManager) throw new ApiError(403, "Not your task");
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    if (b.status !== undefined) {
      const status = reqEnum(b, "status", ["open", "done"] as const);
      fields.status = status;
      fields.doneAt = status === "done" ? FieldValue.serverTimestamp() : null;
      fields.doneBy = status === "done" ? decoded.uid : null;
    }
    if (b.title !== undefined) fields.title = (optStr(b, "title") ?? "").slice(0, 200) || null;
    if (b.text !== undefined) fields.text = (optStr(b, "text") ?? "").slice(0, 4000);
    if (b.color !== undefined) fields.color = sanitizeTaskColor(b.color);
    if (b.items !== undefined) fields.items = sanitizeTaskItems(b.items);
    if (b.dueAt !== undefined) {
      fields.dueAt = optTs(b, "dueAt");
      fields.reminderSent = false;                    // re-arm the due reminder
    }
    if (Object.keys(fields).length === 0) throw new ApiError(400, "No editable fields in payload");
    // Content edits (not status ticks) stamp editedAt → the card shows an "edited" tag.
    if (b.title !== undefined || b.text !== undefined || b.color !== undefined
        || b.items !== undefined || b.dueAt !== undefined) {
      fields.editedAt = FieldValue.serverTimestamp();
      fields.editedBy = decoded.uid;
    }
    await taskRef.update({ ...fields, updatedAt: FieldValue.serverTimestamp() });
    res.json({ ok: true });
  }));

  // ═══ Phase 4 — Logins (per-login pipeline; subcollection cases/{id}/logins) ═══
  // A login = one file → one bank/NBFC. Additive to the legacy per-case stage
  // engine; the money engine (disburse → per-login cycle + MIS) is Build #2.
  const SUB_PROCESS_KEYS = ["pd", "technical", "valuation", "legal", "credit"] as const;
  const emptySubProcess = () => ({ status: "NA", query: null, remarks: null });
  const emptySubProcesses = () =>
    Object.fromEntries(SUB_PROCESS_KEYS.map((k) => [k, emptySubProcess()]));

  // Fields an RM may edit directly on a login (stage/keyDates/money are protected).
  const LOGIN_EDITABLE = new Set([
    "lenderId", "connectorId", "subDsaId", "channelPartnerId", "channelPartnerCode", "channelPartnerName",
    "branch", "amountRequested",
    "smName", "smNumber", "smEmail", "asmName", "asmNumber", "asmEmail",
    "docsSent", "docsSentVia", "directFromBank",
    "dsaCodeUsed", "dsaAggregatorId", "codeName", "loginDone", "loanApplicationNo",
    "amountSanctioned", "roiPct", "tenureMonths", "processingFee", "insuranceAmount",
    "otherCharges", "sanctionDate", "sanctionLetterPath", "verifiedAppNo", "customerDecision",
    "pddStatus", "otcStatus", "pddPendingList", "applicantIds", "remarks",
    "bt", "secured", "subProcesses", "query", "resolveQueryIndex",
  ]);
  const LOGIN_PROTECTED = new Set([
    "stage", "outcome", "keyDates", "payoutStatus", "payoutCycleId",
    "mappingId", "slabId", "dsaCode",
    "amountDisbursed", "disbursementDate", "loanAccountNo", "disbursalCity", "disbursalState",
    "caseId", "seq", "createdAt", "createdBy", "updatedAt", "updatedBy",
  ]);

  // POST — open a login on a case (defaults connector/subDsa from the case).
  app.post("/api/crm2/cases/:id/logins", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const year = new Date().getFullYear();
    const caseRef = db.collection("cases").doc(req.params.id);

    const result = await db.runTransaction(async (tx) => {
      const caseSnap = await tx.get(caseRef);
      if (!caseSnap.exists) throw new ApiError(404, `${req.params.id} not found`);
      const c = caseSnap.data()!;
      // count existing logins (for seq) — read before writes
      const existing = await tx.get(caseRef.collection("logins"));
      const counterRef = db.collection("counters").doc(`logins-${year}`);
      const seqCounter = (((await tx.get(counterRef)).data()?.seq as number | undefined) ?? 0) + 1;
      const loginId = `LGN-${year}-${String(seqCounter).padStart(4, "0")}`;

      tx.set(counterRef, { seq: seqCounter, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(caseRef.collection("logins").doc(loginId), {
        caseId: req.params.id, seq: existing.size + 1,
        lenderId: optStr(b, "lenderId") ?? (c.lenderId as string | null) ?? null,
        connectorId: optStr(b, "connectorId") ?? (c.connectorId as string | null) ?? null,
        subDsaId: optStr(b, "subDsaId") ?? (c.subDsaId as string | null) ?? null,
        channelPartnerId: optStr(b, "channelPartnerId") ?? (c.channelPartnerId as string | null) ?? null,
        channelPartnerCode: optStr(b, "channelPartnerCode") ?? (c.channelPartnerCode as string | null) ?? null,
        channelPartnerName: optStr(b, "channelPartnerName") ?? (c.channelPartnerName as string | null) ?? null,
        branch: optStr(b, "branch"),
        amountRequested: optNum(b, "amountRequested") ?? (c.amountRequested as number | null) ?? null,
        smName: null, smNumber: null, asmName: null, asmNumber: null,
        docsSent: false, directFromBank: b.directFromBank === true,
        dsaCodeUsed: null, codeName: null, loginDone: false, loanApplicationNo: null,
        queryLog: [], subProcesses: emptySubProcesses(),
        amountSanctioned: null, roiPct: null, tenureMonths: null, processingFee: null,
        insuranceAmount: null, otherCharges: null,
        sanctionDate: null, sanctionLetterPath: null, verifiedAppNo: null, customerDecision: null,
        amountDisbursed: null, disbursementDate: null, loanAccountNo: null,
        disbursalCity: null, disbursalState: null, bt: null, secured: null,
        pddStatus: "NA", otcStatus: "NA", pddPendingList: [],
        payoutStatus: "NOT_DUE", payoutCycleId: null,
        mappingId: null, slabId: null, dsaCode: null,
        stage: "FILE_LOGIN", outcome: null, rejectionReason: null,
        applicantIds: strArr(b, "applicantIds"),
        keyDates: { fileLogin: FieldValue.serverTimestamp(), codeLoginDone: null, inProcess: null,
                    sanction: null, disbursement: null, pddCleared: null, otcCleared: null, completed: null },
        remarks: optStr(b, "remarks"),
        ...createAudit(caller.fapl),
      });
      // Bump the case into its login phase (IN_PROGRESS) the first time a login is
      // opened (case-level stages 1–3 are done once logins begin).
      if (existing.size === 0) {
        if (["OPENED", "BASIC_DOCS", "DOCS"].includes(String(c.stage))) {
          tx.update(caseRef, { stage: "IN_PROGRESS", ...updateAudit(caller.fapl) });
        }
        tx.set(caseRef.collection("stageHistory").doc(), {
          from: c.stage ?? null, to: "IN_PROGRESS", at: FieldValue.serverTimestamp(),
          by: caller.fapl, note: `First login opened (${loginId})`,
        });
      }
      return { loginId, seq: existing.size + 1 };
    });

    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: "crm2_create_login",
      targetPath: `/cases/${req.params.id}/logins/${result.loginId}`, at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, ...result });
  }));

  // PATCH — edit login data fields (decoupled from stage advancement; decision F).
  app.patch("/api/crm2/cases/:id/logins/:loginId", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const offending = Object.keys(b).filter((k) => LOGIN_PROTECTED.has(k));
    if (offending.length > 0) throw new ApiError(400, `Protected login fields cannot be set: ${offending.join(", ")}`);
    const unknown = Object.keys(b).filter((k) => !LOGIN_EDITABLE.has(k));
    if (unknown.length > 0) throw new ApiError(400, `Unknown fields: ${unknown.join(", ")}`);

    const ref = db.collection("cases").doc(req.params.id).collection("logins").doc(req.params.loginId);
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, `${req.params.loginId} not found`);
    const cur = snap.data()!;

    const fields: Record<string, unknown> = {};
    for (const k of [
      "lenderId", "connectorId", "subDsaId", "channelPartnerId", "channelPartnerCode", "channelPartnerName",
      "branch", "smName", "smNumber", "asmName", "asmNumber",
      "codeName", "loanApplicationNo", "sanctionLetterPath", "verifiedAppNo", "remarks",
    ]) if (b[k] !== undefined) fields[k] = optStr(b, k);
    for (const k of ["amountRequested", "amountSanctioned", "roiPct", "tenureMonths",
      "processingFee", "insuranceAmount", "otherCharges"]) if (b[k] !== undefined) fields[k] = optNum(b, k);
    if (b.docsSent !== undefined) fields.docsSent = b.docsSent === true;
    if (b.directFromBank !== undefined) fields.directFromBank = b.directFromBank === true;
    if (b.loginDone !== undefined) fields.loginDone = b.loginDone === true;
    if (b.dsaCodeUsed !== undefined) fields.dsaCodeUsed = (b.dsaCodeUsed === "finvastra" || b.dsaCodeUsed === "connector_own") ? b.dsaCodeUsed : null;
    if (b.customerDecision !== undefined) fields.customerDecision = ["ACCEPTED", "PENDING", "REJECTED"].includes(String(b.customerDecision)) ? b.customerDecision : null;
    if (b.sanctionDate !== undefined) fields.sanctionDate = optTs(b, "sanctionDate");
    if (b.pddStatus !== undefined) fields.pddStatus = reqEnum({ pddStatus: b.pddStatus ?? "NA" }, "pddStatus", ["NA", "PENDING", "PARTIAL", "CLEARED"] as const);
    if (b.otcStatus !== undefined) fields.otcStatus = reqEnum({ otcStatus: b.otcStatus ?? "NA" }, "otcStatus", ["NA", "PENDING", "CLEARED"] as const);
    if (b.pddPendingList !== undefined) fields.pddPendingList = strArr(b, "pddPendingList");
    if (b.applicantIds !== undefined) fields.applicantIds = strArr(b, "applicantIds");
    if (b.bt !== undefined) fields.bt = b.bt === null ? null : (b.bt as Record<string, unknown>);
    if (b.secured !== undefined) fields.secured = b.secured === null ? null : (b.secured as Record<string, unknown>);
    if (b.subProcesses !== undefined) {
      const sp = (b.subProcesses ?? {}) as Record<string, Record<string, unknown>>;
      const merged: Record<string, unknown> = { ...(cur.subProcesses ?? emptySubProcesses()) };
      for (const k of SUB_PROCESS_KEYS) if (sp[k]) merged[k] = {
        status: ["NA", "PENDING", "IN_PROGRESS", "DONE"].includes(String(sp[k].status)) ? sp[k].status : "NA",
        query: isStr(sp[k].query) ? String(sp[k].query).slice(0, 1000) : null,
        remarks: isStr(sp[k].remarks) ? String(sp[k].remarks).slice(0, 1000) : null,
      };
      fields.subProcesses = merged;
    }
    // Query log append / resolve (mirrors the case queryLog pattern).
    if (isStr(b.query)) {
      fields.queryLog = FieldValue.arrayUnion({ raisedAt: Timestamp.now(), detail: String(b.query).slice(0, 1000), resolvedAt: null });
    }
    if (typeof b.resolveQueryIndex === "number") {
      const log = [...((cur.queryLog as Array<Record<string, unknown>>) ?? [])];
      const i = b.resolveQueryIndex as number;
      if (log[i] && !log[i].resolvedAt) { log[i] = { ...log[i], resolvedAt: Timestamp.now() }; fields.queryLog = log; }
    }
    if (Object.keys(fields).length === 0) throw new ApiError(400, "No editable fields in payload");
    await ref.update({ ...fields, ...updateAudit(caller.fapl) });

    // Auto-accumulate the bank SM/ASM into the Lender master's contact sub-list
    // (PLAN decision G — the SM/ASM list grows from Stage-4 login entries + manual
    // add). Best-effort, deduped by name+role; never blocks the login update.
    if (["smName", "smNumber", "asmName", "asmNumber"].some((k) => b[k] !== undefined)) {
      const merged = { ...cur, ...fields } as Record<string, unknown>;
      const lenderId = (merged.lenderId as string | null) ?? null;
      const want: Array<{ name: string; role: string; mobile: string }> = [];
      if (isStr(merged.smName) && String(merged.smName).trim()) want.push({ name: String(merged.smName).trim(), role: "SM", mobile: isStr(merged.smNumber) ? String(merged.smNumber).trim() : "" });
      if (isStr(merged.asmName) && String(merged.asmName).trim()) want.push({ name: String(merged.asmName).trim(), role: "ASM", mobile: isStr(merged.asmNumber) ? String(merged.asmNumber).trim() : "" });
      if (lenderId && want.length > 0) {
        try {
          const lref = db.collection("lenders").doc(lenderId);
          await db.runTransaction(async (tx) => {
            const ls = await tx.get(lref);
            if (!ls.exists) return;
            const existing = ((ls.data()!.contacts as Array<Record<string, unknown>>) ?? []);
            const have = new Set(existing.map((c) => `${String(c.name).toLowerCase().trim()}|${c.role}`));
            const add = want.filter((c) => !have.has(`${c.name.toLowerCase()}|${c.role}`))
              .map((c) => ({ name: c.name, role: c.role, email: "", mobile: c.mobile, branch: isStr(merged.branch) ? String(merged.branch).trim() : "" }));
            if (add.length > 0) tx.update(lref, { contacts: [...existing, ...add], ...updateAudit(caller.fapl) });
          });
        } catch { /* non-fatal — the login update already succeeded */ }
      }
    }
    res.json({ ok: true });
  }));

  // POST — advance a login one stage (or early-close with an outcome).
  app.post("/api/crm2/cases/:id/logins/:loginId/stage", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const to = reqEnum(b, "to", ["FILE_LOGIN", "CODE_LOGIN_DONE", "IN_PROCESS", "SANCTIONED", "DISBURSED", "PDD_OTC", "COMPLETED"] as const);
    const outcome = b.outcome === null ? null : (["COMPLETED", "REJECTED", "WITHDRAWN"].includes(String(b.outcome)) ? String(b.outcome) : null);
    const ref = db.collection("cases").doc(req.params.id).collection("logins").doc(req.params.loginId);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new ApiError(404, `${req.params.loginId} not found`);
      const from = snap.data()!.stage as string;
      const chk = validateLoginTransition(from as never, to as never, outcome);
      if (!chk.ok) throw new ApiError(422, chk.reason ?? "Invalid login transition");
      // Gate: a file can't move forward out of File Login until docs are confirmed
      // sent to the bank (early-close to COMPLETED is still allowed).
      if (from === "FILE_LOGIN" && to !== "COMPLETED" && snap.data()!.docsSent !== true) {
        throw new ApiError(422, "Confirm “Docs sent to bank” on this login before advancing it.");
      }

      const upd: Record<string, unknown> = { stage: to, ...updateAudit(caller.fapl) };
      const kd = keyDateForLoginStage(to as never);
      if (kd) upd[`keyDates.${kd}`] = FieldValue.serverTimestamp();
      if (to === "COMPLETED") {
        upd.outcome = outcome ?? "COMPLETED";
        if (outcome === "REJECTED" || outcome === "WITHDRAWN") upd.rejectionReason = optStr(b, "rejectionReason");
      }
      tx.update(ref, upd);
      tx.set(db.collection("cases").doc(req.params.id).collection("stageHistory").doc(), {
        from, to, at: FieldValue.serverTimestamp(), by: caller.fapl,
        note: optStr(b, "note") ?? `Login ${req.params.loginId}: ${from} → ${to}`,
      });
      return { from, to };
    });
    res.json({ ok: true, ...result });
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

  // ═══ Phase 4 — Disburse, Payout Cycles, MIS projection ════════════════════════
  // THE money pipeline. Disbursement freezes economics and atomically creates the
  // payout cycle + MIS record. Milestones derive status/variance/ageing (never
  // client-set) and keep case mirror + MIS in lock-step in one batch.

  const tsToMs = (v: unknown): number | null => {
    if (!v) return null;
    if (typeof (v as { toMillis?: () => number }).toMillis === "function") return (v as { toMillis: () => number }).toMillis();
    return null;
  };
  const monthOf = (ms: number): string => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  /** users/{*}.employeeId == fapl → displayName (best-effort; falls back to the code). */
  async function faplDisplayName(fapl: string): Promise<string> {
    if (!fapl) return "—";
    const snap = await db.collection("users").where("employeeId", "==", fapl).limit(1).get();
    return (snap.docs[0]?.data()?.displayName as string | undefined) ?? fapl;
  }

  // ─── POST /api/crm2/cases/:id/disburse — atomic case + cycle + MIS ───────────
  app.post("/api/crm2/cases/:id/disburse", route(async (req, res) => {
    const caller = await requirePerm(req, res, "payout.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;

    const disbursedAmount = optMoney(b, "disbursedAmount");
    if (disbursedAmount == null || disbursedAmount <= 0) throw new ApiError(400, "disbursedAmount must be a positive number");
    const disbDate = optTs(b, "disbursementDate");
    if (!disbDate) throw new ApiError(400, "disbursementDate is required (ISO date)");
    const loanAccountNo = reqStr(b, "loanAccountNo");
    const city = reqStr(b, "city");
    const state = reqStr(b, "state");
    const roiPct = optPct(b, "roiPct");
    const processingFee = optMoney(b, "processingFee");
    const subDsaPctOverride = optPct(b, "subDsaPayoutPct");

    const caseRef = db.collection("cases").doc(req.params.id);
    const caseSnap = await caseRef.get();
    if (!caseSnap.exists) throw new ApiError(404, `${req.params.id} not found`);
    const c = caseSnap.data()!;

    // ── MONEY SAFETY (Phase 4) — a case is EITHER legacy-per-case OR per-login,
    // never both. If any login exists, the case-level disburse is refused so the
    // same case can't be disbursed twice (per-case AND per-login). Disburse each
    // login from the Logins tab instead. This makes the two engines mutually
    // exclusive per case → no double-disburse / duplicate payout cycles.
    const loginCount = (await caseRef.collection("logins").limit(1).get()).size;
    if (loginCount > 0) {
      throw new ApiError(400, "This case uses the per-login pipeline — disburse each login from its Logins tab, not the case.");
    }

    // Pre-tx validation + slab resolution (hard-fail BEFORE opening the tx).
    if (c.stage !== "SANCTIONED") throw new ApiError(400, `Case must be SANCTIONED to disburse (current: ${c.stage})`);
    if (!c.connectorId || !c.lenderId) throw new ApiError(400, "Case needs connectorId and lenderId set before disbursement");
    const productId = c.productId as string;
    const subDsaId = (c.subDsaId as string | null) ?? null;

    // Mandatory DISBURSEMENT docs must be VERIFIED.
    const trackerSnap = await caseRef.collection("docTracker").get();
    const pendingDisb = trackerSnap.docs
      .map((d) => ({
        rowId: d.id,
        documentDefId: d.data().documentDefId as string,
        requiredByStage: d.data().requiredByStage as string,
        status: d.data().status as string,
      }))
      .filter((r) => r.requiredByStage === "DISBURSEMENT" && r.status !== "VERIFIED");
    if (pendingDisb.length > 0) {
      throw new ApiError(422, `${pendingDisb.length} mandatory DISBURSEMENT document(s) not VERIFIED`,
        pendingDisb.map((p) => ({ rowId: p.rowId, documentDefId: p.documentDefId, status: p.status })));
    }

    // Resolve the DSA-code mapping (aggregator × lender × product) → slab.
    const mapping = await resolveMapping(c.connectorId as string, c.lenderId as string, c.productId as string | undefined, c.subProduct as string | null | undefined);
    if (!mapping) throw new ApiError(400, `No DSA code mapping for this aggregator × lender × product — create one in Masters first`);
    const m = mapping.data();
    if (!m.dsaCode) throw new ApiError(400, "Mapping has no dsaCode set");

    const [aggSnap, lenderSnap, productSnap, clientSnap, subDsaSnap] = await Promise.all([
      db.collection("aggregators").doc(c.connectorId as string).get(),
      db.collection("lenders").doc(c.lenderId as string).get(),
      db.collection("products").doc(productId).get(),
      db.collection("clients").doc(c.clientId as string).get(),
      subDsaId ? db.collection("subDsas").doc(subDsaId).get() : Promise.resolve(null),
    ]);

    // resolveSlab — hard-fail on 0 or >1 matches with the typed readable error.
    const slabResolution = (m.slabs ?? []).map(toResolution);
    let slab;
    try {
      slab = resolveSlab(slabResolution, productId, disbDate.toMillis(), {
        connectorName: (aggSnap.data()?.name as string) ?? (c.connectorId as string),
        lenderName: (lenderSnap.data()?.name as string) ?? (c.lenderId as string),
        productName: (productSnap.data()?.shortCode as string) ?? productId,
      });
    } catch (e) {
      if (e instanceof SlabResolutionError) throw new ApiError(422, e.message, { kind: e.kind });
      throw e;
    }

    // Case-level sub-DSA % override: explicit payload, else the sub-DSA's own
    // product-matching payoutSlab, else the mapping slab default (in computeExpected).
    let caseSubDsaPct: number | null = subDsaPctOverride;
    if (caseSubDsaPct == null && subDsaSnap?.exists) {
      const slabs = (subDsaSnap.data()!.payoutSlabs as Array<{ productIds: string[]; payoutPct: number }>) ?? [];
      caseSubDsaPct = slabs.find((s) => s.productIds.includes(productId))?.payoutPct ?? null;
    }
    const amounts = computeExpectedAmounts(slab, disbursedAmount, caseSubDsaPct, !!subDsaId);
    const expectedTdsPct = (slab.tdsPct ?? (aggSnap.data()?.standardTdsPct as number | undefined)) ?? 0;

    // Derive ids: PC shares the case's sequence (FIN-CASE-2026-0312 → PC-2026-0312).
    const idMatch = /^FIN-CASE-(\d{4})-(\d+)$/.exec(req.params.id);
    if (!idMatch) throw new ApiError(400, `Case id '${req.params.id}' is not a CRM 2.0 case`);
    const cycleId = `PC-${idMatch[1]}-${idMatch[2]}`;
    const reportingMonth = monthOf(disbDate.toMillis());
    const handlingRmName = await faplDisplayName(c.handlingRm as string);

    await db.runTransaction(async (tx) => {
      // Re-read the case INSIDE the tx to prevent a double-disburse race.
      const fresh = await tx.get(caseRef);
      if (!fresh.exists) throw new ApiError(404, "Case vanished");
      if (fresh.data()!.stage !== "SANCTIONED") throw new ApiError(409, "Case is no longer SANCTIONED (already disbursed?)");

      const now = FieldValue.serverTimestamp();
      const cycleRef = db.collection("payoutCycles").doc(cycleId);
      const misRef = db.collection("misRecords").doc(req.params.id);
      const mirrorRef = caseRef.collection("private").doc("payout");

      // 1. Case: stage DISBURSED, freeze economics, payout badge.
      tx.update(caseRef, {
        stage: "DISBURSED",
        mappingId: mapping.id, slabId: slab.slabId, dsaCode: m.dsaCode,
        amountDisbursed: disbursedAmount, disbursalCity: city, disbursalState: state,
        ...(roiPct != null ? { roiPct } : {}), ...(processingFee != null ? { processingFee } : {}),
        loanAccountNo,
        "keyDates.disbursement": now,
        payoutStatus: "AWAITING_DATA_SHARE", payoutCycleId: cycleId,
        ...updateAudit(caller.fapl),
      });

      // 2. Money mirror — key-gated subdoc (payout.amounts.read).
      tx.set(mirrorRef, {
        finvastraPayoutPct: slab.finvastraPayoutPct, finvastraPayoutExpected: amounts.expectedGross,
        subDsaPayoutPct: amounts.subDsaPayoutPct, subDsaPayoutExpected: amounts.subDsaExpected,
        netMarginExpected: amounts.netMarginExpected,
        updatedAt: now,
      });

      // 3. Payout cycle (source of truth) — frozen economics + empty milestones.
      tx.set(cycleRef, {
        caseId: req.params.id, clientId: c.clientId,
        connectorId: c.connectorId, lenderId: c.lenderId, subDsaId,
        dsaCode: m.dsaCode, bankApplicationNo: c.bankApplicationNo ?? null, loanAccountNo,
        slabId: slab.slabId,
        disbursedAmount, disbursementDate: disbDate,
        finvastraPayoutPct: slab.finvastraPayoutPct, expectedGross: amounts.expectedGross,
        subDsaPayoutPct: amounts.subDsaPayoutPct, subDsaExpected: amounts.subDsaExpected,
        expectedTdsPct,
        status: "AWAITING_DATA_SHARE",
        dataSharedAt: null, dataSharedTo: null, reportingMonth: null, sharingMode: null,
        confirmationRaisedAt: null, confirmationRaisedFrom: null, bankSmAddressed: null, connectorCaseRef: c.connectorCaseRef ?? null,
        bankerConfirmedAt: null, bankerConfirmedBy: null, confirmedAmount: null, confirmedDsaCode: null,
        pddStatusAtConfirmation: null, bankerMismatch: false,
        pddOtcClearedMonth: null, holdFlag: false, holdReason: null,
        payoutConfirmedAt: null, confirmedPayoutPct: null, confirmedGross: null, pctVariance: false,
        billNo: null, billDate: null, billGross: null, billGst: null, billGstin: null, billedToEntity: null,
        billSentAt: null, billMode: null, billStoragePath: null,
        receivedAt: null, receivedNet: null, tdsDeducted: null, utr: null, receivedInAccount: null,
        amountVariance: null, varianceReason: null,
        subDsaBillNo: null, subDsaBillDate: null, subDsaBillAmount: null, subDsaApprovedBy: null,
        subDsaPaidAt: null, subDsaPaidAmount: null, subDsaTds: null, subDsaUtr: null,
        closedAt: null, netMarginRealised: null,
        ageing: { disbToDataShare: null, disbToBankerConfirm: null, disbToBilled: null, disbToReceived: null },
        disputeFlag: false, disputeNotes: null,
        milestoneLog: [],
        ...createAudit(caller.fapl),
      });

      // 4. MIS projection — doc id == case id; denormalised display strings.
      tx.set(misRef, {
        reportingMonth, caseId: req.params.id, payoutCycleId: cycleId,
        partyName: (clientSnap.data()?.name as string) ?? c.clientId, city, state,
        productCode: (productSnap.data()?.shortCode as string) ?? productId,
        lenderName: (lenderSnap.data()?.name as string) ?? c.lenderId,
        connectorName: (aggSnap.data()?.name as string) ?? c.connectorId,
        dsaCode: m.dsaCode,
        subDsaId, subDsaName: subDsaSnap?.exists ? (subDsaSnap.data()!.name as string) : null,
        handlingRmId: c.handlingRm, handlingRmName,
        connectorId: c.connectorId, lenderId: c.lenderId,
        bankApplicationNo: c.bankApplicationNo ?? null, loanAccountNo,
        disbursedAmount, disbursementDate: disbDate,
        roiPct: roiPct ?? c.roiPct ?? null, processingFee: processingFee ?? c.processingFee ?? null,
        finvastraPayoutPct: slab.finvastraPayoutPct, expectedGross: amounts.expectedGross,
        bankerConfirmedAt: null, pddOtcClearedMonth: null,
        billNo: null, billDate: null, billGross: null,
        receivedAt: null, receivedNet: null, tdsDeducted: null, utr: null,
        subDsaPayoutPct: amounts.subDsaPayoutPct, subDsaPaidAmount: null, subDsaPaidAt: null, subDsaUtr: null,
        netMargin: null, cycleStatus: "AWAITING_DATA_SHARE", ageingDays: null,
        updatedAt: now,
      });

      // 5. Stage history.
      tx.set(caseRef.collection("stageHistory").doc(), {
        from: "SANCTIONED", to: "DISBURSED", at: now, by: caller.fapl,
        note: `Disbursed ₹${disbursedAmount.toLocaleString("en-IN")} · slab ${slab.finvastraPayoutPct}% → expected ₹${amounts.expectedGross.toLocaleString("en-IN")}`,
      });
    });

    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: "crm2_disburse",
      targetPath: `/cases/${req.params.id}`, after: { cycleId, expectedGross: amounts.expectedGross }, at: FieldValue.serverTimestamp(),
    });
    // Money figures (slab %, expected payout) are gated on payout.amounts.read like
    // every other path — a payout.write-only caller gets just {ok, cycleId} and can
    // read the figures via GET /api/crm2/payout-cycles/:id (also money-stripped).
    const showMoney = await callerHasPerm(caller.uid, "payout.amounts.read");
    res.json({ ok: true, cycleId, ...(showMoney
      ? { expectedGross: amounts.expectedGross, finvastraPayoutPct: slab.finvastraPayoutPct, subDsaExpected: amounts.subDsaExpected }
      : {}) });
  }));

  // ─── GET /api/crm2/cases/:id/disburse-preview?amount&date — slab preview ─────
  // Powers the disburse dialog's "Slab: X × Y × Z — 1.40% w.e.f. … → ₹N" line.
  app.get("/api/crm2/cases/:id/disburse-preview", route(async (req, res) => {
    const caller = await requirePerm(req, res, "payout.amounts.read");
    if (!caller) return;
    const amount = Number(req.query.amount);
    const date = new Date(String(req.query.date ?? ""));
    if (isNaN(date.getTime())) throw new ApiError(400, "date query param must be an ISO date");

    const cSnap = await db.collection("cases").doc(req.params.id).get();
    if (!cSnap.exists) throw new ApiError(404, `${req.params.id} not found`);
    const c = cSnap.data()!;
    if (!c.connectorId || !c.lenderId) throw new ApiError(400, "Set connector and lender on the case first");

    const mapDoc = await resolveMapping(c.connectorId as string, c.lenderId as string, c.productId as string | undefined, c.subProduct as string | null | undefined);
    if (!mapDoc) throw new ApiError(400, "No DSA code mapping for this aggregator × lender × product");
    const m = mapDoc.data();
    const [agg, lender, product] = await Promise.all([
      db.collection("aggregators").doc(c.connectorId as string).get(),
      db.collection("lenders").doc(c.lenderId as string).get(),
      db.collection("products").doc(c.productId as string).get(),
    ]);
    try {
      const slab = resolveSlab((m.slabs ?? []).map(toResolution), c.productId as string, date.getTime(), {
        connectorName: (agg.data()?.name as string) ?? (c.connectorId as string),
        lenderName: (lender.data()?.name as string) ?? (c.lenderId as string),
        productName: (product.data()?.shortCode as string) ?? (c.productId as string),
      });
      const amounts = !isNaN(amount) && amount > 0 ? computeExpectedAmounts(slab, amount, null, !!c.subDsaId) : null;
      res.json({ ok: true, connectorName: agg.data()?.name, lenderName: lender.data()?.name,
        productCode: product.data()?.shortCode, dsaCode: m.dsaCode, slab, expected: amounts });
    } catch (e) {
      if (e instanceof SlabResolutionError) { res.status(422).json({ error: e.message, kind: e.kind }); return; }
      throw e;
    }
  }));

  // ─── POST /api/crm2/cases/:id/logins/:loginId/disburse (Phase 4 per-login) ───
  // The unit of disbursement/payout is now the LOGIN. Freezes economics onto the
  // login + atomically creates a payout cycle (PC- per login) + MIS record
  // (id == loginId). Mirrors the per-case engine; the cycle carries caseId+loginId
  // so the milestone engine, recon and dashboards work unchanged.
  app.post("/api/crm2/cases/:id/logins/:loginId/disburse", route(async (req, res) => {
    const caller = await requirePerm(req, res, "payout.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const caseId = req.params.id, loginId = req.params.loginId;

    const disbursedAmount = optMoney(b, "disbursedAmount");
    if (disbursedAmount == null || disbursedAmount <= 0) throw new ApiError(400, "disbursedAmount must be a positive number");
    const disbDate = optTs(b, "disbursementDate");
    if (!disbDate) throw new ApiError(400, "disbursementDate is required (ISO date)");
    const loanAccountNo = reqStr(b, "loanAccountNo");
    const city = reqStr(b, "city");
    const state = reqStr(b, "state");
    const roiPct = optPct(b, "roiPct");
    const processingFee = optMoney(b, "processingFee");
    const subDsaPctOverride = optPct(b, "subDsaPayoutPct");

    const caseRef = db.collection("cases").doc(caseId);
    const loginRef = caseRef.collection("logins").doc(loginId);
    const [caseSnap, loginSnap] = await Promise.all([caseRef.get(), loginRef.get()]);
    if (!caseSnap.exists) throw new ApiError(404, `${caseId} not found`);
    if (!loginSnap.exists) throw new ApiError(404, `${loginId} not found`);
    const c = caseSnap.data()!;
    const lg = loginSnap.data()!;

    if (lg.stage !== "SANCTIONED") throw new ApiError(400, `Login must be SANCTIONED to disburse (current: ${lg.stage})`);
    const connectorId = lg.connectorId as string | null;
    const lenderId = lg.lenderId as string | null;
    if (!connectorId || !lenderId) throw new ApiError(400, "Login needs connectorId and lenderId set before disbursement");
    const productId = c.productId as string;
    const subDsaId = (lg.subDsaId as string | null) ?? (c.subDsaId as string | null) ?? null;
    // FAC- "Sub DSA" sourcing channel partner (HRMS connectors) — auto-payout source.
    const channelPartnerId = (lg.channelPartnerId as string | null) ?? (c.channelPartnerId as string | null) ?? null;
    const channelPartnerPayoutOverride = optMoney(b, "channelPartnerPayoutOverride");

    // Mandatory DISBURSEMENT docs (case-level shared docTracker) must be VERIFIED.
    const trackerSnap = await caseRef.collection("docTracker").get();
    const pendingDisb = trackerSnap.docs
      .map((d) => ({ rowId: d.id, documentDefId: d.data().documentDefId as string,
        requiredByStage: d.data().requiredByStage as string, status: d.data().status as string }))
      .filter((r) => r.requiredByStage === "DISBURSEMENT" && r.status !== "VERIFIED");
    if (pendingDisb.length > 0) {
      throw new ApiError(422, `${pendingDisb.length} mandatory DISBURSEMENT document(s) not VERIFIED`,
        pendingDisb.map((p) => ({ rowId: p.rowId, documentDefId: p.documentDefId, status: p.status })));
    }

    // Mapping for this login's aggregator × lender × product; resolve the slab.
    const mapping = await resolveMapping(connectorId, lenderId, productId, c.subProduct as string | null | undefined);
    if (!mapping) throw new ApiError(400, "No DSA code mapping for this aggregator × lender × product — create one in Masters first");
    const m = mapping.data();
    if (!m.dsaCode) throw new ApiError(400, "Mapping has no dsaCode set");

    const [aggSnap, lenderSnap, productSnap, clientSnap, subDsaSnap, cpSnap] = await Promise.all([
      db.collection("aggregators").doc(connectorId).get(),
      db.collection("lenders").doc(lenderId).get(),
      db.collection("products").doc(productId).get(),
      db.collection("clients").doc(c.clientId as string).get(),
      subDsaId ? db.collection("subDsas").doc(subDsaId).get() : Promise.resolve(null),
      channelPartnerId ? db.collection("connectors").doc(channelPartnerId).get() : Promise.resolve(null),
    ]);

    const slabResolution = (m.slabs ?? []).map(toResolution);
    let slab;
    try {
      slab = resolveSlab(slabResolution, productId, disbDate.toMillis(), {
        connectorName: (aggSnap.data()?.name as string) ?? connectorId,
        lenderName: (lenderSnap.data()?.name as string) ?? lenderId,
        productName: (productSnap.data()?.shortCode as string) ?? productId,
      });
    } catch (e) {
      if (e instanceof SlabResolutionError) throw new ApiError(422, e.message, { kind: e.kind });
      throw e;
    }

    let caseSubDsaPct: number | null = subDsaPctOverride;
    if (caseSubDsaPct == null && subDsaSnap?.exists) {
      const slabs = (subDsaSnap.data()!.payoutSlabs as Array<{ productIds: string[]; payoutPct: number }>) ?? [];
      caseSubDsaPct = slabs.find((s) => s.productIds.includes(productId))?.payoutPct ?? null;
    }
    const amounts = computeExpectedAmounts(slab, disbursedAmount, caseSubDsaPct, !!subDsaId);
    const expectedTdsPct = (slab.tdsPct ?? (aggSnap.data()?.standardTdsPct as number | undefined)) ?? 0;
    // FAC- channel-partner auto-payout (per-product rule, manual override allowed).
    const cpRule = channelPartnerId && cpSnap?.exists
      ? resolveChannelPartnerRule(cpSnap.data()!.payoutRules as Parameters<typeof resolveChannelPartnerRule>[0], productId)
      : null;
    const cpComputed = computeChannelPartnerPayout(cpRule, disbursedAmount, amounts.expectedGross);
    const cpAmount = channelPartnerPayoutOverride != null ? channelPartnerPayoutOverride : cpComputed;
    const prodVertical = (productSnap.data()?.vertical as string) ?? "LOANS";
    const cpBusinessLine = prodVertical === "WEALTH" ? "wealth" : prodVertical === "INSURANCE" ? "insurance" : "loan";
    const reportingMonth = monthOf(disbDate.toMillis());
    const handlingRmName = await faplDisplayName(c.handlingRm as string);
    const year = new Date().getFullYear();

    const cycleId = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(loginRef);                       // reads first
      if (!fresh.exists) throw new ApiError(404, "Login vanished");
      if (fresh.data()!.stage !== "SANCTIONED") throw new ApiError(409, "Login is no longer SANCTIONED (already disbursed?)");
      const newCycleId = await nextIdInTx(tx, `payoutCycles-${year}`, `PC-${year}-`, 4);   // last read (counter), then writes
      const now = FieldValue.serverTimestamp();
      const cycleRef = db.collection("payoutCycles").doc(newCycleId);
      const misRef = db.collection("misRecords").doc(loginId);

      // 1. Login → DISBURSED, freeze economics, payout badge.
      tx.update(loginRef, {
        stage: "DISBURSED",
        mappingId: mapping.id, slabId: slab.slabId, dsaCode: m.dsaCode,
        amountDisbursed: disbursedAmount, disbursalCity: city, disbursalState: state,
        ...(roiPct != null ? { roiPct } : {}), ...(processingFee != null ? { processingFee } : {}),
        loanAccountNo, "keyDates.disbursement": now,
        payoutStatus: "AWAITING_DATA_SHARE", payoutCycleId: newCycleId,
        ...updateAudit(caller.fapl),
      });

      // 2. Payout cycle (source of truth) — carries caseId + loginId.
      tx.set(cycleRef, {
        caseId, loginId, clientId: c.clientId,
        connectorId, lenderId, subDsaId,
        dsaCode: m.dsaCode, bankApplicationNo: lg.loanApplicationNo ?? null, loanAccountNo,
        slabId: slab.slabId,
        disbursedAmount, disbursementDate: disbDate,
        finvastraPayoutPct: slab.finvastraPayoutPct, expectedGross: amounts.expectedGross,
        subDsaPayoutPct: amounts.subDsaPayoutPct, subDsaExpected: amounts.subDsaExpected,
        expectedTdsPct,
        status: "AWAITING_DATA_SHARE",
        dataSharedAt: null, dataSharedTo: null, reportingMonth: null, sharingMode: null,
        confirmationRaisedAt: null, confirmationRaisedFrom: null, bankSmAddressed: null, connectorCaseRef: null,
        bankerConfirmedAt: null, bankerConfirmedBy: null, confirmedAmount: null, confirmedDsaCode: null,
        pddStatusAtConfirmation: null, bankerMismatch: false,
        pddOtcClearedMonth: null, holdFlag: false, holdReason: null,
        payoutConfirmedAt: null, confirmedPayoutPct: null, confirmedGross: null, pctVariance: false,
        billNo: null, billDate: null, billGross: null, billGst: null, billGstin: null, billedToEntity: null,
        billSentAt: null, billMode: null, billStoragePath: null,
        receivedAt: null, receivedNet: null, tdsDeducted: null, utr: null, receivedInAccount: null,
        amountVariance: null, varianceReason: null,
        subDsaBillNo: null, subDsaBillDate: null, subDsaBillAmount: null, subDsaApprovedBy: null,
        subDsaPaidAt: null, subDsaPaidAmount: null, subDsaTds: null, subDsaUtr: null,
        closedAt: null, netMarginRealised: null,
        ageing: { disbToDataShare: null, disbToBankerConfirm: null, disbToBilled: null, disbToReceived: null },
        disputeFlag: false, disputeNotes: null,
        milestoneLog: [],
        ...createAudit(caller.fapl),
      });

      // 3. MIS projection — doc id == LOGIN id; carries caseId + loginId.
      tx.set(misRef, {
        reportingMonth, caseId, loginId, payoutCycleId: newCycleId,
        partyName: (clientSnap.data()?.name as string) ?? c.clientId, city, state,
        productCode: (productSnap.data()?.shortCode as string) ?? productId,
        lenderName: (lenderSnap.data()?.name as string) ?? lenderId,
        connectorName: (aggSnap.data()?.name as string) ?? connectorId,
        dsaCode: m.dsaCode,
        subDsaId, subDsaName: subDsaSnap?.exists ? (subDsaSnap.data()!.name as string) : null,
        // Sourcing Sub DSA (FAC-) attribution for MIS reporting.
        channelPartnerId: (lg.channelPartnerId as string | null) ?? (c.channelPartnerId as string | null) ?? null,
        channelPartnerCode: (lg.channelPartnerCode as string | null) ?? (c.channelPartnerCode as string | null) ?? null,
        channelPartnerName: (lg.channelPartnerName as string | null) ?? (c.channelPartnerName as string | null) ?? null,
        handlingRmId: c.handlingRm, handlingRmName,
        connectorId, lenderId,
        bankApplicationNo: lg.loanApplicationNo ?? null, loanAccountNo,
        disbursedAmount, disbursementDate: disbDate,
        roiPct: roiPct ?? (lg.roiPct as number | null) ?? null, processingFee: processingFee ?? (lg.processingFee as number | null) ?? null,
        finvastraPayoutPct: slab.finvastraPayoutPct, expectedGross: amounts.expectedGross,
        bankerConfirmedAt: null, pddOtcClearedMonth: null,
        billNo: null, billDate: null, billGross: null,
        receivedAt: null, receivedNet: null, tdsDeducted: null, utr: null,
        subDsaPayoutPct: amounts.subDsaPayoutPct, subDsaPaidAmount: null, subDsaPaidAt: null, subDsaUtr: null,
        netMargin: null, cycleStatus: "AWAITING_DATA_SHARE", ageingDays: null,
        updatedAt: now,
      });

      // 3b. FAC- channel-partner payout — auto-create a connector_payout (pending),
      //     paid later via the existing HRMS connector-payout flow. Override wins.
      if (channelPartnerId && cpAmount != null && cpAmount > 0) {
        const cpRef = db.collection("connector_payouts").doc();
        tx.set(cpRef, {
          connectorId: channelPartnerId,
          connectorCode: (cpSnap?.data()?.connectorCode as string | null) ?? (lg.channelPartnerCode as string | null) ?? null,
          connectorName: (cpSnap?.data()?.displayName as string | null) ?? (lg.channelPartnerName as string | null) ?? null,
          businessLine: cpBusinessLine,
          caseLabel: `${caseId} · ${loginId} · ${loanAccountNo}`,
          caseId, loginId, payoutCycleId: newCycleId,
          leadId: (c.leadId as string | null) ?? null,
          amount: cpAmount,
          basis: cpRule?.basis ?? "MANUAL", rate: cpRule?.value ?? null,
          auto: channelPartnerPayoutOverride == null,
          status: "pending",
          notes: channelPartnerPayoutOverride != null
            ? `Auto-created at disbursement of ${loanAccountNo} — amount overridden`
            : cpRule
              ? `Auto-created at disbursement of ${loanAccountNo} — ${cpRule.basis} ${cpRule.value}`
              : `Auto-created at disbursement of ${loanAccountNo}`,
          createdBy: caller.fapl,
          createdAt: now,
        });
      }

      // 4. Stage history (on the case timeline).
      tx.set(caseRef.collection("stageHistory").doc(), {
        from: "SANCTIONED", to: "DISBURSED", at: now, by: caller.fapl,
        note: `Login ${loginId} disbursed ₹${disbursedAmount.toLocaleString("en-IN")} · slab ${slab.finvastraPayoutPct}% → expected ₹${amounts.expectedGross.toLocaleString("en-IN")}`,
      });
      return newCycleId;
    });

    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: "crm2_disburse_login",
      targetPath: `/cases/${caseId}/logins/${loginId}`, after: { cycleId, expectedGross: amounts.expectedGross }, at: FieldValue.serverTimestamp(),
    });
    const showMoney = await callerHasPerm(caller.uid, "payout.amounts.read");
    res.json({ ok: true, cycleId, loginId, ...(showMoney
      ? { expectedGross: amounts.expectedGross, finvastraPayoutPct: slab.finvastraPayoutPct, subDsaExpected: amounts.subDsaExpected,
          channelPartnerPayout: (channelPartnerId && cpAmount != null && cpAmount > 0) ? cpAmount : null }
      : {}) });
  }));

  // GET per-login slab preview (powers the disburse dialog).
  app.get("/api/crm2/cases/:id/logins/:loginId/disburse-preview", route(async (req, res) => {
    const caller = await requirePerm(req, res, "payout.amounts.read");
    if (!caller) return;
    const amount = Number(req.query.amount);
    const date = new Date(String(req.query.date ?? ""));
    if (isNaN(date.getTime())) throw new ApiError(400, "date query param must be an ISO date");
    const caseRef = db.collection("cases").doc(req.params.id);
    const [cSnap, lSnap] = await Promise.all([caseRef.get(), caseRef.collection("logins").doc(req.params.loginId).get()]);
    if (!cSnap.exists || !lSnap.exists) throw new ApiError(404, "Case or login not found");
    const c = cSnap.data()!; const lg = lSnap.data()!;
    const connectorId = lg.connectorId as string | null, lenderId = lg.lenderId as string | null;
    if (!connectorId || !lenderId) throw new ApiError(400, "Set connector and lender on the login first");
    const mapDoc = await resolveMapping(connectorId, lenderId, c.productId as string | undefined, c.subProduct as string | null | undefined);
    if (!mapDoc) throw new ApiError(400, "No DSA code mapping for this aggregator × lender × product");
    const m = mapDoc.data();
    const channelPartnerId = (lg.channelPartnerId as string | null) ?? (c.channelPartnerId as string | null) ?? null;
    const [agg, lender, product, cp] = await Promise.all([
      db.collection("aggregators").doc(connectorId).get(),
      db.collection("lenders").doc(lenderId).get(),
      db.collection("products").doc(c.productId as string).get(),
      channelPartnerId ? db.collection("connectors").doc(channelPartnerId).get() : Promise.resolve(null),
    ]);
    try {
      const slab = resolveSlab((m.slabs ?? []).map(toResolution), c.productId as string, date.getTime(), {
        connectorName: (agg.data()?.name as string) ?? connectorId,
        lenderName: (lender.data()?.name as string) ?? lenderId,
        productName: (product.data()?.shortCode as string) ?? (c.productId as string),
      });
      const amounts = !isNaN(amount) && amount > 0 ? computeExpectedAmounts(slab, amount, null, !!(lg.subDsaId ?? c.subDsaId)) : null;
      const cpRule = channelPartnerId && cp?.exists
        ? resolveChannelPartnerRule(cp.data()!.payoutRules as Parameters<typeof resolveChannelPartnerRule>[0], c.productId as string)
        : null;
      const channelPartner = channelPartnerId ? {
        id: channelPartnerId,
        name: (cp?.data()?.displayName as string | null) ?? (lg.channelPartnerName as string | null) ?? null,
        rule: cpRule,
        payout: amounts ? computeChannelPartnerPayout(cpRule, amount, amounts.expectedGross) : null,
      } : null;
      res.json({ ok: true, connectorName: agg.data()?.name, lenderName: lender.data()?.name,
        productCode: product.data()?.shortCode, dsaCode: m.dsaCode, slab, expected: amounts, channelPartner });
    } catch (e) {
      if (e instanceof SlabResolutionError) { res.status(422).json({ error: e.message, kind: e.kind }); return; }
      throw e;
    }
  }));

  // ─── Recompute all derived fields from a merged cycle + write cycle/case/MIS ──
  // Pure-function driven: status, ageing, variance flags, margin. Returns the
  // derived patch applied to the cycle, and mirrors the relevant bits to MIS.
  function deriveCycleFields(cy: Record<string, unknown>): Record<string, unknown> {
    const ms = (k: string) => tsToMs(cy[k]);
    const status = deriveCycleStatus({
      disputeFlag: cy.disputeFlag === true, closedAt: ms("closedAt"), subDsaPaidAt: ms("subDsaPaidAt"),
      receivedAt: ms("receivedAt"), billSentAt: ms("billSentAt"), billDate: ms("billDate"),
      payoutConfirmedAt: ms("payoutConfirmedAt"), holdFlag: cy.holdFlag === true,
      bankerConfirmedAt: ms("bankerConfirmedAt"), confirmationRaisedAt: ms("confirmationRaisedAt"),
    });
    const disbMs = tsToMs(cy.disbursementDate) ?? 0;
    const ageing = computeAgeing({
      disbursementDate: disbMs, dataSharedAt: ms("dataSharedAt"), bankerConfirmedAt: ms("bankerConfirmedAt"),
      billedAt: ms("billSentAt") ?? ms("billDate"), receivedAt: ms("receivedAt"),
    });
    const bankerMismatch = computeBankerMismatch(
      ms("bankerConfirmedAt"), cy.confirmedAmount as number | null, cy.disbursedAmount as number,
      cy.confirmedDsaCode as string | null, cy.dsaCode as string);
    const pctVariance = computePctVariance(cy.confirmedPayoutPct as number | null, cy.finvastraPayoutPct as number);
    const amountVariance = computeAmountVariance(
      ms("receivedAt"), cy.billGross as number | null, cy.tdsDeducted as number | null, cy.receivedNet as number | null);
    const netMarginRealised = computeNetMarginRealised(cy.receivedNet as number | null, cy.subDsaPaidAmount as number | null);
    return { status, ageing, bankerMismatch, pctVariance, amountVariance, netMarginRealised };
  }

  // ─── PATCH /api/crm2/payout-cycles/:id/milestone ─────────────────────────────
  app.patch("/api/crm2/payout-cycles/:id/milestone", route(async (req, res) => {
    const caller = await requirePerm(req, res, "payout.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const step = Number(b.step) as MilestoneStep;
    if (!MILESTONE_STEPS[step]) throw new ApiError(400, "step must be 2..10");
    const payload = (b.payload ?? {}) as Record<string, unknown>;
    const override = (b.override ?? null) as { reason?: unknown } | null;

    const cycleRef = db.collection("payoutCycles").doc(req.params.id);

    const result = await db.runTransaction(async (tx) => {
      const cySnap = await tx.get(cycleRef);
      if (!cySnap.exists) throw new ApiError(404, `${req.params.id} not found`);
      const cy = cySnap.data()!;
      // A CLOSED cycle is immutable via milestones. (Disputes on a closed cycle
      // legitimately arise post-close — they go via POST /api/crm2/recon/dispute,
      // which is deliberately NOT blocked here.)
      if (cy.closedAt != null || cy.status === "CLOSED") {
        throw new ApiError(409, "This payout cycle is closed — milestones can no longer be edited");
      }
      const caseRef = db.collection("cases").doc(cy.caseId as string);
      // Phase 4 per-login: the payout badge lives on the LOGIN and the MIS record
      // is keyed by loginId. Legacy per-case cycles (no loginId) fall back to the case.
      const isPerLogin = isStr(cy.loginId);
      const badgeRef = isPerLogin ? caseRef.collection("logins").doc(cy.loginId as string) : caseRef;
      const misRef = db.collection("misRecords").doc((cy.loginId as string) ?? (cy.caseId as string));

      // Step-order validation against current anchors (override bypasses + logs).
      const anchors: Record<string, number | string | null> = {
        dataSharedAt: tsToMs(cy.dataSharedAt), confirmationRaisedAt: tsToMs(cy.confirmationRaisedAt),
        bankerConfirmedAt: tsToMs(cy.bankerConfirmedAt), payoutConfirmedAt: tsToMs(cy.payoutConfirmedAt),
        billSentAt: tsToMs(cy.billSentAt), receivedAt: tsToMs(cy.receivedAt),
      };
      const order = validateMilestoneOrder(step, anchors);
      let overrideApplied = false;
      if (!order.ok) {
        if (!override || !isStr(override.reason)) {
          throw new ApiError(409, `${order.reason}. Supply override.reason to proceed out of order.`, { prereq: order.prereq });
        }
        overrideApplied = true;
      }

      const now = FieldValue.serverTimestamp();
      const patch: Record<string, unknown> = {};
      const setTsOrNow = (field: string, key: string) => {
        const t = optTs(payload, key);
        patch[field] = t ?? Timestamp.now();
      };

      // Per-step field writes (only the step's own fields).
      switch (step) {
        case 2:
          setTsOrNow("dataSharedAt", "dataSharedAt");
          patch.dataSharedTo = optStr(payload, "dataSharedTo");
          patch.reportingMonth = optStr(payload, "reportingMonth") ?? cy.reportingMonth ?? monthOf(tsToMs(cy.disbursementDate) ?? Date.now());
          patch.sharingMode = payload.sharingMode === "PORTAL" ? "PORTAL" : "MAIL";
          break;
        case 3:
          setTsOrNow("confirmationRaisedAt", "confirmationRaisedAt");
          patch.confirmationRaisedFrom = optStr(payload, "confirmationRaisedFrom");
          patch.bankSmAddressed = optStr(payload, "bankSmAddressed");
          if (payload.connectorCaseRef !== undefined) patch.connectorCaseRef = optStr(payload, "connectorCaseRef");
          break;
        case 4:
          setTsOrNow("bankerConfirmedAt", "bankerConfirmedAt");
          { const by = payload.bankerConfirmedBy as Record<string, unknown> | null;
            patch.bankerConfirmedBy = by && isStr(by.name) ? { name: String(by.name).trim(), email: String(by.email ?? "").trim() } : null; }
          patch.confirmedAmount = optMoney(payload, "confirmedAmount");
          patch.confirmedDsaCode = optStr(payload, "confirmedDsaCode");
          patch.pddStatusAtConfirmation = optStr(payload, "pddStatusAtConfirmation");
          break;
        case 5:
          patch.pddOtcClearedMonth = optStr(payload, "pddOtcClearedMonth");
          patch.holdFlag = payload.holdFlag === true;
          patch.holdReason = payload.holdFlag === true ? optStr(payload, "holdReason") : null;
          break;
        case 6:
          setTsOrNow("payoutConfirmedAt", "payoutConfirmedAt");
          patch.confirmedPayoutPct = optPct(payload, "confirmedPayoutPct");
          patch.confirmedGross = optMoney(payload, "confirmedGross");
          break;
        case 7:
          patch.billNo = optStr(payload, "billNo");
          patch.billDate = optTs(payload, "billDate") ?? Timestamp.now();
          patch.billGross = optMoney(payload, "billGross");
          patch.billGst = optMoney(payload, "billGst");
          patch.billGstin = optStr(payload, "billGstin");
          patch.billedToEntity = optStr(payload, "billedToEntity");
          setTsOrNow("billSentAt", "billSentAt");
          patch.billMode = payload.billMode === "PORTAL" ? "PORTAL" : "MAIL";
          patch.billStoragePath = optStr(payload, "billStoragePath");
          break;
        case 8:
          setTsOrNow("receivedAt", "receivedAt");
          patch.receivedNet = optMoney(payload, "receivedNet");
          patch.tdsDeducted = optMoney(payload, "tdsDeducted");
          patch.utr = optStr(payload, "utr");
          patch.receivedInAccount = optStr(payload, "receivedInAccount");
          if (payload.varianceReason !== undefined) patch.varianceReason = optStr(payload, "varianceReason");
          break;
        case 9:
          patch.subDsaBillNo = optStr(payload, "subDsaBillNo");
          patch.subDsaBillDate = optTs(payload, "subDsaBillDate");
          patch.subDsaBillAmount = optMoney(payload, "subDsaBillAmount");
          patch.subDsaApprovedBy = optStr(payload, "subDsaApprovedBy") ?? caller.fapl;
          setTsOrNow("subDsaPaidAt", "subDsaPaidAt");
          patch.subDsaPaidAmount = optMoney(payload, "subDsaPaidAmount");
          patch.subDsaTds = optMoney(payload, "subDsaTds");
          patch.subDsaUtr = optStr(payload, "subDsaUtr");
          break;
        case 10: {
          const merged0 = { ...cy, ...patch };
          const close = canClose(!!cy.subDsaId, tsToMs(merged0.receivedAt), tsToMs(merged0.subDsaPaidAt));
          if (!close.ok) throw new ApiError(422, close.reason!);
          patch.closedAt = optTs(payload, "closedAt") ?? Timestamp.now();
          break;
        }
      }

      // Dispute toggle is allowed alongside any step (or alone via step with disputeFlag).
      if (payload.disputeFlag !== undefined) {
        patch.disputeFlag = payload.disputeFlag === true;
        patch.disputeNotes = payload.disputeFlag === true ? optStr(payload, "disputeNotes") : null;
      }

      // Recompute ALL derived fields from the merged cycle (pure functions).
      const merged = { ...cy, ...patch };
      const derived = deriveCycleFields(merged);
      Object.assign(patch, derived);

      // Milestone log (append-only; records overrides with reason + actor).
      patch.milestoneLog = FieldValue.arrayUnion({
        step, by: caller.fapl, at: Timestamp.now(),
        override: overrideApplied, reason: overrideApplied ? String(override!.reason).slice(0, 500) : null,
      });

      // ── ONE batch: cycle + payout badge (login or legacy case) + MIS ──
      tx.update(cycleRef, { ...patch, ...updateAudit(caller.fapl) });
      tx.update(badgeRef, { payoutStatus: derived.status, ...updateAudit(caller.fapl) });

      // MIS mirror of the cycle's reportable fields.
      const ageingDays = (derived.ageing as { disbToReceived: number | null }).disbToReceived;
      tx.set(misRef, {
        cycleStatus: derived.status,
        bankerConfirmedAt: merged.bankerConfirmedAt ?? null,
        pddOtcClearedMonth: merged.pddOtcClearedMonth ?? null,
        billNo: merged.billNo ?? null, billDate: merged.billDate ?? null, billGross: merged.billGross ?? null,
        receivedAt: merged.receivedAt ?? null, receivedNet: merged.receivedNet ?? null,
        tdsDeducted: merged.tdsDeducted ?? null, utr: merged.utr ?? null,
        subDsaPaidAmount: merged.subDsaPaidAmount ?? null, subDsaPaidAt: merged.subDsaPaidAt ?? null, subDsaUtr: merged.subDsaUtr ?? null,
        netMargin: derived.netMarginRealised, ageingDays,
        updatedAt: now,
      }, { merge: true });

      return { status: derived.status, overrideApplied };
    });

    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: `crm2_milestone_step${step}`,
      targetPath: `/payoutCycles/${req.params.id}`, after: result, at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, ...result });
  }));

  // ─── GET /api/crm2/payout-cycles?status&connectorId&stuckDays ────────────────
  app.get("/api/crm2/payout-cycles", route(async (req, res) => {
    const caller = await requirePerm(req, res, "payout.read");
    if (!caller) return;
    let q: FirebaseFirestore.Query = db.collection("payoutCycles");
    if (isStr(req.query.status)) q = q.where("status", "==", req.query.status);
    if (isStr(req.query.connectorId)) q = q.where("connectorId", "==", req.query.connectorId);
    const snap = await q.limit(500).get();
    const showMoney = await callerHasPerm(caller.uid, "payout.amounts.read");
    let rows = snap.docs.map((d) => sanitizeCycle({ id: d.id, ...(d.data() as Record<string, unknown>) }, showMoney));
    const stuckDays = Number(req.query.stuckDays);
    if (!isNaN(stuckDays) && stuckDays > 0) {
      const cutoff = Date.now() - stuckDays * 86400000;
      rows = rows.filter((r) => {
        const disb = tsToMs((r as Record<string, unknown>).disbursementDate);
        const received = tsToMs((r as Record<string, unknown>).receivedAt);
        return disb != null && received == null && disb < cutoff;
      });
    }
    res.json({ ok: true, cycles: rows });
  }));

  // Strip money fields from a cycle for callers lacking payout.amounts.read.
  const MONEY_CYCLE_FIELDS = [
    "disbursedAmount", "finvastraPayoutPct", "expectedGross", "subDsaPayoutPct", "subDsaExpected",
    "expectedTdsPct", "confirmedAmount", "confirmedPayoutPct", "confirmedGross", "billGross", "billGst",
    "receivedNet", "tdsDeducted", "subDsaBillAmount", "subDsaPaidAmount", "subDsaTds", "amountVariance", "netMarginRealised",
  ];
  function sanitizeCycle(cy: Record<string, unknown>, showMoney: boolean): Record<string, unknown> {
    if (showMoney) return cy;
    const out = { ...cy };
    for (const f of MONEY_CYCLE_FIELDS) if (f in out) out[f] = null;
    return out;
  }
  async function callerHasPerm(uid: string, key: string): Promise<boolean> {
    const snap = await db.collection("users").doc(uid).get();
    const u = snap.data();
    return u?.role === "admin" || u?.perms?.[key] === true;
  }

  // ─── GET /api/crm2/payout-cycles/:id — single cycle (money-stripped per perm) ─
  // The Payout tab uses this so payout.read users see milestone dates + status
  // without money, while payout.amounts.read users get the full cycle.
  app.get("/api/crm2/payout-cycles/:id", route(async (req, res) => {
    const caller = await requirePerm(req, res, "payout.read");
    if (!caller) return;
    const snap = await db.collection("payoutCycles").doc(req.params.id).get();
    if (!snap.exists) throw new ApiError(404, `${req.params.id} not found`);
    const showMoney = await callerHasPerm(caller.uid, "payout.amounts.read");
    res.json({ ok: true, cycle: sanitizeCycle({ id: snap.id, ...(snap.data() as Record<string, unknown>) }, showMoney) });
  }));

  // ─── GET /api/crm2/mis?month&connectorId&rmId — grid feed ────────────────────
  app.get("/api/crm2/mis", route(async (req, res) => {
    const caller = await requirePerm(req, res, "mis.read");
    if (!caller) return;
    let q: FirebaseFirestore.Query = db.collection("misRecords");
    if (isStr(req.query.month)) q = q.where("reportingMonth", "==", req.query.month);
    if (isStr(req.query.connectorId)) q = q.where("connectorId", "==", req.query.connectorId);
    if (isStr(req.query.rmId)) q = q.where("handlingRmId", "==", req.query.rmId);
    const snap = await q.limit(1000).get();
    const showMoney = await callerHasPerm(caller.uid, "payout.amounts.read");
    const MONEY_MIS = ["disbursedAmount", "expectedGross", "finvastraPayoutPct", "billGross", "receivedNet", "tdsDeducted", "subDsaPayoutPct", "subDsaPaidAmount", "netMargin"];
    const rows = snap.docs.map((d) => {
      const r = { id: d.id, ...(d.data() as Record<string, unknown>) };
      if (!showMoney) for (const f of MONEY_MIS) if (f in r) r[f] = null;
      return r;
    });
    res.json({ ok: true, records: rows });
  }));

  // Shared builder for the business sheet (records + xlsx buffer). The sheet
  // inherently contains money (Disbursed / Bill Gross / Received Net / TDS /
  // Net Margin), so both callers gate on payout.amounts.read (spec §12).
  async function buildBusinessSheet(month: string, connectorId: string | null): Promise<{ records: Array<Record<string, unknown>>; buf: Buffer }> {
    let q: FirebaseFirestore.Query = db.collection("misRecords").where("reportingMonth", "==", month);
    if (connectorId) q = q.where("connectorId", "==", connectorId);
    const snap = await q.get();
    const records = snap.docs.map((d) => d.data() as Record<string, unknown>);

    const XLSX = await import("xlsx");
    const rows = records.map((r) => ({
      "Case ID": r.caseId, "Party": r.partyName, "City": r.city, "State": r.state,
      "Product": r.productCode, "Lender": r.lenderName, "Connector": r.connectorName, "DSA Code": r.dsaCode,
      "Sub-DSA": r.subDsaName ?? "", "RM": r.handlingRmName,
      "Loan A/C": r.loanAccountNo ?? "", "App No": r.bankApplicationNo ?? "",
      "Disbursed": r.disbursedAmount, "Disb Date": r.disbursementDate ? new Date(tsToMs(r.disbursementDate)!).toISOString().slice(0, 10) : "",
      "Payout %": r.finvastraPayoutPct, "Expected Gross": r.expectedGross,
      "Bill No": r.billNo ?? "", "Bill Gross": r.billGross ?? "",
      "Received Net": r.receivedNet ?? "", "TDS": r.tdsDeducted ?? "", "UTR": r.utr ?? "",
      "Net Margin": r.netMargin ?? "", "Status": r.cycleStatus, "Ageing (d)": r.ageingDays ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `MIS ${month}`);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return { records, buf };
  }

  // ─── GET /api/crm2/mis/business-sheet?month&connectorId — PURE download ──────
  // No state mutation on GET. The share action (which stamps dataSharedAt on the
  // cycles) lives on POST /api/crm2/mis/business-sheet/share.
  app.get("/api/crm2/mis/business-sheet", route(async (req, res) => {
    const caller = await requirePerm(req, res, "payout.amounts.read");
    if (!caller) return;
    const month = reqStr(req.query as Record<string, unknown>, "month");
    const connectorId = isStr(req.query.connectorId) ? String(req.query.connectorId) : null;
    const { buf } = await buildBusinessSheet(month, connectorId);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="MIS-${month}${connectorId ? "-" + connectorId : ""}.xlsx"`);
    res.send(buf);
  }));

  // ─── POST /api/crm2/mis/business-sheet/share — stamp dataSharedAt + return sheet ─
  // Mutates the included cycles (dataSharedAt/dataSharedTo/reportingMonth), so the
  // caller must hold payout.amounts.read (money artifact) AND payout.write (the
  // mutation). Body: { month, connectorId?, dataSharedTo? }.
  app.post("/api/crm2/mis/business-sheet/share", route(async (req, res) => {
    const caller = await requirePerm(req, res, "payout.amounts.read");
    if (!caller) return;
    if (!(await callerHasPerm(caller.uid, "payout.write"))) {
      res.status(403).json({ error: "Missing permission: payout.write" }); return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const month = reqStr(b, "month");
    const connectorId = optStr(b, "connectorId");
    const { records, buf } = await buildBusinessSheet(month, connectorId);

    // Stamp dataSharedAt/dataSharedTo/reportingMonth on each included cycle in
    // ONE batch (setting the data-share anchor directly; status re-derivation for
    // shared cycles happens on their next milestone write — data-share alone
    // doesn't change the derived status rung).
    const dataSharedTo = optStr(b, "dataSharedTo") ?? (connectorId ?? "aggregator");
    const batch = db.batch();
    let stamped = 0;
    for (const r of records) {
      const cycleId = r.payoutCycleId as string | undefined;
      if (!cycleId) continue;
      const cRef = db.collection("payoutCycles").doc(cycleId);
      batch.update(cRef, {
        dataSharedAt: FieldValue.serverTimestamp(), dataSharedTo, reportingMonth: month, sharingMode: "MAIL",
        ...updateAudit(caller.fapl),
      });
      stamped++;
    }
    if (stamped > 0) await batch.commit();
    await db.collection("audit_logs").add({
      actor: caller.uid, actorFapl: caller.fapl, action: "crm2_business_sheet_share",
      targetPath: `/misRecords (month ${month}${connectorId ? `, connector ${connectorId}` : ""})`,
      after: { shared: stamped, dataSharedTo }, at: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, shared: stamped, month, base64: buf.toString("base64") });
  }));

  // ═══ Phase 4 — Scheduled jobs (Cloud Scheduler → OIDC, or admin) ══════════════
  // Config-driven thresholds in app_config/crm2_settings:
  //   { reminderDataShareDays: 7, reminderBankerConfirmDays: 10 }

  async function requireSchedulerOrAdmin(req: express.Request, res: express.Response): Promise<{ fapl: string } | null> {
    if (await verifyScheduler(req)) return { fapl: "scheduler" };
    const decoded = await decodeToken(req);
    if (!decoded) { res.status(401).json({ error: "Unauthorized" }); return null; }
    const u = (await db.collection("users").doc(decoded.uid).get()).data();
    if (decoded.role !== "admin" && u?.role !== "admin") { res.status(403).json({ error: "Admin or scheduler only" }); return null; }
    return { fapl: await resolveFapl(decoded.uid) };
  }

  async function crm2Settings(): Promise<{ reminderDataShareDays: number; reminderBankerConfirmDays: number }> {
    const snap = await db.collection("app_config").doc("crm2_settings").get();
    const d = snap.data() ?? {};
    return {
      reminderDataShareDays: (d.reminderDataShareDays as number | undefined) ?? 7,
      reminderBankerConfirmDays: (d.reminderBankerConfirmDays as number | undefined) ?? 10,
    };
  }

  // Global on/off per automated notification (super-admin Notifications settings page).
  // Default ENABLED unless the key is explicitly false. Cached 60s.
  let _notifCache: { at: number; data: Record<string, boolean> } | null = null;
  async function notificationsEnabled(key: string): Promise<boolean> {
    const now = Date.now();
    if (!_notifCache || now - _notifCache.at > 60_000) {
      try {
        const snap = await db.collection("app_config").doc("notification_settings").get();
        _notifCache = { at: now, data: (snap.data() ?? {}) as Record<string, boolean> };
      } catch { _notifCache = { at: now, data: {} }; }
    }
    return _notifCache.data[key] !== false;
  }

  /** Resolve a FAPL code → uid for notification targeting (best-effort). */
  async function faplToUid(fapl: string): Promise<string | null> {
    const snap = await db.collection("users").where("employeeId", "==", fapl).limit(1).get();
    return snap.empty ? null : snap.docs[0].id;
  }
  async function notify(uid: string, payload: Record<string, unknown>): Promise<void> {
    await db.collection("notifications").doc(uid).collection("items").add({
      ...payload, read: false, createdAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
  }

  // ─── POST /api/crm2/jobs/run-payout-reminders ────────────────────────────────
  app.post("/api/crm2/jobs/run-payout-reminders", route(async (req, res) => {
    const caller = await requireSchedulerOrAdmin(req, res);
    if (!caller) return;
    if (!(await notificationsEnabled("payout_reminders"))) { res.json({ ok: true, skipped: "notifications_disabled" }); return; }
    const cfg = await crm2Settings();
    const now = Date.now();

    // Open cycles only (not received/closed/disputed).
    const snap = await db.collection("payoutCycles")
      .where("status", "in", ["AWAITING_DATA_SHARE", "CONFIRMATION_RAISED", "BANKER_CONFIRMED", "PDD_OTC_HOLD", "PAYOUT_CONFIRMED", "BILLED"]).get();

    // Idempotency: claim a per-cycle-per-kind-per-day marker via an atomic
    // create-if-absent (deterministic doc id). A second run the same day finds
    // the marker already present and skips the notify — re-running yields 0 new
    // tasks. (Matches the /follow_up_logs dedup pattern.)
    const dayStr = new Date(now).toISOString().slice(0, 10);
    const claimReminder = async (cycleId: string, kind: "datashare" | "banker"): Promise<boolean> => {
      const ref = db.collection("crm2_reminder_logs").doc(`${cycleId}_${kind}_${dayStr}`);
      try {
        await ref.create({ cycleId, kind, day: dayStr, sentAt: FieldValue.serverTimestamp() });
        return true;
      } catch {
        return false; // ALREADY_EXISTS → already sent today
      }
    };

    let dataShareDue = 0, bankerDue = 0;
    const uidCache = new Map<string, string | null>();
    for (const d of snap.docs) {
      const cy = d.data();
      const disbMs = tsToMs(cy.disbursementDate);
      const caseId = cy.caseId as string;
      // Find the handling RM via the MIS record (keyed by loginId in the per-login
      // model; legacy per-case cycles fall back to caseId).
      const mis = (await db.collection("misRecords").doc((cy.loginId as string) ?? caseId).get()).data();
      const fapl = (mis?.handlingRmId as string | undefined) ?? null;
      if (!fapl) continue;
      if (!uidCache.has(fapl)) uidCache.set(fapl, await faplToUid(fapl));
      const uid = uidCache.get(fapl);
      if (!uid) continue;

      // (a) data not shared > X days after disbursement
      if (cy.dataSharedAt == null && disbMs != null && now - disbMs > cfg.reminderDataShareDays * 86400000
          && await claimReminder(d.id, "datashare")) {
        await notify(uid, { type: "follow_up_needed", title: "Payout: share case data",
          body: `${caseId} disbursed ${Math.floor((now - disbMs) / 86400000)}d ago — not yet shared with the aggregator`, link: `/crm/pipeline/cases/${caseId}` });
        dataShareDue++;
      }
      // (b) banker confirmation pending > Y days after confirmation raised
      const crMs = tsToMs(cy.confirmationRaisedAt);
      if (cy.bankerConfirmedAt == null && crMs != null && now - crMs > cfg.reminderBankerConfirmDays * 86400000
          && await claimReminder(d.id, "banker")) {
        await notify(uid, { type: "follow_up_needed", title: "Payout: chase banker confirmation",
          body: `${caseId} — confirmation raised ${Math.floor((now - crMs) / 86400000)}d ago, banker not yet confirmed`, link: `/crm/pipeline/cases/${caseId}` });
        bankerDue++;
      }
    }
    res.json({ ok: true, dataShareReminders: dataShareDue, bankerReminders: bankerDue, scanned: snap.size });
  }));

  // ─── POST /api/crm2/jobs/run-vault-expiry ────────────────────────────────────
  // validUntil < now → vaultDoc EXPIRED + any linked tracker rows EXPIRED.
  app.post("/api/crm2/jobs/run-vault-expiry", route(async (req, res) => {
    const caller = await requireSchedulerOrAdmin(req, res);
    if (!caller) return;
    const nowTs = Timestamp.now();
    const snap = await db.collectionGroup("vaultDocs")
      .where("status", "==", "VALID").where("validUntil", "<", nowTs).get();

    let expiredDocs = 0, expiredRows = 0;
    for (const d of snap.docs) {
      await d.ref.update({ status: "EXPIRED", updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
      expiredDocs++;
      // Expire any docTracker row across all cases that references this vault doc.
      const rows = await db.collectionGroup("docTracker").where("vaultDocId", "==", d.id).get();
      for (const r of rows.docs) {
        await r.ref.update({ status: "EXPIRED", updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
        expiredRows++;
      }
    }
    res.json({ ok: true, expiredVaultDocs: expiredDocs, expiredTrackerRows: expiredRows });
  }));

  // ═══ Phase 5 — Reconciliation, snapshots, dashboards ══════════════════════════

  // Column auto-detection on the dump header row (loanAccountNo / bankApplicationNo
  // / dsaCode / amount / date). Tolerant of common header variants.
  const COL_HINTS: Record<string, string[]> = {
    loanAccountNo:     ["loan account", "loan a/c", "loan acc", "account no", "loan no", "lan"],
    bankApplicationNo: ["application no", "app no", "application", "appl no"],
    dsaCode:           ["dsa code", "dsa", "code", "channel code"],
    amount:            ["disbursed", "disbursal", "amount", "loan amount", "sanction amount"],
    date:              ["disbursement date", "disb date", "date", "disbursal date"],
  };
  function detectReconCols(headers: string[]): Record<string, number> {
    const map: Record<string, number> = {};
    headers.forEach((h, i) => {
      const hl = String(h).toLowerCase().trim();
      for (const [field, hints] of Object.entries(COL_HINTS)) {
        if (map[field] === undefined && hints.some((kw) => hl.includes(kw))) map[field] = i;
      }
    });
    return map;
  }
  const cellNum = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[,\s₹]/g, ""));
    return isNaN(n) ? null : n;
  };
  const cellDate = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    if (typeof v === "number") {
      // xlsx serial date (days since 1899-12-30)
      if (v > 20000 && v < 60000) return Math.round((v - 25569) * 86400000);
    }
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d.getTime();
  };

  // ─── POST /api/crm2/recon/imports — upload dump → bankMisImports + rows + match ─
  // Mutation (creates the import + rows) → recon.write; reads stay recon.read.
  app.post("/api/crm2/recon/imports", route(async (req, res) => {
    const caller = await requirePerm(req, res, "recon.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const connectorId = reqStr(b, "connectorId");
    const reportingMonth = reqStr(b, "reportingMonth");   // YYYY-MM
    const fileBase64 = reqStr(b, "fileBase64");
    const fileName = optStr(b, "fileName") ?? "dump.xlsx";

    // Parse via the xlsx library (handles xlsx AND csv) — reuses the existing dep.
    const XLSX = await import("xlsx");
    const wb = XLSX.read(Buffer.from(fileBase64, "base64"), { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as unknown[][];
    if (grid.length < 2) throw new ApiError(400, "Dump has no data rows");
    const headers = (grid[0] as unknown[]).map((h) => String(h ?? ""));
    const cols = detectReconCols(headers);
    if (cols.loanAccountNo === undefined && cols.bankApplicationNo === undefined && cols.dsaCode === undefined) {
      throw new ApiError(400, "Could not detect any of loan account / application no / DSA code columns in the dump header");
    }

    // misRecords for this connector + month (the candidate set to match against).
    // Per-login model: one misRecord PER DISBURSED LOGIN (doc id == loginId), so a
    // case with two disbursed logins has TWO entries. Matching is keyed strictly by
    // the misRecord id (never by caseId, which is ambiguous across logins) — the
    // MisLite.caseId slot carries the misRecord id for the matcher, and misMeta maps
    // it back to the real caseId/loginId for display + dispute.
    const misSnap = await db.collection("misRecords")
      .where("connectorId", "==", connectorId).where("reportingMonth", "==", reportingMonth).get();
    const misMeta = new Map<string, { caseId: string; loginId: string | null; loanAccountNo: string | null }>();
    const misBook: MisLite[] = misSnap.docs.map((d) => {
      const m = d.data();
      misMeta.set(d.id, {
        caseId: (m.caseId as string | undefined) ?? d.id,
        loginId: (m.loginId as string | undefined) ?? null,
        loanAccountNo: (m.loanAccountNo as string | null) ?? null,
      });
      return {
        caseId: d.id,   // the misRecord id (== loginId per-login; == caseId legacy) — the unambiguous match key
        loanAccountNo: (m.loanAccountNo as string | null) ?? null,
        bankApplicationNo: (m.bankApplicationNo as string | null) ?? null,
        dsaCode: (m.dsaCode as string) ?? "",
        disbursedAmount: Number(m.disbursedAmount ?? 0),
        disbursementDateMs: tsToMs(m.disbursementDate) ?? 0,
      };
    });

    const importRef = db.collection("bankMisImports").doc();
    const dataRows = grid.slice(1);
    const get = (r: unknown[], f: string) => cols[f] !== undefined ? r[cols[f]] : null;

    let matched = 0, unmatched = 0;
    const matchedMisIds = new Set<string>();
    // Batch the row writes (chunks of 400 to stay under the 500-op limit).
    let batch = db.batch(); let ops = 0;
    const flush = async () => { if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; } };

    for (let i = 0; i < dataRows.length; i++) {
      const r = dataRows[i];
      const dump: DumpRow = {
        rowIndex: i + 2,
        loanAccountNo: get(r, "loanAccountNo") != null ? String(get(r, "loanAccountNo")).trim() : null,
        bankApplicationNo: get(r, "bankApplicationNo") != null ? String(get(r, "bankApplicationNo")).trim() : null,
        dsaCode: get(r, "dsaCode") != null ? String(get(r, "dsaCode")).trim() : null,
        amount: cellNum(get(r, "amount")),
        dateMs: cellDate(get(r, "date")),
      };
      const m = matchDumpRow(dump, misBook);
      // m.caseId is the misRecord id (see misBook build) — resolve the real case/login.
      const hit = m.matchType !== "none" ? misMeta.get(m.caseId!) ?? null : null;
      if (m.matchType !== "none") { matched++; matchedMisIds.add(m.caseId!); } else unmatched++;

      const rowRef = importRef.collection("rows").doc();
      batch.set(rowRef, {
        rowIndex: dump.rowIndex,
        loanAccountNo: dump.loanAccountNo, bankApplicationNo: dump.bankApplicationNo,
        dsaCode: dump.dsaCode, amount: dump.amount,
        dateMs: dump.dateMs, dateIso: dump.dateMs ? new Date(dump.dateMs).toISOString().slice(0, 10) : null,
        matched: m.matchType !== "none", matchType: m.matchType,
        matchedCaseId: hit?.caseId ?? null,
        matchedMisId: m.matchType !== "none" ? m.caseId : null,   // misRecord id (== loginId per-login)
        matchedLoginId: hit?.loginId ?? null,
        amountVariance: m.amountVariance,
        manualOverride: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      ops++;
      if (ops >= 400) await flush();
    }
    await flush();

    // Entries in our MIS for this month/connector that the dump did NOT match —
    // per misRecord (i.e. per disbursed LOGIN), so a case whose first login matched
    // but second didn't still surfaces the missing login. missingCaseIds (unique
    // case ids) is kept for back-compat; missingEntries carries the loginId the
    // dispute endpoint needs to disambiguate multi-login cases.
    const missingEntries = misBook
      .filter((m) => !matchedMisIds.has(m.caseId))
      .map((m) => {
        const meta = misMeta.get(m.caseId)!;
        return { misId: m.caseId, caseId: meta.caseId, loginId: meta.loginId, loanAccountNo: meta.loanAccountNo };
      });
    const missingCaseIds = [...new Set(missingEntries.map((e) => e.caseId))];

    await importRef.set({
      connectorId, reportingMonth, fileName,
      totalRows: dataRows.length, matchedRows: matched, unmatchedRows: unmatched,
      misCaseCount: misBook.length, missingCaseIds, missingEntries,
      detectedColumns: cols,
      importedBy: caller.fapl, importedAt: FieldValue.serverTimestamp(),
      ...createAudit(caller.fapl),
    });
    res.json({ ok: true, importId: importRef.id, totalRows: dataRows.length, matched, unmatched, missingCaseIds, missingEntries });
  }));

  // ─── GET /api/crm2/recon/imports/:id — import + its rows ─────────────────────
  app.get("/api/crm2/recon/imports/:id", route(async (req, res) => {
    const caller = await requirePerm(req, res, "recon.read");
    if (!caller) return;
    const imp = await db.collection("bankMisImports").doc(req.params.id).get();
    if (!imp.exists) throw new ApiError(404, "Import not found");
    const rowsSnap = await db.collection("bankMisImports").doc(req.params.id).collection("rows").orderBy("rowIndex").get();
    const showMoney = await callerHasPerm(caller.uid, "payout.amounts.read");
    const rows = rowsSnap.docs.map((d) => {
      const r: Record<string, unknown> = { id: d.id, ...(d.data() as Record<string, unknown>) };
      if (!showMoney) { r.amount = null; r.amountVariance = null; }
      return r;
    });
    res.json({ ok: true, import: { id: imp.id, ...imp.data() }, rows });
  }));

  // ─── PATCH /api/crm2/recon/imports/:id/rows/:rowId — manual match/unmatch ─────
  // Mutation → recon.write (recon.read is the read key; admins implicit as always).
  app.patch("/api/crm2/recon/imports/:id/rows/:rowId", route(async (req, res) => {
    const caller = await requirePerm(req, res, "recon.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ref = db.collection("bankMisImports").doc(req.params.id).collection("rows").doc(req.params.rowId);
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, "Row not found");

    if (b.action === "match") {
      const caseId = reqStr(b, "caseId");
      // Per-login: misRecords are keyed by loginId (one per disbursed login). Accept
      // the misRecord id (loginId) directly — unambiguous — or a caseId. A caseId
      // that maps to MORE than one misRecord (multi-login case) is ambiguous:
      // 409 listing the candidate loginIds instead of guessing.
      let misId: string;
      let misData = (await db.collection("misRecords").doc(caseId).get()).data();
      if (misData) {
        misId = caseId;
      } else {
        const byCase = await db.collection("misRecords").where("caseId", "==", caseId).get();
        if (byCase.empty) throw new ApiError(400, `misRecord for ${caseId} not found`);
        if (byCase.size > 1) {
          throw new ApiError(409,
            `${caseId} has ${byCase.size} disbursed logins — pass the specific loginId (candidates: ${byCase.docs.map((d) => d.id).join(", ")})`,
            { kind: "AMBIGUOUS_CASE", candidates: byCase.docs.map((d) => d.id) });
        }
        misId = byCase.docs[0].id;
        misData = byCase.docs[0].data();
      }
      const realCaseId = (misData.caseId as string | undefined) ?? misId;
      const amount = snap.data()!.amount as number | null;
      const variance = amount != null ? Math.round(amount - Number(misData.disbursedAmount ?? 0)) : null;
      await ref.update({
        matched: true, matchType: "manual", matchedCaseId: realCaseId,
        matchedMisId: misId, matchedLoginId: (misData.loginId as string | undefined) ?? null,
        amountVariance: variance, manualOverride: true, updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (b.action === "unmatch") {
      await ref.update({ matched: false, matchType: "none", matchedCaseId: null, matchedMisId: null, matchedLoginId: null, amountVariance: null, manualOverride: true, updatedAt: FieldValue.serverTimestamp() });
    } else {
      throw new ApiError(400, "action must be 'match' or 'unmatch'");
    }
    res.json({ ok: true });
  }));

  // ─── POST /api/crm2/recon/dispute — flag a case missing from the dump ────────
  // Sets disputeFlag on the payout cycle ("missing in connector's bank MIS dump").
  app.post("/api/crm2/recon/dispute", route(async (req, res) => {
    const caller = await requirePerm(req, res, "payout.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const caseId = reqStr(b, "caseId");
    const note = optStr(b, "note") ?? "Missing in connector's bank MIS dump";

    // Per-login: a case may have several cycles (one per disbursed login). An
    // optional loginId narrows to one; WITHOUT it, a multi-cycle case is ambiguous
    // → 409 listing the candidates instead of disputing an arbitrary cycle.
    const loginId = optStr(b, "loginId");
    let cq = db.collection("payoutCycles").where("caseId", "==", caseId);
    if (loginId) cq = cq.where("loginId", "==", loginId);
    const cycSnap = await cq.get();
    if (cycSnap.empty) throw new ApiError(400, "No payout cycle for this case (not disbursed)");
    if (cycSnap.size > 1) {
      throw new ApiError(409,
        `${caseId} has ${cycSnap.size} payout cycles — pass loginId to pick one (candidates: ${cycSnap.docs.map((d) => `${d.id}/${d.data().loginId ?? "—"}`).join(", ")})`,
        { kind: "AMBIGUOUS_CASE", candidates: cycSnap.docs.map((d) => ({ cycleId: d.id, loginId: (d.data().loginId as string | undefined) ?? null })) });
    }
    const cycleRef = cycSnap.docs[0].ref;
    const cycleId = cycSnap.docs[0].id;
    const cyLoginId = cycSnap.docs[0].data().loginId as string | undefined;

    await db.runTransaction(async (tx) => {
      const cy = await tx.get(cycleRef);
      if (!cy.exists) throw new ApiError(404, "Cycle not found");
      const merged = { ...cy.data()!, disputeFlag: true, disputeNotes: note };
      const derived = deriveCycleFields(merged);
      tx.update(cycleRef, { disputeFlag: true, disputeNotes: note, status: derived.status, ...updateAudit(caller.fapl) });
      // Badge on the login (per-login) or the case (legacy); MIS keyed by loginId.
      const badgeRef = cyLoginId ? db.collection("cases").doc(caseId).collection("logins").doc(cyLoginId) : db.collection("cases").doc(caseId);
      tx.update(badgeRef, { payoutStatus: derived.status, ...updateAudit(caller.fapl) });
      tx.set(db.collection("misRecords").doc(cyLoginId ?? caseId), { cycleStatus: derived.status, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    await db.collection("audit_logs").add({ actor: caller.uid, actorFapl: caller.fapl, action: "crm2_recon_dispute", targetPath: `/payoutCycles/${cycleId}`, at: FieldValue.serverTimestamp() });
    res.json({ ok: true, cycleId });
  }));

  // ─── POST /api/crm2/jobs/run-recon-snapshots — monthly, idempotent ──────────
  // Builds reconSnapshots/{YYYY-MM_connectorId} (deterministic id → re-running
  // OVERWRITES, never duplicates). Body { month } or defaults to last month.
  app.post("/api/crm2/jobs/run-recon-snapshots", route(async (req, res) => {
    const caller = await requireSchedulerOrAdmin(req, res);
    if (!caller) return;
    const month = isStr((req.body ?? {}).month) ? String((req.body as Record<string, unknown>).month) : (() => {
      const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
    const now = Date.now();

    // All cycles whose reporting month == this month (reportingMonth on the MIS;
    // the cycle stores disbursementDate — group by its YYYY-MM).
    const misSnap = await db.collection("misRecords").where("reportingMonth", "==", month).get();
    // connectorId → [{ caseId, cycleId }] (per-login: misRecord id is loginId; read
    // the cycle via the misRecord's stored payoutCycleId, not a derived id).
    const byConnector = new Map<string, Array<{ caseId: string; cycleId: string }>>();
    for (const d of misSnap.docs) {
      const m = d.data();
      const conn = m.connectorId as string;
      if (!byConnector.has(conn)) byConnector.set(conn, []);
      byConnector.get(conn)!.push({ caseId: (m.caseId as string | undefined) ?? d.id, cycleId: m.payoutCycleId as string });
    }

    let snapshots = 0;
    for (const [connectorId, entries] of byConnector) {
      const cycles: CycleLite[] = [];
      for (const { caseId, cycleId } of entries) {
        if (!cycleId) continue;
        const cySnap = await db.collection("payoutCycles").doc(cycleId).get();
        if (!cySnap.exists) continue;
        const c = cySnap.data()!;
        cycles.push({
          caseId,
          status: c.status as string,
          disbursedAmount: Number(c.disbursedAmount ?? 0),
          expectedGross: Number(c.expectedGross ?? 0),
          billGross: c.billGross != null ? Number(c.billGross) : null,
          receivedNet: c.receivedNet != null ? Number(c.receivedNet) : null,
          tdsDeducted: c.tdsDeducted != null ? Number(c.tdsDeducted) : null,
          subDsaExpected: c.subDsaExpected != null ? Number(c.subDsaExpected) : null,
          subDsaPaidAmount: c.subDsaPaidAmount != null ? Number(c.subDsaPaidAmount) : null,
          netMarginRealised: c.netMarginRealised != null ? Number(c.netMarginRealised) : null,
          disputeFlag: c.disputeFlag === true,
          bankerConfirmedAt: tsToMs(c.bankerConfirmedAt),
          confirmationRaisedAt: tsToMs(c.confirmationRaisedAt),
        });
      }
      const snap = computeSnapshot(cycles, now);
      // Deterministic id → idempotent overwrite.
      await db.collection("reconSnapshots").doc(`${month}_${connectorId}`).set({
        month, connectorId, ...snap,
        tdsCertificateStatus: "pending",   // certificate-status field (spec §7.2)
        generatedAt: FieldValue.serverTimestamp(), generatedBy: caller.fapl,
      });
      snapshots++;
    }
    res.json({ ok: true, month, snapshots });
  }));

  // ─── GET /api/crm2/dashboards?period=YYYY-MM — all Pipeline dashboards ───────
  // Money sections are stripped server-side unless the caller holds
  // payout.amounts.read. Figures are computed by reading the period's
  // misRecords/cycles and aggregating in-process (no rollups are stored on any
  // master doc); the receivables totals are the direct sums over misRecords, so
  // they tie out to an independent sum for the same month + connector.
  app.get("/api/crm2/dashboards", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.read");
    if (!caller) return;
    const period = isStr(req.query.period) ? String(req.query.period)
      : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const showMoney = await callerHasPerm(caller.uid, "payout.amounts.read");
    const now = Date.now();

    const [leadsSnap, casesSnap, misSnap, cyclesSnap] = await Promise.all([
      db.collection("leads").get(),
      db.collection("cases").get(),
      db.collection("misRecords").where("reportingMonth", "==", period).get(),
      db.collection("payoutCycles").get(),
    ]);

    // ── Leads funnel (new-model leads carry `category`) ──
    const inc = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };
    const funnel = { byStatus: {} as Record<string, number>, bySource: {} as Record<string, number>, byCategory: {} as Record<string, number> };
    const rmLeads: Record<string, { handled: number; converted: number }> = {};
    let totalLeads = 0, qualified = 0, converted = 0;
    for (const d of leadsSnap.docs) {
      const l = d.data();
      if (l.category === undefined || l.receivedAt === undefined) continue;  // legacy lead — skip
      totalLeads++;
      inc(funnel.byStatus, String(l.status ?? "NEW"));
      inc(funnel.bySource, String(l.source ?? "—"));
      inc(funnel.byCategory, String(l.category ?? "GENERAL"));
      if (l.status === "QUALIFIED") qualified++;
      if (l.converted === true) converted++;
      const rm = (l.assignedRm as string | null) ?? "unassigned";
      rmLeads[rm] ??= { handled: 0, converted: 0 };
      rmLeads[rm].handled++; if (l.converted === true) rmLeads[rm].converted++;
    }

    // ── Pipeline by stage (count + requested value, with ageing) ──
    const STAGES = ["OPENED", "ELIGIBILITY", "DOC_COLLECTION", "CODE_ASSIGNMENT", "LOGIN", "UNDER_PROCESS", "SANCTIONED", "DISBURSED", "PDD_OTC", "CLOSED"];
    const pipeline = STAGES.map((s) => ({ stage: s, count: 0, value: 0, ageSumDays: 0 }));
    const pIdx = Object.fromEntries(STAGES.map((s, i) => [s, i]));
    for (const d of casesSnap.docs) {
      const c = d.data();
      const i = pIdx[c.stage as string]; if (i === undefined) continue;
      pipeline[i].count++;
      pipeline[i].value += Number(c.amountRequested ?? 0);
      const openedMs = tsToMs(c.keyDates?.opened) ?? null;
      if (openedMs) pipeline[i].ageSumDays += Math.floor((now - openedMs) / 86400000);
    }
    const pipelineOut = pipeline.map((p) => ({ stage: p.stage, count: p.count, value: p.value, avgAgeDays: p.count ? Math.round(p.ageSumDays / p.count) : 0 }));

    // ── Disbursement / receivables / margin from the period's misRecords ──
    const groupSum = () => ({ count: 0, disbursed: 0, expected: 0, billed: 0, received: 0, margin: 0 });
    const byConnector: Record<string, ReturnType<typeof groupSum>> = {};
    const byLender: Record<string, ReturnType<typeof groupSum>> = {};
    const byProduct: Record<string, ReturnType<typeof groupSum>> = {};
    const byRm: Record<string, ReturnType<typeof groupSum>> = {};
    const bySubDsa: Record<string, ReturnType<typeof groupSum> & { name: string }> = {};
    let totDisbursed = 0, totExpected = 0, totBilled = 0, totReceived = 0, totMargin = 0;
    const add = (g: Record<string, ReturnType<typeof groupSum>>, k: string, m: Record<string, unknown>) => {
      g[k] ??= groupSum(); const x = g[k];
      x.count++; x.disbursed += Number(m.disbursedAmount ?? 0); x.expected += Number(m.expectedGross ?? 0);
      x.billed += Number(m.billGross ?? 0); x.received += Number(m.receivedNet ?? 0); x.margin += Number(m.netMargin ?? 0);
    };
    for (const d of misSnap.docs) {
      const m = d.data();
      totDisbursed += Number(m.disbursedAmount ?? 0); totExpected += Number(m.expectedGross ?? 0);
      totBilled += Number(m.billGross ?? 0); totReceived += Number(m.receivedNet ?? 0); totMargin += Number(m.netMargin ?? 0);
      add(byConnector, String(m.connectorName ?? m.connectorId), m);
      add(byLender, String(m.lenderName ?? m.lenderId), m);
      add(byProduct, String(m.productCode ?? "—"), m);
      add(byRm, String(m.handlingRmName ?? m.handlingRmId), m);
      if (m.subDsaId) {
        const k = String(m.subDsaId);
        bySubDsa[k] ??= { ...groupSum(), name: String(m.subDsaName ?? k) };
        const x = bySubDsa[k]; x.count++; x.disbursed += Number(m.disbursedAmount ?? 0);
        x.received += Number(m.receivedNet ?? 0); x.margin += Number(m.netMargin ?? 0);
      }
      // RM performance disbursed value (period)
      const rm = String(m.handlingRmId ?? "—");
      rmLeads[rm] ??= { handled: 0, converted: 0 };
      (rmLeads[rm] as Record<string, number>).disbursed = ((rmLeads[rm] as Record<string, number>).disbursed ?? 0) + Number(m.disbursedAmount ?? 0);
      (rmLeads[rm] as Record<string, number>).revenue = ((rmLeads[rm] as Record<string, number>).revenue ?? 0) + Number(m.expectedGross ?? 0);
    }
    const receivables = Object.entries(byConnector).map(([connector, g]) => ({
      connector, expected: g.expected, billed: g.billed, received: g.received, pendingReceivable: g.expected - g.received,
    }));

    // ── Payout health (all cycles) ──
    const cycleStatusCount: Record<string, number> = {};
    let disbToRecSum = 0, disbToRecN = 0; const stuck: Array<{ caseId: string; status: string; ageDays: number }> = [];
    const STUCK_DAYS = 21;
    for (const d of cyclesSnap.docs) {
      const c = d.data();
      inc(cycleStatusCount, String(c.status));
      const disb = tsToMs(c.disbursementDate); const rec = tsToMs(c.receivedAt);
      if (disb && rec) { disbToRecSum += Math.floor((rec - disb) / 86400000); disbToRecN++; }
      if (disb && !rec && c.status !== "CLOSED" && c.status !== "SUBDSA_PAID" && (now - disb) / 86400000 > STUCK_DAYS) {
        stuck.push({ caseId: c.caseId as string, status: c.status as string, ageDays: Math.floor((now - disb) / 86400000) });
      }
    }

    // RM performance + sub-DSA scorecard (rejection rate from cases would need a
    // wider read; expose conversion + disbursed + revenue which are well-defined).
    const rmPerformance = Object.entries(rmLeads).map(([rm, v]) => {
      const vv = v as Record<string, number>;
      return { rm, leadsHandled: vv.handled ?? 0, conversionPct: vv.handled ? Math.round(((vv.converted ?? 0) / vv.handled) * 100) : 0,
               disbursedValue: vv.disbursed ?? 0, revenue: vv.revenue ?? 0 };
    });
    const subDsaScorecard = Object.entries(bySubDsa).map(([id, g]) => ({
      subDsaId: id, name: g.name, casesSourced: g.count, disbursedValue: g.disbursed, payoutMargin: g.margin,
    }));

    // Strip money for callers without payout.amounts.read.
    const stripGroup = (g: Record<string, ReturnType<typeof groupSum>>) =>
      Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { count: v.count }]));

    const out: Record<string, unknown> = {
      period,
      funnel: { ...funnel, totalLeads, qualified, converted, conversionPct: totalLeads ? Math.round((converted / totalLeads) * 100) : 0 },
      pipeline: showMoney ? pipelineOut : pipelineOut.map((p) => ({ stage: p.stage, count: p.count, avgAgeDays: p.avgAgeDays })),
      payoutHealth: { byStatus: cycleStatusCount, avgDisbToReceivedDays: disbToRecN ? Math.round(disbToRecSum / disbToRecN) : null, stuck },
    };
    if (showMoney) {
      out.disbursement = { total: { count: misSnap.size, disbursed: totDisbursed, expected: totExpected, billed: totBilled, received: totReceived },
        byConnector, byLender, byProduct, byRm };
      out.receivables = { total: { expected: totExpected, billed: totBilled, received: totReceived, pendingReceivable: totExpected - totReceived }, byConnector: receivables };
      out.margin = { total: totMargin, byConnector: Object.fromEntries(Object.entries(byConnector).map(([k, v]) => [k, v.margin])),
        byProduct: Object.fromEntries(Object.entries(byProduct).map(([k, v]) => [k, v.margin])), byRm: Object.fromEntries(Object.entries(byRm).map(([k, v]) => [k, v.margin])) };
      out.rmPerformance = rmPerformance;
      out.subDsaScorecard = subDsaScorecard;
    } else {
      out.disbursement = { total: { count: misSnap.size }, byConnector: stripGroup(byConnector), byLender: stripGroup(byLender), byProduct: stripGroup(byProduct), byRm: stripGroup(byRm) };
      out.rmPerformance = rmPerformance.map((r) => ({ rm: r.rm, leadsHandled: r.leadsHandled, conversionPct: r.conversionPct }));
      out.subDsaScorecard = subDsaScorecard.map((s) => ({ subDsaId: s.subDsaId, name: s.name, casesSourced: s.casesSourced }));
    }
    res.json({ ok: true, ...out });
  }));
}
