/**
 * Pipeline → Dashboards (spec §7.4). All sections from GET /api/crm2/dashboards
 * (server-aggregated; money sections present only with payout.amounts.read).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { apiCrm2, hasCrm2Perm } from '../lib';

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
    <div className="glass-panel p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>{title}</p>
      {children}
    </div>
  );
}
function Bars({ data, money }: { data: Record<string, number>; money?: boolean }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="space-y-1.5">
      {entries.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No data</p> : entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <span className="text-[11px] w-28 truncate" style={{ color: 'var(--text-secondary)' }}>{k}</span>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
            <div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, backgroundColor: '#C9A961' }} />
          </div>
          <span className="text-[11px] w-20 text-right font-semibold" style={{ color: 'var(--text-primary)' }}>{money ? inr(v) : v}</span>
        </div>
      ))}
    </div>
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>Dashboards</h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Funnel · pipeline · disbursals · payout health · receivables · margin</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" className="glass-inp text-sm" value={period} onChange={(e) => setPeriod(e.target.value || thisMonth())} />
          <button onClick={load} className="glass-panel px-3 py-2 text-sm flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

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
            <Card title="Leads by source"><Bars data={d.funnel.bySource} /></Card>
            <Card title="Leads by category"><Bars data={d.funnel.byCategory} /></Card>

            <Card title="Pipeline by stage (count)">
              <Bars data={Object.fromEntries(d.pipeline.filter((p) => p.count > 0).map((p) => [p.stage, p.count]))} />
            </Card>
            <Card title="Payout health (by status)"><Bars data={d.payoutHealth.byStatus} /></Card>

            {canMoney && d.disbursement && (
              <Card title="Disbursed by connector">
                <Bars data={Object.fromEntries(Object.entries(d.disbursement.byConnector).map(([k, v]) => [k, v.disbursed ?? 0]))} money />
              </Card>
            )}
            {canMoney && d.margin && (
              <Card title="Net margin by connector"><Bars data={d.margin.byConnector} money /></Card>
            )}

            {canMoney && d.receivables && (
              <Card title="Receivables by connector">
                <div className="space-y-1.5">
                  {d.receivables.byConnector.map((r) => (
                    <div key={r.connector} className="flex items-center justify-between gap-2 text-xs py-1" style={{ borderBottom: '1px solid var(--shell-border)' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{r.connector}</span>
                      <span style={{ color: 'var(--text-muted)' }}>exp {inr(r.expected)} · rec {inr(r.received)} · <span style={{ color: '#fbbf24' }}>pend {inr(r.pendingReceivable)}</span></span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

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
          <Card title="RM performance">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left font-semibold px-2 py-1.5">RM</th>
                  <th className="text-right font-semibold px-2 py-1.5">Leads</th>
                  <th className="text-right font-semibold px-2 py-1.5">Conv %</th>
                  {canMoney && <th className="text-right font-semibold px-2 py-1.5">Disbursed</th>}
                  {canMoney && <th className="text-right font-semibold px-2 py-1.5">Revenue</th>}
                </tr></thead>
                <tbody>
                  {d.rmPerformance.filter((r) => r.rm !== '—' && r.rm !== 'unassigned').map((r) => (
                    <tr key={r.rm} style={{ borderTop: '1px solid var(--shell-border)' }}>
                      <td className="px-2 py-1.5 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{r.rm}</td>
                      <td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>{r.leadsHandled}</td>
                      <td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>{r.conversionPct}%</td>
                      {canMoney && <td className="px-2 py-1.5 text-right" style={{ color: '#C9A961' }}>{inr(r.disbursedValue)}</td>}
                      {canMoney && <td className="px-2 py-1.5 text-right" style={{ color: '#34d399' }}>{inr(r.revenue)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Sub-DSA scorecard */}
          {d.subDsaScorecard.length > 0 && (
            <Card title="Sub-DSA scorecard">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    <th className="text-left font-semibold px-2 py-1.5">Sub-DSA</th>
                    <th className="text-right font-semibold px-2 py-1.5">Cases</th>
                    {canMoney && <th className="text-right font-semibold px-2 py-1.5">Disbursed</th>}
                    {canMoney && <th className="text-right font-semibold px-2 py-1.5">Margin</th>}
                  </tr></thead>
                  <tbody>
                    {d.subDsaScorecard.map((s) => (
                      <tr key={s.subDsaId} style={{ borderTop: '1px solid var(--shell-border)' }}>
                        <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>{s.name}</td>
                        <td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>{s.casesSourced}</td>
                        {canMoney && <td className="px-2 py-1.5 text-right" style={{ color: '#C9A961' }}>{inr(s.disbursedValue)}</td>}
                        {canMoney && <td className="px-2 py-1.5 text-right" style={{ color: '#34d399' }}>{inr(s.payoutMargin)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
