import { useState, useMemo, useEffect } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import type { EmployeeStatus } from '../../../types';

const EMP_PREFIXES = ['FAPL', 'FWPL', 'HK', 'CL'] as const;
type EmpPrefix = typeof EMP_PREFIXES[number];

interface AddEmployeeForm {
  // Basic
  displayName: string;
  employeeStatus: EmployeeStatus;
  joiningDate: string;
  lastWorkingDate: string;
  // Contact
  phone: string;
  personalEmail: string;
  officialEmail: string;
  officialPhone: string;
  // Role
  department: string;
  designation: string;
  location: string;
  reportingManagerName: string;
  // Personal
  dateOfBirth: string;
  gender: string;
  bloodGroup: string;
  fatherMotherName: string;
  spouseName: string;
  // Address
  presentAddress: string;
  permanentAddress: string;
  // Salary structure (monthly components)
  salaryBasic: string;
  salaryHra: string;
  salaryConveyance: string;
  salaryMedical: string;
  salaryOther: string;
  // Bank accounts (stored in /employee_sensitive — admin only)
  personalBankName: string;
  personalBankBranch: string;
  personalBankAcct: string;
  personalBankIfsc: string;
  officialBankName: string;
  officialBankBranch: string;
  officialBankAcct: string;
  officialBankIfsc: string;
}

const EMPTY: AddEmployeeForm = {
  displayName: '', employeeStatus: 'active',
  joiningDate: '', lastWorkingDate: '',
  phone: '', personalEmail: '', officialEmail: '', officialPhone: '',
  department: '', designation: '', location: '', reportingManagerName: '',
  dateOfBirth: '', gender: '', bloodGroup: '', fatherMotherName: '', spouseName: '',
  presentAddress: '', permanentAddress: '',
  salaryBasic: '', salaryHra: '', salaryConveyance: '', salaryMedical: '', salaryOther: '',
  personalBankName: '', personalBankBranch: '', personalBankAcct: '', personalBankIfsc: '',
  officialBankName: '', officialBankBranch: '', officialBankAcct: '', officialBankIfsc: '',
};

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

interface Result { uid: string; tempPassword: string | null }

export function AddEmployeeModal({ onClose, onCreated }: { onClose: () => void; onCreated?: () => void }) {
  const { user } = useAuth();
  const { employees } = useAllEmployees();
  const [form, setForm] = useState<AddEmployeeForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [sameAddress, setSameAddress] = useState(false);

  const [empPrefix, setEmpPrefix] = useState<EmpPrefix>('FAPL');
  const [empNumber, setEmpNumber] = useState('');

  const nextForPrefix = useMemo(() => {
    const nums = employees
      .map((e) => e.employeeId ?? '')
      .filter((id) => id.startsWith(empPrefix + '-'))
      .map((id) => parseInt(id.split('-')[1] ?? '0', 10))
      .filter((n) => !isNaN(n) && n > 0);
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    return String(max + 1).padStart(3, '0');
  }, [employees, empPrefix]);

  useEffect(() => { setEmpNumber(nextForPrefix); }, [employees, empPrefix, nextForPrefix]);

  const computedEmpId = (() => {
    const n = empNumber.trim();
    if (!n) return '';
    const padded = String(parseInt(n, 10)).padStart(3, '0');
    return `${empPrefix}-${padded}`;
  })();

  const set = (k: keyof AddEmployeeForm, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Auto-compute gross when components change
  const computedGross =
    (Number(form.salaryBasic) || 0) +
    (Number(form.salaryHra) || 0) +
    (Number(form.salaryConveyance) || 0) +
    (Number(form.salaryMedical) || 0) +
    (Number(form.salaryOther) || 0);

  const handleSameAddress = (checked: boolean) => {
    setSameAddress(checked);
    if (checked) setForm((f) => ({ ...f, permanentAddress: f.presentAddress }));
  };

  const handleSubmit = async () => {
    if (!form.displayName.trim()) { setError('Full name is required.'); return; }
    if (form.officialEmail.trim() && !form.officialEmail.trim().endsWith('@finvastra.com')) {
      setError('Official email must be a @finvastra.com address.');
      return;
    }
    setSaving(true); setError('');
    try {
      const token = await user?.getIdToken();
      const num = (s: string) => { const n = Number(s.replace(/,/g, '')); return n || undefined; };

      // Convert date of birth from YYYY-MM-DD input → MM-DD storage
      let dob = form.dateOfBirth;
      if (dob && dob.length === 10) {
        const [, mm, dd] = dob.split('-');
        dob = `${mm}-${dd}`;
      }

      const body = {
        ...(form.displayName.trim()         ? { displayName: form.displayName.trim() }               : {}),
        ...(computedEmpId                   ? { employeeId: computedEmpId }                          : {}),
        employeeStatus: form.employeeStatus,
        ...(form.joiningDate                ? { joiningDate: form.joiningDate }                      : {}),
        ...(form.lastWorkingDate            ? { lastWorkingDate: form.lastWorkingDate }              : {}),
        ...(form.officialEmail.trim()       ? { officialEmail: form.officialEmail.trim() }           : {}),
        ...(form.officialPhone.trim()       ? { officialPhone: form.officialPhone.trim() }           : {}),
        ...(form.phone.trim()               ? { phone: form.phone.trim() }                           : {}),
        ...(form.personalEmail.trim()       ? { personalEmail: form.personalEmail.trim() }           : {}),
        ...(form.department.trim()          ? { department: form.department.trim() }                 : {}),
        ...(form.designation.trim()         ? { designation: form.designation.trim() }               : {}),
        ...(form.location.trim()            ? { location: form.location.trim() }                     : {}),
        ...(form.reportingManagerName       ? { reportingManagerName: form.reportingManagerName }    : {}),
        ...(dob                             ? { dateOfBirth: dob }                                   : {}),
        ...(form.gender                     ? { gender: form.gender }                                : {}),
        ...(form.bloodGroup                 ? { bloodGroup: form.bloodGroup }                        : {}),
        ...(form.fatherMotherName.trim()    ? { fatherMotherName: form.fatherMotherName.trim() }     : {}),
        ...(form.spouseName.trim()          ? { spouseName: form.spouseName.trim() }                 : {}),
        ...(form.presentAddress.trim()      ? { presentAddress: form.presentAddress.trim() }         : {}),
        ...(form.permanentAddress.trim()    ? { permanentAddress: form.permanentAddress.trim() }     : {}),
        ...(num(form.salaryBasic)           ? { salaryBasic: num(form.salaryBasic) }                 : {}),
        ...(num(form.salaryHra)             ? { salaryHra: num(form.salaryHra) }                     : {}),
        ...(num(form.salaryConveyance)      ? { salaryConveyance: num(form.salaryConveyance) }       : {}),
        ...(num(form.salaryMedical)         ? { salaryMedical: num(form.salaryMedical) }             : {}),
        ...(num(form.salaryOther)           ? { salaryOther: num(form.salaryOther) }                 : {}),
        ...(computedGross > 0               ? { grossSalary: computedGross }                         : {}),
      };

      // Bank accounts sent separately so server stores in /employee_sensitive
      const bankData = {
        personalBank: {
          name: form.personalBankName.trim() || null,
          branch: form.personalBankBranch.trim() || null,
          accountNumber: form.personalBankAcct.trim() || null,
          ifsc: form.personalBankIfsc.trim() || null,
        },
        officialBank: {
          name: form.officialBankName.trim() || null,
          branch: form.officialBankBranch.trim() || null,
          accountNumber: form.officialBankAcct.trim() || null,
          ifsc: form.officialBankIfsc.trim() || null,
        },
      };
      const hasBankData = Object.values(bankData.personalBank).some(Boolean) ||
                          Object.values(bankData.officialBank).some(Boolean);

      const res = await fetch('/api/admin/employees/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...body, ...(hasBankData ? { bankData } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create employee');
      setResult(data as Result);
      onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const inp = 'w-full text-sm px-3.5 py-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-navy bg-white';
  const sel = `${inp} bg-white`;

  const fLabel = (text: string, required = false) => (
    <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#8B8B85' }}>
      {text}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
  const sectionHead = (title: string) => (
    <div className="pt-3 pb-1 border-t border-slate-100 first:border-0 first:pt-0">
      <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#475569' }}>{title}</p>
    </div>
  );

  // Success state
  if (result) {
    return (
      <Modal isOpen onClose={onClose} title="Employee Added" size="sm"
        footer={<button onClick={onClose} className="px-6 py-2.5 text-sm font-semibold rounded-xl" style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>Done</button>}>
        <div className="space-y-4">
          <div className="rounded-xl p-4 text-sm space-y-1" style={{ backgroundColor: '#D1FAE5', border: '1px solid #6EE7B7' }}>
            <p className="font-semibold" style={{ color: '#065F46' }}>Employee created successfully</p>
          </div>
          {result.tempPassword ? (
            <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: '#FEF3C7', border: '1px solid #FDE68A' }}>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#92400E' }}>Temporary password — share with employee</p>
              <p className="font-mono text-lg font-bold tracking-widest" style={{ color: '#0A0A0A' }}>{result.tempPassword}</p>
              <p className="text-xs" style={{ color: '#78350F' }}>Employee must change this on first login.</p>
            </div>
          ) : (
            <p className="text-sm" style={{ color: '#8B8B85' }}>No official email — profile-only record created (no login account).</p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={onClose} title="Add Employee" size="lg"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-slate-200 rounded-xl" style={{ color: '#2A2A2A' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {saving ? 'Creating…' : 'Create employee'}
          </button>
        </>
      }>
      <div className="space-y-4">

        {/* ── Basic ── */}
        {sectionHead('Basic Information')}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            {fLabel('Full Name', true)}
            <input className={inp} value={form.displayName} onChange={(e) => set('displayName', e.target.value)} placeholder="e.g. Rahul Vijay Wargia" />
          </div>
          <div>
            {fLabel('Emp Code')}
            <div className="flex items-center gap-1.5">
              <select
                className={`${sel} w-28 shrink-0`}
                value={empPrefix}
                onChange={(e) => setEmpPrefix(e.target.value as EmpPrefix)}
              >
                {EMP_PREFIXES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <span className="text-slate-400 font-mono text-sm shrink-0">—</span>
              <input
                type="number"
                min={1}
                className={`${inp} w-20 shrink-0`}
                value={empNumber}
                onChange={(e) => setEmpNumber(e.target.value)}
                placeholder={nextForPrefix}
              />
              <span className="text-xs shrink-0 font-mono font-semibold" style={{ color: '#0A0A0A' }}>
                {computedEmpId || `${empPrefix}-${nextForPrefix}`}
              </span>
            </div>
            <p className="mt-1 text-xs" style={{ color: '#8B8B85' }}>
              Next available for {empPrefix}: <span className="font-mono">{empPrefix}-{nextForPrefix}</span>
            </p>
          </div>
          <div>
            {fLabel('Status')}
            <select className={sel} value={form.employeeStatus} onChange={(e) => set('employeeStatus', e.target.value as EmployeeStatus)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            {fLabel('Date of Joining')}
            <input type="date" className={inp} value={form.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} />
          </div>
          <div>
            {fLabel('Last Working Date')}
            <input type="date" className={inp} value={form.lastWorkingDate} onChange={(e) => set('lastWorkingDate', e.target.value)} placeholder="Only for inactive" />
          </div>
        </div>

        {/* ── Personal ── */}
        {sectionHead('Personal Details')}
        <div className="grid grid-cols-2 gap-3">
          <div>
            {fLabel('Date of Birth')}
            <input type="date" className={inp} value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
          </div>
          <div>
            {fLabel('Gender')}
            <select className={sel} value={form.gender} onChange={(e) => set('gender', e.target.value)}>
              <option value="">— Select —</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            {fLabel('Blood Group')}
            <select className={sel} value={form.bloodGroup} onChange={(e) => set('bloodGroup', e.target.value)}>
              <option value="">— Select —</option>
              {BLOOD_GROUPS.map((bg) => <option key={bg} value={bg}>{bg}</option>)}
            </select>
          </div>
          <div>
            {fLabel("Father's / Mother's Name")}
            <input className={inp} value={form.fatherMotherName} onChange={(e) => set('fatherMotherName', e.target.value)} placeholder="Parent's full name" />
          </div>
          <div>
            {fLabel("Spouse's Name")}
            <input className={inp} value={form.spouseName} onChange={(e) => set('spouseName', e.target.value)} placeholder="If applicable" />
          </div>
        </div>

        {/* ── Contact ── */}
        {sectionHead('Contact Details')}
        <div className="grid grid-cols-2 gap-3">
          <div>
            {fLabel('Personal Mobile')}
            <input className={inp} value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="10-digit mobile" />
          </div>
          <div>
            {fLabel('Personal Email')}
            <input type="email" className={inp} value={form.personalEmail} onChange={(e) => set('personalEmail', e.target.value)} placeholder="name@gmail.com" />
          </div>
          <div>
            {fLabel('Official Email (login)')}
            <input type="email" className={inp} value={form.officialEmail} onChange={(e) => set('officialEmail', e.target.value)} placeholder="name@finvastra.com" />
          </div>
          <div>
            {fLabel('Official Phone')}
            <input className={inp} value={form.officialPhone} onChange={(e) => set('officialPhone', e.target.value)} placeholder="Office direct number" />
          </div>
        </div>

        {/* ── Role & Reporting ── */}
        {sectionHead('Role & Reporting')}
        <div className="grid grid-cols-2 gap-3">
          <div>
            {fLabel('Department')}
            <input className={inp} value={form.department} onChange={(e) => set('department', e.target.value)} placeholder="e.g. BD & Client Relations" />
          </div>
          <div>
            {fLabel('Designation')}
            <input className={inp} value={form.designation} onChange={(e) => set('designation', e.target.value)} placeholder="e.g. Sales Manager" />
          </div>
          <div>
            {fLabel('Location')}
            <input className={inp} value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Ameerpet, Hyderabad" />
          </div>
          <div>
            {fLabel('Reporting Manager')}
            <select className={sel} value={form.reportingManagerName} onChange={(e) => set('reportingManagerName', e.target.value)}>
              <option value="">— Select —</option>
              {employees.map((e) => (
                <option key={e.userId} value={e.displayName}>{e.displayName}{e.designation ? ` (${e.designation})` : ''}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Salary Structure ── */}
        {sectionHead('Salary Structure (Monthly ₹)')}
        <div className="grid grid-cols-3 gap-3">
          <div>
            {fLabel('Basic Salary')}
            <input className={inp} value={form.salaryBasic} onChange={(e) => set('salaryBasic', e.target.value)} placeholder="e.g. 75000" />
          </div>
          <div>
            {fLabel('HRA')}
            <input className={inp} value={form.salaryHra} onChange={(e) => set('salaryHra', e.target.value)} placeholder="e.g. 37500" />
          </div>
          <div>
            {fLabel('Conveyance Allowance')}
            <input className={inp} value={form.salaryConveyance} onChange={(e) => set('salaryConveyance', e.target.value)} placeholder="e.g. 1600" />
          </div>
          <div>
            {fLabel('Medical Allowance')}
            <input className={inp} value={form.salaryMedical} onChange={(e) => set('salaryMedical', e.target.value)} placeholder="e.g. 1250" />
          </div>
          <div>
            {fLabel('Other Allowances')}
            <input className={inp} value={form.salaryOther} onChange={(e) => set('salaryOther', e.target.value)} placeholder="e.g. 35900" />
          </div>
          <div>
            {fLabel('Gross (auto-computed)')}
            <div className="w-full text-sm px-3.5 py-2.5 rounded-lg font-semibold"
              style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', color: computedGross > 0 ? '#065F46' : '#8B8B85' }}>
              {computedGross > 0 ? `₹${computedGross.toLocaleString('en-IN')}` : '—'}
            </div>
          </div>
        </div>
        <p className="text-xs" style={{ color: '#8B8B85' }}>
          These components pre-fill payslip generation each month. The CA adjusts for LOP deductions as needed.
        </p>

        {/* ── Address ── */}
        {sectionHead('Address')}
        <div className="space-y-3">
          <div>
            {fLabel('Present Address')}
            <textarea className={`${inp} resize-none`} rows={2} value={form.presentAddress}
              onChange={(e) => { set('presentAddress', e.target.value); if (sameAddress) set('permanentAddress', e.target.value); }}
              placeholder="Current residential address" />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#2A2A2A' }}>
            <input type="checkbox" checked={sameAddress} onChange={(e) => handleSameAddress(e.target.checked)} className="w-4 h-4 rounded" />
            <span>Permanent address same as present</span>
          </label>
          {!sameAddress && (
            <div>
              {fLabel('Permanent Address')}
              <textarea className={`${inp} resize-none`} rows={2} value={form.permanentAddress}
                onChange={(e) => set('permanentAddress', e.target.value)}
                placeholder="Permanent / hometown address" />
            </div>
          )}
        </div>

        {/* ── Bank Accounts (admin-only storage) ── */}
        {sectionHead('Bank Accounts')}
        <div className="rounded-lg px-3.5 py-2.5 text-xs mb-2" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>
          Stored in a restricted collection — readable only by admin and the employee themselves.
        </div>
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#8B8B85' }}>Personal Account</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              {fLabel('Bank Name')}
              <input className={inp} value={form.personalBankName} onChange={(e) => set('personalBankName', e.target.value)} placeholder="e.g. HDFC Bank" />
            </div>
            <div>
              {fLabel('Branch')}
              <input className={inp} value={form.personalBankBranch} onChange={(e) => set('personalBankBranch', e.target.value)} placeholder="e.g. Somajiguda" />
            </div>
            <div>
              {fLabel('Account Number')}
              <input className={inp} value={form.personalBankAcct} onChange={(e) => set('personalBankAcct', e.target.value)} placeholder="Account number" />
            </div>
            <div>
              {fLabel('IFSC Code')}
              <input className={`${inp} uppercase`} value={form.personalBankIfsc} onChange={(e) => set('personalBankIfsc', e.target.value.toUpperCase())} placeholder="e.g. HDFC0000512" />
            </div>
          </div>

          <p className="text-xs font-semibold uppercase tracking-wider pt-1" style={{ color: '#8B8B85' }}>Official / Salary Account</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              {fLabel('Bank Name')}
              <input className={inp} value={form.officialBankName} onChange={(e) => set('officialBankName', e.target.value)} placeholder="e.g. Indian Overseas Bank" />
            </div>
            <div>
              {fLabel('Branch')}
              <input className={inp} value={form.officialBankBranch} onChange={(e) => set('officialBankBranch', e.target.value)} placeholder="e.g. Koti" />
            </div>
            <div>
              {fLabel('Account Number')}
              <input className={inp} value={form.officialBankAcct} onChange={(e) => set('officialBankAcct', e.target.value)} placeholder="Account number" />
            </div>
            <div>
              {fLabel('IFSC Code')}
              <input className={`${inp} uppercase`} value={form.officialBankIfsc} onChange={(e) => set('officialBankIfsc', e.target.value.toUpperCase())} placeholder="e.g. IOBA0002757" />
            </div>
          </div>
        </div>

        <div className="rounded-lg px-3.5 py-2.5 text-xs" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>
          <strong>Not collected here:</strong> Aadhaar (UIDAI prohibition) · PAN (encryption required — add later) · UAN / PF Account (statutory payroll, out of scope)
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}
