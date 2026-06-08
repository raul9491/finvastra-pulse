/**
 * TeamPerformancePage — a director's view of their HRMS downline in CRM.
 *
 * Strictly team-scoped: the data comes from GET /api/crm/team/performance, which
 * computes the caller's downline (reportingManagerUid tree) server-side and returns
 * only their reports' aggregates. Non-managers see an empty team.
 *
 * Sections: team KPI chips · "Action needed today" (due callbacks + SLA breaches,
 * click through to the lead) · per-member performance table (target vs achieved).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Phone, AlertTriangle, RefreshCw, ArrowRight } from 'lucide-react';
import { auth } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}
const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

interface MemberRow {
  uid: string; name: string; designation: string;
  leads: number; newLeads: number; openOpps: number; pipelineValue: number;
  disbursalAmount: number; commission: number; target: number; achievementPct: number;
  overdueSla: number; dueCallbacks: number;
}
interface CallbackItem { leadId: string; name: string; phone: string; ownerName: string; callbackAt: string; }
interface SlaItem { leadId: string; name: string; phone: string; ownerName: string; slaDeadlineMs: number; }
interface TeamSummary {
  members: MemberRow[];
  totals: { leads: number; openOpps: number; pipelineValue: number; disbursalAmount: number; target: number; overdueSla: number; dueCallbacks: number };
  actionNeeded: { callbacks: CallbackItem[]; slaBreaches: SlaItem[] };
  period: string;
}

function achColor(pct: number): string {
  return pct >= 80 ? '#34d399' : pct >= 50 ? '#fbbf24' : '#f87171';
}

export function TeamPerformancePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<TeamSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (p: string) => {
    if (!user) return;
    setLoading(true); setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/crm/team/performance?period=${p}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Could not load team (HTTP ${res.status})`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team performance');
    } finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(period); }, [period, user]);

  const t = data?.totals;
  const hasTeam = (data?.members.length ?? 0) > 0;

  const Chip = ({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) => (
    <div className="glass-panel p-4" style={{ borderLeft: alert ? '3px solid #f87171' : '3px solid #C9A961' }}>
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: alert ? '#f87171' : 'var(--text-primary)' }}>{value}</p>
      {sub && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontVariationSettings: '"SOFT" 30', fontWeight: 300, color: 'var(--text-primary)' }}>
            My Team
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Your reports' pipeline, targets, and the customers waiting on them</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value || currentPeriod())} className="glass-inp text-sm" />
          <button onClick={() => load(period)} className="glass-panel px-3 py-2 text-sm flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20">
          <div className="w-5 h-5 rounded-full border-2 border-gold border-t-transparent animate-spin" />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading team…</span>
        </div>
      ) : error ? (
        <div className="glass-panel p-4 text-sm" style={{ color: '#f87171' }}>{error}</div>
      ) : !hasTeam ? (
        <div className="glass-panel p-10 text-center">
          <Users size={36} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No team assigned yet</p>
          <p className="text-xs mt-1 max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
            Your team is built from the HRMS reporting line. Set people's <strong>Reporting Manager</strong> to you in
            HRMS → Employees, and they'll appear here with their leads and targets.
          </p>
        </div>
      ) : (
        <>
          {/* KPI chips */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Chip label="Disbursed this month" value={fmtINR(t!.disbursalAmount)} sub={t!.target > 0 ? `of ${fmtINR(t!.target)} target` : 'no target set'} />
            <Chip label="Open pipeline" value={fmtINR(t!.pipelineValue)} sub={`${t!.openOpps} open deals`} />
            <Chip label="Callbacks due now" value={String(t!.dueCallbacks)} sub="customers waiting" alert={t!.dueCallbacks > 0} />
            <Chip label="Leads past SLA" value={String(t!.overdueSla)} sub="need first contact" alert={t!.overdueSla > 0} />
          </div>

          {/* Action needed today */}
          {(data!.actionNeeded.callbacks.length > 0 || data!.actionNeeded.slaBreaches.length > 0) && (
            <div className="grid md:grid-cols-2 gap-4">
              {/* Callbacks due */}
              <div className="glass-panel p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Phone size={15} style={{ color: '#C9A961' }} />
                  <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Callbacks due ({data!.actionNeeded.callbacks.length})</h3>
                </div>
                {data!.actionNeeded.callbacks.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>None due right now 🎉</p>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {data!.actionNeeded.callbacks.slice(0, 25).map((c) => {
                      const overdue = new Date(c.callbackAt).getTime() <= Date.now();
                      return (
                        <button key={c.leadId} onClick={() => navigate(`/crm/leads/${c.leadId}`)}
                          className="w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-white/5 transition-colors"
                          style={{ border: `1px solid ${overdue ? 'rgba(248,113,113,0.4)' : 'var(--shell-border)'}` }}>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
                            <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{c.phone} · {c.ownerName}</p>
                          </div>
                          <span className="text-[10px] font-semibold whitespace-nowrap" style={{ color: overdue ? '#f87171' : '#C9A961' }}>
                            {new Date(c.callbackAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <ArrowRight size={13} style={{ color: 'var(--text-muted)' }} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* SLA breaches */}
              <div className="glass-panel p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={15} style={{ color: '#f87171' }} />
                  <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Past SLA ({data!.actionNeeded.slaBreaches.length})</h3>
                </div>
                {data!.actionNeeded.slaBreaches.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No SLA breaches 🎉</p>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {data!.actionNeeded.slaBreaches.slice(0, 25).map((sLead) => (
                      <button key={sLead.leadId} onClick={() => navigate(`/crm/leads/${sLead.leadId}`)}
                        className="w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-white/5 transition-colors"
                        style={{ border: '1px solid rgba(248,113,113,0.4)' }}>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{sLead.name}</p>
                          <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{sLead.phone} · {sLead.ownerName}</p>
                        </div>
                        <span className="text-[10px] font-semibold whitespace-nowrap" style={{ color: '#f87171' }}>
                          {Math.floor((Date.now() - sLead.slaDeadlineMs) / 3600000)}h late
                        </span>
                        <ArrowRight size={13} style={{ color: 'var(--text-muted)' }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Member table */}
          <div className="glass-panel p-0 overflow-hidden">
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--shell-border)' }}>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Team performance — {data!.members.length} reports</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }} className="text-[10px] uppercase tracking-wider">
                    <th className="text-left font-semibold px-4 py-2">Member</th>
                    <th className="text-right font-semibold px-3 py-2">Leads</th>
                    <th className="text-right font-semibold px-3 py-2">Open</th>
                    <th className="text-right font-semibold px-3 py-2">Pipeline</th>
                    <th className="text-right font-semibold px-3 py-2">Disbursed</th>
                    <th className="text-right font-semibold px-3 py-2">Target</th>
                    <th className="text-right font-semibold px-3 py-2">Achieved</th>
                    <th className="text-right font-semibold px-3 py-2">SLA</th>
                    <th className="text-right font-semibold px-3 py-2">Callbacks</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.members.map((m) => (
                    <tr key={m.uid} style={{ borderTop: '1px solid var(--shell-border)' }}>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{m.name}</p>
                        {m.designation && <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{m.designation}</p>}
                      </td>
                      <td className="text-right px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{m.leads}</td>
                      <td className="text-right px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{m.openOpps}</td>
                      <td className="text-right px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{fmtINR(m.pipelineValue)}</td>
                      <td className="text-right px-3 py-2.5 font-semibold" style={{ color: '#C9A961' }}>{fmtINR(m.disbursalAmount)}</td>
                      <td className="text-right px-3 py-2.5" style={{ color: 'var(--text-muted)' }}>{m.target > 0 ? fmtINR(m.target) : '—'}</td>
                      <td className="text-right px-3 py-2.5">
                        {m.target > 0
                          ? <span className="font-bold" style={{ color: achColor(m.achievementPct) }}>{m.achievementPct}%</span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td className="text-right px-3 py-2.5" style={{ color: m.overdueSla > 0 ? '#f87171' : 'var(--text-muted)', fontWeight: m.overdueSla > 0 ? 700 : 400 }}>{m.overdueSla}</td>
                      <td className="text-right px-3 py-2.5" style={{ color: m.dueCallbacks > 0 ? '#C9A961' : 'var(--text-muted)', fontWeight: m.dueCallbacks > 0 ? 700 : 400 }}>{m.dueCallbacks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
