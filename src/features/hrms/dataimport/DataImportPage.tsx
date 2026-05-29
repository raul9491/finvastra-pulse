/**
 * DataImportPage — Super Admin only
 *
 * Bulk-import Assets, Leave Balances, or Employee Profiles from an Excel or
 * CSV file. Follows the pattern already used for MIS statement uploads but
 * is entirely client-side: the xlsx library parses the file in the browser,
 * a preview table is shown, and on confirmation the data is written directly
 * to Firestore. The original file is stored in Firebase Storage as an audit
 * copy.
 *
 * Access: isSuperAdmin() — not just admin, Super Admin only.
 */

import { useState, useRef, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import {
  collection, doc, setDoc, addDoc, getDocs, query, where, serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { isSuperAdmin } from '../../../config/hrmsConfig';
import {
  Upload, Download, CheckCircle, XCircle, AlertTriangle, FileSpreadsheet,
  ChevronRight, RotateCcw, Database,
} from 'lucide-react';
import {
  parseAssetRows, parseLeaveBalanceRows, parseEmployeeProfileRows,
  assetTemplate, leaveBalanceTemplate, employeeProfileTemplate,
  normaliseDate,
  type AssetRow, type LeaveBalanceRow, type EmployeeProfileRow,
} from './importParsers';

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportType = 'assets' | 'leave_balances' | 'employee_profiles';

type ImportResult = {
  imported: number;
  skipped:  number;
  errors:   number;
  messages: string[];
};

// ─── Style helpers ────────────────────────────────────────────────────────────

const baseBtn  = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const primaryBtn  = `${baseBtn}`;
const ghostBtn    = `${baseBtn} border`;

// ─── Template downloader ──────────────────────────────────────────────────────

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Importer functions ───────────────────────────────────────────────────────

/** Build a map of empCode → { uid, displayName } from the /users collection. */
async function buildEmpCodeMap(): Promise<Map<string, { uid: string; displayName: string }>> {
  const snap = await getDocs(query(collection(db, 'users'), where('deleted', '==', false)));
  const map = new Map<string, { uid: string; displayName: string }>();
  snap.docs.forEach((d) => {
    const data = d.data();
    if (data.empCode) map.set(String(data.empCode).trim(), { uid: d.id, displayName: data.displayName ?? '' });
  });
  return map;
}

async function importAssets(
  rows: AssetRow[],
  empMap: Map<string, { uid: string; displayName: string }>,
  actorUid: string,
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, errors: 0, messages: [] };

  for (const row of rows) {
    if (row._errors.length) { result.errors++; result.messages.push(`Row ${row.rowIndex}: ${row._errors.join(', ')}`); continue; }

    // Resolve employee
    const emp = empMap.get(row.empCode);
    if (!emp) { result.errors++; result.messages.push(`Row ${row.rowIndex}: Emp Code "${row.empCode}" not found in Pulse`); continue; }

    // Skip duplicate by serial number
    if (row.serialNumber) {
      const dup = await getDocs(query(collection(db, 'assets'), where('serialNumber', '==', row.serialNumber)));
      if (!dup.empty) { result.skipped++; result.messages.push(`Row ${row.rowIndex}: Serial "${row.serialNumber}" already exists — skipped`); continue; }
    }

    const normalDate = normaliseDate(row.assignmentDate);

    await addDoc(collection(db, 'assets'), {
      assetType:        row.assetType,
      assetName:        row.assetName,
      serialNumber:     row.serialNumber || null,
      imei:             row.imei         || null,
      simNumber:        row.simNumber    || null,
      phoneNumber:      row.phoneNumber  || null,
      purchaseDate:     null,
      purchaseValue:    null,
      currentStatus:    'assigned',
      assignedTo:       emp.uid,
      assignedToName:   emp.displayName,
      assignedDate:     normalDate || null,
      returnedDate:     null,
      condition:        row.condition,
      notes:            row.notes || null,
      addedBy:          actorUid,
      addedAt:          serverTimestamp(),
      updatedAt:        serverTimestamp(),
    });
    result.imported++;
  }
  return result;
}

async function importLeaveBalances(
  rows: LeaveBalanceRow[],
  empMap: Map<string, { uid: string; displayName: string }>,
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, errors: 0, messages: [] };
  const batch = writeBatch(db);
  let batchCount = 0;

  const flushBatch = async () => {
    if (batchCount > 0) { await batch.commit(); batchCount = 0; }
  };

  for (const row of rows) {
    if (row._errors.length) { result.errors++; result.messages.push(`Row ${row.rowIndex}: ${row._errors.join(', ')}`); continue; }

    const emp = empMap.get(row.empCode);
    if (!emp) { result.errors++; result.messages.push(`Row ${row.rowIndex}: Emp Code "${row.empCode}" not found in Pulse`); continue; }

    const docId  = `${emp.uid}_${row.year}`;
    const docRef = doc(db, 'leave_balances', docId);

    batch.set(docRef, {
      employeeId: emp.uid,
      year:       row.year,
      casual:     { total: row.clTotal,      used: row.clUsed,      remaining: Math.max(0, row.clTotal - row.clUsed) },
      sick:       { total: row.slTotal,      used: row.slUsed,      remaining: Math.max(0, row.slTotal - row.slUsed) },
      earned:     { total: row.elTotal,      used: row.elUsed,      remaining: Math.max(0, row.elTotal - row.elUsed) },
      comp_off:   { total: row.compOffTotal, used: row.compOffUsed, remaining: Math.max(0, row.compOffTotal - row.compOffUsed) },
    });
    batchCount++;
    result.imported++;

    // Firestore batch max is 500 ops
    if (batchCount >= 400) await flushBatch();
  }
  await flushBatch();
  return result;
}

async function importEmployeeProfiles(
  rows: EmployeeProfileRow[],
  empMap: Map<string, { uid: string; displayName: string }>,
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, errors: 0, messages: [] };

  for (const row of rows) {
    if (row._errors.length) { result.errors++; result.messages.push(`Row ${row.rowIndex}: ${row._errors.join(', ')}`); continue; }

    const emp = empMap.get(row.empCode);
    if (!emp) { result.errors++; result.messages.push(`Row ${row.rowIndex}: Emp Code "${row.empCode}" not found in Pulse`); continue; }

    // Resolve managerEmpCode → managerId
    let managerId: string | undefined;
    if (row.managerEmpCode) {
      const mgr = empMap.get(row.managerEmpCode);
      if (mgr) managerId = mgr.uid;
      else result.messages.push(`Row ${row.rowIndex}: Manager Emp Code "${row.managerEmpCode}" not found — skipped manager field`);
    }

    // Build partial updates — only include non-empty values
    const userUpdate: Record<string, unknown> = { updatedAt: serverTimestamp() };
    const profileUpdate: Record<string, unknown> = { updatedAt: serverTimestamp() };

    if (row.joiningDate)        userUpdate.joiningDate   = row.joiningDate;
    if (row.grossSalary != null) userUpdate.grossSalary  = row.grossSalary;
    if (row.department)         userUpdate.department    = row.department;
    if (row.designation)        userUpdate.designation   = row.designation;
    if (managerId)              userUpdate.managerId     = managerId;
    if (row.uan)                profileUpdate.uan        = row.uan;
    if (row.bloodGroup)         profileUpdate.bloodGroup = row.bloodGroup;

    // Only write if there's something beyond the timestamp
    if (Object.keys(userUpdate).length > 1) {
      await setDoc(doc(db, 'users', emp.uid), userUpdate, { merge: true });
    }
    if (Object.keys(profileUpdate).length > 1) {
      await setDoc(doc(db, 'employee_profiles', emp.uid), profileUpdate, { merge: true });
    }
    result.imported++;
  }
  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

const TABS: { id: ImportType; label: string; description: string }[] = [
  { id: 'assets',            label: 'Assets',           description: 'Bulk-create asset records and assign them to employees' },
  { id: 'leave_balances',    label: 'Leave Balances',   description: 'Set or overwrite leave balances for all employees for a given year' },
  { id: 'employee_profiles', label: 'Employee Profiles', description: 'Update joining date, salary, department, UAN, blood group and more' },
];

const TEMPLATE_FN: Record<ImportType, () => string> = {
  assets:            assetTemplate,
  leave_balances:    leaveBalanceTemplate,
  employee_profiles: employeeProfileTemplate,
};

const TEMPLATE_NAMES: Record<ImportType, string> = {
  assets:            'Pulse_Assets_Template.csv',
  leave_balances:    'Pulse_LeaveBalances_Template.csv',
  employee_profiles: 'Pulse_EmployeeProfiles_Template.csv',
};

const COLUMN_HINTS: Record<ImportType, string[]> = {
  assets: [
    'Emp Code — employee code from Pulse (e.g. FAPL-001)',
    'Asset Type — laptop / sim_card / mobile_phone / access_card / other',
    'Asset Name — e.g. "Dell Latitude 5520"',
    'Serial Number — leave blank if unknown (duplicates checked by serial)',
    'IMEI — mobile phones only',
    'SIM Number / Phone Number — SIM cards only',
    'Assignment Date — DD-MM-YYYY or YYYY-MM-DD',
    'Condition — good / fair / damaged',
    'Notes — optional free text',
  ],
  leave_balances: [
    'Emp Code — employee code from Pulse',
    'Year — 4-digit year (e.g. 2026)',
    'CL Total / CL Used — Casual Leave (HR Handbook: 8 total)',
    'SL Total / SL Used — Sick Leave (HR Handbook: 7 total)',
    'EL Total / EL Used — Earned Leave (HR Handbook: 15 total)',
    'Comp Off Total / Comp Off Used — leave blank if no Comp Off',
  ],
  employee_profiles: [
    'Emp Code — employee code from Pulse (required)',
    'Joining Date — DD-MM-YYYY or YYYY-MM-DD (optional)',
    'Gross Salary — numbers only, no ₹ symbol (optional)',
    'Department — must match Pulse department list (optional)',
    'Designation — must match Pulse designation list (optional)',
    'Manager Emp Code — e.g. FAPL-003 (optional)',
    'UAN — 12-digit PF Universal Account Number (optional)',
    'Blood Group — e.g. B+ (optional)',
    'Blank cells are skipped — existing data is preserved',
  ],
};

export function DataImportPage() {
  const { user, profile } = useAuth();
  const isSA = isSuperAdmin(user?.uid ?? '');

  const [activeTab, setActiveTab]       = useState<ImportType>('assets');
  const [file, setFile]                 = useState<File | null>(null);
  const [parsing, setParsing]           = useState(false);
  const [parsedRows, setParsedRows]     = useState<(AssetRow | LeaveBalanceRow | EmployeeProfileRow)[] | null>(null);
  const [globalErrors, setGlobalErrors] = useState<string[]>([]);
  const [importing, setImporting]       = useState(false);
  const [result, setResult]             = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Guard: Super Admin only
  if (!isSA) return <Navigate to="/hrms/dashboard" replace />;

  const reset = () => {
    setFile(null); setParsedRows(null); setGlobalErrors([]); setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleTabChange = (tab: ImportType) => { setActiveTab(tab); reset(); };

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setParsedRows(null); setGlobalErrors([]); setResult(null);
    setParsing(true);

    try {
      // Dynamic import — xlsx (~800KB) loads only when the admin uses this page
      const XLSX = await import('xlsx');
      const buffer = await f.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });

      if (activeTab === 'assets') {
        const { rows, globalErrors: ge } = parseAssetRows(data);
        setParsedRows(rows); setGlobalErrors(ge);
      } else if (activeTab === 'leave_balances') {
        const { rows, globalErrors: ge } = parseLeaveBalanceRows(data);
        setParsedRows(rows); setGlobalErrors(ge);
      } else {
        const { rows, globalErrors: ge } = parseEmployeeProfileRows(data);
        setParsedRows(rows); setGlobalErrors(ge);
      }
    } catch (err) {
      setGlobalErrors([`Failed to read file: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setParsing(false);
    }
  }, [activeTab]);

  const handleImport = async () => {
    if (!parsedRows || !user || !profile) return;
    setImporting(true);

    try {
      // Upload original file to Firebase Storage (audit trail)
      if (file) {
        try {
          const ts = Date.now();
          const sRef = storageRef(storage, `imports/${activeTab}/${user.uid}/${ts}_${file.name}`);
          await uploadBytes(sRef, file, { contentType: file.type || 'application/octet-stream' });
        } catch {
          // Non-fatal — import continues even if storage upload fails
        }
      }

      const empMap = await buildEmpCodeMap();
      let importResult: ImportResult;

      if (activeTab === 'assets') {
        importResult = await importAssets(parsedRows as AssetRow[], empMap, user.uid);
      } else if (activeTab === 'leave_balances') {
        importResult = await importLeaveBalances(parsedRows as LeaveBalanceRow[], empMap);
      } else {
        importResult = await importEmployeeProfiles(parsedRows as EmployeeProfileRow[], empMap);
      }

      // Write import log
      await addDoc(collection(db, 'import_logs'), {
        importType:      activeTab,
        filename:        file?.name ?? 'unknown',
        rowCount:        parsedRows.length,
        importedCount:   importResult.imported,
        skippedCount:    importResult.skipped,
        errorCount:      importResult.errors,
        importedBy:      user.uid,
        importedByName:  profile.displayName ?? '',
        importedAt:      serverTimestamp(),
      });

      setResult(importResult);
      setParsedRows(null);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setGlobalErrors([`Import failed: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setImporting(false);
    }
  };

  const validRows   = parsedRows?.filter((r) => r._errors.length === 0).length ?? 0;
  const invalidRows = parsedRows?.filter((r) => r._errors.length > 0).length  ?? 0;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: '#1B2A4E' }}>
          <Database size={20} style={{ color: '#C9A961' }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#0A0A0A', fontFamily: 'Fraunces, serif' }}>
            Data Import
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#8B8B85' }}>
            Bulk-load data from Excel or CSV. Super Admin only.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 rounded-xl border border-slate-200 bg-slate-50 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => handleTabChange(t.id)}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={
              activeTab === t.id
                ? { backgroundColor: '#0B1538', color: '#FFFFFF' }
                : { color: '#475569' }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab description */}
      <p className="text-sm -mt-4" style={{ color: '#8B8B85' }}>
        {TABS.find((t) => t.id === activeTab)?.description}
      </p>

      {/* Success result */}
      {result && (
        <div className="rounded-2xl border p-6 space-y-4"
          style={{ borderColor: '#BBF7D0', backgroundColor: '#F0FDF4' }}>
          <div className="flex items-center gap-3">
            <CheckCircle size={24} style={{ color: '#16A34A' }} />
            <h2 className="text-lg font-bold" style={{ color: '#15803D' }}>Import Complete</h2>
          </div>
          <div className="flex gap-6">
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: '#15803D' }}>{result.imported}</p>
              <p className="text-xs font-semibold uppercase tracking-wider mt-1" style={{ color: '#16A34A' }}>Imported</p>
            </div>
            {result.skipped > 0 && (
              <div className="text-center">
                <p className="text-2xl font-bold" style={{ color: '#D97706' }}>{result.skipped}</p>
                <p className="text-xs font-semibold uppercase tracking-wider mt-1" style={{ color: '#D97706' }}>Skipped</p>
              </div>
            )}
            {result.errors > 0 && (
              <div className="text-center">
                <p className="text-2xl font-bold" style={{ color: '#DC2626' }}>{result.errors}</p>
                <p className="text-xs font-semibold uppercase tracking-wider mt-1" style={{ color: '#DC2626' }}>Errors</p>
              </div>
            )}
          </div>
          {result.messages.length > 0 && (
            <div className="rounded-lg bg-white border border-slate-200 p-4 space-y-1 max-h-48 overflow-y-auto">
              {result.messages.map((m, i) => (
                <p key={i} className="text-xs" style={{ color: '#374151' }}>{m}</p>
              ))}
            </div>
          )}
          <button
            onClick={() => setResult(null)}
            className={`${ghostBtn}`}
            style={{ borderColor: '#BBF7D0', color: '#15803D' }}
          >
            <RotateCcw size={14} /> Import another file
          </button>
        </div>
      )}

      {!result && (
        <>
          {/* Step 1 — Download template */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>1</span>
              <h2 className="text-base font-bold" style={{ color: '#0A0A0A' }}>Download the template</h2>
            </div>
            <p className="text-sm" style={{ color: '#475569' }}>
              Fill in this CSV template with your data. Save as CSV or XLSX — both are accepted.
            </p>
            <button
              onClick={() => downloadCsv(TEMPLATE_FN[activeTab](), TEMPLATE_NAMES[activeTab])}
              className={`${primaryBtn}`}
              style={{ backgroundColor: '#0B1538', color: '#FFFFFF' }}
            >
              <Download size={15} /> Download Template
            </button>

            {/* Column hints */}
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#475569' }}>
                Column guide
              </p>
              <ul className="space-y-1.5">
                {COLUMN_HINTS[activeTab].map((hint, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <ChevronRight size={13} className="mt-0.5 shrink-0" style={{ color: '#C9A961' }} />
                    <span className="text-xs" style={{ color: '#374151' }}>{hint}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Step 2 — Upload */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>2</span>
              <h2 className="text-base font-bold" style={{ color: '#0A0A0A' }}>Upload your filled file</h2>
            </div>

            <label
              className="flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-10 cursor-pointer transition-colors hover:bg-slate-50"
              style={{ borderColor: file ? '#C9A961' : '#CBD5E1' }}
            >
              <FileSpreadsheet size={36} style={{ color: file ? '#C9A961' : '#94A3B8' }} />
              <div className="text-center">
                <p className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>
                  {file ? file.name : 'Click to choose a file'}
                </p>
                <p className="text-xs mt-1" style={{ color: '#8B8B85' }}>
                  {file ? `${(file.size / 1024).toFixed(1)} KB` : 'Excel (.xlsx) or CSV (.csv) accepted'}
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>

            {parsing && (
              <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
                <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin shrink-0"
                  style={{ borderColor: '#C9A961', borderTopColor: 'transparent' }} />
                <p className="text-sm" style={{ color: '#475569' }}>Reading file…</p>
              </div>
            )}

            {/* Global parse errors */}
            {globalErrors.length > 0 && (
              <div className="rounded-xl border p-4 space-y-1"
                style={{ borderColor: '#FECACA', backgroundColor: '#FEF2F2' }}>
                <div className="flex items-center gap-2 mb-2">
                  <XCircle size={16} style={{ color: '#DC2626' }} />
                  <p className="text-sm font-semibold" style={{ color: '#DC2626' }}>Could not parse file</p>
                </div>
                {globalErrors.map((e, i) => (
                  <p key={i} className="text-sm" style={{ color: '#7F1D1D' }}>{e}</p>
                ))}
              </div>
            )}
          </div>

          {/* Step 3 — Preview & Confirm */}
          {parsedRows && parsedRows.length > 0 && globalErrors.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>3</span>
                  <h2 className="text-base font-bold" style={{ color: '#0A0A0A' }}>Preview & confirm</h2>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1.5" style={{ color: '#16A34A' }}>
                    <CheckCircle size={14} /> {validRows} valid
                  </span>
                  {invalidRows > 0 && (
                    <span className="flex items-center gap-1.5" style={{ color: '#DC2626' }}>
                      <XCircle size={14} /> {invalidRows} with errors
                    </span>
                  )}
                </div>
              </div>

              {invalidRows > 0 && (
                <div className="rounded-xl border p-3 flex items-start gap-2"
                  style={{ borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }}>
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: '#D97706' }} />
                  <p className="text-sm" style={{ color: '#92400E' }}>
                    {invalidRows} row(s) have errors and will be skipped. Valid rows will still be imported.
                  </p>
                </div>
              )}

              {/* Preview table */}
              <div className="overflow-auto max-h-72 rounded-xl border border-slate-200">
                <PreviewTable rows={parsedRows} importType={activeTab} />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleImport}
                  disabled={importing || validRows === 0}
                  className={`${primaryBtn}`}
                  style={{ backgroundColor: '#0B1538', color: '#FFFFFF' }}
                >
                  {importing ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                        style={{ borderColor: '#FFFFFF', borderTopColor: 'transparent' }} />
                      Importing…
                    </>
                  ) : (
                    <>
                      <Upload size={15} /> Import {validRows} row{validRows !== 1 ? 's' : ''}
                    </>
                  )}
                </button>
                <button onClick={reset} className={`${ghostBtn}`}
                  style={{ borderColor: '#E2E8F0', color: '#475569' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Preview table ─────────────────────────────────────────────────────────────

function PreviewTable({
  rows,
  importType,
}: {
  rows: (AssetRow | LeaveBalanceRow | EmployeeProfileRow)[];
  importType: ImportType;
}) {
  if (importType === 'assets') {
    const r = rows as AssetRow[];
    return (
      <table className="w-full text-xs">
        <thead style={{ backgroundColor: '#F8FAFC', position: 'sticky', top: 0 }}>
          <tr>{['Row','Emp Code','Asset Type','Asset Name','Serial No.','Date','Condition','Status'].map((h) => (
            <th key={h} className="px-3 py-2.5 text-left font-semibold text-slate-500 whitespace-nowrap">{h}</th>
          ))}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {r.map((row) => (
            <tr key={row.rowIndex} style={{ backgroundColor: row._errors.length ? '#FEF2F2' : undefined }}>
              <td className="px-3 py-2 text-slate-400">{row.rowIndex}</td>
              <td className="px-3 py-2 font-mono font-medium" style={{ color: '#0B1538' }}>{row.empCode}</td>
              <td className="px-3 py-2 text-slate-600">{row.assetType}</td>
              <td className="px-3 py-2 text-slate-700">{row.assetName}</td>
              <td className="px-3 py-2 text-slate-500">{row.serialNumber || '—'}</td>
              <td className="px-3 py-2 text-slate-500">{row.assignmentDate || '—'}</td>
              <td className="px-3 py-2 text-slate-500">{row.condition ?? '—'}</td>
              <td className="px-3 py-2">
                {row._errors.length
                  ? <span className="flex items-center gap-1 text-red-600"><XCircle size={12}/>{row._errors[0]}</span>
                  : <span className="flex items-center gap-1" style={{ color: '#16A34A' }}><CheckCircle size={12}/>Ready</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (importType === 'leave_balances') {
    const r = rows as LeaveBalanceRow[];
    return (
      <table className="w-full text-xs">
        <thead style={{ backgroundColor: '#F8FAFC', position: 'sticky', top: 0 }}>
          <tr>{['Row','Emp Code','Year','CL','SL','EL','Comp Off','Status'].map((h) => (
            <th key={h} className="px-3 py-2.5 text-left font-semibold text-slate-500 whitespace-nowrap">{h}</th>
          ))}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {r.map((row) => (
            <tr key={row.rowIndex} style={{ backgroundColor: row._errors.length ? '#FEF2F2' : undefined }}>
              <td className="px-3 py-2 text-slate-400">{row.rowIndex}</td>
              <td className="px-3 py-2 font-mono font-medium" style={{ color: '#0B1538' }}>{row.empCode}</td>
              <td className="px-3 py-2 text-slate-600">{row.year}</td>
              <td className="px-3 py-2 text-slate-600">{row.clTotal} / {row.clUsed} used</td>
              <td className="px-3 py-2 text-slate-600">{row.slTotal} / {row.slUsed} used</td>
              <td className="px-3 py-2 text-slate-600">{row.elTotal} / {row.elUsed} used</td>
              <td className="px-3 py-2 text-slate-600">{row.compOffTotal} / {row.compOffUsed} used</td>
              <td className="px-3 py-2">
                {row._errors.length
                  ? <span className="flex items-center gap-1 text-red-600"><XCircle size={12}/>{row._errors[0]}</span>
                  : <span className="flex items-center gap-1" style={{ color: '#16A34A' }}><CheckCircle size={12}/>Ready</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // employee_profiles
  const r = rows as EmployeeProfileRow[];
  return (
    <table className="w-full text-xs">
      <thead style={{ backgroundColor: '#F8FAFC', position: 'sticky', top: 0 }}>
        <tr>{['Row','Emp Code','Joining Date','Salary','Department','Designation','UAN','Status'].map((h) => (
          <th key={h} className="px-3 py-2.5 text-left font-semibold text-slate-500 whitespace-nowrap">{h}</th>
        ))}</tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {r.map((row) => (
          <tr key={row.rowIndex} style={{ backgroundColor: row._errors.length ? '#FEF2F2' : undefined }}>
            <td className="px-3 py-2 text-slate-400">{row.rowIndex}</td>
            <td className="px-3 py-2 font-mono font-medium" style={{ color: '#0B1538' }}>{row.empCode}</td>
            <td className="px-3 py-2 text-slate-600">{row.joiningDate || '—'}</td>
            <td className="px-3 py-2 text-slate-600">{row.grossSalary != null ? `₹${row.grossSalary.toLocaleString('en-IN')}` : '—'}</td>
            <td className="px-3 py-2 text-slate-600">{row.department || '—'}</td>
            <td className="px-3 py-2 text-slate-600">{row.designation || '—'}</td>
            <td className="px-3 py-2 text-slate-500">{row.uan || '—'}</td>
            <td className="px-3 py-2">
              {row._errors.length
                ? <span className="flex items-center gap-1 text-red-600"><XCircle size={12}/>{row._errors[0]}</span>
                : <span className="flex items-center gap-1" style={{ color: '#16A34A' }}><CheckCircle size={12}/>Ready</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
