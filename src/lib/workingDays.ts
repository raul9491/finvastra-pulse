import { startOfMonth, endOfMonth, eachDayOfInterval, format } from 'date-fns';

/**
 * The Finvastra work week: **Monday to SATURDAY**. Only Sunday is off.
 *
 * This exists because date-fns `isWeekend()` treats Saturday as a weekend, and
 * two HRMS screens were using it — which silently contradicted the rule the leave
 * system has enforced since Phase F (`calculateWorkingDays` in hooks/useLeave.ts
 * uses `d.getDay() !== 0`). The two real consequences, both fixed 2026-07-23:
 *
 *   - the dashboard's monthly working-days figure was ~4 days SHORT, so the
 *     "present / working days" attendance stat was measured against the wrong
 *     denominator
 *   - on the attendance calendar, `isPastWorkDay` excluded Saturdays, so an
 *     employee absent on a Saturday could NOT raise a regularization request
 *
 * The rule here matches hooks/useLeave.ts exactly. That hook is DO-NOT-TOUCH, so
 * it keeps its own copy and remains the reference; this module is what every
 * other surface should use.
 *
 * NOT to be confused with `src/lib/crm2/businessHours.ts`, which encodes a
 * DIFFERENT rule for a different purpose: CRM SLA working-time, where the 1st and
 * 2nd Saturdays of the month are off. HRMS attendance/leave has no such carve-out.
 */

/** True when `d` is a Finvastra working day — any day except Sunday. */
export function isWorkingDay(d: Date): boolean {
  return d.getDay() !== 0;
}

/**
 * Working days in a calendar month, excluding Sundays and any holiday dates.
 * @param month 1-based (January = 1), matching how call sites read it.
 * @param holidays `yyyy-MM-dd` strings.
 */
export function workingDaysInMonth(year: number, month: number, holidays: string[] = []): number {
  const start = startOfMonth(new Date(year, month - 1));
  const holidaySet = new Set(holidays);
  return eachDayOfInterval({ start, end: endOfMonth(start) })
    .filter((d) => isWorkingDay(d) && !holidaySet.has(format(d, 'yyyy-MM-dd')))
    .length;
}
