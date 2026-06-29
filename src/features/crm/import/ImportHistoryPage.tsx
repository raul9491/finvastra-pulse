import { Fragment, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Download, ArrowLeft, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { useImportHistory, downloadErrorCsv, retryImportErrors } from '../hooks/useImportJobs';
import type { ImportJobStatus } from '../../../types';

const STATUS_BADGE: Record<ImportJobStatus, string> = {
  processing: 'badge-glass-warning',
  completed:  'badge-glass-success',
  partial:    'badge-glass-info',
  failed:     'badge-glass-danger',
};

export function ImportHistoryPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { jobs, loading } = useImportHistory(isAdmin);
  const toast = useToast();
  const [openErrors, setOpenErrors] = useState<string | null>(null);   // jobId whose errors are expanded
  const [retrying, setRetrying] = useState<string | null>(null);

  const handleRetry = async (jobId: string) => {
    setRetrying(jobId);
    try {
      const r = await retryImportErrors(jobId);
      if (r.imported > 0) {
        toast.success(`${r.imported} row${r.imported === 1 ? '' : 's'} imported.${r.stillFailing > 0 ? ` ${r.stillFailing} still failing.` : ' All fixed!'}${r.duplicates ? ` (${r.duplicates} were already in the system.)` : ''}`);
      } else if (r.duplicates > 0) {
        toast.info(`No new rows — ${r.duplicates} were already in the system. ${r.stillFailing} still failing.`);
      } else {
        toast.info(`No rows could be recovered — ${r.stillFailing} still have errors. Fix them in the sheet and re-import.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Retry failed');
    } finally {
      setRetrying(null);
    }
  };

  const fmtDate = (ts: unknown) => {
    if (!ts) return '—';
    if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
      return format((ts as { toDate: () => Date }).toDate(), 'dd MMM yyyy, HH:mm');
    }
    return '—';
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <button onClick={() => navigate('/crm/import')}
        className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={15} /> Back to Import
      </button>

      <div>
        <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          Import History
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>All past import jobs. Click the red error count to see what failed.</p>
      </div>

      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="animate-pulse">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14" style={{ borderBottom: '1px solid var(--shell-border)', backgroundColor: 'var(--shell-hover-soft)' }} />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No import jobs yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--shell-hover-soft)', borderBottom: '1px solid var(--shell-border)' }}>
                  {['Name', 'Batch ID', 'Started', 'Total', 'Imported', 'Duplicates', 'Errors', 'Distributed', 'Status', ''].map((h, i) => (
                    <th key={i} className="px-3 py-3 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const open = openErrors === job.id;
                  return (
                  <Fragment key={job.id}>
                  <tr className="hover:bg-(--shell-hover-soft) transition-colors"
                    style={{ borderBottom: open ? 'none' : '1px solid var(--shell-border)' }}>
                    <td className="px-3 py-3">
                      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{job.importName || '—'}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-xs font-mono whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{job.batchId}</p>
                    </td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{fmtDate(job.startedAt)}</td>
                    <td className="px-3 py-3" style={{ color: 'var(--text-primary)' }}>{job.totalRows}</td>
                    <td className="px-3 py-3 font-semibold" style={{ color: '#34d399' }}>{job.successCount}</td>
                    <td className="px-3 py-3">
                      {(job.duplicateCount ?? 0) > 0
                        ? <span className="font-semibold" style={{ color: '#d4a64a' }} title="Already in the system or repeated within the sheet — skipped, not imported again">{job.duplicateCount}</span>
                        : <span style={{ color: 'var(--text-muted)' }}>0</span>}
                    </td>
                    <td className="px-3 py-3">
                      {job.errorCount > 0 ? (
                        <button onClick={() => setOpenErrors(open ? null : job.id)}
                          className="inline-flex items-center gap-1 font-semibold hover:underline"
                          style={{ color: '#f87171' }}>
                          {job.errorCount} {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>
                      ) : <span style={{ color: 'var(--text-muted)' }}>0</span>}
                    </td>
                    <td className="px-3 py-3">
                      {job.distributed
                        ? <span className="badge-glass-success whitespace-nowrap">{job.distributedCount ?? 0} sent</span>
                        : (job.successCount ?? 0) > 0
                          ? <span className="badge-glass-warning">Awaiting</span>
                          : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <span className={STATUS_BADGE[job.status]}>{job.status}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-3 whitespace-nowrap">
                        <button onClick={() => navigate(`/crm/leads?importBatchId=${job.batchId}`)}
                          className="text-xs font-semibold hover:underline" style={{ color: '#60a5fa' }}>
                          View leads
                        </button>
                        {job.errorCount > 0 && (
                          <button onClick={() => downloadErrorCsv(job)}
                            className="flex items-center gap-1 text-xs font-semibold hover:underline" style={{ color: 'var(--text-muted)' }}>
                            <Download size={11} /> CSV
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded error detail — see exactly which rows failed and why */}
                  {open && (
                    <tr style={{ borderBottom: '1px solid var(--shell-border)' }}>
                      <td colSpan={10} className="px-4 py-3" style={{ backgroundColor: 'var(--shell-hover-soft)' }}>
                        {job.errors?.length ? (
                          <>
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                                {job.errors.length} row{job.errors.length === 1 ? '' : 's'} skipped — reason shown in red
                              </p>
                              <button onClick={() => handleRetry(job.id)} disabled={retrying === job.id}
                                title="Re-check these failed rows with the latest rules and import the ones that now pass (no duplicates)"
                                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                                style={{ backgroundColor: '#0B1538', color: '#E5C97C' }}>
                                <RefreshCw size={12} className={retrying === job.id ? 'animate-spin' : ''} />
                                {retrying === job.id ? 'Retrying…' : 'Retry failed rows'}
                              </button>
                            </div>
                            <div className="space-y-1 max-h-72 overflow-auto pr-1">
                              {job.errors.map((e, i) => (
                                <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs px-2.5 py-1.5 rounded-lg"
                                  style={{ backgroundColor: 'var(--glass-panel-bg)' }}>
                                  <span className="font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>Row {e.row}</span>
                                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{e.data?.displayName || '(no name)'}</span>
                                  {e.data?.phone && <span style={{ color: 'var(--text-secondary)' }}>{e.data.phone}</span>}
                                  <span className="font-medium" style={{ color: '#f87171' }}>{e.reason}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            Error details aren’t stored for this job — use “CSV” to download them.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
