/**
 * Shared widgets for the role-based CRM Home — salvaged from the retired
 * CrmDashboardPage (2026-07-03 simplification). Pure presentation + one light
 * aggregation hook; no business logic.
 */
import { useState, useMemo, useEffect } from 'react';
import { collectionGroup, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { DataView } from '../../../components/ui/DataView';
import { RePie } from '../../../components/ui/charts';
import type { Lead, LeadSource } from '../../../types';

export interface OppRaw {
  opportunityType: 'loan' | 'wealth' | 'insurance';
  dealSize: number;
  ownerId: string;
}

export function fmtRupees(n: number): string {
  if (!n) return '₹0';
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000)    return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000)      return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export const SOURCE_LABELS: Partial<Record<LeadSource, string>> = {
  website:      'Website',
  instagram:    'Instagram',
  facebook:     'Facebook',
  social_meta:  'Social (Meta)',
  walkin:       'Walk-in',
  referral:     'Referral',
  sub_dsa:      'Connector',
  broker:       'Broker',
  offline_bulk: 'Offline Bulk',
};

// Lightweight open-opps aggregation (no per-lead fetches) — pipeline totals only.
export function useOpenOppsStats() {
  const [opps, setOpps]       = useState<OppRaw[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collectionGroup(db, 'opportunities'), where('status', '==', 'open'));
    return onSnapshot(q, (snap) => {
      setOpps(snap.docs.map((d) => {
        const data = d.data() as OppRaw;
        return { opportunityType: data.opportunityType, dealSize: data.dealSize ?? 0, ownerId: data.ownerId };
      }));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  return { opps, loading };
}

export function BizLineCard({
  icon, label, count, pipelineValue, color, loading,
}: {
  icon: React.ReactNode; label: string; count: number; pipelineValue: number;
  color: string; loading: boolean;
}) {
  return (
    <div className="glass-panel p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: color + '22', color }}>
          {icon}
        </div>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</p>
      </div>
      {loading ? (
        <div className="space-y-1.5">
          <div className="h-7 w-20 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
          <div className="h-3.5 w-14 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
        </div>
      ) : (
        <>
          <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtRupees(pipelineValue)}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {count} open deal{count !== 1 ? 's' : ''}
          </p>
        </>
      )}
    </div>
  );
}

export function SourceBreakdown({ leads }: { leads: Lead[] }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    leads.forEach((l) => {
      const label = SOURCE_LABELS[l.source] ?? l.source ?? 'Unknown';
      map.set(label, (map.get(label) ?? 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [leads]);

  const total = leads.length || 1;

  if (counts.length === 0) return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No leads yet.</p>;

  return (
    <DataView headless
      graph={<RePie height={230} data={counts.map(([name, value]) => ({ name, value }))} />}
      table={
        <div className="space-y-2.5">
          {counts.map(([source, count]) => (
            <div key={source} className="flex items-center gap-3">
              <span className="text-xs w-24 shrink-0 truncate" style={{ color: 'var(--text-muted)' }}>{source}</span>
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${(count / total) * 100}%`, backgroundColor: '#C9A961' }} />
              </div>
              <span className="text-xs font-semibold w-8 text-right shrink-0" style={{ color: 'var(--text-primary)' }}>{count}</span>
            </div>
          ))}
        </div>
      }
    />
  );
}
