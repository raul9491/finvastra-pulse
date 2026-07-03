/**
 * AdminCompOffPage — grant compensatory off days to employees.
 *
 * When an employee works on a Sunday or public holiday, HR records it here.
 * The comp_off leave balance is incremented atomically via a Firestore transaction.
 *
 * Access: admin + isHrmsManager (same gate as leave approvals).
 */

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Navigate } from 'react-router-dom';
import {
  PlusCircle, CalendarDays, CheckCircle2, AlertCircle, Loader2,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useAllCompOffCredits, grantCompOff } from '../hooks/useCompOff';
import { useMyLeaveBalance, currentLeaveYear } from '../hooks/useLeave';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { PageHeader } from '../../../components/ui/primitives';

// ─── Balance chip ─────────────────────────────────────────────────────────────

function BalanceChip({ employeeId }: { employeeId: string }) {
  const year = currentLeaveYear();
  const { balance, loading } = useMyLeaveBalance(employeeId, year);

  if (loading) return <span className="text-xs text-(--text-muted)">Loading balance…</span>;
  if (!balance?.comp_off) {
    return <span className="text-xs text-(--text-muted)">Comp Off balance: 0 days (no record yet)</span>;
  }
  const { total, used, remaining } = balance.comp_off;
  return (
    <span className="text-xs font-medium" style={{ color: '#059669' }}>
      Current Comp Off: <strong>{remaining}</strong> remaining of {total} total ({used} used)
    </span>
  );
}

// ─── AdminCompOffPage ─────────────────────────────────────────────────────────

export function AdminCompOffPage() {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? '';

  const isAdmin      = profile?.role === 'admin';
  const isHrmsManager = profile?.isHrmsManager === true;
  if (!isAdmin && !isHrmsManager) return <Navigate to="/hrms/dashboard" replace />;

  const { employees } = useAllEmployees();
  const { credits, loading: creditsLoading } = useAllCompOffCredits();

  // ── Form state ───────────────────────────────────────────────────────────────
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const [empId,       setEmpId]       = useState('');
  const [dateWorked,  setDateWorked]  = useState(todayStr);
  const [days,        setDays]        = useState('1');
  const [notes,       setNotes]       = useState('');
  const [saving,      setSaving]      = useState(false);
  const [success,     setSuccess]     = useState('');
  const [error,       setError]       = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const activeEmployees = useMemo(
    () => employees.filter((e) => !e.employeeStatus || e.employeeStatus === 'active'),
    [employees],
  );

  const employeeOptions = activeEmployees.map((e) => ({ value: e.userId, label: e.displayName }));

  const selectedEmp = activeEmployees.find((e) => e.userId === empId);
  const daysNum     = Math.max(0, Math.min(30, Number(days) || 0));

  const handleSubmit = async () => {
    const errs: Record<string, string> = {};
    if (!empId)          errs.emp        = 'Select an employee';
    if (!dateWorked)     errs.dateWorked = 'Date is required';
    if (daysNum < 0.5)   errs.days       = 'Must be at least 0.5';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    setFieldErrors({});
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const d = new Date(dateWorked);
      const year = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; // FY of the date worked
      await grantCompOff({
        employeeId:    empId,
        employeeName:  selectedEmp?.displayName ?? empId,
        dateWorked,
        daysGranted:   daysNum,
        notes:         notes.trim() || null,
        grantedBy:     uid,
        grantedByName: profile?.displayName ?? 'Admin',
        year,
      });
      setSuccess(`${daysNum} comp off day${daysNum !== 1 ? 's' : ''} granted to ${selectedEmp?.displayName}.`);
      // Reset form (keep employee selected for repeat grants)
      setDateWorked(todayStr);
      setDays('1');
      setNotes('');
    } catch {
      setError('Failed to grant comp off. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Style helpers
  const inp = (field?: string) => {
    const base = 'w-full text-sm px-3.5 py-2.5 border rounded-xl outline-none focus:ring-2 bg-(--glass-panel-bg) transition-colors';
    const err  = field && fieldErrors[field];
    return `${base} ${err ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30' : 'border-(--shell-border) focus:ring-navy/10 focus:border-navy'}`;
  };

  const fLabel = (text: string, field?: string, required = false) => (
    <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
      style={{ color: field && fieldErrors[field] ? '#DC2626' : 'var(--text-muted)' }}>
      {text}{required && <span className="text-red-500 ml-0.5">*</span>}
      {field && fieldErrors[field] && (
        <span className="ml-2 font-medium normal-case tracking-normal text-red-500">
          — {fieldErrors[field]}
        </span>
      )}
    </label>
  );

  function toTs(ts: any): Date | null {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate();
    return null;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <PageHeader
        title="Compensatory Off"
        subtitle="Grant comp off credits when employees work on Sundays or public holidays."
        pinKey="hrms.comp-off"
      />

      {/* Grant Form */}
      <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-6 space-y-5">
        <h3 className="text-sm font-semibold text-(--text-primary) flex items-center gap-2">
          <PlusCircle size={15} style={{ color: 'var(--text-primary)' }} />
          Grant Comp Off
        </h3>

        {success && (
          <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: '#F0FDF4' }}>
            <CheckCircle2 size={15} style={{ color: '#059669' }} />
            <p className="text-sm font-medium" style={{ color: '#065F46' }}>{success}</p>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: '#FFF1F2' }}>
            <AlertCircle size={15} style={{ color: '#BE123C' }} />
            <p className="text-sm" style={{ color: '#BE123C' }}>{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Employee */}
          <div className="sm:col-span-2">
            {fLabel('Employee', 'emp', true)}
            <SearchableSelect
              options={employeeOptions}
              value={empId}
              onChange={(v) => {
                setEmpId(v);
                setSuccess('');
                if (fieldErrors.emp) setFieldErrors((p) => { const n = {...p}; delete n.emp; return n; });
              }}
              placeholder="Select employee…"
            />
            {fieldErrors.emp && (
              <p className="text-xs text-red-500 mt-1">{fieldErrors.emp}</p>
            )}
            {empId && (
              <div className="mt-1.5">
                <BalanceChip employeeId={empId} />
              </div>
            )}
          </div>

          {/* Date Worked */}
          <div>
            {fLabel('Date Worked', 'dateWorked', true)}
            <input
              type="date"
              className={inp('dateWorked')}
              value={dateWorked}
              max={todayStr}
              onChange={(e) => {
                setDateWorked(e.target.value);
                if (fieldErrors.dateWorked) setFieldErrors((p) => { const n = {...p}; delete n.dateWorked; return n; });
              }}
            />
          </div>

          {/* Days */}
          <div>
            {fLabel('Days to Grant', 'days', true)}
            <input
              type="number"
              min="0.5"
              max="30"
              step="0.5"
              className={inp('days')}
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
                if (fieldErrors.days) setFieldErrors((p) => { const n = {...p}; delete n.days; return n; });
              }}
            />
            <p className="text-[10px] text-(--text-muted) mt-1">0.5 = half day · 1 = full day</p>
          </div>

          {/* Notes */}
          <div className="sm:col-span-2">
            {fLabel('Reason / Note')}
            <input
              type="text"
              className={inp()}
              placeholder="e.g. Worked on Ram Navami (26 Apr 2026)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <CalendarDays size={15} />}
            {saving ? 'Granting…' : 'Grant Comp Off'}
          </button>
        </div>
      </div>

      {/* Recent Credits Table */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Recent Comp Off Credits
        </h3>
        <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl overflow-hidden">
          {creditsLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-(--glass-panel-bg) rounded-lg animate-pulse" />
              ))}
            </div>
          ) : credits.length === 0 ? (
            <div className="py-12 text-center">
              <CalendarDays size={36} className="mx-auto mb-3 text-(--text-dim)" />
              <p className="text-sm text-(--text-muted)">No comp off credits granted yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--shell-border)">
                  <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Employee</th>
                  <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Date Worked</th>
                  <th className="text-center p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Days</th>
                  <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Note</th>
                  <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Granted</th>
                </tr>
              </thead>
              <tbody>
                {credits.map((c) => {
                  const grantedDate = toTs(c.grantedAt);
                  return (
                    <tr key={c.id} className="border-b border-(--shell-border) hover:bg-(--glass-panel-bg)/50">
                      <td className="p-4 font-medium text-(--text-primary)">{c.employeeName}</td>
                      <td className="p-4 text-(--text-muted)">
                        {format(new Date(c.dateWorked + 'T00:00:00'), 'EEE, d MMM yyyy')}
                      </td>
                      <td className="p-4 text-center">
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: '#EDE9FE', color: '#5B21B6' }}>
                          {c.daysGranted} day{c.daysGranted !== 1 ? 's' : ''}
                        </span>
                      </td>
                      <td className="p-4 text-(--text-muted) text-xs max-w-[200px] truncate">
                        {c.notes ?? '—'}
                      </td>
                      <td className="p-4 text-(--text-muted) text-xs">
                        <p>{c.grantedByName}</p>
                        {grantedDate && <p>{format(grantedDate, 'd MMM yyyy')}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
