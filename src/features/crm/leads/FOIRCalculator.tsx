import { useFOIR } from '../hooks/useFOIR';
import type { Opportunity, Lead } from '../../../types';

const STATUS_STYLES = {
  comfortable: { bg: '#F0FDF4', text: '#166534', label: 'Comfortable' },
  acceptable:  { bg: '#EFF6FF', text: '#1D4ED8', label: 'Acceptable' },
  tight:       { bg: '#FFFBEB', text: '#92400E', label: 'Tight' },
  risky:       { bg: '#FFF1F2', text: '#9F1239', label: 'Risky' },
};

interface Props {
  lead: Lead;
  opportunities: Opportunity[];
}

export function FOIRCalculator({ lead, opportunities }: Props) {
  // Use the first open loan opportunity
  const loanOpp = opportunities.find(o => o.opportunityType === 'loan' && o.status === 'open');
  const foir = useFOIR(lead, loanOpp);

  if (!loanOpp) return null;
  if (!lead.monthlyIncome) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#8B8B85' }}>FOIR Snapshot</h3>
        <p className="text-sm" style={{ color: '#8B8B85' }}>
          Add monthly income to this customer profile to see FOIR analysis.
        </p>
      </div>
    );
  }
  if (!foir) return null;

  const st = STATUS_STYLES[foir.status];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>FOIR Snapshot</h3>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full"
          style={{ backgroundColor: st.bg, color: st.text }}>{st.label}</span>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>FOIR</p>
          <p className="text-lg font-semibold" style={{ color: st.text }}>{foir.foirPct}%</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Proposed EMI</p>
          <p className="text-sm font-medium" style={{ color: '#0A0A0A' }}>₹{foir.proposedEmi.toLocaleString('en-IN')}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Total Obligations</p>
          <p className="text-sm font-medium" style={{ color: '#0A0A0A' }}>₹{foir.totalObligationsAfter.toLocaleString('en-IN')}</p>
        </div>
      </div>
      {foir.suggestions.map((s, i) => (
        <p key={i} className="text-xs mt-1" style={{ color: '#92400E' }}>→ {s}</p>
      ))}
      <p className="text-xs mt-2" style={{ color: '#8B8B85' }}>
        Based on {loanOpp.product} · ₹{(loanOpp.dealSize / 100000).toFixed(1)}L
      </p>
    </div>
  );
}
