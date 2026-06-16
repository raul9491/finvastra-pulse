import { describe, it, expect } from 'vitest';
import {
  validateLoginTransition, keyDateForLoginStage, rollUpCaseStatus,
  caseCanComplete, validateCaseLevelTransition, type LoginLite,
} from './logins';

describe('validateLoginTransition', () => {
  it('allows forward-by-one', () => {
    expect(validateLoginTransition('FILE_LOGIN', 'CODE_LOGIN_DONE').ok).toBe(true);
    expect(validateLoginTransition('IN_PROCESS', 'SANCTIONED').ok).toBe(true);
    expect(validateLoginTransition('PDD_OTC', 'COMPLETED').ok).toBe(true);
  });
  it('rejects skips and backwards', () => {
    expect(validateLoginTransition('FILE_LOGIN', 'IN_PROCESS').ok).toBe(false);
    expect(validateLoginTransition('SANCTIONED', 'IN_PROCESS').ok).toBe(false);
  });
  it('reserves DISBURSED for the disburse endpoint', () => {
    const r = validateLoginTransition('SANCTIONED', 'DISBURSED');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/disburse endpoint/);
  });
  it('allows early COMPLETED only with a REJECTED/WITHDRAWN outcome', () => {
    expect(validateLoginTransition('IN_PROCESS', 'COMPLETED', 'REJECTED').ok).toBe(true);
    expect(validateLoginTransition('SANCTIONED', 'COMPLETED', 'WITHDRAWN').ok).toBe(true);
    expect(validateLoginTransition('IN_PROCESS', 'COMPLETED').ok).toBe(false); // no outcome
  });
  it('blocks transitions out of COMPLETED', () => {
    expect(validateLoginTransition('COMPLETED', 'PDD_OTC').ok).toBe(false);
  });
});

describe('keyDateForLoginStage', () => {
  it('maps stages to their keyDate field', () => {
    expect(keyDateForLoginStage('CODE_LOGIN_DONE')).toBe('codeLoginDone');
    expect(keyDateForLoginStage('SANCTIONED')).toBe('sanction');
    expect(keyDateForLoginStage('COMPLETED')).toBe('completed');
    expect(keyDateForLoginStage('FILE_LOGIN')).toBe(null);
  });
});

describe('rollUpCaseStatus', () => {
  it('reports no logins', () => {
    const r = rollUpCaseStatus([]);
    expect(r.total).toBe(0); expect(r.label).toBe('No logins yet'); expect(r.allDone).toBe(false);
  });
  it('headlines the most-advanced active login', () => {
    const logins: LoginLite[] = [
      { stage: 'IN_PROCESS' }, { stage: 'SANCTIONED' },
    ];
    const r = rollUpCaseStatus(logins);
    expect(r.total).toBe(2); expect(r.active).toBe(2);
    expect(r.label).toBe('In Progress · SANCTIONED');
  });
  it('marks Completed only when every login is COMPLETED', () => {
    const r = rollUpCaseStatus([
      { stage: 'COMPLETED', outcome: 'COMPLETED' },
      { stage: 'COMPLETED', outcome: 'REJECTED' },
    ]);
    expect(r.allDone).toBe(true); expect(r.successful).toBe(1); expect(r.rejected).toBe(1);
    expect(r.label).toBe('Completed');
  });
  it('shows Closed — unsuccessful when all logins rejected', () => {
    const r = rollUpCaseStatus([{ stage: 'COMPLETED', outcome: 'REJECTED' }]);
    expect(r.allDone).toBe(true); expect(r.successful).toBe(0);
    expect(r.label).toBe('Closed — unsuccessful');
  });
});

describe('caseCanComplete / validateCaseLevelTransition', () => {
  it('blocks case completion with open logins', () => {
    expect(caseCanComplete([{ stage: 'IN_PROCESS' }]).ok).toBe(false);
    expect(caseCanComplete([]).ok).toBe(false);
    expect(caseCanComplete([{ stage: 'COMPLETED' }]).ok).toBe(true);
  });
  it('case forward-by-one through 1–3', () => {
    expect(validateCaseLevelTransition('OPENED', 'BASIC_DOCS').ok).toBe(true);
    expect(validateCaseLevelTransition('BASIC_DOCS', 'DOCS').ok).toBe(true);
    expect(validateCaseLevelTransition('DOCS', 'IN_PROGRESS').ok).toBe(true);
    expect(validateCaseLevelTransition('OPENED', 'DOCS').ok).toBe(false);
  });
  it('case COMPLETED needs all logins done; CLOSED needs an outcome', () => {
    expect(validateCaseLevelTransition('IN_PROGRESS', 'COMPLETED', null, [{ stage: 'IN_PROCESS' }]).ok).toBe(false);
    expect(validateCaseLevelTransition('IN_PROGRESS', 'COMPLETED', null, [{ stage: 'COMPLETED' }]).ok).toBe(true);
    expect(validateCaseLevelTransition('DOCS', 'CLOSED', 'REJECTED').ok).toBe(true);
    expect(validateCaseLevelTransition('DOCS', 'CLOSED').ok).toBe(false);
  });
});
