import { useState, useEffect, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { parseISO, format } from 'date-fns';
import { GraduationCap, AlertCircle, Clock, Star, Download } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useProbationRecords, ensureProbationRecord } from '../hooks/useProbation';
import type { ProbationRecord, ProbationStatus, UserProfile } from '../../../types';
import { daysInfo } from './probationDates';
import { EvalModal, ConfirmModal, ExtendModal } from './probationModals';
import { downloadConfirmationLetter, downloadExtensionLetter } from './probationLetters';
import { PageHeader } from '../../../components/ui/primitives';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate();
  }
  return null;
}

export function fmtDate(d: string): string {
  try { return format(parseISO(d), 'd MMM yyyy'); } catch { return d; }
}


// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<ProbationStatus, { label: string; bg: string; color: string }> = {
  on_probation: { label: 'On Probation', bg: '#FEF3C7', color: '#92400E' },
  confirmed:    { label: 'Confirmed',    bg: '#D1FAE5', color: '#065F46' },
  extended:     { label: 'Extended',     bg: '#FEE2E2', color: '#991B1B' },
  terminated:   { label: 'Terminated',  bg: '#F3F4F6', color: '#374151' },
};

function StatusPill({ status }: { status: ProbationStatus }) {
  const cfg = STATUS_CFG[status];
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-5 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: color + '20' }}>
        <span className="text-lg font-bold" style={{ color }}>{count}</span>
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
    </div>
  );
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────

type Filter = 'all' | 'active' | 'due_soon' | 'extended' | 'confirmed';

const FILTER_LABELS: Record<Filter, string> = {
  all:       'All',
  active:    'On Probation',
  due_soon:  'Due / Overdue',
  extended:  'Extended',
  confirmed: 'Confirmed',
};

// ─── ProbationPage ────────────────────────────────────────────────────────────

export function ProbationPage() {
  const { user, profile } = useAuth();
  const isAdmin       = profile?.role === 'admin';
  const isHrmsManager = profile?.isHrmsManager === true;
  const canManage     = isAdmin || isHrmsManager;

  const { records, loading } = useProbationRecords(canManage);

  const [filter, setFilter] = useState<Filter>('all');
  const navigate = useNavigate();
  const [evalRecord,    setEvalRecord]    = useState<ProbationRecord | null>(null);
  const [confirmRecord, setConfirmRecord] = useState<ProbationRecord | null>(null);
  const [extendRecord,  setExtendRecord]  = useState<ProbationRecord | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  // Auto-create probation records for active employees with joiningDate who don't have one yet
  const hasBackfilled = useRef(false);
  useEffect(() => {
    if (!canManage || loading || hasBackfilled.current) return;
    hasBackfilled.current = true;

    async function backfill() {
      try {
        const snap = await getDocs(
          query(collection(db, 'users'), where('employeeStatus', '==', 'active')),
        );
        const existing = new Set(records.map((r) => r.employeeId));
        const toCreate = snap.docs
          .map((d) => ({ userId: d.id, ...d.data() } as UserProfile))
          .filter((emp) => !!emp.joiningDate && !existing.has(emp.userId));

        await Promise.all(toCreate.map((emp) =>
          ensureProbationRecord({
            userId: emp.userId,
            displayName: emp.displayName,
            employeeId: emp.employeeId,
            department: emp.department,
            designation: emp.designation,
            joiningDate: emp.joiningDate!,
          }).catch(() => {/* non-fatal */}),
        ));
      } catch { /* non-fatal */ }
    }
    backfill();
  }, [canManage, loading, records]);

  if (!canManage) return <Navigate to="/hrms/dashboard" replace />;

  const today = new Date();
  const in30 = new Date(); in30.setDate(today.getDate() + 30);

  // Computed stats
  const onProbation = records.filter((r) => r.status === 'on_probation');
  const extended    = records.filter((r) => r.status === 'extended');
  const confirmed   = records.filter((r) => r.status === 'confirmed');
  const dueSoon     = [...onProbation, ...extended].filter((r) => {
    const end = parseISO(r.probationEndDate);
    return end <= in30;
  });

  // Sorted: active first, sorted by end date ascending; then confirmed
  const sorted = [...records].sort((a, b) => {
    const activeStatuses: ProbationStatus[] = ['on_probation', 'extended'];
    const aActive = activeStatuses.includes(a.status);
    const bActive = activeStatuses.includes(b.status);
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return a.probationEndDate.localeCompare(b.probationEndDate);
  });

  // Filter
  const filtered = sorted.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'active')    return r.status === 'on_probation';
    if (filter === 'due_soon')  return dueSoon.includes(r);
    if (filter === 'extended')  return r.status === 'extended';
    if (filter === 'confirmed') return r.status === 'confirmed';
    return true;
  });

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ── Header ── */}
      <PageHeader
        title="Probation Management"
        subtitle="6-month probation tracking · confirmation & extension letters"
        pinKey="hrms.probation"
      />

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="On Probation"  count={onProbation.length} color="#92400E" />
        <StatCard label="Due / Overdue" count={dueSoon.length}     color="#DC2626" />
        <StatCard label="Extended"      count={extended.length}    color="#D97706" />
        <StatCard label="Confirmed"     count={confirmed.length}   color="#059669" />
      </div>

      {/* ── Filter tabs ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all"
            style={filter === f
              ? { backgroundColor: '#0B1538', color: '#FFFFFF' }
              : { backgroundColor: 'var(--glass-panel-bg)', color: 'var(--text-muted)' }}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {/* ── Table ── */}
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <GraduationCap size={32} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No probation records for this filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--shell-border)">
                  {['Employee', 'Dept / Role', 'Joining', 'Probation End', 'Timeline', 'Eval', 'Status', ''].map((h) => (
                    <th key={h}
                      className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--text-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((rec) => {
                  const { days, overdue, label } = daysInfo(rec);
                  const isActive = rec.status === 'on_probation' || rec.status === 'extended';
                  const hasEval = !!rec.evaluation;
                  const isSuccess = successId === rec.employeeId;

                  return (
                    <tr key={rec.id}
                      className={`border-b border-(--shell-border) transition-colors ${isSuccess ? 'bg-green-50' : 'hover:bg-(--glass-panel-bg)'}`}>
                      {/* Employee */}
                      <td className="px-5 py-3.5">
                        <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                          {rec.employeeName}
                        </p>
                        {rec.employeeCode && (
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{rec.employeeCode}</p>
                        )}
                      </td>

                      {/* Dept / Role */}
                      <td className="px-5 py-3.5">
                        <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{rec.department ?? '—'}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{rec.designation ?? ''}</p>
                      </td>

                      {/* Joining */}
                      <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-primary)' }}>
                        {fmtDate(rec.joiningDate)}
                      </td>

                      {/* Probation End */}
                      <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-primary)' }}>
                        {fmtDate(rec.probationEndDate)}
                        {rec.status === 'extended' && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                            style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                            Extended
                          </span>
                        )}
                      </td>

                      {/* Timeline */}
                      <td className="px-5 py-3.5">
                        {isActive ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                            style={{
                              backgroundColor: overdue ? '#FEE2E2' : days <= 30 ? '#FEF3C7' : '#F0FDF4',
                              color: overdue ? '#991B1B' : days <= 30 ? '#92400E' : '#065F46',
                            }}
                          >
                            {overdue ? <AlertCircle size={10} /> : <Clock size={10} />}
                            {label}
                          </span>
                        ) : rec.status === 'confirmed' ? (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {rec.confirmedAt ? format(toDate(rec.confirmedAt) ?? new Date(), 'd MMM yyyy') : '—'}
                          </span>
                        ) : null}
                      </td>

                      {/* Eval */}
                      <td className="px-5 py-3.5">
                        {hasEval ? (
                          <div>
                            <div className="flex items-center gap-1">
                              <Star size={11} style={{ color: '#C9A961' }} />
                              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {rec.evaluation!.overallRating}
                              </span>
                            </div>
                            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                              {rec.evaluation!.recommendation === 'confirm' ? '→ Confirm' :
                               rec.evaluation!.recommendation === 'extend'  ? '→ Extend' :
                               '→ Terminate'}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {isActive ? 'Pending' : '—'}
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3.5">
                        <StatusPill status={rec.status} />
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          {isActive && (
                            <>
                              <button
                                onClick={() => setEvalRecord(rec)}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:bg-blue-50"
                                style={{ color: '#3B82F6' }}
                                title={hasEval ? 'Edit Evaluation' : 'Add Evaluation'}
                              >
                                {hasEval ? 'Edit Eval' : 'Evaluate'}
                              </button>
                              <button
                                onClick={() => setConfirmRecord(rec)}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:bg-green-50"
                                style={{ color: '#059669' }}
                                title="Confirm Employment"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setExtendRecord(rec)}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:bg-amber-50"
                                style={{ color: '#D97706' }}
                                title="Extend Probation"
                              >
                                Extend
                              </button>
                              <button
                                onClick={() => {
                                  if (window.confirm(`Fail ${rec.employeeName}'s probation and start their exit? This opens the Exit form (reason preset to Termination) and creates their offboarding checklist.`))
                                    navigate(`/hrms/employees?exitFor=${rec.employeeId}&exitReason=termination`);
                                }}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:bg-red-50"
                                style={{ color: '#DC2626' }}
                                title="Fail probation → start exit + offboarding"
                              >
                                Fail &amp; Exit
                              </button>
                            </>
                          )}
                          {rec.status === 'confirmed' && (
                            <button
                              onClick={() => downloadConfirmationLetter(rec)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:bg-(--glass-panel-bg)"
                              style={{ color: 'var(--text-muted)' }}
                              title="Download Confirmation Letter"
                            >
                              <Download size={11} />
                              Letter
                            </button>
                          )}
                          {rec.status === 'extended' && (
                            <button
                              onClick={() => downloadExtensionLetter(rec)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:bg-(--glass-panel-bg)"
                              style={{ color: 'var(--text-muted)' }}
                              title="Download Extension Letter"
                            >
                              <Download size={11} />
                              Letter
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

      {/* ── Info footer ── */}
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Probation records are auto-created for all active employees with a joining date. HR Handbook: 6-month standard probation.
        Evaluation form is shared by the Reporting Manager after 90 days.
      </p>

      {/* ── Modals ── */}
      {evalRecord && user && (
        <EvalModal
          record={evalRecord}
          byUid={user.uid}
          onClose={() => setEvalRecord(null)}
        />
      )}
      {confirmRecord && user && (
        <ConfirmModal
          record={confirmRecord}
          byUid={user.uid}
          onClose={() => setConfirmRecord(null)}
          onSuccess={() => setSuccessId(confirmRecord.employeeId)}
        />
      )}
      {extendRecord && user && (
        <ExtendModal
          record={extendRecord}
          byUid={user.uid}
          onClose={() => setExtendRecord(null)}
          onSuccess={() => setSuccessId(extendRecord.employeeId)}
        />
      )}
    </div>
  );
}
