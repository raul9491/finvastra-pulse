import { useState, useMemo } from 'react';
import { useBankEligibility } from '../hooks/useBankEligibility';
import { useProviders, useOpportunityTypes } from '../hooks/useOpportunities';
import type { Opportunity, EligibilityResult, EligibilityVerdict } from '../../../types';

const VERDICT_STYLES: Record<EligibilityVerdict, { bg: string; text: string; dot: string; label: string }> = {
  likely:   { bg: '#F0FDF4', text: '#166534', dot: '#22C55E', label: 'Likely' },
  possible: { bg: '#FFFBEB', text: '#92400E', dot: '#F59E0B', label: 'Possible' },
  unlikely: { bg: '#FFF1F2', text: '#9F1239', dot: '#EF4444', label: 'Unlikely' },
};

interface Props {
  opportunity: Opportunity;
  lead: { monthlyIncome?: number; existingEmis?: number };
  foirPct: number | null;
}

export function BankEligibilityCard({ opportunity, lead, foirPct }: Props) {
  const providers = useProviders();
  const { types } = useOpportunityTypes();
  const [selectedResult, setSelectedResult] = useState<EligibilityResult | null>(null);

  const typeConfig = useMemo(
    () => types.find(t => t.name === opportunity.product),
    [types, opportunity.product],
  );

  const results = useBankEligibility(opportunity, lead, providers, typeConfig, foirPct);

  if (opportunity.opportunityType !== 'loan' || results.length === 0) return null;

  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>
            Bank Eligibility Snapshot
          </h3>
          <p className="text-xs" style={{ color: '#8B8B85' }}>Based on current applicant profile</p>
        </div>
        <div className="divide-y divide-slate-100">
          {results.map((r) => {
            const st = VERDICT_STYLES[r.verdict];
            return (
              <div key={r.providerId}
                className="flex items-center justify-between py-2.5 cursor-pointer hover:bg-slate-50 rounded px-1 transition-colors"
                onClick={() => setSelectedResult(r)}>
                <p className="text-sm" style={{ color: '#2A2A2A' }}>{r.providerName}</p>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: st.dot }} />
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: st.bg, color: st.text }}>{st.label}</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs mt-3" style={{ color: '#8B8B85' }}>
          Click any bank for details · {results.filter(r => r.verdict === 'likely').length} likely · {results.filter(r => r.verdict === 'possible').length} possible · {results.filter(r => r.verdict === 'unlikely').length} unlikely
        </p>
      </div>

      {/* Detail modal */}
      {selectedResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setSelectedResult(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold" style={{ color: '#0A0A0A' }}>{selectedResult.providerName}</h3>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: VERDICT_STYLES[selectedResult.verdict].bg, color: VERDICT_STYLES[selectedResult.verdict].text }}>
                {VERDICT_STYLES[selectedResult.verdict].label}
              </span>
            </div>
            {selectedResult.reasons.length === 0 ? (
              <p className="text-sm" style={{ color: '#8B8B85' }}>Passes all configured eligibility criteria.</p>
            ) : (
              <ul className="space-y-2">
                {selectedResult.reasons.map((r, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="shrink-0 mt-0.5" style={{ color: '#EF4444' }}>×</span>
                    <span style={{ color: '#2A2A2A' }}>{r}</span>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => setSelectedResult(null)}
              className="mt-4 w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl hover:bg-slate-50"
              style={{ color: '#2A2A2A' }}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
