import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { Lead } from '../../../types';

const WINDOW_MS = 15 * 60 * 1000;       // surface a callback 15 min before its time
const DISMISS_PREFIX = 'cb_dismissed_'; // localStorage key per lead+time (per device)

function dismissKey(leadId: string, cbMs: number) {
  return `${DISMISS_PREFIX}${leadId}_${cbMs}`;
}

/**
 * Live, persistent callback reminders for the signed-in owner.
 *
 * Returns the owner's leads whose scheduled `callbackAt` is within the next 15 min
 * (or already overdue) and NOT yet dismissed. Re-evaluates every 30s so a card
 * appears right on the 15-min mark and the countdown stays fresh. Dismissals are
 * stored per lead+callback-time in localStorage, so a card stays gone once X'd but
 * a NEW/changed callback time shows again.
 *
 * Scoped tightly (primaryOwnerId == uid AND leadStatus == 'callback') so only the
 * handful of callback leads are fetched — not the owner's whole book.
 */
export function useCallbackReminders(uid: string) {
  const [raw, setRaw] = useState<Lead[]>([]);
  const [tick, setTick] = useState(0);   // forces re-eval of the time window

  useEffect(() => {
    if (!uid) { setRaw([]); return; }
    const q = query(
      collection(db, 'leads'),
      where('primaryOwnerId', '==', uid),
      where('leadStatus', '==', 'callback'),
    );
    return onSnapshot(
      q,
      (snap) => setRaw(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead))),
      () => setRaw([]),   // permission/index error → just show nothing
    );
  }, [uid]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const due = useMemo(() => {
    void tick;                       // re-run on each 30s tick
    const now = Date.now();
    return raw
      .map((l) => {
        const cbMs = l.callbackAt ? new Date(l.callbackAt).getTime() : NaN;
        return { lead: l, cbMs };
      })
      .filter(({ lead, cbMs }) => {
        if (lead.deleted) return false;   // soft-deleted/RTBF leads must not keep reminding
        if (isNaN(cbMs)) return false;
        if (cbMs - now > WINDOW_MS) return false;                       // more than 15 min away
        if (localStorage.getItem(dismissKey(lead.id, cbMs))) return false; // dismissed
        return true;
      })
      .sort((a, b) => a.cbMs - b.cbMs)
      .map(({ lead }) => lead);
  }, [raw, tick]);

  const dismiss = useCallback((lead: Lead) => {
    const cbMs = lead.callbackAt ? new Date(lead.callbackAt).getTime() : NaN;
    if (!isNaN(cbMs)) localStorage.setItem(dismissKey(lead.id, cbMs), '1');
    setTick((x) => x + 1);
  }, []);

  return { due, dismiss };
}
