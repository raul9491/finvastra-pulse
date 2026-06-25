import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { format, parseISO, isAfter, isBefore } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { applyForLeave, useMyLeaveBalance, calculateWorkingDays, currentLeaveYear, LEAVE_DEFAULT_TOTALS } from '../hooks/useLeave';
import { notifyManagerOfRequest } from '../../../lib/notifications';
import { useHolidays } from '../hooks/useHolidays';
import type { LeaveType } from '../../../types';

const LEAVE_TYPES: { value: LeaveType; label: string }[] = [
  { value: 'casual',    label: 'Casual Leave' },
  { value: 'sick',      label: 'Sick Leave' },
  { value: 'earned',    label: 'Earned Leave' },
  { value: 'comp_off',  label: 'Compensatory Off' },
  { value: 'maternity', label: 'Maternity Leave' },
  { value: 'lop',       label: 'Loss of Pay (LOP)' },
  { value: 'optional',  label: 'Optional Leave' },
];

const BALANCE_TYPES = new Set<LeaveType>(['casual', 'sick', 'earned', 'comp_off']);

export function ApplyLeavePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const year = currentLeaveYear();

  const { balance }    = useMyLeaveBalance(user?.uid ?? '', year);
  const { holidays }   = useHolidays(year);

  const today = format(new Date(), 'yyyy-MM-dd');

  const [leaveType, setLeaveType]   = useState<LeaveType>('casual');
  const [fromDate,  setFromDate]    = useState('');
  const [toDate,    setToDate]      = useState('');
  const [reason,    setReason]      = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // Derived state
  const [workingDays, setWorkingDays] = useState(0);

  useEffect(() => {
    if (fromDate && toDate) {
      setWorkingDays(calculateWorkingDays(fromDate, toDate, holidays));
    } else {
      setWorkingDays(0);
    }
  }, [fromDate, toDate, holidays]);

  // ── Validation ────────────────────────────────────────────────────────────

  function getValidationError(): string | null {
    if (!fromDate || !toDate) return 'Please select both from and to dates.';

    // fromDate must be >= today
    if (isBefore(parseISO(fromDate), parseISO(today))) {
      return 'From date cannot be in the past.';
    }

    // fromDate <= toDate
    if (isAfter(parseISO(fromDate), parseISO(toDate))) {
      return 'From date must be on or before the to date.';
    }

    // Must have at least one working day
    if (workingDays <= 0) {
      return 'The selected date range has no working days (Sundays / holidays excluded; Mon–Sat work week).';
    }

    // Balance check for tracked leave types.
    // Per-type entry may be missing on a partial doc (e.g. comp-off-only) —
    // fall back to the HR Handbook default instead of crashing on `!`.
    if (BALANCE_TYPES.has(leaveType) && balance) {
      const t = leaveType as 'casual' | 'sick' | 'earned' | 'comp_off';
      const remaining = balance[t]?.remaining ?? LEAVE_DEFAULT_TOTALS[t];
      if (workingDays > remaining) {
        return `Insufficient ${leaveType} leave balance. You have ${remaining} day(s) remaining but requested ${workingDays}.`;
      }
    }

    if (reason.trim().length < 10) {
      return 'Please provide a reason of at least 10 characters.';
    }

    return null;
  }

  const validationError = getValidationError();
  const canSubmit = !validationError && !submitting;

  // ── Remaining balance for the selected type ───────────────────────────────

  function getBalanceLabel(): string {
    if (!BALANCE_TYPES.has(leaveType)) return '';
    if (!balance) return '';
    const remaining = balance[leaveType as 'casual' | 'sick' | 'earned' | 'comp_off']!.remaining;
    return `${leaveType.charAt(0).toUpperCase() + leaveType.slice(1)} balance: ${remaining} day(s) remaining`;
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || validationError) return;
    setError(null);
    setSubmitting(true);

    try {
      await applyForLeave({
        employeeId: user.uid,
        type: leaveType,
        fromDate,
        toDate,
        days: workingDays,
        reason: reason.trim(),
        status: 'pending',
      });
      // Alert the employee's reporting manager (bell + email) — no-op if no manager.
      notifyManagerOfRequest({
        kind: 'leave',
        rows: [
          { label: 'Type', value: LEAVE_TYPES.find((t) => t.value === leaveType)?.label ?? leaveType },
          { label: 'Dates', value: `${fromDate} → ${toDate}` },
          { label: 'Working days', value: String(workingDays) },
          { label: 'Reason', value: reason.trim() || '—' },
        ],
        link: '/hrms/admin/leave',
      }).catch(() => {});
      navigate('/hrms/leave');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit application.');
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <Link
          to="/hrms/leave"
          className="p-1.5 rounded-lg transition-colors hover:bg-(--glass-panel-bg)"
          style={{ color: 'var(--text-muted)' }}
        >
          <ArrowLeft size={18} />
        </Link>
        <h2
          className="text-3xl"
          style={{
            fontFamily: '"Fraunces", Georgia, serif',
            fontStyle: 'italic',
            fontVariationSettings: '"SOFT" 30',
            fontWeight: 300,
            color: 'var(--text-primary)',
          }}
        >
          Apply for Leave
        </h2>
      </div>

      {/* ── Form ── */}
      <form
        onSubmit={handleSubmit}
        className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-6 space-y-5"
      >
        {/* Leave type */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Leave Type
          </label>
          <select
            value={leaveType}
            onChange={(e) => setLeaveType(e.target.value as LeaveType)}
            className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{ color: 'var(--text-primary)', focusRingColor: '#C9A961' } as React.CSSProperties}
          >
            {LEAVE_TYPES.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {/* Date range */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              min={today}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              min={fromDate || today}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {/* Live preview */}
        {fromDate && toDate && (
          <div
            className="rounded-xl px-4 py-3 text-sm space-y-0.5"
            style={{ backgroundColor: 'var(--glass-panel-bg)', border: '1px solid var(--shell-border)' }}
          >
            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              {workingDays} working day{workingDays !== 1 ? 's' : ''}
            </p>
            {getBalanceLabel() && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {getBalanceLabel()}
              </p>
            )}
          </div>
        )}

        {/* Reason */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Reason <span className="normal-case font-normal">(min 10 characters)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Briefly describe the reason for your leave request…"
            className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
            style={{ color: 'var(--text-primary)' }}
          />
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {reason.trim().length} / 10 minimum characters
          </p>
        </div>

        {/* Inline validation error */}
        {validationError && fromDate && toDate && reason.length > 0 && (
          <p className="text-sm font-medium" style={{ color: '#DC2626' }}>
            {validationError}
          </p>
        )}

        {/* Server error */}
        {error && (
          <p className="text-sm font-medium" style={{ color: '#DC2626' }}>
            {error}
          </p>
        )}

        {/* Submit */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: canSubmit ? '#0B1538' : 'var(--text-muted)',
              color: '#FFFFFF',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? 'Submitting…' : 'Submit Application'}
          </button>
          <Link
            to="/hrms/leave"
            className="text-sm transition-opacity hover:opacity-60"
            style={{ color: 'var(--text-muted)' }}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
