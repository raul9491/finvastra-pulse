/**
 * HrLetterGeneratorPage — generate HR letters for employees.
 *
 * Route: /hrms/admin/letters
 * Access: admin + isHrmsManager
 *
 * Eight letter types covering the full employee lifecycle:
 *   Offer → Appointment → Confirmation → [Increment / Salary Certificate / NOC]
 *   → Experience → Relieving
 *
 * Flow:
 *   1. Build PDF (jsPDF) → ArrayBuffer
 *   2. Upload to Firebase Storage at hr-letters/{employeeId}/{filename}.pdf
 *   3. getDownloadURL() → permanent link
 *   4. Log to /generated_letters/{id} with storageUrl
 *   5. window.open(url) opens PDF in new tab for download
 *
 * HR can see and download all letters from the Recent Letters table.
 * Each employee can download their own letters from their profile page.
 */

import { useState, useMemo, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  FileText, Download, CheckCircle2, AlertCircle, Loader2,
} from 'lucide-react';
import {
  collection, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { db, storage } from '../../../lib/firebase';
import { useAllLetters } from '../hooks/useGeneratedLetters';
import type { GeneratedLetter } from '../../../types';
import {
  generateLetterPdf, letterFilename, letterRefNumber, TYPE_ABBREV,
  type LetterType, type LetterData,
  type OfferData, type AppointmentData, type ConfirmationData,
  type IncrementData, type NocData, type SalaryCertificateData,
  type ExperienceData, type RelievingData,
} from './letterPdf';

// ─── Letter type catalogue ────────────────────────────────────────────────────

const LETTER_TYPES: { value: LetterType; label: string; desc: string }[] = [
  { value: 'offer',              label: 'Offer Letter',           desc: 'Pre-joining offer to candidate'     },
  { value: 'appointment',        label: 'Appointment Letter',     desc: 'Formal appointment on joining'      },
  { value: 'confirmation',       label: 'Confirmation Letter',    desc: 'End of probation confirmation'      },
  { value: 'increment',          label: 'Salary Increment',       desc: 'Revised CTC notification'           },
  { value: 'noc',                label: 'NOC',                    desc: 'No Objection Certificate'           },
  { value: 'salary_certificate', label: 'Salary Certificate',     desc: 'CTC proof for banks / visa'        },
  { value: 'experience',         label: 'Experience Certificate', desc: 'Work history certificate'           },
  { value: 'relieving',          label: 'Relieving Letter',       desc: 'Separation + exit confirmation'     },
];

// ─── Form style helpers ───────────────────────────────────────────────────────

const baseInp = 'w-full text-sm px-3.5 py-2.5 border rounded-xl outline-none focus:ring-2 bg-white transition-colors';

const inp = (field?: string, fieldErrors?: Record<string, string>) =>
  `${baseInp} ${field && fieldErrors?.[field]
    ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30'
    : 'border-slate-200 focus:ring-navy/10 focus:border-navy'}`;

const fLabel = (
  text: string,
  fieldErrors: Record<string, string>,
  field?: string,
  req = false,
) => (
  <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
    style={{ color: field && fieldErrors[field] ? '#DC2626' : '#8B8B85' }}>
    {text}{req && <span className="text-red-500 ml-0.5">*</span>}
    {field && fieldErrors[field] && (
      <span className="ml-2 font-medium normal-case tracking-normal text-red-500">
        — {fieldErrors[field]}
      </span>
    )}
  </label>
);

// ─── HrLetterGeneratorPage ────────────────────────────────────────────────────

export function HrLetterGeneratorPage() {
  const { user, profile } = useAuth();
  const uid               = user?.uid ?? '';
  const isAdmin           = profile?.role === 'admin';
  const isHrmsManager     = profile?.isHrmsManager === true;
  if (!isAdmin && !isHrmsManager) return <Navigate to="/hrms/dashboard" replace />;

  const { employees }                   = useAllEmployees();
  const { letters, loading: llLoading } = useAllLetters();

  const activeEmployees = useMemo(
    () => employees.filter((e) => !e.employeeStatus || e.employeeStatus === 'active'),
    [employees],
  );
  const empOptions = activeEmployees.map((e) => ({ value: e.userId, label: e.displayName }));

  // ── Form state ──────────────────────────────────────────────────────────────
  const [letterType, setLetterType] = useState<LetterType>('appointment');
  const [empId,      setEmpId]      = useState('');
  const [seq,        setSeq]        = useState('1');

  // Offer
  const [off_designation,    setOff_designation]    = useState('');
  const [off_department,     setOff_department]     = useState('');
  const [off_ctc,            setOff_ctc]            = useState('');
  const [off_joiningDeadline,setOff_joiningDeadline]= useState('');
  const [off_probation,      setOff_probation]      = useState('6 months');
  const [off_reportingTo,    setOff_reportingTo]    = useState('');

  // Appointment
  const [apt_designation, setApt_designation] = useState('');
  const [apt_department,  setApt_department]  = useState('');
  const [apt_joiningDate, setApt_joiningDate] = useState('');
  const [apt_ctc,         setApt_ctc]         = useState('');
  const [apt_probation,   setApt_probation]   = useState('6 months');
  const [apt_reportingTo, setApt_reportingTo] = useState('');

  // Confirmation
  const [con_designation,      setCon_designation]      = useState('');
  const [con_department,       setCon_department]       = useState('');
  const [con_joiningDate,      setCon_joiningDate]      = useState('');
  const [con_confirmationDate, setCon_confirmationDate] = useState('');
  const [con_newDesignation,   setCon_newDesignation]   = useState('');

  // Increment
  const [inc_designation,   setInc_designation]   = useState('');
  const [inc_department,    setInc_department]    = useState('');
  const [inc_effectiveDate, setInc_effectiveDate] = useState('');
  const [inc_oldCtc,        setInc_oldCtc]        = useState('');
  const [inc_newCtc,        setInc_newCtc]        = useState('');
  const [inc_percentage,    setInc_percentage]    = useState('');

  // NOC
  const [noc_designation, setNoc_designation] = useState('');
  const [noc_department,  setNoc_department]  = useState('');
  const [noc_joiningDate, setNoc_joiningDate] = useState('');
  const [noc_purpose,     setNoc_purpose]     = useState('');
  const [noc_validUntil,  setNoc_validUntil]  = useState('');

  // Salary Certificate
  const [sal_designation, setSal_designation] = useState('');
  const [sal_department,  setSal_department]  = useState('');
  const [sal_joiningDate, setSal_joiningDate] = useState('');
  const [sal_grossCtc,    setSal_grossCtc]    = useState('');
  const [sal_basicSalary, setSal_basicSalary] = useState('');
  const [sal_purpose,     setSal_purpose]     = useState('');

  // Experience / Relieving (shared)
  const [ex_designation,     setEx_designation]     = useState('');
  const [ex_department,      setEx_department]      = useState('');
  const [ex_joiningDate,     setEx_joiningDate]     = useState('');
  const [ex_lastWorkingDate, setEx_lastWorkingDate] = useState('');
  const [ex_exitReason,      setEx_exitReason]      = useState('');

  const [generating,  setGenerating]  = useState(false);
  const [success,     setSuccess]     = useState('');
  const [error,       setError]       = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const selectedEmp = activeEmployees.find((e) => e.userId === empId);

  // Auto-fill common fields when employee is selected
  useEffect(() => {
    if (!selectedEmp) return;
    const { designation = '', department = '', joiningDate = '' } = selectedEmp;
    const joinFmt = joiningDate
      ? format(new Date(joiningDate + 'T00:00:00'), 'dd-MMM-yyyy')
      : '';

    switch (letterType) {
      case 'offer':
        setOff_designation(designation);
        setOff_department(department);
        break;
      case 'appointment':
        setApt_designation(designation);
        setApt_department(department);
        setApt_joiningDate(joinFmt);
        break;
      case 'confirmation':
        setCon_designation(designation);
        setCon_department(department);
        setCon_joiningDate(joinFmt);
        break;
      case 'increment':
        setInc_designation(designation);
        setInc_department(department);
        break;
      case 'noc':
        setNoc_designation(designation);
        setNoc_department(department);
        setNoc_joiningDate(joinFmt);
        break;
      case 'salary_certificate':
        setSal_designation(designation);
        setSal_department(department);
        setSal_joiningDate(joinFmt);
        break;
      case 'experience':
      case 'relieving':
        setEx_designation(designation);
        setEx_department(department);
        setEx_joiningDate(joinFmt);
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId, letterType]);

  // ── Validation ──────────────────────────────────────────────────────────────
  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!empId)                              errs.emp = 'Select an employee';
    if (!seq.trim() || isNaN(Number(seq)))   errs.seq = 'Enter a valid sequence number';

    switch (letterType) {
      case 'offer':
        if (!off_designation.trim())    errs.off_designation    = 'Required';
        if (!off_department.trim())     errs.off_department     = 'Required';
        if (!off_ctc.trim())            errs.off_ctc            = 'Required';
        if (!off_joiningDeadline.trim())errs.off_joiningDeadline= 'Required';
        if (!off_reportingTo.trim())    errs.off_reportingTo    = 'Required';
        break;
      case 'appointment':
        if (!apt_designation.trim()) errs.apt_designation = 'Required';
        if (!apt_department.trim())  errs.apt_department  = 'Required';
        if (!apt_joiningDate.trim()) errs.apt_joiningDate = 'Required';
        if (!apt_ctc.trim())         errs.apt_ctc         = 'Required';
        if (!apt_reportingTo.trim()) errs.apt_reportingTo = 'Required';
        break;
      case 'confirmation':
        if (!con_designation.trim())      errs.con_designation      = 'Required';
        if (!con_department.trim())       errs.con_department       = 'Required';
        if (!con_joiningDate.trim())      errs.con_joiningDate      = 'Required';
        if (!con_confirmationDate.trim()) errs.con_confirmationDate = 'Required';
        break;
      case 'increment':
        if (!inc_designation.trim())   errs.inc_designation   = 'Required';
        if (!inc_department.trim())    errs.inc_department    = 'Required';
        if (!inc_effectiveDate.trim()) errs.inc_effectiveDate = 'Required';
        if (!inc_oldCtc.trim())        errs.inc_oldCtc        = 'Required';
        if (!inc_newCtc.trim())        errs.inc_newCtc        = 'Required';
        break;
      case 'noc':
        if (!noc_designation.trim()) errs.noc_designation = 'Required';
        if (!noc_department.trim())  errs.noc_department  = 'Required';
        if (!noc_joiningDate.trim()) errs.noc_joiningDate = 'Required';
        if (!noc_purpose.trim())     errs.noc_purpose     = 'Required';
        if (!noc_validUntil.trim())  errs.noc_validUntil  = 'Required';
        break;
      case 'salary_certificate':
        if (!sal_designation.trim()) errs.sal_designation = 'Required';
        if (!sal_department.trim())  errs.sal_department  = 'Required';
        if (!sal_joiningDate.trim()) errs.sal_joiningDate = 'Required';
        if (!sal_grossCtc.trim())    errs.sal_grossCtc    = 'Required';
        if (!sal_basicSalary.trim()) errs.sal_basicSalary = 'Required';
        if (!sal_purpose.trim())     errs.sal_purpose     = 'Required';
        break;
      case 'experience':
      case 'relieving':
        if (!ex_designation.trim())     errs.ex_designation     = 'Required';
        if (!ex_department.trim())      errs.ex_department      = 'Required';
        if (!ex_joiningDate.trim())     errs.ex_joiningDate     = 'Required';
        if (!ex_lastWorkingDate.trim()) errs.ex_lastWorkingDate = 'Required';
        if (letterType === 'relieving' && !ex_exitReason.trim()) errs.ex_exitReason = 'Required';
        break;
    }
    return errs;
  };

  // ── Generate, upload, log ───────────────────────────────────────────────────
  const handleGenerate = async () => {
    const errs = validate();
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    setFieldErrors({});
    setError('');
    setSuccess('');
    setGenerating(true);

    try {
      const empName = selectedEmp?.displayName ?? empId;
      const empCode = selectedEmp?.employeeId  ?? empId;
      const year    = new Date().getFullYear();
      const refNum  = letterRefNumber(letterType, year, seq);

      // Build letter data
      let data: LetterData;
      switch (letterType) {
        case 'offer':
          data = { type: 'offer', empName, empCode,
            designation: off_designation, department: off_department,
            ctc: off_ctc, joiningDeadline: off_joiningDeadline,
            probation: off_probation, reportingTo: off_reportingTo,
          } as OfferData;
          break;
        case 'appointment':
          data = { type: 'appointment', empName, empCode,
            designation: apt_designation, department: apt_department,
            joiningDate: apt_joiningDate, ctc: apt_ctc,
            probation: apt_probation, reportingTo: apt_reportingTo,
          } as AppointmentData;
          break;
        case 'confirmation':
          data = { type: 'confirmation', empName, empCode,
            designation: con_designation, department: con_department,
            joiningDate: con_joiningDate, confirmationDate: con_confirmationDate,
            newDesignation: con_newDesignation,
          } as ConfirmationData;
          break;
        case 'increment':
          data = { type: 'increment', empName, empCode,
            designation: inc_designation, department: inc_department,
            effectiveDate: inc_effectiveDate, oldCtc: inc_oldCtc,
            newCtc: inc_newCtc, percentage: inc_percentage,
          } as IncrementData;
          break;
        case 'noc':
          data = { type: 'noc', empName, empCode,
            designation: noc_designation, department: noc_department,
            joiningDate: noc_joiningDate, purpose: noc_purpose,
            validUntil: noc_validUntil,
          } as NocData;
          break;
        case 'salary_certificate':
          data = { type: 'salary_certificate', empName, empCode,
            designation: sal_designation, department: sal_department,
            joiningDate: sal_joiningDate, grossCtc: sal_grossCtc,
            basicSalary: sal_basicSalary, purpose: sal_purpose,
          } as SalaryCertificateData;
          break;
        case 'experience':
          data = { type: 'experience', empName, empCode,
            designation: ex_designation, department: ex_department,
            joiningDate: ex_joiningDate, lastWorkingDate: ex_lastWorkingDate,
          } as ExperienceData;
          break;
        case 'relieving':
          data = { type: 'relieving', empName, empCode,
            designation: ex_designation, department: ex_department,
            joiningDate: ex_joiningDate, lastWorkingDate: ex_lastWorkingDate,
            exitReason: ex_exitReason,
          } as RelievingData;
          break;
      }

      // 1. Generate PDF bytes
      const bytes    = generateLetterPdf(data, seq);
      const filename = letterFilename(data, year, seq);

      // 2. Upload to Firebase Storage
      const fileRef = storageRef(storage, `hr-letters/${empId}/${filename}`);
      await uploadBytes(fileRef, bytes, { contentType: 'application/pdf' });

      // 3. Get permanent download URL
      const downloadUrl = await getDownloadURL(fileRef);

      // 4. Log to Firestore with storageUrl
      await addDoc(collection(db, 'generated_letters'), {
        letterType,
        employeeId:      empId,
        employeeName:    empName,
        refNumber:       refNum,
        generatedBy:     uid,
        generatedByName: profile?.displayName ?? uid,
        generatedAt:     serverTimestamp(),
        storageUrl:      downloadUrl,
        storageStatus:   'uploaded',
      });

      // 5. Open in new tab (user can view / save from browser)
      window.open(downloadUrl, '_blank');

      setSuccess(`${LETTER_TYPES.find((t) => t.value === letterType)?.label} generated and saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate letter. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const fe   = fieldErrors;
  const I    = (f?: string) => inp(f, fe);
  const L    = (text: string, f?: string, req = false) => fLabel(text, fe, f, req);

  const refPreview = `FV/${TYPE_ABBREV[letterType]}/${new Date().getFullYear()}/${String(Number(seq) || 1).padStart(3, '0')}`;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-3xl mb-1"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
          HR Letters
        </h2>
        <p className="text-sm" style={{ color: '#8B8B85' }}>
          Generate official HR letters — stored in Firebase and available for employees to download from their profile.
        </p>
      </div>

      {/* Form */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        {/* Letter type grid — 2 rows × 4 */}
        <div>
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#475569' }}>
            Letter Type
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {LETTER_TYPES.map(({ value, label: lbl, desc }) => (
              <button
                key={value}
                onClick={() => { setLetterType(value); setSuccess(''); setError(''); setFieldErrors({}); }}
                className={`p-3 rounded-xl border text-left transition-all ${
                  letterType === value ? 'border-navy bg-navy/5' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <p className={`text-xs font-semibold ${letterType === value ? 'text-navy' : 'text-ink'}`}>{lbl}</p>
                <p className="text-[10px] mt-0.5 leading-tight" style={{ color: '#8B8B85' }}>{desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Status banners */}
        {success && (
          <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: '#F0FDF4' }}>
            <CheckCircle2 size={15} style={{ color: '#059669' }} />
            <p className="text-sm font-medium" style={{ color: '#065F46' }}>{success}</p>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: '#FFF1F2' }}>
            <AlertCircle size={15} style={{ color: '#BE123C' }} />
            <p className="text-sm" style={{ color: '#BE123C' }}>{error}</p>
          </div>
        )}

        {/* Common fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            {L('Employee', 'emp', true)}
            <SearchableSelect options={empOptions} value={empId} onChange={(v) => { setEmpId(v); setFieldErrors((p) => { const n = {...p}; delete n.emp; return n; }); }} placeholder="Select employee…" />
          </div>
          <div>
            {L('Sequence Number', 'seq', true)}
            <input
              type="number" min="1"
              className={I('seq')}
              value={seq}
              onChange={(e) => { setSeq(e.target.value); setFieldErrors((p) => { const n = {...p}; delete n.seq; return n; }); }}
            />
            <p className="text-[10px] mt-1" style={{ color: '#8B8B85' }}>Ref: {refPreview}</p>
          </div>
        </div>

        {/* ── Offer fields ── */}
        {letterType === 'offer' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>{L('Designation', 'off_designation', true)}<input className={I('off_designation')} value={off_designation} onChange={(e) => setOff_designation(e.target.value)} /></div>
            <div>{L('Department', 'off_department', true)}<input className={I('off_department')} value={off_department} onChange={(e) => setOff_department(e.target.value)} /></div>
            <div>{L('CTC', 'off_ctc', true)}<input className={I('off_ctc')} placeholder="e.g. ₹4,80,000 per annum" value={off_ctc} onChange={(e) => setOff_ctc(e.target.value)} /></div>
            <div>{L('Joining Deadline (dd-MMM-yyyy)', 'off_joiningDeadline', true)}<input className={I('off_joiningDeadline')} placeholder="e.g. 15-Jun-2026" value={off_joiningDeadline} onChange={(e) => setOff_joiningDeadline(e.target.value)} /></div>
            <div>{L('Probation Period')}<input className={I()} value={off_probation} onChange={(e) => setOff_probation(e.target.value)} /></div>
            <div>{L('Reporting To', 'off_reportingTo', true)}<input className={I('off_reportingTo')} placeholder="Manager name" value={off_reportingTo} onChange={(e) => setOff_reportingTo(e.target.value)} /></div>
          </div>
        )}

        {/* ── Appointment fields ── */}
        {letterType === 'appointment' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>{L('Designation', 'apt_designation', true)}<input className={I('apt_designation')} value={apt_designation} onChange={(e) => setApt_designation(e.target.value)} /></div>
            <div>{L('Department', 'apt_department', true)}<input className={I('apt_department')} value={apt_department} onChange={(e) => setApt_department(e.target.value)} /></div>
            <div>{L('Date of Joining (dd-MMM-yyyy)', 'apt_joiningDate', true)}<input className={I('apt_joiningDate')} placeholder="e.g. 01-Jun-2026" value={apt_joiningDate} onChange={(e) => setApt_joiningDate(e.target.value)} /></div>
            <div>{L('CTC', 'apt_ctc', true)}<input className={I('apt_ctc')} placeholder="e.g. ₹4,80,000 per annum" value={apt_ctc} onChange={(e) => setApt_ctc(e.target.value)} /></div>
            <div>{L('Probation Period')}<input className={I()} value={apt_probation} onChange={(e) => setApt_probation(e.target.value)} /></div>
            <div>{L('Reporting To', 'apt_reportingTo', true)}<input className={I('apt_reportingTo')} placeholder="Manager name" value={apt_reportingTo} onChange={(e) => setApt_reportingTo(e.target.value)} /></div>
          </div>
        )}

        {/* ── Confirmation fields ── */}
        {letterType === 'confirmation' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>{L('Designation', 'con_designation', true)}<input className={I('con_designation')} value={con_designation} onChange={(e) => setCon_designation(e.target.value)} /></div>
            <div>{L('Department', 'con_department', true)}<input className={I('con_department')} value={con_department} onChange={(e) => setCon_department(e.target.value)} /></div>
            <div>{L('Date of Joining (dd-MMM-yyyy)', 'con_joiningDate', true)}<input className={I('con_joiningDate')} placeholder="e.g. 01-Dec-2025" value={con_joiningDate} onChange={(e) => setCon_joiningDate(e.target.value)} /></div>
            <div>{L('Confirmation Date (dd-MMM-yyyy)', 'con_confirmationDate', true)}<input className={I('con_confirmationDate')} placeholder="e.g. 01-Jun-2026" value={con_confirmationDate} onChange={(e) => setCon_confirmationDate(e.target.value)} /></div>
            <div className="sm:col-span-2">{L('New Designation (if changed)')}<input className={I()} placeholder="Leave blank if unchanged" value={con_newDesignation} onChange={(e) => setCon_newDesignation(e.target.value)} /></div>
          </div>
        )}

        {/* ── Increment fields ── */}
        {letterType === 'increment' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>{L('Designation', 'inc_designation', true)}<input className={I('inc_designation')} value={inc_designation} onChange={(e) => setInc_designation(e.target.value)} /></div>
            <div>{L('Department', 'inc_department', true)}<input className={I('inc_department')} value={inc_department} onChange={(e) => setInc_department(e.target.value)} /></div>
            <div>{L('Effective Date (dd-MMM-yyyy)', 'inc_effectiveDate', true)}<input className={I('inc_effectiveDate')} placeholder="e.g. 01-Apr-2026" value={inc_effectiveDate} onChange={(e) => setInc_effectiveDate(e.target.value)} /></div>
            <div>{L('Increment %')}<input className={I()} placeholder="e.g. 15%" value={inc_percentage} onChange={(e) => setInc_percentage(e.target.value)} /></div>
            <div>{L('Previous CTC', 'inc_oldCtc', true)}<input className={I('inc_oldCtc')} placeholder="e.g. ₹4,80,000 per annum" value={inc_oldCtc} onChange={(e) => setInc_oldCtc(e.target.value)} /></div>
            <div>{L('Revised CTC', 'inc_newCtc', true)}<input className={I('inc_newCtc')} placeholder="e.g. ₹5,52,000 per annum" value={inc_newCtc} onChange={(e) => setInc_newCtc(e.target.value)} /></div>
          </div>
        )}

        {/* ── NOC fields ── */}
        {letterType === 'noc' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>{L('Designation', 'noc_designation', true)}<input className={I('noc_designation')} value={noc_designation} onChange={(e) => setNoc_designation(e.target.value)} /></div>
            <div>{L('Department', 'noc_department', true)}<input className={I('noc_department')} value={noc_department} onChange={(e) => setNoc_department(e.target.value)} /></div>
            <div>{L('Date of Joining (dd-MMM-yyyy)', 'noc_joiningDate', true)}<input className={I('noc_joiningDate')} placeholder="e.g. 01-Jun-2024" value={noc_joiningDate} onChange={(e) => setNoc_joiningDate(e.target.value)} /></div>
            <div>{L('Valid Until (dd-MMM-yyyy)', 'noc_validUntil', true)}<input className={I('noc_validUntil')} placeholder="e.g. 31-Dec-2026" value={noc_validUntil} onChange={(e) => setNoc_validUntil(e.target.value)} /></div>
            <div className="sm:col-span-2">{L('Purpose of NOC', 'noc_purpose', true)}<input className={I('noc_purpose')} placeholder="e.g. home loan application, passport application, part-time study" value={noc_purpose} onChange={(e) => setNoc_purpose(e.target.value)} /></div>
          </div>
        )}

        {/* ── Salary Certificate fields ── */}
        {letterType === 'salary_certificate' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>{L('Designation', 'sal_designation', true)}<input className={I('sal_designation')} value={sal_designation} onChange={(e) => setSal_designation(e.target.value)} /></div>
            <div>{L('Department', 'sal_department', true)}<input className={I('sal_department')} value={sal_department} onChange={(e) => setSal_department(e.target.value)} /></div>
            <div>{L('Date of Joining (dd-MMM-yyyy)', 'sal_joiningDate', true)}<input className={I('sal_joiningDate')} placeholder="e.g. 01-Jun-2024" value={sal_joiningDate} onChange={(e) => setSal_joiningDate(e.target.value)} /></div>
            <div>{L('Gross Annual CTC', 'sal_grossCtc', true)}<input className={I('sal_grossCtc')} placeholder="e.g. ₹4,80,000 per annum" value={sal_grossCtc} onChange={(e) => setSal_grossCtc(e.target.value)} /></div>
            <div>{L('Basic Salary (Monthly)', 'sal_basicSalary', true)}<input className={I('sal_basicSalary')} placeholder="e.g. ₹15,000 per month" value={sal_basicSalary} onChange={(e) => setSal_basicSalary(e.target.value)} /></div>
            <div>{L('Purpose', 'sal_purpose', true)}<input className={I('sal_purpose')} placeholder="e.g. home loan application, visa application" value={sal_purpose} onChange={(e) => setSal_purpose(e.target.value)} /></div>
          </div>
        )}

        {/* ── Experience / Relieving fields ── */}
        {(letterType === 'experience' || letterType === 'relieving') && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>{L('Designation', 'ex_designation', true)}<input className={I('ex_designation')} value={ex_designation} onChange={(e) => setEx_designation(e.target.value)} /></div>
            <div>{L('Department', 'ex_department', true)}<input className={I('ex_department')} value={ex_department} onChange={(e) => setEx_department(e.target.value)} /></div>
            <div>{L('Date of Joining (dd-MMM-yyyy)', 'ex_joiningDate', true)}<input className={I('ex_joiningDate')} placeholder="e.g. 01-Jun-2024" value={ex_joiningDate} onChange={(e) => setEx_joiningDate(e.target.value)} /></div>
            <div>{L('Last Working Date (dd-MMM-yyyy)', 'ex_lastWorkingDate', true)}<input className={I('ex_lastWorkingDate')} placeholder="e.g. 31-May-2026" value={ex_lastWorkingDate} onChange={(e) => setEx_lastWorkingDate(e.target.value)} /></div>
            {letterType === 'relieving' && (
              <div className="sm:col-span-2">{L('Exit Reason', 'ex_exitReason', true)}<input className={I('ex_exitReason')} placeholder="e.g. Resignation" value={ex_exitReason} onChange={(e) => setEx_exitReason(e.target.value)} /></div>
            )}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
          >
            {generating ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {generating ? 'Uploading…' : 'Generate & Download'}
          </button>
        </div>
      </div>

      {/* Recent letters log */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#475569' }}>
          Recently Generated Letters
        </h3>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {llLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />)}
            </div>
          ) : letters.length === 0 ? (
            <div className="py-10 text-center">
              <FileText size={32} className="mx-auto mb-3 text-slate-200" />
              <p className="text-sm" style={{ color: '#8B8B85' }}>No letters generated yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Employee', 'Letter Type', 'Ref #', 'Generated By', 'Date', ''].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {letters.slice(0, 30).map((l) => (
                    <LetterRow key={l.id} letter={l} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Letter row with download button ─────────────────────────────────────────

function LetterRow({ letter: l }: { letter: GeneratedLetter }) {
  const d = l.generatedAt?.toDate?.();
  const typeLabel = LETTER_TYPES.find((t) => t.value === l.letterType)?.label ?? l.letterType;

  return (
    <tr className="border-b border-slate-50 hover:bg-slate-50/50">
      <td className="px-4 py-3 font-medium" style={{ color: '#0A0A0A' }}>{l.employeeName}</td>
      <td className="px-4 py-3">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: '#EDE9FE', color: '#5B21B6' }}>
          {typeLabel}
        </span>
      </td>
      <td className="px-4 py-3 font-mono text-xs" style={{ color: '#8B8B85' }}>{l.refNumber}</td>
      <td className="px-4 py-3 text-xs" style={{ color: '#8B8B85' }}>{l.generatedByName}</td>
      <td className="px-4 py-3 text-xs" style={{ color: '#8B8B85' }}>
        {d ? format(d, 'd MMM yyyy, h:mm a') : '—'}
      </td>
      <td className="px-4 py-3">
        {l.storageUrl ? (
          <button
            onClick={() => window.open(l.storageUrl!, '_blank')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-200 hover:bg-slate-50 transition-colors"
            style={{ color: '#0B1538' }}
            title="Open / download PDF"
          >
            <Download size={12} />
            PDF
          </button>
        ) : (
          <span className="text-xs" style={{ color: '#8B8B85' }}>—</span>
        )}
      </td>
    </tr>
  );
}
