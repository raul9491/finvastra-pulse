import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { differenceInDays } from 'date-fns';
import { ChevronRight, Search } from 'lucide-react';
import { useAllOpenOpportunities } from '../hooks/useOpportunities';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import type { OpportunityType } from '../../../types';

const TYPE_LABELS: Record<OpportunityType, string> = {
  loan:      'Loan',
  wealth:    'Wealth',
  insurance: 'Insurance',
};

const TYPE_COLORS: Record<OpportunityType, { bg: string; text: string }> = {
  loan:      { bg: 'rgba(96,165,250,0.15)', text: '#60a5fa' },
  wealth:    { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
  insurance: { bg: 'rgba(201,169,97,0.15)', text: '#C9A961' },
};

function fmt(n: number) {
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function PipelinePage() {
  const navigate = useNavigate();
  const { rows, loading } = useAllOpenOpportunities();
  const { employees } = useAllEmployees();

  const [typeFilter, setTypeFilter]   = useState<OpportunityType | 'all'>('all');
  const [rmFilter, setRmFilter]       = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [search, setSearch]           = useState('');

  // Build RM display name map
  const rmMap = useMemo(() => {
    const m: Record<string, string> = {};
    employees.forEach((e) => { m[e.userId] = e.displayName ?? e.userId; });
    return m;
  }, [employees]);

  // Unique stages and RMs present in data
  const allStages = useMemo(() => [...new Set(rows.map((r) => r.stage))].sort(), [rows]);
  const allRMs    = useMemo(() => [...new Set(rows.map((r) => r.ownerId))], [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== 'all' && r.opportunityType !== typeFilter) return false;
      if (rmFilter  !== 'all' && r.ownerId  !== rmFilter)           return false;
      if (stageFilter !== 'all' && r.stage  !== stageFilter)        return false;
      if (q && !r.leadDisplayName.toLowerCase().includes(q) && !r.product.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, typeFilter, rmFilter, stageFilter, search]);

  // Summary stats
  const totalValue  = useMemo(() => filtered.reduce((s, r) => s + (r.dealSize ?? 0), 0), [filtered]);
  const byType      = useMemo(() => {
    const m: Record<OpportunityType, { count: number; value: number }> = {
      loan:      { count: 0, value: 0 },
      wealth:    { count: 0, value: 0 },
      insurance: { count: 0, value: 0 },
    };
    filtered.forEach((r) => {
      m[r.opportunityType].count++;
      m[r.opportunityType].value += r.dealSize ?? 0;
    });
    return m;
  }, [filtered]);

  const chipBase = 'text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors cursor-pointer select-none';
  const chipActive = 'border-transparent' ;
  const chipInactive = 'hover:bg-white/5';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2
          className="text-3xl mb-1"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}
        >
          Pipeline
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          All open deals across loans, wealth &amp; insurance
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="glass-panel glass-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Total Pipeline</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(totalValue)}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{filtered.length} open deals</p>
        </div>
        {(['loan', 'wealth', 'insurance'] as OpportunityType[]).map((t) => (
          <div key={t} className="glass-panel glass-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{TYPE_LABELS[t]}</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(byType[t].value)}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{byType[t].count} deals</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search customer or product…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="glass-inp text-sm pl-8 pr-3 py-1.5 rounded-full"
            style={{ minWidth: 220 }}
          />
        </div>

        {/* Business line chips */}
        <div className="flex items-center gap-1.5">
          {(['all', 'loan', 'wealth', 'insurance'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`${chipBase} ${typeFilter === t ? chipActive : chipInactive}`}
              style={typeFilter === t
                ? { backgroundColor: '#C9A961', color: '#0B1538', borderColor: '#C9A961' }
                : { backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', borderColor: 'rgba(255,255,255,0.12)' }
              }
            >
              {t === 'all' ? 'All types' : TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        {/* RM filter */}
        {allRMs.length > 1 && (
          <select
            value={rmFilter}
            onChange={(e) => setRmFilter(e.target.value)}
            className="glass-inp text-sm rounded-full px-3 py-1.5"
          >
            <option value="all">All RMs</option>
            {allRMs.map((id) => (
              <option key={id} value={id}>{rmMap[id] ?? id}</option>
            ))}
          </select>
        )}

        {/* Stage filter */}
        {allStages.length > 1 && (
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="glass-inp text-sm rounded-full px-3 py-1.5"
          >
            <option value="all">All stages</option>
            {allStages.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading pipeline…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            {rows.length === 0 ? 'No open deals yet.' : 'No deals match the current filters.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.04)' }}>
                {['Customer', 'Product', 'Type', 'Stage', 'Deal Size', 'RM', 'Expected Close', 'Age'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {h}
                  </th>
                ))}
                <th className="px-5 py-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => {
                const typeColor = TYPE_COLORS[row.opportunityType];
                const daysOpen  = row.createdAt?.toDate
                  ? differenceInDays(new Date(), row.createdAt.toDate())
                  : '—';
                const overdue   = row.expectedCloseDate && new Date(row.expectedCloseDate) < new Date();

                return (
                  <tr
                    key={row.oppId}
                    onClick={() => navigate(`/crm/leads/${row.leadId}/opportunities/${row.oppId}`)}
                    className="cursor-pointer transition-colors hover:bg-white/5"
                    style={{ borderBottom: idx < filtered.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
                  >
                    <td className="px-5 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                      {row.leadDisplayName}
                    </td>
                    <td className="px-5 py-3" style={{ color: 'var(--text-muted)' }}>
                      {row.product}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: typeColor.bg, color: typeColor.text }}
                      >
                        {TYPE_LABELS[row.opportunityType]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {row.stage}
                    </td>
                    <td className="px-5 py-3 font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {fmt(row.dealSize ?? 0)}
                    </td>
                    <td className="px-5 py-3" style={{ color: 'var(--text-muted)' }}>
                      {rmMap[row.ownerId] ?? '—'}
                    </td>
                    <td className="px-5 py-3 tabular-nums" style={{ color: overdue ? 'var(--status-danger)' : 'var(--text-muted)' }}>
                      {row.expectedCloseDate ?? '—'}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-xs" style={{ color: 'var(--text-muted)' }}>
                      {typeof daysOpen === 'number' ? `${daysOpen}d` : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <ChevronRight size={14} style={{ color: 'var(--text-dim)' }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
