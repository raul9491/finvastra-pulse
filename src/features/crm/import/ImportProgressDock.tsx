import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertCircle, X, PackageOpen } from 'lucide-react';
import type { ImportJob } from '../../../types';

/**
 * Global, persistent import-progress dock. Mounted once in CrmShell so a running
 * bulk import stays visible on every CRM page (the Import page's own progress only
 * shows while you're on it). Consumes the shell's existing `import_jobs` subscription
 * — no extra Firestore listener.
 *
 * - While a job is `processing` → live progress bar (rows + %), dismissible.
 * - A `processing` job started >30 min ago is treated as STALLED (the container
 *   died mid-run) — shown as a warning card with a dismiss, never a live bar.
 * - When a watched job finishes → success/fail card with a "Distribute now"
 *   shortcut, shown until dismissed.
 * - Dismissals persist in localStorage so a dead job can't reappear on reload.
 */

const DISMISSED_KEY = 'fv_dismissed_import_jobs';
const STALL_MS = 30 * 60 * 1000;

function loadDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')); }
  catch { return new Set(); }
}
function saveDismissed(s: Set<string>): void {
  // Cap stored ids so the key never grows unbounded.
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s].slice(-50))); } catch { /* ignore */ }
}

function startedAtMs(job: ImportJob): number {
  const s = job.startedAt as { toMillis?: () => number } | undefined;
  return s?.toMillis ? s.toMillis() : 0;
}

export function ImportProgressDock({ jobs }: { jobs: ImportJob[] }) {
  const navigate = useNavigate();
  const seenProcessing = useRef<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);

  // Remember every job we've observed actively processing this session, so we can
  // show its completion card even after it leaves the `processing` state.
  useEffect(() => {
    for (const j of jobs) {
      if (j.status === 'processing') seenProcessing.current.add(j.id);
    }
  }, [jobs]);

  const dismiss = (id: string) => setDismissed((prev) => {
    const next = new Set(prev).add(id);
    saveDismissed(next);
    return next;
  });

  const now = Date.now();
  const isStalled = (j: ImportJob) => {
    const t = startedAtMs(j);
    return t > 0 && now - t > STALL_MS;
  };

  const processing = jobs.filter((j) => j.status === 'processing' && !dismissed.has(j.id) && !isStalled(j));
  const stalled = jobs.filter((j) => j.status === 'processing' && !dismissed.has(j.id) && isStalled(j));
  const finished = jobs.filter(
    (j) => j.status !== 'processing' && seenProcessing.current.has(j.id) && !dismissed.has(j.id),
  );

  if (processing.length === 0 && stalled.length === 0 && finished.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 w-[320px] max-w-[calc(100vw-2rem)]">
      {/* Live progress */}
      {processing.map((job) => {
        const pct = Math.round((job.processedRows / Math.max(job.totalRows, 1)) * 100);
        return (
          <div key={job.id} className="glass-panel p-4 shadow-xl" style={{ border: '1px solid var(--shell-border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Loader2 size={14} className="animate-spin" style={{ color: '#C9A961' }} />
              <p className="text-sm font-semibold truncate flex-1" style={{ color: 'var(--text-primary)' }}>
                Importing {job.importName || job.batchId}
              </p>
              <span className="text-xs font-bold" style={{ color: '#C9A961' }}>{pct}%</span>
              <button onClick={() => dismiss(job.id)}
                className="shrink-0 p-0.5 rounded hover:bg-(--shell-hover-mid)" aria-label="Hide">
                <X size={13} style={{ color: 'var(--shell-text-dim)' }} />
              </button>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: '#C9A961' }} />
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--shell-text-dim)' }}>
              {job.processedRows} / {job.totalRows} rows{job.errorCount > 0 ? ` · ${job.errorCount} skipped` : ''}
            </p>
          </div>
        );
      })}

      {/* Stalled — a processing job this old is dead, not slow */}
      {stalled.map((job) => (
        <div key={job.id} className="glass-panel p-4 shadow-xl" style={{ border: '1px solid rgba(251,191,36,0.4)' }}>
          <div className="flex items-start gap-2">
            <AlertCircle size={15} style={{ color: '#fbbf24' }} className="mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {job.importName || job.batchId} — stalled
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--shell-text-dim)' }}>
                Stopped at {job.processedRows}/{job.totalRows} rows. Re-run the import —
                already-imported rows are skipped automatically.
              </p>
            </div>
            <button onClick={() => dismiss(job.id)}
              className="shrink-0 p-0.5 rounded hover:bg-(--shell-hover-mid)" aria-label="Dismiss">
              <X size={14} style={{ color: 'var(--shell-text-dim)' }} />
            </button>
          </div>
        </div>
      ))}

      {/* Completed / failed */}
      {finished.map((job) => {
        const failed = job.status === 'failed';
        const ok = job.successCount ?? 0;
        return (
          <div key={job.id} className="glass-panel p-4 shadow-xl" style={{ border: '1px solid var(--shell-border)' }}>
            <div className="flex items-start gap-2">
              {failed
                ? <AlertCircle size={15} style={{ color: '#f87171' }} className="mt-0.5 shrink-0" />
                : <CheckCircle2 size={15} style={{ color: '#34d399' }} className="mt-0.5 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {job.importName || job.batchId}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--shell-text-dim)' }}>
                  {failed
                    ? 'Import failed'
                    : `${ok} lead${ok === 1 ? '' : 's'} imported${job.errorCount ? ` · ${job.errorCount} skipped` : ''}`}
                </p>
                {!failed && ok > 0 && !job.distributed && (
                  <button onClick={() => { dismiss(job.id); navigate('/crm/import/queue'); }}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold hover:underline"
                    style={{ color: '#C9A961' }}>
                    <PackageOpen size={12} /> Distribute now →
                  </button>
                )}
              </div>
              <button onClick={() => dismiss(job.id)}
                className="shrink-0 p-0.5 rounded hover:bg-(--shell-hover-mid)" aria-label="Dismiss">
                <X size={14} style={{ color: 'var(--shell-text-dim)' }} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
