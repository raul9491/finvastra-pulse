import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Edit2, Download, UserPlus, Shield, Eye,
  LogOut, UserCheck, AlertTriangle, CheckSquare, X,
} from 'lucide-react';
import {
  updateDoc, doc, addDoc, collection, getDocs,
  serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { Modal } from '../../../components/ui/Modal';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useToast } from '../../../components/ui/Toast';
import { AddEmployeeModal } from './AddEmployeeModal';
import {
  DEPARTMENTS, DESIGNATION_GROUPS,
  SUPER_ADMIN_UIDS, SUPER_ADMIN_LABELS, isSuperAdmin,
} from '../../../config/hrmsConfig';
import type { UserProfile, CrmRole, ConvertorVertical, MisAccess, ExitReason } from '../../../types';
import { EXIT_REASON_LABELS } from '../../../types';

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

// ─── Grouped designation select ───────────────────────────────────────────────
function DesignationSelect({ value, onChange, className }: {
  value: string; onChange: (v: string) => void; className?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">— Select —</option>
      {DESIGNATION_GROUPS.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.designations.map((d) => <option key={d} value={d}>{d}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

// ─── Edit employee modal ──────────────────────────────────────────────────────
// Covers: CRM roles, HRMS access, MIS access, Department, Designation, Reporting Manager
function EditEmployeeModal({ employee, allEmployees, onClose, adminUserId }: {
  employee: UserProfile;
  allEmployees: UserProfile[];
  onClose: () => void;
  adminUserId: string;
}) {
  const [crmRole,           setCrmRole]           = useState<CrmRole>(employee.crmRole ?? null);
  const [convertorVertical, setConvertorVertical] = useState<ConvertorVertical>(employee.convertorVertical ?? null);
  const [crmCanImport,      setCrmCanImport]      = useState<boolean>(employee.crmCanImport ?? false);
  const [isHrmsManager,     setIsHrmsManager]     = useState<boolean>(employee.isHrmsManager ?? false);
  const [misAccess,         setMisAccess]         = useState<MisAccess | null>(employee.misAccess ?? null);
  const [department,        setDepartment]        = useState<string>(employee.department ?? '');
  const [designation,       setDesignation]       = useState<string>(employee.designation ?? '');
  const [reportingMgrUid,   setReportingMgrUid]   = useState<string>(
    (employee as UserProfile & { reportingManagerUid?: string }).reportingManagerUid ?? ''
  );
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  // Reporting manager options sorted: super admins → admins → employees
  const managerOptions = useMemo(() =>
    [...allEmployees]
      .filter((e) => e.userId !== employee.userId) // can't be own manager
      .sort((a, b) => {
        const as_ = isSuperAdmin(a.userId) ? 0 : a.role === 'admin' ? 1 : 2;
        const bs_ = isSuperAdmin(b.userId) ? 0 : b.role === 'admin' ? 1 : 2;
        if (as_ !== bs_) return as_ - bs_;
        return a.displayName.localeCompare(b.displayName);
      })
      .map((e) => ({
        value: e.userId,
        label: `${e.displayName}${e.designation ? ` — ${e.designation}` : ''}`,
      })),
    [allEmployees, employee.userId],
  );

  const handleSave = async () => {
    if (crmRole === 'lead_convertor' && !convertorVertical) {
      setError('A Specialist Vertical is required for Lead Convertor role.');
      return;
    }
    const finalVertical: ConvertorVertical = crmRole === 'lead_convertor' ? convertorVertical : null;
    setSaving(true); setError('');
    try {
      const resolvedMgrName = allEmployees.find((e) => e.userId === reportingMgrUid)?.displayName ?? null;

      const patch: Record<string, unknown> = {
        crmRole:            crmRole ?? null,
        convertorVertical:  finalVertical,
        crmCanImport,
        isHrmsManager,
        misAccess:          misAccess ?? null,
        ...(department  ? { department }  : {}),
        ...(designation ? { designation } : {}),
        ...(reportingMgrUid
          ? { reportingManagerUid: reportingMgrUid, reportingManagerName: resolvedMgrName }
          : {}),
      };

      await updateDoc(doc(db, 'users', employee.userId), patch);
      await addDoc(collection(db, 'audit_logs'), {
        actor: adminUserId, action: 'update_employee_profile',
        targetPath: `/users/${employee.userId}`, patch, at: serverTimestamp(),
      });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to save.'); setSaving(false); }
  };

  const sel = 'w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2';

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

        {/* Profile */}
        <div className="pt-1 border-t border-slate-100">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#8B8B85' }}>Profile</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Department</label>
              <select value={department} onChange={(e) => setDepartment(e.target.value)} className={sel}>
                <option value="">— Select —</option>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Designation</label>
              <DesignationSelect value={designation} onChange={setDesignation} className={sel} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Reporting Manager</label>
              <SearchableSelect
                options={managerOptions}
                value={reportingMgrUid}
                onChange={setReportingMgrUid}
                placeholder="Search employees…"
                emptyMessage="No employees found"
              />
            </div>
          </div>
        </div>

        {/* CRM */}
        <div className="pt-1 border-t border-slate-100">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#8B8B85' }}>CRM Role</p>
          <select value={crmRole ?? ''} onChange={(e) => { setCrmRole((e.target.value || null) as CrmRole); if (e.target.value !== 'lead_convertor') setConvertorVertical(null); }} className={sel}>
            <option value="">No CRM role</option>
            {(Object.keys(CRM_ROLE_LABELS) as NonNullable<CrmRole>[]).map((r) => (
              <option key={r} value={r}>{CRM_ROLE_LABELS[r]}</option>
            ))}
          </select>
          {crmRole === 'lead_convertor' && (
            <div className="mt-2">
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Specialist Vertical *</label>
              <select value={convertorVertical ?? ''} onChange={(e) => setConvertorVertical((e.target.value || null) as ConvertorVertical)} className={sel}>
                <option value="">Select vertical…</option>
                {(Object.keys(CONVERTOR_VERTICAL_LABELS) as NonNullable<ConvertorVertical>[]).map((v) => (
                  <option key={v} value={v}>{CONVERTOR_VERTICAL_LABELS[v]}</option>
                ))}
              </select>
            </div>
          )}
          {crmRole && crmRole !== 'viewer' && (
            <label className="flex items-center gap-2.5 text-sm cursor-pointer mt-2" style={{ color: '#2A2A2A' }}>
              <input type="checkbox" checked={crmCanImport} onChange={(e) => setCrmCanImport(e.target.checked)} className="w-4 h-4 rounded" />
              <span>Can trigger Bulk Import</span>
            </label>
          )}
        </div>

        {/* HRMS */}
        <div className="pt-1 border-t border-slate-100">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#8B8B85' }}>HRMS Permissions</p>
          <label className="flex items-center gap-2.5 text-sm cursor-pointer" style={{ color: '#2A2A2A' }}>
            <input type="checkbox" checked={isHrmsManager} onChange={(e) => setIsHrmsManager(e.target.checked)} className="w-4 h-4 rounded" />
            <span>HRMS Manager</span>
            <span className="text-xs" style={{ color: '#8B8B85' }}>(can approve leave, override attendance)</span>
          </label>
        </div>

        {/* MIS */}
        <div className="pt-1 border-t border-slate-100">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#8B8B85' }}>MIS Access</p>
          <select value={misAccess ?? ''} onChange={(e) => setMisAccess((e.target.value || null) as MisAccess | null)} className={sel}>
            <option value="">No MIS access</option>
            <option value="viewer">Viewer (read-only)</option>
            <option value="admin">Admin (full write)</option>
          </select>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Deactivate modal ─────────────────────────────────────────────────────────
function DeactivateModal({ employee, onClose, onDone }: {
  employee: UserProfile; onClose: () => void; onDone: (warning?: string | null) => void;
}) {
  const { user } = useAuth();
  const [lwd,        setLwd]        = useState('');
  const [exitReason, setExitReason] = useState<ExitReason>('resignation');
  const [notes,      setNotes]      = useState('');
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState('');

  const handleConfirm = async () => {
    if (!lwd) { setError('Last working date is required.'); return; }
    if (!user) { setError('Not authenticated.'); return; }
    setBusy(true); setError('');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/admin/employees/${employee.userId}/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ lastWorkingDate: lwd, exitReason, notes }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; warning?: string; openLeads?: number; openOpportunities?: number };
      if (!res.ok) throw new Error(data.error ?? 'Deactivation failed');
      onDone(data.warning ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deactivation failed');
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Mark ${employee.displayName} as Exited`} size="sm"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-slate-200 rounded-xl" style={{ color: '#2A2A2A' }}>Cancel</button>
          <button onClick={handleConfirm} disabled={busy || !lwd}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}>
            {busy ? 'Processing…' : 'Confirm Exit'}
          </button>
        </>
      }>
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm"
          style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B' }}>
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>This will immediately disable <strong>{employee.displayName}</strong>'s login access.</span>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Last Working Date *</label>
          <input type="date" value={lwd} onChange={(e) => setLwd(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none" style={{ color: '#0A0A0A' }} />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Exit Reason *</label>
          <select value={exitReason} onChange={(e) => setExitReason(e.target.value as ExitReason)}
            className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none" style={{ color: '#0A0A0A' }}>
            {(Object.entries(EXIT_REASON_LABELS) as [ExitReason, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Any additional notes…"
            className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none resize-none" style={{ color: '#0A0A0A' }} />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Reactivate modal ─────────────────────────────────────────────────────────
function ReactivateModal({ employee, onClose, onDone }: {
  employee: UserProfile; onClose: () => void; onDone: () => void;
}) {
  const { user } = useAuth();
  const [newJoiningDate, setNewJoiningDate] = useState('');
  const [notes,          setNotes]          = useState('');
  const [busy,           setBusy]           = useState(false);
  const [error,          setError]          = useState('');

  const handleConfirm = async () => {
    if (!user) { setError('Not authenticated.'); return; }
    setBusy(true); setError('');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/admin/employees/${employee.userId}/reactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ newJoiningDate: newJoiningDate || null, notes }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Reactivation failed');
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reactivation failed');
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Reactivate ${employee.displayName}`} size="sm"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-slate-200 rounded-xl" style={{ color: '#2A2A2A' }}>Cancel</button>
          <button onClick={handleConfirm} disabled={busy}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#065F46', color: '#FFFFFF' }}>
            {busy ? 'Processing…' : 'Reactivate'}
          </button>
        </>
      }>
      <div className="space-y-4">
        <p className="text-sm" style={{ color: '#2A2A2A' }}>
          This will re-enable <strong>{employee.displayName}</strong>'s login access and create a new onboarding checklist.
        </p>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>New Joining Date (optional)</label>
          <input type="date" value={newJoiningDate} onChange={(e) => setNewJoiningDate(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none" style={{ color: '#0A0A0A' }} />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Reason for reactivation…"
            className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none resize-none" style={{ color: '#0A0A0A' }} />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Bulk edit confirmation modal ─────────────────────────────────────────────
function BulkEditConfirmModal({ count, newDept, newDesig, onConfirm, onCancel, busy }: {
  count: number;
  newDept: string;
  newDesig: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <Modal isOpen onClose={onCancel} title={`Update ${count} employees?`} size="sm"
      footer={
        <>
          <button onClick={onCancel} disabled={busy} className="px-5 py-2.5 text-sm border border-slate-200 rounded-xl" style={{ color: '#2A2A2A' }}>Cancel</button>
          <button onClick={onConfirm} disabled={busy}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {busy ? 'Applying…' : 'Apply Changes'}
          </button>
        </>
      }>
      <div className="space-y-3 text-sm" style={{ color: '#2A2A2A' }}>
        <p>This will overwrite the current values for <strong>{count} employees</strong>:</p>
        <div className="rounded-lg px-4 py-3 space-y-1" style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
          <p><span className="text-mute font-medium">Department:</span> {newDept || <span className="text-mute italic">unchanged</span>}</p>
          <p><span className="text-mute font-medium">Designation:</span> {newDesig || <span className="text-mute italic">unchanged</span>}</p>
        </div>
      </div>
    </Modal>
  );
}

// ─── Bulk edit bar ────────────────────────────────────────────────────────────
function BulkEditBar({ selectedIds, onApply, onClear }: {
  selectedIds: Set<string>;
  onApply: (dept: string, desig: string) => void;
  onClear: () => void;
}) {
  const [bulkDept,  setBulkDept]  = useState('');
  const [bulkDesig, setBulkDesig] = useState('');
  const count = selectedIds.size;
  const canApply = bulkDept || bulkDesig;

  const sel = 'text-xs bg-[#0B1538] border border-[#1B2A4E] text-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-gold/30';

  return (
    <div className="fixed bottom-6 left-[calc(50%+7.5rem)] -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl"
      style={{ backgroundColor: '#0A0A0A', border: '1px solid #1B2A4E', minWidth: 560 }}>
      <CheckSquare size={14} style={{ color: '#C9A961' }} />
      <span className="text-sm font-semibold shrink-0" style={{ color: '#C9A961' }}>
        {count} {count === 1 ? 'employee' : 'employees'} selected
      </span>
      <div className="w-px h-5 shrink-0" style={{ backgroundColor: '#1B2A4E' }} />

      {/* Department */}
      <select value={bulkDept} onChange={(e) => setBulkDept(e.target.value)} className={sel}>
        <option value="">Change department…</option>
        {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>

      {/* Designation (grouped) */}
      <select value={bulkDesig} onChange={(e) => setBulkDesig(e.target.value)} className={sel}>
        <option value="">Change designation…</option>
        {DESIGNATION_GROUPS.map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.designations.map((d) => <option key={d} value={d}>{d}</option>)}
          </optgroup>
        ))}
      </select>

      <button
        onClick={() => { if (canApply) onApply(bulkDept, bulkDesig); }}
        disabled={!canApply}
        className="text-xs px-3.5 py-1.5 rounded-lg font-semibold transition-opacity disabled:opacity-30"
        style={{ backgroundColor: '#C9A961', color: '#0A0A0A' }}>
        Apply Changes
      </button>

      <button onClick={onClear}
        className="text-slate-400 hover:text-slate-200 transition-colors ml-1"
        title="Clear selection">
        <X size={15} />
      </button>
    </div>
  );
}

// ─── Status filter type ────────────────────────────────────────────────────────
type StatusFilter = 'all' | 'active' | 'inactive';

// ─── Main page ────────────────────────────────────────────────────────────────
export function EmployeesPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { employees, loading } = useAllEmployees();
  const toast = useToast();

  const isAdmin       = profile?.role === 'admin';
  const isHrmsManager = profile?.isHrmsManager === true;
  const canManage     = isAdmin || isHrmsManager;
  const canViewProfile = canManage;

  const [search,           setSearch]           = useState('');
  const [statusFilter,     setStatusFilter]     = useState<StatusFilter>(canManage ? 'all' : 'active');
  const [editingEmployee,  setEditingEmployee]  = useState<UserProfile | null>(null);
  const [deactivatingEmp,  setDeactivatingEmp]  = useState<UserProfile | null>(null);
  const [reactivatingEmp,  setReactivatingEmp]  = useState<UserProfile | null>(null);
  const [showAddModal,     setShowAddModal]     = useState(false);
  const [addPrefill,       setAddPrefill]       = useState<{ name?: string; email?: string; phone?: string } | undefined>();

  // Auto-open Add Employee modal when ?addNew=1 is present (e.g. from Recruitment "hired" CTA)
  useEffect(() => {
    if (searchParams.get('addNew') === '1' && canManage) {
      setAddPrefill({
        name:  searchParams.get('prefillName')  ?? undefined,
        email: searchParams.get('prefillEmail') ?? undefined,
        phone: searchParams.get('prefillPhone') ?? undefined,
      });
      setShowAddModal(true);
      // Remove params from URL so a refresh doesn't re-open the modal
      setSearchParams({}, { replace: true });
    }
    // Only run on mount — searchParams reference is stable for initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bulk edit state (admin + hrmsManager only)
  const [selectedIds,    setSelectedIds]    = useState<Set<string>>(new Set());
  const [bulkConfirm,    setBulkConfirm]    = useState<{ dept: string; desig: string } | null>(null);
  const [bulkApplying,   setBulkApplying]   = useState(false);

  const visibleEmployees = useMemo(() => {
    const byEmpCode = (a: typeof employees[0], b: typeof employees[0]) =>
      (a.employeeId ?? '').localeCompare(b.employeeId ?? '', undefined, { numeric: true, sensitivity: 'base' });
    if (!canManage) return employees.filter((e) => (e.employeeStatus ?? 'active') === 'active').sort(byEmpCode);
    if (statusFilter === 'active')   return employees.filter((e) => (e.employeeStatus ?? 'active') === 'active').sort(byEmpCode);
    if (statusFilter === 'inactive') return employees.filter((e) => e.employeeStatus === 'inactive').sort(byEmpCode);
    return [...employees].sort(byEmpCode);
  }, [employees, canManage, statusFilter]);

  const filtered = useMemo(() =>
    visibleEmployees.filter((e) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return e.displayName.toLowerCase().includes(q) || e.email.toLowerCase().includes(q);
    }),
    [visibleEmployees, search],
  );

  const allFilteredSelected = filtered.length > 0 &&
    filtered.every((e) => selectedIds.has(e.userId));

  function toggleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(filtered.map((e) => e.userId)));
    } else {
      setSelectedIds(new Set());
    }
  }
  function toggleSelect(uid: string, checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) next.add(uid); else next.delete(uid);
    setSelectedIds(next);
  }

  // Bulk apply — chunk Firestore writes into batches of 500
  const handleBulkApply = async (dept: string, desig: string) => {
    setBulkApplying(true);
    try {
      const uids = [...selectedIds];
      const patch: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (dept)  patch.department  = dept;
      if (desig) patch.designation = desig;

      // Chunk into batches of 500
      for (let i = 0; i < uids.length; i += 500) {
        const chunk = uids.slice(i, i + 500);
        const batch = writeBatch(db);
        chunk.forEach((uid) => batch.update(doc(db, 'users', uid), patch));
        await batch.commit();
      }
      // Audit log
      if (user) {
        await addDoc(collection(db, 'audit_logs'), {
          actor:      user.uid,
          action:     'bulk_profile_update',
          targetPath: '/users/[bulk]',
          patch:      { ...patch, updatedIds: [...selectedIds] },
          at:         serverTimestamp(),
        });
      }
    } finally {
      setBulkApplying(false);
      setBulkConfirm(null);
      setSelectedIds(new Set());
    }
  };

  const handleExport = async () => {
    const dobToSheet = (mmdd?: string) => {
      if (!mmdd) return 'NA';
      const [mm, dd] = mmdd.split('-');
      return `${dd}-${mm}-????`;
    };
    const isoToSheet = (iso?: string) => {
      if (!iso) return 'NA';
      const [y, m, d] = iso.split('-');
      return `${d}-${m}-${y}`;
    };
    type SensRow = { salaryBasic?: number; salaryHra?: number; salaryConveyance?: number; salaryMedical?: number; salaryOther?: number; grossSalary?: number };
    type DetRow  = { phone?: string; officialPhone?: string; personalEmail?: string; dateOfBirth?: string; presentAddress?: string; permanentAddress?: string; lastWorkingDate?: string; gender?: string; bloodGroup?: string; fatherMotherName?: string; spouseName?: string };

    const [sensSnap, detSnap] = await Promise.all([
      getDocs(collection(db, 'employee_sensitive')),
      getDocs(collection(db, 'user_details')),
    ]);
    const sensMap: Record<string, SensRow> = {};
    sensSnap.forEach((d) => { sensMap[d.id] = d.data() as SensRow; });
    const detMap: Record<string, DetRow> = {};
    detSnap.forEach((d) => { detMap[d.id] = d.data() as DetRow; });

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

    const rows = employees.map((e, idx) => {
      const det = detMap[e.userId] ?? {};
      const sen = sensMap[e.userId] ?? {};
      return [
        String(idx + 1), e.employeeStatus === 'inactive' ? 'Inactive' : 'Active',
        v(e.employeeId), v(e.displayName), dobToSheet(det.dateOfBirth),
        v(det.gender), v(det.bloodGroup), v(det.fatherMotherName), v(det.spouseName),
        v(det.phone), v(det.personalEmail), isoToSheet(e.joiningDate),
        v(e.email), v(det.officialPhone), v(e.department), v(e.designation),
        v(e.location), v(e.reportingManagerName),
        v(det.presentAddress), v(det.permanentAddress), isoToSheet(det.lastWorkingDate),
        salary(sen.salaryBasic), salary(sen.salaryHra), salary(sen.salaryConveyance),
        salary(sen.salaryMedical), salary(sen.salaryOther), salary(sen.grossSalary),
      ];
    });

    const escape = (cell: string) => cell.includes(',') || cell.includes('"') || cell.includes('\n')
      ? `"${cell.replace(/"/g, '""')}"` : cell;
    const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `finvastra-employees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // Column count for empty-state colSpan
  const colCount = 2 + // checkbox + emp code
    3 + // name, dept, desig
    2 + // email, status
    (canManage ? 1 : 0) + // login status
    (canViewProfile ? 1 : 0); // actions

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
              <button onClick={() => navigate('/hrms/admin/permissions')}
                className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border transition-colors hover:bg-slate-50"
                style={{ borderColor: '#E2E8F0', color: '#2A2A2A' }}>
                <Shield size={14} /> Manage Permissions
              </button>
              <button onClick={handleExport} disabled={employees.length === 0}
                className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border transition-colors hover:bg-slate-50 disabled:opacity-40"
                style={{ borderColor: '#E2E8F0', color: '#2A2A2A' }}>
                <Download size={14} /> Export CSV
              </button>
              <button onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg transition-opacity hover:opacity-80"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                <UserPlus size={14} /> Add Employee
              </button>
            </div>
          )}
        </div>

        {/* Search + status filter */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email…"
              className="text-sm border border-slate-200 rounded-lg pl-9 pr-4 py-2 bg-white focus:outline-none w-56" />
          </div>
          {canManage && (
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
              {(['all', 'active', 'inactive'] as StatusFilter[]).map((f) => (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md capitalize transition-colors"
                  style={statusFilter === f
                    ? { backgroundColor: '#0B1538', color: '#FFFFFF' }
                    : { color: '#8B8B85' }}>
                  {f}
                </button>
              ))}
            </div>
          )}
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
                    {/* Select-all checkbox — admin/HR only */}
                    {canManage && (
                      <th className="px-4 py-3 w-10">
                        <input type="checkbox" checked={allFilteredSelected}
                          onChange={(e) => toggleSelectAll(e.target.checked)}
                          className="w-4 h-4 rounded" />
                      </th>
                    )}
                    {['Emp Code', 'Name', 'Department', 'Designation', 'Email', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>{h}</th>
                    ))}
                    {canManage && <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Login Status</th>}
                    {canViewProfile && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((emp) => {
                    const isInactive = (emp.employeeStatus ?? 'active') === 'inactive';
                    const isSA = isSuperAdmin(emp.userId);
                    const isSelected = selectedIds.has(emp.userId);
                    const loginStatus = isInactive
                      ? { label: 'Inactive',          bg: '#F1F5F9', text: '#475569' }
                      : emp.needsEmailSetup
                      ? { label: 'Needs Email Setup', bg: '#FFFBEB', text: '#92400E' }
                      : emp.mustResetPassword
                      ? { label: 'Reset Pending',     bg: '#FFFBEB', text: '#92400E' }
                      : { label: 'Active',            bg: '#D1FAE5', text: '#065F46' };

                    return (
                      <tr key={emp.userId}
                        className="border-b border-slate-100 last:border-0 transition-colors"
                        style={{
                          opacity: isInactive ? 0.5 : 1,
                          backgroundColor: isSelected ? 'rgba(201,169,97,0.04)' : undefined,
                          borderLeft: isSelected ? '3px solid #C9A961' : '3px solid transparent',
                        }}>

                        {/* Row checkbox */}
                        {canManage && (
                          <td className="px-4 py-3">
                            <input type="checkbox" checked={isSelected}
                              onChange={(e) => toggleSelect(emp.userId, e.target.checked)}
                              className="w-4 h-4 rounded" />
                          </td>
                        )}

                        <td className="px-4 py-3 font-mono text-xs" style={{ color: '#8B8B85' }}>
                          {emp.employeeId ?? '—'}
                        </td>

                        <td className="px-4 py-3">
                          <button onClick={() => navigate(`/hrms/employees/${emp.userId}`)}
                            className="flex items-center gap-3 hover:opacity-75 transition-opacity text-left">
                            {emp.photoURL ? (
                              <img src={emp.photoURL} alt={emp.displayName} className="w-8 h-8 rounded-full object-cover shrink-0" />
                            ) : (
                              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                                {emp.displayName?.[0]}
                              </div>
                            )}
                            <div>
                              <p className="text-sm font-medium" style={{ color: '#0A0A0A' }}>{emp.displayName}</p>
                              {isSA && (
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-widest"
                                  style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                                  ★ Super Admin
                                </span>
                              )}
                              {!isSA && isInactive && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                                  style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>Inactive</span>
                              )}
                            </div>
                          </button>
                        </td>

                        <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>{emp.department ?? '—'}</td>
                        <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>{emp.designation ?? '—'}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{emp.email || '—'}</td>
                        <td className="px-4 py-3 text-xs capitalize" style={{ color: isInactive ? '#475569' : '#065F46' }}>
                          {emp.employeeStatus ?? 'active'}
                        </td>

                        {canManage && (
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
                              style={{ backgroundColor: loginStatus.bg, color: loginStatus.text }}>
                              {loginStatus.label}
                            </span>
                          </td>
                        )}

                        {canViewProfile && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button onClick={() => navigate(`/hrms/employees/${emp.userId}`)} title="View profile"
                                className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors">
                                <Eye size={14} />
                              </button>
                              {isAdmin && (
                                <button onClick={() => setEditingEmployee(emp)} title="Edit employee"
                                  className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors">
                                  <Edit2 size={14} />
                                </button>
                              )}
                              {/* Exit / Reactivate — super admins cannot be exited */}
                              {isAdmin && !isSA && (
                                isInactive ? (
                                  <button onClick={() => setReactivatingEmp(emp)} title="Reactivate employee"
                                    className="p-1.5 transition-colors" style={{ color: '#059669' }}>
                                    <UserCheck size={14} />
                                  </button>
                                ) : (
                                  <button onClick={() => setDeactivatingEmp(emp)} title="Mark as exited"
                                    className="p-1.5 transition-colors" style={{ color: '#DC2626' }}>
                                    <LogOut size={14} />
                                  </button>
                                )
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={colCount} className="px-4 py-12 text-center text-sm" style={{ color: '#8B8B85' }}>
                        No employees found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Bulk edit bar */}
      {canManage && selectedIds.size > 0 && (
        <BulkEditBar
          selectedIds={selectedIds}
          onApply={(dept, desig) => setBulkConfirm({ dept, desig })}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      {/* Bulk edit confirmation */}
      {bulkConfirm && (
        <BulkEditConfirmModal
          count={selectedIds.size}
          newDept={bulkConfirm.dept}
          newDesig={bulkConfirm.desig}
          busy={bulkApplying}
          onConfirm={() => handleBulkApply(bulkConfirm.dept, bulkConfirm.desig)}
          onCancel={() => setBulkConfirm(null)}
        />
      )}

      {editingEmployee && user && (
        <EditEmployeeModal
          employee={editingEmployee}
          allEmployees={employees}
          onClose={() => setEditingEmployee(null)}
          adminUserId={user.uid}
        />
      )}
      {deactivatingEmp && (
        <DeactivateModal employee={deactivatingEmp}
          onClose={() => setDeactivatingEmp(null)}
          onDone={(warning) => {
            setDeactivatingEmp(null);
            if (warning) toast.warning(warning + ' — check the offboarding checklist.');
          }} />
      )}
      {reactivatingEmp && (
        <ReactivateModal employee={reactivatingEmp}
          onClose={() => setReactivatingEmp(null)}
          onDone={() => setReactivatingEmp(null)} />
      )}
      {showAddModal && (
        <AddEmployeeModal
          prefill={addPrefill}
          onClose={() => { setShowAddModal(false); setAddPrefill(undefined); }}
          onCreated={() => { setShowAddModal(false); setAddPrefill(undefined); }} />
      )}
    </>
  );
}
