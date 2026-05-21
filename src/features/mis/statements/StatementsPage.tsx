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

const STATUS_STYLES: Record<CommissionStatementStatus, string> = {
  imported:    'bg-slate-100 text-slate-700',
  reconciling: 'bg-blue-50 text-blue-700',
  reconciled:  'bg-green-50 text-green-700',
  discrepancy: 'bg-amber-50 text-amber-700',
  closed:      'bg-slate-50 text-slate-500',
};

function StatusPill({ status }: { status: CommissionStatementStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${STATUS_STYLES[status]}`}>
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
            style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: '#0B1538' }}
          >
            Commission Statements
          </h1>
          <p className="text-sm" style={{ color: '#8B8B85' }}>
            All imported commission statements from banks, AMCs and insurers.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => navigate('/mis/statements/upload')}
            className="shrink-0 px-4 py-2.5 rounded-lg text-sm font-semibold bg-[#0B1538] text-white hover:bg-[#1B2A4E] transition-colors"
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
          className="px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538] bg-white"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as CommissionStatementStatus | '')}
          className="px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538] bg-white"
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
            style={{ color: '#8B8B85' }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Error banner ── */}
      {closeError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {closeError}
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium" style={{ color: '#2A2A2A' }}>
              {statements.length === 0
                ? 'No statements imported yet. Upload your first statement.'
                : 'No statements match the selected filters.'}
            </p>
            {isAdmin && statements.length === 0 && (
              <button
                onClick={() => navigate('/mis/statements/upload')}
                className="mt-4 px-4 py-2 text-sm font-semibold rounded-lg bg-[#C9A961] text-[#0B1538] hover:bg-[#E5C97C] transition-colors"
              >
                Upload Statement
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#F2EFE7]">
                  <th className="px-4 py-3 text-left font-semibold text-navy">Provider</th>
                  <th className="px-4 py-3 text-left font-semibold text-navy">Period</th>
                  <th className="px-4 py-3 text-left font-semibold text-navy">Received Date</th>
                  <th className="px-4 py-3 text-right font-semibold text-navy">Total</th>
                  <th className="px-4 py-3 text-right font-semibold text-navy">Lines</th>
                  <th className="px-4 py-3 text-right font-semibold text-navy">Matched</th>
                  <th className="px-4 py-3 text-right font-semibold text-navy">Disc.</th>
                  <th className="px-4 py-3 text-right font-semibold text-navy">Unmatched</th>
                  <th className="px-4 py-3 text-left font-semibold text-navy">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-navy">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((stmt: CommissionStatement, i: number) => {
                  const providerName = providerMap.get(stmt.providerId) ?? stmt.providerId;
                  return (
                    <tr
                      key={stmt.id}
                      className={i % 2 === 0 ? 'bg-white' : 'bg-[#FAFAF7]'}
                    >
                      <td className="px-4 py-3 font-medium text-[#0A0A0A] max-w-[140px] truncate">
                        {providerName}
                      </td>
                      <td className="px-4 py-3 text-[#2A2A2A] whitespace-nowrap">
                        {stmt.periodStart === stmt.periodEnd
                          ? stmt.periodStart
                          : `${stmt.periodStart} – ${stmt.periodEnd}`}
                      </td>
                      <td className="px-4 py-3 text-[#2A2A2A] whitespace-nowrap">
                        {stmt.receivedDate
                          ? format(new Date(stmt.receivedDate), 'd MMM yyyy')
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-[#0A0A0A] whitespace-nowrap">
                        ₹{stmt.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-4 py-3 text-right text-[#2A2A2A]">{stmt.lineCount}</td>
                      <td className="px-4 py-3 text-right" style={{ color: '#166534' }}>
                        {stmt.matchedCount}
                      </td>
                      <td
                        className="px-4 py-3 text-right font-medium"
                        style={{ color: stmt.discrepancyCount > 0 ? '#92400E' : '#2A2A2A' }}
                      >
                        {stmt.discrepancyCount}
                      </td>
                      <td
                        className="px-4 py-3 text-right font-medium"
                        style={{ color: stmt.unmatchedCount > 0 ? '#9F1239' : '#2A2A2A' }}
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
                              className="text-[11px] font-semibold text-[#0B1538] hover:underline whitespace-nowrap"
                            >
                              Reconcile
                            </button>
                          )}
                          <button
                            onClick={() => navigate(`/mis/statements/${stmt.id}`)}
                            className="text-[11px] font-semibold text-[#C9A961] hover:underline"
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleExport(stmt)}
                            className="text-[11px] font-semibold text-[#8B8B85] hover:underline"
                          >
                            Export CSV
                          </button>
                          {isAdmin && stmt.unmatchedCount === 0 && stmt.status !== 'closed' && (
                            <button
                              onClick={() => handleClose(stmt)}
                              disabled={closingId === stmt.id}
                              className="text-[11px] font-semibold text-slate-500 hover:underline disabled:opacity-50"
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
