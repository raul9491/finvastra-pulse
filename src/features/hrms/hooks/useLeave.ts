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

// ─── Leave year + defaults (single source of truth) ──────────────────────────
// Balance docs are keyed per FINANCIAL year (April–March), matching the
// year-end reset job: April onwards → current calendar year; Jan–Mar → previous.
// (Previously some call sites used the calendar year, which split a financial
// year's balance across two docs every January–March.)
export function currentLeaveYear(): number {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

// HR Handbook annual entitlements — used when a balance doc/entry doesn't
// exist yet (never seed total:0, it sticks once the doc exists).
export const LEAVE_DEFAULT_TOTALS: Record<'casual' | 'sick' | 'earned' | 'comp_off', number> = {
  casual: 8,
  sick: 7,
  earned: 15,
  comp_off: 0,
};

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

// ─── useAllApprovedLeaves ─────────────────────────────────────────────────────
// Admin hook: all approved leave applications across the org, sorted by fromDate.
// Used by the team leave calendar.
export function useAllApprovedLeaves(): {
  applications: LeaveApplication[];
  loading: boolean;
} {
  const [applications, setApplications] = useState<LeaveApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'leave_applications'),
      where('status', '==', 'approved'),
      orderBy('fromDate', 'asc'),
    );
    return onSnapshot(q, (snap) => {
      setApplications(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeaveApplication)));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

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
    const year = currentLeaveYear();
    const balanceRef = doc(db, 'leave_balances', `${application.employeeId}_${year}`);
    const balSnap = await getDoc(balanceRef);

    // When the doc or the type entry is missing, seed from the HR Handbook
    // defaults — NOT total:0, which would permanently show a zero balance once
    // the doc exists (the UI's "?? default" fallback only applies to a null doc).
    const existingEntry = balSnap.exists()
      ? (balSnap.data() as LeaveBalance)[balanceType]
      : undefined;
    const total = existingEntry?.total ?? LEAVE_DEFAULT_TOTALS[balanceType];

    const newUsed      = (existingEntry?.used ?? 0) + application.days;
    const newRemaining = Math.max(0, total - newUsed);

    await setDoc(balanceRef, {
      employeeId: application.employeeId,
      year,
      [balanceType]: { total, used: newUsed, remaining: newRemaining },
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
  const appRef = doc(db, 'leave_applications', applicationId);
  const appSnap = await getDoc(appRef);
  const application = appSnap.exists() ? (appSnap.data() as Omit<LeaveApplication, 'id'>) : null;

  await updateDoc(appRef, {
    status: 'cancelled',
  });

  // Refund the balance when cancelling an APPROVED leave — approval deducted
  // the days, so cancellation must give them back (was previously never
  // refunded, silently inflating "used").
  const balanceType = application?.type as LeaveType | undefined;
  if (application?.status === 'approved' &&
      (balanceType === 'casual' || balanceType === 'sick' || balanceType === 'earned' || balanceType === 'comp_off')) {
    const year = currentLeaveYear();
    const balanceRef = doc(db, 'leave_balances', `${application.employeeId}_${year}`);
    const balSnap = await getDoc(balanceRef);
    if (balSnap.exists()) {
      const entry = (balSnap.data() as LeaveBalance)[balanceType];
      const total = entry?.total ?? LEAVE_DEFAULT_TOTALS[balanceType];
      const newUsed = Math.max(0, (entry?.used ?? 0) - application.days);
      await setDoc(balanceRef, {
        [balanceType]: { total, used: newUsed, remaining: Math.max(0, total - newUsed) },
      }, { merge: true });
    }
  }
}
