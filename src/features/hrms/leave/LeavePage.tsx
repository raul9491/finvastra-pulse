import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Plus, Coins, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useMyLeaveBalance, useMyApplications, cancelLeave } from '../hooks/useLeave';
import {
  useMyEncashmentRequests,
  submitEncashmentRequest,
} from '../hooks/useLeaveEncashment';
import type { LeaveApplication, LeaveStatus } from '../../../types';

// ─── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: LeaveStatus }) {
  const config: Record<LeaveStatus, { label: string; color: string; bg: string }> = {
    pending:   { label: 'Pending',   color: '#92400E', bg: '#FEF3C7' },
    approved:  { label: 'Approved',  color: '#065F46', bg: '#D1FAE5' },
    rejected:  { label: 'Rejected',  color: '#991B1B', bg: '#FEE2E2' },
    cancelled: { label: 'Cancelled', color: '#374151', bg: '#F3F4F6' },
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
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <p
        className="text-xs font-bold uppercase tracking-widest mb-1"
        style={{ color: '#8B8B85' }}
      >
        {label}
      </p>
      <p className="text-2xl font-semibold" style={{ color: '#0A0A0A' }}>
        {remaining}
      </p>
      <p className="text-xs" style={{ color: '#8B8B85' }}>
        days remaining &nbsp;·&nbsp; {used}/{total} used
      </p>
      <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
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
    pending:  { label: 'Pending',  color: '#92400E', bg: '#FEF3C7' },
    approved: { label: 'Approved', color: '#065F46', bg: '#D1FAE5' },
    rejected: { label: 'Rejected', color: '#991B1B', bg: '#FEE2E2' },
    paid:     { label: 'Paid',     color: '#1D4ED8', bg: '#DBEAFE' },
  };
  const { label, color, bg } = cfg[status] ?? { label: status, color: '#374151', bg: '#F3F4F6' };
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
  const year = new Date().getFullYear();
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
    if (!daysNum || daysNum < 1 || daysNum > 15) errs.encDays   = '1–15 days only';
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
    } catch (e) {
      setEncError('Failed to submit. Please try again.');
    } finally {
      setEncSaving(false);
    }
  };

  const encInp = (f?: string) => {
    const base = 'w-full text-sm px-3.5 py-2.5 border rounded-xl outline-none focus:ring-2 bg-white transition-colors';
    const err  = f && encFieldErr[f];
    return `${base} ${err ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30' : 'border-slate-200 focus:ring-navy/10 focus:border-navy'}`;
  };

  return (
    <div className="space-y-8 max-w-4xl">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            className="text-3xl mb-1"
            style={{
              fontFamily: '"Fraunces", Georgia, serif',
              fontStyle: 'italic',
              fontVariationSettings: '"SOFT" 30',
              fontWeight: 300,
              color: '#0A0A0A',
            }}
          >
            Leave
          </h2>
          <p className="text-sm" style={{ color: '#8B8B85' }}>
            {year} balance &amp; applications
          </p>
        </div>
        <Link
          to="/hrms/leave/apply"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ backgroundColor: '#0B1538', color: '#FFFFFF' }}
        >
          <Plus size={15} />
          Apply for Leave
        </Link>
      </div>

      {/* ── Balance cards ── */}
      {balLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <BalanceCard
            label="Casual Leave"
            used={balance?.casual.used ?? 0}
            total={balance?.casual.total ?? 8}
            remaining={balance?.casual.remaining ?? 8}
          />
          <BalanceCard
            label="Sick Leave"
            used={balance?.sick.used ?? 0}
            total={balance?.sick.total ?? 7}
            remaining={balance?.sick.remaining ?? 7}
          />
          <BalanceCard
            label="Earned Leave"
            used={balance?.earned.used ?? 0}
            total={balance?.earned.total ?? 15}
            remaining={balance?.earned.remaining ?? 15}
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
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>
            My Applications
          </h3>
        </div>

        {appsLoading ? (
          <div className="p-6 text-sm" style={{ color: '#8B8B85' }}>
            Loading…
          </div>
        ) : applications.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm" style={{ color: '#8B8B85' }}>
            No leave applications yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Type', 'From', 'To', 'Days', 'Status', 'Applied On', ''].map((h) => (
                    <th
                      key={h}
                      className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: '#8B8B85' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => (
                  <tr key={app.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3.5 font-medium" style={{ color: '#0A0A0A' }}>
                      {TYPE_LABELS[app.type] ?? app.type}
                    </td>
                    <td className="px-6 py-3.5" style={{ color: '#2A2A2A' }}>
                      {format(new Date(app.fromDate), 'd MMM yyyy')}
                    </td>
                    <td className="px-6 py-3.5" style={{ color: '#2A2A2A' }}>
                      {format(new Date(app.toDate), 'd MMM yyyy')}
                    </td>
                    <td className="px-6 py-3.5" style={{ color: '#2A2A2A' }}>
                      {app.days}
                    </td>
                    <td className="px-6 py-3.5">
                      <StatusPill status={app.status} />
                    </td>
                    <td className="px-6 py-3.5 text-xs" style={{ color: '#8B8B85' }}>
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
                          style={{ color: '#8B8B85' }}
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
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins size={15} style={{ color: '#0B1538' }} />
            <h3 className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>Leave Encashment</h3>
          </div>
          {!showEncash && (
            <button onClick={() => { setShowEncash(true); setEncSuccess(''); setEncError(''); }}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors hover:bg-navy/10"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              <Plus size={12} /> Request Encashment
            </button>
          )}
        </div>

        {encSuccess && (
          <div className="mx-6 mt-4 flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: '#F0FDF4' }}>
            <CheckCircle2 size={14} style={{ color: '#059669' }} />
            <p className="text-sm" style={{ color: '#065F46' }}>{encSuccess}</p>
          </div>
        )}

        {showEncash && (
          <div className="p-6 space-y-4 border-b border-slate-100">
            <p className="text-xs text-mute">Only Earned Leave (EL) can be encashed. Maximum 15 days per request. Daily rate = Gross ÷ 26.</p>
            {encError && (
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: '#FFF1F2' }}>
                <AlertCircle size={14} style={{ color: '#BE123C' }} />
                <p className="text-sm" style={{ color: '#BE123C' }}>{encError}</p>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-mute">Days (1–15){encFieldErr.encDays && <span className="text-red-500 ml-1 normal-case">— {encFieldErr.encDays}</span>}</label>
                <input type="number" min="1" max="15" className={encInp('encDays')} value={encDays}
                  onChange={(e) => { setEncDays(e.target.value); setEncFieldErr((p) => { const n = {...p}; delete n.encDays; return n; }); }} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-mute">Gross Monthly (₹){encFieldErr.encGross && <span className="text-red-500 ml-1 normal-case">— {encFieldErr.encGross}</span>}</label>
                <input type="number" className={encInp('encGross')} placeholder="e.g. 40000" value={encGross}
                  onChange={(e) => { setEncGross(e.target.value); setEncFieldErr((p) => { const n = {...p}; delete n.encGross; return n; }); }} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-mute">Payroll Month{encFieldErr.encMonth && <span className="text-red-500 ml-1 normal-case">— {encFieldErr.encMonth}</span>}</label>
                <input type="month" className={encInp('encMonth')} value={encMonth}
                  onChange={(e) => { setEncMonth(e.target.value); setEncFieldErr((p) => { const n = {...p}; delete n.encMonth; return n; }); }} />
              </div>
              <div className="sm:col-span-1">
                {encGross && encDays && Number(encGross) > 0 && Number(encDays) > 0 && (
                  <div className="p-2 rounded-xl text-center" style={{ backgroundColor: '#F0FDF4' }}>
                    <p className="text-[10px] text-mute">Est. Amount</p>
                    <p className="text-sm font-bold" style={{ color: '#065F46' }}>
                      ₹{(Number(encDays) * Math.round(Number(encGross) / 26)).toLocaleString('en-IN')}
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-mute">Reason{encFieldErr.encReason && <span className="text-red-500 ml-1 normal-case">— {encFieldErr.encReason}</span>}</label>
              <input className={encInp('encReason')} placeholder="Reason for encashment request" value={encReason}
                onChange={(e) => { setEncReason(e.target.value); setEncFieldErr((p) => { const n = {...p}; delete n.encReason; return n; }); }} />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowEncash(false)} className="px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleEncash} disabled={encSaving}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                {encSaving ? <Loader2 size={14} className="animate-spin" /> : <Coins size={14} />}
                {encSaving ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </div>
        )}

        {encashLoading ? (
          <div className="p-6 text-sm text-mute">Loading…</div>
        ) : encashReqs.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-mute">No encashment requests yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                {['Month', 'Days', 'Daily Rate', 'Amount', 'Status', 'Submitted'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-mute">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {encashReqs.map((r) => {
                const d = r.submittedAt?.toDate?.();
                return (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-ink">{r.month}</td>
                    <td className="px-4 py-3 text-mute">{r.leaveDays}</td>
                    <td className="px-4 py-3 text-mute">₹{r.dailyRate.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 font-semibold text-ink">₹{r.totalAmount.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3"><EncashPill status={r.status} /></td>
                    <td className="px-4 py-3 text-mute text-xs">{d ? format(d, 'd MMM yyyy') : '—'}</td>
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
