import { useState, useEffect } from 'react';
import { doc, collection, onSnapshot, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
// NOTE: serverTimestamp() can't go inside arrays, so ISO strings are used for log entries
import { db } from '../../../lib/firebase';
import type { DocumentTypeId, DocumentStatus, DocumentType, ConditionalDocumentRule } from '../../../types';

// ─── Document types collection ────────────────────────────────────────────────
export function useDocumentTypes(): DocumentType[] {
  const [docTypes, setDocTypes] = useState<DocumentType[]>([]);

  useEffect(() => {
    return onSnapshot(collection(db, 'document_types'), (snap) => {
      setDocTypes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DocumentType)));
    });
  }, []);

  return docTypes;
}

// ─── Document checklist for a bank submission ─────────────────────────────────
export function useDocumentChecklist(
  leadId: string | null,
  oppId: string | null,
  subId: string | null,
  requiredDocuments: DocumentTypeId[],
  conditionalDocuments: ConditionalDocumentRule[],
  customFields: Record<string, unknown> | undefined,
): {
  resolvedDocuments: DocumentTypeId[];
  documentStatus: Record<DocumentTypeId, DocumentStatus>;
  loading: boolean;
} {
  const [documentStatus, setDocumentStatus] = useState<Record<DocumentTypeId, DocumentStatus>>({});
  const [loading, setLoading] = useState(true);

  // Compute which documents are required, including conditional ones
  const extra: DocumentTypeId[] = [];
  for (const rule of conditionalDocuments) {
    const fieldValue = customFields?.[rule.when.field];
    if (fieldValue === rule.when.equals) {
      extra.push(...rule.addDocuments);
    }
  }
  const resolvedDocuments = [...new Set([...requiredDocuments, ...extra])];

  useEffect(() => {
    if (!leadId || !oppId || !subId) {
      setLoading(false);
      return;
    }
    const subRef = doc(db, 'leads', leadId, 'opportunities', oppId, 'bank_submissions', subId);
    return onSnapshot(subRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as { documentStatus?: Record<DocumentTypeId, DocumentStatus> };
        setDocumentStatus(data.documentStatus ?? {});
      }
      setLoading(false);
    }, () => setLoading(false));
  }, [leadId, oppId, subId]);

  return { resolvedDocuments, documentStatus, loading };
}

// ─── Status advance map ────────────────────────────────────────────────────────
// Cycles: pending → collected → submitted → accepted (terminal for advance)
const ADVANCE_MAP: Record<DocumentStatus, DocumentStatus | null> = {
  pending:   'collected',
  collected: 'submitted',
  submitted: 'accepted',
  accepted:  null,
  rejected:  null,
};

// ─── Advance document status ──────────────────────────────────────────────────
export async function advanceDocumentStatus(
  leadId: string,
  oppId: string,
  subId: string,
  docTypeId: DocumentTypeId,
  currentStatus: DocumentStatus,
  by: string,
): Promise<void> {
  const next = ADVANCE_MAP[currentStatus];
  if (!next) return;
  const at = new Date().toISOString();
  const subRef = doc(db, 'leads', leadId, 'opportunities', oppId, 'bank_submissions', subId);
  await updateDoc(subRef, {
    [`documentStatus.${docTypeId}`]: next,
    documentStatusLog: arrayUnion({
      docTypeId,
      from: currentStatus,
      to: next,
      by,
      at,
    }),
    updatedAt: serverTimestamp(),
  });
}

// ─── Reject document ──────────────────────────────────────────────────────────
export async function rejectDocument(
  leadId: string,
  oppId: string,
  subId: string,
  docTypeId: DocumentTypeId,
  currentStatus: DocumentStatus,
  by: string,
): Promise<void> {
  const at = new Date().toISOString();
  const subRef = doc(db, 'leads', leadId, 'opportunities', oppId, 'bank_submissions', subId);
  await updateDoc(subRef, {
    [`documentStatus.${docTypeId}`]: 'rejected',
    documentStatusLog: arrayUnion({
      docTypeId,
      from: currentStatus,
      to: 'rejected' as DocumentStatus,
      by,
      at,
    }),
    updatedAt: serverTimestamp(),
  });
}
