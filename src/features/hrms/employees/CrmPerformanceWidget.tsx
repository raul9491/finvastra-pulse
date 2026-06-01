/**
 * CrmPerformanceWidget
 *
 * Shown on the employee profile page (admin / HRMS manager only) when the employee
 * has crmAccess: true. Reads from /leads and /commission_records — no separate
 * collection needed. All Firestore reads are one-time (getDocs) on mount.
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { format } from 'date-fns';

interface Props {
  employeeUid: string;
  employeeName: string;
}

interface CrmStats {
  totalLeads: number;
  wonOpportunities: number;
  openOpportunities: number;
  commissionThisMonth: number;
}

function SkeletonCard() {
  return <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />;
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white p-4 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#8B8B85' }}>
        {label}
      </p>
      <p className="text-2xl font-bold" style={{ color: '#0B1538' }}>{value}</p>
    </div>
  );
}

/** Split an array into chunks of at most `size` items. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

export function CrmPerformanceWidget({ employeeUid, employeeName: _employeeName }: Props) {
  const [stats,   setStats]   = useState<CrmStats | null>(null);
  const [loading, setLoading] = useState(true);

  const now        = new Date();
  const monthLabel = format(now, 'MMMM yyyy');
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        // 1. Total leads where this employee is the primary RM
        const leadsSnap = await getDocs(
          query(
            collection(db, 'leads'),
            where('primaryOwnerId', '==', employeeUid),
            where('deleted', '==', false),
          )
        );
        const totalLeads = leadsSnap.size;
        const leadIds    = leadsSnap.docs.map((d) => d.id);

        // 2. Opportunities for each lead — count won and open ones owned by this employee
        let wonOpportunities  = 0;
        let openOpportunities = 0;

        if (leadIds.length > 0) {
          // Chunk to avoid doing too many parallel reads (Firestore limit: 500 concurrent)
          const chunks = chunkArray(leadIds, 20);
          for (const chunk of chunks) {
            await Promise.all(chunk.map(async (leadId) => {
              const opSnap = await getDocs(
                collection(db, 'leads', leadId, 'opportunities')
              );
              for (const d of opSnap.docs) {
                const data = d.data() as { ownerId?: string; status?: string };
                if (data.ownerId === employeeUid) {
                  if (data.status === 'won')  wonOpportunities++;
                  if (data.status === 'open') openOpportunities++;
                }
              }
            }));
          }
        }

        // 3. Commission paid this month: /commission_records where rmOwnerId === uid, status === 'paid'
        //    Filter by payout date in memory — avoids composite index on status + date.
        const commSnap = await getDocs(
          query(
            collection(db, 'commission_records'),
            where('rmOwnerId', '==', employeeUid),
            where('status',    '==', 'paid'),
          )
        );

        let commissionThisMonth = 0;
        for (const d of commSnap.docs) {
          const data = d.data() as { actualPayoutDate?: any; createdAt?: any; calculatedCommission?: number };
          const raw  = data.actualPayoutDate ?? data.createdAt;
          let payoutDate: Date | null = null;
          if (raw?.toDate)             payoutDate = raw.toDate() as Date;
          else if (typeof raw === 'string') payoutDate = new Date(raw);
          if (payoutDate && payoutDate >= monthStart) {
            commissionThisMonth += data.calculatedCommission ?? 0;
          }
        }

        if (!cancelled) {
          setStats({ totalLeads, wonOpportunities, openOpportunities, commissionThisMonth });
        }
      } catch {
        // CRM data is a convenience read — silently fail, show zeros
        if (!cancelled) {
          setStats({ totalLeads: 0, wonOpportunities: 0, openOpportunities: 0, commissionThisMonth: 0 });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStats();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeUid]);

  const conversionRate = stats && stats.totalLeads > 0
    ? Math.round((stats.wonOpportunities / stats.totalLeads) * 100)
    : 0;

  const hasActivity = stats
    ? stats.totalLeads > 0 || stats.openOpportunities > 0 || stats.commissionThisMonth > 0
    : false;

  const formatCurrency = (n: number) =>
    `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      {/* Heading */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-widest" style={{ color: '#8B8B85' }}>
          CRM Performance — {monthLabel}
        </h3>
        <Link
          to={`/crm/leads?ownerId=${employeeUid}`}
          className="flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
          style={{ color: '#C9A961' }}
        >
          View in CRM →
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : !hasActivity ? (
        <p className="text-sm text-center py-4" style={{ color: '#8B8B85' }}>
          No CRM activity this month
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard label="Active Leads"        value={stats!.totalLeads} />
            <StatCard
              label="Disbursals"
              value={
                <span style={{ color: stats!.commissionThisMonth > 0 ? '#166534' : '#0B1538' }}>
                  {formatCurrency(stats!.commissionThisMonth)}
                </span>
              }
            />
            <StatCard label="Open Opportunities"  value={stats!.openOpportunities} />
          </div>
          <p className="text-xs mt-3" style={{ color: '#8B8B85' }}>
            Conversion rate:{' '}
            <span className="font-semibold" style={{ color: '#0A0A0A' }}>
              {conversionRate}%
            </span>
            {' '}({stats!.wonOpportunities} won of {stats!.totalLeads} leads)
          </p>
        </>
      )}
    </div>
  );
}
