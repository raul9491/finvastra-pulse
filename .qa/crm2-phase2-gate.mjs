/**
 * CRM 2.0 Phase 2 acceptance — leads intake, dedupe, convert (emulator + dev server).
 * Same prereqs as crm2-phase1-gate.mjs (.qa header there).
 *
 * Asserts: website-form lead lands with UTM · duplicate flagged not blocked ·
 * convert creates client + case + PRIMARY applicant + docTracker atomically ·
 * PARTNER_DSA lead converts to a subDsa.
 */

const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };

async function signUp() {
  const email = `p2-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@finvastra.com`;
  const s = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  return { ...s, email };
}

async function makeAdmin() {
  const s = await signUp();
  await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${s.localId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: {
      userId: { stringValue: s.localId }, email: { stringValue: s.email },
      displayName: { stringValue: 'P2 Admin' }, role: { stringValue: 'admin' },
      employeeId: { stringValue: 'FAPL-022' },
    } }),
  });
  return s.idToken;
}

/** A non-admin user with a perms map (requirePerm falls back to the users doc). */
async function makeUser({ name, role = 'employee', crmRole = null, fapl, perms = {} }) {
  const s = await signUp();
  const fields = {
    userId: { stringValue: s.localId }, email: { stringValue: s.email },
    displayName: { stringValue: name }, role: { stringValue: role },
    employeeId: { stringValue: fapl },
  };
  if (crmRole) fields.crmRole = { stringValue: crmRole };
  const permFields = {};
  for (const k of Object.keys(perms)) permFields[k] = { booleanValue: !!perms[k] };
  if (Object.keys(permFields).length) fields.perms = { mapValue: { fields: permFields } };
  await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${s.localId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  return s.idToken;
}

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// Read a doc via the emulator REST (rules bypass)
async function getDoc(path) {
  const r = await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`,
    { headers: { Authorization: 'Bearer owner' } });
  return r.status === 200 ? r.json() : null;
}
async function listDocs(path) {
  const r = await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}?pageSize=50`,
    { headers: { Authorization: 'Bearer owner' } });
  const j = await r.json().catch(() => ({}));
  return j.documents ?? [];
}
const fv = (doc, field) => doc?.fields?.[field]?.stringValue
  ?? doc?.fields?.[field]?.integerValue ?? doc?.fields?.[field]?.booleanValue ?? null;

async function main() {
  console.log('CRM 2.0 Phase 2 acceptance — leads, dedupe, convert\n');
  const token = await makeAdmin();
  const stamp = Date.now() % 1000000;
  const mob = (n) => `98${String(stamp + n).padStart(8, '0')}`;

  // ── 1. Public website-form lead with UTM ──────────────────────────────────
  const pub = await api('POST', '/api/public/leads', null, {
    name: 'Valeo Products LLP', mobile: mob(1), email: `valeo${stamp}@x.com`,
    category: 'LOAN', amountRequired: 5000000,
    formId: 'business_loan_form', sourceUrl: 'https://finvastra.com/loans?x=1',
    utm: { source: 'google', medium: 'cpc', campaign: 'lap-june' },
  });
  pub.status === 200 && pub.data.id?.startsWith('LD-')
    ? ok(`public lead created (${pub.data.id})`) : bad('public lead', JSON.stringify(pub));

  const leadDoc = await getDoc(`leads/${pub.data.id}`);
  const utm = leadDoc?.fields?.sourceMeta?.mapValue?.fields?.utm?.mapValue?.fields;
  utm?.campaign?.stringValue === 'lap-june' && fv(leadDoc, 'source') === 'WEBSITE'
    ? ok('UTM + formId + source captured') : bad('utm capture', JSON.stringify(leadDoc?.fields?.sourceMeta));

  // Honeypot: bot fills hidden field → 200 but NO lead
  const hp = await api('POST', '/api/public/leads', null, { name: 'Bot', mobile: mob(2), website: 'http://spam' });
  hp.status === 200 && !hp.data.id ? ok('honeypot swallowed silently') : bad('honeypot', JSON.stringify(hp));

  // ── 2. Duplicate flagged, never blocked ───────────────────────────────────
  const dup = await api('POST', '/api/public/leads', null, { name: 'Valeo Again', mobile: mob(1) });
  dup.status === 200 && dup.data.id
    ? ok(`duplicate submission still creates a lead (${dup.data.id})`) : bad('dup create', JSON.stringify(dup));
  const dupDoc = await getDoc(`leads/${dup.data.id}`);
  fv(dupDoc, 'duplicateOfLeadId') === pub.data.id
    ? ok(`flagged duplicateOfLeadId → ${pub.data.id}`) : bad('dup flag', JSON.stringify(dupDoc?.fields?.duplicateOfLeadId));

  // ── 3. Convert: needs a product + a mandatory doc def ─────────────────────
  const prod = await api('POST', '/api/crm2/masters/products', token, {
    name: `LAP-P2-${stamp}`, shortCode: 'LAP', vertical: 'LOANS',
  });
  await api('POST', '/api/crm2/masters/documentMaster', token, {
    name: `PAN Card P2-${stamp}`, category: 'INDIVIDUAL_KYC', applicableTo: 'EACH_APPLICANT',
    mandatoryForProducts: [prod.data.id], requiredByStage: 'LOGIN',
  });
  await api('POST', '/api/crm2/masters/documentMaster', token, {
    name: `GST Cert P2-${stamp}`, category: 'ENTITY_KYC', applicableTo: 'ENTITY',
    mandatoryForProducts: [prod.data.id], requiredByStage: 'LOGIN',
  });

  // Unqualified convert must be rejected
  const early = await api('POST', `/api/crm2/leads/${pub.data.id}/convert`, token, { productId: prod.data.id });
  early.status === 400 && /QUALIFIED/.test(early.data.error ?? '')
    ? ok('convert blocked while not QUALIFIED') : bad('early convert', JSON.stringify(early));

  await api('PATCH', `/api/crm2/leads/${pub.data.id}`, token, {
    status: 'QUALIFIED', assignedRm: 'FAPL-012',
    activity: { note: 'Spoke to promoter, docs ready', action: 'call' },
  });

  const conv = await api('POST', `/api/crm2/leads/${pub.data.id}/convert`, token, {
    productId: prod.data.id, constitution: 'LLP',
  });
  conv.status === 200 && conv.data.clientId?.startsWith('FCL-') && conv.data.caseId?.startsWith('FIN-CASE-')
    ? ok(`converted → ${conv.data.clientId} / ${conv.data.caseId}`) : bad('convert', JSON.stringify(conv));

  const caseDoc = await getDoc(`cases/${conv.data.caseId}`);
  fv(caseDoc, 'stage') === 'OPENED' && fv(caseDoc, 'handlingRm') === 'FAPL-012' && fv(caseDoc, 'payoutStatus') === 'NOT_DUE'
    ? ok('case OPENED, handlingRm carried from lead RM, payout NOT_DUE')
    : bad('case fields', JSON.stringify({ stage: fv(caseDoc, 'stage'), rm: fv(caseDoc, 'handlingRm') }));

  const clientDoc = await getDoc(`clients/${conv.data.clientId}`);
  fv(clientDoc, 'constitution') === 'LLP' && fv(clientDoc, 'sourceLeadId') === pub.data.id
    ? ok('client created (LLP, sourceLeadId linked)') : bad('client', JSON.stringify(clientDoc?.fields?.constitution));

  const applicants = await listDocs(`cases/${conv.data.caseId}/applicants`);
  applicants.length === 1 && applicants[0].fields?.type?.stringValue === 'PRIMARY'
    ? ok('PRIMARY applicant created from lead contact') : bad('applicant', `${applicants.length} applicants`);

  const tracker = await listDocs(`cases/${conv.data.caseId}/docTracker`);
  tracker.length === 2
    ? ok('docTracker expanded (1 entity doc + 1 per-applicant doc)') : bad('docTracker', `${tracker.length} rows`);

  const leadAfter = await getDoc(`leads/${pub.data.id}`);
  fv(leadAfter, 'status') === 'CONVERTED' && leadAfter?.fields?.converted?.booleanValue === true
    ? ok('lead marked CONVERTED with links') : bad('lead conversion fields', JSON.stringify(leadAfter?.fields?.status));

  // Double-convert blocked
  const again = await api('POST', `/api/crm2/leads/${pub.data.id}/convert`, token, { productId: prod.data.id });
  again.status === 409 ? ok('second convert rejected (409 already converted)') : bad('double convert', JSON.stringify(again));

  // ── 4. PARTNER_DSA lead → subDsa ──────────────────────────────────────────
  const partner = await api('POST', '/api/crm2/leads', token, {
    name: 'Ramesh Referrals', mobile: mob(3), category: 'PARTNER_DSA', source: 'WALKIN',
  });
  await api('PATCH', `/api/crm2/leads/${partner.data.id}`, token, { status: 'QUALIFIED' });
  const pconv = await api('POST', `/api/crm2/leads/${partner.data.id}/convert`, token, { relationshipOwner: 'FAPL-003' });
  pconv.status === 200 && pconv.data.subDsaId?.startsWith('SDSA-')
    ? ok(`PARTNER_DSA lead → subDsa ${pconv.data.subDsaId}`) : bad('partner convert', JSON.stringify(pconv));
  const sd = await getDoc(`subDsas/${pconv.data.subDsaId}`);
  fv(sd, 'sourceLeadId') === partner.data.id && fv(sd, 'relationshipOwner') === 'FAPL-003'
    ? ok('subDsa carries sourceLeadId + relationshipOwner') : bad('subDsa fields', JSON.stringify(sd?.fields));

  // ── 5. Client Master — direct CRUD + ownership/assign-RM access ────────────
  const rmA = await makeUser({ name: 'RM Alpha', fapl: 'FAPL-901', perms: { 'crm.cases.write': true, 'crm.cases.read': true } });
  const rmB = await makeUser({ name: 'RM Bravo', fapl: 'FAPL-902', perms: { 'crm.cases.write': true, 'crm.cases.read': true } });
  const mgr = await makeUser({ name: 'Team Manager', crmRole: 'manager', fapl: 'FAPL-903', perms: { 'crm.cases.write': true, 'crm.cases.read': true } });

  // RM-A creates a client → FCL- id, owned by FAPL-901
  const cCreate = await api('POST', '/api/crm2/clients', rmA, {
    name: `Direct Client ${stamp}`, constitution: 'PVT_LTD',
    primaryContact: { name: 'Promoter', mobile: mob(4), email: `dc${stamp}@x.com` },
    industry: 'Manufacturing',
  });
  cCreate.status === 200 && cCreate.data.id?.startsWith('FCL-')
    ? ok(`client created directly (${cCreate.data.id})`) : bad('client create', JSON.stringify(cCreate));
  const cId = cCreate.data.id;
  const cDoc = await getDoc(`clients/${cId}`);
  fv(cDoc, 'ownerRm') === 'FAPL-901' && fv(cDoc, 'name') === `Direct Client ${stamp}`
    ? ok('client ownerRm = creating RM') : bad('client owner', JSON.stringify(cDoc?.fields?.ownerRm));

  // RM-A edits own client detail → 200
  const ownEdit = await api('PATCH', `/api/crm2/clients/${cId}`, rmA, { industry: 'Textiles' });
  ownEdit.status === 200 ? ok('owner edits own client detail') : bad('owner edit', JSON.stringify(ownEdit));

  // RM-B edits another RM's client detail → 403
  const foreignEdit = await api('PATCH', `/api/crm2/clients/${cId}`, rmB, { industry: 'Hijack' });
  foreignEdit.status === 403 ? ok('non-owner RM blocked from editing details') : bad('foreign edit', JSON.stringify(foreignEdit));

  // RM-B (not manager) tries assign-RM → 403
  const foreignAssign = await api('PATCH', `/api/crm2/clients/${cId}`, rmB, { ownerRm: 'FAPL-902' });
  foreignAssign.status === 403 ? ok('non-manager blocked from assign-RM') : bad('foreign assign', JSON.stringify(foreignAssign));

  // RM-B (not manager) tries blacklist → 403
  const foreignBlk = await api('PATCH', `/api/crm2/clients/${cId}`, rmB, { status: 'BLACKLISTED' });
  foreignBlk.status === 403 ? ok('non-manager blocked from blacklist') : bad('foreign blacklist', JSON.stringify(foreignBlk));

  // Manager reassigns + blacklists → 200
  const mgrAssign = await api('PATCH', `/api/crm2/clients/${cId}`, mgr, { ownerRm: 'FAPL-902' });
  mgrAssign.status === 200 ? ok('manager assigns RM') : bad('manager assign', JSON.stringify(mgrAssign));
  const after = await getDoc(`clients/${cId}`);
  fv(after, 'ownerRm') === 'FAPL-902' ? ok('ownerRm updated to FAPL-902') : bad('owner after', JSON.stringify(after?.fields?.ownerRm));
  const mgrBlk = await api('PATCH', `/api/crm2/clients/${cId}`, mgr, { status: 'BLACKLISTED' });
  mgrBlk.status === 200 ? ok('manager blacklists client') : bad('manager blacklist', JSON.stringify(mgrBlk));

  // ── 6. Convert with EXISTING client (reuse) and with newClient (create) ────
  // Existing-client reuse: a fresh lead converts onto the client created above.
  const lead2 = await api('POST', '/api/crm2/leads', token, { name: 'Reuse Co', mobile: mob(5), category: 'LOAN', source: 'WALKIN' });
  await api('PATCH', `/api/crm2/leads/${lead2.data.id}`, token, { status: 'QUALIFIED' });
  const conv2 = await api('POST', `/api/crm2/leads/${lead2.data.id}/convert`, token, { clientId: cId, productId: prod.data.id });
  conv2.status === 200 && conv2.data.clientId === cId
    ? ok('convert reuses the passed existing client (no new client)') : bad('reuse convert', JSON.stringify(conv2));

  // newClient: a fresh lead converts by creating a brand-new FCL- client.
  const lead3 = await api('POST', '/api/crm2/leads', token, { name: 'Greenfield Co', mobile: mob(6), category: 'LOAN', source: 'WALKIN' });
  await api('PATCH', `/api/crm2/leads/${lead3.data.id}`, token, { status: 'QUALIFIED' });
  const conv3 = await api('POST', `/api/crm2/leads/${lead3.data.id}/convert`, token, {
    productId: prod.data.id,
    newClient: { name: `Greenfield Holdings ${stamp}`, constitution: 'PARTNERSHIP', primaryContact: { mobile: mob(7) } },
  });
  conv3.status === 200 && conv3.data.clientId?.startsWith('FCL-') && conv3.data.clientId !== cId
    ? ok(`convert with newClient mints a fresh client (${conv3.data.clientId})`) : bad('newClient convert', JSON.stringify(conv3));
  const newC = await getDoc(`clients/${conv3.data.clientId}`);
  fv(newC, 'name') === `Greenfield Holdings ${stamp}` && fv(newC, 'constitution') === 'PARTNERSHIP' && fv(newC, 'sourceLeadId') === lead3.data.id
    ? ok('newClient carries template fields + sourceLeadId') : bad('newClient doc', JSON.stringify(newC?.fields?.name));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
