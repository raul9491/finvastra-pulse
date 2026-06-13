import { useState } from 'react';
import { CalendarClock, Check, X, MapPin, Plus, CalendarCheck, AlertCircle } from 'lucide-react';
import { useLeadMeetings, scheduleMeeting, updateMeeting } from '../hooks/useMeetings';
import type { CrmMeeting } from '../../../types';

const DURATIONS = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
];

function syncChip(m: CrmMeeting) {
  if (m.status === 'cancelled') return null;
  if (m.calendarSyncStatus === 'synced')
    return <span className="text-[10px] font-semibold inline-flex items-center gap-1" style={{ color: '#34d399' }}><CalendarCheck size={11} /> On your Google Calendar</span>;
  return <span className="text-[10px] font-semibold inline-flex items-center gap-1" style={{ color: '#fbbf24' }}><AlertCircle size={11} /> Not synced to calendar</span>;
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * MeetingsSection — schedule client meetings against a lead; the server pushes
 * each one to the RM's own Google Workspace calendar. Shown to the lead's owner,
 * the owner's manager, or an admin (canSchedule). Non-fatal calendar sync: the
 * meeting is always saved in Pulse even if the calendar push fails.
 */
export function MeetingsSection({ leadId, leadName, canSchedule }: { leadId: string; leadName: string; canSchedule: boolean }) {
  const { meetings, loading } = useLeadMeetings(leadId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [startAt, setStartAt] = useState('');
  const [durationMins, setDurationMins] = useState(30);
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [fieldErr, setFieldErr] = useState('');

  const upcoming = meetings.filter((m) => m.status === 'scheduled');
  const past = meetings.filter((m) => m.status !== 'scheduled');

  const reset = () => { setTitle(''); setStartAt(''); setDurationMins(30); setLocation(''); setNotes(''); setErr(''); setFieldErr(''); };

  const handleSchedule = async () => {
    if (!startAt) { setFieldErr('Pick a date & time'); return; }
    if (new Date(startAt).getTime() < Date.now() - 60000) { setFieldErr('That time is in the past'); return; }
    setSaving(true); setErr(''); setFieldErr('');
    try {
      const res = await scheduleMeeting({
        leadId,
        title: title.trim() || undefined,
        startAt: new Date(startAt).toISOString(),
        durationMins,
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      reset(); setOpen(false);
      if (res.calendarSyncStatus === 'failed')
        setErr('Meeting saved, but Google Calendar sync is not set up yet (ask admin to enable the Calendar scope).');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not schedule the meeting.');
    } finally { setSaving(false); }
  };

  const cancelMeeting = async (id: string) => {
    if (!window.confirm('Cancel this meeting? It will be removed from the calendar.')) return;
    try { await updateMeeting(id, { status: 'cancelled' }); } catch { /* surfaced by snapshot */ }
  };
  const markDone = async (id: string) => {
    try { await updateMeeting(id, { status: 'done' }); } catch { /* no-op */ }
  };

  const inp = (bad?: boolean) =>
    `w-full text-sm px-3.5 py-2.5 border rounded-lg outline-none focus:ring-2 transition-colors glass-inp ${bad ? 'border-red-400 focus:ring-red-200/50' : ''}`;

  return (
    <div className="glass-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarClock size={16} style={{ color: '#C9A961' }} />
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Meetings</h3>
          {upcoming.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ color: '#C9A961', backgroundColor: 'rgba(201,169,97,0.14)' }}>{upcoming.length}</span>
          )}
        </div>
        {canSchedule && !open && (
          <button onClick={() => setOpen(true)} className="text-xs font-semibold inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            <Plus size={13} /> Schedule
          </button>
        )}
      </div>

      {err && (
        <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.30)', color: '#fbbf24' }}>{err}</div>
      )}

      {/* Schedule form */}
      {open && canSchedule && (
        <div className="mb-4 p-3 rounded-xl space-y-2.5" style={{ border: '1px solid var(--shell-border)' }}>
          <input className={inp()} placeholder={`Title (default: Meeting · ${leadName})`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <input type="datetime-local" className={inp(!!fieldErr)} value={startAt}
                onChange={(e) => { setStartAt(e.target.value); if (fieldErr) setFieldErr(''); }} />
              {fieldErr && <p className="text-[10px] mt-1" style={{ color: '#f87171' }}>{fieldErr}</p>}
            </div>
            <select className={inp()} value={durationMins} onChange={(e) => setDurationMins(Number(e.target.value))}>
              {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <input className={inp()} placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
          <textarea className={`${inp()} resize-none`} rows={2} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          <div className="flex gap-2">
            <button onClick={() => { reset(); setOpen(false); }} className="flex-1 py-2 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={handleSchedule} disabled={saving} className="flex-1 py-2 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {saving ? 'Scheduling…' : 'Schedule meeting'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : meetings.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No meetings yet.</p>
      ) : (
        <div className="space-y-2">
          {upcoming.map((m) => (
            <div key={m.id} className="px-3 py-2.5 rounded-lg" style={{ border: '1px solid var(--shell-border)' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{m.title}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{fmtWhen(m.startAt)}</p>
                  {m.location && <p className="text-[10px] mt-0.5 inline-flex items-center gap-1" style={{ color: 'var(--text-muted)' }}><MapPin size={10} /> {m.location}</p>}
                  <div className="mt-1">{syncChip(m)}</div>
                </div>
                {canSchedule && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => markDone(m.id)} title="Mark done" className="p-1.5 rounded-lg hover:bg-(--shell-hover-soft)"><Check size={14} style={{ color: '#34d399' }} /></button>
                    <button onClick={() => cancelMeeting(m.id)} title="Cancel" className="p-1.5 rounded-lg hover:bg-(--shell-hover-soft)"><X size={14} style={{ color: '#f87171' }} /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {past.length > 0 && (
            <div className="pt-1">
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Past</p>
              {past.slice(0, 5).map((m) => (
                <div key={m.id} className="px-3 py-1.5 flex items-center justify-between gap-2">
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)', textDecoration: m.status === 'cancelled' ? 'line-through' : 'none' }}>
                    {m.title} · {fmtWhen(m.startAt)}
                  </p>
                  <span className="text-[10px] font-semibold shrink-0" style={{ color: m.status === 'done' ? '#34d399' : '#f87171' }}>{m.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
