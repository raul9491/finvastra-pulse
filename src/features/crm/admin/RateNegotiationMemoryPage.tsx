import { useState, useEffect, useMemo } from 'react';
import {
  collectionGroup,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '../../../lib/firebase';
import type { BankSubmission, Opportunity, Provider } from '../../../types';

// ─── Enriched row ─────────────────────────────────────────────────────────────
interface EnrichedSubmission {
  submission: BankSubmission;
  leadId: string;
  oppId: string;
  product: string;
  dealSize: number;
  providerName: string;
}

function parseTimestamp(ts: unknown): Date | null {
  if (!ts) return null;
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
    return (ts as { toDate: () => Date }).toDate();
  }
  return null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function RateNegotiationMemoryPage() {
  const [rows, setRows] = useState<EnrichedSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<Provider[]>([]);

  const [filterProduct, setFilterProduct] = useState('');
  const [filterProvider, setFilterProvider] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      // 1. Load providers for name lookup
      const provSnap = await getDocs(collection(db, 'providers'));
      if (cancelled) return;
      const providerList = provSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as Provider),
      );
      if (!cancelled) setProviders(providerList);

      const providerById = new Map(providerList.map((p) => [p.id, p]));

      // 2. Load sanctioned/disbursed bank_submissions with an interestRate
      const subSnap = await getDocs(
        query(
          collectionGroup(db, 'bank_submissions'),
          where('status', 'in', ['sanctioned', 'disbursed']),
          where('interestRate', '!=', null),
        ),
      );
      if (cancelled) return;

      // 3. For each submission, load parent opportunity
      // Path: leads/{leadId}/opportunities/{oppId}/bank_submissions/{subId}
      const enriched: EnrichedSubmission[] = [];

      await Promise.all(
        subSnap.docs.map(async (d) => {
          const segments = d.ref.path.split('/');
          // segments: ['leads', leadId, 'opportunities', oppId, 'bank_submissions', subId]
          const leadId = segments[1] ?? '';
          const oppId = segments[3] ?? '';

          const sub = { id: d.id, ...d.data() } as BankSubmission;

          // Load opportunity for product + dealSize
          let product = '';
          let dealSize = 0;
          try {
            const oppDoc = await getDoc(
              doc(db, 'leads', leadId, 'opportunities', oppId),
            );
            if (oppDoc.exists()) {
              const oppData = oppDoc.data() as Partial<Opportunity>;
              product = oppData.product ?? '';
              dealSize = oppData.dealSize ?? 0;
            }
          } catch {
            // opportunity not accessible — skip silently
          }

          const provider = providerById.get(sub.providerId);
          enriched.push({
            submission: sub,
            leadId,
            oppId,
            product,
            dealSize,
            providerName: provider?.name ?? sub.providerId,
          });
        }),
      );

      if (!cancelled) {
        // Sort by date descending
        enriched.sort((a, b) => {
          const aDate = parseTimestamp(a.submission.decisionAt ?? a.submission.disbursedAt);
          const bDate = parseTimestamp(b.submission.decisionAt ?? b.submission.disbursedAt);
          if (!aDate && !bDate) return 0;
          if (!aDate) return 1;
          if (!bDate) return -1;
          return bDate.getTime() - aDate.getTime();
        });
        setRows(enriched);
        setLoading(false);
      }
    }

    load().catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, []);

  // ─── Filter options ──────────────────────────────────────────────────────────
  const productOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.product).filter(Boolean))).sort(),
    [rows],
  );

  const providerOptions = useMemo(
    () =>
      providers
        .filter((p) => p.type === 'bank')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [providers],
  );

  // ─── Filtered rows ───────────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (filterProduct && r.product !== filterProduct) return false;
        if (filterProvider && r.submission.providerId !== filterProvider) return false;
        return true;
      }),
    [rows, filterProduct, filterProvider],
  );

  // ─── Stats ────────────────────────────────────────────────────────────────────
  const rates = filtered
    .map((r) => r.submission.interestRate)
    .filter((x): x is number => typeof x === 'number');

  const minRate = rates.length > 0 ? Math.min(...rates) : null;
  const maxRate = rates.length > 0 ? Math.max(...rates) : null;
  const medRate = rates.length > 0 ? median(rates) : null;

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
          Rate Negotiation Memory
        </h2>
        <p className="text-sm" style={{ color: '#8B8B85' }}>
          Sanctioned and disbursed loan rates — use this to benchmark negotiation
        </p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-24 bg-slate-100 rounded-2xl" />
          <div className="h-64 bg-slate-100 rounded-2xl" />
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <select
              value={filterProduct}
              onChange={(e) => setFilterProduct(e.target.value)}
              className={inputClass}
            >
              <option value="">All loan types</option>
              {productOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>

            <select
              value={filterProvider}
              onChange={(e) => setFilterProvider(e.target.value)}
              className={inputClass}
            >
              <option value="">All providers</option>
              {providerOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Stats banner */}
          {rates.length > 0 && (
            <div
              className="rounded-2xl px-6 py-4 text-sm"
              style={{ backgroundColor: '#F2EFE7', border: '1px solid #C9A961' }}
            >
              <span style={{ color: '#9A7E3F', fontWeight: 600 }}>
                Rate range:
              </span>{' '}
              <span style={{ color: '#0A0A0A' }}>
                {minRate?.toFixed(2)}% – {maxRate?.toFixed(2)}%
              </span>
              <span style={{ color: '#8B8B85' }}>{' · '}</span>
              <span style={{ color: '#9A7E3F', fontWeight: 600 }}>Median:</span>{' '}
              <span style={{ color: '#0A0A0A' }}>{medRate?.toFixed(2)}%</span>
              <span style={{ color: '#8B8B85' }}>
                {' '}· Based on {rates.length} sanctioned application
                {rates.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    {[
                      'Provider',
                      'Loan Type',
                      'Deal Size',
                      'Interest Rate',
                      'Tenure',
                      'Status',
                      'Date',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest"
                        style={{ color: '#8B8B85' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-8 text-center text-sm"
                        style={{ color: '#8B8B85' }}
                      >
                        No sanctioned applications with recorded interest rates.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((r) => {
                      const dateRaw =
                        r.submission.disbursedAt ?? r.submission.decisionAt;
                      const date = parseTimestamp(dateRaw);
                      return (
                        <tr
                          key={`${r.leadId}-${r.oppId}-${r.submission.id}`}
                          className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                        >
                          <td
                            className="px-4 py-3 font-medium"
                            style={{ color: '#0A0A0A' }}
                          >
                            {r.providerName}
                          </td>
                          <td className="px-4 py-3" style={{ color: '#2A2A2A' }}>
                            {r.product || '—'}
                          </td>
                          <td
                            className="px-4 py-3 whitespace-nowrap"
                            style={{ color: '#2A2A2A' }}
                          >
                            {r.dealSize > 0
                              ? `₹${r.dealSize.toLocaleString('en-IN')}`
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">
                            <span
                              style={{
                                color:
                                  (r.submission.interestRate ?? 0) <= 9
                                    ? '#166534'
                                    : (r.submission.interestRate ?? 0) <= 12
                                    ? '#9A3412'
                                    : '#2A2A2A',
                              }}
                            >
                              {r.submission.interestRate?.toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right" style={{ color: '#2A2A2A' }}>
                            {r.submission.tenureMonths != null
                              ? `${r.submission.tenureMonths} mo`
                              : '—'}
                          </td>
                          <td className="px-4 py-3" style={{ color: '#2A2A2A' }}>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                                r.submission.status === 'disbursed'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              {r.submission.status}
                            </span>
                          </td>
                          <td
                            className="px-4 py-3 whitespace-nowrap"
                            style={{ color: '#2A2A2A' }}
                          >
                            {date ? format(date, 'dd MMM yyyy') : '—'}
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
