/**
 * CRM 2.0 Phase 5 acceptance — recon, snapshots, dashboards (emulators).
 * Same prereqs as crm2-phase1-gate.mjs.
 *
 * Proves: a bank dump auto-matches by loan account no; unmatched of OUR cases flow
 * to the dispute list; dispute sets the cycle DISPUTED; recon snapshot is
 * idempotent (re-run overwrites, no duplicate); the receivables dashboard totals
 * EQUAL the direct misRecords sums for the month+connector; dashboard money is
 * absent for a caller without payout.amounts.read.
 */
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';
const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };

async function mkUser(role, perms) {
  const email = `p5-${Math.random().toString(36).slice(2)}@finvastra.com`;
  const s = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }) }).then((r) => r.json());
  const f = { userId: { stringValue: s.localId }, email: { stringValue: email }, displayName: { stringValue: 'P5' }, employeeId: { stringValue: 'FAPL-022' } };
  if (role) f.role = { stringValue: role };
  if (perms) f.perms = { mapValue: { fields: Object.fromEntries(Object.entries(perms).map(([k, v]) => [k, { booleanValue: v }])) } };
  await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${s.localId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields: f }) });
  return s.idToken;
}
async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function getDoc(path) { const r = await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { Authorization: 'Bearer owner' } }); return r.status === 200 ? r.json() : null; }
async function listDocs(path) { const r = await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}?pageSize=100`, { headers: { Authorization: 'Bearer owner' } }); const j = await r.json().catch(() => ({})); return j.documents ?? []; }
const fnum = (d, f) => { const x = d?.fields?.[f]; return x ? Number(x.integerValue ?? x.doubleValue ?? 0) : null; };
const fstr = (d, f) => d?.fields?.[f]?.stringValue ?? null;

// Phase 4 cutover: disburse PER LOGIN. Returns the caseId (recon dispute is by case).
async function disburse(T, stamp, conn, len, prod, dsaCode, amount, date, loanAcct) {
  const lead = await api('POST', '/api/crm2/leads', T, { name: `Co-${stamp}`, mobile: `9${String(stamp).padStart(9, '0').slice(0, 9)}`, category: 'LOAN', source: 'WALKIN', productId: prod });
  await api('PATCH', `/api/crm2/leads/${lead.data.id}`, T, { status: 'QUALIFIED' });
  const conv = await api('POST', `/api/crm2/leads/${lead.data.id}/convert`, T, {});
  const caseId = conv.data.caseId;
  const rows = (await listDocs(`cases/${caseId}/docTracker`));
  for (const r of rows) await api('PATCH', `/api/crm2/cases/${caseId}/doc-tracker/${r.name.split('/').pop()}`, T, { status: 'VERIFIED' });
  const l = await api('POST', `/api/crm2/cases/${caseId}/logins`, T, { connectorId: conn, lenderId: len });
  for (const to of ['CODE_LOGIN_DONE', 'IN_PROCESS', 'SANCTIONED']) await api('POST', `/api/crm2/cases/${caseId}/logins/${l.data.loginId}/stage`, T, { to });
  await api('POST', `/api/crm2/cases/${caseId}/logins/${l.data.loginId}/disburse`, T, { disbursedAmount: amount, disbursementDate: date, loanAccountNo: loanAcct, city: 'C', state: 'S' });
  return caseId;
}

async function main() {
  console.log('CRM 2.0 Phase 5 acceptance — recon, snapshots, dashboards\n');
  const T = await mkUser('admin');
  const stamp = Date.now() % 1000000;
  const month = '2026-05';

  // Masters: product, LOGIN+DISBURSEMENT docs, connector, lender, mapping+slab.
  const prod = await api('POST', '/api/crm2/masters/products', T, { name: `P-${stamp}`, shortCode: 'LAP', vertical: 'LOANS' });
  await api('POST', '/api/crm2/masters/documentMaster', T, { name: `L-${stamp}`, category: 'ENTITY_KYC', applicableTo: 'ENTITY', mandatoryForProducts: [prod.data.id], requiredByStage: 'LOGIN' });
  await api('POST', '/api/crm2/masters/documentMaster', T, { name: `D-${stamp}`, category: 'POST_SANCTION_PDD', applicableTo: 'ENTITY', mandatoryForProducts: [prod.data.id], requiredByStage: 'DISBURSEMENT' });
  const conn = await api('POST', '/api/crm2/masters/aggregators', T, { name: `Conn-${stamp}`, type: 'MASTER_AGGREGATOR', payoutFrequency: 'MONTHLY', standardTdsPct: 5 });
  const len = await api('POST', '/api/crm2/masters/lenders', T, { name: `Len-${stamp}`, type: 'NBFC' });
  const map = await api('POST', '/api/crm2/mappings', T, { connectorId: conn.data.id, lenderId: len.data.id, dsaCode: `DSA-${stamp}`, codeRegisteredName: 'X', slabs: [] });
  await api('POST', `/api/crm2/mappings/${map.data.id}/slabs`, T, { productIds: [prod.data.id], finvastraPayoutPct: 1.4, effectiveFrom: '2025-04-01', effectiveTo: null });

  // 3 disbursed cases — known loan a/c numbers + amounts (all 1.4%).
  const c1 = await disburse(T, stamp + 1, conn.data.id, len.data.id, prod.data.id, `DSA-${stamp}`, 5000000, `${month}-12`, `LOAN-${stamp}-A`);
  const c2 = await disburse(T, stamp + 2, conn.data.id, len.data.id, prod.data.id, `DSA-${stamp}`, 3000000, `${month}-15`, `LOAN-${stamp}-B`);
  const c3 = await disburse(T, stamp + 3, conn.data.id, len.data.id, prod.data.id, `DSA-${stamp}`, 2000000, `${month}-20`, `LOAN-${stamp}-C`); // will be MISSING from dump

  // ── 1. Build a dump CSV: c1 + c2 by loan a/c + one unknown row; c3 omitted ──
  const csv = [
    'Loan Account No,Application No,DSA Code,Disbursed,Disbursement Date',
    `LOAN-${stamp}-A,,DSA-${stamp},5000000,${month}-12`,
    `LOAN-${stamp}-B,,DSA-${stamp},3000000,${month}-15`,
    `LOAN-${stamp}-Z,,DSA-${stamp},9999999,${month}-28`,   // not one of ours → unmatched dump row
  ].join('\n');
  const imp = await api('POST', '/api/crm2/recon/imports', T, { connectorId: conn.data.id, reportingMonth: month, fileBase64: Buffer.from(csv).toString('base64'), fileName: 'dump.csv' });
  imp.status === 200 && imp.data.matched === 2 && imp.data.unmatched === 1
    ? ok(`dump imported — 2 matched by loan a/c, 1 unmatched dump row`) : bad('import', JSON.stringify(imp.data));
  imp.data.missingCaseIds?.length === 1 && imp.data.missingCaseIds[0] === c3
    ? ok(`our case ${c3} correctly flagged missing from the dump`) : bad('missing', JSON.stringify(imp.data.missingCaseIds));

  // verify the matched rows link to the right cases
  const rows = await listDocs(`bankMisImports/${imp.data.importId}/rows`);
  const matchedA = rows.find((r) => fstr(r, 'loanAccountNo') === `LOAN-${stamp}-A`);
  fstr(matchedA, 'matchType') === 'loan' && fstr(matchedA, 'matchedCaseId') === c1
    ? ok('matched row links to the correct case via loan-account tier') : bad('row link', JSON.stringify(matchedA?.fields?.matchedCaseId));

  // ── 2. Dispute the missing case → its (per-login) cycle DISPUTED ──
  const disp = await api('POST', '/api/crm2/recon/dispute', T, { caseId: c3 });
  const cyc3 = disp.data.cycleId ? await getDoc(`payoutCycles/${disp.data.cycleId}`) : null;
  disp.status === 200 && fstr(cyc3, 'status') === 'DISPUTED' && cyc3?.fields?.disputeFlag?.booleanValue === true
    ? ok(`missing case disputed → cycle ${disp.data.cycleId} DISPUTED`) : bad('dispute', JSON.stringify({ s: fstr(cyc3, 'status'), d: disp.data }));
  // Per-login: the payout badge lives on the LOGIN, not the case.
  const loginId3 = fstr(cyc3, 'loginId');
  const login3 = loginId3 ? await getDoc(`cases/${c3}/logins/${loginId3}`) : null;
  fstr(login3, 'payoutStatus') === 'DISPUTED' ? ok('login payout badge → DISPUTED (same tx)') : bad('badge', fstr(login3, 'payoutStatus'));

  // ── 3. Recon snapshot idempotent ──
  const snap1 = await api('POST', '/api/crm2/jobs/run-recon-snapshots', T, { month });
  const snapDoc1 = await getDoc(`reconSnapshots/${month}_${conn.data.id}`);
  const snap2 = await api('POST', '/api/crm2/jobs/run-recon-snapshots', T, { month });
  const allSnaps = await listDocs('reconSnapshots');
  const forThis = allSnaps.filter((d) => d.name.endsWith(`${month}_${conn.data.id}`));
  snap1.status === 200 && snap2.status === 200 && forThis.length === 1 && fnum(snapDoc1, 'casesDisbursedCount') === 3
    ? ok(`recon snapshot idempotent — ran twice, exactly 1 doc, 3 cases`) : bad('snapshot idempotency', `count=${forThis.length}`);
  fnum(snapDoc1, 'disbursedValue') === 10000000 && fnum(snapDoc1, 'expectedGross') === 140000
    ? ok('snapshot totals correct (disbursed ₹1.0Cr, expected ₹1,40,000)') : bad('snapshot totals', JSON.stringify({ d: fnum(snapDoc1, 'disbursedValue'), e: fnum(snapDoc1, 'expectedGross') }));

  // ── 4. Dashboard receivables TIE-OUT to direct misRecords sums (PER CONNECTOR) ──
  // The dashboard month-total spans all connectors; the spec's tie-out is per
  // connector, so compare THIS connector's dashboard entry to its direct sum.
  const dash = await api('GET', `/api/crm2/dashboards?period=${month}`, T);
  const mis = await listDocs('misRecords');
  const ours = mis.filter((d) => fstr(d, 'connectorId') === conn.data.id && fstr(d, 'reportingMonth') === month);
  const directExpected = ours.reduce((s, d) => s + (fnum(d, 'expectedGross') ?? 0), 0);
  const directDisbursed = ours.reduce((s, d) => s + (fnum(d, 'disbursedAmount') ?? 0), 0);
  const connName = `Conn-${stamp}`;
  const recvEntry = (dash.data.receivables?.byConnector ?? []).find((r) => r.connector === connName);
  dash.status === 200 && recvEntry && recvEntry.expected === directExpected && directExpected === 140000
    ? ok(`receivables TIE-OUT (per connector) — dashboard expected ${recvEntry?.expected} == direct misRecords sum ${directExpected}`)
    : bad('tie-out', `dashConn=${recvEntry?.expected} direct=${directExpected}`);
  const disbEntry = dash.data.disbursement?.byConnector?.[connName];
  disbEntry && disbEntry.disbursed === directDisbursed && directDisbursed === 10000000
    ? ok(`disbursement ties out per connector (${directDisbursed})`) : bad('disb tie-out', `${disbEntry?.disbursed} vs ${directDisbursed}`);

  // ── 5. Dashboard money invisible without payout.amounts.read ──
  const poor = await mkUser(null, { 'crm.cases.read': true, 'mis.read': true });
  const pdash = await api('GET', `/api/crm2/dashboards?period=${month}`, poor);
  const leak = pdash.data.receivables !== undefined || pdash.data.margin !== undefined
    || (pdash.data.disbursement?.total?.disbursed != null)
    || (pdash.data.rmPerformance ?? []).some((r) => r.disbursedValue != null || r.revenue != null);
  pdash.status === 200 && !leak
    ? ok('dashboard money absent for caller without payout.amounts.read (server-side)') : bad('dash money leak', JSON.stringify({ recv: pdash.data.receivables !== undefined, margin: pdash.data.margin !== undefined }));
  // funnel/pipeline counts still present (non-money)
  pdash.data.funnel?.totalLeads != null && Array.isArray(pdash.data.pipeline)
    ? ok('non-money sections (funnel, pipeline) still served to non-privileged caller') : bad('non-money missing', JSON.stringify(pdash.data.funnel));
  // recon import row money also stripped for poor
  const poorRecon = await mkUser(null, { 'recon.read': true });
  const impPoor = await api('GET', `/api/crm2/recon/imports/${imp.data.importId}`, poorRecon);
  const reconLeak = (impPoor.data.rows ?? []).some((r) => r.amount != null || r.amountVariance != null);
  impPoor.status === 200 && !reconLeak ? ok('recon row amounts stripped for recon.read-only (no payout.amounts.read)') : bad('recon money leak', `leak=${reconLeak}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
