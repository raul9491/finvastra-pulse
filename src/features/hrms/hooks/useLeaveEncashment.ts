/**
 * useLeaveEncashment — hooks + mutations for leave encashment requests.
 *
 * Employees can request encashment of earned leave days (EL only, min 1, max 15 per request).
 * Admin/HR approves and it flows into the payslip as an "Other Allowance" suggestion.
 *
 * Collection: /leave_encashment_requests
 */

import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, doc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { LeaveEncashmentRequest, EncashmentStatus } from '../../../types';

// ─── Read hooks ───────────────────────────────────────────────────────────────

/** Employee: own encashment requests. */
export function useMyEncashmentRequests(employeeId: string): {
  requests: LeaveEncashmentRequest[];
  loading:  boolean;
} {
  const [requests, setRequests] = useState<LeaveEncashmentRequest[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!employeeId) { setLoading(false); return; }
    return onSnapshot(
      query(
        collection(db, 'leave_encashment_requests'),
        where('employeeId', '==', employeeId),
        orderBy('submittedAt', 'desc'),
      ),
      (snap) => {
        setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeaveEncashmentRequest)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [employeeId]);

  return { requests, loading };
}

/** Admin: all encashment requests, newest first. */
export function useAllEncashmentRequests(): {
  requests: LeaveEncashmentRequest[];
  loading:  boolean;
} {
  const [requests, setRequests] = useState<LeaveEncashmentRequest[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'leave_encashment_requests'), orderBy('submittedAt', 'desc')),
      (snap) => {
        setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeaveEncashmentRequest)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  return { requests, loading };
}

/** Count of pending encashment requests (for admin nav badge). */
export function usePendingEncashmentCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(collection(db, 'leave_encashment_requests'), where('status', '==', 'pending')),
      (snap) => setCount(snap.size),
      () => setCount(0),
    );
  }, [enabled]);
  return count;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Employee submits an encashment request. */
export async function submitEncashmentRequest(params: {
  employeeId:   string;
  employeeName: string;
  leaveDays:    number;
  dailyRate:    number;
  grossSalary:  number;
  reason:       string;
  month:        string;   // YYYY-MM
}): Promise<void> {
  const { employeeId, employeeName, leaveDays, dailyRate, grossSalary, reason, month } = params;
  await addDoc(collection(db, 'leave_encashment_requests'), {
    employeeId,
    employeeName,
    leaveDays,
    dailyRate,
    grossSalary,
    totalAmount:     Math.round(leaveDays * dailyRate),
    reason,
    month,
    status:          'pending' as EncashmentStatus,
    submittedAt:     serverTimestamp(),
    approvedBy:      null,
    approvedAt:      null,
    rejectionReason: null,
    paidAt:          null,
    paymentReference: null,
    notes:           null,
  });
}

/** Admin approves an encashment request. */
export async function approveEncashmentRequest(
  requestId:  string,
  approvedBy: string,
): Promise<void> {
  await updateDoc(doc(db, 'leave_encashment_requests', requestId), {
    status:     'approved' as EncashmentStatus,
    approvedBy,
    approvedAt: serverTimestamp(),
  });
}

/** Admin rejects an encashment request. */
export async function rejectEncashmentRequest(
  requestId:       string,
  rejectedBy:      string,
  rejectionReason: string,
): Promise<void> {
  await updateDoc(doc(db, 'leave_encashment_requests', requestId), {
    status:          'rejected' as EncashmentStatus,
    approvedBy:      rejectedBy,
    approvedAt:      serverTimestamp(),
    rejectionReason,
  });
}

/** Admin marks as paid (after including in payslip). */
export async function markEncashmentPaid(
  requestId:        string,
  paymentReference: string,
): Promise<void> {
  await updateDoc(doc(db, 'leave_encashment_requests', requestId), {
    status:           'paid' as EncashmentStatus,
    paidAt:           serverTimestamp(),
    paymentReference,
  });
}
