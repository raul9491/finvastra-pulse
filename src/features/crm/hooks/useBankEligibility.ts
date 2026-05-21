import { useMemo } from 'react';
import type { Opportunity, Provider, EligibilityResult, EligibilityVerdict, EligibilityRule } from '../../../types';

function checkEligibility(
  opportunity: Opportunity,
  lead: { monthlyIncome?: number; existingEmis?: number },
  rule: EligibilityRule,
  foirPct: number | null,
): { verdict: EligibilityVerdict; reasons: string[] } {
  const reasons: string[] = [];
  let failCount = 0;
  let borderlineCount = 0;

  if (rule.minMonthlyIncome && lead.monthlyIncome) {
    if (lead.monthlyIncome < rule.minMonthlyIncome) {
      reasons.push(`Income ₹${(lead.monthlyIncome / 1000).toFixed(0)}K below min ₹${(rule.minMonthlyIncome / 1000).toFixed(0)}K`);
      failCount++;
    } else if (lead.monthlyIncome < rule.minMonthlyIncome * 1.2) {
      reasons.push(`Income close to minimum (₹${(rule.minMonthlyIncome / 1000).toFixed(0)}K)`);
      borderlineCount++;
    }
  }

  if (rule.maxFoirPct && foirPct !== null) {
    if (foirPct > rule.maxFoirPct) {
      reasons.push(`FOIR ${foirPct}% exceeds max ${rule.maxFoirPct}%`);
      failCount++;
    } else if (foirPct > rule.maxFoirPct * 0.9) {
      reasons.push(`FOIR close to limit (max ${rule.maxFoirPct}%)`);
      borderlineCount++;
    }
  }

  if (rule.maxTicketSize) {
    const productKey = opportunity.product.toLowerCase().replace(/\s+/g, '_');
    const maxTicket = rule.maxTicketSize[productKey] ?? rule.maxTicketSize[opportunity.product];
    if (maxTicket !== undefined && opportunity.dealSize > maxTicket) {
      reasons.push(`Deal size ₹${(opportunity.dealSize / 100000).toFixed(0)}L exceeds bank max ₹${(maxTicket / 100000).toFixed(0)}L`);
      failCount++;
    }
  }

  const verdict: EligibilityVerdict = failCount > 0 ? 'unlikely' : borderlineCount > 0 ? 'possible' : 'likely';
  return { verdict, reasons };
}

export function useBankEligibility(
  opportunity: Opportunity | null | undefined,
  lead: { monthlyIncome?: number; existingEmis?: number } | null | undefined,
  providers: Provider[],
  typeConfig: { eligibleProviderIds?: string[] } | null | undefined,
  foirPct: number | null,
): EligibilityResult[] {
  return useMemo(() => {
    if (!opportunity || opportunity.opportunityType !== 'loan') return [];

    // Filter eligible providers — eligibleProviderIds contains provider NAMES (by design from seed data)
    const eligibleNames = typeConfig?.eligibleProviderIds ?? [];
    const eligibleProviders = eligibleNames.length > 0
      ? providers.filter(p => p.type === 'bank' && p.active && eligibleNames.includes(p.name))
      : providers.filter(p => p.type === 'bank' && p.active);

    const results: EligibilityResult[] = eligibleProviders.map(provider => {
      const rule = provider.eligibilityRules;
      if (!rule) {
        return { providerId: provider.id, providerName: provider.name, verdict: 'likely' as EligibilityVerdict, reasons: [] };
      }
      const { verdict, reasons } = checkEligibility(opportunity, lead ?? {}, rule, foirPct);
      return { providerId: provider.id, providerName: provider.name, verdict, reasons };
    });

    // Sort: likely → possible → unlikely
    const ORDER: Record<EligibilityVerdict, number> = { likely: 0, possible: 1, unlikely: 2 };
    return results.sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict]);
  }, [opportunity, lead, providers, typeConfig, foirPct]);
}
