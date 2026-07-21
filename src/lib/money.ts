/**
 * money — ONE home for ₹ (INR) formatting, replacing 20+ private copies that had
 * drifted into three subtly different behaviours. Each function reproduces an
 * existing behaviour EXACTLY so adoption is behavior-preserving:
 *
 *   inr(n)       — exact value, null/undefined → '—'   (the crm2 `inr` variant)
 *   inrRound(n)  — Math.round to whole rupees, null/NaN → ₹0  (the `fmtINR` variant)
 *   inrPaise(n)  — 2-decimal paise precision (payslip/FnF salary figures)
 *
 * Indian digit grouping via `toLocaleString('en-IN')`. Pure — server + client.
 */

/** Exact amount with Indian grouping; null/undefined renders as '—'. */
export const inr = (n: number | null | undefined): string =>
  n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';

/** Whole-rupee (rounded) amount; null/NaN → ₹0. */
export const inrRound = (n: number | null | undefined): string =>
  `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/** 2-decimal (paise) amount, for payslip/FnF salary figures; null/NaN → ₹0.00. */
export const inrPaise = (n: number | null | undefined): string =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
