// ─── Shared UI primitives (Phase 4 overhaul) ─────────────────────────────────
// One consistent set of building blocks pages adopt so the look stops being
// hand-rolled per page: PageHeader · Card · Section · StatCard · Toolbar.
// All theme-aware (CSS vars only); no business logic.

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { PinButton } from './PinButton';

// ── PageHeader — editorial title + subtitle + right-aligned actions ───────────
export function PageHeader({ title, subtitle, actions, pinKey, className }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; pinKey?: string; className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 mb-6', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="h-display text-3xl" style={{ color: 'var(--text-primary)' }}>{title}</h1>
          {pinKey && <PinButton nodeKey={pinKey} />}
        </div>
        {subtitle && <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

// ── Card — glass surface; `elevated` lifts it off the page ────────────────────
export function Card({ children, className, elevated = false, padded = true, onClick }: {
  children: ReactNode; className?: string; elevated?: boolean; padded?: boolean; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn('glass-panel', elevated && 'glass-elevated', padded && 'p-5', onClick && 'cursor-pointer', className)}
      style={{ borderRadius: 'var(--radius-lg)' }}
    >
      {children}
    </div>
  );
}

// ── Section — a labelled block (small uppercase label + content) ──────────────
export function Section({ label, action, children, className }: {
  label?: ReactNode; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      {(label || action) && (
        <div className="flex items-center justify-between gap-2">
          {label && <p className="h-section">{label}</p>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// ── StatCard — unified KPI card (replaces the duplicated CRM/HRMS versions) ────
export function StatCard({ icon, label, value, sub, accent, color, onClick, loading }: {
  icon?: ReactNode; label: string; value: ReactNode; sub?: ReactNode;
  accent?: string; color?: string; onClick?: () => void; loading?: boolean;
}) {
  const a = color ?? accent ?? '#C9A961';   // `color` alias keeps existing call sites working
  const inner = (
    <div className="glass-panel glass-card p-5 h-full transition-all group-hover:shadow-md" style={{ borderRadius: 'var(--radius-lg)' }}>
      <div className="flex items-center justify-between mb-3">
        {icon && (
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: a + '22', color: a }}>
            {icon}
          </div>
        )}
        {onClick && <ChevronRight size={14} style={{ color: 'var(--text-dim)' }} className="group-hover:opacity-80 transition-opacity" />}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {loading
        ? <div className="h-7 w-16 my-0.5 animate-pulse rounded-md" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
        : <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>}
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
  return onClick
    ? <button onClick={onClick} className="group text-left w-full">{inner}</button>
    : <div className="group">{inner}</div>;
}

// ── Toolbar — a filter / search / action row above a list ─────────────────────
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 mb-4', className)}>{children}</div>
  );
}
