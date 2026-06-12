import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { differenceInDays, format } from 'date-fns';
import { Search, LayoutGrid, List, AlertCircle, Clock } from 'lucide-react';
import { useAllOpenOpportunities, useOpportunityTypes } from '../hooks/useOpportunities';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import type { OpportunityType } from '../../../types';

// ─── Constants ───────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<OpportunityType, string> = {
  loan:      'Loan',
  wealth:    'Wealth',
  insurance: 'Insurance',
};

const TYPE_COLORS: Record<OpportunityType, { bg: string; text: string; border: string }> = {
  loan:      { bg: 'rgba(96,165,250,0.15)',   text: '#60a5fa', border: '#60a5fa' },
  wealth:    { bg: 'rgba(52,211,153,0.15)',   text: '#34d399', border: '#34d399' },
  insurance: { bg: 'rgba(201,169,97,0.15)',   text: '#C9A961', border: '#C9A961' },
};

// Stage column accent colours — cycle through a palette
const STAGE_ACCENTS = [
  '#C9A961', '#60a5fa', '#34d399', '#a78bfa', '#fb923c',
  '#f472b6', '#38bdf8', '#4ade80', '#facc15',
];

function fmt(n: number) {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000)    return `₹${(n / 100_000).toFixed(1)}L`;
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

type ViewMode = 'board' | 'table';

// ─── Kanban Card ─────────────────────────────────────────────────────────────

interface KanbanCardProps {
  row: ReturnType<typeof useAllOpenOpportunities>['rows'][number];
  rmName: string;
  onClick: () => void;
}

function KanbanCard({ row, rmName, onClick }: KanbanCardProps) {
  const tc        = TYPE_COLORS[row.opportunityType];
  const daysOpen  = row.createdAt?.toDate
    ? differenceInDays(new Date(), row.createdAt.toDate())
    : null;
  const overdue   = row.expectedCloseDate && new Date(row.expectedCloseDate) < new Date();
  const dueSoon   = !overdue && row.expectedCloseDate &&
    differenceInDays(new Date(row.expectedCloseDate), new Date()) <= 7;

  return (
    <div
      onClick={onClick}
      className="rounded-xl cursor-pointer transition-all hover:scale-[1.01] hover:shadow-lg"
      style={{
        backgroundColor: 'var(--glass-panel-bg)',
        border: '1px solid var(--shell-border-mid)',
        borderLeft: `3px solid ${tc.border}`,
        padding: '12px 14px',
      }}
    >
      {/* Top row: type badge + age */}
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
          style={{ backgroundColor: tc.bg, color: tc.text }}
        >
          {TYPE_LABELS[row.opportunityType]}
        </span>
        {daysOpen !== null && (
          <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-muted)' }}>
            <Clock size={9} />
            {daysOpen}d
          </span>
        )}
      </div>

      {/* Customer name */}
      <p
        className="text-sm font-semibold mb-0.5 leading-tight"
        style={{ color: 'var(--text-primary)' }}
      >
        {row.leadDisplayName}
      </p>

      {/* Product */}
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        {row.product}
      </p>

      {/* Deal size */}
      <p className="text-base font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
        {fmt(row.dealSize ?? 0)}
      </p>

      {/* Footer: RM + close date */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
            style={{ backgroundColor: 'rgba(201,169,97,0.25)', color: '#C9A961' }}
          >
            {rmName.charAt(0).toUpperCase()}
          </div>
          <span className="text-[10px] truncate max-w-20" style={{ color: 'var(--text-muted)' }}>
            {rmName}
          </span>
        </div>
        {(overdue || dueSoon) && (
          <span
            className="text-[9px] font-semibold flex items-center gap-0.5 px-1.5 py-0.5 rounded-full"
            style={{
              backgroundColor: overdue ? 'rgba(248,113,113,0.15)' : 'rgba(251,146,60,0.15)',
              color: overdue ? '#f87171' : '#fb923c',
            }}
          >
            <AlertCircle size={8} />
            {overdue ? 'Overdue' : 'Due soon'}
          </span>
        )}
        {row.expectedCloseDate && !overdue && !dueSoon && (
          <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
            {format(new Date(row.expectedCloseDate), 'd MMM')}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Kanban Column ────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  stage: string;
  accentColor: string;
  cards: ReturnType<typeof useAllOpenOpportunities>['rows'];
  rmMap: Record<string, string>;
  onCardClick: (leadId: string, oppId: string) => void;
}

function KanbanColumn({ stage, accentColor, cards, rmMap, onCardClick }: KanbanColumnProps) {
  const totalValue = cards.reduce((s, r) => s + (r.dealSize ?? 0), 0);

  return (
    <div
      className="flex flex-col shrink-0 rounded-2xl"
      style={{
        width: 270,
        backgroundColor: 'var(--shell-hover-soft)',
        border: '1px solid var(--shell-border)',
      }}
    >
      {/* Column header */}
      <div
        className="px-4 py-3 rounded-t-2xl"
        style={{
          borderBottom: `2px solid ${accentColor}`,
          backgroundColor: 'var(--shell-hover-soft)',
        }}
      >
        <div className="flex items-center justify-between mb-0.5">
          <p
            className="text-xs font-bold uppercase tracking-widest truncate"
            style={{ color: accentColor }}
          >
            {stage}
          </p>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ml-2"
            style={{ backgroundColor: `${accentColor}22`, color: accentColor }}
          >
            {cards.length}
          </span>
        </div>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {fmt(totalValue)}
        </p>
      </div>

      {/* Cards */}
      <div
        className="flex-1 overflow-y-auto p-3 space-y-2.5"
        style={{ maxHeight: 'calc(100vh - 320px)', minHeight: 80 }}
      >
        {cards.length === 0 ? (
          <div className="flex items-center justify-center h-16">
            <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Empty</p>
          </div>
        ) : (
          cards.map((row) => (
            <KanbanCard
              key={row.oppId}
              row={row}
              rmName={rmMap[row.ownerId] ?? row.ownerId.slice(0, 6)}
              onClick={() => onCardClick(row.leadId, row.oppId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── PipelinePage ─────────────────────────────────────────────────────────────

export function PipelinePage() {
  const navigate = useNavigate();
  const { rows, loading }  = useAllOpenOpportunities();
  const { types }          = useOpportunityTypes();
  const { employees }      = useAllEmployees();

  const [viewMode, setViewMode]     = useState<ViewMode>('board');
  const [typeFilter, setTypeFilter] = useState<OpportunityType | 'all'>('all');
  const [rmFilter, setRmFilter]     = useState('all');
  const [search, setSearch]         = useState('');

  // ── RM display name map ──
  const rmMap = useMemo(() => {
    const m: Record<string, string> = {};
    employees.forEach((e) => { m[e.userId] = e.displayName ?? e.userId; });
    return m;
  }, [employees]);

  // ── Unique RMs present in data ──
  const allRMs = useMemo(() => [...new Set(rows.map((r) => r.ownerId))], [rows]);

  // ── Filtered rows ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== 'all' && r.opportunityType !== typeFilter) return false;
      if (rmFilter  !== 'all' && r.ownerId !== rmFilter)            return false;
      if (q && !r.leadDisplayName.toLowerCase().includes(q) && !r.product.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, typeFilter, rmFilter, search]);

  // ── Stage ordering (derives from opportunity_types config) ──
  // When a specific type is selected, use that type's stages in order.
  // When 'all', merge all unique stages preserving first-seen order.
  const orderedStages = useMemo(() => {
    const businessLine = typeFilter === 'all' ? null : typeFilter;
    const relevantTypes = businessLine
      ? types.filter((t) => t.businessLine === businessLine && t.active)
      : types.filter((t) => t.active);

    const seen = new Set<string>();
    const stages: string[] = [];
    for (const t of relevantTypes) {
      for (const s of (t.stages ?? [])) {
        if (!seen.has(s)) { seen.add(s); stages.push(s); }
      }
    }

    // Fallback: use stages present in filtered rows when types aren't seeded yet
    if (stages.length === 0) {
      const fromRows = [...new Set(filtered.map((r) => r.stage))];
      return fromRows;
    }

    return stages;
  }, [types, typeFilter, filtered]);

  // ── Summary stats ──
  const totalValue = useMemo(() => filtered.reduce((s, r) => s + (r.dealSize ?? 0), 0), [filtered]);
  const byType = useMemo(() => {
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

  const chipBase     = 'text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors cursor-pointer select-none';
  const chipInactive = 'hover:bg-(--shell-hover-soft)';

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>

      {/* ── Fixed header area ── */}
      <div className="space-y-4 pb-4">

        {/* Title + view toggle */}
        <div className="flex items-start justify-between gap-4">
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

          {/* Board / Table toggle */}
          <div
            className="flex gap-1 rounded-lg p-1 shrink-0"
            style={{ backgroundColor: 'var(--glass-panel-bg)' }}
          >
            <button
              onClick={() => setViewMode('board')}
              title="Board view"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={{
                backgroundColor: viewMode === 'board' ? 'var(--shell-hover-hard)' : 'transparent',
                color: viewMode === 'board' ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              <LayoutGrid size={13} /> Board
            </button>
            <button
              onClick={() => setViewMode('table')}
              title="Table view"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={{
                backgroundColor: viewMode === 'table' ? 'var(--shell-hover-hard)' : 'transparent',
                color: viewMode === 'table' ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              <List size={13} /> Table
            </button>
          </div>
        </div>

        {/* Summary cards — 2×2 on phones, 4 across on desktop */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="glass-panel glass-card p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Total Pipeline</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(totalValue)}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{filtered.length} open deals</p>
          </div>
          {(['loan', 'wealth', 'insurance'] as OpportunityType[]).map((t) => (
            <div
              key={t}
              onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
              className="glass-panel glass-card p-4 cursor-pointer transition-all hover:scale-[1.02]"
              style={{ borderLeft: typeFilter === t ? `3px solid ${TYPE_COLORS[t].border}` : undefined }}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: TYPE_COLORS[t].text }}>
                {TYPE_LABELS[t]}
              </p>
              <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(byType[t].value)}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{byType[t].count} deals</p>
            </div>
          ))}
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search customer or product…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="glass-inp text-sm pl-8 pr-3 py-1.5 rounded-full"
              style={{ minWidth: 200 }}
            />
          </div>

          {/* Business line chips */}
          <div className="flex items-center gap-1.5">
            {(['all', 'loan', 'wealth', 'insurance'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`${chipBase} ${typeFilter === t ? '' : chipInactive}`}
                style={typeFilter === t
                  ? { backgroundColor: '#C9A961', color: '#0B1538', borderColor: '#C9A961' }
                  : { backgroundColor: 'var(--glass-panel-bg)', color: 'var(--text-muted)', borderColor: 'var(--shell-border-mid)' }
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
        </div>
      </div>

      {/* ── BOARD VIEW ── */}
      {viewMode === 'board' && (() => {
        // Only stages that actually hold deals get a column — a row of giant
        // empty columns (especially on phones) read as broken UI.
        const stagesWithCards = orderedStages.filter((s) => filtered.some((r) => r.stage === s));
        const hiddenEmpty = orderedStages.length - stagesWithCards.length;

        if (loading) {
          return (
            <div className="flex gap-4 overflow-x-auto pb-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="shrink-0 rounded-2xl animate-pulse"
                  style={{ width: 270, height: 280, backgroundColor: 'var(--glass-panel-bg)' }} />
              ))}
            </div>
          );
        }

        if (orderedStages.length === 0) {
          return (
            <div className="glass-panel py-20 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No stages configured yet.</p>
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Run Seed CRM Config from the Dashboard first.</p>
            </div>
          );
        }

        if (filtered.length === 0) {
          return (
            <div className="glass-panel py-16 text-center" style={{ borderStyle: 'dashed' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {rows.length === 0 ? 'No open deals yet.' : 'No deals match the current filters.'}
              </p>
              <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Deals appear here as soon as opportunities are added to customers.
              </p>
            </div>
          );
        }

        return (
          <>
            {/* Mobile: stages stack vertically — no sideways hunting */}
            <div className="md:hidden space-y-4 pb-4">
              {stagesWithCards.map((stage) => {
                const idx = orderedStages.indexOf(stage);
                const accentColor = STAGE_ACCENTS[idx % STAGE_ACCENTS.length];
                const stageCards = filtered.filter((r) => r.stage === stage);
                const totalValue = stageCards.reduce((s, r) => s + (r.dealSize ?? 0), 0);
                return (
                  <div key={stage} className="rounded-2xl overflow-hidden"
                    style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}>
                    <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: `2px solid ${accentColor}` }}>
                      <p className="text-xs font-bold uppercase tracking-widest" style={{ color: accentColor }}>{stage}</p>
                      <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                        {stageCards.length} · {fmt(totalValue)}
                      </p>
                    </div>
                    <div className="p-3 space-y-2.5">
                      {stageCards.map((row) => (
                        <KanbanCard key={row.oppId} row={row}
                          rmName={rmMap[row.ownerId] ?? row.ownerId.slice(0, 6)}
                          onClick={() => navigate(`/crm/leads/${row.leadId}/opportunities/${row.oppId}`)} />
                      ))}
                    </div>
                  </div>
                );
              })}
              {hiddenEmpty > 0 && (
                <p className="text-xs text-center" style={{ color: 'var(--text-dim)' }}>
                  {hiddenEmpty} empty stage{hiddenEmpty !== 1 ? 's' : ''} hidden
                </p>
              )}
            </div>

            {/* Desktop: classic horizontal board, populated columns only */}
            <div className="hidden md:block overflow-x-auto pb-4" style={{ flex: 1, minHeight: 0 }}>
              <div className="flex gap-4" style={{ width: 'max-content', minWidth: '100%' }}>
                {stagesWithCards.map((stage) => {
                  const idx = orderedStages.indexOf(stage);
                  const accentColor = STAGE_ACCENTS[idx % STAGE_ACCENTS.length];
                  const stageCards = filtered.filter((r) => r.stage === stage);
                  return (
                    <KanbanColumn
                      key={stage}
                      stage={stage}
                      accentColor={accentColor}
                      cards={stageCards}
                      rmMap={rmMap}
                      onCardClick={(leadId, oppId) =>
                        navigate(`/crm/leads/${leadId}/opportunities/${oppId}`)
                      }
                    />
                  );
                })}
              </div>
              {hiddenEmpty > 0 && (
                <p className="text-xs mt-2" style={{ color: 'var(--text-dim)' }}>
                  {hiddenEmpty} empty stage{hiddenEmpty !== 1 ? 's' : ''} hidden
                </p>
              )}
            </div>
          </>
        );
      })()}

      {/* ── TABLE VIEW ── */}
      {viewMode === 'table' && (
        <div className="glass-panel overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Loading pipeline…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              {rows.length === 0 ? 'No open deals yet.' : 'No deals match the current filters.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--shell-border)', backgroundColor: 'var(--shell-hover-soft)' }}>
                    {['Customer', 'Product', 'Type', 'Stage', 'Deal Size', 'RM', 'Expected Close', 'Age'].map((h) => (
                      <th
                        key={h}
                        className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {h}
                      </th>
                    ))}
                    <th className="px-5 py-3 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, idx) => {
                    const tc      = TYPE_COLORS[row.opportunityType];
                    const daysOpen = row.createdAt?.toDate
                      ? differenceInDays(new Date(), row.createdAt.toDate())
                      : '—';
                    const overdue  = row.expectedCloseDate && new Date(row.expectedCloseDate) < new Date();

                    return (
                      <tr
                        key={row.oppId}
                        onClick={() => navigate(`/crm/leads/${row.leadId}/opportunities/${row.oppId}`)}
                        className="cursor-pointer transition-colors hover:bg-(--shell-hover-soft)"
                        style={{ borderBottom: idx < filtered.length - 1 ? '1px solid var(--shell-border)' : 'none' }}
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
                            style={{ backgroundColor: tc.bg, color: tc.text }}
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
                        <td
                          className="px-5 py-3 tabular-nums"
                          style={{ color: overdue ? '#f87171' : 'var(--text-muted)' }}
                        >
                          {row.expectedCloseDate ?? '—'}
                        </td>
                        <td className="px-5 py-3 tabular-nums text-xs" style={{ color: 'var(--text-muted)' }}>
                          {typeof daysOpen === 'number' ? `${daysOpen}d` : '—'}
                        </td>
                        <td className="px-5 py-3">
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
