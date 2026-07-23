/**
 * The Balances tab: the per-employee balance editor and the adjustment-history
 * list.
 * 
 * Extracted verbatim from AdminLeavePage.tsx (2026-07-23). The arithmetic it
 * used to inline now lives in ./balanceEdit and is unit-tested - see
 * balanceEdit.test.ts.
 */
import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, doc, getDoc, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '../../../lib/firebase';
import { useToast } from '../../../components/ui/Toast';
import { currentLeaveYear } from '../hooks/useLeave';
import { applyBalanceEdits, emptyBalance } from './balanceEdit';
import type { LeaveBalance } from '../../../types';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';

// ─── EditLeaveBalanceModal ────────────────────────────────────────────────────

interface EditLeaveBalanceModalProps {
  employees: { userId: string; displayName: string; employeeId?: string }[];
  currentYear: number;
  actorUid: string;
  actorName: string;
  onClose: () => void;
}

type LeaveTypeEditable = 'casual' | 'sick' | 'earned' | 'comp_off';

interface BalanceRow {
  type: LeaveTypeEditable;
  label: string;
  current: number;
  newTotal: string;
}

export function EditLeaveBalanceModal({
  employees,
  currentYear,
  actorUid,
  actorName,
  onClose,
}: EditLeaveBalanceModalProps) {
  const toast = useToast();

  const [selectedUid, setSelectedUid]   = useState('');
  const [year,        setYear]          = useState(String(currentYear));
  const [loading,     setLoading]       = useState(false);
  const [saving,      setSaving]        = useState(false);
  const [balance,     setBalance]       = useState<LeaveBalance | null>(null);
  const [rows,        setRows]          = useState<BalanceRow[]>([]);
  const [reason,      setReason]        = useState('');
  const [serverError, setServerError]   = useState('');
  const [fieldErrors, setFieldErrors]   = useState<Record<string, string>>({});

  // Fetch balance whenever employee or year changes
  useEffect(() => {
    if (!selectedUid) { setBalance(null); setRows([]); return; }
    const docId = `${selectedUid}_${year}`;
    setLoading(true);
    getDoc(doc(db, 'leave_balances', docId)).then((snap) => {
      if (snap.exists()) {
        const b = snap.data() as LeaveBalance;
        setBalance(b);
        setRows([
          { type: 'casual',   label: 'Casual Leave',       current: b.casual.total,            newTotal: String(b.casual.total) },
          { type: 'sick',     label: 'Sick Leave',          current: b.sick.total,              newTotal: String(b.sick.total) },
          { type: 'earned',   label: 'Earned Leave',        current: b.earned.total,            newTotal: String(b.earned.total) },
          { type: 'comp_off', label: 'Compensatory Off',    current: b.comp_off?.total ?? 0,    newTotal: String(b.comp_off?.total ?? 0) },
        ]);
      } else {
        setBalance(null);
        setRows([
          { type: 'casual',   label: 'Casual Leave',      current: 0, newTotal: '8'  },
          { type: 'sick',     label: 'Sick Leave',         current: 0, newTotal: '7'  },
          { type: 'earned',   label: 'Earned Leave',       current: 0, newTotal: '15' },
          { type: 'comp_off', label: 'Compensatory Off',   current: 0, newTotal: '0'  },
        ]);
      }
      setLoading(false);
    }).catch((e) => {
      console.error('[EditLeaveBalanceModal] fetch error:', e);
      setLoading(false);
    });
  }, [selectedUid, year]);

  const setRowValue = (type: LeaveTypeEditable, val: string) => {
    setRows((prev) => prev.map((r) => r.type === type ? { ...r, newTotal: val } : r));
    if (fieldErrors[type]) setFieldErrors((prev) => { const n = { ...prev }; delete n[type]; return n; });
  };

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (!selectedUid) errs.employee = 'Select an employee';
    if (!reason.trim()) errs.reason = 'Reason is required';
    rows.forEach((r) => {
      const v = parseInt(r.newTotal, 10);
      if (r.newTotal === '' || isNaN(v) || v < 0 || v > 365) {
        errs[r.type] = 'Enter a number 0–365';
      }
    });
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }
    setFieldErrors({});
    setServerError('');
    setSaving(true);

    try {
      const docId = `${selectedUid}_${year}`;
      const yearNum = parseInt(year, 10);
      const existing = balance ?? emptyBalance(selectedUid, yearNum);

      // The arithmetic lives in ./balanceEdit so it can be unit-tested — this is
      // the most bug-prone area in HRMS (see balanceEdit.test.ts).
      const { updated: updatedBalance, adjustments } = applyBalanceEdits(existing, rows, yearNum);

      // Only write if something changed
      if (adjustments.length === 0) {
        toast.success('No changes to save');
        setSaving(false);
        onClose();
        return;
      }

      // 1. Upsert leave_balances
      await setDoc(doc(db, 'leave_balances', docId), updatedBalance, { merge: true });

      // 2. Write audit record for each changed leave type
      for (const adj of adjustments) {
        await addDoc(collection(db, 'leave_balance_adjustments'), {
          employeeId:   selectedUid,
          year:         yearNum,
          leaveType:    adj.type,
          oldTotal:     adj.oldTotal,
          newTotal:     adj.newTotal,
          delta:        adj.delta,
          reason:       reason.trim(),
          adjustedBy:   actorUid,
          adjustedByName: actorName,
          adjustedAt:   serverTimestamp(),
        });
      }

      toast.success('Leave balances updated');
      onClose();
    } catch (e) {
      console.error('[EditLeaveBalanceModal] save error:', e);
      setServerError(e instanceof Error ? e.message : 'Failed to save');
      setSaving(false);
    }
  };

  const baseInp = 'w-full text-sm px-3.5 py-2.5 border rounded-lg outline-none focus:ring-2 bg-(--glass-panel-bg) transition-colors';
  const inp = (field?: string) =>
    `${baseInp} ${field && fieldErrors[field]
      ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30'
      : 'border-(--shell-border) focus:ring-gold'}`;

  const fLabel = (text: string, field?: string, required = false) => (
    <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
      style={{ color: field && fieldErrors[field] ? '#DC2626' : 'var(--text-muted)' }}>
      {text}{required && <span className="text-red-500 ml-0.5">*</span>}
      {field && fieldErrors[field] && (
        <span className="ml-2 text-red-500 font-medium normal-case tracking-normal">
          — {fieldErrors[field]}
        </span>
      )}
    </label>
  );

  const empOptions = employees.map((e) => ({
    value: e.userId,
    label: `${e.displayName}${e.employeeId ? ` (${e.employeeId})` : ''}`,
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) shadow-xl w-full max-w-lg flex flex-col max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-(--shell-border)">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Edit Leave Balances
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Adjust annual leave totals. Changes are logged with a reason for audit purposes.
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {serverError && (
            <div className="rounded-lg px-4 py-3 text-sm bg-red-50 border border-red-200" style={{ color: '#DC2626' }}>
              {serverError}
            </div>
          )}

          {/* Employee selector */}
          <div>
            {fLabel('Employee', 'employee', true)}
            <SearchableSelect
              options={empOptions}
              value={selectedUid}
              onChange={(v) => {
                setSelectedUid(v);
                if (fieldErrors.employee) setFieldErrors((p) => { const n = { ...p }; delete n.employee; return n; });
              }}
              placeholder="Search employees…"
              className={fieldErrors.employee ? 'ring-1 ring-red-400 rounded-lg' : ''}
            />
          </div>

          {/* Year */}
          <div>
            {fLabel('Year')}
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className={inp()}
            >
              {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Balance rows */}
          {selectedUid && (
            <div className="rounded-xl border border-(--shell-border) overflow-hidden">
              <div className="overflow-x-auto">
              <div className="grid grid-cols-3 min-w-70 text-xs font-semibold uppercase tracking-wide px-4 py-2 border-b border-(--shell-border)" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--glass-panel-bg)' }}>
                <span>Leave Type</span>
                <span className="text-center">Current Total</span>
                <span className="text-center">New Total</span>
              </div>
              {loading ? (
                <div className="px-4 py-6 text-sm text-center" style={{ color: 'var(--text-muted)' }}>Loading current balances…</div>
              ) : (
                rows.map((r) => (
                  <div key={r.type} className="grid grid-cols-3 min-w-70 items-center px-4 py-3 border-b border-(--shell-border) last:border-0">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{r.label}</span>
                    <span className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>{r.current} days</span>
                    <div className="flex justify-center">
                      <input
                        type="number"
                        min="0"
                        max="365"
                        value={r.newTotal}
                        onChange={(e) => setRowValue(r.type, e.target.value)}
                        className={`w-20 text-center text-sm px-2 py-1.5 border rounded-lg outline-none focus:ring-2 transition-colors ${
                          fieldErrors[r.type]
                            ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30'
                            : 'border-(--shell-border) focus:ring-gold'
                        }`}
                      />
                    </div>
                  </div>
                ))
              )}
              </div>{/* /overflow-x-auto */}
            </div>
          )}
          {selectedUid && rows.some((r) => fieldErrors[r.type]) && (
            <p className="text-xs" style={{ color: '#DC2626' }}>
              {rows.map((r) => fieldErrors[r.type] && `${r.label}: ${fieldErrors[r.type]}`).filter(Boolean).join(' · ')}
            </p>
          )}

          {/* Reason */}
          <div>
            {fLabel('Reason for adjustment', 'reason', true)}
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (fieldErrors.reason) setFieldErrors((p) => { const n = { ...p }; delete n.reason; return n; });
              }}
              placeholder="e.g. Annual reset, carry-forward from previous year, correction…"
              className={`${inp('reason')} resize-none`}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || loading || !selectedUid}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: '#C9A961',
              color: 'var(--text-primary)',
              opacity: saving || loading || !selectedUid ? 0.5 : 1,
              cursor: saving || loading || !selectedUid ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            onClick={onClose}
            className="text-sm transition-opacity hover:opacity-60"
            style={{ color: 'var(--text-muted)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── BalancesTab ──────────────────────────────────────────────────────────────

interface AdjustmentRecord {
  id: string;
  employeeId: string;
  year: number;
  leaveType: string;
  oldTotal: number;
  newTotal: number;
  delta: number;
  reason: string;
  adjustedBy: string;
  adjustedByName: string;
  adjustedAt: import('firebase/firestore').Timestamp;
}

export function useAdjustmentHistory() {
  const [records, setRecords]   = useState<AdjustmentRecord[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'leave_balance_adjustments'), orderBy('adjustedAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AdjustmentRecord)));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  return { records, loading };
}

interface BalancesTabProps {
  employees: { userId: string; displayName: string; employeeId?: string }[];
  actorUid: string;
  actorName: string;
  isAdmin: boolean;
  isHrmsManager: boolean;
}

export function BalancesTab({ employees, actorUid, actorName }: BalancesTabProps) {
  const currentYear = currentLeaveYear();
  const [showEditModal, setShowEditModal] = useState(false);
  const { records, loading } = useAdjustmentHistory();

  const employeeNameById = (uid: string): string =>
    employees.find((e) => e.userId === uid)?.displayName ?? uid.slice(0, 8);

  const leaveTypeLabel: Record<string, string> = {
    casual: 'Casual', sick: 'Sick', earned: 'Earned',
  };

  return (
    <div>
      {/* Action bar */}
      <div className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-(--shell-border)">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          History of manual leave balance adjustments
        </p>
        <button
          onClick={() => setShowEditModal(true)}
          className="px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
        >
          Edit Balances
        </button>
      </div>

      {/* Adjustment history */}
      {loading ? (
        <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : records.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No adjustments recorded yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--shell-border)">
                {['Employee', 'Year', 'Type', 'Old Total', 'New Total', 'Delta', 'Reason', 'Adjusted By', 'Date'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-b border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                    {employeeNameById(r.employeeId)}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{r.year}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                    {leaveTypeLabel[r.leaveType] ?? r.leaveType}
                  </td>
                  <td className="px-4 py-3 text-center" style={{ color: 'var(--text-primary)' }}>{r.oldTotal}</td>
                  <td className="px-4 py-3 text-center" style={{ color: 'var(--text-primary)' }}>{r.newTotal}</td>
                  <td className="px-4 py-3 text-center font-semibold"
                    style={{ color: r.delta > 0 ? '#065F46' : r.delta < 0 ? '#991B1B' : 'var(--text-muted)' }}>
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate" style={{ color: 'var(--text-primary)' }} title={r.reason}>
                    {r.reason}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {r.adjustedByName}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                    {r.adjustedAt ? format(r.adjustedAt.toDate(), 'd MMM yyyy') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showEditModal && (
        <EditLeaveBalanceModal
          employees={employees}
          currentYear={currentYear}
          actorUid={actorUid}
          actorName={actorName}
          onClose={() => setShowEditModal(false)}
        />
      )}
    </div>
  );
}
