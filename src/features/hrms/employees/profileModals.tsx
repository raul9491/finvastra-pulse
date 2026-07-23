/**
 * The two profile edit dialogs: the admin/HR 'Edit details' modal (work
 * details, address, salary + bank) and the employee's own 'Edit My Details'.
 * 
 * Extracted verbatim from EmployeeProfilePage.tsx (2026-07-23) - no behaviour
 * change. Both use the empty-omit pattern: a blank field never overwrites
 * existing data, which is what makes them safe for partial backfills.
 */
import { useState } from 'react';
import { X, Check, UserCircle } from 'lucide-react';
import { doc, getDoc, updateDoc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { UserProfile, UserDetails } from '../../../types';
import type { SensitiveData } from './useEmployeeProfile';

// ─── Edit Profile Modal ───────────────────────────────────────────────────────

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

export function EditProfileModal({ profile, userId, userDetails, sensitiveData, onSave, onSaveDetails, onSaveSensitive, onClose }: {
  profile: UserProfile;
  userId: string;
  userDetails: UserDetails | null;
  sensitiveData: SensitiveData | null;
  onSave: (updated: Partial<UserProfile>) => void;
  onSaveDetails: (updated: UserDetails) => void;
  onSaveSensitive: (updated: SensitiveData) => void;
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

  const [phone,           setPhone]            = useState(userDetails?.phone ?? '');
  const [officialPhone,   setOfficialPhone]    = useState(userDetails?.officialPhone ?? '');
  const [personalEmail,   setPersonalEmail]    = useState(userDetails?.personalEmail ?? '');
  const [gender,          setGender]           = useState(userDetails?.gender ?? '');
  const [bloodGroup,      setBloodGroup]        = useState(userDetails?.bloodGroup ?? '');
  const [dateOfBirth,     setDateOfBirth]       = useState(dob2input(userDetails?.dateOfBirth));
  const [fatherMotherName,setFatherMotherName]  = useState(userDetails?.fatherMotherName ?? '');
  const [spouseName,      setSpouseName]        = useState(userDetails?.spouseName ?? '');
  const [presentAddress,  setPresentAddress]    = useState(userDetails?.presentAddress ?? '');
  const [permanentAddress,setPermanentAddress]  = useState(userDetails?.permanentAddress ?? '');
  const [bankName,        setBankName]          = useState(sensitiveData?.bankName ?? '');
  const [bankBranch,      setBankBranch]        = useState(sensitiveData?.bankBranch ?? '');
  const [bankAccountNo,   setBankAccountNo]     = useState(sensitiveData?.bankAccountNo ?? '');
  const [bankIfsc,        setBankIfsc]          = useState(sensitiveData?.bankIfsc ?? '');
  const [uan,             setUan]               = useState(sensitiveData?.uan ?? '');
  const [salaryBasic,     setSalaryBasic]       = useState(num2str(sensitiveData?.salaryBasic));
  const [salaryHra,       setSalaryHra]         = useState(num2str(sensitiveData?.salaryHra));
  const [salaryConveyance,setSalaryConveyance]  = useState(num2str(sensitiveData?.salaryConveyance));
  const [salaryMedical,   setSalaryMedical]     = useState(num2str(sensitiveData?.salaryMedical));
  const [salaryOther,     setSalaryOther]       = useState(num2str(sensitiveData?.salaryOther));

  // Identity + work fields live on the /users doc (admin-editable). Editable here
  // so a bootstrapped account (whose /users doc lacks name/code/dept/designation —
  // e.g. an admin created via Google first-login) can be completed in place.
  const [displayName,  setDisplayName]  = useState(profile.displayName ?? '');
  const [employeeCode, setEmployeeCode] = useState(profile.employeeId ?? '');
  const [department,   setDepartment]   = useState(profile.department ?? '');
  const [designation,  setDesignation]  = useState(profile.designation ?? '');

  const computedGross =
    (Number(salaryBasic) || 0) + (Number(salaryHra) || 0) +
    (Number(salaryConveyance) || 0) + (Number(salaryMedical) || 0) + (Number(salaryOther) || 0);

  const inp = 'w-full text-sm px-3 py-2 glass-inp rounded-lg outline-none';
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

      // Identity + work details → /users (admin path). Empty-omit pattern: a
      // blank field never wipes existing data; a non-empty one backfills it.
      const userPatch: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (displayName.trim())  userPatch.displayName = displayName.trim();
      if (employeeCode.trim()) userPatch.employeeId  = employeeCode.trim();
      if (department.trim())   userPatch.department  = department.trim();
      if (designation.trim())  userPatch.designation = designation.trim();
      await updateDoc(doc(db, 'users', userId), userPatch);
      const { updatedAt: _omitTs, ...profileEcho } = userPatch;
      onSave(profileEcho as Partial<UserProfile>);

      // Personal details → /user_details (admin/HR-only)
      const detailsUpdates: UserDetails = {
        ...(phone           ? { phone }           : {}),
        ...(officialPhone   ? { officialPhone }   : {}),
        ...(personalEmail   ? { personalEmail }   : {}),
        ...(gender          ? { gender }          : { gender: undefined }),
        ...(bloodGroup      ? { bloodGroup }      : { bloodGroup: undefined }),
        ...(dob             ? { dateOfBirth: dob }: { dateOfBirth: undefined }),
        ...(fatherMotherName ? { fatherMotherName } : { fatherMotherName: undefined }),
        ...(spouseName      ? { spouseName }      : { spouseName: undefined }),
        ...(presentAddress  ? { presentAddress }  : { presentAddress: undefined }),
        ...(permanentAddress ? { permanentAddress } : { permanentAddress: undefined }),
      };
      await setDoc(doc(db, 'user_details', userId), detailsUpdates, { merge: true });
      onSaveDetails(detailsUpdates);

      // Bank + salary → /employee_sensitive (admin/HR-only)
      const sensitiveUpdates: SensitiveData = {
        ...(bankName      ? { bankName }      : {}),
        ...(bankBranch    ? { bankBranch }    : {}),
        ...(bankAccountNo ? { bankAccountNo } : {}),
        ...(bankIfsc      ? { bankIfsc }      : {}),
        ...(uan           ? { uan }           : {}),
        ...(num(salaryBasic)      != null ? { salaryBasic: num(salaryBasic)! }           : {}),
        ...(num(salaryHra)        != null ? { salaryHra: num(salaryHra)! }               : {}),
        ...(num(salaryConveyance) != null ? { salaryConveyance: num(salaryConveyance)! } : {}),
        ...(num(salaryMedical)    != null ? { salaryMedical: num(salaryMedical)! }       : {}),
        ...(num(salaryOther)      != null ? { salaryOther: num(salaryOther)! }           : {}),
        ...(computedGross > 0             ? { grossSalary: computedGross }               : {}),
      };
      await setDoc(doc(db, 'employee_sensitive', userId), sensitiveUpdates, { merge: true });
      onSaveSensitive(sensitiveUpdates);
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const sHead = (t: string) => (
    <p className="text-[10px] font-bold uppercase tracking-widest pt-4 pb-1 first:pt-0" style={{ borderTop: '1px solid var(--shell-border)', color: 'var(--shell-text-secondary)' }}>{t}</p>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 glass-modal-overlay">
      <div className="glass-modal-panel w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="glass-modal-header flex items-center justify-between px-6 py-4">
          <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Edit Personal &amp; Salary Details</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg nav-item-hover transition-colors" style={{ color: 'var(--shell-text-dim)' }}><X size={16} /></button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-3 flex-1">
          {sHead('Work Details')}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Full Name</label>
              <input className={inp} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Rahul Vijay Wargia" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Employee Code</label>
              <input className={inp} value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="e.g. FAPL-022" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Department</label>
              <input className={inp} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Technology" />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Designation</label>
              <input className={inp} value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Tech & Builder" />
            </div>
          </div>

          {sHead('Contact')}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Phone</label>
              <input className={inp} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit number" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Official Phone</label>
              <input className={inp} value={officialPhone} onChange={(e) => setOfficialPhone(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Personal Email</label>
              <input type="email" className={inp} value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} />
            </div>
          </div>

          {sHead('Personal Details')}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Date of Birth</label>
              <input type="date" className={inp} value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--shell-text-dim)' }}>Year shown here is ignored — only day/month is stored.</p>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Gender</label>
              <select className={sel} value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">— Select —</option>
                <option>Male</option><option>Female</option><option>Other</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Blood Group</label>
              <select className={sel} value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)}>
                <option value="">— Select —</option>
                {BLOOD_GROUPS.map((bg) => <option key={bg}>{bg}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Father / Mother Name</label>
              <input className={inp} value={fatherMotherName} onChange={(e) => setFatherMotherName(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Spouse Name</label>
              <input className={inp} value={spouseName} onChange={(e) => setSpouseName(e.target.value)} placeholder="If applicable" />
            </div>
          </div>

          {sHead('Address')}
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Present Address</label>
              <textarea className={`${inp} resize-none`} rows={2} value={presentAddress} onChange={(e) => setPresentAddress(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Permanent Address</label>
              <textarea className={`${inp} resize-none`} rows={2} value={permanentAddress} onChange={(e) => setPermanentAddress(e.target.value)} />
            </div>
          </div>

          {sHead('Bank Details')}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Bank Name</label>
              <input className={inp} value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Bank" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Branch</label>
              <input className={inp} value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Account No.</label>
              <input className={inp} value={bankAccountNo} onChange={(e) => setBankAccountNo(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>IFSC Code</label>
              <input className={inp} value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value)} placeholder="e.g. HDFC0001234" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>UAN</label>
              <input className={inp} value={uan} onChange={(e) => setUan(e.target.value)} placeholder="12-digit UAN" />
            </div>
          </div>

          {sHead('Salary Structure (Monthly ₹)')}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([['Basic', salaryBasic, setSalaryBasic], ['HRA', salaryHra, setSalaryHra],
               ['Conveyance', salaryConveyance, setSalaryConveyance], ['Medical', salaryMedical, setSalaryMedical],
               ['Other', salaryOther, setSalaryOther]] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
              <div key={label}>
                <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>{label}</label>
                <input type="number" className={inp} value={val} onChange={(e) => setter(e.target.value)} placeholder="0" />
              </div>
            ))}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>Gross (auto)</label>
              <div className="text-sm px-3 py-2 rounded-lg font-semibold" style={{ backgroundColor: 'var(--glass-panel-bg)', border: '1px solid var(--shell-border)', color: computedGross > 0 ? '#065F46' : 'var(--shell-text-dim)' }}>
                {computedGross > 0 ? `₹ ${computedGross.toLocaleString('en-IN')}` : '—'}
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--shell-border)' }}>
          <button onClick={onClose} className="px-5 py-2 text-sm rounded-xl" style={{ border: '1px solid var(--shell-border)', color: 'var(--text-primary)' }}>Cancel</button>
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

// ─── EditMyDetailsModal — employee self-service (7 fields) ───────────────────

export interface EditMyDetailsModalProps {
  userId:     string;
  empName:    string;
  details:    UserDetails | null;
  onSave:     (updated: Partial<UserDetails>) => void;
  onClose:    () => void;
}

export function EditMyDetailsModal({ userId, empName, details, onSave, onClose }: EditMyDetailsModalProps) {
  const [phone,       setPhone]       = useState(details?.phone ?? '');
  const [email,       setEmail]       = useState(details?.personalEmail ?? '');
  const [address,     setAddress]     = useState(details?.presentAddress ?? '');
  const [bloodGroup,  setBloodGroup]  = useState(details?.bloodGroup ?? '');
  const [ecName,      setEcName]      = useState(details?.emergencyContactName ?? '');
  const [ecPhone,     setEcPhone]     = useState(details?.emergencyContactPhone ?? '');
  const [ecRel,       setEcRel]       = useState(details?.emergencyContactRelationship ?? '');

  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  const inp = 'w-full text-sm px-3.5 py-2.5 glass-inp rounded-xl outline-none transition-colors';

  const handleSave = async () => {
    setSaving(true);
    setError('');
    // Write plain trimmed strings (never `undefined` — Firestore rejects it).
    const updated: Record<string, unknown> = {
      phone:                        phone.trim(),
      personalEmail:                email.trim(),
      presentAddress:               address.trim(),
      bloodGroup:                   bloodGroup.trim(),
      emergencyContactName:         ecName.trim(),
      emergencyContactPhone:        ecPhone.trim(),
      emergencyContactRelationship: ecRel.trim(),
      updatedAt:                    serverTimestamp(),
    };
    try {
      const ref = doc(db, 'user_details', userId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, updated);
      } else {
        await setDoc(ref, updated);
      }
      // Audit log — best-effort; never block the save if logging is denied.
      try {
        await addDoc(collection(db, 'profile_update_logs'), {
          employeeId:  userId,
          employeeName: empName,
          updatedAt:   serverTimestamp(),
          fields:      Object.keys(updated).filter((k) => k !== 'updatedAt'),
        });
      } catch { /* non-fatal */ }
      onSave(updated as Partial<UserDetails>);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 glass-modal-overlay">
      <div className="glass-modal-panel w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="glass-modal-header flex items-center justify-between p-5">
          <div className="flex items-center gap-3">
            <UserCircle size={18} style={{ color: 'var(--text-primary)' }} />
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Edit My Details</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg nav-item-hover transition-colors">
            <X size={16} style={{ color: 'var(--shell-text-dim)' }} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.3em] mb-3" style={{ color: '#C9A961' }}>
              Contact Information
            </p>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-(--text-muted)">Personal Mobile</label>
                <input className={inp} placeholder="10-digit mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-(--text-muted)">Personal Email</label>
                <input type="email" className={inp} placeholder="personal@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-(--text-muted)">Present Address</label>
                <textarea className={`${inp} resize-none`} rows={2} placeholder="Current residential address" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-(--text-muted)">Blood Group</label>
                <select className={inp} value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)}>
                  <option value="">— Not specified —</option>
                  {['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−'].map((bg) => (
                    <option key={bg} value={bg}>{bg}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.3em] mb-3" style={{ color: '#C9A961' }}>
              Emergency Contact
            </p>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-(--text-muted)">Full Name</label>
                <input className={inp} placeholder="Emergency contact name" value={ecName} onChange={(e) => setEcName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-(--text-muted)">Phone</label>
                  <input className={inp} placeholder="Mobile number" value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-(--text-muted)">Relationship</label>
                  <input className={inp} placeholder="e.g. Spouse, Parent" value={ecRel} onChange={(e) => setEcRel(e.target.value)} />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="p-5 space-y-3" style={{ borderTop: '1px solid var(--shell-border)' }}>
          {error && (
            <div className="p-3 rounded-xl text-sm"
              style={{ backgroundColor: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.4)', color: '#f87171' }}>
              {error}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium nav-item-hover transition-colors" style={{ border: '1px solid var(--shell-border)' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {saving ? 'Saving…' : <><Check size={14} /> Save Changes</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
