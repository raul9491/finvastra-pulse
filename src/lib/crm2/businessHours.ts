/**
 * Working-time arithmetic for the two-stage lead SLA — pure, unit-tested.
 *
 * SLA clocks count ONLY time inside working windows on working days; wall-clock
 * time at night / on off-days does not count. India has no DST, so IST is a fixed
 * +5:30 offset and we can do all wall-clock maths with plain millisecond shifts
 * (no timezone library needed).
 *
 * Supersedes the dead, calendar-only `computeSlaDeadline` in slaUtils.ts.
 */

export interface BusinessHoursConfig {
  /** Fixed offset of the business timezone from UTC, in minutes (IST = 330). */
  tzOffsetMinutes: number;
  /** Daily window start, minutes past midnight in local time (10:00 → 600). */
  startMinutes: number;
  /** Daily window end, minutes past midnight in local time (18:30 → 1110). */
  endMinutes: number;
  /** Local day-of-week values that are working days (0=Sun … 6=Sat). */
  workingDows: number[];
  /** Ordinal Saturdays of the month that are OFF (1st & 2nd Sat → [1, 2]). */
  offSaturdayOrdinals: number[];
}

/** Finvastra default: IST, 10:00–18:30, Mon–Sat, 1st & 2nd Saturdays off, Sun off. */
export const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  tzOffsetMinutes: 330,
  startMinutes: 10 * 60,        // 10:00
  endMinutes: 18 * 60 + 30,     // 18:30
  workingDows: [1, 2, 3, 4, 5, 6],   // Mon–Sat (Sun excluded)
  offSaturdayOrdinals: [1, 2],
};

const DAY_MS = 86_400_000;

/** Is the local calendar day containing `localMidnightMs` a working day? */
export function isWorkingDay(localMidnightMs: number, cfg: BusinessHoursConfig): boolean {
  const d = new Date(localMidnightMs);          // read with UTC getters — already shifted
  const dow = d.getUTCDay();
  if (!cfg.workingDows.includes(dow)) return false;
  if (dow === 6) {
    const dayOfMonth = d.getUTCDate();
    const ordinal = Math.floor((dayOfMonth - 1) / 7) + 1;   // 1st, 2nd, 3rd… Saturday
    if (cfg.offSaturdayOrdinals.includes(ordinal)) return false;
  }
  return true;
}

/**
 * Milliseconds of WORKING time between two UTC instants. Counts only the parts of
 * [startMs, endMs] that fall inside the daily working window on working days.
 */
export function elapsedWorkingMs(
  startMs: number,
  endMs: number,
  cfg: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS,
): number {
  if (!(endMs > startMs)) return 0;
  const shift = cfg.tzOffsetMinutes * 60_000;

  // UTC instant of local midnight for the day containing startMs.
  const localMidnightWall = Math.floor((startMs + shift) / DAY_MS) * DAY_MS;
  let dayStartUtc = localMidnightWall - shift;   // UTC instant of local 00:00

  let total = 0;
  // Walk day by day until the window opening is past endMs.
  while (dayStartUtc < endMs) {
    const localMidnightMs = dayStartUtc + shift;   // local wall-clock midnight (UTC-read)
    if (isWorkingDay(localMidnightMs, cfg)) {
      const winStart = dayStartUtc + cfg.startMinutes * 60_000;
      const winEnd = dayStartUtc + cfg.endMinutes * 60_000;
      const lo = Math.max(startMs, winStart);
      const hi = Math.min(endMs, winEnd);
      if (hi > lo) total += hi - lo;
    }
    dayStartUtc += DAY_MS;   // exact 24h step — IST has no DST
  }
  return total;
}

/**
 * The UTC instant when `workingMs` of working time will have elapsed starting from
 * `startMs` — i.e. an SLA deadline expressed as a working-time budget. (Handy for
 * surfacing a countdown; the sweep itself uses elapsedWorkingMs comparisons.)
 */
export function addWorkingMs(
  startMs: number,
  workingMs: number,
  cfg: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS,
): number {
  if (workingMs <= 0) return startMs;
  const shift = cfg.tzOffsetMinutes * 60_000;
  let remaining = workingMs;
  const localMidnightWall = Math.floor((startMs + shift) / DAY_MS) * DAY_MS;
  let dayStartUtc = localMidnightWall - shift;

  // Cap the walk so a misconfigured (no working days) call can't loop forever.
  for (let guard = 0; guard < 3650 && remaining > 0; guard++) {
    const localMidnightMs = dayStartUtc + shift;
    if (isWorkingDay(localMidnightMs, cfg)) {
      const winStart = dayStartUtc + cfg.startMinutes * 60_000;
      const winEnd = dayStartUtc + cfg.endMinutes * 60_000;
      const from = Math.max(startMs, winStart);
      if (winEnd > from) {
        const avail = winEnd - from;
        if (remaining <= avail) return from + remaining;
        remaining -= avail;
      }
    }
    dayStartUtc += DAY_MS;
  }
  return dayStartUtc;   // budget never consumed (degenerate config) — far-future instant
}
