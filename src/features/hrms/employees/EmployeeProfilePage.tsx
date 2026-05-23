import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, CheckCircle2, Clock, Pencil, X, Check } from 'lucide-react';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import type { UserProfile, EmployeeProfile } from '../../../types';

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useEmployee(userId: string | undefined) {
  const [profile,  setProfile]  = useState<UserProfile | null>(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    getDoc(doc(db, 'users', userId))
      .then((snap) => setProfile(snap.exists() ? (snap.data() as UserProfile) : null))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [userId]);

  return { profile, loading };
}

function useEmployeeProfileDoc(empCode: string | undefined) {
  const [epDoc,    setEpDoc]    = useState<EmployeeProfile | null>(null);
  const [epLoading,setEpLoading]= useState(true);

  useEffect(() => {
    if (!empCode) { setEpLoading(false); return; }
    getDoc(doc(db, 'employee_profiles', empCode))
      .then((snap) => setEpDoc(snap.exists() ? (snap.data() as EmployeeProfile) : null))
      .catch(() => setEpDoc(null))
      .finally(() => setEpLoading(false));
  }, [empCode]);

  return { epDoc, epLoading, setEpDoc };
}

// ─── Field row ────────────────────────────────────────────────────────────────

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3 border-b border-slate-100 last:border-0">
      <span className="text-xs font-semibold uppercase tracking-widest w-44 shrink-0 pt-0.5"
        style={{ color: '#8B8B85' }}>{label}</span>
      <span className="text-sm flex-1" style={{ color: '#0A0A0A' }}>
        {value ?? <span style={{ color: '#8B8B85' }}>—</span>}
      </span>
    </div>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h3 className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#8B8B85' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

// ─── Identity Verification section ───────────────────────────────────────────

function IdentityVerification({
  empCode, epDoc, onUpdate,
  verifierEmpCode,
}: {
  empCode: string;
  epDoc: EmployeeProfile | null;
  onUpdate: (updated: Partial<EmployeeProfile>) => void;
  verifierEmpCode: string;
}) {
  const [driveLink, setDriveLink]   = useState(epDoc?.aadhaarDriveLink ?? '');
  const [savingLink, setSavingLink] = useState(false);
  const [markingVer, setMarkingVer] = useState(false);
  const [linkSaved,  setLinkSaved]  = useState(false);

  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2,'0')}-${String(today.getMonth()+1).padStart(2,'0')}-${today.getFullYear()}`;

  const handleMarkVerified = async () => {
    setMarkingVer(true);
    try {
      const update = {
        aadhaarVerified:   true,
        aadhaarVerifiedOn: todayStr,
        aadhaarVerifiedBy: verifierEmpCode,
        updatedAt:         serverTimestamp() as unknown as import('firebase/firestore').Timestamp,
      };
      await updateDoc(doc(db, 'employee_profiles', empCode), update);
      onUpdate(update);
    } finally {
      setMarkingVer(false);
    }
  };

  const handleSaveLink = async () => {
    if (!driveLink.trim()) return;
    setSavingLink(true);
    try {
      await updateDoc(doc(db, 'employee_profiles', empCode), {
        aadhaarDriveLink: driveLink.trim(),
        updatedAt: serverTimestamp(),
      });
      onUpdate({ aadhaarDriveLink: driveLink.trim() });
      setLinkSaved(true);
      setTimeout(() => setLinkSaved(false), 3000);
    } finally {
      setSavingLink(false);
    }
  };

  return (
    <Section title="Identity Verification">
      {/* Aadhaar verification status */}
      <div className="flex items-start gap-4 py-3 border-b border-slate-100">
        <span className="text-xs font-semibold uppercase tracking-widest w-44 shrink-0 pt-1"
          style={{ color: '#8B8B85' }}>Aadhaar</span>
        <div className="flex-1 flex items-center gap-3">
          {epDoc?.aadhaarVerified ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                <CheckCircle2 size={11} />
                Verified
              </span>
              <span className="text-xs" style={{ color: '#8B8B85' }}>
                {epDoc.aadhaarVerifiedOn} · by {epDoc.aadhaarVerifiedBy ?? '—'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: '#FFFBEB', color: '#92400E' }}>
                <Clock size={11} />
                Not Verified
              </span>
              <button
                onClick={handleMarkVerified}
                disabled={markingVer}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
                style={{ color: '#0A0A0A' }}
              >
                {markingVer ? 'Saving…' : 'Mark as Verified'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Aadhaar drive link */}
      <div className="flex items-start gap-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-widest w-44 shrink-0 pt-2.5"
          style={{ color: '#8B8B85' }}>Aadhaar Document</span>
        <div className="flex-1 space-y-2">
          {epDoc?.aadhaarDriveLink ? (
            <div className="flex items-center gap-3">
              <a href={epDoc.aadhaarDriveLink} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm font-medium hover:underline"
                style={{ color: '#1D4ED8' }}>
                <ExternalLink size={13} />
                Open in Drive
              </a>
              <button
                onClick={() => { onUpdate({ aadhaarDriveLink: null }); setDriveLink('');
                  updateDoc(doc(db, 'employee_profiles', empCode), { aadhaarDriveLink: null }); }}
                className="text-xs" style={{ color: '#8B8B85' }}>
                Change
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={driveLink}
                onChange={(e) => setDriveLink(e.target.value)}
                placeholder="Paste Google Drive link to scanned Aadhaar"
                className="flex-1 text-sm px-3.5 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-navy bg-slate-50"
                style={{ color: '#0A0A0A' }}
              />
              <button
                onClick={handleSaveLink}
                disabled={!driveLink.trim() || savingLink}
                className="text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
              >
                {savingLink ? 'Saving…' : linkSaved ? 'Saved ✓' : 'Save'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Compliance note */}
      <p className="mt-3 text-xs" style={{ color: '#8B8B85' }}>
        Aadhaar numbers are not stored in this system in compliance with UIDAI regulations.
        Store the scanned document in the HR Google Drive folder and link it here.
      </p>
    </Section>
  );
}

// ─── Edit Profile Modal ───────────────────────────────────────────────────────

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

function EditProfileModal({ profile, userId, onSave, onClose }: {
  profile: UserProfile;
  userId: string;
  onSave: (updated: Partial<UserProfile>) => void;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const num2str = (n?: number) => (n != null ? String(n) : '');
  const dob2input = (mmdd?: string) => {
    if (!mmdd || mmdd.length !== 5) return '';
    const [mm, dd] = mmdd.split('-');
    return `2000-${mm}-${dd}`;
  };

  const [gender,          setGender]          = useState(profile.gender ?? '');
  const [bloodGroup,      setBloodGroup]       = useState(profile.bloodGroup ?? '');
  const [dateOfBirth,     setDateOfBirth]      = useState(dob2input(profile.dateOfBirth));
  const [fatherMotherName,setFatherMotherName] = useState(profile.fatherMotherName ?? '');
  const [spouseName,      setSpouseName]       = useState(profile.spouseName ?? '');
  const [presentAddress,  setPresentAddress]   = useState(profile.presentAddress ?? '');
  const [permanentAddress,setPermanentAddress] = useState(profile.permanentAddress ?? '');
  const [bankName,        setBankName]         = useState(profile.bankName ?? '');
  const [bankBranch,      setBankBranch]       = useState(profile.bankBranch ?? '');
  const [bankAccountNo,   setBankAccountNo]    = useState(profile.bankAccountNo ?? '');
  const [bankIfsc,        setBankIfsc]         = useState(profile.bankIfsc ?? '');
  const [uan,             setUan]              = useState(profile.uan ?? '');
  const [salaryBasic,     setSalaryBasic]      = useState(num2str(profile.salaryBasic));
  const [salaryHra,       setSalaryHra]        = useState(num2str(profile.salaryHra));
  const [salaryConveyance,setSalaryConveyance] = useState(num2str(profile.salaryConveyance));
  const [salaryMedical,   setSalaryMedical]    = useState(num2str(profile.salaryMedical));
  const [salaryOther,     setSalaryOther]      = useState(num2str(profile.salaryOther));

  const computedGross =
    (Number(salaryBasic) || 0) + (Number(salaryHra) || 0) +
    (Number(salaryConveyance) || 0) + (Number(salaryMedical) || 0) + (Number(salaryOther) || 0);

  const inp = 'w-full text-sm px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-navy bg-white';
  const sel = inp;

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      let dob = '';
      if (dateOfBirth && dateOfBirth.length === 10) {
        const [, mm, dd] = dateOfBirth.split('-');
        dob = `${mm}-${dd}`;
      }
      const num = (s: string) => { const n = Number(s); return isNaN(n) || !s ? undefined : n; };
      const updates: Partial<UserProfile> & Record<string, unknown> = {
        ...(gender           ? { gender }           : { gender: null }),
        ...(bloodGroup       ? { bloodGroup }       : { bloodGroup: null }),
        ...(dob              ? { dateOfBirth: dob } : { dateOfBirth: null }),
        ...(fatherMotherName ? { fatherMotherName } : { fatherMotherName: null }),
        ...(spouseName       ? { spouseName }       : { spouseName: null }),
        ...(presentAddress   ? { presentAddress }   : { presentAddress: null }),
        ...(permanentAddress ? { permanentAddress } : { permanentAddress: null }),
        ...(bankName      ? { bankName }      : { bankName: null }),
        ...(bankBranch    ? { bankBranch }    : { bankBranch: null }),
        ...(bankAccountNo ? { bankAccountNo } : { bankAccountNo: null }),
        ...(bankIfsc      ? { bankIfsc }      : { bankIfsc: null }),
        ...(uan           ? { uan }           : { uan: null }),
        ...(num(salaryBasic)       != null ? { salaryBasic: num(salaryBasic) }             : { salaryBasic: null }),
        ...(num(salaryHra)         != null ? { salaryHra: num(salaryHra) }                 : { salaryHra: null }),
        ...(num(salaryConveyance)  != null ? { salaryConveyance: num(salaryConveyance) }   : { salaryConveyance: null }),
        ...(num(salaryMedical)     != null ? { salaryMedical: num(salaryMedical) }         : { salaryMedical: null }),
        ...(num(salaryOther)       != null ? { salaryOther: num(salaryOther) }             : { salaryOther: null }),
        grossSalary: computedGross > 0 ? computedGross : null,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, 'users', userId), updates);
      onSave(updates as Partial<UserProfile>);
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const sHead = (t: string) => (
    <p className="text-[10px] font-bold uppercase tracking-widest pt-4 pb-1 border-t border-slate-100 first:border-0 first:pt-0" style={{ color: '#475569' }}>{t}</p>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-sm" style={{ color: '#0A0A0A' }}>Edit Personal &amp; Salary Details</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors" style={{ color: '#8B8B85' }}><X size={16} /></button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-3 flex-1">
          {sHead('Personal Details')}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Date of Birth</label>
              <input type="date" className={inp} value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
              <p className="text-[10px] mt-0.5" style={{ color: '#8B8B85' }}>Year shown here is ignored — only day/month is stored.</p>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Gender</label>
              <select className={sel} value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">— Select —</option>
                <option>Male</option><option>Female</option><option>Other</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Blood Group</label>
              <select className={sel} value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)}>
                <option value="">— Select —</option>
                {BLOOD_GROUPS.map((bg) => <option key={bg}>{bg}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Father / Mother Name</label>
              <input className={inp} value={fatherMotherName} onChange={(e) => setFatherMotherName(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Spouse Name</label>
              <input className={inp} value={spouseName} onChange={(e) => setSpouseName(e.target.value)} placeholder="If applicable" />
            </div>
          </div>

          {sHead('Address')}
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Present Address</label>
              <textarea className={`${inp} resize-none`} rows={2} value={presentAddress} onChange={(e) => setPresentAddress(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Permanent Address</label>
              <textarea className={`${inp} resize-none`} rows={2} value={permanentAddress} onChange={(e) => setPermanentAddress(e.target.value)} />
            </div>
          </div>

          {sHead('Bank Details')}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Bank Name</label>
              <input className={inp} value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Bank" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Branch</label>
              <input className={inp} value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Account No.</label>
              <input className={inp} value={bankAccountNo} onChange={(e) => setBankAccountNo(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>IFSC Code</label>
              <input className={inp} value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value)} placeholder="e.g. HDFC0001234" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>UAN</label>
              <input className={inp} value={uan} onChange={(e) => setUan(e.target.value)} placeholder="12-digit UAN" />
            </div>
          </div>

          {sHead('Salary Structure (Monthly ₹)')}
          <div className="grid grid-cols-3 gap-3">
            {([['Basic', salaryBasic, setSalaryBasic], ['HRA', salaryHra, setSalaryHra],
               ['Conveyance', salaryConveyance, setSalaryConveyance], ['Medical', salaryMedical, setSalaryMedical],
               ['Other', salaryOther, setSalaryOther]] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
              <div key={label}>
                <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>{label}</label>
                <input type="number" className={inp} value={val} onChange={(e) => setter(e.target.value)} placeholder="0" />
              </div>
            ))}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Gross (auto)</label>
              <div className="text-sm px-3 py-2 rounded-lg font-semibold" style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', color: computedGross > 0 ? '#065F46' : '#8B8B85' }}>
                {computedGross > 0 ? `₹ ${computedGross.toLocaleString('en-IN')}` : '—'}
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-5 py-2 text-sm border border-slate-200 rounded-xl" style={{ color: '#2A2A2A' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-6 py-2 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {saving ? 'Saving…' : <><Check size={14} /> Save changes</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EmployeeProfilePage ──────────────────────────────────────────────────────

export function EmployeeProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate   = useNavigate();
  const { profile: currentUser } = useAuth();

  const isAdminOrHr = currentUser?.role === 'admin' || currentUser?.isHrmsManager === true;

  const [editingProfile, setEditingProfile] = useState(false);

  const { profile, loading }            = useEmployee(userId);
  const [localProfile, setLocalProfile] = useState<UserProfile | null>(null);
  const displayProfile = localProfile ?? profile;

  const { epDoc, epLoading, setEpDoc }  = useEmployeeProfileDoc(displayProfile?.employeeId);

  const handleEpUpdate = (updated: Partial<EmployeeProfile>) => {
    setEpDoc((prev) => prev ? { ...prev, ...updated } : null);
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 animate-pulse space-y-4">
        {[1,2,3].map((i) => <div key={i} className="h-32 bg-slate-100 rounded-2xl" />)}
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 text-center text-sm" style={{ color: '#8B8B85' }}>
        Employee not found.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Back + header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/hrms/employees')}
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors shrink-0"
          style={{ color: '#8B8B85' }}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-4 flex-1">
          {displayProfile.photoURL ? (
            <img src={displayProfile.photoURL} alt={displayProfile.displayName}
              className="w-14 h-14 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              {displayProfile.displayName?.[0]}
            </div>
          )}
          <div className="flex-1">
            <h2 className="text-2xl" style={{ fontFamily: '"Fraunces", Georgia, serif', fontWeight: 300, color: '#0A0A0A' }}>
              {displayProfile.displayName}
            </h2>
            <p className="text-sm" style={{ color: '#8B8B85' }}>
              {displayProfile.employeeId ?? '—'} · {displayProfile.designation ?? '—'} · {displayProfile.department ?? '—'}
            </p>
          </div>
          {isAdminOrHr && (
            <button
              onClick={() => setEditingProfile(true)}
              className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border transition-colors hover:bg-slate-50 shrink-0"
              style={{ borderColor: '#E2E8F0', color: '#2A2A2A' }}
            >
              <Pencil size={14} />
              Edit details
            </button>
          )}
        </div>
      </div>

      {/* General info */}
      <Section title="Work Details">
        <FieldRow label="Employee Code"    value={displayProfile.employeeId} />
        <FieldRow label="Department"       value={displayProfile.department} />
        <FieldRow label="Designation"      value={displayProfile.designation} />
        <FieldRow label="Reporting Manager"value={displayProfile.reportingManagerName} />
        <FieldRow label="Joining Date"     value={displayProfile.joiningDate} />
        {displayProfile.lastWorkingDate && (
          <FieldRow label="Last Working Day" value={displayProfile.lastWorkingDate} />
        )}
        <FieldRow label="Status"           value={
          <span className="inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
            style={displayProfile.employeeStatus === 'inactive'
              ? { backgroundColor: '#F1F5F9', color: '#475569' }
              : { backgroundColor: '#D1FAE5', color: '#065F46' }}>
            {displayProfile.employeeStatus ?? 'active'}
          </span>
        } />
      </Section>

      <Section title="Contact">
        <FieldRow label="Official Email"   value={displayProfile.email || null} />
        <FieldRow label="Phone"            value={displayProfile.phone} />
        <FieldRow label="Personal Email"   value={displayProfile.personalEmail} />
      </Section>

      {/* Personal Details — admin / HRMS manager only */}
      {isAdminOrHr && (
        <Section title="Personal Details">
          <FieldRow label="Date of Birth"      value={displayProfile.dateOfBirth ?? null} />
          <FieldRow label="Gender"             value={displayProfile.gender ?? null} />
          <FieldRow label="Blood Group"        value={displayProfile.bloodGroup ?? null} />
          <FieldRow label="Father / Mother"    value={displayProfile.fatherMotherName ?? null} />
          <FieldRow label="Spouse"             value={displayProfile.spouseName ?? null} />
        </Section>
      )}

      {/* Address — admin / HRMS manager only */}
      {isAdminOrHr && (
        <Section title="Address">
          <FieldRow label="Present Address"    value={displayProfile.presentAddress ?? null} />
          <FieldRow label="Permanent Address"  value={displayProfile.permanentAddress ?? null} />
        </Section>
      )}

      {/* Bank Details — admin only */}
      {currentUser?.role === 'admin' && (
        <Section title="Bank Details">
          <FieldRow label="Bank"           value={displayProfile.bankName ?? null} />
          <FieldRow label="Branch"         value={displayProfile.bankBranch ?? null} />
          <FieldRow label="Account No."    value={displayProfile.bankAccountNo ?? null} />
          <FieldRow label="IFSC Code"      value={displayProfile.bankIfsc ?? null} />
          <FieldRow label="UAN"            value={displayProfile.uan ?? null} />
        </Section>
      )}

      {/* Salary Structure — admin only */}
      {currentUser?.role === 'admin' && (
        <Section title="Salary Structure">
          <FieldRow label="Basic"              value={displayProfile.salaryBasic       != null ? `₹ ${displayProfile.salaryBasic.toLocaleString('en-IN')}` : null} />
          <FieldRow label="HRA"               value={displayProfile.salaryHra          != null ? `₹ ${displayProfile.salaryHra.toLocaleString('en-IN')}` : null} />
          <FieldRow label="Conveyance"         value={displayProfile.salaryConveyance  != null ? `₹ ${displayProfile.salaryConveyance.toLocaleString('en-IN')}` : null} />
          <FieldRow label="Medical"            value={displayProfile.salaryMedical     != null ? `₹ ${displayProfile.salaryMedical.toLocaleString('en-IN')}` : null} />
          <FieldRow label="Other Allowances"   value={displayProfile.salaryOther       != null ? `₹ ${displayProfile.salaryOther.toLocaleString('en-IN')}` : null} />
          <FieldRow label="Gross (Monthly CTC)"value={displayProfile.grossSalary       != null ? `₹ ${displayProfile.grossSalary.toLocaleString('en-IN')}` : null} />
        </Section>
      )}

      {/* Identity Verification — admin / HRMS manager only */}
      {isAdminOrHr && displayProfile.employeeId && (
        epLoading ? (
          <div className="h-40 bg-slate-100 rounded-2xl animate-pulse" />
        ) : (
          <IdentityVerification
            empCode={displayProfile.employeeId}
            epDoc={epDoc}
            onUpdate={handleEpUpdate}
            verifierEmpCode={currentUser?.employeeId ?? currentUser?.userId ?? ''}
          />
        )
      )}

      {/* Edit personal & salary modal */}
      {editingProfile && userId && displayProfile && (
        <EditProfileModal
          profile={displayProfile}
          userId={userId}
          onSave={(updated) => setLocalProfile((prev) => ({ ...(prev ?? displayProfile), ...updated } as UserProfile))}
          onClose={() => setEditingProfile(false)}
        />
      )}
    </div>
  );
}
