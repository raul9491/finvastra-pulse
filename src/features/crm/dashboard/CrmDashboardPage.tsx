import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, startOfMonth } from 'date-fns';
import { Users, TrendingUp, AlertTriangle, IndianRupee, ChevronRight } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useLeads } from '../hooks/useLeads';
import { useCommissionRecords } from '../hooks/useCommissionRecords';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { CommissionDashboardCard } from '../commissions/CommissionDashboardCard';
import type { Lead, LeadSource } from '../../../types';

// ─── Source labels ────────────────────────────────────────────────────────────

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

// ─── Mini stat card ───────────────────────────────────────────────────────────

function MiniCard({
  icon, label, value, sub, color, link,
}: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string;
  color: string; link?: string;
}) {
  const navigate = useNavigate();
  const inner = (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: color + '15', color }}>
          {icon}
        </div>
        {link && <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-mute mb-0.5">{label}</p>
      <p className="text-2xl font-bold text-ink">{value}</p>
      {sub && <p className="text-xs text-mute mt-0.5">{sub}</p>}
    </div>
  );
  if (link) {
    return (
      <button onClick={() => navigate(link)} className="group text-left w-full hover:shadow-md transition-all rounded-2xl">
        {inner}
      </button>
    );
  }
  return <div>{inner}</div>;
}

// ─── Source breakdown ─────────────────────────────────────────────────────────

function SourceBreakdown({ leads }: { leads: Lead[] }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    leads.forEach((l) => {
      const label = SOURCE_LABELS[l.source] ?? l.source;
      map.set(label, (map.get(label) ?? 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [leads]);

  const total = leads.length || 1;

  return (
    <div className="space-y-2">
      {counts.map(([source, count]) => (
        <div key={source} className="flex items-center gap-3">
          <span className="text-sm text-ink-soft w-28 shrink-0">{source}</span>
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${(count / total) * 100}%`, backgroundColor: '#C9A961' }} />
          </div>
          <span className="text-sm font-semibold text-ink w-8 text-right shrink-0">{count}</span>
        </div>
      ))}
    </div>
  );
}

// ─── RM leaderboard (admin) ───────────────────────────────────────────────────

function RmLeaderboard({ leads, employees }: {
  leads: Lead[];
  employees: { userId: string; displayName: string }[];
}) {
  const board = useMemo(() => {
    const map = new Map<string, number>();
    leads.forEach((l) => map.set(l.primaryOwnerId, (map.get(l.primaryOwnerId) ?? 0) + 1));
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([uid, count]) => ({
        name: employees.find((e) => e.userId === uid)?.displayName ?? uid.slice(0, 8),
        count,
      }));
  }, [leads, employees]);

  if (board.length === 0) return <p className="text-sm text-mute">No data yet.</p>;

  return (
    <div className="space-y-2">
      {board.map(({ name, count }, i) => (
        <div key={name} className="flex items-center gap-3">
          <span className="text-xs font-bold text-mute w-5">{i + 1}</span>
          <span className="text-sm text-ink-soft flex-1">{name}</span>
          <span className="text-sm font-semibold text-ink">{count} leads</span>
        </div>
      ))}
    </div>
  );
}

// ─── CrmDashboardPage ─────────────────────────────────────────────────────────

export function CrmDashboardPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === 'admin';
  const uid = user?.uid ?? '';

  const { leads, loading: leadsLoading }       = useLeads(uid, isAdmin);
  const { records, loading: recsLoading }      = useCommissionRecords(uid, isAdmin);
  const { employees }                          = useAllEmployees();

  // ── Monthly window ─────────────────────────────────────────────────────────
  const monthStart = startOfMonth(new Date()).toISOString();
  const now        = Date.now();

  // ── Derived lead stats ─────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const newThisMonth = leads.filter((l) => {
      const d = l.createdAt?.toDate?.()?.getTime();
      return d && d >= new Date(monthStart).getTime();
    }).length;

    const overdueSla = leads.filter((l) => {
      if (!l.slaDeadline) return false;
      const ms = typeof l.slaDeadline.toDate === 'function'
        ? l.slaDeadline.toDate().getTime()
        : null;
      return ms && ms < now;
    }).length;

    const highPriority = leads.filter((l) => l.triagePriority === 'high').length;

    return { total: leads.length, newThisMonth, overdueSla, highPriority };
  }, [leads, monthStart, now]);

  // ── Commission stats this month ────────────────────────────────────────────
  const commStats = useMemo(() => {
    const monthKey = format(new Date(), 'yyyy-MM');
    const monthRecs = records.filter((r) => {
      const d = r.createdAt?.toDate?.()?.getTime();
      if (!d) return false;
      return format(new Date(d), 'yyyy-MM') === monthKey;
    });
    return {
      pending:     monthRecs.filter((r) => r.status === 'pending').length,
      paidCount:   monthRecs.filter((r) => r.status === 'paid').length,
      totalPaid:   monthRecs.filter((r) => r.status === 'paid').reduce((s, r) => s + (r.actualAmount ?? r.calculatedCommission), 0),
    };
  }, [records]);

  const loading = leadsLoading || recsLoading;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl mb-1 text-ink"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300 }}>
          CRM Overview
        </h2>
        <p className="text-sm text-mute">
          {format(new Date(), 'MMMM yyyy')} · {loading ? 'Loading…' : `${stats.total} leads`}
        </p>
      </div>

      {/* Commission card (existing) */}
      <CommissionDashboardCard />

      {/* Pipeline stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MiniCard
          icon={<Users size={16} />}
          label="Total Leads"
          value={loading ? '…' : stats.total}
          sub="all time, active"
          color="#0B1538"
          link="/crm/leads"
        />
        <MiniCard
          icon={<TrendingUp size={16} />}
          label="New This Month"
          value={loading ? '…' : stats.newThisMonth}
          sub={format(new Date(), 'MMMM yyyy')}
          color="#166534"
        />
        <MiniCard
          icon={<AlertTriangle size={16} />}
          label="Overdue SLA"
          value={loading ? '…' : stats.overdueSla}
          sub={stats.overdueSla > 0 ? 'need immediate follow-up' : 'all leads within SLA'}
          color={stats.overdueSla > 0 ? '#9F1239' : '#166534'}
          link={stats.overdueSla > 0 ? '/crm/leads' : undefined}
        />
        <MiniCard
          icon={<IndianRupee size={16} />}
          label="Commission Paid"
          value={loading ? '…' : `₹${(commStats.totalPaid / 100000).toFixed(1)}L`}
          sub={`${commStats.paidCount} records · ${commStats.pending} pending`}
          color="#C9A961"
          link="/crm/commissions"
        />
      </div>

      {/* Two-column: source breakdown + RM leaderboard (admin) */}
      <div className={`grid gap-4 ${isAdmin ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>

        {/* Source breakdown */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4 text-mute">Leads by Source</p>
          {loading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-4 bg-slate-100 rounded animate-pulse" />)}</div>
          ) : leads.length === 0 ? (
            <p className="text-sm text-mute">No leads yet.</p>
          ) : (
            <SourceBreakdown leads={leads} />
          )}
        </div>

        {/* RM leaderboard — admin only */}
        {isAdmin && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mute">Top RMs by Lead Count</p>
              <button onClick={() => navigate('/crm/leads')}
                className="text-xs text-mute hover:text-ink transition-colors">View all →</button>
            </div>
            {loading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-5 bg-slate-100 rounded animate-pulse" />)}</div>
            ) : (
              <RmLeaderboard leads={leads} employees={employees} />
            )}
          </div>
        )}
      </div>

      {/* Priority alert — only show when overdue leads exist */}
      {stats.overdueSla > 0 && (
        <button onClick={() => navigate('/crm/leads')}
          className="group w-full flex items-center justify-between bg-red-50 border border-red-200 rounded-2xl px-6 py-4 hover:shadow-sm transition-all">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} className="text-red-600 shrink-0" />
            <div className="text-left">
              <p className="text-sm font-semibold text-red-900">
                {stats.overdueSla} lead{stats.overdueSla > 1 ? 's have' : ' has'} breached SLA
              </p>
              <p className="text-xs text-red-700">These customers are waiting — open the Customers list to follow up</p>
            </div>
          </div>
          <ChevronRight size={16} className="text-red-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
        </button>
      )}

      {/* Dev-only admin setup tools */}
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
          fn: async () => { set('seed','Seeding…'); try { const r = await seedCrmConfig(); set('seed', r.typed===0&&r.providers===0?'Already seeded.':`Done. ${r.typed} types + ${r.providers} providers.`); } catch(e){ set('seed',`Error: ${e instanceof Error?e.message:String(e)}`); } },
        },
        {
          key: 'migrate', label: '2. Migrate Legacy Leads',
          desc: 'Converts Phase 2.1 leads to Lead-Opportunity model.',
          btn: 'Migrate Leads',
          fn: async () => { set('migrate','Migrating…'); try { const r = await migrateLeads(); set('migrate', r.migrated===0?'No leads to migrate.':`Done. ${r.migrated} migrated.`); } catch(e){ set('migrate',`Error: ${e instanceof Error?e.message:String(e)}`); } },
        },
        {
          key: 'slabs', label: '3. Seed Sample Slabs (testing only)',
          desc: 'Creates SAMPLE slabs with placeholder provider IDs.',
          btn: 'Seed Sample Slabs',
          fn: async () => { set('slabs','Seeding…'); try { let n=0; for(const s of SAMPLE_SLABS){ await createSlab({...s,active:true,effectiveFrom:'2026-01-01',effectiveTo:null},uid); n++; } set('slabs',`Done. ${n} slabs. Edit provider IDs in Emulator UI.`); } catch(e){ set('slabs',`Error: ${e instanceof Error?e.message:String(e)}`); } },
        },
        {
          key: 'doctypes', label: '4. Seed Document Types',
          desc: 'Seeds the /document_types collection.',
          btn: 'Seed Document Types',
          fn: async () => { set('doctypes','Seeding…'); try { const n = await seedDocumentTypes(); set('doctypes', n===0?'Already seeded.':`Done. ${n} types.`); } catch(e){ set('doctypes',`Error: ${e instanceof Error?e.message:String(e)}`); } },
        },
        {
          key: 'pan', label: '5. Migrate PAN Encryption',
          desc: 'Encrypts all plaintext panRaw fields. Requires PAN_ENCRYPTION_KEY.',
          btn: 'Run PAN Migration',
          fn: async () => { set('pan','Running…'); try { const token = await firebaseAuth.currentUser?.getIdToken(); const res = await fetch('/api/admin/migrate-pan-encryption',{method:'POST',headers:{Authorization:`Bearer ${token}`}}); const d = await res.json() as {migrated?:number;skipped?:number;failed?:number;error?:string}; if(!res.ok) throw new Error(d.error??'Failed'); set('pan',`Done. Migrated: ${d.migrated??0}, Skipped: ${d.skipped??0}, Failed: ${d.failed??0}`); } catch(e){ set('pan',`Error: ${e instanceof Error?e.message:String(e)}`); } },
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
            <p className="mt-1.5 text-sm" style={{ color: statuses[key].startsWith('Error') ? '#EF4444' : '#166534' }}>
              {statuses[key]}
            </p>
          )}
          <hr className="mt-4 border-slate-100" />
        </div>
      ))}
    </div>
  );
}
