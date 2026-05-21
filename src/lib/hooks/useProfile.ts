import { useState, useEffect } from 'react';
import {
  doc,
  updateDoc,
  collection,
  query,
  onSnapshot,
  limit,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { UserProfile } from '../../types';

// ─── Update profile fields ────────────────────────────────────────────────────
export async function updateProfile(
  userId: string,
  fields: Partial<Pick<UserProfile, 'displayName' | 'photoURL' | 'phone' | 'location' | 'department' | 'designation' | 'dateOfBirth'>>
): Promise<void> {
  await updateDoc(doc(db, 'users', userId), fields);
}

// ─── Hook: useAllEmployees ────────────────────────────────────────────────────
export function useAllEmployees(): { employees: UserProfile[]; loading: boolean } {
  const [employees, setEmployees] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'users'), limit(200));
    return onSnapshot(q, (snap) => {
      setEmployees(snap.docs.map((d) => d.data() as UserProfile));
      setLoading(false);
    });
  }, []);

  return { employees, loading };
}

// ─── Hook: useLiveProfile ─────────────────────────────────────────────────────
export function useLiveProfile(userId: string | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!userId) return;
    const q = query(collection(db, 'users'), limit(1));
    // live subscription to own doc
    const ref = doc(db, 'users', userId);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) setProfile(snap.data() as UserProfile);
    });
    return unsub;
  }, [userId]);

  return profile;
}
