/**
 * TeamPulseHome — the manager landing screen. Zero digging: own numbers, who
 * needs attention (with the reason spelled out), the team's due actions, and
 * the import-data verdicts. Two cached fetches, zero Firestore listeners.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhoneCall, TrendingUp, AlertTriangle, ArrowRight, Database } from 'lucide-react';
import { auth } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader, StatCard, Card, Section } from '../../../components/ui/primitives';
import { fmtRupees } from './widgets';

interface MemberRow {
  uid: string; name: string; leads: number; untouched?: number; attempted?: number;
  overdueSla: number; dueCallbacks: number; conversionRate: number; inactiveDays: number | null;
  callsLogged?: number | null; disbursalAmount: number; achievementPct: number; target: number;
}
interface TeamData {
  head: MemberRow | null; members: MemberRow[];
  actionNeeded: { callbacks: Array<{ leadId: string; name: string; ownerName: string; callbackAt: string }>;
                  slaBreaches: Array<{ leadId: string; name: string; ownerName: string }> };
}
interface ImportPerf { key: string; name: string; leads: number; attemptedPct: number; interested: number; converted: number; deadPct: number; untouched: number }

function attentionReasons(m: MemberRow): string[] {
  const r: string[] = [];
  if (m.dueCallbacks > 0) r.push(`${m.dueCallbacks} callback${m.dueCallbacks > 1 ? 's' : ''} due`);
  if (m.overdueSla > 0) r.push(`${m.overdueSla} lead${m.overdueSla > 1 ? 's' : ''} past SLA`);
  if ((m.untouched ?? 0) >= 10) r.push(`${m.untouched} untouched`);
  if (m.inactiveDays !== null && m.inactiveDays >= 3) r.push(`no activity for ${m.inactiveDays}d`);
  return r;
}

export function TeamPulseHome() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const period = new Date().toISOString().slice(0, 7);
  const [team, setTeam] = useState<TeamData | null>(null);
  const [imports, setImports] = useState<ImportPerf[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const h = { Authorization: `Bearer ${token}` };
        const [tRes, iRes] = await Promise.all([
          fetch(`/api/crm/team/performance?period=${period}`, { headers: h }),
          fetch('/api/crm/imports/performance', { headers: h }),
        ]);
        if (alive && tRes.ok) setTeam(await tRes.json());
        if (alive && iRes.ok) setImports(((await iRes.json()).imports ?? []).slice(0, 4));
      } catch { /* sections show empty states */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [user, period]);

  const head = team?.head ?? null;
  const members = team?.members ?? [];
  const attention = members
    .map((m) => ({ m, reasons: attentionReasons(m) }))
    .filter((x) => x.reasons.length > 0);
  const actions = [
    ...(team?.actionNeeded.callbacks ?? []).map((c) => ({ leadId: c.leadId, text: `${c.ownerName}: callback due — ${c.name}` })),
    ...(team?.actionNeeded.slaBreaches ?? []).map((s) => ({ leadId: s.leadId, text: `${s.ownerName}: past SLA — ${s.name}` })),
  ].slice(0, 8);
  const firstName = (profile?.displayName ?? '').split(' ')[0] || '';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Team Pulse"
        subtitle={`${firstName ? firstName + ', here' : 'Here'}'s your team's pulse for ${new Date().toLocaleDateString('en-IN', { month: 'long' })} — who's flying, who needs you.`}
        pinKey="crm.dashboard"
      />

      {/* My numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<PhoneCall size={16} />} label="My calls this month" value={head?.callsLogged ?? 0} loading={loading} accent="#C9A961" link="/crm/performance" />
        <StatCard icon={<TrendingUp size={16} />} label="My disbursed" value={fmtRupees(head?.disbursalAmount ?? 0)} loading={loading} accent="#34A853" />
        <StatCard label="My conversion" value={`${head?.conversionRate ?? 0}%`} loading={loading} accent="#5B9BD5" />
        <StatCard label="My target" value={head && head.target > 0 ? `${head.achievementPct}%` : '—'} loading={loading}
          sub={head && head.target > 0 ? `of ${fmtRupees(head.target)}` : 'not set'} accent="#8B5CF6" link="/crm/targets" />
      </div>

      {/* Needs attention — the centrepiece */}
      <Card>
        <Section label="Needs attention" action={
          <button onClick={() => navigate('/crm/performance?tab=team')} className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: '#C9A961' }}>
            Full team view <ArrowRight size={12} />
          </button>
        }>
          {loading ? (
            <div className="space-y-2">{[...Array(2)].map((_, i) => <div key={i} className="h-10 rounded-lg animate-pulse" style={{ backgroundColor: 'var(--shell-hover-soft)' }} />)}</div>
          ) : attention.length === 0 ? (
            <p className="text-sm py-2" style={{ color: '#34d399' }}>All clear — nobody needs a nudge right now. 🎉</p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--shell-border)' }}>
              {attention.map(({ m, reasons }) => (
                <button key={m.uid} onClick={() => navigate(`/crm/performance?tab=team`)}
                  className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-(--shell-hover-soft) rounded-lg px-2 -mx-2 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{m.name}</p>
                    <p className="text-xs truncate" style={{ color: '#f87171' }}>{reasons.join(' · ')}</p>
                  </div>
                  <AlertTriangle size={15} className="shrink-0" style={{ color: '#f87171' }} />
                </button>
              ))}
            </div>
          )}
        </Section>
      </Card>

      {/* Action list */}
      {actions.length > 0 && (
        <Card>
          <Section label="Due today across the team">
            <div className="divide-y" style={{ borderColor: 'var(--shell-border)' }}>
              {actions.map((a, i) => (
                <button key={i} onClick={() => navigate(`/crm/leads/${a.leadId}`)}
                  className="w-full text-left text-sm py-2 hover:bg-(--shell-hover-soft) rounded px-2 -mx-2 transition-colors"
                  style={{ color: 'var(--text-secondary)' }}>
                  {a.text}
                </button>
              ))}
            </div>
          </Section>
        </Card>
      )}

      {/* Data verdicts */}
      <Card>
        <Section label="How the data is performing" action={
          <button onClick={() => navigate('/crm/performance?tab=data')} className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: '#C9A961' }}>
            All data sources <ArrowRight size={12} />
          </button>
        }>
          {imports.length === 0 ? (
            <p className="text-sm flex items-center gap-2" style={{ color: 'var(--text-dim)' }}><Database size={14} /> No imported data yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {imports.map((im) => {
                const good = im.converted > 0 || (im.interested > 0 && im.deadPct < 40);
                const bad = im.deadPct >= 60 || (im.attemptedPct >= 50 && im.interested === 0 && im.converted === 0);
                const color = good ? '#34d399' : bad ? '#f87171' : '#C9A961';
                return (
                  <span key={im.key} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg"
                    title={`${im.leads} customers · ${im.attemptedPct}% attempted · ${im.interested} interested · ${im.converted} converted · ${im.deadPct}% dead`}
                    style={{ color, backgroundColor: `${color}1a`, border: `1px solid ${color}44` }}>
                    {im.name} · {good ? 'working' : bad ? 'cold' : 'mixed'}
                  </span>
                );
              })}
            </div>
          )}
        </Section>
      </Card>

      {/* Go deeper */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: 'Performance hub', to: '/crm/performance?tab=team' },
          { label: 'Import Queue', to: '/crm/import/queue' },
          { label: 'Targets', to: '/crm/targets' },
        ].map((l) => (
          <button key={l.to} onClick={() => navigate(l.to)}
            className="text-xs font-semibold px-3.5 py-2 rounded-lg border transition-opacity hover:opacity-80"
            style={{ borderColor: 'var(--shell-border-mid)', color: 'var(--text-secondary)' }}>
            {l.label} →
          </button>
        ))}
      </div>
    </div>
  );
}
