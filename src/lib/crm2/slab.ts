/**
 * Slab resolution + overlap validation — THE payout engine's pure core.
 *
 * Pure functions operating on millisecond timestamps so they run identically on
 * the server (Admin SDK), the client (slab preview in the disburse dialog), and
 * in vitest. Callers convert Firestore Timestamps via .toMillis().
 *
 * NEVER defaults to 0% — zero or multiple matching slabs throws a typed error
 * that blocks the disbursement save with a human-readable message.
 */

export interface SlabForResolution {
  slabId: string;
  productIds: string[];
  finvastraPayoutPct: number;
  subDsaDefaultPayoutPct: number | null;
  tdsPct: number | null;
  effectiveFromMs: number;
  effectiveToMs: number | null;       // null = current (open-ended)
}

export class SlabResolutionError extends Error {
  readonly kind: 'NO_SLAB' | 'AMBIGUOUS_SLAB';
  readonly matches: SlabForResolution[];
  constructor(kind: 'NO_SLAB' | 'AMBIGUOUS_SLAB', message: string, matches: SlabForResolution[]) {
    super(message);
    this.name = 'SlabResolutionError';
    this.kind = kind;
    this.matches = matches;
  }
}

/** Names used purely to build the human-readable error message. */
export interface SlabContext {
  connectorName: string;              // "Starpowerz"
  lenderName: string;                 // "Fedbank"
  productName: string;                // "LAP"
}

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Resolve the EXACTLY ONE slab covering (productId, disbursementDate).
 * Boundary dates are inclusive on both ends: effectiveFrom ≤ d ≤ effectiveTo.
 */
export function resolveSlab(
  slabs: SlabForResolution[],
  productId: string,
  disbursementDateMs: number,
  ctx: SlabContext,
): SlabForResolution {
  const matches = slabs.filter((s) =>
    s.productIds.includes(productId)
    && s.effectiveFromMs <= disbursementDateMs
    && (s.effectiveToMs === null || disbursementDateMs <= s.effectiveToMs),
  );

  const where = `${ctx.connectorName} × ${ctx.lenderName} × ${ctx.productName} on ${fmtDate(disbursementDateMs)}`;
  if (matches.length === 0) {
    throw new SlabResolutionError('NO_SLAB', `No active payout slab for ${where}`, matches);
  }
  if (matches.length > 1) {
    throw new SlabResolutionError(
      'AMBIGUOUS_SLAB',
      `${matches.length} overlapping payout slabs for ${where} — end-date the old slab in the mapping editor`,
      matches,
    );
  }
  return matches[0];
}

/**
 * Validate that no two slabs covering the same productId overlap in date range.
 * Used by the mapping editor + the masters API before saving slabs.
 * Returns a list of human-readable conflicts (empty = valid).
 */
export function findSlabOverlaps(
  slabs: SlabForResolution[],
  productNameById?: (id: string) => string,
): string[] {
  const conflicts: string[] = [];
  const nameOf = productNameById ?? ((id: string) => id);

  for (let i = 0; i < slabs.length; i++) {
    for (let j = i + 1; j < slabs.length; j++) {
      const a = slabs[i], b = slabs[j];
      const sharedProducts = a.productIds.filter((p) => b.productIds.includes(p));
      if (sharedProducts.length === 0) continue;
      // Ranges [fromA, toA] and [fromB, toB] overlap when each starts before the
      // other ends (open-ended `to` = Infinity). Boundaries are inclusive, so
      // toA == fromB IS an overlap (both slabs cover that exact day).
      const aEnd = a.effectiveToMs ?? Infinity;
      const bEnd = b.effectiveToMs ?? Infinity;
      const overlaps = a.effectiveFromMs <= bEnd && b.effectiveFromMs <= aEnd;
      if (overlaps) {
        conflicts.push(
          `Slabs ${a.slabId.slice(0, 8)} and ${b.slabId.slice(0, 8)} overlap for ` +
          `${sharedProducts.map(nameOf).join(', ')} ` +
          `(${fmtDate(Math.max(a.effectiveFromMs, b.effectiveFromMs))} → ` +
          `${aEnd === Infinity && bEnd === Infinity ? 'open' : fmtDate(Math.min(aEnd, bEnd))})`,
        );
      }
    }
  }
  return conflicts;
}

/** Compute expected amounts from a resolved slab — used by the disburse endpoint
 *  and the slab-preview UI. Rounded to whole rupees. */
export function computeExpectedAmounts(
  slab: Pick<SlabForResolution, 'finvastraPayoutPct' | 'subDsaDefaultPayoutPct'>,
  disbursedAmount: number,
  caseSubDsaPctOverride: number | null,   // case-level % beats the slab default
  hasSubDsa: boolean,
): { expectedGross: number; subDsaPayoutPct: number | null; subDsaExpected: number | null; netMarginExpected: number } {
  const expectedGross = Math.round(disbursedAmount * slab.finvastraPayoutPct / 100);
  const subDsaPct = hasSubDsa ? (caseSubDsaPctOverride ?? slab.subDsaDefaultPayoutPct) : null;
  const subDsaExpected = subDsaPct != null ? Math.round(disbursedAmount * subDsaPct / 100) : null;
  return {
    expectedGross,
    subDsaPayoutPct: subDsaPct,
    subDsaExpected,
    netMarginExpected: expectedGross - (subDsaExpected ?? 0),
  };
}
