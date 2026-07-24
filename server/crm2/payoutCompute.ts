/**
 * server/crm2/payoutCompute.ts — shared, PURE payout-cycle derivation, hoisted
 * from server/crm2.ts (2026-07-24). deriveCycleFields recomputes the derived
 * fields of a payout cycle (status · ageing · variance flags · realised margin)
 * from a merged cycle object — no db, driven entirely by the tested payout libs.
 * Shared by the disburse/milestone money routes AND the recon-dispute recompute,
 * so it lives once here (the seam that lets both route groups extract cleanly).
 */
import { tsToMs } from "./core.js";
import {
  deriveCycleStatus, computeAgeing, computeBankerMismatch,
  computePctVariance, computeAmountVariance, computeNetMarginRealised,
} from "../../src/lib/crm2/payout.js";

export function deriveCycleFields(cy: Record<string, unknown>): Record<string, unknown> {
  const ms = (k: string) => tsToMs(cy[k]);
  const status = deriveCycleStatus({
    disputeFlag: cy.disputeFlag === true, closedAt: ms("closedAt"), subDsaPaidAt: ms("subDsaPaidAt"),
    receivedAt: ms("receivedAt"), billSentAt: ms("billSentAt"), billDate: ms("billDate"),
    payoutConfirmedAt: ms("payoutConfirmedAt"), holdFlag: cy.holdFlag === true,
    bankerConfirmedAt: ms("bankerConfirmedAt"), confirmationRaisedAt: ms("confirmationRaisedAt"),
  });
  const disbMs = tsToMs(cy.disbursementDate) ?? 0;
  const ageing = computeAgeing({
    disbursementDate: disbMs, dataSharedAt: ms("dataSharedAt"), bankerConfirmedAt: ms("bankerConfirmedAt"),
    billedAt: ms("billSentAt") ?? ms("billDate"), receivedAt: ms("receivedAt"),
  });
  const bankerMismatch = computeBankerMismatch(
    ms("bankerConfirmedAt"), cy.confirmedAmount as number | null, cy.disbursedAmount as number,
    cy.confirmedDsaCode as string | null, cy.dsaCode as string);
  const pctVariance = computePctVariance(cy.confirmedPayoutPct as number | null, cy.finvastraPayoutPct as number);
  const amountVariance = computeAmountVariance(
    ms("receivedAt"), cy.billGross as number | null, cy.tdsDeducted as number | null, cy.receivedNet as number | null);
  const netMarginRealised = computeNetMarginRealised(cy.receivedNet as number | null, cy.subDsaPaidAmount as number | null);
  return { status, ageing, bankerMismatch, pctVariance, amountVariance, netMarginRealised };
}
