import { useEffect, useState } from 'react';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import type { PresenceUser } from '../../../types';

const HEARTBEAT_MS = 30_000;       // lastSeen refresh interval
const STALE_AFTER_MS = 2 * 60_000; // viewers older than this are hidden

/**
 * Phase P — real-time presence on a page.
 * Writes /presence/{pageKey}/viewers/{uid} on mount, heartbeats lastSeen every
 * 30s, deletes on unmount (+ best-effort beforeunload — STALENESS is the real
 * cleanup mechanism, which is why others are filtered CLIENT-SIDE to a 2-minute
 * lastSeen window on every render tick rather than via a query cutoff that
 * would go stale inside onSnapshot).
 *
 * Returns the OTHER live viewers (self excluded).
 */
export function usePresence(pageKey: string | null): PresenceUser[] {
  const { user, profile } = useAuth();
  const [viewers, setViewers] = useState<PresenceUser[]>([]);
  // Ticks every heartbeat so the staleness filter re-evaluates even when no
  // snapshot arrives (e.g. a viewer silently disappears).
  const [, setTick] = useState(0);

  const uid = user?.uid ?? null;
  const displayName = profile?.displayName ?? '';

  // ── My own viewer doc + heartbeat ──────────────────────────────────────────
  useEffect(() => {
    if (!pageKey || !uid) return;
    const ref = doc(db, 'presence', pageKey, 'viewers', uid);
    const initials = displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?';

    const write = (entered: boolean) => setDoc(ref, {
      uid,
      displayName,
      avatarInitials: initials,
      ...(entered ? { enteredAt: serverTimestamp() } : {}),
      lastSeen: serverTimestamp(),
      pageKey,
    }, { merge: true }).catch(() => {});

    write(true);
    const hb = setInterval(() => write(false), HEARTBEAT_MS);

    const cleanup = () => { deleteDoc(ref).catch(() => {}); };
    window.addEventListener('beforeunload', cleanup);

    return () => {
      clearInterval(hb);
      window.removeEventListener('beforeunload', cleanup);
      cleanup();
    };
  }, [pageKey, uid, displayName]);

  // ── Other viewers ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pageKey || !uid) { setViewers([]); return; }
    const unsub = onSnapshot(collection(db, 'presence', pageKey, 'viewers'), (snap) => {
      setViewers(snap.docs.map((d) => d.data() as PresenceUser).filter((v) => v.uid !== uid));
    }, () => setViewers([]));
    const tick = setInterval(() => setTick((t) => t + 1), HEARTBEAT_MS);
    return () => { unsub(); clearInterval(tick); };
  }, [pageKey, uid]);

  const cutoff = Date.now() - STALE_AFTER_MS;
  return viewers.filter((v) => {
    const ms = v.lastSeen?.toMillis?.();
    return ms != null && ms >= cutoff;
  });
}
