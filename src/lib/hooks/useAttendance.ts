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
} from 'firebase/firestore';
import { format } from 'date-fns';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { Attendance } from '../../types';

// ─── Hook: Today's attendance record ─────────────────────────────────────────
export function useTodayAttendance(userId: string | null) {
  const [record, setRecord] = useState<Attendance | null>(null);

  useEffect(() => {
    if (!userId) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    const q = query(
      collection(db, 'attendance'),
      where('userId', '==', userId),
      where('date', '==', today),
      limit(1)
    );

    return onSnapshot(q, (snap) => {
      if (!snap.empty) {
        setRecord({ id: snap.docs[0].id, ...snap.docs[0].data() } as Attendance);
      } else {
        setRecord(null);
      }
    });
  }, [userId]);

  return record;
}

// ─── Hook: Recent attendance logs ─────────────────────────────────────────────
export function useAttendanceLogs(userId: string | null, count = 5) {
  const [logs, setLogs] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, 'attendance'),
      where('userId', '==', userId),
      orderBy('date', 'desc'),
      limit(count)
    );

    return onSnapshot(
      q,
      (snap) => {
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Attendance)));
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'attendance');
      }
    );
  }, [userId, count]);

  return { logs, loading };
}

// ─── Hook: Full attendance history ────────────────────────────────────────────
export function useAttendanceHistory(userId: string | null, count = 30) {
  const [logs, setLogs] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, 'attendance'),
      where('userId', '==', userId),
      orderBy('checkIn', 'desc'),
      limit(count)
    );

    return onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Attendance)));
      setLoading(false);
    });
  }, [userId, count]);

  return { logs, loading };
}

// ─── Clock-in / Clock-out action ─────────────────────────────────────────────
export async function clockAction(
  userId: string,
  todayRecord: Attendance | null
): Promise<void> {
  const now = new Date().toISOString();
  const today = format(new Date(), 'yyyy-MM-dd');

  if (!todayRecord) {
    await addDoc(collection(db, 'attendance'), {
      userId,
      checkIn: now,
      date: today,
      status: 'present',
    });
  } else if (!todayRecord.checkOut) {
    const checkInMs = todayRecord.checkIn
      ? todayRecord.checkIn.toDate().getTime()
      : Date.now();
    const duration = (Date.now() - checkInMs) / (1000 * 60 * 60);
    await updateDoc(doc(db, 'attendance', todayRecord.id), {
      checkOut: now,
      workingHours: parseFloat(duration.toFixed(2)),
    });
  }
}

// ─── Hook: Admin — global attendance (today) ─────────────────────────────────
export function useGlobalAttendanceToday() {
  const [records, setRecords] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const q = query(
      collection(db, 'attendance'),
      where('date', '==', today),
      limit(100)
    );

    return onSnapshot(q, (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Attendance)));
      setLoading(false);
    });
  }, []);

  return { records, loading };
}
