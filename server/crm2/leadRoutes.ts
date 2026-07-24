/**
 * server/crm2/leadRoutes.ts - CRM 2.0 lead internal CRUD + convert + promote.
 *
 *   POST  /api/crm2/leads              internal create
 *   PATCH /api/crm2/leads/:id          edit / disposition / re-assign
 *   POST  /api/crm2/leads/:id/convert  resolve-or-create Client, open a Case
 *   POST  /api/crm2/leads/:id/promote  old-CRM Customer -> CRM 2.0 lead in place
 *   POST  /api/crm2/admin/backfill-lead-codes
 *
 * NOT on the money path. convert INITIALISES a case (amountSanctioned/Disbursed
 * = null, payoutStatus = NOT_DUE, payoutCycleId = null) but never resolves a
 * slab, computes an amount, or writes a payout cycle - verified before cutting.
 * Public intake, the Meta webhook, the SLA sweep and the partner-candidate
 * routes are interleaved with these in crm2.ts and deliberately stay there;
 * only the clean CRUD block moved.
 *
 * Extracted verbatim from server/crm2.ts (2026-07-23); only the dedent +
 * registerLeadRoutes(app, faplToUid). The lead enums moved to ./leadEnums.ts in
 * the same commit so both files share them.
 */
import type express from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../db.js';
import { route, ApiError, reqStr, optStr, reqEnum, optNum, optTs, isStr } from './core.js';
import { requirePerm, getCallerMeta, createAudit, updateAudit, nextIdInTx, expandDocTracker } from './context.js';
import { findDuplicate, leadYearCounter } from './leads.js';
import { sanitizeClient } from './sanitizers.js';
import { LEAD_CATEGORIES, LEAD_SOURCES, LEAD_STATUSES, DROP_REASONS } from './leadEnums.js';
import { buildDupeKeys, normaliseMobile } from '../../src/lib/crm2/dedupe.js';

export function registerLeadRoutes(
  app: express.Express,
  faplToUid: (fapl: string) => Promise<string | null>,
  notify: (uid: string, payload: Record<string, unknown>) => Promise<void>,
): void {

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
        // SECURITY: sourcing attribution. For a CONNECTOR caller this is FORCED to
        // their own CON- id and the client body is IGNORED — otherwise a connector
        // could attribute a lead to another partner, or claim one by writing
        // someone else's id. It is also the key every scoped read keys off, so it
        // must never be client-controlled for them. Staff keep the free picker.
        ...(caller.connectorId
          ? { channelPartnerId: caller.connectorId, channelPartnerCode: null, channelPartnerName: null }
          : {
              channelPartnerId: optStr(b, "channelPartnerId"),
              channelPartnerCode: optStr(b, "channelPartnerCode"),
              channelPartnerName: optStr(b, "channelPartnerName"),
            }),
        linkedExistingClientId: optStr(b, "linkedExistingClientId"),
        customerProfile: sanitizeCustomerProfile(b.customerProfile),
        assignedRm, assignedAt: assignedRm ? FieldValue.serverTimestamp() : null,
        status: "NEW",
        priority: ["HOT", "WARM", "COLD"].includes(String(b.priority)) ? b.priority : "WARM",
        nextFollowUpAt: optTs(b, "nextFollowUpAt"), nextFollowUpNote: optStr(b, "nextFollowUpNote"),
        followUpReminderSent: false, attempts: 0,
        activityLog: [], dropReason: null,
        deleted: false, converted: false, convertedAt: null,
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

    // SECURITY: a CONNECTOR caller may only touch leads they themselves sourced.
    // crm.leads.write alone is a capability, not an ownership check — without this
    // a connector could edit any lead in the book. 404 (not 403) so the endpoint
    // never confirms that someone else's lead id exists.
    if (caller.connectorId && cur.channelPartnerId !== caller.connectorId) {
      throw new ApiError(404, `${req.params.id} not found`);
    }

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
    // SECURITY: a CONNECTOR caller may never re-attribute a lead — doing so would
    // move it out of (or into) their own scope. Silently ignored for them; staff
    // keep the editable picker.
    if (!caller.connectorId) {
      if (b.channelPartnerId !== undefined) fields.channelPartnerId = optStr(b, "channelPartnerId");
      if (b.channelPartnerCode !== undefined) fields.channelPartnerCode = optStr(b, "channelPartnerCode");
      if (b.channelPartnerName !== undefined) fields.channelPartnerName = optStr(b, "channelPartnerName");
    }
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
      deleted: false, converted: false, convertedAt: null,
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
}
