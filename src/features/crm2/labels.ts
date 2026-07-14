/**
 * Display-label maps — friendly, human wording for the stored CRM 2.0 enums.
 *
 * IMPORTANT: these change ONLY what is printed on screen. The stored values
 * (e.g. 'HOT', 'WALKIN', 'AWAITING_DATA_SHARE') are NEVER changed — every map
 * keys off the stored value and falls back to a title-cased version so an
 * unmapped value still reads cleanly instead of as ALL_CAPS.
 */
import type { Crm2LeadCategory, Crm2LeadSource, PayoutCycleStatus } from '../../types/crm2';

// Generic fallback: 'AWAITING_DATA_SHARE' -> 'Awaiting data share'
export function humanize(v: string | null | undefined): string {
  if (!v) return '—';
  return v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

// ── Lead source ───────────────────────────────────────────────────────────────
export const SOURCE_LABEL: Record<Crm2LeadSource, string> = {
  WEBSITE: 'Website',
  ADS: 'Social Ad',
  JUSTDIAL: 'JustDial',
  WALKIN: 'Walk-in',
  COLD_CALL: 'Cold call',
  REFERRAL_CLIENT: 'Referral (Client)',
  REFERRAL_SUBDSA: 'Referral (Connector)',
  WHATSAPP: 'WhatsApp',
};
export const sourceLabel = (v: string | null | undefined): string =>
  (v && SOURCE_LABEL[v as Crm2LeadSource]) || humanize(v);

// ── Lead category ─────────────────────────────────────────────────────────────
export const CATEGORY_LABEL: Record<Crm2LeadCategory, string> = {
  LOAN: 'Loan',
  WEALTH: 'Wealth',
  INSURANCE: 'Insurance',
  CIBIL_CHECK: 'CIBIL Check',
  PARTNER_DSA: 'Partner Sign-up',
  GENERAL: 'General',
};
export const categoryLabel = (v: string | null | undefined): string =>
  (v && CATEGORY_LABEL[v as Crm2LeadCategory]) || humanize(v);

// ── Payout cycle status (+ the NOT_DUE sentinel shown on cases/logins) ─────────
export const PAYOUT_STATUS_LABEL: Record<PayoutCycleStatus | 'NOT_DUE', string> = {
  NOT_DUE: 'Not due yet',
  AWAITING_DATA_SHARE: 'Awaiting data share',
  CONFIRMATION_RAISED: 'Confirmation raised',
  BANKER_CONFIRMED: 'Banker confirmed',
  PDD_OTC_HOLD: 'PDD / OTC hold',
  PAYOUT_CONFIRMED: 'Payout confirmed',
  BILLED: 'Billed',
  RECEIVED: 'Received',
  SUBDSA_PAID: 'Sub DSA paid',
  CLOSED: 'Closed',
  DISPUTED: 'Disputed',
};
export const payoutStatusLabel = (v: string | null | undefined): string =>
  (v && PAYOUT_STATUS_LABEL[v as PayoutCycleStatus | 'NOT_DUE']) || humanize(v);
