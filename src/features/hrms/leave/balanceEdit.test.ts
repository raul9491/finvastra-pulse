import { describe, it, expect } from 'vitest';
import { applyBalanceEdits, emptyBalance, type BalanceEditRow } from './balanceEdit';
import type { LeaveBalance } from '../../../types';

/**
 * /leave_balances has been the most bug-prone area of HRMS (four correctness
 * fixes in June 2026, one more in July). The admin balance editor's arithmetic
 * was inline in a modal and untested until it was extracted (2026-07-23). These
 * lock in CURRENT behaviour as a regression net.
 */

const bal = (over: Partial<LeaveBalance> = {}): LeaveBalance => ({
  employeeId: 'u1',
  year: 2026,
  casual: { total: 8, used: 3, remaining: 5 },
  sick:   { total: 7, used: 0, remaining: 7 },
  earned: { total: 15, used: 10, remaining: 5 },
  ...over,
} as LeaveBalance);

const row = (type: BalanceEditRow['type'], newTotal: string): BalanceEditRow => ({ type, newTotal });

describe('applyBalanceEdits', () => {
  it('recomputes remaining as total - used', () => {
    const { updated } = applyBalanceEdits(bal(), [row('casual', '12')], 2026);
    expect(updated.casual).toEqual({ total: 12, used: 3, remaining: 9 });
  });

  it('NEVER touches `used` — it is derived from approved leave, not editable here', () => {
    const { updated } = applyBalanceEdits(bal(), [row('earned', '30')], 2026);
    expect(updated.earned.used).toBe(10);
  });

  it('clamps remaining at 0 when the new total is below what is already used', () => {
    // 10 days already taken, admin sets the total to 4 → 0 left, never -6
    const { updated } = applyBalanceEdits(bal(), [row('earned', '4')], 2026);
    expect(updated.earned).toEqual({ total: 4, used: 10, remaining: 0 });
  });

  it('reports an adjustment only for types that actually changed', () => {
    const { adjustments } = applyBalanceEdits(
      bal(), [row('casual', '8'), row('sick', '10')], 2026,
    );
    expect(adjustments).toEqual([{ type: 'sick', oldTotal: 7, newTotal: 10, delta: 3 }]);
  });

  it('returns no adjustments when nothing changed — the caller then skips the write', () => {
    const { adjustments } = applyBalanceEdits(bal(), [row('casual', '8')], 2026);
    expect(adjustments).toHaveLength(0);
  });

  it('records a negative delta when a total is reduced', () => {
    const { adjustments } = applyBalanceEdits(bal(), [row('casual', '5')], 2026);
    expect(adjustments[0]).toEqual({ type: 'casual', oldTotal: 8, newTotal: 5, delta: -3 });
  });

  it('handles a PARTIAL balance doc — a type absent from it starts at all-zero', () => {
    // Real case: a comp-off grant creates a doc carrying only comp_off.
    const partial = { employeeId: 'u1', year: 2026, comp_off: { total: 2, used: 0, remaining: 2 } } as unknown as LeaveBalance;
    const { updated, adjustments } = applyBalanceEdits(partial, [row('casual', '8')], 2026);
    expect(updated.casual).toEqual({ total: 8, used: 0, remaining: 8 });
    expect(adjustments[0]).toEqual({ type: 'casual', oldTotal: 0, newTotal: 8, delta: 8 });
  });

  it('ignores a blank or non-numeric row rather than zeroing the type', () => {
    const { updated, adjustments } = applyBalanceEdits(bal(), [row('casual', '')], 2026);
    expect(updated.casual).toEqual({ total: 8, used: 3, remaining: 5 });
    expect(adjustments).toHaveLength(0);
  });

  it('stamps the year being edited', () => {
    expect(applyBalanceEdits(bal({ year: 2025 }), [], 2026).updated.year).toBe(2026);
  });

  it('applies several types in one save', () => {
    const { updated, adjustments } = applyBalanceEdits(
      bal(), [row('casual', '10'), row('sick', '9'), row('earned', '20')], 2026,
    );
    expect(updated.casual.remaining).toBe(7);
    expect(updated.sick.remaining).toBe(9);
    expect(updated.earned.remaining).toBe(10);
    expect(adjustments.map((a) => a.type)).toEqual(['casual', 'sick', 'earned']);
  });
});

describe('emptyBalance', () => {
  it('starts every tracked type at zero', () => {
    const b = emptyBalance('u9', 2026);
    expect(b.employeeId).toBe('u9');
    expect(b.year).toBe(2026);
    for (const t of ['casual', 'sick', 'earned'] as const) {
      expect(b[t]).toEqual({ total: 0, used: 0, remaining: 0 });
    }
  });
});
