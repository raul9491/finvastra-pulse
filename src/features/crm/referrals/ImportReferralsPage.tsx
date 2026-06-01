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
          style={{ backgroundColor: done.failed === 0 ? 'rgba(52,211,153,0.15)' : 'rgba(201,169,97,0.15)' }}>
          <CheckCircle2 size={32} style={{ color: done.failed === 0 ? '#34d399' : '#C9A961' }} />
        </div>
        <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Import complete</h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{done.ok}</strong> lead{done.ok !== 1 ? 's' : ''} submitted successfully.
          {done.failed > 0 && ` ${done.failed} failed — check the console for details.`}
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => { setImportState('idle'); setRows([]); setFileName(''); }}
            className="text-sm px-4 py-2 rounded-lg border transition-colors hover:bg-white/5"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'var(--text-primary)' }}
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
        style={{ color: 'var(--text-muted)' }}
      >
        <ArrowLeft size={15} />
        My Referrals
      </button>

      <div>
        <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Import Leads from CSV</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Upload a CSV file of leads collected offline. All imported leads will be marked with
          your name and queued for the tele-calling team.
        </p>
      </div>

      {/* Step 1 — template */}
      <div className="glass-panel p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Step 1 — Download the template
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Required columns: <code className="font-mono" style={{ color: '#C9A961' }}>name</code>, <code className="font-mono" style={{ color: '#C9A961' }}>phone</code>.
              Optional: <code className="font-mono" style={{ color: '#C9A961' }}>email</code>, <code className="font-mono" style={{ color: '#C9A961' }}>notes</code>.
            </p>
          </div>
          <button
            onClick={downloadSample}
            className="flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg border transition-colors hover:bg-white/5"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'var(--text-primary)' }}
          >
            <Download size={14} />
            Download template
          </button>
        </div>
      </div>

      {/* Step 2 — upload */}
      <div className="glass-panel p-5 space-y-3">
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Step 2 — Upload your CSV file
        </p>

        {parseError && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm"
            style={{ backgroundColor: 'rgba(248,113,113,0.10)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}>
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            {parseError}
          </div>
        )}

        <div
          className="border-2 border-dashed rounded-xl flex flex-col items-center justify-center py-10 px-6 text-center cursor-pointer transition-colors hover:bg-white/5"
          style={{ borderColor: 'rgba(255,255,255,0.15)' }}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={24} className="mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {fileName ? `Selected: ${fileName}` : 'Click to select a CSV file'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>.csv files only</p>
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
        <div className="glass-panel overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Step 3 — Review & Import
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
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
            <div className="px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-center gap-3">
                <Loader2 size={14} className="animate-spin shrink-0" style={{ color: '#C9A961' }} />
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: validRows.length > 0 ? `${(progress / validRows.length) * 100}%` : '0%', backgroundColor: '#C9A961' }}
                  />
                </div>
                <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {progress} / {validRows.length}
                </span>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th className="py-2.5 pl-5 pr-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Row</th>
                  <th className="py-2.5 px-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Name</th>
                  <th className="py-2.5 px-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Phone</th>
                  <th className="py-2.5 px-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Email</th>
                  <th className="py-2.5 px-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Notes</th>
                  <th className="py-2.5 pr-5 pl-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.index}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                      backgroundColor: row.errors.length > 0 ? 'rgba(248,113,113,0.06)' : undefined,
                    }}
                  >
                    <td className="py-2.5 pl-5 pr-3 text-xs" style={{ color: 'var(--text-muted)' }}>{row.index}</td>
                    <td className="py-2.5 px-3 font-medium" style={{ color: row.errors.some(e => e.includes('Name')) ? '#f87171' : 'var(--text-primary)' }}>
                      {row.name || <span style={{ color: '#f87171' }}>—</span>}
                    </td>
                    <td className="py-2.5 px-3 font-mono" style={{ color: row.errors.some(e => e.includes('phone')) ? '#f87171' : 'var(--text-primary)' }}>
                      {row.phone || <span style={{ color: '#f87171' }}>—</span>}
                    </td>
                    <td className="py-2.5 px-3" style={{ color: 'var(--text-muted)' }}>{row.email || '—'}</td>
                    <td className="py-2.5 px-3 max-w-[180px] truncate" style={{ color: 'var(--text-muted)' }} title={row.notes}>
                      {row.notes || '—'}
                    </td>
                    <td className="py-2.5 pr-5 pl-3">
                      {row.errors.length === 0 ? (
                        <span className="badge-glass-success">Valid</span>
                      ) : (
                        <span className="text-[11px]" style={{ color: '#f87171' }}>
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
        style={{ backgroundColor: 'rgba(201,169,97,0.08)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.25)' }}>
        <strong>DPDP Act 2023:</strong> By importing, you confirm that all individuals in this list
        have given explicit consent for Finvastra to contact them. All imported leads will be tagged
        with consent method <strong>offline_collection</strong>.
      </div>
    </div>
  );
}
