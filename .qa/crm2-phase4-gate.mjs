/**
 * CRM 2.0 Phase 4 acceptance — disburse, payout cycle, MIS, milestones (emulators).
 * Same prereqs as crm2-phase1-gate.mjs.
 *
 * Proves: disburse atomically creates cycle + MIS; missing/ambiguous slab blocks
 * with the exact human message; editing a slab after disbursement does NOT change
 * the disbursed case (frozen economics); a Step-8 write updates cycle + case badge
 * + MIS together; out-of-order milestone blocked without override, allowed+logged
 * with override; business-sheet export stamps dataSharedAt.
 */

const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };

async function makeAdmin() {
  const email = `p4-admin-${Date.now()}@finvastra.com`;
  const s = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${s.localId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: {
      userId: { stringValue: s.localId }, email: { stringValue: email },
      displayName: { stringValue: 'P4 Admin' }, role: { stringValue: 'admin' },
      employeeId: { stringValue: 'FAPL-022' },
    } }),
  });
  return s.idToken;
}
// Non-privileged user: has mis.read but NOT payout.amounts.read (audit fix 1).
async function makePoorUser() {
  const email = `p4-poor-${Date.now()}@finvastra.com`;
  const s = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${s.localId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: {
      userId: { stringValue: s.localId }, email: { stringValue: email }, displayName: { stringValue: 'Poor' },
      perms: { mapValue: { fields: { 'mis.read': { booleanValue: true }, 'payout.read': { booleanValue: true } } } },
    } }),
  });
  return s.idToken;
}
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
const fv = (doc, f) => doc?.fields?.[f]?.stringValue ?? doc?.fields?.[f]?.integerValue ?? doc?.fields?.[f]?.doubleValue ?? doc?.fields?.[f]?.booleanValue ?? null;
const fnum = (doc, f) => { const x = doc?.fields?.[f]; return x ? Number(x.integerValue ?? x.doubleValue ?? 0) : null; };

async function setupSanctionedCase(token, stamp, { dsaCode = '1033618', slabFrom = '2025-04-01', slabTo = null, pct = 1.4, subPct = 0.7 } = {}) {
  const prod = await api('POST', '/api/crm2/masters/products', token, { name: `LAP-P4-${stamp}`, shortCode: 'LAP', vertical: 'LOANS' });
  const dLogin = await api('POST', '/api/crm2/masters/documentMaster', token, {
    name: `GST-P4-${stamp}`, category: 'ENTITY_KYC', applicableTo: 'ENTITY', mandatoryForProducts: [prod.data.id], requiredByStage: 'LOGIN' });
  const dDisb = await api('POST', '/api/crm2/masters/documentMaster', token, {
    name: `DRL-P4-${stamp}`, category: 'POST_SANCTION_PDD', applicableTo: 'ENTITY', mandatoryForProducts: [prod.data.id], requiredByStage: 'DISBURSEMENT' });
  const conn = await api('POST', '/api/crm2/masters/aggregators', token, { name: `Starpowerz-${stamp}`, type: 'MASTER_AGGREGATOR', payoutFrequency: 'MONTHLY', standardTdsPct: 5 });
  const lender = await api('POST', '/api/crm2/masters/lenders', token, { name: `Fedbank-${stamp}`, type: 'NBFC' });
  const map = await api('POST', '/api/crm2/mappings', token, {
    connectorId: conn.data.id, lenderId: lender.data.id, dsaCode, codeRegisteredName: 'STAR POWERZ', slabs: [] });
  await api('POST', `/api/crm2/mappings/${map.data.id}/slabs`, token, {
    productIds: [prod.data.id], finvastraPayoutPct: pct, subDsaDefaultPayoutPct: subPct, effectiveFrom: slabFrom, effectiveTo: slabTo });

  // Lead → qualify → convert (case at OPENED with LOGIN + DISBURSEMENT tracker rows)
  const lead = await api('POST', '/api/crm2/leads', token, { name: `P4 Co ${stamp}`, mobile: `96${String(stamp).padStart(8, '0')}`, category: 'LOAN', source: 'WALKIN', productId: prod.data.id });
  await api('PATCH', `/api/crm2/leads/${lead.data.id}`, token, { status: 'QUALIFIED' });
  const conv = await api('POST', `/api/crm2/leads/${lead.data.id}/convert`, token, {});
  const caseId = conv.data.caseId;
  // route + verify all docs
  await api('PATCH', `/api/crm2/cases/${caseId}`, token, { connectorId: conn.data.id, lenderId: lender.data.id });
  const rows = (await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/cases/${caseId}/docTracker?pageSize=50`, { headers: { Authorization: 'Bearer owner' } }).then((r) => r.json())).documents ?? [];
  for (const r of rows) {
    const rid = r.name.split('/').pop();
    await api('PATCH', `/api/crm2/cases/${caseId}/doc-tracker/${rid}`, token, { status: 'VERIFIED' });
  }
  // walk to SANCTIONED
  for (const to of ['ELIGIBILITY', 'DOC_COLLECTION', 'CODE_ASSIGNMENT', 'LOGIN', 'UNDER_PROCESS', 'SANCTIONED']) {
    const r = await api('POST', `/api/crm2/cases/${caseId}/stage`, token, { to });
    if (r.status !== 200) throw new Error(`stage ${to} failed: ${JSON.stringify(r)}`);
  }
  return { caseId, mappingId: map.data.id, productId: prod.data.id, connName: `Starpowerz-${stamp}` };
}

async function main() {
  console.log('CRM 2.0 Phase 4 acceptance — disburse, cycle, MIS, milestones\n');
  const token = await makeAdmin();
  const stamp = Date.now() % 1000000;

  // ── 1. Happy-path disburse → atomic cycle + MIS ──────────────────────────
  const s1 = await setupSanctionedCase(token, stamp);
  const disb = await api('POST', `/api/crm2/cases/${s1.caseId}/disburse`, token, {
    disbursedAmount: 5000000, disbursementDate: '2026-05-12', loanAccountNo: 'FEDHYCLAP0563116', city: 'Hyderabad', state: 'Telangana', roiPct: 10.5, processingFee: 25000 });
  const cycleId = disb.data.cycleId;
  disb.status === 200 && cycleId === s1.caseId.replace('FIN-CASE', 'PC') && disb.data.expectedGross === 70000
    ? ok(`disburse → ${cycleId}, expected ₹70,000 (1.4% of 50L)`) : bad('disburse', JSON.stringify(disb));

  const caseDoc = await getDoc(`cases/${s1.caseId}`);
  fv(caseDoc, 'stage') === 'DISBURSED' && fv(caseDoc, 'payoutStatus') === 'AWAITING_DATA_SHARE' && fv(caseDoc, 'dsaCode') === '1033618' && fv(caseDoc, 'slabId')
    ? ok('case → DISBURSED, payoutStatus AWAITING_DATA_SHARE, dsaCode+slabId frozen') : bad('case post-disburse', JSON.stringify(caseDoc?.fields?.stage));
  const cycle = await getDoc(`payoutCycles/${cycleId}`);
  cycle && fnum(cycle, 'expectedGross') === 70000 && fnum(cycle, 'finvastraPayoutPct') === 1.4 && fv(cycle, 'status') === 'AWAITING_DATA_SHARE'
    ? ok('payoutCycle created with frozen economics') : bad('cycle', JSON.stringify(cycle?.fields?.expectedGross));
  const mis = await getDoc(`misRecords/${s1.caseId}`);
  mis && mis.fields && fv(mis, 'reportingMonth') === '2026-05' && fnum(mis, 'expectedGross') === 70000 && fv(mis, 'dsaCode') === '1033618'
    ? ok('misRecords/{caseId} created (id==caseId), denormalised') : bad('mis', JSON.stringify(mis?.fields?.reportingMonth));
  const mirror = await getDoc(`cases/${s1.caseId}/private/payout`);
  // Self-sourced case (no sub-DSA): subDsaExpected null, full gross is the margin.
  mirror && fnum(mirror, 'netMarginExpected') === 70000 && mirror.fields.subDsaPayoutExpected?.nullValue !== undefined
    ? ok('money mirror in private/payout — netMargin ₹70,000 (self-sourced, no sub-DSA)') : bad('mirror', JSON.stringify(mirror?.fields));

  // ── 2. Frozen economics: edit slab after disburse → case/cycle unchanged ──
  await api('POST', `/api/crm2/mappings/${s1.mappingId}/slabs/${fv(cycle, 'slabId')}/end`, token, { effectiveTo: '2026-05-31' });
  await api('POST', `/api/crm2/mappings/${s1.mappingId}/slabs`, token, {
    productIds: [s1.productId], finvastraPayoutPct: 2.0, effectiveFrom: '2026-06-01' });
  const cycleAfter = await getDoc(`payoutCycles/${cycleId}`);
  const mirrorAfter = await getDoc(`cases/${s1.caseId}/private/payout`);
  fnum(cycleAfter, 'finvastraPayoutPct') === 1.4 && fnum(cycleAfter, 'expectedGross') === 70000 && fnum(mirrorAfter, 'finvastraPayoutPct') === 1.4
    ? ok('FROZEN: slab edit after disbursement did NOT change the cycle/mirror (still 1.4%)') : bad('frozen economics', JSON.stringify(cycleAfter?.fields?.finvastraPayoutPct));

  // ── 3. Missing/ambiguous slab blocks with the exact human message ─────────
  const s2 = await setupSanctionedCase(token, stamp + 1, { slabFrom: '2025-04-01', slabTo: '2025-12-31' }); // slab expires before disb date
  const blocked = await api('POST', `/api/crm2/cases/${s2.caseId}/disburse`, token, {
    disbursedAmount: 1000000, disbursementDate: '2026-05-12', loanAccountNo: 'X', city: 'Y', state: 'Z' });
  blocked.status === 422 && /No active payout slab for .* on 2026-05-12/.test(blocked.data.error ?? '')
    ? ok(`missing-slab disburse blocked: "${blocked.data.error}"`) : bad('missing slab', JSON.stringify(blocked));
  const s2case = await getDoc(`cases/${s2.caseId}`);
  fv(s2case, 'stage') === 'SANCTIONED'
    ? ok('blocked case stayed SANCTIONED (no partial write)') : bad('partial write', fv(s2case, 'stage'));

  // ── 4. Milestones: out-of-order blocked, override logged; Step-8 one-batch ─
  // step 8 (received) before step 7 (billed) → blocked
  const ooo = await api('PATCH', `/api/crm2/payout-cycles/${cycleId}/milestone`, token, { step: 8, payload: { receivedNet: 63000 } });
  ooo.status === 409 && /requires milestone 'billSentAt'/.test(ooo.data.error ?? '')
    ? ok('out-of-order Step 8 blocked without override (409)') : bad('out-of-order', JSON.stringify(ooo));
  // with override
  const ovr = await api('PATCH', `/api/crm2/payout-cycles/${cycleId}/milestone`, token, {
    step: 8, payload: { receivedNet: 63000, tdsDeducted: 7000 }, override: { reason: 'Bank paid before we billed (rare)' } });
  ovr.status === 200 ? ok('Step 8 allowed WITH override+reason') : bad('override', JSON.stringify(ovr));
  const cy8 = await getDoc(`payoutCycles/${cycleId}`);
  const logHasOverride = (cy8?.fields?.milestoneLog?.arrayValue?.values ?? []).some((v) => v.mapValue?.fields?.override?.booleanValue === true && v.mapValue?.fields?.reason?.stringValue);
  logHasOverride ? ok('override reason persisted in milestoneLog') : bad('override log', JSON.stringify(cy8?.fields?.milestoneLog));

  // Step-8 derived: status RECEIVED, amountVariance = (billGross 0 − tds 7000) − 63000... but no bill → billGross null → variance = (0-7000)-63000 = -70000
  fv(cy8, 'status') === 'RECEIVED'
    ? ok('cycle status DERIVED → RECEIVED after step 8') : bad('derived status', fv(cy8, 'status'));
  const case8 = await getDoc(`cases/${cycleId.replace('PC', 'FIN-CASE')}`);
  fv(case8, 'payoutStatus') === 'RECEIVED'
    ? ok('case payout badge updated → RECEIVED (same batch)') : bad('case badge', fv(case8, 'payoutStatus'));
  const mis8 = await getDoc(`misRecords/${cycleId.replace('PC', 'FIN-CASE')}`);
  fv(mis8, 'cycleStatus') === 'RECEIVED' && fnum(mis8, 'receivedNet') === 63000
    ? ok('MIS updated → cycleStatus RECEIVED + receivedNet ₹63,000 (same batch)') : bad('mis update', JSON.stringify(mis8?.fields?.cycleStatus));

  // ── 5. Business-sheet export stamps dataSharedAt ─────────────────────────
  // Fresh case so its cycle has no dataSharedAt yet
  const s3 = await setupSanctionedCase(token, stamp + 2);
  await api('POST', `/api/crm2/cases/${s3.caseId}/disburse`, token, {
    disbursedAmount: 2000000, disbursementDate: '2026-07-03', loanAccountNo: 'L3', city: 'C', state: 'S' });
  const pc3 = s3.caseId.replace('FIN-CASE', 'PC');
  const before = await getDoc(`payoutCycles/${pc3}`);
  const share = await api('GET', `/api/crm2/mis/business-sheet?month=2026-07&share=1&dataSharedTo=Ruloans`, token);
  const after = await getDoc(`payoutCycles/${pc3}`);
  share.status === 200 && share.data.shared >= 1 && before?.fields?.dataSharedAt?.nullValue !== undefined && after?.fields?.dataSharedAt?.timestampValue
    ? ok(`business-sheet share stamped dataSharedAt on ${share.data.shared} cycle(s)`) : bad('share stamp', JSON.stringify({ shared: share.data?.shared, after: after?.fields?.dataSharedAt }));

  // download (no share) returns xlsx bytes
  const dl = await api('GET', `/api/crm2/mis/business-sheet?month=2026-07`, token);
  dl.status === 200 ? ok('business-sheet download returns xlsx') : bad('xlsx download', dl.status);

  // ── 5b. Sub-DSA case: subDsaExpected from slab default (0.7%) end-to-end ──
  const s4 = await setupSanctionedCase(token, stamp + 3);
  const sub = await api('POST', '/api/crm2/masters/subDsas', token, { name: `Ramesh ${stamp}`, type: 'INDIVIDUAL', mobile: `95${String(stamp).padStart(8, '0')}`, relationshipOwner: 'FAPL-022' });
  await api('PATCH', `/api/crm2/cases/${s4.caseId}`, token, { subDsaId: sub.data.id });
  await api('POST', `/api/crm2/cases/${s4.caseId}/disburse`, token, {
    disbursedAmount: 5000000, disbursementDate: '2026-05-20', loanAccountNo: 'L4', city: 'C', state: 'S' });
  const m4 = await getDoc(`cases/${s4.caseId}/private/payout`);
  fnum(m4, 'subDsaPayoutExpected') === 35000 && fnum(m4, 'netMarginExpected') === 35000 && fnum(m4, 'subDsaPayoutPct') === 0.7
    ? ok('sub-DSA case: subDsaExpected ₹35,000 (0.7%), netMargin ₹35,000') : bad('sub-dsa math', JSON.stringify(m4?.fields));

  // ── 6. MIS grid feed ─────────────────────────────────────────────────────
  const grid = await api('GET', `/api/crm2/mis?month=2026-05`, token);
  grid.status === 200 && Array.isArray(grid.data.records) && grid.data.records.some((r) => r.caseId === s1.caseId)
    ? ok('MIS grid feed returns the disbursed case') : bad('mis grid', JSON.stringify(grid.data?.records?.length));

  // ── 7. AUDIT FIX 1: business-sheet export gated by payout.amounts.read ────
  const poor = await makePoorUser(); // mis.read + payout.read, NO payout.amounts.read
  const dlPoor = await api('GET', `/api/crm2/mis/business-sheet?month=2026-05`, poor);
  dlPoor.status === 403
    ? ok('business-sheet download → 403 for mis.read-only user (no money leak)') : bad('export leak (download)', `status=${dlPoor.status}`);
  const sharePoor = await api('GET', `/api/crm2/mis/business-sheet?month=2026-05&share=1`, poor);
  sharePoor.status === 403
    ? ok('business-sheet share action → 403 for mis.read-only user') : bad('export leak (share)', `status=${sharePoor.status}`);
  // sanity: an admin (has all perms) still gets the sheet
  const dlAdmin = await api('GET', `/api/crm2/mis/business-sheet?month=2026-05`, token);
  dlAdmin.status === 200 ? ok('business-sheet still works for payout.amounts.read holder (admin)') : bad('export admin', dlAdmin.status);

  // ── 8. AUDIT FIX 2: payout reminders are idempotent within a day ─────────
  const r1 = await api('POST', '/api/crm2/jobs/run-payout-reminders', token, {});
  const r2 = await api('POST', '/api/crm2/jobs/run-payout-reminders', token, {});
  r1.status === 200 && r2.status === 200 && (r2.data.dataShareReminders + r2.data.bankerReminders) === 0
    ? ok(`reminders idempotent — run1 fired ${r1.data.dataShareReminders + r1.data.bankerReminders}, run2 fired 0`)
    : bad('reminder idempotency', `run1=${r1.data.dataShareReminders + r1.data.bankerReminders} run2=${r2.data.dataShareReminders + r2.data.bankerReminders}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
