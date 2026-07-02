/**
 * useAttendanceRegularization — employee regularization requests.
 *
 * Flow:
 *  Employee submits → status: 'pending'
 *  Admin approves → attendance record updated, status: 'approved'
 *  Admin rejects  → status: 'rejected', rejectionReason set
 *
 * Collection: /attendance_regularizations/{reqId}
 */

import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { AttendanceRegularization, AttendanceStatus } from '../../../types';

// ─── Submit ───────────────────────────────────────────────────────────────────

export interface SubmitRegularizationInput {
  employeeId:        string;
  employeeName:      string;
  date:              string;   // YYYY-MM-DD
  requestedCheckIn:  string | null;  // HH:mm
  requestedCheckOut: string | null;
  reason:            string;
  existingStatus:    AttendanceStatus | null;
}

export async function submitRegularization(input: SubmitRegularizationInput): Promise<void> {
  await addDoc(collection(db, 'attendance_regularizations'), {
    ...input,
    status:        'pending',
    reviewedBy:    null,
    reviewedByName: null,
    reviewedAt:    null,
    rejectionReason: null,
    submittedAt:   serverTimestamp(),
  });
}

// ─── Approve ──────────────────────────────────────────────────────────────────
// Builds a Firestore Timestamp from a YYYY-MM-DD date string + HH:mm time string.
// Uses the Asia/Kolkata timezone offset (IST = UTC+5:30).

function buildTimestamp(date: string, time: string): Timestamp {
  // date = "YYYY-MM-DD", time = "HH:mm"
  const [y, mo, d]   = date.split('-').map(Number);
  const [hh, mm]     = time.split(':').map(Number);
  // Construct as UTC-adjusted for IST (UTC+5:30 = subtract 5h30m for UTC equiv)
  const utcMs = Date.UTC(y, mo - 1, d, hh - 5, mm - 30);
  return Timestamp.fromMillis(utcMs);
}

export async function approveRegularization(
  req: AttendanceRegularization,
  reviewerId: string,
  reviewerName: string,
  /** existing attendance doc id for that date/employee — null if none exists */
  existingAttendanceId: string | null,
): Promise<void> {
  // 1. Update the regularization request itself
  await updateDoc(doc(db, 'attendance_regularizations', req.id), {
    status:        'approved',
    reviewedBy:    reviewerId,
    reviewedByName: reviewerName,
    reviewedAt:    serverTimestamp(),
  });

  // 2. Build new checkIn / checkOut timestamps
  const newCheckIn  = req.requestedCheckIn  ? buildTimestamp(req.date, req.requestedCheckIn)  : null;
  let   newCheckOut = req.requestedCheckOut ? buildTimestamp(req.date, req.requestedCheckOut) : null;

  // Overnight shift: a checkout at or before the check-in time means it
  // happened the NEXT day (e.g. 21:00 → 02:00) — roll it forward 24h.
  // Previously this computed 0 working hours.
  if (newCheckIn && newCheckOut && newCheckOut.toMillis() <= newCheckIn.toMillis()) {
    newCheckOut = Timestamp.fromMillis(newCheckOut.toMillis() + 24 * 60 * 60 * 1000);
  }

  // 3. Compute working hours from both times
  let workingHours = 0;
  if (newCheckIn && newCheckOut) {
    workingHours = Math.max(
      0,
      (newCheckOut.toMillis() - newCheckIn.toMillis()) / (1000 * 60 * 60),
    );
  }

  const attendancePayload = {
    checkIn:      newCheckIn,
    checkOut:     newCheckOut,
    workingHours,
    status:       'present' as AttendanceStatus,
    markedBy:     'admin' as const,
    notes:        `Regularized by ${reviewerName}`,
    updatedAt:    serverTimestamp(),
  };

  if (existingAttendanceId) {
    // Update existing record
    await updateDoc(doc(db, 'attendance', existingAttendanceId), attendancePayload);
  } else {
    // Create a new attendance record for that day
    await addDoc(collection(db, 'attendance'), {
      ...attendancePayload,
      userId:    req.employeeId,
      date:      req.date,
      createdAt: serverTimestamp(),
    });
  }
}

export async function rejectRegularization(
  reqId: string,
  reviewerId: string,
  reviewerName: string,
  rejectionReason: string,
): Promise<void> {
  await updateDoc(doc(db, 'attendance_regularizations', reqId), {
    status:          'rejected',
    reviewedBy:      reviewerId,
    reviewedByName:  reviewerName,
    reviewedAt:      serverTimestamp(),
    rejectionReason,
  });
}

// ─── useMyRegularizations (employee) ─────────────────────────────────────────

export function useMyRegularizations(employeeId: string, month: string): {
  requests: AttendanceRegularization[];
  loading: boolean;
} {
  const [requests, setRequests] = useState<AttendanceRegularization[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!employeeId || !month) { setLoading(false); return; }

    // month = "YYYY-MM"; derive start/end date strings for the month
    const startDate = `${month}-01`;
    const year  = Number(month.slice(0, 4));
    const mo    = Number(month.slice(5, 7));
    const lastDay = new Date(year, mo, 0).getDate();
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

    const q = query(
      collection(db, 'attendance_regularizations'),
      where('employeeId', '==', employeeId),
      where('date', '>=', startDate),
      where('date', '<=', endDate),
      orderBy('date', 'desc'),
    );

    return onSnapshot(
      q,
      (snap) => {
        setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AttendanceRegularization));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [employeeId, month]);

  return { requests, loading };
}

// ─── useAllRegularizations (admin) ───────────────────────────────────────────

export function useAllRegularizations(statusFilter: string): {
  requests: AttendanceRegularization[];
  loading: boolean;
} {
  const [requests, setRequests] = useState<AttendanceRegularization[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    const q = statusFilter && statusFilter !== 'all'
      ? query(
          collection(db, 'attendance_regularizations'),
          where('status', '==', statusFilter),
          orderBy('submittedAt', 'desc'),
        )
      : query(
          collection(db, 'attendance_regularizations'),
          orderBy('submittedAt', 'desc'),
        );

    return onSnapshot(
      q,
      (snap) => {
        setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AttendanceRegularization));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [statusFilter]);

  return { requests, loading };
}

// ─── usePendingRegularizationCount (shell badge) ─────────────────────────────

export function usePendingRegularizationCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(collection(db, 'attendance_regularizations'), where('status', '==', 'pending')),
      (snap) => setCount(snap.size),
      () => setCount(0),
    );
  }, [enabled]);

  return count;
}
