/**
 * LeaveYearEndPage — annual leave balance reset (admin-only).
 *
 * Accessible at /hrms/admin/leave-year-end.
 * Runs on April 1 automatically via Cloud Scheduler; admins may also trigger
 * it manually through this page.
 *
 * Reset rules (HR Handbook, April 1 every year):
 *   CL → 8        (no carry-forward)
 *   SL → 7        (no carry-forward)
 *   EL → min(current EL remaining, 30) + 15
 *   Comp Off → 0  (cleared; new credits granted separately)
 *
 * A preview table shows each active employee's old → new balance.
 * The user must type "RESET {YEAR}" to confirm before running.
 */

import { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { Navigate } from 'react-router-dom';
import {
  RefreshCcw, CheckCircle2, AlertCircle, Loader2,
  ChevronDown, ChevronUp, Calendar,
} from 'lucide-react';
import { collection, query, getDocs, doc, getDoc } from 'firebase/firestore';
import { useAuth } from '../../auth/AuthContext';
import { db, auth } from '../../../lib/firebase';
import { getIdToken } from 'firebase/auth';
import { currentFyYear, useLeaveYearResetStatus } from '../hooks/useLeaveYearReset';
import type { UserProfile, LeaveBalance } from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';

// ─── Preview row ──────────────────────────────────────────────────────────────

interface PreviewRow {
  empId:         string;
  name:          string;
  empCode:       string;
  prevElRemain:  number;
  elCarryForward:number;
  newElTotal:    number;
}

function buildPreview(employees: UserProfile[], balMap: Map<string, LeaveBalance>): PreviewRow[] {
  return employees.map((emp) => {
    const prevBal = balMap.get(emp.userId);
    const prevElRemain  = prevBal?.earned?.remaining ?? 0;
    const elCarryForward = Math.min(prevElRemain, 30);
    return {
      empId:          emp.userId,
      name:           emp.displayName,
      empCode:        emp.employeeId ?? '—',
      prevElRemain,
      elCarryForward,
      newElTotal:     elCarryForward + 15,
    };
  });
}

// ─── LeaveYearEndPage ─────────────────────────────────────────────────────────

export function LeaveYearEndPage() {
  const { user, profile } = useAuth();

  const isAdmin      = profile?.role === 'admin';
  const isManager    = profile?.isHrmsManager === true;
  if (!isAdmin && !isManager) return <Navigate to="/hrms/dashboard" replace />;

  const year    = currentFyYear();
  const prevYear = year - 1;

  const { reset, loading: resetLoading } = useLeaveYearResetStatus(year);

  // ── Preview state ──────────────────────────────────────────────────────────
  const [employees,    setEmployees]    = useState<UserProfile[]>([]);
  const [balMap,       setBalMap]       = useState<Map<string, LeaveBalance>>(new Map());
  const [previewLoading, setPreviewLoading] = useState(true);
  const [showAll,      setShowAll]      = useState(false);

  useEffect(() => {
    async function load() {
      setPreviewLoading(true);
      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        const emps: UserProfile[] = usersSnap.docs
          .map((d) => ({ ...d.data(), userId: d.id } as UserProfile))
          .filter((e) => e.employeeStatus !== 'inactive' && e.email);
        emps.sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''));
        setEmployees(emps);

        // Fetch previous year's balances in parallel
        const chunks: Promise<void>[] = emps.map(async (emp) => {
          const balSnap = await getDoc(doc(db, 'leave_balances', `${emp.userId}_${prevYear}`));
          if (balSnap.exists()) {
            setBalMap((prev) => new Map(prev).set(emp.userId, balSnap.data() as LeaveBalance));
          }
        });
        await Promise.all(chunks);
      } finally {
        setPreviewLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevYear]);

  const preview = useMemo(() => buildPreview(employees, balMap), [employees, balMap]);
  const displayRows = showAll ? preview : preview.slice(0, 8);

  // ── Confirm dialog ─────────────────────────────────────────────────────────
  const [showConfirm,  setShowConfirm]  = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const confirmPhrase = `RESET ${year}`;
  const isConfirmed   = confirmInput.trim() === confirmPhrase;

  // ── Run state ──────────────────────────────────────────────────────────────
  const [running, setRunning]   = useState(false);
  const [result,  setResult]    = useState<{ ok: boolean; employeesProcessed: number; errors: string[] } | null>(null);
  const [runError,setRunError]  = useState('');

  const handleRun = async () => {
    if (!isConfirmed || !user) return;
    setRunning(true);
    setRunError('');
    try {
      const token = await getIdToken(user);
      const res = await fetch('/api/admin/run-leave-year-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ year }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Unknown error');
      setResult(data);
      setShowConfirm(false);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const alreadyDone = !!reset;

  function toTs(ts: any): Date | null {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate();
    return null;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <PageHeader
        title="Leave Year-End Reset"
        subtitle="Resets all employee leave balances at the start of each financial year (April 1). EL carry-forward is capped at 30 days; 15 new EL days are always added."
        pinKey="hrms.leave-year-end"
      />

      {/* Status card */}
      {!resetLoading && (
        <div className={`p-5 rounded-2xl border flex items-start gap-4 ${alreadyDone ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          {alreadyDone
            ? <CheckCircle2 size={20} className="shrink-0 mt-0.5" style={{ color: '#059669' }} />
            : <AlertCircle  size={20} className="shrink-0 mt-0.5" style={{ color: '#D97706' }} />
          }
          <div>
            {alreadyDone ? (
              <>
                <p className="text-sm font-semibold" style={{ color: '#065F46' }}>
                  FY {year}–{year + 1} reset completed
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#047857' }}>
                  {reset.employeesProcessed} employees processed
                  {' · '}by {reset.resetByName}
                  {toTs(reset.resetAt) && (
                    <> · {format(toTs(reset.resetAt)!, 'd MMM yyyy, h:mm a')}</>
                  )}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold" style={{ color: '#92400E' }}>
                  FY {year}–{year + 1} reset not yet done
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#78350F' }}>
                  Run this reset at the start of April to apply the new year's leave allocations.
                  Cloud Scheduler runs it automatically on April 1.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Success toast */}
      {result?.ok && (
        <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 flex items-center gap-3">
          <CheckCircle2 size={16} style={{ color: '#059669' }} />
          <p className="text-sm font-medium" style={{ color: '#065F46' }}>
            Reset complete — {result.employeesProcessed} employees processed.
            {result.errors.length > 0 && (
              <span className="text-amber-700 ml-2">{result.errors.length} errors (see console).</span>
            )}
          </p>
        </div>
      )}
      {runError && (
        <div className="p-4 rounded-2xl border border-red-200 bg-red-50 flex items-center gap-3">
          <AlertCircle size={16} style={{ color: '#DC2626' }} />
          <p className="text-sm" style={{ color: '#DC2626' }}>{runError}</p>
        </div>
      )}

      {/* Reset rules reference */}
      <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
          Reset Rules — HR Handbook
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Casual Leave', rule: 'Reset to 8', note: 'No carry-forward' },
            { label: 'Sick Leave',   rule: 'Reset to 7', note: 'No carry-forward' },
            { label: 'Earned Leave', rule: 'Carry + 15', note: 'min(prev EL, 30) + 15' },
            { label: 'Comp Off',     rule: 'Reset to 0', note: 'Grants credited separately' },
          ].map(({ label, rule, note }) => (
            <div key={label} className="p-3 rounded-xl bg-(--glass-panel-bg) border border-(--shell-border)">
              <p className="text-[10px] font-bold uppercase tracking-wider text-(--text-muted) mb-1">{label}</p>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{rule}</p>
              <p className="text-[11px] text-(--text-muted) mt-0.5">{note}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Preview table */}
      <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-(--shell-border) flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Preview — FY {year}–{year + 1}
          </h3>
          <span className="text-xs text-(--text-muted)">
            Based on {prevYear} EL remaining
          </span>
        </div>
        {previewLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-10 bg-(--glass-panel-bg) rounded-lg animate-pulse" />)}
          </div>
        ) : preview.length === 0 ? (
          <div className="py-10 text-center text-sm text-(--text-muted)">No active employees found.</div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--shell-border) bg-(--glass-panel-bg)/50">
                  <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Employee</th>
                  <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">CL</th>
                  <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">SL</th>
                  <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">EL (prev remaining)</th>
                  <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">EL carry</th>
                  <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">New EL total</th>
                  <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Comp Off</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => (
                  <tr key={row.empId} className="border-b border-(--shell-border) hover:bg-(--glass-panel-bg)/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-(--text-primary)">{row.name}</p>
                      <p className="text-[11px] text-(--text-muted)">{row.empCode}</p>
                    </td>
                    <td className="px-4 py-3 text-center font-semibold" style={{ color: 'var(--text-primary)' }}>8</td>
                    <td className="px-4 py-3 text-center font-semibold" style={{ color: 'var(--text-primary)' }}>7</td>
                    <td className="px-4 py-3 text-center text-(--text-muted)">{row.prevElRemain}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: row.elCarryForward > 0 ? '#FEF3C7' : 'var(--shell-hover-hard)', color: row.elCarryForward > 0 ? '#92400E' : 'var(--text-muted)' }}>
                        {row.elCarryForward}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: '#EDE9FE', color: '#5B21B6' }}>
                        {row.newElTotal}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-(--text-muted) text-xs">0 (reset)</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 8 && (
              <button
                onClick={() => setShowAll((p) => !p)}
                className="w-full py-3 text-xs font-medium text-(--text-muted) hover:text-(--text-primary) flex items-center justify-center gap-1.5 border-t border-(--shell-border) transition-colors"
              >
                {showAll
                  ? <><ChevronUp size={13} /> Show fewer</>
                  : <><ChevronDown size={13} /> Show all {preview.length} employees</>
                }
              </button>
            )}
          </>
        )}
      </div>

      {/* Action */}
      {!alreadyDone && (
        <div className="flex justify-end">
          <button
            onClick={() => { setShowConfirm(true); setConfirmInput(''); setRunError(''); }}
            disabled={previewLoading || preview.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
          >
            <RefreshCcw size={15} />
            Run Year-End Reset for FY {year}–{year + 1}
          </button>
        </div>
      )}

      {/* Confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-(--glass-panel-bg) rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: '#FEF3C7' }}>
                <AlertCircle size={20} style={{ color: '#D97706' }} />
              </div>
              <div>
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Confirm Year-End Reset
                </h3>
                <p className="text-xs text-(--text-muted)">FY {year}–{year + 1} · {preview.length} employees</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-xs" style={{ color: '#78350F' }}>
              <strong>This will overwrite all existing leave_balances for {year}.</strong> All employees'
              balances will be reset using the HR Handbook rules. This action cannot be undone.
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-(--text-muted)">
                Type <span className="font-mono text-(--text-primary) bg-(--glass-panel-bg) px-1.5 py-0.5 rounded">{confirmPhrase}</span> to confirm
              </label>
              <input
                type="text"
                className="w-full text-sm px-3.5 py-2.5 border rounded-xl outline-none focus:ring-2 bg-(--glass-panel-bg)"
                style={{
                  borderColor: confirmInput && !isConfirmed ? '#F87171' : 'var(--text-muted)',
                  ...(isConfirmed && { borderColor: '#6EE7B7', backgroundColor: '#F0FDF4' }),
                }}
                placeholder={confirmPhrase}
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
              />
            </div>

            {runError && (
              <p className="text-xs text-red-600">{runError}</p>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={running}
                className="px-4 py-2 rounded-xl text-sm font-medium border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRun}
                disabled={!isConfirmed || running}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-40 transition-opacity"
                style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}
              >
                {running
                  ? <><Loader2 size={14} className="animate-spin" /> Running…</>
                  : <><Calendar size={14} /> Reset {year}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
