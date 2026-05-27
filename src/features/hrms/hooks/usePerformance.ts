import { useState, useEffect } from 'react';
import {
  collection, doc, getDoc, setDoc, updateDoc,
  onSnapshot, query, where, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type {
  PerformanceReview,
  PerformanceSelfAssessment,
  PerformanceManagerReview,
  UserProfile,
} from '../../../types';

// ─── Year helpers ──────────────────────────────────────────────────────────────

/** Calendar year used for review cycles (2026 = "2026 Annual Review"). */
export function currentReviewYear(): number {
  return new Date().getFullYear();
}

export function reviewId(employeeId: string, year: number): string {
  return `${employeeId}_${year}`;
}

// ─── Subscriptions ─────────────────────────────────────────────────────────────

export function useMyPerformanceReview(
  uid: string,
  year: number,
): { review: PerformanceReview | null; loading: boolean } {
  const [review, setReview] = useState<PerformanceReview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    setLoading(true);
    return onSnapshot(
      doc(db, 'performance_reviews', reviewId(uid, year)),
      (snap) => {
        setReview(snap.exists() ? ({ id: snap.id, ...snap.data() } as PerformanceReview) : null);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [uid, year]);

  return { review, loading };
}

export function useAllPerformanceReviews(
  year: number,
  enabled: boolean,
): { reviews: PerformanceReview[]; loading: boolean } {
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    return onSnapshot(
      query(collection(db, 'performance_reviews'), where('year', '==', year)),
      (snap) => {
        setReviews(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PerformanceReview));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [year, enabled]);

  return { reviews, loading };
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

export async function createReviewCycle(
  year: number,
  employees: UserProfile[],
): Promise<number> {
  let created = 0;
  await Promise.all(
    employees.map(async (emp) => {
      const id = reviewId(emp.userId, year);
      const existing = await getDoc(doc(db, 'performance_reviews', id));
      if (existing.exists()) return;

      await setDoc(doc(db, 'performance_reviews', id), {
        employeeId: emp.userId,
        employeeName: emp.displayName,
        employeeCode: emp.employeeId ?? null,
        department: emp.department ?? null,
        designation: emp.designation ?? null,
        year,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      created++;
    }),
  );
  return created;
}

export async function submitSelfAssessment(
  employeeId: string,
  year: number,
  data: Omit<PerformanceSelfAssessment, 'submittedAt'>,
): Promise<void> {
  const id = reviewId(employeeId, year);
  await updateDoc(doc(db, 'performance_reviews', id), {
    status: 'self_review',
    selfAssessment: { ...data, submittedAt: serverTimestamp() },
    updatedAt: serverTimestamp(),
  });
}

export async function submitManagerReview(
  reviewDocId: string,
  data: Omit<PerformanceManagerReview, 'submittedAt' | 'submittedBy'>,
  byUid: string,
): Promise<void> {
  await updateDoc(doc(db, 'performance_reviews', reviewDocId), {
    status: 'manager_review',
    managerReview: { ...data, submittedBy: byUid, submittedAt: serverTimestamp() },
    updatedAt: serverTimestamp(),
  });
}

export async function finalizeReview(
  reviewDocId: string,
  data: {
    incrementPercentage: number;
    newGrossSalary: number;
    oldGrossSalary: number;
    incrementEffectiveDate: string;
    hrNotes: string | null;
  },
  byUid: string,
): Promise<void> {
  await updateDoc(doc(db, 'performance_reviews', reviewDocId), {
    status: 'completed',
    ...data,
    finalizedAt: serverTimestamp(),
    finalizedBy: byUid,
    updatedAt: serverTimestamp(),
  });
}

// ─── Badge hooks ───────────────────────────────────────────────────────────────

/**
 * Employee badge: returns 1 if the current year review exists and is 'pending'
 * (self-assessment not yet submitted). Drops to 0 once submitted.
 */
export function useSelfAssessmentBadge(uid: string, year: number): number {
  const { review, loading } = useMyPerformanceReview(uid, year);
  if (loading || !review) return 0;
  return review.status === 'pending' ? 1 : 0;
}

/**
 * Admin badge: count of reviews awaiting HR action (self_review or manager_review).
 */
export function usePendingReviewCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  const year = currentReviewYear();

  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(
        collection(db, 'performance_reviews'),
        where('year', '==', year),
        where('status', 'in', ['self_review', 'manager_review']),
      ),
      (snap) => setCount(snap.size),
      () => setCount(0),
    );
  }, [enabled, year]);

  return count;
}
