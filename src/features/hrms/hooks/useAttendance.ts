import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  getDoc,
  doc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '../../../lib/firebase';
import type { Attendance, AttendanceStatus } from '../../../types';

// ─── useMyAttendance ──────────────────────────────────────────────────────────
// Real-time subscription to the current user's attendance for a given month.
// month: 'YYYY-MM'
export function useMyAttendance(
  userId: string,
  month: string,
): { records: Attendance[]; loading: boolean } {
  const [records, setRecords] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId || !month) return;

    // Date range for the month — use the full calendar range so partial months
    // at the boundaries of the ISO string sort correctly.
    const startDate = `${month}-01`;
    const endDate = `${month}-31`; // strings past the last day sort fine with >=/<= on YYYY-MM-DD

    const q = query(
      collection(db, 'attendance'),
      where('userId', '==', userId),
      where('date', '>=', startDate),
      where('date', '<=', endDate),
      orderBy('date', 'asc'),
    );

    return onSnapshot(q, (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Attendance)));
      setLoading(false);
    });
  }, [userId, month]);

  return { records, loading };
}

// ─── useTodayAttendance ───────────────────────────────────────────────────────
// Real-time subscription to today's attendance record for the given user.
// Returns null when no record exists yet.
export function useTodayAttendance(userId: string): {
  record: Attendance | null;
  loading: boolean;
} {
  const [record, setRecord] = useState<Attendance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const today = format(new Date(), 'yyyy-MM-dd');

    const q = query(
      collection(db, 'attendance'),
      where('userId', '==', userId),
      where('date', '==', today),
    );

    return onSnapshot(q, (snap) => {
      setRecord(snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as Attendance));
      setLoading(false);
    });
  }, [userId]);

  return { record, loading };
}

// ─── checkIn ─────────────────────────────────────────────────────────────────
// Creates a new attendance record with checkIn timestamp.
export async function checkIn(userId: string): Promise<void> {
  await addDoc(collection(db, 'attendance'), {
    userId,
    date: format(new Date(), 'yyyy-MM-dd'),
    checkIn: serverTimestamp(),
    checkOut: null,
    workingHours: 0,
    status: 'present' as AttendanceStatus,
    markedBy: 'self' as const,
    notes: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ─── checkOut ────────────────────────────────────────────────────────────────
// Writes checkOut as serverTimestamp, then reads the committed value back to
// compute workingHours from server time — avoids client clock drift.
export async function checkOut(recordId: string, checkInTime: Date): Promise<void> {
  const ref = doc(db, 'attendance', recordId);
  try {
    await updateDoc(ref, {
      checkOut:  serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const snap = await getDoc(ref);
    if (snap.exists()) {
      const checkOutTs = snap.data().checkOut as Timestamp | null;
      if (checkOutTs?.toDate) {
        const workingHours = (checkOutTs.toDate().getTime() - checkInTime.getTime()) / (1000 * 60 * 60);
        const roundedHours = Math.round(workingHours * 100) / 100;
        const status: AttendanceStatus = roundedHours < 4 ? 'half_day' : 'present';
        await updateDoc(ref, { workingHours: roundedHours, status });
      }
    }
  } catch (err) {
    console.error('[useAttendance] checkOut failed:', err);
    throw new Error('Check-out failed — please try again');
  }
}

// ─── adminMarkAttendance ──────────────────────────────────────────────────────
// Admin / manager override: create or update an attendance record for any user
// on any date, setting status and optional notes.
export async function adminMarkAttendance(
  recordId: string | null,
  userId: string,
  date: string,
  status: AttendanceStatus,
  notes: string,
): Promise<void> {
  if (recordId) {
    await updateDoc(doc(db, 'attendance', recordId), {
      status,
      notes,
      markedBy: 'admin' as const,
      updatedAt: serverTimestamp(),
    });
  } else {
    await addDoc(collection(db, 'attendance'), {
      userId,
      date,
      checkIn: null,
      checkOut: null,
      workingHours: 0,
      status,
      markedBy: 'admin' as const,
      notes,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

// ─── useTeamAttendance ────────────────────────────────────────────────────────
// Real-time subscription to all attendance records for a given date.
// Used by the admin view to see the full team's status.
export function useTeamAttendance(date: string): {
  records: Attendance[];
  loading: boolean;
} {
  const [records, setRecords] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!date) return;

    const q = query(
      collection(db, 'attendance'),
      where('date', '==', date),
    );

    return onSnapshot(q, (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Attendance)));
      setLoading(false);
    });
  }, [date]);

  return { records, loading };
}
