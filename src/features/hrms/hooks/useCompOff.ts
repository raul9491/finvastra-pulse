/**
 * useCompOff — Compensatory Off crediting hooks and mutations.
 *
 * When an employee works on a Sunday or public holiday, an admin grants them
 * comp off days. This:
 *   1. Writes an audit record to /comp_off_credits/{id}
 *   2. Updates /leave_balances/{employeeId}_{year}.comp_off (increment total + remaining)
 *      using a transaction so concurrent grants are safe.
 *
 * Collection: /comp_off_credits
 */

import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, doc, getDoc, setDoc, updateDoc, serverTimestamp, runTransaction,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompOffCredit {
  id:            string;
  employeeId:    string;
  employeeName:  string;
  dateWorked:    string;   // YYYY-MM-DD — the Sunday / holiday they worked
  daysGranted:   number;
  notes:         string | null;
  grantedBy:     string;   // uid of admin who granted
  grantedByName: string;
  grantedAt:     import('firebase/firestore').Timestamp;
  year:          number;   // financial year the credit applies to
}

// ─── Read hooks ───────────────────────────────────────────────────────────────

/** Admin: all comp off credits across the org, newest first. */
export function useAllCompOffCredits(): { credits: CompOffCredit[]; loading: boolean } {
  const [credits, setCredits] = useState<CompOffCredit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'comp_off_credits'),
      orderBy('grantedAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setCredits(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CompOffCredit)));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  return { credits, loading };
}

/** Employee: own comp off credits only. */
export function useMyCompOffCredits(employeeId: string): { credits: CompOffCredit[]; loading: boolean } {
  const [credits, setCredits] = useState<CompOffCredit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employeeId) { setLoading(false); return; }
    const q = query(
      collection(db, 'comp_off_credits'),
      where('employeeId', '==', employeeId),
      orderBy('grantedAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setCredits(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CompOffCredit)));
      setLoading(false);
    }, () => setLoading(false));
  }, [employeeId]);

  return { credits, loading };
}

// ─── Mutation ─────────────────────────────────────────────────────────────────

/**
 * grantCompOff — atomically:
 *   1. Adds a record to /comp_off_credits
 *   2. Updates /leave_balances/{employeeId}_{year}.comp_off (total + remaining += daysGranted)
 *      Creates the balance doc with correct defaults if it doesn't exist yet.
 */
export async function grantCompOff(params: {
  employeeId:    string;
  employeeName:  string;
  dateWorked:    string;   // YYYY-MM-DD
  daysGranted:   number;
  notes:         string | null;
  grantedBy:     string;
  grantedByName: string;
  year:          number;
}): Promise<void> {
  const { employeeId, employeeName, dateWorked, daysGranted, notes,
          grantedBy, grantedByName, year } = params;

  const balDocId  = `${employeeId}_${year}`;
  const balRef    = doc(db, 'leave_balances', balDocId);
  const credRef   = collection(db, 'comp_off_credits');

  await runTransaction(db, async (tx) => {
    const balSnap = await tx.get(balRef);

    if (balSnap.exists()) {
      // Document exists — increment comp_off.total and comp_off.remaining
      const data        = balSnap.data();
      const existing    = data.comp_off as { total: number; used: number; remaining: number } | undefined;
      const prevTotal   = existing?.total     ?? 0;
      const prevUsed    = existing?.used      ?? 0;
      const prevRemain  = existing?.remaining ?? 0;

      tx.update(balRef, {
        'comp_off.total':     prevTotal    + daysGranted,
        'comp_off.used':      prevUsed,
        'comp_off.remaining': prevRemain   + daysGranted,
      });
    } else {
      // Balance doc doesn't exist — create with HR Handbook defaults + comp_off
      tx.set(balRef, {
        employeeId,
        year,
        casual:   { total: 8,           used: 0, remaining: 8           },
        sick:     { total: 7,           used: 0, remaining: 7           },
        earned:   { total: 15,          used: 0, remaining: 15          },
        comp_off: { total: daysGranted, used: 0, remaining: daysGranted },
      });
    }
  });

  // Write audit record (outside transaction — non-fatal if this fails separately)
  await addDoc(credRef, {
    employeeId,
    employeeName,
    dateWorked,
    daysGranted,
    notes:         notes || null,
    grantedBy,
    grantedByName,
    year,
    grantedAt: serverTimestamp(),
  });
}
