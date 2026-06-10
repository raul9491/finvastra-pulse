import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, startOfMonth } from 'date-fns';
import {
  Users, TrendingUp, AlertTriangle, IndianRupee, ChevronRight,
  Building2, ShieldCheck, Target, Medal,
} from 'lucide-react';
import { collectionGroup, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useLeads } from '../hooks/useLeads';
import { useCommissionRecords } from '../hooks/useCommissionRecords';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { CommissionDashboardCard } from '../commissions/CommissionDashboardCard';
import type { Lead, LeadSource, CommissionRecord, UserProfile } from '../../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OppRaw {
  opportunityType: 'loan' | 'wealth' | 'insurance';
  dealSize: number;
  ownerId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRupees(n: number): string {
  if (!n) return '₹0';
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000)    return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000)      return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${n.toLocaleString('en-IN')}`;
}

const SOURCE_LABELS: Partial<Record<LeadSource, string>> = {
  website:      'Website',
  instagram:    'Instagram',
  facebook:     'Facebook',
  social_meta:  'Social (Meta)',
  walkin:       'Walk-in',
  referral:     'Referral',
  broker:       'Broker',
  offline_bulk: 'Offline Bulk',
};

// ─── Lightweight open-opps hook (no lead-name batch fetch) ────────────────────
// Skips the expensive per-lead getDoc calls; used for pipeline aggregation only.

function useOpenOppsStats() {
  const [opps, setOpps]       = useState<OppRaw[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collectionGroup(db, 'opportunities'),
      where('status', '==', 'open'),
    );
    return onSnapshot(q, (snap) => {
      setOpps(
        snap.docs.map((d) => {
          const data = d.data() as { opportunityType: 'loan' | 'wealth' | 'insurance'; dealSize: number; ownerId: string };
          return {
            opportunityType: data.opportunityType,
            dealSize:        data.dealSize ?? 0,
            ownerId:         data.ownerId,
          };
        }),
      );
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  return { opps, loading };
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, sub, color, onClick,
}: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string;
  color: string; onClick?: () => void;
}) {
  const inner = (
    <div className="glass-panel glass-card p-5 h-full transition-all group-hover:shadow-md">
      <div className="flex items-center justify-between mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: color + '22', color }}>
          {icon}
        </div>
        {onClick && (
          <ChevronRight size={14} style={{ color: 'var(--text-dim)' }} className="group-hover:opacity-80 transition-opacity" />
        )}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
  if (onClick) {
    return (
      <button onClick={onClick} className="group text-left w-full">
        {inner}
      </button>
    );
  }
  return <div>{inner}</div>;
}

// ─── BizLineCard ──────────────────────────────────────────────────────────────

function BizLineCard({
  icon, label, count, pipelineValue, color, loading,
}: {
  icon: React.ReactNode; label: string; count: number; pipelineValue: number;
  color: string; loading: boolean;
}) {
  return (
    <div className="glass-panel p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: color + '22', color }}>
          {icon}
        </div>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</p>
      </div>
      {loading ? (
        <div className="space-y-1.5">
          <div className="h-7 w-20 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
          <div className="h-3.5 w-14 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
        </div>
      ) : (
        <>
          <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtRupees(pipelineValue)}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {count} open deal{count !== 1 ? 's' : ''}
          </p>
        </>
      )}
    </div>
  );
}

// ─── SourceBreakdown ──────────────────────────────────────────────────────────

function SourceBreakdown({ leads }: { leads: Lead[] }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    leads.forEach((l) => {
      const label = SOURCE_LABELS[l.source] ?? l.source ?? 'Unknown';
      map.set(label, (map.get(label) ?? 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [leads]);

  const total = leads.length || 1;

  if (counts.length === 0) return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No leads yet.</p>;

  return (
    <div className="space-y-2.5">
      {counts.map(([source, count]) => (
        <div key={source} className="flex items-center gap-3">
          <span className="text-xs w-24 shrink-0 truncate" style={{ color: 'var(--text-muted)' }}>{source}</span>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(count / total) * 100}%`, backgroundColor: '#C9A961' }} />
          </div>
          <span className="text-xs font-semibold w-8 text-right shrink-0" style={{ color: 'var(--text-primary)' }}>{count}</span>
        </div>
      ))}
    </div>
  );
}

// ─── RM Performance Table ─────────────────────────────────────────────────────

interface RmStat {
  uid: string;
  name: string;
  activeLeads: number;
  openOpps: number;
  pipelineValue: number;
  commissionMonth: number;
}

function RmPerformanceTable({
  leads, opps, records, employees, monthKey,
}: {
  leads: Lead[];
  opps: OppRaw[];
  records: CommissionRecord[];
  employees: UserProfile[];
  monthKey: string;
}) {
  const stats = useMemo<RmStat[]>(() => {
    return employees
      .map((e): RmStat => {
        const myLeads = leads.filter((l) => l.primaryOwnerId === e.userId && !l.deleted);
        const myOpps  = opps.filter((o) => o.ownerId === e.userId);
        const pipelineValue = myOpps.reduce((s, o) => s + (o.dealSize || 0), 0);
        const commissionMonth = records
          .filter((r) => {
            if (r.rmOwnerId !== e.userId || r.status !== 'paid') return false;
            const d = (r.createdAt as { toDate?: () => Date } | null)?.toDate?.()?.getTime();
            return d ? format(new Date(d), 'yyyy-MM') === monthKey : false;
          })
          .reduce((s, r) => s + (r.actualAmount ?? r.calculatedCommission ?? 0), 0);

        return {
          uid:  e.userId,
          name: e.displayName,
          activeLeads:     myLeads.length,
          openOpps:        myOpps.length,
          pipelineValue,
          commissionMonth,
        };
      })
      .filter((r) => r.activeLeads > 0 || r.openOpps > 0 || r.commissionMonth > 0)
      .sort((a, b) => b.pipelineValue - a.pipelineValue)
      .slice(0, 10);
  }, [leads, opps, records, employees, monthKey]);

  if (stats.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No RM activity yet.</p>;
  }

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm min-w-120">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--shell-border)' }}>
            <th className="text-left text-[10px] font-bold uppercase tracking-widest pb-2.5 pl-1 w-7" style={{ color: 'var(--text-muted)' }}>#</th>
            <th className="text-left text-[10px] font-bold uppercase tracking-widest pb-2.5" style={{ color: 'var(--text-muted)' }}>Name</th>
            <th className="text-right text-[10px] font-bold uppercase tracking-widest pb-2.5" style={{ color: 'var(--text-muted)' }}>Leads</th>
            <th className="text-right text-[10px] font-bold uppercase tracking-widest pb-2.5" style={{ color: 'var(--text-muted)' }}>Opps</th>
            <th className="text-right text-[10px] font-bold uppercase tracking-widest pb-2.5" style={{ color: 'var(--text-muted)' }}>Pipeline</th>
            <th className="text-right text-[10px] font-bold uppercase tracking-widest pb-2.5 pr-1" style={{ color: 'var(--text-muted)' }}>Comm. MTD</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(({ uid, name, activeLeads, openOpps, pipelineValue, commissionMonth }, i) => (
            <tr key={uid} className="hover:bg-(--shell-hover-soft) transition-colors" style={{ borderBottom: '1px solid var(--shell-border)' }}>
              <td className="py-2.5 pl-1">
                {i === 0
                  ? <Medal size={14} style={{ color: '#C9A961' }} />
                  : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
                }
              </td>
              <td className="py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{name}</td>
              <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{activeLeads}</td>
              <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{openOpps}</td>
              <td className="py-2.5 text-right font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmtRupees(pipelineValue)}</td>
              <td className="py-2.5 text-right pr-1 tabular-nums">
                {commissionMonth > 0
                  ? <span style={{ color: 'var(--status-success)', fontWeight: 600 }}>{fmtRupees(commissionMonth)}</span>
                  : <span style={{ color: 'var(--text-muted)' }}>—</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Quick Actions ────────────────────────────────────────────────────────────

function QuickActions({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate();

  const actions: { label: string; href: string; color: string }[] = [
    { label: '+ New Lead',     href: '/crm/leads',       color: '#C9A961' },
    { label: 'Pipeline',       href: '/crm/pipeline',    color: '#60a5fa' },
    { label: 'Commissions',    href: '/crm/commissions', color: '#34d399' },
    ...(isAdmin ? [{ label: 'Import Leads', href: '/crm/import', color: '#a78bfa' }] : []),
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(({ label, href, color }) => (
        <button key={href} onClick={() => navigate(href)}
          className="px-4 py-2 text-sm font-semibold rounded-xl border transition-all hover:shadow-sm active:scale-[0.98]"
          style={{ borderColor: color + '40', color, backgroundColor: color + '15' }}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Skeleton row helper ──────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-4 w-4 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
      <div className="flex-1 h-4 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
      <div className="h-4 w-16 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
    </div>
  );
}

// ─── CrmDashboardPage ─────────────────────────────────────────────────────────

export function CrmDashboardPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const isAdmin          = profile?.role === 'admin';
  const isManager        = profile?.crmRole === 'manager';
  const isAdminOrManager = isAdmin || isManager;
  const uid              = user?.uid ?? '';

  // ── All hooks unconditional ───────────────────────────────────────────────
  const { leads,   loading: leadsLoading } = useLeads(uid, isAdmin);
  const { records, loading: recsLoading  } = useCommissionRecords(uid, isAdmin);
  const { employees }                      = useAllEmployees();
  const { opps,    loading: oppsLoading  } = useOpenOppsStats();

  // ── Time windows ──────────────────────────────────────────────────────────
  const now        = Date.now();
  const monthKey   = format(new Date(), 'yyyy-MM');
  const monthStart = startOfMonth(new Date()).getTime();

  // ── Lead-level stats ──────────────────────────────────────────────────────
  const leadStats = useMemo(() => {
    const active = leads.filter((l) => !l.deleted);
    const newThisMonth = active.filter((l) => {
      const d = (l.createdAt as { toDate?: () => Date } | null)?.toDate?.()?.getTime();
      return d !== undefined && d >= monthStart;
    }).length;
    const overdueSla = active.filter((l) => {
      const ms = typeof (l.slaDeadline as { toDate?: () => Date } | null)?.toDate === 'function'
        ? (l.slaDeadline as { toDate: () => Date }).toDate().getTime()
        : null;
      return ms !== null && ms < now;
    }).length;
    return { total: active.length, newThisMonth, overdueSla };
  }, [leads, monthStart, now]);

  // ── Pipeline stats from open opps ─────────────────────────────────────────
  const myOpps = isAdminOrManager ? opps : opps.filter((o) => o.ownerId === uid);

  const bizLine = useMemo(() => {
    const calc = (type: 'loan' | 'wealth' | 'insurance') => {
      const list = opps.filter((o) => o.opportunityType === type);
      return { count: list.length, value: list.reduce((s, o) => s + (o.dealSize || 0), 0) };
    };
    return {
      loan:      calc('loan'),
      wealth:    calc('wealth'),
      insurance: calc('insurance'),
      total:     { count: opps.length, value: opps.reduce((s, o) => s + (o.dealSize || 0), 0) },
    };
  }, [opps]);

  // ── Commission stats ──────────────────────────────────────────────────────
  const commPaid = useMemo(() =>
    records
      .filter((r) => {
        if (r.status !== 'paid') return false;
        const d = (r.createdAt as { toDate?: () => Date } | null)?.toDate?.()?.getTime();
        return d !== undefined && format(new Date(d), 'yyyy-MM') === monthKey;
      })
      .reduce((s, r) => s + (r.actualAmount ?? r.calculatedCommission ?? 0), 0),
  [records, monthKey]);

  // suppress unused variable warning
  void commPaid;

  const loading = leadsLoading || recsLoading;

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-3xl mb-1"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          CRM Overview
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {format(new Date(), 'MMMM yyyy')}
          {' · '}
          {loading ? 'Loading…' : `${leadStats.total} leads`}
        </p>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          ADMIN / MANAGER VIEW
      ════════════════════════════════════════════════════════════════════ */}
      {isAdminOrManager ? (
        <>

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              icon={<Users size={16} />}
              label="Total Leads"
              value={loading ? '…' : leadStats.total}
              sub="all active leads"
              color="#60a5fa"
              onClick={() => navigate('/crm/leads')}
            />
            <StatCard
              icon={<TrendingUp size={16} />}
              label="New This Month"
              value={loading ? '…' : leadStats.newThisMonth}
              sub={format(new Date(), 'MMMM yyyy')}
              color="#34d399"
            />
            <StatCard
              icon={<AlertTriangle size={16} />}
              label="SLA Overdue"
              value={loading ? '…' : leadStats.overdueSla}
              sub={leadStats.overdueSla > 0 ? 'need follow-up' : 'all within SLA'}
              color={leadStats.overdueSla > 0 ? '#f87171' : '#34d399'}
              onClick={leadStats.overdueSla > 0 ? () => navigate('/crm/leads') : undefined}
            />
            <StatCard
              icon={<IndianRupee size={16} />}
              label="Open Pipeline"
              value={oppsLoading ? '…' : fmtRupees(bizLine.total.value)}
              sub={`${bizLine.total.count} open deal${bizLine.total.count !== 1 ? 's' : ''}`}
              color="#C9A961"
              onClick={() => navigate('/crm/pipeline')}
            />
          </div>

          {/* Business line breakdown */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
              Pipeline by Business Line
            </p>
            <div className="grid grid-cols-3 gap-4">
              <BizLineCard
                icon={<Building2 size={16} />}
                label="Loans"
                count={bizLine.loan.count}
                pipelineValue={bizLine.loan.value}
                color="#60a5fa"
                loading={oppsLoading}
              />
              <BizLineCard
                icon={<TrendingUp size={16} />}
                label="Wealth"
                count={bizLine.wealth.count}
                pipelineValue={bizLine.wealth.value}
                color="#34d399"
                loading={oppsLoading}
              />
              <BizLineCard
                icon={<ShieldCheck size={16} />}
                label="Insurance"
                count={bizLine.insurance.count}
                pipelineValue={bizLine.insurance.value}
                color="#a78bfa"
                loading={oppsLoading}
              />
            </div>
          </div>

          {/* RM Performance table + Source breakdown */}
          <div className="grid sm:grid-cols-2 gap-4">

            {/* RM Performance */}
            <div className="glass-panel p-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                  RM Performance
                </p>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>by pipeline value</span>
              </div>
              {loading || oppsLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
                </div>
              ) : (
                <RmPerformanceTable
                  leads={leads}
                  opps={opps}
                  records={records}
                  employees={employees}
                  monthKey={monthKey}
                />
              )}
            </div>

            {/* Lead source breakdown */}
            <div className="glass-panel p-6">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
                Leads by Source
              </p>
              {loading ? (
                <div className="space-y-2.5">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-4 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
                  ))}
                </div>
              ) : (
                <SourceBreakdown leads={leads} />
              )}
            </div>
          </div>

          {/* Commission card */}
          <CommissionDashboardCard />

          {/* Quick actions */}
          <div className="glass-panel p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
              Quick Actions
            </p>
            <QuickActions isAdmin={isAdmin} />
          </div>

        </>
      ) : (

        /* ══════════════════════════════════════════════════════════════════
            RM / INDIVIDUAL view
        ══════════════════════════════════════════════════════════════════ */
        <>

          {/* Personal stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              icon={<Users size={16} />}
              label="My Leads"
              value={loading ? '…' : leadStats.total}
              sub="total assigned"
              color="#60a5fa"
              onClick={() => navigate('/crm/leads')}
            />
            <StatCard
              icon={<Target size={16} />}
              label="Open Deals"
              value={oppsLoading ? '…' : myOpps.length}
              sub="active opportunities"
              color="#C9A961"
              onClick={() => navigate('/crm/pipeline')}
            />
            <StatCard
              icon={<AlertTriangle size={16} />}
              label="SLA Overdue"
              value={loading ? '…' : leadStats.overdueSla}
              sub={leadStats.overdueSla > 0 ? 'need follow-up' : 'all within SLA'}
              color={leadStats.overdueSla > 0 ? '#f87171' : '#34d399'}
              onClick={leadStats.overdueSla > 0 ? () => navigate('/crm/leads') : undefined}
            />
            <StatCard
              icon={<IndianRupee size={16} />}
              label="My Pipeline"
              value={oppsLoading ? '…' : fmtRupees(myOpps.reduce((s, o) => s + (o.dealSize || 0), 0))}
              sub="open deal value"
              color="#34d399"
            />
          </div>

          {/* Business line split for my opps */}
          {myOpps.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
                My Pipeline by Business Line
              </p>
              <div className="grid grid-cols-3 gap-4">
                {(['loan', 'wealth', 'insurance'] as const).map((type) => {
                  const list = myOpps.filter((o) => o.opportunityType === type);
                  return (
                    <BizLineCard
                      key={type}
                      icon={type === 'loan' ? <Building2 size={16} /> : type === 'wealth' ? <TrendingUp size={16} /> : <ShieldCheck size={16} />}
                      label={type === 'loan' ? 'Loans' : type === 'wealth' ? 'Wealth' : 'Insurance'}
                      count={list.length}
                      pipelineValue={list.reduce((s, o) => s + (o.dealSize || 0), 0)}
                      color={type === 'loan' ? '#60a5fa' : type === 'wealth' ? '#34d399' : '#a78bfa'}
                      loading={false}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* My leads by source */}
          {leads.length > 0 && (
            <div className="glass-panel p-6">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
                My Leads by Source
              </p>
              {loading ? (
                <div className="space-y-2.5">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-4 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
                  ))}
                </div>
              ) : (
                <SourceBreakdown leads={leads} />
              )}
            </div>
          )}

          {/* Commission card */}
          <CommissionDashboardCard />

          {/* Quick actions */}
          <div className="glass-panel p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
              Quick Actions
            </p>
            <QuickActions isAdmin={false} />
          </div>

        </>
      )}

      {/* SLA alert — both views */}
      {!loading && leadStats.overdueSla > 0 && (
        <button
          onClick={() => navigate('/crm/leads')}
          className="group w-full flex items-center justify-between rounded-2xl px-6 py-4 hover:shadow-sm transition-all"
          style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)' }}>
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} style={{ color: '#f87171' }} className="shrink-0" />
            <div className="text-left">
              <p className="text-sm font-semibold" style={{ color: '#f87171' }}>
                {leadStats.overdueSla} lead{leadStats.overdueSla > 1 ? 's have' : ' has'} breached SLA
              </p>
              <p className="text-xs" style={{ color: 'rgba(248,113,113,0.70)' }}>
                These customers are waiting — open Leads to follow up
              </p>
            </div>
          </div>
          <ChevronRight size={16} style={{ color: '#f87171' }} className="group-hover:translate-x-0.5 transition-transform shrink-0" />
        </button>
      )}

      {/* CRM first-time setup — visible to admin in all environments */}
      {isAdmin && <CrmSetupPanel />}
      {/* Dev-only dangerous tools (migration / sample slabs) */}
      {import.meta.env.DEV && isAdmin && <DevAdminTools />}
    </div>
  );
}

// ─── CRM Setup Panel (production-safe, admin-only) ───────────────────────────
// Seeds opportunity_types, providers, and document_types.
// seedCrmConfig() is idempotent — safe to run multiple times (no-ops if data exists).

import { seedCrmConfig } from '../config/seedCrmConfig';

function CrmSetupPanel() {
  const [status, setStatus] = useState<string>('');
  const [running, setRunning] = useState(false);

  const handleSeed = async () => {
    if (!window.confirm('This will seed CRM product types, providers, and document types into Firestore. Safe to run multiple times. Continue?')) return;
    setRunning(true);
    setStatus('Seeding…');
    try {
      const r = await seedCrmConfig();
      if (r.typed === 0 && r.providers === 0 && r.documentTypes === 0) {
        setStatus('Already set up — no changes needed.');
      } else {
        setStatus(`Done! ${r.typed} product types · ${r.providers} providers · ${r.documentTypes} document types added.`);
      }
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="glass-panel p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
            CRM Setup
          </h3>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Seeds product types (Loan / Wealth / Insurance), bank providers, and document types.
            Run this once after first deployment. Safe to run again — no duplicates created.
          </p>
        </div>
        <button
          onClick={handleSeed}
          disabled={running}
          className="shrink-0 px-5 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
        >
          {running ? 'Running…' : 'Seed CRM Config'}
        </button>
      </div>
      {status && (
        <p className="text-sm" style={{ color: status.startsWith('Error') ? '#f87171' : '#34d399' }}>
          {status}
        </p>
      )}
    </div>
  );
}

// ─── Dev-only seed tools (tree-shaken in prod) ────────────────────────────────
import { migrateLeads } from '../config/migrate';
import { createSlab } from '../hooks/useCommissionSlabs';
import { seedDocumentTypes } from '../config/seedDocumentTypes';
import { auth as firebaseAuth } from '../../../lib/firebase';

const SAMPLE_SLABS = [
  { providerId: 'HDFC_PLACEHOLDER', product: 'Home Loan',     minTicket: 0,       maxTicket: 5000000,  percentage: 0.5,  basisOn: 'disbursed' as const, notes: 'SAMPLE' },
  { providerId: 'HDFC_PLACEHOLDER', product: 'Home Loan',     minTicket: 5000001, maxTicket: null,     percentage: 0.4,  basisOn: 'disbursed' as const, notes: 'SAMPLE' },
  { providerId: 'HDFC_PLACEHOLDER', product: 'Personal Loan', minTicket: 0,       maxTicket: 2500000,  percentage: 1.0,  basisOn: 'disbursed' as const, notes: 'SAMPLE' },
  { providerId: 'ICICI_PLACEHOLDER',product: 'Home Loan',     minTicket: 0,       maxTicket: 7500000,  percentage: 0.4,  basisOn: 'disbursed' as const, notes: 'SAMPLE' },
  { providerId: 'ICICI_PLACEHOLDER',product: 'Personal Loan', minTicket: 0,       maxTicket: null,     percentage: 0.75, basisOn: 'disbursed' as const, notes: 'SAMPLE' },
];

function DevAdminTools() {
  const { profile } = useAuth();
  const uid = profile?.userId ?? '';
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setStatuses((p) => ({ ...p, [k]: v }));

  return (
    <div className="glass-panel p-6 space-y-5">
      <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Admin Setup (dev only)</h3>
      {[
        {
          key: 'seed', label: '1. Seed CRM Config',
          desc: 'Creates opportunity types + providers + document types.',
          btn: 'Seed Config Data',
          fn: async () => {
            set('seed', 'Seeding…');
            try {
              const r = await seedCrmConfig();
              set('seed', r.typed === 0 && r.providers === 0 ? 'Already seeded.' : `Done. ${r.typed} types + ${r.providers} providers.`);
            } catch (e) { set('seed', `Error: ${e instanceof Error ? e.message : String(e)}`); }
          },
        },
        {
          key: 'migrate', label: '2. Migrate Legacy Leads',
          desc: 'Converts Phase 2.1 leads to Lead-Opportunity model.',
          btn: 'Migrate Leads',
          fn: async () => {
            set('migrate', 'Migrating…');
            try {
              const r = await migrateLeads();
              set('migrate', r.migrated === 0 ? 'No leads to migrate.' : `Done. ${r.migrated} migrated.`);
            } catch (e) { set('migrate', `Error: ${e instanceof Error ? e.message : String(e)}`); }
          },
        },
        {
          key: 'slabs', label: '3. Seed Sample Slabs (testing only)',
          desc: 'Creates SAMPLE slabs with placeholder provider IDs.',
          btn: 'Seed Sample Slabs',
          fn: async () => {
            set('slabs', 'Seeding…');
            try {
              let n = 0;
              for (const s of SAMPLE_SLABS) { await createSlab({ ...s, active: true, effectiveFrom: '2026-01-01', effectiveTo: null }, uid); n++; }
              set('slabs', `Done. ${n} slabs. Edit provider IDs in Emulator UI.`);
            } catch (e) { set('slabs', `Error: ${e instanceof Error ? e.message : String(e)}`); }
          },
        },
        {
          key: 'doctypes', label: '4. Seed Document Types',
          desc: 'Seeds the /document_types collection.',
          btn: 'Seed Document Types',
          fn: async () => {
            set('doctypes', 'Seeding…');
            try {
              const n = await seedDocumentTypes();
              set('doctypes', n === 0 ? 'Already seeded.' : `Done. ${n} types.`);
            } catch (e) { set('doctypes', `Error: ${e instanceof Error ? e.message : String(e)}`); }
          },
        },
        {
          key: 'pan', label: '5. Migrate PAN Encryption',
          desc: 'Encrypts all plaintext panRaw fields. Requires PAN_ENCRYPTION_KEY.',
          btn: 'Run PAN Migration',
          fn: async () => {
            set('pan', 'Running…');
            try {
              const token = await firebaseAuth.currentUser?.getIdToken();
              const res = await fetch('/api/admin/migrate-pan-encryption', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              });
              const d = await res.json() as { migrated?: number; skipped?: number; failed?: number; error?: string };
              if (!res.ok) throw new Error(d.error ?? 'Failed');
              set('pan', `Done. Migrated: ${d.migrated ?? 0}, Skipped: ${d.skipped ?? 0}, Failed: ${d.failed ?? 0}`);
            } catch (e) { set('pan', `Error: ${e instanceof Error ? e.message : String(e)}`); }
          },
        },
      ].map(({ key, label, desc, btn, fn }) => (
        <div key={key}>
          <p className="text-sm font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>{label}</p>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{desc}</p>
          <button onClick={fn}
            className="px-5 py-2 rounded-lg text-sm font-semibold border hover:bg-(--shell-hover-soft) transition-colors"
            style={{ color: 'var(--text-muted)', borderColor: 'var(--shell-border-mid)' }}>
            {btn}
          </button>
          {statuses[key] && (
            <p className="mt-1.5 text-sm"
              style={{ color: statuses[key].startsWith('Error') ? '#f87171' : '#34d399' }}>
              {statuses[key]}
            </p>
          )}
          <hr className="mt-4" style={{ borderColor: 'var(--shell-border)' }} />
        </div>
      ))}
    </div>
  );
}
