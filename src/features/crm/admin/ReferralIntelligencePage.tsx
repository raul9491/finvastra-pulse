import { useState, useEffect, useMemo } from 'react';
import {
  collection,
  collectionGroup,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '../../../lib/firebase';
import type { Lead } from '../../../types';

interface ReferrerStats {
  name: string;
  leads: Lead[];
  converted: number;
  totalDealSize: number;
}

function parseTimestamp(ts: unknown): Date | null {
  if (!ts) return null;
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
    return (ts as { toDate: () => Date }).toDate();
  }
  return null;
}

export function ReferralIntelligencePage() {
  const [referrerMap, setReferrerMap] = useState<Map<string, ReferrerStats>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      // 1. Load all referral leads
      const leadsSnap = await getDocs(
        query(
          collection(db, 'leads'),
          where('source', '==', 'referral'),
          where('deleted', '==', false),
        ),
      );
      if (cancelled) return;

      const leads = leadsSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as Lead),
      );

      // 2. Load all won opportunities via collectionGroup to find converted leads
      const wonSnap = await getDocs(
        query(
          collectionGroup(db, 'opportunities'),
          where('status', '==', 'won'),
        ),
      );
      if (cancelled) return;

      // Build set of leadIds with at least one won opportunity
      const wonLeadIds = new Set<string>();
      // Also track total deal size per lead from won opps
      const dealSizeByLeadId = new Map<string, number>();
      wonSnap.forEach((d) => {
        const segments = d.ref.path.split('/');
        const leadId = segments[1] ?? '';
        wonLeadIds.add(leadId);
        const existing = dealSizeByLeadId.get(leadId) ?? 0;
        const dealSize = (d.data() as { dealSize?: number }).dealSize ?? 0;
        dealSizeByLeadId.set(leadId, existing + dealSize);
      });

      // 3. Group leads by referrerName
      const map = new Map<string, ReferrerStats>();
      leads.forEach((lead) => {
        const name = lead.referrerName?.trim() || '(Unknown)';
        const existing = map.get(name) ?? {
          name,
          leads: [],
          converted: 0,
          totalDealSize: 0,
        };
        existing.leads.push(lead);
        if (wonLeadIds.has(lead.id)) {
          existing.converted += 1;
          existing.totalDealSize += dealSizeByLeadId.get(lead.id) ?? 0;
        }
        map.set(name, existing);
      });

      if (!cancelled) {
        setReferrerMap(map);
        setLoading(false);
      }
    }

    load().catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(
    () =>
      Array.from(referrerMap.values()).sort((a, b) => {
        const rateA = a.leads.length > 0 ? a.converted / a.leads.length : 0;
        const rateB = b.leads.length > 0 ? b.converted / b.leads.length : 0;
        return rateB - rateA;
      }),
    [referrerMap],
  );

  const firstDate = (leads: Lead[]): Date | null => {
    const dates = leads
      .map((l) => parseTimestamp(l.createdAt))
      .filter((d): d is Date => d !== null);
    if (dates.length === 0) return null;
    return new Date(Math.min(...dates.map((d) => d.getTime())));
  };

  const lastDate = (leads: Lead[]): Date | null => {
    const dates = leads
      .map((l) => parseTimestamp(l.createdAt))
      .filter((d): d is Date => d !== null);
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates.map((d) => d.getTime())));
  };

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
            color: 'var(--text-primary)',
          }}
        >
          Referral Intelligence
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Performance by referrer — all time
        </p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-64 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="glass-panel p-12 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No referral leads found. Referral leads show up here once created with source = Referral.
          </p>
        </div>
      ) : (
        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {[
                    '#',
                    'Referrer Name',
                    'Total Leads',
                    'Converted',
                    'Conversion %',
                    'Total Deal Size',
                    'First Referral',
                    'Last Referral',
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const rate =
                    r.leads.length > 0
                      ? Math.round((r.converted / r.leads.length) * 100)
                      : 0;
                  const first = firstDate(r.leads);
                  const last = lastDate(r.leads);
                  const isTopThree = idx < 3;

                  return (
                    <tr
                      key={r.name}
                      className="hover:bg-white/5 transition-colors"
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <td className="px-4 py-3 text-center" style={{ color: 'var(--text-muted)' }}>
                        {isTopThree ? (
                          <span title="Top 3 by conversion rate">&#x1F451;</span>
                        ) : (
                          idx + 1
                        )}
                      </td>
                      <td
                        className="px-4 py-3 font-medium"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {r.name}
                      </td>
                      <td className="px-4 py-3 text-right" style={{ color: 'var(--text-primary)' }}>
                        {r.leads.length}
                      </td>
                      <td className="px-4 py-3 text-right" style={{ color: 'var(--text-primary)' }}>
                        {r.converted}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className="font-semibold"
                          style={{
                            color:
                              rate >= 60
                                ? '#34d399'
                                : rate >= 30
                                ? '#C9A961'
                                : 'var(--text-primary)',
                          }}
                        >
                          {rate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                        {r.totalDealSize > 0
                          ? `₹${r.totalDealSize.toLocaleString('en-IN')}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                        {first ? format(first, 'dd MMM yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                        {last ? format(last, 'dd MMM yyyy') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
