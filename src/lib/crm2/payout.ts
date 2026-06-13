/**
 * Payout-cycle money math — pure, fully unit-tested (spec §9).
 *
 * These are THE financial functions. They operate on plain numbers/millisecond
 * timestamps so they run identically on the server (Admin SDK), the client
 * (milestone preview), and in vitest. Status is DERIVED here and never settable
 * via the API; ageing/variance/margin are all computed, never client-supplied.
 */

export type PayoutCycleStatus =
  | 'AWAITING_DATA_SHARE' | 'CONFIRMATION_RAISED' | 'BANKER_CONFIRMED'
  | 'PDD_OTC_HOLD' | 'PAYOUT_CONFIRMED' | 'BILLED' | 'RECEIVED'
  | 'SUBDSA_PAID' | 'CLOSED' | 'DISPUTED';

/** Milestone presence flags + the two override flags — the inputs to status. */
export interface CycleStatusInput {
  disputeFlag: boolean;
  closedAt: number | null;
  subDsaPaidAt: number | null;
  receivedAt: number | null;
  billSentAt: number | null;
  billDate: number | null;
  payoutConfirmedAt: number | null;
  holdFlag: boolean;
  bankerConfirmedAt: number | null;
  confirmationRaisedAt: number | null;
}

/**
 * Derive cycle status. STRICT precedence (spec §9), highest first:
 * DISPUTED → CLOSED → SUBDSA_PAID → RECEIVED → BILLED → PAYOUT_CONFIRMED →
 * PDD_OTC_HOLD → BANKER_CONFIRMED → CONFIRMATION_RAISED → AWAITING_DATA_SHARE.
 */
export function deriveCycleStatus(c: CycleStatusInput): PayoutCycleStatus {
  if (c.disputeFlag) return 'DISPUTED';
  if (c.closedAt != null) return 'CLOSED';
  if (c.subDsaPaidAt != null) return 'SUBDSA_PAID';
  if (c.receivedAt != null) return 'RECEIVED';
  if (c.billSentAt != null || c.billDate != null) return 'BILLED';
  if (c.payoutConfirmedAt != null) return 'PAYOUT_CONFIRMED';
  if (c.holdFlag) return 'PDD_OTC_HOLD';
  if (c.bankerConfirmedAt != null) return 'BANKER_CONFIRMED';
  if (c.confirmationRaisedAt != null) return 'CONFIRMATION_RAISED';
  return 'AWAITING_DATA_SHARE';
}

const MS_PER_DAY = 86_400_000;
/** Whole-day delta from disbursement to a milestone (null if not reached / before disb). */
function daysFrom(disbMs: number, milestoneMs: number | null): number | null {
  if (milestoneMs == null) return null;
  const d = Math.floor((milestoneMs - disbMs) / MS_PER_DAY);
  return d >= 0 ? d : 0;
}

export interface AgeingInput {
  disbursementDate: number;
  dataSharedAt: number | null;
  bankerConfirmedAt: number | null;
  billedAt: number | null;       // billSentAt ?? billDate
  receivedAt: number | null;
}
export interface Ageing {
  disbToDataShare: number | null;
  disbToBankerConfirm: number | null;
  disbToBilled: number | null;
  disbToReceived: number | null;
}
export function computeAgeing(a: AgeingInput): Ageing {
  return {
    disbToDataShare:    daysFrom(a.disbursementDate, a.dataSharedAt),
    disbToBankerConfirm: daysFrom(a.disbursementDate, a.bankerConfirmedAt),
    disbToBilled:       daysFrom(a.disbursementDate, a.billedAt),
    disbToReceived:     daysFrom(a.disbursementDate, a.receivedAt),
  };
}

/** Banker confirmation mismatch: confirmed amount/code differ from the case's
 *  frozen values. Only meaningful once the banker has confirmed. */
export function computeBankerMismatch(
  bankerConfirmedAt: number | null,
  confirmedAmount: number | null, frozenDisbursedAmount: number,
  confirmedDsaCode: string | null, frozenDsaCode: string,
): boolean {
  if (bankerConfirmedAt == null) return false;
  const amountDiffers = confirmedAmount != null && Math.round(confirmedAmount) !== Math.round(frozenDisbursedAmount);
  const codeDiffers = confirmedDsaCode != null && confirmedDsaCode !== frozenDsaCode;
  return amountDiffers || codeDiffers;
}

/** Aggregator's confirmed payout % differs from the frozen slab %. */
export function computePctVariance(confirmedPayoutPct: number | null, frozenPct: number): boolean {
  if (confirmedPayoutPct == null) return false;
  // Compare to 2 decimals to avoid float noise (e.g. 1.40 vs 1.4).
  return Math.round(confirmedPayoutPct * 100) !== Math.round(frozenPct * 100);
}

/** amountVariance = (billGross − tdsDeducted) − receivedNet. Null until received. */
export function computeAmountVariance(
  receivedAt: number | null,
  billGross: number | null, tdsDeducted: number | null, receivedNet: number | null,
): number | null {
  if (receivedAt == null || receivedNet == null) return null;
  const expectedNet = (billGross ?? 0) - (tdsDeducted ?? 0);
  return Math.round(expectedNet - receivedNet);
}

/** netMarginRealised = receivedNet − (subDsaPaidAmount ?? 0). Null until received. */
export function computeNetMarginRealised(
  receivedNet: number | null, subDsaPaidAmount: number | null,
): number | null {
  if (receivedNet == null) return null;
  return Math.round(receivedNet - (subDsaPaidAmount ?? 0));
}

/** Closure rule (spec §9): closing requires receivedAt, plus subDsaPaidAt when a
 *  sub-DSA is on the cycle. Returns {ok} or {ok:false, reason}. */
export function canClose(
  hasSubDsa: boolean, receivedAt: number | null, subDsaPaidAt: number | null,
): { ok: boolean; reason?: string } {
  if (receivedAt == null) return { ok: false, reason: 'Cannot close — payout not received yet (receivedAt is empty)' };
  if (hasSubDsa && subDsaPaidAt == null) {
    return { ok: false, reason: 'Cannot close — sub-DSA payout not yet paid (subDsaPaidAt is empty)' };
  }
  return { ok: true };
}

// ─── Milestone step ordering ────────────────────────────────────────────────
// Steps 2..10 (spec §9). Each step requires its predecessor's anchor date to be
// present, unless an override+reason is supplied (which is logged). Step 1 is the
// disbursement itself (the cycle's creation), so the chain starts at step 2.

export const MILESTONE_STEPS = {
  2: 'dataSharedAt',
  3: 'confirmationRaisedAt',
  4: 'bankerConfirmedAt',
  5: 'pddOtcClearedMonth',   // PDD/OTC clearance (may also set holdFlag)
  6: 'payoutConfirmedAt',
  7: 'billSentAt',           // bill raised/sent
  8: 'receivedAt',
  9: 'subDsaPaidAt',
  10: 'closedAt',
} as const;
export type MilestoneStep = keyof typeof MILESTONE_STEPS;

/** The anchor field whose presence step N depends on (step N-1's anchor). Step 5
 *  is exempt (a hold can be placed any time after banker confirmation; step 5's
 *  predecessor is step 4). Returns the predecessor anchor field name. */
const STEP_PREREQ: Record<MilestoneStep, string | null> = {
  2: null,                    // first milestone after disbursement
  3: 'dataSharedAt',
  4: 'confirmationRaisedAt',
  5: 'bankerConfirmedAt',
  6: 'bankerConfirmedAt',     // payout confirmation follows banker confirmation (hold is optional in between)
  7: 'payoutConfirmedAt',
  8: 'billSentAt',
  9: 'receivedAt',
  10: 'receivedAt',           // closure also needs subDsaPaidAt when subDsa set — enforced by canClose
};

/** Validate that step N's predecessor milestone is present. Returns ok, or the
 *  blocking reason (caller may bypass with an override+reason that gets logged). */
export function validateMilestoneOrder(
  step: MilestoneStep,
  anchors: Record<string, number | string | null | undefined>,
): { ok: boolean; reason?: string; prereq?: string } {
  const prereq = STEP_PREREQ[step];
  if (prereq == null) return { ok: true };
  const v = anchors[prereq];
  if (v == null) {
    return { ok: false, prereq, reason: `Step ${step} requires milestone '${prereq}' to be recorded first` };
  }
  return { ok: true };
}
