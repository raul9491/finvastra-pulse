/**
 * Partner-intake funnel option lists, the screening call-script prompt (`AskQ`),
 * and the tier/funnel badge styling. Shared by the connector form, the connectors
 * list tab and the Partner Scoring settings tab.
 * 
 * Extracted verbatim from MastersPage.tsx (2026-07-22) - no behaviour change.
 */
// ─── Partner intake funnel — option lists + badge styling ─────────────────────
export const opt = (v: string) => ({ value: v, label: v });
export const PARTNER_FUNNEL_OPTS = ['Inquiry', 'Screening', 'KYC Collection', 'Agreement Sent', 'Agreement Signed', 'Training', 'Active', 'Rejected', 'On Hold'].map(opt);
export const PARTNER_LEAD_SOURCE_OPTS = ['Website Form', 'WhatsApp Inquiry', 'Referral', 'Walk-in', 'Other'].map(opt);
export const PARTNER_NETWORK_TYPE_OPTS = ['CA / Accountant', 'Property Dealer / Broker', 'Insurance Agent', 'HR / Corporate Contact', 'Society / RWA Office Bearer', 'Freelance Loan Agent', 'Other / Unclear'].map(opt);
export const PARTNER_NETWORK_SIZE_OPTS = ['>100 contacts', '30-100 contacts', '<30 contacts', 'Not Shared'].map(opt);
export const PARTNER_FIT_OPTS = ['Strong Fit', 'Partial Fit', 'Unclear'].map(opt);
export const PARTNER_TRACK_OPTS = ['Proven with Examples', 'Some Experience', 'None'].map(opt);
export const PARTNER_VOLUME_OPTS = ['>5 cases/month', '2-5 cases/month', '<2 cases/month', 'Not Shared'].map(opt);
export const PARTNER_KYC_OPTS = ['Ready', 'Partial', 'Not Ready'].map(opt);
export const PARTNER_NEXT_ACTION_OPTS = ['Send Screening Call', 'Collect KYC Docs', 'Send Agreement', 'Schedule Training', 'Grant Pulse Access', 'Reject', 'On Hold'].map(opt);

export const PRACTICAL_OPTS = {
  productKnowledge: ['Strong', 'Adequate', 'Weak'].map(opt),
  sampleCaseQuality: ['Complete & clean', 'Minor gaps', 'Poor'].map(opt),
  responsiveness: ['Prompt', 'Acceptable', 'Slow'].map(opt),
  processUnderstanding: ['Clear', 'Partial', 'None'].map(opt),
};

// The italic "ask this" line under a screening field — the tab doubles as the
// call script so nobody needs a separate question sheet.
export function AskQ({ q }: { q: string }) {
  return <p className="text-[11px] italic mb-1" style={{ color: 'var(--text-dim)' }}>Ask: “{q}”</p>;
}

export const TIER_STYLE: Record<string, { color: string; bg: string }> = {
  Hot: { color: '#34d399', bg: 'rgba(52,211,153,0.14)' },
  Warm: { color: '#fbbf24', bg: 'rgba(251,191,36,0.14)' },
  Cold: { color: '#f87171', bg: 'rgba(248,113,113,0.14)' },
};
export function TierBadge({ tier }: { tier?: string }) {
  if (!tier) return <span style={{ color: 'var(--text-dim)' }}>—</span>;
  const s = TIER_STYLE[tier] ?? { color: 'var(--text-muted)', bg: 'var(--shell-hover-hard)' };
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: s.bg }}>{tier}</span>;
}
// Colour a funnel stage: settled-good (Active) green, terminal-bad (Rejected) red,
// holding amber, in-progress neutral gold.
export function funnelColor(f?: string): string {
  if (f === 'Active') return '#34d399';
  if (f === 'Rejected') return '#f87171';
  if (f === 'On Hold') return '#fbbf24';
  return '#C9A961';
}
