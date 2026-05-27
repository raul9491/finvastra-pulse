/**
 * useDocumentAcknowledgements — Policy acknowledgement hooks + mutations.
 *
 * Collection: /document_acknowledgements
 * Each record is an immutable digital sign-off: an employee confirms they have
 * read a specific company document (POSH policy, Code of Conduct, etc.).
 */

import { useState, useEffect, useMemo } from 'react';
import {
  collection, query, where, onSnapshot, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { CompanyDocument, DocumentAcknowledgement } from '../../../types';

// ── Read hooks ────────────────────────────────────────────────────────────────

/** Employee: own acknowledgement records. */
export function useMyAcknowledgements(employeeId: string) {
  const [acks, setAcks]     = useState<DocumentAcknowledgement[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!employeeId) { setLoading(false); return; }
    return onSnapshot(
      query(collection(db, 'document_acknowledgements'), where('employeeId', '==', employeeId)),
      (snap) => {
        setAcks(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DocumentAcknowledgement)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [employeeId]);
  return { acks, loading };
}

/** Admin: all acknowledgements for a specific document. */
export function useDocumentAcknowledgements(documentId: string) {
  const [acks, setAcks]     = useState<DocumentAcknowledgement[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!documentId) { setLoading(false); return; }
    return onSnapshot(
      query(collection(db, 'document_acknowledgements'), where('documentId', '==', documentId)),
      (snap) => {
        setAcks(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DocumentAcknowledgement)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [documentId]);
  return { acks, loading };
}

/**
 * usePendingAcknowledgements — list of docs this employee still needs to acknowledge.
 * Subscribes to their ack records; cross-references the provided docs list.
 */
export function usePendingAcknowledgements(
  employeeId: string,
  allDocs: CompanyDocument[],
): { pending: CompanyDocument[]; loading: boolean } {
  const { acks, loading } = useMyAcknowledgements(employeeId);

  const pending = useMemo(() => {
    if (!employeeId) return [];
    const ackedIds = new Set(acks.map((a) => a.documentId));
    return allDocs.filter(
      (d) => d.isActive && d.requiresAcknowledgement === true && !ackedIds.has(d.id),
    );
  }, [acks, allDocs, employeeId]);

  return { pending, loading };
}

/**
 * usePendingAcknowledgementCount — badge count for the Documents nav item.
 * Subscribes to employee's own acks + active policy docs requiring acknowledgement.
 */
export function usePendingAcknowledgementCount(employeeId: string): number {
  const [requiredDocIds, setRequiredDocIds] = useState<string[]>([]);
  const [ackedIds,       setAckedIds]       = useState<Set<string>>(new Set());

  // Subscribe to docs requiring ack
  useEffect(() => {
    return onSnapshot(
      query(
        collection(db, 'company_documents'),
        where('isActive', '==', true),
        where('requiresAcknowledgement', '==', true),
      ),
      (snap) => setRequiredDocIds(snap.docs.map((d) => d.id)),
      () => setRequiredDocIds([]),
    );
  }, []);

  // Subscribe to employee's acks
  useEffect(() => {
    if (!employeeId) return;
    return onSnapshot(
      query(collection(db, 'document_acknowledgements'), where('employeeId', '==', employeeId)),
      (snap) => setAckedIds(new Set(snap.docs.map((d) => d.data().documentId as string))),
      () => setAckedIds(new Set()),
    );
  }, [employeeId]);

  return requiredDocIds.filter((id) => !ackedIds.has(id)).length;
}

/**
 * useAcknowledgementCountMap — admin hook.
 * Returns a Record<documentId, number> of how many employees have acknowledged each doc.
 * Only subscribes when `enabled` is true (admin/hrmsManager only).
 */
export function useAcknowledgementCountMap(enabled: boolean): Record<string, number> {
  const [countMap, setCountMap] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      collection(db, 'document_acknowledgements'),
      (snap) => {
        const map: Record<string, number> = {};
        snap.docs.forEach((d) => {
          const docId = d.data().documentId as string;
          map[docId] = (map[docId] ?? 0) + 1;
        });
        setCountMap(map);
      },
      () => setCountMap({}),
    );
  }, [enabled]);
  return countMap;
}

// ── Mutation ──────────────────────────────────────────────────────────────────

/** Record an employee's acknowledgement of a company document. Immutable once written. */
export async function acknowledgeDocument(data: {
  documentId: string;
  documentTitle: string;
  employeeId: string;
  employeeName: string;
}) {
  await addDoc(collection(db, 'document_acknowledgements'), {
    ...data,
    method:          'checkbox',
    acknowledgedAt:  serverTimestamp(),
  });
}
