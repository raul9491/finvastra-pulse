/**
 * HrLetterGeneratorPage — generate HR letters for employees.
 *
 * Route:  /hrms/admin/letters
 * Access: admin + isHrmsManager
 *
 * Four letter types matching actual Finvastra Advisors company formats:
 *   Appointment → Confirmation / Probation Extension → Consultant Agreement
 *
 * Flow:
 *   1. Build PDF (jsPDF) → ArrayBuffer
 *   2. Upload to Firebase Storage via /api/admin/hr-letters/upload
 *   3. getDownloadURL() → permanent link
 *   4. Log to /generated_letters/{id} with storageUrl
 *   5. window.open(url) opens PDF in new tab
 */

import { useState, useMemo, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  FileText, Download, CheckCircle2, AlertCircle, Loader2, UserPlus, Users, Plus, Minus,
} from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { db } from '../../../lib/firebase';
import { useAllLetters } from '../hooks/useGeneratedLetters';
import type { GeneratedLetter } from '../../../types';
import {
  generateLetterPdf, letterFilename, letterRefNumber, TYPE_ABBREV,
  type LetterType, type LetterData, type Salutation, type SalaryRow,
  type AppointmentData, type ConfirmationData,
  type ProbationExtensionData, type ConsultantAgreementData,
} from './letterPdf';

// ─── Letter type catalogue ────────────────────────────────────────────────────

const LETTER_TYPES: { value: LetterType; label: string; desc: string }[] = [
  { value: 'appointment',         label: 'Appointment Letter',     desc: 'Full legal employment accord'        },
  { value: 'confirmation',        label: 'Confirmation Letter',    desc: 'End of probation — permanent status' },
  { value: 'probation_extension', label: 'Probation Extension',    desc: 'Extend probation period'             },
  { value: 'consultant_agreement',label: 'Consultant Agreement',   desc: '13-clause engagement contract'       },
];

const SALUTATIONS: Salutation[] = ['Mr.', 'Ms.', 'Mrs.', 'Dr.'];

// ─── Default salary row components ───────────────────────────────────────────

const DEFAULT_SALARY_ROWS: SalaryRow[] = [
  { component: 'Basic Salary',              description: 'Monthly Fixed', monthly: '' },
  { component: 'House Rent Allowance',      description: '',              monthly: '' },
  { component: 'Conveyance Allowance',      description: '',              monthly: '' },
  { component: 'Other Allowance',           description: '',              monthly: '' },
];

// ─── Form style helpers ───────────────────────────────────────────────────────

const baseInp = 'w-full text-sm px-3.5 py-2.5 border rounded-xl outline-none focus:ring-2 bg-white transition-colors';
const baseTa  = `${baseInp} resize-none`;

const inp = (field?: string, fe?: Record<string, string>) =>
  `${baseInp} ${field && fe?.[field]
    ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30'
    : 'border-slate-200 focus:ring-navy/10 focus:border-navy'}`;

const fLabel = (
  text: string,
  fe: Record<string, string>,
  field?: string,
  req = false,
) => (
  <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
    style={{ color: field && fe[field] ? '#DC2626' : '#8B8B85' }}>
    {text}{req && <span className="text-red-500 ml-0.5">*</span>}
    {field && fe[field] && (
      <span className="ml-2 font-medium normal-case tracking-normal text-red-500">
        — {fe[field]}
      </span>
    )}
  </label>
);

// ─── HrLetterGeneratorPage ────────────────────────────────────────────────────

export function HrLetterGeneratorPage() {
  const { user, profile } = useAuth();
  const uid           = user?.uid ?? '';
  const isAdmin       = profile?.role === 'admin';
  const isHrmsManager = profile?.isHrmsManager === true;
  if (!isAdmin && !isHrmsManager) return <Navigate to="/hrms/dashboard" replace />;

  const { employees }                   = useAllEmployees();
  const { letters, loading: llLoading } = useAllLetters();

  const activeEmployees = useMemo(
    () => employees.filter((e) => !e.employeeStatus || e.employeeStatus === 'active'),
    [employees],
  );
  const empOptions = activeEmployees.map((e) => ({ value: e.userId, label: e.displayName }));

  // ── Employee selection ──────────────────────────────────────────────────────
  const [manualMode, setManualMode] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualCode, setManualCode] = useState('');

  // ── Common ─────────────────────────────────────────────────────────────────
  const [letterType, setLetterType] = useState<LetterType>('appointment');
  const [empId,      setEmpId]      = useState('');
  const [seq,        setSeq]        = useState('1');
  const [salutation, setSalutation] = useState<Salutation>('Mr.');

  // ── Appointment ────────────────────────────────────────────────────────────
  const [apt_empAddress,       setApt_empAddress]       = useState('');
  const [apt_designation,      setApt_designation]      = useState('');
  const [apt_joiningDate,      setApt_joiningDate]      = useState('');
  const [apt_probationDuration,setApt_probationDuration]= useState('three (3) months');
  const [apt_probationEndDate, setApt_probationEndDate] = useState('');
  const [apt_ctcAnnual,        setApt_ctcAnnual]        = useState('');
  const [apt_ctcInWords,       setApt_ctcInWords]       = useState('');
  const [apt_salaryRows,       setApt_salaryRows]       = useState<SalaryRow[]>(DEFAULT_SALARY_ROWS.map(r => ({ ...r })));

  // ── Confirmation ───────────────────────────────────────────────────────────
  const [con_designation,      setCon_designation]      = useState('');
  const [con_probationFrom,    setCon_probationFrom]    = useState('');
  const [con_probationTo,      setCon_probationTo]      = useState('');
  const [con_confirmationDate, setCon_confirmationDate] = useState('');
  const [con_newDesignation,   setCon_newDesignation]   = useState('');

  // ── Probation Extension ────────────────────────────────────────────────────
  const [pex_designation,         setPex_designation]         = useState('');
  const [pex_probationDuration,    setPex_probationDuration]   = useState('3 months');
  const [pex_originalProbationEnd, setPex_originalProbationEnd]= useState('');
  const [pex_extendedUntilDate,    setPex_extendedUntilDate]   = useState('');

  // ── Consultant Agreement ───────────────────────────────────────────────────
  const [cag_consultantAddress, setCag_consultantAddress] = useState('');
  const [cag_role,              setCag_role]              = useState('');
  const [cag_scopeOfServices,   setCag_scopeOfServices]   = useState('');
  const [cag_startDate,         setCag_startDate]         = useState('');
  const [cag_endDate,           setCag_endDate]           = useState('');
  const [cag_termMonths,        setCag_termMonths]        = useState('one (1) month');
  const [cag_feeAmount,         setCag_feeAmount]         = useState('');
  const [cag_feeInWords,        setCag_feeInWords]        = useState('');

  // ── Status ─────────────────────────────────────────────────────────────────
  const [generating,  setGenerating]  = useState(false);
  const [success,     setSuccess]     = useState('');
  const [error,       setError]       = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const selectedEmp = activeEmployees.find((e) => e.userId === empId);

  // Auto-fill common fields when employee is selected or letter type changes
  useEffect(() => {
    if (!selectedEmp) return;
    const { designation = '', joiningDate = '' } = selectedEmp;
    const joinFmt = joiningDate
      ? format(new Date(joiningDate + 'T00:00:00'), "do MMMM yyyy")
      : '';

    switch (letterType) {
      case 'appointment':
        setApt_designation(designation);
        setApt_joiningDate(joinFmt);
        break;
      case 'confirmation':
        setCon_designation(designation);
        break;
      case 'probation_extension':
        setPex_designation(designation);
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId, letterType]);

  // ── Salary row helpers ──────────────────────────────────────────────────────
  const totalMonthly = apt_salaryRows.reduce(
    (sum, r) => sum + (parseFloat(r.monthly.replace(/,/g, '')) || 0), 0
  );

  function updateSalaryRow(idx: number, field: keyof SalaryRow, val: string) {
    setApt_salaryRows((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));
  }

  function addSalaryRow() {
    setApt_salaryRows((prev) => [...prev, { component: '', description: '', monthly: '' }]);
  }

  function removeSalaryRow(idx: number) {
    if (apt_salaryRows.length <= 1) return;
    setApt_salaryRows((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {};

    if (manualMode) {
      if (!manualName.trim()) errs.manualName = 'Enter employee name';
      if (!manualCode.trim()) errs.manualCode = 'Enter employee code';
    } else {
      if (letterType !== 'consultant_agreement' && !empId) errs.emp = 'Select an employee';
    }
    if (!seq.trim() || isNaN(Number(seq))) errs.seq = 'Enter a valid sequence number';

    switch (letterType) {
      case 'appointment':
        if (!apt_empAddress.trim())       errs.apt_empAddress       = 'Required';
        if (!apt_designation.trim())      errs.apt_designation      = 'Required';
        if (!apt_joiningDate.trim())      errs.apt_joiningDate      = 'Required';
        if (!apt_probationDuration.trim())errs.apt_probationDuration = 'Required';
        if (!apt_probationEndDate.trim()) errs.apt_probationEndDate  = 'Required';
        if (!apt_ctcAnnual.trim())        errs.apt_ctcAnnual         = 'Required';
        if (!apt_ctcInWords.trim())       errs.apt_ctcInWords        = 'Required';
        if (apt_salaryRows.some(r => !r.component.trim() || !r.monthly.trim()))
          errs.apt_salary = 'All salary rows must have a component and monthly amount';
        break;
      case 'confirmation':
        if (!con_designation.trim())      errs.con_designation      = 'Required';
        if (!con_probationFrom.trim())    errs.con_probationFrom    = 'Required';
        if (!con_probationTo.trim())      errs.con_probationTo      = 'Required';
        if (!con_confirmationDate.trim()) errs.con_confirmationDate = 'Required';
        break;
      case 'probation_extension':
        if (!pex_designation.trim())          errs.pex_designation         = 'Required';
        if (!pex_probationDuration.trim())     errs.pex_probationDuration   = 'Required';
        if (!pex_originalProbationEnd.trim())  errs.pex_originalProbationEnd= 'Required';
        if (!pex_extendedUntilDate.trim())     errs.pex_extendedUntilDate   = 'Required';
        break;
      case 'consultant_agreement':
        if (!manualName.trim())               errs.manualName            = 'Enter consultant name';
        if (!cag_consultantAddress.trim())    errs.cag_consultantAddress = 'Required';
        if (!cag_role.trim())                 errs.cag_role              = 'Required';
        if (!cag_scopeOfServices.trim())      errs.cag_scopeOfServices   = 'Required';
        if (!cag_startDate.trim())            errs.cag_startDate         = 'Required';
        if (!cag_endDate.trim())              errs.cag_endDate           = 'Required';
        if (!cag_termMonths.trim())           errs.cag_termMonths        = 'Required';
        if (!cag_feeAmount.trim())            errs.cag_feeAmount         = 'Required';
        if (!cag_feeInWords.trim())           errs.cag_feeInWords        = 'Required';
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
      const isManual     = manualMode || letterType === 'consultant_agreement';
      const empName      = isManual ? manualName.trim() : (selectedEmp?.displayName ?? empId);
      const empCode      = isManual ? (manualCode.trim() || 'N/A') : (selectedEmp?.employeeId ?? empId);
      const storageEmpId = isManual ? '_manual' : empId;
      const year         = new Date().getFullYear();
      const refNum       = letterRefNumber(letterType, year, seq);

      let data: LetterData;
      switch (letterType) {
        case 'appointment':
          data = {
            type: 'appointment', salutation, empName, empCode,
            empAddress:        apt_empAddress.trim(),
            designation:       apt_designation.trim(),
            joiningDate:       apt_joiningDate.trim(),
            probationDuration: apt_probationDuration.trim(),
            probationEndDate:  apt_probationEndDate.trim(),
            ctcAnnual:         apt_ctcAnnual.trim(),
            ctcInWords:        apt_ctcInWords.trim(),
            salaryRows:        apt_salaryRows,
          } as AppointmentData;
          break;
        case 'confirmation':
          data = {
            type: 'confirmation', salutation, empName, empCode,
            designation:      con_designation.trim(),
            probationFrom:    con_probationFrom.trim(),
            probationTo:      con_probationTo.trim(),
            confirmationDate: con_confirmationDate.trim(),
            ...(con_newDesignation.trim() ? { newDesignation: con_newDesignation.trim() } : {}),
          } as ConfirmationData;
          break;
        case 'probation_extension':
          data = {
            type: 'probation_extension', salutation, empName, empCode,
            designation:          pex_designation.trim(),
            probationDuration:    pex_probationDuration.trim(),
            originalProbationEnd: pex_originalProbationEnd.trim(),
            extendedUntilDate:    pex_extendedUntilDate.trim(),
          } as ProbationExtensionData;
          break;
        case 'consultant_agreement':
          data = {
            type: 'consultant_agreement', salutation,
            consultantName:     manualName.trim(),
            consultantAddress:  cag_consultantAddress.trim(),
            role:               cag_role.trim(),
            scopeOfServices:    cag_scopeOfServices.trim(),
            startDate:          cag_startDate.trim(),
            endDate:            cag_endDate.trim(),
            termMonths:         cag_termMonths.trim(),
            feeAmount:          cag_feeAmount.trim(),
            feeInWords:         cag_feeInWords.trim(),
          } as ConsultantAgreementData;
          break;
        default:
          throw new Error('Unknown letter type');
      }

      // 1. Generate PDF bytes
      const bytes    = generateLetterPdf(data, seq);
      const filename = letterFilename(data, year, seq);

      // 2. Upload via server proxy (Admin SDK bypasses Storage rules)
      const idToken = await getAuth().currentUser?.getIdToken();
      if (!idToken) throw new Error('Not authenticated — please sign in again.');

      const base64Data = btoa(
        new Uint8Array(bytes).reduce((acc, byte) => acc + String.fromCharCode(byte), '')
      );

      const uploadRes = await fetch('/api/admin/hr-letters/upload', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body:    JSON.stringify({ employeeId: storageEmpId, filename, base64Data }),
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `Upload failed (${uploadRes.status})`);
      }
      const { downloadUrl } = await uploadRes.json() as { downloadUrl: string };

      // 3. Log to Firestore
      await addDoc(collection(db, 'generated_letters'), {
        letterType,
        employeeId:      storageEmpId,
        employeeName:    empName,
        refNumber:       refNum,
        generatedBy:     uid,
        generatedByName: profile?.displayName ?? uid,
        generatedAt:     serverTimestamp(),
        storageUrl:      downloadUrl,
        storageStatus:   'uploaded',
      });

      // 4. Open in new tab
      window.open(downloadUrl, '_blank');
      setSuccess(`${LETTER_TYPES.find((t) => t.value === letterType)?.label} generated and saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate letter. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const fe = fieldErrors;
  const I  = (f?: string) => inp(f, fe);
  const L  = (text: string, f?: string, req = false) => fLabel(text, fe, f, req);
  const refPreview = `FV/${TYPE_ABBREV[letterType]}/${new Date().getFullYear()}/${String(Number(seq) || 1).padStart(3, '0')}`;

  const isConsultant = letterType === 'consultant_agreement';

  return (
    <div className="max-w-4xl mx-auto space-y-8">

      {/* Header */}
      <div>
        <h2 className="text-3xl mb-1"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
          HR Letters
        </h2>
        <p className="text-sm" style={{ color: '#8B8B85' }}>
          Generate official Finvastra HR letters — stored in Firebase and available for employees to download.
        </p>
      </div>

      {/* Form */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">

        {/* Letter type grid */}
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

        {/* Common: employee selector / manual entry */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">

            {/* Toggle only for non-consultant types */}
            {!isConsultant && (
              <div className="flex items-center gap-2 mb-3">
                <button type="button"
                  onClick={() => { setManualMode(false); setFieldErrors({}); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{ backgroundColor: !manualMode ? '#0B1538' : '#F2EFE7', color: !manualMode ? '#C9A961' : '#8B8B85' }}>
                  <Users size={13} />Existing Employee
                </button>
                <button type="button"
                  onClick={() => { setManualMode(true); setFieldErrors({}); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{ backgroundColor: manualMode ? '#0B1538' : '#F2EFE7', color: manualMode ? '#C9A961' : '#8B8B85' }}>
                  <UserPlus size={13} />New / No Account
                </button>
              </div>
            )}

            {/* Consultant — always manual name entry */}
            {isConsultant && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Salutation */}
                <div>
                  {L('Salutation', undefined, true)}
                  <select className={I()} value={salutation} onChange={(e) => setSalutation(e.target.value as Salutation)}>
                    {SALUTATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  {L('Consultant Full Name', 'manualName', true)}
                  <input className={I('manualName')} placeholder="e.g. Priya Sharma"
                    value={manualName} onChange={(e) => { setManualName(e.target.value); setFieldErrors((p) => { const n={...p}; delete n.manualName; return n; }); }} />
                </div>
              </div>
            )}

            {/* Existing employee picker */}
            {!isConsultant && !manualMode && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  {L('Salutation', undefined, true)}
                  <select className={I()} value={salutation} onChange={(e) => setSalutation(e.target.value as Salutation)}>
                    {SALUTATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  {L('Employee', 'emp', true)}
                  <SearchableSelect
                    options={empOptions}
                    value={empId}
                    onChange={(v) => { setEmpId(v); setFieldErrors((p) => { const n={...p}; delete n.emp; return n; }); }}
                    placeholder="Search by name…"
                  />
                  {fe.emp && <p className="text-[11px] mt-0.5 text-red-500">{fe.emp}</p>}
                </div>
              </div>
            )}

            {/* Manual entry */}
            {!isConsultant && manualMode && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-xl border border-amber-200" style={{ backgroundColor: '#FFFBEB' }}>
                <p className="sm:col-span-3 text-xs font-semibold" style={{ color: '#92400E' }}>
                  ✏️ Enter details manually (for new joiners without a Pulse account)
                </p>
                <div>
                  {L('Salutation', undefined, true)}
                  <select className={I()} value={salutation} onChange={(e) => setSalutation(e.target.value as Salutation)}>
                    {SALUTATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  {L('Full Name', 'manualName', true)}
                  <input className={I('manualName')} placeholder="e.g. Priya Sharma"
                    value={manualName} onChange={(e) => { setManualName(e.target.value); setFieldErrors((p) => { const n={...p}; delete n.manualName; return n; }); }} />
                </div>
                <div>
                  {L('Employee Code', 'manualCode', true)}
                  <input className={I('manualCode')} placeholder="e.g. FAPL-025"
                    value={manualCode} onChange={(e) => { setManualCode(e.target.value); setFieldErrors((p) => { const n={...p}; delete n.manualCode; return n; }); }} />
                </div>
              </div>
            )}
          </div>

          {/* Sequence number */}
          <div>
            {L('Sequence Number', 'seq', true)}
            <input type="number" min="1" className={I('seq')} value={seq}
              onChange={(e) => { setSeq(e.target.value); setFieldErrors((p) => { const n={...p}; delete n.seq; return n; }); }} />
            <p className="text-[10px] mt-1" style={{ color: '#8B8B85' }}>Ref: {refPreview}</p>
          </div>
        </div>

        {/* ── Appointment fields ── */}
        {letterType === 'appointment' && (
          <div className="space-y-4 pt-2 border-t border-slate-100">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#475569' }}>Appointment Details</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                {L('Residential Address (for contract party description)', 'apt_empAddress', true)}
                <textarea className={`${baseTa} ${fe.apt_empAddress ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30' : 'border-slate-200 focus:ring-navy/10 focus:border-navy'}`}
                  rows={2} placeholder="e.g. 116, Gayatri Hills, Jubilee Hills, Hyderabad, Telangana - 500033"
                  value={apt_empAddress} onChange={(e) => setApt_empAddress(e.target.value)} />
              </div>
              <div>
                {L('Designation', 'apt_designation', true)}
                <input className={I('apt_designation')} value={apt_designation} onChange={(e) => setApt_designation(e.target.value)} />
              </div>
              <div>
                {L('Date of Joining (e.g. 17th November 2025)', 'apt_joiningDate', true)}
                <input className={I('apt_joiningDate')} placeholder="e.g. 17th November 2025"
                  value={apt_joiningDate} onChange={(e) => setApt_joiningDate(e.target.value)} />
              </div>
              <div>
                {L('Probation Duration (e.g. three (3) months)', 'apt_probationDuration', true)}
                <input className={I('apt_probationDuration')} placeholder="e.g. three (3) months"
                  value={apt_probationDuration} onChange={(e) => setApt_probationDuration(e.target.value)} />
              </div>
              <div>
                {L('Probation End Date (e.g. 17th February 2026)', 'apt_probationEndDate', true)}
                <input className={I('apt_probationEndDate')} placeholder="e.g. 17th February 2026"
                  value={apt_probationEndDate} onChange={(e) => setApt_probationEndDate(e.target.value)} />
              </div>
              <div>
                {L('Annual CTC (e.g. 8,40,000)', 'apt_ctcAnnual', true)}
                <input className={I('apt_ctcAnnual')} placeholder="e.g. 8,40,000"
                  value={apt_ctcAnnual} onChange={(e) => setApt_ctcAnnual(e.target.value)} />
              </div>
              <div>
                {L('CTC in Words (e.g. Eight Lakh Forty Thousand)', 'apt_ctcInWords', true)}
                <input className={I('apt_ctcInWords')} placeholder="e.g. Eight Lakh Forty Thousand"
                  value={apt_ctcInWords} onChange={(e) => setApt_ctcInWords(e.target.value)} />
              </div>
            </div>

            {/* Salary table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                {L('Salary Breakdown (Annexure I)', 'apt_salary', true)}
                <button type="button" onClick={addSalaryRow}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50">
                  <Plus size={11} /> Add Row
                </button>
              </div>
              {fe.apt_salary && <p className="text-xs text-red-500 mb-2">{fe.apt_salary}</p>}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ backgroundColor: '#0B1538' }}>
                      <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wider" style={{ color: '#C9A961', width: '35%' }}>Component</th>
                      <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wider" style={{ color: '#C9A961', width: '30%' }}>Description</th>
                      <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wider" style={{ color: '#C9A961', width: '17%' }}>Monthly (₹)</th>
                      <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-wider" style={{ color: '#C9A961', width: '14%' }}>Annual (₹)</th>
                      <th className="px-3 py-2" style={{ width: '4%' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {apt_salaryRows.map((row, idx) => {
                      const monthly = parseFloat(row.monthly.replace(/,/g, '')) || 0;
                      const annual  = (monthly * 12).toLocaleString('en-IN');
                      return (
                        <tr key={idx} className="border-t border-slate-100">
                          <td className="px-2 py-1.5">
                            <input className="w-full text-xs px-2 py-1 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-navy/10"
                              value={row.component} placeholder="e.g. Basic Salary"
                              onChange={(e) => updateSalaryRow(idx, 'component', e.target.value)} />
                          </td>
                          <td className="px-2 py-1.5">
                            <input className="w-full text-xs px-2 py-1 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-navy/10"
                              value={row.description} placeholder="e.g. Monthly Fixed"
                              onChange={(e) => updateSalaryRow(idx, 'description', e.target.value)} />
                          </td>
                          <td className="px-2 py-1.5">
                            <input className="w-full text-xs px-2 py-1 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-navy/10 text-right"
                              value={row.monthly} placeholder="35000"
                              onChange={(e) => updateSalaryRow(idx, 'monthly', e.target.value.replace(/[^0-9,]/g, ''))} />
                          </td>
                          <td className="px-3 py-1.5 text-right font-medium" style={{ color: '#475569' }}>
                            {monthly > 0 ? annual : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <button type="button" onClick={() => removeSalaryRow(idx)}
                              className="text-slate-300 hover:text-red-400 transition-colors">
                              <Minus size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {/* Totals row */}
                    <tr className="border-t-2 border-slate-300" style={{ backgroundColor: '#F5EDD8' }}>
                      <td className="px-3 py-2 text-xs font-bold" style={{ color: '#0B1538' }} colSpan={2}>TOTAL COST TO COMPANY (CTC)</td>
                      <td className="px-3 py-2 text-xs font-bold text-right" style={{ color: '#0B1538' }}>
                        {totalMonthly > 0 ? totalMonthly.toLocaleString('en-IN') : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs font-bold text-right" style={{ color: '#0B1538' }}>
                        {totalMonthly > 0 ? (totalMonthly * 12).toLocaleString('en-IN') : '—'}
                      </td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Confirmation fields ── */}
        {letterType === 'confirmation' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>
              {L('Designation', 'con_designation', true)}
              <input className={I('con_designation')} value={con_designation} onChange={(e) => setCon_designation(e.target.value)} />
            </div>
            <div>
              {L('Confirmation Date (e.g. 01st January 2026)', 'con_confirmationDate', true)}
              <input className={I('con_confirmationDate')} placeholder="e.g. 01st January 2026"
                value={con_confirmationDate} onChange={(e) => setCon_confirmationDate(e.target.value)} />
            </div>
            <div>
              {L('Probation Period From (e.g. 01st October 2025)', 'con_probationFrom', true)}
              <input className={I('con_probationFrom')} placeholder="e.g. 01st October 2025"
                value={con_probationFrom} onChange={(e) => setCon_probationFrom(e.target.value)} />
            </div>
            <div>
              {L('Probation Period To (e.g. 01st January 2026)', 'con_probationTo', true)}
              <input className={I('con_probationTo')} placeholder="e.g. 01st January 2026"
                value={con_probationTo} onChange={(e) => setCon_probationTo(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              {L('New Designation (only if changed during confirmation)')}
              <input className={I()} placeholder="Leave blank if unchanged"
                value={con_newDesignation} onChange={(e) => setCon_newDesignation(e.target.value)} />
            </div>
          </div>
        )}

        {/* ── Probation Extension fields ── */}
        {letterType === 'probation_extension' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>
              {L('Designation', 'pex_designation', true)}
              <input className={I('pex_designation')} value={pex_designation} onChange={(e) => setPex_designation(e.target.value)} />
            </div>
            <div>
              {L('Probation Duration (e.g. 3 months)', 'pex_probationDuration', true)}
              <input className={I('pex_probationDuration')} placeholder="e.g. 3 months"
                value={pex_probationDuration} onChange={(e) => setPex_probationDuration(e.target.value)} />
            </div>
            <div>
              {L('Original Probation End Date (e.g. 17th February 2026)', 'pex_originalProbationEnd', true)}
              <input className={I('pex_originalProbationEnd')} placeholder="e.g. 17th February 2026"
                value={pex_originalProbationEnd} onChange={(e) => setPex_originalProbationEnd(e.target.value)} />
            </div>
            <div>
              {L('Extended Until Date (e.g. 17th May 2026)', 'pex_extendedUntilDate', true)}
              <input className={I('pex_extendedUntilDate')} placeholder="e.g. 17th May 2026"
                value={pex_extendedUntilDate} onChange={(e) => setPex_extendedUntilDate(e.target.value)} />
            </div>
          </div>
        )}

        {/* ── Consultant Agreement fields ── */}
        {letterType === 'consultant_agreement' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div className="sm:col-span-2">
              {L('Residential Address (for contract party description)', 'cag_consultantAddress', true)}
              <textarea className={`${baseTa} ${fe.cag_consultantAddress ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30' : 'border-slate-200 focus:ring-navy/10 focus:border-navy'}`}
                rows={2} placeholder="e.g. 42, Banjara Hills Road No. 12, Hyderabad, Telangana - 500034"
                value={cag_consultantAddress} onChange={(e) => setCag_consultantAddress(e.target.value)} />
            </div>
            <div>
              {L('Role / Position (e.g. Consultant - Digital Marketing)', 'cag_role', true)}
              <input className={I('cag_role')} placeholder="e.g. Consultant - Digital Marketing"
                value={cag_role} onChange={(e) => setCag_role(e.target.value)} />
            </div>
            <div>
              {L('Agreement Term (e.g. one (1) month)', 'cag_termMonths', true)}
              <input className={I('cag_termMonths')} placeholder="e.g. one (1) month"
                value={cag_termMonths} onChange={(e) => setCag_termMonths(e.target.value)} />
            </div>
            <div>
              {L('Start Date (e.g. 02nd January 2026)', 'cag_startDate', true)}
              <input className={I('cag_startDate')} placeholder="e.g. 02nd January 2026"
                value={cag_startDate} onChange={(e) => setCag_startDate(e.target.value)} />
            </div>
            <div>
              {L('End Date (e.g. 31st January 2026)', 'cag_endDate', true)}
              <input className={I('cag_endDate')} placeholder="e.g. 31st January 2026"
                value={cag_endDate} onChange={(e) => setCag_endDate(e.target.value)} />
            </div>
            <div>
              {L('Monthly Fee Amount (e.g. 10,000)', 'cag_feeAmount', true)}
              <input className={I('cag_feeAmount')} placeholder="e.g. 10,000"
                value={cag_feeAmount} onChange={(e) => setCag_feeAmount(e.target.value)} />
            </div>
            <div>
              {L('Fee in Words (e.g. Ten Thousand)', 'cag_feeInWords', true)}
              <input className={I('cag_feeInWords')} placeholder="e.g. Ten Thousand"
                value={cag_feeInWords} onChange={(e) => setCag_feeInWords(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              {L('Scope of Services', 'cag_scopeOfServices', true)}
              <textarea className={`${baseTa} ${fe.cag_scopeOfServices ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30' : 'border-slate-200 focus:ring-navy/10 focus:border-navy'}`}
                rows={4} placeholder="Describe the services to be provided — shooting and editing visual content, developing creative concepts, etc."
                value={cag_scopeOfServices} onChange={(e) => setCag_scopeOfServices(e.target.value)} />
            </div>

            {/* Notice about Aadhaar */}
            <div className="sm:col-span-2 px-4 py-3 rounded-xl border border-amber-200" style={{ backgroundColor: '#FFFBEB' }}>
              <p className="text-xs font-semibold mb-1" style={{ color: '#92400E' }}>📋 Aadhaar field</p>
              <p className="text-xs" style={{ color: '#92400E' }}>
                The agreement will show a blank line (<em>___________________________</em>) in the party description
                where the Aadhaar number goes. Please fill this in manually on the printed / signed copy to comply
                with UIDAI guidelines.
              </p>
            </div>
          </div>
        )}

        {/* Aadhaar notice for appointment letter */}
        {letterType === 'appointment' && (
          <div className="px-4 py-3 rounded-xl border border-amber-200" style={{ backgroundColor: '#FFFBEB' }}>
            <p className="text-xs font-semibold mb-1" style={{ color: '#92400E' }}>📋 Aadhaar field</p>
            <p className="text-xs" style={{ color: '#92400E' }}>
              The accord will show a blank line (<em>___________________________</em>) in the party description.
              Please fill the Aadhaar number manually on the printed / signed copy to comply with UIDAI guidelines.
            </p>
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

// ─── Letter row ───────────────────────────────────────────────────────────────

function LetterRow({ letter: l }: { letter: GeneratedLetter }) {
  const d         = l.generatedAt?.toDate?.();
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
            <Download size={12} /> PDF
          </button>
        ) : (
          <span className="text-xs" style={{ color: '#8B8B85' }}>—</span>
        )}
      </td>
    </tr>
  );
}
