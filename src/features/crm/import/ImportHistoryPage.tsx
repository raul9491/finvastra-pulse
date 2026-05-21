import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Download, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useImportHistory, downloadErrorCsv } from '../hooks/useImportJobs';
import type { ImportJobStatus } from '../../../types';

const STATUS_STYLES: Record<ImportJobStatus, { bg: string; text: string }> = {
  processing: { bg: '#FFFBEB', text: '#92400E' },
  completed:  { bg: '#F0FDF4', text: '#166534' },
  partial:    { bg: '#EFF6FF', text: '#1D4ED8' },
  failed:     { bg: '#FFF1F2', text: '#9F1239' },
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
        style={{ color: '#8B8B85' }}>
        <ArrowLeft size={15} /> Back to Import
      </button>

      <div>
        <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
          Import History
        </h2>
        <p className="text-sm" style={{ color: '#8B8B85' }}>All past import jobs.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="animate-pulse divide-y divide-slate-100">
            {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-slate-50" />)}
          </div>
        ) : jobs.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: '#8B8B85' }}>No import jobs yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ backgroundColor: '#FAFAF7', borderBottom: '1px solid #E2E8F0' }}>
                  {['Batch ID', 'Started', 'Total', 'Imported', 'Errors', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const st = STATUS_STYLES[job.status];
                  return (
                    <tr key={job.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-sm font-mono font-medium" style={{ color: '#0A0A0A' }}>{job.batchId}</p>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#8B8B85' }}>{fmtDate(job.startedAt)}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>{job.totalRows}</td>
                      <td className="px-4 py-3 text-sm font-semibold" style={{ color: '#166534' }}>{job.successCount}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: job.errorCount > 0 ? '#9F1239' : '#8B8B85' }}>{job.errorCount}</td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full"
                          style={{ backgroundColor: st.bg, color: st.text }}>
                          {job.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          <button onClick={() => navigate(`/crm/leads?importBatchId=${job.batchId}`)}
                            className="text-xs font-semibold underline" style={{ color: '#0B1538' }}>
                            View leads
                          </button>
                          {job.errorCount > 0 && (
                            <button onClick={() => downloadErrorCsv(job)}
                              className="flex items-center gap-1 text-xs font-semibold underline" style={{ color: '#8B8B85' }}>
                              <Download size={11} /> Errors CSV
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
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
