import { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  Briefcase, Plus, ChevronRight, Check, X, Download,
  ExternalLink, UserCheck, UserX, ArrowRight,
} from 'lucide-react';
import {
  collection, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import jsPDF from 'jspdf';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { DEPARTMENTS, DESIGNATIONS } from '../../../config/hrmsConfig';
import type { JobOpening, JobOpeningStatus, Candidate, CandidateStage, CandidateSource } from '../../../types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGES: { value: CandidateStage; label: string; color: string; bg: string }[] = [
  { value: 'applied',     label: 'Applied',     color: '#64748B', bg: '#F1F5F9' },
  { value: 'shortlisted', label: 'Shortlisted', color: '#1D4ED8', bg: '#DBEAFE' },
  { value: 'interview_1', label: 'Interview I',  color: '#7C3AED', bg: '#EDE9FE' },
  { value: 'interview_2', label: 'Interview II', color: '#9333EA', bg: '#F3E8FF' },
  { value: 'offer_made',  label: 'Offer Made',  color: '#C2410C', bg: '#FFF7ED' },
  { value: 'hired',       label: 'Hired',       color: '#065F46', bg: '#D1FAE5' },
  { value: 'rejected',    label: 'Rejected',    color: '#991B1B', bg: '#FEE2E2' },
];

const STAGE_MAP = Object.fromEntries(STAGES.map((s) => [s.value, s])) as Record<CandidateStage, typeof STAGES[0]>;

const NEXT_STAGE: Partial<Record<CandidateStage, CandidateStage>> = {
  applied:     'shortlisted',
  shortlisted: 'interview_1',
  interview_1: 'interview_2',
  interview_2: 'offer_made',
  offer_made:  'hired',
};

const SOURCE_LABELS: Record<CandidateSource, string> = {
  referral:   'Employee Referral',
  walk_in:    'Walk-in',
  linkedin:   'LinkedIn',
  naukri:     'Naukri',
  job_portal: 'Job Portal',
  other:      'Other',
};

const OPENING_STATUS_META: Record<JobOpeningStatus, { label: string; color: string; bg: string }> = {
  open:    { label: 'Open',    color: '#065F46', bg: '#D1FAE5' },
  on_hold: { label: 'On Hold', color: '#92400E', bg: '#FEF3C7' },
  closed:  { label: 'Closed',  color: '#374151', bg: '#F3F4F6' },
};

function StagePill({ stage }: { stage: CandidateStage }) {
  const s = STAGE_MAP[stage];
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ color: s.color, backgroundColor: s.bg }}>
      {s.label}
    </span>
  );
}

const inp  = 'w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-slate-400';
const sel  = `${inp} cursor-pointer`;
const lbl  = 'block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5';

// ─── Offer Letter PDF ─────────────────────────────────────────────────────────

function generateOfferLetter(
  candidate: Candidate,
  opening: JobOpening | undefined,
  offeredCTC: number,
  joiningDate: string,
) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const M = 20;
  const today = format(new Date(), 'dd MMMM yyyy');

  pdf.setFillColor(11, 21, 56);
  pdf.rect(0, 0, W, 28, 'F');
  pdf.setTextColor(201, 169, 97);
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.text('FINVASTRA', M, 13);
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(200, 200, 200);
  pdf.text('Finvastra Advisory Pvt. Ltd.', M, 20);

  pdf.setTextColor(11, 21, 56);
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.text('OFFER LETTER', W / 2, 42, { align: 'center' });

  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 100, 100);
  pdf.text(`Date: ${today}`, M, 52);

  let y = 64;
  pdf.setTextColor(30, 30, 30);
  pdf.text('To,', M, y); y += 6;
  pdf.setFont('helvetica', 'bold');
  pdf.text(candidate.name, M, y); y += 6;
  pdf.setFont('helvetica', 'normal');
  if (candidate.phone) { pdf.text(`Phone: ${candidate.phone}`, M, y); y += 6; }
  if (candidate.email) { pdf.text(`Email: ${candidate.email}`, M, y); y += 6; }
  y += 4;

  pdf.setFontSize(10);
  pdf.text(`Dear ${candidate.name.split(' ')[0]},`, M, y); y += 10;

  const dept = opening?.department ?? candidate.openingTitle;
  const lines = [
    `We are pleased to extend this offer of employment for the position of`,
    `${candidate.openingTitle} in the ${dept} department at Finvastra Advisory Pvt. Ltd.`,
    '',
    `Your expected date of joining is ${joiningDate ? format(new Date(joiningDate), 'dd MMMM yyyy') : 'to be confirmed'}.`,
    '',
    'Compensation:',
  ];
  for (const line of lines) { pdf.text(line, M, y); y += 7; }

  // CTC box
  pdf.setFillColor(245, 248, 255);
  pdf.roundedRect(M, y, W - 2 * M, 14, 2, 2, 'F');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(80, 80, 80);
  pdf.text('Gross Monthly CTC', M + 4, y + 5);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(11, 21, 56);
  pdf.setFontSize(10);
  pdf.text(`₹ ${offeredCTC.toLocaleString('en-IN')} / month`, W - M - 4, y + 5, { align: 'right' });
  y += 18;

  const closing = [
    '',
    'This offer is subject to satisfactory reference checks and background verification.',
    'Please sign and return a copy of this letter as confirmation of your acceptance by',
    joiningDate ? `${format(new Date(joiningDate), 'dd MMMM yyyy')}.` : 'the joining date.',
    '',
    'We look forward to welcoming you to the Finvastra team!',
  ];
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(30, 30, 30);
  for (const line of closing) { pdf.text(line, M, y); y += 7; }

  y += 12;
  pdf.line(M, y, M + 65, y);
  pdf.line(W / 2, y, W / 2 + 65, y);
  y += 5;
  pdf.setFontSize(9);
  pdf.setTextColor(80, 80, 80);
  pdf.text('Authorized Signatory', M, y);
  pdf.text('Candidate Acceptance', W / 2, y);
  y += 4;
  pdf.text('Finvastra Advisory Pvt. Ltd.', M, y);

  const footerY = pdf.internal.pageSize.getHeight() - 10;
  pdf.setFontSize(7);
  pdf.setTextColor(150, 150, 150);
  pdf.text('Finvastra Advisory Pvt. Ltd. | pulse.finvastra.com | Confidential', W / 2, footerY, { align: 'center' });

  const safeName = candidate.name.replace(/\s+/g, '_');
  pdf.save(`OfferLetter_${safeName}_${joiningDate ?? 'TBD'}.pdf`);
}

// ─── Add Opening Modal ────────────────────────────────────────────────────────

function AddOpeningModal({ uid, onClose }: { uid: string; onClose: () => void }) {
  const [title,           setTitle]           = useState('');
  const [department,      setDepartment]      = useState('');
  const [description,     setDescription]     = useState('');
  const [targetHireDate,  setTargetHireDate]  = useState('');
  const [hiresRequired,   setHiresRequired]   = useState('1');
  const [saving,          setSaving]          = useState(false);
  const [error,           setError]           = useState('');

  const handleSave = async () => {
    if (!title.trim() || !department.trim()) { setError('Title and department are required.'); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, 'job_openings'), {
        title: title.trim(),
        department: department.trim(),
        description: description.trim() || null,
        location: null,
        openedDate: format(new Date(), 'yyyy-MM-dd'),
        targetHireDate: targetHireDate || null,
        status: 'open',
        hiresRequired: parseInt(hiresRequired) || 1,
        hiresCompleted: 0,
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      onClose();
    } catch { setError('Failed to create opening. Please try again.'); }
    finally   { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
        <h3 className="text-base font-semibold text-ink">New Job Opening</h3>
        {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={lbl}>Position / Title *</label>
            <select className={sel} value={title} onChange={e => setTitle(e.target.value)}>
              <option value="">Select designation…</option>
              {DESIGNATIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Department *</label>
            <select className={sel} value={department} onChange={e => setDepartment(e.target.value)}>
              <option value="">Select department…</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Target Hire Date</label>
            <input type="date" className={inp} value={targetHireDate} onChange={e => setTargetHireDate(e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Hires Required</label>
            <input type="number" className={inp} value={hiresRequired} onChange={e => setHiresRequired(e.target.value)} min="1" max="20" />
          </div>
          <div className="col-span-2">
            <label className={lbl}>Description / Notes</label>
            <textarea className={`${inp} resize-none`} rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Key responsibilities, requirements…" />
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 border border-slate-200 rounded-xl py-2 text-sm font-medium text-muted hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 bg-navy text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-navy-soft disabled:opacity-50 flex items-center justify-center gap-1.5">
            <Check size={14} />{saving ? 'Saving…' : 'Create Opening'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Candidate Modal ──────────────────────────────────────────────────────

function AddCandidateModal({
  uid, openings, defaultOpeningId, onClose,
}: {
  uid: string; openings: JobOpening[]; defaultOpeningId?: string; onClose: () => void;
}) {
  const [name,                setName]                = useState('');
  const [phone,               setPhone]               = useState('');
  const [email,               setEmail]               = useState('');
  const [openingId,           setOpeningId]           = useState(defaultOpeningId ?? (openings[0]?.id ?? ''));
  const [currentCompany,      setCurrentCompany]      = useState('');
  const [currentDesignation,  setCurrentDesignation]  = useState('');
  const [source,              setSource]              = useState<CandidateSource>('walk_in');
  const [resumeLink,          setResumeLink]          = useState('');
  const [notes,               setNotes]               = useState('');
  const [saving,              setSaving]              = useState(false);
  const [error,               setError]               = useState('');

  const selectedOpening = openings.find(o => o.id === openingId);

  const handleSave = async () => {
    if (!name.trim() || !phone.trim() || !openingId) { setError('Name, phone, and opening are required.'); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, 'candidates'), {
        openingId,
        openingTitle: selectedOpening?.title ?? '',
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        currentCompany: currentCompany.trim() || null,
        currentDesignation: currentDesignation.trim() || null,
        source,
        resumeLink: resumeLink.trim() || null,
        stage: 'applied',
        rejectionReason: null,
        notes: notes.trim() || null,
        expectedJoiningDate: null,
        offeredCTC: null,
        addedBy: uid,
        addedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        stageHistory: [],
      });
      onClose();
    } catch { setError('Failed to add candidate. Please try again.'); }
    finally   { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-4 p-6 space-y-4">
        <h3 className="text-base font-semibold text-ink">Add Candidate</h3>
        {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={lbl}>Opening *</label>
            <select className={sel} value={openingId} onChange={e => setOpeningId(e.target.value)}>
              <option value="">Select opening…</option>
              {openings.filter(o => o.status === 'open').map(o => (
                <option key={o.id} value={o.id}>{o.title} — {o.department}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={lbl}>Full Name *</label>
            <input className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Candidate's full name" />
          </div>
          <div>
            <label className={lbl}>Phone *</label>
            <input className={inp} value={phone} onChange={e => setPhone(e.target.value)} placeholder="10-digit mobile" />
          </div>
          <div>
            <label className={lbl}>Email</label>
            <input type="email" className={inp} value={email} onChange={e => setEmail(e.target.value)} placeholder="optional" />
          </div>
          <div>
            <label className={lbl}>Current Company</label>
            <input className={inp} value={currentCompany} onChange={e => setCurrentCompany(e.target.value)} placeholder="optional" />
          </div>
          <div>
            <label className={lbl}>Current Designation</label>
            <input className={inp} value={currentDesignation} onChange={e => setCurrentDesignation(e.target.value)} placeholder="optional" />
          </div>
          <div>
            <label className={lbl}>Source</label>
            <select className={sel} value={source} onChange={e => setSource(e.target.value as CandidateSource)}>
              {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Resume Link (Drive)</label>
            <input type="url" className={inp} value={resumeLink} onChange={e => setResumeLink(e.target.value)} placeholder="https://…" />
          </div>
          <div className="col-span-2">
            <label className={lbl}>Notes</label>
            <textarea className={`${inp} resize-none`} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Initial impressions, referrer name, etc." />
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 border border-slate-200 rounded-xl py-2 text-sm font-medium text-muted hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 bg-navy text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-navy-soft disabled:opacity-50 flex items-center justify-center gap-1.5">
            <Check size={14} />{saving ? 'Saving…' : 'Add Candidate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stage Advance Modal ──────────────────────────────────────────────────────

function AdvanceStageModal({
  candidate, uid, onClose,
}: {
  candidate: Candidate; uid: string; onClose: () => void;
}) {
  const nextStage = NEXT_STAGE[candidate.stage];
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  if (!nextStage) return null;

  const handleAdvance = async () => {
    setSaving(true);
    try {
      const entry = { from: candidate.stage, to: nextStage, at: serverTimestamp() as any, by: uid, ...(notes.trim() ? { notes: notes.trim() } : {}) };
      await updateDoc(doc(db, 'candidates', candidate.id), {
        stage: nextStage,
        stageHistory: [...candidate.stageHistory, entry],
        updatedAt: serverTimestamp(),
      });
      onClose();
    } finally { setSaving(false); }
  };

  const from = STAGE_MAP[candidate.stage];
  const to   = STAGE_MAP[nextStage];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-semibold text-ink">Advance Stage</h3>
        <p className="text-sm text-muted">{candidate.name}</p>
        <div className="flex items-center gap-3">
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ color: from.color, backgroundColor: from.bg }}>{from.label}</span>
          <ArrowRight size={14} className="text-muted" />
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ color: to.color, backgroundColor: to.bg }}>{to.label}</span>
        </div>
        <div>
          <label className={lbl}>Notes (optional)</label>
          <textarea className={`${inp} resize-none`} rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Interview feedback, observations…" />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 border border-slate-200 rounded-xl py-2 text-sm font-medium text-muted hover:bg-slate-50">Cancel</button>
          <button onClick={handleAdvance} disabled={saving} className="flex-1 bg-navy text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-navy-soft disabled:opacity-50 flex items-center justify-center gap-1.5">
            <UserCheck size={14} />{saving ? 'Saving…' : 'Advance'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reject Modal ─────────────────────────────────────────────────────────────

function RejectModal({ candidate, uid, onClose }: { candidate: Candidate; uid: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleReject = async () => {
    setSaving(true);
    try {
      const entry = { from: candidate.stage, to: 'rejected' as CandidateStage, at: serverTimestamp() as any, by: uid, ...(reason.trim() ? { notes: reason.trim() } : {}) };
      await updateDoc(doc(db, 'candidates', candidate.id), {
        stage: 'rejected',
        rejectionReason: reason.trim() || null,
        stageHistory: [...candidate.stageHistory, entry],
        updatedAt: serverTimestamp(),
      });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-semibold text-ink">Reject Candidate</h3>
        <p className="text-sm text-muted">{candidate.name}</p>
        <div>
          <label className={lbl}>Reason (optional)</label>
          <textarea className={`${inp} resize-none`} rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Feedback or reason for rejection…" />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 border border-slate-200 rounded-xl py-2 text-sm font-medium text-muted hover:bg-slate-50">Cancel</button>
          <button onClick={handleReject} disabled={saving} className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
            <UserX size={14} />{saving ? 'Saving…' : 'Mark Rejected'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Offer Letter Modal ───────────────────────────────────────────────────────

function OfferLetterModal({
  candidate, openings, onClose,
}: {
  candidate: Candidate; openings: JobOpening[]; onClose: () => void;
}) {
  const opening = openings.find(o => o.id === candidate.openingId);
  const [offeredCTC,      setOfferedCTC]      = useState(candidate.offeredCTC ? String(candidate.offeredCTC) : '');
  const [joiningDate,     setJoiningDate]     = useState(candidate.expectedJoiningDate ?? '');
  const [saving,          setSaving]          = useState(false);

  const handleDownload = async () => {
    const ctc = parseFloat(offeredCTC);
    if (!ctc || ctc <= 0) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'candidates', candidate.id), {
        offeredCTC: ctc,
        expectedJoiningDate: joiningDate || null,
        updatedAt: serverTimestamp(),
      });
      generateOfferLetter(candidate, opening, ctc, joiningDate);
    } finally { setSaving(false); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-semibold text-ink">Generate Offer Letter</h3>
        <p className="text-sm text-muted">{candidate.name} — {candidate.openingTitle}</p>
        <div>
          <label className={lbl}>Offered Gross CTC (₹/month) *</label>
          <input type="number" className={inp} value={offeredCTC} onChange={e => setOfferedCTC(e.target.value)} placeholder="e.g. 35000" />
        </div>
        <div>
          <label className={lbl}>Expected Joining Date</label>
          <input type="date" className={inp} value={joiningDate} onChange={e => setJoiningDate(e.target.value)} />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 border border-slate-200 rounded-xl py-2 text-sm font-medium text-muted hover:bg-slate-50">Cancel</button>
          <button onClick={handleDownload} disabled={!offeredCTC || saving} className="flex-1 bg-navy text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-navy-soft disabled:opacity-50 flex items-center justify-center gap-1.5">
            <Download size={14} />{saving ? 'Generating…' : 'Download Letter'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function RecruitmentPage() {
  const { profile, user } = useAuth();

  const [openings,    setOpenings]    = useState<JobOpening[]>([]);
  const [candidates,  setCandidates]  = useState<Candidate[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState<'openings' | 'candidates'>('openings');
  const [filterOpeningId, setFilterOpeningId] = useState<string>('');
  const [stageFilter, setStageFilter] = useState<CandidateStage | 'all'>('all');
  const [search,      setSearch]      = useState('');

  // Modals
  const [addingOpening,   setAddingOpening]   = useState(false);
  const [addingCandidate, setAddingCandidate] = useState(false);
  const [advancing,       setAdvancing]       = useState<Candidate | null>(null);
  const [rejecting,       setRejecting]       = useState<Candidate | null>(null);
  const [offerCandidate,  setOfferCandidate]  = useState<Candidate | null>(null);

  const isAdmin     = profile?.role === 'admin';
  const isHrMgr     = !!profile?.isHrmsManager;
  const canAccess   = isAdmin || isHrMgr;

  useEffect(() => {
    if (!canAccess) return;
    const unsub1 = onSnapshot(
      query(collection(db, 'job_openings'), orderBy('createdAt', 'desc')),
      snap => { setOpenings(snap.docs.map(d => ({ id: d.id, ...d.data() }) as JobOpening)); setLoading(false); },
      () => setLoading(false),
    );
    const unsub2 = onSnapshot(
      query(collection(db, 'candidates'), orderBy('addedAt', 'desc')),
      snap => setCandidates(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Candidate)),
      () => {},
    );
    return () => { unsub1(); unsub2(); };
  }, [canAccess]);

  if (profile && !canAccess) return <Navigate to="/hrms/dashboard" replace />;

  // Summary metrics
  const openPositions   = openings.filter(o => o.status === 'open').length;
  const activeCandidates = candidates.filter(c => c.stage !== 'hired' && c.stage !== 'rejected').length;
  const interviewsPending = candidates.filter(c => c.stage === 'interview_1' || c.stage === 'interview_2').length;
  const thisMonth = format(new Date(), 'yyyy-MM');
  const hiredThisMonth = candidates.filter(c => {
    if (c.stage !== 'hired') return false;
    const d = (c.updatedAt as any)?.toDate?.();
    return d ? format(d, 'yyyy-MM') === thisMonth : false;
  }).length;

  // Filtered candidates
  const filteredCandidates = useMemo(() => candidates.filter(c => {
    if (filterOpeningId && c.openingId !== filterOpeningId) return false;
    if (stageFilter !== 'all' && c.stage !== stageFilter) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [candidates, filterOpeningId, stageFilter, search]);

  const candidatesByOpening = (openingId: string) => candidates.filter(c => c.openingId === openingId).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl" style={{ background: '#EEF2FF' }}>
          <Briefcase size={20} style={{ color: '#3730A3' }} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-ink">Recruitment</h1>
          <p className="text-sm text-muted">{openings.length} opening{openings.length !== 1 ? 's' : ''} · {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Open Positions',    openPositions,    '#EEF2FF', '#3730A3'],
          ['Active Candidates', activeCandidates, '#F0FDF4', '#166534'],
          ['Interviews Pending',interviewsPending,'#F5F3FF', '#7C3AED'],
          ['Hired This Month',  hiredThisMonth,   '#D1FAE5', '#065F46'],
        ].map(([label, n, bg, color]) => (
          <div key={label as string} className="rounded-2xl p-4 border" style={{ background: bg as string, borderColor: 'transparent' }}>
            <p className="text-2xl font-bold" style={{ color: color as string }}>{n as number}</p>
            <p className="text-xs font-medium mt-0.5" style={{ color: color as string }}>{label as string}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {(['openings', 'candidates'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize"
            style={{ background: activeTab === tab ? '#FFFFFF' : 'transparent', color: activeTab === tab ? '#0A0A0A' : '#8B8B85', boxShadow: activeTab === tab ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>
            {tab === 'openings' ? `Openings (${openings.length})` : `Candidates (${candidates.length})`}
          </button>
        ))}
      </div>

      {/* ── Openings tab ── */}
      {activeTab === 'openings' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setAddingOpening(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ backgroundColor: '#0B1538', color: '#FFFFFF' }}>
              <Plus size={14} />New Opening
            </button>
          </div>

          {loading ? (
            <div className="text-sm text-muted text-center py-12">Loading…</div>
          ) : openings.length === 0 ? (
            <div className="text-center py-16 text-muted text-sm">No job openings yet. Create one to get started.</div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Position', 'Department', 'Status', 'Target Date', 'Candidates', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {openings.map(op => {
                    const sm = OPENING_STATUS_META[op.status];
                    return (
                      <tr key={op.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-ink">{op.title}</td>
                        <td className="px-4 py-3 text-muted">{op.department}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ color: sm.color, backgroundColor: sm.bg }}>{sm.label}</span>
                        </td>
                        <td className="px-4 py-3 text-muted">{op.targetHireDate ?? '—'}</td>
                        <td className="px-4 py-3 text-muted">{candidatesByOpening(op.id)}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => { setFilterOpeningId(op.id); setActiveTab('candidates'); }}
                            className="flex items-center gap-1 text-xs font-medium hover:underline"
                            style={{ color: '#1D4ED8' }}>
                            View <ChevronRight size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Candidates tab ── */}
      {activeTab === 'candidates' && (
        <div className="space-y-4">
          {/* Filters row */}
          <div className="flex flex-wrap gap-3 items-center">
            <select className="px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none bg-white"
              value={filterOpeningId} onChange={e => setFilterOpeningId(e.target.value)}>
              <option value="">All Openings</option>
              {openings.map(o => <option key={o.id} value={o.id}>{o.title} — {o.department}</option>)}
            </select>
            <input type="search" placeholder="Search by name…" value={search} onChange={e => setSearch(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none bg-white w-48" />
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => setStageFilter('all')}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ background: stageFilter === 'all' ? '#0B1538' : '#F1F5F9', color: stageFilter === 'all' ? '#FFFFFF' : '#64748B' }}>
                All
              </button>
              {STAGES.map(s => (
                <button key={s.value} onClick={() => setStageFilter(s.value)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: stageFilter === s.value ? s.color : s.bg, color: stageFilter === s.value ? '#FFFFFF' : s.color }}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="ml-auto">
              <button onClick={() => setAddingCandidate(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
                style={{ backgroundColor: '#0B1538', color: '#FFFFFF' }}>
                <Plus size={14} />Add Candidate
              </button>
            </div>
          </div>

          {filteredCandidates.length === 0 ? (
            <div className="text-center py-16 text-muted text-sm">No candidates match the current filters.</div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Candidate', 'Position', 'Stage', 'Source', 'Phone', 'Applied', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCandidates.map(c => {
                    const addedDate = (c.addedAt as any)?.toDate?.();
                    const nextSt = NEXT_STAGE[c.stage];
                    return (
                      <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-ink">{c.name}</p>
                          {c.currentCompany && <p className="text-xs text-muted">{c.currentCompany}</p>}
                        </td>
                        <td className="px-4 py-3 text-muted text-xs">{c.openingTitle}</td>
                        <td className="px-4 py-3"><StagePill stage={c.stage} /></td>
                        <td className="px-4 py-3 text-muted text-xs">{SOURCE_LABELS[c.source]}</td>
                        <td className="px-4 py-3 text-muted">{c.phone}</td>
                        <td className="px-4 py-3 text-muted text-xs">{addedDate ? format(addedDate, 'dd MMM') : '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {c.resumeLink && (
                              <a href={c.resumeLink} target="_blank" rel="noopener noreferrer"
                                className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors" title="View Resume"
                                style={{ color: '#1D4ED8' }}>
                                <ExternalLink size={13} />
                              </a>
                            )}
                            {nextSt && c.stage !== 'rejected' && (
                              <button onClick={() => setAdvancing(c)}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium hover:bg-indigo-50 transition-colors"
                                style={{ color: '#3730A3' }} title={`Advance to ${STAGE_MAP[nextSt].label}`}>
                                <ArrowRight size={11} />{STAGE_MAP[nextSt].label}
                              </button>
                            )}
                            {c.stage === 'offer_made' && (
                              <button onClick={() => setOfferCandidate(c)}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium hover:bg-amber-50 transition-colors"
                                style={{ color: '#C2410C' }}>
                                <Download size={11} />Offer
                              </button>
                            )}
                            {c.stage !== 'hired' && c.stage !== 'rejected' && (
                              <button onClick={() => setRejecting(c)}
                                className="p-1.5 rounded-lg hover:bg-red-50 transition-colors" title="Reject"
                                style={{ color: '#991B1B' }}>
                                <X size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {addingOpening   && <AddOpeningModal   uid={user?.uid ?? ''}  onClose={() => setAddingOpening(false)} />}
      {addingCandidate && <AddCandidateModal uid={user?.uid ?? ''} openings={openings} defaultOpeningId={filterOpeningId || undefined} onClose={() => setAddingCandidate(false)} />}
      {advancing       && <AdvanceStageModal  candidate={advancing}  uid={user?.uid ?? ''} onClose={() => setAdvancing(null)} />}
      {rejecting       && <RejectModal        candidate={rejecting}  uid={user?.uid ?? ''} onClose={() => setRejecting(null)} />}
      {offerCandidate  && <OfferLetterModal   candidate={offerCandidate} openings={openings} onClose={() => setOfferCandidate(null)} />}
    </div>
  );
}
