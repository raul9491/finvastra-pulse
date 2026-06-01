import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useAuth } from '../../auth/AuthContext';
import { useMisOverview } from '../hooks/useMisOverview';
import { usePayoutSlabs, seedDefaultSlabs } from '../hooks/usePayouts';
import type { CommissionStatement, RmPayout } from '../../../types';

// ─── Status pill ─────────────────────────────────────────────────────────────

const STATUS_BADGE_CLASS: Record<string, string> = {
  imported:     'badge-glass-muted',
  reconciling:  'badge-glass-info',
  reconciled:   'badge-glass-success',
  discrepancy:  'badge-glass-warning',
  closed:       'badge-glass-muted',
  draft:        'badge-glass-muted',
  approved:     'badge-glass-success',
  paid:         'badge-glass-success',
};

function StatusPill({ status }: { status: string }) {
  const cls = STATUS_BADGE_CLASS[status] ?? 'badge-glass-muted';
  return (
    <span className={`${cls} capitalize`}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  children: React.ReactNode;
}

function SummaryCard({ label, children }: SummaryCardProps) {
  return (
    <div className="glass-panel glass-card p-6">
      <p
        className="text-xs font-bold uppercase tracking-widest mb-3"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </p>
      {children}
    </div>
  );
}

// ─── Helper: format ₹ in lakhs ────────────────────────────────────────────────

function formatLakhs(amount: number): string {
  return `₹${(amount / 100_000).toFixed(1)}L`;
}

// ─── MisOverviewPage ──────────────────────────────────────────────────────────

export function MisOverviewPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const todayMonth = format(new Date(), 'yyyy-MM');
  const [selectedMonth, setSelectedMonth] = useState(todayMonth);

  const data = useMisOverview(selectedMonth);

  // Payout slabs (from usePayouts.ts — may be stub)
  const { slabs } = usePayoutSlabs();

  const [seedSuccess, setSeedSuccess] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const isAdmin = profile?.role === 'admin' || profile?.misAccess === 'admin';

  async function handleSeedSlabs() {
    if (!user) return;
    setSeeding(true);
    try {
      await seedDefaultSlabs(user.uid);
      setSeedSuccess(true);
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1
            className="text-3xl mb-1"
            style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}
          >
            Management Information System
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Commission reconciliation and RM payout overview.
          </p>
        </div>
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="glass-inp text-sm"
        />
      </div>

      {/* ── Seed slabs banner — dev only ── */}
      {import.meta.env.DEV && isAdmin && slabs.length === 0 && !seedSuccess && (
        <div
          className="rounded-xl p-4 flex items-center gap-4 mb-6"
          style={{ backgroundColor: 'rgba(201,169,97,0.08)', border: '1px solid rgba(201,169,97,0.25)' }}
        >
          <p className="text-sm flex-1" style={{ color: '#C9A961' }}>
            No payout slabs configured. Seed default slabs (20% generator, 50% convertor, 30% manager)?
          </p>
          <button
            onClick={handleSeedSlabs}
            disabled={seeding}
            className="px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors shrink-0"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
          >
            {seeding ? 'Seeding…' : 'Seed Defaults'}
          </button>
        </div>
      )}
      {seedSuccess && (
        <div
          className="rounded-xl p-4 mb-6"
          style={{ backgroundColor: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.25)' }}
        >
          <p className="text-sm font-medium" style={{ color: '#34d399' }}>Default payout slabs seeded successfully.</p>
        </div>
      )}

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">

        {/* Card 1 — Commission received vs expected */}
        <SummaryCard label="Commission">
          {data.loading ? (
            <div className="h-10 rounded animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          ) : (
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <p className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>Received</p>
                <p
                  className="text-2xl font-semibold"
                  style={{ color: data.variance >= 0 ? '#34d399' : '#f87171' }}
                >
                  {formatLakhs(data.currentMonthReceived)}
                </p>
              </div>
              <span style={{ color: 'var(--text-muted)' }}>vs</span>
              <div>
                <p className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>Expected</p>
                <p className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                  {formatLakhs(data.currentMonthExpected)}
                </p>
              </div>
              {data.variance !== 0 && (
                <span
                  className="text-xs font-semibold"
                  style={{ color: data.variance > 0 ? '#34d399' : '#f87171' }}
                >
                  {data.variance > 0 ? '+' : ''}₹{Math.abs(data.variance).toLocaleString('en-IN')}
                </span>
              )}
            </div>
          )}
        </SummaryCard>

        {/* Card 2 — Open Statements */}
        <SummaryCard label="Open Statements">
          {data.loading ? (
            <div className="h-10 rounded animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          ) : (
            <div>
              <p className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {data.openStatements}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                awaiting reconciliation
              </p>
            </div>
          )}
        </SummaryCard>

        {/* Card 3 — Pending RM Payouts */}
        <SummaryCard label="Pending RM Payouts">
          {data.loading ? (
            <div className="h-10 rounded animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          ) : (
            <div>
              <p className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {formatLakhs(data.pendingPayoutsAmount)}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                draft + approved
              </p>
            </div>
          )}
        </SummaryCard>

        {/* Card 4 — Discrepancies */}
        <SummaryCard label="Discrepancies">
          {data.loading ? (
            <div className="h-10 rounded animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          ) : (
            <div>
              <p
                className="text-4xl font-bold"
                style={{ color: data.discrepancyCount > 0 ? '#f87171' : '#34d399' }}
              >
                {data.discrepancyCount}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {data.discrepancyCount === 0 ? 'all clear' : 'lines need review'}
              </p>
            </div>
          )}
        </SummaryCard>
      </div>

      {/* ── Recent tables row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Recent statements */}
        <div className="glass-panel overflow-hidden">
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
          >
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recent Statements</p>
            <button
              onClick={() => navigate('/mis/statements')}
              className="text-xs font-medium hover:underline"
              style={{ color: '#C9A961' }}
            >
              View all
            </button>
          </div>

          {data.loading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 rounded animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
              ))}
            </div>
          ) : data.recentStatements.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
              No statements imported yet.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th className="px-4 py-2.5 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Provider</th>
                  <th className="px-4 py-2.5 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Period</th>
                  <th className="px-4 py-2.5 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>Total</th>
                  <th className="px-4 py-2.5 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recentStatements.map((stmt: CommissionStatement) => (
                  <tr
                    key={stmt.id}
                    onClick={() => navigate(`/mis/statements/${stmt.id}`)}
                    className="cursor-pointer hover:bg-white/5 transition-colors"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <td className="px-4 py-2.5 font-medium truncate max-w-30" style={{ color: 'var(--text-primary)' }}>
                      {stmt.providerId}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                      {stmt.periodStart === stmt.periodEnd
                        ? stmt.periodStart
                        : `${stmt.periodStart} – ${stmt.periodEnd}`}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium" style={{ color: 'var(--text-primary)' }}>
                      ₹{stmt.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill status={stmt.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent payouts */}
        <div className="glass-panel overflow-hidden">
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
          >
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recent RM Payouts</p>
            <button
              onClick={() => navigate('/mis/payouts')}
              className="text-xs font-medium hover:underline"
              style={{ color: '#C9A961' }}
            >
              View all
            </button>
          </div>

          {data.loading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 rounded animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
              ))}
            </div>
          ) : data.recentPayouts.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
              No payouts generated yet.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th className="px-4 py-2.5 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>RM</th>
                  <th className="px-4 py-2.5 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Period</th>
                  <th className="px-4 py-2.5 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>Amount</th>
                  <th className="px-4 py-2.5 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recentPayouts.map((payout: RmPayout) => (
                  <tr
                    key={payout.id}
                    className="hover:bg-white/5 transition-colors"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <td className="px-4 py-2.5 font-medium truncate max-w-30" style={{ color: 'var(--text-primary)' }}>
                      {payout.rmDisplayName}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                      {payout.periodStart === payout.periodEnd
                        ? payout.periodStart
                        : `${payout.periodStart} – ${payout.periodEnd}`}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium" style={{ color: 'var(--text-primary)' }}>
                      ₹{payout.totalPayout.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill status={payout.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
