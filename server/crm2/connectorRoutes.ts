/**
 * server/crm2/connectorRoutes.ts - the CON-### connector (channel partner)
 * registry and the partner-scoring rubric.
 *
 * Extracted verbatim from server/crm2.ts (2026-07-23); the only changes are the
 * dedent and registerConnectorRoutes(app). NOT on the money path - a connector
 * payout is created downstream at disburse, from the rules edited here.
 *
 * `nextConnectorCodeServer` and `getPartnerRubric` are EXPORTED because crm2.ts
 * still uses them when a lead is promoted into the partner funnel
 * (createPartnerCandidate) - the same shape as meta.ts exporting its helpers.
 *
 * Security notes carried over verbatim: PAN and bank account are encrypted
 * server-side (last-4 shown), Aadhaar is last-4 ONLY (UIDAI - the full number is
 * never stored), and the sensitive values live in the admin/HR-only
 * /connectors/{id}/private/financial sub-doc. `partnerScoring` and
 * `onboardingChecklist.progressPct` are ALWAYS recomputed server-side and never
 * read from the request body.
 */
import type express from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../db.js';
import {
  route, ApiError, optStr, optNum, optTs,
  rejectFullAadhaar, isStr, PAN_RE,
} from './core.js';
import { requirePerm, createAudit, updateAudit } from './context.js';
import { connectorMainFields, buildPayoutBank, scoreFor } from './connectors.js';
import {
  PARTNER_TERMINAL, partnerScreeningFields, partnerOnboardingFields,
  partnerPracticalFields, activationBlockers,
} from './partners.js';
import { Timestamp } from 'firebase-admin/firestore';
import {
  computeOnboardingProgress, computePracticalAssessment,
  sanitizePartnerRubric, DEFAULT_PARTNER_RUBRIC, type PartnerRubric,
} from '../../src/lib/crm2/partnerScoring.js';
import { encryptField } from '../../src/lib/encryption.js';


// Shared with crm2.ts: a lead promoted into the partner funnel
// (createPartnerCandidate) mints a code, reads the rubric and seeds the same
// empty checklist, so these three cannot live inside the register function.
export const EMPTY_ONBOARDING = {
  panCollected: false, aadhaarCollected: false, bankDetailsCollected: false,
  agreementSentDate: null, agreementSignedDate: null,
  trainingCompleted: false, pulseAccessCreated: false, firstCaseLogged: false,
  onboardingCompleteDate: null, progressPct: 0,
};

export async function nextConnectorCodeServer(): Promise<string> {
  const snap = await db.collection("connectors").get();
  let max = 0;
  snap.docs.forEach((d) => {
    const m = /^(?:CON|CONN|FAC)-(\d+)$/.exec(String(d.data().connectorCode ?? ""));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return `CON-${String(max + 1).padStart(3, "0")}`;
}

export async function getPartnerRubric(): Promise<PartnerRubric> {
  const ref = db.collection("partnerScoringConfig").doc("default");
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({ ...DEFAULT_PARTNER_RUBRIC, updatedAt: FieldValue.serverTimestamp(), updatedBy: "system:seed" });
    return DEFAULT_PARTNER_RUBRIC;
  }
  return snap.data() as PartnerRubric;
}

export function registerConnectorRoutes(app: express.Express): void {
  // ─── Connector master (HRMS /connectors, CON-###) — rich, encrypted ──────────
  // PAN encrypted (last-4 shown), Aadhaar last-4 ONLY (UIDAI — full never stored),
  // bank account encrypted (last-4 shown). Sensitive financial lives in the
  // admin/HR-only /connectors/{id}/private/financial sub-doc; the main doc holds
  // display-safe fields (read by CRM users for the Add Customer picker).


  // ─── Partner intake funnel (fields ON the connector; see src/lib/crm2/partnerScoring) ──




  /** Load the rubric config, seeding partnerScoringConfig/default on first read. */


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
}
