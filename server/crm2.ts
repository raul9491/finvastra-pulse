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
import { buildDupeKeys, normaliseMobile } from "../src/lib/crm2/dedupe.js";
import { extractClientIp } from "../src/lib/crm2/http.js";
import { verifyMetaSignature, extractLeadgenEvents, mapMetaFields, type MetaLeadgenEvent } from "../src/lib/crm2/meta.js";
import { evaluateSla, slaConfigFromDoc, toMs, type SlaConfig } from "../src/lib/crm2/sla.js";
import { DEFAULT_BUSINESS_HOURS, type BusinessHoursConfig } from "../src/lib/crm2/businessHours.js";
import { validateTransition, gateForStage, keyDateForStage } from "../src/lib/crm2/stages.js";
import { validateLoginTransition, keyDateForLoginStage, validateCaseLevelTransition, type LoginLite } from "../src/lib/crm2/logins.js";
import { deriveCycleStatus, computeAgeing, computeBankerMismatch, computePctVariance, computeAmountVariance, computeNetMarginRealised, canClose, validateMilestoneOrder, MILESTONE_STEPS, type MilestoneStep } from "../src/lib/crm2/payout.js";
import { matchDumpRow, computeSnapshot, type DumpRow, type MisLite, type CycleLite } from "../src/lib/crm2/recon.js";
import { ApiError, safeEqual, PAN_RE, MOBILE_RE, isStr, reqStr, optStr, reqEnum, optNum, optMoney, optPct, strArr, optTs, rejectFullAadhaar, optBool, optEnum, route } from "./crm2/core.js";
import { LEAD_CATEGORIES } from "./crm2/leadEnums.js";
import {
  PARTNER_FUNNEL, PARTNER_LEAD_SOURCE, PARTNER_NETWORK_TYPE, PARTNER_NETWORK_SIZE,
  PARTNER_FIT, PARTNER_TRACK, PARTNER_VOLUME, PARTNER_KYC, PARTNER_NEXT_ACTION,
  partnerScreeningFields, isPartnerIntent,
} from "./crm2/partners.js";
import {
  CONSTITUTIONS, sanitizeAddress,
} from "./crm2/sanitizers.js";
import { decodeToken, resolveFapl, requirePerm, createAudit, updateAudit, nextIdInTx, expandDocTracker } from "./crm2/context.js";
import { toResolution, pickUnambiguousMapping } from "./crm2/slabs.js";
import { scoreFor } from "./crm2/connectors.js";
import { rateLimit, findDuplicate, leadYearCounter } from "./crm2/leads.js";
import { META_MAX_ATTEMPTS, persistMetaEvent, logMetaWebhook, deadLetterMeta, fetchMetaLead, processMetaLeadgen } from "./crm2/meta.js";
import { registerWhatsAppRoutes } from "./crm2/whatsapp.js";
import { registerMastersClientRoutes } from "./crm2/mastersClients.js";
import { registerQueueRoutes } from "./crm2/queueRoutes.js";
import { registerTaskRoutes } from "./crm2/taskRoutes.js";
import { registerLeadRoutes } from "./crm2/leadRoutes.js";
import { registerMappingRoutes } from "./crm2/mappingRoutes.js";
import {
  registerConnectorRoutes, EMPTY_ONBOARDING, nextConnectorCodeServer, getPartnerRubric,
} from "./crm2/connectorRoutes.js";
import type { SlabBody } from "./crm2/slabs.js";
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


export function registerCrm2Routes(app: express.Express, { db, admin, verifyScheduler, sendBrandedEmail }: Deps): void {
  const { FieldValue, Timestamp } = admin.firestore;


  // ─── Validation helpers ──────────────────────────────────────────────────────

  /** Wrap a handler: ApiError → its status; anything else → 500. */


  // ─── DSA Code Mappings (the payout engine) ───────────────────────────────────
  // Slab edit policy (spec §11): a live slab's % is never edited in place —
  // end-date it and add a successor. Endpoints: create mapping (with initial
  // slabs), patch identity fields, add slab, end slab. Every slab change is
  // validated against overlaps before commit.

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

  // Reference data + Client Master, and the CON-### partner registry —
  // extracted to ./crm2/mastersClients.ts and ./crm2/connectorRoutes.ts
  // (2026-07-23). Both are off the money path.
  registerMastersClientRoutes(app);
  registerConnectorRoutes(app);
  // DSA-code mappings + payout slabs (admin CRUD). resolveMapping (the disburse
  // reader) stays in crm2.ts; these routes only touch the tested slab libs.
  registerMappingRoutes(app);



  // ═══ Phase 2 — Leads: public intake, internal CRUD, dedupe, convert ═══════════


  /** Firestore-transaction rate limit (multi-instance safe) — same pattern as the
   *  existing /rate_limits collection. Returns false when over the limit. */

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
      && safeEqual(req.headers["x-finvastra-webhook-secret"], process.env.WEBSITE_WEBHOOK_SECRET);

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
        deleted: false, converted: false, convertedAt: null,
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
      && safeEqual(req.headers["x-finvastra-webhook-secret"], process.env.WEBSITE_WEBHOOK_SECRET);
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
        deleted: false, converted: false, convertedAt: null,
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
        deleted: false, converted: false, convertedAt: null, status: "NEW",
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
          activityLog: [], deleted: false, converted: false, convertedAt: null,
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
    const fresh: MetaLeadgenEvent[] = [];
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

  // ─── Permission editor backend — set a user's perms map + resync claims ──────
  // Admin-only (matches the existing Permission Manager guard model).
  app.post("/api/crm2/perms/:uid", route(async (req, res) => {
    const decoded = await decodeToken(req);
    if (!decoded) { res.status(401).json({ error: "Unauthorized" }); return; }
    const callerSnap = await db.collection("users").doc(decoded.uid).get();
    if (decoded.role !== "admin" && callerSnap.data()?.role !== "admin") {
      res.status(403).json({ error: "Admin only" }); return;
    }
    // Protect super admin accounts: only another super admin can change their perms.
    const saUids = new Set(superAdminUidsFromEnv());
    if (saUids.has(req.params.uid) && !saUids.has(decoded.uid)) {
      res.status(403).json({ error: "Only a super admin can modify another super admin's permissions." }); return;
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

  // Case collaboration + ad-hoc tasks — extracted to ./crm2/taskRoutes.ts
  // (2026-07-23). Registered after faplDisplayName is defined; notify +
  // sendBrandedEmail + faplToUid + faplDisplayName are threaded in.
  registerTaskRoutes(app, notify, sendBrandedEmail, faplToUid, faplDisplayName);
  // Lead CRUD + convert + promote — extracted to ./crm2/leadRoutes.ts (2026-07-23).
  registerLeadRoutes(app, faplToUid, notify);

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

  // WhatsApp Cloud API inbox — extracted to ./crm2/whatsapp.ts (2026-07-23).
  // Registered here rather than at the top of this function because it needs
  // requireSchedulerOrAdmin, which closes over the injected verifyScheduler.
  registerWhatsAppRoutes(app, requireSchedulerOrAdmin);

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

  // FIFO pull-queue — extracted to ./crm2/queueRoutes.ts (2026-07-23). Registered
  // here, after resolveEscalationUids + notify are defined, because the release
  // escalation path (a lead released >=3 times) needs both.
  registerQueueRoutes(app, loadSlaConfig, loadBusinessHours, resolveEscalationUids, notify);

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
