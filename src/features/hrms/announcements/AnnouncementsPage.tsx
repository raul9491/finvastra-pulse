import { useEffect, useMemo } from 'react';
import { Megaphone, Pin, AlertTriangle, Info, CalendarDays } from 'lucide-react';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { useAuth } from '../../auth/AuthContext';
import { useAnnouncements, markAnnouncementRead } from '../hooks/useAnnouncements';
import { useHolidays } from '../hooks/useHolidays';
import type { Announcement, AnnouncementPriority, Holiday } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_META: Record<AnnouncementPriority, { label: string; bg: string; border: string; color: string; icon: typeof Info }> = {
  normal:    { label: 'Normal',    bg: '#FAFAF7', border: '#E2E8F0', color: '#2A2A2A', icon: Info },
  important: { label: 'Important', bg: '#FFFBEB', border: '#FCD34D', color: '#92400E', icon: AlertTriangle },
  urgent:    { label: 'Urgent',    bg: '#FFF1F2', border: '#FECDD3', color: '#BE123C', icon: AlertTriangle },
};

function toTs(ts: unknown): Date | null {
  if (!ts) return null;
  if (typeof (ts as { toDate?: unknown }).toDate === 'function') return (ts as { toDate: () => Date }).toDate();
  return null;
}

// ─── Holiday proximity pill ───────────────────────────────────────────────────

function HolidayPill({ diff }: { diff: number }) {
  const isVeryClose = diff <= 3;
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{
        backgroundColor: diff === 0 ? '#C9A961' : isVeryClose ? '#FEF3C7' : '#F1F5F9',
        color:           diff === 0 ? '#0B1538' : isVeryClose ? '#92400E' : '#475569',
      }}
    >
      {diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `In ${diff} days`}
    </span>
  );
}

// ─── Upcoming Holidays section ────────────────────────────────────────────────

function UpcomingHolidaysSection({ holidays }: { holidays: Holiday[] }) {
  const today = new Date();

  const upcoming = useMemo(() =>
    holidays
      .map((h) => ({ ...h, diff: differenceInCalendarDays(parseISO(h.date), today) }))
      .filter((h) => h.diff >= 0 && h.diff <= 29)
      .sort((a, b) => a.date.localeCompare(b.date)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [holidays]);

  if (upcoming.length === 0) return null;

  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{ backgroundColor: '#FFFEF5', borderColor: '#FDE68A' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3"
        style={{ backgroundColor: '#FFFBEB', borderBottom: '1px solid #FDE68A' }}>
        <CalendarDays size={15} style={{ color: '#92400E' }} />
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#92400E' }}>
          Upcoming Holidays
        </p>
        <span className="ml-auto text-[10px] text-mute">Next 30 days</span>
      </div>

      {/* Holiday rows */}
      <div className="divide-y divide-amber-100">
        {upcoming.map((h) => (
          <div key={h.id} className="flex items-center gap-4 px-5 py-3">
            <span className="text-lg" aria-hidden>🗓️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: '#0A0A0A' }}>{h.name}</p>
              <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>
                {format(parseISO(h.date), 'EEEE, dd MMM yyyy')}
                {h.type !== 'national' && (
                  <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: '#C9A961' }}>
                    {h.type}
                  </span>
                )}
              </p>
            </div>
            <HolidayPill diff={h.diff} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Announcement Card ────────────────────────────────────────────────────────

function AnnouncementCard({ ann, userId }: { ann: Announcement; userId: string }) {
  const isRead = ann.readBy?.includes(userId);
  const meta = PRIORITY_META[ann.priority];
  const Icon = meta.icon;
  const publishedDate = toTs(ann.publishedAt);

  const handleMarkRead = async () => {
    if (isRead) return;
    await markAnnouncementRead(ann.id, userId);
  };

  return (
    <div
      className="rounded-2xl border p-5 transition-all"
      style={{ backgroundColor: meta.bg, borderColor: meta.border, opacity: isRead ? 0.7 : 1 }}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: meta.color + '20', color: meta.color }}>
          {ann.pinned ? <Pin size={16} /> : <Icon size={16} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>{ann.title}</p>
            {ann.pinned && (
              <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                Pinned
              </span>
            )}
            <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ backgroundColor: meta.color + '20', color: meta.color }}>
              {meta.label}
            </span>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: '#2A2A2A' }}>{ann.body}</p>
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-mute">
              {ann.publishedByName}
              {publishedDate ? ` · ${format(publishedDate, 'dd MMM yyyy')}` : ''}
            </p>
            {!isRead && (
              <button onClick={handleMarkRead}
                className="text-xs font-medium transition-opacity hover:opacity-70"
                style={{ color: meta.color }}>
                Mark as read
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AnnouncementsPage ────────────────────────────────────────────────────────

export function AnnouncementsPage() {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { announcements, loading } = useAnnouncements();

  // Load holidays for current + next year (handles Dec → Jan boundary)
  // Hooks called unconditionally per Rules of Hooks.
  const currentYear = new Date().getFullYear();
  const { holidays: thisYearHolidays } = useHolidays(currentYear);
  const { holidays: nextYearHolidays  } = useHolidays(currentYear + 1);

  const allHolidays = useMemo(
    () => [...thisYearHolidays, ...nextYearHolidays],
    [thisYearHolidays, nextYearHolidays],
  );

  // On page mount: mark holidays in the next 7 days as "seen" in localStorage.
  // This causes HrmsShell to drop the nav badge when the user next navigates.
  useEffect(() => {
    const today = new Date();
    allHolidays.forEach((h) => {
      const diff = differenceInCalendarDays(parseISO(h.date), today);
      if (diff >= 0 && diff <= 6) {
        try { localStorage.setItem(`holiday_seen_${h.date}`, '1'); }
        catch { /* localStorage unavailable — ignore */ }
      }
    });
  }, [allHolidays]);

  const pinned = announcements.filter((a) => a.pinned);
  const rest   = announcements.filter((a) => !a.pinned);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-3xl mb-1"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
          Announcements
        </h2>
        <p className="text-sm text-mute">Company-wide updates from HR and leadership.</p>
      </div>

      {/* ── Upcoming Holidays — always shown, zero Firestore writes ── */}
      <UpcomingHolidaysSection holidays={allHolidays} />

      {/* ── Admin announcements ── */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-24 bg-white border border-slate-200 rounded-2xl animate-pulse" />)}
        </div>
      ) : announcements.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
          <Megaphone size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-mute">No announcements yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pinned.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#475569' }}>Pinned</p>
              {pinned.map((a) => <AnnouncementCard key={a.id} ann={a} userId={uid} />)}
            </>
          )}
          {rest.length > 0 && (
            <>
              {pinned.length > 0 && (
                <p className="text-[10px] font-bold uppercase tracking-widest pt-2" style={{ color: '#475569' }}>All Announcements</p>
              )}
              {rest.map((a) => <AnnouncementCard key={a.id} ann={a} userId={uid} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
