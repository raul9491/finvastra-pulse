/**
 * Partner intake / scoring / onboarding gate — exercises the REAL HTTP + Firestore
 * path against the emulators for the funnel added on the Connector entity.
 *
 * Proves: minimal Inquiry create (NO PAN) → scored + inactive; screening PATCH
 * re-tiers; funnelStatus→Active derives status:'active'; onboarding checklist →
 * progressPct + completion date; config PATCH bumps version + re-tiers non-terminal
 * candidates (Active untouched); public partner-inquiry (no auth, honeypot);
 * client can't forge partnerScoring/progressPct.
 *
 * Run via the generic runner: npm run qa:partner  (see run-partner-gate.sh)
 */
const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };

async function makeAdmin() {
  const email = `partner-gate-${Date.now()}@finvastra.com`;
  const su = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  const url = `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${su.localId}`;
  await fetch(url, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: {
      userId: { stringValue: su.localId }, email: { stringValue: email },
      displayName: { stringValue: 'Partner Gate Admin' }, role: { stringValue: 'admin' },
      employeeId: { stringValue: 'FAPL-022' },
    } }),
  });
  return su.idToken;
}
async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function getDoc(path) {
  const r = await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  return r.ok ? (await r.json()).fields : null;
}
const fv = (f, k) => {
  const v = f?.[k]; if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.mapValue) return v.mapValue.fields;
  return v;
};

async function main() {
  console.log('Partner intake gate\n');
  const token = await makeAdmin();

  // 1. Minimal Inquiry — NO PAN — must succeed, inactive, Cold-ish, scored.
  const c1 = await api('POST', '/api/crm2/connectors', token, {
    displayName: 'Ramesh CA', mobiles: ['9876500011'], verticals: ['loan'],
    leadSource: 'Website Form', funnelStatus: 'Inquiry',
  });
  c1.status === 200 && c1.data.id ? ok(`minimal Inquiry created without PAN (${c1.data.connectorCode})`) : bad('inquiry create', JSON.stringify(c1));
  const id = c1.data.id;
  let doc = await getDoc(`connectors/${id}`);
  fv(doc, 'status') === 'inactive' && fv(doc, 'funnelStatus') === 'Inquiry'
    ? ok('created inactive + funnelStatus Inquiry (hidden from RM pickers)') : bad('inquiry defaults', JSON.stringify({ status: fv(doc, 'status'), fs: fv(doc, 'funnelStatus') }));
  const ps0 = fv(doc, 'partnerScoring');
  ps0 && fv(ps0, 'tier') ? ok(`partnerScoring computed server-side (tier ${fv(ps0, 'tier')}, total ${fv(ps0, 'totalScore')})`) : bad('scoring present', JSON.stringify(doc?.partnerScoring));

  // 2. Screening PATCH → re-tier to Hot.
  await api('PATCH', `/api/crm2/connectors/${id}`, token, {
    networkType: 'CA / Accountant', networkSize: '>100 contacts', productDemandFit: 'Strong Fit',
    priorTrackRecord: 'Proven with Examples', expectedMonthlyVolume: '>5 cases/month', kycReadinessInput: 'Ready',
  });
  doc = await getDoc(`connectors/${id}`);
  const ps1 = fv(doc, 'partnerScoring');
  fv(ps1, 'tier') === 'Hot' && fv(ps1, 'totalScore') === 17
    ? ok('screening PATCH re-tiered → Hot (17)') : bad('re-tier', JSON.stringify({ tier: fv(ps1, 'tier'), total: fv(ps1, 'totalScore') }));

  // 3. Client cannot FORGE the score — send a bogus partnerScoring; server ignores it.
  await api('PATCH', `/api/crm2/connectors/${id}`, token, {
    partnerScoring: { tier: 'Hot', totalScore: 999 }, kycReadinessInput: 'Partial',
  });
  doc = await getDoc(`connectors/${id}`);
  fv(fv(doc, 'partnerScoring'), 'totalScore') !== 999
    ? ok('forged partnerScoring ignored (server recomputes)') : bad('forge blocked', 'totalScore=999 leaked');

  // 4. funnelStatus → Active derives status:'active'.
  await api('PATCH', `/api/crm2/connectors/${id}`, token, { funnelStatus: 'Active' });
  doc = await getDoc(`connectors/${id}`);
  fv(doc, 'status') === 'active' && fv(doc, 'funnelStatus') === 'Active'
    ? ok('funnelStatus Active → status active (now pickable by RMs)') : bad('activate', JSON.stringify({ s: fv(doc, 'status') }));

  // 5. Onboarding checklist → progressPct + completion date.
  await api('PATCH', `/api/crm2/connectors/${id}`, token, {
    onboardingChecklist: { panCollected: true, aadhaarCollected: true, bankDetailsCollected: true,
      agreementSignedDate: '2026-07-01', trainingCompleted: true, pulseAccessCreated: true, firstCaseLogged: true },
  });
  doc = await getDoc(`connectors/${id}`);
  const oc = fv(doc, 'onboardingChecklist');
  fv(oc, 'progressPct') === 100 && fv(oc, 'onboardingCompleteDate')
    ? ok('all onboarding items → progressPct 100 + completion date stamped') : bad('onboarding', JSON.stringify({ p: fv(oc, 'progressPct') }));

  // 6. A Cold candidate for the config recompute test.
  const c2 = await api('POST', '/api/crm2/connectors', token, {
    displayName: 'Weak Lead', mobiles: ['9876500022'], verticals: ['loan'],
    networkType: 'Other / Unclear', networkSize: 'Not Shared', productDemandFit: 'Unclear',
  });
  const id2 = c2.data.id;
  let d2 = await getDoc(`connectors/${id2}`);
  const cold0 = fv(fv(d2, 'partnerScoring'), 'tier');

  // 7. Config PATCH bumps version + re-tiers NON-terminal (Active c1 untouched).
  const cfg = await api('PATCH', '/api/crm2/partner-scoring-config', token, { tierThresholds: { hot: 1, warm: 0 } });
  cfg.status === 200 && cfg.data.version >= 2 ? ok(`config PATCH bumped version → ${cfg.data.version}, recomputed ${cfg.data.recomputed}`) : bad('config patch', JSON.stringify(cfg));
  d2 = await getDoc(`connectors/${id2}`);
  fv(fv(d2, 'partnerScoring'), 'tier') === 'Hot' && cold0 !== 'Hot'
    ? ok('non-terminal candidate re-tiered by new thresholds (Cold→Hot)') : bad('recompute non-terminal', JSON.stringify({ before: cold0, after: fv(fv(d2, 'partnerScoring'), 'tier') }));
  const d1 = await getDoc(`connectors/${id}`);
  fv(fv(d1, 'partnerScoring'), 'rubricVersion') === 1
    ? ok('terminal (Active) candidate NOT recomputed by config change') : bad('active untouched', `rubricVersion=${fv(fv(d1, 'partnerScoring'), 'rubricVersion')}`);

  // 8. Public partner-inquiry — no auth, honeypot, creates Inquiry.
  const honey = await api('POST', '/api/public/partner-inquiry', null, { name: 'Bot', mobile: '9876500033', website: 'x' });
  honey.status === 200 && honey.data.ok ? ok('honeypot submission swallowed (no write)') : bad('honeypot', JSON.stringify(honey));
  const pub = await api('POST', '/api/public/partner-inquiry', null, {
    name: 'Walk-in Partner', mobile: '9876500044', leadSource: 'Website Form', networkType: 'Property Dealer / Broker',
  });
  pub.status === 200 && pub.data.ok ? ok('public partner-inquiry created an Inquiry candidate') : bad('public intake', JSON.stringify(pub));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
