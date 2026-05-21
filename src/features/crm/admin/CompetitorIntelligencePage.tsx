import { useState, useEffect, useMemo } from 'react';
import { collectionGroup, query, where, getDocs } from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '../../../lib/firebase';
import type { Opportunity, LostReason } from '../../../types';
import { LOST_REASON_LABELS } from '../../../types';
import { useAllEmployees } from '../../../lib/hooks/useProfile';

// Opportunity from collectionGroup doesn't carry leadId inline — we reconstruct
// it from the document reference path: leads/{leadId}/opportunities/{oppId}
interface LostOpportunity extends Opportunity {
  leadId: string;
}

function parseCapturedAt(capturedAt: unknown): Date | null {
  if (!capturedAt) return null;
  if (typeof capturedAt === 'object' && capturedAt !== null && 'toDate' in capturedAt) {
    return (capturedAt as { toDate: () => Date }).toDate();
  }
  return null;
}

// ─── Median helper ────────────────────────────────────────────────────────────
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function CompetitorIntelligencePage() {
  const [opps, setOpps] = useState<LostOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [reasonFilter, setReasonFilter] = useState<LostReason | ''>('');
  const [competitorSearch, setCompetitorSearch] = useState('');
  const { employees } = useAllEmployees();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getDocs(
      query(
        collectionGroup(db, 'opportunities'),
        where('status', '==', 'lost'),
      ),
    ).then((snap) => {
      if (cancelled) return;

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const results: LostOpportunity[] = [];
      snap.forEach((d) => {
        // path: leads/{leadId}/opportunities/{oppId}
        const segments = d.ref.path.split('/');
        const leadId = segments[1] ?? '';
        const opp = { id: d.id, leadId, ...d.data() } as LostOpportunity;

        // Client-side 90-day filter on capturedAt
        const capturedAt = parseCapturedAt(opp.lostDetails?.capturedAt);
        if (capturedAt && capturedAt < ninetyDaysAgo) return;
        // If no capturedAt yet, still include (e.g. legacy lost records)
        results.push(opp);
      });

      setOpps(results);
      setLoading(false);
    }).catch(() => setLoading(false));

    return () => { cancelled = true; };
  }, []);

  const authorName = (uid: string) =>
    employees.find((e) => e.userId === uid)?.displayName ?? uid.slice(0, 8);

  // ─── Aggregations ──────────────────────────────────────────────────────────
  const reasonCounts = useMemo(() => {
    const counts = new Map<LostReason, number>();
    opps.forEach((o) => {
      if (o.lostDetails?.reason) {
        counts.set(o.lostDetails.reason, (counts.get(o.lostDetails.reason) ?? 0) + 1);
      }
    });
    return counts;
  }, [opps]);

  const topReason = useMemo(() => {
    let max = 0;
    let top: LostReason | null = null;
    reasonCounts.forEach((count, reason) => {
      if (count > max) { max = count; top = reason; }
    });
    return top;
  }, [reasonCounts]);

  const competitorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    opps.forEach((o) => {
      const name = o.lostDetails?.competitorName?.trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return counts;
  }, [opps]);

  const topCompetitor = useMemo(() => {
    let max = 0;
    let top: string | null = null;
    competitorCounts.forEach((count, name) => {
      if (count > max) { max = count; top = name; }
    });
    return top ? { name: top, count: competitorCounts.get(top) ?? 0 } : null;
  }, [competitorCounts]);

  // ─── Filtered rows ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return opps.filter((o) => {
      if (reasonFilter && o.lostDetails?.reason !== reasonFilter) return false;
      if (competitorSearch) {
        const haystack = (o.lostDetails?.competitorName ?? '').toLowerCase();
        if (!haystack.includes(competitorSearch.toLowerCase())) return false;
      }
      return true;
    });
  }, [opps, reasonFilter, competitorSearch]);

  const medianRate = useMemo(() => {
    const rates = opps
      .map((o) => o.lostDetails?.competitorRate)
      .filter((r): r is number => typeof r === 'number');
    return median(rates);
  }, [opps]);

  const inputClass =
    'px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 transition-colors bg-white';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2
          className="text-3xl mb-1"
          style={{
            fontFamily: '"Fraunces", Georgia, serif',
            fontStyle: 'italic',
            fontWeight: 300,
            color: '#0A0A0A',
          }}
        >
          Competitor Intelligence
        </h2>
        <p className="text-sm" style={{ color: '#8B8B85' }}>
          Lost opportunities — last 90 days
        </p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-24 bg-slate-100 rounded-2xl" />
          <div className="h-64 bg-slate-100 rounded-2xl" />
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <p
                className="text-[10px] font-bold uppercase tracking-widest mb-1"
                style={{ color: '#8B8B85' }}
              >
                Total Lost
              </p>
              <p className="text-3xl font-semibold" style={{ color: '#0A0A0A' }}>
                {opps.length}
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <p
                className="text-[10px] font-bold uppercase tracking-widest mb-1"
                style={{ color: '#8B8B85' }}
              >
                Top Reason
              </p>
              {topReason ? (
                <>
                  <p className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>
                    {LOST_REASON_LABELS[topReason]}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>
                    {reasonCounts.get(topReason)} of {opps.length} (
                    {Math.round(((reasonCounts.get(topReason) ?? 0) / opps.length) * 100)}%)
                  </p>
                </>
              ) : (
                <p className="text-sm" style={{ color: '#8B8B85' }}>—</p>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <p
                className="text-[10px] font-bold uppercase tracking-widest mb-1"
                style={{ color: '#8B8B85' }}
              >
                Most Mentioned Competitor
              </p>
              {topCompetitor ? (
                <>
                  <p className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>
                    {topCompetitor.name}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>
                    {topCompetitor.count} mentions
                    {medianRate > 0 ? ` · median rate ${medianRate.toFixed(2)}%` : ''}
                  </p>
                </>
              ) : (
                <p className="text-sm" style={{ color: '#8B8B85' }}>—</p>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <select
              value={reasonFilter}
              onChange={(e) => setReasonFilter(e.target.value as LostReason | '')}
              className={inputClass}
            >
              <option value="">All reasons</option>
              {(Object.entries(LOST_REASON_LABELS) as [LostReason, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Search competitor…"
              value={competitorSearch}
              onChange={(e) => setCompetitorSearch(e.target.value)}
              className={`${inputClass} w-52`}
            />
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Date', 'Product', 'Deal Size', 'Reason', 'Competitor', 'Rate (%)', 'RM'].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest"
                          style={{ color: '#8B8B85' }}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: '#8B8B85' }}>
                        No lost opportunities found for the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((o) => {
                      const capturedAt = parseCapturedAt(o.lostDetails?.capturedAt);
                      return (
                        <tr key={`${o.leadId}-${o.id}`} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap" style={{ color: '#2A2A2A' }}>
                            {capturedAt ? format(capturedAt, 'dd MMM yyyy') : '—'}
                          </td>
                          <td className="px-4 py-3" style={{ color: '#2A2A2A' }}>{o.product}</td>
                          <td className="px-4 py-3 whitespace-nowrap" style={{ color: '#2A2A2A' }}>
                            ₹{o.dealSize.toLocaleString('en-IN')}
                          </td>
                          <td className="px-4 py-3" style={{ color: '#2A2A2A' }}>
                            {o.lostDetails?.reason
                              ? LOST_REASON_LABELS[o.lostDetails.reason]
                              : <span style={{ color: '#8B8B85' }}>—</span>}
                          </td>
                          <td className="px-4 py-3" style={{ color: '#2A2A2A' }}>
                            {o.lostDetails?.competitorName ?? <span style={{ color: '#8B8B85' }}>—</span>}
                          </td>
                          <td className="px-4 py-3 text-right" style={{ color: '#2A2A2A' }}>
                            {o.lostDetails?.competitorRate != null
                              ? `${o.lostDetails.competitorRate}%`
                              : <span style={{ color: '#8B8B85' }}>—</span>}
                          </td>
                          <td className="px-4 py-3" style={{ color: '#2A2A2A' }}>
                            {authorName(o.ownerId)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
