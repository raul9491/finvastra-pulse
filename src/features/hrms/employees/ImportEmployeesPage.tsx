import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, updateDoc, setDoc, doc, serverTimestamp } from 'firebase/firestore';
import { ArrowLeft, Link2, Eye, Upload, CheckCircle2, AlertCircle, Info, ChevronRight } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedEmployee {
  empCode:          string;
  name:             string;
  status:           'active' | 'inactive';
  dob:              string | null;   // MM-DD
  phone:            string | null;
  officialPhone:    string | null;
  personalEmail:    string | null;
  officialEmail:    string | null;
  doj:              string | null;   // YYYY-MM-DD
  lwd:              string | null;   // YYYY-MM-DD
  department:       string | null;
  designation:      string | null;
  reportingManager: string | null;
  presentAddress:   string | null;
  permanentAddress: string | null;
  grossSalary:      number | null;
  existsInFirestore: boolean;
}

interface SyncResult {
  empCode: string;
  name:    string;
  action:  'updated' | 'created' | 'error';
  detail?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractSheetId(url: string): string | null {
  const m = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function na(v: string | null | undefined): string | null {
  if (!v || v.trim() === '' || v.trim().toUpperCase() === 'NA') return null;
  return v.trim();
}

function parseDdMmYyyy(s: string | null): { dob: string | null; iso: string | null } {
  if (!s) return { dob: null, iso: null };
  const parts = s.split('-');
  if (parts.length !== 3) return { dob: null, iso: null };
  const [dd, mm, yyyy] = parts;
  return {
    dob: `${mm}-${dd}`,
    iso: `${yyyy}-${mm}-${dd}`,
  };
}

function parseSalary(s: string | null): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, '').replace(/₹/g, '').trim());
  return isNaN(n) || n === 0 ? null : n;
}

async function fetchSheetCsv(sheetId: string): Promise<string> {
  // Try by tab name first, then by gid (1172437773 = Employee Master in this sheet)
  const urls = [
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=Employee%20Master`,
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=1172437773`,
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json`,
  ];

  let text = '';
  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) continue;
    const t = await res.text();
    if (t.includes('setResponse(')) { text = t; break; }
  }
  if (!text) throw new Error('Could not read sheet. Make sure sharing is set to "Anyone with the link can view".');

  // Strip Google's JSONP wrapper: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
  const start = text.indexOf('setResponse(');
  const end   = text.lastIndexOf(')');
  if (start === -1 || end === -1) throw new Error('Unexpected response format from Google Sheets.');
  return text.slice(start + 'setResponse('.length, end);
}

function parseGvizJson(jsonStr: string): ParsedEmployee[] {
  const data = JSON.parse(jsonStr) as {
    table: {
      cols: { label: string }[];
      rows: ({ c: ({ v: string | number | null } | null)[] } | null)[];
    };
  };

  const rows = data.table.rows;
  const employees: ParsedEmployee[] = [];

  for (const row of rows) {
    if (!row) continue;
    const c = row.c;
    const get = (i: number): string | null => {
      const cell = c[i];
      if (!cell || cell.v === null || cell.v === undefined) return null;
      return String(cell.v).trim();
    };

    const empCode = na(get(2));
    const name    = na(get(3));
    if (!empCode || !name) continue;
    // Skip placeholder rows
    if (empCode.startsWith('FAPL-023') && !name) continue;

    const statusRaw = na(get(1));
    const status: 'active' | 'inactive' = statusRaw?.toLowerCase() === 'inactive' ? 'inactive' : 'active';

    const dobParsed = parseDdMmYyyy(na(get(4)));
    const dojParsed = parseDdMmYyyy(na(get(7)));
    const lwdParsed = parseDdMmYyyy(na(get(26)));

    employees.push({
      empCode,
      name,
      status,
      dob:              dobParsed.dob,
      phone:            na(get(5)),
      officialPhone:    na(get(9)),
      personalEmail:    na(get(6)),
      officialEmail:    na(get(8)),
      doj:              dojParsed.iso,
      lwd:              lwdParsed.iso,
      department:       na(get(10)),
      designation:      na(get(11)),
      reportingManager: na(get(12)),
      presentAddress:   na(get(16)),
      permanentAddress: na(get(17)),
      grossSalary:      parseSalary(na(get(27))),
      existsInFirestore: false,
    });
  }

  return employees;
}

// ─── Small UI pieces ──────────────────────────────────────────────────────────

function Step({ n, label, done, active }: { n: number; label: string; done: boolean; active: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
        style={{
          backgroundColor: done ? '#D1FAE5' : active ? '#0B1538' : '#F1F5F9',
          color: done ? '#065F46' : active ? '#C9A961' : '#8B8B85',
        }}>
        {done ? '✓' : n}
      </div>
      <span className="text-sm font-medium" style={{ color: active ? '#0A0A0A' : done ? '#065F46' : '#8B8B85' }}>
        {label}
      </span>
    </div>
  );
}

function FieldCount({ emp }: { emp: ParsedEmployee }) {
  let n = 0;
  if (emp.dob)              n++;
  if (emp.phone)            n++;
  if (emp.officialPhone)    n++;
  if (emp.personalEmail)    n++;
  if (emp.presentAddress)   n++;
  if (emp.permanentAddress) n++;
  if (emp.grossSalary)      n++;
  if (emp.doj)              n++;
  if (emp.lwd)              n++;
  if (emp.department)       n++;
  if (emp.designation)      n++;
  if (emp.reportingManager) n++;
  return <span className="text-xs" style={{ color: '#8B8B85' }}>{n} fields</span>;
}

// ─── ImportEmployeesPage ──────────────────────────────────────────────────────

export function ImportEmployeesPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [sheetUrl,   setSheetUrl]   = useState('');
  const [step,       setStep]       = useState<1 | 2 | 3>(1);
  const [employees,  setEmployees]  = useState<ParsedEmployee[]>([]);
  const [results,    setResults]    = useState<SyncResult[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [progress,   setProgress]   = useState(0);

  const isAdmin = profile?.role === 'admin';

  // ── Step 1 → 2: fetch + parse sheet ─────────────────────────────────────

  const handlePreview = async () => {
    const sheetId = extractSheetId(sheetUrl.trim());
    if (!sheetId) { setError('Paste a valid Google Sheets URL (must contain /spreadsheets/d/...).'); return; }

    setLoading(true); setError(''); setEmployees([]);
    try {
      const jsonStr = await fetchSheetCsv(sheetId);
      const parsed  = parseGvizJson(jsonStr);
      if (parsed.length === 0) throw new Error('No employee rows found. Check the sheet has an "Employee Master" tab with data.');

      // Check which emp codes already exist in Firestore
      const snap = await getDocs(query(collection(db, 'users'), where('employeeId', '!=', null)));
      const existing = new Set(snap.docs.map((d) => d.data().employeeId as string));
      const withExists = parsed.map((e) => ({ ...e, existsInFirestore: existing.has(e.empCode) }));

      setEmployees(withExists);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read sheet.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2 → 3: sync to Firestore ───────────────────────────────────────

  const handleSync = async () => {
    setLoading(true); setError(''); setProgress(0);
    const res: SyncResult[] = [];

    // Build a map of employeeId → docRef from Firestore
    const snap = await getDocs(collection(db, 'users'));
    const uidMap = new Map<string, string>();
    snap.docs.forEach((d) => {
      const empId = d.data().employeeId;
      if (empId) uidMap.set(empId, d.id);
    });

    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      setProgress(Math.round(((i + 1) / employees.length) * 100));

      // Public directory fields — safe for all employees to read
      const update: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (emp.doj)              update.joiningDate          = emp.doj;
      if (emp.department)       update.department           = emp.department;
      if (emp.designation)      update.designation          = emp.designation;
      if (emp.reportingManager) update.reportingManagerName = emp.reportingManager;
      update.employeeStatus = emp.status;

      // Personal details — goes to /user_details (admin/HR-only)
      const personalUpdate: Record<string, unknown> = {};
      if (emp.dob)           personalUpdate.dateOfBirth     = emp.dob;
      if (emp.phone)         personalUpdate.phone           = emp.phone;
      if (emp.officialPhone) personalUpdate.officialPhone   = emp.officialPhone;
      if (emp.personalEmail) personalUpdate.personalEmail   = emp.personalEmail;
      if (emp.lwd)           personalUpdate.lastWorkingDate = emp.lwd;
      if (emp.presentAddress)   personalUpdate.presentAddress   = emp.presentAddress;
      if (emp.permanentAddress) personalUpdate.permanentAddress = emp.permanentAddress;

      try {
        const uid = uidMap.get(emp.empCode);
        if (uid) {
          await updateDoc(doc(db, 'users', uid), update);
          if (Object.keys(personalUpdate).length > 0) {
            await setDoc(doc(db, 'user_details', uid), personalUpdate, { merge: true });
          }
          if (emp.grossSalary) {
            await setDoc(doc(db, 'employee_sensitive', uid), { grossSalary: emp.grossSalary }, { merge: true });
          }
          res.push({ empCode: emp.empCode, name: emp.name, action: 'updated' });
        } else {
          // Create a minimal profile doc (no Auth account — that needs the server)
          const newRef = doc(collection(db, 'users'));
          await setDoc(newRef, {
            userId:       newRef.id,
            employeeId:   emp.empCode,
            displayName:  emp.name,
            email:        emp.officialEmail ?? '',
            role:         'employee',
            hrmsAccess:   true,
            crmAccess:    false,
            needsEmailSetup: !emp.officialEmail,
            ...update,
          });
          if (Object.keys(personalUpdate).length > 0) {
            await setDoc(doc(db, 'user_details', newRef.id), personalUpdate, { merge: true });
          }
          if (emp.grossSalary) {
            await setDoc(doc(db, 'employee_sensitive', newRef.id), { grossSalary: emp.grossSalary }, { merge: true });
          }
          res.push({ empCode: emp.empCode, name: emp.name, action: 'created', detail: 'Profile only — no login account' });
        }
      } catch (e) {
        res.push({ empCode: emp.empCode, name: emp.name, action: 'error', detail: e instanceof Error ? e.message : 'Unknown error' });
      }
    }

    setResults(res);
    setStep(3);
    setLoading(false);
  };

  const updated  = results.filter((r) => r.action === 'updated').length;
  const created  = results.filter((r) => r.action === 'created').length;
  const errored  = results.filter((r) => r.action === 'error').length;
  const active   = employees.filter((e) => e.status === 'active').length;
  const inactive = employees.filter((e) => e.status === 'inactive').length;
  const existing = employees.filter((e) => e.existsInFirestore).length;
  const newOnes  = employees.filter((e) => !e.existsInFirestore).length;

  if (!isAdmin) {
    return <p className="text-sm text-center mt-20" style={{ color: '#8B8B85' }}>Admin access required.</p>;
  }

  return (
    <div className="space-y-6 max-w-5xl">

      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/hrms/employees')}
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors shrink-0"
          style={{ color: '#8B8B85' }}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="text-3xl mb-1"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
            Sync from Google Sheet
          </h2>
          <p className="text-sm" style={{ color: '#8B8B85' }}>
            Paste the Employee Master sheet link. Personal details, addresses, and salary sync to all employee profiles.
          </p>
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-3 bg-white rounded-2xl border border-slate-200 px-6 py-4">
        <Step n={1} label="Paste sheet URL" done={step > 1} active={step === 1} />
        <ChevronRight size={14} style={{ color: '#CBD5E1' }} />
        <Step n={2} label="Review employees" done={step > 2} active={step === 2} />
        <ChevronRight size={14} style={{ color: '#CBD5E1' }} />
        <Step n={3} label="Sync complete" done={step === 3} active={step === 3} />
      </div>

      {/* How this works */}
      {step === 1 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>How this works</p>
          <div className="space-y-2 text-sm" style={{ color: '#2A2A2A' }}>
            <div className="flex items-start gap-2"><span className="text-green-600 font-bold shrink-0">✓</span><span>Reads the <strong>Employee Master</strong> tab from your Google Sheet directly in the browser.</span></div>
            <div className="flex items-start gap-2"><span className="text-green-600 font-bold shrink-0">✓</span><span>Matches employees by their <strong>Emp Code</strong> (FAPL-001, etc.) and updates their Firestore profile.</span></div>
            <div className="flex items-start gap-2"><span className="text-green-600 font-bold shrink-0">✓</span><span>Syncs: date of birth, mobile, official phone, personal email, joining date, addresses, gross salary.</span></div>
            <div className="flex items-start gap-2"><span style={{ color: '#F59E0B' }} className="font-bold shrink-0">—</span><span><strong>Aadhaar is never stored</strong> (UIDAI regulation). PAN needs separate encryption step.</span></div>
            <div className="flex items-start gap-2"><span style={{ color: '#F59E0B' }} className="font-bold shrink-0">—</span><span>The sheet must be shared as <strong>"Anyone with the link can view"</strong> for the browser to read it.</span></div>
          </div>
        </div>
      )}

      {/* Step 1 — URL input */}
      {step === 1 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Step 1 — Google Sheet URL</p>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Link2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#8B8B85' }} />
              <input
                type="url"
                className="w-full text-sm pl-9 pr-4 py-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-navy"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={sheetUrl}
                onChange={(e) => { setSheetUrl(e.target.value); setError(''); }}
                style={{ color: '#0A0A0A' }}
              />
            </div>
            <button
              onClick={handlePreview}
              disabled={loading || !sheetUrl.trim()}
              className="flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl transition-opacity hover:opacity-80 disabled:opacity-40 shrink-0"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
            >
              <Eye size={15} />
              {loading ? 'Reading…' : 'Preview'}
            </button>
          </div>
          {error && (
            <div className="flex items-start gap-2 text-sm rounded-xl px-4 py-3" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}
          <div className="flex items-start gap-2 text-xs rounded-xl px-4 py-3" style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}>
            <Info size={13} className="shrink-0 mt-0.5" />
            <span>To share: open the sheet → Share → Change to <strong>Anyone with the link → Viewer</strong>. You can restrict access again after syncing.</span>
          </div>
        </div>
      )}

      {/* Step 2 — Preview */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Summary counts */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total in sheet', value: employees.length, color: '#0A0A0A' },
              { label: 'Active',         value: active,           color: '#065F46' },
              { label: 'Inactive',       value: inactive,         color: '#475569' },
              { label: 'New to Firestore', value: newOnes,        color: '#92400E' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
                <p className="text-2xl font-bold" style={{ color }}>{value}</p>
                <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>{label}</p>
              </div>
            ))}
          </div>

          {/* What will happen callout */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#8B8B85' }}>What happens when you confirm</p>
            <div className="flex items-start gap-2 text-sm" style={{ color: '#2A2A2A' }}>
              <span className="text-blue-600 font-bold shrink-0">→</span>
              <span><strong>{existing} employees</strong> already in Firestore will have their profile <strong>updated</strong> with the sheet data.</span>
            </div>
            {newOnes > 0 && (
              <div className="flex items-start gap-2 text-sm" style={{ color: '#2A2A2A' }}>
                <span className="text-amber-600 font-bold shrink-0">→</span>
                <span><strong>{newOnes} new employees</strong> will get a <strong>Firestore profile created</strong>. Login accounts (Firebase Auth) need to be created separately via Add Employee.</span>
              </div>
            )}
            <div className="flex items-start gap-2 text-sm" style={{ color: '#8B8B85' }}>
              <span className="shrink-0">—</span>
              <span>Aadhaar is skipped. PAN is skipped (needs encryption). Bank accounts are skipped (stored separately).</span>
            </div>
          </div>

          {/* Preview table */}
          <div className="rounded-2xl overflow-hidden bg-white border border-slate-200">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Employee preview</p>
              <button
                onClick={handleSync}
                disabled={loading}
                className="flex items-center gap-2 text-sm font-semibold px-6 py-2.5 rounded-xl transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
              >
                <Upload size={15} />
                {loading ? `Syncing… ${progress}%` : 'Confirm sync'}
              </button>
            </div>

            {loading && (
              <div className="h-2 bg-slate-100">
                <div className="h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%`, backgroundColor: '#0B1538' }} />
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
                    {['Emp Code', 'Name', 'Status', 'Department', 'Designation', 'In System?', 'Fields'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp, idx) => (
                    <tr key={emp.empCode}
                      style={{
                        borderBottom: idx < employees.length - 1 ? '1px solid #F1F5F9' : 'none',
                        opacity: emp.status === 'inactive' ? 0.55 : 1,
                      }}>
                      <td className="px-4 py-2.5 font-mono text-xs" style={{ color: '#8B8B85' }}>{emp.empCode}</td>
                      <td className="px-4 py-2.5 font-medium text-sm" style={{ color: '#0A0A0A' }}>{emp.name}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
                          style={emp.status === 'active'
                            ? { backgroundColor: '#D1FAE5', color: '#065F46' }
                            : { backgroundColor: '#F1F5F9', color: '#475569' }}>
                          {emp.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: '#475569' }}>{emp.department ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: '#475569' }}>{emp.designation ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs">
                        {emp.existsInFirestore
                          ? <span style={{ color: '#065F46' }}>✓ update</span>
                          : <span style={{ color: '#92400E' }}>+ create</span>}
                      </td>
                      <td className="px-4 py-2.5"><FieldCount emp={emp} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — Results */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-2xl p-6 flex items-start gap-4"
            style={{ backgroundColor: '#D1FAE5', border: '1px solid #6EE7B7' }}>
            <CheckCircle2 size={24} className="shrink-0 mt-0.5" style={{ color: '#065F46' }} />
            <div>
              <p className="text-lg font-semibold" style={{ color: '#065F46' }}>Sync complete</p>
              <p className="text-sm mt-1" style={{ color: '#065F46' }}>
                {updated} updated · {created} new profiles created · {errored} errors
              </p>
            </div>
          </div>

          {errored > 0 && (
            <div className="rounded-2xl p-5" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
              <p className="text-sm font-semibold mb-3" style={{ color: '#991B1B' }}>Errors ({errored})</p>
              <ul className="space-y-1">
                {results.filter((r) => r.action === 'error').map((r) => (
                  <li key={r.empCode} className="text-xs" style={{ color: '#991B1B' }}>
                    {r.empCode} {r.name} — {r.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl overflow-hidden bg-white border border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
                    {['Emp Code', 'Name', 'Result', 'Note'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, idx) => (
                    <tr key={r.empCode} style={{ borderBottom: idx < results.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                      <td className="px-4 py-2.5 font-mono text-xs" style={{ color: '#8B8B85' }}>{r.empCode}</td>
                      <td className="px-4 py-2.5 text-sm" style={{ color: '#0A0A0A' }}>{r.name}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-bold"
                          style={{ color: r.action === 'error' ? '#991B1B' : r.action === 'created' ? '#92400E' : '#065F46' }}>
                          {r.action === 'updated' ? '✓ Updated' : r.action === 'created' ? '+ Created' : '✗ Error'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: '#8B8B85' }}>{r.detail ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => { setStep(1); setSheetUrl(''); setEmployees([]); setResults([]); }}
              className="text-sm font-medium px-5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
              style={{ color: '#2A2A2A' }}>
              Sync again
            </button>
            <button
              onClick={() => navigate('/hrms/employees')}
              className="text-sm font-semibold px-5 py-2.5 rounded-xl transition-opacity hover:opacity-80"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              View employees
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
