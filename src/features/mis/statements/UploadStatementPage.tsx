import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProviders } from '../../crm/hooks/useOpportunities';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { auth } from '../../../lib/firebase';
import type { SearchableSelectOption } from '../../../components/ui/SearchableSelect';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DetectedColumns {
  dateCol: number;
  descCol: number;
  amountCol: number;
}

interface UploadResponse {
  tempId: string;
  headers: string[];
  detectedColumns: DetectedColumns;
  previewRows: string[][];
  fileName: string;
  periodStart: string;
  periodEnd: string;
  statementDate: string;
  receivedDate: string;
  providerId: string;
}

interface ProcessResponse {
  statementId: string;
  lineCount: number;
  totalAmount: number;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['File & Metadata', 'Column Mapping', 'Import Summary'];
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, idx) => {
        const step = (idx + 1) as 1 | 2 | 3;
        const isDone    = step < current;
        const isActive  = step === current;
        return (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold',
                  isDone   ? 'bg-navy text-white'   : '',
                  isActive ? 'bg-[#C9A961] text-navy' : '',
                  !isDone && !isActive ? 'bg-slate-100 text-mute' : '',
                ].join(' ')}
              >
                {isDone ? '✓' : step}
              </div>
              <span
                className={`text-xs whitespace-nowrap ${isActive ? 'text-navy font-semibold' : 'text-mute'}`}
              >
                {label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`w-16 h-px mx-2 mb-4 ${step < current ? 'bg-navy' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-[#0A0A0A]">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Column selector for mapping ─────────────────────────────────────────────

function ColumnSelect({
  label,
  headers,
  value,
  onChange,
}: {
  label: string;
  headers: string[];
  value: number;
  onChange: (col: number) => void;
}) {
  const options: SearchableSelectOption[] = [
    { value: '-1', label: '— not in this file —' },
    ...headers.map((h, i) => ({ value: String(i), label: `Column ${i + 1}: ${h}` })),
  ];
  return (
    <Field label={label} required>
      <SearchableSelect
        options={options}
        value={String(value)}
        onChange={(v) => onChange(Number(v))}
        placeholder="Select column…"
      />
    </Field>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function UploadStatementPage() {
  const navigate = useNavigate();
  const providers = useProviders();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Step 1 fields
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvBase64, setCsvBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [providerId, setProviderId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [statementDate, setStatementDate] = useState('');
  const [receivedDate, setReceivedDate] = useState('');

  // Step 2 state (from upload response)
  const [uploadResp, setUploadResp] = useState<UploadResponse | null>(null);
  const [confirmedCols, setConfirmedCols] = useState<DetectedColumns>({ dateCol: -1, descCol: -1, amountCol: -1 });

  // Step 3 state (from process response)
  const [processResp, setProcessResp] = useState<ProcessResponse | null>(null);

  // ─── Provider options ───────────────────────────────────────────────────────
  const providerOptions: SearchableSelectOption[] = providers.map(p => ({
    value: p.id,
    label: p.name,
    description: p.type,
  }));

  // ─── File read ──────────────────────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      // readAsDataURL returns "data:<mime>;base64,<data>"
      const result = evt.target?.result as string;
      const base64 = result.split(',')[1] ?? '';
      setCsvBase64(base64);
    };
    reader.readAsDataURL(file);
  }

  // ─── Step 1 → Upload ───────────────────────────────────────────────────────
  async function handleUpload() {
    if (!csvBase64 || !providerId || !periodStart) {
      setError('Please select a file, provider, and period start.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/mis/statements/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify({ csvBase64, fileName, providerId, periodStart, periodEnd, statementDate, receivedDate }),
      });
      const data: UploadResponse | { error: string } = await res.json();
      if (!res.ok || 'error' in data) {
        setError(('error' in data ? data.error : null) ?? 'Upload failed.');
        return;
      }
      setUploadResp(data);
      setConfirmedCols(data.detectedColumns);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Step 2 → Process ──────────────────────────────────────────────────────
  async function handleProcess() {
    if (!uploadResp) return;
    setError(null);
    setSubmitting(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/mis/statements/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify({
          tempId: uploadResp.tempId,
          confirmedColumns: confirmedCols,
          providerId: uploadResp.providerId,
          periodStart: uploadResp.periodStart,
          periodEnd: uploadResp.periodEnd,
          statementDate: uploadResp.statementDate,
          receivedDate: uploadResp.receivedDate,
          fileName: uploadResp.fileName,
        }),
      });
      const data: ProcessResponse | { error: string } = await res.json();
      if (!res.ok || 'error' in data) {
        setError(('error' in data ? data.error : null) ?? 'Processing failed.');
        return;
      }
      setProcessResp(data);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed.');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Reset for "Upload Another" ────────────────────────────────────────────
  function resetWizard() {
    setStep(1);
    setCsvBase64(null);
    setFileName('');
    setProviderId('');
    setPeriodStart('');
    setPeriodEnd('');
    setStatementDate('');
    setReceivedDate('');
    setUploadResp(null);
    setConfirmedCols({ dateCol: -1, descCol: -1, amountCol: -1 });
    setProcessResp(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Title */}
      <h1
        className="text-3xl mb-2"
        style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: '#0B1538' }}
      >
        Upload Statement
      </h1>
      <p className="text-sm mb-8" style={{ color: '#8B8B85' }}>
        Import a commission statement from a bank, AMC, or insurer.
      </p>

      <StepIndicator current={step} />

      {/* ── Step 1: File & Metadata ── */}
      {step === 1 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-navy mb-5">File &amp; Metadata</h2>
          <div className="flex flex-col gap-5">

            <Field label="CSV File" required>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="text-sm text-[#0A0A0A] file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-[#F2EFE7] file:text-navy hover:file:bg-gold-bright cursor-pointer"
              />
              {fileName && (
                <span className="text-xs text-mute mt-1">{fileName}</span>
              )}
            </Field>

            <Field label="Provider" required>
              <SearchableSelect
                options={providerOptions}
                value={providerId}
                onChange={setProviderId}
                placeholder="Select provider…"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Period Start" required>
                <input
                  type="month"
                  value={periodStart}
                  onChange={e => setPeriodStart(e.target.value)}
                  className="px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538]"
                />
              </Field>
              <Field label="Period End">
                <input
                  type="month"
                  value={periodEnd}
                  onChange={e => setPeriodEnd(e.target.value)}
                  className="px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538]"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Statement Date">
                <input
                  type="date"
                  value={statementDate}
                  onChange={e => setStatementDate(e.target.value)}
                  className="px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538]"
                />
              </Field>
              <Field label="Received Date">
                <input
                  type="date"
                  value={receivedDate}
                  onChange={e => setReceivedDate(e.target.value)}
                  className="px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538]"
                />
              </Field>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              onClick={handleUpload}
              disabled={submitting || !csvBase64 || !providerId || !periodStart}
              className="mt-1 px-5 py-2.5 rounded-lg text-sm font-semibold bg-navy text-white disabled:opacity-50 hover:bg-navy-soft transition-colors self-start"
            >
              {submitting ? 'Uploading…' : 'Upload & Detect'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Column Mapping ── */}
      {step === 2 && uploadResp && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-navy mb-1">Column Mapping</h2>
          <p className="text-sm mb-5" style={{ color: '#8B8B85' }}>
            The server detected {uploadResp.headers.length} columns. Confirm which column contains
            each field before importing.
          </p>

          <div className="flex flex-col gap-4 mb-6">
            <ColumnSelect
              label="Date column"
              headers={uploadResp.headers}
              value={confirmedCols.dateCol}
              onChange={(col) => setConfirmedCols(prev => ({ ...prev, dateCol: col }))}
            />
            <ColumnSelect
              label="Description column"
              headers={uploadResp.headers}
              value={confirmedCols.descCol}
              onChange={(col) => setConfirmedCols(prev => ({ ...prev, descCol: col }))}
            />
            <ColumnSelect
              label="Amount column"
              headers={uploadResp.headers}
              value={confirmedCols.amountCol}
              onChange={(col) => setConfirmedCols(prev => ({ ...prev, amountCol: col }))}
            />
          </div>

          {/* Preview table */}
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-mute mb-2">
              Preview (first 5 rows)
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#F2EFE7]">
                    <th className="px-3 py-2 text-left font-semibold text-navy">Date</th>
                    <th className="px-3 py-2 text-left font-semibold text-navy">Description</th>
                    <th className="px-3 py-2 text-right font-semibold text-navy">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadResp.previewRows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#FAFAF7]'}>
                      <td className="px-3 py-1.5 text-[#0A0A0A]">
                        {confirmedCols.dateCol >= 0 ? (row[confirmedCols.dateCol] ?? '—') : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-[#0A0A0A] max-w-xs truncate">
                        {confirmedCols.descCol >= 0 ? (row[confirmedCols.descCol] ?? '—') : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right text-[#0A0A0A]">
                        {confirmedCols.amountCol >= 0 ? (row[confirmedCols.amountCol] ?? '—') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => { setStep(1); setError(null); }}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-slate-200 text-[#0A0A0A] hover:bg-slate-50 transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleProcess}
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-navy text-white disabled:opacity-50 hover:bg-navy-soft transition-colors"
            >
              {submitting ? 'Importing…' : 'Process & Import'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Import Summary ── */}
      {step === 3 && processResp && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-lg">
              ✓
            </div>
            <div>
              <h2 className="text-lg font-semibold text-navy">Import Complete</h2>
              <p className="text-sm" style={{ color: '#8B8B85' }}>Statement saved and ready for reconciliation.</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="rounded-xl bg-[#F2EFE7] px-4 py-3 text-center">
              <div className="text-2xl font-bold text-navy">{processResp.lineCount}</div>
              <div className="text-xs text-mute mt-0.5">Lines imported</div>
            </div>
            <div className="rounded-xl bg-[#F2EFE7] px-4 py-3 text-center">
              <div className="text-2xl font-bold text-navy">
                ₹{processResp.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </div>
              <div className="text-xs text-mute mt-0.5">Total amount</div>
            </div>
            <div className="rounded-xl bg-[#F2EFE7] px-4 py-3 text-center">
              <div className="text-2xl font-bold text-mute">{processResp.lineCount}</div>
              <div className="text-xs text-mute mt-0.5">Unmatched lines</div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => navigate(`/mis/reconciliation/${processResp.statementId}`)}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-[#C9A961] text-navy hover:bg-gold-bright transition-colors"
            >
              Go to Reconciliation
            </button>
            <button
              onClick={resetWizard}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-slate-200 text-[#0A0A0A] hover:bg-slate-50 transition-colors"
            >
              Upload Another Statement
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
