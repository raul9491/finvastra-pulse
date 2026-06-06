import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Download, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useImportHistory, downloadErrorCsv } from '../hooks/useImportJobs';
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

  const fmtDate = (ts: unknown) => {
    if (!ts) return '—';
    if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
      return format((ts as { toDate: () => Date }).toDate(), 'dd MMM yyyy, HH:mm');
    }
    return '—';
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button onClick={() => navigate('/crm/import')}
        className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={15} /> Back to Import
      </button>

      <div>
        <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          Import History
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>All past import jobs.</p>
      </div>

      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="animate-pulse">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', backgroundColor: 'rgba(255,255,255,0.02)' }} />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No import jobs yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Name', 'Batch ID', 'Started', 'Total', 'Imported', 'Errors', 'Distributed', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-white/5 transition-colors"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{job.importName || '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{job.batchId}</p>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate(job.startedAt)}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>{job.totalRows}</td>
                    <td className="px-4 py-3 text-sm font-semibold" style={{ color: '#34d399' }}>{job.successCount}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: job.errorCount > 0 ? '#f87171' : 'var(--text-muted)' }}>{job.errorCount}</td>
                    <td className="px-4 py-3">
                      {job.distributed
                        ? <span className="badge-glass-success">{job.distributedCount ?? 0} sent</span>
                        : (job.successCount ?? 0) > 0
                          ? <span className="badge-glass-warning">Awaiting</span>
                          : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={STATUS_BADGE[job.status]}>{job.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button onClick={() => navigate(`/crm/leads?importBatchId=${job.batchId}`)}
                          className="text-xs font-semibold hover:underline" style={{ color: '#60a5fa' }}>
                          View leads
                        </button>
                        {job.errorCount > 0 && (
                          <button onClick={() => downloadErrorCsv(job)}
                            className="flex items-center gap-1 text-xs font-semibold hover:underline" style={{ color: 'var(--text-muted)' }}>
                            <Download size={11} /> Errors CSV
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
