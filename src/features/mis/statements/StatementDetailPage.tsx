import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useAuth } from '../../auth/AuthContext';
import { useStatement, exportStatementCsv } from '../hooks/useStatements';
import { useProviders } from '../../crm/hooks/useOpportunities';
import type { StatementLine, StatementLineStatus, CommissionStatementStatus } from '../../../types';

// ─── Status pills ─────────────────────────────────────────────────────────────

const LINE_STATUS_STYLES: Record<StatementLineStatus, string> = {
  unmatched:   'bg-red-50 text-red-700',
  matched:     'bg-green-50 text-green-700',
  discrepancy: 'bg-amber-50 text-amber-700',
  unknown:     'bg-slate-100 text-slate-600',
  excluded:    'bg-slate-50 text-slate-400',
};

function LinePill({ status }: { status: StatementLineStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${LINE_STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

const STMT_STATUS_STYLES: Record<CommissionStatementStatus, string> = {
  imported:    'bg-slate-100 text-slate-700',
  reconciling: 'bg-blue-50 text-blue-700',
  reconciled:  'bg-green-50 text-green-700',
  discrepancy: 'bg-amber-50 text-amber-700',
  closed:      'bg-slate-50 text-slate-500',
};

function StatementStatusPill({ status }: { status: CommissionStatementStatus }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${STMT_STATUS_STYLES[status]}`}>
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
      <span className="text-xs" style={{ color: '#8B8B85' }}>{label}</span>
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
        <div className="h-6 w-32 bg-slate-100 rounded animate-pulse" />
        <div className="h-40 bg-slate-100 rounded-2xl animate-pulse" />
        <div className="h-64 bg-slate-100 rounded-2xl animate-pulse" />
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
          style={{ color: '#8B8B85' }}
        >
          ← Statements
        </button>
        <p className="text-sm text-center py-16" style={{ color: '#8B8B85' }}>
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
        style={{ color: '#8B8B85' }}
      >
        ← Commission Statements
      </button>

      {/* ── Header card ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <h1
              className="text-2xl mb-1"
              style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: '#0B1538' }}
            >
              {providerName}
            </h1>
            <p className="text-sm" style={{ color: '#8B8B85' }}>
              {statement.fileName}
            </p>
          </div>
          <StatementStatusPill status={statement.status} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Period</p>
            <p className="font-medium text-[#0A0A0A]">
              {statement.periodStart === statement.periodEnd
                ? statement.periodStart
                : `${statement.periodStart} – ${statement.periodEnd}`}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Statement Date</p>
            <p className="font-medium text-[#0A0A0A]">
              {statement.statementDate
                ? format(new Date(statement.statementDate), 'd MMM yyyy')
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Received</p>
            <p className="font-medium text-[#0A0A0A]">
              {statement.receivedDate
                ? format(new Date(statement.receivedDate), 'd MMM yyyy')
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Source</p>
            <p className="font-medium text-[#0A0A0A] capitalize">{statement.source}</p>
          </div>
        </div>
      </div>

      {/* ── Summary row ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-4 mb-6 flex items-center gap-6 flex-wrap">
        <StatBadge label="Matched"     count={statement.matchedCount}     color="#166534" />
        <div className="w-px h-4 bg-slate-200" />
        <StatBadge label="Discrepancy" count={statement.discrepancyCount} color="#92400E" />
        <div className="w-px h-4 bg-slate-200" />
        <StatBadge label="Unmatched"   count={statement.unmatchedCount}   color="#9F1239" />
        <div className="w-px h-4 bg-slate-200" />
        <StatBadge
          label="Excluded"
          count={lines.filter((l) => l.status === 'excluded').length}
          color="#8B8B85"
        />
        <div className="w-px h-4 bg-slate-200" />
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold" style={{ color: '#0B1538' }}>
            ₹{statement.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </span>
          <span className="text-xs" style={{ color: '#8B8B85' }}>Total</span>
        </div>

        {/* Action buttons pushed to right */}
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {isAdmin && (
            <button
              onClick={() => navigate(`/mis/reconciliation?statementId=${statement.id}`)}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#C9A961] text-[#0B1538] hover:bg-[#E5C97C] transition-colors"
            >
              Go to Reconciliation
            </button>
          )}
          <button
            onClick={handleExport}
            className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 text-[#0A0A0A] hover:bg-slate-50 transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Lines table ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-sm font-semibold" style={{ color: '#0B1538' }}>
            Statement Lines
            <span className="ml-2 text-xs font-normal" style={{ color: '#8B8B85' }}>
              ({lines.length} line{lines.length !== 1 ? 's' : ''})
            </span>
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>
            View-only. Use Reconciliation to match or edit lines.
          </p>
        </div>

        {lines.length === 0 ? (
          <p className="px-5 py-10 text-sm text-center" style={{ color: '#8B8B85' }}>
            No lines loaded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#F2EFE7]">
                  <th className="px-4 py-3 text-left font-semibold text-navy whitespace-nowrap">Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-navy">Description</th>
                  <th className="px-4 py-3 text-right font-semibold text-navy whitespace-nowrap">Amount</th>
                  <th className="px-4 py-3 text-left font-semibold text-navy">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-navy whitespace-nowrap">Matched Record</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line: StatementLine, i: number) => (
                  <tr key={line.id} className={i % 2 === 0 ? 'bg-white' : 'bg-[#FAFAF7]'}>
                    <td className="px-4 py-2.5 text-[#2A2A2A] whitespace-nowrap">
                      {line.parsedDate
                        ? format(new Date(line.parsedDate), 'd MMM yyyy')
                        : line.rawDate}
                    </td>
                    <td className="px-4 py-2.5 text-[#0A0A0A] max-w-xs">
                      <span className="line-clamp-2">{line.rawDescription}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-[#0A0A0A] whitespace-nowrap">
                      ₹{line.parsedAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      {line.discrepancyAmount !== null && line.discrepancyAmount !== 0 && (
                        <span
                          className="ml-1 text-[10px]"
                          style={{ color: line.discrepancyAmount > 0 ? '#166534' : '#9F1239' }}
                        >
                          ({line.discrepancyAmount > 0 ? '+' : ''}
                          {line.discrepancyAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <LinePill status={line.status} />
                    </td>
                    <td className="px-4 py-2.5 text-[#8B8B85] font-mono text-[10px] truncate max-w-[160px]">
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
