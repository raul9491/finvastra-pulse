/**
 * CRM 2.0 Phase 1 wiring smoke test — exercises the REAL HTTP + Firestore path
 * against the emulators (not just the pure functions).
 *
 * Flow: admin user → create connector + lender + product → create mapping →
 * add slab gen-1 (end-dated) + gen-2 (open) → attempt overlap (must 400 with
 * details) → resolve-slab for a date in each generation → resolve for an
 * uncovered date (must 422 NO_SLAB with human message).
 *
 * Prereqs (run in separate terminals, or use the orchestration in .qa/README):
 *   1. npm run dev:emulators        (auth :9099, firestore :8080)
 *   2. GCLOUD_PROJECT=demo-pulse FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *      FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 VITE_USE_EMULATOR=true \
 *      PORT=8090 npx tsx server.ts
 *   3. node .qa/crm2-phase1-gate.mjs
 */

const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };
const bad = (name, detail) => { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); };

// ── Auth emulator: create an admin user + mint an ID token ──────────────────
async function makeAdmin() {
  const email = `gate-admin-${Date.now()}@finvastra.com`;
  const signUp = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  if (!signUp.localId) throw new Error(`auth signUp failed: ${JSON.stringify(signUp)}`);

  // users doc with role admin + employeeId — written straight to the Firestore
  // emulator REST (server reads it for requirePerm fallback + FAPL resolution).
  const docUrl = `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${signUp.localId}`;
  await fetch(docUrl, {
    // "Bearer owner" = emulator rules bypass (Admin-SDK equivalent for REST).
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: {
      userId: { stringValue: signUp.localId },
      email: { stringValue: email },
      displayName: { stringValue: 'Gate Admin' },
      role: { stringValue: 'admin' },
      employeeId: { stringValue: 'FAPL-022' },
    } }),
  });
  return signUp.idToken;
}

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function main() {
  console.log('CRM 2.0 Phase 1 gate — wiring smoke test\n');
  const token = await makeAdmin();

  // 1. Masters
  const conn = await api('POST', '/api/crm2/masters/aggregators', token, {
    name: 'Starpowerz', type: 'MASTER_AGGREGATOR', payoutFrequency: 'MONTHLY', standardTdsPct: 5,
  });
  conn.status === 200 && conn.data.id?.startsWith('AGG-')
    ? ok(`aggregator created (${conn.data.id})`) : bad('aggregator create', JSON.stringify(conn));

  const lender = await api('POST', '/api/crm2/masters/lenders', token, {
    name: 'Fedbank Financial Services', type: 'NBFC',
  });
  lender.status === 200 && lender.data.id?.startsWith('LEN-')
    ? ok(`lender created (${lender.data.id})`) : bad('lender create', JSON.stringify(lender));

  const product = await api('POST', '/api/crm2/masters/products', token, {
    name: 'Loan Against Property', shortCode: 'LAP', vertical: 'LOANS',
  });
  product.status === 200 && product.data.id?.startsWith('PRD-')
    ? ok(`product created (${product.data.id})`) : bad('product create', JSON.stringify(product));

  // Sub-product master (just a name, mapped to a product)
  const subProduct = await api('POST', '/api/crm2/masters/subProducts', token, {
    name: 'Prime LAP', productId: product.data.id,
  });
  subProduct.status === 200 && subProduct.data.id?.startsWith('SUBP-')
    ? ok(`sub-product created (${subProduct.data.id}) mapped to ${product.data.id}`) : bad('sub-product create', JSON.stringify(subProduct));

  // 2. Mapping (aggregator × lender × product)
  const map = await api('POST', '/api/crm2/mappings', token, {
    connectorId: conn.data.id, lenderId: lender.data.id, productId: product.data.id,
    dsaCode: '1033618', codeRegisteredName: 'STAR POWERZ DIGITAL TECH P', slabs: [],
  });
  map.status === 200 && map.data.id?.startsWith('MAP-')
    ? ok(`mapping created (${map.data.id})`) : bad('mapping create', JSON.stringify(map));

  // Duplicate aggregator × lender × product must be rejected
  const dup = await api('POST', '/api/crm2/mappings', token, {
    connectorId: conn.data.id, lenderId: lender.data.id, productId: product.data.id, dsaCode: 'x', slabs: [],
  });
  dup.status === 409 ? ok('duplicate aggregator×lender×product rejected (409)') : bad('dup mapping', JSON.stringify(dup));

  // 3. Two slab generations via end-and-add
  const gen1 = await api('POST', `/api/crm2/mappings/${map.data.id}/slabs`, token, {
    productIds: [product.data.id], finvastraPayoutPct: 1.2,
    effectiveFrom: '2025-04-01', effectiveTo: '2026-03-31',
  });
  gen1.status === 200 ? ok('slab gen-1 added (1.2%, FY25-26)') : bad('gen1', JSON.stringify(gen1));

  const gen2 = await api('POST', `/api/crm2/mappings/${map.data.id}/slabs`, token, {
    productIds: [product.data.id], finvastraPayoutPct: 1.4,
    subDsaDefaultPayoutPct: 0.7, effectiveFrom: '2026-04-01',
  });
  gen2.status === 200 ? ok('slab gen-2 added (1.4%, open-ended)') : bad('gen2', JSON.stringify(gen2));

  // 4. Overlapping slab must be rejected with details
  const overlap = await api('POST', `/api/crm2/mappings/${map.data.id}/slabs`, token, {
    productIds: [product.data.id], finvastraPayoutPct: 1.5, effectiveFrom: '2026-06-01',
  });
  overlap.status === 400 && Array.isArray(overlap.data.details) && overlap.data.details.length > 0
    ? ok(`overlap rejected with details ("${overlap.data.details[0].slice(0, 60)}…")`)
    : bad('overlap rejection', JSON.stringify(overlap));

  // 5. Resolution through the HTTP path
  const r1 = await api('GET', `/api/crm2/mappings/${map.data.id}/resolve-slab?productId=${product.data.id}&date=2025-12-01`, token);
  r1.status === 200 && r1.data.slab?.finvastraPayoutPct === 1.2
    ? ok('resolve 2025-12-01 → gen-1 (1.2%)') : bad('resolve gen1', JSON.stringify(r1));

  const r2 = await api('GET', `/api/crm2/mappings/${map.data.id}/resolve-slab?productId=${product.data.id}&date=2026-05-12`, token);
  r2.status === 200 && r2.data.slab?.finvastraPayoutPct === 1.4
    ? ok('resolve 2026-05-12 → gen-2 (1.4%)') : bad('resolve gen2', JSON.stringify(r2));

  const r3 = await api('GET', `/api/crm2/mappings/${map.data.id}/resolve-slab?productId=${product.data.id}&date=2024-01-15`, token);
  r3.status === 422 && r3.data.kind === 'NO_SLAB' && /No active payout slab for Starpowerz/.test(r3.data.error ?? '')
    ? ok(`no-coverage date → 422 NO_SLAB ("${r3.data.error}")`)
    : bad('no-slab error', JSON.stringify(r3));

  // 6. Permission denial: a non-admin without perms must get 403
  const nobody = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `gate-emp-${Date.now()}@finvastra.com`, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  const denied = await api('POST', '/api/crm2/masters/lenders', nobody.idToken, { name: 'X', type: 'NBFC' });
  denied.status === 403 ? ok('non-admin without perms → 403') : bad('perm denial', JSON.stringify(denied));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
