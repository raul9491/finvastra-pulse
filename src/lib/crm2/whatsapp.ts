/**
 * WhatsApp Cloud API webhook — pure helpers (parse the `messages` envelope).
 *
 * Mirrors meta.ts: framework-free + unit-testable, reused by server/crm2.ts. The HMAC
 * signature is verified with `verifyMetaSignature` / `signMetaPayload` from meta.ts (same
 * `X-Hub-Signature-256` scheme, keyed by the WhatsApp app secret). No secrets live here.
 *
 * Inbound envelope (Cloud API):
 * { object:'whatsapp_business_account', entry:[{ id:<WABA_ID>, changes:[{ field:'messages',
 *   value:{ metadata:{ phone_number_id }, contacts:[{ profile:{name}, wa_id }],
 *           messages:[{ from, id, timestamp, type, text:{body}, image:{id,caption}, … }],
 *           statuses:[{ id, status, recipient_id, timestamp }] } }] }] }
 */

export interface WhatsAppInbound {
  waMessageId: string;
  from: string;                  // sender phone, digits only (E.164 without +)
  phoneNumberId: string | null;  // OUR business number that received it
  timestamp: string | null;      // unix seconds (string)
  type: string;                  // text | image | document | audio | video | button | interactive | …
  text: string | null;           // body for text/button/interactive + media caption; null otherwise
  mediaId: string | null;        // media id for image/document/… (URL fetched in Phase 2)
  contactName: string | null;    // sender's WhatsApp profile name, if present
}

export interface WhatsAppStatus {
  waMessageId: string;           // id of the OUTBOUND message this status is for
  status: string;                // sent | delivered | read | failed
  recipientId: string | null;
  timestamp: string | null;
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const onlyDigits = (s: string): string => s.replace(/\D/g, "");

/** Pull inbound messages out of the WhatsApp webhook envelope. Ignores non-WABA
 *  objects and non-`messages` changes. Each message needs both an id and a `from`. */
export function extractWhatsAppMessages(body: unknown): WhatsAppInbound[] {
  const out: WhatsAppInbound[] = [];
  const b = body as { object?: string; entry?: unknown[] } | null;
  if (!b || b.object !== "whatsapp_business_account" || !Array.isArray(b.entry)) return out;
  for (const entryRaw of b.entry) {
    const changes = Array.isArray((entryRaw as { changes?: unknown[] })?.changes)
      ? (entryRaw as { changes: unknown[] }).changes : [];
    for (const changeRaw of changes) {
      const change = changeRaw as { field?: unknown; value?: Record<string, unknown> };
      if (change?.field !== "messages") continue;
      const v = change.value ?? {};
      const meta = v.metadata as { phone_number_id?: unknown } | undefined;
      const phoneNumberId = isStr(meta?.phone_number_id) ? String(meta!.phone_number_id) : null;

      // Map sender wa_id → profile name (so a new lead gets a real name).
      const contacts = Array.isArray(v.contacts) ? v.contacts : [];
      const nameByWaId = new Map<string, string>();
      for (const c of contacts) {
        const wa = (c as { wa_id?: unknown }).wa_id;
        const nm = (c as { profile?: { name?: unknown } }).profile?.name;
        if (isStr(wa) && isStr(nm)) nameByWaId.set(String(wa), String(nm));
      }

      const messages = Array.isArray(v.messages) ? v.messages : [];
      for (const mRaw of messages) {
        const m = mRaw as Record<string, unknown>;
        if (!isStr(m.id) || !isStr(m.from)) continue;
        const type = isStr(m.type) ? String(m.type) : "unknown";
        let text: string | null = null;
        let mediaId: string | null = null;
        if (type === "text") {
          const t = m.text as { body?: unknown } | undefined;
          text = isStr(t?.body) ? String(t!.body) : null;
        } else if (type === "button") {
          const btn = m.button as { text?: unknown } | undefined;
          text = isStr(btn?.text) ? String(btn!.text) : null;
        } else if (type === "interactive") {
          const it = m.interactive as { button_reply?: { title?: unknown }; list_reply?: { title?: unknown } } | undefined;
          text = isStr(it?.button_reply?.title) ? String(it!.button_reply!.title)
            : isStr(it?.list_reply?.title) ? String(it!.list_reply!.title) : null;
        } else {
          // media types: image/document/audio/video/sticker → { id, caption? }
          const media = m[type] as { id?: unknown; caption?: unknown } | undefined;
          mediaId = isStr(media?.id) ? String(media!.id) : null;
          text = isStr(media?.caption) ? String(media!.caption) : null;
        }
        out.push({
          waMessageId: String(m.id),
          from: onlyDigits(String(m.from)),
          phoneNumberId,
          timestamp: isStr(m.timestamp) ? String(m.timestamp) : null,
          type,
          text,
          mediaId,
          contactName: nameByWaId.get(String(m.from)) ?? null,
        });
      }
    }
  }
  return out;
}

/** Pull delivery-status updates (sent/delivered/read/failed) for OUTBOUND messages. */
export function extractWhatsAppStatuses(body: unknown): WhatsAppStatus[] {
  const out: WhatsAppStatus[] = [];
  const b = body as { object?: string; entry?: unknown[] } | null;
  if (!b || b.object !== "whatsapp_business_account" || !Array.isArray(b.entry)) return out;
  for (const entryRaw of b.entry) {
    const changes = Array.isArray((entryRaw as { changes?: unknown[] })?.changes)
      ? (entryRaw as { changes: unknown[] }).changes : [];
    for (const changeRaw of changes) {
      const change = changeRaw as { field?: unknown; value?: Record<string, unknown> };
      if (change?.field !== "messages") continue;
      const statuses = Array.isArray(change.value?.statuses) ? change.value!.statuses : [];
      for (const sRaw of statuses) {
        const s = sRaw as Record<string, unknown>;
        if (!isStr(s.id) || !isStr(s.status)) continue;
        out.push({
          waMessageId: String(s.id),
          status: String(s.status),
          recipientId: isStr(s.recipient_id) ? String(s.recipient_id) : null,
          timestamp: isStr(s.timestamp) ? String(s.timestamp) : null,
        });
      }
    }
  }
  return out;
}
