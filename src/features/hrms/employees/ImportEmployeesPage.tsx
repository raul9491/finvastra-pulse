import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Upload, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedEmployee {
  empCode: string;
  name: string;
  status: 'active' | 'inactive';
  officialEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  officialPhone: string | null;
  dob: string | null;
  doj: string | null;
  lwd: string | null;
  department: string | null;
  designation: string | null;
  reportingManager: string | null;
  panMasked: string | null;
  uan: string | null;
  presentAddress: string | null;
  permanentAddress: string | null;
  personalBankName: string | null;
  personalBankBranch: string | null;
  personalBankIfsc: string | null;
  officialBankName: string | null;
  officialBankBranch: string | null;
  officialBankIfsc: string | null;
  grossSalary: number | null;
  roleAttrs: {
    role: 'admin' | 'employee';
    crmRole: string | null;
    misAccess: string | null;
    crmAccess: boolean;
  };
  needsEmailSetup: boolean;
}

interface PreviewResponse {
  employees: ParsedEmployee[];
  total: number;
  active: number;
  inactive: number;
}

interface ConfirmResponse {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: 'active' | 'inactive' }) {
  return (
    <span
      className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
      style={status === 'active'
        ? { backgroundColor: '#D1FAE5', color: '#065F46' }
        : { backgroundColor: '#F1F5F9', color: '#475569' }}
    >
      {status}
    </span>
  );
}

function RolePill({ role, crmRole }: { role: string; crmRole: string | null }) {
  const isAdmin = role === 'admin';
  return (
    <span
      className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
      style={isAdmin
        ? { backgroundColor: '#FEF3C7', color: '#92400E' }
        : { backgroundColor: '#DBEAFE', color: '#1D4ED8' }}
    >
      {isAdmin ? 'Admin' : (crmRole?.replace('_', ' ') ?? 'Employee')}
    </span>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl p-4 bg-white border border-slate-200 text-center">
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>{label}</p>
    </div>
  );
}

// ─── Preview table ────────────────────────────────────────────────────────────

function PreviewTable({ employees }: { employees: ParsedEmployee[] }) {
  const headers = ['Emp Code', 'Name', 'Department', 'Designation', 'Official Email', 'Status', 'Role', 'Auth'];
  return (
    <div className="rounded-2xl overflow-hidden bg-white border border-slate-200">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
              {headers.map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: '#475569' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp, idx) => (
              <tr key={emp.empCode}
                style={{
                  borderBottom: idx < employees.length - 1 ? '1px solid #F1F5F9' : 'none',
                  backgroundColor: emp.status === 'inactive' ? '#F8FAFC' : (idx % 2 === 0 ? '#FFFFFF' : '#FAFAF7'),
                  opacity: emp.status === 'inactive' ? 0.6 : 1,
                }}>
                <td className="px-4 py-2.5 font-mono text-xs" style={{ color: '#8B8B85' }}>{emp.empCode}</td>
                <td className="px-4 py-2.5 font-medium text-sm" style={{ color: '#0A0A0A' }}>{emp.name}</td>
                <td className="px-4 py-2.5 text-xs" style={{ color: '#475569' }}>{emp.department ?? '—'}</td>
                <td className="px-4 py-2.5 text-xs" style={{ color: '#475569' }}>{emp.designation ?? '—'}</td>
                <td className="px-4 py-2.5 text-xs" style={{ color: '#475569' }}>
                  {emp.officialEmail ?? (
                    <span style={{ color: '#8B8B85' }}>
                      {emp.needsEmailSetup ? '⚠ needs setup' : '—'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5"><StatusPill status={emp.status} /></td>
                <td className="px-4 py-2.5">
                  <RolePill role={emp.roleAttrs.role} crmRole={emp.roleAttrs.crmRole} />
                </td>
                <td className="px-4 py-2.5 text-xs" style={{ color: '#475569' }}>
                  {emp.status === 'inactive' ? (
                    <span style={{ color: '#8B8B85' }}>inactive</span>
                  ) : emp.officialEmail ? (
                    <span style={{ color: '#065F46' }}>✓ create</span>
                  ) : (
                    <span style={{ color: '#8B8B85' }}>Firestore only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── ImportEmployeesPage ──────────────────────────────────────────────────────

export function ImportEmployeesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [preview,     setPreview]     = useState<PreviewResponse | null>(null);
  const [result,      setResult]      = useState<ConfirmResponse | null>(null);
  const [loading,     setLoading]     = useState<'preview' | 'import' | null>(null);
  const [error,       setError]       = useState('');

  const getToken = async () => {
    const token = await user?.getIdToken();
    if (!token) throw new Error('Not authenticated');
    return token;
  };

  const handlePreview = async () => {
    setLoading('preview'); setError(''); setPreview(null); setResult(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/employees/import-preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as PreviewResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Preview failed');
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setLoading(null);
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    const toCreate = preview.employees.filter(
      (e) => e.status === 'active' && e.officialEmail && !e.needsEmailSetup,
    ).length;
    if (!window.confirm(
      `This will create up to ${toCreate} Firebase Auth accounts and write Firestore profiles for all ${preview.total} employees. Continue?`,
    )) return;

    setLoading('import'); setError('');
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/employees/import-confirm', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as ConfirmResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Import failed');
      setResult(data);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
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
            Reads the Finvastra employee master sheet via service account and creates Auth accounts + profiles.
          </p>
        </div>
      </div>

      {/* Action panel */}
      {!result && (
        <div className="rounded-2xl p-5 bg-white border border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>Employee Master sheet</p>
            <p className="text-xs mt-0.5" style={{ color: '#8B8B85' }}>
              Reads all rows from the "Employee Master" tab. Aadhaar is never stored. PAN + bank accounts are encrypted.
            </p>
          </div>
          <button
            onClick={handlePreview}
            disabled={loading !== null}
            className="flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl transition-opacity hover:opacity-80 disabled:opacity-40 shrink-0"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
          >
            <Users size={15} />
            {loading === 'preview' ? 'Loading…' : 'Preview employees'}
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-2 text-sm"
          style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
          <AlertCircle size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Preview results */}
      {preview && !result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <SummaryCard label="Total employees" value={preview.total} color="#0A0A0A" />
            <SummaryCard label="Active" value={preview.active} color="#065F46" />
            <SummaryCard label="Inactive" value={preview.inactive} color="#475569" />
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>
              Review before confirming
            </p>
            <button
              onClick={handleImport}
              disabled={loading !== null}
              className="flex items-center gap-2 text-sm font-semibold px-6 py-2.5 rounded-xl transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
            >
              <Upload size={15} />
              {loading === 'import' ? 'Importing…' : 'Confirm import'}
            </button>
          </div>

          <PreviewTable employees={preview.employees} />
        </div>
      )}

      {/* Import complete */}
      {result && (
        <div className="space-y-4">
          <div className="rounded-xl p-5 flex items-start gap-3"
            style={{ backgroundColor: '#D1FAE5', border: '1px solid #6EE7B7' }}>
            <CheckCircle2 size={18} className="shrink-0 mt-0.5" style={{ color: '#065F46' }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: '#065F46' }}>Import complete</p>
              <p className="text-xs mt-0.5" style={{ color: '#065F46' }}>
                {result.created} created · {result.updated} updated · {result.skipped} inactive
              </p>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="rounded-xl p-4" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
              <p className="text-sm font-semibold mb-2" style={{ color: '#991B1B' }}>
                {result.errors.length} row{result.errors.length > 1 ? 's' : ''} failed
              </p>
              <ul className="text-xs space-y-1" style={{ color: '#991B1B' }}>
                {result.errors.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            </div>
          )}

          <button
            onClick={() => { setResult(null); setPreview(null); }}
            className="text-sm font-semibold px-5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
            style={{ color: '#2A2A2A' }}
          >
            Run again
          </button>
        </div>
      )}
    </div>
  );
}
