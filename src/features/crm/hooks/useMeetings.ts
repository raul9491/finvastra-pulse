import { useEffect, useState } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../../lib/firebase';
import type { CrmMeeting } from '../../../types';

/** Live meetings scheduled against one lead (newest first). */
export function useLeadMeetings(leadId: string | null) {
  const [meetings, setMeetings] = useState<CrmMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leadId) { setMeetings([]); setLoading(false); return; }
    const q = query(
      collection(db, 'crm_meetings'),
      where('leadId', '==', leadId),
      orderBy('startAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setMeetings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CrmMeeting)));
      setLoading(false);
    }, () => setLoading(false));
  }, [leadId]);

  return { meetings, loading };
}

/** Live meetings the given RM owns (soonest first). */
export function useMyMeetings(uid: string | null) {
  const [meetings, setMeetings] = useState<CrmMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setMeetings([]); setLoading(false); return; }
    const q = query(
      collection(db, 'crm_meetings'),
      where('ownerId', '==', uid),
      orderBy('startAt', 'asc'),
    );
    return onSnapshot(q, (snap) => {
      setMeetings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CrmMeeting)));
      setLoading(false);
    }, () => setLoading(false));
  }, [uid]);

  return { meetings, loading };
}

export interface ScheduleMeetingInput {
  leadId: string;
  title?: string;
  startAt: string;          // ISO
  durationMins?: number;
  location?: string;
  notes?: string;
}

async function authedFetch(url: string, method: string, body?: unknown) {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status})`);
  return data;
}

/** Schedule a meeting → server writes the doc + inserts the RM's calendar event. */
export function scheduleMeeting(input: ScheduleMeetingInput): Promise<{ ok: boolean; id: string; calendarSyncStatus: string }> {
  return authedFetch('/api/crm/meetings', 'POST', input);
}

/** Reschedule / mark done / cancel a meeting (server mirrors the calendar event). */
export function updateMeeting(
  id: string,
  patch: { startAt?: string; durationMins?: number; status?: 'scheduled' | 'done' | 'cancelled'; location?: string; notes?: string },
): Promise<{ ok: boolean }> {
  return authedFetch(`/api/crm/meetings/${id}`, 'PATCH', patch);
}
