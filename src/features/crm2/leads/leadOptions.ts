/**
 * Option lists and payload builders shared by the CRM 2.0 lead surfaces.
 * 
 * Labels come from ../labels so the stored enum values (HOT, WALKIN,
 * REFERRAL_SUBDSA...) stay untouched while the UI reads in plain words.
 * 
 * Extracted verbatim from Crm2LeadsPage.tsx (2026-07-23).
 */
import { categoryLabel, sourceLabel } from '../labels';
import type { Client, SubDsa, Crm2LeadFields } from '../../../types/crm2';
import type { Connector } from '../../../types';

// Priority shown as a Red / Yellow / Green traffic light (enum values unchanged).

/** Resolve a connector (FAC-) id → the channelPartner* attribution fields. */
export function buildChannelPartner(partnerId: string, connectors: Connector[]) {
  const p = connectors.find((c) => c.id === partnerId);
  return p
    ? { channelPartnerId: p.id, channelPartnerCode: p.connectorCode, channelPartnerName: p.displayName }
    : { channelPartnerId: null, channelPartnerCode: null, channelPartnerName: null };
}

export type LeadRow = Crm2LeadFields & { id: string };

// Priority shown as a Red / Yellow / Green traffic light (enum values unchanged).
export const PRIORITY_META: Record<'HOT' | 'WARM' | 'COLD', { label: string; color: string; dot: string }> = {
  HOT:  { label: 'High',   color: '#f87171', dot: '#ef4444' },
  WARM: { label: 'Medium', color: '#fbbf24', dot: '#f59e0b' },
  COLD: { label: 'Low',    color: '#34d399', dot: '#22c55e' },
};

export const PRIORITY_OPTS = (['HOT', 'WARM', 'COLD'] as const).map((p) => ({ value: p, label: `${PRIORITY_META[p].label} (${p === 'HOT' ? 'Red' : p === 'WARM' ? 'Yellow' : 'Green'})` }));

// Shared option/data props for the lead forms.
export type Opt = { value: string; label: string };
export type ProductOpt = Opt & { cat: string | null };   // cat = product's lead category (filters the picker)
// Products whose category matches the lead's category (uncategorised show for all — legacy-safe).
export const filterProductsByCat = (opts: ProductOpt[], cat: string) => opts.filter((o) => !o.cat || o.cat === cat);
export type RefData = { clients: Array<Client & { id: string }>; subDsas: Array<SubDsa & { id: string }>; connectors: Connector[] };
export const CATEGORY_OPTS = ['LOAN', 'WEALTH', 'INSURANCE', 'CIBIL_CHECK', 'PARTNER_DSA', 'GENERAL'].map((c) => ({ value: c, label: categoryLabel(c) }));
export const SOURCE_OPTS = ['WALKIN', 'COLD_CALL', 'REFERRAL_CLIENT', 'REFERRAL_SUBDSA', 'JUSTDIAL', 'ADS', 'WEBSITE'].map((s) => ({ value: s, label: sourceLabel(s) }));
export const CONSTITUTION_LEAD_OPTS = [{ value: '', label: '—' }, ...['INDIVIDUAL', 'PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PVT_LTD', 'HUF'].map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))];

/** Builds the referral payload (referredBy*) from the chosen source + picker value. */
export function buildReferral(source: string, refSubDsaId: string, refClientId: string, refData: RefData) {
  if (source === 'REFERRAL_SUBDSA' && refSubDsaId) {
    const s = refData.subDsas.find((x) => x.id === refSubDsaId);
    return { referredById: refSubDsaId, referredByType: 'SUBDSA', referredByName: s?.name ?? null, referredByCode: refSubDsaId };
  }
  if (source === 'REFERRAL_CLIENT' && refClientId) {
    const c = refData.clients.find((x) => x.id === refClientId);
    return { referredById: refClientId, referredByType: 'CLIENT', referredByName: c?.name ?? null, referredByCode: null };
  }
  return { referredById: null, referredByType: null, referredByName: null, referredByCode: null };
}
