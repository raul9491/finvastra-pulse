/**
 * Per-stage data-capture forms for an opportunity, plus the shared stage-data
 * types and the small local form primitives they use.
 * 
 * Each pipeline stage captures a different structured payload, stored on
 * `opportunity.stageData[stage]` and replayed by StageDataHistory.
 * 
 * Extracted verbatim from OpportunityDetailPage.tsx (2026-07-23) - no
 * behaviour change.
 */
import { useState } from 'react';
import { format } from 'date-fns';
import {
  Briefcase, TrendingUp, ShieldCheck, CheckCircle2, Circle, X, Plus,
} from 'lucide-react';
import type { OpportunityType, ActivityType, Opportunity } from '../../../types';
// ─── Stage data interfaces (file-private) ────────────────────────────────────

export interface ContactedData {
  contactType: 'call' | 'whatsapp' | 'email' | 'meeting';
  contactDate: string;
  contactedByName: string;
  notes: string;
}
export interface DocItem {
  name: string;
  collected: boolean;
  receivedVia: '' | 'whatsapp' | 'email' | 'physical' | 'portal';
}
export interface DocumentsData {
  documents: DocItem[];
  notes: string;
}
export interface SubmittedData {
  bankName: string; applicationNo: string; submittedDate: string;
  smName: string; smEmail: string; smPhone: string;
  asmName: string; asmEmail: string; asmPhone: string;
  notes: string;
}
export interface SanctionedData {
  sanctionedAmount: string; sanctionDate: string;
  sanctionLetterNo: string; interestRate: string;
  tenureMonths: string; notes: string;
}
export interface DisbursedData {
  applicationNo: string; loanNo: string; customerCompanyName: string;
  disbursalDate: string; disbursedAmount: string; cityState: string;
  smEmail: string; smPhone: string; asmEmail: string; asmPhone: string;
  dsaName: string; dsaCode: string; notes: string;
}
export type AnyStageData = ContactedData | DocumentsData | SubmittedData | SanctionedData | DisbursedData | { notes: string };

export type OpportunityWithStageData = Opportunity & { stageData?: Record<string, AnyStageData> };

// ─── Default document lists ───────────────────────────────────────────────────

export const LOAN_DOCS = [
  'PAN Card', 'Aadhaar Card', 'Passport Photo',
  'Last 3 Months Salary Slips', 'Last 6 Months Bank Statement',
  'Form 16 / Latest ITR', 'Employment Letter / Appointment Letter',
  'Address Proof (Utility Bill / Rental Agreement)',
];
export const PRODUCT_EXTRA_DOCS: Record<string, string[]> = {
  'Home Loan':                  ['Sale Agreement / Title Deed', 'Approved Building Plan', 'OC / CC Certificate'],
  'LAP':                        ['Property Title Deed', 'Latest Property Tax Receipt', 'Encumbrance Certificate'],
  'Business Loan':              ['GST Certificate', 'Business Registration Certificate', 'Last 2 Years Balance Sheet'],
  'Business Loan (Unsecured)':  ['GST Certificate', 'Business Registration Certificate', 'Last 2 Years Balance Sheet'],
  'Education Loan':             ['Admission Letter', 'Fee Structure / Prospectus', 'Academic Mark Sheets'],
};

// ─── Type constants ───────────────────────────────────────────────────────────

export const TYPE_ICONS: Record<OpportunityType, React.ReactNode> = {
  loan:      <Briefcase size={16} />,
  wealth:    <TrendingUp size={16} />,
  insurance: <ShieldCheck size={16} />,
};
export const TYPE_COLORS: Record<OpportunityType, { bg: string; text: string }> = {
  loan:      { bg: 'rgba(96,165,250,0.15)', text: '#60a5fa' },
  wealth:    { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
  insurance: { bg: 'rgba(251,146,60,0.15)', text: '#fb923c' },
};
export const ACTIVITY_ICONS: Record<ActivityType, string> = {
  note: '📝', status_change: '🔄', ownership_change: '🔁', commission_calculated: '💰',
  call: '📞', email: '✉️', whatsapp: '💬', meeting: '🤝',
};

// ─── Shared form helpers ──────────────────────────────────────────────────────

export function FieldLabel({ text, required, fieldKey, errors }: {
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

export const GInp = (err?: boolean) =>
  `glass-inp w-full text-sm${err ? ' border-red-500/60 focus:ring-red-400/30' : ''}`;

// ─── Stage form: Contacted ────────────────────────────────────────────────────

export function ContactedForm({ value, onChange, errors }: {
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
                  ? '1.5px solid #C9A961' : '1px solid var(--shell-border-mid)',
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

export function DocumentsCollectedForm({ value, onChange, product }: {
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
            style={{ backgroundColor: d.collected ? 'rgba(52,211,153,0.06)' : 'var(--shell-hover-soft)' }}>
            <button type="button" onClick={() => setDoc(i, { collected: !d.collected })}
              className="shrink-0 transition-colors">
              {d.collected
                ? <CheckCircle2 size={18} style={{ color: '#34d399' }} />
                : <Circle size={18} style={{ color: 'var(--text-dim)' }} />}
            </button>
            <span className="flex-1 text-sm" style={{ color: d.collected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              {d.name}
            </span>
            {d.collected && (
              <select value={d.receivedVia}
                onChange={e => setDoc(i, { receivedVia: e.target.value as DocItem['receivedVia'] })}
                className="text-xs px-2 py-1 rounded-lg outline-none cursor-pointer"
                style={{ backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-muted)', border: '1px solid var(--shell-border-mid)' }}>
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

export function SubmittedToBankForm({ value, onChange, errors }: {
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

export function UnderReviewForm({ submittedData, notes, onChange }: {
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

export function SanctionedForm({ value, onChange, errors }: {
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

export function DisbursedForm({ value, onChange, errors }: {
  value: DisbursedData; onChange: (v: DisbursedData) => void; errors: Record<string, string>;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs pb-3" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--shell-border)' }}>
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
