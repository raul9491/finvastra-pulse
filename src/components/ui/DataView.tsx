// ─── DataView — Table ⇄ Graph toggle for a report block ───────────────────────
// A titled card that shows the SAME data as either a Table or a Graph, with a
// switcher. Default view follows the device: GRAPH on mobile (reads better on a
// phone), TABLE on desktop — both overridable, and the choice is remembered per
// breakpoint. Optional per-report Share button (grants a colleague access via the
// existing Phase-P page-share; self-hides for non-super-admins).
//
// Presentation only — it just switches between two nodes the page already built.

import { useEffect, useState, type ReactNode } from 'react';
import { Table2, BarChart3 } from 'lucide-react';
import { SharePageButton } from './SharePageButton';
import type { PageKey } from '../../config/shareablePages';

type ViewMode = 'table' | 'graph';

function isMobileViewport(): boolean {
  try { return window.matchMedia('(max-width: 768px)').matches; } catch { return false; }
}

export function DataView({ title, subtitle, table, graph, pageKey, actions, height, className, headless, defaultMode }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  table: ReactNode;
  graph: ReactNode;
  pageKey?: PageKey;
  actions?: ReactNode;
  height?: number;          // optional fixed min-height to stop layout jump on switch
  className?: string;
  headless?: boolean;       // render just the toggle + body (no card/title) — for use inside an existing section
  defaultMode?: ViewMode;   // override the per-breakpoint default
}) {
  // Default per breakpoint, remembered separately for mobile vs desktop so a
  // desktop "Table" choice never forces Table onto the phone.
  const [mode, setMode] = useState<ViewMode | null>(null);

  useEffect(() => {
    const mobile = isMobileViewport();
    const key = `fv-report-view-${mobile ? 'm' : 'd'}`;
    let initial: ViewMode = defaultMode ?? (mobile ? 'graph' : 'table');
    try {
      const saved = localStorage.getItem(key);
      if (saved === 'table' || saved === 'graph') initial = saved;
    } catch { /* ignore */ }
    setMode(initial);
  }, [defaultMode]);

  const choose = (m: ViewMode) => {
    setMode(m);
    try { localStorage.setItem(`fv-report-view-${isMobileViewport() ? 'm' : 'd'}`, m); } catch { /* ignore */ }
  };

  const seg = (m: ViewMode, label: string, Icon: typeof Table2) => {
    const active = mode === m;
    return (
      <button
        onClick={() => choose(m)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors"
        style={active
          ? { backgroundColor: 'rgba(201,169,97,0.16)', color: '#C9A961' }
          : { color: 'var(--text-muted)' }}
        aria-pressed={active}
      >
        <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
      </button>
    );
  };

  const switcher = (
    <div className="flex items-center gap-0.5 p-0.5 rounded-lg" style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}>
      {seg('table', 'Table', Table2)}
      {seg('graph', 'Graph', BarChart3)}
    </div>
  );

  if (headless) {
    return (
      <div className={className}>
        <div className="flex items-center justify-end gap-1.5 mb-3">
          {actions}
          {pageKey && <SharePageButton pageKey={pageKey} />}
          {switcher}
        </div>
        <div style={height ? { minHeight: height } : undefined}>
          {mode === null ? null : mode === 'graph' ? graph : table}
        </div>
      </div>
    );
  }

  return (
    <div className={`glass-panel glass-card p-4 sm:p-5 ${className ?? ''}`} style={{ borderRadius: 'var(--radius-lg)' }}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          {title && <h3 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{title}</h3>}
          {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {actions}
          {pageKey && <SharePageButton pageKey={pageKey} />}
          {switcher}
        </div>
      </div>

      {/* Body */}
      <div style={height ? { minHeight: height } : undefined}>
        {mode === null ? null : mode === 'graph' ? graph : table}
      </div>
    </div>
  );
}

// ── SimpleTable — a clean, theme-aware table for the "Table" view ─────────────
export interface Column<T> {
  key: string;
  label: ReactNode;
  align?: 'left' | 'right' | 'center';
  render?: (row: T) => ReactNode;
}

export function SimpleTable<T extends Record<string, unknown>>({ columns, rows, empty }: {
  columns: Column<T>[]; rows: T[]; empty?: ReactNode;
}) {
  if (!rows.length) {
    return <p className="text-sm text-center py-8" style={{ color: 'var(--text-dim)' }}>{empty ?? 'No data for this period.'}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--shell-border)' }}>
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 font-semibold whitespace-nowrap text-[11px] uppercase tracking-wider"
                style={{ color: 'var(--text-muted)', textAlign: c.align ?? 'left' }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--shell-border)' }}>
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2.5 whitespace-nowrap"
                  style={{ color: 'var(--text-primary)', textAlign: c.align ?? 'left' }}>
                  {c.render ? c.render(row) : String(row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
