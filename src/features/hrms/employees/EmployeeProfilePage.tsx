import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, CheckCircle2, Clock, Pencil, X, Check } from 'lucide-react';
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import type { UserProfile, UserDetails, EmployeeProfile } from '../../../types';

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

interface SensitiveData {
  bankName?: string; bankBranch?: string;
  bankAccountNo?: string; bankIfsc?: string; uan?: string;
  salaryBasic?: number; salaryHra?: number; salaryConveyance?: number;
  salaryMedical?: number; salaryOther?: number; grossSalary?: number;
}

function useEmployeeSensitive(userId: string | undefined) {
  const [sensitive,    setSensitive]    = useState<SensitiveData | null>(null);
  const [sensLoading,  setSensLoading]  = useState(true);

  useEffect(() => {
    if (!userId) { setSensLoading(false); return; }
    getDoc(doc(db, 'employee_sensitive', userId))
      .then((snap) => setSensitive(snap.exists() ? (snap.data() as SensitiveData) : {}))
      .catch(() => setSensitive(null))
      .finally(() => setSensLoading(false));
  }, [userId]);

  return { sensitive, sensLoading, setSensitive };
}

function useUserDetails(userId: string | undefined) {
  const [details,     setDetails]     = useState<UserDetails | null>(null);
  const [detLoading,  setDetLoading]  = useState(true);

  useEffect(() => {
    if (!userId) { setDetLoading(false); return; }
    getDoc(doc(db, 'user_details', userId))
      .then((snap) => setDetails(snap.exists() ? (snap.data() as UserDetails) : {}))
      .catch(() => setDetails(null))
      .finally(() => setDetLoading(false));
  }, [userId]);

  return { details, detLoading, setDetails };
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

function EditProfileModal({ profile, userId, userDetails, sensitiveData, onSave, onSaveDetails, onSaveSensitive, onClose }: {
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

      // User doc update is now minimal — just the updatedAt timestamp if anything changed
      await updateDoc(doc(db, 'users', userId), { updatedAt: serverTimestamp() });
      onSave({});

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
          {sHead('Contact')}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Phone</label>
              <input className={inp} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit number" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Official Phone</label>
              <input className={inp} value={officialPhone} onChange={(e) => setOfficialPhone(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Personal Email</label>
              <input type="email" className={inp} value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} />
            </div>
          </div>

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

// ─── Profile completion indicator ────────────────────────────────────────────

function ProfileCompletionBanner({
  profile, details, onEdit,
}: {
  profile: UserProfile;
  details: UserDetails | null;
  onEdit: () => void;
}) {
  const checks = [
    { label: 'Upload profile photo', done: !!profile.photoURL },
    { label: 'Add phone number',     done: !!(details?.phone) },
    { label: 'Add blood group',      done: !!(details?.bloodGroup) },
    { label: 'Add date of birth',    done: !!(details?.dateOfBirth) },
    { label: 'Add gender',           done: !!(details?.gender) },
  ];
  const done = checks.filter((c) => c.done).length;
  const pct  = Math.round((done / checks.length) * 100);
  const missing = checks.filter((c) => !c.done);

  if (pct === 100) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#475569' }}>
          Profile {pct}% complete
        </p>
        <button onClick={onEdit} className="text-xs font-medium transition-opacity hover:opacity-70" style={{ color: '#0B1538' }}>
          Complete now
        </button>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-3">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: '#C9A961' }} />
      </div>
      <div className="flex flex-wrap gap-2">
        {missing.map(({ label }) => (
          <button key={label} onClick={onEdit}
            className="text-[11px] px-2.5 py-1 rounded-full border border-dashed border-slate-300 text-mute hover:border-navy transition-colors">
            + {label}
          </button>
        ))}
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
  const isOwnProfile = currentUser?.userId === userId;

  const [editingProfile, setEditingProfile] = useState(false);

  const { profile, loading }            = useEmployee(userId);
  const [localProfile, setLocalProfile] = useState<UserProfile | null>(null);
  const displayProfile = localProfile ?? profile;

  const { epDoc, epLoading, setEpDoc }              = useEmployeeProfileDoc(displayProfile?.employeeId);
  const { sensitive, sensLoading, setSensitive }    = useEmployeeSensitive(userId);
  const { details,   detLoading,  setDetails }      = useUserDetails(userId);

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

      {/* Profile completion — own profile only */}
      {isOwnProfile && !detLoading && (
        <ProfileCompletionBanner
          profile={displayProfile}
          details={details}
          onEdit={() => setEditingProfile(true)}
        />
      )}

      {/* General info */}
      <Section title="Work Details">
        <FieldRow label="Employee Code"    value={displayProfile.employeeId} />
        <FieldRow label="Department"       value={displayProfile.department} />
        <FieldRow label="Designation"      value={displayProfile.designation} />
        <FieldRow label="Reporting Manager"value={displayProfile.reportingManagerName} />
        <FieldRow label="Joining Date"     value={displayProfile.joiningDate} />
        {isAdminOrHr && details?.lastWorkingDate && (
          <FieldRow label="Last Working Day" value={details.lastWorkingDate} />
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

      {/* Contact — official email visible to all; personal contact only for admin/HR */}
      <Section title="Contact">
        <FieldRow label="Official Email" value={displayProfile.email || null} />
        {isAdminOrHr && (
          <>
            <FieldRow label="Phone"         value={details?.phone ?? null} />
            <FieldRow label="Official Phone"value={details?.officialPhone ?? null} />
            <FieldRow label="Personal Email"value={details?.personalEmail ?? null} />
          </>
        )}
      </Section>

      {/* Personal Details — admin / HRMS manager only */}
      {isAdminOrHr && (
        detLoading ? <div className="h-36 bg-slate-100 rounded-2xl animate-pulse" /> : (
          <Section title="Personal Details">
            <FieldRow label="Date of Birth"   value={details?.dateOfBirth ?? null} />
            <FieldRow label="Gender"          value={details?.gender ?? null} />
            <FieldRow label="Blood Group"     value={details?.bloodGroup ?? null} />
            <FieldRow label="Father / Mother" value={details?.fatherMotherName ?? null} />
            <FieldRow label="Spouse"          value={details?.spouseName ?? null} />
          </Section>
        )
      )}

      {/* Address — admin / HRMS manager only */}
      {isAdminOrHr && !detLoading && (
        <Section title="Address">
          <FieldRow label="Present Address"   value={details?.presentAddress ?? null} />
          <FieldRow label="Permanent Address" value={details?.permanentAddress ?? null} />
        </Section>
      )}

      {/* Bank Details — admin only, read from employee_sensitive */}
      {currentUser?.role === 'admin' && (
        sensLoading ? (
          <div className="h-32 bg-slate-100 rounded-2xl animate-pulse" />
        ) : (
          <Section title="Bank Details">
            <FieldRow label="Bank"         value={sensitive?.bankName ?? null} />
            <FieldRow label="Branch"       value={sensitive?.bankBranch ?? null} />
            <FieldRow label="Account No."  value={sensitive?.bankAccountNo ?? null} />
            <FieldRow label="IFSC Code"    value={sensitive?.bankIfsc ?? null} />
            <FieldRow label="UAN"          value={sensitive?.uan ?? null} />
          </Section>
        )
      )}

      {/* Salary Structure — admin and HRMS manager only, from employee_sensitive */}
      {isAdminOrHr && (
        sensLoading ? (
          <div className="h-40 bg-slate-100 rounded-2xl animate-pulse" />
        ) : (
          <Section title="Salary Structure">
            <FieldRow label="Basic"              value={sensitive?.salaryBasic       != null ? `₹ ${sensitive.salaryBasic.toLocaleString('en-IN')}` : null} />
            <FieldRow label="HRA"               value={sensitive?.salaryHra          != null ? `₹ ${sensitive.salaryHra.toLocaleString('en-IN')}` : null} />
            <FieldRow label="Conveyance"         value={sensitive?.salaryConveyance  != null ? `₹ ${sensitive.salaryConveyance.toLocaleString('en-IN')}` : null} />
            <FieldRow label="Medical"            value={sensitive?.salaryMedical     != null ? `₹ ${sensitive.salaryMedical.toLocaleString('en-IN')}` : null} />
            <FieldRow label="Other Allowances"   value={sensitive?.salaryOther       != null ? `₹ ${sensitive.salaryOther.toLocaleString('en-IN')}` : null} />
            <FieldRow label="Gross (Monthly CTC)"value={sensitive?.grossSalary       != null ? `₹ ${sensitive.grossSalary.toLocaleString('en-IN')}` : null} />
          </Section>
        )
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
          userDetails={details}
          sensitiveData={sensitive}
          onSave={(updated) => setLocalProfile((prev) => ({ ...(prev ?? displayProfile), ...updated } as UserProfile))}
          onSaveDetails={(updated) => setDetails((prev) => ({ ...prev, ...updated }))}
          onSaveSensitive={(updated) => setSensitive((prev) => ({ ...prev, ...updated }))}
          onClose={() => setEditingProfile(false)}
        />
      )}
    </div>
  );
}
