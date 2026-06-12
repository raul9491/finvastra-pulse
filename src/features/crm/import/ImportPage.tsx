import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useImportJob } from '../hooks/useImportJobs';
import { auth } from '../../../lib/firebase';

// ─── API helper ───────────────────────────────────────────────────────────────
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

// ─── Types ────────────────────────────────────────────────────────────────────
interface PreviewRow {
  rowNumber: number;
  data: Record<string, string>;
  valid: boolean;
  errors: string[];
}

type ColMap = Record<string, number>;   // field -> 0-based column index

// Human-readable labels for each extractable field
const FIELD_LABELS: Record<string, string> = {
  displayName:    'Name',
  phone:          'Phone',
  email:          'Email',
  panRaw:         'PAN',
  loanProduct:    'Product',
  dealSize:       'Deal ₹',
  address:        'Address',
  triagePriority: 'Priority',
  notes:          'Notes',
};

// Only Name + Phone are truly required — a contact list with no product column
// imports as raw leads (no opportunity). Forcing Product here once pushed users
// to map unrelated columns (e.g. a date) into it, failing every row.
const REQUIRED_FIELDS = ['displayName', 'phone'];

// Convert 0-based index to spreadsheet column letter (0→A, 25→Z, 26→AA …)
function colLetter(idx: number): string {
  let s = '';
  let n = idx + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ─── ImportPage ───────────────────────────────────────────────────────────────

export function ImportPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const isAdmin = profile?.role === 'admin';
  const canRun  = isAdmin || profile?.crmRole === 'manager';

  // ── Step 1 state ─────────────────────────────────────────────────────────
  const [importName,  setImportName]  = useState('');
  const [nameError,   setNameError]   = useState('');
  const [sheetUrl,    setSheetUrl]    = useState('');
  const [saEmail,     setSaEmail]     = useState('');
  const [checkStatus, setCheckStatus] = useState<'idle'|'checking'|'ok'|'error'>('idle');
  const [checkMsg,    setCheckMsg]    = useState('');

  // ── Step 2 state ─────────────────────────────────────────────────────────
  const [previewRows,    setPreviewRows]    = useState<PreviewRow[]>([]);
  const [totalRows,      setTotalRows]      = useState(0);
  const [sheetHeaders,   setSheetHeaders]   = useState<string[]>([]);
  const [detectedMap,    setDetectedMap]    = useState<ColMap>({});
  const [confirmedMap,   setConfirmedMap]   = useState<ColMap>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError,   setPreviewError]   = useState('');
  const [skipErrors,     setSkipErrors]     = useState(false);

  // ── Step 3 state ─────────────────────────────────────────────────────────
  const [runLoading,     setRunLoading]     = useState(false);
  const [runError,       setRunError]       = useState('');
  const [activeJobId,    setActiveJobId]    = useState<string | null>(null);
  const liveJob = useImportJob(activeJobId);

  // Fetch service account email on mount
  useEffect(() => {
    fetch('/api/import/service-account-email')
      .then(r => r.json())
      .then(d => setSaEmail(d.email ?? ''))
      .catch(() => {});
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────

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
    setPreviewRows([]); setSheetHeaders([]); setDetectedMap({}); setConfirmedMap({});
    try {
      const data = await apiPost('/api/import/preview', { sheetUrl });
      setPreviewRows(data.rows ?? []);
      setTotalRows(data.totalRows ?? data.rows?.length ?? 0);
      const headers: string[] = data.headers ?? [];
      const mapping: ColMap   = data.mapping  ?? {};
      setSheetHeaders(headers);
      setDetectedMap(mapping);
      setConfirmedMap(mapping);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Preview failed.');
    } finally { setPreviewLoading(false); }
  };

  const updateMapping = (field: string, colIdx: number) => {
    setConfirmedMap(prev => {
      const next = { ...prev };
      // Remove this field from previous assignment
      Object.keys(next).forEach(f => { if (next[f] === colIdx && f !== field) delete next[f]; });
      if (colIdx < 0) { delete next[field]; } else { next[field] = colIdx; }
      return next;
    });
  };

  const handleRun = async () => {
    if (!canRun) return;
    if (importName.trim().length < 2) {
      setNameError('Give this import a name so you can track its source later.');
      return;
    }
    setRunLoading(true); setRunError('');
    try {
      const data = await apiPost('/api/import/run', {
        sheetUrl,
        skipErrors,
        columnMapping: confirmedMap,
        importName: importName.trim(),
      });
      setActiveJobId(data.jobId);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Import failed to start.');
    } finally { setRunLoading(false); }
  };

  // ── Derived state ─────────────────────────────────────────────────────────
  const errorCount    = previewRows.filter(r => !r.valid).length;
  const missingReqd   = REQUIRED_FIELDS.filter(f => confirmedMap[f] === undefined);
  const canRunImport  = checkStatus === 'ok'
    && previewRows.length > 0
    && (errorCount === 0 || skipErrors)
    && missingReqd.length === 0
    && importName.trim().length >= 2;

  const jobDone = liveJob?.status === 'completed' || liveJob?.status === 'failed' || liveJob?.status === 'partial';
  const jobPct  = liveJob ? Math.round((liveJob.processedRows / Math.max(liveJob.totalRows, 1)) * 100) : 0;

  // Build display rows using confirmed mapping
  const displayFields = Object.keys(FIELD_LABELS).filter(f => confirmedMap[f] !== undefined);

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-3xl mb-1"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          Bulk Import
        </h2>
        <p className="text-sm" style={{ color: 'var(--shell-text-dim)' }}>
          Import leads from a Google Sheet — any column order is auto-detected.
        </p>
      </div>

      {/* ── Step 1 — Sheet access ─────────────────────────────────────────── */}
      <div className="glass-panel p-6 space-y-4">
        <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>
          Step 1 — Name &amp; Sheet Access
        </h3>

        {/* Import name — mandatory; lets you track each sheet's source & quality later */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5"
            style={{ color: nameError ? '#f87171' : 'var(--shell-text-dim)' }}>
            Import name <span style={{ color: '#f87171' }}>*</span>
            {nameError && <span className="ml-2 normal-case tracking-normal font-medium" style={{ color: '#f87171' }}>— {nameError}</span>}
          </label>
          <input type="text" value={importName}
            onChange={(e) => { setImportName(e.target.value); if (nameError) setNameError(''); }}
            placeholder="e.g. Facebook Jan campaign · Vendor XYZ Apr batch"
            className="glass-inp w-full text-sm"
            style={{ borderColor: nameError ? 'rgba(248,113,113,0.5)' : undefined }} />
          <p className="mt-1 text-[11px]" style={{ color: 'var(--shell-text-dim)' }}>
            Used to track where these leads came from — so you can later spot which sources convert.
          </p>
        </div>

        {saEmail && (
          <div className="text-sm p-3 rounded-lg"
            style={{ backgroundColor: 'rgba(201,169,97,0.08)', color: 'var(--text-primary)', border: '1px solid rgba(201,169,97,0.20)' }}>
            Share your Sheet with:&nbsp;
            <code className="font-mono font-bold" style={{ color: '#C9A961' }}>{saEmail}</code>
          </div>
        )}

        <div className="flex gap-2">
          <input type="text" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)}
            placeholder="Paste Google Sheet URL…"
            className="glass-inp flex-1 text-sm" />
          <button onClick={handleCheck} disabled={!sheetUrl.trim() || checkStatus === 'checking'}
            className="px-5 py-2.5 text-sm font-semibold rounded-lg disabled:opacity-50 border transition-colors"
            style={{ color: 'var(--text-primary)', borderColor: 'var(--shell-border)' }}>
            {checkStatus === 'checking' ? <Loader2 size={14} className="animate-spin" /> : 'Check Access'}
          </button>
        </div>

        {checkStatus === 'ok' && (
          <p className="flex items-center gap-1.5 text-sm" style={{ color: '#34d399' }}>
            <CheckCircle2 size={14} />{checkMsg}
          </p>
        )}
        {checkStatus === 'error' && (
          <p className="flex items-center gap-1.5 text-sm" style={{ color: '#f87171' }}>
            <AlertCircle size={14} />{checkMsg}
          </p>
        )}
      </div>

      {/* ── Step 2 — Preview + column mapping ────────────────────────────── */}
      {checkStatus === 'ok' && (
        <div className="glass-panel p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>
              Step 2 — Preview &amp; Column Mapping
            </h3>
            <button onClick={handlePreview} disabled={previewLoading}
              className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg transition-opacity hover:opacity-80"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {previewLoading
                ? <><Loader2 size={14} className="animate-spin" /> Detecting…</>
                : <><RefreshCw size={14} /> {previewRows.length > 0 ? 'Re-preview' : 'Preview Sheet'}</>}
            </button>
          </div>

          {previewError && (
            <p className="text-sm" style={{ color: '#f87171' }}>{previewError}</p>
          )}

          {/* ── Detected column mapping editor ── */}
          {sheetHeaders.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Detected column mapping — verify each field, fix if wrong
                </p>
                <button onClick={() => setConfirmedMap(detectedMap)}
                  className="text-[10px] font-semibold px-2 py-1 rounded transition-opacity hover:opacity-70"
                  style={{ color: '#C9A961', border: '1px solid rgba(201,169,97,0.25)' }}>
                  Reset to auto-detected
                </button>
              </div>

              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--shell-border)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--glass-panel-bg)', borderBottom: '1px solid var(--shell-border)' }}>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>Field</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>Maps to column</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>Sample value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(FIELD_LABELS).map((field) => {
                      const isRequired = REQUIRED_FIELDS.includes(field);
                      const colIdx     = confirmedMap[field] ?? -1;
                      const isMissing  = isRequired && colIdx < 0;
                      const sampleVal  = colIdx >= 0 && previewRows[0]?.data[field] ? previewRows[0].data[field] : '—';
                      return (
                        <tr key={field} style={{ borderBottom: '1px solid var(--shell-border)' }}>
                          <td className="px-4 py-2.5 font-semibold" style={{ color: isMissing ? '#f87171' : 'var(--text-primary)' }}>
                            {FIELD_LABELS[field]}
                            {isRequired && <span className="ml-1 text-[10px] font-bold" style={{ color: '#f87171' }}>*</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            <select
                              value={colIdx}
                              onChange={(e) => updateMapping(field, Number(e.target.value))}
                              className="glass-inp text-xs py-1.5 px-2 rounded-lg"
                              style={{ minWidth: 160, borderColor: isMissing ? 'rgba(248,113,113,0.5)' : undefined }}
                            >
                              <option value={-1}>— Not in this sheet —</option>
                              {sheetHeaders.map((h, i) => (
                                <option key={i} value={i}>
                                  Col {colLetter(i)}: {h || `(col ${i+1})`}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-2.5 text-xs font-mono" style={{ color: 'var(--shell-text-secondary)', maxWidth: 160 }}>
                            <span className="truncate block max-w-[140px]">{sampleVal}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {missingReqd.length > 0 && (
                <p className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(248,113,113,0.08)', color: '#f87171', border: '1px solid rgba(248,113,113,0.20)' }}>
                  Required fields not mapped: <strong>{missingReqd.map(f => FIELD_LABELS[f]).join(', ')}</strong>. Assign them above before importing.
                </p>
              )}
            </div>
          )}

          {/* ── Preview table ── */}
          {previewRows.length > 0 && (
            <>
              <div style={{ borderTop: '1px solid var(--shell-border)', paddingTop: 16 }}>
                <p className="text-sm mb-3" style={{ color: 'var(--shell-text-dim)' }}>
                  Total in sheet: <strong style={{ color: 'var(--text-primary)' }}>{totalRows}</strong>
                  {' · '}Valid in preview: <strong style={{ color: '#34d399' }}>{previewRows.filter(r=>r.valid).length}</strong>
                  {' · '}Errors: <strong style={{ color: '#f87171' }}>{errorCount}</strong>
                </p>
                <div className="overflow-auto rounded-lg" style={{ maxHeight: 380, border: '1px solid var(--shell-border)' }}>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr style={{ backgroundColor: 'var(--glass-panel-bg)', borderBottom: '1px solid var(--shell-border)', position: 'sticky', top: 0, zIndex: 1 }}>
                        <th className="px-3 py-2 font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>#</th>
                        {displayFields.map((f) => (
                          <th key={f} className="px-3 py-2 font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: 'var(--shell-text-dim)' }}>
                            {FIELD_LABELS[f]}
                          </th>
                        ))}
                        {errorCount > 0 && <th className="px-3 py-2 font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>Issue</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row) => (
                        <tr key={row.rowNumber}
                          style={{
                            borderBottom: '1px solid var(--shell-border)',
                            backgroundColor: row.valid ? undefined : 'rgba(248,113,113,0.06)',
                          }}>
                          <td className="px-3 py-2" style={{ color: 'var(--shell-text-dim)' }}>{row.rowNumber}</td>
                          {displayFields.map((f) => (
                            <td key={f} className="px-3 py-2 max-w-[130px]"
                              style={{ color: row.valid ? 'var(--text-primary)' : '#f87171' }}>
                              <span className="block truncate">{row.data[f] || '—'}</span>
                            </td>
                          ))}
                          {errorCount > 0 && (
                            <td className="px-3 py-2 text-[10px]" style={{ color: '#f87171', maxWidth: 180 }}>
                              {row.errors.join(' · ') || ''}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {errorCount > 0 && (
                <div className="text-sm p-3 rounded-lg"
                  style={{ backgroundColor: 'rgba(248,113,113,0.08)', color: '#f87171', border: '1px solid rgba(248,113,113,0.20)' }}>
                  {errorCount} row(s) have validation issues.
                  <label className="flex items-center gap-2 cursor-pointer mt-2">
                    <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} />
                    Skip error rows and import valid rows only
                  </label>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Step 3 — Run import ───────────────────────────────────────────── */}
      {canRun && previewRows.length > 0 && missingReqd.length === 0 && (
        <div className="glass-panel p-6 space-y-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>
            Step 3 — Run Import
          </h3>
          <p className="text-sm" style={{ color: 'var(--shell-text-dim)' }}>
            Will import <strong style={{ color: 'var(--text-primary)' }}>{totalRows}</strong> total rows
            {skipErrors && errorCount > 0 ? ` (${errorCount} skipped)` : ''}
            {' '}under <strong style={{ color: '#C9A961' }}>{importName.trim() || 'this import'}</strong>.
            {' '}Leads land in the <strong style={{ color: 'var(--text-primary)' }}>Import Queue</strong> unassigned — you'll route them to agents from there.
          </p>
          <button onClick={handleRun} disabled={!canRunImport || runLoading || !!activeJobId}
            className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold disabled:opacity-40 transition-opacity hover:opacity-80"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            {runLoading ? <Loader2 size={14} className="animate-spin" /> : null}
            {runLoading ? 'Starting…' : `Import ${totalRows} Leads`}
          </button>
          {runError && <p className="text-sm" style={{ color: '#f87171' }}>{runError}</p>}
        </div>
      )}

      {/* ── Live progress ─────────────────────────────────────────────────── */}
      {liveJob && (
        <div className="glass-panel p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>
              Import Progress
            </h3>
            <span className={
              liveJob.status === 'completed' ? 'badge-glass-success' :
              liveJob.status === 'failed'    ? 'badge-glass-danger'  : 'badge-glass-warning'
            }>
              {liveJob.status}
            </span>
          </div>
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${jobPct}%`, backgroundColor: liveJob.status === 'failed' ? '#f87171' : '#C9A961' }} />
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            {[
              { label: 'Processed', value: liveJob.processedRows },
              { label: 'Imported',  value: liveJob.successCount  },
              { label: 'Errors',    value: liveJob.errorCount    },
            ].map(({ label, value }) => (
              <div key={label} className="glass-panel rounded-xl p-3">
                <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>{label}</p>
              </div>
            ))}
          </div>
          {jobDone && (
            <div className="flex gap-4">
              <button onClick={() => navigate('/crm/import/queue')}
                className="text-sm font-semibold hover:underline" style={{ color: '#C9A961' }}>
                Distribute to agents →
              </button>
              <button onClick={() => navigate('/crm/import/history')}
                className="text-sm hover:underline" style={{ color: 'var(--shell-text-secondary)' }}>
                Import history
              </button>
            </div>
          )}
        </div>
      )}

      {/* No access fallback */}
      {!canRun && (
        <div className="glass-panel p-6 text-center">
          <ExternalLink size={24} className="mx-auto mb-3" style={{ color: 'var(--shell-text-dim)' }} />
          <p className="text-sm" style={{ color: 'var(--shell-text-dim)' }}>
            Import access not granted. Ask your admin to enable bulk import for your account.
          </p>
        </div>
      )}
    </div>
  );
}
