/**
 * Pipeline → Dashboards (spec §7.4). All sections from GET /api/crm2/dashboards
 * (server-aggregated; money sections present only with payout.amounts.read).
 *
 * Presentation note: each data series is shown via <DataView> — a Table ⇄ Graph
 * toggle (graph default on mobile, table on desktop). This file does NOT compute
 * or change any business value; it only renders the server-aggregated `d`.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../../components/ui/primitives';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { apiCrm2, hasCrm2Perm } from '../lib';
import { DataView, SimpleTable, type Column } from '../../../components/ui/DataView';
import { ReBar, fmtINR, fmtNum } from '../../../components/ui/charts';

const inr = (n: number | null | undefined) => n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';
const thisMonth = () => new Date().toISOString().slice(0, 7);

interface Dash {
  period: string;
  funnel: { byStatus: Record<string, number>; bySource: Record<string, number>; byCategory: Record<string, number>; totalLeads: number; qualified: number; converted: number; conversionPct: number };
  pipeline: Array<{ stage: string; count: number; value?: number; avgAgeDays: number }>;
  payoutHealth: { byStatus: Record<string, number>; avgDisbToReceivedDays: number | null; stuck: Array<{ caseId: string; status: string; ageDays: number }> };
  disbursement?: { total: { count: number; disbursed?: number; expected?: number; billed?: number; received?: number }; byConnector: Record<string, { count: number; disbursed?: number; received?: number }> };
  receivables?: { total: { expected: number; billed: number; received: number; pendingReceivable: number }; byConnector: Array<{ connector: string; expected: number; billed: number; received: number; pendingReceivable: number }> };
  margin?: { total: number; byConnector: Record<string, number>; byProduct: Record<string, number>; byRm: Record<string, number> };
  rmPerformance: Array<{ rm: string; leadsHandled: number; conversionPct: number; disbursedValue?: number; revenue?: number }>;
  subDsaScorecard: Array<{ subDsaId: string; name: string; casesSourced: number; disbursedValue?: number; payoutMargin?: number }>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel glass-card p-4 sm:p-5" style={{ borderRadius: 'var(--radius-lg)' }}>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>{title}</p>
      {children}
    </div>
  );
}

type Row = { name: string; value: number };
const recToArr = (rec: Record<string, number>): Row[] =>
  Object.entries(rec).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

/** A single-series breakdown shown as a Table or a horizontal Bar graph. */
function SeriesView({ title, rec, money, valueLabel }: { title: string; rec: Record<string, number>; money?: boolean; valueLabel?: string }) {
  const rows = recToArr(rec);
  const cols: Column<Row>[] = [
    { key: 'name', label: title },
    { key: 'value', label: valueLabel ?? (money ? 'Amount' : 'Count'), align: 'right', render: (r) => money ? fmtINR(r.value) : fmtNum(r.value) },
  ];
  return (
    <DataView
      title={title}
      table={<SimpleTable columns={cols} rows={rows} />}
      graph={<ReBar data={rows} xKey="name" series={[{ key: 'value', name: title }]} horizontal money={money} height={Math.max(180, Math.min(rows.length, 12) * 32 + 24)} />}
    />
  );
}

export function DashboardsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState(thisMonth());
  const [d, setD] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const canMoney = hasCrm2Perm(profile, 'payout.amounts.read');

  const load = async () => {
    setLoading(true);
    try { const r = await apiCrm2<{ ok: boolean } & Dash>('GET', `/api/crm2/dashboards?period=${period}`); setD(r); }
    catch { /* ignore */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [period]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Analytics"
        subtitle="Funnel, pipeline value, disbursements and scorecards for the whole company."
        pinKey="crm.dashboards"
        actions={
          <div className="flex items-center gap-2">
            <input type="month" className="glass-inp text-sm" value={period} onChange={(e) => setPeriod(e.target.value || thisMonth())} />
            <button onClick={load} className="glass-panel px-3 py-2 text-sm flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}><RefreshCw size={14} /> Refresh</button>
          </div>
        }
      />

      {loading || !d ? (
        <div className="glass-panel p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <>
          {/* Funnel summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[['Leads', d.funnel.totalLeads], ['Qualified', d.funnel.qualified], ['Converted', d.funnel.converted], ['Conversion', `${d.funnel.conversionPct}%`]].map(([l, v]) => (
              <div key={l} className="glass-panel p-3"><p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{l}</p><p className="text-lg font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{v}</p></div>
            ))}
          </div>

          {canMoney && d.receivables && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[['Expected', d.receivables.total.expected], ['Billed', d.receivables.total.billed], ['Received', d.receivables.total.received], ['Pending', d.receivables.total.pendingReceivable]].map(([l, v]) => (
                <div key={l} className="glass-panel p-3"><p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{l}</p><p className="text-base font-bold mt-0.5" style={{ color: l === 'Received' ? '#34d399' : l === 'Pending' ? '#fbbf24' : 'var(--text-primary)' }}>{inr(v as number)}</p></div>
              ))}
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <SeriesView title="Leads by source" rec={d.funnel.bySource} />
            <SeriesView title="Leads by category" rec={d.funnel.byCategory} />

            {/* Pipeline by stage — count graph + a richer table (count · avg age · value) */}
            {(() => {
              const stages = d.pipeline.filter((p) => p.count > 0);
              const cols: Column<typeof stages[number]>[] = [
                { key: 'stage', label: 'Stage' },
                { key: 'count', label: 'Count', align: 'right' },
                { key: 'avgAgeDays', label: 'Avg age', align: 'right', render: (r) => `${r.avgAgeDays}d` },
                ...(canMoney ? [{ key: 'value', label: 'Value', align: 'right' as const, render: (r: typeof stages[number]) => fmtINR(r.value ?? 0) }] : []),
              ];
              return (
                <DataView
                  title="Pipeline by stage"
                  table={<SimpleTable columns={cols} rows={stages} />}
                  graph={<ReBar data={stages.map((p) => ({ name: p.stage, value: p.count }))} xKey="name" series={[{ key: 'value', name: 'Cases' }]} horizontal height={Math.max(180, stages.length * 32 + 24)} />}
                />
              );
            })()}

            <SeriesView title="Payout health (by status)" rec={d.payoutHealth.byStatus} />

            {canMoney && d.disbursement && (
              <SeriesView title="Disbursed by connector" money rec={Object.fromEntries(Object.entries(d.disbursement.byConnector).map(([k, v]) => [k, v.disbursed ?? 0]))} />
            )}
            {canMoney && d.margin && (
              <SeriesView title="Net margin by connector" money rec={d.margin.byConnector} />
            )}

            {canMoney && d.receivables && (() => {
              const cols: Column<typeof d.receivables.byConnector[number]>[] = [
                { key: 'connector', label: 'Connector' },
                { key: 'expected', label: 'Expected', align: 'right', render: (r) => fmtINR(r.expected) },
                { key: 'received', label: 'Received', align: 'right', render: (r) => fmtINR(r.received) },
                { key: 'pendingReceivable', label: 'Pending', align: 'right', render: (r) => <span style={{ color: '#fbbf24' }}>{fmtINR(r.pendingReceivable)}</span> },
              ];
              return (
                <DataView
                  title="Receivables by connector"
                  table={<SimpleTable columns={cols} rows={d.receivables.byConnector} />}
                  graph={<ReBar
                    data={d.receivables.byConnector.map((r) => ({ name: r.connector, received: r.received, pending: r.pendingReceivable }))}
                    xKey="name" money stacked legend
                    series={[{ key: 'received', name: 'Received', color: '#34A853' }, { key: 'pending', name: 'Pending', color: '#F59E0B' }]}
                    height={Math.max(200, d.receivables.byConnector.length * 36 + 24)} horizontal
                  />}
                />
              );
            })()}

            <Card title="Payout cycle ageing">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Avg disbursement → received: <strong>{d.payoutHealth.avgDisbToReceivedDays ?? '—'} days</strong></p>
              {d.payoutHealth.stuck.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] font-bold uppercase" style={{ color: '#f87171' }}>Stuck &gt; 21 days ({d.payoutHealth.stuck.length})</p>
                  {d.payoutHealth.stuck.slice(0, 8).map((s) => (
                    <button key={s.caseId} onClick={() => navigate(`/crm/pipeline/cases/${s.caseId}`)} className="block text-left text-[11px] hover:underline" style={{ color: '#C9A961' }}>
                      {s.caseId} · {s.status} · {s.ageDays}d
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* RM performance */}
          {(() => {
            const rows = d.rmPerformance.filter((r) => r.rm !== '—' && r.rm !== 'unassigned');
            const cols: Column<typeof rows[number]>[] = [
              { key: 'rm', label: 'RM', render: (r) => <span className="font-mono text-xs">{r.rm}</span> },
              { key: 'leadsHandled', label: 'Leads', align: 'right' },
              { key: 'conversionPct', label: 'Conv %', align: 'right', render: (r) => `${r.conversionPct}%` },
              ...(canMoney ? [
                { key: 'disbursedValue', label: 'Disbursed', align: 'right' as const, render: (r: typeof rows[number]) => <span style={{ color: '#C9A961' }}>{inr(r.disbursedValue)}</span> },
                { key: 'revenue', label: 'Revenue', align: 'right' as const, render: (r: typeof rows[number]) => <span style={{ color: '#34d399' }}>{inr(r.revenue)}</span> },
              ] : []),
            ];
            return (
              <DataView
                title="RM performance"
                table={<SimpleTable columns={cols} rows={rows} />}
                graph={<ReBar
                  data={rows.map((r) => ({ name: r.rm, value: canMoney ? (r.disbursedValue ?? 0) : r.leadsHandled }))}
                  xKey="name" money={canMoney} horizontal
                  series={[{ key: 'value', name: canMoney ? 'Disbursed' : 'Leads handled' }]}
                  height={Math.max(200, rows.length * 30 + 24)}
                />}
              />
            );
          })()}

          {/* Sub DSA scorecard */}
          {d.subDsaScorecard.length > 0 && (() => {
            const cols: Column<typeof d.subDsaScorecard[number]>[] = [
              { key: 'name', label: 'Connector' },
              { key: 'casesSourced', label: 'Cases', align: 'right' },
              ...(canMoney ? [
                { key: 'disbursedValue', label: 'Disbursed', align: 'right' as const, render: (r: typeof d.subDsaScorecard[number]) => <span style={{ color: '#C9A961' }}>{inr(r.disbursedValue)}</span> },
                { key: 'payoutMargin', label: 'Margin', align: 'right' as const, render: (r: typeof d.subDsaScorecard[number]) => <span style={{ color: '#34d399' }}>{inr(r.payoutMargin)}</span> },
              ] : []),
            ];
            return (
              <DataView
                title="Sub DSA scorecard"
                table={<SimpleTable columns={cols} rows={d.subDsaScorecard} />}
                graph={<ReBar
                  data={d.subDsaScorecard.map((s) => ({ name: s.name, value: canMoney ? (s.disbursedValue ?? 0) : s.casesSourced }))}
                  xKey="name" money={canMoney} horizontal
                  series={[{ key: 'value', name: canMoney ? 'Disbursed' : 'Cases sourced' }]}
                  height={Math.max(200, d.subDsaScorecard.length * 30 + 24)}
                />}
              />
            );
          })()}
        </>
      )}
    </div>
  );
}
