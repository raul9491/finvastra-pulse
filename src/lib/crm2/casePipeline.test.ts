import { describe, it, expect } from 'vitest';
import { activeCasePipelineStage, CASE_PIPELINE } from '../../types/crm2';

describe('CASE_PIPELINE', () => {
  it('has the 10 spec stages in order', () => {
    expect(CASE_PIPELINE.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(CASE_PIPELINE[0].label).toBe('Opened');
    expect(CASE_PIPELINE[9].label).toBe('Case Completed');
    // stages 4–9 are per-login, 1–3 + 10 are case-level
    expect(CASE_PIPELINE.filter((s) => s.level === 'login').map((s) => s.n)).toEqual([4, 5, 6, 7, 8, 9]);
  });
});

describe('activeCasePipelineStage', () => {
  it('maps the case-level stages directly', () => {
    expect(activeCasePipelineStage('OPENED', [])).toBe(1);
    expect(activeCasePipelineStage('BASIC_DOCS', [])).toBe(2);
    expect(activeCasePipelineStage('DOCS', [])).toBe(3);
    expect(activeCasePipelineStage('COMPLETED', [])).toBe(10);
    expect(activeCasePipelineStage('CLOSED', [])).toBe(10);
  });
  it('IN_PROGRESS with no logins yet sits at stage 4 (File Login)', () => {
    expect(activeCasePipelineStage('IN_PROGRESS', [])).toBe(4);
  });
  it('IN_PROGRESS points at the earliest-active login (the bottleneck)', () => {
    // login 1 sanctioned (7), login 2 still in process (6) → show 6
    expect(activeCasePipelineStage('IN_PROGRESS', ['SANCTIONED', 'IN_PROCESS'])).toBe(6);
    expect(activeCasePipelineStage('IN_PROCESS' as string, ['DISBURSED', 'PDD_OTC'])).toBe(8);
  });
  it('ignores completed logins unless all are completed', () => {
    expect(activeCasePipelineStage('IN_PROGRESS', ['COMPLETED', 'SANCTIONED'])).toBe(7);
    expect(activeCasePipelineStage('IN_PROGRESS', ['COMPLETED', 'COMPLETED'])).toBe(9);
  });
});
