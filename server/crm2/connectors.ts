/**
 * server/crm2/connectors.ts - connector/sub-DSA field builders + the partner-score
 * wrapper, lifted from server/crm2.ts (2026-07-22). Pure: core validators +
 * encryptField (PAN/bank) + computePartnerScore. getPartnerRubric /
 * nextConnectorCodeServer (db) stay in crm2.ts.
 */
import { FieldValue } from "firebase-admin/firestore";
import { ApiError, MOBILE_RE, isStr, optStr, reqStr } from "./core.js";
import { encryptField } from "../../src/lib/encryption.js";
import { computePartnerScore, type PartnerRubric } from "../../src/lib/crm2/partnerScoring.js";
import { sanitizeChannelPartnerRule } from "../../src/lib/crm2/channelPartnerPayout.js";

const CONNECTOR_ENTITY_TYPES = ["INDIVIDUAL", "PROPRIETORSHIP", "PARTNERSHIP", "LLP", "PVT_LTD", "HUF"];
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

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

export { scoreFor, connectorMainFields, buildPayoutBank };
