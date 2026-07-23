/**
 * server/crm2/whatsapp.ts - the WhatsApp Cloud API inbox engine.
 *
 * Mirrors server/crm2/meta.ts exactly, because it is the same shape of problem:
 * verify the HMAC over the RAW bytes -> persist-first to a write-ahead store
 * (whatsapp_message_events/{waMessageId}) -> ACK fast -> process asynchronously.
 * Idempotent on waMessageId, with a retry pass and a dead-letter for messages
 * that exhaust it.
 *
 * Extracted verbatim from server/crm2.ts (2026-07-23). The only change is the
 * dedent (it lived inside registerCrm2Routes) and registerWhatsAppRoutes(app)
 * replacing the inline route registrations - same pattern as the 11 route groups
 * already lifted out of server.ts.
 *
 * The phone->lead lookup runs INSIDE the minting transaction so two concurrent
 * first messages from the same number cannot double-mint a lead (fixed
 * 2026-07-02; do not move it back out).
 */
import type express from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../db.js';
import { route, ApiError, isStr } from './core.js';
import { createAudit, nextIdInTx, requirePerm } from './context.js';
import { leadYearCounter } from './leads.js';
import { META_GRAPH_BASE } from './meta.js';
import { verifyMetaSignature } from '../../src/lib/crm2/meta.js';
import {
  extractWhatsAppMessages, extractWhatsAppStatuses, type WhatsAppInbound,
} from '../../src/lib/crm2/whatsapp.js';
import { buildDupeKeys, normaliseMobile } from '../../src/lib/crm2/dedupe.js';

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';

/** `requireSchedulerOrAdmin` is threaded in because it closes over the
 *  `verifyScheduler` dependency that server.ts injects into registerCrm2Routes. */
export function registerWhatsAppRoutes(
  app: express.Express,
  requireSchedulerOrAdmin: (req: express.Request, res: express.Response) => Promise<{ fapl: string } | null>,
): void {
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
            deleted: false, converted: false, convertedAt: null,
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

}
