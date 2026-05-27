/**
 * useGeneratedLetters — hooks for reading /generated_letters documents.
 *
 * useMyLetters(employeeId) — reads letters for a single employee (employee self-service).
 * useAllLetters()          — reads all letters across all employees (HR admin view).
 *
 * Both return results sorted newest-first.
 */

import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { GeneratedLetter } from '../../../types';

export function useMyLetters(
  employeeId: string | undefined,
): { letters: GeneratedLetter[]; loading: boolean } {
  const [letters, setLetters] = useState<GeneratedLetter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employeeId) {
      setLoading(false);
      return;
    }
    // Single-field where clause — no composite index required.
    // Sort newest-first in memory to avoid adding a compound index.
    const q = query(
      collection(db, 'generated_letters'),
      where('employeeId', '==', employeeId),
    );
    return onSnapshot(
      q,
      (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as GeneratedLetter));
        all.sort((a, b) => {
          const aTs = a.generatedAt?.seconds ?? 0;
          const bTs = b.generatedAt?.seconds ?? 0;
          return bTs - aTs;
        });
        setLetters(all);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [employeeId]);

  return { letters, loading };
}

export function useAllLetters(): { letters: GeneratedLetter[]; loading: boolean } {
  const [letters, setLetters] = useState<GeneratedLetter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'generated_letters'),
      orderBy('generatedAt', 'desc'),
    );
    return onSnapshot(
      q,
      (snap) => {
        setLetters(snap.docs.map((d) => ({ id: d.id, ...d.data() } as GeneratedLetter)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  return { letters, loading };
}
