/**
 * server/crm2/meta.ts - Meta Lead Ads webhook processing (write-ahead store,
 * logging, dead-letter, Graph pull, and the idempotent leadgen->CRM-2.0-lead
 * upsert), lifted from server/crm2.ts (2026-07-22). db/admin from ../db.js;
 * shares context (audit/counter) + leads (dedup) helpers + the tested meta lib.
 */
import { FieldValue } from "firebase-admin/firestore";
import { db, admin } from "../db.js";
import { isStr } from "./core.js";
import { createAudit, nextIdInTx } from "./context.js";
import { findDuplicate, leadYearCounter } from "./leads.js";
import { buildDupeKeys } from "../../src/lib/crm2/dedupe.js";
import { mapMetaFields, type MetaLeadgenEvent } from "../../src/lib/crm2/meta.js";

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
      deleted: false, converted: false, convertedAt: null,
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

export { META_GRAPH_BASE, META_MAX_ATTEMPTS, persistMetaEvent, logMetaWebhook, deadLetterMeta, fetchMetaLead, processMetaLeadgen };
