/**
 * BusinessPulseHome — the admin/director landing screen: company pipeline,
 * every team at a glance, data-source verdicts, and doors to the deep views.
 * Money figures are unmasked here by design — this branch renders only for
 * platform admins, who hold payout.amounts.read by definition.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ShieldCheck, IndianRupee, Users, ArrowRight, Landmark, Database } from 'lucide-react';
import { auth } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useLeads } from '../hooks/useLeads';
import { useCommissionRecords } from '../hooks/useCommissionRecords';
import { PageHeader, StatCard, Card, Section } from '../../../components/ui/primitives';
import { CommissionDashboardCard } from '../commissions/CommissionDashboardCard';
import { useOpenOppsStats, BizLineCard, SourceBreakdown, fmtRupees } from './widgets';
import { SeedTools } from './SeedTools';

interface TeamCard {
  manager: { uid: string; name: string; disbursalAmount: number; conversionRate: number };
  members: Array<{ uid: string; disbursalAmount: number; callsLogged?: number | null }>;
  totals: { disbursalAmount: number; leads: number };
}
interface ImportPerf { key: string; name: string; leads: number; attemptedPct: number; interested: number; converted: number; deadPct: number }

export function BusinessPulseHome() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const uid = user?.uid ?? '';
  const period = new Date().toISOString().slice(0, 7);

  const { opps, loading: oppsLoading } = useOpenOppsStats();
  const { leads } = useLeads(uid, true);
  const { records } = useCommissionRecords(uid, true);
  const [teams, setTeams] = useState<TeamCard[]>([]);
  const [imports, setImports] = useState<ImportPerf[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const h = { Authorization: `Bearer ${token}` };
        const [tRes, iRes] = await Promise.all([
          fetch(`/api/crm/team/all-teams?period=${period}`, { headers: h }),
          fetch('/api/crm/imports/performance', { headers: h }),
        ]);
        if (alive && tRes.ok) setTeams((await tRes.json()).teams ?? []);
        if (alive && iRes.ok) setImports(((await iRes.json()).imports ?? []).slice(0, 5));
      } catch { /* sections show empty states */ }
      if (alive) setRemoteLoading(false);
    })();
    return () => { alive = false; };
  }, [user, period]);

  const bizLine = useMemo(() => {
    const calc = (type: 'loan' | 'wealth' | 'insurance') => {
      const list = opps.filter((o) => o.opportunityType === type);
      return { count: list.length, value: list.reduce((s, o) => s + (o.dealSize || 0), 0) };
    };
    return {
      loan: calc('loan'), wealth: calc('wealth'), insurance: calc('insurance'),
      total: { count: opps.length, value: opps.reduce((s, o) => s + (o.dealSize || 0), 0) },
    };
  }, [opps]);

  // The CRM-MIS bridge stamps disbursalDate/disbursedAmount on commission_records
  // at disbursement (setPrimarySubmission); the base type predates those fields.
  const disbursedMtd = useMemo(() =>
    records
      .map((r) => r as typeof r & { disbursalDate?: string; disbursedAmount?: number })
      .filter((r) => typeof r.disbursalDate === 'string' && r.disbursalDate.startsWith(period))
      .reduce((s, r) => s + (r.disbursedAmount ?? 0), 0),
  [records, period]);

  const activeLeads = useMemo(() => leads.filter((l) => !l.deleted), [leads]);
  const firstName = (profile?.displayName ?? '').split(' ')[0] || '';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Business Pulse"
        subtitle={`${firstName ? firstName + ' — the' : 'The'} company at a glance: pipeline, teams and data quality.`}
        pinKey="crm.dashboard"
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<IndianRupee size={16} />} label="Open pipeline" value={fmtRupees(bizLine.total.value)}
          loading={oppsLoading} sub={`${bizLine.total.count} open deals`} accent="#C9A961" link="/crm/pipeline/dashboards" />
        <StatCard icon={<Landmark size={16} />} label="Disbursed this month" value={fmtRupees(disbursedMtd)} accent="#34A853" />
        <StatCard icon={<Users size={16} />} label="Active customers" value={activeLeads.length} accent="#5B9BD5" link="/crm/leads" />
        <StatCard icon={<ShieldCheck size={16} />} label="Teams" value={teams.length} loading={remoteLoading}
          sub="tap for all-team detail" accent="#8B5CF6" link="/crm/performance?tab=team" />
      </div>

      {/* Business lines */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <BizLineCard icon={<Building2 size={15} />} label="Loans" count={bizLine.loan.count} pipelineValue={bizLine.loan.value} color="#C9A961" loading={oppsLoading} />
        <BizLineCard icon={<IndianRupee size={15} />} label="Wealth" count={bizLine.wealth.count} pipelineValue={bizLine.wealth.value} color="#5B9BD5" loading={oppsLoading} />
        <BizLineCard icon={<ShieldCheck size={15} />} label="Insurance" count={bizLine.insurance.count} pipelineValue={bizLine.insurance.value} color="#34A853" loading={oppsLoading} />
      </div>

      {/* All teams */}
      <Card>
        <Section label="Teams" action={
          <button onClick={() => navigate('/crm/performance?tab=team')} className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: '#C9A961' }}>
            Performance hub <ArrowRight size={12} />
          </button>
        }>
          {remoteLoading ? (
            <div className="grid sm:grid-cols-2 gap-3">{[...Array(2)].map((_, i) => <div key={i} className="h-20 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--shell-hover-soft)' }} />)}</div>
          ) : teams.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No teams set up yet — assign reporting managers in HRMS → Employees.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {teams.map((t) => (
                <button key={t.manager.uid} onClick={() => navigate(`/crm/performance?tab=team&uid=${t.manager.uid}`)}
                  className="glass-panel p-4 text-left hover:opacity-90 transition-opacity">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t.manager.name}'s team</p>
                    <ArrowRight size={13} style={{ color: 'var(--text-dim)' }} />
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {t.members.length} member{t.members.length !== 1 ? 's' : ''} · {t.totals.leads} leads ·{' '}
                    <span style={{ color: '#C9A961', fontWeight: 700 }}>{fmtRupees(t.totals.disbursalAmount)}</span> disbursed
                  </p>
                </button>
              ))}
            </div>
          )}
        </Section>
      </Card>

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

      {/* Source breakdown + commission */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <Section label="Leads by source"><SourceBreakdown leads={activeLeads} /></Section>
        </Card>
        <CommissionDashboardCard />
      </div>

      {/* Go deeper */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: 'Analytics', to: '/crm/pipeline/dashboards' },
          { label: 'Command Centre', to: '/crm/command-centre' },
          { label: 'Performance hub', to: '/crm/performance' },
        ].map((l) => (
          <button key={l.to} onClick={() => navigate(l.to)}
            className="text-xs font-semibold px-3.5 py-2 rounded-lg border transition-opacity hover:opacity-80"
            style={{ borderColor: 'var(--shell-border-mid)', color: 'var(--text-secondary)' }}>
            {l.label} →
          </button>
        ))}
      </div>

      <SeedTools />
    </div>
  );
}
