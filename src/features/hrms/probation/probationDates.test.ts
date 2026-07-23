import { describe, it, expect } from 'vitest';
import { daysInfo } from './probationDates';
import type { ProbationRecord } from '../../../types';

/**
 * `daysInfo` drives the "due soon" filter and the overdue badge on the probation
 * list. It read `new Date()` inline until it was extracted (2026-07-23), which
 * made it untestable. `today` is now injectable.
 */

const rec = (over: Partial<ProbationRecord> = {}): ProbationRecord => ({
  probationEndDate: '2026-08-01',
  status: 'on_probation',
  ...over,
} as ProbationRecord);

const TODAY = new Date('2026-07-23T00:00:00');

describe('daysInfo', () => {
  it('counts days remaining before the end date', () => {
    const r = daysInfo(rec({ probationEndDate: '2026-08-01' }), TODAY);
    expect(r.days).toBe(9);
    expect(r.overdue).toBe(false);
    expect(r.label).toBe('9d left');
  });

  it('says "Today" on the end date itself', () => {
    const r = daysInfo(rec({ probationEndDate: '2026-07-23' }), TODAY);
    expect(r.days).toBe(0);
    expect(r.overdue).toBe(false);
    expect(r.label).toBe('Today');
  });

  it('reports overdue with a positive day count', () => {
    const r = daysInfo(rec({ probationEndDate: '2026-07-13' }), TODAY);
    expect(r.days).toBe(-10);
    expect(r.overdue).toBe(true);
    expect(r.label).toBe('10d overdue');   // never "-10d"
  });

  it('an EXTENDED probation counts down to the EXTENSION end date', () => {
    // The rule that matters: without this the employee would be measured against
    // the original date and flagged overdue when they are not.
    const r = daysInfo(rec({
      status: 'extended',
      probationEndDate: '2026-07-01',      // already passed
      extensionEndDate: '2026-09-01',      // the one that applies
    }), TODAY);
    expect(r.overdue).toBe(false);
    expect(r.days).toBe(40);
  });

  it('falls back to the original end date when extended WITHOUT an extension date', () => {
    const r = daysInfo(rec({ status: 'extended', probationEndDate: '2026-07-13' }), TODAY);
    expect(r.overdue).toBe(true);
  });

  it('ignores extensionEndDate when the status is not extended', () => {
    const r = daysInfo(rec({
      status: 'on_probation',
      probationEndDate: '2026-07-13',
      extensionEndDate: '2026-12-01',
    }), TODAY);
    expect(r.overdue).toBe(true);
  });
});
