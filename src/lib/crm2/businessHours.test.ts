import { describe, it, expect } from 'vitest';
import { elapsedWorkingMs, addWorkingMs, isWorkingDay, DEFAULT_BUSINESS_HOURS } from './businessHours';

// UTC instant for a given IST wall-clock time (IST = UTC+5:30, no DST).
const ist = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  Date.UTC(y, mo - 1, d, h, mi) - 330 * 60_000;

const MIN = 60_000;
const HOUR = 3_600_000;
const FULL_DAY = (18 * 60 + 30 - 10 * 60) * MIN; // 10:00–18:30 = 8h30 = 30,600,000

// Reference 2026 dates (IST): 06-15 Mon · 06-06 1st Sat(off) · 06-13 2nd Sat(off)
//   06-20 3rd Sat(work) · 06-27 4th Sat(work) · 06-07 Sun(off)

describe('isWorkingDay', () => {
  const mid = (y: number, mo: number, d: number) => Date.UTC(y, mo - 1, d, 0, 0); // local-midnight wall
  it('Mon–Fri are working', () => {
    expect(isWorkingDay(mid(2026, 6, 15), DEFAULT_BUSINESS_HOURS)).toBe(true); // Mon
    expect(isWorkingDay(mid(2026, 6, 19), DEFAULT_BUSINESS_HOURS)).toBe(true); // Fri
  });
  it('Sunday is off', () => {
    expect(isWorkingDay(mid(2026, 6, 7), DEFAULT_BUSINESS_HOURS)).toBe(false);
  });
  it('1st & 2nd Saturdays off; 3rd/4th/5th working', () => {
    expect(isWorkingDay(mid(2026, 6, 6), DEFAULT_BUSINESS_HOURS)).toBe(false);  // 1st Sat
    expect(isWorkingDay(mid(2026, 6, 13), DEFAULT_BUSINESS_HOURS)).toBe(false); // 2nd Sat
    expect(isWorkingDay(mid(2026, 6, 20), DEFAULT_BUSINESS_HOURS)).toBe(true);  // 3rd Sat
    expect(isWorkingDay(mid(2026, 6, 27), DEFAULT_BUSINESS_HOURS)).toBe(true);  // 4th Sat
  });
});

describe('elapsedWorkingMs', () => {
  it('counts a simple within-window span', () => {
    expect(elapsedWorkingMs(ist(2026, 6, 15, 10, 0), ist(2026, 6, 15, 11, 0))).toBe(HOUR);
  });

  it('a full working day is 8h30', () => {
    expect(elapsedWorkingMs(ist(2026, 6, 15, 10, 0), ist(2026, 6, 15, 18, 30))).toBe(FULL_DAY);
  });

  it('clamps the 10:00 open boundary', () => {
    // 09:00 → 10:30 counts only 10:00–10:30 = 30 min
    expect(elapsedWorkingMs(ist(2026, 6, 15, 9, 0), ist(2026, 6, 15, 10, 30))).toBe(30 * MIN);
    // starting exactly at 10:00 counts from the open
    expect(elapsedWorkingMs(ist(2026, 6, 15, 10, 0), ist(2026, 6, 15, 10, 15))).toBe(15 * MIN);
  });

  it('clamps the 18:30 close boundary', () => {
    // 18:00 → 19:00 counts only 18:00–18:30 = 30 min
    expect(elapsedWorkingMs(ist(2026, 6, 15, 18, 0), ist(2026, 6, 15, 19, 0))).toBe(30 * MIN);
  });

  it('skips the overnight gap', () => {
    // Mon 18:00 → Tue 10:30 = 30 min (Mon) + 30 min (Tue) = 1h
    expect(elapsedWorkingMs(ist(2026, 6, 15, 18, 0), ist(2026, 6, 16, 10, 30))).toBe(HOUR);
  });

  it('does not count Sundays', () => {
    expect(elapsedWorkingMs(ist(2026, 6, 7, 10, 0), ist(2026, 6, 7, 18, 0))).toBe(0);
  });

  it('does not count 1st/2nd Saturdays but counts the 3rd', () => {
    expect(elapsedWorkingMs(ist(2026, 6, 6, 10, 0), ist(2026, 6, 6, 18, 0))).toBe(0);   // 1st Sat
    expect(elapsedWorkingMs(ist(2026, 6, 13, 10, 0), ist(2026, 6, 13, 18, 0))).toBe(0); // 2nd Sat
    expect(elapsedWorkingMs(ist(2026, 6, 20, 10, 0), ist(2026, 6, 20, 11, 0))).toBe(HOUR); // 3rd Sat
  });

  it('pauses across an off-weekend (Fri after-hours → Mon open)', () => {
    // Fri 06-05 20:00 → Mon 06-08 10:30: Fri after 18:30 (0) + 1st Sat off + Sun off + Mon 10:00–10:30
    expect(elapsedWorkingMs(ist(2026, 6, 5, 20, 0), ist(2026, 6, 8, 10, 30))).toBe(30 * MIN);
  });

  it('a lead arriving after 18:30 accrues nothing until the next open', () => {
    // arrives Mon 19:00; "now" is Mon 23:00 → still 0 working-ms
    expect(elapsedWorkingMs(ist(2026, 6, 15, 19, 0), ist(2026, 6, 15, 23, 0))).toBe(0);
    // …and Tue 10:15 → 15 min
    expect(elapsedWorkingMs(ist(2026, 6, 15, 19, 0), ist(2026, 6, 16, 10, 15))).toBe(15 * MIN);
  });

  it('returns 0 for end<=start', () => {
    expect(elapsedWorkingMs(ist(2026, 6, 15, 12, 0), ist(2026, 6, 15, 12, 0))).toBe(0);
    expect(elapsedWorkingMs(ist(2026, 6, 15, 12, 0), ist(2026, 6, 15, 11, 0))).toBe(0);
  });
});

describe('addWorkingMs', () => {
  it('30 working-min from Mon 10:00 = Mon 10:30', () => {
    expect(addWorkingMs(ist(2026, 6, 15, 10, 0), 30 * MIN)).toBe(ist(2026, 6, 15, 10, 30));
  });
  it('rolls a budget across the overnight gap', () => {
    // Mon 18:00 + 60 working-min = Tue 10:30 (30 min Mon tail + 30 min Tue)
    expect(addWorkingMs(ist(2026, 6, 15, 18, 0), 60 * MIN)).toBe(ist(2026, 6, 16, 10, 30));
  });
});
