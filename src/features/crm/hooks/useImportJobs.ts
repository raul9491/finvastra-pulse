import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot, doc, limit,
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

/** List of past import jobs for the history page + progress dock.
 *  Capped at the 25 most recent — job docs can carry up to 1,000 error rows
 *  each, and this subscription is mounted in CrmShell on every CRM page, so
 *  an uncapped query was re-downloading megabytes and slowing the whole app. */
export function useImportHistory(isAdmin: boolean) {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const uid = auth.currentUser?.uid;

  useEffect(() => {
    if (!uid) return;
    const base = collection(db, 'import_jobs');
    const q = isAdmin
      ? query(base, orderBy('startedAt', 'desc'), limit(25))
      : query(base, where('triggeredBy', '==', uid), orderBy('startedAt', 'desc'), limit(25));
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

/**
 * Re-process a job's FAILED rows in place — re-validates them with the current
 * logic (incl. phone salvage) and imports the now-valid ones, deduped (no
 * duplicates). Returns { imported, duplicates, stillFailing }. The live history
 * listener reflects the updated counts automatically.
 */
export async function retryImportErrors(jobId: string): Promise<{ imported: number; duplicates: number; stillFailing: number }> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not signed in');
  const res = await fetch('/api/import/retry-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobId }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Retry failed (${res.status})`);
  }
  return res.json();
}

/**
 * Re-read a batch's source sheet and stamp the extra columns (amount, city, …) onto
 * the existing leads (matched by importHash). For batches imported before importExtras
 * shipped. Idempotent. Returns { updated, totalLeads }.
 */
export async function backfillImportExtras(batchId: string): Promise<{ updated: number; totalLeads: number }> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not signed in');
  const res = await fetch('/api/import/backfill-extras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ batchId }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Backfill failed (${res.status})`);
  }
  return res.json();
}
