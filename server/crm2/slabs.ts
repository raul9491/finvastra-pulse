/**
 * server/crm2/slabs.ts - payout-slab request validation + resolution helpers,
 * lifted from server/crm2.ts (2026-07-22). Pure: core validators + the tested
 * slab lib (findSlabOverlaps/resolveSlab). resolveMapping (db) stays in crm2.ts.
 */
import { ApiError, optNum, optTs, strArr } from "./core.js";
import { findSlabOverlaps, resolveSlab, type SlabForResolution } from "../../src/lib/crm2/slab.js";

export interface SlabBody {
  productIds: string[]; finvastraPayoutPct: number;
  connectorPayoutPctFromBank: number | null; subDsaDefaultPayoutPct: number | null;
  tdsPct: number | null; effectiveFrom: FirebaseFirestore.Timestamp;
  effectiveTo: FirebaseFirestore.Timestamp | null;
}

function sanitizeSlab(b: Record<string, unknown>): SlabBody {
  const productIds = strArr(b, "productIds");
  if (productIds.length === 0) throw new ApiError(400, "productIds must have at least one product");
  const pct = optNum(b, "finvastraPayoutPct");
  if (pct === null || pct <= 0 || pct > 100) throw new ApiError(400, "finvastraPayoutPct must be > 0 and ≤ 100");
  const from = optTs(b, "effectiveFrom");
  if (!from) throw new ApiError(400, "effectiveFrom is required");
  const to = optTs(b, "effectiveTo");
  if (to && to.toMillis() < from.toMillis()) throw new ApiError(400, "effectiveTo must be on/after effectiveFrom");
  return {
    productIds,
    finvastraPayoutPct: pct,
    connectorPayoutPctFromBank: optNum(b, "connectorPayoutPctFromBank"),
    subDsaDefaultPayoutPct: optNum(b, "subDsaDefaultPayoutPct"),
    tdsPct: optNum(b, "tdsPct"),
    effectiveFrom: from,
    effectiveTo: to,
  };
}

const toResolution = (s: Record<string, unknown>): SlabForResolution => ({
  slabId: s.slabId as string,
  productIds: s.productIds as string[],
  finvastraPayoutPct: s.finvastraPayoutPct as number,
  subDsaDefaultPayoutPct: (s.subDsaDefaultPayoutPct as number | null) ?? null,
  tdsPct: (s.tdsPct as number | null) ?? null,
  effectiveFromMs: (s.effectiveFrom as FirebaseFirestore.Timestamp).toMillis(),
  effectiveToMs: s.effectiveTo ? (s.effectiveTo as FirebaseFirestore.Timestamp).toMillis() : null,
});

function assertNoOverlaps(slabs: Array<Record<string, unknown>>): void {
  const conflicts = findSlabOverlaps(slabs.map(toResolution));
  if (conflicts.length > 0) {
    throw new ApiError(400, "Slab date ranges overlap — end-date the old slab first", conflicts);
  }
}

// Resolve the DSA-code mapping for a case/login. Payout is per product, and per
// sub-product when sub-products exist, so the precedence is:
//   (agg × lender × product × subProduct)  →  (agg × lender × product, whole)
//   →  any product mapping  →  legacy product-less mapping.
// Deterministic — money is never guessed. If more than one mapping remains at the
// matched tier (after preferring ACTIVE), we hard-fail 409 naming the conflicting
// mapping ids, mirroring the resolveSlab hard-fail style. All four call sites
// (per-case + per-login disburse and both previews) surface this to the caller.
function pickUnambiguousMapping(
  docs: FirebaseFirestore.QueryDocumentSnapshot[], tierDesc: string,
): FirebaseFirestore.QueryDocumentSnapshot {
  if (docs.length === 1) return docs[0];
  const active = docs.filter((d) => d.data().status === "ACTIVE");
  const pool = active.length > 0 ? active : docs;
  if (pool.length === 1) return pool[0];
  throw new ApiError(409,
    `Ambiguous DSA-code mapping — ${pool.length} mappings match ${tierDesc} (${pool.map((d) => d.id).join(", ")}). ` +
    `Deactivate or merge the duplicates in Masters → DSA Codes so exactly one applies.`,
    { kind: "AMBIGUOUS_MAPPING", candidates: pool.map((d) => d.id) });
}

export { sanitizeSlab, toResolution, assertNoOverlaps, pickUnambiguousMapping };
