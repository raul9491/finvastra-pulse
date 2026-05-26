import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Plus } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useMyLeaveBalance, useMyApplications, cancelLeave } from '../hooks/useLeave';
import type { LeaveApplication, LeaveStatus } from '../../../types';

// ─── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: LeaveStatus }) {
  const config: Record<LeaveStatus, { label: string; color: string; bg: string }> = {
    pending:   { label: 'Pending',   color: '#92400E', bg: '#FEF3C7' },
    approved:  { label: 'Approved',  color: '#065F46', bg: '#D1FAE5' },
    rejected:  { label: 'Rejected',  color: '#991B1B', bg: '#FEE2E2' },
    cancelled: { label: 'Cancelled', color: '#374151', bg: '#F3F4F6' },
  };
  const { label, color, bg } = config[status];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ color, backgroundColor: bg }}
    >
      {label}
    </span>
  );
}

// ─── Balance card ─────────────────────────────────────────────────────────────

interface BalanceCardProps {
  label: string;
  used: number;
  total: number;
  remaining: number;
}

function BalanceCard({ label, used, total, remaining }: BalanceCardProps) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <p
        className="text-xs font-bold uppercase tracking-widest mb-1"
        style={{ color: '#8B8B85' }}
      >
        {label}
      </p>
      <p className="text-2xl font-semibold" style={{ color: '#0A0A0A' }}>
        {remaining}
      </p>
      <p className="text-xs" style={{ color: '#8B8B85' }}>
        days remaining &nbsp;·&nbsp; {used}/{total} used
      </p>
      <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: '#C9A961' }}
        />
      </div>
    </div>
  );
}

// ─── Leave type label ─────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  casual:   'Casual',
  sick:     'Sick',
  earned:   'Earned',
  lop:      'LOP',
  optional: 'Optional',
};

// ─── LeavePage ────────────────────────────────────────────────────────────────

export function LeavePage() {
  const { user } = useAuth();
  const year = new Date().getFullYear();
  const { balance, loading: balLoading } = useMyLeaveBalance(user?.uid ?? '', year);
  const { applications, loading: appsLoading } = useMyApplications(user?.uid ?? '');

  const handleCancel = async (app: LeaveApplication) => {
    if (app.status !== 'pending') return;
    if (!window.confirm('Cancel this leave application?')) return;
    await cancelLeave(app.id);
  };

  return (
    <div className="space-y-8 max-w-4xl">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            className="text-3xl mb-1"
            style={{
              fontFamily: '"Fraunces", Georgia, serif',
              fontStyle: 'italic',
              fontVariationSettings: '"SOFT" 30',
              fontWeight: 300,
              color: '#0A0A0A',
            }}
          >
            Leave
          </h2>
          <p className="text-sm" style={{ color: '#8B8B85' }}>
            {year} balance &amp; applications
          </p>
        </div>
        <Link
          to="/hrms/leave/apply"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ backgroundColor: '#0B1538', color: '#FFFFFF' }}
        >
          <Plus size={15} />
          Apply for Leave
        </Link>
      </div>

      {/* ── Balance cards ── */}
      {balLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <BalanceCard
            label="Casual Leave"
            used={balance?.casual.used ?? 0}
            total={balance?.casual.total ?? 8}
            remaining={balance?.casual.remaining ?? 8}
          />
          <BalanceCard
            label="Sick Leave"
            used={balance?.sick.used ?? 0}
            total={balance?.sick.total ?? 7}
            remaining={balance?.sick.remaining ?? 7}
          />
          <BalanceCard
            label="Earned Leave"
            used={balance?.earned.used ?? 0}
            total={balance?.earned.total ?? 15}
            remaining={balance?.earned.remaining ?? 15}
          />
          {balance?.comp_off && (
            <BalanceCard
              label="Comp Off"
              used={balance.comp_off.used}
              total={balance.comp_off.total}
              remaining={balance.comp_off.remaining}
            />
          )}
        </div>
      )}

      {/* ── Applications table ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>
            My Applications
          </h3>
        </div>

        {appsLoading ? (
          <div className="p-6 text-sm" style={{ color: '#8B8B85' }}>
            Loading…
          </div>
        ) : applications.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm" style={{ color: '#8B8B85' }}>
            No leave applications yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Type', 'From', 'To', 'Days', 'Status', 'Applied On', ''].map((h) => (
                    <th
                      key={h}
                      className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: '#8B8B85' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => (
                  <tr key={app.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3.5 font-medium" style={{ color: '#0A0A0A' }}>
                      {TYPE_LABELS[app.type] ?? app.type}
                    </td>
                    <td className="px-6 py-3.5" style={{ color: '#2A2A2A' }}>
                      {format(new Date(app.fromDate), 'd MMM yyyy')}
                    </td>
                    <td className="px-6 py-3.5" style={{ color: '#2A2A2A' }}>
                      {format(new Date(app.toDate), 'd MMM yyyy')}
                    </td>
                    <td className="px-6 py-3.5" style={{ color: '#2A2A2A' }}>
                      {app.days}
                    </td>
                    <td className="px-6 py-3.5">
                      <StatusPill status={app.status} />
                    </td>
                    <td className="px-6 py-3.5 text-xs" style={{ color: '#8B8B85' }}>
                      {app.appliedAt
                        ? format(
                            (app.appliedAt as import('firebase/firestore').Timestamp).toDate(),
                            'd MMM yyyy',
                          )
                        : '—'}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      {app.status === 'pending' && (
                        <button
                          onClick={() => handleCancel(app)}
                          className="text-xs font-medium transition-opacity hover:opacity-60"
                          style={{ color: '#8B8B85' }}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
