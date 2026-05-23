import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Search, Edit2, Download, UserPlus, Shield, Eye } from 'lucide-react';
import { updateDoc, doc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { Modal } from '../../../components/ui/Modal';
import { AddEmployeeModal } from './AddEmployeeModal';
import type { UserProfile, CrmRole, ConvertorVertical, MisAccess } from '../../../types';

const CRM_ROLE_LABELS: Record<NonNullable<CrmRole>, string> = {
  viewer:          'Viewer (read-only)',
  lead_generator:  'Lead Generator',
  lead_convertor:  'Lead Convertor',
  manager:         'Manager',
  admin:           'CRM Admin',
};
const CONVERTOR_VERTICAL_LABELS: Record<NonNullable<ConvertorVertical>, string> = {
  loan:      'Loan',
  wealth:    'Wealth',
  insurance: 'Insurance',
};

// ─── Edit modal ───────────────────────────────────────────────────────────────
function EditEmployeeModal({ employee, onClose, adminUserId }: {
  employee: UserProfile;
  onClose: () => void;
  adminUserId: string;
}) {
  const [crmRole,            setCrmRole]            = useState<CrmRole>(employee.crmRole ?? null);
  const [convertorVertical,  setConvertorVertical]  = useState<ConvertorVertical>(employee.convertorVertical ?? null);
  const [crmCanImport,       setCrmCanImport]       = useState<boolean>(employee.crmCanImport ?? false);
  const [isHrmsManager,      setIsHrmsManager]      = useState<boolean>(employee.isHrmsManager ?? false);
  const [misAccess,          setMisAccess]          = useState<MisAccess | null>(employee.misAccess ?? null);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const handleSave = async () => {
    // Validate convertor vertical constraint
    if (crmRole === 'lead_convertor' && !convertorVertical) {
      setError('A Specialist Vertical is required for Lead Convertor role.');
      return;
    }
    const finalVertical: ConvertorVertical = crmRole === 'lead_convertor' ? convertorVertical : null;

    setSaving(true); setError('');
    try {
      const before = {
        crmRole: employee.crmRole ?? null,
        convertorVertical: employee.convertorVertical ?? null,
        crmCanImport: employee.crmCanImport ?? false,
        isHrmsManager: employee.isHrmsManager ?? false,
        misAccess: employee.misAccess ?? null,
      };
      const after  = { crmRole, convertorVertical: finalVertical, crmCanImport, isHrmsManager, misAccess };

      await updateDoc(doc(db, 'users', employee.userId), {
        crmRole:            crmRole ?? null,
        convertorVertical:  finalVertical,
        crmCanImport,
        isHrmsManager,
        misAccess:          misAccess ?? null,
      });

      // Audit log
      await addDoc(collection(db, 'audit_logs'), {
        actor:      adminUserId,
        action:     'update_user_roles',
        targetPath: `/users/${employee.userId}`,
        before,
        after,
        at: serverTimestamp(),
      });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to save.'); setSaving(false); }
  };

  const sel = "w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2";

  return (
    <Modal isOpen onClose={onClose} title={`Edit: ${employee.displayName}`} size="sm"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-slate-200 rounded-xl" style={{ color: '#2A2A2A' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }>
      <div className="space-y-4">
        <div className="text-sm" style={{ color: '#8B8B85' }}>
          {employee.email} · HRMS role: <strong>{employee.role}</strong>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>CRM Role</label>
          <select value={crmRole ?? ''} onChange={(e) => { setCrmRole((e.target.value || null) as CrmRole); if (e.target.value !== 'lead_convertor') setConvertorVertical(null); }} className={sel}>
            <option value="">No CRM role</option>
            {(Object.keys(CRM_ROLE_LABELS) as NonNullable<CrmRole>[]).map((r) => (
              <option key={r} value={r}>{CRM_ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>

        {crmRole === 'lead_convertor' && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Specialist Vertical *</label>
            <select value={convertorVertical ?? ''} onChange={(e) => setConvertorVertical((e.target.value || null) as ConvertorVertical)} className={sel}>
              <option value="">Select vertical…</option>
              {(Object.keys(CONVERTOR_VERTICAL_LABELS) as NonNullable<ConvertorVertical>[]).map((v) => (
                <option key={v} value={v}>{CONVERTOR_VERTICAL_LABELS[v]}</option>
              ))}
            </select>
            <p className="mt-1 text-xs" style={{ color: '#8B8B85' }}>
              Determines which opportunity types this person can receive handoffs for.
            </p>
          </div>
        )}

        {/* CRM import toggle — only relevant when user has CRM access */}
        {crmRole && crmRole !== 'viewer' && (
          <div>
            <label className="flex items-center gap-2.5 text-sm cursor-pointer" style={{ color: '#2A2A2A' }}>
              <input type="checkbox" checked={crmCanImport}
                onChange={(e) => setCrmCanImport(e.target.checked)} className="w-4 h-4 rounded" />
              <span>Can trigger Bulk Import</span>
              <span className="text-xs" style={{ color: '#8B8B85' }}>(managers have this by default)</span>
            </label>
          </div>
        )}

        <div className="pt-1 border-t border-slate-100">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#8B8B85' }}>HRMS Permissions</p>
          <label className="flex items-center gap-2.5 text-sm cursor-pointer" style={{ color: '#2A2A2A' }}>
            <input
              type="checkbox"
              checked={isHrmsManager}
              onChange={(e) => setIsHrmsManager(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <span>HRMS Manager</span>
            <span className="text-xs" style={{ color: '#8B8B85' }}>(can approve leave, override attendance)</span>
          </label>
        </div>

        <div className="pt-1 border-t border-slate-100">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#8B8B85' }}>MIS Access</p>
          <select value={misAccess ?? ''} onChange={(e) => setMisAccess((e.target.value || null) as MisAccess | null)} className={sel}>
            <option value="">No MIS access</option>
            <option value="viewer">Viewer (read-only)</option>
            <option value="admin">Admin (full write)</option>
          </select>
          <p className="mt-1 text-xs" style={{ color: '#8B8B85' }}>Viewer: see all MIS data. Admin: upload statements, approve payouts.</p>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function EmployeesPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { employees, loading } = useAllEmployees();
  const isAdmin       = profile?.role === 'admin';
  const isHrmsManager = profile?.isHrmsManager === true;
  const canViewProfile = isAdmin || isHrmsManager;

  const [search,          setSearch]         = useState('');
  const [editingEmployee, setEditingEmployee] = useState<UserProfile | null>(null);
  const [showAddModal,    setShowAddModal]    = useState(false);

  const filtered = useMemo(() =>
    employees.filter((e) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return e.displayName.toLowerCase().includes(q) || e.email.toLowerCase().includes(q);
    }),
    [employees, search],
  );

  const crmRoleLabel = (r?: CrmRole) => r ? (CRM_ROLE_LABELS[r] ?? r) : '—';
  const verticalLabel = (v?: ConvertorVertical) => v ? (CONVERTOR_VERTICAL_LABELS[v] ?? v) : '—';

  const handleExport = () => {
    // Convert MM-DD to DD-MM-YYYY (use current year as placeholder for display)
    const dobToSheet = (mmdd?: string) => {
      if (!mmdd) return 'NA';
      const [mm, dd] = mmdd.split('-');
      return `${dd}-${mm}-????`; // year not stored; keep placeholder
    };
    const isoToSheet = (iso?: string) => {
      if (!iso) return 'NA';
      const [y, m, d] = iso.split('-');
      return `${d}-${m}-${y}`;
    };
    const salary = (n?: number) => n ? n.toLocaleString('en-IN') : 'NA';
    const v = (s?: string | null) => (s && s.trim()) ? s.trim() : 'NA';

    const headers = [
      'S. No.', 'Status', 'Emp Code', 'Emp Name', 'DOB', 'Gender', 'Blood Group',
      "Father's/Mother's Name", "Spouse's Name",
      'Contact No.', 'Email ID', 'DOJ', 'Official Email ID', 'Official No.',
      'Department', 'Designation', 'Location', 'Reporting Manager',
      'Present Address', 'Permanent Address', 'LWD',
      'Basic Salary', 'HRA', 'Conveyance Allowance', 'Medical Allowance', 'Other Allowances', 'Gross Salary',
    ];

    const rows = employees.map((e, idx) => [
      String(idx + 1),
      e.employeeStatus === 'inactive' ? 'Inactive' : 'Active',
      v(e.employeeId),
      v(e.displayName),
      dobToSheet(e.dateOfBirth),
      v(e.gender),
      v(e.bloodGroup),
      v(e.fatherMotherName),
      v(e.spouseName),
      v(e.phone),
      v(e.personalEmail),
      isoToSheet(e.joiningDate),
      v(e.email),
      v(e.officialPhone),
      v(e.department),
      v(e.designation),
      v(e.location),
      v(e.reportingManagerName),
      v(e.presentAddress),
      v(e.permanentAddress),
      isoToSheet(e.lastWorkingDate),
      salary(e.salaryBasic),
      salary(e.salaryHra),
      salary(e.salaryConveyance),
      salary(e.salaryMedical),
      salary(e.salaryOther),
      salary(e.grossSalary),
    ]);

    const escape = (cell: string) => cell.includes(',') || cell.includes('"') || cell.includes('\n')
      ? `"${cell.replace(/"/g, '""')}"` : cell;

    const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `finvastra-employees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
              Employees
            </h2>
            <p className="text-sm" style={{ color: '#8B8B85' }}>
              {loading ? 'Loading…' : `${filtered.length} of ${employees.length} employees`}
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/hrms/admin/access')}
                className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border transition-colors hover:bg-slate-50"
                style={{ borderColor: '#E2E8F0', color: '#2A2A2A' }}
              >
                <Shield size={14} />
                Manage Permissions
              </button>
              <button
                onClick={handleExport}
                disabled={employees.length === 0}
                className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border transition-colors hover:bg-slate-50 disabled:opacity-40"
                style={{ borderColor: '#E2E8F0', color: '#2A2A2A' }}
              >
                <Download size={14} />
                Export CSV
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg transition-opacity hover:opacity-80"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
              >
                <UserPlus size={14} />
                Add Employee
              </button>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-4 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="text-sm border border-slate-200 rounded-lg pl-9 pr-4 py-2 bg-white focus:outline-none w-full" />
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="animate-pulse divide-y divide-slate-100">
              {[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-slate-50" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr style={{ backgroundColor: '#FAFAF7', borderBottom: '1px solid #E2E8F0' }}>
                    {['Emp Code', 'Name', 'Department', 'Designation', 'Email', 'Status', 'Login Status', canViewProfile ? '' : null].filter(Boolean).map((h) => (
                      <th key={h!} className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((emp) => {
                    const isInactive = emp.employeeStatus === 'inactive';
                    const loginStatus = isInactive
                      ? { label: 'Inactive',          bg: '#F1F5F9', text: '#475569' }
                      : emp.needsEmailSetup
                      ? { label: 'Needs Email Setup', bg: '#FFFBEB', text: '#92400E' }
                      : emp.mustResetPassword
                      ? { label: 'Reset Pending',     bg: '#FFFBEB', text: '#92400E' }
                      : { label: 'Active',            bg: '#D1FAE5', text: '#065F46' };
                    return (
                      <tr key={emp.userId}
                        className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
                        style={{ opacity: isInactive ? 0.55 : 1 }}>
                        <td className="px-4 py-3 font-mono text-xs" style={{ color: '#8B8B85' }}>
                          {emp.employeeId ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => navigate(`/hrms/employees/${emp.userId}`)}
                            className="flex items-center gap-3 hover:opacity-75 transition-opacity text-left"
                          >
                            {emp.photoURL ? (
                              <img src={emp.photoURL} alt={emp.displayName} className="w-8 h-8 rounded-full object-cover shrink-0" />
                            ) : (
                              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                                {emp.displayName?.[0]}
                              </div>
                            )}
                            <p className="text-sm font-medium" style={{ color: '#0A0A0A' }}>{emp.displayName}</p>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>{emp.department ?? '—'}</td>
                        <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>{emp.designation ?? '—'}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{emp.email || '—'}</td>
                        <td className="px-4 py-3 text-xs capitalize" style={{ color: emp.employeeStatus === 'inactive' ? '#475569' : '#065F46' }}>
                          {emp.employeeStatus ?? 'active'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
                            style={{ backgroundColor: loginStatus.bg, color: loginStatus.text }}>
                            {loginStatus.label}
                          </span>
                        </td>
                        {canViewProfile && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => navigate(`/hrms/employees/${emp.userId}`)}
                                title="View profile"
                                className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors"
                              >
                                <Eye size={14} />
                              </button>
                              {isAdmin && (
                                <button onClick={() => setEditingEmployee(emp)} title="Edit permissions" className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors">
                                  <Edit2 size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={canViewProfile ? 8 : 7} className="px-4 py-12 text-center text-sm" style={{ color: '#8B8B85' }}>No employees found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editingEmployee && user && (
        <EditEmployeeModal
          employee={editingEmployee}
          onClose={() => setEditingEmployee(null)}
          adminUserId={user.uid}
        />
      )}

      {showAddModal && (
        <AddEmployeeModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => setShowAddModal(false)}
        />
      )}
    </>
  );
}
