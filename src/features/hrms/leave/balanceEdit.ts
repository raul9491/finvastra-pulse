import type { LeaveBalance } from '../../../types';

/**
 * The arithmetic behind an admin editing an employee's leave-balance TOTALS.
 *
 * Extracted from AdminLeavePage.tsx (2026-07-23). It was inline in a modal's save
 * handler, so it had no tests — despite `/leave_balances` being the single most
 * bug-prone thing in HRMS this year (four correctness fixes in June: approve
 * seeding `total: 0`, cancel not refunding, partial docs crashing readers, and the
 * calendar-vs-financial-year split; then the July fix keying the balance by the
 * LEAVE's financial year rather than the click date).
 *
 * The rules encoded here, unchanged:
 *   - an admin edits TOTAL only; `used` is never touched (it is derived from
 *     approved leave, so overwriting it here would silently rewrite history)
 *   - remaining = max(0, newTotal - used) — a total set below what is already
 *     used clamps to 0 rather than going negative
 *   - a type missing from the existing doc is treated as all-zero (partial
 *     balance docs are real: a comp-off grant creates a doc with only comp_off)
 *   - only CHANGED types produce an adjustment record, so a no-op save writes
 *     nothing
 */
export type LeaveTypeEditable = 'casual' | 'sick' | 'earned' | 'comp_off';

export interface BalanceEditRow {
  type: LeaveTypeEditable;
  newTotal: string;          // straight off the form input
}

export interface BalanceAdjustment {
  type: string;
  oldTotal: number;
  newTotal: number;
  delta: number;
}

const ZERO = { total: 0, used: 0, remaining: 0 };

/**
 * Apply the edited totals to an existing balance doc.
 * Returns the doc to write plus one adjustment per CHANGED type (empty when
 * nothing changed — the caller skips the write entirely in that case).
 */
export function applyBalanceEdits(
  existing: LeaveBalance,
  rows: BalanceEditRow[],
  yearNum: number,
): { updated: LeaveBalance; adjustments: BalanceAdjustment[] } {
  const updated: LeaveBalance = { ...existing, year: yearNum };
  const adjustments: BalanceAdjustment[] = [];

  for (const r of rows) {
    const newTotalNum = parseInt(r.newTotal, 10);
    if (Number.isNaN(newTotalNum)) continue;      // blank/invalid row — leave untouched

    const slot = existing[r.type] ?? ZERO;
    const used = slot.used;
    updated[r.type] = {
      total: newTotalNum,
      used,                                        // NEVER recomputed here
      remaining: Math.max(0, newTotalNum - used),  // clamp, never negative
    };
    if (newTotalNum !== slot.total) {
      adjustments.push({
        type: r.type,
        oldTotal: slot.total,
        newTotal: newTotalNum,
        delta: newTotalNum - slot.total,
      });
    }
  }

  return { updated, adjustments };
}

/** A blank balance doc — used when an employee has no row for the year yet. */
export function emptyBalance(employeeId: string, yearNum: number): LeaveBalance {
  return {
    employeeId,
    year: yearNum,
    casual: { ...ZERO },
    sick:   { ...ZERO },
    earned: { ...ZERO },
  } as LeaveBalance;
}
