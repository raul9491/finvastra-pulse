/**
 * server/crm2/partners.ts - partner-intake (connector funnel) enums + the
 * client-body field builders (screening/onboarding/practical) + activation gate
 * + intent detector, lifted from server/crm2.ts (2026-07-22). Pure: uses only
 * core validators + Timestamp. Scoring is recomputed elsewhere, never read here.
 */
import { Timestamp } from "firebase-admin/firestore";
import { ApiError, isStr, optStr, optBool, optEnum } from "./core.js";

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

function isPartnerIntent(category: string, formId: string | null, sourceUrl: string | null): boolean {
  if (category === "PARTNER_DSA") return true;
  const hay = ((formId ?? "") + " " + (sourceUrl ?? "")).toLowerCase();
  // "partner" catches the finvastra.com/partner page URL; the rest are the
  // page's actual form ids observed in production submissions.
  return /partner|individual[-_ ]?dsa|corporate[-_ ]?dsa|institutional|co[-_ ]?sourcing|dsa[-_ ]?code|become[-_ ]?a[-_ ]?agent/.test(hay);
}

export {
  PARTNER_FUNNEL, PARTNER_TERMINAL, PARTNER_LEAD_SOURCE, PARTNER_NETWORK_TYPE,
  PARTNER_NETWORK_SIZE, PARTNER_FIT, PARTNER_TRACK, PARTNER_VOLUME, PARTNER_KYC, PARTNER_NEXT_ACTION,
  partnerScreeningFields, partnerOnboardingFields, partnerPracticalFields, activationBlockers, isPartnerIntent,
};
