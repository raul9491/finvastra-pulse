import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, deleteDoc, doc, getDocs, limit, writeBatch,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { Holiday } from '../../../types';

// ─── useHolidays ──────────────────────────────────────────────────────────────
// Real-time subscription to holidays for a given year, ordered by date.
export function useHolidays(year: number): { holidays: Holiday[]; loading: boolean } {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'holidays'),
      where('year', '==', year),
      orderBy('date', 'asc'),
    );

    return onSnapshot(q, (snap) => {
      setHolidays(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Holiday)));
      setLoading(false);
    });
  }, [year]);

  return { holidays, loading };
}

// ─── addHoliday ───────────────────────────────────────────────────────────────
// Admin only — caller is responsible for access guarding before calling this.
export async function addHoliday(holiday: Omit<Holiday, 'id'>): Promise<void> {
  await addDoc(collection(db, 'holidays'), holiday);
}

// ─── deleteHoliday ────────────────────────────────────────────────────────────
export async function deleteHoliday(id: string): Promise<void> {
  await deleteDoc(doc(db, 'holidays', id));
}

// Official Finvastra 2026 holiday calendar (Hyderabad)
// Keep in sync with scripts/seed/syncHolidays2026.ts — run `npm run sync:holidays` after editing.
const HOLIDAYS_2026: Omit<Holiday, 'id'>[] = [
  { date: '2026-01-26', name: 'Republic Day',              type: 'national', year: 2026 },
  { date: '2026-02-26', name: 'Maha Shivaratri',           type: 'national', year: 2026 },
  { date: '2026-03-14', name: 'Holi',                      type: 'national', year: 2026 },
  { date: '2026-03-19', name: 'Ugadi',                     type: 'regional', year: 2026 },
  { date: '2026-03-31', name: 'Eid ul-Fitr',               type: 'national', year: 2026 },
  { date: '2026-04-03', name: 'Good Friday',               type: 'national', year: 2026 },
  { date: '2026-04-14', name: 'Ambedkar Jayanti',          type: 'national', year: 2026 },
  { date: '2026-04-22', name: 'Ram Navami',                type: 'national', year: 2026 },
  { date: '2026-05-28', name: 'Bakrid (Eid ul-Adha)',      type: 'national', year: 2026 },
  { date: '2026-08-15', name: 'Independence Day',          type: 'national', year: 2026 },
  { date: '2026-08-23', name: 'Ganesh Chaturthi',          type: 'regional', year: 2026 },
  { date: '2026-10-02', name: 'Gandhi Jayanti',            type: 'national', year: 2026 },
  { date: '2026-10-20', name: 'Dussehra (Vijaya Dashami)', type: 'national', year: 2026 },
  { date: '2026-11-08', name: 'Diwali',                    type: 'national', year: 2026 },
  { date: '2026-12-25', name: 'Christmas',                 type: 'national', year: 2026 },
];

// ─── seedHolidays2026 ─────────────────────────────────────────────────────────
// Idempotent: checks for existing 2026 records before seeding. Safe to call on
// every admin mount — it's a no-op after the first run.
export async function seedHolidays2026(): Promise<void> {
  const existing = await getDocs(
    query(collection(db, 'holidays'), where('year', '==', 2026), limit(1)),
  );
  if (!existing.empty) return;

  for (const h of HOLIDAYS_2026) {
    await addDoc(collection(db, 'holidays'), h);
  }
}

// ─── resetHolidays2026 ────────────────────────────────────────────────────────
// Admin action: deletes all existing 2026 holidays and re-seeds from the
// official Finvastra calendar. Used when seed data has changed.
export async function resetHolidays2026(): Promise<void> {
  const existing = await getDocs(
    query(collection(db, 'holidays'), where('year', '==', 2026)),
  );
  const batch = writeBatch(db);
  existing.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();

  for (const h of HOLIDAYS_2026) {
    await addDoc(collection(db, 'holidays'), h);
  }
}
