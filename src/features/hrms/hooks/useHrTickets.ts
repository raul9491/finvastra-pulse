/**
 * useHrTickets — HR Helpdesk / Grievance data hooks + mutations.
 *
 * Collection: /hr_tickets
 * Security: employees read/create own tickets; admin/hrmsManager read all + update.
 */

import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type {
  HrTicketCategory, HrTicketPriority, HrTicketStatus, HrTicket,
} from '../../../types';

// ── Read hooks ────────────────────────────────────────────────────────────────

/** Employee: own tickets only. */
export function useMyTickets(employeeId: string) {
  const [tickets, setTickets] = useState<HrTicket[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!employeeId) return;
    return onSnapshot(
      query(
        collection(db, 'hr_tickets'),
        where('employeeId', '==', employeeId),
        orderBy('createdAt', 'desc'),
      ),
      (snap) => {
        setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as HrTicket)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [employeeId]);
  return { tickets, loading };
}

/** Admin: all tickets, sorted by createdAt desc. */
export function useAllTickets() {
  const [tickets, setTickets] = useState<HrTicket[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'hr_tickets'), orderBy('createdAt', 'desc')),
      (snap) => {
        setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as HrTicket)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);
  return { tickets, loading };
}

// ── Badges ────────────────────────────────────────────────────────────────────

/** Employee badge: count of own tickets with status 'open' | 'in_review'. */
export function useMyOpenTicketCount(employeeId: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!employeeId) return;
    return onSnapshot(
      query(
        collection(db, 'hr_tickets'),
        where('employeeId', '==', employeeId),
        where('status', 'in', ['open', 'in_review']),
      ),
      (snap) => setCount(snap.size),
      () => setCount(0),
    );
  }, [employeeId]);
  return count;
}

/** Admin badge: count of open + in_review tickets. */
export function useOpenTicketCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(
        collection(db, 'hr_tickets'),
        where('status', 'in', ['open', 'in_review']),
      ),
      (snap) => setCount(snap.size),
      () => setCount(0),
    );
  }, [enabled]);
  return count;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function createTicket(data: {
  employeeId: string;
  employeeName: string;
  category: HrTicketCategory;
  subject: string;
  description: string;
  priority: HrTicketPriority;
  isAnonymous: boolean;
  attachmentUrl: string | null;
}) {
  await addDoc(collection(db, 'hr_tickets'), {
    ...data,
    // Wipe employee identity if anonymous
    employeeName: data.isAnonymous ? 'Anonymous' : data.employeeName,
    status:          'open',
    resolvedAt:      null,
    resolvedBy:      null,
    resolutionNotes: null,
    adminNotes:      null,
    createdAt:   serverTimestamp(),
    updatedAt:   serverTimestamp(),
  });
}

export async function updateTicketStatus(
  ticketId: string,
  status: HrTicketStatus,
  resolutionNotes: string | null,
  resolvedBy: string,
) {
  const patch: Record<string, unknown> = {
    status,
    resolutionNotes,
    updatedAt: serverTimestamp(),
  };
  if (status === 'resolved' || status === 'closed') {
    patch.resolvedAt = serverTimestamp();
    patch.resolvedBy = resolvedBy;
  }
  await updateDoc(doc(db, 'hr_tickets', ticketId), patch);
}

export async function updateAdminNotes(ticketId: string, adminNotes: string) {
  await updateDoc(doc(db, 'hr_tickets', ticketId), {
    adminNotes: adminNotes.trim() || null,
    updatedAt: serverTimestamp(),
  });
}
