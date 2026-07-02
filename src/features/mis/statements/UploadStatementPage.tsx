import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProviders } from '../../crm/hooks/useOpportunities';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../../lib/firebase';
import type { SearchableSelectOption } from '../../../components/ui/SearchableSelect';
import type { StatementTemplate } from '../../../types';

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
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold"
                style={{
                  backgroundColor: isDone ? '#0B1538' : isActive ? '#C9A961' : 'var(--shell-hover-hard)',
                  color: isDone ? '#C9A961' : isActive ? '#0B1538' : 'var(--text-muted)',
                }}
              >
                {isDone ? '✓' : step}
              </div>
              <span
                className="text-xs whitespace-nowrap"
                style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: isActive ? 600 : undefined }}
              >
                {label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className="w-16 h-px mx-2 mb-4"
                style={{ backgroundColor: step < current ? '#0B1538' : 'var(--shell-hover-hard)' }}
              />
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
      <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {label}{required && <span style={{ color: '#f87171' }} className="ml-0.5">*</span>}
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

  // Bank template auto-mapping (Part 6)
  const [templateFound, setTemplateFound] = useState<StatementTemplate | null>(null);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

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
      // Try a saved template for this provider — auto-map columns by header name
      let mapped = data.detectedColumns;
      try {
        const tSnap = await getDoc(doc(db, 'commission_statement_templates', providerId));
        if (tSnap.exists()) {
          const tpl = { id: tSnap.id, ...(tSnap.data() as any) } as StatementTemplate;
          const idxOf = (name: string | null) => {
            if (!name) return -1;
            const n = name.toLowerCase();
            return data.headers.findIndex((h) => h.toLowerCase() === n || h.toLowerCase().includes(n));
          };
          mapped = {
            dateCol: idxOf(tpl.columnMappings.date),
            descCol: idxOf(tpl.columnMappings.description),
            amountCol: idxOf(tpl.columnMappings.amount),
          };
          setTemplateFound(tpl);
        } else {
          setTemplateFound(null);
        }
      } catch { setTemplateFound(null); }
      setConfirmedCols(mapped);
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
      // Optionally persist the confirmed mapping as a bank template
      if (saveAsTemplate && !templateFound && uploadResp) {
        const h = uploadResp.headers;
        setDoc(doc(db, 'commission_statement_templates', uploadResp.providerId), {
          bankId: uploadResp.providerId,
          bankName: providers.find((p) => p.id === uploadResp.providerId)?.name ?? uploadResp.providerId,
          columnMappings: {
            date: h[confirmedCols.dateCol] ?? '',
            description: h[confirmedCols.descCol] ?? '',
            amount: h[confirmedCols.amountCol] ?? '',
            referenceNumber: null,
          },
          dateFormat: 'DD/MM/YYYY', skipRows: 0, amountMultiplier: 1,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }, { merge: true }).catch(() => {});
      }
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
        style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: 'var(--text-primary)' }}
      >
        Upload Statement
      </h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
        Import a commission statement from a bank, AMC, or insurer.
      </p>

      <StepIndicator current={step} />

      {/* ── Step 1: File & Metadata ── */}
      {step === 1 && (
        <div className="glass-panel p-6">
          <h2 className="text-lg font-semibold mb-5" style={{ color: 'var(--text-primary)' }}>File &amp; Metadata</h2>
          <div className="flex flex-col gap-5">

            <Field label="CSV File" required>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium cursor-pointer"
                style={{
                  color: 'var(--text-primary)',
                }}
              />
              {fileName && (
                <span className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{fileName}</span>
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
                  className="glass-inp text-sm"
                />
              </Field>
              <Field label="Period End">
                <input
                  type="month"
                  value={periodEnd}
                  onChange={e => setPeriodEnd(e.target.value)}
                  className="glass-inp text-sm"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Statement Date">
                <input
                  type="date"
                  value={statementDate}
                  onChange={e => setStatementDate(e.target.value)}
                  className="glass-inp text-sm"
                />
              </Field>
              <Field label="Received Date">
                <input
                  type="date"
                  value={receivedDate}
                  onChange={e => setReceivedDate(e.target.value)}
                  className="glass-inp text-sm"
                />
              </Field>
            </div>

            {error && (
              <p
                className="text-sm rounded-lg px-3 py-2"
                style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171' }}
              >
                {error}
              </p>
            )}

            <button
              onClick={handleUpload}
              disabled={submitting || !csvBase64 || !providerId || !periodStart}
              className="mt-1 px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors self-start"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
            >
              {submitting ? 'Uploading…' : 'Upload & Detect'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Column Mapping ── */}
      {step === 2 && uploadResp && (
        <div className="glass-panel p-6">
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Column Mapping</h2>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
            The server detected {uploadResp.headers.length} columns. Confirm which column contains
            each field before importing.
          </p>

          {templateFound && (
            <div className="text-sm rounded-lg px-3 py-2 mb-4" style={{ backgroundColor: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.25)', color: '#34d399' }}>
              ✅ Template found for <strong>{templateFound.bankName}</strong> — columns auto-mapped. Review and confirm.
            </div>
          )}

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
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
              Preview (first 5 rows)
            </p>
            <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--shell-border-mid)' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ backgroundColor: 'var(--shell-hover-soft)', borderBottom: '1px solid var(--shell-border)' }}>
                    <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Date</th>
                    <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Description</th>
                    <th className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadResp.previewRows.map((row, i) => (
                    <tr key={i} className="hover:bg-(--shell-hover-soft) transition-colors" style={{ borderBottom: '1px solid var(--shell-border)' }}>
                      <td className="px-3 py-1.5" style={{ color: 'var(--text-primary)' }}>
                        {confirmedCols.dateCol >= 0 ? (row[confirmedCols.dateCol] ?? '—') : '—'}
                      </td>
                      <td className="px-3 py-1.5 max-w-xs truncate" style={{ color: 'var(--text-primary)' }}>
                        {confirmedCols.descCol >= 0 ? (row[confirmedCols.descCol] ?? '—') : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-primary)' }}>
                        {confirmedCols.amountCol >= 0 ? (row[confirmedCols.amountCol] ?? '—') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {error && (
            <p
              className="text-sm rounded-lg px-3 py-2 mb-4"
              style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171' }}
            >
              {error}
            </p>
          )}

          {!templateFound && (
            <label className="flex items-center gap-2 text-sm mb-4 cursor-pointer" style={{ color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={saveAsTemplate} onChange={(e) => setSaveAsTemplate(e.target.checked)} />
              Save this mapping as a reusable template for this bank (admin only)
            </label>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => { setStep(1); setError(null); }}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors hover:bg-(--shell-hover-soft)"
              style={{ border: '1px solid var(--shell-border-mid)', color: 'var(--text-primary)' }}
            >
              Back
            </button>
            <button
              onClick={handleProcess}
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
            >
              {submitting ? 'Importing…' : 'Process & Import'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Import Summary ── */}
      {step === 3 && processResp && (
        <div className="glass-panel p-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
              style={{ backgroundColor: 'rgba(52,211,153,0.15)', color: '#34d399' }}
            >
              ✓
            </div>
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Import Complete</h2>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Statement saved and ready for reconciliation.</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div
              className="rounded-xl px-4 py-3 text-center"
              style={{ backgroundColor: 'var(--glass-panel-bg)', border: '1px solid var(--shell-border)' }}
            >
              <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{processResp.lineCount}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Lines imported</div>
            </div>
            <div
              className="rounded-xl px-4 py-3 text-center"
              style={{ backgroundColor: 'var(--glass-panel-bg)', border: '1px solid var(--shell-border)' }}
            >
              <div className="text-2xl font-bold" style={{ color: '#C9A961' }}>
                ₹{processResp.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Total amount</div>
            </div>
            <div
              className="rounded-xl px-4 py-3 text-center"
              style={{ backgroundColor: 'var(--glass-panel-bg)', border: '1px solid var(--shell-border)' }}
            >
              <div className="text-2xl font-bold" style={{ color: 'var(--text-muted)' }}>{processResp.lineCount}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Unmatched lines</div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              // Query-string form — the router has no /mis/reconciliation/:id route, so the
              // path form fell through to the catch-all and dumped users on the launcher.
              onClick={() => navigate(`/mis/reconciliation?statementId=${processResp.statementId}`)}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
            >
              Go to Reconciliation
            </button>
            <button
              onClick={resetWizard}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors hover:bg-(--shell-hover-soft)"
              style={{ border: '1px solid var(--shell-border-mid)', color: 'var(--text-primary)' }}
            >
              Upload Another Statement
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
