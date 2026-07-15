import { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { collection, onSnapshot, doc, updateDoc, serverTimestamp, query, orderBy, getDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { UserMinus, ChevronLeft, Check, Clock, CheckCircle2, FileText, Monitor, Package, BookOpen, Circle, Calculator, Download, IndianRupee, AlertCircle, ExternalLink } from 'lucide-react';
import { format, differenceInYears } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { OffboardingChecklist, ChecklistItem, ChecklistStatus, ChecklistItemCategory, FnFDetails, FnFStatus, UserProfile } from '../../../types';
import { EXIT_REASON_LABELS } from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDate(ts: any): Date | null {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  return null;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
}

const STATUS_META: Record<ChecklistStatus, { label: string; bg: string; color: string }> = {
  pending:     { label: 'Pending',     bg: '#FFFBEB', color: '#92400E' },
  in_progress: { label: 'In Progress', bg: '#EFF6FF', color: '#1D4ED8' },
  completed:   { label: 'Completed',   bg: '#F0FDF4', color: '#166534' },
};

const FNF_STATUS_META: Record<FnFStatus, { label: string; bg: string; color: string }> = {
  pending:    { label: 'FnF Pending',    bg: '#FFF1F2', color: '#BE123C' },
  calculated: { label: 'FnF Calculated', bg: '#FFF7ED', color: '#C2410C' },
  settled:    { label: 'FnF Settled',    bg: '#F0FDF4', color: '#166534' },
};

const CATEGORY_META: Record<ChecklistItemCategory, { label: string; icon: typeof FileText; color: string }> = {
  documents:          { label: 'Documents',          icon: FileText,    color: '#3B82F6' },
  system_access:      { label: 'System Access',      icon: Monitor,     color: '#8B5CF6' },
  assets:             { label: 'Assets',             icon: Package,     color: '#F59E0B' },
  induction:          { label: 'Induction',          icon: BookOpen,    color: '#10B981' },
  knowledge_transfer: { label: 'Knowledge Transfer', icon: BookOpen,    color: '#0EA5E9' },
  crm:                { label: 'CRM Reassignment',   icon: AlertCircle, color: '#DC2626' },
  other:              { label: 'Other',              icon: Circle,      color: 'var(--text-muted)' },
};

function statusBadge(status: ChecklistStatus) {
  const m = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: m.bg, color: m.color }}>
      <Clock size={10} />{m.label}
    </span>
  );
}

function fnfBadge(status: FnFStatus) {
  const m = FNF_STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: m.bg, color: m.color }}>
      <IndianRupee size={10} />{m.label}
    </span>
  );
}

function progressBar(items: ChecklistItem[]) {
  const done = items.filter(i => i.completed).length;
  const total = items.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-(--glass-panel-bg) rounded-full h-1.5 overflow-hidden">
        <div className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: pct === 100 ? '#16a34a' : '#ef4444' }} />
      </div>
      <span className="text-xs text-muted whitespace-nowrap">{done}/{total}</span>
    </div>
  );
}

// ─── FnF Calculator ───────────────────────────────────────────────────────────

interface FnFInputs {
  grossSalary: string;
  workingDaysInLastMonth: string;
  daysWorked: string;
  earnedLeaveBalance: string;
  joiningDateStr: string;       // DD-MM-YYYY or YYYY-MM-DD
  lastWorkingDateStr: string;   // DD-MM-YYYY or YYYY-MM-DD
  noticePeriodDays: string;
  noticePeriodServed: string;
  // Extras
  bonusAmount: string;
  fuelAmount: string;
  compOffDays: string;
  excessPaidRecovery: string;
  excessPaidRecoveryNotes: string;
  // Standard deductions
  otherDeductions: string;
  otherDeductionNotes: string;
}

/** Parse DD-MM-YYYY or YYYY-MM-DD into a Date */
function parseFlexDate(s: string): Date | null {
  if (!s) return null;
  const ddmm = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmm) return new Date(`${ddmm[3]}-${ddmm[2]}-${ddmm[1]}`);
  const iso = s.match(/^\d{4}-\d{2}-\d{2}$/);
  if (iso) return new Date(s);
  return null;
}

function computeFnF(inputs: FnFInputs): FnFDetails | null {
  const gross = parseFloat(inputs.grossSalary) || 0;
  const workDays = parseFloat(inputs.workingDaysInLastMonth) || 26;
  const daysWorked = parseFloat(inputs.daysWorked) || 0;
  const earnedLeave = parseFloat(inputs.earnedLeaveBalance) || 0;
  const noticeDays = parseFloat(inputs.noticePeriodDays) || 0;
  const noticeServed = parseFloat(inputs.noticePeriodServed) || 0;
  const bonusAmt = parseFloat(inputs.bonusAmount) || 0;
  const fuelAmt = parseFloat(inputs.fuelAmount) || 0;
  const compOffDays = parseFloat(inputs.compOffDays) || 0;
  const excessRecovery = parseFloat(inputs.excessPaidRecovery) || 0;
  const otherDed = parseFloat(inputs.otherDeductions) || 0;

  if (gross <= 0) return null;

  const basic = gross * 0.4; // approximate when separate basic not available

  const dailyRate = gross / workDays;
  const salaryForDaysWorked = dailyRate * daysWorked;

  // Leave encashment: earned only, capped at 30 days
  const cappedLeave = Math.min(earnedLeave, 30);
  const leaveEncashmentAmount = cappedLeave * dailyRate;

  // Comp Off encashment: at daily rate
  const compOffEncashmentAmount = compOffDays * dailyRate;

  // Gratuity: only if tenure >= 5 years
  const joiningDate = parseFlexDate(inputs.joiningDateStr);
  const lwdDate = parseFlexDate(inputs.lastWorkingDateStr);
  let gratuityApplicable = false;
  let gratuityAmount = 0;
  let tenureYears = 0;
  if (joiningDate && lwdDate) {
    tenureYears = differenceInYears(lwdDate, joiningDate);
    gratuityApplicable = tenureYears >= 5;
    if (gratuityApplicable) {
      // Gratuity = (basic / 26) × 15 × years of service
      gratuityAmount = Math.round((basic / 26) * 15 * tenureYears);
    }
  }

  // Notice period deduction: shortfall × daily rate
  const shortfall = Math.max(0, noticeDays - noticeServed);
  const noticePeriodDeduction = shortfall * dailyRate;

  const totalPayable =
    salaryForDaysWorked + leaveEncashmentAmount + gratuityAmount
    + bonusAmt + fuelAmt + compOffEncashmentAmount
    - noticePeriodDeduction - excessRecovery - otherDed;

  return {
    grossSalary: gross,
    workingDaysInLastMonth: workDays,
    daysWorked,
    dailyRate,
    salaryForDaysWorked,
    earnedLeaveBalance: earnedLeave,
    leaveEncashmentAmount,
    gratuityApplicable,
    gratuityAmount,
    noticePeriodDays: noticeDays,
    noticePeriodServed: noticeServed,
    noticePeriodDeduction,
    bonusAmount: bonusAmt || undefined,
    fuelAmount: fuelAmt || undefined,
    compOffDays: compOffDays || undefined,
    compOffEncashmentAmount: compOffDays ? compOffEncashmentAmount : undefined,
    excessPaidRecovery: excessRecovery || undefined,
    excessPaidRecoveryNotes: inputs.excessPaidRecoveryNotes.trim() || undefined,
    otherDeductions: otherDed,
    otherDeductionNotes: inputs.otherDeductionNotes,
    totalPayable,
    finalizedAt: null,
    finalizedBy: null,
    statementGeneratedAt: null,
  };
}

// ─── FnF PDF ──────────────────────────────────────────────────────────────────

function generateFnFPdf(checklist: OffboardingChecklist) {
  const fnf = checklist.fnfDetails!;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 20;

  // Letterhead
  pdf.setFillColor(11, 21, 56); // navy
  pdf.rect(0, 0, pageWidth, 28, 'F');
  pdf.setTextColor(201, 169, 97); // gold
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.text('FINVASTRA', margin, 13);
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(200, 200, 200);
  pdf.text('Full & Final Settlement Statement', margin, 20);

  // Title
  pdf.setTextColor(11, 21, 56);
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Full & Final Settlement', pageWidth / 2, 42, { align: 'center' });

  // Employee info
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80, 80, 80);
  const infoY = 52;
  pdf.text(`Employee: ${checklist.employeeName}`, margin, infoY);
  if (checklist.lastWorkingDate) pdf.text(`Last Working Date: ${checklist.lastWorkingDate}`, margin, infoY + 6);
  if (checklist.exitReason) pdf.text(`Exit Reason: ${EXIT_REASON_LABELS[checklist.exitReason] ?? checklist.exitReason}`, margin, infoY + 12);

  const genDate = toDate(fnf.statementGeneratedAt) ?? new Date();
  pdf.text(`Statement Generated: ${format(genDate, 'dd MMM yyyy')}`, pageWidth - margin, infoY, { align: 'right' });

  // Earnings table
  const tableY = infoY + 22;
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(11, 21, 56);
  pdf.text('Earnings', margin, tableY);

  autoTable(pdf, {
    startY: tableY + 4,
    head: [['Component', 'Calculation', 'Amount (₹)']],
    body: [
      [
        'Salary for Days Worked',
        `₹${fnf.dailyRate.toFixed(2)}/day × ${fnf.daysWorked} days`,
        fnf.salaryForDaysWorked.toFixed(2),
      ],
      [
        'Leave Encashment (Earned)',
        `${Math.min(fnf.earnedLeaveBalance, 30)} days × ₹${fnf.dailyRate.toFixed(2)}/day`,
        fnf.leaveEncashmentAmount.toFixed(2),
      ],
      ...(fnf.gratuityApplicable
        ? [['Gratuity', `Applicable (tenure ≥ 5 years)`, fnf.gratuityAmount.toFixed(2)]]
        : [['Gratuity', 'Not applicable (tenure < 5 years)', '0.00']]),
      ...(fnf.bonusAmount
        ? [['Bonus', '', fnf.bonusAmount.toFixed(2)]]
        : []),
      ...(fnf.fuelAmount
        ? [['Fuel Allowance', '', fnf.fuelAmount.toFixed(2)]]
        : []),
      ...(fnf.compOffDays
        ? [['Comp Off Encashment', `${fnf.compOffDays} days × ₹${fnf.dailyRate.toFixed(2)}/day`, (fnf.compOffEncashmentAmount ?? 0).toFixed(2)]]
        : []),
    ],
    theme: 'striped',
    headStyles: { fillColor: [11, 21, 56], textColor: [201, 169, 97], fontSize: 8 },
    styles: { fontSize: 8 },
    columnStyles: { 2: { halign: 'right' } },
    margin: { left: margin, right: margin },
  });

  const afterEarnings = (pdf as any).lastAutoTable.finalY + 8;
  pdf.setFont('helvetica', 'bold');
  pdf.text('Deductions', margin, afterEarnings);

  autoTable(pdf, {
    startY: afterEarnings + 4,
    head: [['Component', 'Calculation', 'Amount (₹)']],
    body: [
      [
        'Notice Period Deduction',
        `${Math.max(0, fnf.noticePeriodDays - fnf.noticePeriodServed)} days shortfall × ₹${fnf.dailyRate.toFixed(2)}/day`,
        fnf.noticePeriodDeduction.toFixed(2),
      ],
      ...(fnf.excessPaidRecovery
        ? [[`Excess Paid Recovery${fnf.excessPaidRecoveryNotes ? ` (${fnf.excessPaidRecoveryNotes})` : ''}`, '', fnf.excessPaidRecovery.toFixed(2)]]
        : []),
      [
        `Other Deductions${fnf.otherDeductionNotes ? ` (${fnf.otherDeductionNotes})` : ''}`,
        '',
        fnf.otherDeductions.toFixed(2),
      ],
    ],
    theme: 'striped',
    headStyles: { fillColor: [190, 18, 60], textColor: [255, 255, 255], fontSize: 8 },
    styles: { fontSize: 8 },
    columnStyles: { 2: { halign: 'right' } },
    margin: { left: margin, right: margin },
  });

  const afterDed = (pdf as any).lastAutoTable.finalY + 8;

  // Total
  pdf.setFillColor(240, 253, 244);
  pdf.roundedRect(margin, afterDed, pageWidth - 2 * margin, 14, 3, 3, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(22, 101, 52);
  pdf.text('Net Amount Payable', margin + 4, afterDed + 9);
  pdf.text(
    `₹ ${fnf.totalPayable.toFixed(2)}`,
    pageWidth - margin - 4,
    afterDed + 9,
    { align: 'right' }
  );

  // Signature section
  const sigY = afterDed + 32;
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 100, 100);
  pdf.text('Employee Signature', margin + 10, sigY + 16);
  pdf.text('HR / Management Signature', pageWidth / 2 + 10, sigY + 16);
  pdf.line(margin, sigY + 12, margin + 60, sigY + 12);
  pdf.line(pageWidth / 2, sigY + 12, pageWidth / 2 + 60, sigY + 12);

  // Footer
  const footerY = pdf.internal.pageSize.getHeight() - 10;
  pdf.setFontSize(7);
  pdf.setTextColor(150, 150, 150);
  pdf.text(
    'Finvastra Advisors Private Limited | pulse.finvastra.com | Confidential — For HR Use Only',
    pageWidth / 2,
    footerY,
    { align: 'center' }
  );

  const month = checklist.lastWorkingDate
    ? checklist.lastWorkingDate.slice(0, 7)
    : format(new Date(), 'yyyy-MM');
  const safeName = checklist.employeeName.replace(/\s+/g, '_');
  pdf.save(`FnF_${checklist.id}_${safeName}_${month}.pdf`);
}

// ─── Experience Letter PDF ────────────────────────────────────────────────────

function generateExperienceLetter(checklist: OffboardingChecklist, profile: UserProfile) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 20;
  const today = format(new Date(), 'dd MMMM yyyy');

  // Letterhead
  pdf.setFillColor(11, 21, 56);
  pdf.rect(0, 0, pageWidth, 28, 'F');
  pdf.setTextColor(201, 169, 97);
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.text('FINVASTRA', margin, 13);
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(200, 200, 200);
  pdf.text('Finvastra Advisors Private Limited', margin, 20);

  // Title
  pdf.setTextColor(11, 21, 56);
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.text('EXPERIENCE CERTIFICATE', pageWidth / 2, 42, { align: 'center' });

  // Date
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 100, 100);
  pdf.text(`Date: ${today}`, margin, 52);

  // Body
  let y = 68;
  pdf.setTextColor(30, 30, 30);
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.text('To Whom It May Concern,', margin, y);
  y += 10;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);

  const joining = profile.joiningDate ?? 'N/A';
  const lwd     = checklist.lastWorkingDate ?? 'N/A';
  const desig   = profile.designation ?? 'team member';
  const dept    = profile.department ?? 'Finvastra';
  const name    = checklist.employeeName;
  const empCode = profile.employeeId ? ` (${profile.employeeId})` : '';

  const paragraphs = [
    `This is to certify that ${name}${empCode} was employed with Finvastra Advisors`,
    `Private Limited as ${desig} in the ${dept} department from ${joining} to ${lwd}.`,
    '',
    `During ${name.split(' ')[0]}'s tenure with us, they demonstrated professionalism,`,
    'commitment, and a positive work ethic. They consistently contributed to the team',
    'and carried out their responsibilities with diligence.',
    '',
    `We wish ${name.split(' ')[0]} all the very best in their future endeavors.`,
  ];

  for (const line of paragraphs) {
    pdf.text(line, margin, y);
    y += 7;
  }

  // Signature block
  y += 16;
  pdf.line(margin, y, margin + 65, y);
  y += 5;
  pdf.setFontSize(9);
  pdf.setTextColor(60, 60, 60);
  pdf.text('Authorized Signatory', margin, y);
  y += 5;
  pdf.text('Finvastra Advisors Private Limited', margin, y);

  // Footer
  const footerY = pdf.internal.pageSize.getHeight() - 10;
  pdf.setFontSize(7);
  pdf.setTextColor(150, 150, 150);
  pdf.text('Finvastra Advisors Private Limited | pulse.finvastra.com | Confidential — For HR Use Only', pageWidth / 2, footerY, { align: 'center' });

  const safeName = name.replace(/\s+/g, '_');
  pdf.save(`ExperienceCertificate_${profile.employeeId ?? 'EMP'}_${safeName}.pdf`);
}

// ─── Relieving Letter PDF ─────────────────────────────────────────────────────

function generateRelievingLetter(checklist: OffboardingChecklist, profile: UserProfile) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 20;
  const today = format(new Date(), 'dd MMMM yyyy');

  // Letterhead
  pdf.setFillColor(11, 21, 56);
  pdf.rect(0, 0, pageWidth, 28, 'F');
  pdf.setTextColor(201, 169, 97);
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.text('FINVASTRA', margin, 13);
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(200, 200, 200);
  pdf.text('Finvastra Advisors Private Limited', margin, 20);

  // Title
  pdf.setTextColor(11, 21, 56);
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.text('RELIEVING LETTER', pageWidth / 2, 42, { align: 'center' });

  // Date + Addressee
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 100, 100);
  pdf.text(`Date: ${today}`, margin, 52);

  let y = 64;
  pdf.setTextColor(30, 30, 30);
  pdf.setFontSize(9);
  pdf.text('To,', margin, y); y += 6;
  pdf.setFont('helvetica', 'bold');
  pdf.text(checklist.employeeName, margin, y); y += 6;
  pdf.setFont('helvetica', 'normal');
  if (profile.employeeId) { pdf.text(`Employee Code: ${profile.employeeId}`, margin, y); y += 6; }
  y += 4;

  pdf.setFontSize(10);
  pdf.text(`Dear ${checklist.employeeName.split(' ')[0]},`, margin, y);
  y += 10;

  const lwd    = checklist.lastWorkingDate ?? 'N/A';
  const desig  = profile.designation ?? 'your position';
  const reason = checklist.exitReason ? EXIT_REASON_LABELS[checklist.exitReason] : null;

  const paragraphs = [
    `This is to confirm that you have been relieved from your duties as ${desig}`,
    `at Finvastra Advisors Private Limited, effective ${lwd}${reason ? ` (${reason})` : ''}.`,
    '',
    'We acknowledge that all company assets, access credentials, and pending',
    'responsibilities have been duly handed over. Your Full & Final Settlement',
    'will be processed as per company policy.',
    '',
    'We appreciate your contributions during your tenure and wish you great',
    'success in your future career.',
  ];

  for (const line of paragraphs) {
    pdf.text(line, margin, y);
    y += 7;
  }

  // Signature blocks
  y += 16;
  pdf.line(margin, y, margin + 65, y);
  pdf.line(pageWidth / 2, y, pageWidth / 2 + 65, y);
  y += 5;
  pdf.setFontSize(9);
  pdf.setTextColor(60, 60, 60);
  pdf.text('Authorized Signatory', margin, y);
  pdf.text('Employee Acknowledgement', pageWidth / 2, y);
  y += 5;
  pdf.text('Finvastra Advisors Private Limited', margin, y);

  // Footer
  const footerY = pdf.internal.pageSize.getHeight() - 10;
  pdf.setFontSize(7);
  pdf.setTextColor(150, 150, 150);
  pdf.text('Finvastra Advisors Private Limited | pulse.finvastra.com | Confidential — For HR Use Only', pageWidth / 2, footerY, { align: 'center' });

  const safeName = checklist.employeeName.replace(/\s+/g, '_');
  pdf.save(`RelievingLetter_${profile.employeeId ?? 'EMP'}_${safeName}.pdf`);
}

// ─── Tick Item Modal ──────────────────────────────────────────────────────────

function TickItemModal({
  item, checklistId, uid, onClose,
}: {
  item: ChecklistItem; checklistId: string; uid: string; onClose: () => void;
}) {
  const [notes, setNotes] = useState(item.notes ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async (complete: boolean) => {
    setSaving(true);
    try {
      const ref = doc(db, 'offboarding_checklists', checklistId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const data = snap.data() as Omit<OffboardingChecklist, 'id'>;
      const updatedItems = data.items.map(i =>
        i.id === item.id
          ? { ...i, completed: complete, completedAt: complete ? serverTimestamp() : null, completedBy: complete ? uid : null, notes: notes.trim() || null }
          : i
      );
      const allDone = updatedItems.every(i => i.completed);
      const anyDone = updatedItems.some(i => i.completed);
      const newStatus: ChecklistStatus = allDone ? 'completed' : anyDone ? 'in_progress' : 'pending';
      await updateDoc(ref, {
        items: updatedItems,
        status: newStatus,
        completedAt: allDone ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setSaving(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-base font-semibold text-(--text-primary)">{item.task}</h3>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Notes (optional)</label>
          <textarea className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-gold/30"
            rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add a note…" />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} disabled={saving}
            className="flex-1 border border-(--shell-border) rounded-xl py-2 text-sm font-medium text-muted hover:bg-(--glass-panel-bg) transition-colors">
            Cancel
          </button>
          {item.completed && (
            <button onClick={() => handleSave(false)} disabled={saving}
              className="flex-1 border border-amber-200 rounded-xl py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 transition-colors">
              Mark Incomplete
            </button>
          )}
          {!item.completed && (
            <button onClick={() => handleSave(true)} disabled={saving}
              className="flex-1 bg-navy text-white rounded-xl py-2 text-sm font-semibold hover:bg-navy-soft transition-colors flex items-center justify-center gap-1.5">
              <Check size={14} />Mark Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── FnF Calculator Modal ─────────────────────────────────────────────────────

function FnFCalculatorModal({
  checklist, currentUid, onClose,
}: {
  checklist: OffboardingChecklist; currentUid: string; onClose: () => void;
}) {
  const existing = checklist.fnfDetails;
  const [inputs, setInputs] = useState<FnFInputs>({
    grossSalary:            existing ? String(existing.grossSalary) : '',
    workingDaysInLastMonth: existing ? String(existing.workingDaysInLastMonth) : '26',
    daysWorked:             existing ? String(existing.daysWorked) : '',
    earnedLeaveBalance:     existing ? String(existing.earnedLeaveBalance) : '',
    joiningDateStr:         '',
    lastWorkingDateStr:     checklist.lastWorkingDate ?? '',
    noticePeriodDays:       existing ? String(existing.noticePeriodDays) : '30',
    noticePeriodServed:     existing ? String(existing.noticePeriodServed) : '',
    bonusAmount:            existing?.bonusAmount ? String(existing.bonusAmount) : '',
    fuelAmount:             existing?.fuelAmount ? String(existing.fuelAmount) : '',
    compOffDays:            existing?.compOffDays ? String(existing.compOffDays) : '',
    excessPaidRecovery:     existing?.excessPaidRecovery ? String(existing.excessPaidRecovery) : '',
    excessPaidRecoveryNotes:existing?.excessPaidRecoveryNotes ?? '',
    otherDeductions:        existing ? String(existing.otherDeductions) : '0',
    otherDeductionNotes:    existing?.otherDeductionNotes ?? '',
  });
  const [saving, setSaving] = useState(false);

  // Auto-fill grossSalary from employee_sensitive when opening a fresh FnF (no existing data).
  // Admin can override. Only runs once on mount when no fnfDetails yet.
  useEffect(() => {
    if (existing) return; // already has saved data — don't overwrite
    getDoc(doc(db, 'employee_sensitive', checklist.id)).then((snap) => {
      if (!snap.exists()) return;
      const d = snap.data() as { grossSalary?: number };
      if (d.grossSalary) {
        setInputs((prev) => ({ ...prev, grossSalary: String(d.grossSalary) }));
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const result = useMemo(() => computeFnF(inputs), [inputs]);

  const set = (k: keyof FnFInputs) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setInputs(prev => ({ ...prev, [k]: e.target.value }));

  const handleSave = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const finalResult: FnFDetails = {
        ...result,
        finalizedAt: serverTimestamp() as any,
        finalizedBy: currentUid,
        statementGeneratedAt: null,
      };
      await updateDoc(doc(db, 'offboarding_checklists', checklist.id), {
        fnfDetails: finalResult,
        fnfStatus: 'calculated',
        updatedAt: serverTimestamp(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = "w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold/30";
  const labelClass = "block text-xs font-medium text-muted mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-2xl my-4">
        <div className="px-6 py-4 border-b border-(--shell-border) flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calculator size={18} style={{ color: '#C9A961' }} />
            <h3 className="text-base font-semibold text-(--text-primary)">FnF Calculator — {checklist.employeeName}</h3>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Salary inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Gross Monthly Salary (₹) *</label>
              <input type="number" className={fieldClass} value={inputs.grossSalary} onChange={set('grossSalary')} placeholder="e.g. 45000" />
            </div>
            <div>
              <label className={labelClass}>Working Days in Last Month</label>
              <input type="number" className={fieldClass} value={inputs.workingDaysInLastMonth} onChange={set('workingDaysInLastMonth')} placeholder="26" />
            </div>
            <div>
              <label className={labelClass}>Days Worked in Last Month *</label>
              <input type="number" className={fieldClass} value={inputs.daysWorked} onChange={set('daysWorked')} placeholder="e.g. 18" />
            </div>
            <div>
              <label className={labelClass}>Earned Leave Balance (days)</label>
              <input type="number" className={fieldClass} value={inputs.earnedLeaveBalance} onChange={set('earnedLeaveBalance')} placeholder="e.g. 10 (max 30 encashed)" />
            </div>
          </div>

          {/* Tenure */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Joining Date (for gratuity)</label>
              <input type="text" className={fieldClass} value={inputs.joiningDateStr} onChange={set('joiningDateStr')} placeholder="DD-MM-YYYY or YYYY-MM-DD" />
            </div>
            <div>
              <label className={labelClass}>Last Working Date</label>
              <input type="text" className={fieldClass} value={inputs.lastWorkingDateStr} onChange={set('lastWorkingDateStr')} placeholder="DD-MM-YYYY or YYYY-MM-DD" />
            </div>
          </div>

          {/* Notice */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Notice Period (days)</label>
              <input type="number" className={fieldClass} value={inputs.noticePeriodDays} onChange={set('noticePeriodDays')} placeholder="30" />
            </div>
            <div>
              <label className={labelClass}>Notice Period Served (days)</label>
              <input type="number" className={fieldClass} value={inputs.noticePeriodServed} onChange={set('noticePeriodServed')} placeholder="e.g. 15" />
            </div>
          </div>

          {/* Additional earnings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Bonus Amount (₹)</label>
              <input type="number" className={fieldClass} value={inputs.bonusAmount} onChange={set('bonusAmount')} placeholder="0" />
            </div>
            <div>
              <label className={labelClass}>Fuel Allowance (₹)</label>
              <input type="number" className={fieldClass} value={inputs.fuelAmount} onChange={set('fuelAmount')} placeholder="0" />
            </div>
            <div>
              <label className={labelClass}>Comp Off Encashment (days)</label>
              <input type="number" className={fieldClass} value={inputs.compOffDays} onChange={set('compOffDays')} placeholder="0" />
            </div>
          </div>

          {/* Additional deductions */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Excess Paid Recovery (₹)</label>
              <input type="number" className={fieldClass} value={inputs.excessPaidRecovery} onChange={set('excessPaidRecovery')} placeholder="0" />
            </div>
            <div>
              <label className={labelClass}>Recovery Notes</label>
              <input type="text" className={fieldClass} value={inputs.excessPaidRecoveryNotes} onChange={set('excessPaidRecoveryNotes')} placeholder="e.g. Advance adjustment" />
            </div>
          </div>

          {/* Other deductions */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Other Deductions (₹)</label>
              <input type="number" className={fieldClass} value={inputs.otherDeductions} onChange={set('otherDeductions')} placeholder="0" />
            </div>
            <div>
              <label className={labelClass}>Deduction Notes</label>
              <input type="text" className={fieldClass} value={inputs.otherDeductionNotes} onChange={set('otherDeductionNotes')} placeholder="e.g. Advance recovery" />
            </div>
          </div>

          {/* Preview */}
          {result && (
            <div className="bg-(--glass-panel-bg) rounded-2xl p-4 space-y-2 text-sm">
              <p className="font-semibold text-(--text-primary) mb-3">Breakdown Preview</p>
              {/* Earnings */}
              {[
                ['Daily Rate', formatCurrency(result.dailyRate)],
                ['Salary for Days Worked', formatCurrency(result.salaryForDaysWorked)],
                ['Leave Encashment', formatCurrency(result.leaveEncashmentAmount)],
                [`Gratuity${result.gratuityApplicable ? '' : ' (not applicable)'}`, formatCurrency(result.gratuityAmount)],
                ...(result.bonusAmount ? [['Bonus', formatCurrency(result.bonusAmount)]] : []),
                ...(result.fuelAmount  ? [['Fuel Allowance', formatCurrency(result.fuelAmount)]] : []),
                ...(result.compOffDays ? [['Comp Off Encashment', formatCurrency(result.compOffEncashmentAmount ?? 0)]] : []),
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted">{label}</span>
                  <span className="font-medium text-(--text-primary)">{val}</span>
                </div>
              ))}
              <div className="border-t border-(--shell-border) my-2" />
              {/* Deductions */}
              {[
                ['Notice Deduction', `-${formatCurrency(result.noticePeriodDeduction)}`],
                ...(result.excessPaidRecovery ? [['Excess Paid Recovery', `-${formatCurrency(result.excessPaidRecovery)}`]] : []),
                ['Other Deductions', `-${formatCurrency(result.otherDeductions)}`],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted">{label}</span>
                  <span className="font-medium text-red-600">{val}</span>
                </div>
              ))}
              <div className="border-t border-(--shell-border) mt-2 pt-2 flex justify-between">
                <span className="font-bold text-(--text-primary)">Net Payable</span>
                <span className="font-bold text-lg" style={{ color: result.totalPayable >= 0 ? '#166534' : '#BE123C' }}>
                  {formatCurrency(result.totalPayable)}
                </span>
              </div>
            </div>
          )}

          {!result && (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-xl p-3">
              <AlertCircle size={15} />
              Enter gross salary and days worked to see the calculation.
            </div>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose} disabled={saving}
            className="flex-1 border border-(--shell-border) rounded-xl py-2 text-sm font-medium text-muted hover:bg-(--glass-panel-bg) transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!result || saving}
            className="flex-1 bg-navy text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-navy-soft transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50">
            <Check size={14} />Save FnF Calculation
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Settle FnF Modal ─────────────────────────────────────────────────────────

function SettleFnFModal({
  checklist, currentUid, onClose,
}: {
  checklist: OffboardingChecklist; currentUid: string; onClose: () => void;
}) {
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSettle = async () => {
    if (!reference.trim()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'offboarding_checklists', checklist.id), {
        fnfStatus: 'settled',
        fnfSettledAt: serverTimestamp(),
        fnfSettledBy: currentUid,
        'fnfDetails.statementGeneratedAt': serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } finally {
      setSaving(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-semibold text-(--text-primary)">Mark FnF as Settled</h3>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Payment Date *</label>
          <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
            className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold/30" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Payment Reference / UTR *</label>
          <input type="text" value={reference} onChange={e => setReference(e.target.value)}
            placeholder="e.g. UTR123456789"
            className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold/30" />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} disabled={saving}
            className="flex-1 border border-(--shell-border) rounded-xl py-2 text-sm font-medium text-muted hover:bg-(--glass-panel-bg) transition-colors">Cancel</button>
          <button onClick={handleSettle} disabled={!reference.trim() || saving}
            className="flex-1 bg-green-600 text-white rounded-xl py-2 text-sm font-semibold hover:bg-green-700 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50">
            <Check size={14} />Mark Settled
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail View ──────────────────────────────────────────────────────────────

function ChecklistDetail({
  checklist, currentUid, onBack,
}: {
  checklist: OffboardingChecklist; currentUid: string; onBack: () => void;
}) {
  const [tickingItem, setTickingItem] = useState<ChecklistItem | null>(null);
  const [showFnFCalc, setShowFnFCalc] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [empProfile, setEmpProfile] = useState<UserProfile | null>(null);

  // Fetch employee profile (for letter generation) once on mount
  useEffect(() => {
    getDoc(doc(db, 'users', checklist.id)).then((snap) => {
      if (snap.exists()) setEmpProfile(snap.data() as UserProfile);
    }).catch(() => {});
  }, [checklist.id]);

  const handleExperienceLetter = () => {
    if (!empProfile) return;
    generateExperienceLetter(live, empProfile);
  };

  const handleRelievingLetter = () => {
    if (!empProfile) return;
    generateRelievingLetter(live, empProfile);
  };

  // Subscribe to live updates for this checklist
  const [live, setLive] = useState<OffboardingChecklist>(checklist);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'offboarding_checklists', checklist.id), snap => {
      if (snap.exists()) setLive({ id: snap.id, ...snap.data() } as OffboardingChecklist);
    });
    return unsub;
  }, [checklist.id]);

  // CRM reassignment item is rendered separately at the top if present
  const crmItem = live.items.find((i) => i.id === 'crm_reassignment');
  const crmReassigned = !crmItem || crmItem.completed;
  const nonCrmItems = live.items.filter((i) => i.id !== 'crm_reassignment');

  const grouped = Object.entries(
    nonCrmItems.reduce<Record<string, ChecklistItem[]>>((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {})
  ) as [ChecklistItemCategory, ChecklistItem[]][];

  const done = live.items.filter(i => i.completed).length;
  const total = live.items.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={onBack} className="mt-0.5 p-2 rounded-xl border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold text-(--text-primary)">{live.employeeName}</h2>
            {statusBadge(live.status)}
            {fnfBadge(live.fnfStatus)}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted mt-1 flex-wrap">
            {live.lastWorkingDate && <span>LWD: {live.lastWorkingDate}</span>}
            {live.exitReason && <span>Exit: {EXIT_REASON_LABELS[live.exitReason]}</span>}
          </div>
        </div>
      </div>

      {/* CRM Reassignment — shown at top when present and not yet done */}
      {crmItem && (
        <div className={`rounded-2xl border-2 p-5 shadow-sm ${crmItem.completed ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'}`}>
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="shrink-0 mt-0.5" style={{ color: crmItem.completed ? '#166534' : '#DC2626' }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: crmItem.completed ? '#166534' : '#DC2626' }}>
                {crmItem.completed ? 'CRM Reassignment Complete ✓' : 'Action Required: CRM Reassignment'}
              </p>
              <p className="text-sm mt-1" style={{ color: crmItem.completed ? '#166534' : '#991B1B' }}>
                {crmItem.task}
              </p>
              {!crmItem.completed && (
                <div className="flex items-center gap-3 mt-3">
                  <a
                    href={(crmItem as ChecklistItem & { metadata?: { reassignUrl?: string } }).metadata?.reassignUrl ?? '/crm/leads'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                    style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}
                  >
                    <ExternalLink size={12} />
                    Go to CRM to reassign →
                  </a>
                  <button
                    onClick={() => setTickingItem(crmItem)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-300 transition-colors hover:bg-red-100"
                    style={{ color: '#DC2626' }}
                  >
                    <Check size={12} />
                    Mark as done
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-(--text-primary)">Checklist Progress</span>
          <span className="text-2xl font-bold" style={{ color: pct === 100 ? '#16a34a' : '#ef4444' }}>{pct}%</span>
        </div>
        <div className="bg-(--glass-panel-bg) rounded-full h-2.5 overflow-hidden">
          <div className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: pct === 100 ? '#16a34a' : '#ef4444' }} />
        </div>
        <p className="text-xs text-muted mt-2">{done} of {total} tasks completed</p>
      </div>

      {/* FnF panel */}
      <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IndianRupee size={16} style={{ color: '#C9A961' }} />
            <span className="text-sm font-semibold text-(--text-primary)">Full &amp; Final Settlement</span>
          </div>
          {fnfBadge(live.fnfStatus)}
        </div>

        {live.fnfDetails && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs text-muted">Net Payable</p>
              <p className="font-bold text-lg" style={{ color: live.fnfDetails.totalPayable >= 0 ? '#166534' : '#BE123C' }}>
                {formatCurrency(live.fnfDetails.totalPayable)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Gross Salary Basis</p>
              <p className="font-medium">{formatCurrency(live.fnfDetails.grossSalary)}/mo</p>
            </div>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowFnFCalc(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
            <Calculator size={13} />
            {live.fnfDetails ? 'Recalculate FnF' : 'Calculate FnF'}
          </button>
          {live.fnfDetails && live.fnfStatus !== 'settled' && (
            <div className="relative group inline-flex">
              <button
                onClick={() => crmReassigned && setShowSettle(true)}
                disabled={!crmReassigned}
                title={!crmReassigned ? 'Reassign all open CRM items before settling FnF.' : undefined}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors"
                style={{
                  backgroundColor: crmReassigned ? '#16a34a' : '#D1FAE5',
                  color: crmReassigned ? '#FFFFFF' : '#6B7280',
                  cursor: crmReassigned ? 'pointer' : 'not-allowed',
                }}
              >
                <Check size={13} />Mark FnF as Settled
              </button>
              {!crmReassigned && (
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs bg-slate-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  Reassign all open CRM items before settling FnF.
                </span>
              )}
            </div>
          )}
          {live.fnfDetails && (
            <button
              onClick={() => {
                const withTimestamp: OffboardingChecklist = {
                  ...live,
                  fnfDetails: {
                    ...live.fnfDetails!,
                    statementGeneratedAt: live.fnfDetails!.statementGeneratedAt ?? { toDate: () => new Date() } as any,
                  },
                };
                generateFnFPdf(withTimestamp);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
              <Download size={13} />Download FnF PDF
            </button>
          )}
        </div>

        {live.fnfStatus === 'settled' && live.fnfSettledAt && (
          <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">
            Settled on {format(toDate(live.fnfSettledAt)!, 'dd MMM yyyy')}
          </p>
        )}
      </div>

      {/* Checklist items by category */}
      {grouped.map(([cat, items]) => {
        const meta = CATEGORY_META[cat] ?? CATEGORY_META.other;
        const catDone = items.filter(i => i.completed).length;
        return (
          <div key={cat} className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-(--shell-border)"
              style={{ background: `${meta.color}10` }}>
              <meta.icon size={15} style={{ color: meta.color }} />
              <span className="text-sm font-semibold" style={{ color: meta.color }}>{meta.label}</span>
              <span className="ml-auto text-xs text-muted">{catDone}/{items.length}</span>
            </div>
            <ul className="divide-y divide-(--shell-border)">
              {items.map(item => (
                <li key={item.id}
                  className={`flex items-start gap-3 px-5 py-3 transition-colors ${item.completed && item.task.toLowerCase().includes('disabled') ? 'opacity-60' : 'hover:bg-(--glass-panel-bg) cursor-pointer'}`}
                  onClick={() => !item.task.toLowerCase().includes('disabled') && setTickingItem(item)}>
                  <div className="mt-0.5 flex-shrink-0">
                    {item.completed
                      ? <CheckCircle2 size={18} className="text-green-500" />
                      : <div className="w-[18px] h-[18px] rounded-full border-2 border-(--shell-border-mid)" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${item.completed ? 'line-through text-muted' : 'text-(--text-primary)'}`}>{item.task}</p>
                    {item.notes && <p className="text-xs text-muted mt-0.5 truncate">{item.notes}</p>}
                    {item.completedAt && <p className="text-xs text-muted mt-0.5">{format(toDate(item.completedAt)!, 'dd MMM yyyy')}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {/* HR Letters */}
      <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <FileText size={16} style={{ color: '#C9A961' }} />
          <span className="text-sm font-semibold text-(--text-primary)">HR Letters</span>
        </div>
        {!empProfile && (
          <p className="text-xs text-muted">Loading employee data…</p>
        )}
        {empProfile && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={handleExperienceLetter}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
              <Download size={13} />Experience Certificate
            </button>
            <button onClick={handleRelievingLetter}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
              <Download size={13} />Relieving Letter
            </button>
          </div>
        )}
      </div>

      {tickingItem && (
        <TickItemModal item={tickingItem} checklistId={live.id} uid={currentUid} onClose={() => setTickingItem(null)} />
      )}
      {showFnFCalc && (
        <FnFCalculatorModal checklist={live} currentUid={currentUid} onClose={() => setShowFnFCalc(false)} />
      )}
      {showSettle && (
        <SettleFnFModal checklist={live} currentUid={currentUid} onClose={() => setShowSettle(false)} />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export type OffboardingFilter = 'all' | ChecklistStatus | 'fnf_pending' | 'fnf_settled';

export function OffboardingPage() {
  const { profile, user } = useAuth();

  // All hooks before guard
  const [checklists, setChecklists] = useState<OffboardingChecklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<OffboardingFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<OffboardingChecklist | null>(null);

  const isAdmin = profile?.role === 'admin';
  const isHrmsManager = !!profile?.isHrmsManager;
  const canAccess = isAdmin || isHrmsManager;

  useEffect(() => {
    if (!canAccess) return;
    const q = query(collection(db, 'offboarding_checklists'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setChecklists(snap.docs.map(d => ({ id: d.id, ...d.data() } as OffboardingChecklist)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [canAccess]);

  // Guard after hooks
  if (profile && !canAccess) return <Navigate to="/hrms/dashboard" replace />;

  const filtered = checklists.filter(c => {
    if (filter === 'fnf_pending') return c.fnfStatus === 'pending' || c.fnfStatus === 'calculated';
    if (filter === 'fnf_settled') return c.fnfStatus === 'settled';
    if (filter !== 'all' && c.status !== filter) return false;
    if (search && !c.employeeName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).filter(c => !search || c.employeeName.toLowerCase().includes(search.toLowerCase()));

  const counts = {
    pending:     checklists.filter(c => c.status === 'pending').length,
    in_progress: checklists.filter(c => c.status === 'in_progress').length,
    completed:   checklists.filter(c => c.status === 'completed').length,
    fnf_pending: checklists.filter(c => c.fnfStatus !== 'settled').length,
    fnf_settled: checklists.filter(c => c.fnfStatus === 'settled').length,
  };

  if (selected) {
    return (
      <div className="max-w-2xl mx-auto">
        <ChecklistDetail
          checklist={selected}
          currentUid={user?.uid ?? ''}
          onBack={() => setSelected(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="p-2 rounded-xl" style={{ background: '#FFF1F2' }}>
              <UserMinus size={20} style={{ color: '#BE123C' }} />
            </span>
            Offboarding
          </span>
        }
        subtitle={`${checklists.length} checklist${checklists.length !== 1 ? 's' : ''}`}
        pinKey="hrms.offboarding"
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {([
          ['all',         checklists.length, '#F8FAFC', 'var(--text-muted)', 'All'],
          ['pending',     counts.pending,    '#FFFBEB', '#92400E', 'Pending'],
          ['in_progress', counts.in_progress,'#EFF6FF', '#1D4ED8', 'In Progress'],
          ['completed',   counts.completed,  '#F0FDF4', '#166534', 'Completed'],
          ['fnf_pending', counts.fnf_pending,'#FFF1F2', '#BE123C', 'FnF Pending'],
        ] as const).map(([f, n, bg, color, label]) => (
          <button key={f}
            onClick={() => setFilter(filter === f ? 'all' : f)}
            className="rounded-2xl p-3 text-left border transition-all"
            style={{
              background: bg,
              borderColor: filter === f ? color : 'transparent',
              outline: filter === f ? `2px solid ${color}` : undefined,
            }}>
            <p className="text-xl font-bold" style={{ color }}>{n}</p>
            <p className="text-xs font-medium mt-0.5" style={{ color }}>{label}</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <input type="search" placeholder="Search by employee name…" value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold/30" />

      {/* List */}
      {loading ? (
        <div className="text-center py-16 text-muted text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted text-sm">No checklists found.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => {
            const done = c.items.filter(i => i.completed).length;
            const total = c.items.length;
            const pct = total === 0 ? 0 : Math.round((done / total) * 100);
            const createdDate = toDate(c.createdAt);
            const isFnFUrgent = c.fnfStatus !== 'settled';

            return (
              <button key={c.id} onClick={() => setSelected(c)}
                className="w-full bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-5 shadow-sm text-left hover:border-red-200 hover:shadow-md transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-(--text-primary)">{c.employeeName}</span>
                      {statusBadge(c.status)}
                      {isFnFUrgent && fnfBadge(c.fnfStatus)}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted mt-0.5 flex-wrap">
                      {c.lastWorkingDate && <span>LWD: {c.lastWorkingDate}</span>}
                      {c.exitReason && <span>{EXIT_REASON_LABELS[c.exitReason]}</span>}
                      {createdDate && <span>Created {format(createdDate, 'dd MMM yyyy')}</span>}
                    </div>
                  </div>
                  <span className="text-lg font-bold shrink-0"
                    style={{ color: pct === 100 ? '#16a34a' : '#ef4444' }}>
                    {pct}%
                  </span>
                </div>
                <div className="mt-3">
                  {progressBar(c.items)}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
