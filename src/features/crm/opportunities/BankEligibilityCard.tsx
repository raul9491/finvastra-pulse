import { useState, useMemo } from 'react';
import { useBankEligibility } from '../hooks/useBankEligibility';
import { useProviders, useOpportunityTypes } from '../hooks/useOpportunities';
import type { Opportunity, EligibilityResult, EligibilityVerdict } from '../../../types';

const VERDICT_STYLES: Record<EligibilityVerdict, { bg: string; text: string; dot: string; label: string; badge: string }> = {
  likely:   { bg: 'rgba(52,211,153,0.12)', text: '#34d399', dot: '#34d399', label: 'Likely', badge: 'badge-glass-success' },
  possible: { bg: 'rgba(201,169,97,0.12)', text: '#C9A961', dot: '#C9A961', label: 'Possible', badge: 'badge-glass-warning' },
  unlikely: { bg: 'rgba(248,113,113,0.12)', text: '#f87171', dot: '#f87171', label: 'Unlikely', badge: 'badge-glass-danger' },
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
      <div className="glass-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Bank Eligibility Snapshot
          </h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Based on current applicant profile</p>
        </div>
        <div>
          {results.map((r, idx) => {
            const st = VERDICT_STYLES[r.verdict];
            return (
              <div key={r.providerId}
                className="flex items-center justify-between py-2.5 cursor-pointer hover:bg-white/5 rounded px-1 transition-colors"
                style={{ borderBottom: idx < results.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
                onClick={() => setSelectedResult(r)}>
                <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{r.providerName}</p>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: st.dot }} />
                  <span className={st.badge}>{st.label}</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
          Click any bank for details · {results.filter(r => r.verdict === 'likely').length} likely · {results.filter(r => r.verdict === 'possible').length} possible · {results.filter(r => r.verdict === 'unlikely').length} unlikely
        </p>
      </div>

      {/* Detail modal */}
      {selectedResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center glass-modal-overlay"
          onClick={() => setSelectedResult(null)}>
          <div className="glass-modal-panel p-6 w-full max-w-sm mx-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedResult.providerName}</h3>
              <span className={VERDICT_STYLES[selectedResult.verdict].badge}>
                {VERDICT_STYLES[selectedResult.verdict].label}
              </span>
            </div>
            {selectedResult.reasons.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Passes all configured eligibility criteria.</p>
            ) : (
              <ul className="space-y-2">
                {selectedResult.reasons.map((r, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="shrink-0 mt-0.5" style={{ color: '#f87171' }}>×</span>
                    <span style={{ color: 'var(--text-muted)' }}>{r}</span>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => setSelectedResult(null)}
              className="mt-4 w-full px-4 py-2.5 text-sm border rounded-xl hover:bg-white/5 transition-colors"
              style={{ color: 'var(--text-muted)', borderColor: 'rgba(255,255,255,0.12)' }}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
