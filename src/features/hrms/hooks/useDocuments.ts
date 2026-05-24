import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../../lib/firebase';
import type { CompanyDocument, EmployeeDocument, CompanyDocumentCategory, EmployeeDocumentType } from '../../../types';

// ─── Company Documents ────────────────────────────────────────────────────────

export function useCompanyDocuments(category?: CompanyDocumentCategory) {
  const [docs, setDocs] = useState<CompanyDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const constraints: Parameters<typeof query>[1][] = [
      where('isActive', '==', true),
      orderBy('uploadedAt', 'desc'),
    ];
    if (category) constraints.unshift(where('category', '==', category));
    const q = query(collection(db, 'company_documents'), ...constraints);
    return onSnapshot(q, (snap) => {
      setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CompanyDocument));
      setLoading(false);
    }, () => setLoading(false));
  }, [category]);

  return { docs, loading };
}

export function useAllCompanyDocuments() {
  const [docs, setDocs] = useState<CompanyDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'company_documents'), orderBy('uploadedAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CompanyDocument));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  return { docs, loading };
}

// ─── Employee Documents ───────────────────────────────────────────────────────

export function useMyEmployeeDocuments(employeeId: string) {
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employeeId) { setLoading(false); return; }
    const q = query(
      collection(db, 'employee_documents'),
      where('employeeId', '==', employeeId),
      where('isActive', '==', true),
      orderBy('uploadedAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as EmployeeDocument));
      setLoading(false);
    }, () => setLoading(false));
  }, [employeeId]);

  return { docs, loading };
}

export function useEmployeeDocuments(employeeId: string) {
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employeeId) { setLoading(false); return; }
    const q = query(
      collection(db, 'employee_documents'),
      where('employeeId', '==', employeeId),
      orderBy('uploadedAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as EmployeeDocument));
      setLoading(false);
    }, () => setLoading(false));
  }, [employeeId]);

  return { docs, loading };
}

// ─── Upload helpers ───────────────────────────────────────────────────────────

export async function uploadFileToStorage(
  file: File,
  path: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file);
    task.on('state_changed',
      (snap) => { if (onProgress) onProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)); },
      reject,
      async () => { resolve(await getDownloadURL(task.snapshot.ref)); },
    );
  });
}

// ─── Admin write helpers ──────────────────────────────────────────────────────

export async function addCompanyDocument(params: {
  title: string;
  category: CompanyDocumentCategory;
  description: string;
  fileUrl: string;
  uploadedBy: string;
  financialYear: string | null;
}) {
  await addDoc(collection(db, 'company_documents'), {
    ...params,
    isActive: true,
    uploadedAt: serverTimestamp(),
  });
}

export async function deactivateCompanyDocument(docId: string) {
  await updateDoc(doc(db, 'company_documents', docId), { isActive: false });
}

export async function addEmployeeDocument(params: {
  employeeId: string;
  documentType: EmployeeDocumentType;
  title: string;
  fileUrl: string;
  uploadedBy: string;
  financialYear: string | null;
}) {
  await addDoc(collection(db, 'employee_documents'), {
    ...params,
    isActive: true,
    uploadedAt: serverTimestamp(),
  });
}

export async function deactivateEmployeeDocument(docId: string) {
  await updateDoc(doc(db, 'employee_documents', docId), { isActive: false });
}
