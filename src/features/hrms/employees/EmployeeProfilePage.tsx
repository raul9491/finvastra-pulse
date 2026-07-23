import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Camera, UserCircle } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../../lib/firebase';
import { compressImage } from '../../../lib/imageCompression';
import { useAuth } from '../../auth/AuthContext';
import { FieldHistory } from '../../crm/components/FieldHistory';
import { CrmPerformanceWidget } from './CrmPerformanceWidget';
import {
  useEmployee, useEmployeeProfileDoc, useEmployeeSensitive, useUserDetails,
} from './useEmployeeProfile';
import {
  EmployeeAssetsSection, FieldRow, Section, IdentityVerification, MyLettersSection,
  ProfileCompletionBanner,
} from './profileSections';
import { EditProfileModal, EditMyDetailsModal } from './profileModals';
import type { UserProfile, EmployeeProfile } from '../../../types';

// ─── Employee Assets Section ──────────────────────────────────────────────────


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
