import { describe, it, expect } from 'vitest';
import { matchDumpRow, computeSnapshot, type DumpRow, type MisLite, type CycleLite } from './recon';

const D = (s: string) => new Date(`${s}T00:00:00`).getTime();
const mis = (p: Partial<MisLite> & { caseId: string }): MisLite => ({
  loanAccountNo: null, bankApplicationNo: null, dsaCode: 'DSA1',
  disbursedAmount: 5000000, disbursementDateMs: D('2026-05-12'), ...p,
});
const row = (p: Partial<DumpRow>): DumpRow => ({
  rowIndex: 1, loanAccountNo: null, bankApplicationNo: null, dsaCode: null, amount: null, dateMs: null, ...p,
});

describe('matchDumpRow — tiered matching', () => {
  const book = [
    mis({ caseId: 'FIN-CASE-2026-0001', loanAccountNo: 'FEDHY001', bankApplicationNo: '639799', dsaCode: 'DSA1', disbursedAmount: 5000000, disbursementDateMs: D('2026-05-12') }),
    mis({ caseId: 'FIN-CASE-2026-0002', loanAccountNo: 'FEDHY002', bankApplicationNo: '639800', dsaCode: 'DSA1', disbursedAmount: 3000000, disbursementDateMs: D('2026-05-20') }),
  ];

  it('tier 1: loan account number exact (case-insensitive, trimmed)', () => {
    const r = matchDumpRow(row({ loanAccountNo: ' fedhy001 ', amount: 5000000 }), book);
    expect(r.matchType).toBe('loan');
    expect(r.caseId).toBe('FIN-CASE-2026-0001');
    expect(r.amountVariance).toBe(0);
  });
  it('tier 2: bank application number when no loan match', () => {
    const r = matchDumpRow(row({ bankApplicationNo: '639800', amount: 3000000 }), book);
    expect(r.matchType).toBe('app');
    expect(r.caseId).toBe('FIN-CASE-2026-0002');
  });
  it('loan match takes precedence over app match', () => {
    const r = matchDumpRow(row({ loanAccountNo: 'FEDHY001', bankApplicationNo: '639800' }), book);
    expect(r.matchType).toBe('loan');
    expect(r.caseId).toBe('FIN-CASE-2026-0001');
  });
  it('tier 3 fuzzy: dsaCode + amount ±1% + date ±7d', () => {
    // 1% of 5,000,000 = 50,000; 49,000 within band; 6 days within ±7
    const r = matchDumpRow(row({ dsaCode: 'DSA1', amount: 4951000, dateMs: D('2026-05-18') }), book);
    expect(r.matchType).toBe('fuzzy');
    expect(r.caseId).toBe('FIN-CASE-2026-0001');
    expect(r.amountVariance).toBe(-49000);
  });
  it('fuzzy boundary: exactly 1% and exactly 7 days both match (inclusive)', () => {
    expect(matchDumpRow(row({ dsaCode: 'DSA1', amount: 5050000, dateMs: D('2026-05-19') }), book).matchType).toBe('fuzzy'); // +1%, +7d
    expect(matchDumpRow(row({ dsaCode: 'DSA1', amount: 4950000, dateMs: D('2026-05-05') }), book).matchType).toBe('fuzzy'); // −1%, −7d
  });
  it('fuzzy rejects just outside the bands', () => {
    expect(matchDumpRow(row({ dsaCode: 'DSA1', amount: 5050001, dateMs: D('2026-05-12') }), book).matchType).toBe('none'); // >1%
    expect(matchDumpRow(row({ dsaCode: 'DSA1', amount: 5000000, dateMs: D('2026-05-20') }), book).matchType).toBe('none'); // 8 days
    expect(matchDumpRow(row({ dsaCode: 'OTHER', amount: 5000000, dateMs: D('2026-05-12') }), book).matchType).toBe('none'); // wrong dsa
  });
  it('fuzzy tie broken by smallest amount delta', () => {
    const two = [
      mis({ caseId: 'A', dsaCode: 'DSAX', disbursedAmount: 1000000, disbursementDateMs: D('2026-05-12') }),
      mis({ caseId: 'B', dsaCode: 'DSAX', disbursedAmount: 1005000, disbursementDateMs: D('2026-05-12') }),
    ];
    const r = matchDumpRow(row({ dsaCode: 'DSAX', amount: 1004000, dateMs: D('2026-05-12') }), two);
    expect(r.caseId).toBe('B'); // 1004000 closer to 1005000 than 1000000
  });
  it('no match → none', () => {
    expect(matchDumpRow(row({ loanAccountNo: 'NOPE' }), book).matchType).toBe('none');
  });
});

describe('computeSnapshot — aggregation math', () => {
  const cyc = (p: Partial<CycleLite>): CycleLite => ({
    caseId: 'C', status: 'RECEIVED', disbursedAmount: 5000000, expectedGross: 70000,
    billGross: 70000, receivedNet: 63000, tdsDeducted: 7000, subDsaExpected: 35000,
    subDsaPaidAmount: null, netMarginRealised: 63000, disputeFlag: false,
    bankerConfirmedAt: D('2026-05-15'), confirmationRaisedAt: D('2026-05-13'), ...p,
  });

  it('sums values and counts', () => {
    const s = computeSnapshot([
      cyc({ caseId: 'A' }),
      cyc({ caseId: 'B', disbursedAmount: 3000000, expectedGross: 42000, billGross: null, receivedNet: null, bankerConfirmedAt: null, confirmationRaisedAt: D('2026-05-10') }),
    ], D('2026-05-20'));
    expect(s.casesDisbursedCount).toBe(2);
    expect(s.disbursedValue).toBe(8000000);
    expect(s.expectedGross).toBe(112000);
    expect(s.billed).toBe(70000);          // B had null
    expect(s.received).toBe(63000);
    expect(s.pendingReceivable).toBe(112000 - 63000);
    expect(s.bankerConfirmedCount).toBe(1);
    expect(s.pendingConfirmationCount).toBe(1);
    expect(s.pendingConfirmationAvgAgeingDays).toBe(10); // 2026-05-20 − 2026-05-10
  });
  it('sub-DSA balance = due − paid', () => {
    const s = computeSnapshot([
      cyc({ subDsaExpected: 35000, subDsaPaidAmount: 35000 }),
      cyc({ subDsaExpected: 20000, subDsaPaidAmount: null }),
    ], D('2026-05-20'));
    expect(s.subDsaDue).toBe(55000);
    expect(s.subDsaPaid).toBe(35000);
    expect(s.subDsaBalance).toBe(20000);
  });
  it('collects disputed case ids', () => {
    const s = computeSnapshot([cyc({ caseId: 'X', disputeFlag: true }), cyc({ caseId: 'Y' })], D('2026-05-20'));
    expect(s.disputedCaseIds).toEqual(['X']);
  });
  it('empty period → zeros, null ageing', () => {
    const s = computeSnapshot([], D('2026-05-20'));
    expect(s.casesDisbursedCount).toBe(0);
    expect(s.pendingConfirmationAvgAgeingDays).toBeNull();
  });
});
