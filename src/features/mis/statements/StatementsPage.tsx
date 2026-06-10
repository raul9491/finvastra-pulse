import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useAuth } from '../../auth/AuthContext';
import { useStatements, closeStatement, exportStatementCsv } from '../hooks/useStatements';
import { useProviders } from '../../crm/hooks/useOpportunities';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import type { CommissionStatement, CommissionStatementStatus } from '../../../types';
import type { SearchableSelectOption } from '../../../components/ui/SearchableSelect';

// ─── Status pill ─────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<CommissionStatementStatus, string> = {
  imported:    'badge-glass-muted',
  reconciling: 'badge-glass-info',
  reconciled:  'badge-glass-success',
  discrepancy: 'badge-glass-warning',
  closed:      'badge-glass-muted',
};

function StatusPill({ status }: { status: CommissionStatementStatus }) {
  return (
    <span className={`${STATUS_BADGE[status]} capitalize`}>
      {status}
    </span>
  );
}

// ─── StatementsPage ───────────────────────────────────────────────────────────

export function StatementsPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const { statements, loading } = useStatements();
  const providers = useProviders();

  // ── Filters ──────────────────────────────────────────────────────────────
  const [filterProviderId, setFilterProviderId] = useState('');
  const [filterPeriod,     setFilterPeriod]     = useState('');
  const [filterStatus,     setFilterStatus]     = useState<CommissionStatementStatus | ''>('');

  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin' || profile?.misAccess === 'admin';

  // Provider name lookup map
  const providerMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of providers) map.set(p.id, p.name);
    return map;
  }, [providers]);

  // Provider options for SearchableSelect filter
  const providerOptions: SearchableSelectOption[] = useMemo(() => [
    { value: '', label: 'All providers' },
    ...providers.map((p) => ({ value: p.id, label: p.name, description: p.type })),
  ], [providers]);

  // Filtered list
  const filtered = useMemo(() => {
    return statements.filter((s) => {
      if (filterProviderId && s.providerId !== filterProviderId) return false;
      if (filterPeriod && s.periodStart !== filterPeriod && s.periodEnd !== filterPeriod) return false;
      if (filterStatus && s.status !== filterStatus) return false;
      return true;
    });
  }, [statements, filterProviderId, filterPeriod, filterStatus]);

  async function handleClose(stmt: CommissionStatement) {
    if (!user) return;
    setClosingId(stmt.id);
    setCloseError(null);
    try {
      await closeStatement(stmt.id, user.uid);
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : 'Failed to close statement.');
    } finally {
      setClosingId(null);
    }
  }

  function handleExport(stmt: CommissionStatement) {
    // Export with empty lines array — full lines fetched in detail page.
    // Exporting from the list shows statement header only.
    exportStatementCsv(stmt, []);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1
            className="text-3xl mb-1"
            style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: 'var(--text-primary)' }}
          >
            Commission Statements
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            All imported commission statements from banks, AMCs and insurers.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => navigate('/mis/statements/upload')}
            className="shrink-0 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
          >
            + Upload New Statement
          </button>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="w-52">
          <SearchableSelect
            options={providerOptions}
            value={filterProviderId}
            onChange={setFilterProviderId}
            placeholder="All providers"
            label="Filter by provider"
          />
        </div>
        <input
          type="month"
          value={filterPeriod}
          onChange={(e) => setFilterPeriod(e.target.value)}
          className="glass-inp text-sm"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as CommissionStatementStatus | '')}
          className="glass-inp text-sm"
        >
          <option value="">All statuses</option>
          <option value="imported">Imported</option>
          <option value="reconciling">Reconciling</option>
          <option value="reconciled">Reconciled</option>
          <option value="discrepancy">Discrepancy</option>
          <option value="closed">Closed</option>
        </select>
        {(filterProviderId || filterPeriod || filterStatus) && (
          <button
            onClick={() => { setFilterProviderId(''); setFilterPeriod(''); setFilterStatus(''); }}
            className="text-xs font-medium underline"
            style={{ color: 'var(--text-muted)' }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Error banner ── */}
      {closeError && (
        <div
          className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171' }}
        >
          {closeError}
        </div>
      )}

      {/* ── Table ── */}
      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {statements.length === 0
                ? 'No statements imported yet. Upload your first statement.'
                : 'No statements match the selected filters.'}
            </p>
            {isAdmin && statements.length === 0 && (
              <button
                onClick={() => navigate('/mis/statements/upload')}
                className="mt-4 px-4 py-2 text-sm font-semibold rounded-lg transition-colors"
                style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
              >
                Upload Statement
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: 'var(--shell-hover-soft)', borderBottom: '1px solid var(--shell-border)' }}>
                  <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Provider</th>
                  <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Period</th>
                  <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Received Date</th>
                  <th className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>Total</th>
                  <th className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>Lines</th>
                  <th className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>Matched</th>
                  <th className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>Disc.</th>
                  <th className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>Unmatched</th>
                  <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Status</th>
                  <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((stmt: CommissionStatement) => {
                  const providerName = providerMap.get(stmt.providerId) ?? stmt.providerId;
                  return (
                    <tr
                      key={stmt.id}
                      className="hover:bg-(--shell-hover-soft) transition-colors"
                      style={{ borderBottom: '1px solid var(--shell-border)' }}
                    >
                      <td className="px-4 py-3 font-medium max-w-[140px] truncate" style={{ color: 'var(--text-primary)' }}>
                        {providerName}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                        {stmt.periodStart === stmt.periodEnd
                          ? stmt.periodStart
                          : `${stmt.periodStart} – ${stmt.periodEnd}`}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                        {stmt.receivedDate
                          ? format(new Date(stmt.receivedDate), 'd MMM yyyy')
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                        ₹{stmt.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-4 py-3 text-right" style={{ color: 'var(--text-primary)' }}>{stmt.lineCount}</td>
                      <td className="px-4 py-3 text-right" style={{ color: '#34d399' }}>
                        {stmt.matchedCount}
                      </td>
                      <td
                        className="px-4 py-3 text-right font-medium"
                        style={{ color: stmt.discrepancyCount > 0 ? '#C9A961' : 'var(--text-primary)' }}
                      >
                        {stmt.discrepancyCount}
                      </td>
                      <td
                        className="px-4 py-3 text-right font-medium"
                        style={{ color: stmt.unmatchedCount > 0 ? '#f87171' : 'var(--text-primary)' }}
                      >
                        {stmt.unmatchedCount}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={stmt.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isAdmin && (
                            <button
                              onClick={() => navigate(`/mis/reconciliation?statementId=${stmt.id}`)}
                              className="text-[11px] font-semibold hover:underline whitespace-nowrap"
                              style={{ color: '#60a5fa' }}
                            >
                              Reconcile
                            </button>
                          )}
                          <button
                            onClick={() => navigate(`/mis/statements/${stmt.id}`)}
                            className="text-[11px] font-semibold hover:underline"
                            style={{ color: '#C9A961' }}
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleExport(stmt)}
                            className="text-[11px] font-semibold hover:underline"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            Export CSV
                          </button>
                          {isAdmin && stmt.unmatchedCount === 0 && stmt.status !== 'closed' && (
                            <button
                              onClick={() => handleClose(stmt)}
                              disabled={closingId === stmt.id}
                              className="text-[11px] font-semibold hover:underline disabled:opacity-50"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              {closingId === stmt.id ? 'Closing…' : 'Close'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
