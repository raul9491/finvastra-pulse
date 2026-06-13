import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, MapPin, ArrowRight, CalendarCheck, AlertCircle } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useMyMeetings, updateMeeting } from '../hooks/useMeetings';
import type { CrmMeeting } from '../../../types';

const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

function bucketOf(iso: string): 'Today' | 'Tomorrow' | 'This week' | 'Later' {
  const d = new Date(iso); const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 7) return 'This week';
  return 'Later';
}

export function MyMeetingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { meetings, loading } = useMyMeetings(user?.uid ?? null);

  const upcoming = useMemo(
    () => meetings.filter((m) => m.status === 'scheduled' && new Date(m.endAt || m.startAt).getTime() > Date.now() - 3600000),
    [meetings]);

  const groups = useMemo(() => {
    const order = ['Today', 'Tomorrow', 'This week', 'Later'] as const;
    const byBucket: Record<string, CrmMeeting[]> = {};
    for (const m of upcoming) (byBucket[bucketOf(m.startAt)] ??= []).push(m);
    return order.filter((b) => byBucket[b]?.length).map((b) => ({ bucket: b, items: byBucket[b] }));
  }, [upcoming]);

  const markDone = (id: string) => { updateMeeting(id, { status: 'done' }).catch(() => {}); };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontVariationSettings: '"SOFT" 30', fontWeight: 300, color: 'var(--text-primary)' }}>
          Meetings
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Your upcoming client meetings — also on your Google Calendar</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-16 justify-center">
          <div className="w-5 h-5 rounded-full border-2 border-gold border-t-transparent animate-spin" />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</span>
        </div>
      ) : upcoming.length === 0 ? (
        <div className="glass-panel p-10 text-center">
          <CalendarClock size={34} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No upcoming meetings</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Schedule meetings from a customer's page — they sync to your Google Calendar.</p>
        </div>
      ) : (
        groups.map(({ bucket, items }) => (
          <div key={bucket}>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>{bucket}</p>
            <div className="space-y-2">
              {items.map((m) => (
                <div key={m.id} className="glass-panel p-4 flex items-center gap-4">
                  <div className="text-center shrink-0 w-16">
                    <p className="text-lg font-bold" style={{ color: '#C9A961' }}>{fmtTime(m.startAt)}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{fmtDay(m.startAt).split(',')[0]}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{m.title}</p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{m.leadName}{m.location ? ` · ` : ''}{m.location && <span className="inline-flex items-center gap-0.5"><MapPin size={10} />{m.location}</span>}</p>
                    <span className="text-[10px] font-semibold inline-flex items-center gap-1 mt-0.5" style={{ color: m.calendarSyncStatus === 'synced' ? '#34d399' : '#fbbf24' }}>
                      {m.calendarSyncStatus === 'synced' ? <><CalendarCheck size={11} /> On your calendar</> : <><AlertCircle size={11} /> Not synced</>}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => markDone(m.id)} className="text-[11px] font-semibold px-2 py-1 rounded-lg border" style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Done</button>
                    <button onClick={() => navigate(`/crm/leads/${m.leadId}`)} className="p-1.5 rounded-lg hover:bg-(--shell-hover-soft)" aria-label="Open customer">
                      <ArrowRight size={15} style={{ color: 'var(--text-muted)' }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
