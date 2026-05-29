/**
 * useCrmDocuments — CRM Document Vault
 *
 * Reads /crm_documents where opportunityId == oppId (excluding soft-deleted).
 * Uploads go through the server proxy (POST /api/crm/documents/upload) which
 * uses Firebase Admin SDK — avoids the named-Firestore-DB issue with Storage rules.
 * Deletes are soft (deleted: true) so the audit trail is preserved.
 */

import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../../../lib/firebase';
import type { CrmDocument, DocumentType } from '../../../types';

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useCrmDocuments(opportunityId: string | null) {
  const [documents, setDocuments] = useState<CrmDocument[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!opportunityId) { setLoading(false); return; }
    const q = query(
      collection(db, 'crm_documents'),
      where('opportunityId', '==', opportunityId),
      where('deleted', '==', false),
      orderBy('uploadedAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setDocuments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CrmDocument)));
      setLoading(false);
    }, () => setLoading(false));
  }, [opportunityId]);

  return { documents, loading };
}

// ─── Hook: document types (for the type picker) ───────────────────────────────
export function useDocumentTypes() {
  const [types, setTypes] = useState<DocumentType[]>([]);
  useEffect(() => {
    const q = query(collection(db, 'document_types'));
    return onSnapshot(q, (snap) => {
      setTypes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DocumentType)));
    }, () => {});
  }, []);
  return types;
}

// ─── Upload ───────────────────────────────────────────────────────────────────
// Reads file as ArrayBuffer in the browser, base64-encodes, sends to server proxy.
// Returns the Firestore document ID of the newly created /crm_documents/{id}.
export async function uploadCrmDocument(params: {
  opportunityId: string;
  leadId:        string;
  file:          File;
  docTypeId:     string | null;
  uploaderName:  string;
}): Promise<string> {
  const { opportunityId, leadId, file, docTypeId, uploaderName } = params;

  // 1. Read file as ArrayBuffer → base64
  const arrayBuffer = await file.arrayBuffer();
  const base64Data  = btoa(
    new Uint8Array(arrayBuffer).reduce((acc, b) => acc + String.fromCharCode(b), ''),
  );

  // 2. Get current user's ID token for server auth
  const idToken = await getAuth().currentUser?.getIdToken();
  if (!idToken) throw new Error('Not authenticated. Please sign in again.');

  // 3. Upload via server proxy (Admin SDK bypasses Storage rules)
  const res = await fetch('/api/crm/documents/upload', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body:    JSON.stringify({
      opportunityId,
      filename:    file.name,
      base64Data,
      contentType: file.type || 'application/octet-stream',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Upload failed (${res.status})`);
  }
  const { downloadUrl, storagePath } = await res.json() as {
    downloadUrl: string;
    storagePath: string;
  };

  // 4. Log to Firestore
  const ref = await addDoc(collection(db, 'crm_documents'), {
    opportunityId,
    leadId,
    originalName:   file.name,
    storagePath,
    storageUrl:     downloadUrl,
    fileSize:       file.size,
    contentType:    file.type || 'application/octet-stream',
    docTypeId:      docTypeId ?? null,
    uploadedBy:     getAuth().currentUser!.uid,
    uploadedByName: uploaderName,
    uploadedAt:     serverTimestamp(),
    deleted:        false,
    deletedAt:      null,
    deletedBy:      null,
  });

  return ref.id;
}

// ─── Soft delete ──────────────────────────────────────────────────────────────
export async function deleteCrmDocument(docId: string, deletedByUid: string): Promise<void> {
  await updateDoc(doc(db, 'crm_documents', docId), {
    deleted:   true,
    deletedAt: serverTimestamp(),
    deletedBy: deletedByUid,
  });
}
