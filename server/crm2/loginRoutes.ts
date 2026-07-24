/**
 * server/crm2/loginRoutes.ts — CRM 2.0 per-login pipeline (subcollection
 * cases/{id}/logins), extracted verbatim from server/crm2.ts (2026-07-24).
 * OPEN + PATCH-data + advance-STAGE only — OFF the money path (the per-login
 * disburse → cycle + MIS engine stays in crm2.ts with resolveMapping/resolveSlab).
 * registerLoginRoutes(app) is called from registerCrm2Routes.
 */
import type express from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../db.js';
import { route, ApiError, optStr, optNum, optTs, reqEnum, strArr, isStr } from './core.js';
import { requirePerm, createAudit, updateAudit } from './context.js';
import { validateLoginTransition, keyDateForLoginStage } from '../../src/lib/crm2/logins.js';

export function registerLoginRoutes(app: express.Express) {
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
}
