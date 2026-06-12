/**
 * NotificationBell — in-app notification dropdown for CRM and HRMS shells.
 *
 * Subscribes to /notifications/{uid}/items (newest 20).
 * Bell badge = unread count.
 * Click → dropdown with notification list.
 * Click item → mark read + navigate to link.
 * "Mark all read" button clears the badge.
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection, query, orderBy, limit, onSnapshot,
  updateDoc, doc, writeBatch,
} from 'firebase/firestore';
import { Bell, CheckCheck, ArrowRight, Inbox } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { db } from '../../lib/firebase';
import type { AppNotification } from '../../lib/notifications';

// ─── Icons per notification type ──────────────────────────────────────────────

const TYPE_META: Record<AppNotification['type'], { icon: string; color: string }> = {
  new_lead:         { icon: '👤', color: '#60a5fa' },
  leave_approved:   { icon: '✅', color: '#34d399' },
  leave_rejected:   { icon: '❌', color: '#f87171' },
  claim_approved:   { icon: '✅', color: '#34d399' },
  claim_rejected:   { icon: '❌', color: '#f87171' },
  claim_paid:       { icon: '💰', color: '#C9A961' },
  it_decl_revision: { icon: '✏️', color: '#fbbf24' },
  it_decl_accepted: { icon: '✅', color: '#34d399' },
  follow_up_needed: { icon: '⏰', color: '#fbbf24' },
  // Phase P
  share_granted:    { icon: '🔗', color: '#C9A961' },
  share_revoked:    { icon: '🔒', color: '#f87171' },
  dispute_created:  { icon: '⚠️', color: '#f87171' },
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

function useNotifications(uid: string) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    const q = query(
      collection(db, 'notifications', uid, 'items'),
      orderBy('createdAt', 'desc'),
      limit(20),
    );
    return onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AppNotification));
      setLoading(false);
    }, () => setLoading(false));
  }, [uid]);

  const unreadCount = items.filter((n) => !n.read).length;

  const markRead = (notifId: string) =>
    updateDoc(doc(db, 'notifications', uid, 'items', notifId), { read: true }).catch(() => {});

  const markAllRead = () => {
    const unread = items.filter((n) => !n.read);
    if (!unread.length) return;
    const batch = writeBatch(db);
    unread.forEach((n) => batch.update(doc(db, 'notifications', uid, 'items', n.id), { read: true }));
    batch.commit().catch(() => {});
  };

  return { items, unreadCount, loading, markRead, markAllRead };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NotificationBell({ uid }: { uid: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { items, unreadCount, loading, markRead, markAllRead } = useNotifications(uid);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleItemClick = (n: AppNotification) => {
    if (!n.read) markRead(n.id);
    if (n.link) navigate(n.link);
    setOpen(false);
  };

  function formatTime(ts: unknown): string {
    try {
      const date = typeof (ts as { toDate?: () => Date }).toDate === 'function'
        ? (ts as { toDate: () => Date }).toDate()
        : new Date(ts as string);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return '';
    }
  }

  return (
    <div className="relative" ref={ref}>
      {/* Bell button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-(--shell-hover-hard)"
        title="Notifications"
        aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ''}`}
      >
        <Bell size={18} style={{ color: 'var(--shell-text-icon)' }} />
        {unreadCount > 0 && (
          <span
            className="absolute top-1 right-1 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center leading-none"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        // Mobile: fixed sheet below the header (the absolute-anchored panel used
        // to hang off-screen left). Solid --ss-bg so page content never bleeds
        // through (the translucent glass panel was hard to read over text).
        <div
          className="fixed inset-x-3 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 z-50 overflow-hidden glass-modal-panel"
          style={{ backgroundColor: 'var(--ss-bg)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}
        >

          {/* Header */}
          <div className="glass-modal-header flex items-center justify-between px-4 py-3">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
                style={{ color: '#C9A961' }}
              >
                <CheckCheck size={13} />
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[360px] overflow-y-auto">
            {loading ? (
              <div className="space-y-2 p-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-12 rounded-xl animate-pulse"
                    style={{ backgroundColor: 'var(--glass-panel-bg)' }}
                  />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Inbox size={28} style={{ color: 'rgba(201,169,97,0.40)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--shell-text-dim)' }}>
                  No notifications yet
                </p>
              </div>
            ) : (
              items.map((n) => {
                const meta = TYPE_META[n.type] ?? { icon: '🔔', color: 'var(--shell-text-secondary)' };
                return (
                  <button
                    key={n.id}
                    onClick={() => handleItemClick(n)}
                    className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors nav-item-hover"
                    style={{
                      backgroundColor: n.read ? 'transparent' : 'rgba(201,169,97,0.06)',
                      borderBottom:    '1px solid var(--shell-border)',
                    }}
                  >
                    <span className="text-base mt-0.5 shrink-0">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-semibold leading-snug truncate"
                        style={{ color: n.read ? 'var(--shell-text-secondary)' : 'var(--text-primary)' }}
                      >
                        {n.title}
                      </p>
                      <p className="text-xs leading-snug mt-0.5" style={{ color: 'var(--shell-text-secondary)' }}>
                        {n.body}
                      </p>
                      <p className="text-[10px] mt-1" style={{ color: 'var(--shell-text-dim)' }}>
                        {formatTime(n.createdAt)}
                      </p>
                    </div>
                    {n.link && (
                      <ArrowRight
                        size={14}
                        className="shrink-0 mt-1"
                        style={{ color: 'rgba(201,169,97,0.50)' }}
                      />
                    )}
                    {!n.read && (
                      <span
                        className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                        style={{ backgroundColor: '#C9A961' }}
                      />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
