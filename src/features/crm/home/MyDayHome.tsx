/**
 * MyDayHome — the telecaller landing screen ("what needs me right now").
 * Deliberately light: one cached fetch (/api/crm/activity/summary, 45s server
 * cache) + useMyLeads + useCallbackReminders (both already streaming in the
 * shell — Firestore multiplexes identical queries) + useMyTargets.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhoneCall, AlertTriangle, Clock, UserX, ArrowRight, Target } from 'lucide-react';
import { auth } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useMyLeads } from '../hooks/useMyLeads';
import { useCallbackReminders } from '../hooks/useCallbackReminders';
import { useMyTargets, achievementPct } from '../hooks/useRmTargets';
import { PageHeader, StatCard, Card, Section } from '../../../components/ui/primitives';
import { fmtRupees } from './widgets';

interface ActivityLite {
  totalTouches: number;
  untouchedCount: number;
  daily: Array<{ date: string; count: number }>;
}

const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

export function MyDayHome() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const uid = user?.uid ?? '';
  const period = new Date().toISOString().slice(0, 7);

  const { leads, overdue, loading: leadsLoading } = useMyLeads(uid);
  const { due } = useCallbackReminders(uid);
  const { target, actuals } = useMyTargets(uid, period);
  const [act, setAct] = useState<ActivityLite | null>(null);

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(`/api/crm/activity/summary?period=${period}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok && alive) setAct(await res.json());
      } catch { /* stat cards just show 0 */ }
    })();
    return () => { alive = false; };
  }, [uid, period]);

  const callsToday = act?.daily.find((d) => d.date === istToday())?.count ?? 0;
  const firstName = (profile?.displayName ?? '').split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const nextUp = leads.slice(0, 3);
  const disbursedTarget = target?.targets.disbursalAmount ?? 0;
  const disbursedActual = actuals?.disbursalAmount ?? 0;
  const ach = achievementPct(disbursedActual, disbursedTarget);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="My Day"
        subtitle={`${greeting}, ${firstName} — here's what needs you right now.`}
        pinKey="crm.dashboard"
      />

      {/* Do-now strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<Clock size={16} />} label="Callbacks due now" value={due.length}
          sub={due.length > 0 ? 'promised calls waiting' : 'nothing scheduled'}
          accent={due.length > 0 ? '#EF4444' : '#34A853'} link="/crm/tasks" />
        <StatCard icon={<AlertTriangle size={16} />} label="Overdue in my queue" value={overdue}
          loading={leadsLoading} sub={overdue > 0 ? 'past their follow-up time' : 'all on time'}
          accent={overdue > 0 ? '#F59E0B' : '#34A853'} link="/crm/tasks" />
        <StatCard icon={<PhoneCall size={16} />} label="Calls today" value={callsToday}
          sub={act ? `${act.totalTouches} touches this month` : undefined} accent="#C9A961"
          link="/crm/performance" />
        <StatCard icon={<UserX size={16} />} label="Untouched customers" value={act?.untouchedCount ?? 0}
          sub="tagged, never contacted" accent={(act?.untouchedCount ?? 0) > 0 ? '#EF4444' : '#34A853'}
          link="/crm/performance?view=untouched" />
      </div>

      {/* Next up */}
      <Card>
        <Section label="Next up" action={
          <button onClick={() => navigate(nextUp[0] ? `/crm/leads/${nextUp[0].lead.id}` : '/crm/tasks')}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            Get next lead <ArrowRight size={12} />
          </button>
        }>
          {nextUp.length === 0 ? (
            <p className="text-sm py-3" style={{ color: 'var(--text-dim)' }}>
              Queue is clear — pull fresh leads from Tasks → My Queue.
            </p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--shell-border)' }}>
              {nextUp.map(({ lead }) => {
                const dl = lead.slaDeadline as { toDate?: () => Date } | null;
                const ms = typeof dl?.toDate === 'function' ? dl.toDate!().getTime() : null;
                const isOver = ms !== null && ms < Date.now();
                return (
                  <button key={lead.id} onClick={() => navigate(`/crm/leads/${lead.id}`)}
                    className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-(--shell-hover-soft) rounded-lg px-2 -mx-2 transition-colors">
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{lead.displayName}</span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                      style={isOver
                        ? { color: '#f87171', backgroundColor: 'rgba(248,113,113,0.12)' }
                        : { color: '#C9A961', backgroundColor: 'rgba(201,169,97,0.14)' }}>
                      {isOver ? 'Overdue' : 'Due soon'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Section>
      </Card>

      {/* My month */}
      <Card>
        <Section label="My month" action={
          <button onClick={() => navigate('/crm/targets')} className="text-xs font-semibold" style={{ color: '#C9A961' }}>
            Targets →
          </button>
        }>
          {disbursedTarget > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: 'var(--text-muted)' }}>Disbursed {fmtRupees(disbursedActual)} of {fmtRupees(disbursedTarget)}</span>
                <span className="font-bold" style={{ color: ach >= 80 ? '#34d399' : ach >= 50 ? '#C9A961' : '#f87171' }}>{ach}%</span>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, ach)}%`, backgroundColor: ach >= 80 ? '#34d399' : ach >= 50 ? '#C9A961' : '#f87171' }} />
              </div>
            </div>
          ) : (
            <p className="text-sm flex items-center gap-2" style={{ color: 'var(--text-dim)' }}>
              <Target size={14} /> No target set for this month yet — ask your manager, or check Targets.
            </p>
          )}
        </Section>
      </Card>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: 'My Activity', to: '/crm/performance' },
          { label: 'Customers', to: '/crm/leads' },
          { label: 'Meetings', to: '/crm/tasks' },
        ].map((l) => (
          <button key={l.to + l.label} onClick={() => navigate(l.to)}
            className="text-xs font-semibold px-3.5 py-2 rounded-lg border transition-opacity hover:opacity-80"
            style={{ borderColor: 'var(--shell-border-mid)', color: 'var(--text-secondary)' }}>
            {l.label} →
          </button>
        ))}
      </div>
    </div>
  );
}
