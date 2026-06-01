import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { usePayouts } from '../hooks/usePayouts';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import type { SearchableSelectOption } from '../../../components/ui/SearchableSelect';
import type { RmPayout } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatPeriod(start: string, end: string): string {
  if (start === end) return start;
  return `${start} – ${end}`;
}

// ─── Status pill ──────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: RmPayout['status'] }) {
  const cls: Record<RmPayout['status'], string> = {
    draft:    'badge-glass-muted',
    approved: 'badge-glass-info',
    paid:     'badge-glass-success',
  };
  const label: Record<RmPayout['status'], string> = {
    draft:    'Draft',
    approved: 'Approved',
    paid:     'Paid',
  };
  return (
    <span className={cls[status]}>
      {label[status]}
    </span>
  );
}

// ─── PayoutsPage ──────────────────────────────────────────────────────────────

export function PayoutsPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const isAdmin = profile?.role === 'admin' || profile?.misAccess === 'admin';

  // Admin gets all payouts; RM gets only their own
  const { payouts, loading } = usePayouts(isAdmin ? undefined : user?.uid);
  const { employees } = useAllEmployees();

  // Filter bar state (admin only)
  const [filterPeriod, setFilterPeriod] = useState('');
  const [filterRm, setFilterRm]         = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Build RM options for filter
  const rmOptions: SearchableSelectOption[] = useMemo(() => {
    const seen = new Set<string>();
    const opts: SearchableSelectOption[] = [{ value: '', label: 'All RMs' }];
    for (const p of payouts) {
      if (!seen.has(p.rmId)) {
        seen.add(p.rmId);
        const emp = employees.find((e) => e.userId === p.rmId);
        opts.push({ value: p.rmId, label: emp?.displayName ?? p.rmDisplayName });
      }
    }
    return opts;
  }, [payouts, employees]);

  const statusOptions: SearchableSelectOption[] = [
    { value: '',         label: 'All statuses' },
    { value: 'draft',    label: 'Draft' },
    { value: 'approved', label: 'Approved' },
    { value: 'paid',     label: 'Paid' },
  ];

  // Apply filters
  const filtered = useMemo(() => {
    return payouts.filter((p) => {
      if (filterPeriod && p.periodStart !== filterPeriod && p.periodEnd !== filterPeriod) return false;
      if (filterRm && p.rmId !== filterRm) return false;
      if (filterStatus && p.status !== filterStatus) return false;
      return true;
    });
  }, [payouts, filterPeriod, filterRm, filterStatus]);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1
            className="text-3xl mb-1"
            style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: 'var(--text-primary)' }}
          >
            RM Payouts
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Monthly commission payouts per Relationship Manager, based on received commissions.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => navigate('/mis/payouts/generate')}
            className="px-4 py-2 text-sm font-semibold rounded-lg flex items-center gap-2 transition-colors"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
          >
            Generate Payouts
            <span aria-hidden>→</span>
          </button>
        )}
      </div>

      {/* Filter bar (admin only) */}
      {isAdmin && (
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="w-40">
            <input
              type="month"
              value={filterPeriod}
              onChange={(e) => setFilterPeriod(e.target.value)}
              className="glass-inp w-full text-sm"
              placeholder="Period"
            />
          </div>
          <div className="w-52">
            <SearchableSelect
              options={rmOptions}
              value={filterRm}
              onChange={setFilterRm}
              placeholder="Filter by RM…"
            />
          </div>
          <div className="w-44">
            <SearchableSelect
              options={statusOptions}
              value={filterStatus}
              onChange={setFilterStatus}
              placeholder="Filter by status…"
            />
          </div>
          {(filterPeriod || filterRm || filterStatus) && (
            <button
              onClick={() => { setFilterPeriod(''); setFilterRm(''); setFilterStatus(''); }}
              className="text-xs px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
              style={{ color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.15)' }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="px-8 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading payouts…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-8 py-12 text-center">
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              {payouts.length === 0 ? 'No payouts generated yet' : 'No payouts match your filters'}
            </p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {isAdmin && payouts.length === 0
                ? 'Use "Generate Payouts" to create monthly RM payout records.'
                : 'Try adjusting your filters.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <th className="px-5 py-3 text-left font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>RM Name</th>
                <th className="px-5 py-3 text-left font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Period</th>
                <th className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Total Received</th>
                <th className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Payout Amount</th>
                <th className="px-5 py-3 text-center font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Status</th>
                <th className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((payout) => (
                <tr
                  key={payout.id}
                  className="hover:bg-white/5 transition-colors"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <td className="px-5 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                    {payout.rmDisplayName}
                  </td>
                  <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                    {formatPeriod(payout.periodStart, payout.periodEnd)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {formatCurrency(payout.totalReceivedBase)}
                  </td>
                  <td className="px-5 py-3 text-right font-bold" style={{ color: '#C9A961' }}>
                    {formatCurrency(payout.totalPayout)}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <StatusPill status={payout.status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => navigate(`/mis/payouts/${payout.id}`)}
                      className="text-xs px-3 py-1.5 rounded-md font-semibold hover:bg-white/5 transition-colors"
                      style={{ color: '#C9A961', border: '1px solid rgba(201,169,97,0.30)' }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Summary footer */}
      {filtered.length > 0 && (
        <div className="mt-4 flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>{filtered.length} payout{filtered.length !== 1 ? 's' : ''}</span>
          <span>
            Total:{' '}
            <span className="font-semibold" style={{ color: '#C9A961' }}>
              {formatCurrency(filtered.reduce((sum, p) => sum + p.totalPayout, 0))}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
