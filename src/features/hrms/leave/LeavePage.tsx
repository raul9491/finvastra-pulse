import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Plus, Coins, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useMyLeaveBalance, useMyApplications, cancelLeave, currentLeaveYear, LEAVE_DEFAULT_TOTALS } from '../hooks/useLeave';
import {
  useMyEncashmentRequests,
  submitEncashmentRequest,
} from '../hooks/useLeaveEncashment';
import type { LeaveApplication, LeaveStatus } from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';

// ─── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: LeaveStatus }) {
  const config: Record<LeaveStatus, { label: string; color: string; bg: string }> = {
    pending:   { label: 'Pending',   color: '#fbbf24', bg: 'rgba(251,191,36,0.15)'  },
    approved:  { label: 'Approved',  color: '#34d399', bg: 'rgba(52,211,153,0.15)'  },
    rejected:  { label: 'Rejected',  color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
    cancelled: { label: 'Cancelled', color: 'var(--text-muted)', bg: 'var(--glass-panel-bg)' },
  };
  const { label, color, bg } = config[status];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ color, backgroundColor: bg }}
    >
      {label}
    </span>
  );
}

// ─── Balance card ─────────────────────────────────────────────────────────────

interface BalanceCardProps {
  label: string;
  used: number;
  total: number;
  remaining: number;
}

function BalanceCard({ label, used, total, remaining }: BalanceCardProps) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="glass-panel glass-card p-5">
      <p
        className="text-xs font-bold uppercase tracking-widest mb-1"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </p>
      <p className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
        {remaining}
      </p>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        days remaining &nbsp;·&nbsp; {used}/{total} used
      </p>
      <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: '#C9A961' }}
        />
      </div>
    </div>
  );
}

// ─── Leave type label ─────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  casual:   'Casual',
  sick:     'Sick',
  earned:   'Earned',
  lop:      'LOP',
  optional: 'Optional',
};

// ─── Encashment status pill ───────────────────────────────────────────────────

function EncashPill({ status }: { status: string }) {
  const cfg: Record<string, { label: string; color: string; bg: string }> = {
    pending:  { label: 'Pending',  color: '#fbbf24', bg: 'rgba(251,191,36,0.15)'  },
    approved: { label: 'Approved', color: '#34d399', bg: 'rgba(52,211,153,0.15)'  },
    rejected: { label: 'Rejected', color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
    paid:     { label: 'Paid',     color: '#60a5fa', bg: 'rgba(96,165,250,0.15)'  },
  };
  const { label, color, bg } = cfg[status] ?? { label: status, color: 'var(--text-muted)', bg: 'var(--glass-panel-bg)' };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ color, backgroundColor: bg }}>
      {label}
    </span>
  );
}

// ─── LeavePage ────────────────────────────────────────────────────────────────

export function LeavePage() {
  const { user, profile } = useAuth();
  const year = currentLeaveYear();
  const { balance, loading: balLoading } = useMyLeaveBalance(user?.uid ?? '', year);
  const { applications, loading: appsLoading } = useMyApplications(user?.uid ?? '');
  const { requests: encashReqs, loading: encashLoading } = useMyEncashmentRequests(user?.uid ?? '');

  // Encashment form state
  const [showEncash,  setShowEncash]  = useState(false);
  const [encDays,     setEncDays]     = useState('1');
  const [encGross,    setEncGross]    = useState('');
  const [encMonth,    setEncMonth]    = useState(format(new Date(), 'yyyy-MM'));
  const [encReason,   setEncReason]   = useState('');
  const [encSaving,   setEncSaving]   = useState(false);
  const [encSuccess,  setEncSuccess]  = useState('');
  const [encError,    setEncError]    = useState('');
  const [encFieldErr, setEncFieldErr] = useState<Record<string, string>>({});

  const handleCancel = async (app: LeaveApplication) => {
    if (app.status !== 'pending') return;
    if (!window.confirm('Cancel this leave application?')) return;
    await cancelLeave(app.id);
  };

  const handleEncash = async () => {
    const errs: Record<string, string> = {};
    const daysNum = Number(encDays);
    const grossNum = Number(encGross);
    // Only what's actually left in the EL balance can be encashed (C2).
    // Approval re-verifies + debits the balance server-side; this is the
    // friendly early check. Missing doc/entry → HR Handbook default.
    const elRemaining = balance?.earned?.remaining ?? LEAVE_DEFAULT_TOTALS.earned;
    if (!daysNum || daysNum < 1 || daysNum > 15)  errs.encDays   = '1–15 days only';
    else if (daysNum > elRemaining)               errs.encDays   = `Only ${elRemaining} earned-leave day(s) remaining`;
    if (!grossNum || grossNum < 1000)             errs.encGross  = 'Enter your gross monthly salary';
    if (!encMonth)                                errs.encMonth  = 'Required';
    if (!encReason.trim())                        errs.encReason = 'Reason is required';
    if (Object.keys(errs).length) { setEncFieldErr(errs); return; }
    setEncFieldErr({});
    setEncError('');
    setEncSuccess('');
    setEncSaving(true);
    try {
      const dailyRate = Math.round(grossNum / 26);
      await submitEncashmentRequest({
        employeeId:   user?.uid ?? '',
        employeeName: profile?.displayName ?? '',
        leaveDays:    daysNum,
        dailyRate,
        grossSalary:  grossNum,
        reason:       encReason.trim(),
        month:        encMonth,
      });
      setEncSuccess(`Encashment request for ${daysNum} day${daysNum !== 1 ? 's' : ''} (₹${(daysNum * dailyRate).toLocaleString('en-IN')}) submitted.`);
      setEncDays('1'); setEncGross(''); setEncReason(''); setShowEncash(false);
    } catch {
      setEncError('Failed to submit. Please try again.');
    } finally {
      setEncSaving(false);
    }
  };

  // Glass-friendly input style helper
  const encInp = (f?: string) => {
    const hasErr = f && encFieldErr[f];
    return `glass-inp w-full text-sm${hasErr ? ' border-[rgba(248,113,113,0.50)]' : ''}`;
  };

  return (
    <div className="space-y-8 max-w-4xl">
      {/* ── Header ── */}
      <PageHeader
        title="Leave"
        subtitle={`${year} balance & applications`}
        pinKey="hrms.leave"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {/* Secondary links — surfaced here since they're removed from the main nav */}
            <Link
              to="/hrms/leave/team-calendar"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors hover:bg-(--shell-hover-mid)"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--shell-border-mid)' }}
            >
              Team Calendar →
            </Link>
            <Link
              to="/hrms/holidays"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors hover:bg-(--shell-hover-mid)"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--shell-border-mid)' }}
            >
              Holidays →
            </Link>
            <Link
              to="/hrms/leave/apply"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:brightness-110"
              style={{
                background: 'linear-gradient(135deg, rgba(201,169,97,0.85), rgba(154,126,63,0.85))',
                color:      '#0B1538',
                border:     '1px solid rgba(201,169,97,0.40)',
              }}
            >
              <Plus size={15} />
              Apply for Leave
            </Link>
          </div>
        }
      />

      {/* ── Balance cards ── */}
      {balLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-panel p-5 animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Per-type optional chaining: a PARTIAL balance doc (e.g. created by
              a comp-off grant or an approval before other types were seeded)
              previously crashed this section via balance?.casual.used. */}
          <BalanceCard
            label="Casual Leave"
            used={balance?.casual?.used ?? 0}
            total={balance?.casual?.total ?? 8}
            remaining={balance?.casual?.remaining ?? 8}
          />
          <BalanceCard
            label="Sick Leave"
            used={balance?.sick?.used ?? 0}
            total={balance?.sick?.total ?? 7}
            remaining={balance?.sick?.remaining ?? 7}
          />
          <BalanceCard
            label="Earned Leave"
            used={balance?.earned?.used ?? 0}
            total={balance?.earned?.total ?? 15}
            remaining={balance?.earned?.remaining ?? 15}
          />
          {balance?.comp_off && (
            <BalanceCard
              label="Comp Off"
              used={balance.comp_off.used}
              total={balance.comp_off.total}
              remaining={balance.comp_off.remaining}
            />
          )}
        </div>
      )}

      {/* ── Applications table ── */}
      <div className="glass-panel overflow-hidden">
        <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--shell-border)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            My Applications
          </h3>
        </div>

        {appsLoading ? (
          <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading…
          </div>
        ) : applications.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No leave applications yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--shell-border)' }}>
                  {['Type', 'From', 'To', 'Days', 'Status', 'Applied On', ''].map((h) => (
                    <th
                      key={h}
                      className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => (
                  <tr
                    key={app.id}
                    className="transition-colors hover:bg-(--shell-hover-soft)"
                    style={{ borderBottom: '1px solid var(--shell-border)' }}
                  >
                    <td className="px-6 py-3.5 font-medium" style={{ color: 'var(--text-primary)' }}>
                      {TYPE_LABELS[app.type] ?? app.type}
                    </td>
                    <td className="px-6 py-3.5" style={{ color: 'var(--text-muted)' }}>
                      {format(new Date(app.fromDate), 'd MMM yyyy')}
                    </td>
                    <td className="px-6 py-3.5" style={{ color: 'var(--text-muted)' }}>
                      {format(new Date(app.toDate), 'd MMM yyyy')}
                    </td>
                    <td className="px-6 py-3.5" style={{ color: 'var(--text-muted)' }}>
                      {app.days}
                    </td>
                    <td className="px-6 py-3.5">
                      <StatusPill status={app.status} />
                    </td>
                    <td className="px-6 py-3.5 text-xs" style={{ color: 'var(--text-dim)' }}>
                      {app.appliedAt
                        ? format(
                            (app.appliedAt as import('firebase/firestore').Timestamp).toDate(),
                            'd MMM yyyy',
                          )
                        : '—'}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      {app.status === 'pending' && (
                        <button
                          onClick={() => handleCancel(app)}
                          className="text-xs font-medium transition-opacity hover:opacity-60"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Leave Encashment ── */}
      <div className="glass-panel overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--shell-border)' }}>
          <div className="flex items-center gap-2">
            <Coins size={15} style={{ color: '#C9A961' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Leave Encashment</h3>
          </div>
          {!showEncash && (
            <button
              onClick={() => { setShowEncash(true); setEncSuccess(''); setEncError(''); }}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:brightness-110"
              style={{
                background: 'linear-gradient(135deg, rgba(201,169,97,0.85), rgba(154,126,63,0.85))',
                color:      '#0B1538',
                border:     '1px solid rgba(201,169,97,0.40)',
              }}
            >
              <Plus size={12} /> Request Encashment
            </button>
          )}
        </div>

        {encSuccess && (
          <div className="mx-6 mt-4 flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.20)' }}>
            <CheckCircle2 size={14} style={{ color: '#34d399' }} />
            <p className="text-sm" style={{ color: '#34d399' }}>{encSuccess}</p>
          </div>
        )}

        {showEncash && (
          <div className="p-6 space-y-4" style={{ borderBottom: '1px solid var(--shell-border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Only Earned Leave (EL) can be encashed. Maximum 15 days per request. Daily rate = Gross ÷ 26.</p>
            {encError && (
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.20)' }}>
                <AlertCircle size={14} style={{ color: '#f87171' }} />
                <p className="text-sm" style={{ color: '#f87171' }}>{encError}</p>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: encFieldErr.encDays ? '#f87171' : 'var(--text-muted)' }}>
                  Days (1–15){encFieldErr.encDays && <span className="ml-1 normal-case font-normal">— {encFieldErr.encDays}</span>}
                </label>
                <input type="number" min="1" max="15" className={encInp('encDays')} value={encDays}
                  onChange={(e) => { setEncDays(e.target.value); setEncFieldErr((p) => { const n = {...p}; delete n.encDays; return n; }); }} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: encFieldErr.encGross ? '#f87171' : 'var(--text-muted)' }}>
                  Gross Monthly (₹){encFieldErr.encGross && <span className="ml-1 normal-case font-normal">— {encFieldErr.encGross}</span>}
                </label>
                <input type="number" className={encInp('encGross')} placeholder="e.g. 40000" value={encGross}
                  onChange={(e) => { setEncGross(e.target.value); setEncFieldErr((p) => { const n = {...p}; delete n.encGross; return n; }); }} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: encFieldErr.encMonth ? '#f87171' : 'var(--text-muted)' }}>
                  Payroll Month{encFieldErr.encMonth && <span className="ml-1 normal-case font-normal">— {encFieldErr.encMonth}</span>}
                </label>
                <input type="month" className={encInp('encMonth')} value={encMonth}
                  onChange={(e) => { setEncMonth(e.target.value); setEncFieldErr((p) => { const n = {...p}; delete n.encMonth; return n; }); }} />
              </div>
              <div className="sm:col-span-1">
                {encGross && encDays && Number(encGross) > 0 && Number(encDays) > 0 && (
                  <div className="p-2 rounded-xl text-center" style={{ backgroundColor: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.20)' }}>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Est. Amount</p>
                    <p className="text-sm font-bold" style={{ color: '#34d399' }}>
                      ₹{(Number(encDays) * Math.round(Number(encGross) / 26)).toLocaleString('en-IN')}
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: encFieldErr.encReason ? '#f87171' : 'var(--text-muted)' }}>
                Reason{encFieldErr.encReason && <span className="ml-1 normal-case font-normal" style={{ color: '#f87171' }}>— {encFieldErr.encReason}</span>}
              </label>
              <input className={encInp('encReason')} placeholder="Reason for encashment request" value={encReason}
                onChange={(e) => { setEncReason(e.target.value); setEncFieldErr((p) => { const n = {...p}; delete n.encReason; return n; }); }} />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowEncash(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-colors hover:bg-(--shell-hover-mid)"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--shell-border-mid)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleEncash}
                disabled={encSaving}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 transition-all hover:brightness-110"
                style={{
                  background: 'linear-gradient(135deg, rgba(201,169,97,0.85), rgba(154,126,63,0.85))',
                  color:      '#0B1538',
                  border:     '1px solid rgba(201,169,97,0.40)',
                }}
              >
                {encSaving ? <Loader2 size={14} className="animate-spin" /> : <Coins size={14} />}
                {encSaving ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </div>
        )}

        {encashLoading ? (
          <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : encashReqs.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No encashment requests yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--shell-border)' }}>
                {['Month', 'Days', 'Daily Rate', 'Amount', 'Status', 'Submitted'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {encashReqs.map((r) => {
                const d = r.submittedAt?.toDate?.();
                return (
                  <tr key={r.id} className="transition-colors hover:bg-(--shell-hover-soft)" style={{ borderBottom: '1px solid var(--shell-border)' }}>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{r.month}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>{r.leaveDays}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>₹{r.dailyRate.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 font-semibold" style={{ color: 'var(--text-primary)' }}>₹{r.totalAmount.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3"><EncashPill status={r.status} /></td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-dim)' }}>{d ? format(d, 'd MMM yyyy') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
