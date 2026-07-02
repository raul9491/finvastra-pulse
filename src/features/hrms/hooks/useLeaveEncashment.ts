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
  addDoc, doc, getDoc, getDocs, updateDoc, runTransaction, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { LEAVE_DEFAULT_TOTALS } from './useLeave';
import type { LeaveEncashmentRequest, EncashmentStatus, LeaveBalance } from '../../../types';

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

// FY (April–March, keyed to the START year) a YYYY-MM month belongs to —
// same convention as currentLeaveYear()/leaveYearOf() in useLeave.ts.
function encashmentFyOf(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m >= 4 ? y : y - 1;
}

// Aggregate FY encashment ceiling — matches the stated per-FY entitlement.
const MAX_ENCASH_DAYS_PER_FY = 30;

/**
 * Admin approves an encashment request.
 *
 * Approval now DEBITS the employee's earned-leave balance in the same
 * transaction as the status flip (previously the employee was paid for the EL
 * days AND kept them). Throws a human-readable Error when the balance (or the
 * 30-day FY cap) doesn't cover the request — the caller surfaces the message.
 *
 * FY keying choice: the FY is derived from the request's PAYROLL MONTH
 * (`month`, YYYY-MM) — it's stored on the request doc, deterministic, and is
 * the period the encashment is actually processed/paid in, so the debit lands
 * on the same FY balance doc the payout belongs to.
 */
export async function approveEncashmentRequest(
  requestId:  string,
  approvedBy: string,
): Promise<void> {
  const reqRef = doc(db, 'leave_encashment_requests', requestId);

  // Pre-read outside the tx to know the employee + FY for the aggregate query.
  const preSnap = await getDoc(reqRef);
  if (!preSnap.exists()) throw new Error('Encashment request not found.');
  const pre = preSnap.data() as LeaveEncashmentRequest;
  const fy  = encashmentFyOf(pre.month);

  // Cumulative FY cap: approved + paid encashment days for this employee in
  // this FY must not exceed 30 (incl. this request). Client transactions
  // cannot run queries, so this check runs BEFORE the tx. Residual race: two
  // admins approving simultaneously could each pass this check — accepted for
  // single-admin usage; the per-approval balance debit inside the tx still
  // bounds total encashment at the actual EL balance.
  const priorSnap = await getDocs(query(
    collection(db, 'leave_encashment_requests'),
    where('employeeId', '==', pre.employeeId),
  ));
  const priorDays = priorSnap.docs
    .filter((d) => d.id !== requestId)
    .map((d) => d.data() as LeaveEncashmentRequest)
    .filter((r) => (r.status === 'approved' || r.status === 'paid') && encashmentFyOf(r.month) === fy)
    .reduce((sum, r) => sum + (r.leaveDays || 0), 0);
  if (priorDays + pre.leaveDays > MAX_ENCASH_DAYS_PER_FY) {
    throw new Error(
      `Cannot approve — this would take ${pre.employeeName}'s encashed days for FY ${fy}-${(fy + 1) % 100} ` +
      `to ${priorDays + pre.leaveDays} (max ${MAX_ENCASH_DAYS_PER_FY}). Already approved/paid: ${priorDays} day(s).`,
    );
  }

  const balanceRef = doc(db, 'leave_balances', `${pre.employeeId}_${fy}`);

  // One transaction: re-read the request (double-approve guard), read the
  // balance, validate, then debit EL + flip status together. Reads before writes.
  await runTransaction(db, async (tx) => {
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) throw new Error('Encashment request not found.');
    const req = reqSnap.data() as LeaveEncashmentRequest;
    if (req.status !== 'pending') {
      throw new Error('This encashment request has already been processed.');
    }

    const balSnap = await tx.get(balanceRef);
    // Missing doc / missing earned entry → HR Handbook default entitlement
    // (never seed total:0 — see LEAVE_DEFAULT_TOTALS in useLeave.ts).
    const entry = balSnap.exists() ? (balSnap.data() as LeaveBalance).earned : undefined;
    const total     = entry?.total ?? LEAVE_DEFAULT_TOTALS.earned;
    const used      = entry?.used  ?? 0;
    const remaining = entry?.remaining ?? Math.max(0, total - used);

    if (req.leaveDays > remaining) {
      throw new Error(
        `Cannot approve — ${req.employeeName} has only ${remaining} earned-leave day(s) remaining ` +
        `but requested ${req.leaveDays}.`,
      );
    }

    const newUsed = used + req.leaveDays;
    tx.set(balanceRef, {
      employeeId: req.employeeId,
      year: fy,
      earned: { total, used: newUsed, remaining: Math.max(0, total - newUsed) },
    }, { merge: true });

    tx.update(reqRef, {
      status:     'approved' as EncashmentStatus,
      approvedBy,
      approvedAt: serverTimestamp(),
    });
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
