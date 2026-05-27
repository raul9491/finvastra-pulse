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
    <div className="bg-white border border-slate-200 rounded-2xl p-5 h-full transition-all group-hover:shadow-md">
      <div className="flex items-center justify-between mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: color + '1A', color }}>
          {icon}
        </div>
        {onClick && (
          <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
        )}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-mute mb-0.5">{label}</p>
      <p className="text-2xl font-bold text-ink">{value}</p>
      {sub && <p className="text-xs text-mute mt-0.5">{sub}</p>}
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
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: color + '1A', color }}>
          {icon}
        </div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-mute">{label}</p>
      </div>
      {loading ? (
        <div className="space-y-1.5">
          <div className="h-7 w-20 bg-slate-100 rounded animate-pulse" />
          <div className="h-3.5 w-14 bg-slate-100 rounded animate-pulse" />
        </div>
      ) : (
        <>
          <p className="text-2xl font-bold text-ink">{fmtRupees(pipelineValue)}</p>
          <p className="text-xs text-mute mt-0.5">
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

  if (counts.length === 0) return <p className="text-sm text-mute">No leads yet.</p>;

  return (
    <div className="space-y-2.5">
      {counts.map(([source, count]) => (
        <div key={source} className="flex items-center gap-3">
          <span className="text-xs text-ink-soft w-24 shrink-0 truncate">{source}</span>
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(count / total) * 100}%`, backgroundColor: '#C9A961' }} />
          </div>
          <span className="text-xs font-semibold text-ink w-8 text-right shrink-0">{count}</span>
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
    return <p className="text-sm text-mute">No RM activity yet.</p>;
  }

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm min-w-120">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="text-left text-[10px] font-bold uppercase tracking-widest text-mute pb-2.5 pl-1 w-7">#</th>
            <th className="text-left text-[10px] font-bold uppercase tracking-widest text-mute pb-2.5">Name</th>
            <th className="text-right text-[10px] font-bold uppercase tracking-widest text-mute pb-2.5">Leads</th>
            <th className="text-right text-[10px] font-bold uppercase tracking-widest text-mute pb-2.5">Opps</th>
            <th className="text-right text-[10px] font-bold uppercase tracking-widest text-mute pb-2.5">Pipeline</th>
            <th className="text-right text-[10px] font-bold uppercase tracking-widest text-mute pb-2.5 pr-1">Comm. MTD</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(({ uid, name, activeLeads, openOpps, pipelineValue, commissionMonth }, i) => (
            <tr key={uid} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
              <td className="py-2.5 pl-1">
                {i === 0
                  ? <Medal size={14} className="text-yellow-500" />
                  : <span className="text-xs text-mute">{i + 1}</span>
                }
              </td>
              <td className="py-2.5 font-medium text-ink">{name}</td>
              <td className="py-2.5 text-right text-ink-soft tabular-nums">{activeLeads}</td>
              <td className="py-2.5 text-right text-ink-soft tabular-nums">{openOpps}</td>
              <td className="py-2.5 text-right font-semibold text-ink tabular-nums">{fmtRupees(pipelineValue)}</td>
              <td className="py-2.5 text-right pr-1 tabular-nums">
                {commissionMonth > 0
                  ? <span className="text-green-700 font-semibold">{fmtRupees(commissionMonth)}</span>
                  : <span className="text-mute">—</span>
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
    { label: '+ New Lead',     href: '/crm/leads',       color: '#0B1538' },
    { label: 'Pipeline',       href: '/crm/pipeline',    color: '#C9A961' },
    { label: 'Commissions',    href: '/crm/commissions', color: '#166534' },
    ...(isAdmin ? [{ label: 'Import Leads', href: '/crm/import', color: '#6366F1' }] : []),
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(({ label, href, color }) => (
        <button key={href} onClick={() => navigate(href)}
          className="px-4 py-2 text-sm font-semibold rounded-xl border transition-all hover:shadow-sm active:scale-[0.98]"
          style={{ borderColor: color + '40', color, backgroundColor: color + '08' }}>
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
      <div className="h-4 w-4 bg-slate-100 rounded animate-pulse" />
      <div className="flex-1 h-4 bg-slate-100 rounded animate-pulse" />
      <div className="h-4 w-16 bg-slate-100 rounded animate-pulse" />
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

  const loading = leadsLoading || recsLoading;

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-3xl mb-1 text-ink"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300 }}>
          CRM Overview
        </h2>
        <p className="text-sm text-mute">
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
              color="#0B1538"
              onClick={() => navigate('/crm/leads')}
            />
            <StatCard
              icon={<TrendingUp size={16} />}
              label="New This Month"
              value={loading ? '…' : leadStats.newThisMonth}
              sub={format(new Date(), 'MMMM yyyy')}
              color="#166534"
            />
            <StatCard
              icon={<AlertTriangle size={16} />}
              label="SLA Overdue"
              value={loading ? '…' : leadStats.overdueSla}
              sub={leadStats.overdueSla > 0 ? 'need follow-up' : 'all within SLA'}
              color={leadStats.overdueSla > 0 ? '#9F1239' : '#166534'}
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
            <p className="text-[10px] font-bold uppercase tracking-widest text-mute mb-3">
              Pipeline by Business Line
            </p>
            <div className="grid grid-cols-3 gap-4">
              <BizLineCard
                icon={<Building2 size={16} />}
                label="Loans"
                count={bizLine.loan.count}
                pipelineValue={bizLine.loan.value}
                color="#1D4ED8"
                loading={oppsLoading}
              />
              <BizLineCard
                icon={<TrendingUp size={16} />}
                label="Wealth"
                count={bizLine.wealth.count}
                pipelineValue={bizLine.wealth.value}
                color="#059669"
                loading={oppsLoading}
              />
              <BizLineCard
                icon={<ShieldCheck size={16} />}
                label="Insurance"
                count={bizLine.insurance.count}
                pipelineValue={bizLine.insurance.value}
                color="#7C3AED"
                loading={oppsLoading}
              />
            </div>
          </div>

          {/* RM Performance table + Source breakdown */}
          <div className="grid sm:grid-cols-2 gap-4">

            {/* RM Performance */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-mute">
                  RM Performance
                </p>
                <span className="text-[10px] text-mute">by pipeline value</span>
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
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mute mb-4">
                Leads by Source
              </p>
              {loading ? (
                <div className="space-y-2.5">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-4 bg-slate-100 rounded animate-pulse" />
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
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-mute mb-3">
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
              color="#0B1538"
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
              color={leadStats.overdueSla > 0 ? '#9F1239' : '#166534'}
              onClick={leadStats.overdueSla > 0 ? () => navigate('/crm/leads') : undefined}
            />
            <StatCard
              icon={<IndianRupee size={16} />}
              label="My Pipeline"
              value={oppsLoading ? '…' : fmtRupees(myOpps.reduce((s, o) => s + (o.dealSize || 0), 0))}
              sub="open deal value"
              color="#166534"
            />
          </div>

          {/* Business line split for my opps */}
          {myOpps.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-mute mb-3">
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
                      color={type === 'loan' ? '#1D4ED8' : type === 'wealth' ? '#059669' : '#7C3AED'}
                      loading={false}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* My leads by source */}
          {leads.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mute mb-4">
                My Leads by Source
              </p>
              {loading ? (
                <div className="space-y-2.5">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-4 bg-slate-100 rounded animate-pulse" />
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
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-mute mb-3">
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
          className="group w-full flex items-center justify-between bg-red-50 border border-red-200 rounded-2xl px-6 py-4 hover:shadow-sm transition-all">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} className="text-red-600 shrink-0" />
            <div className="text-left">
              <p className="text-sm font-semibold text-red-900">
                {leadStats.overdueSla} lead{leadStats.overdueSla > 1 ? 's have' : ' has'} breached SLA
              </p>
              <p className="text-xs text-red-700">
                These customers are waiting — open Leads to follow up
              </p>
            </div>
          </div>
          <ChevronRight size={16} className="text-red-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
        </button>
      )}

      {/* Dev-only admin setup panel */}
      {import.meta.env.DEV && isAdmin && <DevAdminTools />}
    </div>
  );
}

// ─── Dev-only seed tools (tree-shaken in prod) ────────────────────────────────

import { seedCrmConfig } from '../config/seedCrmConfig';
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
    <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
      <h3 className="text-xs font-bold uppercase tracking-widest text-mute">Admin Setup (dev only)</h3>
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
          <p className="text-sm font-medium mb-0.5 text-ink">{label}</p>
          <p className="text-xs text-mute mb-2">{desc}</p>
          <button onClick={fn}
            className="px-5 py-2 rounded-lg text-sm font-semibold border border-slate-200 hover:bg-slate-50 transition-colors text-ink-soft">
            {btn}
          </button>
          {statuses[key] && (
            <p className="mt-1.5 text-sm"
              style={{ color: statuses[key].startsWith('Error') ? '#EF4444' : '#166534' }}>
              {statuses[key]}
            </p>
          )}
          <hr className="mt-4 border-slate-100" />
        </div>
      ))}
    </div>
  );
}
