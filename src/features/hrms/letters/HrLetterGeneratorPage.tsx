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
import { format, addMonths, parse } from 'date-fns';
import {
  FileText, Download, CheckCircle2, AlertCircle, Loader2, UserPlus, Users, Plus, Minus, Sparkles,
} from 'lucide-react';
import { collection, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { amountInWordsWithOnly } from '../../../lib/numberToWords';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { DEPARTMENTS } from '../../../config/hrmsConfig';
import { db } from '../../../lib/firebase';
import { useAllLetters } from '../hooks/useGeneratedLetters';
import {
  generateLetterPdf, letterFilename, letterRefNumber, TYPE_ABBREV,
  type LetterType, type LetterData, type Salutation, type SalaryRow,
  type OfferLetterData, type AppointmentData, type ConfirmationData,
  type ProbationExtensionData, type ConsultantAgreementData,
} from './letterPdf';
import { PageHeader } from '../../../components/ui/primitives';
import {
  LETTER_TYPES, SALARY_COMPONENTS, SALUTATIONS, DEFAULT_SALARY_ROWS,
  inp, baseTa, fLabel, LetterRow, type EmpDetails, type EmpSalary,
} from './letterFormBits';

// ─── Letter type catalogue ────────────────────────────────────────────────────

// ─── HrLetterGeneratorPage ────────────────────────────────────────────────────

/**
 * Thin access gate. It exists so the heavy body below can call its ~60 hooks
 * UNCONDITIONALLY: the guard used to sit above them, so a guarded render
 * skipped every one of them and changed the hook count between renders
 * (React #310 — the crash class that took down the case page on 2026-06-18).
 * Splitting also means an unauthorised user never mounts the body, so its
 * Firestore subscriptions never start — same behaviour as the old early return.
 */
export function HrLetterGeneratorPage() {
  const { profile } = useAuth();
  const isAdmin       = profile?.role === 'admin';
  const isHrmsManager = profile?.isHrmsManager === true;
  if (!isAdmin && !isHrmsManager) return <Navigate to="/hrms/dashboard" replace />;
  return <HrLetterGeneratorContent />;
}

function HrLetterGeneratorContent() {
  const { user, profile } = useAuth();
  const uid           = user?.uid ?? '';

  const { employees }                   = useAllEmployees();
  const { letters, loading: llLoading } = useAllLetters();

  const activeEmployees = useMemo(
    () => employees.filter((e) => !e.employeeStatus || e.employeeStatus === 'active'),
    [employees],
  );
  const empOptions = activeEmployees.map((e) => ({ value: e.userId, label: e.displayName }));

  // ── Employee selection ──────────────────────────────────────────────────────
  const [manualMode, setManualMode] = useState(false);
  const [manualName,   setManualName]   = useState('');
  const [manualPrefix, setManualPrefix] = useState<'FAPL'|'HK'|'CON'>('FAPL');
  const [manualNumber, setManualNumber] = useState('');

  const manualCode = (() => {
    const n = manualNumber.trim();
    if (!n || isNaN(Number(n))) return '';
    return `${manualPrefix}-${String(parseInt(n, 10)).padStart(3, '0')}`;
  })();

  // ── Common ─────────────────────────────────────────────────────────────────
  const [letterType, setLetterType] = useState<LetterType>('appointment');
  const [empId,      setEmpId]      = useState('');
  const [seq,        setSeq]        = useState('1');
  const [salutation, setSalutation] = useState<Salutation>('Mr.');

  // ── Offer Letter ───────────────────────────────────────────────────────────
  const [ofl_careOf,           setOfl_careOf]           = useState('');
  const [ofl_designation,      setOfl_designation]      = useState('');
  const [ofl_department,       setOfl_department]       = useState('');
  const [ofl_ctcAnnual,        setOfl_ctcAnnual]        = useState('');
  const [ofl_ctcInWords,       setOfl_ctcInWords]       = useState('');
  const [ofl_joiningDate,      setOfl_joiningDate]      = useState('');      // YYYY-MM-DD
  const [ofl_joiningDateFmt,   setOfl_joiningDateFmt]   = useState('');      // "3rd May 2026"
  const [ofl_probationMonths,  setOfl_probationMonths]  = useState('3');
  const [ofl_probationEndDate, setOfl_probationEndDate] = useState('');      // auto-computed
  const [ofl_reportingTo,      setOfl_reportingTo]      = useState('');

  // ── Appointment ────────────────────────────────────────────────────────────
  const [apt_careOf,           setApt_careOf]           = useState('');
  const [apt_empAddress,       setApt_empAddress]       = useState('');
  const [apt_designation,      setApt_designation]      = useState('');
  const [apt_joiningDate,      setApt_joiningDate]      = useState('');      // YYYY-MM-DD
  const [apt_joiningDateFmt,   setApt_joiningDateFmt]   = useState('');      // "17th November 2025"
  const [apt_probationMonths,  setApt_probationMonths]  = useState('3');
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

  // Admin-only detail + salary docs for the selected employee (address, gender,
  // salary components). Fetched once per selection so the letter fields prefill
  // straight from the employee master — nothing has to be re-typed per letter.
  const [empDetails,     setEmpDetails]     = useState<EmpDetails | null>(null);
  const [empSalary,      setEmpSalary]      = useState<EmpSalary | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(false);

  useEffect(() => {
    if (!empId || manualMode) { setEmpDetails(null); setEmpSalary(null); return; }
    let cancelled = false;
    setPrefillLoading(true);
    (async () => {
      try {
        const [dSnap, sSnap] = await Promise.all([
          getDoc(doc(db, 'user_details', empId)),
          getDoc(doc(db, 'employee_sensitive', empId)),
        ]);
        if (cancelled) return;
        setEmpDetails(dSnap.exists() ? (dSnap.data() as EmpDetails) : null);
        setEmpSalary(sSnap.exists() ? (sSnap.data() as EmpSalary) : null);
      } catch {
        if (!cancelled) { setEmpDetails(null); setEmpSalary(null); }
      } finally {
        if (!cancelled) setPrefillLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [empId, manualMode]);

  // Auto-fill the letter fields from the selected employee's master record
  // (users + user_details + employee_sensitive) when the employee, letter type,
  // or freshly-fetched detail/salary docs change. Every field stays editable for
  // a one-off override; a permanent correction is made in the employee's profile.
  // Only prefills a field when the master actually has a value, so a manual entry
  // is never blanked out by missing master data.
  useEffect(() => {
    if (!selectedEmp) return;
    const { designation = '', department = '', joiningDate = '' } = selectedEmp;
    const rawDate = joiningDate || '';
    const address = (empDetails?.presentAddress || empDetails?.permanentAddress || '').trim();

    // Salutation from gender (Male → Mr., Female → Ms.)
    if (empDetails?.gender === 'Male')        setSalutation('Mr.');
    else if (empDetails?.gender === 'Female') setSalutation('Ms.');

    // Monthly salary components → annual CTC + Annexure salary breakdown rows
    const s = empSalary;
    const monthlyGross = s?.grossSalary
      ?? [s?.salaryBasic, s?.salaryHra, s?.salaryConveyance, s?.salaryMedical, s?.salaryOther]
           .reduce((sum: number, v) => sum + (Number(v) || 0), 0);
    const annualCtcStr = monthlyGross ? Math.round(monthlyGross * 12).toLocaleString('en-IN') : '';
    const salaryRows: SalaryRow[] = [];
    const pushRow = (component: string, val?: number, description = '') => {
      if (val && val > 0) salaryRows.push({ component, description, monthly: String(val) });
    };
    pushRow('Basic Salary',              s?.salaryBasic, 'Monthly Fixed');
    pushRow('House Rent Allowance (HRA)', s?.salaryHra);
    pushRow('Conveyance Allowance',       s?.salaryConveyance);
    pushRow('Medical Allowance',          s?.salaryMedical);
    pushRow('Other Allowance',            s?.salaryOther);

    switch (letterType) {
      case 'offer_letter':
        setOfl_designation(designation);
        setOfl_department(department);
        if (annualCtcStr) setOfl_ctcAnnual(annualCtcStr);
        break;
      case 'appointment':
        setApt_designation(designation);
        if (rawDate)           setApt_joiningDate(rawDate);
        if (address)           setApt_empAddress(address);
        if (annualCtcStr)      setApt_ctcAnnual(annualCtcStr);
        if (salaryRows.length) setApt_salaryRows(salaryRows);
        break;
      case 'confirmation':
        setCon_designation(designation);
        break;
      case 'probation_extension':
        setPex_designation(designation);
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId, letterType, empDetails, empSalary]);

  // Auto-format appointment joining date and compute probation end date
  useEffect(() => {
    if (!apt_joiningDate) { setApt_joiningDateFmt(''); setApt_probationEndDate(''); return; }
    try {
      const d = parse(apt_joiningDate, 'yyyy-MM-dd', new Date());
      setApt_joiningDateFmt(format(d, "do MMMM yyyy"));
      const months = parseInt(apt_probationMonths) || 3;
      setApt_probationEndDate(format(addMonths(d, months), "do MMMM yyyy"));
    } catch {
      setApt_joiningDateFmt('');
      setApt_probationEndDate('');
    }
  }, [apt_joiningDate, apt_probationMonths]);

  // Auto-format offer letter joining date and compute probation end date
  useEffect(() => {
    if (!ofl_joiningDate) { setOfl_joiningDateFmt(''); setOfl_probationEndDate(''); return; }
    try {
      const d = parse(ofl_joiningDate, 'yyyy-MM-dd', new Date());
      setOfl_joiningDateFmt(format(d, "do MMMM yyyy"));
      const months = parseInt(ofl_probationMonths) || 3;
      setOfl_probationEndDate(format(addMonths(d, months), "do MMMM yyyy"));
    } catch {
      setOfl_joiningDateFmt('');
      setOfl_probationEndDate('');
    }
  }, [ofl_joiningDate, ofl_probationMonths]);

  // Auto-populate CTC in words for appointment letter
  useEffect(() => {
    const raw = parseFloat(apt_ctcAnnual.replace(/,/g, ''));
    setApt_ctcInWords(raw > 0 ? amountInWordsWithOnly(raw) : '');
  }, [apt_ctcAnnual]);

  // Auto-populate CTC in words for offer letter
  useEffect(() => {
    const raw = parseFloat(ofl_ctcAnnual.replace(/,/g, ''));
    setOfl_ctcInWords(raw > 0 ? amountInWordsWithOnly(raw) : '');
  }, [ofl_ctcAnnual]);

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
      if (!manualNumber.trim() || isNaN(Number(manualNumber))) errs.manualCode = 'Enter a valid number';
    } else {
      if (letterType !== 'consultant_agreement' && !empId) errs.emp = 'Select an employee';
    }
    if (!seq.trim() || isNaN(Number(seq))) errs.seq = 'Enter a valid sequence number';

    switch (letterType) {
      case 'offer_letter':
        if (!ofl_designation.trim())   errs.ofl_designation   = 'Required';
        if (!ofl_department.trim())    errs.ofl_department    = 'Required';
        if (!ofl_ctcAnnual.trim())     errs.ofl_ctcAnnual     = 'Required';
        if (!ofl_joiningDate.trim())   errs.ofl_joiningDate   = 'Required';
        if (!ofl_reportingTo.trim())   errs.ofl_reportingTo   = 'Required';
        if (!ofl_probationEndDate)     errs.ofl_probationMonths = 'Enter valid joining date first';
        break;
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
        case 'offer_letter': {
          const reportingToName = activeEmployees.find((e) => e.userId === ofl_reportingTo)?.displayName
            ?? ofl_reportingTo.trim();
          data = {
            type: 'offer_letter', salutation, empName, empCode,
            ...(ofl_careOf.trim() ? { careof: ofl_careOf.trim() } : {}),
            designation:      ofl_designation.trim(),
            department:       ofl_department.trim(),
            ctcAnnual:        ofl_ctcAnnual.trim(),
            joiningDate:      ofl_joiningDateFmt || ofl_joiningDate,
            probationPeriod:  `${ofl_probationMonths} months`,
            probationEndDate: ofl_probationEndDate,
            reportingTo:      reportingToName,
          } as OfferLetterData;
          break;
        }
        case 'appointment':
          data = {
            type: 'appointment', salutation, empName, empCode,
            ...(apt_careOf.trim() ? { careof: apt_careOf.trim() } : {}),
            empAddress:        apt_empAddress.trim(),
            designation:       apt_designation.trim(),
            joiningDate:       apt_joiningDateFmt || apt_joiningDate,
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
      <PageHeader
        title="HR Letters"
        subtitle="Generate official Finvastra HR letters — stored in Firebase and available for employees to download."
        pinKey="hrms.letters"
      />

      {/* Form */}
      <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-6 space-y-5">

        {/* Letter type grid */}
        <div>
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
            Letter Type
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {LETTER_TYPES.map(({ value, label: lbl, desc }) => (
              <button
                key={value}
                onClick={() => { setLetterType(value); setSuccess(''); setError(''); setFieldErrors({}); }}
                className={`p-3 rounded-xl border text-left transition-all ${
                  letterType === value ? 'border-navy bg-navy/5' : 'border-(--shell-border) hover:border-(--shell-border-mid)'
                }`}
              >
                <p className={`text-xs font-semibold ${letterType === value ? 'text-navy' : 'text-(--text-primary)'}`}>{lbl}</p>
                <p className="text-[10px] mt-0.5 leading-tight" style={{ color: 'var(--text-muted)' }}>{desc}</p>
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
                  style={{ backgroundColor: !manualMode ? '#0B1538' : 'var(--shell-hover-hard)', color: !manualMode ? '#C9A961' : 'var(--text-muted)' }}>
                  <Users size={13} />Existing Employee
                </button>
                <button type="button"
                  onClick={() => { setManualMode(true); setFieldErrors({}); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{ backgroundColor: manualMode ? '#0B1538' : 'var(--shell-hover-hard)', color: manualMode ? '#C9A961' : 'var(--text-muted)' }}>
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
                  <div className="flex items-center gap-2">
                    <select className={`${I()} flex-none`} style={{ width: 100 }}
                      value={manualPrefix}
                      onChange={(e) => { setManualPrefix(e.target.value as 'FAPL'|'HK'|'CON'); setFieldErrors((p) => { const n={...p}; delete n.manualCode; return n; }); }}>
                      <option value="FAPL">FAPL</option>
                      <option value="HK">HK</option>
                      <option value="CON">CON</option>
                    </select>
                    <span className="text-(--text-muted) font-mono text-sm shrink-0">—</span>
                    <input type="number" min={1} className={`${I('manualCode')} flex-none`} style={{ width: 80 }}
                      placeholder="001"
                      value={manualNumber}
                      onChange={(e) => { setManualNumber(e.target.value); setFieldErrors((p) => { const n={...p}; delete n.manualCode; return n; }); }} />
                    {manualCode && (
                      <span className="text-sm font-mono font-semibold px-2.5 py-2 rounded-lg shrink-0"
                        style={{ backgroundColor: 'rgba(201,169,97,0.10)', color: '#9A7E3F' }}>
                        {manualCode}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sequence number */}
          <div>
            {L('Sequence Number', 'seq', true)}
            <input type="number" min="1" className={I('seq')} value={seq}
              onChange={(e) => { setSeq(e.target.value); setFieldErrors((p) => { const n={...p}; delete n.seq; return n; }); }} />
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Ref: {refPreview}</p>
          </div>
        </div>

        {/* Prefill note — details are pulled from the employee master */}
        {!isConsultant && !manualMode && selectedEmp && (
          <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl text-xs"
            style={{ backgroundColor: 'rgba(201,169,97,0.08)', border: '1px solid rgba(201,169,97,0.25)' }}>
            <Sparkles size={14} style={{ color: '#9A7E3F', marginTop: 1, flexShrink: 0 }} />
            <div style={{ color: 'var(--text-secondary)' }}>
              {prefillLoading ? (
                <>Loading {selectedEmp.displayName}'s details…</>
              ) : (() => {
                const miss: string[] = [];
                if (!(empDetails?.presentAddress || empDetails?.permanentAddress)) miss.push('address');
                if (!empSalary?.grossSalary && !empSalary?.salaryBasic)            miss.push('salary / CTC');
                return (
                  <>
                    Auto-filled from <strong>{selectedEmp.displayName}</strong>'s employee record
                    {miss.length ? (
                      <> — <span style={{ color: '#B45309' }}>
                        {miss.join(' & ')} not on file yet. Add it in the employee's profile so it prefills here next time.
                      </span></>
                    ) : (
                      <>. To correct any detail permanently, edit the employee's profile — no need to re-type it here.</>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── Offer Letter fields ── */}
        {letterType === 'offer_letter' && (
          <div className="space-y-4 pt-2 border-t border-(--shell-border)">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Offer Details</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                {L('C/O (Care Of — optional, appears in address block)')}
                <input className={I()} placeholder="e.g. Ramesh Kumar (parent / guardian name)"
                  value={ofl_careOf} onChange={(e) => setOfl_careOf(e.target.value)} />
              </div>
              <div>
                {L('Designation', 'ofl_designation', true)}
                <input className={I('ofl_designation')} placeholder="Auto-filled from employee"
                  value={ofl_designation}
                  onChange={(e) => { setOfl_designation(e.target.value); setFieldErrors((p) => { const n={...p}; delete n.ofl_designation; return n; }); }} />
              </div>
              <div>
                {L('Department', 'ofl_department', true)}
                <select className={I('ofl_department')}
                  value={ofl_department}
                  onChange={(e) => { setOfl_department(e.target.value); setFieldErrors((p) => { const n={...p}; delete n.ofl_department; return n; }); }}>
                  <option value="">— Select department —</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                {L('Annual CTC (e.g. 18,00,000)', 'ofl_ctcAnnual', true)}
                <input className={I('ofl_ctcAnnual')} placeholder="e.g. 18,00,000"
                  value={ofl_ctcAnnual}
                  onChange={(e) => { setOfl_ctcAnnual(e.target.value); setFieldErrors((p) => { const n={...p}; delete n.ofl_ctcAnnual; return n; }); }} />
                {ofl_ctcInWords && (
                  <p className="text-[10px] mt-1" style={{ color: '#059669' }}>{ofl_ctcInWords}</p>
                )}
              </div>
              <div>
                {L('Joining Deadline (date picker)', 'ofl_joiningDate', true)}
                <input type="date" className={I('ofl_joiningDate')}
                  value={ofl_joiningDate}
                  onChange={(e) => { setOfl_joiningDate(e.target.value); setFieldErrors((p) => { const n={...p}; delete n.ofl_joiningDate; return n; }); }} />
                {ofl_joiningDateFmt && (
                  <p className="text-[10px] mt-1" style={{ color: '#059669' }}>{ofl_joiningDateFmt}</p>
                )}
              </div>
              <div>
                {L('Probation Period (months)', 'ofl_probationMonths', false)}
                <input type="number" min="1" max="24" className={I('ofl_probationMonths')}
                  placeholder="3"
                  value={ofl_probationMonths}
                  onChange={(e) => setOfl_probationMonths(e.target.value)} />
                {ofl_probationEndDate && (
                  <p className="text-[10px] mt-1" style={{ color: '#059669' }}>Ends: {ofl_probationEndDate}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                {L('Reporting To', 'ofl_reportingTo', true)}
                <SearchableSelect
                  options={empOptions}
                  value={ofl_reportingTo}
                  onChange={(v) => { setOfl_reportingTo(v); setFieldErrors((p) => { const n={...p}; delete n.ofl_reportingTo; return n; }); }}
                  placeholder="Search by name…"
                />
                {fe.ofl_reportingTo && <p className="text-[11px] mt-0.5 text-red-500">{fe.ofl_reportingTo}</p>}
              </div>
            </div>
          </div>
        )}

        {/* ── Appointment fields ── */}
        {letterType === 'appointment' && (
          <div className="space-y-4 pt-2 border-t border-(--shell-border)">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Appointment Details</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                {L('Residential Address (for contract party description)', 'apt_empAddress', true)}
                <textarea className={`${baseTa} ${fe.apt_empAddress ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30' : 'border-(--shell-border) focus:ring-navy/10 focus:border-navy'}`}
                  rows={2} placeholder="e.g. 116, Gayatri Hills, Jubilee Hills, Hyderabad, Telangana - 500033"
                  value={apt_empAddress} onChange={(e) => setApt_empAddress(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                {L('C/O (Care Of — optional, appears before address in contract)')}
                <input className={I()} placeholder="e.g. Ramesh Kumar (parent / guardian name)"
                  value={apt_careOf} onChange={(e) => setApt_careOf(e.target.value)} />
              </div>
              <div>
                {L('Designation', 'apt_designation', true)}
                <input className={I('apt_designation')} value={apt_designation} onChange={(e) => setApt_designation(e.target.value)} />
              </div>
              <div>
                {L('Date of Joining', 'apt_joiningDate', true)}
                <input type="date" className={I('apt_joiningDate')}
                  value={apt_joiningDate}
                  onChange={(e) => { setApt_joiningDate(e.target.value); setFieldErrors((p) => { const n={...p}; delete n.apt_joiningDate; return n; }); }} />
                {apt_joiningDateFmt && (
                  <p className="text-[10px] mt-1" style={{ color: '#059669' }}>{apt_joiningDateFmt}</p>
                )}
              </div>
              <div>
                {L('Probation Duration (months)', 'apt_probationMonths', false)}
                <input type="number" min="1" max="24" className={I('apt_probationMonths')}
                  placeholder="3"
                  value={apt_probationMonths}
                  onChange={(e) => setApt_probationMonths(e.target.value)} />
                {apt_probationEndDate && (
                  <p className="text-[10px] mt-1" style={{ color: '#059669' }}>Ends: {apt_probationEndDate}</p>
                )}
              </div>
              <div>
                {L('Probation Duration (in words, for contract)', 'apt_probationDuration', true)}
                <input className={I('apt_probationDuration')} placeholder="e.g. three (3) months"
                  value={apt_probationDuration} onChange={(e) => setApt_probationDuration(e.target.value)} />
              </div>
              <div>
                {L('Annual CTC (e.g. 8,40,000)', 'apt_ctcAnnual', true)}
                <input className={I('apt_ctcAnnual')} placeholder="e.g. 8,40,000"
                  value={apt_ctcAnnual} onChange={(e) => { setApt_ctcAnnual(e.target.value); setFieldErrors((p) => { const n={...p}; delete n.apt_ctcAnnual; return n; }); }} />
              </div>
              <div>
                {L('CTC in Words (auto-filled)', 'apt_ctcInWords', true)}
                <input className={I('apt_ctcInWords')} placeholder="Auto-fills when you enter CTC above"
                  value={apt_ctcInWords} onChange={(e) => setApt_ctcInWords(e.target.value)} />
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Auto-calculated — edit if needed</p>
              </div>
            </div>

            {/* Salary table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                {L('Salary Breakdown (Annexure I)', 'apt_salary', true)}
                <button type="button" onClick={addSalaryRow}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-(--shell-border) hover:bg-(--glass-panel-bg)">
                  <Plus size={11} /> Add Row
                </button>
              </div>
              {fe.apt_salary && <p className="text-xs text-red-500 mb-2">{fe.apt_salary}</p>}
              <div className="rounded-xl border border-(--shell-border) overflow-hidden">
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
                        <tr key={idx} className="border-t border-(--shell-border)">
                          <td className="px-2 py-1.5">
                            <select className="w-full text-xs px-2 py-1 border border-(--shell-border) rounded-lg outline-none focus:ring-2 focus:ring-navy/10 bg-(--glass-panel-bg)"
                              value={row.component}
                              onChange={(e) => updateSalaryRow(idx, 'component', e.target.value)}>
                              <option value="">— Select component —</option>
                              {SALARY_COMPONENTS.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <input className="w-full text-xs px-2 py-1 border border-(--shell-border) rounded-lg outline-none focus:ring-2 focus:ring-navy/10"
                              value={row.description} placeholder="e.g. Monthly Fixed"
                              onChange={(e) => updateSalaryRow(idx, 'description', e.target.value)} />
                          </td>
                          <td className="px-2 py-1.5">
                            <input className="w-full text-xs px-2 py-1 border border-(--shell-border) rounded-lg outline-none focus:ring-2 focus:ring-navy/10 text-right"
                              value={row.monthly} placeholder="35000"
                              onChange={(e) => updateSalaryRow(idx, 'monthly', e.target.value.replace(/[^0-9,]/g, ''))} />
                          </td>
                          <td className="px-3 py-1.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>
                            {monthly > 0 ? annual : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <button type="button" onClick={() => removeSalaryRow(idx)}
                              className="text-(--text-muted) hover:text-red-400 transition-colors">
                              <Minus size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {/* Totals row */}
                    <tr className="border-t-2 border-(--shell-border-mid)" style={{ backgroundColor: '#F5EDD8' }}>
                      <td className="px-3 py-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }} colSpan={2}>TOTAL COST TO COMPANY (CTC)</td>
                      <td className="px-3 py-2 text-xs font-bold text-right" style={{ color: 'var(--text-primary)' }}>
                        {totalMonthly > 0 ? totalMonthly.toLocaleString('en-IN') : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs font-bold text-right" style={{ color: 'var(--text-primary)' }}>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-(--shell-border)">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-(--shell-border)">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-(--shell-border)">
            <div className="sm:col-span-2">
              {L('Residential Address (for contract party description)', 'cag_consultantAddress', true)}
              <textarea className={`${baseTa} ${fe.cag_consultantAddress ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30' : 'border-(--shell-border) focus:ring-navy/10 focus:border-navy'}`}
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
              <textarea className={`${baseTa} ${fe.cag_scopeOfServices ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30' : 'border-(--shell-border) focus:ring-navy/10 focus:border-navy'}`}
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
        <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Recently Generated Letters
        </h3>
        <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl overflow-hidden">
          {llLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-(--glass-panel-bg) rounded-lg animate-pulse" />)}
            </div>
          ) : letters.length === 0 ? (
            <div className="py-10 text-center">
              <FileText size={32} className="mx-auto mb-3 text-(--text-dim)" />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No letters generated yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--shell-border)">
                    {['Employee', 'Letter Type', 'Ref #', 'Generated By', 'Date', ''].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{h}</th>
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

