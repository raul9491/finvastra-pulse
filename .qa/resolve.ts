import { resolvePageKey, SHAREABLE_PAGES } from '../src/config/shareablePages';
const cases: [string, string, string|null][] = [
  ['/crm/dashboard', '', 'crm.dashboard'],
  ['/crm/dashboard/', '', 'crm.dashboard'],
  ['/mis/overview', '', 'mis.overview'],
  ['/mis/overview', '?tab=disbursals', 'mis.disbursals'],
  ['/mis/disputes', '', 'mis.disputes'],
  ['/crm/leads', '', 'crm.leads'],
  ['/crm/leads/abc123', '', null],
  ['/hrms/admin/compliance', '', 'hrms.compliance'],
  ['/unknown', '', null],
];
let fail = 0;
for (const [p, s, want] of cases) {
  const got = resolvePageKey(p, s);
  if (got !== want) { console.log('FAIL', p, s, '→', got, 'wanted', want); fail++; }
}
console.log(fail === 0 ? `OK — all ${cases.length} resolvePageKey cases pass (${Object.keys(SHAREABLE_PAGES).length} pages)` : `${fail} FAILURES`);
