import { describe, it, expect } from 'vitest';
import { isWorkingDay, workingDaysInMonth } from './workingDays';

/**
 * Finvastra works Mon–SATURDAY. date-fns `isWeekend()` does not, which is how two
 * screens drifted from the leave system's rule (see workingDays.ts). These tests
 * pin the rule down so it cannot drift again.
 */

describe('isWorkingDay', () => {
  it('counts SATURDAY as a working day — the whole point', () => {
    expect(isWorkingDay(new Date(2026, 6, 25))).toBe(true);   // Sat 25 Jul 2026
  });
  it('excludes Sunday, and only Sunday', () => {
    expect(isWorkingDay(new Date(2026, 6, 26))).toBe(false);  // Sun 26 Jul 2026
    for (let d = 20; d <= 25; d++) {                          // Mon 20 .. Sat 25
      expect(isWorkingDay(new Date(2026, 6, d))).toBe(true);
    }
  });
});

describe('workingDaysInMonth', () => {
  it('counts every day except Sundays', () => {
    // July 2026: 31 days, Sundays fall on 5, 12, 19, 26 → 4 Sundays → 27 working days
    expect(workingDaysInMonth(2026, 7)).toBe(27);
  });

  it('is HIGHER than a Mon–Fri count — the bug this replaces', () => {
    // A Mon–Fri month would have been 23 for July 2026; Saturdays add 4.
    expect(workingDaysInMonth(2026, 7)).toBeGreaterThan(23);
  });

  it('subtracts holidays', () => {
    const base = workingDaysInMonth(2026, 7);
    expect(workingDaysInMonth(2026, 7, ['2026-07-20', '2026-07-21'])).toBe(base - 2);
  });

  it('ignores a holiday that falls on a Sunday — it was never counted', () => {
    const base = workingDaysInMonth(2026, 7);
    expect(workingDaysInMonth(2026, 7, ['2026-07-26'])).toBe(base);   // 26 Jul is a Sunday
  });

  it('counts a SATURDAY holiday as removed — it would otherwise be a working day', () => {
    const base = workingDaysInMonth(2026, 7);
    expect(workingDaysInMonth(2026, 7, ['2026-07-25'])).toBe(base - 1);  // 25 Jul is a Saturday
  });

  it('handles February in a leap year', () => {
    // Feb 2028: 29 days; Sundays on 6, 13, 20, 27 → 4 → 25 working days
    expect(workingDaysInMonth(2028, 2)).toBe(25);
  });

  it('takes a 1-based month (January = 1)', () => {
    expect(workingDaysInMonth(2026, 1)).toBeGreaterThan(0);
    // Jan 2026 has 31 days with 4 Sundays (4, 11, 18, 25) → 27
    expect(workingDaysInMonth(2026, 1)).toBe(27);
  });
});
