import { jsPDF } from 'jspdf';
import { addWatermarkToAllPages } from '../../../lib/pdfWatermark';
import type { Payslip, UserProfile, PayslipExtras } from '../../../types';

/**
 * Official Finvastra Advisors Pvt Ltd payslip format.
 * Layout matches the company's approved "Payslip Format.docx" from the HR Drive folder.
 *
 * mode = 'save'   (default) — triggers browser download immediately
 * mode = 'base64'           — returns pure base64 string for email attachment
 *
 * extras = optional supplementary employee data (bank, UAN, gender, leave balance).
 * When absent, those cells show "—" or "On file" rather than erroring.
 */
export function generatePayslipPdf(
  payslip: Payslip,
  employee: UserProfile,
  mode?: 'save' | 'base64',
  extras?: PayslipExtras,
): string | void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW  = doc.internal.pageSize.getWidth();   // 210 mm
  const PH  = doc.internal.pageSize.getHeight();  // 297 mm
  const ML  = 15;   // left margin
  const MR  = 15;   // right margin
  const CW  = PW - ML - MR; // 180 mm usable width
  const HCW = CW / 2;       // half-column width = 90 mm

  // ─── Brand colours ────────────────────────────────────────────────────────────
  const NAVY:   [number,number,number] = [11,  21,  56 ];
  const GOLD:   [number,number,number] = [201, 169, 97 ];
  const INK:    [number,number,number] = [10,  10,  10 ];
  const MUTE:   [number,number,number] = [100, 100, 100];
  const SILVER: [number,number,number] = [200, 200, 200];
  const LTGRAY: [number,number,number] = [245, 245, 245];

  const tc = (c: [number,number,number]) => doc.setTextColor(c[0], c[1], c[2]);
  const dc = (c: [number,number,number]) => doc.setDrawColor(c[0], c[1], c[2]);
  const fc = (c: [number,number,number]) => doc.setFillColor(c[0], c[1], c[2]);

  /** Indian number format with 2 decimal places, e.g. "32,500.00" */
  function fmt(n: number): string {
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ─── Month & display values ───────────────────────────────────────────────────
  const [yr, mo] = payslip.month.split('-');
  const monthDate  = new Date(+yr, +mo - 1, 1);
  const monthName  = monthDate.toLocaleString('en-IN', { month: 'long' });
  const titleMonth = `${monthName} - ${yr}`;   // e.g. "November - 2025"

  const empCode = employee.employeeId ?? employee.userId.slice(-8).toUpperCase();

  const joiningDateDisplay = (() => {
    const jd = extras?.joiningDate ?? employee.joiningDate;
    if (!jd) return '—';
    const p = jd.split('-');
    // Convert YYYY-MM-DD → DD-MM-YYYY
    return (p.length === 3 && p[0].length === 4) ? `${p[2]}-${p[1]}-${p[0]}` : jd;
  })();

  const location   = extras?.location   ?? employee.location ?? 'Hyderabad';
  const gender     = extras?.gender     ?? '—';
  const panDisplay = extras?.panMasked  ?? 'On file';
  const bankName   = extras?.bankName   ?? '—';
  const bankAcct   = extras?.bankAccountLast4 ? `****${extras.bankAccountLast4}` : '—';
  const pfNumber   = extras?.pfNumber   ?? '—';
  const uan        = extras?.uan        ?? '—';

  let y = 14;

  // ─── 1. Title & subtitle ──────────────────────────────────────────────────────
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  tc(NAVY);
  doc.text('FINVASTRA ADVISORS PVT LTD', PW / 2, y, { align: 'center' });
  y += 6;

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  tc(INK);
  doc.text(`Salary Statement for the Month of ${titleMonth}`, PW / 2, y, { align: 'center' });
  y += 4;

  // Gold rule below subtitle
  dc(GOLD);
  doc.setLineWidth(0.6);
  doc.line(ML, y, ML + CW, y);
  doc.setLineWidth(0.3);
  y += 4;

  // ─── 2. Employee Info table (6 rows × 2 columns) ─────────────────────────────
  const INFO_ROW_H = 6.5;   // mm per row
  const INFO_ROWS  = 6;
  const INFO_H     = INFO_ROW_H * INFO_ROWS; // 39 mm total
  const LPAD       = 3;
  const LVAL_X     = 30; // offset from column start to value text

  // Outer border first; header filled later so border is painted on top
  dc(SILVER);
  doc.rect(ML, y, CW, INFO_H);
  // Centre vertical divider
  doc.line(ML + HCW, y, ML + HCW, y + INFO_H);

  const infoRows: [string, string, string, string][] = [
    ['Emp Code',        empCode,                      'Gender',       gender     ],
    ['Emp Name',        employee.displayName,          'PAN Number',   panDisplay ],
    ['Date of Joining', joiningDateDisplay,             'Bank Name',    bankName   ],
    ['Department',      employee.department  ?? '—',   'Bank A/C No.', bankAcct   ],
    ['Designation',     employee.designation ?? '—',   'PF Number',    pfNumber   ],
    ['Location',        location,                      'UAN Number',   uan        ],
  ];

  for (let i = 0; i < infoRows.length; i++) {
    // Row divider (skip before first row)
    if (i > 0) {
      dc(SILVER);
      doc.line(ML, y + i * INFO_ROW_H, ML + CW, y + i * INFO_ROW_H);
    }

    const rowMidY = y + i * INFO_ROW_H + INFO_ROW_H * 0.65;
    const [lLbl, lVal, rLbl, rVal] = infoRows[i];
    const c1 = ML + LPAD;
    const c2 = ML + HCW + LPAD;

    // Left cell
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    tc(MUTE);
    doc.text(`${lLbl}:`, c1, rowMidY);
    doc.setFont('helvetica', 'normal');
    tc(INK);
    doc.text(lVal, c1 + LVAL_X, rowMidY);

    // Right cell
    doc.setFont('helvetica', 'bold');
    tc(MUTE);
    doc.text(`${rLbl}:`, c2, rowMidY);
    doc.setFont('helvetica', 'normal');
    tc(INK);
    doc.text(rVal, c2 + LVAL_X, rowMidY);
  }

  y += INFO_H + 4;

  // ─── 3. Payable / Paid / LOP Days row ────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  tc(NAVY);
  doc.text(
    [
      `Payable Days: ${payslip.workingDays.toFixed(2)}`,
      `Paid Days: ${payslip.presentDays.toFixed(2)}`,
      `LOP Days: ${payslip.lopDays.toFixed(2)}`,
    ].join('     '),
    PW / 2, y, { align: 'center' },
  );
  y += 4;

  dc(SILVER);
  doc.line(ML, y, ML + CW, y);
  y += 3;

  // ─── 4. Salary Details header ────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  tc(NAVY);
  doc.text('Salary Details for the Month', PW / 2, y, { align: 'center' });
  y += 4;

  dc(SILVER);
  doc.line(ML, y, ML + CW, y);
  y += 1;

  // ─── 5. Earnings / Deductions section ────────────────────────────────────────
  //
  // Earning rows (left): Basic · HRA · Conv. Allow. · Other Allow.
  // "Other Allow." = medicalAllowance + otherAllowances (matches the Drive format which
  //  does not show a separate Medical Allowance line).
  //
  // Deduction rows (right): non-zero items only; LOP only when lopDays > 0.
  //
  const EARN_ROWS: [string, number][] = [
    ['Basic',        payslip.basicSalary],
    ['HRA',          payslip.hra],
    ['Conv. Allow.', payslip.conveyanceAllowance],
    ['Other Allow.', payslip.medicalAllowance + payslip.otherAllowances],
  ];

  const DED_ROWS: [string, number][] = [];
  if (payslip.lopDays > 0)           DED_ROWS.push([`LOP (${payslip.lopDays}d)`, payslip.otherDeductions]);
  if (payslip.pf > 0)                DED_ROWS.push(['Provident Fund',            payslip.pf]);
  if (payslip.professionalTax > 0)   DED_ROWS.push(['Prof. Tax (PT)',            payslip.professionalTax]);
  if (payslip.tds > 0)               DED_ROWS.push(['TDS',                       payslip.tds]);
  // otherDeductions when there is no LOP (already accounted for above when lopDays > 0)
  if (payslip.lopDays === 0 && payslip.otherDeductions > 0)
    DED_ROWS.push(['Other Deductions', payslip.otherDeductions]);

  const DATA_ROWS   = Math.max(EARN_ROWS.length, DED_ROWS.length);
  const SAL_HDR_H   = 7;
  const SAL_ROW_H   = 5.5;
  const SAL_TOTAL_H = 7;
  const SAL_SECT_H  = SAL_HDR_H + DATA_ROWS * SAL_ROW_H + SAL_TOTAL_H;

  const sectTop = y;
  const lLblX   = ML + LPAD;
  const lAmtX   = ML + HCW - 3;
  const rLblX   = ML + HCW + LPAD;
  const rAmtX   = ML + CW  - 3;

  // Header background (drawn before border so border paints on top)
  fc(LTGRAY);
  doc.rect(ML, sectTop, CW, SAL_HDR_H, 'F');

  // Outer border + internal lines
  dc(SILVER);
  doc.setLineWidth(0.3);
  doc.rect(ML, sectTop, CW, SAL_SECT_H);                              // outer box
  doc.line(ML + HCW, sectTop, ML + HCW, sectTop + SAL_SECT_H);       // mid vertical
  doc.line(ML, sectTop + SAL_HDR_H, ML + CW, sectTop + SAL_HDR_H);   // header bottom

  // Column headers
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  tc(MUTE);
  doc.text('EARNINGS',   lLblX, sectTop + SAL_HDR_H * 0.72);
  doc.text('DEDUCTIONS', rLblX, sectTop + SAL_HDR_H * 0.72);

  // Data rows
  const dataStartY = sectTop + SAL_HDR_H;
  for (let i = 0; i < DATA_ROWS; i++) {
    const rowY = dataStartY + i * SAL_ROW_H + SAL_ROW_H * 0.72;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    tc(INK);

    if (i < EARN_ROWS.length) {
      const [lbl, amt] = EARN_ROWS[i];
      doc.text(lbl,        lLblX, rowY);
      doc.text(fmt(amt),   lAmtX, rowY, { align: 'right' });
    }
    if (i < DED_ROWS.length) {
      const [lbl, amt] = DED_ROWS[i];
      doc.text(lbl,        rLblX, rowY);
      doc.text(fmt(amt),   rAmtX, rowY, { align: 'right' });
    }
  }

  // Divider before totals
  const divY = dataStartY + DATA_ROWS * SAL_ROW_H;
  dc(SILVER);
  doc.line(ML, divY, ML + CW, divY);

  // Totals row — Gross Salary | Total Deductions
  const totY = divY + SAL_TOTAL_H * 0.72;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  tc(NAVY);
  doc.text('Gross Salary',              lLblX, totY);
  doc.text(fmt(payslip.totalEarnings),  lAmtX, totY, { align: 'right' });
  doc.text('Total Deductions',          rLblX, totY);
  doc.text(fmt(payslip.totalDeductions),rAmtX, totY, { align: 'right' });

  y = sectTop + SAL_SECT_H;

  // ─── 6. Net Pay band ─────────────────────────────────────────────────────────
  const NET_H = 10;
  fc(NAVY);
  doc.rect(ML, y, CW, NET_H, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  tc(GOLD);
  doc.text('Net Pay', lLblX, y + NET_H * 0.68);
  doc.setTextColor(255, 255, 255);
  doc.text(fmt(payslip.netPay), rAmtX, y + NET_H * 0.68, { align: 'right' });
  y += NET_H + 6;

  // ─── 7. Leave Details table (only when leave balance is provided) ─────────────
  if (extras?.leaveBalance) {
    const lb = extras.leaveBalance;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    tc(NAVY);
    doc.text('Leave Details', PW / 2, y, { align: 'center' });
    y += 4;

    dc(SILVER);
    doc.line(ML, y, ML + CW, y);
    y += 1;

    const LV_HDR_H = 7;
    const LV_ROW_H = 7;
    const LV_ROWS  = 3;
    const LV_H     = LV_HDR_H + LV_ROWS * LV_ROW_H;  // 28 mm

    // Column widths
    const lvTypeW = CW * 0.38;            // "Leave Type" column
    const lvColW  = (CW - lvTypeW) / 3;   // remaining split into 3 equal columns

    const lvTop = y;

    // Header background
    fc(LTGRAY);
    doc.rect(ML, lvTop, CW, LV_HDR_H, 'F');

    // Outer border + horizontal header separator
    dc(SILVER);
    doc.rect(ML, lvTop, CW, LV_H);
    doc.line(ML, lvTop + LV_HDR_H, ML + CW, lvTop + LV_HDR_H);

    // Column dividers (full height)
    doc.line(ML + lvTypeW,          lvTop, ML + lvTypeW,          lvTop + LV_H);
    doc.line(ML + lvTypeW + lvColW, lvTop, ML + lvTypeW + lvColW, lvTop + LV_H);
    doc.line(ML + lvTypeW + lvColW * 2, lvTop, ML + lvTypeW + lvColW * 2, lvTop + LV_H);

    // Header labels
    const lvHdrY = lvTop + LV_HDR_H * 0.72;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    tc(MUTE);
    doc.text('Leave Type',      ML + LPAD,                              lvHdrY);
    doc.text('Credited',        ML + lvTypeW + lvColW * 0.5,            lvHdrY, { align: 'center' });
    doc.text('Availed',         ML + lvTypeW + lvColW * 1.5,            lvHdrY, { align: 'center' });
    doc.text('Closing Balance', ML + lvTypeW + lvColW * 2.5,            lvHdrY, { align: 'center' });

    // Data rows
    const leaveRows: { label: string; d: typeof lb.sick }[] = [
      { label: 'Sick Leave',      d: lb.sick   },
      { label: 'Casual Leave',    d: lb.casual  },
      { label: 'Privilege Leave', d: lb.earned  },
    ];

    for (let i = 0; i < leaveRows.length; i++) {
      const { label, d } = leaveRows[i];
      const rowY = lvTop + LV_HDR_H + i * LV_ROW_H + LV_ROW_H * 0.68;

      // Row separator (skip before first data row)
      if (i > 0) {
        dc(SILVER);
        doc.line(ML, lvTop + LV_HDR_H + i * LV_ROW_H, ML + CW, lvTop + LV_HDR_H + i * LV_ROW_H);
      }

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      tc(INK);
      doc.text(label,                  ML + LPAD,                              rowY);
      doc.text(d.credited.toFixed(2),  ML + lvTypeW + lvColW * 0.5,            rowY, { align: 'center' });
      doc.text(d.availed.toFixed(2),   ML + lvTypeW + lvColW * 1.5,            rowY, { align: 'center' });
      doc.text(d.closing.toFixed(2),   ML + lvTypeW + lvColW * 2.5,            rowY, { align: 'center' });
    }

    y = lvTop + LV_H + 6;
  }

  // ─── 8. Footer ───────────────────────────────────────────────────────────────
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  tc(MUTE);
  doc.text(
    'This is a computer-generated payslip. For queries, contact HR at support@finvastra.com',
    PW / 2, PH - 8, { align: 'center' },
  );
  if (payslip.notes) {
    doc.text(`Notes: ${payslip.notes}`, PW / 2, PH - 4, { align: 'center' });
  }

  // ─── Watermark ────────────────────────────────────────────────────────────────
  addWatermarkToAllPages(doc, { downloaderName: employee.displayName });

  // ─── Output ───────────────────────────────────────────────────────────────────
  const fname   = employee.displayName.replace(/\s+/g, '-');
  const monSlug = payslip.month;
  if (mode === 'base64') {
    return doc.output('datauristring').split(',')[1]; // pure base64, no data-uri prefix
  }
  doc.save(`Finvastra-Payslip-${fname}-${monSlug}.pdf`);
}
