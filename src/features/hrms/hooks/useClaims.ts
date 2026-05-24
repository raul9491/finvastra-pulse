import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { Claim, ClaimType, ClaimTravelDetails } from '../../../types';

export { type Claim };

// ─── Employee: my claims ──────────────────────────────────────────────────────

export function useMyClaims(userId: string, month?: string) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    const constraints = [
      where('employeeId', '==', userId),
      orderBy('submittedAt', 'desc'),
    ];
    if (month) constraints.splice(1, 0, where('month', '==', month));
    const q = query(collection(db, 'claims'), ...constraints);
    return onSnapshot(q, (snap) => {
      setClaims(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Claim));
      setLoading(false);
    }, () => setLoading(false));
  }, [userId, month]);

  return { claims, loading };
}

// ─── Admin: all claims ────────────────────────────────────────────────────────

export function useAllClaims(month?: string, status?: string, employeeId?: string) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const constraints: Parameters<typeof query>[1][] = [orderBy('submittedAt', 'desc')];
    if (month)      constraints.unshift(where('month', '==', month));
    if (status)     constraints.unshift(where('status', '==', status));
    if (employeeId) constraints.unshift(where('employeeId', '==', employeeId));
    const q = query(collection(db, 'claims'), ...constraints);
    return onSnapshot(q, (snap) => {
      setClaims(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Claim));
      setLoading(false);
    }, () => setLoading(false));
  }, [month, status, employeeId]);

  return { claims, loading };
}

// ─── Submit a new claim ───────────────────────────────────────────────────────

export async function submitClaim(params: {
  employeeId: string;
  employeeName: string;
  claimType: ClaimType;
  amount: number;
  description: string;
  travelDetails?: ClaimTravelDetails;
}) {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  await addDoc(collection(db, 'claims'), {
    ...params,
    receiptUrl: null,
    submittedAt: serverTimestamp(),
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
    rejectionReason: null,
    paidAt: null,
    paymentReference: null,
    month,
  });
}

// ─── Admin actions ────────────────────────────────────────────────────────────

export async function approveClaim(claimId: string, approvedBy: string) {
  await updateDoc(doc(db, 'claims', claimId), {
    status: 'approved',
    approvedBy,
    approvedAt: serverTimestamp(),
  });
}

export async function rejectClaim(claimId: string, rejectionReason: string) {
  await updateDoc(doc(db, 'claims', claimId), {
    status: 'rejected',
    rejectionReason,
  });
}

export async function markClaimsPaid(claimIds: string[], paymentReference: string) {
  for (const id of claimIds) {
    await updateDoc(doc(db, 'claims', id), {
      status: 'paid',
      paidAt: serverTimestamp(),
      paymentReference,
    });
  }
}

export async function cancelClaim(claimId: string) {
  await updateDoc(doc(db, 'claims', claimId), { status: 'rejected', rejectionReason: 'Cancelled by employee' });
}

// ─── CSV export ───────────────────────────────────────────────────────────────

export async function exportClaimsCSV(month: string): Promise<void> {
  const q = query(collection(db, 'claims'), where('month', '==', month));
  const snap = await getDocs(q);
  if (snap.empty) { alert('No claims found for this month.'); return; }

  const rows = snap.docs.map((d) => {
    const c = d.data() as Claim;
    return [
      c.employeeName, c.claimType, c.amount, c.description, c.status,
      c.approvedBy ?? '', c.paymentReference ?? '', c.month,
    ].join(',');
  });

  const csv = ['Employee,Type,Amount,Description,Status,Approved By,Payment Ref,Month', ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `claims-${month}.csv`; a.click();
  URL.revokeObjectURL(url);
}
