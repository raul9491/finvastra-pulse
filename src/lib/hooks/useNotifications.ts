import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Notification, NotificationType } from '../../types';

// ─── Hook: My notifications ───────────────────────────────────────────────────
export function useNotifications(userId: string | null) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Notification));
      setNotifications(list);
      setUnreadCount(list.filter((n) => !n.isRead).length);
      setLoading(false);
    });
  }, [userId]);

  return { notifications, unreadCount, loading };
}

// ─── Mark notification as read ────────────────────────────────────────────────
export async function markAsRead(notificationId: string): Promise<void> {
  await updateDoc(doc(db, 'notifications', notificationId), { isRead: true });
}

// ─── Mark all as read ─────────────────────────────────────────────────────────
export async function markAllAsRead(userId: string): Promise<void> {
  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    where('isRead', '==', false)
  );
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(d.ref, { isRead: true }));
  await batch.commit();
}

// ─── Send a notification ──────────────────────────────────────────────────────
export async function sendNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  await addDoc(collection(db, 'notifications'), {
    ...params,
    isRead: false,
    createdAt: serverTimestamp(),
  });
}
