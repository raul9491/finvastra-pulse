/**
 * The dashboard stat cards: leave balance, holidays, and team-today.
 * 
 * Extracted verbatim from HrmsDashboardPage.tsx (2026-07-23).
 */
import { parseISO } from 'date-fns';
import { ChevronRight, CalendarOff, CalendarDays, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

// ─── Stat card ────────────────────────────────────────────────────────────────

// ─── Leave balance mini-bars ──────────────────────────────────────────────────

export function LeaveCard({ loading, balance }: {
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
      className="group w-full text-left glass-panel glass-card p-6 transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961' }}>
          <CalendarOff size={18} />
        </div>
        <ChevronRight size={14} style={{ color: 'var(--text-dim)' }} className="group-hover:opacity-70 transition-opacity" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Leave Balance</p>
      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-4 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />)}
        </div>
      ) : !balance ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No balance set yet</p>
      ) : (
        <div className="space-y-2.5">
          {types.map(({ key, label, color }) => {
            const b = balance[key];
            const pct = b.total > 0 ? (b.remaining / b.total) * 100 : 0;
            return (
              <div key={key}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{b.remaining} / {b.total}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
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

export function HolidaysCard({ holidays, loading }: { holidays: { date: string; name: string; type: string }[]; loading: boolean }) {
  const navigate = useNavigate();
  const today = format(new Date(), 'yyyy-MM-dd');
  const upcoming = holidays.filter((h) => h.date >= today).slice(0, 3);
  return (
    <button onClick={() => navigate('/hrms/holidays')}
      className="group w-full text-left glass-panel glass-card p-6 transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961' }}>
          <CalendarDays size={18} />
        </div>
        <ChevronRight size={14} style={{ color: 'var(--text-dim)' }} className="group-hover:opacity-70 transition-opacity" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Upcoming Holidays</p>
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-5 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />)}</div>
      ) : upcoming.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No upcoming holidays</p>
      ) : (
        <div className="space-y-2">
          {upcoming.map((h) => (
            <div key={h.date} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{h.name}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{format(parseISO(h.date), 'EEE, dd MMM yyyy')}</p>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: h.type === 'national' ? 'rgba(96,165,250,0.15)' : h.type === 'regional' ? 'rgba(201,169,97,0.15)' : 'var(--glass-panel-bg)',
                  color:           h.type === 'national' ? '#60a5fa' : h.type === 'regional' ? '#C9A961' : 'var(--text-muted)',
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

// ─── Team Today card ──────────────────────────────────────────────────────────

export function TeamTodayCard({ present, leave, absent, loading }: { present: number; leave: number; absent: number; loading: boolean }) {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate('/hrms/admin/attendance')}
      className="group w-full text-left glass-panel glass-card p-6 transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(52,211,153,0.12)', color: '#34d399' }}>
          <Clock size={18} />
        </div>
        <ChevronRight size={14} style={{ color: 'var(--text-dim)' }} className="group-hover:opacity-70 transition-opacity" />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Team Today</p>
      {loading ? (
        <div className="h-8 w-24 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
      ) : (
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#34d399' }} />
            <span style={{ color: 'var(--text-muted)' }}>{present} present / checked in</span>
          </div>
          {leave > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#60a5fa' }} />
              <span style={{ color: 'var(--text-muted)' }}>{leave} on leave</span>
            </div>
          )}
        </div>
      )}
    </button>
  );
}
