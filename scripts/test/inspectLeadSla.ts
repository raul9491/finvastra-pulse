/**
 * Go-live verification — print a lead's SLA + pull-queue timeline.
 *
 *   npm run sla:inspect -- <leadId>
 *
 * Env:
 *   PULSE_BASE        API base (default https://pulse.finvastra.com)
 *   PULSE_ADMIN_TOKEN a Firebase ID token for an admin user (required)
 */
const base = (process.env.PULSE_BASE || 'https://pulse.finvastra.com').replace(/\/$/, '');
const token = process.env.PULSE_ADMIN_TOKEN || '';
const leadId = process.argv[2];

if (!leadId) { console.error('Usage: npm run sla:inspect -- <leadId>'); process.exit(2); }
if (!token) { console.error('Set PULSE_ADMIN_TOKEN (an admin Firebase ID token).'); process.exit(2); }

const res = await fetch(`${base}/api/crm2/admin/lead/${encodeURIComponent(leadId)}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const body = await res.json().catch(() => ({}));
if (res.status !== 200) { console.error(`✗ ${res.status}:`, JSON.stringify(body, null, 2)); process.exit(1); }

console.log(JSON.stringify(body, null, 2));
const s = body.sla ?? {};
console.log('\n── Lifecycle ──────────────────────────────────────');
console.log(`capture     : ${s.captureAt ?? '—'}`);
console.log(`assigned    : ${s.assignedAt ?? '— (in queue)'}  owner=${body.assignedRm ?? '—'}`);
console.log(`firstContact: ${s.firstContactedAt ?? '— (Stage-2 clock running)'}`);
console.log(`Stage-1 breach: ${s.stage1BreachedAt ?? 'none'}`);
console.log(`Stage-2 breach: ${s.stage2BreachedAt ?? 'none'}`);
if (body.queue?.releaseCount) console.log(`releases    : ${body.queue.releaseCount}${body.queue.queueFlagged ? ' (FLAGGED)' : ''}`);
process.exit(0);
