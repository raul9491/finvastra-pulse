/**
 * The dashboard's banner strips: upcoming holidays and active announcements.
 * 
 * Extracted verbatim from HrmsDashboardPage.tsx (2026-07-23).
 */
import { parseISO, differenceInCalendarDays } from 'date-fns';
import { X, AlertTriangle, Megaphone, Pin } from 'lucide-react';
import { markAnnouncementRead } from '../hooks/useAnnouncements';
import type { Announcement } from '../../../types';
import { useState, useEffect } from 'react';
import { format } from 'date-fns';

// ─── Holiday Banner ───────────────────────────────────────────────────────────
// Shows for ALL employees when a public holiday is within 3 calendar days.
// Pure date logic — no admin action needed. Dismiss per-holiday per-day via localStorage.

export function HolidayBanner({ holidays }: { holidays: Array<{ id: string; date: string; name: string }> }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Read dismissal flags from localStorage whenever the holidays list changes
  useEffect(() => {
    if (holidays.length === 0) return;
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    const dis = new Set<string>();
    try {
      for (const h of holidays) {
        if (localStorage.getItem(`dismissed_holiday_${h.date}_${todayKey}`)) {
          dis.add(h.date);
        }
      }
    } catch { /* localStorage unavailable */ }
    setDismissed(dis);
  }, [holidays]);

  const today = new Date();
  const imminent = holidays
    .map((h) => ({ ...h, daysUntil: differenceInCalendarDays(parseISO(h.date), today) }))
    .filter(({ daysUntil, date }) => daysUntil >= 0 && daysUntil <= 3 && !dismissed.has(date))
    .sort((a, b) => a.daysUntil - b.daysUntil);

  if (imminent.length === 0) return null;

  function dismiss(date: string) {
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    try { localStorage.setItem(`dismissed_holiday_${date}_${todayKey}`, '1'); } catch { /* storage unavailable */ }
    setDismissed((prev) => new Set([...prev, date]));
  }

  return (
    <div className="space-y-3 mb-6">
      {imminent.map(({ id, date, name, daysUntil }) => {
        const hDate = parseISO(date);

        const pill =
          daysUntil === 0
            ? { bg: '#FEE2E2', color: '#991B1B', label: 'Today' }
            : daysUntil === 1
            ? { bg: '#FEF3C7', color: '#92400E', label: 'Tomorrow' }
            : { bg: 'rgba(201,169,97,0.15)', color: '#9A7E3F', label: `In ${daysUntil} days` };

        const subtext =
          daysUntil === 0
            ? `Today — Office closed. Wishing everyone a wonderful ${name}!`
            : daysUntil === 1
            ? `Tomorrow, ${format(hDate, 'EEE d MMM')} — Office closed.`
            : `This ${format(hDate, 'EEEE')}, ${format(hDate, 'd MMM')} — Office closed.`;

        return (
          <div
            key={id}
            className="flex items-center gap-4 rounded-xl px-5 py-4"
            style={{
              backgroundColor: 'rgba(201,169,97,0.08)',
              border: '1px solid rgba(201,169,97,0.3)',
              borderLeftWidth: '4px',
              borderLeftColor: '#C9A961',
            }}
          >
            <span className="text-2xl shrink-0 select-none" aria-hidden>🎉</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: '#C9A961' }}>{name}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtext}</p>
            </div>
            <span
              className="text-xs font-bold px-2.5 py-1 rounded-full shrink-0"
              style={{ backgroundColor: pill.bg, color: pill.color }}
            >
              {pill.label}
            </span>
            <button
              onClick={() => dismiss(date)}
              className="shrink-0 p-1.5 rounded-lg hover:bg-black/5 transition-colors"
              title="Dismiss"
              aria-label={`Dismiss ${name} notification`}
            >
              <X size={14} style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Announcements Banner ─────────────────────────────────────────────────────

export function AnnouncementBanner({
  userId,
  announcements,
}: {
  userId: string;
  announcements: Announcement[];
}) {
  const unread = announcements.filter((a) => !(a.readBy ?? []).includes(userId));
  const pinned = unread.filter((a) => a.pinned || a.priority !== 'normal');

  if (pinned.length === 0) return null;

  const top = pinned[0];
  const isUrgent    = top.priority === 'urgent';
  const isImportant = top.priority === 'important';

  return (
    <div
      className="rounded-2xl border px-5 py-4 flex items-center gap-4 mb-6"
      style={{
        backgroundColor: isUrgent ? 'rgba(248,113,113,0.10)' : isImportant ? 'rgba(201,169,97,0.10)' : 'rgba(96,165,250,0.10)',
        borderColor:     isUrgent ? 'rgba(248,113,113,0.25)' : isImportant ? 'rgba(201,169,97,0.25)' : 'rgba(96,165,250,0.20)',
      }}
    >
      <div className="shrink-0">
        {isUrgent || isImportant ? (
          <AlertTriangle size={18} style={{ color: isUrgent ? '#f87171' : '#C9A961' }} />
        ) : (
          <Megaphone size={18} style={{ color: '#60a5fa' }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {top.pinned && <Pin size={12} style={{ color: '#C9A961' }} />}
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{top.title}</span>
          {unread.length > 1 && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>+{unread.length - 1} more</span>
          )}
        </div>
        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{top.body}</p>
      </div>
      <button
        onClick={() => markAnnouncementRead(top.id, userId)}
        className="p-1.5 rounded-lg hover:bg-(--shell-hover-mid) transition-colors shrink-0"
        title="Dismiss"
      >
        <X size={14} style={{ color: 'var(--text-muted)' }} />
      </button>
    </div>
  );
}
