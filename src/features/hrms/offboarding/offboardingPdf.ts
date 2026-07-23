/**
 * The three PDFs the offboarding flow produces: the FnF settlement statement,
 * the experience certificate and the relieving letter.
 * 
 * Extracted verbatim from OffboardingPage.tsx (2026-07-23) - no behaviour
 * change. Kept together because they share the same jsPDF letterhead styling.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import type { OffboardingChecklist, UserProfile } from '../../../types';
import { EXIT_REASON_LABELS } from '../../../types';
import { toDate } from './OffboardingPage';
// ─── FnF PDF ──────────────────────────────────────────────────────────────────

export function generateFnFPdf(checklist: OffboardingChecklist) {
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

export function generateExperienceLetter(checklist: OffboardingChecklist, profile: UserProfile) {
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

export function generateRelievingLetter(checklist: OffboardingChecklist, profile: UserProfile) {
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
