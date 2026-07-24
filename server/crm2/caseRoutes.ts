/**
 * server/crm2/caseRoutes.ts - Phase 3 case lifecycle: CRUD, the case-level stage
 * machine, applicants, docTracker.
 *
 *   POST  /api/crm2/cases                 walk-in / manual case open
 *   PATCH /api/crm2/cases/:id             edit (CASE_EDITABLE_FIELDS allowlist;
 *                                          CASE_PROTECTED_FIELDS rejected by name)
 *   POST  /api/crm2/cases/:id/stage       case-level transition (validated)
 *   POST/PATCH/DELETE .../applicants      applicant CRUD (PAN encrypted, Aadhaar
 *                                          last-4 only)
 *   PATCH .../doc-tracker/:rowId          status + recompute docsCompletePct
 *
 * OFF the money path: case-open INITIALISES payoutStatus = NOT_DUE /
 * payoutCycleId = null and lists the payout-mirror fields as PROTECTED, but never
 * resolves a slab, computes an amount or writes a payout cycle - disburse (Phase 4)
 * is a separate section that STAYS in crm2.ts. Verified before cutting: no
 * resolveMapping/resolveSlab/disburse call, and none of the case-local helpers
 * (CASE_EDITABLE_FIELDS/CASE_PROTECTED_FIELDS/sanitizeApplicant/sanitizeStage1/
 * sanitizeEligibility) are used after this block. (A dead readTrackerRows
 * helper that rode along was deleted in the same commit.)
 *
 * Extracted verbatim from server/crm2.ts (2026-07-23); only the dedent +
 * registerCaseRoutes(app). No crm2.ts-local helper is threaded.
 */
import type express from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../db.js';
import { route, ApiError, reqStr, optStr, reqEnum, optNum, optTs, strArr, isStr, rejectFullAadhaar, PAN_RE } from './core.js';
import { requirePerm, createAudit, updateAudit, expandDocTracker } from './context.js';
import { validateCaseLevelTransition, type LoginLite } from '../../src/lib/crm2/logins.js';
import { encryptField } from '../../src/lib/encryption.js';

export function registerCaseRoutes(app: express.Express): void {
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
}
