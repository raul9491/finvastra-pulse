/**
 * Two-stage lead-SLA — emulator integration gate. Proves the sweep end-to-end:
 * candidate queries across BOTH lead models, breach stamping, notify-only alerts
 * (owner→manager / escalation), once-per-breach dedup, old-model activity backfill,
 * tier classification, attribution, set-once firstContactedAt, and config-driven
 * windows. The working-time math + business-hours pause are covered by unit tests;
 * here we seed a 24/7 business-hours config so breach timing is deterministic.
 *
 * Run: `npm run qa:sla` (boots emulators + dev server). Standalone prereqs mirror
 * the meta gate header.
 */

const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };

const docUrl = (p) => `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${p}`;
const isoMinus = (min) => new Date(Date.now() - min * 60_000).toISOString();

// Firestore REST value encoders
const V = {
  s: (v) => ({ stringValue: v }), b: (v) => ({ booleanValue: v }),
  n: () => ({ nullValue: null }), t: (iso) => ({ timestampValue: iso }),
  i: (v) => ({ integerValue: String(v) }),
};
async function putDoc(path, fields) {
  const r = await fetch(docUrl(path), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (r.status !== 200) throw new Error(`putDoc ${path}: ${r.status} ${await r.text()}`);
}
async function getDoc(path) {
  const r = await fetch(docUrl(path), { headers: { Authorization: 'Bearer owner' } });
  return r.status === 200 ? r.json() : null;
}
async function listItems(uid) {
  const r = await fetch(`${docUrl(`notifications/${uid}/items`)}?pageSize=100`, { headers: { Authorization: 'Bearer owner' } });
  const j = await r.json().catch(() => ({}));
  return j.documents ?? [];
}
const has = (doc, field) => doc?.fields?.[field] !== undefined && doc?.fields?.[field]?.nullValue === undefined;

async function api(method, path, token, body) {
  const r = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function makeAdmin() {
  const email = `sla-admin-${Date.now()}@finvastra.com`;
  const s = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  await putDoc(`users/${s.localId}`, { userId: V.s(s.localId), email: V.s(email), role: V.s('admin'), employeeId: V.s('FAPL-022') });
  return { token: s.idToken, uid: s.localId };
}
const sweep = (token) => api('POST', '/api/crm2/jobs/run-lead-sla-sweep', token, {});

async function main() {
  console.log('Two-stage lead-SLA — emulator integration gate\n');
  const { token, uid: adminUid } = await makeAdmin();

  // Owner (FAPL-OWNER) + manager (Stage-2 escalation via reportingManagerUid) + a
  // CRM manager (DUTY = the dynamic Stage-1/backlog recipient; crmRole:'manager') —
  // all FABRICATED uids (Firestore user docs, NO Auth account) so userEmail() returns
  // null and the email path is skipped (Gmail auth has no creds in the emulator and
  // would hang); notify() still writes.
  const OWNER = 'sla-owner-uid', MGR = 'sla-mgr-uid', DUTY = 'sla-duty-uid';
  await putDoc(`users/${OWNER}`, { userId: V.s(OWNER), employeeId: V.s('FAPL-OWNER'), role: V.s('employee'), reportingManagerUid: V.s(MGR), employeeStatus: V.s('active') });
  // Stage-1 recipients are resolved LIVE to active crmRole:'manager' users (no hardcoded
  // escalationUids). DUTY is that manager.
  await putDoc(`users/${DUTY}`, { userId: V.s(DUTY), role: V.s('employee'), crmRole: V.s('manager'), employeeStatus: V.s('active') });

  // Config: 24/7 business hours (deterministic timing) + tier windows (no escalationUids).
  await putDoc('app_config/business_hours', {
    tzOffsetMinutes: V.i(0), startMinutes: V.i(0), endMinutes: V.i(1440),
    workingDows: { arrayValue: { values: [0, 1, 2, 3, 4, 5, 6].map(V.i) } },
    offSaturdayOrdinals: { arrayValue: { values: [] } },
  });
  const mins = (m) => V.i(m * 60_000);
  await putDoc('app_config/sla', {
    WARM: { mapValue: { fields: { stage1Ms: mins(15), stage2Ms: mins(30) } } },
    COLD: { mapValue: { fields: { stage1Ms: mins(48 * 60), stage2Ms: mins(24 * 60) } } },
    MANUAL: { mapValue: { fields: { stage1Ms: V.i(0), stage2Ms: mins(30) } } },
  });

  // ── 1. Warm ADS unassigned 20 min → Stage-1 breach, alert escalation, dedup ──
  await putDoc('leads/L1', { source: V.s('ADS'), receivedAt: V.t(isoMinus(20)), converted: V.b(false),
    assignedRm: V.n(), firstContactedAt: V.n(), status: V.s('NEW'), name: V.s('Warm One') });
  const r1 = await sweep(token);
  r1.status === 200 ? ok('sweep authorised (admin)') : bad('sweep auth', JSON.stringify(r1));
  has(await getDoc('leads/L1'), 'slaStage1BreachedAt') ? ok('Stage-1 breach stamped on warm unassigned (20m > 15m)') : bad('stage1 stamp');
  const dutyItems1 = await listItems(DUTY);
  dutyItems1.some((d) => d.fields?.title?.stringValue?.includes('Warm One')) ? ok('Stage-1 alert delivered to dynamic recipient (active CRM manager)') : bad('stage1 notify', `${dutyItems1.length} items`);
  // dedup: a second sweep must not re-alert L1
  const before = (await listItems(DUTY)).length;
  await sweep(token);
  (await listItems(DUTY)).length === before ? ok('Stage-1 dedup holds on re-run') : bad('stage1 dedup');

  // ── 2. Warm unassigned 40 min, no contact → Stage-2 breach, late attribution ──
  await putDoc('leads/L2', { source: V.s('ADS'), receivedAt: V.t(isoMinus(40)), converted: V.b(false),
    assignedRm: V.n(), firstContactedAt: V.n(), status: V.s('NEW'), name: V.s('Warm Two') });
  await sweep(token);
  has(await getDoc('leads/L2'), 'slaStage2BreachedAt') ? ok('Stage-2 breach stamped (40m > 30m from capture)') : bad('stage2 stamp');
  (await listItems(DUTY)).some((d) => d.fields?.body?.stringValue?.includes('late')) ? ok('Stage-2 alert attributes LATE assignment (unassigned)') : bad('stage2 attribution');

  // ── 3. Warm ASSIGNED on-time, no contact 40 min → owner + manager, timely ──
  await putDoc('leads/L3', { source: V.s('ADS'), receivedAt: V.t(isoMinus(40)), converted: V.b(false),
    assignedRm: V.s('FAPL-OWNER'), assignedAt: V.t(isoMinus(39)), firstContactedAt: V.n(), status: V.s('NEW'), name: V.s('Warm Three') });
  await sweep(token);
  has(await getDoc('leads/L3'), 'slaStage2BreachedAt') ? ok('Stage-2 breach on assigned-uncontacted lead') : bad('stage2 assigned stamp');
  const ownerItems = await listItems(OWNER), mgrItems = await listItems(MGR);
  ownerItems.some((d) => d.fields?.title?.stringValue?.includes('Warm Three')) ? ok('Stage-2 alert to OWNER (telecaller)') : bad('stage2 owner notify');
  mgrItems.some((d) => d.fields?.title?.stringValue?.includes('Warm Three')) ? ok('Stage-2 alert escalates to MANAGER') : bad('stage2 manager notify');
  ownerItems.some((d) => d.fields?.body?.stringValue?.includes('timely')) ? ok('attribution = TIMELY assignment (assigned in 1m)') : bad('timely attribution');

  // ── 4. Cold bulk unassigned 1h → NO Stage-1 breach (48h window) ──
  await putDoc('leads/L4', { source: V.s('offline_bulk'), importBatchId: V.s('B1'), createdAt: V.t(isoMinus(60)),
    deleted: V.b(false), primaryOwnerId: V.s('UNASSIGNED'), firstContactedAt: V.n(), name: V.s('Cold Four') });
  await sweep(token);
  !has(await getDoc('leads/L4'), 'slaStage1BreachedAt') ? ok('Cold bulk does NOT Stage-1-breach before 48h') : bad('cold stage1 false-breach');

  // ── 5. firstContactedAt stamps once via PATCH, never overwritten ──
  const created = await api('POST', '/api/crm2/leads', token, { name: 'Patch Five', mobile: '9701090005', source: 'ADS', category: 'LOAN' });
  const L5 = created.data.id;
  L5 ? ok(`CRM2 lead created (${L5})`) : bad('create L5', JSON.stringify(created));
  await api('PATCH', `/api/crm2/leads/${L5}`, token, { status: 'ATTEMPTED' });
  const fc1 = (await getDoc(`leads/${L5}`))?.fields?.firstContactedAt?.timestampValue;
  fc1 ? ok('firstContactedAt stamped on status→ATTEMPTED') : bad('firstContact stamp');
  await api('PATCH', `/api/crm2/leads/${L5}`, token, { activity: { note: 'second touch later' } });
  const fc2 = (await getDoc(`leads/${L5}`))?.fields?.firstContactedAt?.timestampValue;
  fc2 === fc1 ? ok('firstContactedAt is set-once (not overwritten by later contact)') : bad('set-once', `${fc1} → ${fc2}`);

  // ── 6. Old-model backfill: an activity exists without the stamp → sweep backfills ──
  await putDoc('leads/L6', { source: V.s('walkin'), createdAt: V.t(isoMinus(40)), deleted: V.b(false),
    primaryOwnerId: V.s(OWNER), firstContactedAt: V.n(), name: V.s('Old Six') });
  await putDoc('leads/L6/activities/a1', { type: V.s('call'), content: V.s('spoke'), at: V.t(isoMinus(30)), by: V.s(OWNER) });
  await sweep(token);
  const l6 = await getDoc('leads/L6');
  has(l6, 'firstContactedAt') ? ok('old-model firstContactedAt backfilled from earliest activity') : bad('backfill');
  !has(l6, 'slaStage2BreachedAt') ? ok('backfilled lead does NOT Stage-2-breach') : bad('backfill false-breach');

  // ── 7. Config-driven: relaxing the window stops the breach (no redeploy) ──
  await putDoc('app_config/sla', {
    WARM: { mapValue: { fields: { stage1Ms: mins(99 * 60), stage2Ms: mins(99 * 60) } } },
    COLD: { mapValue: { fields: { stage1Ms: mins(48 * 60), stage2Ms: mins(24 * 60) } } },
    MANUAL: { mapValue: { fields: { stage1Ms: V.i(0), stage2Ms: mins(30) } } },
  });
  await putDoc('leads/L7', { source: V.s('ADS'), receivedAt: V.t(isoMinus(20)), converted: V.b(false),
    assignedRm: V.n(), firstContactedAt: V.n(), status: V.s('NEW'), name: V.s('Warm Seven') });
  await sweep(token);
  !has(await getDoc('leads/L7'), 'slaStage1BreachedAt') ? ok('config-driven: widened window → no breach (read from app_config/sla)') : bad('config not honoured');

  console.log(`\n${fail === 0 ? '✅' : '❌'} SLA gate: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
