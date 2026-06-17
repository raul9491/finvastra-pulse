/**
 * Go-live verification — print live pull-queue state (depth · oldest age · SLA · reps).
 *
 *   npm run queue:inspect
 *
 * Env:
 *   PULSE_BASE        API base (default https://pulse.finvastra.com)
 *   PULSE_ADMIN_TOKEN a Firebase ID token for an admin / crm.leads.read user (required)
 */
const base = (process.env.PULSE_BASE || 'https://pulse.finvastra.com').replace(/\/$/, '');
const token = process.env.PULSE_ADMIN_TOKEN || '';
if (!token) { console.error('Set PULSE_ADMIN_TOKEN (an admin Firebase ID token).'); process.exit(2); }

const res = await fetch(`${base}/api/crm2/queue/state`, { headers: { Authorization: `Bearer ${token}` } });
const body = await res.json().catch(() => ({}));
if (res.status !== 200) { console.error(`✗ ${res.status}:`, JSON.stringify(body, null, 2)); process.exit(1); }

const m = (ms: number | null) => (ms == null ? '—' : `${Math.round(ms / 60000)}m`);
console.log(`Total waiting: ${body.totalWaiting} · active reps: ${body.activeTelecallers?.length ?? 0}\n`);
console.log('Queue        Depth  OldestAge(wk)  SLA-countdown');
for (const q of body.queues ?? []) {
  const sla = q.slaCountdownMs == null ? '—' : (q.slaCountdownMs < 0 ? `BREACHED −${m(-q.slaCountdownMs)}` : `${m(q.slaCountdownMs)} left`);
  console.log(`${q.name.padEnd(12)} ${String(q.depth).padStart(5)}  ${m(q.oldestWorkingAgeMs).padStart(12)}  ${sla}`);
}
for (const t of body.activeTelecallers ?? []) console.log(`  rep ${t.fapl}: ${t.openClaims} open claim(s)`);
process.exit(0);
