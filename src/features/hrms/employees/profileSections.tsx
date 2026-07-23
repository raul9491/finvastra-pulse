/**
 * The read-only sections of an employee profile: assigned assets, the
 * identity-verification block, generated letters, the profile-completion
 * banner, and the small FieldRow / Section layout primitives.
 * 
 * Extracted verbatim from EmployeeProfilePage.tsx (2026-07-23) - no behaviour
 * change.
 */
import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import {
  ExternalLink, CheckCircle2, Clock, Laptop, Smartphone, CreditCard, Package,
  Wifi, CreditCard as IdCardIcon, Mouse, FileText, Download,
} from 'lucide-react';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useMyLetters } from '../hooks/useGeneratedLetters';
import type { UserProfile, UserDetails, EmployeeProfile, Asset, AssetType, GeneratedLetter } from '../../../types';

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


export function AssetTypeIcon({ type }: { type: AssetType }) {
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

export function EmployeeAssetsSection({ employeeUid }: { employeeUid: string }) {
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

// ─── Field row ────────────────────────────────────────────────────────────────

export function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
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

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
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

export function IdentityVerification({
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

export function MyLettersSection({ employeeUid }: { employeeUid: string }) {
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

export function LetterLine({ letter: l }: { letter: GeneratedLetter }) {
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

// ─── Profile completion indicator ────────────────────────────────────────────

export function ProfileCompletionBanner({
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
