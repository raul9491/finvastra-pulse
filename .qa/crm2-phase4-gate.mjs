/**
 * CRM 2.0 Phase 4 acceptance — PER-LOGIN disburse, payout cycle, MIS, milestones.
 * Same prereqs as crm2-phase1-gate.mjs. (Phase 4 cutover: disbursement/payout are
 * per LOGIN; the cycle is PC- from a counter, misRecords are keyed by loginId.)
 *
 * Proves: per-login disburse atomically creates cycle + MIS; missing/ambiguous slab
 * blocks with the exact human message (no partial write); editing a slab after
 * disbursement does NOT change the cycle (frozen economics); a Step-8 write updates
 * cycle + login badge + MIS together; out-of-order milestone blocked without override,
 * allowed+logged with override; business-sheet export stamps dataSharedAt + is money-gated.
 */

const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };

async function makeUser(fapl, perms) {
  const email = `p4-${(fapl ?? 'u').toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@finvastra.com`;
  const s = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  const fields = { userId: { stringValue: s.localId }, email: { stringValue: email }, displayName: { stringValue: 'P4' } };
  if (fapl) { fields.role = { stringValue: 'admin' }; fields.employeeId = { stringValue: fapl }; }
  if (perms) fields.perms = { mapValue: { fields: Object.fromEntries(perms.map((k) => [k, { booleanValue: true }])) } };
  await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${s.localId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  return s.idToken;
}
const makeAdmin = () => makeUser('FAPL-022', null);
const makePoorUser = () => makeUser(null, ['mis.read', 'payout.read']);
const makeWriteOnlyUser = () => makeUser(null, ['payout.write', 'payout.read']);

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, data: ct.includes('json') ? await res.json().catch(() => ({})) : await res.text() };
}
async function getDoc(path) {
  const r = await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { Authorization: 'Bearer owner' } });
  return r.status === 200 ? r.json() : null;
}
async function listDocs(path) {
  const r = await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}?pageSize=100`, { headers: { Authorization: 'Bearer owner' } });
  return (await r.json().catch(() => ({}))).documents ?? [];
}
const fv = (d, f) => d?.fields?.[f]?.stringValue ?? d?.fields?.[f]?.integerValue ?? d?.fields?.[f]?.doubleValue ?? d?.fields?.[f]?.booleanValue ?? null;
const fnum = (d, f) => { const x = d?.fields?.[f]; return x ? Number(x.integerValue ?? x.doubleValue ?? 0) : null; };

// Set up a case with ONE login advanced to SANCTIONED + all docTracker rows VERIFIED.
async function setupSanctionedLogin(token, stamp, { dsaCode = '1033618', slabFrom = '2025-04-01', slabTo = null, pct = 1.4, subPct = 0.7 } = {}) {
  const prod = await api('POST', '/api/crm2/masters/products', token, { name: `LAP-P4-${stamp}`, shortCode: 'LAP', vertical: 'LOANS' });
  await api('POST', '/api/crm2/masters/documentMaster', token, { name: `GST-P4-${stamp}`, category: 'ENTITY_KYC', applicableTo: 'ENTITY', mandatoryForProducts: [prod.data.id], requiredByStage: 'LOGIN' });
  await api('POST', '/api/crm2/masters/documentMaster', token, { name: `DRL-P4-${stamp}`, category: 'POST_SANCTION_PDD', applicableTo: 'ENTITY', mandatoryForProducts: [prod.data.id], requiredByStage: 'DISBURSEMENT' });
  const conn = await api('POST', '/api/crm2/masters/aggregators', token, { name: `Starpowerz-${stamp}`, type: 'MASTER_AGGREGATOR', payoutFrequency: 'MONTHLY', standardTdsPct: 5 });
  const lender = await api('POST', '/api/crm2/masters/lenders', token, { name: `Fedbank-${stamp}`, type: 'NBFC' });
  const map = await api('POST', '/api/crm2/mappings', token, { connectorId: conn.data.id, lenderId: lender.data.id, productId: prod.data.id, dsaCode, codeRegisteredName: 'STAR POWERZ', slabs: [] });
  await api('POST', `/api/crm2/mappings/${map.data.id}/slabs`, token, { productIds: [prod.data.id], finvastraPayoutPct: pct, subDsaDefaultPayoutPct: subPct, effectiveFrom: slabFrom, effectiveTo: slabTo });
  const lead = await api('POST', '/api/crm2/leads', token, { name: `P4 Co ${stamp}`, mobile: `96${String(stamp).padStart(8, '0')}`, category: 'LOAN', source: 'WALKIN', productId: prod.data.id });
  await api('PATCH', `/api/crm2/leads/${lead.data.id}`, token, { status: 'QUALIFIED' });
  const conv = await api('POST', `/api/crm2/leads/${lead.data.id}/convert`, token, {});
  const caseId = conv.data.caseId;
  for (const r of await listDocs(`cases/${caseId}/docTracker`)) await api('PATCH', `/api/crm2/cases/${caseId}/doc-tracker/${r.name.split('/').pop()}`, token, { status: 'VERIFIED' });
  const l = await api('POST', `/api/crm2/cases/${caseId}/logins`, token, { connectorId: conn.data.id, lenderId: lender.data.id });
  await api('PATCH', `/api/crm2/cases/${caseId}/logins/${l.data.loginId}`, token, { docsSent: true });
  for (const to of ['CODE_LOGIN_DONE', 'IN_PROCESS', 'SANCTIONED']) await api('POST', `/api/crm2/cases/${caseId}/logins/${l.data.loginId}/stage`, token, { to });
  return { caseId, loginId: l.data.loginId, mappingId: map.data.id, productId: prod.data.id, connName: `Starpowerz-${stamp}` };
}
const disburse = (token, s, body) => api('POST', `/api/crm2/cases/${s.caseId}/logins/${s.loginId}/disburse`, token, body);

async function main() {
  console.log('CRM 2.0 Phase 4 acceptance — per-login disburse, cycle, MIS, milestones\n');
  const token = await makeAdmin();
  const stamp = Date.now() % 1000000;

  // ── 1. Happy-path per-login disburse → atomic cycle + MIS ─────────────────
  const s1 = await setupSanctionedLogin(token, stamp);
  const disb = await disburse(token, s1, { disbursedAmount: 5000000, disbursementDate: '2026-05-12', loanAccountNo: 'FEDHYCLAP0563116', city: 'Hyderabad', state: 'Telangana', roiPct: 10.5, processingFee: 25000 });
  const cycleId = disb.data.cycleId;
  disb.status === 200 && cycleId?.startsWith('PC-') && disb.data.expectedGross === 70000
    ? ok(`per-login disburse → ${cycleId}, expected ₹70,000 (1.4% of 50L)`) : bad('disburse', JSON.stringify(disb));

  const loginDoc = await getDoc(`cases/${s1.caseId}/logins/${s1.loginId}`);
  fv(loginDoc, 'stage') === 'DISBURSED' && fv(loginDoc, 'payoutStatus') === 'AWAITING_DATA_SHARE' && fv(loginDoc, 'dsaCode') === '1033618' && fv(loginDoc, 'slabId')
    ? ok('login → DISBURSED, payoutStatus AWAITING_DATA_SHARE, dsaCode+slabId frozen') : bad('login post-disburse', JSON.stringify(loginDoc?.fields?.stage));
  const cycle = await getDoc(`payoutCycles/${cycleId}`);
  cycle && fnum(cycle, 'expectedGross') === 70000 && fnum(cycle, 'finvastraPayoutPct') === 1.4 && fv(cycle, 'status') === 'AWAITING_DATA_SHARE' && fv(cycle, 'loginId') === s1.loginId
    ? ok('payoutCycle created with frozen economics + loginId') : bad('cycle', JSON.stringify(cycle?.fields?.expectedGross));
  const mis = await getDoc(`misRecords/${s1.loginId}`);
  mis && mis.fields && fv(mis, 'reportingMonth') === '2026-05' && fnum(mis, 'expectedGross') === 70000 && fv(mis, 'dsaCode') === '1033618'
    ? ok('misRecords/{loginId} created (id==loginId), denormalised') : bad('mis', JSON.stringify(mis?.fields?.reportingMonth));
  // Self-sourced login (no sub-DSA): subDsaExpected null, full gross is the margin.
  cycle.fields.subDsaExpected?.nullValue !== undefined && fnum(cycle, 'expectedGross') === 70000
    ? ok('self-sourced cycle — subDsaExpected null, full ₹70,000 is the margin') : bad('self-sourced margin', JSON.stringify(cycle?.fields?.subDsaExpected));

  // ── 2. Frozen economics: edit slab after disburse → cycle unchanged ───────
  await api('POST', `/api/crm2/mappings/${s1.mappingId}/slabs/${fv(cycle, 'slabId')}/end`, token, { effectiveTo: '2026-05-31' });
  await api('POST', `/api/crm2/mappings/${s1.mappingId}/slabs`, token, { productIds: [s1.productId], finvastraPayoutPct: 2.0, effectiveFrom: '2026-06-01' });
  const cycleAfter = await getDoc(`payoutCycles/${cycleId}`);
  fnum(cycleAfter, 'finvastraPayoutPct') === 1.4 && fnum(cycleAfter, 'expectedGross') === 70000
    ? ok('FROZEN: slab edit after disbursement did NOT change the cycle (still 1.4%)') : bad('frozen economics', JSON.stringify(cycleAfter?.fields?.finvastraPayoutPct));

  // ── 3. Missing slab blocks with the exact human message (no partial write) ─
  const s2 = await setupSanctionedLogin(token, stamp + 1, { slabFrom: '2025-04-01', slabTo: '2025-12-31' });
  const blocked = await disburse(token, s2, { disbursedAmount: 1000000, disbursementDate: '2026-05-12', loanAccountNo: 'X', city: 'Y', state: 'Z' });
  blocked.status === 422 && /No active payout slab for .* on 2026-05-12/.test(blocked.data.error ?? '')
    ? ok(`missing-slab disburse blocked: "${blocked.data.error}"`) : bad('missing slab', JSON.stringify(blocked));
  const s2login = await getDoc(`cases/${s2.caseId}/logins/${s2.loginId}`);
  fv(s2login, 'stage') === 'SANCTIONED'
    ? ok('blocked login stayed SANCTIONED (no partial write)') : bad('partial write', fv(s2login, 'stage'));

  // ── 4. Milestones: out-of-order blocked, override logged; Step-8 one-batch ─
  const ooo = await api('PATCH', `/api/crm2/payout-cycles/${cycleId}/milestone`, token, { step: 8, payload: { receivedNet: 63000 } });
  ooo.status === 409 && /requires milestone 'billSentAt'/.test(ooo.data.error ?? '')
    ? ok('out-of-order Step 8 blocked without override (409)') : bad('out-of-order', JSON.stringify(ooo));
  const ovr = await api('PATCH', `/api/crm2/payout-cycles/${cycleId}/milestone`, token, { step: 8, payload: { receivedNet: 63000, tdsDeducted: 7000 }, override: { reason: 'Bank paid before we billed (rare)' } });
  ovr.status === 200 ? ok('Step 8 allowed WITH override+reason') : bad('override', JSON.stringify(ovr));
  const cy8 = await getDoc(`payoutCycles/${cycleId}`);
  const logHasOverride = (cy8?.fields?.milestoneLog?.arrayValue?.values ?? []).some((v) => v.mapValue?.fields?.override?.booleanValue === true && v.mapValue?.fields?.reason?.stringValue);
  logHasOverride ? ok('override reason persisted in milestoneLog') : bad('override log', JSON.stringify(cy8?.fields?.milestoneLog));
  fv(cy8, 'status') === 'RECEIVED' ? ok('cycle status DERIVED → RECEIVED after step 8') : bad('derived status', fv(cy8, 'status'));
  const login8 = await getDoc(`cases/${s1.caseId}/logins/${s1.loginId}`);
  fv(login8, 'payoutStatus') === 'RECEIVED' ? ok('login payout badge updated → RECEIVED (same batch)') : bad('login badge', fv(login8, 'payoutStatus'));
  const mis8 = await getDoc(`misRecords/${s1.loginId}`);
  fv(mis8, 'cycleStatus') === 'RECEIVED' && fnum(mis8, 'receivedNet') === 63000
    ? ok('MIS updated → cycleStatus RECEIVED + receivedNet ₹63,000 (same batch)') : bad('mis update', JSON.stringify(mis8?.fields?.cycleStatus));

  // ── 5. Business-sheet export stamps dataSharedAt ─────────────────────────
  const s3 = await setupSanctionedLogin(token, stamp + 2);
  const d3 = await disburse(token, s3, { disbursedAmount: 2000000, disbursementDate: '2026-07-03', loanAccountNo: 'L3', city: 'C', state: 'S' });
  const pc3 = d3.data.cycleId;
  const before = await getDoc(`payoutCycles/${pc3}`);
  const share = await api('GET', `/api/crm2/mis/business-sheet?month=2026-07&share=1&dataSharedTo=Ruloans`, token);
  const after = await getDoc(`payoutCycles/${pc3}`);
  share.status === 200 && share.data.shared >= 1 && before?.fields?.dataSharedAt?.nullValue !== undefined && after?.fields?.dataSharedAt?.timestampValue
    ? ok(`business-sheet share stamped dataSharedAt on ${share.data.shared} cycle(s)`) : bad('share stamp', JSON.stringify({ shared: share.data?.shared, after: after?.fields?.dataSharedAt }));
  const dl = await api('GET', `/api/crm2/mis/business-sheet?month=2026-07`, token);
  dl.status === 200 ? ok('business-sheet download returns xlsx') : bad('xlsx download', dl.status);

  // ── 5b. Sub-DSA login: subDsaExpected from slab default (0.7%) end-to-end ──
  const s4 = await setupSanctionedLogin(token, stamp + 3);
  const sub = await api('POST', '/api/crm2/masters/subDsas', token, { name: `Ramesh ${stamp}`, type: 'INDIVIDUAL', mobile: `95${String(stamp).padStart(8, '0')}`, relationshipOwner: 'FAPL-022' });
  await api('PATCH', `/api/crm2/cases/${s4.caseId}`, token, { subDsaId: sub.data.id });   // disburse falls back to case.subDsaId
  const d4 = await disburse(token, s4, { disbursedAmount: 5000000, disbursementDate: '2026-05-20', loanAccountNo: 'L4', city: 'C', state: 'S' });
  const cy4 = await getDoc(`payoutCycles/${d4.data.cycleId}`);
  fnum(cy4, 'subDsaExpected') === 35000 && fnum(cy4, 'subDsaPayoutPct') === 0.7 && (fnum(cy4, 'expectedGross') - fnum(cy4, 'subDsaExpected')) === 35000
    ? ok('sub-DSA login: subDsaExpected ₹35,000 (0.7%), net margin ₹35,000') : bad('sub-dsa math', JSON.stringify(cy4?.fields));

  // ── 6. MIS grid feed (records carry caseId + loginId) ─────────────────────
  const grid = await api('GET', `/api/crm2/mis?month=2026-05`, token);
  grid.status === 200 && Array.isArray(grid.data.records) && grid.data.records.some((r) => r.caseId === s1.caseId)
    ? ok('MIS grid feed returns the disbursed case') : bad('mis grid', JSON.stringify(grid.data?.records?.length));

  // ── 7. business-sheet export gated by payout.amounts.read ────────────────
  const poor = await makePoorUser();
  const dlPoor = await api('GET', `/api/crm2/mis/business-sheet?month=2026-05`, poor);
  dlPoor.status === 403 ? ok('business-sheet download → 403 for mis.read-only user (no money leak)') : bad('export leak (download)', `status=${dlPoor.status}`);
  const sharePoor = await api('GET', `/api/crm2/mis/business-sheet?month=2026-05&share=1`, poor);
  sharePoor.status === 403 ? ok('business-sheet share action → 403 for mis.read-only user') : bad('export leak (share)', `status=${sharePoor.status}`);
  const dlAdmin = await api('GET', `/api/crm2/mis/business-sheet?month=2026-05`, token);
  dlAdmin.status === 200 ? ok('business-sheet still works for payout.amounts.read holder (admin)') : bad('export admin', dlAdmin.status);

  // ── 8. payout reminders idempotent within a day ──────────────────────────
  const r1 = await api('POST', '/api/crm2/jobs/run-payout-reminders', token, {});
  const r2 = await api('POST', '/api/crm2/jobs/run-payout-reminders', token, {});
  r1.status === 200 && r2.status === 200 && (r2.data.dataShareReminders + r2.data.bankerReminders) === 0
    ? ok(`reminders idempotent — run1 fired ${r1.data.dataShareReminders + r1.data.bankerReminders}, run2 fired 0`)
    : bad('reminder idempotency', `run1=${r1.data.dataShareReminders + r1.data.bankerReminders} run2=${r2.data.dataShareReminders + r2.data.bankerReminders}`);

  // ── 9. disburse response money gated on payout.amounts.read ──────────────
  const wo = await makeWriteOnlyUser();
  const s9 = await setupSanctionedLogin(token, stamp + 9);
  const dwo = await disburse(wo, s9, { disbursedAmount: 5000000, disbursementDate: '2026-05-12', loanAccountNo: 'L9', city: 'C', state: 'S' });
  dwo.status === 200 && dwo.data.cycleId && dwo.data.expectedGross === undefined && dwo.data.finvastraPayoutPct === undefined
    ? ok('disburse response money-gated — payout.write-only caller gets cycleId but NO money fields') : bad('disburse money echo', `body=${JSON.stringify(dwo.data)}`);
  const s9b = await setupSanctionedLogin(token, stamp + 19);
  const dadm = await disburse(token, s9b, { disbursedAmount: 5000000, disbursementDate: '2026-05-12', loanAccountNo: 'L9b', city: 'C', state: 'S' });
  dadm.status === 200 && dadm.data.expectedGross === 70000 && dadm.data.finvastraPayoutPct === 1.4
    ? ok('disburse response still returns money to payout.amounts.read holder (admin)') : bad('disburse admin money', JSON.stringify(dadm.data));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
