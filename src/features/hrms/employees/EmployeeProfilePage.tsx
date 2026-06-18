import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, CheckCircle2, Clock, Pencil, X, Check, Laptop, Smartphone, Wifi, CreditCard, Package, Download, Mouse, CreditCard as IdCardIcon, UserCircle, FileText, Camera } from 'lucide-react';
import { doc, getDoc, updateDoc, setDoc, addDoc, serverTimestamp, collection, query, where, onSnapshot } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { format } from 'date-fns';
import { db, storage } from '../../../lib/firebase';
import { compressImage } from '../../../lib/imageCompression';
import { useAuth } from '../../auth/AuthContext';
import { FieldHistory } from '../../crm/components/FieldHistory';
import { CrmPerformanceWidget } from './CrmPerformanceWidget';
import { useMyLetters } from '../hooks/useGeneratedLetters';
import type { UserProfile, UserDetails, EmployeeProfile, Asset, AssetType, GeneratedLetter } from '../../../types';

// ─── Employee Assets Section ──────────────────────────────────────────────────

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  laptop:        'Laptop',
  sim_card:      'SIM Card',
  mobile_phone:  'Mobile Phone',
  access_card:   'Access Card',
  mouse:         'Mouse',
  visiting_card: 'Visiting Card',
  id_card:       'ID Card',
  other:         'Other',
};

function AssetTypeIcon({ type }: { type: AssetType }) {
  switch (type) {
    case 'laptop':        return <Laptop      size={14} />;
    case 'mobile_phone':  return <Smartphone  size={14} />;
    case 'sim_card':      return <Wifi        size={14} />;
    case 'access_card':   return <CreditCard  size={14} />;
    case 'mouse':         return <Mouse       size={14} />;
    case 'visiting_card': return <IdCardIcon  size={14} />;
    case 'id_card':       return <IdCardIcon  size={14} />;
    default:              return <Package     size={14} />;
  }
}

function EmployeeAssetsSection({ employeeUid }: { employeeUid: string }) {
  const [assets,  setAssets]  = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'assets'),
      where('assignedTo', '==', employeeUid),
      where('currentStatus', '==', 'assigned'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Asset));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [employeeUid]);

  if (loading) return <div className="h-20 glass-panel animate-pulse" />;
  if (assets.length === 0) return null;

  return (
    <div className="glass-panel p-6">
      <h3 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--shell-text-dim)' }}>
        Assigned Assets
      </h3>
      <div className="space-y-2">
        {assets.map((asset) => (
          <div key={asset.id} className="flex items-center gap-3 py-2 last:border-0" style={{ borderBottom: '1px solid var(--shell-border)' }}>
            <span style={{ color: 'var(--text-primary)' }}>
              <AssetTypeIcon type={asset.assetType} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{asset.assetName}</p>
              <p className="text-xs" style={{ color: 'var(--shell-text-dim)' }}>
                {ASSET_TYPE_LABELS[asset.assetType]}
                {asset.serialNumber && ` · ${asset.serialNumber}`}
                {asset.imei && ` · IMEI: ${asset.imei}`}
              </p>
            </div>
            {asset.assignedDate && (
              <span className="text-xs shrink-0" style={{ color: 'var(--shell-text-dim)' }}>Since {asset.assignedDate}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

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
    <div className="flex items-start gap-4 py-3 last:border-0" style={{ borderBottom: '1px solid var(--shell-border)' }}>
      {/* Narrower label on phones + min-w-0/anywhere on the value — long emails
          were forcing the whole page into horizontal scroll */}
      <span className="text-xs font-semibold uppercase tracking-widest w-32 sm:w-44 shrink-0 pt-0.5"
        style={{ color: 'var(--shell-text-dim)' }}>{label}</span>
      <span className="text-sm flex-1 min-w-0" style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
        {value ?? <span style={{ color: 'var(--shell-text-dim)' }}>—</span>}
      </span>
    </div>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel p-6">
      <h3 className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--shell-text-dim)' }}>
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
      <div className="flex items-start gap-4 py-3" style={{ borderBottom: '1px solid var(--shell-border)' }}>
        <span className="text-xs font-semibold uppercase tracking-widest w-44 shrink-0 pt-1"
          style={{ color: 'var(--shell-text-dim)' }}>Aadhaar</span>
        <div className="flex-1 flex items-center gap-3">
          {epDoc?.aadhaarVerified ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                <CheckCircle2 size={11} />
                Verified
              </span>
              <span className="text-xs" style={{ color: 'var(--shell-text-dim)' }}>
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
                className="text-xs font-semibold px-3 py-1.5 rounded-lg nav-item-hover transition-colors disabled:opacity-50"
                style={{ border: '1px solid var(--shell-border)', color: 'var(--text-primary)' }}
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
          style={{ color: 'var(--shell-text-dim)' }}>Aadhaar Document</span>
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
                className="text-xs" style={{ color: 'var(--shell-text-dim)' }}>
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
                className="flex-1 text-sm px-3.5 py-2 glass-inp rounded-lg outline-none"
                style={{ color: 'var(--text-primary)' }}
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
      <p className="mt-3 text-xs" style={{ color: 'var(--shell-text-dim)' }}>
        Aadhaar numbers are not stored in this system in compliance with UIDAI regulations.
        Store the scanned document in the HR Google Drive folder and link it here.
      </p>
    </Section>
  );
}

// ─── My Letters Section ───────────────────────────────────────────────────────

const LETTER_TYPE_LABELS: Record<string, string> = {
  offer:               'Offer Letter',
  appointment:         'Appointment Letter',
  confirmation:        'Confirmation Letter',
  increment:           'Salary Increment',
  noc:                 'NOC',
  salary_certificate:  'Salary Certificate',
  experience:          'Experience Certificate',
  relieving:           'Relieving Letter',
};

function MyLettersSection({ employeeUid }: { employeeUid: string }) {
  const { letters, loading } = useMyLetters(employeeUid);

  if (loading) return <div className="h-24 glass-panel animate-pulse" />;
  if (letters.length === 0) return null;   // no letters yet — section hidden

  return (
    <div className="glass-panel p-6">
      <h3 className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--shell-text-dim)' }}>
        My Letters
      </h3>
      <div className="space-y-1">
        {letters.map((l) => (
          <LetterLine key={l.id} letter={l} />
        ))}
      </div>
    </div>
  );
}

function LetterLine({ letter: l }: { letter: GeneratedLetter }) {
  const d = l.generatedAt?.toDate?.();
  return (
    <div className="flex items-center gap-3 py-2 last:border-0" style={{ borderBottom: '1px solid var(--shell-border)' }}>
      <FileText size={14} style={{ color: 'var(--shell-text-dim)', flexShrink: 0 }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {LETTER_TYPE_LABELS[l.letterType] ?? l.letterType}
        </p>
        <p className="text-xs" style={{ color: 'var(--shell-text-dim)' }}>
          {l.refNumber}{d ? ` · ${format(d, 'd MMM yyyy')}` : ''}
        </p>
      </div>
      {l.storageUrl ? (
        <button
          onClick={() => window.open(l.storageUrl!, '_blank')}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold nav-item-hover transition-colors shrink-0"
          style={{ border: '1px solid var(--shell-border)', color: 'var(--text-primary)' }}
          title="Open / download PDF"
        >
          <Download size={12} />
          PDF
        </button>
      ) : (
        <span className="text-xs shrink-0" style={{ color: 'var(--shell-text-dim)' }}>—</span>
      )}
    </div>
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

// ─── Profile completion indicator ────────────────────────────────────────────

function ProfileCompletionBanner({
  onUploadPhoto,
  profile, details, onEdit,
}: {
  onUploadPhoto?: () => void;
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
    <div className="glass-panel p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-secondary)' }}>
          Profile {pct}% complete
        </p>
        <button onClick={onEdit} className="text-xs font-medium transition-opacity hover:opacity-70" style={{ color: 'var(--text-primary)' }}>
          Complete now
        </button>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ backgroundColor: 'var(--shell-border-mid)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: '#C9A961' }} />
      </div>
      <div className="flex flex-wrap gap-2">
        {missing.map(({ label }) => (
          <button key={label}
            // The photo chip opens the file picker directly — the edit modal has no photo field
            onClick={label === 'Upload profile photo' && onUploadPhoto ? onUploadPhoto : onEdit}
            className="text-[11px] px-2.5 py-1 rounded-full border border-dashed hover:border-navy transition-colors"
            style={{ borderColor: 'var(--shell-border)', color: 'var(--shell-text-secondary)' }}>
            + {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── EditMyDetailsModal — employee self-service (7 fields) ───────────────────

interface EditMyDetailsModalProps {
  userId:     string;
  empName:    string;
  details:    UserDetails | null;
  onSave:     (updated: Partial<UserDetails>) => void;
  onClose:    () => void;
}

function EditMyDetailsModal({ userId, empName, details, onSave, onClose }: EditMyDetailsModalProps) {
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

// ─── EmployeeProfilePage ──────────────────────────────────────────────────────

export function EmployeeProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate   = useNavigate();
  const { profile: currentUser } = useAuth();

  const isAdminOrHr = currentUser?.role === 'admin' || currentUser?.isHrmsManager === true;
  const isOwnProfile = currentUser?.userId === userId;

  const [editingProfile,   setEditingProfile]   = useState(false);
  const [editingMyDetails, setEditingMyDetails] = useState(false);

  const { profile, loading }            = useEmployee(userId);
  const [localProfile, setLocalProfile] = useState<UserProfile | null>(null);
  const displayProfile = localProfile ?? profile;

  const { epDoc, epLoading, setEpDoc }              = useEmployeeProfileDoc(displayProfile?.employeeId);
  const { sensitive, sensLoading, setSensitive }    = useEmployeeSensitive(userId);
  const { details,   detLoading,  setDetails }      = useUserDetails(userId);

  const handleEpUpdate = (updated: Partial<EmployeeProfile>) => {
    setEpDoc((prev) => prev ? { ...prev, ...updated } : null);
  };

  // ── Profile photo upload ────────────────────────────────────────────────────
  // Compressed in-browser to a ~256px JPEG (~15-30 KB) BEFORE upload, stored at
  // a FIXED path (profile-photos/{uid}/avatar.jpg) so re-uploads replace the old
  // file — Storage never grows, and Firestore only holds the URL string.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');

  const handlePhotoSelected = async (file: File | null) => {
    if (!file || !userId || !isOwnProfile) return;
    if (!file.type.startsWith('image/')) {
      setPhotoError('Please choose an image file.');
      return;
    }
    setUploadingPhoto(true);
    setPhotoError('');
    try {
      const small = await compressImage(file, { maxDim: 256, quality: 0.75 });
      if (small.size > 300 * 1024) throw new Error('Image could not be compressed enough. Try a different photo.');
      const dest = storageRef(storage, `profile-photos/${userId}/avatar.jpg`);
      await uploadBytes(dest, small, { contentType: small.type, cacheControl: 'public,max-age=86400' });
      const url = await getDownloadURL(dest);
      await updateDoc(doc(db, 'users', userId), { photoURL: url });
      setLocalProfile((prev) => ({ ...(prev ?? profile!), photoURL: url }));
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Upload failed. Please try again.');
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 animate-pulse space-y-4">
        {[1,2,3].map((i) => <div key={i} className="h-32 glass-panel" />)}
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 text-center text-sm" style={{ color: 'var(--shell-text-dim)' }}>
        Employee not found.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Back + header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/hrms/employees')}
          className="p-2 rounded-lg nav-item-hover transition-colors shrink-0"
          style={{ color: 'var(--shell-text-dim)' }}>
          <ArrowLeft size={18} />
        </button>
        {/* flex-wrap: on phones the action buttons drop to their own row instead
            of squeezing the name into one-word-per-line */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 flex-1 min-w-0">
          <div className="relative shrink-0">
            {displayProfile.photoURL ? (
              <img src={displayProfile.photoURL} alt={displayProfile.displayName}
                className="w-14 h-14 rounded-full object-cover" style={{ opacity: uploadingPhoto ? 0.4 : 1 }} />
            ) : (
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold"
                style={{ backgroundColor: '#0B1538', color: '#C9A961', opacity: uploadingPhoto ? 0.4 : 1 }}>
                {displayProfile.displayName?.[0]}
              </div>
            )}
            {isOwnProfile && (
              <>
                <button
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  title="Change profile photo"
                  aria-label="Change profile photo"
                  className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                  style={{ backgroundColor: '#C9A961', color: '#0B1538', border: '2px solid var(--ss-bg)' }}
                >
                  <Camera size={12} />
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handlePhotoSelected(e.target.files?.[0] ?? null)}
                />
              </>
            )}
          </div>
          <div className="flex-1 min-w-0" style={{ minWidth: 180 }}>
            <h2 className="text-xl sm:text-2xl" style={{ fontFamily: '"Fraunces", Georgia, serif', fontWeight: 300, color: 'var(--text-primary)' }}>
              {displayProfile.displayName}
            </h2>
            <p className="text-sm" style={{ color: 'var(--shell-text-dim)' }}>
              {displayProfile.employeeId ?? '—'} · {displayProfile.designation ?? '—'} · {displayProfile.department ?? '—'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isOwnProfile && (
              <button
                onClick={() => setEditingMyDetails(true)}
                className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg nav-item-hover transition-colors"
                style={{ border: '1px solid #C9A961', color: '#C9A961' }}
              >
                <UserCircle size={14} />
                Edit My Details
              </button>
            )}
            {isAdminOrHr && (
              <button
                onClick={() => setEditingProfile(true)}
                className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg nav-item-hover transition-colors"
                style={{ border: '1px solid var(--shell-border)', color: 'var(--text-primary)' }}
              >
                <Pencil size={14} />
                Edit details
              </button>
            )}
          </div>
        </div>
      </div>

      {photoError && (
        <p className="text-xs px-1" style={{ color: '#f87171' }}>{photoError}</p>
      )}

      {/* Profile completion — own profile only */}
      {isOwnProfile && !detLoading && (
        <ProfileCompletionBanner
          profile={displayProfile}
          details={details}
          onEdit={() => setEditingProfile(true)}
          onUploadPhoto={() => photoInputRef.current?.click()}
        />
      )}

      {/* General info */}
      <Section title="Work Details">
        <FieldRow label="Employee Code"    value={displayProfile.employeeId} />
        {/* Phase P — field-change history icons (admin/manager only) */}
        <FieldRow label="Department"       value={<>{displayProfile.department ?? '—'} {userId && <FieldHistory parentPath={['users', userId]} field="department" label="Department" />}</>} />
        <FieldRow label="Designation"      value={<>{displayProfile.designation ?? '—'} {userId && <FieldHistory parentPath={['users', userId]} field="designation" label="Designation" />}</>} />
        <FieldRow label="Reporting Manager"value={displayProfile.reportingManagerName} />
        <FieldRow label="Joining Date"     value={displayProfile.joiningDate} />
        {isAdminOrHr && details?.lastWorkingDate && (
          <FieldRow label="Last Working Day" value={details.lastWorkingDate} />
        )}
        <FieldRow label="Status"           value={
          <span className="inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
            style={displayProfile.employeeStatus === 'inactive'
              ? { backgroundColor: 'var(--shell-border-mid)', color: 'var(--shell-text-secondary)' }
              : { backgroundColor: '#D1FAE5', color: '#065F46' }}>
            {displayProfile.employeeStatus ?? 'active'}
          </span>
        } />
      </Section>

      {/* Contact — official email visible to all; personal contact to admin/HR or own profile */}
      <Section title="Contact">
        <FieldRow label="Official Email" value={displayProfile.email || null} />
        {(isAdminOrHr || isOwnProfile) && !detLoading && (
          <>
            <FieldRow label="Personal Mobile" value={details?.phone ?? null} />
            <FieldRow label="Personal Email"  value={details?.personalEmail ?? null} />
            {isAdminOrHr && (
              <FieldRow label="Official Phone" value={details?.officialPhone ?? null} />
            )}
          </>
        )}
      </Section>

      {/* Emergency Contact — visible to admin/HR and to the employee on their own profile */}
      {(isAdminOrHr || isOwnProfile) && !detLoading && (
        details?.emergencyContactName ? (
          <Section title="Emergency Contact">
            <FieldRow label="Name"         value={details.emergencyContactName ?? null} />
            <FieldRow label="Phone"        value={details.emergencyContactPhone ?? null} />
            <FieldRow label="Relationship" value={details.emergencyContactRelationship ?? null} />
          </Section>
        ) : isOwnProfile ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between gap-3">
            <p className="text-sm" style={{ color: '#92400E' }}>
              ⚠️ No emergency contact on file. Please add one for HR records.
            </p>
            <button onClick={() => setEditingMyDetails(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0 transition-colors hover:bg-amber-100"
              style={{ color: '#92400E', border: '1px solid #FCD34D' }}>
              Add Now
            </button>
          </div>
        ) : null
      )}

      {/* Personal Details — admin / HRMS manager only */}
      {isAdminOrHr && (
        detLoading ? <div className="h-36 glass-panel animate-pulse" /> : (
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
          <div className="h-32 glass-panel animate-pulse" />
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
          <div className="h-40 glass-panel animate-pulse" />
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
          <div className="h-40 glass-panel animate-pulse" />
        ) : (
          <IdentityVerification
            empCode={displayProfile.employeeId}
            epDoc={epDoc}
            onUpdate={handleEpUpdate}
            verifierEmpCode={currentUser?.employeeId ?? currentUser?.userId ?? ''}
          />
        )
      )}

      {/* CRM Performance — admin/HR manager only, shown when employee has CRM access */}
      {isAdminOrHr && userId && displayProfile.crmAccess === true && (
        <CrmPerformanceWidget employeeUid={userId} employeeName={displayProfile.displayName} />
      )}

      {/* Assigned Assets — admin/HR manager only */}
      {isAdminOrHr && userId && <EmployeeAssetsSection employeeUid={userId} />}

      {/* My Letters — employee sees own letters; admin/HR sees any employee's letters */}
      {(isOwnProfile || isAdminOrHr) && userId && (
        <MyLettersSection employeeUid={userId} />
      )}

      {/* Edit personal & salary modal (admin) */}
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

      {/* Edit my details modal (employee self-service) */}
      {editingMyDetails && userId && (
        <EditMyDetailsModal
          userId={userId}
          empName={displayProfile.displayName}
          details={details}
          onSave={(updated) => setDetails((prev) => ({ ...prev, ...updated }))}
          onClose={() => setEditingMyDetails(false)}
        />
      )}
    </div>
  );
}
