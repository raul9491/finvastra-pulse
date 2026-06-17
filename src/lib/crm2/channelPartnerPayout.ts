/**
 * Sub-DSA (FAC-) channel-partner payout — pure, deterministic money math.
 *
 * The FAC- "Sub DSA" is the channel partner who SOURCED a customer (distinct from
 * the SDSA- "Connector" who gets the per-login slab payout, and the CONN-
 * "Aggregator" we route through). Per Rahul (2026-06-17): each FAC- partner gets a
 * payout defined PER PRODUCT (with an 'ALL' fallback), the basis is the partner's
 * choice (flat ₹, % of disbursed, or % of Finvastra's payout), and the disburse
 * step may MANUALLY OVERRIDE the computed amount for case-by-case variance.
 *
 * Used by both the server (per-login disburse) and the client preview. No I/O.
 */

export type ChannelPartnerPayoutBasis = 'DISBURSED_PCT' | 'FINVASTRA_PCT' | 'FLAT';

export interface ChannelPartnerPayoutRule {
  productId: string;                   // a CRM2 products id, or 'ALL' (fallback)
  basis: ChannelPartnerPayoutBasis;
  value: number;                       // percentage for *_PCT, rupee amount for FLAT
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pick the rule for a product — exact match wins, then the 'ALL' fallback. */
export function resolveChannelPartnerRule(
  rules: ChannelPartnerPayoutRule[] | null | undefined,
  productId: string,
): ChannelPartnerPayoutRule | null {
  if (!rules?.length) return null;
  return rules.find((r) => r.productId === productId)
    ?? rules.find((r) => r.productId === 'ALL')
    ?? null;
}

/**
 * Compute the FAC- partner's expected payout. Returns null when no rule applies or
 * the rule is malformed (caller then creates no payout). Never throws.
 */
export function computeChannelPartnerPayout(
  rule: ChannelPartnerPayoutRule | null,
  disbursedAmount: number,
  finvastraGross: number,
): number | null {
  if (!rule) return null;
  const v = rule.value;
  if (!Number.isFinite(v) || v < 0) return null;
  switch (rule.basis) {
    case 'FLAT':           return round2(v);
    case 'DISBURSED_PCT':  return Number.isFinite(disbursedAmount) ? round2((disbursedAmount * v) / 100) : null;
    case 'FINVASTRA_PCT':  return Number.isFinite(finvastraGross) ? round2((finvastraGross * v) / 100) : null;
    default:               return null;
  }
}

/** Validate + clamp a single rule from untrusted input (server-side guard). */
export function sanitizeChannelPartnerRule(raw: unknown): ChannelPartnerPayoutRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const productId = typeof r.productId === 'string' && r.productId.trim() ? r.productId.trim() : null;
  const basis = r.basis;
  if (!productId) return null;
  if (basis !== 'DISBURSED_PCT' && basis !== 'FINVASTRA_PCT' && basis !== 'FLAT') return null;
  const value = Number(r.value);
  if (!Number.isFinite(value) || value < 0) return null;
  // Percentages are clamped to a sane 0–100; flat amounts are left as-is.
  const clamped = basis === 'FLAT' ? value : Math.min(value, 100);
  return { productId, basis, value: clamped };
}
