import { useState, useEffect } from 'react';
import {
  collection, query, where, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { db } from '../../../lib/firebase';
import type { Announcement, AnnouncementPriority, Holiday } from '../../../types';

// ─── Live announcements (for employees) ──────────────────────────────────────
// NOTE: We intentionally omit orderBy('publishedAt') here so we only need the
// auto-created single-field index on 'isActive' (composite indexes can take
// time to build after first deploy and fail silently).  Sorting is done
// client-side — the collection is small enough that this is negligible.

function tsMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof (ts as { toMillis?: unknown }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export function useAnnouncements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'announcements'),
      where('isActive', '==', true),
    );
    return onSnapshot(q, (snap) => {
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Announcement)
        // Sort descending by publishedAt client-side (avoids composite index)
        .sort((a, b) => tsMillis(b.publishedAt) - tsMillis(a.publishedAt));
      setAnnouncements(docs);
      setLoading(false);
    }, (err) => {
      console.error('[useAnnouncements] query failed:', err.code, err.message);
      setLoading(false);
    });
  }, []);

  return { announcements, loading };
}

// ─── All announcements (for admin) ───────────────────────────────────────────

export function useAllAnnouncements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // No composite index needed — fetch all and sort client-side
    return onSnapshot(collection(db, 'announcements'), (snap) => {
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Announcement)
        .sort((a, b) => tsMillis(b.publishedAt) - tsMillis(a.publishedAt));
      setAnnouncements(docs);
      setLoading(false);
    }, (err) => {
      console.error('[useAllAnnouncements] query failed:', err.code, err.message);
      setLoading(false);
    });
  }, []);

  return { announcements, loading };
}

// ─── Unread count (for nav badge) ────────────────────────────────────────────
// Counts active, non-expired announcements not yet read by this user.

export function useUnreadAnnouncementCount(userId: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, 'announcements'),
      where('isActive', '==', true),
    );
    return onSnapshot(q, (snap) => {
      const now = new Date();
      setCount(
        snap.docs.filter((d) => {
          const data = d.data();
          const readBy: string[] = data.readBy ?? [];
          if (readBy.includes(userId)) return false;
          // Exclude expired announcements from the badge count
          if (data.expiresAt) {
            try {
              if (data.expiresAt.toDate() <= now) return false;
            } catch { /* if toDate() fails treat as non-expired */ }
          }
          return true;
        }).length,
      );
    }, () => setCount(0));
  }, [userId]);

  return count;
}

// ─── Mark read ────────────────────────────────────────────────────────────────

export async function markAnnouncementRead(announcementId: string, userId: string) {
  await updateDoc(doc(db, 'announcements', announcementId), {
    readBy: arrayUnion(userId),
  });
}

// ─── Admin: create / toggle ───────────────────────────────────────────────────

export async function createAnnouncement(params: {
  title: string;
  body: string;
  priority: AnnouncementPriority;
  pinned: boolean;
  expiresAt: Date | null;
  publishedBy: string;
  publishedByName: string;
}) {
  await addDoc(collection(db, 'announcements'), {
    ...params,
    expiresAt: params.expiresAt
      ? serverTimestamp() // placeholder; caller should convert
      : null,
    publishedAt: serverTimestamp(),
    isActive: true,
    readBy: [],
  });
}

export async function toggleAnnouncementActive(id: string, isActive: boolean) {
  await updateDoc(doc(db, 'announcements', id), { isActive });
}

export async function updateAnnouncementPinned(id: string, pinned: boolean) {
  await updateDoc(doc(db, 'announcements', id), { pinned });
}

// ─── Unseen holiday count (for nav badge) ────────────────────────────────────
// Returns the number of holidays in the next 0–6 days that have not been marked
// seen in localStorage (key set when the user opens AnnouncementsPage).
// Pure synchronous function — safe to call on every render.
export function getUnseenHolidayCount(holidays: Holiday[]): number {
  const today = new Date();
  return holidays.filter((h) => {
    const diff = differenceInCalendarDays(parseISO(h.date), today);
    if (diff < 0 || diff > 6) return false;
    try { return !localStorage.getItem(`holiday_seen_${h.date}`); }
    catch { return false; }
  }).length;
}
