/**
 * Connector isolation gate — proves that a CONNECTOR account can reach ONLY its
 * own data, and that staff access is unchanged.
 *
 * WHY THIS EXISTS: connectors are external channel partners who are nevertheless
 * issued a @finvastra.com login, so nothing about the identity distinguishes them
 * from staff — only `connectorId` does. Scoping that lives in a page's query is
 * NOT a boundary (a connector can open devtools or call the REST API directly),
 * so this gate deliberately bypasses the UI and the Express API and reads
 * Firestore DIRECTLY with each principal's own ID token. That is exactly the
 * attack surface, and the rules are the only thing standing in it.
 *
 * Proves, for connector A vs connector B:
 *   - A reads own lead / case / payout / connector record          → ALLOWED
 *   - A reads B's lead / case / payout / connector record          → DENIED
 *   - A cannot list the staff directory (/users)                   → DENIED
 *   - A reads own /users doc                                       → ALLOWED
 *   - lead create FORCES channelPartnerId to A (body ignored)      → attribution safe
 *   - A cannot PATCH B's lead through the API                      → 404
 *   - A cannot re-attribute its own lead to B                      → ignored
 *   - staff (admin) still read every lead / connector / user       → NO REGRESSION
 *
 * Run: npm run qa:connector
 */
const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };

const docUrl = (path) => `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;

/** Create an emulator auth user + its /users doc (written as owner, bypassing rules). */
async function makeUser(label, fields) {
  const email = `conn-gate-${label}-${Date.now()}@finvastra.com`;
  const su = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  await fetch(docUrl(`users/${su.localId}`), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: {
      userId: { stringValue: su.localId }, email: { stringValue: email },
      displayName: { stringValue: `Gate ${label}` },
      ...fields,
    } }),
  });
  return { uid: su.localId, token: su.idToken, email };
}

/** Seed a document as owner (bypasses rules) — we are testing READS, not writes. */
async function seed(path, fields) {
  const r = await fetch(docUrl(path), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`seed ${path} failed: ${r.status} ${await r.text()}`);
}

/** Read a doc AS a principal — the rules decide. Returns the HTTP status. */
async function readAs(token, path) {
  const r = await fetch(docUrl(path), { headers: { Authorization: `Bearer ${token}` } });
  return r.status;
}
/** List a collection AS a principal — exercises the `list` rule specifically. */
async function listAs(token, coll) {
  const r = await fetch(`${docUrl(coll)}?pageSize=5`, { headers: { Authorization: `Bearer ${token}` } });
  return r.status;
}
async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const str = (v) => ({ stringValue: v });

const ALLOWED = (s) => s === 200;
const DENIED = (s) => s === 403 || s === 404;

async function main() {
  const A_ID = 'CON-901';   // connector A's own record id
  const B_ID = 'CON-902';   // connector B — the "someone else" A must never see

  // ── principals ──────────────────────────────────────────────────────────────
  const admin = await makeUser('admin', {
    role: str('admin'), employeeId: str('FAPL-022'),
  });
  const connA = await makeUser('connA', {
    role: str('employee'), connectorId: str(A_ID),
    hrmsAccess: { booleanValue: false }, crmAccess: { booleanValue: true },
    perms: { mapValue: { fields: {
      'crm.leads.write': { booleanValue: true },
      'crm.leads.read': { booleanValue: true },
      'crm.cases.read': { booleanValue: true },
    } } },
  });
  const connB = await makeUser('connB', {
    role: str('employee'), connectorId: str(B_ID),
    hrmsAccess: { booleanValue: false }, crmAccess: { booleanValue: true },
  });

  // ── seed both partners' worlds ──────────────────────────────────────────────
  await seed(`connectors/${A_ID}`, { connectorCode: str(A_ID), displayName: str('Partner A'), mobile: str('9000000001') });
  await seed(`connectors/${B_ID}`, { connectorCode: str(B_ID), displayName: str('Partner B'), mobile: str('9000000002') });

  await seed('leads/LD-GATE-A', { name: str('A Customer'), mobile: str('9800000001'), channelPartnerId: str(A_ID), receivedAt: { timestampValue: '2026-07-01T00:00:00Z' }, deleted: { booleanValue: false } });
  await seed('leads/LD-GATE-B', { name: str('B Customer'), mobile: str('9800000002'), channelPartnerId: str(B_ID), receivedAt: { timestampValue: '2026-07-01T00:00:00Z' }, deleted: { booleanValue: false } });

  await seed('cases/FIN-GATE-A', { clientName: str('A Client'), channelPartnerId: str(A_ID), stage: str('OPENED') });
  await seed('cases/FIN-GATE-B', { clientName: str('B Client'), channelPartnerId: str(B_ID), stage: str('OPENED') });

  await seed('connector_payouts/PAY-GATE-A', { connectorId: str(A_ID), amount: { doubleValue: 2000 }, status: str('pending') });
  await seed('connector_payouts/PAY-GATE-B', { connectorId: str(B_ID), amount: { doubleValue: 9999 }, status: str('pending') });

  console.log('\n— connector A reaches its OWN data —');
  ALLOWED(await readAs(connA.token, `leads/LD-GATE-A`)) ? ok('A reads own lead') : bad('A reads own lead');
  ALLOWED(await readAs(connA.token, `cases/FIN-GATE-A`)) ? ok('A reads own case') : bad('A reads own case');
  ALLOWED(await readAs(connA.token, `connector_payouts/PAY-GATE-A`)) ? ok('A reads own payout') : bad('A reads own payout');
  ALLOWED(await readAs(connA.token, `connectors/${A_ID}`)) ? ok('A reads own connector record') : bad('A reads own connector record');
  ALLOWED(await readAs(connA.token, `users/${connA.uid}`)) ? ok('A reads own user doc') : bad('A reads own user doc');

  console.log('\n— connector A is BLOCKED from everyone else —');
  DENIED(await readAs(connA.token, `leads/LD-GATE-B`)) ? ok("A CANNOT read B's lead") : bad("A CANNOT read B's lead", 'LEAK');
  DENIED(await readAs(connA.token, `cases/FIN-GATE-B`)) ? ok("A CANNOT read B's case") : bad("A CANNOT read B's case", 'LEAK');
  DENIED(await readAs(connA.token, `connector_payouts/PAY-GATE-B`)) ? ok("A CANNOT read B's payout") : bad("A CANNOT read B's payout", 'LEAK');
  DENIED(await readAs(connA.token, `connectors/${B_ID}`)) ? ok("A CANNOT read B's connector record (contact details)") : bad("A CANNOT read B's connector record", 'LEAK');
  DENIED(await readAs(connA.token, `users/${connB.uid}`)) ? ok("A CANNOT read B's user doc") : bad("A CANNOT read B's user doc", 'LEAK');
  DENIED(await listAs(connA.token, 'users')) ? ok('A CANNOT list the staff directory') : bad('A CANNOT list /users', 'LEAK');
  DENIED(await listAs(connA.token, 'connectors')) ? ok('A CANNOT list the connector registry') : bad('A CANNOT list /connectors', 'LEAK');

  console.log('\n— attribution cannot be forged —');
  const created = await api('POST', '/api/crm2/leads', connA.token, {
    name: 'Forged Attribution', mobile: '9800000009', category: 'LOAN', source: 'WALKIN',
    channelPartnerId: B_ID, channelPartnerCode: 'CON-902', channelPartnerName: 'Partner B',
  });
  if (created.status === 200 && created.data.id) {
    const r = await fetch(docUrl(`leads/${created.data.id}`), { headers: { Authorization: 'Bearer owner' } });
    const cp = (await r.json()).fields?.channelPartnerId?.stringValue;
    cp === A_ID
      ? ok(`lead create FORCED attribution to A (body claimed B, stored ${cp})`)
      : bad('lead create attribution', `expected ${A_ID}, got ${cp}`);
  } else {
    bad('lead create by connector', JSON.stringify(created).slice(0, 160));
  }

  const patchOther = await api('PATCH', '/api/crm2/leads/LD-GATE-B', connA.token, { name: 'hijacked' });
  patchOther.status === 404
    ? ok("A CANNOT PATCH B's lead through the API (404)")
    : bad("A PATCH B's lead", `expected 404, got ${patchOther.status}`);

  const reattr = await api('PATCH', '/api/crm2/leads/LD-GATE-A', connA.token, { channelPartnerId: B_ID });
  if (reattr.status === 200) {
    const r = await fetch(docUrl('leads/LD-GATE-A'), { headers: { Authorization: 'Bearer owner' } });
    const cp = (await r.json()).fields?.channelPartnerId?.stringValue;
    cp === A_ID ? ok('A CANNOT re-attribute its own lead to B (ignored)') : bad('re-attribution', `now ${cp}`);
  } else {
    ok(`A CANNOT re-attribute its own lead to B (${reattr.status})`);
  }

  console.log('\n— staff access is UNCHANGED (regression) —');
  ALLOWED(await readAs(admin.token, 'leads/LD-GATE-A')) ? ok('admin still reads any lead') : bad('admin reads lead', 'REGRESSION');
  ALLOWED(await readAs(admin.token, 'leads/LD-GATE-B')) ? ok("admin still reads another partner's lead") : bad('admin reads lead B', 'REGRESSION');
  ALLOWED(await readAs(admin.token, `connectors/${B_ID}`)) ? ok('admin still reads the connector registry') : bad('admin reads connector', 'REGRESSION');
  ALLOWED(await listAs(admin.token, 'users')) ? ok('admin still lists the staff directory') : bad('admin lists /users', 'REGRESSION');
  ALLOWED(await readAs(admin.token, 'connector_payouts/PAY-GATE-B')) ? ok('admin still reads any payout') : bad('admin reads payout', 'REGRESSION');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
