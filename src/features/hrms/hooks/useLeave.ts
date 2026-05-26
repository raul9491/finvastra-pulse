import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  setDoc,
  doc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { parseISO, eachDayOfInterval, format } from 'date-fns';
import { db, auth } from '../../../lib/firebase';
import type { LeaveApplication, LeaveBalance, LeaveType, Holiday } from '../../../types';

// ─── useMyLeaveBalance ────────────────────────────────────────────────────────
// Real-time subscription to /leave_balances/{userId} for the given year.
// The document id convention is `{userId}_{year}` to allow multiple years.
export function useMyLeaveBalance(
  userId: string,
  year: number,
): { balance: LeaveBalance | null; loading: boolean } {
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    // Document id: "{userId}_{year}" keeps balances per-year without a subcollection
    const docRef = doc(db, 'leave_balances', `${userId}_${year}`);
    return onSnapshot(docRef, (snap) => {
      setBalance(snap.exists() ? (snap.data() as LeaveBalance) : null);
      setLoading(false);
    });
  }, [userId, year]);

  return { balance, loading };
}

// ─── useMyApplications ────────────────────────────────────────────────────────
// Real-time subscription to leave applications for the given user, newest first.
export function useMyApplications(userId: string): {
  applications: LeaveApplication[];
  loading: boolean;
} {
  const [applications, setApplications] = useState<LeaveApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, 'leave_applications'),
      where('employeeId', '==', userId),
      orderBy('appliedAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setApplications(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeaveApplication)));
      setLoading(false);
    });
  }, [userId]);

  return { applications, loading };
}

// ─── usePendingApprovals ──────────────────────────────────────────────────────
// Real-time subscription to all pending leave applications, oldest first (FIFO).
export function usePendingApprovals(): {
  applications: LeaveApplication[];
  loading: boolean;
} {
  const [applications, setApplications] = useState<LeaveApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'leave_applications'),
      where('status', '==', 'pending'),
      orderBy('appliedAt', 'asc'),
    );
    return onSnapshot(q, (snap) => {
      setApplications(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeaveApplication)));
      setLoading(false);
    });
  }, []);

  return { applications, loading };
}

// ─── calculateWorkingDays ─────────────────────────────────────────────────────
// Pure function: counts weekdays in [fromDate, toDate] that are not in the
// provided holidays list. Returns 0 if toDate < fromDate.
export function calculateWorkingDays(
  fromDate: string,
  toDate: string,
  holidays: Holiday[],
): number {
  const start = parseISO(fromDate);
  const end = parseISO(toDate);
  if (end < start) return 0;
  const days = eachDayOfInterval({ start, end });
  const holidayDates = new Set(holidays.map((h) => h.date));
  // Mon–Sat is the Finvastra working week (HR Handbook). Only Sunday (getDay() === 0) is off.
  return days.filter((d) => d.getDay() !== 0 && !holidayDates.has(format(d, 'yyyy-MM-dd'))).length;
}

// ─── applyForLeave ────────────────────────────────────────────────────────────
// Writes a new leave_application document with server timestamp for appliedAt.
export async function applyForLeave(
  application: Omit<
    LeaveApplication,
    'id' | 'appliedAt' | 'approvedBy' | 'approvedAt' | 'rejectionReason' | 'calendarEventId'
  >,
): Promise<void> {
  await addDoc(collection(db, 'leave_applications'), {
    ...application,
    appliedAt: serverTimestamp(),
    approvedBy: null,
    approvedAt: null,
    rejectionReason: null,
    calendarEventId: null,
  });
}

// ─── approveLeave ─────────────────────────────────────────────────────────────
// 1. Marks the application approved in Firestore.
// 2. Deducts days from the employee's leave balance for the year.
// 3. Fire-and-forget call to the server endpoint to create a Google Calendar event.
// calendarTokens param is reserved for future direct-token flow; currently unused
// because the server endpoint uses the stored oauth2Client credentials.
export async function approveLeave(
  applicationId: string,
  approvedBy: string,
  _calendarTokens?: unknown,
): Promise<void> {
  const appRef = doc(db, 'leave_applications', applicationId);
  const appSnap = await getDoc(appRef);
  if (!appSnap.exists()) throw new Error('Leave application not found');

  const application = appSnap.data() as Omit<LeaveApplication, 'id'>;

  // Update application status
  await updateDoc(appRef, {
    status: 'approved',
    approvedBy,
    approvedAt: serverTimestamp(),
  });

  // Deduct from leave balance (casual / sick / earned / comp_off have tracked balances)
  const balanceType = application.type as LeaveType;
  if (balanceType === 'casual' || balanceType === 'sick' || balanceType === 'earned' || balanceType === 'comp_off') {
    const year = new Date().getFullYear();
    const balanceRef = doc(db, 'leave_balances', `${application.employeeId}_${year}`);
    const balSnap = await getDoc(balanceRef);

    const current = balSnap.exists()
      ? (balSnap.data() as LeaveBalance)[balanceType]
      : { total: 0, used: 0, remaining: 0 };

    const newUsed      = (current?.used ?? 0) + application.days;
    const newRemaining = Math.max(0, (current?.total ?? 0) - newUsed);

    await setDoc(balanceRef, {
      employeeId: application.employeeId,
      year,
      [balanceType]: { ...current, used: newUsed, remaining: newRemaining },
    }, { merge: true });
  }

  // Fire-and-forget: ask the server to create a Google Calendar event.
  // The server uses the admin's stored oauth2Client credentials, so no tokens
  // need to travel in the request body.
  const token = await auth.currentUser?.getIdToken();
  fetch('/api/hrms/leave/sync-calendar', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token ?? ''}`,
    },
    body: JSON.stringify({ applicationId }),
  }).catch(() => {
    // Non-fatal — calendar sync failure must never block the approve flow.
  });
}

// ─── rejectLeave ──────────────────────────────────────────────────────────────
// Marks the application rejected with a mandatory reason and records who rejected it.
export async function rejectLeave(
  applicationId: string,
  reason: string,
  rejectedBy: string,
): Promise<void> {
  await updateDoc(doc(db, 'leave_applications', applicationId), {
    status:          'rejected',
    rejectionReason: reason,
    rejectedAt:      serverTimestamp(),
    reviewedAt:      serverTimestamp(),
    reviewedBy:      rejectedBy,
    approvedBy:      null,
    approvedAt:      null,
  });
}

// ─── cancelLeave ──────────────────────────────────────────────────────────────
// Employee-initiated cancellation of their own pending application.
export async function cancelLeave(applicationId: string): Promise<void> {
  await updateDoc(doc(db, 'leave_applications', applicationId), {
    status: 'cancelled',
  });
}
