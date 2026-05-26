import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Upload, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { createReferralLead } from '../hooks/useLeads';

// ─── CSV template ──────────────────────────────────────────────────────────────

const SAMPLE_CSV =
  `name,phone,email,notes\nRamesh Kumar,9876543210,ramesh@example.com,Home Loan ₹40L\nSunita Sharma,9988776655,,Term insurance enquiry`;

// ─── Parsing ──────────────────────────────────────────────────────────────────

interface ParsedRow {
  index: number;
  raw: Record<string, string>;
  // normalised
  name:  string;
  phone: string;
  email: string;
  notes: string;
  // validation
  errors: string[];
}

function parseCsv(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headers    = headerLine.split(',').map((h) => h.trim().toLowerCase());

  const get = (row: string[], key: string) => {
    const idx = headers.indexOf(key);
    return idx >= 0 ? (row[idx] ?? '').trim() : '';
  };

  return lines.slice(1).map((line, i) => {
    // Basic CSV split — handles no-quote CSVs; good enough for this template
    const cols = line.split(',');
    const name  = get(cols, 'name');
    const phone = get(cols, 'phone');
    const email = get(cols, 'email');
    const notes = get(cols, 'notes');

    const errors: string[] = [];
    if (!name || name.length < 2)          errors.push('Name is required (min 2 chars)');
    if (!phone || !/^\d{10}$/.test(phone)) errors.push('10-digit phone required');

    return {
      index: i + 2, // human row number (1 = header, so data starts at 2)
      raw:   Object.fromEntries(headers.map((h, j) => [h, cols[j] ?? ''])),
      name, phone, email, notes,
      errors,
    };
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type ImportState = 'idle' | 'preview' | 'importing' | 'done';

export function ImportReferralsPage() {
  const navigate               = useNavigate();
  const { user, profile }      = useAuth();
  const fileRef                = useRef<HTMLInputElement>(null);

  const [rows,       setRows]       = useState<ParsedRow[]>([]);
  const [fileName,   setFileName]   = useState('');
  const [importState, setImportState] = useState<ImportState>('idle');
  const [progress,   setProgress]   = useState(0);
  const [done,       setDone]       = useState({ ok: 0, failed: 0 });
  const [parseError, setParseError] = useState('');

  const validRows   = rows.filter((r) => r.errors.length === 0);
  const invalidRows = rows.filter((r) => r.errors.length > 0);

  // ── Download sample ────────────────────────────────────────────────────────
  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'referral_leads_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── File pick ──────────────────────────────────────────────────────────────
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError('');
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) { setParseError('Could not read file'); return; }
      const parsed = parseCsv(text);
      if (parsed.length === 0) {
        setParseError('No data rows found. Make sure the CSV has a header row and at least one data row.');
        return;
      }
      setRows(parsed);
      setImportState('preview');
    };
    reader.onerror = () => setParseError('Failed to read file');
    reader.readAsText(file);

    // Reset so the same file can be re-selected after edits
    e.target.value = '';
  };

  // ── Import ─────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!user || validRows.length === 0) return;
    setImportState('importing');
    setProgress(0);

    let ok = 0;
    let failed = 0;

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        await createReferralLead(
          {
            displayName:   row.name,
            phone:         row.phone,
            ...(row.email  ? { email: row.email }             : {}),
            ...(row.notes  ? { productInterest: row.notes }   : {}),
            consentMethod: 'offline_collection',
          },
          user.uid,
          profile?.displayName ?? 'An employee',
        );
        ok++;
      } catch (err) {
        console.error(`[ImportReferrals] row ${row.index} failed:`, err);
        failed++;
      }
      setProgress(i + 1);
    }

    setDone({ ok, failed });
    setImportState('done');
  };

  // ── Done screen ────────────────────────────────────────────────────────────
  if (importState === 'done') {
    return (
      <div className="max-w-lg mx-auto pt-12 text-center space-y-5">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full"
          style={{ backgroundColor: done.failed === 0 ? '#D1FAE5' : '#FEF3C7' }}>
          <CheckCircle2 size={32} style={{ color: done.failed === 0 ? '#059669' : '#D97706' }} />
        </div>
        <h2 className="text-xl font-bold" style={{ color: '#0A0A0A' }}>Import complete</h2>
        <p className="text-sm" style={{ color: '#8B8B85' }}>
          <strong>{done.ok}</strong> lead{done.ok !== 1 ? 's' : ''} submitted successfully.
          {done.failed > 0 && ` ${done.failed} failed — check the console for details.`}
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => { setImportState('idle'); setRows([]); setFileName(''); }}
            className="text-sm px-4 py-2 rounded-lg border transition-colors hover:bg-slate-50"
            style={{ borderColor: '#E2E8F0', color: '#2A2A2A' }}
          >
            Import another file
          </button>
          <button
            onClick={() => navigate('/crm/referrals')}
            className="text-sm px-4 py-2 rounded-lg font-medium"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
          >
            View My Referrals
          </button>
        </div>
      </div>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Back */}
      <button
        onClick={() => navigate('/crm/referrals')}
        className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
        style={{ color: '#8B8B85' }}
      >
        <ArrowLeft size={15} />
        My Referrals
      </button>

      <div>
        <h2 className="text-2xl font-bold" style={{ color: '#0A0A0A' }}>Import Leads from CSV</h2>
        <p className="text-sm mt-0.5" style={{ color: '#8B8B85' }}>
          Upload a CSV file of leads collected offline. All imported leads will be marked with
          your name and queued for the tele-calling team.
        </p>
      </div>

      {/* Step 1 — template */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>
              Step 1 — Download the template
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>
              Required columns: <code className="font-mono">name</code>, <code className="font-mono">phone</code>.
              Optional: <code className="font-mono">email</code>, <code className="font-mono">notes</code>.
            </p>
          </div>
          <button
            onClick={downloadSample}
            className="flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg border transition-colors hover:bg-slate-50"
            style={{ borderColor: '#E2E8F0', color: '#2A2A2A' }}
          >
            <Download size={14} />
            Download template
          </button>
        </div>
      </div>

      {/* Step 2 — upload */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <p className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>
          Step 2 — Upload your CSV file
        </p>

        {parseError && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm"
            style={{ backgroundColor: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}>
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            {parseError}
          </div>
        )}

        <div
          className="border-2 border-dashed rounded-xl flex flex-col items-center justify-center py-10 px-6 text-center cursor-pointer transition-colors hover:border-amber-400"
          style={{ borderColor: '#E2E8F0' }}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={24} className="mb-3" style={{ color: '#8B8B85' }} />
          <p className="text-sm font-medium" style={{ color: '#2A2A2A' }}>
            {fileName ? `Selected: ${fileName}` : 'Click to select a CSV file'}
          </p>
          <p className="text-xs mt-1" style={{ color: '#8B8B85' }}>.csv files only</p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFile}
          />
        </div>
      </div>

      {/* Step 3 — preview / importing */}
      {(importState === 'preview' || importState === 'importing') && rows.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between"
            style={{ borderBottom: '1px solid #E2E8F0' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>
                Step 3 — Review & Import
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>
                {validRows.length} valid · {invalidRows.length} with errors
                {invalidRows.length > 0 && ' (rows with errors will be skipped)'}
              </p>
            </div>
            <button
              onClick={handleImport}
              disabled={validRows.length === 0 || importState === 'importing'}
              className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
            >
              {importState === 'importing' ? (
                <><Loader2 size={14} className="animate-spin" /> Importing…</>
              ) : (
                <><Upload size={14} /> Import {validRows.length} lead{validRows.length !== 1 ? 's' : ''}</>
              )}
            </button>
          </div>

          {/* Progress bar while importing */}
          {importState === 'importing' && (
            <div className="px-5 py-3" style={{ borderBottom: '1px solid #E2E8F0' }}>
              <div className="flex items-center gap-3">
                <Loader2 size={14} className="animate-spin shrink-0" style={{ color: '#C9A961' }} />
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#E2E8F0' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: validRows.length > 0 ? `${(progress / validRows.length) * 100}%` : '0%', backgroundColor: '#C9A961' }}
                  />
                </div>
                <span className="text-xs shrink-0" style={{ color: '#8B8B85' }}>
                  {progress} / {validRows.length}
                </span>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                  <th className="py-2.5 pl-5 pr-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#8B8B85' }}>Row</th>
                  <th className="py-2.5 px-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#8B8B85' }}>Name</th>
                  <th className="py-2.5 px-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#8B8B85' }}>Phone</th>
                  <th className="py-2.5 px-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#8B8B85' }}>Email</th>
                  <th className="py-2.5 px-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#8B8B85' }}>Notes</th>
                  <th className="py-2.5 pr-5 pl-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: '#8B8B85' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.index}
                    className="border-b border-slate-50"
                    style={{ backgroundColor: row.errors.length > 0 ? '#FFF7F7' : undefined }}
                  >
                    <td className="py-2.5 pl-5 pr-3 text-xs" style={{ color: '#8B8B85' }}>{row.index}</td>
                    <td className="py-2.5 px-3 font-medium" style={{ color: row.errors.some(e => e.includes('Name')) ? '#DC2626' : '#0A0A0A' }}>
                      {row.name || <span style={{ color: '#DC2626' }}>—</span>}
                    </td>
                    <td className="py-2.5 px-3 font-mono" style={{ color: row.errors.some(e => e.includes('phone')) ? '#DC2626' : '#2A2A2A' }}>
                      {row.phone || <span style={{ color: '#DC2626' }}>—</span>}
                    </td>
                    <td className="py-2.5 px-3" style={{ color: '#8B8B85' }}>{row.email || '—'}</td>
                    <td className="py-2.5 px-3 max-w-[180px] truncate" style={{ color: '#8B8B85' }} title={row.notes}>
                      {row.notes || '—'}
                    </td>
                    <td className="py-2.5 pr-5 pl-3">
                      {row.errors.length === 0 ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>Valid</span>
                      ) : (
                        <span className="text-[11px]" style={{ color: '#DC2626' }}>
                          {row.errors[0]}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Consent notice */}
      <div className="px-4 py-3 rounded-xl text-xs leading-relaxed"
        style={{ backgroundColor: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
        <strong>DPDP Act 2023:</strong> By importing, you confirm that all individuals in this list
        have given explicit consent for Finvastra to contact them. All imported leads will be tagged
        with consent method <strong>offline_collection</strong>.
      </div>
    </div>
  );
}
