import { useMemo } from 'react';
import type { FOIRResult, FOIRStatus, Opportunity } from '../../../types';

// Standard EMI formula: EMI = P × r × (1+r)^n / ((1+r)^n - 1)
// where r = monthly interest rate (annual% / 12 / 100), n = tenureMonths
function calculateEMI(principal: number, annualRatePct: number, tenureMonths: number): number {
  if (tenureMonths <= 0 || principal <= 0) return 0;
  if (annualRatePct <= 0) return principal / tenureMonths;
  const r = annualRatePct / 12 / 100;
  const n = tenureMonths;
  return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

export function useFOIR(
  lead: { monthlyIncome?: number; existingEmis?: number } | null | undefined,
  opportunity: Opportunity | null | undefined,
  estimatedRate?: number,  // % per annum; fallback to 9.5
): FOIRResult | null {
  return useMemo(() => {
    if (!lead?.monthlyIncome || !opportunity) return null;
    if (opportunity.opportunityType !== 'loan') return null;
    if (!opportunity.dealSize) return null;

    const income = lead.monthlyIncome;
    const existing = lead.existingEmis ?? 0;

    // Get tenure from customFields, fall back to 240 months
    const tenureMonths = typeof opportunity.customFields?.tenureMonths === 'number'
      ? (opportunity.customFields.tenureMonths as number)
      : 240;
    const rate = estimatedRate ?? 9.5;

    const proposedEmi = Math.round(calculateEMI(opportunity.dealSize, rate, tenureMonths));
    const totalObligationsAfter = existing + proposedEmi;
    const foirPct = Math.round((totalObligationsAfter / income) * 1000) / 10; // 1 decimal

    let status: FOIRStatus;
    if (foirPct < 40) status = 'comfortable';
    else if (foirPct < 50) status = 'acceptable';
    else if (foirPct < 55) status = 'tight';
    else status = 'risky';

    const suggestions: string[] = [];
    if (status === 'tight' || status === 'risky') {
      // Suggest reduced amount to reach acceptable (50% FOIR)
      const maxTotal = income * 0.50;
      const maxProposedEmi = Math.max(0, maxTotal - existing);
      // Back-calculate principal from max EMI
      const r = rate / 12 / 100;
      const n = tenureMonths;
      const maxPrincipal = maxProposedEmi > 0 && r > 0
        ? Math.round(maxProposedEmi * (Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n)) / 100000) * 100000
        : 0;
      if (maxPrincipal > 0 && maxPrincipal < opportunity.dealSize) {
        suggestions.push(`Reduce loan amount to ₹${(maxPrincipal / 100000).toFixed(1)}L to reach acceptable FOIR`);
      }
      // Suggest extending tenure
      const extendedTenure = Math.min(360, tenureMonths + 60);
      const extendedEmi = Math.round(calculateEMI(opportunity.dealSize, rate, extendedTenure));
      const extendedFoir = Math.round((existing + extendedEmi) / income * 1000) / 10;
      if (extendedFoir < 50) {
        suggestions.push(`Extend tenure to ${extendedTenure} months (FOIR: ${extendedFoir}%)`);
      }
    }

    return { proposedEmi, totalObligationsAfter, foirPct, status, suggestions };
  }, [lead?.monthlyIncome, lead?.existingEmis, opportunity, estimatedRate]);
}
