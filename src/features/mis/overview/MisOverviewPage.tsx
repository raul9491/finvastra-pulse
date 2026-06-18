import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader } from '../../../components/ui/primitives';
import { useMisOverview } from '../hooks/useMisOverview';
import { usePayoutSlabs, seedDefaultSlabs } from '../hooks/usePayouts';
import type { CommissionStatement, RmPayout, CommissionRecord } from '../../../types';

// Extended type — CommissionRecord + disbursal fields written by CRM Disbursed stage
type DisbursalRecord = CommissionRecord & {
  loanNo?: string;
  applicationNo?: string;
  customerCompanyName?: string;
  disbursalDate?: string;
  disbursedAmount?: number;
  dsaCode?: string;
  dsaName?: string;
  cityState?: string;
};

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

type MisTab = 'overview' | 'disbursals';

export function MisOverviewPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const todayMonth = format(new Date(), 'yyyy-MM');
  const [selectedMonth, setSelectedMonth] = useState(todayMonth);
  // Phase P — /mis/overview?tab=disbursals deep-links straight to a tab
  // (used by the mis.disbursals shareable-page entry).
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<MisTab>(
    () => (searchParams.get('tab') === 'disbursals' ? 'disbursals' : 'overview'),
  );
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'disbursals' || t === 'overview') setActiveTab(t);
  }, [searchParams]);

  const data = useMisOverview(selectedMonth);

  // Payout slabs (from usePayouts.ts — may be stub)
  const { slabs } = usePayoutSlabs();

  const [seedSuccess, setSeedSuccess] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const isAdmin = profile?.role === 'admin' || profile?.misAccess === 'admin';

  // ── Disbursals tab — all commission_records, enriched with CRM disbursal data ──
  const [disbursals, setDisbursals] = useState<DisbursalRecord[]>([]);
  const [disbursalsLoading, setDisbursalsLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== 'disbursals' || !isAdmin) return;
    setDisbursalsLoading(true);
    getDocs(query(collection(db, 'commission_records'), orderBy('createdAt', 'desc')))
      .then((snap) => {
        setDisbursals(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DisbursalRecord)));
      })
      .catch(() => {})
      .finally(() => setDisbursalsLoading(false));
  }, [activeTab, isAdmin]);

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

  // Filter disbursals by selected month (by disbursalDate if present, else expectedPayoutDate)
  const filteredDisbursals = disbursals.filter((r) => {
    const dateStr = r.disbursalDate ?? r.expectedPayoutDate ?? '';
    return dateStr.startsWith(selectedMonth);
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">

      {/* ── Header ── */}
      <PageHeader
        title="Management Information System"
        subtitle="Commission reconciliation and RM payout overview."
        pinKey="mis.overview"
        actions={
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="glass-inp text-sm"
          />
        }
      />

      {/* ── Tab strip ── */}
      <div className="flex gap-1 rounded-lg p-1 mb-6 w-fit"
        style={{ backgroundColor: 'var(--glass-panel-bg)' }}>
        {(['overview', 'disbursals'] as MisTab[]).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize"
            style={{
              backgroundColor: activeTab === tab ? 'var(--shell-hover-hard)' : 'transparent',
              color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
            }}>
            {tab === 'disbursals' ? 'Disbursals' : 'Overview'}
          </button>
        ))}
      </div>

      {/* ── DISBURSALS TAB ── */}
      {activeTab === 'disbursals' && (
        <div>
          {disbursalsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
              ))}
            </div>
          ) : filteredDisbursals.length === 0 ? (
            <div className="glass-panel py-16 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No commission records for {selectedMonth}.
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--text-dim, rgba(255,255,255,0.3))' }}>
                Disbursal data is captured when the CRM opportunity moves to the Disbursed stage.
              </p>
            </div>
          ) : (
            <div className="glass-panel overflow-x-auto">
              <div className="px-5 py-4 flex items-center justify-between"
                style={{ borderBottom: '1px solid var(--shell-border)' }}>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    All Cases — {selectedMonth}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {filteredDisbursals.length} record{filteredDisbursals.length !== 1 ? 's' : ''} ·
                    Commission: ₹{filteredDisbursals.reduce((s, r) => s + (r.calculatedCommission ?? 0), 0)
                      .toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </p>
                </div>
              </div>
              <table className="w-full text-xs min-w-175">
                <thead>
                  <tr style={{ backgroundColor: 'var(--shell-hover-soft)', borderBottom: '1px solid var(--shell-border)' }}>
                    <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Loan No</th>
                    <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>App No</th>
                    <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Company</th>
                    <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Disbursal Date</th>
                    <th className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>Amount</th>
                    <th className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>Commission</th>
                    <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>DSA Code</th>
                    <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Sub DSA</th>
                    <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Status</th>
                    <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>CRM</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDisbursals.map((rec) => (
                    <tr key={rec.id} className="hover:bg-(--shell-hover-soft) transition-colors"
                      style={{ borderBottom: '1px solid var(--shell-border)' }}>
                      <td className="px-4 py-3 font-mono font-semibold" style={{ color: '#C9A961' }}>
                        {rec.loanNo ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                        {rec.applicationNo ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td className="px-4 py-3 max-w-32 truncate" style={{ color: 'var(--text-primary)' }}>
                        {rec.customerCompanyName ?? '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                        {rec.disbursalDate
                          ? format(new Date(rec.disbursalDate), 'd MMM yyyy')
                          : <span style={{ color: 'var(--text-muted)' }}>Pending</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                        {rec.disbursedAmount
                          ? `₹${Number(rec.disbursedAmount).toLocaleString('en-IN')}`
                          : `₹${rec.basisAmount.toLocaleString('en-IN')}`}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap" style={{ color: '#34d399' }}>
                        ₹{rec.calculatedCommission.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                        {rec.dsaCode ?? '—'}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                        {rec.connectorName
                          ? (
                            <span className="inline-flex items-center gap-1.5 flex-wrap">
                              <span>{rec.connectorName}{rec.connectorCode ? <span style={{ color: 'var(--text-muted)' }}> · {rec.connectorCode}</span> : null}</span>
                              {rec.dsaCodeUsed && (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                  title={rec.dsaCodeUsed === 'finvastra'
                                    ? 'Case ran under our DSA code — bank pays Finvastra; connector payout owed'
                                    : "Case ran under the connector's own DSA code — bank pays them directly"}
                                  style={rec.dsaCodeUsed === 'finvastra'
                                    ? { backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }
                                    : { backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-muted)' }}>
                                  {rec.dsaCodeUsed === 'finvastra' ? 'Our DSA' : 'Own DSA'}
                                </span>
                              )}
                            </span>
                          )
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={
                          rec.status === 'paid' ? 'badge-glass-success' :
                          rec.status === 'clawed_back' ? 'badge-glass-danger' :
                          'badge-glass-muted'
                        }>
                          {rec.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {rec.leadId && rec.opportunityId && (
                          <button
                            onClick={() => navigate(`/crm/leads/${rec.leadId}/opportunities/${rec.opportunityId}`)}
                            className="text-[10px] font-semibold hover:underline"
                            style={{ color: '#C9A961' }}
                          >
                            View →
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
      )}

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && <>

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
            <div className="h-10 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
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
            <div className="h-10 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
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
            <div className="h-10 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
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
            <div className="h-10 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
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
            style={{ borderBottom: '1px solid var(--shell-border)' }}
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
                <div key={i} className="h-8 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
              ))}
            </div>
          ) : data.recentStatements.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
              No statements imported yet.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: 'var(--shell-hover-soft)', borderBottom: '1px solid var(--shell-border)' }}>
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
                    className="cursor-pointer hover:bg-(--shell-hover-soft) transition-colors"
                    style={{ borderBottom: '1px solid var(--shell-border)' }}
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
            style={{ borderBottom: '1px solid var(--shell-border)' }}
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
                <div key={i} className="h-8 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
              ))}
            </div>
          ) : data.recentPayouts.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
              No payouts generated yet.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: 'var(--shell-hover-soft)', borderBottom: '1px solid var(--shell-border)' }}>
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
                    className="hover:bg-(--shell-hover-soft) transition-colors"
                    style={{ borderBottom: '1px solid var(--shell-border)' }}
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

      </>} {/* end overview tab */}

    </div>
  );
}
