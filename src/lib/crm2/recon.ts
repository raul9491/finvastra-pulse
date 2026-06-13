/**
 * Bank-dump reconciliation + recon-snapshot math — pure, unit-tested (spec §9.6, §7.2).
 *
 * Plain numbers / ms timestamps so the same code runs on the server and in vitest.
 * Matching is three-tier and deterministic; the snapshot is a pure aggregation.
 */

export type MatchType = 'loan' | 'app' | 'fuzzy' | 'none';

/** A parsed row from the connector's bank-MIS dump. */
export interface DumpRow {
  rowIndex: number;
  loanAccountNo: string | null;
  bankApplicationNo: string | null;
  dsaCode: string | null;
  amount: number | null;       // disbursed amount as the dump reports it
  dateMs: number | null;       // disbursement date
}

/** The minimal misRecord facts needed to match a dump row. */
export interface MisLite {
  caseId: string;
  loanAccountNo: string | null;
  bankApplicationNo: string | null;
  dsaCode: string;
  disbursedAmount: number;
  disbursementDateMs: number;
}

export interface MatchResult {
  matchType: MatchType;
  caseId: string | null;
  /** dump.amount − misRecord.disbursedAmount (how far the bank's figure is from ours). */
  amountVariance: number | null;
}

const MS_PER_DAY = 86_400_000;
const norm = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();

/**
 * Three-tier match (spec §9.6), in order:
 *  1. loanAccountNo exact  2. bankApplicationNo exact
 *  3. fuzzy: same dsaCode AND |amount−disbursed|/disbursed ≤ 1% AND |date−disb| ≤ 7 days.
 * Fuzzy ties broken by smallest amount delta. Returns the first/best match or none.
 */
export function matchDumpRow(row: DumpRow, mis: MisLite[]): MatchResult {
  // Tier 1 — loan account number
  if (norm(row.loanAccountNo)) {
    const hit = mis.find((m) => norm(m.loanAccountNo) && norm(m.loanAccountNo) === norm(row.loanAccountNo));
    if (hit) return { matchType: 'loan', caseId: hit.caseId, amountVariance: variance(row, hit) };
  }
  // Tier 2 — bank application number
  if (norm(row.bankApplicationNo)) {
    const hit = mis.find((m) => norm(m.bankApplicationNo) && norm(m.bankApplicationNo) === norm(row.bankApplicationNo));
    if (hit) return { matchType: 'app', caseId: hit.caseId, amountVariance: variance(row, hit) };
  }
  // Tier 3 — fuzzy on dsaCode + amount(±1%) + date(±7d)
  if (norm(row.dsaCode) && row.amount != null && row.dateMs != null) {
    const candidates = mis
      .filter((m) => norm(m.dsaCode) === norm(row.dsaCode))
      .filter((m) => m.disbursedAmount > 0 && Math.abs(row.amount! - m.disbursedAmount) / m.disbursedAmount <= 0.01)
      .filter((m) => Math.abs(row.dateMs! - m.disbursementDateMs) <= 7 * MS_PER_DAY)
      .sort((a, b) => Math.abs(row.amount! - a.disbursedAmount) - Math.abs(row.amount! - b.disbursedAmount));
    if (candidates.length > 0) return { matchType: 'fuzzy', caseId: candidates[0].caseId, amountVariance: variance(row, candidates[0]) };
  }
  return { matchType: 'none', caseId: null, amountVariance: null };
}

function variance(row: DumpRow, m: MisLite): number | null {
  return row.amount != null ? Math.round(row.amount - m.disbursedAmount) : null;
}

// ─── Recon snapshot aggregation (spec §7.2) ──────────────────────────────────

export interface CycleLite {
  caseId: string;
  status: string;
  disbursedAmount: number;
  expectedGross: number;
  billGross: number | null;
  receivedNet: number | null;
  tdsDeducted: number | null;
  subDsaExpected: number | null;
  subDsaPaidAmount: number | null;
  netMarginRealised: number | null;
  disputeFlag: boolean;
  bankerConfirmedAt: number | null;
  confirmationRaisedAt: number | null;
}

export interface ReconSnapshot {
  casesDisbursedCount: number;
  disbursedValue: number;
  bankerConfirmedCount: number;
  pendingConfirmationCount: number;
  pendingConfirmationAvgAgeingDays: number | null;  // avg days since confirmationRaised, unconfirmed
  expectedGross: number;
  billed: number;
  received: number;
  pendingReceivable: number;          // expectedGross − received
  tdsDeducted: number;
  subDsaDue: number;
  subDsaPaid: number;
  subDsaBalance: number;
  netMargin: number;
  disputedCaseIds: string[];
}

/** Aggregate a period's cycles into a snapshot. `nowMs` anchors pending-confirmation ageing. */
export function computeSnapshot(cycles: CycleLite[], nowMs: number): ReconSnapshot {
  let disbursedValue = 0, expectedGross = 0, billed = 0, received = 0, tds = 0;
  let subDue = 0, subPaid = 0, netMargin = 0;
  let bankerConfirmed = 0, pendingConfirm = 0, pendingAgeSum = 0, pendingAgeN = 0;
  const disputed: string[] = [];

  for (const c of cycles) {
    disbursedValue += c.disbursedAmount;
    expectedGross += c.expectedGross;
    billed += c.billGross ?? 0;
    received += c.receivedNet ?? 0;
    tds += c.tdsDeducted ?? 0;
    subDue += c.subDsaExpected ?? 0;
    subPaid += c.subDsaPaidAmount ?? 0;
    netMargin += c.netMarginRealised ?? 0;
    if (c.bankerConfirmedAt != null) bankerConfirmed++;
    else {
      pendingConfirm++;
      if (c.confirmationRaisedAt != null) { pendingAgeSum += Math.max(0, Math.floor((nowMs - c.confirmationRaisedAt) / MS_PER_DAY)); pendingAgeN++; }
    }
    if (c.disputeFlag) disputed.push(c.caseId);
  }

  return {
    casesDisbursedCount: cycles.length,
    disbursedValue,
    bankerConfirmedCount: bankerConfirmed,
    pendingConfirmationCount: pendingConfirm,
    pendingConfirmationAvgAgeingDays: pendingAgeN > 0 ? Math.round(pendingAgeSum / pendingAgeN) : null,
    expectedGross,
    billed,
    received,
    pendingReceivable: expectedGross - received,
    tdsDeducted: tds,
    subDsaDue: subDue,
    subDsaPaid: subPaid,
    subDsaBalance: subDue - subPaid,
    netMargin,
    disputedCaseIds: disputed,
  };
}
