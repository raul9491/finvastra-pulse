import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useAuth } from '../../auth/AuthContext';
import { useMisOverview } from '../hooks/useMisOverview';
import { usePayoutSlabs, seedDefaultSlabs } from '../hooks/usePayouts';
import type { CommissionStatement, RmPayout } from '../../../types';

// ─── Status pill ─────────────────────────────────────────────────────────────

const STATUS_PILL_CLASSES: Record<string, string> = {
  imported:     'bg-slate-100 text-slate-700',
  reconciling:  'bg-blue-50 text-blue-700',
  reconciled:   'bg-green-50 text-green-700',
  discrepancy:  'bg-amber-50 text-amber-700',
  closed:       'bg-slate-50 text-slate-500',
  draft:        'bg-slate-100 text-slate-700',
  approved:     'bg-green-50 text-green-700',
  paid:         'bg-emerald-50 text-emerald-700',
};

function StatusPill({ status }: { status: string }) {
  const cls = STATUS_PILL_CLASSES[status] ?? 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${cls}`}>
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
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
      <p
        className="text-xs font-bold uppercase tracking-widest mb-3"
        style={{ color: '#8B8B85' }}
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
            style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontWeight: 300, color: '#0B1538' }}
          >
            Management Information System
          </h1>
          <p className="text-sm" style={{ color: '#8B8B85' }}>
            Commission reconciliation and RM payout overview.
          </p>
        </div>
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-navy bg-white"
        />
      </div>

      {/* ── Seed slabs banner — dev only ── */}
      {import.meta.env.DEV && isAdmin && slabs.length === 0 && !seedSuccess && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-4 mb-6">
          <p className="text-sm flex-1" style={{ color: '#92400E' }}>
            No payout slabs configured. Seed default slabs (20% generator, 50% convertor, 30% manager)?
          </p>
          <button
            onClick={handleSeedSlabs}
            disabled={seeding}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-700 text-white disabled:opacity-50 hover:bg-amber-800 transition-colors shrink-0"
          >
            {seeding ? 'Seeding…' : 'Seed Defaults'}
          </button>
        </div>
      )}
      {seedSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-green-800 font-medium">Default payout slabs seeded successfully.</p>
        </div>
      )}

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">

        {/* Card 1 — Commission received vs expected */}
        <SummaryCard label="Commission">
          {data.loading ? (
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
          ) : (
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <p className="text-[10px] uppercase" style={{ color: '#8B8B85' }}>Received</p>
                <p
                  className="text-2xl font-semibold"
                  style={{ color: data.variance >= 0 ? '#166534' : '#9F1239' }}
                >
                  {formatLakhs(data.currentMonthReceived)}
                </p>
              </div>
              <span style={{ color: '#8B8B85' }}>vs</span>
              <div>
                <p className="text-[10px] uppercase" style={{ color: '#8B8B85' }}>Expected</p>
                <p className="text-lg font-medium" style={{ color: '#2A2A2A' }}>
                  {formatLakhs(data.currentMonthExpected)}
                </p>
              </div>
              {data.variance !== 0 && (
                <span
                  className="text-xs font-semibold"
                  style={{ color: data.variance > 0 ? '#166534' : '#9F1239' }}
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
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
          ) : (
            <div>
              <p className="text-4xl font-bold" style={{ color: '#0B1538' }}>
                {data.openStatements}
              </p>
              <p className="text-xs mt-1" style={{ color: '#8B8B85' }}>
                awaiting reconciliation
              </p>
            </div>
          )}
        </SummaryCard>

        {/* Card 3 — Pending RM Payouts */}
        <SummaryCard label="Pending RM Payouts">
          {data.loading ? (
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
          ) : (
            <div>
              <p className="text-2xl font-semibold" style={{ color: '#0B1538' }}>
                {formatLakhs(data.pendingPayoutsAmount)}
              </p>
              <p className="text-xs mt-1" style={{ color: '#8B8B85' }}>
                draft + approved
              </p>
            </div>
          )}
        </SummaryCard>

        {/* Card 4 — Discrepancies */}
        <SummaryCard label="Discrepancies">
          {data.loading ? (
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
          ) : (
            <div>
              <p
                className="text-4xl font-bold"
                style={{ color: data.discrepancyCount > 0 ? '#9F1239' : '#166534' }}
              >
                {data.discrepancyCount}
              </p>
              <p className="text-xs mt-1" style={{ color: '#8B8B85' }}>
                {data.discrepancyCount === 0 ? 'all clear' : 'lines need review'}
              </p>
            </div>
          )}
        </SummaryCard>
      </div>

      {/* ── Recent tables row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Recent statements */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <p className="text-sm font-semibold" style={{ color: '#0B1538' }}>Recent Statements</p>
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
                <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : data.recentStatements.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: '#8B8B85' }}>
              No statements imported yet.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-paper">
                  <th className="px-4 py-2.5 text-left font-semibold text-navy">Provider</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-navy">Period</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-navy">Total</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-navy">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recentStatements.map((stmt: CommissionStatement, i: number) => (
                  <tr
                    key={stmt.id}
                    onClick={() => navigate(`/mis/statements/${stmt.id}`)}
                    className={`cursor-pointer hover:bg-paper-warm transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-paper'}`}
                  >
                    <td className="px-4 py-2.5 font-medium text-ink truncate max-w-30">
                      {stmt.providerId}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">
                      {stmt.periodStart === stmt.periodEnd
                        ? stmt.periodStart
                        : `${stmt.periodStart} – ${stmt.periodEnd}`}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-ink">
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
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <p className="text-sm font-semibold" style={{ color: '#0B1538' }}>Recent RM Payouts</p>
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
                <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : data.recentPayouts.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: '#8B8B85' }}>
              No payouts generated yet.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-paper">
                  <th className="px-4 py-2.5 text-left font-semibold text-navy">RM</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-navy">Period</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-navy">Amount</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-navy">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recentPayouts.map((payout: RmPayout, i: number) => (
                  <tr
                    key={payout.id}
                    className={i % 2 === 0 ? 'bg-white' : 'bg-paper'}
                  >
                    <td className="px-4 py-2.5 font-medium text-ink truncate max-w-30">
                      {payout.rmDisplayName}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">
                      {payout.periodStart === payout.periodEnd
                        ? payout.periodStart
                        : `${payout.periodStart} – ${payout.periodEnd}`}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-ink">
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
