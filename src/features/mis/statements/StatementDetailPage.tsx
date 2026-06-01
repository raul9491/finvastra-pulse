import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useAuth } from '../../auth/AuthContext';
import { useStatement, exportStatementCsv } from '../hooks/useStatements';
import { useProviders } from '../../crm/hooks/useOpportunities';
import type { StatementLine, StatementLineStatus, CommissionStatementStatus } from '../../../types';

// ─── Status pills ─────────────────────────────────────────────────────────────

const LINE_STATUS_BADGE: Record<StatementLineStatus, string> = {
  unmatched:   'badge-glass-danger',
  matched:     'badge-glass-success',
  discrepancy: 'badge-glass-warning',
  unknown:     'badge-glass-muted',
  excluded:    'badge-glass-muted',
};

function LinePill({ status }: { status: StatementLineStatus }) {
  return (
    <span className={`${LINE_STATUS_BADGE[status]} capitalize`}>
      {status}
    </span>
  );
}

const STMT_STATUS_BADGE: Record<CommissionStatementStatus, string> = {
  imported:    'badge-glass-muted',
  reconciling: 'badge-glass-info',
  reconciled:  'badge-glass-success',
  discrepancy: 'badge-glass-warning',
  closed:      'badge-glass-muted',
};

function StatementStatusPill({ status }: { status: CommissionStatementStatus }) {
  return (
    <span className={`${STMT_STATUS_BADGE[status]} capitalize`}>
      {status}
    </span>
  );
}

// ─── Stat badge ───────────────────────────────────────────────────────────────

function StatBadge({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm font-bold" style={{ color }}>{count}</span>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );
}

// ─── StatementDetailPage ──────────────────────────────────────────────────────

export function StatementDetailPage() {
  const { statementId } = useParams<{ statementId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const { statement, lines, loading } = useStatement(statementId ?? null);
  const providers = useProviders();

  const isAdmin = profile?.role === 'admin' || profile?.misAccess === 'admin';

  const providerName = useMemo(() => {
    if (!statement) return '';
    const p = providers.find((pr) => pr.id === statement.providerId);
    return p?.name ?? statement.providerId;
  }, [statement, providers]);

  function handleExport() {
    if (!statement) return;
    exportStatementCsv(statement, lines);
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-4">
        <div className="h-6 w-32 rounded animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
        <div className="h-40 rounded-2xl animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
        <div className="h-64 rounded-2xl animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
      </div>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (!statement) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate('/mis/statements')}
          className="text-sm font-medium hover:underline mb-6 flex items-center gap-1"
          style={{ color: 'var(--text-muted)' }}
        >
          ← Statements
        </button>
        <p className="text-sm text-center py-16" style={{ color: 'var(--text-muted)' }}>
          Statement not found.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">

      {/* ── Back button ── */}
      <button
        onClick={() => navigate('/mis/statements')}
        className="text-sm font-medium hover:underline mb-6 flex items-center gap-1"
        style={{ color: 'var(--text-muted)' }}
      >
        ← Commission Statements
      </button>

      {/* ── Header card ── */}
      <div className="glass-panel p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <h1
              className="text-2xl mb-1"
              style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: 'var(--text-primary)' }}
            >
              {providerName}
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {statement.fileName}
            </p>
          </div>
          <StatementStatusPill status={statement.status} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Period</p>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {statement.periodStart === statement.periodEnd
                ? statement.periodStart
                : `${statement.periodStart} – ${statement.periodEnd}`}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Statement Date</p>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {statement.statementDate
                ? format(new Date(statement.statementDate), 'd MMM yyyy')
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Received</p>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {statement.receivedDate
                ? format(new Date(statement.receivedDate), 'd MMM yyyy')
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Source</p>
            <p className="font-medium capitalize" style={{ color: 'var(--text-primary)' }}>{statement.source}</p>
          </div>
        </div>
      </div>

      {/* ── Summary row ── */}
      <div
        className="glass-panel px-6 py-4 mb-6 flex items-center gap-6 flex-wrap"
      >
        <StatBadge label="Matched"     count={statement.matchedCount}     color="#34d399" />
        <div className="w-px h-4" style={{ backgroundColor: 'rgba(255,255,255,0.12)' }} />
        <StatBadge label="Discrepancy" count={statement.discrepancyCount} color="#C9A961" />
        <div className="w-px h-4" style={{ backgroundColor: 'rgba(255,255,255,0.12)' }} />
        <StatBadge label="Unmatched"   count={statement.unmatchedCount}   color="#f87171" />
        <div className="w-px h-4" style={{ backgroundColor: 'rgba(255,255,255,0.12)' }} />
        <StatBadge
          label="Excluded"
          count={lines.filter((l) => l.status === 'excluded').length}
          color="var(--text-muted)"
        />
        <div className="w-px h-4" style={{ backgroundColor: 'rgba(255,255,255,0.12)' }} />
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold" style={{ color: '#C9A961' }}>
            ₹{statement.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Total</span>
        </div>

        {/* Action buttons pushed to right */}
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {isAdmin && (
            <button
              onClick={() => navigate(`/mis/reconciliation?statementId=${statement.id}`)}
              className="px-4 py-2 text-sm font-semibold rounded-lg transition-colors"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
            >
              Go to Reconciliation
            </button>
          )}
          <button
            onClick={handleExport}
            className="px-4 py-2 text-sm font-semibold rounded-lg transition-colors hover:bg-white/5"
            style={{ border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-primary)' }}
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Lines table ── */}
      <div className="glass-panel overflow-hidden">
        <div
          className="px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Statement Lines
            <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
              ({lines.length} line{lines.length !== 1 ? 's' : ''})
            </span>
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            View-only. Use Reconciliation to match or edit lines.
          </p>
        </div>

        {lines.length === 0 ? (
          <p className="px-5 py-10 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
            No lines loaded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th className="px-4 py-3 text-left font-semibold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Date</th>
                  <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Description</th>
                  <th className="px-4 py-3 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Amount</th>
                  <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Status</th>
                  <th className="px-4 py-3 text-left font-semibold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Matched Record</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line: StatementLine) => (
                  <tr key={line.id} className="hover:bg-white/5 transition-colors" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                      {line.parsedDate
                        ? format(new Date(line.parsedDate), 'd MMM yyyy')
                        : line.rawDate}
                    </td>
                    <td className="px-4 py-2.5 max-w-xs" style={{ color: 'var(--text-primary)' }}>
                      <span className="line-clamp-2">{line.rawDescription}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                      ₹{line.parsedAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      {line.discrepancyAmount !== null && line.discrepancyAmount !== 0 && (
                        <span
                          className="ml-1 text-[10px]"
                          style={{ color: line.discrepancyAmount > 0 ? '#34d399' : '#f87171' }}
                        >
                          ({line.discrepancyAmount > 0 ? '+' : ''}
                          {line.discrepancyAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <LinePill status={line.status} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[10px] truncate max-w-[160px]" style={{ color: 'var(--text-muted)' }}>
                      {line.matchedCommissionRecordId ?? '—'}
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
