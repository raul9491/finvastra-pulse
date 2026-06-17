/**
 * FIFO pull-queue — emulator integration gate. Proves: oldest-first claim, atomic
 * concurrent claims (two reps never get the same lead), skill gating + empty-skills=all,
 * claim stamps owner/assignedAt/ASSIGNED, release preserves captureAt + bumps releaseCount
 * + flags at 3, /state depth+age+SLA countdown, SLA regression (unclaimed still Stage-1
 * breaches; firstContactedAt stamps post-claim), and live app_config/queues reshape.
 *
 * Run: `npm run qa:queue` (boots emulators + dev server). Seeds 24/7 business hours so
 * SLA timing is deterministic.
 */
const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };

const docUrl = (p) => `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${p}`;
const isoMinus = (m) => new Date(Date.now() - m * 60_000).toISOString();
const V = {
  s: (v) => ({ stringValue: v }), b: (v) => ({ booleanValue: v }),
  n: () => ({ nullValue: null }), t: (iso) => ({ timestampValue: iso }), i: (v) => ({ integerValue: String(v) }),
  arr: (vals) => ({ arrayValue: { values: vals } }),
};
async function putDoc(path, fields) {
  const r = await fetch(docUrl(path), { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields }) });
  if (r.status !== 200) throw new Error(`putDoc ${path}: ${r.status} ${await r.text()}`);
}
async function getDoc(path) {
  const r = await fetch(docUrl(path), { headers: { Authorization: 'Bearer owner' } });
  return r.status === 200 ? r.json() : null;
}
const has = (d, f) => d?.fields?.[f] !== undefined && d?.fields?.[f]?.nullValue === undefined;
const fv = (d, f) => d?.fields?.[f]?.stringValue ?? null;
async function api(method, path, token, body) {
  const r = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function signUp() {
  const email = `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@finvastra.com`;
  const s = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  return { token: s.idToken, uid: s.localId, email };
}
async function makeAdmin() {
  const s = await signUp();
  await putDoc(`users/${s.uid}`, { userId: V.s(s.uid), email: V.s(s.email), role: V.s('admin'), employeeId: V.s('FAPL-022') });
  return s.token;
}
async function makeRm(fapl, queueSkills) {
  const s = await signUp();
  const fields = {
    userId: V.s(s.uid), email: V.s(s.email), role: V.s('employee'), employeeId: V.s(fapl), employeeStatus: V.s('active'),
    perms: { mapValue: { fields: { 'crm.leads.write': V.b(true), 'crm.leads.read': V.b(true) } } },
  };
  if (queueSkills) fields.queueSkills = V.arr(queueSkills.map(V.s));
  await putDoc(`users/${s.uid}`, fields);
  return { token: s.token, fapl };
}
const warmLead = (extra) => ({ source: V.s('ADS'), converted: V.b(false), assignedRm: V.n(), firstContactedAt: V.n(), status: V.s('NEW'), ...extra });
const claim = (token) => api('POST', '/api/crm2/queue/claim', token, {});

async function main() {
  console.log('FIFO pull-queue — emulator integration gate\n');
  const admin = await makeAdmin();
  // Config: 24/7 hours (deterministic SLA), tight WARM window, default queues.
  await putDoc('app_config/business_hours', { tzOffsetMinutes: V.i(0), startMinutes: V.i(0), endMinutes: V.i(1440), workingDows: V.arr([0,1,2,3,4,5,6].map(V.i)), offSaturdayOrdinals: { arrayValue: { values: [] } } });
  const mins = (m) => V.i(m * 60_000);
  await putDoc('app_config/sla', { WARM: { mapValue: { fields: { stage1Ms: mins(15), stage2Ms: mins(30) } } }, COLD: { mapValue: { fields: { stage1Ms: mins(2880), stage2Ms: mins(1440) } } }, MANUAL: { mapValue: { fields: { stage1Ms: V.i(0), stage2Ms: mins(30) } } } });
  await putDoc('app_config/queues', { queues: { arrayValue: { values: [
    { mapValue: { fields: { id: V.s('loans'), name: V.s('Loans'), skill: V.s('LOANS'), productFilter: V.arr([V.s('LOAN')]) } } },
    { mapValue: { fields: { id: V.s('sip'), name: V.s('SIP'), skill: V.s('SIP'), productFilter: V.arr([V.s('WEALTH')]) } } },
  ] } } });

  // ── 1. FIFO + atomic concurrent claim ──────────────────────────────────────
  await putDoc('leads/Q1', warmLead({ category: V.s('LOAN'), name: V.s('Loan One'), receivedAt: V.t(isoMinus(30)) }));
  await putDoc('leads/Q2', warmLead({ category: V.s('LOAN'), name: V.s('Loan Two'), receivedAt: V.t(isoMinus(20)) }));
  await putDoc('leads/Q3', warmLead({ category: V.s('LOAN'), name: V.s('Loan Three'), receivedAt: V.t(isoMinus(10)) }));
  const A = await makeRm('FAPL-A', []), B = await makeRm('FAPL-B', []), C = await makeRm('FAPL-C', []);
  const [ra, rb] = await Promise.all([claim(A.token), claim(B.token)]);   // concurrent
  const idA = ra.data.lead?.id, idB = rb.data.lead?.id;
  idA && idB && idA !== idB ? ok(`concurrent claims yield DIFFERENT leads (${idA} ≠ ${idB})`) : bad('concurrency', `${idA} / ${idB}`);
  [idA, idB].every((x) => ['Q1', 'Q2'].includes(x)) ? ok('FIFO: the two oldest (Q1,Q2) were served first') : bad('FIFO order', `${idA},${idB}`);
  const claimedDoc = await getDoc(`leads/${idA}`);
  fv(claimedDoc, 'status') === 'ASSIGNED' && fv(claimedDoc, 'assignedRm') === 'FAPL-A' && has(claimedDoc, 'assignedAt')
    ? ok('claim stamps assignedRm + assignedAt + status ASSIGNED') : bad('claim stamp', JSON.stringify(claimedDoc?.fields?.status));
  const rc = await claim(C.token);
  rc.data.lead?.id === 'Q3' ? ok('third claim serves Q3 (next in line)') : bad('third claim', rc.data.lead?.id);
  (await claim(C.token)).data.lead === null ? ok('empty queue → null lead' ) : bad('empty queue');

  // ── 2. Skill gating + empty-skills = all ───────────────────────────────────
  await putDoc('leads/W1', warmLead({ category: V.s('WEALTH'), name: V.s('Wealth One'), receivedAt: V.t(isoMinus(25)) }));
  const loansRm = await makeRm('FAPL-L', ['LOANS']);
  (await claim(loansRm.token)).data.lead === null ? ok('LOANS-skill rep cannot claim a WEALTH lead') : bad('skill gate (loans→wealth)');
  const sipRm = await makeRm('FAPL-S', ['SIP']);
  (await claim(sipRm.token)).data.lead?.id === 'W1' ? ok('SIP-skill rep claims the WEALTH lead') : bad('skill gate (sip→wealth)');
  await putDoc('leads/W2', warmLead({ category: V.s('WEALTH'), name: V.s('Wealth Two'), receivedAt: V.t(isoMinus(5)) }));
  const anyRm = await makeRm('FAPL-ANY', []);   // empty skills
  (await claim(anyRm.token)).data.lead?.id === 'W2' ? ok('empty queueSkills → eligible for ALL (claims WEALTH)') : bad('empty skills = all');

  // ── 3. Release: real claim→release cycles + flag at 3 ──────────────────────
  // R1 is the only waiting lead now, so each release (preserving receivedAt) puts it
  // back at the front and the next claim re-serves it — a real bounce loop.
  await putDoc('leads/R1', warmLead({ category: V.s('LOAN'), name: V.s('Rel One'), receivedAt: V.t(isoMinus(40)) }));
  const capBefore = (await getDoc('leads/R1'))?.fields?.receivedAt?.timestampValue;
  const relRm = await makeRm('FAPL-R', []);
  for (let i = 1; i <= 3; i++) {
    const c = await claim(relRm.token);
    if (i === 1) (c.data.lead?.id === 'R1' ? ok('claimed R1 for release test') : bad('claim R1', c.data.lead?.id));
    const rel = await api('POST', '/api/crm2/queue/release', relRm.token, { leadId: 'R1', reason: `bounce ${i}` });
    if (i === 1) {
      const afterRel = await getDoc('leads/R1');
      rel.data.releaseCount === 1 && fv(afterRel, 'status') === 'QUEUED' && !has(afterRel, 'assignedRm')
        ? ok('release → QUEUED, unassigned, releaseCount 1') : bad('release state', JSON.stringify(afterRel?.fields));
      afterRel?.fields?.receivedAt?.timestampValue === capBefore ? ok('release preserves captureAt (keeps its place)') : bad('captureAt preserved');
    }
  }
  const flagged = await getDoc('leads/R1');
  flagged?.fields?.releaseCount?.integerValue === '3' && flagged?.fields?.queueFlagged?.booleanValue === true
    ? ok('flagged for manager at releaseCount >= 3') : bad('flag at 3', JSON.stringify(flagged?.fields?.queueFlagged));

  // ── 4. /state — depth + oldest age + SLA countdown ─────────────────────────
  await putDoc('leads/S1', warmLead({ category: V.s('LOAN'), name: V.s('State One'), receivedAt: V.t(isoMinus(50)) }));
  const st = await api('GET', '/api/crm2/queue/state', admin);
  const loansQ = st.data.queues?.find((q) => q.id === 'loans');
  st.status === 200 && loansQ && loansQ.depth >= 1 ? ok(`/state returns Loans depth (${loansQ.depth})`) : bad('state depth', JSON.stringify(st.data));
  loansQ && typeof loansQ.oldestWorkingAgeMs === 'number' && loansQ.oldestWorkingAgeMs > 0 ? ok('/state reports oldest-lead working age') : bad('state age');
  loansQ && loansQ.slaCountdownMs != null ? ok('/state reports SLA countdown for the oldest') : bad('state sla countdown');

  // ── 5. SLA regression: unclaimed Stage-1 breach + post-claim firstContact ──
  await putDoc('leads/U1', warmLead({ category: V.s('LOAN'), name: V.s('Unclaimed'), receivedAt: V.t(isoMinus(20)) }));
  await api('POST', '/api/crm2/jobs/run-lead-sla-sweep', admin, {});
  has(await getDoc('leads/U1'), 'slaStage1BreachedAt') ? ok('SLA regression: unclaimed lead still Stage-1 breaches') : bad('sla stage1 regression');
  await putDoc('leads/U2', warmLead({ category: V.s('LOAN'), name: V.s('Claimable'), receivedAt: V.t(isoMinus(3)) }));
  const cl = await makeRm('FAPL-FC', []);
  const got = await claim(cl.token);
  await api('PATCH', `/api/crm2/leads/${got.data.lead.id}`, cl.token, { status: 'ATTEMPTED' });
  has(await getDoc(`leads/${got.data.lead.id}`), 'firstContactedAt') ? ok('SLA regression: firstContactedAt stamps post-claim (Stage 2)') : bad('firstContact post-claim');

  // ── 6. Live config: single ["*"] queue reshapes behaviour with no redeploy ──
  await putDoc('app_config/queues', { queues: { arrayValue: { values: [
    { mapValue: { fields: { id: V.s('shared'), name: V.s('Shared'), skill: V.s('LOANS'), productFilter: V.arr([V.s('*')]) } } },
  ] } } });
  await putDoc('leads/Wc', warmLead({ category: V.s('WEALTH'), name: V.s('Wealth Cfg'), receivedAt: V.t(isoMinus(60)) }));
  const loansRm2 = await makeRm('FAPL-L2', ['LOANS']);
  const claimedWealth = await claim(loansRm2.token);   // LOANS rep now CAN claim WEALTH (single shared queue)
  claimedWealth.data.lead && fv(await getDoc(`leads/${claimedWealth.data.lead.id}`), 'category') === 'WEALTH'
    ? ok('live config: single ["*"] queue lets a LOANS rep claim WEALTH (no redeploy)') : bad('live config reshape', JSON.stringify(claimedWealth.data));

  console.log(`\n${fail === 0 ? '✅' : '❌'} Queue gate: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
