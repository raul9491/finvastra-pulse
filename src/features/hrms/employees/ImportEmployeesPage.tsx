import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Upload, AlertTriangle, CheckCircle2, Users, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/14AQc2MZe9Z2EcS5e8XYVvoPERgNPL2pCVhGHaYA-bPc/edit?gid=1172437773#gid=1172437773';

interface ImportResult {
  empCode: string;
  name: string;
  email: string | null;
  status: 'created' | 'exists' | 'no_email' | 'error';
  tempPassword?: string;
  error?: string;
}

interface ImportResponse {
  dryRun: boolean;
  summary: { total: number; created: number; exists: number; noEmail: number };
  results: ImportResult[];
}

const STATUS_CONFIG = {
  created:  { label: 'Account created', bg: '#D1FAE5', text: '#065F46' },
  exists:   { label: 'Already exists',  bg: '#DBEAFE', text: '#1D4ED8' },
  no_email: { label: 'No login email',  bg: '#F1F5F9', text: '#475569' },
  error:    { label: 'Error',           bg: '#FEE2E2', text: '#991B1B' },
};

export function ImportEmployeesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [sheetUrl, setSheetUrl] = useState(SHEET_URL);
  const [previewData, setPreviewData] = useState<ImportResponse | null>(null);
  const [importData,  setImportData]  = useState<ImportResponse | null>(null);
  const [loading, setLoading] = useState<'preview' | 'import' | null>(null);
  const [error, setError] = useState('');

  const getToken = async () => {
    const token = await user?.getIdToken();
    if (!token) throw new Error('Not authenticated');
    return token;
  };

  const handlePreview = async () => {
    setLoading('preview'); setError(''); setPreviewData(null); setImportData(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/hrms/employees/import-from-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sheetUrl, dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Preview failed');
      setPreviewData(data as ImportResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setLoading(null);
    }
  };

  const handleImport = async () => {
    if (!window.confirm(`This will create ${previewData?.summary.created ?? 0} new Firebase Auth accounts and Firestore profiles. Continue?`)) return;
    setLoading('import'); setError('');
    try {
      const token = await getToken();
      const res = await fetch('/api/hrms/employees/import-from-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sheetUrl, dryRun: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Import failed');
      setImportData(data as ImportResponse);
      setPreviewData(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setLoading(null);
    }
  };

  const downloadPasswords = (results: ImportResult[]) => {
    const created = results.filter(r => r.status === 'created' && r.tempPassword);
    if (!created.length) return;
    const lines = ['Emp Code,Name,Email,Temp Password', ...created.map(r =>
      `${r.empCode},${r.name},${r.email ?? ''},${r.tempPassword}`)];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `finvastra-temp-passwords-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const activeResults = importData ?? previewData;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/hrms/employees')}
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
          style={{ color: '#8B8B85' }}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="text-3xl mb-1"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
            Import Employee Master
          </h2>
          <p className="text-sm" style={{ color: '#8B8B85' }}>
            Creates Firebase accounts + HR profiles from the Finvastra employee master sheet
          </p>
        </div>
      </div>

      {/* Skipped fields notice */}
      <div className="rounded-xl p-4 flex gap-3" style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
        <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: '#92400E' }} />
        <div className="text-sm" style={{ color: '#78350F' }}>
          <strong>Fields not imported for compliance / scope reasons:</strong>
          <span className="ml-1">Aadhaar (UIDAI prohibition) · PAN (needs encryption — separate feature) · UAN (statutory payroll, out of scope) · Bank account details (sensitive — separate feature)</span>
        </div>
      </div>

      {/* Sheet URL input */}
      <div className="rounded-2xl p-5 bg-white border border-slate-200 space-y-4">
        <h3 className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>Source Sheet</h3>
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#8B8B85' }}>
            Google Sheets URL
          </label>
          <input
            type="text"
            value={sheetUrl}
            onChange={(e) => { setSheetUrl(e.target.value); setPreviewData(null); setImportData(null); }}
            className="w-full text-sm px-3.5 py-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-navy bg-slate-50 font-mono"
            style={{ color: '#0A0A0A' }}
          />
          <p className="text-xs" style={{ color: '#8B8B85' }}>
            Sheet must be public (anyone with link can view). The gid= parameter selects the correct tab.
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={handlePreview}
            disabled={loading !== null}
            className="flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
          >
            <Users size={15} />
            {loading === 'preview' ? 'Loading preview…' : 'Preview employees'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
          {error}
        </div>
      )}

      {/* Preview / results */}
      {activeResults && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Total rows', value: activeResults.summary.total, color: '#0A0A0A' },
              { label: 'New accounts', value: activeResults.summary.created, color: '#065F46' },
              { label: 'Already exist', value: activeResults.summary.exists, color: '#1D4ED8' },
              { label: 'No email (profile only)', value: activeResults.summary.noEmail, color: '#475569' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-2xl p-4 bg-white border border-slate-200 text-center">
                <p className="text-2xl font-bold" style={{ color }}>{value}</p>
                <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>{label}</p>
              </div>
            ))}
          </div>

          {/* Action buttons (preview mode only) */}
          {activeResults.dryRun && activeResults.summary.created > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleImport}
                disabled={loading !== null}
                className="flex items-center gap-2 text-sm font-semibold px-6 py-2.5 rounded-xl transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
              >
                <Upload size={15} />
                {loading === 'import' ? 'Creating accounts…' : `Create ${activeResults.summary.created} accounts`}
              </button>
              <p className="text-xs" style={{ color: '#8B8B85' }}>
                Review the table below before confirming
              </p>
            </div>
          )}

          {/* Import complete */}
          {!activeResults.dryRun && (
            <div className="rounded-xl p-4 flex items-center justify-between"
              style={{ backgroundColor: '#D1FAE5', border: '1px solid #6EE7B7' }}>
              <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#065F46' }}>
                <CheckCircle2 size={16} />
                Import complete — {activeResults.summary.created} accounts created
              </div>
              {activeResults.summary.created > 0 && (
                <button
                  onClick={() => downloadPasswords(activeResults.results)}
                  className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg transition-opacity hover:opacity-80"
                  style={{ backgroundColor: '#065F46', color: '#FFFFFF' }}
                >
                  <Download size={14} />
                  Download temp passwords
                </button>
              )}
            </div>
          )}

          {/* Results table */}
          <div className="rounded-2xl overflow-hidden bg-white border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
                  {['Emp Code', 'Name', 'Official Email', 'Dept', 'Designation', 'Status', activeResults.dryRun ? 'Action' : 'Temp Password'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#475569' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeResults.results.map((r, idx) => {
                  const cfg = STATUS_CONFIG[r.status];
                  return (
                    <tr key={idx} style={{ borderBottom: idx < activeResults.results.length - 1 ? '1px solid #F1F5F9' : 'none', backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#FAFAF7' }}>
                      <td className="px-4 py-2.5 font-mono text-xs" style={{ color: '#8B8B85' }}>{r.empCode}</td>
                      <td className="px-4 py-2.5 font-medium" style={{ color: '#0A0A0A' }}>{r.name}</td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: '#475569' }}>{r.email ?? <span style={{ color: '#8B8B85' }}>—</span>}</td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: '#475569' }}>—</td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: '#475569' }}>—</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: cfg.bg, color: cfg.text }}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs" style={{ color: '#0A0A0A' }}>
                        {r.tempPassword ? (
                          <span className="px-2 py-0.5 rounded" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>{r.tempPassword}</span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
