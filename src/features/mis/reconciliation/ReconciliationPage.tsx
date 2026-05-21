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
  bg,
}: {
  label: string;
  value: number | string;
  color: string;
  bg: string;
}) {
  return (
    <div
      className="rounded-xl px-4 py-3 flex flex-col gap-0.5 text-center"
      style={{ background: bg }}
    >
      <span className="text-xl font-bold" style={{ color }}>
        {value}
      </span>
      <span className="text-xs" style={{ color: '#8B8B85' }}>
        {label}
      </span>
    </div>
  );
}

// ─── StatusPill ──────────────────────────────────────────────────────────────

const STATUS_PILL: Record<StatementLineStatus, { label: string; className: string }> = {
  matched:     { label: 'Matched',     className: 'bg-green-100 text-green-700' },
  discrepancy: { label: 'Discrepancy', className: 'bg-amber-100 text-amber-700' },
  unmatched:   { label: 'Unmatched',   className: 'bg-red-100 text-red-700' },
  excluded:    { label: 'Excluded',    className: 'bg-slate-100 text-slate-500 line-through' },
  unknown:     { label: 'Unknown',     className: 'bg-slate-100 text-slate-500' },
};

function StatusPill({ status }: { status: StatementLineStatus }) {
  const cfg = STATUS_PILL[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.className}`}>
      {cfg.label}
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
        style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: '#0B1538' }}
      >
        Reconciliation
      </h1>
      <p className="text-sm mb-6" style={{ color: '#8B8B85' }}>
        Match statement lines to commission records and close statements.
      </p>

      {/* ── Statement selector ── */}
      <div className="mb-6 max-w-xl">
        {statementsLoading ? (
          <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
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
        <div className="text-center py-20 text-[#8B8B85]">
          Select a statement above to begin reconciliation.
        </div>
      )}

      {selectedId && linesLoading && (
        <div className="space-y-3 mt-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {selectedId && !linesLoading && (
        <>
          {/* ── Summary strip ── */}
          <div className="grid grid-cols-5 gap-3 mb-6">
            <StatChip
              label="Matched"
              value={byStatus.matched.length}
              color="#166534"
              bg="#F0FDF4"
            />
            <StatChip
              label="Discrepancy"
              value={byStatus.discrepancy.length}
              color="#92400E"
              bg="#FFFBEB"
            />
            <StatChip
              label="Unmatched"
              value={byStatus.unmatched.length}
              color="#9F1239"
              bg="#FFF1F2"
            />
            <StatChip
              label="Excluded"
              value={byStatus.excluded.length}
              color="#475569"
              bg="#F1F5F9"
            />
            <StatChip
              label="Total ₹"
              value={`₹${totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
              color="#0A0A0A"
              bg="#FAFAF7"
            />
          </div>

          {/* ── Toolbar ── */}
          <div className="flex items-center justify-between gap-4 mb-4">
            {/* Tabs */}
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {(['all', 'unmatched', 'discrepancy'] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={[
                    'px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize',
                    activeTab === tab
                      ? 'bg-white text-[#0B1538] shadow-sm'
                      : 'text-[#8B8B85] hover:text-[#0A0A0A]',
                  ].join(' ')}
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
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#0B1538] text-white disabled:opacity-50 hover:bg-[#1B2A4E] transition-colors"
              >
                {autoMatchRunning ? 'Running…' : 'Auto-Match'}
              </button>
            )}
          </div>

          {/* ── Lines table ── */}
          {displayLines.length === 0 ? (
            <div className="text-center py-12 text-[#8B8B85] text-sm">
              No lines in this view.
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F2EFE7]">
                    <th className="px-4 py-3 text-left font-semibold text-[#0B1538] w-28">Date</th>
                    <th className="px-4 py-3 text-left font-semibold text-[#0B1538]">Description</th>
                    <th className="px-4 py-3 text-right font-semibold text-[#0B1538] w-28">Amount</th>
                    <th className="px-4 py-3 text-left font-semibold text-[#0B1538] w-28">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-[#0B1538] w-36">Matched To</th>
                    <th className="px-4 py-3 text-right font-semibold text-[#0B1538] w-36">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayLines.map((line, i) => (
                    <tr
                      key={line.id}
                      className={i % 2 === 0 ? 'bg-white' : 'bg-[#FAFAF7]'}
                    >
                      <td className="px-4 py-3 text-[#0A0A0A] whitespace-nowrap">
                        {line.parsedDate}
                      </td>
                      <td className="px-4 py-3 text-[#0A0A0A] max-w-xs truncate">
                        {line.rawDescription}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-[#0A0A0A]">
                        ₹{line.parsedAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={line.status} />
                        {line.status === 'discrepancy' && line.discrepancyAmount !== null && (
                          <span className="block text-xs text-amber-600 mt-0.5">
                            Δ ₹{line.discrepancyAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#8B8B85] truncate max-w-xs">
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
            <div className="mt-8 pt-6 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setCloseModalOpen(true)}
                disabled={byStatus.unmatched.length > 0}
                className={[
                  'px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors',
                  byStatus.unmatched.length === 0
                    ? 'bg-[#C9A961] text-[#0B1538] hover:bg-[#E5C97C]'
                    : 'bg-slate-100 text-[#8B8B85] cursor-not-allowed',
                ].join(' ')}
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
                <p className="text-xs text-[#8B8B85] mb-0.5">Statement date</p>
                <p className="font-medium">{viewingLine.parsedDate}</p>
              </div>
              <div>
                <p className="text-xs text-[#8B8B85] mb-0.5">Statement amount</p>
                <p className="font-medium">
                  ₹{viewingLine.parsedAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs text-[#8B8B85] mb-0.5">Matched commission record ID</p>
              <p className="font-mono text-xs break-all text-[#0B1538]">
                {viewingLine.matchedCommissionRecordId ?? '—'}
              </p>
            </div>
            {viewingLine.discrepancyAmount !== null && (
              <div className="rounded-lg bg-amber-50 px-3 py-2">
                <p className="text-xs text-amber-700 font-medium">
                  Discrepancy: ₹{viewingLine.discrepancyAmount.toLocaleString('en-IN', {
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            )}
            {viewingLine.reconciledBy && (
              <div>
                <p className="text-xs text-[#8B8B85] mb-0.5">Reconciled by</p>
                <p className="font-medium">{viewingLine.reconciledBy}</p>
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
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-200 text-[#0A0A0A] hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleExclude}
              disabled={excludeSaving || !excludeReason.trim()}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#0B1538] text-white disabled:opacity-50 hover:bg-[#1B2A4E] transition-colors"
            >
              {excludeSaving ? 'Saving…' : 'Exclude'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[#8B8B85]">
            Provide a reason for excluding this line. It will be recorded for audit purposes.
          </p>
          <textarea
            value={excludeReason}
            onChange={(e) => setExcludeReason(e.target.value)}
            rows={3}
            placeholder="e.g. Duplicate entry, outside scope, already reconciled elsewhere…"
            className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538] resize-none"
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
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-200 text-[#0A0A0A] hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCloseStatement}
              disabled={closeSaving}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#C9A961] text-[#0B1538] disabled:opacity-50 hover:bg-[#E5C97C] transition-colors"
            >
              {closeSaving ? 'Closing…' : 'Confirm Close'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          {byStatus.discrepancy.length > 0 ? (
            <p className="text-[#0A0A0A]">
              This statement has{' '}
              <strong className="text-amber-700">{byStatus.discrepancy.length} discrepanc{byStatus.discrepancy.length === 1 ? 'y' : 'ies'}</strong>{' '}
              that will remain unresolved. Are you sure you want to close it?
            </p>
          ) : (
            <p className="text-[#0A0A0A]">
              All lines are matched or excluded. Closing this statement will mark it as final.
            </p>
          )}
          <p className="text-xs text-[#8B8B85]">
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
  const btn =
    'px-2.5 py-1 rounded text-xs font-medium transition-colors border';

  if (line.status === 'unmatched') {
    return (
      <div className="flex justify-end gap-1.5">
        {isAdmin && (
          <button
            onClick={onMatch}
            className={`${btn} bg-[#0B1538] text-white border-[#0B1538] hover:bg-[#1B2A4E]`}
          >
            Match
          </button>
        )}
        {isAdmin && (
          <button
            onClick={onExclude}
            className={`${btn} border-slate-200 text-[#8B8B85] hover:bg-slate-50`}
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
          className={`${btn} border-slate-200 text-[#0A0A0A] hover:bg-slate-50`}
        >
          View
        </button>
        {isAdmin && (
          <button
            onClick={onUnmatch}
            className={`${btn} border-slate-200 text-[#8B8B85] hover:bg-slate-50`}
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
            className={`${btn} bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100`}
          >
            Resolve
          </button>
        )}
        {isAdmin && (
          <button
            onClick={onUnmatch}
            className={`${btn} border-slate-200 text-[#8B8B85] hover:bg-slate-50`}
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
            className={`${btn} border-slate-200 text-[#8B8B85] hover:bg-slate-50`}
          >
            Restore
          </button>
        )}
      </div>
    );
  }

  return null;
}
