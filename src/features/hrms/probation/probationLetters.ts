/**
 * The two probation PDFs: the confirmation letter and the extension letter.
 * 
 * Extracted verbatim from ProbationPage.tsx (2026-07-23) - same jsPDF
 * letterhead styling as the other HR letters.
 */
import jsPDF from 'jspdf';
import { format } from 'date-fns';
import type { ProbationRecord } from '../../../types';
import { fmtDate, toDate } from './ProbationPage';

// ─── PDF generation ───────────────────────────────────────────────────────────

export function downloadConfirmationLetter(record: ProbationRecord): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 20;

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(11, 21, 56);
  doc.text('FINVASTRA ADVISORS PRIVATE LIMITED', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(139, 139, 133);
  doc.text('Hyderabad · pulse.finvastra.com', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setDrawColor(201, 169, 97);
  doc.setLineWidth(0.6);
  doc.line(20, y, pageW - 20, y);
  y += 10;

  // Reference and date
  const today = format(new Date(), 'd MMM yyyy');
  const empCode = record.employeeCode ?? record.employeeId.slice(-6).toUpperCase();
  doc.setFontSize(9);
  doc.setTextColor(42, 42, 42);
  doc.text(`Ref: FAPL/${empCode}/HRMS/${format(new Date(), 'yyyy')}`, 20, y);
  doc.text(`Date: ${today}`, pageW - 20, y, { align: 'right' });
  y += 10;

  // Subject line
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(10, 10, 10);
  doc.text('Subject: Confirmation of Employment', 20, y);
  y += 10;

  // Salutation
  const firstName = record.employeeName.split(' ')[0];
  doc.setFont('helvetica', 'normal');
  doc.text(`Dear ${firstName},`, 20, y);
  y += 8;

  // Body paragraphs
  const bodyStyle = { maxWidth: pageW - 40 };
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(42, 42, 42);

  const para1 =
    `With reference to your appointment dated ${fmtDate(record.joiningDate)}, we are pleased to ` +
    `inform you that upon review of your performance during the probation period ending ` +
    `${fmtDate(record.probationEndDate)}, the management has decided to confirm your appointment ` +
    `as a Permanent Employee of Finvastra Advisors Private Limited`;
  const lines1 = doc.splitTextToSize(para1, bodyStyle.maxWidth);
  doc.text(lines1, 20, y);
  y += (lines1.length * 5) + 6;

  const confirmedDate = record.confirmedAt
    ? format(toDate(record.confirmedAt) ?? new Date(), 'd MMM yyyy')
    : today;
  const para2 =
    `Your employment as ${record.designation ?? 'Employee'} in the ${record.department ?? 'department'} ` +
    `is confirmed with effect from ${confirmedDate}. Your terms and conditions of employment remain ` +
    `unchanged as per your appointment letter.`;
  const lines2 = doc.splitTextToSize(para2, bodyStyle.maxWidth);
  doc.text(lines2, 20, y);
  y += (lines2.length * 5) + 6;

  const para3 =
    `We appreciate your contribution to the organisation and look forward to your continued ` +
    `dedication and excellent performance. We wish you a rewarding career with us.`;
  const lines3 = doc.splitTextToSize(para3, bodyStyle.maxWidth);
  doc.text(lines3, 20, y);
  y += (lines3.length * 5) + 20;

  // Closing
  doc.setFont('helvetica', 'normal');
  doc.text('Yours sincerely,', 20, y);
  y += 15;
  doc.setFont('helvetica', 'bold');
  doc.text('For Finvastra Advisors Private Limited', 20, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(139, 139, 133);
  doc.text('Human Resources', 20, y);
  y += 25;

  // Employee acknowledgement
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(20, y, pageW / 2 - 10, y);
  doc.line(pageW / 2 + 10, y, pageW - 20, y);
  y += 4;
  doc.setFontSize(8);
  doc.setTextColor(139, 139, 133);
  doc.text('Authorised Signatory', 20, y);
  doc.text('Employee Acknowledgement', pageW / 2 + 10, y);
  y += 4;
  doc.text(`Date: ${today}`, 20, y);
  doc.text('Date: _______________', pageW / 2 + 10, y);

  const filename = `Probation_Confirmation_${empCode}_${record.employeeName.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
}

export function downloadExtensionLetter(record: ProbationRecord): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 20;

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(11, 21, 56);
  doc.text('FINVASTRA ADVISORS PRIVATE LIMITED', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(139, 139, 133);
  doc.text('Hyderabad · pulse.finvastra.com', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setDrawColor(201, 169, 97);
  doc.setLineWidth(0.6);
  doc.line(20, y, pageW - 20, y);
  y += 10;

  const today = format(new Date(), 'd MMM yyyy');
  const empCode = record.employeeCode ?? record.employeeId.slice(-6).toUpperCase();
  doc.setFontSize(9);
  doc.setTextColor(42, 42, 42);
  doc.text(`Ref: FAPL/${empCode}/HRMS/${format(new Date(), 'yyyy')}`, 20, y);
  doc.text(`Date: ${today}`, pageW - 20, y, { align: 'right' });
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(10, 10, 10);
  doc.text('Subject: Extension of Probation Period', 20, y);
  y += 10;

  const firstName = record.employeeName.split(' ')[0];
  doc.setFont('helvetica', 'normal');
  doc.text(`Dear ${firstName},`, 20, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(42, 42, 42);

  const para1 =
    `With reference to your appointment dated ${fmtDate(record.joiningDate)}, we wish to inform you ` +
    `that your probation period, which was scheduled to end on ${fmtDate(record.probationEndDate)}, ` +
    `has been extended as detailed below.`;
  const lines1 = doc.splitTextToSize(para1, pageW - 40);
  doc.text(lines1, 20, y);
  y += (lines1.length * 5) + 8;

  // Extension table
  const newEnd = record.extensionEndDate ?? record.probationEndDate;
  doc.setFont('helvetica', 'bold');
  doc.text('Extended Probation End Date:', 20, y);
  doc.setFont('helvetica', 'normal');
  doc.text(fmtDate(newEnd), 90, y);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text('Reason for Extension:', 20, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  const reasonLines = doc.splitTextToSize(record.extensionReason ?? '—', pageW - 40);
  doc.text(reasonLines, 20, y);
  y += (reasonLines.length * 5) + 8;

  const para2 =
    `Your performance will be reviewed at the end of the extended probation period. You are ` +
    `expected to demonstrate significant improvement in the areas highlighted and maintain ` +
    `the highest standard of professionalism.`;
  const lines2 = doc.splitTextToSize(para2, pageW - 40);
  doc.text(lines2, 20, y);
  y += (lines2.length * 5) + 20;

  doc.setFont('helvetica', 'normal');
  doc.text('Yours sincerely,', 20, y);
  y += 15;
  doc.setFont('helvetica', 'bold');
  doc.text('For Finvastra Advisors Private Limited', 20, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(139, 139, 133);
  doc.text('Human Resources', 20, y);
  y += 25;

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(20, y, pageW / 2 - 10, y);
  doc.line(pageW / 2 + 10, y, pageW - 20, y);
  y += 4;
  doc.setFontSize(8);
  doc.setTextColor(139, 139, 133);
  doc.text('Authorised Signatory', 20, y);
  doc.text('Employee Acknowledgement', pageW / 2 + 10, y);
  y += 4;
  doc.text(`Date: ${today}`, 20, y);
  doc.text('Date: _______________', pageW / 2 + 10, y);

  const filename = `Probation_Extension_${empCode}_${record.employeeName.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
}
