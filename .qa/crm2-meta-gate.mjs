/**
 * Meta Lead Ads webhook — emulator integration gate (offline; Graph API mocked).
 *
 * Proves the behaviours unit tests can't (real HTTP + Firestore + the async state
 * machine): idempotent redelivery, Graph-failure recovery, the terminal/dead-letter
 * path, and signature/envelope rejection.
 *
 * The dev server is started (by run-meta-gate.sh) with META_GRAPH_BASE pointing at
 * THIS script's in-process mock Graph server, so no real token / network is used.
 *
 * Prereqs (or just `npm run qa:meta`, which wires all of this):
 *   1. npm run dev:emulators
 *   2. VITE_USE_EMULATOR=true PORT=8090 \
 *      META_APP_SECRET=gate_secret META_PAGE_ACCESS_TOKEN=gate_token \
 *      META_GRAPH_BASE=http://127.0.0.1:8099 META_GRAPH_VERSION=v23.0 \
 *      FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *      GCLOUD_PROJECT=demo-pulse npx tsx server.ts
 *   3. node .qa/crm2-meta-gate.mjs
 */

import http from 'node:http';
import crypto from 'node:crypto';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';
const APP_SECRET = process.env.META_APP_SECRET ?? 'gate_secret';
const MOCK_PORT = Number(process.env.META_GRAPH_MOCK_PORT ?? 8099);

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── In-process mock Graph API ────────────────────────────────────────────────
// behaviors[leadgenId] = 'ok' | '500'. fieldData[leadgenId] = the field_data array.
const behaviors = new Map();
const fieldData = new Map();
const mock = http.createServer((req, res) => {
  // path is /{version}/{leadgenId}; ignore the query (carries fields + token).
  const path = (req.url ?? '').split('?')[0];
  const leadgenId = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '');
  const mode = behaviors.get(leadgenId) ?? '500';
  if (mode === 'ok') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      field_data: fieldData.get(leadgenId) ?? [],
      created_time: '2026-06-16T10:00:00+0000',
      form_id: 'FORM-1', ad_id: 'AD-1', campaign_id: 'CMP-1',
    }));
  } else {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'mock graph 500', code: 1 } }));
  }
});

function sign(rawStr) {
  return 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(Buffer.from(rawStr, 'utf8')).digest('hex');
}
function envelope(leadgenId) {
  return JSON.stringify({
    object: 'page',
    entry: [{ id: '100', time: 1718530000, changes: [{ field: 'leadgen', value: {
      leadgen_id: leadgenId, page_id: '100', form_id: 'FORM-1', ad_id: 'AD-1', created_time: 1718530000,
    } }] }],
  });
}
async function postWebhook(leadgenId, { sig } = {}) {
  const raw = envelope(leadgenId);
  const res = await fetch(`${API}/api/webhooks/meta/leadgen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig ?? sign(raw) },
    body: raw,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function runRetry() {
  // No auth token → relies on the scheduler-or-admin guard; the gate has no OIDC,
  // so mint nothing and call it as admin instead.
  return fetch(`${API}/api/crm2/jobs/run-meta-retry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: '{}',
  }).then((r) => r.json().catch(() => ({})));
}

// ── Firestore emulator REST (rules bypass via "Bearer owner") ─────────────────
const docUrl = (p) => `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${p}`;
async function getDoc(p) {
  const r = await fetch(docUrl(p), { headers: { Authorization: 'Bearer owner' } });
  return r.status === 200 ? r.json() : null;
}
async function listLeadsByMobile(mobile) {
  const r = await fetch(`${docUrl('leads')}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  const j = await r.json().catch(() => ({}));
  return (j.documents ?? []).filter((d) => d?.fields?.mobile?.stringValue === mobile);
}
const ev = (doc, field) => doc?.fields?.[field];
const evStr = (doc, field) => ev(doc, field)?.stringValue ?? null;
const evBool = (doc, field) => ev(doc, field)?.booleanValue ?? false;

async function pollEvent(leadgenId, predicate, { tries = 40, gap = 150 } = {}) {
  for (let i = 0; i < tries; i++) {
    const doc = await getDoc(`meta_lead_events/${leadgenId}`);
    if (doc && predicate(doc)) return doc;
    await sleep(gap);
  }
  return await getDoc(`meta_lead_events/${leadgenId}`);
}

// ── Auth emulator: an admin (for the retry endpoint) ──────────────────────────
let ADMIN_TOKEN = '';
async function makeAdmin() {
  const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
  const email = `meta-gate-${Date.now()}@finvastra.com`;
  const s = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  await fetch(docUrl(`users/${s.localId}`), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: {
      userId: { stringValue: s.localId }, email: { stringValue: email },
      role: { stringValue: 'admin' }, employeeId: { stringValue: 'FAPL-022' },
    } }),
  });
  return s.idToken;
}

async function main() {
  console.log('Meta Lead Ads webhook — emulator integration gate (Graph mocked)\n');
  await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
  ADMIN_TOKEN = await makeAdmin();
  const t = Date.now();
  const lg = (n) => `LG-GATE-${t}-${n}`;
  const fd = (name, phone, product) => [
    { name: 'full_name', values: [name] },
    { name: 'phone_number', values: [phone] },
    { name: 'email', values: ['x@example.com'] },
    { name: 'city', values: ['Hyderabad'] },
    ...(product ? [{ name: 'product', values: [product] }] : []),
  ];

  // ── 1. Idempotent redelivery → exactly ONE lead ───────────────────────────
  {
    const id = lg(1), mob = `97${String((t + 1) % 100000000).padStart(8, '0')}`;
    behaviors.set(id, 'ok'); fieldData.set(id, fd('Asha Rao', mob, 'Home Loan'));
    const a = await postWebhook(id);
    a.status === 200 ? ok('webhook ACK 200') : bad('webhook ACK', JSON.stringify(a));
    await pollEvent(id, (d) => evStr(d, 'status') === 'done');
    // Redeliver the SAME leadgen_id twice more + a retry pass.
    await postWebhook(id); await postWebhook(id); await runRetry();
    await sleep(400);
    const evt = await getDoc(`meta_lead_events/${id}`);
    const leads = await listLeadsByMobile(mob);
    evStr(evt, 'status') === 'done' ? ok('event ends done') : bad('event status', evStr(evt, 'status'));
    leads.length === 1 ? ok('redelivery → exactly ONE lead') : bad('idempotency', `got ${leads.length} leads`);
    leads[0] && leads[0].fields?.source?.stringValue === 'ADS'
      ? ok('lead is source ADS / status NEW') : bad('lead shape', JSON.stringify(leads[0]?.fields?.source));
    // product captured + category inferred
    const cat = leads[0]?.fields?.category?.stringValue;
    cat === 'LOAN' ? ok('product captured → category LOAN inferred') : bad('category', cat);
  }

  // ── 2. Graph failure → no lead; retry recovers → exactly ONE lead ─────────
  {
    const id = lg(2), mob = `97${String((t + 2) % 100000000).padStart(8, '0')}`;
    behaviors.set(id, '500'); fieldData.set(id, fd('Ravi K', mob, 'SIP'));
    await postWebhook(id);
    const failed = await pollEvent(id, (d) => evStr(d, 'status') === 'failed');
    evStr(failed, 'status') === 'failed' && !evBool(failed, 'terminal')
      ? ok('graph 500 → event failed, non-terminal') : bad('fail state', JSON.stringify(failed?.fields));
    (await listLeadsByMobile(mob)).length === 0 ? ok('no lead written on failure') : bad('premature lead', mob);
    // Recover.
    behaviors.set(id, 'ok');
    await runRetry();
    await pollEvent(id, (d) => evStr(d, 'status') === 'done');
    const leads = await listLeadsByMobile(mob);
    leads.length === 1 ? ok('retry recovers → exactly ONE lead, none lost') : bad('recovery', `got ${leads.length}`);
  }

  // ── 3. Terminal path → dead-letter, still no lead ─────────────────────────
  {
    const id = lg(3), mob = `97${String((t + 3) % 100000000).padStart(8, '0')}`;
    behaviors.set(id, '500'); fieldData.set(id, fd('Dead Letter', mob, 'LAP'));
    await postWebhook(id);                 // attempt 1
    await pollEvent(id, (d) => evStr(d, 'status') === 'failed');
    for (let i = 0; i < 6; i++) { await runRetry(); await sleep(200); }  // attempts 2..5 → terminal
    const evt = await pollEvent(id, (d) => evBool(d, 'terminal') === true, { tries: 20 });
    evBool(evt, 'terminal') ? ok('event terminal after cap') : bad('terminal', JSON.stringify(evt?.fields));
    evBool(evt, 'deadLetter') ? ok('event flagged deadLetter') : bad('deadLetter flag', JSON.stringify(evt?.fields));
    const dl = await getDoc(`meta_lead_deadletters/${id}`);
    dl ? ok('dead-letter doc written') : bad('dead-letter doc missing', id);
    (await listLeadsByMobile(mob)).length === 0 ? ok('terminal → still NO lead') : bad('terminal lead leak', mob);
  }

  // ── 4. Bad signature / malformed → rejected, no event, no lead ────────────
  {
    const id = lg(4);
    const badsig = await postWebhook(id, { sig: 'sha256=deadbeef' });
    badsig.status === 403 ? ok('bad signature → 403') : bad('bad sig status', badsig.status);
    await sleep(200);
    (await getDoc(`meta_lead_events/${id}`)) === null ? ok('no event doc on bad signature') : bad('event leaked', id);

    // Malformed envelope but correctly signed → 200, received 0, no event.
    const raw = JSON.stringify({ object: 'user', entry: [] });
    const r = await fetch(`${API}/api/webhooks/meta/leadgen`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(raw) }, body: raw,
    });
    const j = await r.json().catch(() => ({}));
    r.status === 200 && j.received === 0 ? ok('malformed envelope → 200, 0 queued') : bad('malformed', `${r.status} ${JSON.stringify(j)}`);
  }

  mock.close();
  console.log(`\n${fail === 0 ? '✅' : '❌'} Meta gate: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); try { mock.close(); } catch {} process.exit(1); });
