/**
 * CRM 2.0 shared client helpers — API wrapper + live collection hook + perm check.
 * Reads go through the Firestore SDK (rule-gated); ALL mutations via /api/crm2/*.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { useAllEmployees } from '../../lib/hooks/useProfile';
import type { UserProfile } from '../../types';
import type { Crm2PermKey } from '../../types/crm2';

/**
 * Resolve a FAPL employee code (assignedRm / handlingRm / ownerRm / collaborators)
 * to the employee's display NAME. In CRM 2.0 people are stored as FAPL-### codes;
 * the UI should always show the name. Returns the code itself if the employee isn't
 * found (e.g. exited), and '—' for an empty value. Loads the (small) employee list.
 */
export function useRmName(): (fapl?: string | null) => string {
  const { employees } = useAllEmployees();
  const map = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) if (e.employeeId) m.set(e.employeeId, e.displayName);
    return m;
  }, [employees]);
  return useMemo(() => (fapl?: string | null): string => (fapl ? (map.get(fapl) ?? fapl) : '—'), [map]);
}

export async function apiCrm2<T = { ok: boolean; id?: string }>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = Array.isArray(data.details) ? `\n${data.details.join('\n')}` : '';
    throw new Error((data.error ?? `Request failed (HTTP ${res.status})`) + details);
  }
  return data as T;
}

/** Live subscription to a whole (small) master collection, sorted by doc id.
 *  Pass `enabled=false` to defer the listener until the data is actually needed
 *  (cuts mount-time Firestore contention on pages that only use it on a sub-view). */
export function useCrm2Collection<T extends { id: string }>(name: string, enabled = true) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    return onSnapshot(
      collection(db, name),
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)
          .sort((a, b) => a.id.localeCompare(b.id)));
        setLoading(false);
        setError('');
      },
      (e) => { setError(e.message); setLoading(false); },
    );
  }, [name, enabled]);

  return { rows, loading, error };
}

/** Client-side permission check (UI gating only — rules + API enforce for real).
 *  Platform admins implicitly hold every key. */
export function hasCrm2Perm(profile: UserProfile | null, key: Crm2PermKey): boolean {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  return (profile as UserProfile & { perms?: Record<string, boolean> }).perms?.[key] === true;
}
