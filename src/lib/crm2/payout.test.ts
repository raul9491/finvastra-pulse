import { describe, it, expect } from 'vitest';
import {
  deriveCycleStatus, computeAgeing, computeBankerMismatch, computePctVariance,
  computeAmountVariance, computeNetMarginRealised, canClose, validateMilestoneOrder,
  type CycleStatusInput,
} from './payout';

const D = (s: string) => new Date(`${s}T00:00:00`).getTime();

// All-empty baseline; tests flip one field at a time to prove precedence.
const base: CycleStatusInput = {
  disputeFlag: false, closedAt: null, subDsaPaidAt: null, receivedAt: null,
  billSentAt: null, billDate: null, payoutConfirmedAt: null, holdFlag: false,
  bankerConfirmedAt: null, confirmationRaisedAt: null,
};

describe('deriveCycleStatus — full precedence chain', () => {
  it('empty → AWAITING_DATA_SHARE', () => {
    expect(deriveCycleStatus(base)).toBe('AWAITING_DATA_SHARE');
  });
  it('each rung in isolation', () => {
    expect(deriveCycleStatus({ ...base, confirmationRaisedAt: 1 })).toBe('CONFIRMATION_RAISED');
    expect(deriveCycleStatus({ ...base, bankerConfirmedAt: 1 })).toBe('BANKER_CONFIRMED');
    expect(deriveCycleStatus({ ...base, holdFlag: true })).toBe('PDD_OTC_HOLD');
    expect(deriveCycleStatus({ ...base, payoutConfirmedAt: 1 })).toBe('PAYOUT_CONFIRMED');
    expect(deriveCycleStatus({ ...base, billDate: 1 })).toBe('BILLED');
    expect(deriveCycleStatus({ ...base, billSentAt: 1 })).toBe('BILLED');
    expect(deriveCycleStatus({ ...base, receivedAt: 1 })).toBe('RECEIVED');
    expect(deriveCycleStatus({ ...base, subDsaPaidAt: 1 })).toBe('SUBDSA_PAID');
    expect(deriveCycleStatus({ ...base, closedAt: 1 })).toBe('CLOSED');
    expect(deriveCycleStatus({ ...base, disputeFlag: true })).toBe('DISPUTED');
  });
  it('precedence: higher rung wins when several are set', () => {
    // A fully-progressed cycle that is also disputed → DISPUTED (top of chain)
    const full: CycleStatusInput = {
      disputeFlag: true, closedAt: 9, subDsaPaidAt: 8, receivedAt: 7, billSentAt: 6,
      billDate: 6, payoutConfirmedAt: 5, holdFlag: true, bankerConfirmedAt: 4, confirmationRaisedAt: 3,
    };
    expect(deriveCycleStatus(full)).toBe('DISPUTED');
    expect(deriveCycleStatus({ ...full, disputeFlag: false })).toBe('CLOSED');
    expect(deriveCycleStatus({ ...full, disputeFlag: false, closedAt: null })).toBe('SUBDSA_PAID');
    expect(deriveCycleStatus({ ...full, disputeFlag: false, closedAt: null, subDsaPaidAt: null })).toBe('RECEIVED');
  });
  it('hold only applies before payout is confirmed', () => {
    // payoutConfirmedAt set + holdFlag → PAYOUT_CONFIRMED outranks hold
    expect(deriveCycleStatus({ ...base, holdFlag: true, payoutConfirmedAt: 1 })).toBe('PAYOUT_CONFIRMED');
  });
});

describe('computeAgeing', () => {
  it('whole-day deltas from disbursement', () => {
    const a = computeAgeing({
      disbursementDate: D('2026-05-01'),
      dataSharedAt: D('2026-05-04'),       // 3
      bankerConfirmedAt: D('2026-05-15'),  // 14
      billedAt: D('2026-06-01'),           // 31
      receivedAt: D('2026-06-15'),         // 45
    });
    expect(a).toEqual({ disbToDataShare: 3, disbToBankerConfirm: 14, disbToBilled: 31, disbToReceived: 45 });
  });
  it('null milestones stay null; pre-disbursement clamps to 0', () => {
    const a = computeAgeing({ disbursementDate: D('2026-05-10'), dataSharedAt: D('2026-05-05'), bankerConfirmedAt: null, billedAt: null, receivedAt: null });
    expect(a.disbToDataShare).toBe(0);   // clamp negative
    expect(a.disbToBankerConfirm).toBeNull();
  });
});

describe('variance + margin', () => {
  it('bankerMismatch on amount or code, only after confirmation', () => {
    expect(computeBankerMismatch(null, 999, 5000000, 'x', '1033618')).toBe(false); // not confirmed
    expect(computeBankerMismatch(1, 5000000, 5000000, '1033618', '1033618')).toBe(false); // match
    expect(computeBankerMismatch(1, 4999000, 5000000, '1033618', '1033618')).toBe(true);  // amount differs
    expect(computeBankerMismatch(1, 5000000, 5000000, '9999999', '1033618')).toBe(true);  // code differs
  });
  it('pctVariance compares to 2 decimals (1.40 == 1.4)', () => {
    expect(computePctVariance(1.4, 1.40)).toBe(false);
    expect(computePctVariance(1.35, 1.40)).toBe(true);
    expect(computePctVariance(null, 1.40)).toBe(false);
  });
  it('amountVariance = (billGross − tds) − receivedNet', () => {
    expect(computeAmountVariance(1, 70000, 7000, 63000)).toBe(0);
    expect(computeAmountVariance(1, 70000, 7000, 60000)).toBe(3000);  // short-received
    expect(computeAmountVariance(null, 70000, 7000, null)).toBeNull();
  });
  it('netMarginRealised = receivedNet − subDsaPaid', () => {
    expect(computeNetMarginRealised(63000, 30000)).toBe(33000);
    expect(computeNetMarginRealised(63000, null)).toBe(63000);  // self-sourced
    expect(computeNetMarginRealised(null, 30000)).toBeNull();
  });
});

describe('canClose', () => {
  it('requires receivedAt', () => {
    expect(canClose(false, null, null).ok).toBe(false);
    expect(canClose(false, 1, null).ok).toBe(true);   // self-sourced, received → closeable
  });
  it('with sub-DSA, also requires subDsaPaidAt', () => {
    expect(canClose(true, 1, null).ok).toBe(false);
    expect(canClose(true, 1, 2).ok).toBe(true);
  });
});

describe('validateMilestoneOrder', () => {
  it('step 2 has no prerequisite', () => {
    expect(validateMilestoneOrder(2, {}).ok).toBe(true);
  });
  it('step 4 needs confirmationRaisedAt', () => {
    expect(validateMilestoneOrder(4, { confirmationRaisedAt: null }).ok).toBe(false);
    expect(validateMilestoneOrder(4, { confirmationRaisedAt: 123 }).ok).toBe(true);
  });
  it('step 8 (received) needs billSentAt', () => {
    const r = validateMilestoneOrder(8, { billSentAt: null });
    expect(r.ok).toBe(false);
    expect(r.prereq).toBe('billSentAt');
    expect(r.reason).toMatch(/Step 8 requires milestone 'billSentAt'/);
  });
  it('step 6 follows banker confirmation (hold optional in between)', () => {
    expect(validateMilestoneOrder(6, { bankerConfirmedAt: 1 }).ok).toBe(true);
    expect(validateMilestoneOrder(6, { bankerConfirmedAt: null }).ok).toBe(false);
  });
});
