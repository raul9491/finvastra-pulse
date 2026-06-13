import { describe, it, expect } from 'vitest';
import {
  validateTransition, gateForStage, gatePddClear,
  computeDocsCompletePct, allLoginDocsVerified, keyDateForStage,
  type TrackerRowLite,
} from './stages';

const row = (p: Partial<TrackerRowLite> & { rowId: string }): TrackerRowLite => ({
  documentDefId: 'DOC-001', applicantId: null,
  requiredByStage: 'LOGIN', status: 'PENDING', ...p,
});

describe('validateTransition', () => {
  it('allows forward-by-one along the pipeline', () => {
    expect(validateTransition('OPENED', 'ELIGIBILITY').ok).toBe(true);
    expect(validateTransition('SANCTIONED', 'DISBURSED').ok).toBe(false); // disburse endpoint only
    expect(validateTransition('DISBURSED', 'PDD_OTC').ok).toBe(true);
  });
  it('rejects skipping stages', () => {
    const r = validateTransition('OPENED', 'LOGIN');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/next stage is ELIGIBILITY/);
  });
  it('rejects backward moves', () => {
    expect(validateTransition('LOGIN', 'DOC_COLLECTION').ok).toBe(false);
  });
  it('DISBURSED is unreachable via the generic endpoint', () => {
    const r = validateTransition('SANCTIONED', 'DISBURSED');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/disburse endpoint/);
  });
  it('early CLOSED requires REJECTED/WITHDRAWN outcome', () => {
    expect(validateTransition('UNDER_PROCESS', 'CLOSED').ok).toBe(false);
    expect(validateTransition('UNDER_PROCESS', 'CLOSED', 'REJECTED').ok).toBe(true);
    expect(validateTransition('LOGIN', 'CLOSED', 'WITHDRAWN').ok).toBe(true);
  });
  it('PDD_OTC → CLOSED is the natural completion (no outcome needed)', () => {
    expect(validateTransition('PDD_OTC', 'CLOSED').ok).toBe(true);
  });
  it('CLOSED is terminal', () => {
    expect(validateTransition('CLOSED', 'OPENED').ok).toBe(false);
  });
});

describe('gateForStage (LOGIN doc gating)', () => {
  const rows = [
    row({ rowId: 'a', status: 'VERIFIED' }),
    row({ rowId: 'b', status: 'RECEIVED' }),
    row({ rowId: 'c', requiredByStage: 'PDD', status: 'PENDING' }),  // not LOGIN — ignored
  ];
  it('blocks LOGIN while any mandatory LOGIN row is not VERIFIED, returning the pending list', () => {
    const r = gateForStage('LOGIN', rows);
    expect(r.ok).toBe(false);
    expect(r.pendingDocs?.map((d) => d.rowId)).toEqual(['b']);
  });
  it('passes when every LOGIN row is VERIFIED', () => {
    expect(gateForStage('LOGIN', [row({ rowId: 'a', status: 'VERIFIED' })]).ok).toBe(true);
  });
  it('does not gate other stages', () => {
    expect(gateForStage('ELIGIBILITY', rows).ok).toBe(true);
    expect(gateForStage('SANCTIONED', rows).ok).toBe(true);
  });
});

describe('gatePddClear', () => {
  it('blocks CLEARED with pending PDD rows', () => {
    const r = gatePddClear([row({ rowId: 'p', requiredByStage: 'PDD', status: 'RECEIVED' })]);
    expect(r.ok).toBe(false);
    expect(r.pendingDocs).toHaveLength(1);
  });
  it('passes when PDD rows are all VERIFIED (or none exist)', () => {
    expect(gatePddClear([row({ rowId: 'p', requiredByStage: 'PDD', status: 'VERIFIED' })]).ok).toBe(true);
    expect(gatePddClear([]).ok).toBe(true);
  });
});

describe('computeDocsCompletePct / allLoginDocsVerified / keyDateForStage', () => {
  it('computes the verified percentage', () => {
    expect(computeDocsCompletePct([
      row({ rowId: 'a', status: 'VERIFIED' }),
      row({ rowId: 'b', status: 'VERIFIED' }),
      row({ rowId: 'c', status: 'PENDING' }),
      row({ rowId: 'd', status: 'REJECTED_REUPLOAD' }),
    ])).toBe(50);
    expect(computeDocsCompletePct([])).toBe(100);
  });
  it('allLoginDocsVerified needs at least one LOGIN row, all VERIFIED', () => {
    expect(allLoginDocsVerified([row({ rowId: 'a', status: 'VERIFIED' })])).toBe(true);
    expect(allLoginDocsVerified([row({ rowId: 'a', status: 'VERIFIED' }), row({ rowId: 'b' })])).toBe(false);
    expect(allLoginDocsVerified([])).toBe(false);
  });
  it('stamps the right keyDate per stage', () => {
    expect(keyDateForStage('LOGIN')).toBe('login');
    expect(keyDateForStage('SANCTIONED')).toBe('sanction');
    expect(keyDateForStage('CLOSED')).toBe('closed');
    expect(keyDateForStage('ELIGIBILITY')).toBeNull();
  });
});
