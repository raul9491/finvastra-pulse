/**
 * server/crm2/sanitizers.ts - CRM 2.0 master/entity request sanitizers (lender,
 * product, sub-product, aggregator, sub-DSA, document-def, address, client) +
 * the Sanitizer type + CONSTITUTIONS enum, lifted from server/crm2.ts (2026-07-22).
 * Pure: core validators + Timestamp + encryptField (PAN/bank) + buildDupeKeys.
 */
import { Timestamp } from "firebase-admin/firestore";
import { ApiError, PAN_RE, MOBILE_RE, isStr, reqStr, optStr, reqEnum, optNum, optTs, strArr, rejectFullAadhaar } from "./core.js";
import { encryptField } from "../../src/lib/encryption.js";
import { buildDupeKeys } from "../../src/lib/crm2/dedupe.js";

export type Sanitizer = (body: Record<string, unknown>, isCreate: boolean) => Record<string, unknown>;

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

export { sanitizeLender, sanitizeProduct, sanitizeSubProduct, sanitizeAggregator, sanitizeSubDsa, sanitizeDocumentDef, CONSTITUTIONS, sanitizeAddress, sanitizeClient };
