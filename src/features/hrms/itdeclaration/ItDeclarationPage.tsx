import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Info, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import {
  useMyItDeclaration, saveItDeclaration, requestItReopen,
  currentFinancialYear, fyLabel,
  compute80C, compute80D, computeTotalDeductions, computeTaxSaving,
  default80C, default80D, defaultHra, defaultHomeLoan, defaultLta, default80E,
  MAX_80C, MAX_80D_SELF, MAX_80D_PARENTS, MAX_80D_PARENTS_SR, MAX_HOME_LOAN_INT,
  type ItDeclFormData,
} from '../hooks/useItDeclarations';
import type { ItDeclSection80C } from '../../../types';

// ─── Utilities ────────────────────────────────────────────────────────────────

const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const numInput = (e: React.ChangeEvent<HTMLInputElement>) =>
  Math.max(0, Number(e.target.value) || 0);

// ─── Shared input style ───────────────────────────────────────────────────────

const INP = 'w-full text-sm border border-(--shell-border) rounded-lg px-3 py-2 bg-(--glass-panel-bg) outline-none focus:ring-2 focus:ring-blue-100 transition-colors disabled:bg-(--glass-panel-bg) disabled:text-(--text-muted)';
const LBL = 'block text-[11px] font-semibold uppercase tracking-wider mb-1.5 text-(--text-muted)';

// ─── Accordion section wrapper ────────────────────────────────────────────────

function Section({
  id, title, subtitle, open, onToggle, children,
}: {
  id: string; title: string; subtitle?: string;
  open: boolean; onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-(--glass-panel-bg) transition-colors"
      >
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</p>
          {subtitle && <p className="text-xs mt-0.5 text-(--text-muted)">{subtitle}</p>}
        </div>
        {open
          ? <ChevronDown size={16} className="text-(--text-muted) shrink-0" />
          : <ChevronRight size={16} className="text-(--text-muted) shrink-0" />}
      </button>
      {open && (
        <div className="px-6 pb-6 pt-2 border-t border-(--shell-border) space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Currency input with label ────────────────────────────────────────────────

function AmtRow({
  label, value, onChange, disabled, hint,
}: {
  label: string; value: number;
  onChange: (v: number) => void;
  disabled?: boolean; hint?: string;
}) {
  return (
    <div>
      <label className={LBL}>{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-(--text-muted)">₹</span>
        <input
          type="number" min={0} step={100}
          value={value || ''}
          onChange={(e) => onChange(numInput(e))}
          className={`${INP} pl-7`}
          placeholder="0"
          disabled={disabled}
        />
      </div>
      {hint && <p className="text-xs mt-1 text-(--text-muted)">{hint}</p>}
    </div>
  );
}

// ─── 80C progress bar ────────────────────────────────────────────────────────

function C80Progress({ raw, capped }: { raw: number; capped: number }) {
  const pct     = Math.min((raw / MAX_80C) * 100, 100);
  const over    = raw > MAX_80C;
  const barColor = over ? '#DC2626' : '#C9A961';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold" style={{ color: over ? '#DC2626' : 'var(--text-primary)' }}>
          80C total: {inr(raw)} / {inr(MAX_80C)}
        </span>
        <span className="text-(--text-muted)">Deduction: {inr(capped)}</span>
      </div>
      <div className="h-2 rounded-full bg-(--glass-panel-bg) overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
      {over && (
        <p className="text-xs px-2.5 py-1.5 rounded-lg"
          style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
          Capped at ₹1,50,000 — excess ignored by the income tax department
        </p>
      )}
    </div>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  c80, d80, hraOn, homeLoanDed, eduLoan, lta, total, taxSaving,
}: {
  c80: number; d80: number; hraOn: boolean;
  homeLoanDed: number; eduLoan: number; lta: number;
  total: number; taxSaving: number;
}) {
  return (
    <div className="rounded-2xl border border-(--shell-border) bg-(--glass-panel-bg) overflow-hidden">
      <div className="px-5 py-3 flex items-center gap-2"
        style={{ backgroundColor: 'var(--text-primary)', borderBottom: '1px solid #1B2A4E' }}>
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#C9A961' }}>
          Live Summary
        </p>
      </div>
      <div className="px-5 py-4 space-y-2">
        <Row label="80C Investments" value={`${inr(c80)} of ${inr(MAX_80C)}`} />
        <Row label="80D Health Insurance" value={inr(d80)} />
        <Row label="HRA Exemption" value={hraOn ? 'Claimed' : 'Not claimed'} dim={!hraOn} />
        <Row label="Home Loan Interest (Sec 24b)" value={`${inr(homeLoanDed)} of ${inr(MAX_HOME_LOAN_INT)}`} dim={homeLoanDed === 0} />
        <Row label="Education Loan (80E)" value={inr(eduLoan)} dim={eduLoan === 0} />
        <Row label="LTA" value={inr(lta)} dim={lta === 0} />
        <div className="border-t border-(--shell-border) pt-2 mt-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Deductions</span>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{inr(total)}</span>
          </div>
        </div>
        <div className="rounded-xl px-4 py-3" style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
          <p className="text-xs font-semibold" style={{ color: '#92400E' }}>
            Estimated saving: ~{inr(taxSaving)}/year
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: '#B45309' }}>
            Indicative only (30% bracket) — actual TDS depends on your income slab
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-(--text-muted) shrink-0">{label}</span>
      <span className="text-xs font-medium text-right" style={{ color: dim ? 'var(--text-muted)' : 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

// ─── Confirm modal ────────────────────────────────────────────────────────────

function ConfirmSubmitModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="shrink-0 mt-0.5" style={{ color: '#D97706' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Submit to HR?</p>
            <p className="text-sm mt-1 text-(--text-muted) leading-relaxed">
              Once submitted, you cannot edit this declaration without HR approval.
              Make sure all values are correct before continuing.
            </p>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            Yes, Submit
          </button>
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm border border-(--shell-border) hover:bg-(--glass-panel-bg)">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 80C field list ───────────────────────────────────────────────────────────

const C80_FIELDS: Array<{ key: keyof ItDeclSection80C; label: string; hint?: string }> = [
  { key: 'lifeInsurance',     label: 'Life Insurance Premium' },
  { key: 'ppf',               label: 'PPF (Public Provident Fund)' },
  { key: 'elss',              label: 'ELSS (Equity Linked Saving Scheme)' },
  { key: 'nsc',               label: 'NSC (National Savings Certificate)' },
  { key: 'homeLoanPrincipal', label: 'Home Loan Principal Repayment' },
  { key: 'tuitionFees',       label: "Children's Tuition Fees" },
  { key: 'epfVoluntary',      label: 'EPF Voluntary Contribution' },
  { key: 'nps80CCD1',         label: 'NPS under 80CCD(1)', hint: 'Employee contribution to NPS' },
  { key: 'other80C',          label: 'Other 80C Investments' },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export function ItDeclarationPage() {
  const { user } = useAuth();
  const uid = user?.uid ?? '';

  // FY selector — current and 2 previous
  const thisFY = currentFinancialYear();
  const fyOptions = [thisFY, thisFY - 1, thisFY - 2];
  const [selectedYear, setSelectedYear] = useState(thisFY);

  const { declaration, loading } = useMyItDeclaration(uid, selectedYear);

  // ── Form state ─────────────────────────────────────────────────────────────
  const [form, setForm] = useState<ItDeclFormData>({
    section80C: default80C(),
    section80D: default80D(),
    hra:        defaultHra(),
    homeLoan:   defaultHomeLoan(),
    lta:        defaultLta(),
    section80E: default80E(),
  });

  // Initialise form from Firestore on first load or when year changes
  const formYearRef = useRef(-1);
  useEffect(() => {
    if (loading) return;
    if (formYearRef.current === selectedYear) return;
    formYearRef.current = selectedYear;
    setForm(declaration ? {
      section80C: declaration.section80C,
      section80D: declaration.section80D,
      hra:        declaration.hra,
      homeLoan:   declaration.homeLoan,
      lta:        declaration.lta,
      section80E: declaration.section80E,
    } : {
      section80C: default80C(),
      section80D: default80D(),
      hra:        defaultHra(),
      homeLoan:   defaultHomeLoan(),
      lta:        defaultLta(),
      section80E: default80E(),
    });
  }, [loading, selectedYear, declaration]);

  // ── Accordion state ────────────────────────────────────────────────────────
  const [openSection, setOpenSection] = useState<string>('80c');
  const toggleSection = (id: string) => setOpenSection((prev) => prev === id ? '' : id);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [saving,         setSaving]         = useState(false);
  const [confirmSubmit,  setConfirmSubmit]  = useState(false);
  const [saveSuccess,    setSaveSuccess]    = useState(false);
  const [reopenSent,     setReopenSent]     = useState(false);
  const [saveError,      setSaveError]      = useState('');

  const isReadOnly = declaration?.status === 'submitted' || declaration?.status === 'accepted';

  // ── Live derived values ────────────────────────────────────────────────────
  const raw80C        = (Object.keys(form.section80C) as Array<keyof ItDeclSection80C>)
    .filter((k) => k !== 'total80C')
    .reduce((s, k) => s + (form.section80C[k] as number), 0);
  const total80C      = compute80C(form.section80C);
  const total80D      = compute80D(form.section80D);
  const hlDeduction   = form.homeLoan.claimingHomeLoan
    ? Math.min(form.homeLoan.annualInterest, MAX_HOME_LOAN_INT) : 0;
  const eduDeduction  = form.section80E.claimingEducationLoan
    ? form.section80E.annualInterest : 0;
  const ltaDeduction  = form.lta.claimingLta ? form.lta.travelAmount : 0;
  const totalDeductions  = computeTotalDeductions(
    total80C, total80D, form.homeLoan, form.section80E, form.lta,
  );
  const estimatedTaxSaving = computeTaxSaving(totalDeductions);
  const annualRent    = form.hra.monthlyRent * 12;
  const panRequired   = annualRent > 100_000;

  // ── Helpers ────────────────────────────────────────────────────────────────
  const set80C = (key: keyof ItDeclSection80C, val: number) =>
    setForm((f) => ({ ...f, section80C: { ...f.section80C, [key]: val } }));

  const doSave = async (status: 'draft' | 'submitted') => {
    setSaving(true); setSaveError('');
    try {
      await saveItDeclaration(uid, selectedYear, form, status, declaration);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error('[ItDeclarationPage] save failed:', err);
      setSaveError('Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleReopen = async () => {
    try {
      await requestItReopen(uid, selectedYear);
      setReopenSent(true);
    } catch {
      alert('Could not send reopen request. Please try again.');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl mb-1"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            IT Declaration
          </h2>
          <p className="text-sm text-(--text-muted)">Declare your investments and exemptions for TDS computation.</p>
        </div>

        {/* FY selector */}
        <select
          value={selectedYear}
          onChange={(e) => {
            formYearRef.current = -1;
            setSelectedYear(Number(e.target.value));
          }}
          className="text-sm border border-(--shell-border) rounded-xl px-4 py-2 bg-(--glass-panel-bg) outline-none focus:ring-2 focus:ring-blue-100 font-semibold shrink-0"
          style={{ color: 'var(--text-primary)' }}
        >
          {fyOptions.map((y) => (
            <option key={y} value={y}>{fyLabel(y)}</option>
          ))}
        </select>
      </div>

      {/* Status banner */}
      {!loading && declaration && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium"
          style={{
            backgroundColor:
              declaration.status === 'accepted'  ? '#D1FAE5' :
              declaration.status === 'submitted' ? '#DBEAFE' : '#FEF3C7',
            color:
              declaration.status === 'accepted'  ? '#065F46' :
              declaration.status === 'submitted' ? '#1E40AF' : '#92400E',
          }}>
          {declaration.status === 'accepted'  && <CheckCircle2 size={16} className="shrink-0" />}
          {declaration.status === 'submitted' && <Info size={16} className="shrink-0" />}
          {declaration.status === 'draft'     && <Info size={16} className="shrink-0" />}
          <span>
            {declaration.status === 'draft'     && 'Draft — not yet submitted to HR'}
            {declaration.status === 'submitted' && 'Submitted — awaiting HR review'}
            {declaration.status === 'accepted'  && `Accepted by HR${declaration.acceptedAt ? '' : ''}`}
          </span>
          {declaration.revisionNote && (
            <span className="ml-2 text-xs opacity-80">· Note: {declaration.revisionNote}</span>
          )}
        </div>
      )}

      {!loading && !declaration && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ backgroundColor: 'var(--glass-panel-bg)', border: '1px solid #E2E8F0', color: 'var(--text-muted)' }}>
          <Info size={15} className="shrink-0" />
          No declaration on file for {fyLabel(selectedYear)}. Fill the form and save as draft to start.
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[1,2,3].map((i) => (
            <div key={i} className="h-14 bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) animate-pulse" />
          ))}
        </div>
      )}

      {!loading && (
        <>
          {/* ── Section 1: 80C ─────────────────────────────────────────────── */}
          <Section
            id="80c"
            title="Section 80C — Investments & Payments"
            subtitle={`Max deduction: ${inr(MAX_80C)}`}
            open={openSection === '80c'}
            onToggle={toggleSection}
          >
            <C80Progress raw={raw80C} capped={total80C} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
              {C80_FIELDS.map(({ key, label, hint }) => (
                <AmtRow
                  key={key}
                  label={label}
                  hint={hint}
                  value={(form.section80C[key] as number) || 0}
                  onChange={(v) => set80C(key, v)}
                  disabled={isReadOnly}
                />
              ))}
            </div>
          </Section>

          {/* ── Section 2: 80D ─────────────────────────────────────────────── */}
          <Section
            id="80d"
            title="Section 80D — Health Insurance"
            subtitle={`Max ₹25,000 self/family + ₹25,000 parents (₹50,000 if senior)`}
            open={openSection === '80d'}
            onToggle={toggleSection}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <AmtRow
                label={`Self + Family Premium (max ${inr(MAX_80D_SELF)})`}
                value={form.section80D.selfFamilyPremium}
                onChange={(v) => setForm((f) => ({ ...f, section80D: { ...f.section80D, selfFamilyPremium: v } }))}
                disabled={isReadOnly}
              />
              <div>
                <label className="flex items-center gap-2 mb-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.section80D.parentsSenior}
                    onChange={(e) => setForm((f) => ({ ...f, section80D: { ...f.section80D, parentsSenior: e.target.checked } }))}
                    disabled={isReadOnly}
                    className="rounded"
                  />
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    Parents are senior citizens (60+)
                  </span>
                </label>
                <AmtRow
                  label={`Parents Premium (max ${inr(form.section80D.parentsSenior ? MAX_80D_PARENTS_SR : MAX_80D_PARENTS)})`}
                  value={form.section80D.parentsPremium}
                  onChange={(v) => setForm((f) => ({ ...f, section80D: { ...f.section80D, parentsPremium: v } }))}
                  disabled={isReadOnly}
                />
              </div>
            </div>
            <div className="px-3 py-2 rounded-lg text-xs"
              style={{ backgroundColor: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }}>
              80D deduction: {inr(total80D)}
              {' '}(self/family: {inr(Math.min(form.section80D.selfFamilyPremium, MAX_80D_SELF))} + parents: {inr(Math.min(form.section80D.parentsPremium, form.section80D.parentsSenior ? MAX_80D_PARENTS_SR : MAX_80D_PARENTS))})
            </div>
          </Section>

          {/* ── Section 3: HRA ─────────────────────────────────────────────── */}
          <Section
            id="hra"
            title="HRA — House Rent Allowance"
            subtitle="Only if you live in rented accommodation and receive HRA from employer"
            open={openSection === 'hra'}
            onToggle={toggleSection}
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.hra.claimingHra}
                onChange={(e) => setForm((f) => ({ ...f, hra: { ...f.hra, claimingHra: e.target.checked } }))}
                disabled={isReadOnly}
                className="rounded"
              />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                I am claiming HRA exemption
              </span>
            </label>

            {form.hra.claimingHra && (
              <div className="space-y-4 mt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <AmtRow
                    label="Monthly Rent (₹)"
                    value={form.hra.monthlyRent}
                    onChange={(v) => setForm((f) => ({ ...f, hra: { ...f.hra, monthlyRent: v } }))}
                    disabled={isReadOnly}
                  />
                  <div>
                    <label className={LBL}>City Type</label>
                    <select
                      value={form.hra.cityType}
                      onChange={(e) => setForm((f) => ({ ...f, hra: { ...f.hra, cityType: e.target.value as 'metro' | 'non_metro' } }))}
                      disabled={isReadOnly}
                      className={INP}
                    >
                      <option value="metro">Metro (Mumbai, Delhi, Kolkata, Chennai)</option>
                      <option value="non_metro">Non-Metro</option>
                    </select>
                  </div>
                </div>

                {form.hra.monthlyRent > 0 && (
                  <p className="text-xs px-3 py-2 rounded-lg"
                    style={{ backgroundColor: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }}>
                    Your annual rent: {inr(annualRent)}
                  </p>
                )}

                {panRequired && !form.hra.landlordPan && (
                  <div className="flex items-start gap-2 text-xs px-3 py-2.5 rounded-lg"
                    style={{ backgroundColor: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    Landlord PAN is required when annual rent exceeds ₹1,00,000.
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={LBL}>Landlord Name</label>
                    <input
                      type="text"
                      value={form.hra.landlordName}
                      onChange={(e) => setForm((f) => ({ ...f, hra: { ...f.hra, landlordName: e.target.value } }))}
                      disabled={isReadOnly}
                      placeholder="Full name of landlord"
                      className={INP}
                    />
                  </div>
                  <div>
                    <label className={LBL}>
                      Landlord PAN
                      {panRequired && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    <input
                      type="text"
                      value={form.hra.landlordPan ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, hra: { ...f.hra, landlordPan: e.target.value.toUpperCase() || null } }))}
                      disabled={isReadOnly}
                      placeholder={panRequired ? 'Required (rent > ₹1L/yr)' : 'Optional'}
                      maxLength={10}
                      className={INP}
                    />
                    <p className="text-[10px] mt-1 text-(--text-muted)">Required if annual rent exceeds ₹1,00,000</p>
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* ── Section 4: Home Loan ────────────────────────────────────────── */}
          <Section
            id="homeloan"
            title="Home Loan Interest — Section 24(b)"
            subtitle={`Max deduction: ${inr(MAX_HOME_LOAN_INT)} for self-occupied property`}
            open={openSection === 'homeloan'}
            onToggle={toggleSection}
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.homeLoan.claimingHomeLoan}
                onChange={(e) => setForm((f) => ({ ...f, homeLoan: { ...f.homeLoan, claimingHomeLoan: e.target.checked } }))}
                disabled={isReadOnly}
                className="rounded"
              />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>I have a home loan</span>
            </label>

            {form.homeLoan.claimingHomeLoan && (
              <div className="space-y-4 mt-2">
                <AmtRow
                  label="Annual Interest Paid (₹)"
                  value={form.homeLoan.annualInterest}
                  onChange={(v) => setForm((f) => ({ ...f, homeLoan: { ...f.homeLoan, annualInterest: v } }))}
                  disabled={isReadOnly}
                />
                {form.homeLoan.annualInterest > 0 && (
                  <p className="text-xs px-3 py-2 rounded-lg"
                    style={{ backgroundColor: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }}>
                    Deduction applicable: {inr(Math.min(form.homeLoan.annualInterest, MAX_HOME_LOAN_INT))}
                    {form.homeLoan.annualInterest > MAX_HOME_LOAN_INT &&
                      <span className="ml-1 opacity-75">(capped at {inr(MAX_HOME_LOAN_INT)})</span>}
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={LBL}>Property Address</label>
                    <input
                      type="text"
                      value={form.homeLoan.propertyAddress}
                      onChange={(e) => setForm((f) => ({ ...f, homeLoan: { ...f.homeLoan, propertyAddress: e.target.value } }))}
                      disabled={isReadOnly}
                      placeholder="Full property address"
                      className={INP}
                    />
                  </div>
                  <div>
                    <label className={LBL}>Lender / Bank Name</label>
                    <input
                      type="text"
                      value={form.homeLoan.lenderName}
                      onChange={(e) => setForm((f) => ({ ...f, homeLoan: { ...f.homeLoan, lenderName: e.target.value } }))}
                      disabled={isReadOnly}
                      placeholder="e.g. HDFC Bank"
                      className={INP}
                    />
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* ── Section 5: LTA ─────────────────────────────────────────────── */}
          <Section
            id="lta"
            title="LTA — Leave Travel Allowance"
            subtitle="As per company LTA policy — actual travel receipts required"
            open={openSection === 'lta'}
            onToggle={toggleSection}
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.lta.claimingLta}
                onChange={(e) => setForm((f) => ({ ...f, lta: { ...f.lta, claimingLta: e.target.checked } }))}
                disabled={isReadOnly}
                className="rounded"
              />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>I am claiming LTA</span>
            </label>

            {form.lta.claimingLta && (
              <div className="space-y-4 mt-2">
                <AmtRow
                  label="Travel Amount (₹)"
                  value={form.lta.travelAmount}
                  onChange={(v) => setForm((f) => ({ ...f, lta: { ...f.lta, travelAmount: v } }))}
                  disabled={isReadOnly}
                />
                <div>
                  <label className={LBL}>Travel Details</label>
                  <textarea
                    value={form.lta.travelDetails}
                    onChange={(e) => setForm((f) => ({ ...f, lta: { ...f.lta, travelDetails: e.target.value } }))}
                    disabled={isReadOnly}
                    placeholder="Destination, travel dates, mode of transport…"
                    rows={2}
                    className={`${INP} resize-none`}
                  />
                </div>
              </div>
            )}
          </Section>

          {/* ── Section 6: 80E ─────────────────────────────────────────────── */}
          <Section
            id="80e"
            title="Section 80E — Education Loan Interest"
            subtitle="No upper limit — full interest paid is deductible"
            open={openSection === '80e'}
            onToggle={toggleSection}
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.section80E.claimingEducationLoan}
                onChange={(e) => setForm((f) => ({ ...f, section80E: { ...f.section80E, claimingEducationLoan: e.target.checked } }))}
                disabled={isReadOnly}
                className="rounded"
              />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>I have an education loan</span>
            </label>

            {form.section80E.claimingEducationLoan && (
              <div className="space-y-2 mt-2">
                <AmtRow
                  label="Annual Interest Paid (₹)"
                  value={form.section80E.annualInterest}
                  onChange={(v) => setForm((f) => ({ ...f, section80E: { ...f.section80E, annualInterest: v } }))}
                  disabled={isReadOnly}
                />
                <p className="text-xs text-(--text-muted)">
                  No upper limit — the entire interest amount qualifies for deduction under Section 80E.
                </p>
              </div>
            )}
          </Section>

          {/* ── Summary ────────────────────────────────────────────────────── */}
          <SummaryCard
            c80={total80C}
            d80={total80D}
            hraOn={form.hra.claimingHra}
            homeLoanDed={hlDeduction}
            eduLoan={eduDeduction}
            lta={ltaDeduction}
            total={totalDeductions}
            taxSaving={estimatedTaxSaving}
          />

          {/* ── Actions ────────────────────────────────────────────────────── */}
          {saveError && (
            <p className="text-sm px-4 py-3 rounded-xl"
              style={{ backgroundColor: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}>
              {saveError}
            </p>
          )}

          {isReadOnly ? (
            <div className="flex items-center gap-3">
              {declaration?.reopenRequested ? (
                <div className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl"
                  style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}>
                  <Info size={15} />
                  Reopen request sent to HR
                </div>
              ) : reopenSent ? (
                <div className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl"
                  style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                  <CheckCircle2 size={15} />
                  Reopen request sent
                </div>
              ) : (
                <button
                  onClick={handleReopen}
                  className="text-sm px-4 py-2.5 rounded-xl border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Request HR to reopen
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => doSave('draft')}
                disabled={saving}
                className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors disabled:opacity-50 font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {saving ? 'Saving…' : saveSuccess ? '✓ Saved' : 'Save as Draft'}
              </button>
              <button
                onClick={() => setConfirmSubmit(true)}
                disabled={saving}
                className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl font-semibold disabled:opacity-50"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
              >
                Submit to HR
              </button>
            </div>
          )}
        </>
      )}

      {confirmSubmit && (
        <ConfirmSubmitModal
          onConfirm={() => { setConfirmSubmit(false); doSave('submitted'); }}
          onCancel={() => setConfirmSubmit(false)}
        />
      )}
    </div>
  );
}
