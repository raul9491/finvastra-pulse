/**
 * CRM 2.0 Phase 4 (Build #2) acceptance — PER-LOGIN money engine.
 * Same prereqs as the other crm2 gates (emulators + dev server :8090).
 *
 * Proves: a login (not the case) is the unit of disbursement — disburse atomically
 * freezes economics on the login + creates a payout cycle (PC- per login) + MIS
 * record keyed by loginId; a milestone updates the LOGIN badge + misRecords/{loginId};
 * a login whose lender has no mapping is blocked.
 */
const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };

async function makeAdmin() {
  const email = `p4m-admin-${Date.now()}@finvastra.com`;
  const s = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${s.localId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: {
      userId: { stringValue: s.localId }, email: { stringValue: email },
      displayName: { stringValue: 'P4m Admin' }, role: { stringValue: 'admin' }, employeeId: { stringValue: 'FAPL-022' },
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
  const r = await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { Authorization: 'Bearer owner' } });
  return r.status === 200 ? r.json() : null;
}
async function listDocs(path) {
  const r = await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}?pageSize=80`, { headers: { Authorization: 'Bearer owner' } });
  return (await r.json().catch(() => ({}))).documents ?? [];
}
async function setDocFields(path, fields) {
  await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
}
const fv = (d, f) => d?.fields?.[f]?.stringValue ?? d?.fields?.[f]?.integerValue ?? d?.fields?.[f]?.doubleValue ?? d?.fields?.[f]?.booleanValue ?? null;
const fnum = (d, f) => { const x = d?.fields?.[f]; return x ? Number(x.integerValue ?? x.doubleValue ?? 0) : null; };

async function main() {
  console.log('CRM 2.0 Phase 4 Build #2 — per-login money engine\n');
  const token = await makeAdmin();
  const stamp = Date.now() % 1000000;

  // Masters: product, LOGIN + DISBURSEMENT doc defs, aggregator, lender, mapping+slab.
  const prod = await api('POST', '/api/crm2/masters/products', token, { name: `LAP-${stamp}`, shortCode: 'LAP', vertical: 'LOANS' });
  await api('POST', '/api/crm2/masters/documentMaster', token, { name: `GST-${stamp}`, category: 'ENTITY_KYC', applicableTo: 'ENTITY', mandatoryForProducts: [prod.data.id], requiredByStage: 'LOGIN' });
  await api('POST', '/api/crm2/masters/documentMaster', token, { name: `DRL-${stamp}`, category: 'POST_SANCTION_PDD', applicableTo: 'ENTITY', mandatoryForProducts: [prod.data.id], requiredByStage: 'DISBURSEMENT' });
  const conn = await api('POST', '/api/crm2/masters/aggregators', token, { name: `Agg-${stamp}`, type: 'MASTER_AGGREGATOR', payoutFrequency: 'MONTHLY', standardTdsPct: 5 });
  const lender = await api('POST', '/api/crm2/masters/lenders', token, { name: `Bank-${stamp}`, type: 'NBFC' });
  const lender2 = await api('POST', '/api/crm2/masters/lenders', token, { name: `Bank2-${stamp}`, type: 'NBFC' }); // no mapping
  const map = await api('POST', '/api/crm2/mappings', token, { connectorId: conn.data.id, lenderId: lender.data.id, productId: prod.data.id, dsaCode: '1033618', codeRegisteredName: 'AGG', slabs: [] });
  await api('POST', `/api/crm2/mappings/${map.data.id}/slabs`, token, { productIds: [prod.data.id], finvastraPayoutPct: 1.4, subDsaDefaultPayoutPct: 0.7, effectiveFrom: '2025-04-01', effectiveTo: null });

  // Client + case; verify ALL docTracker rows (so DISBURSEMENT gate passes).
  const client = await api('POST', '/api/crm2/clients', token, { name: `Co ${stamp}`, constitution: 'PVT_LTD', primaryContact: { mobile: `98${String(stamp).padStart(8, '0')}` } });
  const kase = await api('POST', '/api/crm2/cases', token, { clientId: client.data.id, productId: prod.data.id });
  const caseId = kase.data.caseId;
  for (const r of await listDocs(`cases/${caseId}/docTracker`)) {
    await api('PATCH', `/api/crm2/cases/${caseId}/doc-tracker/${r.name.split('/').pop()}`, token, { status: 'VERIFIED' });
  }

  // Login → SANCTIONED (connector+lender on the login).
  const l1 = await api('POST', `/api/crm2/cases/${caseId}/logins`, token, { lenderId: lender.data.id, connectorId: conn.data.id });
  const loginId = l1.data.loginId;
  await api('PATCH', `/api/crm2/cases/${caseId}/logins/${loginId}`, token, { docsSent: true });
  for (const to of ['CODE_LOGIN_DONE', 'IN_PROCESS', 'SANCTIONED']) await api('POST', `/api/crm2/cases/${caseId}/logins/${loginId}/stage`, token, { to });

  // Disburse the LOGIN.
  const disb = await api('POST', `/api/crm2/cases/${caseId}/logins/${loginId}/disburse`, token, {
    disbursedAmount: 5000000, disbursementDate: '2025-06-15', loanAccountNo: 'LN-001', city: 'Mumbai', state: 'MH',
  });
  disb.status === 200 && disb.data.cycleId?.startsWith('PC-') && disb.data.expectedGross === 70000
    ? ok(`login disbursed → cycle ${disb.data.cycleId}, expectedGross ₹70,000 (1.4% of 50L)`) : bad('disburse', JSON.stringify(disb));
  const cycleId = disb.data.cycleId;

  const lDoc = await getDoc(`cases/${caseId}/logins/${loginId}`);
  fv(lDoc, 'stage') === 'DISBURSED' && fv(lDoc, 'payoutCycleId') === cycleId && fnum(lDoc, 'amountDisbursed') === 5000000 && fv(lDoc, 'dsaCode') === '1033618'
    ? ok('login: DISBURSED + payoutCycleId + amountDisbursed + frozen dsaCode') : bad('login doc', JSON.stringify({ s: fv(lDoc, 'stage'), c: fv(lDoc, 'payoutCycleId') }));

  const cyc = await getDoc(`payoutCycles/${cycleId}`);
  fv(cyc, 'caseId') === caseId && fv(cyc, 'loginId') === loginId && fnum(cyc, 'expectedGross') === 70000 && fv(cyc, 'status') === 'AWAITING_DATA_SHARE'
    ? ok('payoutCycle: caseId + loginId + expectedGross + AWAITING_DATA_SHARE') : bad('cycle', JSON.stringify({ caseId: fv(cyc, 'caseId'), loginId: fv(cyc, 'loginId') }));

  const mis = await getDoc(`misRecords/${loginId}`);
  mis && fv(mis, 'loginId') === loginId && fv(mis, 'caseId') === caseId && fv(mis, 'cycleStatus') === 'AWAITING_DATA_SHARE'
    ? ok('MIS record keyed by loginId (caseId + loginId + status)') : bad('mis', JSON.stringify(mis?.fields?.loginId));

  // Milestone step 2 (data shared) → updates LOGIN badge + misRecords/{loginId}.
  const mile = await api('PATCH', `/api/crm2/payout-cycles/${cycleId}/milestone`, token, { step: 2, payload: { dataSharedTo: 'agg@x.com', reportingMonth: '2025-06' } });
  mile.status === 200 ? ok(`milestone step 2 applied (status ${mile.data.status})`) : bad('milestone', JSON.stringify(mile));
  const lAfter = await getDoc(`cases/${caseId}/logins/${loginId}`);
  const misAfter = await getDoc(`misRecords/${loginId}`);
  fv(lAfter, 'payoutStatus') === mile.data.status && fv(misAfter, 'cycleStatus') === mile.data.status
    ? ok('milestone updated the LOGIN badge + MIS record in lock-step') : bad('milestone propagation', JSON.stringify({ login: fv(lAfter, 'payoutStatus'), mis: fv(misAfter, 'cycleStatus') }));

  // MONEY SAFETY — a case that has logins cannot be disbursed at the case level
  // (no double-disburse: a case is either legacy-per-case OR per-login).
  const caseDisb = await api('POST', `/api/crm2/cases/${caseId}/disburse`, token, {
    disbursedAmount: 5000000, disbursementDate: '2025-06-15', loanAccountNo: 'LN-X', city: 'Mumbai', state: 'MH',
  });
  caseDisb.status === 400 && /per-login pipeline/.test(caseDisb.data.error ?? '')
    ? ok('case-level disburse blocked once logins exist (no double-disburse)') : bad('case disburse guard', JSON.stringify(caseDisb));

  // A login whose lender has no mapping is blocked at disburse.
  const l2 = await api('POST', `/api/crm2/cases/${caseId}/logins`, token, { lenderId: lender2.data.id, connectorId: conn.data.id });
  await api('PATCH', `/api/crm2/cases/${caseId}/logins/${l2.data.loginId}`, token, { docsSent: true });
  for (const to of ['CODE_LOGIN_DONE', 'IN_PROCESS', 'SANCTIONED']) await api('POST', `/api/crm2/cases/${caseId}/logins/${l2.data.loginId}/stage`, token, { to });
  const noMap = await api('POST', `/api/crm2/cases/${caseId}/logins/${l2.data.loginId}/disburse`, token, { disbursedAmount: 1000000, disbursementDate: '2025-06-15', loanAccountNo: 'LN-002', city: 'Pune', state: 'MH' });
  noMap.status === 400 && /mapping/.test(noMap.data.error ?? '')
    ? ok('login with no connector×lender mapping blocked (400)') : bad('no-mapping', JSON.stringify(noMap));

  // A non-SANCTIONED login cannot disburse.
  const l3 = await api('POST', `/api/crm2/cases/${caseId}/logins`, token, { lenderId: lender.data.id, connectorId: conn.data.id });
  const early = await api('POST', `/api/crm2/cases/${caseId}/logins/${l3.data.loginId}/disburse`, token, { disbursedAmount: 1000000, disbursementDate: '2025-06-15', loanAccountNo: 'LN-003', city: 'Pune', state: 'MH' });
  early.status === 400 && /SANCTIONED/.test(early.data.error ?? '')
    ? ok('non-SANCTIONED login cannot disburse (400)') : bad('early disburse', JSON.stringify(early));

  // Sub DSA (FAC- channel partner) attribution carries case → login → misRecord.
  const kase2 = await api('POST', '/api/crm2/cases', token, {
    clientId: client.data.id, productId: prod.data.id,
    channelPartnerId: 'FAC-001', channelPartnerCode: 'FAC-001', channelPartnerName: 'Acme Partners',
  });
  for (const r of await listDocs(`cases/${kase2.data.caseId}/docTracker`)) await api('PATCH', `/api/crm2/cases/${kase2.data.caseId}/doc-tracker/${r.name.split('/').pop()}`, token, { status: 'VERIFIED' });
  const lp = await api('POST', `/api/crm2/cases/${kase2.data.caseId}/logins`, token, { lenderId: lender.data.id, connectorId: conn.data.id });
  const lpDoc = await getDoc(`cases/${kase2.data.caseId}/logins/${lp.data.loginId}`);
  fv(lpDoc, 'channelPartnerName') === 'Acme Partners' && fv(lpDoc, 'channelPartnerCode') === 'FAC-001'
    ? ok('login inherits the sourcing Sub DSA (channelPartner) from the case') : bad('login channelPartner', fv(lpDoc, 'channelPartnerName'));
  await api('PATCH', `/api/crm2/cases/${kase2.data.caseId}/logins/${lp.data.loginId}`, token, { docsSent: true });
  for (const to of ['CODE_LOGIN_DONE', 'IN_PROCESS', 'SANCTIONED']) await api('POST', `/api/crm2/cases/${kase2.data.caseId}/logins/${lp.data.loginId}/stage`, token, { to });

  // Seed the FAC- connector (HRMS connectors) with a per-product auto-payout rule.
  await setDocFields('connectors/FAC-001', {
    connectorCode: { stringValue: 'FAC-001' }, displayName: { stringValue: 'Acme Partners' },
    status: { stringValue: 'active' }, deleted: { booleanValue: false },
    payoutRules: { arrayValue: { values: [
      { mapValue: { fields: { productId: { stringValue: prod.data.id }, basis: { stringValue: 'DISBURSED_PCT' }, value: { doubleValue: 0.2 } } } },
    ] } },
  });

  await api('POST', `/api/crm2/cases/${kase2.data.caseId}/logins/${lp.data.loginId}/disburse`, token, { disbursedAmount: 1000000, disbursementDate: '2025-06-15', loanAccountNo: 'LN-CP', city: 'X', state: 'Y' });
  const misP = await getDoc(`misRecords/${lp.data.loginId}`);
  fv(misP, 'channelPartnerName') === 'Acme Partners' && fv(misP, 'channelPartnerCode') === 'FAC-001'
    ? ok('misRecord carries the sourcing Sub DSA for MIS reporting (case→login→MIS)') : bad('mis channelPartner', fv(misP, 'channelPartnerName'));

  // Sub DSA AUTO-PAYOUT — disbursement auto-creates a connector_payout from the rule.
  const cps = await listDocs('connector_payouts');
  const cp1 = cps.find((d) => fv(d, 'loginId') === lp.data.loginId);
  cp1 && fnum(cp1, 'amount') === 2000 && fv(cp1, 'basis') === 'DISBURSED_PCT' && fv(cp1, 'auto') === true && fv(cp1, 'status') === 'pending' && fv(cp1, 'connectorId') === 'FAC-001'
    ? ok('Sub DSA auto-payout: connector_payout ₹2,000 (0.2% of 10L), auto, pending') : bad('cp auto', JSON.stringify(cp1?.fields));

  // Manual override at disbursement wins over the rule.
  const lp2 = await api('POST', `/api/crm2/cases/${kase2.data.caseId}/logins`, token, { lenderId: lender.data.id, connectorId: conn.data.id });
  await api('PATCH', `/api/crm2/cases/${kase2.data.caseId}/logins/${lp2.data.loginId}`, token, { docsSent: true });
  for (const to of ['CODE_LOGIN_DONE', 'IN_PROCESS', 'SANCTIONED']) await api('POST', `/api/crm2/cases/${kase2.data.caseId}/logins/${lp2.data.loginId}/stage`, token, { to });
  await api('POST', `/api/crm2/cases/${kase2.data.caseId}/logins/${lp2.data.loginId}/disburse`, token, { disbursedAmount: 1000000, disbursementDate: '2025-06-15', loanAccountNo: 'LN-CP2', city: 'X', state: 'Y', channelPartnerPayoutOverride: 9999 });
  const cp2 = (await listDocs('connector_payouts')).find((d) => fv(d, 'loginId') === lp2.data.loginId);
  cp2 && fnum(cp2, 'amount') === 9999 && fv(cp2, 'auto') === false
    ? ok('Sub DSA payout override honored at disbursement (₹9,999, auto=false)') : bad('cp override', JSON.stringify(cp2?.fields));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
