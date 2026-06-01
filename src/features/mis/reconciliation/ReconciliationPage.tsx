import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useStatements, closeStatement } from '../hooks/useStatements';
import { useLinesByStatus, autoMatch, unmatch, excludeLine } from '../hooks/useReconciliation';
import { LineMatchModal } from './LineMatchModal';
import { Modal } from '../../../components/ui/Modal';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useToast } from '../../../components/ui/Toast';
import type { CommissionStatement, StatementLine, StatementLineStatus } from '../../../types';
import type { SearchableSelectOption } from '../../../components/ui/SearchableSelect';

// ─── StatChip ────────────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div
      className="glass-panel glass-card rounded-xl px-4 py-3 flex flex-col gap-0.5 text-center"
    >
      <span className="text-xl font-bold" style={{ color }}>
        {value}
      </span>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
    </div>
  );
}

// ─── StatusPill ──────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<StatementLineStatus, string> = {
  matched:     'badge-glass-success',
  discrepancy: 'badge-glass-warning',
  unmatched:   'badge-glass-danger',
  excluded:    'badge-glass-muted',
  unknown:     'badge-glass-muted',
};

const STATUS_LABEL: Record<StatementLineStatus, string> = {
  matched:     'Matched',
  discrepancy: 'Discrepancy',
  unmatched:   'Unmatched',
  excluded:    'Excluded',
  unknown:     'Unknown',
};

function StatusPill({ status }: { status: StatementLineStatus }) {
  return (
    <span className={STATUS_BADGE[status]}>
      {STATUS_LABEL[status]}
    </span>
  );
}

// ─── Tab type ─────────────────────────────────────────────────────────────────

type Tab = 'all' | 'unmatched' | 'discrepancy';

// ─── ReconciliationPage ───────────────────────────────────────────────────────

export function ReconciliationPage() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const { statements, loading: statementsLoading } = useStatements();
  const [selectedId, setSelectedId] = useState<string>(searchParams.get('statementId') ?? '');
  const [activeTab, setActiveTab] = useState<Tab>('all');

  // Auto-select from URL param once statements load
  useEffect(() => {
    const paramId = searchParams.get('statementId');
    if (paramId && selectedId !== paramId) setSelectedId(paramId);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const statement: CommissionStatement | null =
    statements.find((s) => s.id === selectedId) ?? null;

  const { allLines, byStatus, loading: linesLoading } = useLinesByStatus(
    selectedId || null,
  );

  // ── Auto-match state ──────────────────────────────────────────────────────
  const [autoMatchRunning, setAutoMatchRunning] = useState(false);

  async function handleAutoMatch() {
    if (!selectedId || !statement) return;
    setAutoMatchRunning(true);
    try {
      const result = await autoMatch(selectedId, statement.providerId);
      toast.success(
        `Auto-match complete: ${result.matched} matched, ${result.discrepancy} discrepancy`,
        'Auto-Match',
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Auto-match failed.', 'Error');
    } finally {
      setAutoMatchRunning(false);
    }
  }

  // ── Line match modal ──────────────────────────────────────────────────────
  const [matchLine, setMatchLine] = useState<StatementLine | null>(null);

  // ── Exclude modal ─────────────────────────────────────────────────────────
  const [excludingLine, setExcludingLine] = useState<StatementLine | null>(null);
  const [excludeReason, setExcludeReason] = useState('');
  const [excludeSaving, setExcludeSaving] = useState(false);

  async function handleExclude() {
    if (!excludingLine || !selectedId || !user) return;
    setExcludeSaving(true);
    try {
      await excludeLine(selectedId, excludingLine.id, excludeReason, user.uid);
      toast.success('Line excluded.', 'Excluded');
      setExcludingLine(null);
      setExcludeReason('');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to exclude.', 'Error');
    } finally {
      setExcludeSaving(false);
    }
  }

  // ── Unmatch ───────────────────────────────────────────────────────────────
  async function handleUnmatch(line: StatementLine) {
    if (!selectedId) return;
    try {
      await unmatch(selectedId, line.id);
      toast.info('Line restored to unmatched.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to unmatch.', 'Error');
    }
  }

  // ── Restore excluded line ─────────────────────────────────────────────────
  async function handleRestore(line: StatementLine) {
    if (!selectedId) return;
    try {
      await unmatch(selectedId, line.id);
      toast.info('Line restored to unmatched.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to restore.', 'Error');
    }
  }

  // ── View matched record details ───────────────────────────────────────────
  const [viewingLine, setViewingLine] = useState<StatementLine | null>(null);

  // ── Close statement modal ─────────────────────────────────────────────────
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closeSaving, setCloseSaving] = useState(false);

  async function handleCloseStatement() {
    if (!selectedId || !user) return;
    setCloseSaving(true);
    try {
      await closeStatement(selectedId, user.uid);
      toast.success('Statement closed.', 'Closed');
      setCloseModalOpen(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to close statement.', 'Error');
    } finally {
      setCloseSaving(false);
    }
  }

  const isAdmin = profile?.role === 'admin' || profile?.misAccess === 'admin';

  // ── Statement selector options ────────────────────────────────────────────
  const statementOptions: SearchableSelectOption[] = statements
    .filter((s) => s.status !== 'closed')
    .map((s) => ({
      value: s.id,
      label: `${s.providerId} · ${s.periodStart} · ₹${s.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
      description: s.status,
    }));

  // ── Tab filtering ─────────────────────────────────────────────────────────
  const displayLines: StatementLine[] =
    activeTab === 'all'
      ? allLines
      : activeTab === 'unmatched'
      ? byStatus.unmatched
      : byStatus.discrepancy;

  const totalAmount = allLines.reduce((sum, l) => sum + l.parsedAmount, 0);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* ── Title ── */}
      <h1
        className="text-3xl mb-1"
        style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: 'var(--text-primary)' }}
      >
        Reconciliation
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Match statement lines to commission records and close statements.
      </p>

      {/* ── Statement selector ── */}
      <div className="mb-6 max-w-xl">
        {statementsLoading ? (
          <div className="h-10 rounded-lg animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
        ) : (
          <SearchableSelect
            options={statementOptions}
            value={selectedId}
            onChange={setSelectedId}
            placeholder="Select a statement to reconcile…"
            emptyMessage="No open statements found."
            label="Select statement"
          />
        )}
      </div>

      {/* ── Content ── */}
      {!selectedId && (
        <div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>
          Select a statement above to begin reconciliation.
        </div>
      )}

      {selectedId && linesLoading && (
        <div className="space-y-3 mt-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-xl animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          ))}
        </div>
      )}

      {selectedId && !linesLoading && (
        <>
          {/* ── Summary strip ── */}
          <div className="grid grid-cols-5 gap-3 mb-6">
            <StatChip label="Matched"     value={byStatus.matched.length}     color="#34d399" />
            <StatChip label="Discrepancy" value={byStatus.discrepancy.length} color="#C9A961" />
            <StatChip label="Unmatched"   value={byStatus.unmatched.length}   color="#f87171" />
            <StatChip label="Excluded"    value={byStatus.excluded.length}    color="var(--text-muted)" />
            <StatChip
              label="Total ₹"
              value={`₹${totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
              color="#C9A961"
            />
          </div>

          {/* ── Toolbar ── */}
          <div className="flex items-center justify-between gap-4 mb-4">
            {/* Tabs */}
            <div
              className="flex gap-1 rounded-lg p-1"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
            >
              {(['all', 'unmatched', 'discrepancy'] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize"
                  style={{
                    backgroundColor: activeTab === tab ? 'rgba(255,255,255,0.12)' : 'transparent',
                    color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  {tab === 'all' ? `All (${allLines.length})` : null}
                  {tab === 'unmatched' ? `Unmatched (${byStatus.unmatched.length})` : null}
                  {tab === 'discrepancy' ? `Discrepancy (${byStatus.discrepancy.length})` : null}
                </button>
              ))}
            </div>

            {/* Auto-match button (admin only) */}
            {isAdmin && (
              <button
                onClick={handleAutoMatch}
                disabled={autoMatchRunning || byStatus.unmatched.length === 0}
                className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
              >
                {autoMatchRunning ? 'Running…' : 'Auto-Match'}
              </button>
            )}
          </div>

          {/* ── Lines table ── */}
          {displayLines.length === 0 ? (
            <div className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
              No lines in this view.
            </div>
          ) : (
            <div className="glass-panel overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <th className="px-4 py-3 text-left font-semibold w-28" style={{ color: 'var(--text-muted)' }}>Date</th>
                    <th className="px-4 py-3 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Description</th>
                    <th className="px-4 py-3 text-right font-semibold w-28" style={{ color: 'var(--text-muted)' }}>Amount</th>
                    <th className="px-4 py-3 text-left font-semibold w-28" style={{ color: 'var(--text-muted)' }}>Status</th>
                    <th className="px-4 py-3 text-left font-semibold w-36" style={{ color: 'var(--text-muted)' }}>Matched To</th>
                    <th className="px-4 py-3 text-right font-semibold w-36" style={{ color: 'var(--text-muted)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayLines.map((line) => (
                    <tr
                      key={line.id}
                      className="hover:bg-white/5 transition-colors"
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                        {line.parsedDate}
                      </td>
                      <td className="px-4 py-3 max-w-xs truncate" style={{ color: 'var(--text-primary)' }}>
                        {line.rawDescription}
                      </td>
                      <td className="px-4 py-3 text-right font-medium" style={{ color: 'var(--text-primary)' }}>
                        ₹{line.parsedAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={line.status} />
                        {line.status === 'discrepancy' && line.discrepancyAmount !== null && (
                          <span className="block text-xs mt-0.5" style={{ color: '#C9A961' }}>
                            Δ ₹{line.discrepancyAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs truncate max-w-xs" style={{ color: 'var(--text-muted)' }}>
                        {line.matchedCommissionRecordId
                          ? line.matchedCommissionRecordId.slice(0, 14) + '…'
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <LineActions
                          line={line}
                          isAdmin={isAdmin}
                          onMatch={() => setMatchLine(line)}
                          onView={() => setViewingLine(line)}
                          onUnmatch={() => handleUnmatch(line)}
                          onExclude={() => { setExcludingLine(line); setExcludeReason(''); }}
                          onRestore={() => handleRestore(line)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Close Statement (admin only) ── */}
          {isAdmin && statement?.status !== 'closed' && (
            <div
              className="mt-8 pt-6 flex justify-end"
              style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
            >
              <button
                onClick={() => setCloseModalOpen(true)}
                disabled={byStatus.unmatched.length > 0}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: byStatus.unmatched.length === 0 ? '#C9A961' : 'rgba(255,255,255,0.08)',
                  color: byStatus.unmatched.length === 0 ? '#0B1538' : 'var(--text-muted)',
                }}
                title={
                  byStatus.unmatched.length > 0
                    ? 'All unmatched lines must be matched or excluded before closing.'
                    : undefined
                }
              >
                {byStatus.discrepancy.length > 0
                  ? `Close with ${byStatus.discrepancy.length} discrepanc${byStatus.discrepancy.length === 1 ? 'y' : 'ies'}`
                  : 'Close Statement'}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Line Match Modal ── */}
      {matchLine && selectedId && user && (
        <LineMatchModal
          isOpen={matchLine !== null}
          onClose={() => setMatchLine(null)}
          statementId={selectedId}
          line={matchLine}
          reconciledBy={user.uid}
        />
      )}

      {/* ── View matched record modal ── */}
      <Modal
        isOpen={viewingLine !== null}
        onClose={() => setViewingLine(null)}
        title="Matched Record Details"
        size="sm"
      >
        {viewingLine && (
          <div className="text-sm flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Statement date</p>
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{viewingLine.parsedDate}</p>
              </div>
              <div>
                <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Statement amount</p>
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  ₹{viewingLine.parsedAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Matched commission record ID</p>
              <p className="font-mono text-xs break-all" style={{ color: '#C9A961' }}>
                {viewingLine.matchedCommissionRecordId ?? '—'}
              </p>
            </div>
            {viewingLine.discrepancyAmount !== null && (
              <div
                className="rounded-lg px-3 py-2"
                style={{ backgroundColor: 'rgba(201,169,97,0.08)', border: '1px solid rgba(201,169,97,0.20)' }}
              >
                <p className="text-xs font-medium" style={{ color: '#C9A961' }}>
                  Discrepancy: ₹{viewingLine.discrepancyAmount.toLocaleString('en-IN', {
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            )}
            {viewingLine.reconciledBy && (
              <div>
                <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Reconciled by</p>
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{viewingLine.reconciledBy}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Exclude modal ── */}
      <Modal
        isOpen={excludingLine !== null}
        onClose={() => { setExcludingLine(null); setExcludeReason(''); }}
        title="Exclude Line"
        size="sm"
        footer={
          <>
            <button
              onClick={() => { setExcludingLine(null); setExcludeReason(''); }}
              disabled={excludeSaving}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-primary)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleExclude}
              disabled={excludeSaving || !excludeReason.trim()}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
            >
              {excludeSaving ? 'Saving…' : 'Exclude'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Provide a reason for excluding this line. It will be recorded for audit purposes.
          </p>
          <textarea
            value={excludeReason}
            onChange={(e) => setExcludeReason(e.target.value)}
            rows={3}
            placeholder="e.g. Duplicate entry, outside scope, already reconciled elsewhere…"
            className="glass-inp w-full text-sm resize-none"
          />
        </div>
      </Modal>

      {/* ── Close Statement modal ── */}
      <Modal
        isOpen={closeModalOpen}
        onClose={() => setCloseModalOpen(false)}
        title="Close Statement"
        size="sm"
        footer={
          <>
            <button
              onClick={() => setCloseModalOpen(false)}
              disabled={closeSaving}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-primary)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleCloseStatement}
              disabled={closeSaving}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
            >
              {closeSaving ? 'Closing…' : 'Confirm Close'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          {byStatus.discrepancy.length > 0 ? (
            <p style={{ color: 'var(--text-primary)' }}>
              This statement has{' '}
              <strong style={{ color: '#C9A961' }}>{byStatus.discrepancy.length} discrepanc{byStatus.discrepancy.length === 1 ? 'y' : 'ies'}</strong>{' '}
              that will remain unresolved. Are you sure you want to close it?
            </p>
          ) : (
            <p style={{ color: 'var(--text-primary)' }}>
              All lines are matched or excluded. Closing this statement will mark it as final.
            </p>
          )}
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Closed statements cannot be edited. This action cannot be undone.
          </p>
        </div>
      </Modal>
    </div>
  );
}

// ─── LineActions ──────────────────────────────────────────────────────────────

function LineActions({
  line,
  isAdmin,
  onMatch,
  onView,
  onUnmatch,
  onExclude,
  onRestore,
}: {
  line: StatementLine;
  isAdmin: boolean;
  onMatch: () => void;
  onView: () => void;
  onUnmatch: () => void;
  onExclude: () => void;
  onRestore: () => void;
}) {
  const btn = 'px-2.5 py-1 rounded text-xs font-medium transition-colors';

  if (line.status === 'unmatched') {
    return (
      <div className="flex justify-end gap-1.5">
        {isAdmin && (
          <button
            onClick={onMatch}
            className={btn}
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
          >
            Match
          </button>
        )}
        {isAdmin && (
          <button
            onClick={onExclude}
            className={`${btn} hover:bg-white/5`}
            style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-muted)' }}
          >
            Exclude
          </button>
        )}
      </div>
    );
  }

  if (line.status === 'matched') {
    return (
      <div className="flex justify-end gap-1.5">
        <button
          onClick={onView}
          className={`${btn} hover:bg-white/5`}
          style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' }}
        >
          View
        </button>
        {isAdmin && (
          <button
            onClick={onUnmatch}
            className={`${btn} hover:bg-white/5`}
            style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-muted)' }}
          >
            Unmatch
          </button>
        )}
      </div>
    );
  }

  if (line.status === 'discrepancy') {
    return (
      <div className="flex justify-end gap-1.5">
        {isAdmin && (
          <button
            onClick={onExclude}
            className={btn}
            style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.25)' }}
          >
            Resolve
          </button>
        )}
        {isAdmin && (
          <button
            onClick={onUnmatch}
            className={`${btn} hover:bg-white/5`}
            style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-muted)' }}
          >
            Unmatch
          </button>
        )}
      </div>
    );
  }

  if (line.status === 'excluded') {
    return (
      <div className="flex justify-end">
        {isAdmin && (
          <button
            onClick={onRestore}
            className={`${btn} hover:bg-white/5`}
            style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-muted)' }}
          >
            Restore
          </button>
        )}
      </div>
    );
  }

  return null;
}
