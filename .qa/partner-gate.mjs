/**
 * Partner intake / scoring / onboarding gate — exercises the REAL HTTP + Firestore
 * path against the emulators for the funnel added on the Connector entity.
 *
 * Proves: minimal Inquiry create (NO PAN) → scored + inactive; screening PATCH
 * re-tiers; funnelStatus→Active derives status:'active'; onboarding checklist →
 * progressPct + completion date; config PATCH bumps version + re-tiers non-terminal
 * candidates (Active untouched); public partner-inquiry (no auth, honeypot);
 * client can't forge partnerScoring/progressPct.
 *
 * Run via the generic runner: npm run qa:partner  (see run-partner-gate.sh)
 */
const API = process.env.API_BASE ?? 'http://127.0.0.1:8090';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-pulse';

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };

async function makeAdmin() {
  const email = `partner-gate-${Date.now()}@finvastra.com`;
  const su = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gate@12345', returnSecureToken: true }),
  }).then((r) => r.json());
  const url = `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${su.localId}`;
  await fetch(url, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: {
      userId: { stringValue: su.localId }, email: { stringValue: email },
      displayName: { stringValue: 'Partner Gate Admin' }, role: { stringValue: 'admin' },
      employeeId: { stringValue: 'FAPL-022' },
    } }),
  });
  return su.idToken;
}
async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function getDoc(path) {
  const r = await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  return r.ok ? (await r.json()).fields : null;
}
const fv = (f, k) => {
  const v = f?.[k]; if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.mapValue) return v.mapValue.fields;
  return v;
};

async function main() {
  console.log('Partner intake gate\n');
  const token = await makeAdmin();

  // 1. Minimal Inquiry — NO PAN — must succeed, inactive, Cold-ish, scored.
  const c1 = await api('POST', '/api/crm2/connectors', token, {
    displayName: 'Ramesh CA', mobiles: ['9876500011'], verticals: ['loan'],
    leadSource: 'Website Form', funnelStatus: 'Inquiry',
  });
  c1.status === 200 && c1.data.id ? ok(`minimal Inquiry created without PAN (${c1.data.connectorCode})`) : bad('inquiry create', JSON.stringify(c1));
  const id = c1.data.id;
  let doc = await getDoc(`connectors/${id}`);
  fv(doc, 'status') === 'inactive' && fv(doc, 'funnelStatus') === 'Inquiry'
    ? ok('created inactive + funnelStatus Inquiry (hidden from RM pickers)') : bad('inquiry defaults', JSON.stringify({ status: fv(doc, 'status'), fs: fv(doc, 'funnelStatus') }));
  const ps0 = fv(doc, 'partnerScoring');
  ps0 && fv(ps0, 'tier') ? ok(`partnerScoring computed server-side (tier ${fv(ps0, 'tier')}, total ${fv(ps0, 'totalScore')})`) : bad('scoring present', JSON.stringify(doc?.partnerScoring));

  // 2. Screening PATCH → re-tier to Hot.
  await api('PATCH', `/api/crm2/connectors/${id}`, token, {
    networkType: 'CA / Accountant', networkSize: '>100 contacts', productDemandFit: 'Strong Fit',
    priorTrackRecord: 'Proven with Examples', expectedMonthlyVolume: '>5 cases/month', kycReadinessInput: 'Ready',
  });
  doc = await getDoc(`connectors/${id}`);
  const ps1 = fv(doc, 'partnerScoring');
  fv(ps1, 'tier') === 'Hot' && fv(ps1, 'totalScore') === 17
    ? ok('screening PATCH re-tiered → Hot (17)') : bad('re-tier', JSON.stringify({ tier: fv(ps1, 'tier'), total: fv(ps1, 'totalScore') }));

  // 3. Client cannot FORGE the score — send a bogus partnerScoring; server ignores it.
  await api('PATCH', `/api/crm2/connectors/${id}`, token, {
    partnerScoring: { tier: 'Hot', totalScore: 999 }, kycReadinessInput: 'Partial',
  });
  doc = await getDoc(`connectors/${id}`);
  fv(fv(doc, 'partnerScoring'), 'totalScore') !== 999
    ? ok('forged partnerScoring ignored (server recomputes)') : bad('forge blocked', 'totalScore=999 leaked');

  // 4. ACTIVATION CHAIN: Active is BLOCKED until practical assessment passed +
  //    agreement signed + PAN collected — then it derives status:'active'.
  const blocked = await api('PATCH', `/api/crm2/connectors/${id}`, token, { funnelStatus: 'Active' });
  blocked.status === 422 && /practical assessment/.test(blocked.data.error ?? '')
    ? ok('Active BLOCKED before practical assessment (422 names what is missing)') : bad('activation gate', JSON.stringify(blocked));

  // Fail the practical -> still blocked with the FAILED message.
  await api('PATCH', `/api/crm2/connectors/${id}`, token, {
    practicalAssessment: { productKnowledge: 'Weak', sampleCaseQuality: 'Poor', responsiveness: 'Slow', processUnderstanding: 'None' },
  });
  const failedTry = await api('PATCH', `/api/crm2/connectors/${id}`, token, { funnelStatus: 'Active' });
  failedTry.status === 422 && /FAILED/.test(failedTry.data.error ?? '')
    ? ok('a FAILED assessment still blocks Active') : bad('failed-assessment gate', JSON.stringify(failedTry));

  // Pass the practical + sign agreement + collect PAN -> Active goes through.
  await api('PATCH', `/api/crm2/connectors/${id}`, token, {
    practicalAssessment: { productKnowledge: 'Strong', sampleCaseQuality: 'Complete & clean', responsiveness: 'Prompt', processUnderstanding: 'Clear', assessorNotes: 'Sharp; clean sample file' },
    onboardingChecklist: { agreementSignedDate: '2026-07-10', panCollected: true },
  });
  doc = await getDoc(`connectors/${id}`);
  const paDoc = fv(doc, 'practicalAssessment');
  fv(paDoc, 'result') === 'Pass' && fv(paDoc, 'totalScore') === 10
    ? ok('practical assessment scored server-side (Pass 10/10)') : bad('practical score', JSON.stringify({ r: fv(paDoc, 'result'), t: fv(paDoc, 'totalScore') }));
  await api('PATCH', `/api/crm2/connectors/${id}`, token, { funnelStatus: 'Active' });
  doc = await getDoc(`connectors/${id}`);
  fv(doc, 'status') === 'active' && fv(doc, 'funnelStatus') === 'Active'
    ? ok('chain complete → Active allowed → status active (pickable by RMs)') : bad('activate', JSON.stringify({ s: fv(doc, 'status') }));

  // 5. Onboarding checklist → progressPct + completion date.
  await api('PATCH', `/api/crm2/connectors/${id}`, token, {
    onboardingChecklist: { panCollected: true, aadhaarCollected: true, bankDetailsCollected: true,
      agreementSignedDate: '2026-07-01', trainingCompleted: true, pulseAccessCreated: true, firstCaseLogged: true },
  });
  doc = await getDoc(`connectors/${id}`);
  const oc = fv(doc, 'onboardingChecklist');
  fv(oc, 'progressPct') === 100 && fv(oc, 'onboardingCompleteDate')
    ? ok('all onboarding items → progressPct 100 + completion date stamped') : bad('onboarding', JSON.stringify({ p: fv(oc, 'progressPct') }));

  // 6. A Cold candidate for the config recompute test.
  const c2 = await api('POST', '/api/crm2/connectors', token, {
    displayName: 'Weak Lead', mobiles: ['9876500022'], verticals: ['loan'],
    networkType: 'Other / Unclear', networkSize: 'Not Shared', productDemandFit: 'Unclear',
  });
  const id2 = c2.data.id;
  let d2 = await getDoc(`connectors/${id2}`);
  const cold0 = fv(fv(d2, 'partnerScoring'), 'tier');

  // 7. Config PATCH bumps version + re-tiers NON-terminal (Active c1 untouched).
  const cfg = await api('PATCH', '/api/crm2/partner-scoring-config', token, { tierThresholds: { hot: 1, warm: 0 } });
  cfg.status === 200 && cfg.data.version >= 2 ? ok(`config PATCH bumped version → ${cfg.data.version}, recomputed ${cfg.data.recomputed}`) : bad('config patch', JSON.stringify(cfg));
  d2 = await getDoc(`connectors/${id2}`);
  fv(fv(d2, 'partnerScoring'), 'tier') === 'Hot' && cold0 !== 'Hot'
    ? ok('non-terminal candidate re-tiered by new thresholds (Cold→Hot)') : bad('recompute non-terminal', JSON.stringify({ before: cold0, after: fv(fv(d2, 'partnerScoring'), 'tier') }));
  const d1 = await getDoc(`connectors/${id}`);
  fv(fv(d1, 'partnerScoring'), 'rubricVersion') === 1
    ? ok('terminal (Active) candidate NOT recomputed by config change') : bad('active untouched', `rubricVersion=${fv(fv(d1, 'partnerScoring'), 'rubricVersion')}`);

  // 8. Public partner-inquiry — no auth, honeypot, creates Inquiry.
  const honey = await api('POST', '/api/public/partner-inquiry', null, { name: 'Bot', mobile: '9876500033', website: 'x' });
  honey.status === 200 && honey.data.ok ? ok('honeypot submission swallowed (no write)') : bad('honeypot', JSON.stringify(honey));
  const pub = await api('POST', '/api/public/partner-inquiry', null, {
    name: 'Walk-in Partner', mobile: '9876500044',
  });
  const pubDoc = pub.data.id ? await getDoc(`leads/${pub.data.id}`) : null;
  pub.status === 200 && fv(pubDoc, 'category') === 'PARTNER_DSA' && fv(pubDoc, 'status') === 'NEW'
    ? ok('public partner-inquiry lands as a PARTNER_DSA LEAD (no connector, no code spent)') : bad('public intake', JSON.stringify(pub));

  // 9. Website lead with partner intent auto-routes into the funnel.
  const wl = await api('POST', '/api/public/leads', null, {
    name: 'Web Partner Guy', mobile: '9876500055', category: 'PARTNER_DSA',
  });
  wl.status === 200 && wl.data.id ? ok('partner-intent website lead accepted') : bad('web lead', JSON.stringify(wl));
  await new Promise((r) => setTimeout(r, 400));
  const wlDoc = await getDoc(`leads/${wl.data.id}`);
  fv(wlDoc, 'status') === 'NEW' && fv(wlDoc, 'category') === 'PARTNER_DSA' && !fv(wlDoc, 'linkedConnectorId')
    ? ok('auto-detect STAMPS the lead PARTNER_DSA — stays a lead, no code minted') : bad('auto-stamp', JSON.stringify({ s: fv(wlDoc, 'status'), c: fv(wlDoc, 'category') }));

  // 10. Only Partner Sign-up leads may enter the funnel (rule added 2026-07-16, so a
  //     loan/wealth/general enquiry can never be moved). A GENERAL lead is REJECTED;
  //     recategorising it first — the lead drawer's Category picker escape hatch —
  //     then allows the promote. Second promote -> 409.
  const gl = await api('POST', '/api/public/leads', null, { name: 'General Guy', mobile: '9876500066' });
  const prBlocked = await api('POST', `/api/crm2/leads/${gl.data.id}/promote-partner`, token, {});
  prBlocked.status === 400
    ? ok('GENERAL lead BLOCKED from the partner funnel (400)') : bad('promote guard', JSON.stringify(prBlocked));
  const recat = await api('PATCH', `/api/crm2/leads/${gl.data.id}`, token, { category: 'PARTNER_DSA' });
  recat.status === 200 ? ok('lead recategorised to Partner Sign-up') : bad('recategorise', JSON.stringify(recat));
  const pr = await api('POST', `/api/crm2/leads/${gl.data.id}/promote-partner`, token, {});
  pr.status === 200 && pr.data.connectorCode ? ok(`recategorised lead promoted to partner funnel (${pr.data.connectorCode})`) : bad('promote', JSON.stringify(pr));
  const pr2 = await api('POST', `/api/crm2/leads/${gl.data.id}/promote-partner`, token, {});
  pr2.status === 409 ? ok('second promote rejected (409 already in funnel)') : bad('promote idempotency', JSON.stringify(pr2));

  // 10c. Return-to-lead: candidate deleted (code freed), lead re-opened.
  const ret = await api('POST', `/api/crm2/connectors/${pr.data.connectorId}/return-to-lead`, token, {});
  ret.status === 200 && ret.data.leadId === gl.data.id && ret.data.freedCode === pr.data.connectorCode
    ? ok(`return-to-lead re-opened ${gl.data.id} and freed ${ret.data.freedCode}`) : bad('return-to-lead', JSON.stringify(ret));
  const glDoc = await getDoc(`leads/${gl.data.id}`);
  const connGone = await getDoc(`connectors/${pr.data.connectorId}`);
  fv(glDoc, 'status') === 'NEW' && !fv(glDoc, 'converted') && connGone === null
    ? ok('lead is NEW again + connector doc hard-deleted') : bad('return state', JSON.stringify({ s: fv(glDoc, 'status'), gone: connGone === null }));
  // an ACTIVE candidate cannot be returned
  const retActive = await api('POST', `/api/crm2/connectors/${id}/return-to-lead`, token, {});
  retActive.status === 422 ? ok('Active partner cannot be returned (422)') : bad('active return guard', JSON.stringify(retActive));

  // 11. Activity log + follow-up on the candidate.
  const act = await api('PATCH', `/api/crm2/connectors/${id2}`, token, {
    activity: { action: 'call', note: 'Spoke — wants a callback after the 20th' },
    nextFollowUpAt: '2026-07-21T10:00:00.000Z', nextFollowUpNote: 'call after 20th',
  });
  act.status === 200 ? ok('activity + follow-up PATCH accepted') : bad('activity patch', JSON.stringify(act));
  const d2b = await getDoc(`connectors/${id2}`);
  const alog = d2b?.activityLog?.arrayValue?.values ?? [];
  alog.length === 1 && d2b?.nextFollowUpAt?.timestampValue && fv(d2b, 'followUpReminderSent') === false
    ? ok('activity appended + follow-up armed (reminderSent=false)') : bad('activity state', JSON.stringify({ n: alog.length, fu: d2b?.nextFollowUpAt, rs: fv(d2b, 'followUpReminderSent') }));

  // 12. Payout rules persist (sanitized) via the connector PATCH.
  const pr12 = await api('PATCH', `/api/crm2/connectors/${id}`, token, {
    payoutRules: [{ productId: 'ALL', basis: 'DISBURSED_PCT', value: 0.25 }, { productId: '', basis: 'BAD', value: -1 }],
  });
  pr12.status === 200 ? ok('payoutRules PATCH accepted') : bad('payoutRules patch', JSON.stringify(pr12));
  const dRules = await getDoc(`connectors/${id}`);
  const rulesArr = dRules?.payoutRules?.arrayValue?.values ?? [];
  rulesArr.length === 1 && fv(rulesArr[0]?.mapValue?.fields, 'basis') === 'DISBURSED_PCT'
    ? ok('payoutRules sanitized + persisted (1 valid rule kept, junk dropped)') : bad('payoutRules state', JSON.stringify(rulesArr.length));

  // 13. Graduate Connector -> Sub DSA: SDSA minted with carried KYC; connector retired.
  const panPatch = await api('PATCH', `/api/crm2/connectors/${id}`, token, { pan: 'ABCDE1234F' });
  panPatch.status === 200 ? ok('PAN stored (encrypted) ahead of graduation') : bad('pan patch', JSON.stringify(panPatch));
  const grad = await api('POST', `/api/crm2/connectors/${id}/graduate-to-subdsa`, token, {});
  grad.status === 200 && grad.data.subDsaId?.startsWith('SDSA-')
    ? ok(`graduated → ${grad.data.subDsaId}`) : bad('graduate', JSON.stringify(grad));
  const sd = await getDoc(`subDsas/${grad.data.subDsaId}`);
  const gradConn = await getDoc(`connectors/${id}`);
  fv(sd, 'panLast4') === '234F' && fv(sd, 'status') === 'ACTIVE'
    && fv(gradConn, 'status') === 'inactive' && fv(gradConn, 'graduatedToSubDsaId') === grad.data.subDsaId
    ? ok('KYC carried (PAN last4), Sub DSA ACTIVE, connector retired + marked') : bad('graduate state', JSON.stringify({ pan: fv(sd, 'panLast4'), cs: fv(gradConn, 'status') }));
  const grad2 = await api('POST', `/api/crm2/connectors/${id}/graduate-to-subdsa`, token, {});
  grad2.status === 409 ? ok('second graduation rejected (409)') : bad('graduate idempotency', JSON.stringify(grad2));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
