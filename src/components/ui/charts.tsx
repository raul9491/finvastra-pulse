// ─── ChartKit — themed Recharts wrappers (Phase: report visualisation) ────────
// Brand-styled, theme-aware (dark + light via CSS vars), responsive charts used
// by the manager/director reports. Presentation only — charts receive
// already-computed data; they never query or derive business values.
//
// Recharts is heavy, so this module is only imported by lazy report-page chunks
// (never the main entry). Do NOT add recharts to vite manualChunks (object-form
// manual chunks get modulepreloaded on every page).

import type { ReactNode } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

// Categorical brand palette — gold first, then the module accents + extras.
export const CHART_COLORS = ['#C9A961', '#5B9BD5', '#34A853', '#8B5CF6', '#EC4899', '#F59E0B', '#06B6D4', '#EF4444', '#10B981', '#A78BFA'];

const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 11 };
const GRID_STROKE = 'var(--shell-border)';

export function fmtINR(n: number): string {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (Math.abs(n) >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}
export function fmtNum(n: number): string {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-IN');
}

// Themed tooltip — opaque surface, brand border, works in both themes.
function ChartTooltip({ active, payload, label, money }: { active?: boolean; payload?: Array<{ name: string; value: number; color?: string }>; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)', boxShadow: 'var(--elev-2)' }}>
      {label != null && <p className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} />
          {p.name}: <span style={{ color: 'var(--text-primary)' }} className="font-semibold">{money ? fmtINR(p.value) : fmtNum(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

interface SeriesDef { key: string; name?: string; color?: string }
interface BaseChartProps {
  data: Array<Record<string, string | number>>;
  xKey: string;
  height?: number;
  money?: boolean;
  legend?: boolean;
  empty?: ReactNode;
}

function EmptyChart({ height, children }: { height: number; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-center text-sm" style={{ height, color: 'var(--text-dim)' }}>
      {children ?? 'No data for this period.'}
    </div>
  );
}

// ── Bar (vertical or horizontal, single or grouped/stacked) ───────────────────
export function ReBar({ data, xKey, series, height = 280, money, legend, stacked, horizontal, empty }: BaseChartProps & { series: SeriesDef[]; stacked?: boolean; horizontal?: boolean }) {
  if (!data.length) return <EmptyChart height={height}>{empty}</EmptyChart>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 8, bottom: 4, left: horizontal ? 8 : 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={!horizontal} horizontal={horizontal ? false : true} />
        {horizontal
          ? (<><XAxis type="number" tick={AXIS_TICK} tickFormatter={(v) => money ? fmtINR(v) : fmtNum(v)} axisLine={false} tickLine={false} /><YAxis type="category" dataKey={xKey} tick={AXIS_TICK} width={132} axisLine={false} tickLine={false} /></>)
          : (<><XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" /><YAxis tick={AXIS_TICK} tickFormatter={(v) => money ? fmtINR(v) : fmtNum(v)} axisLine={false} tickLine={false} width={money ? 56 : 36} /></>)}
        <Tooltip cursor={{ fill: 'var(--shell-hover-soft)' }} content={<ChartTooltip money={money} />} />
        {legend && <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.name ?? s.key} fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} radius={horizontal ? [0, 5, 5, 0] : [5, 5, 0, 0]} stackId={stacked ? 'a' : undefined} maxBarSize={horizontal ? 22 : 46} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Line ──────────────────────────────────────────────────────────────────────
export function ReLine({ data, xKey, series, height = 280, money, legend, empty }: BaseChartProps & { series: SeriesDef[] }) {
  if (!data.length) return <EmptyChart height={height}>{empty}</EmptyChart>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS_TICK} tickFormatter={(v) => money ? fmtINR(v) : fmtNum(v)} axisLine={false} tickLine={false} width={money ? 56 : 36} />
        <Tooltip content={<ChartTooltip money={money} />} />
        {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name ?? s.key} stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Area ──────────────────────────────────────────────────────────────────────
export function ReArea({ data, xKey, series, height = 280, money, legend, empty }: BaseChartProps & { series: SeriesDef[] }) {
  if (!data.length) return <EmptyChart height={height}>{empty}</EmptyChart>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <defs>
          {series.map((s, i) => {
            const c = s.color ?? CHART_COLORS[i % CHART_COLORS.length];
            return (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={c} stopOpacity={0.35} />
                <stop offset="95%" stopColor={c} stopOpacity={0.02} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS_TICK} tickFormatter={(v) => money ? fmtINR(v) : fmtNum(v)} axisLine={false} tickLine={false} width={money ? 56 : 36} />
        <Tooltip content={<ChartTooltip money={money} />} />
        {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, i) => {
          const c = s.color ?? CHART_COLORS[i % CHART_COLORS.length];
          return <Area key={s.key} type="monotone" dataKey={s.key} name={s.name ?? s.key} stroke={c} strokeWidth={2} fill={`url(#grad-${s.key})`} />;
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Donut / Pie ───────────────────────────────────────────────────────────────
export function RePie({ data, height = 280, money, donut = true, colors = CHART_COLORS, empty }: {
  data: Array<{ name: string; value: number }>; height?: number; money?: boolean; donut?: boolean; colors?: string[]; empty?: ReactNode;
}) {
  const total = data.reduce((s, d) => s + (d.value || 0), 0);
  if (!data.length || total === 0) return <EmptyChart height={height}>{empty}</EmptyChart>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={donut ? '58%' : 0} outerRadius="82%" paddingAngle={data.length > 1 ? 2 : 0} stroke="var(--glass-panel-bg)" strokeWidth={2}>
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Pie>
        <Tooltip content={<ChartTooltip money={money} />} />
        <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span style={{ color: 'var(--text-muted)' }}>{v}</span>} />
      </PieChart>
    </ResponsiveContainer>
  );
}
