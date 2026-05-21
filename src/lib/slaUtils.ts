import type { LeadSource } from '../types';

/**
 * Compute the SLA deadline for a new lead.
 * Phase 2.5a: calendar hours only — working-day skipping deferred to Phase 2.5b.
 *
 * Sources and their SLA windows:
 *  - offline_bulk       → 24 calendar hours
 *  - social_meta        → 30 minutes (placeholder, real-time intake in Phase 2.5b)
 *  - website            → 30 minutes (placeholder, webhook intake in Phase 2.5b)
 *  - all other sources  → 24 calendar hours (manual entries, walk-ins, referrals)
 */
export function computeSlaDeadline(source: LeadSource, createdAt: Date): Date {
  const deadline = new Date(createdAt);
  if (source === 'social_meta' || source === 'website') {
    deadline.setMinutes(deadline.getMinutes() + 30);
  } else {
    deadline.setHours(deadline.getHours() + 24);
  }
  return deadline;
}

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
