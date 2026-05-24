import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { Announcement, AnnouncementPriority } from '../../../types';

// ─── Live announcements (for employees) ──────────────────────────────────────

export function useAnnouncements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'announcements'),
      where('isActive', '==', true),
      orderBy('publishedAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setAnnouncements(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Announcement));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  return { announcements, loading };
}

// ─── All announcements (for admin) ───────────────────────────────────────────

export function useAllAnnouncements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'announcements'), orderBy('publishedAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setAnnouncements(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Announcement));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  return { announcements, loading };
}

// ─── Unread count (for nav badge) ────────────────────────────────────────────

export function useUnreadAnnouncementCount(userId: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, 'announcements'),
      where('isActive', '==', true),
    );
    return onSnapshot(q, (snap) => {
      setCount(
        snap.docs.filter((d) => {
          const readBy: string[] = d.data().readBy ?? [];
          return !readBy.includes(userId);
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
