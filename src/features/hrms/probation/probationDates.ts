/**
 * Probation countdown.
 * 
 * Extracted from ProbationPage.tsx (2026-07-23) so it can be unit-tested. `today`
 * is injectable for exactly that reason - the original read new Date() inline.
 * 
 * The rule that matters: an EXTENDED probation counts down to extensionEndDate,
 * not the original probationEndDate. Getting that precedence wrong would flag an
 * employee whose probation was extended as overdue against a date that no longer
 * applies.
 */
import { differenceInDays, parseISO } from 'date-fns';
import type { ProbationRecord } from '../../../types';


export function daysInfo(record: ProbationRecord, today: Date = new Date()): { days: number; overdue: boolean; label: string } {
  const end = parseISO(record.status === 'extended' && record.extensionEndDate
    ? record.extensionEndDate
    : record.probationEndDate);
  const days = differenceInDays(end, today);
  const overdue = days < 0;
  const label = overdue
    ? `${Math.abs(days)}d overdue`
    : days === 0 ? 'Today' : `${days}d left`;
  return { days, overdue, label };
}
