import { useState } from 'react';
import { inrRound as inr } from '../../../lib/money';
import { Download, Eye, CheckCircle2, RotateCcw, ChevronLeft, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { writeNotification, sendHrEmailNotification, buildHrEmailHtml } from '../../../lib/notifications';
import {
  useAllItDeclarations, acceptItDeclaration, requestItRevision,
  exportItDeclarationsCSV, currentFinancialYear, fyLabel,
  MAX_80C, MAX_HOME_LOAN_INT,
} from '../hooks/useItDeclarations';
import type { ItDeclaration, ItDeclarationStatus } from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';

// ─── Utilities ────────────────────────────────────────────────────────────────


function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (typeof (ts as { toDate?: unknown }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate();
  }
  return null;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, reopenRequested }: { status: ItDeclarationStatus; reopenRequested?: boolean }) {
  const map = {
    draft:     { bg: '#FEF3C7', text: '#92400E',  label: 'Draft'     },
    submitted: { bg: '#DBEAFE', text: '#1D4ED8',  label: 'Submitted' },
    accepted:  { bg: '#D1FAE5', text: '#065F46',  label: 'Accepted'  },
  } as const;
  const s = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
      style={{ backgroundColor: s.bg, color: s.text }}>
      {s.label}
      {reopenRequested && (
        <span className="text-[9px] font-bold uppercase tracking-wider ml-1 opacity-75">· Reopen Req.</span>
      )}
    </span>
  );
}

// ─── Read-only declaration detail view ───────────────────────────────────────

function DeclarationDetail({
  decl, employeeName, onBack, onAccept, onRevise, isAdmin,
}: {
  decl: ItDeclaration;
  employeeName: string;
  onBack: () => void;
  onAccept: () => void;
  onRevise: (note: string) => void;
  isAdmin: boolean;
}) {
  const [revisionNote, setRevisionNote]     = useState('');
  const [showReviseForm, setShowReviseForm] = useState(false);
  const [acting, setActing]                 = useState(false);

  const hlDeduction = decl.homeLoan.claimingHomeLoan
    ? Math.min(decl.homeLoan.annualInterest, MAX_HOME_LOAN_INT) : 0;
  const submittedDate = toDate(decl.submittedAt);
  const acceptedDate  = toDate(decl.acceptedAt);

  const handleAccept = async () => {
    setActing(true);
    try { await onAccept(); } finally { setActing(false); }
  };

  const handleRevise = async () => {
    setActing(true);
    try { await onRevise(revisionNote); setShowReviseForm(false); } finally { setActing(false); }
  };

  return (
    <div className="space-y-5">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-(--text-muted) hover:opacity-70 transition-opacity">
          <ChevronLeft size={15} /> Back to list
        </button>
        <div className="w-px h-4 bg-(--shell-hover-hard)" />
        <div>
          <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {employeeName} — IT Declaration ({fyLabel(decl.year)})
          </p>
          <p className="text-xs mt-0.5 text-(--text-muted)">
            {submittedDate ? `Submitted ${format(submittedDate, 'dd MMM yyyy')}` : 'Not yet submitted'}
            {acceptedDate  ? ` · Accepted ${format(acceptedDate, 'dd MMM yyyy')}` : ''}
          </p>
        </div>
        <div className="ml-auto">
          <StatusBadge status={decl.status} reopenRequested={decl.reopenRequested} />
        </div>
      </div>

      {decl.reopenRequested && (
        <div className="flex items-start gap-2 text-sm px-4 py-3 rounded-xl"
          style={{ backgroundColor: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          Employee has requested HR to reopen this declaration for editing.
        </div>
      )}

      {decl.revisionNote && (
        <div className="text-sm px-4 py-3 rounded-xl"
          style={{ backgroundColor: 'var(--glass-panel-bg)', color: 'var(--text-muted)', border: '1px solid var(--shell-border)' }}>
          <span className="font-semibold">HR Note: </span>{decl.revisionNote}
        </div>
      )}

      {/* Detail sections */}
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        <div className="px-5 py-3 border-b border-(--shell-border)"
          style={{ backgroundColor: 'var(--glass-panel-bg)' }}>
          <p className="text-xs font-bold uppercase tracking-widest text-(--text-muted)">Section 80C</p>
        </div>
        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
          {[
            ['Life Insurance',         decl.section80C.lifeInsurance],
            ['PPF',                    decl.section80C.ppf],
            ['ELSS',                   decl.section80C.elss],
            ['NSC',                    decl.section80C.nsc],
            ['Home Loan Principal',    decl.section80C.homeLoanPrincipal],
            ["Children's Tuition",     decl.section80C.tuitionFees],
            ['EPF Voluntary',          decl.section80C.epfVoluntary],
            ['NPS 80CCD(1)',           decl.section80C.nps80CCD1],
            ['Other 80C',              decl.section80C.other80C],
          ].map(([label, val]) => (
            <div key={label as string} className="flex justify-between text-sm py-0.5">
              <span className="text-(--text-muted)">{label as string}</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{inr(val as number)}</span>
            </div>
          ))}
          <div className="col-span-full border-t border-(--shell-border) pt-2 mt-1 flex justify-between text-sm font-semibold">
            <span style={{ color: 'var(--text-primary)' }}>Total 80C Deduction</span>
            <span style={{ color: 'var(--text-primary)' }}>{inr(decl.section80C.total80C)} of {inr(MAX_80C)}</span>
          </div>
        </div>
      </div>

      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        <div className="px-5 py-3 border-b border-(--shell-border)" style={{ backgroundColor: 'var(--glass-panel-bg)' }}>
          <p className="text-xs font-bold uppercase tracking-widest text-(--text-muted)">Section 80D</p>
        </div>
        <div className="px-5 py-4 space-y-2">
          {[
            ['Self + Family Premium',  decl.section80D.selfFamilyPremium],
            ['Parents Premium',        decl.section80D.parentsPremium],
          ].map(([label, val]) => (
            <div key={label as string} className="flex justify-between text-sm">
              <span className="text-(--text-muted)">{label as string}</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{inr(val as number)}</span>
            </div>
          ))}
          <p className="text-xs text-(--text-muted)">
            Parents senior citizens: {decl.section80D.parentsSenior ? 'Yes' : 'No'}
          </p>
          <div className="border-t border-(--shell-border) pt-2 flex justify-between text-sm font-semibold">
            <span style={{ color: 'var(--text-primary)' }}>Total 80D Deduction</span>
            <span style={{ color: 'var(--text-primary)' }}>{inr(decl.section80D.total80D)}</span>
          </div>
        </div>
      </div>

      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        <div className="px-5 py-3 border-b border-(--shell-border)" style={{ backgroundColor: 'var(--glass-panel-bg)' }}>
          <p className="text-xs font-bold uppercase tracking-widest text-(--text-muted)">HRA / Home Loan / LTA / 80E</p>
        </div>
        <div className="px-5 py-4 space-y-2">
          <DetailRow label="HRA Exemption" value={decl.hra.claimingHra ? 'Claimed' : 'Not claimed'} />
          {decl.hra.claimingHra && (
            <>
              <DetailRow label="Monthly Rent" value={inr(decl.hra.monthlyRent)} />
              <DetailRow label="Annual Rent" value={inr(decl.hra.annualRent)} />
              <DetailRow label="Landlord" value={decl.hra.landlordName || '—'} />
              <DetailRow label="Landlord PAN" value={decl.hra.landlordPan || '—'} />
              <DetailRow label="City Type" value={decl.hra.cityType === 'metro' ? 'Metro' : 'Non-Metro'} />
            </>
          )}
          <div className="border-t border-(--shell-border) pt-2">
            <DetailRow label="Home Loan Interest (Sec 24b)" value={decl.homeLoan.claimingHomeLoan ? `${inr(hlDeduction)} deductible` : 'Not claimed'} />
            {decl.homeLoan.claimingHomeLoan && (
              <>
                <DetailRow label="Lender" value={decl.homeLoan.lenderName || '—'} />
                <DetailRow label="Property" value={decl.homeLoan.propertyAddress || '—'} />
              </>
            )}
          </div>
          <div className="border-t border-(--shell-border) pt-2">
            <DetailRow label="LTA" value={decl.lta.claimingLta ? `${inr(decl.lta.travelAmount)} claimed` : 'Not claimed'} />
            <DetailRow label="Education Loan (80E)" value={decl.section80E.claimingEducationLoan ? `${inr(decl.section80E.annualInterest)} interest` : 'Not claimed'} />
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        <div className="px-5 py-3 border-b border-(--shell-border)"
          style={{ backgroundColor: '#0B1538' }}>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#C9A961' }}>
            Summary
          </p>
        </div>
        <div className="px-5 py-4 space-y-2">
          <DetailRow label="Total Deductions" value={inr(decl.totalDeductions)} bold />
          <DetailRow label="Estimated Tax Saving (30%)" value={`~${inr(decl.estimatedTaxSaving)}/year`} />
        </div>
      </div>

      {/* Admin actions */}
      {isAdmin && decl.status !== 'accepted' && (
        <div className="space-y-3">
          {!showReviseForm ? (
            <div className="flex items-center gap-3 flex-wrap">
              {decl.status === 'submitted' && (
                <button
                  onClick={handleAccept}
                  disabled={acting}
                  className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl font-semibold disabled:opacity-50"
                  style={{ backgroundColor: '#059669', color: '#FFFFFF' }}
                >
                  <CheckCircle2 size={15} />
                  {acting ? 'Accepting…' : 'Accept Declaration'}
                </button>
              )}
              <button
                onClick={() => setShowReviseForm(true)}
                disabled={acting}
                className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors disabled:opacity-50 font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                <RotateCcw size={14} />
                Request Revision
              </button>
            </div>
          ) : (
            <div className="bg-(--glass-panel-bg) rounded-xl border border-(--shell-border) p-4 space-y-3">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Request Revision
              </p>
              <textarea
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
                placeholder="Explain what the employee needs to correct or add…"
                rows={3}
                className="w-full text-sm border border-(--shell-border) rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-100 resize-none"
              />
              <div className="flex gap-3">
                <button
                  onClick={handleRevise}
                  disabled={acting}
                  className="text-sm px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
                  style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}
                >
                  {acting ? 'Sending…' : 'Send for Revision'}
                </button>
                <button
                  onClick={() => setShowReviseForm(false)}
                  className="text-sm px-4 py-2 rounded-lg border border-(--shell-border) hover:bg-(--glass-panel-bg)"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm py-0.5">
      <span className="text-(--text-muted)">{label}</span>
      <span className={bold ? 'font-bold' : 'font-medium'} style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AdminItDeclarationsPage() {
  const { user, profile } = useAuth();
  const uid    = user?.uid ?? '';
  const isAdmin = profile?.role === 'admin' || !!profile?.isHrmsManager;

  const thisFY   = currentFinancialYear();
  const fyOptions = [thisFY, thisFY - 1, thisFY - 2];
  const [selectedYear, setSelectedYear] = useState(thisFY);

  const { declarations, loading } = useAllItDeclarations(selectedYear);
  const { employees }             = useAllEmployees();

  // Filter to active employees only
  const activeEmployees = employees.filter((e) => (e.employeeStatus ?? 'active') === 'active');

  // Lookup map for quick access
  const empMap = new Map(activeEmployees.map((e) => [e.userId, e]));

  // Cross-reference: one row per active employee
  const rows = activeEmployees.map((emp) => ({
    employee: emp,
    decl: declarations.find((d) => d.employeeId === emp.userId) ?? null,
  }));

  // Summary counts
  const submitted   = declarations.filter((d) => d.status === 'submitted').length;
  const accepted    = declarations.filter((d) => d.status === 'accepted').length;
  const hasdecl     = declarations.length;
  const notSubmitted = activeEmployees.length - hasdecl + declarations.filter((d) => d.status === 'draft').length;

  const [selectedDecl, setSelectedDecl] = useState<ItDeclaration | null>(null);

  // ── Detail view ───────────────────────────────────────────────────────────
  if (selectedDecl) {
    const emp = empMap.get(selectedDecl.employeeId);
    return (
      <div className="max-w-3xl mx-auto">
        <DeclarationDetail
          decl={selectedDecl}
          employeeName={emp?.displayName ?? selectedDecl.employeeId}
          onBack={() => setSelectedDecl(null)}
          isAdmin={isAdmin}
          onAccept={async () => {
            await acceptItDeclaration(selectedDecl.employeeId, selectedDecl.year, uid);
            const fyStr = `FY ${selectedDecl.year}-${selectedDecl.year + 1}`;
            writeNotification(selectedDecl.employeeId, {
              type:  'it_decl_accepted',
              title: 'IT Declaration Accepted',
              body:  `Your IT declaration for ${fyStr} has been accepted by HR.`,
              link:  '/hrms/it-declaration',
            }).catch(() => {});
            sendHrEmailNotification({
              employeeId: selectedDecl.employeeId,
              subject: 'Your IT declaration is accepted',
              htmlBody: buildHrEmailHtml({
                title: 'Your IT declaration has been accepted',
                lines: [{ label: 'Financial Year', value: fyStr }],
                ctaLabel: 'View Declaration',
                ctaLink:  'https://pulse.finvastra.com/hrms/it-declaration',
              }),
            }).catch(() => {});
            setSelectedDecl(null);
          }}
          onRevise={async (note) => {
            await requestItRevision(selectedDecl.employeeId, selectedDecl.year, note);
            const fyStr = `FY ${selectedDecl.year}-${selectedDecl.year + 1}`;
            writeNotification(selectedDecl.employeeId, {
              type:  'it_decl_revision',
              title: 'IT Declaration: Revision Required',
              body:  `HR has requested changes to your ${fyStr} declaration. Note: ${note}`,
              link:  '/hrms/it-declaration',
            }).catch(() => {});
            sendHrEmailNotification({
              employeeId: selectedDecl.employeeId,
              subject: 'Action needed on your IT declaration',
              htmlBody: buildHrEmailHtml({
                title: 'HR has requested a revision to your IT declaration',
                lines: [{ label: 'Financial Year', value: fyStr }],
                note,
                ctaLabel: 'Update Declaration',
                ctaLink:  'https://pulse.finvastra.com/hrms/it-declaration',
              }),
            }).catch(() => {});
            setSelectedDecl(null);
          }}
        />
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="IT Declarations"
        subtitle="Review and accept employee investment declarations for TDS."
        pinKey="hrms.it-declarations"
        actions={
          <div className="flex items-center gap-3">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="text-sm border border-(--shell-border) rounded-xl px-4 py-2 bg-(--glass-panel-bg) outline-none focus:ring-2 focus:ring-blue-100 font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {fyOptions.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}
            </select>
            <button
              onClick={() => exportItDeclarationsCSV(
                selectedYear,
                activeEmployees.map((e) => ({
                  userId: e.userId, displayName: e.displayName,
                  empCode: e.employeeId, department: e.department,
                })),
              )}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              <Download size={14} />
              Export CSV
            </button>
          </div>
        }
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Employees',  value: activeEmployees.length,   bg: '#E5E7EB', text: '#374151' },
          { label: 'Submitted',        value: submitted,                 bg: '#DBEAFE', text: '#1D4ED8' },
          { label: 'Accepted',         value: accepted,                  bg: '#D1FAE5', text: '#065F46' },
          { label: 'Not Submitted',    value: notSubmitted,              bg: '#FEF3C7', text: '#92400E' },
        ].map(({ label, value, bg, text }) => (
          <div key={label} className="rounded-xl border border-(--shell-border) px-4 py-3 text-center"
            style={{ backgroundColor: bg }}>
            <p className="text-2xl font-bold" style={{ color: text }}>{value}</p>
            <p className="text-xs mt-0.5 font-medium" style={{ color: text }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        {loading ? (
          <div className="divide-y divide-(--shell-border) animate-pulse">
            {[1,2,3,4,5].map((i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <div className="h-4 bg-(--shell-hover-hard) rounded w-36" />
                <div className="h-4 bg-(--glass-panel-bg) rounded w-24 ml-auto" />
                <div className="h-4 bg-(--glass-panel-bg) rounded w-16" />
                <div className="h-4 bg-(--glass-panel-bg) rounded w-16" />
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr style={{ backgroundColor: 'var(--glass-panel-bg)', borderBottom: '1px solid var(--shell-border)' }}>
                  {['Employee', 'Department', 'Status', '80C', '80D', 'HRA', 'Submitted On', 'Actions'].map((h) => (
                    <th key={h} className="px-5 py-3.5 text-[10px] font-bold uppercase tracking-widest text-(--text-muted) whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ employee: emp, decl }) => (
                  <tr key={emp.userId}
                    className="border-b border-(--shell-border) last:border-0 hover:bg-(--glass-panel-bg)/50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{emp.displayName}</p>
                      <p className="text-xs text-(--text-muted) mt-0.5">{emp.employeeId}</p>
                    </td>
                    <td className="px-5 py-4 text-(--text-muted) whitespace-nowrap">{emp.department ?? '—'}</td>
                    <td className="px-5 py-4">
                      {decl
                        ? <StatusBadge status={decl.status} reopenRequested={decl.reopenRequested} />
                        : <span className="text-xs text-(--text-muted) italic">Not submitted</span>}
                    </td>
                    <td className="px-5 py-4 text-(--text-muted) whitespace-nowrap">
                      {decl ? inr(decl.section80C.total80C) : '—'}
                    </td>
                    <td className="px-5 py-4 text-(--text-muted) whitespace-nowrap">
                      {decl ? inr(decl.section80D.total80D) : '—'}
                    </td>
                    <td className="px-5 py-4">
                      {decl
                        ? (decl.hra.claimingHra
                          ? <span className="text-xs font-semibold" style={{ color: '#059669' }}>Yes</span>
                          : <span className="text-xs text-(--text-muted)">No</span>)
                        : <span className="text-(--text-muted)">—</span>}
                    </td>
                    <td className="px-5 py-4 text-(--text-muted) whitespace-nowrap">
                      {decl?.submittedAt
                        ? (() => { const d = toDate(decl.submittedAt); return d ? format(d, 'dd MMM yy') : '—'; })()
                        : '—'}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        {decl ? (
                          <>
                            <button
                              onClick={() => setSelectedDecl(decl)}
                              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors font-medium"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              <Eye size={12} /> View
                            </button>
                            {isAdmin && decl.status === 'submitted' && (
                              <button
                                onClick={async () => {
                                  await acceptItDeclaration(decl.employeeId, decl.year, uid);
                                  const fyStr = `FY ${decl.year}-${decl.year + 1}`;
                                  writeNotification(decl.employeeId, {
                                    type:  'it_decl_accepted',
                                    title: 'IT Declaration Accepted',
                                    body:  `Your IT declaration for ${fyStr} has been accepted by HR.`,
                                    link:  '/hrms/it-declaration',
                                  }).catch(() => {});
                                  sendHrEmailNotification({
                                    employeeId: decl.employeeId,
                                    subject: 'Your IT declaration is accepted',
                                    htmlBody: buildHrEmailHtml({
                                      title: 'Your IT declaration has been accepted',
                                      lines: [{ label: 'Financial Year', value: fyStr }],
                                      ctaLabel: 'View Declaration',
                                      ctaLink:  'https://pulse.finvastra.com/hrms/it-declaration',
                                    }),
                                  }).catch(() => {});
                                }}
                                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-semibold"
                                style={{ backgroundColor: '#059669', color: '#FFFFFF' }}
                              >
                                <CheckCircle2 size={12} /> Accept
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-(--text-muted) italic">No declaration</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
