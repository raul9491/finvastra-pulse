import { useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isWeekend, parseISO, isAfter,
} from 'date-fns';
import { Clock, CalendarOff, CalendarDays, Receipt, ChevronRight, AlertCircle } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useMyAttendance } from '../hooks/useAttendance';
import { useMyLeaveBalance, usePendingApprovals } from '../hooks/useLeave';
import { useHolidays, seedHolidays2026 } from '../hooks/useHolidays';
import { useMyPayslips } from '../hooks/usePayslips';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function greeting(name: string): string {
  const h = new Date().getHours();
  const time = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return `Good ${time}, ${name.split(' ')[0]}.`;
}

function workingDaysInMonth(year: number, month: number, holidays: string[]): number {
  const start = startOfMonth(new Date(year, month - 1));
  const end   = endOfMonth(start);
  const holidaySet = new Set(holidays);
  return eachDayOfInterval({ start, end })
    .filter((d) => !isWeekend(d) && !holidaySet.has(format(d, 'yyyy-MM-dd')))
    .length;
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, sub, accent, link, loading,
}: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string;
  accent?: string; link: string; loading?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(link)}
      className="group w-full text-left bg-white border border-slate-200 rounded-2xl p-6 hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: (accent ?? '#0B1538') + '15', color: accent ?? '#0B1538' }}>
          {icon}
        </div>
        <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-mute">{label}</p>
      {loading ? (
        <div className="h-8 w-24 bg-slate-100 rounded animate-pulse" />
      ) : (
        <p className="text-2xl font-bold text-ink">{value}</p>
      )}
      {sub && <p className="text-xs text-mute mt-1">{sub}</p>}
    </button>
  );
}

// ─── Leave balance mini-bars ──────────────────────────────────────────────────

function LeaveCard({ loading, balance }: {
  loading: boolean;
  balance: { casual: { remaining: number; total: number }; sick: { remaining: number; total: number }; earned: { remaining: number; total: number } } | null;
}) {
  const navigate = useNavigate();
  const types = [
    { key: 'casual' as const, label: 'Casual', color: '#C9A961' },
    { key: 'sick'   as const, label: 'Sick',   color: '#3B82F6' },
    { key: 'earned' as const, label: 'Earned', color: '#10B981' },
  ];
  return (
    <button onClick={() => navigate('/hrms/leave')}
      className="group w-full text-left bg-white border border-slate-200 rounded-2xl p-6 hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: '#C9A96115', color: '#C9A961' }}>
          <CalendarOff size={18} />
        </div>
        <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-mute">Leave Balance</p>
      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-4 bg-slate-100 rounded animate-pulse" />)}
        </div>
      ) : !balance ? (
        <p className="text-sm text-mute">No balance set yet</p>
      ) : (
        <div className="space-y-2.5">
          {types.map(({ key, label, color }) => {
            const b = balance[key];
            const pct = b.total > 0 ? (b.remaining / b.total) * 100 : 0;
            return (
              <div key={key}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-ink-soft">{label}</span>
                  <span className="font-semibold text-ink">{b.remaining} / {b.total}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </button>
  );
}

// ─── Upcoming holidays card ───────────────────────────────────────────────────

function HolidaysCard({ holidays, loading }: { holidays: { date: string; name: string; type: string }[]; loading: boolean }) {
  const navigate = useNavigate();
  const today = format(new Date(), 'yyyy-MM-dd');
  const upcoming = holidays.filter((h) => h.date >= today).slice(0, 3);
  return (
    <button onClick={() => navigate('/hrms/holidays')}
      className="group w-full text-left bg-white border border-slate-200 rounded-2xl p-6 hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: '#C9A96120', color: '#C9A961' }}>
          <CalendarDays size={18} />
        </div>
        <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-mute">Upcoming Holidays</p>
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-5 bg-slate-100 rounded animate-pulse" />)}</div>
      ) : upcoming.length === 0 ? (
        <p className="text-sm text-mute">No upcoming holidays</p>
      ) : (
        <div className="space-y-2">
          {upcoming.map((h) => (
            <div key={h.date} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">{h.name}</p>
                <p className="text-xs text-mute">{format(parseISO(h.date), 'EEE, dd MMM yyyy')}</p>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: h.type === 'national' ? '#EFF6FF' : h.type === 'regional' ? '#FFFBEB' : '#FAFAF7',
                  color:           h.type === 'national' ? '#1D4ED8' : h.type === 'regional' ? '#92400E' : '#C9A961',
                }}>
                {h.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

// ─── HrmsDashboardPage ────────────────────────────────────────────────────────

export function HrmsDashboardPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === 'admin';
  const isManager = isAdmin || profile?.isHrmsManager === true;

  const uid = user?.uid ?? '';
  const today = new Date();
  const currentMonth = format(today, 'yyyy-MM');
  const currentYear  = today.getFullYear();

  const { records: attendanceRecords, loading: attLoading } = useMyAttendance(uid, currentMonth);
  const { balance,  loading: balLoading }  = useMyLeaveBalance(uid, currentYear);
  const { holidays, loading: holLoading }  = useHolidays(currentYear);
  const { payslips, loading: payLoading }  = useMyPayslips(uid);
  const { applications: pendingApprovals } = usePendingApprovals();

  // Auto-seed 2026 holidays if collection is empty (non-blocking)
  useEffect(() => { seedHolidays2026().catch((e) => console.error('[seedHolidays2026]', e)); }, []);

  // ── Attendance stats ───────────────────────────────────────────────────────
  const { presentDays, halfDays, workingDays } = useMemo(() => {
    const holidayDates = holidays.map((h) => h.date);
    return {
      presentDays:  attendanceRecords.filter((r) => r.status === 'present').length,
      halfDays:     attendanceRecords.filter((r) => r.status === 'half_day').length,
      workingDays:  workingDaysInMonth(today.getFullYear(), today.getMonth() + 1, holidayDates),
    };
  }, [attendanceRecords, holidays]);

  const latestPayslip = payslips[0] ?? null;

  // ── Leave pending check ────────────────────────────────────────────────────
  const myPendingLeave = pendingApprovals.filter((a) => a.employeeId === uid).length;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Greeting */}
      <div className="mb-8">
        <h2 className="text-4xl mb-1 text-ink"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300 }}>
          {profile?.displayName ? greeting(profile.displayName) : 'Welcome back.'}
        </h2>
        <p className="text-sm text-mute">
          {format(today, 'EEEE, dd MMMM yyyy')}
          {myPendingLeave > 0 && (
            <span className="ml-3 inline-flex items-center gap-1 text-amber-700">
              <AlertCircle size={12} /> {myPendingLeave} leave application{myPendingLeave > 1 ? 's' : ''} pending
            </span>
          )}
        </p>
      </div>

      {/* 4-card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {/* Attendance */}
        <StatCard
          icon={<Clock size={18} />}
          label="Attendance this month"
          value={attLoading ? '…' : `${presentDays + halfDays} / ${workingDays}`}
          sub={halfDays > 0 ? `${presentDays} full · ${halfDays} half-day` : 'working days present'}
          accent="#0B1538"
          link="/hrms/attendance"
          loading={attLoading}
        />

        {/* Leave balance */}
        <LeaveCard loading={balLoading} balance={balance} />

        {/* Upcoming holidays */}
        <HolidaysCard holidays={holidays} loading={holLoading} />

        {/* Latest payslip */}
        <StatCard
          icon={<Receipt size={18} />}
          label="Latest Payslip"
          value={payLoading ? '…' : latestPayslip ? `₹${latestPayslip.netPay.toLocaleString('en-IN')}` : '—'}
          sub={latestPayslip
            ? new Date(latestPayslip.month + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' })
            : 'No payslips yet'}
          accent="#166534"
          link="/hrms/payslips"
          loading={payLoading}
        />
      </div>

      {/* Manager: pending approvals banner */}
      {isManager && pendingApprovals.length > 0 && (
        <button onClick={() => navigate('/hrms/leave/admin')}
          className="w-full group flex items-center justify-between bg-amber-50 border border-amber-200 rounded-2xl px-6 py-4 hover:shadow-sm transition-all mb-6">
          <div className="flex items-center gap-3">
            <AlertCircle size={18} className="text-amber-600" />
            <div className="text-left">
              <p className="text-sm font-semibold text-amber-900">
                {pendingApprovals.length} leave application{pendingApprovals.length > 1 ? 's' : ''} waiting for approval
              </p>
              <p className="text-xs text-amber-700">Oldest first — act before the employee's leave date</p>
            </div>
          </div>
          <ChevronRight size={16} className="text-amber-500 group-hover:translate-x-0.5 transition-transform" />
        </button>
      )}

      {/* Quick links */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-4 text-mute">Quick Actions</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Apply for Leave',  path: '/hrms/leave/apply',   color: '#1D4ED8' },
            { label: 'Clock In / Out',   path: '/hrms/attendance',    color: '#0B1538' },
            { label: 'View Payslips',    path: '/hrms/payslips',      color: '#166534' },
            { label: 'Holiday Calendar', path: '/hrms/holidays',      color: '#C9A961' },
          ].map(({ label, path, color }) => (
            <button key={path} onClick={() => navigate(path)}
              className="px-4 py-3 rounded-xl text-sm font-semibold text-center transition-opacity hover:opacity-80"
              style={{ backgroundColor: color + '10', color }}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
