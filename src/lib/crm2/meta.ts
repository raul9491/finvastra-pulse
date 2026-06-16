/**
 * Meta Lead Ads webhook — pure helpers (signature verify, envelope parse, field map).
 *
 * Kept pure + framework-free so they're unit-testable (see meta.test.ts) and reused
 * by the Express handlers in server/crm2.ts. No secrets live here — the app secret is
 * passed in by the caller (read from env), never hardcoded.
 *
 * Meta delivers only a `leadgen_id` in the webhook; the real answers are pulled from
 * the Graph API separately and fed through `mapMetaFields`.
 */

import crypto from 'crypto';
import { normaliseMobile } from './dedupe';

export interface MetaLeadgenEvent {
  leadgenId: string;
  pageId: string | null;
  formId: string | null;
  adId: string | null;
  createdTime: string | null;
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Constant-time HMAC-SHA256 verification of Meta's `X-Hub-Signature-256` header over
 * the RAW request bytes, keyed with the app secret. Fails closed on any anomaly
 * (missing secret/body/header, wrong prefix, non-hex, length mismatch).
 */
export function verifyMetaSignature(
  raw: Buffer | undefined | null,
  headerVal: unknown,
  appSecret: string,
): boolean {
  if (!appSecret) return false;
  if (!raw || !Buffer.isBuffer(raw) || raw.length === 0) return false;
  const header = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const theirsHex = header.slice('sha256='.length).trim();
  if (!/^[0-9a-f]+$/i.test(theirsHex)) return false;
  const ours = crypto.createHmac('sha256', appSecret).update(raw).digest();
  let theirs: Buffer;
  try { theirs = Buffer.from(theirsHex, 'hex'); } catch { return false; }
  if (theirs.length !== ours.length) return false;
  return crypto.timingSafeEqual(ours, theirs);
}

/** Compute the signature header value for a payload — used by callers/tests. */
export function signMetaPayload(raw: Buffer | string, appSecret: string): string {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
  return 'sha256=' + crypto.createHmac('sha256', appSecret).update(buf).digest('hex');
}

/**
 * Pull leadgen events out of the Meta webhook envelope
 * ({ object:'page', entry:[{ id, changes:[{ field:'leadgen', value:{ leadgen_id,… } }] }] }).
 * Ignores non-page objects and non-leadgen changes. Each event needs a leadgen_id.
 */
export function extractLeadgenEvents(body: unknown): MetaLeadgenEvent[] {
  const out: MetaLeadgenEvent[] = [];
  const b = body as { object?: string; entry?: unknown[] } | null;
  if (!b || b.object !== 'page' || !Array.isArray(b.entry)) return out;
  for (const entryRaw of b.entry) {
    const entry = entryRaw as { id?: unknown; changes?: unknown[] };
    const pageFromEntry = entry?.id != null ? String(entry.id) : null;
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const changeRaw of changes) {
      const change = changeRaw as { field?: unknown; value?: Record<string, unknown> };
      if (change?.field !== 'leadgen') continue;
      const v = change.value ?? {};
      if (!isStr(v.leadgen_id)) continue;
      out.push({
        leadgenId: String(v.leadgen_id),
        pageId: isStr(v.page_id) ? String(v.page_id) : pageFromEntry,
        formId: isStr(v.form_id) ? String(v.form_id) : null,
        adId: isStr(v.ad_id) ? String(v.ad_id) : null,
        createdTime: v.created_time != null ? String(v.created_time) : null,
      });
    }
  }
  return out;
}

export interface MappedMetaLead {
  name: string | null;
  mobile: string | null;   // normalised 10-digit Indian mobile, or null
  email: string | null;
  city: string | null;
}

/**
 * Defensive field mapping over Graph API `field_data`
 * ([{ name:'full_name', values:['…'] }, …]). Form field names vary by campaign, so
 * each logical field matches several aliases; phone is normalised (strips +91 etc.).
 */
export function mapMetaFields(
  fieldData: Array<{ name?: unknown; values?: unknown }> | null | undefined,
): MappedMetaLead {
  const list = Array.isArray(fieldData) ? fieldData : [];
  const get = (...aliases: string[]): string | null => {
    for (const fd of list) {
      const key = String(fd?.name ?? '').toLowerCase().trim();
      if (!aliases.includes(key)) continue;
      const val = Array.isArray(fd?.values) ? fd.values[0] : fd?.values;
      if (isStr(val)) return String(val).trim();
    }
    return null;
  };
  let name = get('full_name', 'name', 'your_name', 'naam');
  if (!name) {
    const parts = [get('first_name'), get('last_name')].filter(Boolean) as string[];
    name = parts.length ? parts.join(' ') : null;
  }
  const rawPhone = get('phone_number', 'phone', 'mobile_number', 'mobile', 'contact_number', 'whatsapp_number');
  return {
    name,
    mobile: rawPhone ? normaliseMobile(rawPhone) : null,
    email: get('email', 'email_address', 'work_email'),
    city: get('city', 'town', 'city_name', 'location'),
  };
}
