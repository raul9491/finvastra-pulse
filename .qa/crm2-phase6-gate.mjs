/**
 * CRM 2.0 Phase 6 acceptance — case collaboration (collaborators + task/update thread).
 * Prereqs: emulators + dev server :8090 (same as the other crm2 gates).
 *
 * Proves: admin/manager/owner can set collaborators (a non-privileged perm-holder
 * cannot → 403); tasks + updates post to the thread; a task assigned to a teammate
 * surfaces via GET /api/crm2/my-case-tasks (cross-case collectionGroup) and drops
 * out once marked done; updates are informational (status done on create).
 */
const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };

async function signUp(email) {
  return fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
}
async function patchUser(uid, fields) {
  await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
}
async function makeUser(fapl, role, perms) {
  const email = `p6-${fapl.toLowerCase()}-${Date.now()}@finvastra.com`;
  const s = await signUp(email);
  const fields = {
    userId: { stringValue: s.localId }, email: { stringValue: email },
    displayName: { stringValue: fapl }, employeeId: { stringValue: fapl }, role: { stringValue: role },
  };
  if (perms) fields.perms = { mapValue: { fields: Object.fromEntries(perms.map((p) => [p, { booleanValue: true }])) } };
  await patchUser(s.localId, fields);
  return { token: s.idToken, uid: s.localId };
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
  const r = await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}?pageSize=50`, { headers: { Authorization: 'Bearer owner' } });
  return (await r.json().catch(() => ({}))).documents ?? [];
}
const fv = (d, f) => d?.fields?.[f]?.stringValue ?? d?.fields?.[f]?.booleanValue ?? null;
const arr = (d, f) => (d?.fields?.[f]?.arrayValue?.values ?? []).map((v) => v.stringValue);

async function main() {
  console.log('CRM 2.0 Phase 6 — case collaboration\n');
  const stamp = Date.now() % 1000000;
  const admin = await makeUser('FAPL-022', 'admin');            // owner (handlingRm defaults to caller)
  const mate = await makeUser('FAPL-099', 'employee', ['crm.cases.read', 'crm.cases.write']);  // perm-holder, not manager/owner

  const prod = await api('POST', '/api/crm2/masters/products', admin.token, { name: `P-${stamp}`, shortCode: 'P', vertical: 'LOANS' });
  const client = await api('POST', '/api/crm2/clients', admin.token, { name: `Co ${stamp}`, constitution: 'PVT_LTD', primaryContact: { mobile: `98${String(stamp).padStart(8, '0')}` } });
  const kase = await api('POST', '/api/crm2/cases', admin.token, { clientId: client.data.id, productId: prod.data.id });
  const caseId = kase.data.caseId;

  // Owner/admin sets collaborators.
  const setC = await api('POST', `/api/crm2/cases/${caseId}/collaborators`, admin.token, { collaborators: ['FAPL-099', 'FAPL-099', 'FAPL-022'] });
  setC.status === 200 ? ok('admin set collaborators (200)') : bad('set collaborators', JSON.stringify(setC));
  const cDoc = await getDoc(`cases/${caseId}`);
  const collab = arr(cDoc, 'collaborators');
  collab.length === 1 && collab[0] === 'FAPL-099'
    ? ok('collaborators deduped + handlingRm stripped → [FAPL-099]') : bad('collaborators value', JSON.stringify(collab));

  // A non-manager, non-owner perm-holder CANNOT change collaborators.
  const denied = await api('POST', `/api/crm2/cases/${caseId}/collaborators`, mate.token, { collaborators: [] });
  denied.status === 403 ? ok('non-owner/non-manager collaborator edit blocked (403)') : bad('collab guard', JSON.stringify(denied));

  // Post an update + a task assigned to the teammate.
  const upd = await api('POST', `/api/crm2/cases/${caseId}/tasks`, admin.token, { kind: 'update', text: 'Filed with bank today' });
  upd.status === 200 ? ok('update posted') : bad('update', JSON.stringify(upd));
  const task = await api('POST', `/api/crm2/cases/${caseId}/tasks`, admin.token, { kind: 'task', text: 'Collect salary slips', assignedTo: 'FAPL-099' });
  task.status === 200 && task.data.taskId ? ok('task created + assigned to FAPL-099') : bad('task', JSON.stringify(task));
  const tDoc = await getDoc(`cases/${caseId}/tasks/${task.data.taskId}`);
  fv(tDoc, 'assignedTo') === 'FAPL-099' && fv(tDoc, 'status') === 'open' && fv(tDoc, 'caseId') === caseId && fv(tDoc, 'kind') === 'task'
    ? ok('task doc: assignedTo + open + denormalised caseId') : bad('task doc', JSON.stringify(tDoc?.fields));
  const uDoc = (await listDocs(`cases/${caseId}/tasks`)).find((d) => fv(d, 'kind') === 'update');
  fv(uDoc, 'status') === 'done' ? ok('update is informational (status done on create)') : bad('update status', fv(uDoc, 'status'));

  // The teammate sees the task via the cross-case Tasks page endpoint.
  const mine = await api('GET', '/api/crm2/my-case-tasks', mate.token);
  const found = (mine.data.tasks ?? []).find((t) => t.id === task.data.taskId);
  mine.status === 200 && found && found.caseId === caseId && found.text === 'Collect salary slips'
    ? ok('my-case-tasks returns the assigned task (cross-case)') : bad('my-case-tasks', JSON.stringify(mine.data));

  // Mark the task done → drops out of the open list.
  const done = await api('PATCH', `/api/crm2/cases/${caseId}/tasks/${task.data.taskId}`, mate.token, { status: 'done' });
  done.status === 200 ? ok('teammate marked the task done') : bad('mark done', JSON.stringify(done));
  const after = await api('GET', '/api/crm2/my-case-tasks', mate.token);
  (after.data.tasks ?? []).every((t) => t.id !== task.data.taskId)
    ? ok('done task no longer in my open case-tasks') : bad('done filter', JSON.stringify(after.data.tasks));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
