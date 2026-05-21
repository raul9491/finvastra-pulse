import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useImportJob } from '../hooks/useImportJobs';
import { auth } from '../../../lib/firebase';

// ─── API helpers ──────────────────────────────────────────────────────────────
async function apiPost(path: string, body: object) {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

interface PreviewRow {
  rowNumber: number;
  data: Record<string, string>;
  valid: boolean;
  errors: string[];
}

const COLUMNS = ['displayName','phone','email','panRaw','loanProduct','dealSize','triagePriority','notes'] as const;
const COL_LABELS: Record<string, string> = {
  displayName:'Name', phone:'Phone', email:'Email', panRaw:'PAN',
  loanProduct:'Product', dealSize:'Deal ₹', triagePriority:'Priority', notes:'Notes',
};

export function ImportPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const canRun  = isAdmin || profile?.crmRole === 'manager';

  const [sheetUrl,       setSheetUrl]       = useState('');
  const [saEmail,        setSaEmail]        = useState('');
  const [templateUrl,    setTemplateUrl]    = useState('');
  const [checkStatus,    setCheckStatus]    = useState<'idle'|'checking'|'ok'|'error'>('idle');
  const [checkMsg,       setCheckMsg]       = useState('');
  const [previewRows,    setPreviewRows]    = useState<PreviewRow[]>([]);
  const [totalRows,      setTotalRows]      = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError,   setPreviewError]   = useState('');
  const [skipErrors,     setSkipErrors]     = useState(false);
  const [runLoading,     setRunLoading]     = useState(false);
  const [runError,       setRunError]       = useState('');
  const [activeJobId,    setActiveJobId]    = useState<string | null>(null);
  const liveJob = useImportJob(activeJobId);

  // Fetch service account email on mount
  useEffect(() => {
    fetch('/api/import/service-account-email')
      .then(r => r.json())
      .then(d => { setSaEmail(d.email ?? ''); setTemplateUrl(d.templateSheetUrl ?? ''); })
      .catch(() => {});
  }, []);

  const handleCheck = async () => {
    if (!sheetUrl.trim()) return;
    setCheckStatus('checking'); setCheckMsg('');
    try {
      await apiPost('/api/import/check', { sheetUrl });
      setCheckStatus('ok');
      setCheckMsg('Service account has access. Proceed to preview.');
    } catch (e) {
      setCheckStatus('error');
      setCheckMsg(e instanceof Error ? e.message : 'Check failed.');
    }
  };

  const handlePreview = async () => {
    setPreviewLoading(true); setPreviewError('');
    try {
      const data = await apiPost('/api/import/preview', { sheetUrl });
      setPreviewRows(data.rows ?? []);
      setTotalRows(data.totalRows ?? data.rows?.length ?? 0);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Preview failed.');
    } finally { setPreviewLoading(false); }
  };

  const handleRun = async () => {
    if (!canRun) return;
    setRunLoading(true); setRunError('');
    try {
      const data = await apiPost('/api/import/run', { sheetUrl, skipErrors });
      setActiveJobId(data.jobId);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Import failed to start.');
    } finally { setRunLoading(false); }
  };

  const errorCount  = previewRows.filter(r => !r.valid).length;
  const canRunImport = checkStatus === 'ok' && (previewRows.length > 0) && (errorCount === 0 || skipErrors);

  const jobDone  = liveJob?.status === 'completed' || liveJob?.status === 'failed' || liveJob?.status === 'partial';
  const jobPct   = liveJob ? Math.round((liveJob.processedRows / Math.max(liveJob.totalRows, 1)) * 100) : 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
          Bulk Import
        </h2>
        <p className="text-sm" style={{ color: '#8B8B85' }}>Import leads from a Google Sheet.</p>
      </div>

      {/* Step 1 — Sheet URL + access check */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Step 1 — Sheet Access</h3>

        {saEmail && (
          <div className="text-sm p-3 rounded-lg" style={{ backgroundColor: '#F2EFE7', color: '#2A2A2A' }}>
            Share your Sheet with: <code className="font-mono font-bold">{saEmail}</code>
            {templateUrl && templateUrl.includes('REPLACE') === false && (
              <a href={templateUrl} target="_blank" rel="noreferrer"
                className="ml-3 inline-flex items-center gap-1 font-semibold underline" style={{ color: '#0B1538' }}>
                Get template <ExternalLink size={12} />
              </a>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <input type="text" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)}
            placeholder="Paste Google Sheet URL or ID…"
            className="flex-1 text-sm px-3.5 py-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2" />
          <button onClick={handleCheck} disabled={!sheetUrl.trim() || checkStatus === 'checking'}
            className="px-5 py-2.5 text-sm font-semibold rounded-lg disabled:opacity-50 border border-slate-200 hover:bg-slate-50">
            {checkStatus === 'checking' ? <Loader2 size={14} className="animate-spin" /> : 'Check Access'}
          </button>
        </div>

        {checkStatus === 'ok' && (
          <p className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 size={14} />{checkMsg}</p>
        )}
        {checkStatus === 'error' && (
          <p className="flex items-center gap-1.5 text-sm text-red-500"><AlertCircle size={14} />{checkMsg}</p>
        )}
      </div>

      {/* Step 2 — Preview */}
      {checkStatus === 'ok' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Step 2 — Preview (first 50 rows)</h3>
            <button onClick={handlePreview} disabled={previewLoading}
              className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              {previewLoading ? <Loader2 size={14} className="animate-spin" /> : null}
              {previewLoading ? 'Loading…' : 'Preview First 50 Rows'}
            </button>
          </div>

          {previewError && <p className="text-sm text-red-500">{previewError}</p>}

          {previewRows.length > 0 && (
            <>
              <p className="text-sm" style={{ color: '#8B8B85' }}>
                Total rows in sheet: <strong>{totalRows}</strong> ·
                Valid in preview: <strong className="text-emerald-700">{previewRows.filter(r=>r.valid).length}</strong> ·
                Errors: <strong className="text-red-500">{errorCount}</strong>
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr style={{ backgroundColor: '#FAFAF7', borderBottom: '1px solid #E2E8F0' }}>
                      <th className="px-3 py-2 font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>#</th>
                      {COLUMNS.map((k) => (
                        <th key={k} className="px-3 py-2 font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: '#8B8B85' }}>{COL_LABELS[k]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={row.rowNumber}
                        className="border-b border-slate-100 last:border-0"
                        style={{ backgroundColor: row.valid ? undefined : '#FFF1F2' }}
                        title={row.valid ? '' : row.errors.join('\n')}>
                        <td className="px-3 py-2" style={{ color: '#8B8B85' }}>{row.rowNumber}</td>
                        {COLUMNS.map((k) => (
                          <td key={k} className="px-3 py-2 max-w-[120px] truncate" style={{ color: row.valid ? '#2A2A2A' : '#9F1239' }}>
                            {row.data[k] || <span style={{ color: '#CBD5E1' }}>—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {errorCount > 0 && (
                <div className="text-sm p-3 rounded-lg" style={{ backgroundColor: '#FFF1F2', color: '#9F1239' }}>
                  {errorCount} row(s) have validation errors (hover for details).
                  <label className="ml-3 flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} />
                    Skip rows with errors and import valid rows only
                  </label>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Step 3 — Run */}
      {canRun && previewRows.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Step 3 — Run Import</h3>
          <p className="text-sm" style={{ color: '#8B8B85' }}>
            Will import <strong>{totalRows}</strong> total rows
            {skipErrors && errorCount > 0 ? ` (${errorCount} skipped)` : ''}.
            Leads will be assigned round-robin to active lead generators.
          </p>
          <button onClick={handleRun} disabled={!canRunImport || runLoading || !!activeJobId}
            className="flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {runLoading ? <Loader2 size={14} className="animate-spin" /> : null}
            {runLoading ? 'Starting…' : 'Run Full Import'}
          </button>
          {runError && <p className="text-sm text-red-500">{runError}</p>}
        </div>
      )}

      {/* Live progress */}
      {liveJob && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Import Progress</h3>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{
                backgroundColor: liveJob.status === 'completed' ? '#F0FDF4' : liveJob.status === 'failed' ? '#FFF1F2' : '#FFFBEB',
                color: liveJob.status === 'completed' ? '#166534' : liveJob.status === 'failed' ? '#9F1239' : '#92400E',
              }}>
              {liveJob.status}
            </span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${jobPct}%`, backgroundColor: liveJob.status === 'failed' ? '#EF4444' : '#0B1538' }} />
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            {[
              { label: 'Processed', value: liveJob.processedRows },
              { label: 'Imported',  value: liveJob.successCount },
              { label: 'Errors',    value: liveJob.errorCount },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-50 rounded-xl p-3">
                <p className="text-lg font-bold" style={{ color: '#0A0A0A' }}>{value}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>{label}</p>
              </div>
            ))}
          </div>
          {jobDone && (
            <div className="flex gap-3">
              <button onClick={() => navigate('/crm/leads')}
                className="text-sm font-semibold underline" style={{ color: '#0B1538' }}>
                View imported leads →
              </button>
              <button onClick={() => navigate('/crm/import/history')}
                className="text-sm font-semibold underline" style={{ color: '#8B8B85' }}>
                Import history
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
