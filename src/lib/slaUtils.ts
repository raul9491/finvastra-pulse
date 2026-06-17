/**
 * SLA status formatting. The deadline *computation* now lives in the working-time
 * engine (src/lib/crm2/sla.ts + businessHours.ts); the old calendar-only
 * computeSlaDeadline() was removed 2026-06-17 (it had no callers).
 */

/**
 * Format a Firestore Timestamp or JS Date as a human-readable SLA status.
 * Returns { label, overdue, hoursLeft }.
 */
export function formatSlaStatus(slaDeadline: { toDate?: () => Date } | Date | null | undefined): {
  label: string;
  overdue: boolean;
  hoursLeft: number;
} | null {
  if (!slaDeadline) return null;
  const deadline = typeof (slaDeadline as { toDate?: () => Date }).toDate === 'function'
    ? (slaDeadline as { toDate: () => Date }).toDate()
    : slaDeadline as Date;

  const now = new Date();
  const diffMs = deadline.getTime() - now.getTime();
  const diffH  = diffMs / (1000 * 60 * 60);
  const overdue = diffH < 0;
  const absH   = Math.abs(diffH);

  let label: string;
  if (absH < 1) {
    const mins = Math.round(Math.abs(diffMs) / 60000);
    label = overdue ? `Overdue by ${mins}m` : `${mins}m remaining`;
  } else {
    const hrs = Math.floor(absH);
    const mins = Math.round((absH - hrs) * 60);
    const hStr = hrs > 0 ? `${hrs}h` : '';
    const mStr = mins > 0 ? ` ${mins}m` : '';
    label = overdue ? `Overdue by ${hStr}${mStr}`.trim() : `${hStr}${mStr} remaining`.trim();
  }

  return { label, overdue, hoursLeft: diffH };
}
