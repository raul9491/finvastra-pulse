import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowLeft, ChevronRight, TrendingDown, MessageSquare,
  Briefcase, TrendingUp, ShieldCheck, ChevronDown, ChevronUp,
  CheckCircle2, Circle, Plus, X,
} from 'lucide-react';
import { doc, updateDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useLead } from '../hooks/useLeads';
import { useOpportunity, useActivities, useOpportunityTypes, updateOpportunityStage, markOpportunityLost, addNote } from '../hooks/useOpportunities';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { BankSubmissionsSection } from './loans/BankSubmissionsSection';
import { BankEligibilityCard } from './BankEligibilityCard';
import { WealthInvestmentsSection } from './wealth/WealthInvestmentsSection';
import { InsurancePoliciesSection } from './insurance/InsurancePoliciesSection';
import { CrmDocumentVault } from './CrmDocumentVault';
import type { OpportunityType, ActivityType, LostReason, LostDetails, Opportunity } from '../../../types';
import { LOST_REASON_LABELS } from '../../../types';

// ─── Stage data interfaces (file-private) ────────────────────────────────────

interface ContactedData {
  contactType: 'call' | 'whatsapp' | 'email' | 'meeting';
  contactDate: string;
  contactedByName: string;
  notes: string;
}
interface DocItem {
  name: string;
  collected: boolean;
  receivedVia: '' | 'whatsapp' | 'email' | 'physical' | 'portal';
}
interface DocumentsData {
  documents: DocItem[];
  notes: string;
}
interface SubmittedData {
  bankName: string; applicationNo: string; submittedDate: string;
  smName: string; smEmail: string; smPhone: string;
  asmName: string; asmEmail: string; asmPhone: string;
  notes: string;
}
interface SanctionedData {
  sanctionedAmount: string; sanctionDate: string;
  sanctionLetterNo: string; interestRate: string;
  tenureMonths: string; notes: string;
}
interface DisbursedData {
  applicationNo: string; loanNo: string; customerCompanyName: string;
  disbursalDate: string; disbursedAmount: string; cityState: string;
  smEmail: string; smPhone: string; asmEmail: string; asmPhone: string;
  dsaName: string; dsaCode: string; notes: string;
}
type AnyStageData = ContactedData | DocumentsData | SubmittedData | SanctionedData | DisbursedData | { notes: string };

type OpportunityWithStageData = Opportunity & { stageData?: Record<string, AnyStageData> };

// ─── Default document lists ───────────────────────────────────────────────────

const LOAN_DOCS = [
  'PAN Card', 'Aadhaar Card', 'Passport Photo',
  'Last 3 Months Salary Slips', 'Last 6 Months Bank Statement',
  'Form 16 / Latest ITR', 'Employment Letter / Appointment Letter',
  'Address Proof (Utility Bill / Rental Agreement)',
];
const PRODUCT_EXTRA_DOCS: Record<string, string[]> = {
  'Home Loan':                  ['Sale Agreement / Title Deed', 'Approved Building Plan', 'OC / CC Certificate'],
  'LAP':                        ['Property Title Deed', 'Latest Property Tax Receipt', 'Encumbrance Certificate'],
  'Business Loan':              ['GST Certificate', 'Business Registration Certificate', 'Last 2 Years Balance Sheet'],
  'Business Loan (Unsecured)':  ['GST Certificate', 'Business Registration Certificate', 'Last 2 Years Balance Sheet'],
  'Education Loan':             ['Admission Letter', 'Fee Structure / Prospectus', 'Academic Mark Sheets'],
};

// ─── Type constants ───────────────────────────────────────────────────────────

const TYPE_ICONS: Record<OpportunityType, React.ReactNode> = {
  loan:      <Briefcase size={16} />,
  wealth:    <TrendingUp size={16} />,
  insurance: <ShieldCheck size={16} />,
};
const TYPE_COLORS: Record<OpportunityType, { bg: string; text: string }> = {
  loan:      { bg: 'rgba(96,165,250,0.15)', text: '#60a5fa' },
  wealth:    { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
  insurance: { bg: 'rgba(251,146,60,0.15)', text: '#fb923c' },
};
const ACTIVITY_ICONS: Record<ActivityType, string> = {
  note: '📝', status_change: '🔄', ownership_change: '🔁', commission_calculated: '💰',
  call: '📞', email: '✉️', whatsapp: '💬', meeting: '🤝',
};

// ─── Shared form helpers ──────────────────────────────────────────────────────

function FieldLabel({ text, required, fieldKey, errors }: {
  text: string; required?: boolean;
  fieldKey?: string; errors?: Record<string, string>;
}) {
  const err = fieldKey ? errors?.[fieldKey] : undefined;
  return (
    <label className="block text-xs font-semibold uppercase tracking-widest mb-1"
      style={{ color: err ? '#DC2626' : 'var(--text-muted)' }}>
      {text}{required && <span className="text-red-500 ml-0.5">*</span>}
      {err && <span className="ml-2 text-red-500 font-medium normal-case tracking-normal">— {err}</span>}
    </label>
  );
}

const GInp = (err?: boolean) =>
  `glass-inp w-full text-sm${err ? ' border-red-500/60 focus:ring-red-400/30' : ''}`;

// ─── Stage form: Contacted ────────────────────────────────────────────────────

function ContactedForm({ value, onChange, errors }: {
  value: ContactedData; onChange: (v: ContactedData) => void; errors: Record<string, string>;
}) {
  const types: { key: ContactedData['contactType']; label: string; emoji: string }[] = [
    { key: 'call', label: 'Phone Call', emoji: '📞' },
    { key: 'whatsapp', label: 'WhatsApp', emoji: '💬' },
    { key: 'email', label: 'Email', emoji: '✉️' },
    { key: 'meeting', label: 'Meeting', emoji: '🤝' },
  ];
  return (
    <div className="space-y-4">
      <div>
        <FieldLabel text="How was the customer contacted?" />
        <div className="grid grid-cols-2 gap-2 mt-1">
          {types.map(({ key, label, emoji }) => (
            <label key={key}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all text-sm"
              style={{
                border: value.contactType === key
                  ? '1.5px solid #C9A961' : '1px solid rgba(255,255,255,0.10)',
                backgroundColor: value.contactType === key
                  ? 'rgba(201,169,97,0.12)' : 'transparent',
                color: 'var(--text-primary)',
              }}>
              <input type="radio" name="contactType" value={key}
                checked={value.contactType === key}
                onChange={() => onChange({ ...value, contactType: key })}
                className="sr-only" />
              <span>{emoji}</span>
              <span className="font-medium">{label}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel text="Contact Date" fieldKey="contactDate" errors={errors} required />
          <input type="date" value={value.contactDate}
            onChange={e => onChange({ ...value, contactDate: e.target.value })}
            className={GInp(!!errors.contactDate)} />
        </div>
        <div>
          <FieldLabel text="Contacted By" />
          <input type="text" value={value.contactedByName}
            onChange={e => onChange({ ...value, contactedByName: e.target.value })}
            placeholder="Name of person who contacted"
            className={GInp()} />
        </div>
      </div>
      <div>
        <FieldLabel text="Notes" />
        <textarea rows={3} value={value.notes}
          onChange={e => onChange({ ...value, notes: e.target.value })}
          placeholder="What was discussed? Any commitments made?"
          className={`${GInp()} resize-none`} />
      </div>
    </div>
  );
}

// ─── Stage form: Documents Collected ─────────────────────────────────────────

function DocumentsCollectedForm({ value, onChange, product }: {
  value: DocumentsData; onChange: (v: DocumentsData) => void; product: string;
}) {
  const [newDocName, setNewDocName] = useState('');

  // Initialise default docs on first render if list is empty
  const docs = value.documents.length === 0
    ? [...LOAN_DOCS, ...(PRODUCT_EXTRA_DOCS[product] ?? [])].map<DocItem>(
        name => ({ name, collected: false, receivedVia: '' })
      )
    : value.documents;

  const setDoc = (i: number, patch: Partial<DocItem>) =>
    onChange({ ...value, documents: docs.map((d, idx) => idx === i ? { ...d, ...patch } : d) });

  const addDoc = () => {
    const name = newDocName.trim();
    if (!name) return;
    onChange({ ...value, documents: [...docs, { name, collected: false, receivedVia: '' }] });
    setNewDocName('');
  };

  const removeDoc = (i: number) =>
    onChange({ ...value, documents: docs.filter((_, idx) => idx !== i) });

  const collectedCount = docs.filter(d => d.collected).length;
  const VIA_OPTIONS = ['', 'whatsapp', 'email', 'physical', 'portal'] as const;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Document Checklist
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
          style={{ backgroundColor: collectedCount === docs.length ? 'rgba(52,211,153,0.15)' : 'rgba(251,146,60,0.15)', color: collectedCount === docs.length ? '#34d399' : '#fb923c' }}>
          {collectedCount} / {docs.length} collected
        </span>
      </div>

      {/* Scrollable checklist */}
      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {docs.map((d, i) => (
          <div key={i}
            className="flex items-center gap-2 rounded-xl px-3 py-2 transition-colors"
            style={{ backgroundColor: d.collected ? 'rgba(52,211,153,0.06)' : 'rgba(255,255,255,0.03)' }}>
            <button type="button" onClick={() => setDoc(i, { collected: !d.collected })}
              className="shrink-0 transition-colors">
              {d.collected
                ? <CheckCircle2 size={18} style={{ color: '#34d399' }} />
                : <Circle size={18} style={{ color: 'rgba(255,255,255,0.25)' }} />}
            </button>
            <span className="flex-1 text-sm" style={{ color: d.collected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              {d.name}
            </span>
            {d.collected && (
              <select value={d.receivedVia}
                onChange={e => setDoc(i, { receivedVia: e.target.value as DocItem['receivedVia'] })}
                className="text-xs px-2 py-1 rounded-lg outline-none cursor-pointer"
                style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.12)' }}>
                <option value="">via…</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="physical">Physical</option>
                <option value="portal">Portal</option>
              </select>
            )}
            <button type="button" onClick={() => removeDoc(i)}
              className="shrink-0 p-0.5 rounded opacity-30 hover:opacity-70 transition-opacity">
              <X size={13} style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
        ))}
      </div>

      {/* Add custom document */}
      <div className="flex gap-2">
        <input type="text" value={newDocName} onChange={e => setNewDocName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addDoc())}
          placeholder="Add custom document…"
          className="glass-inp flex-1 text-sm" />
        <button type="button" onClick={addDoc}
          className="px-3 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
          <Plus size={14} />
        </button>
      </div>

      <div>
        <FieldLabel text="Notes" />
        <textarea rows={2} value={value.notes}
          onChange={e => onChange({ ...value, notes: e.target.value })}
          placeholder="Any missing docs or follow-up needed?"
          className={`${GInp()} resize-none`} />
      </div>
    </div>
  );
}

// ─── Stage form: Submitted to Bank ───────────────────────────────────────────

function SubmittedToBankForm({ value, onChange, errors }: {
  value: SubmittedData; onChange: (v: SubmittedData) => void; errors: Record<string, string>;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel text="Bank / NBFC Name" fieldKey="bankName" errors={errors} required />
          <input type="text" value={value.bankName}
            onChange={e => onChange({ ...value, bankName: e.target.value })}
            placeholder="e.g. HDFC Bank, Cholamandalam"
            className={GInp(!!errors.bankName)} />
        </div>
        <div>
          <FieldLabel text="Application No" fieldKey="applicationNo" errors={errors} required />
          <input type="text" value={value.applicationNo}
            onChange={e => onChange({ ...value, applicationNo: e.target.value })}
            placeholder="e.g. 10441897"
            className={GInp(!!errors.applicationNo)} />
        </div>
        <div>
          <FieldLabel text="Submission Date" />
          <input type="date" value={value.submittedDate}
            onChange={e => onChange({ ...value, submittedDate: e.target.value })}
            className={GInp()} />
        </div>
      </div>

      {/* SM details */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest mb-2 pb-1"
          style={{ color: '#C9A961', borderBottom: '1px solid rgba(201,169,97,0.20)' }}>
          SM (Sales Manager) Contact
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel text="Name" />
            <input type="text" value={value.smName}
              onChange={e => onChange({ ...value, smName: e.target.value })}
              placeholder="SM Name"
              className={GInp()} />
          </div>
          <div>
            <FieldLabel text="Phone" />
            <input type="tel" value={value.smPhone}
              onChange={e => onChange({ ...value, smPhone: e.target.value })}
              placeholder="SM Phone"
              className={GInp()} />
          </div>
          <div className="col-span-2">
            <FieldLabel text="Email" />
            <input type="email" value={value.smEmail}
              onChange={e => onChange({ ...value, smEmail: e.target.value })}
              placeholder="sm@bank.com"
              className={GInp()} />
          </div>
        </div>
      </div>

      {/* ASM details */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest mb-2 pb-1"
          style={{ color: '#C9A961', borderBottom: '1px solid rgba(201,169,97,0.20)' }}>
          ASM (Area Sales Manager) Contact
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel text="Name" />
            <input type="text" value={value.asmName}
              onChange={e => onChange({ ...value, asmName: e.target.value })}
              placeholder="ASM Name"
              className={GInp()} />
          </div>
          <div>
            <FieldLabel text="Phone" />
            <input type="tel" value={value.asmPhone}
              onChange={e => onChange({ ...value, asmPhone: e.target.value })}
              placeholder="ASM Phone"
              className={GInp()} />
          </div>
          <div className="col-span-2">
            <FieldLabel text="Email" />
            <input type="email" value={value.asmEmail}
              onChange={e => onChange({ ...value, asmEmail: e.target.value })}
              placeholder="asm@bank.com"
              className={GInp()} />
          </div>
        </div>
      </div>

      <div>
        <FieldLabel text="Notes" />
        <textarea rows={2} value={value.notes}
          onChange={e => onChange({ ...value, notes: e.target.value })}
          placeholder="Additional details…"
          className={`${GInp()} resize-none`} />
      </div>
    </div>
  );
}

// ─── Stage form: Under Review ─────────────────────────────────────────────────

function UnderReviewForm({ submittedData, notes, onChange }: {
  submittedData: SubmittedData | null;
  notes: string;
  onChange: (notes: string) => void;
}) {
  return (
    <div className="space-y-4">
      {submittedData?.bankName ? (
        <div className="rounded-xl px-4 py-3 space-y-1.5"
          style={{ backgroundColor: 'rgba(201,169,97,0.08)', borderLeft: '3px solid #C9A961' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#C9A961' }}>
            Submitted To — Reference
          </p>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {submittedData.bankName}
          </p>
          {submittedData.applicationNo && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              App No: <span style={{ color: 'var(--text-primary)' }}>{submittedData.applicationNo}</span>
            </p>
          )}
          {(submittedData.smName || submittedData.smPhone) && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              SM: {[submittedData.smName, submittedData.smPhone].filter(Boolean).join(' · ')}
            </p>
          )}
          {(submittedData.asmName || submittedData.asmPhone) && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              ASM: {[submittedData.asmName, submittedData.asmPhone].filter(Boolean).join(' · ')}
            </p>
          )}
          {submittedData.submittedDate && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Submitted: {format(new Date(submittedData.submittedDate), 'dd MMM yyyy')}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm py-2" style={{ color: 'var(--text-muted)' }}>
          No submission details captured. You can still advance and add review notes.
        </p>
      )}
      <div>
        <FieldLabel text="Review Notes" />
        <textarea rows={3} value={notes}
          onChange={e => onChange(e.target.value)}
          placeholder="Which bank is reviewing? Any feedback so far? Credit assessment status?"
          className={`${GInp()} resize-none`} />
      </div>
    </div>
  );
}

// ─── Stage form: Sanctioned ───────────────────────────────────────────────────

function SanctionedForm({ value, onChange, errors }: {
  value: SanctionedData; onChange: (v: SanctionedData) => void; errors: Record<string, string>;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel text="Sanctioned Amount ₹" fieldKey="sanctionedAmount" errors={errors} required />
          <input type="number" value={value.sanctionedAmount}
            onChange={e => onChange({ ...value, sanctionedAmount: e.target.value })}
            placeholder="e.g. 7000000"
            className={GInp(!!errors.sanctionedAmount)} />
        </div>
        <div>
          <FieldLabel text="Sanction Date" fieldKey="sanctionDate" errors={errors} required />
          <input type="date" value={value.sanctionDate}
            onChange={e => onChange({ ...value, sanctionDate: e.target.value })}
            className={GInp(!!errors.sanctionDate)} />
        </div>
        <div>
          <FieldLabel text="Sanction Letter No" />
          <input type="text" value={value.sanctionLetterNo}
            onChange={e => onChange({ ...value, sanctionLetterNo: e.target.value })}
            placeholder="Letter reference number"
            className={GInp()} />
        </div>
        <div>
          <FieldLabel text="Interest Rate %" />
          <input type="number" step="0.01" value={value.interestRate}
            onChange={e => onChange({ ...value, interestRate: e.target.value })}
            placeholder="e.g. 10.50"
            className={GInp()} />
        </div>
        <div>
          <FieldLabel text="Tenure (months)" />
          <input type="number" value={value.tenureMonths}
            onChange={e => onChange({ ...value, tenureMonths: e.target.value })}
            placeholder="e.g. 240"
            className={GInp()} />
        </div>
      </div>
      <div>
        <FieldLabel text="Notes" />
        <textarea rows={2} value={value.notes}
          onChange={e => onChange({ ...value, notes: e.target.value })}
          placeholder="Any conditions, special terms?"
          className={`${GInp()} resize-none`} />
      </div>
    </div>
  );
}

// ─── Stage form: Disbursed ────────────────────────────────────────────────────

function DisbursedForm({ value, onChange, errors }: {
  value: DisbursedData; onChange: (v: DisbursedData) => void; errors: Record<string, string>;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs pb-3" style={{ color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        Fill in the disbursal details. Fields pre-filled from the submission record where available.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel text="Application No" fieldKey="applicationNo" errors={errors} required />
          <input type="text" value={value.applicationNo}
            onChange={e => onChange({ ...value, applicationNo: e.target.value })}
            placeholder="e.g. 10441897"
            className={GInp(!!errors.applicationNo)} />
        </div>
        <div>
          <FieldLabel text="Loan No" fieldKey="loanNo" errors={errors} required />
          <input type="text" value={value.loanNo}
            onChange={e => onChange({ ...value, loanNo: e.target.value })}
            placeholder="e.g. HE01HYT00000162035"
            className={GInp(!!errors.loanNo)} />
        </div>
        <div>
          <FieldLabel text="Customer Company Name" />
          <input type="text" value={value.customerCompanyName}
            onChange={e => onChange({ ...value, customerCompanyName: e.target.value })}
            placeholder="Business / company name"
            className={GInp()} />
        </div>
        <div>
          <FieldLabel text="Disbursal Date" fieldKey="disbursalDate" errors={errors} required />
          <input type="date" value={value.disbursalDate}
            onChange={e => onChange({ ...value, disbursalDate: e.target.value })}
            className={GInp(!!errors.disbursalDate)} />
        </div>
        <div>
          <FieldLabel text="Disbursed Amount ₹" />
          <input type="number" value={value.disbursedAmount}
            onChange={e => onChange({ ...value, disbursedAmount: e.target.value })}
            placeholder="Actual disbursed amount"
            className={GInp()} />
        </div>
        <div>
          <FieldLabel text="City & State" />
          <input type="text" value={value.cityState}
            onChange={e => onChange({ ...value, cityState: e.target.value })}
            placeholder="e.g. Hyderabad, Telangana"
            className={GInp()} />
        </div>
      </div>

      {/* SM / ASM */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest mb-2 pb-1"
          style={{ color: '#C9A961', borderBottom: '1px solid rgba(201,169,97,0.20)' }}>
          SM Contact
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel text="SM Email" />
            <input type="email" value={value.smEmail}
              onChange={e => onChange({ ...value, smEmail: e.target.value })}
              placeholder="sm@bank.com"
              className={GInp()} />
          </div>
          <div>
            <FieldLabel text="SM Phone" />
            <input type="tel" value={value.smPhone}
              onChange={e => onChange({ ...value, smPhone: e.target.value })}
              placeholder="SM contact number"
              className={GInp()} />
          </div>
        </div>
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-widest mb-2 pb-1"
          style={{ color: '#C9A961', borderBottom: '1px solid rgba(201,169,97,0.20)' }}>
          ASM Contact
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel text="ASM Email" />
            <input type="email" value={value.asmEmail}
              onChange={e => onChange({ ...value, asmEmail: e.target.value })}
              placeholder="asm@bank.com"
              className={GInp()} />
          </div>
          <div>
            <FieldLabel text="ASM Phone" />
            <input type="tel" value={value.asmPhone}
              onChange={e => onChange({ ...value, asmPhone: e.target.value })}
              placeholder="ASM contact number"
              className={GInp()} />
          </div>
        </div>
      </div>

      {/* DSA */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest mb-2 pb-1"
          style={{ color: '#C9A961', borderBottom: '1px solid rgba(201,169,97,0.20)' }}>
          DSA Details
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel text="DSA Name" />
            <input type="text" value={value.dsaName}
              onChange={e => onChange({ ...value, dsaName: e.target.value })}
              placeholder="e.g. Ruloans Distribution"
              className={GInp()} />
          </div>
          <div>
            <FieldLabel text="DSA Code" />
            <input type="text" value={value.dsaCode}
              onChange={e => onChange({ ...value, dsaCode: e.target.value })}
              placeholder="e.g. 19453"
              className={GInp()} />
          </div>
        </div>
      </div>
      <div>
        <FieldLabel text="Notes" />
        <textarea rows={2} value={value.notes}
          onChange={e => onChange({ ...value, notes: e.target.value })}
          placeholder="Any other details about the disbursement?"
          className={`${GInp()} resize-none`} />
      </div>
    </div>
  );
}

// ─── Stage Advance Modal ──────────────────────────────────────────────────────

function StageAdvanceModal({ targetStage, opportunityType, product, existingStageData, onConfirm, onCancel, saving }: {
  targetStage: string;
  opportunityType: OpportunityType;
  product: string;
  existingStageData: Record<string, AnyStageData>;
  onConfirm: (data: AnyStageData) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}) {
  const col   = TYPE_COLORS[opportunityType];
  const key   = targetStage.toLowerCase().trim();
  const prevSubKey = 'submitted to bank';
  const prevSub = existingStageData[prevSubKey] as SubmittedData | undefined;

  // ── per-stage initial form state ────────────────────────────────────────────
  const [contactedData, setContactedData] = useState<ContactedData>({
    contactType: 'call', contactDate: '', contactedByName: '', notes: '',
  });
  const [docsData, setDocsData] = useState<DocumentsData>({ documents: [], notes: '' });
  const [submittedData, setSubmittedData] = useState<SubmittedData>({
    bankName: '', applicationNo: '', submittedDate: '',
    smName: '', smEmail: '', smPhone: '',
    asmName: '', asmEmail: '', asmPhone: '', notes: '',
  });
  const [reviewNotes, setReviewNotes] = useState('');
  const [sanctionedData, setSanctionedData] = useState<SanctionedData>({
    sanctionedAmount: '', sanctionDate: '', sanctionLetterNo: '',
    interestRate: '', tenureMonths: '', notes: '',
  });
  const [disbursedData, setDisbursedData] = useState<DisbursedData>({
    applicationNo: prevSub?.applicationNo ?? '',
    loanNo: '', customerCompanyName: '', disbursalDate: '', disbursedAmount: '',
    cityState: '',
    smEmail: prevSub?.smEmail ?? '', smPhone: prevSub?.smPhone ?? '',
    asmEmail: prevSub?.asmEmail ?? '', asmPhone: prevSub?.asmPhone ?? '',
    dsaName: '', dsaCode: '', notes: '',
  });
  const [genericNotes, setGenericNotes] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleConfirm = async () => {
    const errs: Record<string, string> = {};
    let payload: AnyStageData;

    if (key === 'contacted') {
      if (!contactedData.contactDate) errs.contactDate = 'Required';
      payload = contactedData;
    } else if (key === 'documents collected') {
      payload = { ...docsData, documents: docsData.documents.length === 0
        ? [...LOAN_DOCS, ...(PRODUCT_EXTRA_DOCS[product] ?? [])].map(name => ({ name, collected: false, receivedVia: '' as const }))
        : docsData.documents };
    } else if (key === 'submitted to bank') {
      if (!submittedData.bankName.trim()) errs.bankName = 'Required';
      if (!submittedData.applicationNo.trim()) errs.applicationNo = 'Required';
      payload = submittedData;
    } else if (key === 'under review') {
      payload = { notes: reviewNotes };
    } else if (key === 'sanctioned') {
      if (!sanctionedData.sanctionedAmount) errs.sanctionedAmount = 'Required';
      if (!sanctionedData.sanctionDate) errs.sanctionDate = 'Required';
      payload = sanctionedData;
    } else if (key === 'disbursed') {
      if (!disbursedData.applicationNo.trim()) errs.applicationNo = 'Required';
      if (!disbursedData.loanNo.trim()) errs.loanNo = 'Required';
      if (!disbursedData.disbursalDate) errs.disbursalDate = 'Required';
      payload = disbursedData;
    } else {
      payload = { notes: genericNotes };
    }

    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }
    setFieldErrors({});
    await onConfirm(payload);
  };

  const title: Record<string, string> = {
    'contacted':         '📞 Contacted',
    'documents collected': '📋 Documents Collected',
    'submitted to bank': '🏦 Submitted to Bank',
    'under review':      '🔍 Under Review',
    'sanctioned':        '✅ Sanctioned',
    'disbursed':         '💰 Disbursed',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center glass-modal-overlay">
      <div className="glass-modal-panel p-6 w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base"
              style={{ backgroundColor: col.bg }}>
              {title[key]?.split(' ')[0] ?? '📌'}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-muted)' }}>
                Moving to stage
              </p>
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {targetStage}
              </h3>
            </div>
          </div>
        </div>

        {/* Form body */}
        <div className="mb-6">
          {key === 'contacted' && (
            <ContactedForm value={contactedData} onChange={setContactedData} errors={fieldErrors} />
          )}
          {key === 'documents collected' && (
            <DocumentsCollectedForm value={docsData} onChange={setDocsData} product={product} />
          )}
          {key === 'submitted to bank' && (
            <SubmittedToBankForm value={submittedData} onChange={setSubmittedData} errors={fieldErrors} />
          )}
          {key === 'under review' && (
            <UnderReviewForm submittedData={prevSub ?? null} notes={reviewNotes} onChange={setReviewNotes} />
          )}
          {key === 'sanctioned' && (
            <SanctionedForm value={sanctionedData} onChange={setSanctionedData} errors={fieldErrors} />
          )}
          {key === 'disbursed' && (
            <DisbursedForm value={disbursedData} onChange={setDisbursedData} errors={fieldErrors} />
          )}
          {!['contacted','documents collected','submitted to bank','under review','sanctioned','disbursed'].includes(key) && (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Add any notes about this stage transition (optional).
              </p>
              <textarea rows={4} value={genericNotes} onChange={e => setGenericNotes(e.target.value)}
                placeholder="Notes about moving to this stage…"
                className={`${GInp()} resize-none`} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button onClick={onCancel} type="button"
            className="flex-1 px-4 py-2.5 text-sm border rounded-xl hover:bg-white/5 transition-colors"
            style={{ color: 'var(--text-muted)', borderColor: 'rgba(255,255,255,0.12)' }}>
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={saving} type="button"
            className="flex-2 px-6 py-2.5 text-sm font-semibold rounded-xl transition-opacity disabled:opacity-40"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {saving ? 'Saving…' : `Save & Move to ${targetStage}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stage Data History Accordion ─────────────────────────────────────────────

function StageDataHistory({ stages, stageData }: {
  stages: string[];
  stageData: Record<string, AnyStageData> | undefined;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!stageData) return null;

  // Only show stages that have captured data, in pipeline order
  const captured = stages.filter(s => stageData[s.toLowerCase().trim()]);
  if (captured.length === 0) return null;

  const toggle = (s: string) => setExpanded(prev => prev === s ? null : s);

  const renderBody = (stage: string) => {
    const key  = stage.toLowerCase().trim();
    const data = stageData[key] as Record<string, unknown>;
    if (!data) return null;

    if (key === 'contacted') {
      const d = data as unknown as ContactedData;
      const typeEmoji: Record<string, string> = { call: '📞', whatsapp: '💬', email: '✉️', meeting: '🤝' };
      return (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Method</p>
            <p style={{ color: 'var(--text-primary)' }}>{typeEmoji[d.contactType] ?? ''} {d.contactType}</p></div>
          {d.contactDate && <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Date</p>
            <p style={{ color: 'var(--text-primary)' }}>{format(new Date(d.contactDate), 'dd MMM yyyy')}</p></div>}
          {d.contactedByName && <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>By</p>
            <p style={{ color: 'var(--text-primary)' }}>{d.contactedByName}</p></div>}
          {d.notes && <div className="col-span-2"><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Notes</p>
            <p style={{ color: 'var(--text-muted)' }}>{d.notes}</p></div>}
        </div>
      );
    }

    if (key === 'documents collected') {
      const d = data as unknown as DocumentsData;
      const docs = d.documents ?? [];
      const collected = docs.filter(doc => doc.collected);
      const viaLabel: Record<string, string> = { whatsapp: '💬 WhatsApp', email: '✉️ Email', physical: '📄 Physical', portal: '🌐 Portal' };
      return (
        <div className="space-y-2">
          <p className="text-xs font-semibold" style={{ color: collected.length === docs.length ? '#34d399' : '#fb923c' }}>
            {collected.length} of {docs.length} documents collected
          </p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {docs.map((doc, i) => (
              <div key={i} className="flex items-center gap-2 text-xs py-1"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                {doc.collected
                  ? <CheckCircle2 size={13} style={{ color: '#34d399' }} />
                  : <Circle size={13} style={{ color: 'rgba(255,255,255,0.25)' }} />}
                <span className="flex-1" style={{ color: doc.collected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {doc.name}
                </span>
                {doc.collected && doc.receivedVia && (
                  <span className="px-1.5 py-0.5 rounded text-[10px]"
                    style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
                    {viaLabel[doc.receivedVia] ?? doc.receivedVia}
                  </span>
                )}
              </div>
            ))}
          </div>
          {d.notes && <p className="text-xs pt-1" style={{ color: 'var(--text-muted)' }}>{d.notes}</p>}
        </div>
      );
    }

    if (key === 'submitted to bank') {
      const d = data as unknown as SubmittedData;
      return (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Bank / NBFC</p>
              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{d.bankName || '—'}</p></div>
            <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Application No</p>
              <p style={{ color: 'var(--text-primary)' }}>{d.applicationNo || '—'}</p></div>
            {d.submittedDate && <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Submitted On</p>
              <p style={{ color: 'var(--text-primary)' }}>{format(new Date(d.submittedDate), 'dd MMM yyyy')}</p></div>}
          </div>
          {(d.smName || d.smEmail || d.smPhone) && (
            <div className="rounded-lg px-3 py-2 text-xs space-y-0.5"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="font-bold uppercase tracking-widest mb-1" style={{ color: '#C9A961' }}>SM</p>
              {d.smName && <p style={{ color: 'var(--text-primary)' }}>{d.smName}</p>}
              {d.smEmail && <p style={{ color: 'var(--text-muted)' }}>{d.smEmail}</p>}
              {d.smPhone && <p style={{ color: 'var(--text-muted)' }}>{d.smPhone}</p>}
            </div>
          )}
          {(d.asmName || d.asmEmail || d.asmPhone) && (
            <div className="rounded-lg px-3 py-2 text-xs space-y-0.5"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="font-bold uppercase tracking-widest mb-1" style={{ color: '#C9A961' }}>ASM</p>
              {d.asmName && <p style={{ color: 'var(--text-primary)' }}>{d.asmName}</p>}
              {d.asmEmail && <p style={{ color: 'var(--text-muted)' }}>{d.asmEmail}</p>}
              {d.asmPhone && <p style={{ color: 'var(--text-muted)' }}>{d.asmPhone}</p>}
            </div>
          )}
          {d.notes && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.notes}</p>}
        </div>
      );
    }

    if (key === 'under review') {
      const prevSub = stageData['submitted to bank'] as unknown as SubmittedData | undefined;
      const reviewNotes = (data as unknown as { notes: string }).notes;
      return (
        <div className="space-y-3">
          {prevSub?.bankName && (
            <div className="rounded-xl px-4 py-3"
              style={{ backgroundColor: 'rgba(201,169,97,0.08)', borderLeft: '3px solid #C9A961' }}>
              <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: '#C9A961' }}>Submitted To</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{prevSub.bankName}</p>
              {prevSub.applicationNo && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>App# {prevSub.applicationNo}</p>}
              {prevSub.smPhone && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>SM: {prevSub.smName} {prevSub.smPhone}</p>}
            </div>
          )}
          {reviewNotes && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{reviewNotes}</p>}
        </div>
      );
    }

    if (key === 'sanctioned') {
      const d = data as unknown as SanctionedData;
      return (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Sanctioned Amount</p>
            <p className="font-semibold" style={{ color: '#34d399' }}>
              {d.sanctionedAmount ? `₹${Number(d.sanctionedAmount).toLocaleString('en-IN')}` : '—'}
            </p></div>
          <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Sanction Date</p>
            <p style={{ color: 'var(--text-primary)' }}>
              {d.sanctionDate ? format(new Date(d.sanctionDate), 'dd MMM yyyy') : '—'}
            </p></div>
          {d.sanctionLetterNo && <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Letter No</p>
            <p style={{ color: 'var(--text-primary)' }}>{d.sanctionLetterNo}</p></div>}
          {d.interestRate && <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Interest Rate</p>
            <p style={{ color: 'var(--text-primary)' }}>{d.interestRate}%</p></div>}
          {d.tenureMonths && <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Tenure</p>
            <p style={{ color: 'var(--text-primary)' }}>{d.tenureMonths} months</p></div>}
          {d.notes && <div className="col-span-2"><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Notes</p>
            <p style={{ color: 'var(--text-muted)' }}>{d.notes}</p></div>}
        </div>
      );
    }

    if (key === 'disbursed') {
      const d = data as unknown as DisbursedData;
      const rows: { label: string; value: string | undefined }[] = [
        { label: 'Application No',    value: d.applicationNo },
        { label: 'Loan No',           value: d.loanNo },
        { label: 'Company',           value: d.customerCompanyName },
        { label: 'Disbursal Date',    value: d.disbursalDate ? format(new Date(d.disbursalDate), 'dd MMM yyyy') : undefined },
        { label: 'Disbursed Amount',  value: d.disbursedAmount ? `₹${Number(d.disbursedAmount).toLocaleString('en-IN')}` : undefined },
        { label: 'City / State',      value: d.cityState },
        { label: 'SM Email',          value: d.smEmail },
        { label: 'SM Phone',          value: d.smPhone },
        { label: 'ASM Email',         value: d.asmEmail },
        { label: 'ASM Phone',         value: d.asmPhone },
        { label: 'DSA Name',          value: d.dsaName },
        { label: 'DSA Code',          value: d.dsaCode },
      ].filter(r => r.value);
      return (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(201,169,97,0.20)' }}>
          {rows.map(({ label, value }, i) => (
            <div key={label}
              className="flex items-center gap-3 px-4 py-2.5 text-sm"
              style={{ backgroundColor: i % 2 === 0 ? 'rgba(201,169,97,0.04)' : 'transparent' }}>
              <span className="w-36 shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                {label}
              </span>
              <span style={{ color: 'var(--text-primary)' }}>{value}</span>
            </div>
          ))}
          {d.notes && (
            <div className="px-4 py-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.notes}</p>
            </div>
          )}
        </div>
      );
    }

    // Generic fallback
    const notes = (data as { notes?: string }).notes;
    return notes ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{notes}</p> : null;
  };

  return (
    <div className="glass-panel p-5">
      <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
        Stage History <span className="ml-1 font-normal normal-case tracking-normal">({captured.length} stage{captured.length !== 1 ? 's' : ''} captured)</span>
      </h3>
      <div className="space-y-1">
        {captured.map((stage) => {
          const isOpen = expanded === stage;
          return (
            <div key={stage} className="rounded-xl overflow-hidden"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              <button
                onClick={() => toggle(stage)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/3 transition-colors"
              >
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{stage}</span>
                {isOpen
                  ? <ChevronUp size={15} style={{ color: 'var(--text-muted)' }} />
                  : <ChevronDown size={15} style={{ color: 'var(--text-muted)' }} />}
              </button>
              {isOpen && (
                <div className="px-4 pb-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="pt-3">
                    {renderBody(stage)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Lost Reason Modal ────────────────────────────────────────────────────────

function LostReasonModal({ onConfirm, onCancel, loading }: {
  onConfirm: (details: Omit<LostDetails, 'capturedAt' | 'capturedBy'>) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState<LostReason | ''>('');
  const [competitorName, setCompetitorName] = useState('');
  const [competitorRate, setCompetitorRate] = useState('');
  const [notes, setNotes] = useState('');

  const isCompetitorReason =
    reason === 'lower_rate_competitor' ||
    reason === 'faster_approval_competitor' ||
    reason === 'better_terms_competitor';

  const handleConfirm = () => {
    if (!reason) return;
    onConfirm({
      reason: reason as LostReason,
      ...(competitorName ? { competitorName } : {}),
      ...(competitorRate ? { competitorRate: parseFloat(competitorRate) } : {}),
      ...(notes ? { notes } : {}),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center glass-modal-overlay">
      <div className="glass-modal-panel p-6 w-full max-w-md mx-4 space-y-4">
        <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          Mark as Lost — Capture Reason
        </h3>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Reason *
          </label>
          <select value={reason} onChange={(e) => setReason(e.target.value as LostReason | '')}
            className="glass-inp w-full text-sm">
            <option value="">Select reason…</option>
            {(Object.entries(LOST_REASON_LABELS) as [LostReason, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        {isCompetitorReason && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Competitor Name
              </label>
              <input type="text" value={competitorName} onChange={(e) => setCompetitorName(e.target.value)}
                placeholder="e.g. Bajaj Finserv" className="glass-inp w-full text-sm" />
            </div>
            {reason === 'lower_rate_competitor' && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Competitor Rate (%)
                </label>
                <input type="number" step="0.01" value={competitorRate} onChange={(e) => setCompetitorRate(e.target.value)}
                  placeholder="8.5" className="glass-inp w-full text-sm" />
              </div>
            )}
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Notes (optional)
          </label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            rows={2} className="glass-inp w-full text-sm resize-none" />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm border rounded-xl hover:bg-white/5 transition-colors"
            style={{ color: 'var(--text-muted)', borderColor: 'rgba(255,255,255,0.12)' }}>
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={!reason || loading}
            className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-40"
            style={{ backgroundColor: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.30)' }}>
            {loading ? '…' : 'Confirm Lost'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stage Stepper ────────────────────────────────────────────────────────────

function StageStepper({ stages, current, isLost }: { stages: string[]; current: string; isLost: boolean }) {
  const currentIdx = stages.indexOf(current);
  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-1 pt-1">
      {stages.map((stage, i) => {
        const done   = !isLost && i < currentIdx;
        const active = !isLost && i === currentIdx;
        return (
          <div key={stage} className="flex items-center min-w-0">
            <div className="flex flex-col items-center min-w-15">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{
                  backgroundColor: done ? '#C9A961' : active ? '#C9A961' : 'rgba(255,255,255,0.08)',
                  color: done ? '#0B1538' : active ? '#0B1538' : 'var(--text-dim)',
                }}>
                {done ? '✓' : i + 1}
              </div>
              <p className="text-[9px] font-medium mt-1 text-center leading-tight"
                style={{ color: active ? '#C9A961' : done ? 'var(--text-muted)' : 'var(--text-dim)' }}>
                {stage}
              </p>
            </div>
            {i < stages.length - 1 && (
              <div className="w-6 h-0.5 mb-5 shrink-0"
                style={{ backgroundColor: done ? '#C9A961' : 'rgba(255,255,255,0.08)' }} />
            )}
          </div>
        );
      })}
      {isLost && (
        <div className="ml-3 self-start mt-1 badge-glass-danger px-2.5 py-0.5">Lost</div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function OpportunityDetailPage() {
  const { leadId, oppId } = useParams<{ leadId: string; oppId: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { lead } = useLead(leadId ?? null);
  const { opportunity, loading } = useOpportunity(leadId ?? null, oppId ?? null);
  const { activities } = useActivities(leadId ?? null, oppId ?? null);
  const { types } = useOpportunityTypes();
  const { employees } = useAllEmployees();

  const [noteText, setNoteText]         = useState('');
  const [savingNote, setSavingNote]     = useState(false);
  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [stageSaving, setStageSaving]   = useState(false);
  const [lostModalOpen, setLostModalOpen] = useState(false);

  const isAdmin = profile?.role === 'admin';
  const isOwner = user?.uid === opportunity?.ownerId;
  const canAct  = isAdmin || isOwner;

  const typeConfig = useMemo(
    () => types.find((t) => t.name === opportunity?.product),
    [types, opportunity?.product],
  );
  const stages     = typeConfig?.stages ?? [];
  const currentIdx = opportunity ? stages.indexOf(opportunity.stage) : -1;
  const hasNext    = currentIdx >= 0 && currentIdx < stages.length - 1;
  const isTerminal = opportunity?.status === 'won' || opportunity?.status === 'lost';

  const opp = opportunity as OpportunityWithStageData | null;

  const authorName = (uid: string) =>
    employees.find((e) => e.userId === uid)?.displayName ?? uid.slice(0, 8);

  // ── Stage advance with data capture ──────────────────────────────────────────
  const handleStageAdvanceConfirm = async (formData: AnyStageData) => {
    if (!opp || !user || !canAct || !hasNext || !leadId || !oppId) return;
    setStageSaving(true);
    try {
      const next     = stages[currentIdx + 1];
      const stageKey = next.toLowerCase().trim();
      const isLast   = currentIdx + 1 === stages.length - 1;

      // 1. Save stage-specific data on the opportunity doc
      await updateDoc(doc(db, 'leads', leadId, 'opportunities', oppId), {
        stageData: { ...(opp.stageData ?? {}), [stageKey]: formData },
        updatedAt: serverTimestamp(),
      });

      // 1.5 If disbursed — push reference numbers onto the linked commission_record
      // so MIS can see Loan No, App No, etc. alongside the commission entry.
      if (stageKey === 'disbursed') {
        try {
          const d = formData as unknown as DisbursedData;
          const recSnap = await getDocs(
            query(collection(db, 'commission_records'), where('opportunityId', '==', oppId))
          );
          for (const recDoc of recSnap.docs) {
            await updateDoc(recDoc.ref, {
              loanNo:              d.loanNo             || null,
              applicationNo:       d.applicationNo      || null,
              disbursedAmount:     d.disbursedAmount ? Number(d.disbursedAmount) : null,
              disbursalDate:       d.disbursalDate       || null,
              dsaCode:             d.dsaCode             || null,
              dsaName:             d.dsaName             || null,
              cityState:           d.cityState           || null,
              customerCompanyName: d.customerCompanyName || null,
              updatedAt:           serverTimestamp(),
            });
          }
        } catch (_) {
          // Non-fatal — stage advance still proceeds even if record enrichment fails
        }
      }

      // 2. Advance the stage (handles activity log + won status)
      await updateOpportunityStage(leadId, oppId, next, opp.stage, user.uid, isLast);
      setStageModalOpen(false);
    } finally {
      setStageSaving(false);
    }
  };

  const handleMarkLost = () => {
    if (!opp || !user || !canAct) return;
    setLostModalOpen(true);
  };

  const handleAddNote = async () => {
    if (!noteText.trim() || !user || !leadId || !oppId) return;
    setSavingNote(true);
    try {
      await addNote(leadId, oppId, noteText, user.uid);
      setNoteText('');
    } finally {
      setSavingNote(false);
    }
  };

  if (loading || !opportunity) {
    return (
      <div className="max-w-3xl mx-auto animate-pulse space-y-4">
        <div className="h-5 rounded w-32" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
        <div className="h-8 rounded w-48" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
        <div className="h-40 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />
      </div>
    );
  }

  const col    = TYPE_COLORS[opportunity.opportunityType];
  const isLost = opportunity.status === 'lost';
  const isWon  = opportunity.status === 'won';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <button onClick={() => navigate(`/crm/leads/${leadId}`)}
        className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={15} /> {lead?.displayName ?? 'Customer'}
      </button>

      {/* Header card */}
      <div className="glass-panel p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: col.bg, color: col.text }}>
              {TYPE_ICONS[opportunity.opportunityType]}
            </div>
            <div>
              <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{opportunity.product}</h2>
              <p className="text-sm capitalize" style={{ color: 'var(--text-muted)' }}>{opportunity.opportunityType}</p>
            </div>
          </div>
          <span className={isWon ? 'badge-glass-success' : isLost ? 'badge-glass-danger' : 'badge-glass-warning'}>
            {opportunity.status}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Deal Size</p>
            <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>₹{opportunity.dealSize.toLocaleString('en-IN')}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>RM</p>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{authorName(opportunity.ownerId)}</p>
          </div>
          {opportunity.expectedCloseDate && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Expected Close</p>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {format(new Date(opportunity.expectedCloseDate), 'dd MMM yyyy')}
              </p>
            </div>
          )}
          {opportunity.actualCloseDate && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Closed On</p>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {format(new Date(opportunity.actualCloseDate), 'dd MMM yyyy')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Stage stepper + controls */}
      <div className="glass-panel p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
          Pipeline Stage
        </h3>
        {stages.length > 0 ? (
          <StageStepper stages={stages} current={opportunity.stage} isLost={isLost} />
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading stage config…</p>
        )}

        {canAct && !isTerminal && (
          <div className="flex gap-3 mt-5">
            {hasNext && (
              <button onClick={() => setStageModalOpen(true)} disabled={stageSaving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                <ChevronRight size={15} />
                Move to {stages[currentIdx + 1]}
              </button>
            )}
            <button onClick={handleMarkLost} disabled={stageSaving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 btn-glass-danger">
              <TrendingDown size={15} /> Mark as Lost
            </button>
          </div>
        )}
      </div>

      {/* Stage data history accordion */}
      <StageDataHistory
        stages={stages}
        stageData={opp?.stageData}
      />

      {/* Sub-collection section — type-specific */}
      {opportunity.opportunityType === 'loan' ? (
        <>
          <BankEligibilityCard
            opportunity={opportunity}
            lead={{ monthlyIncome: lead?.monthlyIncome, existingEmis: lead?.existingEmis }}
            foirPct={null}
          />
          <BankSubmissionsSection leadId={leadId!} oppId={oppId!} oppOwnerId={opportunity.ownerId} opportunityProduct={opportunity.product} />
        </>
      ) : opportunity.opportunityType === 'wealth' ? (
        <WealthInvestmentsSection leadId={leadId!} oppId={oppId!} canWrite={canAct} />
      ) : (
        <InsurancePoliciesSection leadId={leadId!} oppId={oppId!} canWrite={canAct} />
      )}

      {/* Stage advance modal */}
      {stageModalOpen && hasNext && opp && (
        <StageAdvanceModal
          targetStage={stages[currentIdx + 1]}
          opportunityType={opportunity.opportunityType}
          product={opportunity.product}
          existingStageData={(opp.stageData ?? {}) as Record<string, AnyStageData>}
          onConfirm={handleStageAdvanceConfirm}
          onCancel={() => setStageModalOpen(false)}
          saving={stageSaving}
        />
      )}

      {/* Lost Reason Modal */}
      {lostModalOpen && (
        <LostReasonModal
          onConfirm={async (details) => {
            if (!user) return;
            setStageSaving(true);
            try {
              await markOpportunityLost(leadId!, oppId!, user.uid, details);
              setLostModalOpen(false);
            } finally {
              setStageSaving(false);
            }
          }}
          onCancel={() => setLostModalOpen(false)}
          loading={stageSaving}
        />
      )}

      {/* Document vault */}
      <CrmDocumentVault opportunityId={oppId!} leadId={leadId!} canWrite={canAct} />

      {/* Activity timeline */}
      <div className="glass-panel p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>Activity</h3>
        <div className="flex gap-2 mb-5">
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note…" rows={2}
            className="glass-inp flex-1 text-sm resize-none" />
          <button onClick={handleAddNote} disabled={!noteText.trim() || savingNote}
            className="shrink-0 self-end flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            <MessageSquare size={14} />
            {savingNote ? '…' : 'Add'}
          </button>
        </div>
        <div>
          {activities.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No activity yet.</p>
          ) : activities.map((a, idx) => (
            <div key={a.id} className="flex gap-3 py-3"
              style={{ borderBottom: idx < activities.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
              <span className="text-base shrink-0 mt-0.5">{ACTIVITY_ICONS[a.type] ?? '📌'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{a.content}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>
                  {authorName(a.by)}
                  {a.at?.toDate ? ` · ${format(a.at.toDate(), 'dd MMM yyyy, HH:mm')}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
