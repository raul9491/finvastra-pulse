import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot, doc,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { auth } from '../../../lib/firebase';
import type { ImportJob } from '../../../types';

/** Real-time listener for a single import job (used for live progress). */
export function useImportJob(jobId: string | null) {
  const [job, setJob] = useState<ImportJob | null>(null);

  useEffect(() => {
    if (!jobId) return;
    return onSnapshot(doc(db, 'import_jobs', jobId), (snap) => {
      setJob(snap.exists() ? ({ id: snap.id, ...snap.data() } as ImportJob) : null);
    });
  }, [jobId]);

  return job;
}

/** List of past import jobs for the history page. */
export function useImportHistory(isAdmin: boolean) {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const uid = auth.currentUser?.uid;

  useEffect(() => {
    if (!uid) return;
    const base = collection(db, 'import_jobs');
    const q = isAdmin
      ? query(base, orderBy('startedAt', 'desc'))
      : query(base, where('triggeredBy', '==', uid), orderBy('startedAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImportJob)));
      setLoading(false);
    }, () => setLoading(false));
  }, [uid, isAdmin]);

  return { jobs, loading };
}

/** Helper to download the error CSV for a completed import job. */
export function downloadErrorCsv(job: ImportJob): void {
  if (!job.errors?.length) return;
  const header = 'row,displayName,phone,email,panRaw,loanProduct,dealSize,triagePriority,notes,reason\n';
  const rows = job.errors.map((e) => {
    const d = e.data;
    const cols = [e.row, d.displayName, d.phone, d.email, d.panRaw, d.loanProduct, d.dealSize, d.triagePriority, d.notes, e.reason]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',');
    return cols;
  });
  const csv = header + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `import-errors-${job.batchId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
