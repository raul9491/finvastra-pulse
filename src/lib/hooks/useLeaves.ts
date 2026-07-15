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
  serverTimestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { LeaveApplication, LeaveType } from '../../types';

// ─── Hook: My leave applications ──────────────────────────────────────────────
export function useLeaves(userId: string | null) {
  const [leaves, setLeaves] = useState<LeaveApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, 'leave_applications'),
      where('employeeId', '==', userId),
      orderBy('appliedAt', 'desc')
    );

    return onSnapshot(
      q,
      (snap) => {
        setLeaves(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeaveApplication)));
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'leave_applications');
      }
    );
  }, [userId]);

  return { leaves, loading };
}

// ─── Submit a leave application ───────────────────────────────────────────────
export async function submitLeave(
  userId: string,
  data: { fromDate: string; toDate: string; days: number; type: LeaveType; reason: string }
): Promise<void> {
  await addDoc(collection(db, 'leave_applications'), {
    ...data,
    employeeId: userId,
    status: 'pending',
    appliedAt: serverTimestamp(),
    approvedBy: null,
    approvedAt: null,
    rejectionReason: null,
    calendarEventId: null,
  });
}

// ─── Cancel a pending leave application ───────────────────────────────────────
export async function cancelLeave(applicationId: string): Promise<void> {
  await updateDoc(doc(db, 'leave_applications', applicationId), { status: 'cancelled' });
}

// ─── Hook: Admin — all pending leave applications ─────────────────────────────
export function usePendingLeaves() {
  const [leaves, setLeaves] = useState<LeaveApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'leave_applications'),
      where('status', '==', 'pending'),
      orderBy('appliedAt', 'asc')
    );

    return onSnapshot(q, (snap) => {
      setLeaves(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeaveApplication)));
      setLoading(false);
    });
  }, []);

  return { leaves, loading };
}

// ─── Admin: approve or reject a leave application ────────────────────────────
export async function adminLeaveAction(
  applicationId: string,
  status: 'approved' | 'rejected',
  adminUserId: string
): Promise<void> {
  await updateDoc(doc(db, 'leave_applications', applicationId), {
    status,
    approvedBy: adminUserId,
    approvedAt: serverTimestamp(),
  });
}
