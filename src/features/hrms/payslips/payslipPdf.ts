import { jsPDF } from 'jspdf';
import { addWatermarkToAllPages } from '../../../lib/pdfWatermark';
import type { Payslip, UserProfile } from '../../../types';

export function generatePayslipPdf(payslip: Payslip, employee: UserProfile): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 20;

  // ─── HEADER ──────────────────────────────────────────────────────────────────
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(11, 21, 56);   // navy
  doc.text('FINVASTRA', pageW / 2, y, { align: 'center' });
  y += 7;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(139, 139, 133); // mute
  doc.text('Payslip', pageW / 2, y, { align: 'center' });
  y += 12;

  // ─── Employee info block ──────────────────────────────────────────────────────
  const monthLabel = (() => {
    const [yr, mo] = payslip.month.split('-');
    return new Date(+yr, +mo - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  })();

  doc.setTextColor(42, 42, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(employee.displayName, 20, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  y += 5;
  doc.text(`Employee ID: ${employee.employeeId ?? employee.userId.slice(-8).toUpperCase()}`, 20, y);
  if (employee.designation) { y += 4; doc.text(`Designation: ${employee.designation}`, 20, y); }
  y += 4;
  doc.text(`Pay Period: ${monthLabel}`, 20, y);
  y += 10;

  // ─── Horizontal rule ─────────────────────────────────────────────────────────
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.line(20, y, pageW - 20, y);
  y += 6;

  // ─── Two-column layout: Earnings | Deductions ────────────────────────────────
  const colW = (pageW - 50) / 2;  // half width with margins
  const leftX = 20;
  const rightX = leftX + colW + 10;

  function sectionHeader(x: number, label: string, yPos: number): number {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(139, 139, 133);
    doc.text(label.toUpperCase(), x, yPos);
    return yPos + 5;
  }

  function row(x: number, label: string, value: number, yPos: number, bold = false): number {
    doc.setFontSize(9);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setTextColor(bold ? 10 : 42, bold ? 10 : 42, bold ? 10 : 42);
    doc.text(label, x, yPos);
    doc.text(`₹${value.toLocaleString('en-IN')}`, x + colW - 5, yPos, { align: 'right' });
    return yPos + 5;
  }

  // Earnings column
  let lY = sectionHeader(leftX, 'Earnings', y);
  lY = row(leftX, 'Basic Salary',         payslip.basicSalary,         lY);
  lY = row(leftX, 'HRA',                  payslip.hra,                 lY);
  lY = row(leftX, 'Conveyance Allowance', payslip.conveyanceAllowance, lY);
  lY = row(leftX, 'Medical Allowance',    payslip.medicalAllowance,    lY);
  lY = row(leftX, 'Other Allowances',     payslip.otherAllowances,     lY);
  lY += 2;
  doc.setDrawColor(226, 232, 240);
  doc.line(leftX, lY, leftX + colW, lY);
  lY += 3;
  lY = row(leftX, 'Total Earnings', payslip.totalEarnings, lY, true);

  // Deductions column
  let rY = sectionHeader(rightX, 'Deductions', y);
  rY = row(rightX, 'Provident Fund',                    payslip.pf,               rY);
  // Only render PT row if non-zero (employees below ₹15,000 gross are exempt)
  if (payslip.professionalTax > 0) {
    rY = row(rightX, 'Professional Tax (PT)',           payslip.professionalTax,  rY);
  }
  rY = row(rightX, 'TDS',                               payslip.tds,              rY);
  if (payslip.lopDays > 0) {
    rY = row(rightX, `LOP (${payslip.lopDays} days)`,  payslip.otherDeductions,  rY);
  }
  rY = row(rightX, 'Other Deductions',                  payslip.otherDeductions,  rY);
  rY += 2;
  doc.line(rightX, rY, rightX + colW, rY);
  rY += 3;
  rY = row(rightX, 'Total Deductions', payslip.totalDeductions, rY, true);

  // Advance y past both columns
  y = Math.max(lY, rY) + 8;

  // ─── Net Pay box ─────────────────────────────────────────────────────────────
  doc.setFillColor(201, 169, 97);  // gold
  doc.roundedRect(20, y, pageW - 40, 14, 3, 3, 'F');
  doc.setTextColor(11, 21, 56);  // navy
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Net Pay', 28, y + 9);
  doc.text(`₹${payslip.netPay.toLocaleString('en-IN')}`, pageW - 22, y + 9, { align: 'right' });
  y += 22;

  // ─── Attendance summary ───────────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(139, 139, 133);
  doc.text(
    `Attendance: Working Days ${payslip.workingDays} | Present ${payslip.presentDays} | LOP ${payslip.lopDays}`,
    pageW / 2, y, { align: 'center' }
  );
  y += 12;

  // ─── Footer ──────────────────────────────────────────────────────────────────
  doc.setFontSize(7);
  doc.setTextColor(139, 139, 133);
  doc.text('This is a system-generated payslip. For queries contact HR at support@finvastra.com', pageW / 2, y, { align: 'center' });
  if (payslip.notes) {
    y += 4;
    doc.text(`Notes: ${payslip.notes}`, pageW / 2, y, { align: 'center' });
  }

  // ─── Watermark ───────────────────────────────────────────────────────────────
  addWatermarkToAllPages(doc, { downloaderName: employee.displayName });

  // ─── Save ────────────────────────────────────────────────────────────────────
  const fname = employee.displayName.replace(/\s+/g, '-');
  const monthSlug = payslip.month;
  doc.save(`Finvastra-Payslip-${fname}-${monthSlug}.pdf`);
}
