import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, CheckCircle2, Clock } from 'lucide-react';
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

// ─── EmployeeProfilePage ──────────────────────────────────────────────────────

export function EmployeeProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate   = useNavigate();
  const { profile: currentUser } = useAuth();

  const isAdminOrHr = currentUser?.role === 'admin' || currentUser?.isHrmsManager === true;

  const { profile, loading }            = useEmployee(userId);
  const { epDoc, epLoading, setEpDoc }  = useEmployeeProfileDoc(profile?.employeeId);

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
        <div className="flex items-center gap-4">
          {profile.photoURL ? (
            <img src={profile.photoURL} alt={profile.displayName}
              className="w-14 h-14 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              {profile.displayName?.[0]}
            </div>
          )}
          <div>
            <h2 className="text-2xl" style={{ fontFamily: '"Fraunces", Georgia, serif', fontWeight: 300, color: '#0A0A0A' }}>
              {profile.displayName}
            </h2>
            <p className="text-sm" style={{ color: '#8B8B85' }}>
              {profile.employeeId ?? '—'} · {profile.designation ?? '—'} · {profile.department ?? '—'}
            </p>
          </div>
        </div>
      </div>

      {/* General info */}
      <Section title="Work Details">
        <FieldRow label="Employee Code"    value={profile.employeeId} />
        <FieldRow label="Department"       value={profile.department} />
        <FieldRow label="Designation"      value={profile.designation} />
        <FieldRow label="Reporting Manager"value={profile.reportingManagerName} />
        <FieldRow label="Joining Date"     value={profile.joiningDate} />
        {profile.lastWorkingDate && (
          <FieldRow label="Last Working Day" value={profile.lastWorkingDate} />
        )}
        <FieldRow label="Status"           value={
          <span className="inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
            style={profile.employeeStatus === 'inactive'
              ? { backgroundColor: '#F1F5F9', color: '#475569' }
              : { backgroundColor: '#D1FAE5', color: '#065F46' }}>
            {profile.employeeStatus ?? 'active'}
          </span>
        } />
      </Section>

      <Section title="Contact">
        <FieldRow label="Official Email"   value={profile.email || null} />
        <FieldRow label="Phone"            value={profile.phone} />
        <FieldRow label="Personal Email"   value={profile.personalEmail} />
      </Section>

      {/* Identity Verification — admin / HRMS manager only */}
      {isAdminOrHr && profile.employeeId && (
        epLoading ? (
          <div className="h-40 bg-slate-100 rounded-2xl animate-pulse" />
        ) : (
          <IdentityVerification
            empCode={profile.employeeId}
            epDoc={epDoc}
            onUpdate={handleEpUpdate}
            verifierEmpCode={currentUser?.employeeId ?? currentUser?.userId ?? ''}
          />
        )
      )}
    </div>
  );
}
