/**
 * Live test-lead verification helper — Meta webhook go-live.
 *
 * Prints the meta_lead_events state machine + the resulting CRM 2.0 lead (every
 * mapped field) and ASSERTS product interest is present. Exits non-zero (fails
 * loudly) when the landed lead has no product/interest field — that means the Meta
 * Instant Form is missing the product question, which Phase 2 routing depends on.
 *
 * Usage:
 *   npm run qa:meta:inspect -- <leadgen_id>
 *
 * Env:
 *   META_INSPECT_BASE   API base (default https://pulse.finvastra.com)
 *   META_ADMIN_TOKEN    a Firebase ID token for an admin user (required)
 *                       (get one from the browser devtools of a signed-in admin,
 *                        or mint one against the auth emulator for local runs)
 */

const base = (process.env.META_INSPECT_BASE || "https://pulse.finvastra.com").replace(/\/$/, "");
const token = process.env.META_ADMIN_TOKEN || "";
const leadgenId = process.argv[2];

if (!leadgenId) { console.error("Usage: npm run qa:meta:inspect -- <leadgen_id>"); process.exit(2); }
if (!token) { console.error("Set META_ADMIN_TOKEN (an admin Firebase ID token)."); process.exit(2); }

const res = await fetch(`${base}/api/crm2/admin/meta-event/${encodeURIComponent(leadgenId)}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const body = await res.json().catch(() => ({}));

if (res.status !== 200) {
  console.error(`✗ ${res.status}:`, JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log("── Event ──────────────────────────────────────────");
console.log(JSON.stringify(body.event, null, 2));
if (body.deadLetter) {
  console.log("── Dead-letter ────────────────────────────────────");
  console.log(JSON.stringify(body.deadLetter, null, 2));
}
console.log("── Landed CRM 2.0 lead ────────────────────────────");
console.log(JSON.stringify(body.lead, null, 2));
console.log("───────────────────────────────────────────────────");

if (body.productInterestPresent) {
  console.log(`✓ ${body.productInterestMessage}`);
  process.exit(0);
}
console.error(`✗ ${body.productInterestMessage}`);
process.exit(1);
