/**
 * CRM 2.0 Phase 4a acceptance — per-login pipeline (subcollection cases/{id}/logins).
 * Same prereqs as the other crm2 gates (emulators + dev server on :8090).
 *
 * Asserts: login open (LGN- id, FILE_LOGIN, seq) · field patch · stage forward-by-
 * one · DISBURSED reserved (422) · skip rejected (422) · early-close REJECTED ·
 * second login seq · protected-field patch rejected.
 */
const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };

async function makeAdmin() {
  const email = `p4a-admin-${Date.now()}@finvastra.com`;
  const s = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${s.localId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: {
      userId: { stringValue: s.localId }, email: { stringValue: email },
      displayName: { stringValue: 'P4a Admin' }, role: { stringValue: 'admin' },
      employeeId: { stringValue: 'FAPL-022' },
    } }),
  });
  return s.idToken;
}
async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function getDoc(path) {
  const r = await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { Authorization: 'Bearer owner' } });
  return r.status === 200 ? r.json() : null;
}
const fv = (doc, field) => doc?.fields?.[field]?.stringValue
  ?? doc?.fields?.[field]?.integerValue ?? doc?.fields?.[field]?.booleanValue ?? null;

async function main() {
  console.log('CRM 2.0 Phase 4a acceptance — per-login pipeline\n');
  const token = await makeAdmin();
  const stamp = Date.now() % 1000000;

  // Product + client + case
  const prod = await api('POST', '/api/crm2/masters/products', token, { name: `LAP-${stamp}`, shortCode: 'LAP', vertical: 'LOANS' });
  const client = await api('POST', '/api/crm2/clients', token, {
    name: `Login Co ${stamp}`, constitution: 'PVT_LTD', primaryContact: { mobile: `98${String(stamp).padStart(8, '0')}` },
  });
  const kase = await api('POST', '/api/crm2/cases', token, { clientId: client.data.id, productId: prod.data.id });
  kase.status === 200 && kase.data.caseId?.startsWith('FIN-CASE-')
    ? ok(`case opened (${kase.data.caseId})`) : bad('case open', JSON.stringify(kase));
  const caseId = kase.data.caseId;

  // 1. Open a login
  const l1 = await api('POST', `/api/crm2/cases/${caseId}/logins`, token, { lenderId: 'LEN-001', branch: 'Andheri' });
  l1.status === 200 && l1.data.loginId?.startsWith('LGN-') && l1.data.seq === 1
    ? ok(`login opened (${l1.data.loginId}, seq 1)`) : bad('login open', JSON.stringify(l1));
  const loginId = l1.data.loginId;
  const lDoc = await getDoc(`cases/${caseId}/logins/${loginId}`);
  fv(lDoc, 'stage') === 'FILE_LOGIN' && fv(lDoc, 'caseId') === caseId && fv(lDoc, 'branch') === 'Andheri'
    ? ok('login doc: FILE_LOGIN + caseId + branch') : bad('login fields', JSON.stringify({ stage: fv(lDoc, 'stage') }));

  // 2. Patch fields
  const patch = await api('PATCH', `/api/crm2/cases/${caseId}/logins/${loginId}`, token, {
    smName: 'Ravi', smNumber: '9876543210', loanApplicationNo: 'HDFC-APP-99', amountRequested: 5000000,
  });
  patch.status === 200 ? ok('login fields patched') : bad('login patch', JSON.stringify(patch));

  // 3. Protected field rejected
  const prot = await api('PATCH', `/api/crm2/cases/${caseId}/logins/${loginId}`, token, { stage: 'SANCTIONED' });
  prot.status === 400 ? ok('protected login field (stage) rejected') : bad('protected', JSON.stringify(prot));

  // 4. Stage forward-by-one
  for (const to of ['CODE_LOGIN_DONE', 'IN_PROCESS', 'SANCTIONED']) {
    const r = await api('POST', `/api/crm2/cases/${caseId}/logins/${loginId}/stage`, token, { to });
    if (!(r.status === 200 && r.data.to === to)) { bad(`advance → ${to}`, JSON.stringify(r)); }
  }
  const after = await getDoc(`cases/${caseId}/logins/${loginId}`);
  fv(after, 'stage') === 'SANCTIONED' ? ok('login advanced FILE_LOGIN→…→SANCTIONED') : bad('advanced', fv(after, 'stage'));

  // 5. DISBURSED reserved
  const disb = await api('POST', `/api/crm2/cases/${caseId}/logins/${loginId}/stage`, token, { to: 'DISBURSED' });
  disb.status === 422 && /disburse endpoint/.test(disb.data.error ?? '')
    ? ok('DISBURSED reserved for the disburse endpoint (422)') : bad('disbursed reserve', JSON.stringify(disb));

  // 6. Skip rejected
  const skip = await api('POST', `/api/crm2/cases/${caseId}/logins/${loginId}/stage`, token, { to: 'COMPLETED' });
  skip.status === 422 ? ok('skip to COMPLETED without outcome rejected (422)') : bad('skip', JSON.stringify(skip));

  // 7. Early-close a SECOND login as REJECTED
  const l2 = await api('POST', `/api/crm2/cases/${caseId}/logins`, token, { lenderId: 'LEN-002' });
  l2.data.seq === 2 ? ok(`second login seq 2 (${l2.data.loginId})`) : bad('second login', JSON.stringify(l2));
  const rej = await api('POST', `/api/crm2/cases/${caseId}/logins/${l2.data.loginId}/stage`, token, { to: 'COMPLETED', outcome: 'REJECTED', rejectionReason: 'Low CIBIL' });
  rej.status === 200 ? ok('second login early-closed REJECTED') : bad('reject', JSON.stringify(rej));
  const l2Doc = await getDoc(`cases/${caseId}/logins/${l2.data.loginId}`);
  fv(l2Doc, 'stage') === 'COMPLETED' && fv(l2Doc, 'outcome') === 'REJECTED'
    ? ok('rejected login: COMPLETED + outcome REJECTED') : bad('rejected doc', JSON.stringify({ s: fv(l2Doc, 'stage'), o: fv(l2Doc, 'outcome') }));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
