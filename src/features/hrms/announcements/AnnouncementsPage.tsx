import { useEffect, useMemo } from 'react';
import { Megaphone, Pin, AlertTriangle, Info, CalendarDays } from 'lucide-react';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { useAuth } from '../../auth/AuthContext';
import { useAnnouncements, markAnnouncementRead } from '../hooks/useAnnouncements';
import { useHolidays } from '../hooks/useHolidays';
import type { Announcement, AnnouncementPriority, Holiday } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_META: Record<AnnouncementPriority, { label: string; bg: string; border: string; color: string; icon: typeof Info }> = {
  normal:    { label: 'Normal',    bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)', color: 'var(--text-muted)',  icon: Info },
  important: { label: 'Important', bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.25)',  color: '#fbbf24',            icon: AlertTriangle },
  urgent:    { label: 'Urgent',    bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.25)', color: '#f87171',            icon: AlertTriangle },
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
        backgroundColor: diff === 0 ? '#C9A961'
                       : isVeryClose ? 'rgba(251,191,36,0.20)'
                       : 'rgba(255,255,255,0.08)',
        color: diff === 0 ? '#0B1538'
             : isVeryClose ? '#fbbf24'
             : 'var(--text-muted)',
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
    <div
      className="rounded-2xl overflow-hidden"
      style={{ backgroundColor: 'rgba(201,169,97,0.06)', border: '1px solid rgba(201,169,97,0.20)' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-5 py-3"
        style={{ backgroundColor: 'rgba(201,169,97,0.10)', borderBottom: '1px solid rgba(201,169,97,0.20)' }}
      >
        <CalendarDays size={15} style={{ color: '#C9A961' }} />
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#C9A961' }}>
          Upcoming Holidays
        </p>
        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-muted)' }}>Next 30 days</span>
      </div>

      {/* Holiday rows */}
      <div>
        {upcoming.map((h) => (
          <div key={h.id} className="flex items-center gap-4 px-5 py-3" style={{ borderBottom: '1px solid rgba(201,169,97,0.08)' }}>
            <span className="text-lg" aria-hidden>🗓️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{h.name}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {format(parseISO(h.date), 'EEEE, dd MMM yyyy')}
                {h.type !== 'national' && (
                  <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#C9A961' }}>
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
  // For normal priority, use gold for the icon; others use their own color
  const iconColor = ann.priority === 'normal' ? '#C9A961' : meta.color;

  const handleMarkRead = async () => {
    if (isRead) return;
    await markAnnouncementRead(ann.id, userId);
  };

  return (
    <div
      className="rounded-2xl border p-5 transition-all"
      style={{
        backgroundColor: meta.bg,
        borderColor:     meta.border,
        opacity:         isRead ? 0.65 : 1,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${iconColor}20`, color: iconColor }}
        >
          {ann.pinned ? <Pin size={16} /> : <Icon size={16} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{ann.title}</p>
            {ann.pinned && (
              <span
                className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                style={{ backgroundColor: 'rgba(201,169,97,0.20)', color: '#C9A961' }}
              >
                Pinned
              </span>
            )}
            <span
              className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ backgroundColor: `${iconColor}20`, color: iconColor }}
            >
              {meta.label}
            </span>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{ann.body}</p>
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
              {ann.publishedByName}
              {publishedDate ? ` · ${format(publishedDate, 'dd MMM yyyy')}` : ''}
            </p>
            {!isRead && (
              <button
                onClick={handleMarkRead}
                className="text-xs font-medium transition-opacity hover:opacity-70"
                style={{ color: '#C9A961' }}
              >
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
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          Announcements
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Company-wide updates from HR and leadership.</p>
      </div>

      {/* ── Upcoming Holidays — always shown, zero Firestore writes ── */}
      <UpcomingHolidaysSection holidays={allHolidays} />

      {/* ── Admin announcements ── */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-24 glass-panel rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 text-center">
          <Megaphone size={40} className="mx-auto mb-3" style={{ color: 'rgba(201,169,97,0.30)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No announcements yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pinned.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Pinned</p>
              {pinned.map((a) => <AnnouncementCard key={a.id} ann={a} userId={uid} />)}
            </>
          )}
          {rest.length > 0 && (
            <>
              {pinned.length > 0 && (
                <p className="text-[10px] font-bold uppercase tracking-widest pt-2" style={{ color: 'var(--text-muted)' }}>All Announcements</p>
              )}
              {rest.map((a) => <AnnouncementCard key={a.id} ann={a} userId={uid} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
