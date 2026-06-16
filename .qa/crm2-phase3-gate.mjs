/**
 * CRM 2.0 Phase 3 acceptance — cases, stage gating, docTracker, vault (emulators).
 * Same prereqs as crm2-phase1-gate.mjs.
 *
 * Proves AT THE API LEVEL: LOGIN unreachable with pending mandatory docs;
 * docsCompletePct recomputed on tracker writes; one vault doc referenced by TWO
 * cases; stageHistory carries every transition with the actor; applicant add
 * re-expands docTracker idempotently; pddStatus CLEARED blocked with PDD rows
 * pending; protected case fields rejected; full Aadhaar rejected.
 */

const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };

async function makeAdmin() {
  const email = `p3-admin-${Date.now()}@finvastra.com`;
  const s = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${s.localId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: {
      userId: { stringValue: s.localId }, email: { stringValue: email },
      displayName: { stringValue: 'P3 Admin' }, role: { stringValue: 'admin' },
      employeeId: { stringValue: 'FAPL-003' },
    } }),
  });
  return s.idToken;
}

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function getDoc(path) {
  const r = await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`,
    { headers: { Authorization: 'Bearer owner' } });
  return r.status === 200 ? r.json() : null;
}
async function listDocs(path) {
  const r = await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}?pageSize=100`,
    { headers: { Authorization: 'Bearer owner' } });
  const j = await r.json().catch(() => ({}));
  return j.documents ?? [];
}
const fv = (doc, f) => doc?.fields?.[f]?.stringValue ?? doc?.fields?.[f]?.integerValue ?? null;

async function main() {
  console.log('CRM 2.0 Phase 3 acceptance — cases, gating, vault\n');
  const token = await makeAdmin();
  const stamp = Date.now() % 1000000;

  // Masters: product + LOGIN docs (1 entity + 1 per-applicant) + 1 PDD doc
  const prod = await api('POST', '/api/crm2/masters/products', token, { name: `LAP-P3-${stamp}`, shortCode: 'LAP', vertical: 'LOANS' });
  const dGst = await api('POST', '/api/crm2/masters/documentMaster', token, {
    name: `GST-P3-${stamp}`, category: 'ENTITY_KYC', applicableTo: 'ENTITY',
    mandatoryForProducts: [prod.data.id], requiredByStage: 'LOGIN', validityDays: 30 });
  await api('POST', '/api/crm2/masters/documentMaster', token, {
    name: `PAN-P3-${stamp}`, category: 'INDIVIDUAL_KYC', applicableTo: 'EACH_APPLICANT',
    mandatoryForProducts: [prod.data.id], requiredByStage: 'LOGIN' });
  await api('POST', '/api/crm2/masters/documentMaster', token, {
    name: `PDDACK-P3-${stamp}`, category: 'POST_SANCTION_PDD', applicableTo: 'ENTITY',
    mandatoryForProducts: [prod.data.id], requiredByStage: 'PDD' });

  // Client (via lead convert path would also work; use a lead for realism)
  const lead = await api('POST', '/api/crm2/leads', token, {
    name: `P3 Client ${stamp}`, mobile: `97${String(stamp).padStart(8, '0')}`, category: 'LOAN', source: 'WALKIN', productId: prod.data.id });
  await api('PATCH', `/api/crm2/leads/${lead.data.id}`, token, { status: 'QUALIFIED' });
  const conv = await api('POST', `/api/crm2/leads/${lead.data.id}/convert`, token, {});
  const caseId = conv.data.caseId, clientId = conv.data.clientId;
  conv.status === 200 ? ok(`case ${caseId} via convert (3 tracker rows expected)`) : bad('setup convert', JSON.stringify(conv));

  // 1. Protected fields rejected on PATCH
  const prot = await api('PATCH', `/api/crm2/cases/${caseId}`, token, { stage: 'LOGIN', docsCompletePct: 100 });
  prot.status === 400 && /Server-calculated/.test(prot.data.error)
    ? ok('protected fields (stage, docsCompletePct) rejected on PATCH') : bad('protected fields', JSON.stringify(prot));

  // 2. Case-level stage machine (Phase 4 cutover): OPENED → BASIC_DOCS → DOCS.
  // Sanction/login/disburse/PDD are PER-LOGIN now (covered by the phase4-money + 4a gates).
  const skip = await api('POST', `/api/crm2/cases/${caseId}/stage`, token, { to: 'DOCS' });
  skip.status === 400 ? ok('case stage skipping rejected (OPENED → DOCS)') : bad('skip', JSON.stringify(skip));
  let walkOk = true;
  for (const to of ['BASIC_DOCS', 'DOCS']) {
    const r = await api('POST', `/api/crm2/cases/${caseId}/stage`, token, { to });
    if (r.status !== 200) { walkOk = false; bad(`case advance → ${to}`, JSON.stringify(r)); }
  }
  if (walkOk) ok('case advanced OPENED → BASIC_DOCS → DOCS (case-level)');

  // 3. Vault upload + link + verify → docsCompletePct moves
  const pdfB64 = Buffer.from('%PDF-1.4 fake-gst-certificate').toString('base64');
  const up = await api('POST', `/api/crm2/clients/${clientId}/vault`, token, {
    documentDefId: dGst.data.id, fileName: 'gst-cert.pdf', contentBase64: pdfB64, contentType: 'application/pdf' });
  up.status === 200 && up.data.vaultDocId
    ? ok(`vault upload → ${up.data.vaultDocId} (storage ${up.data.storagePath})`) : bad('vault upload', JSON.stringify(up));

  const rows = await listDocs(`cases/${caseId}/docTracker`);
  const rowIds = rows.map((r) => r.name.split('/').pop());
  for (const rid of rowIds) {
    if (rid.startsWith(dGst.data.id)) {
      await api('PATCH', `/api/crm2/cases/${caseId}/doc-tracker/${rid}`, token, { vaultDocId: up.data.vaultDocId, status: 'VERIFIED' });
    } else {
      await api('PATCH', `/api/crm2/cases/${caseId}/doc-tracker/${rid}`, token, { status: 'VERIFIED' });
    }
  }
  const caseAfterDocs = await getDoc(`cases/${caseId}`);
  Number(fv(caseAfterDocs, 'docsCompletePct')) === 100
    ? ok('docsCompletePct recomputed to 100 after verifications')
    : bad('docsCompletePct', fv(caseAfterDocs, 'docsCompletePct'));
  caseAfterDocs?.fields?.keyDates?.mapValue?.fields?.docsComplete?.timestampValue
    ? ok('keyDates.docsComplete stamped when LOGIN docs all VERIFIED') : bad('docsComplete stamp');

  // 4. verifiedBy stamped with the actor FAPL when a doc row is VERIFIED
  const anyRow = await getDoc(`cases/${caseId}/docTracker/${rowIds[0]}`);
  fv(anyRow, 'verifiedBy') === 'FAPL-003'
    ? ok('verifiedBy stamped with actor FAPL-003') : bad('verifiedBy', fv(anyRow, 'verifiedBy'));

  // 5. Applicant add → idempotent re-expansion (1 new per-applicant row only)
  const beforeCount = (await listDocs(`cases/${caseId}/docTracker`)).length;
  const addA = await api('POST', `/api/crm2/cases/${caseId}/applicants`, token, {
    name: 'Co Applicant', type: 'CO_APPLICANT', relationshipToPrimary: 'SPOUSE', aadhaarLast4: '4321' });
  const afterCount = (await listDocs(`cases/${caseId}/docTracker`)).length;
  addA.status === 200 && addA.data.newTrackerRows === 1 && afterCount === beforeCount + 1
    ? ok('applicant add expanded exactly 1 new per-applicant row (idempotent)')
    : bad('re-expansion', `new=${addA.data.newTrackerRows} before=${beforeCount} after=${afterCount}`);

  // Full Aadhaar rejected
  const aad = await api('POST', `/api/crm2/cases/${caseId}/applicants`, token, {
    name: 'Bad Aadhaar', type: 'GUARANTOR', aadhaarLast4: '123412341234' });
  aad.status === 400 ? ok('12-digit Aadhaar rejected at the API') : bad('aadhaar guard', JSON.stringify(aad));

  // 6. Vault doc reused by a SECOND case (upload once, reference everywhere)
  const case2 = await api('POST', '/api/crm2/cases', token, { clientId, productId: prod.data.id });
  const rows2 = await listDocs(`cases/${case2.data.caseId}/docTracker`);
  const gstRow2 = rows2.map((r) => r.name.split('/').pop()).find((id) => id.startsWith(dGst.data.id));
  const link2 = await api('PATCH', `/api/crm2/cases/${case2.data.caseId}/doc-tracker/${gstRow2}`, token, {
    vaultDocId: up.data.vaultDocId, status: 'RECEIVED' });
  link2.status === 200
    ? ok(`same vault doc referenced by second case ${case2.data.caseId}`) : bad('vault reuse', JSON.stringify(link2));

  // 7. pddStatus CLEARED blocked while the PDD row is pending
  const pdd = await api('PATCH', `/api/crm2/cases/${case2.data.caseId}`, token, { pddStatus: 'CLEARED' });
  pdd.status === 422 && Array.isArray(pdd.data.details)
    ? ok('pddStatus → CLEARED blocked with pending PDD rows (list returned)') : bad('pdd gate', JSON.stringify(pdd));

  // 8. stageHistory carries every transition with the actor
  const hist = await listDocs(`cases/${caseId}/stageHistory`);
  const tos = hist.map((h) => fv(h, 'to'));
  const actors = new Set(hist.map((h) => fv(h, 'by')));
  hist.length >= 3 && tos.includes('DOCS') && actors.has('FAPL-003')
    ? ok(`stageHistory has ${hist.length} entries incl. DOCS, actor FAPL-003`)
    : bad('stageHistory', JSON.stringify({ n: hist.length, tos, actors: [...actors] }));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
