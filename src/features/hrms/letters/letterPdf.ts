/**
 * letterPdf.ts — HR letter generation using jsPDF.
 *
 * Five letter types matching actual Finvastra Advisors company formats:
 *   offer_letter         — pre-joining offer with terms table (1 page)
 *   appointment          — full legal employment accord (multi-page)
 *   confirmation         — probation completion / permanent employment confirmation
 *   probation_extension  — extension of probation period
 *   consultant_agreement — independent consultant engagement (13 clauses)
 *
 * Returns: generateLetterPdf() → ArrayBuffer (for Firebase Storage upload).
 * Caller uses getDownloadURL() after upload, then window.open(url).
 *
 * SECURITY: Aadhaar numbers are NEVER collected, stored, or transmitted
 * through this system. The consultant agreement includes a blank line
 * (___________________________) where the Aadhaar would appear in the party
 * description. HR completes this manually on the printed copy.
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import logoUrl from '../../../../images/logo-finvastra.png';

// ─── Company constants ────────────────────────────────────────────────────────

const CO = {
  name:    'Finvastra Advisors Private Limited',
  addr1:   'H.No.7-1-617/A, 3rd Floor, 305 Imperial Towers,',
  addr2:   'Ameerpet, Hyderabad, Telangana - 500016',
  addrFull:'H.No.7-1-617/A, 3rd Floor, 305 Imperial Towers, Ameerpet, Hyderabad, Telangana - 500016',
  phone:   '040-45501355 / +91 98543 3303',
  email:   'support@finvastra.com',
  website: 'www.finvastra.com',
  cin:     'U70200TS2025PTC202271',
  ceo:     'AJAY NEWATIA',
  ceoTitle:'Founder & CEO',
  hr:      'Vennela Rudrapati',
  hrTitle: 'Manager - Human Resources',
  services:'Advisory   |   Lending   |   Investments   |   Wealth   |   Insurance',
  tagline: 'Empowering Growth through Excellence, Trust, and Innovation',
};

// ─── Letter types ─────────────────────────────────────────────────────────────

export type LetterType =
  | 'offer_letter'
  | 'appointment'
  | 'confirmation'
  | 'probation_extension'
  | 'consultant_agreement';

export const TYPE_ABBREV: Record<LetterType, string> = {
  offer_letter:         'OFR',
  appointment:          'APT',
  confirmation:         'CON',
  probation_extension:  'PEX',
  consultant_agreement: 'CAG',
};

// ─── Colours ──────────────────────────────────────────────────────────────────

const NAVY = [11,  21,  56]  as [number, number, number];
const GOLD = [201, 169, 97]  as [number, number, number];
const MUTE = [139, 139, 133] as [number, number, number];
const INK  = [30,  30,  30]  as [number, number, number];

// ─── Preload logo image at module init ────────────────────────────────────────
// The HR Letters page imports this module on first render. By the time the
// admin fills the form and clicks Generate (10+ seconds), the 12 KB PNG is
// cached. We fall back to text-only if it hasn't loaded yet.

const _logo: HTMLImageElement | null = (() => {
  if (typeof window === 'undefined') return null;
  const img = new Image();
  img.src = logoUrl as string;
  return img;
})();

// ─── Interfaces ───────────────────────────────────────────────────────────────

export type Salutation = 'Mr.' | 'Ms.' | 'Mrs.' | 'Dr.';

export interface SalaryRow {
  component:   string;
  description: string;
  monthly:     string;   // numeric string, e.g. "35000"
}

export interface OfferLetterData {
  type:             'offer_letter';
  salutation:       Salutation;
  empName:          string;
  empCode:          string;
  careof?:          string;      // C/O address line (optional)
  designation:      string;
  department:       string;
  ctcAnnual:        string;      // "18,00,000"
  joiningDate:      string;      // "3rd May 2026"
  probationPeriod:  string;      // "3 months"
  probationEndDate: string;      // "3rd August 2026"
  reportingTo:      string;
}

export interface AppointmentData {
  type:              'appointment';
  salutation:        Salutation;
  empName:           string;
  empCode:           string;
  careof?:           string;     // C/O address line (optional)
  empAddress:        string;     // residential address for party description
  designation:       string;
  joiningDate:       string;     // "17th November 2025"
  probationDuration: string;     // "three (3) months"
  probationEndDate:  string;     // "17th February 2026"
  ctcAnnual:         string;     // "8,40,000"
  ctcInWords:        string;     // "Eight Lakh Forty Thousand"
  salaryRows:        SalaryRow[];
}

export interface ConfirmationData {
  type:             'confirmation';
  salutation:       Salutation;
  empName:          string;
  empCode:          string;
  designation:      string;
  probationFrom:    string;      // "01st October 2025"
  probationTo:      string;      // "01st January 2026"
  confirmationDate: string;      // "01st January 2026"
  newDesignation?:  string;      // omit if unchanged
}

export interface ProbationExtensionData {
  type:                 'probation_extension';
  salutation:           Salutation;
  empName:              string;
  empCode:              string;
  designation:          string;
  probationDuration:    string;   // "3 months"
  originalProbationEnd: string;   // "17th February 2026"
  extendedUntilDate:    string;   // "17th May 2026"
}

export interface ConsultantAgreementData {
  type:               'consultant_agreement';
  salutation:         Salutation;
  consultantName:     string;
  consultantAddress:  string;
  role:               string;    // "Consultant - Digital Marketing"
  scopeOfServices:    string;
  startDate:          string;    // "02nd January 2026"
  endDate:            string;    // "31st January 2026"
  termMonths:         string;    // "one (1) month"
  feeAmount:          string;    // "10,000"
  feeInWords:         string;    // "Ten Thousand"
}

export type LetterData =
  | OfferLetterData
  | AppointmentData
  | ConfirmationData
  | ProbationExtensionData
  | ConsultantAgreementData;

// ─── Public helpers ───────────────────────────────────────────────────────────

export function letterRefNumber(type: LetterType, year: number, seq: string): string {
  return `FV/${TYPE_ABBREV[type]}/${year}/${seq.padStart(3, '0')}`;
}

export function letterFilename(data: LetterData, year: number, seq: string): string {
  const abbrev = TYPE_ABBREV[data.type];
  const name =
    data.type === 'consultant_agreement'
      ? data.consultantName.replace(/\s+/g, '_')
      : (data as OfferLetterData | AppointmentData | ConfirmationData | ProbationExtensionData).empName.replace(/\s+/g, '_');
  return `FV_${abbrev}_${year}_${seq.padStart(3, '0')}_${name}.pdf`;
}

// ─── Page layout ──────────────────────────────────────────────────────────────

const MARGIN      = 14;      // left/right margin
const BODY_TOP    = 52;      // y where body text starts (after letterhead + ref/date)
const BODY_BOTTOM = 270;     // y where body text stops (footer below)
const FONT_BODY   = 9.5;
const FONT_SMALL  = 8.5;
const FONT_HEADING= 9.5;

/** Approximate line height for a given fontSize in jsPDF mm units. */
function lh(fontSize: number): number {
  return fontSize * 0.58;
}

// ─── Page state ───────────────────────────────────────────────────────────────

interface PState {
  pdf:    jsPDF;
  y:      number;
  W:      number;
  refNum: string;
  date:   string;
  curPage:number;
}

// ─── Letterhead ───────────────────────────────────────────────────────────────

function drawLetterhead(pdf: jsPDF, W: number, refNum: string, date: string): void {
  // Watermark (draw first so body content renders on top)
  const H = pdf.internal.pageSize.getHeight();
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(58);
  pdf.setTextColor(230, 228, 220);
  pdf.text('FINVASTRA', W / 2, H / 2 - 20, { align: 'center', angle: 45 });

  // Logo (top-left)
  if (_logo?.complete && _logo.naturalWidth > 0) {
    try {
      pdf.addImage(_logo, 'PNG', MARGIN, 6, 42, 17);
    } catch {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(13);
      pdf.setTextColor(...NAVY);
      pdf.text('FINVASTRA', MARGIN, 16);
    }
  } else {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(...NAVY);
    pdf.text('FINVASTRA', MARGIN, 16);
  }

  // CIN (top-right, above company name)
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.5);
  pdf.setTextColor(...MUTE);
  pdf.text(`CIN: ${CO.cin}`, W - MARGIN, 10, { align: 'right' });

  // Company name (top-right, below CIN)
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(...NAVY);
  pdf.text(CO.name, W - MARGIN, 15, { align: 'right' });

  // Gold divider line
  pdf.setDrawColor(...GOLD);
  pdf.setLineWidth(0.7);
  pdf.line(MARGIN, 27, W - MARGIN, 27);

  // Services row (centered, gold)
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(...GOLD);
  pdf.text(CO.services, W / 2, 33, { align: 'center' });

  // Second thin gold line
  pdf.setDrawColor(...GOLD);
  pdf.setLineWidth(0.3);
  pdf.line(MARGIN, 37, W - MARGIN, 37);

  // Ref number and date (right-aligned, below header)
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(FONT_SMALL);
  pdf.setTextColor(...MUTE);
  pdf.text(`Ref: ${refNum}`, W - MARGIN, 43, { align: 'right' });
  pdf.text(`Date: ${date}`, W - MARGIN, 48, { align: 'right' });
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function drawFooter(pdf: jsPDF, W: number): void {
  const H = pdf.internal.pageSize.getHeight();

  // Gold line
  pdf.setDrawColor(...GOLD);
  pdf.setLineWidth(0.5);
  pdf.line(MARGIN, H - 23, W - MARGIN, H - 23);

  // Company name
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(...NAVY);
  pdf.text(CO.name, W / 2, H - 19, { align: 'center' });

  // 3-column contact info
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.5);
  pdf.setTextColor(...MUTE);
  pdf.text(`${CO.addr1} ${CO.addr2}`, MARGIN, H - 14.5);
  pdf.text(`Ph: ${CO.phone}`, W / 2, H - 14.5, { align: 'center' });
  pdf.text(`${CO.email}  |  ${CO.website}`, W - MARGIN, H - 14.5, { align: 'right' });

  // Gold tagline banner
  pdf.setFillColor(...GOLD);
  pdf.rect(0, H - 10, W, 10, 'F');
  pdf.setFont('helvetica', 'bolditalic');
  pdf.setFontSize(7.5);
  pdf.setTextColor(...NAVY);
  pdf.text(CO.tagline, W / 2, H - 3.5, { align: 'center' });
}

// ─── Page break helper ────────────────────────────────────────────────────────

function breakPage(s: PState): void {
  drawFooter(s.pdf, s.W);
  s.pdf.addPage();
  s.curPage++;
  drawLetterhead(s.pdf, s.W, s.refNum, s.date);
  s.y = BODY_TOP;
}

// ─── Write paragraph (page-break aware) ──────────────────────────────────────

interface WriteOpts {
  bold?:     boolean;
  heading?:  boolean;
  indent?:   number;
  gap?:      number;
  fontSize?: number;
  color?:    [number, number, number];
  center?:   boolean;
}

function writeParagraph(s: PState, text: string, opts: WriteOpts = {}): void {
  const {
    bold     = false,
    heading  = false,
    indent   = 0,
    gap      = 3.5,
    fontSize = FONT_BODY,
    color    = INK,
    center   = false,
  } = opts;

  const fs   = heading ? FONT_HEADING : fontSize;
  const maxW = s.W - 2 * MARGIN - indent;
  const x    = MARGIN + indent;

  s.pdf.setFont('helvetica', (bold || heading) ? 'bold' : 'normal');
  s.pdf.setFontSize(fs);

  const lines  = s.pdf.splitTextToSize(text, maxW) as string[];
  const needed = lines.length * lh(fs) + gap;

  if (s.y + needed > BODY_BOTTOM) breakPage(s);

  s.pdf.setTextColor(...(heading ? NAVY : color));
  if (center) {
    s.pdf.text(lines, s.W / 2, s.y, { align: 'center' });
  } else {
    s.pdf.text(lines, x, s.y);
  }
  s.y += needed;
}

function writeGap(s: PState, mm = 3): void {
  s.y += mm;
}

// ─── Dual signature block ─────────────────────────────────────────────────────

function writeSignatures(
  s: PState,
  leftName:  string,
  leftTitle: string,
  rightLabel:string,
  rightName: string,
  rightSub?: string,
): void {
  if (s.y + 40 > BODY_BOTTOM) breakPage(s);

  const sigLineY = s.y + 10;

  // Left: Company signature
  s.pdf.setFont('helvetica', 'bold');
  s.pdf.setFontSize(FONT_SMALL);
  s.pdf.setTextColor(...INK);
  s.pdf.text(`SIGNED BY THE WITHIN NAMED THE COMPANY`, MARGIN, s.y);
  s.pdf.setFont('helvetica', 'normal');
  s.pdf.setFontSize(FONT_SMALL - 0.5);
  s.pdf.setTextColor(...MUTE);
  s.pdf.text(`For ${CO.name}`, MARGIN, s.y + 5);
  s.pdf.text('. . . . . . . . . . . . . . . . . . . . . . . . . . .', MARGIN, sigLineY + 8);
  s.pdf.setFont('helvetica', 'bold');
  s.pdf.setFontSize(FONT_SMALL);
  s.pdf.setTextColor(...INK);
  s.pdf.text(`Name: ${leftName}`, MARGIN, sigLineY + 13);
  s.pdf.setFont('helvetica', 'normal');
  s.pdf.text(`Designation: ${leftTitle}`, MARGIN, sigLineY + 18);

  // Right: Employee/consultant signature
  const rx = s.W - MARGIN;
  s.pdf.setFont('helvetica', 'bold');
  s.pdf.setFontSize(FONT_SMALL);
  s.pdf.setTextColor(...INK);
  s.pdf.text(rightLabel, rx, s.y, { align: 'right' });
  s.pdf.setFont('helvetica', 'normal');
  s.pdf.setFontSize(FONT_SMALL - 0.5);
  s.pdf.setTextColor(...MUTE);
  s.pdf.text('. . . . . . . . . . . . . . . . . . . . . . . . . . .', rx, sigLineY + 8, { align: 'right' });
  s.pdf.setFont('helvetica', 'bold');
  s.pdf.setFontSize(FONT_SMALL);
  s.pdf.setTextColor(...INK);
  s.pdf.text(`Name: ${rightName}`, rx, sigLineY + 13, { align: 'right' });
  if (rightSub) {
    s.pdf.setFont('helvetica', 'normal');
    s.pdf.text(rightSub, rx, sigLineY + 18, { align: 'right' });
  }

  s.y = sigLineY + 26;
}

// ─── HR-only signature block (for confirmation / extension) ──────────────────

function writeHrSignatures(
  s: PState,
  empName: string,
  empCode: string,
): void {
  if (s.y + 40 > BODY_BOTTOM) breakPage(s);

  // Left: HR signature
  s.pdf.setFont('helvetica', 'normal');
  s.pdf.setFontSize(FONT_SMALL);
  s.pdf.setTextColor(...MUTE);
  s.pdf.text('. . . . . . . . . . . . . . . . . . . . . . . .', MARGIN, s.y + 8);
  s.pdf.setFont('helvetica', 'bold');
  s.pdf.setFontSize(FONT_SMALL);
  s.pdf.setTextColor(...INK);
  s.pdf.text(CO.hr, MARGIN, s.y + 13);
  s.pdf.setFont('helvetica', 'normal');
  s.pdf.text(CO.hrTitle, MARGIN, s.y + 18);

  // Right: Employee signature
  const rx = s.W - MARGIN;
  s.pdf.setFont('helvetica', 'normal');
  s.pdf.setFontSize(FONT_SMALL);
  s.pdf.setTextColor(...MUTE);
  s.pdf.text('. . . . . . . . . . . . . . . . . . . . . . . .', rx, s.y + 8, { align: 'right' });
  s.pdf.setFont('helvetica', 'bold');
  s.pdf.setFontSize(FONT_SMALL);
  s.pdf.setTextColor(...INK);
  s.pdf.text(empName, rx, s.y + 13, { align: 'right' });
  s.pdf.setFont('helvetica', 'normal');
  s.pdf.text(`Code: ${empCode}`, rx, s.y + 18, { align: 'right' });

  s.y += 26;
}

// ─── Helper: today's date as DD/MM/YYYY ──────────────────────────────────────

function todayDMY(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// ─── APPOINTMENT LETTER ───────────────────────────────────────────────────────

function buildAppointment(data: AppointmentData, seq: string): jsPDF {
  const dateStr = todayDMY();
  const year    = new Date().getFullYear();
  const refNum  = `FV/${TYPE_ABBREV.appointment}/${year}/${seq.padStart(3, '0')}`;
  const pdf     = new jsPDF({ unit: 'mm', format: 'a4' });
  const W       = pdf.internal.pageSize.getWidth();

  drawLetterhead(pdf, W, refNum, dateStr);
  const s: PState = { pdf, y: BODY_TOP, W, refNum, date: dateStr, curPage: 1 };

  writeParagraph(s, `Dear ${data.salutation} ${data.empName},`, { gap: 4 });
  writeParagraph(s,
    `We are pleased to inform you that you are hereby appointed to the position of ` +
    `${data.designation} with effect from ${data.joiningDate}.`,
    { gap: 5 });

  writeParagraph(s,
    `${CO.name}, a company incorporated under the provisions of the Companies Act, 2013, having its ` +
    `registered office at H.No. 7-1-617/A, 3rd Floor, Unit No. 305, Imperial Towers, Ameerpet, ` +
    `Hyderabad, Telangana – 500016, hereinafter referred to as the "Company" (which expression shall, ` +
    `unless repugnant to the context or meaning thereof, be deemed to include its affiliates, subsidiaries, ` +
    `associates, joint ventures, and group companies), is the ONE PART.`,
    { gap: 4 });

  writeParagraph(s,
    `${data.salutation} ${data.empName}, an Indian citizen and an adult, residing at ` +
    (data.careof ? `C/O ${data.careof}, ` : '') +
    `${data.empAddress}, ` +
    `is hereinafter referred to as the "Employee", of the OTHER PART.`,
    { gap: 6 });

  writeParagraph(s, 'WHEREAS:', { bold: true, gap: 3 });
  writeParagraph(s,
    `1.  The Company is a duly incorporated and reputed private limited company engaged in the ` +
    `business of providing financial consultancy and allied services.`,
    { indent: 5, gap: 2 });
  writeParagraph(s,
    `2.  The Employee has applied for employment with the Company and has successfully completed ` +
    `the selection and interview process conducted by the Company, and has expressed their willingness to ` +
    `accept employment with the Company.`,
    { indent: 5, gap: 2 });
  writeParagraph(s,
    `3.  The Company, being satisfied with the qualifications, experience, and suitability of the ` +
    `Employee, is willing to appoint the Employee and avail their services on the terms and conditions set out herein.`,
    { indent: 5, gap: 2 });
  writeParagraph(s,
    `4.  The Parties are desirous of entering into this appointment accord to record, inter alia, ` +
    `the terms and conditions governing the employment of the Employee, along with the respective rights, ` +
    `duties, and obligations of the Parties, as more particularly set out hereinafter.`,
    { indent: 5, gap: 6 });

  writeParagraph(s,
    `Now this Accord witnessed, and it is hereby agreed upon by and between the parties as follows:`,
    { bold: true, gap: 5 });

  // ── Appointment ──
  writeParagraph(s, 'Appointment', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Employee is hereby appointed to the position of ${data.designation} with effect from ${data.joiningDate}. ` +
    `The period from ${data.joiningDate} to ${data.probationEndDate}, being a duration of ${data.probationDuration}, ` +
    `shall constitute the probation period.`, { gap: 2 });
  writeParagraph(s,
    `During the probation period, the Employee's performance, conduct, and attendance shall be assessed by the Company. ` +
    `Upon successful completion of the probation period and if the Employee's performance is found to be satisfactory, ` +
    `the Company shall issue a written confirmation of employment.`, { gap: 2 });
  writeParagraph(s,
    `In the absence of such written confirmation, the Employee's services shall automatically stand terminated without ` +
    `any further notice upon completion of the probation period.`, { gap: 5 });

  // ── Relieving from Previous Employer ──
  writeParagraph(s, 'Relieving from Previous Employer', { heading: true, gap: 2 });
  writeParagraph(s,
    `It shall be the sole responsibility of the Employee to ensure that they are duly relieved from their previous ` +
    `employment(s) prior to joining the Company. The Company shall not, in any manner whatsoever, be responsible or ` +
    `liable for any claims, disputes, obligations, or liabilities that may arise or be raised by the Employee's ` +
    `present or former employer(s).`, { gap: 2 });
  writeParagraph(s,
    `The Employee hereby agrees to indemnify and hold harmless the Company, its directors, officers, and ` +
    `representatives from and against any and all claims, losses, damages, costs, or liabilities arising out of ` +
    `or in connection with the Employee's present or prior employment.`, { gap: 5 });

  // ── Duties ──
  writeParagraph(s, 'Duties and Responsibilities of the Employee', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Employee shall initially be appointed to the position of ${data.designation}. The Employee shall perform ` +
    `such duties and responsibilities as are assigned to them by the Company from time to time and shall faithfully, ` +
    `diligently, and efficiently discharge their functions in the best interests of the Company.`, { gap: 2 });
  writeParagraph(s,
    `The Company reserves the right to revise, modify, or reassign the Employee's job role, responsibilities, ` +
    `reporting structure, place of work, and compensation, in whole or in part, based on business exigencies, ` +
    `industry requirements, market conditions, or organizational needs.`, { gap: 5 });

  // ── Remuneration ──
  writeParagraph(s, 'Remuneration and Benefits', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Employee shall be entitled to a total remuneration of INR ${data.ctcAnnual}/- ` +
    `(Rupees ${data.ctcInWords} Only) per annum, payable in accordance with the Company's payroll practices, ` +
    `the detailed breakup of which is set out in Annexure I hereto.`, { gap: 2 });
  writeParagraph(s,
    `The terms and structure of remuneration, allowances, incentives, and other benefits shall be subject to ` +
    `revision, modification, or restructuring by the Company from time to time, in accordance with its policies, ` +
    `performance assessments, and applicable laws.`, { gap: 5 });

  // ── Leave Policy ──
  writeParagraph(s, 'Leave Policy', { heading: true, gap: 2 });
  writeParagraph(s,
    `For the purpose of leave computation, the leave year shall be from 1st April to 31st March. Availment of all ` +
    `leaves shall be subject to prior approval by the reporting manager and/or the Human Resources department. ` +
    `Except in cases of emergency, the Employee shall obtain approval in advance before availing any leave.`, { gap: 3 });
  writeParagraph(s, 'Earned Leave (EL)', { bold: true, gap: 1 });
  writeParagraph(s,
    `The Employee shall be eligible for a maximum of fifteen (15) Earned Leaves per leave year, accrued at the ` +
    `rate of one (1) Earned Leave for every twenty (20) days worked in the preceding year. Earned Leave shall be ` +
    `credited in two equal installments, once in April and once in October of each leave year.`, { gap: 2 });
  writeParagraph(s, 'Sick Leave (SL)', { bold: true, gap: 1 });
  writeParagraph(s,
    `The Employee shall be eligible for seven (7) days of Sick Leave per leave year. Sick Leave shall be ` +
    `calculated on a pro-rata basis if the Employee joins during the leave year. Sick Leave shall be credited ` +
    `in two equal installments, once in April (or on the date of joining, as applicable) and once in October ` +
    `(or on the date of joining, as applicable).`, { gap: 2 });
  writeParagraph(s, 'Casual Leave (CL)', { bold: true, gap: 1 });
  writeParagraph(s,
    `The Employee shall be eligible for eight (8) days of Casual Leave per leave year. Casual Leave shall be ` +
    `calculated on a pro-rata basis in case of mid-year joining. Casual Leave shall be credited in two equal ` +
    `installments, once in April (or on the date of joining, as applicable) and once in October (or on the ` +
    `date of joining, as applicable).`, { gap: 2 });
  writeParagraph(s, 'Loss of Pay (LOP)', { bold: true, gap: 1 });
  writeParagraph(s,
    `Loss of Pay shall be applicable when no other leave balance is available. During any period of Loss of Pay, ` +
    `the Employee shall not be entitled to salary or any allowances. A maximum of ninety (90) days of Loss of ` +
    `Pay may be availed only on medical grounds, subject to submission of valid supporting medical documents and ` +
    `approval by the HR Department.`, { gap: 5 });

  // ── Retirement ──
  writeParagraph(s, 'Retirement', { heading: true, gap: 2 });
  writeParagraph(s,
    `The normal age of retirement for the Employee shall be upon completion of fifty-eight (58) years of age. ` +
    `Notwithstanding the foregoing, the Company may, at its sole discretion, extend the Employee's service for ` +
    `a period of up to two (2) additional years.`, { gap: 2 });
  writeParagraph(s,
    `The Company also reserves the right to retire the Employee prior to attaining the age of 58 years, if the ` +
    `Employee is found to be unable to continue in service satisfactorily due to physical or mental incapacity, ` +
    `illness, or inability to perform assigned duties, as determined by the Company.`, { gap: 5 });

  // ── Intellectual Property ──
  writeParagraph(s, 'Intellectual Property', { heading: true, gap: 2 });
  writeParagraph(s,
    `During the term of employment and at all times thereafter, the Employee shall promptly disclose to the ` +
    `Company and irrevocably assign all rights, title, and interest in and to any Intellectual Property to the Company.`, { gap: 2 });
  writeParagraph(s,
    `For the purposes of this clause, "Intellectual Property" shall include, without limitation, all patents, ` +
    `copyrights, trademarks, trade secrets, designs, mask works, inventions, discoveries, improvements, ideas, ` +
    `processes, data, works of authorship, or developments of any kind, whether or not registrable, which are ` +
    `created, conceived, developed, reduced to practice, or discovered by the Employee, either alone or jointly ` +
    `with others, that:`, { gap: 1 });
  writeParagraph(s, `(a)  arise during the course of employment;`,   { indent: 8, gap: 1 });
  writeParagraph(s, `(b)  relate to the business or activities of the Company; or`, { indent: 8, gap: 1 });
  writeParagraph(s, `(c)  result from the use of the Company's resources, facilities, equipment, or confidential information.`, { indent: 8, gap: 2 });
  writeParagraph(s,
    `All such Intellectual Property shall be the exclusive property of the Company. The Employee shall not ` +
    `undertake any act that conflicts with the Company's ownership rights and shall fully cooperate with the ` +
    `Company in securing, protecting, enforcing, and defending such Intellectual Property.`, { gap: 5 });

  // ── Assets ──
  writeParagraph(s, 'Use of Company Assets', { heading: true, gap: 2 });
  writeParagraph(s,
    `During the course of employment and until all Company assets are duly returned, the Employee shall use ` +
    `all assets provided by the Company solely and exclusively for official business purposes. Company assets ` +
    `include, but are not limited to, computers, laptops, mobile phones, storage devices, networks, SIM cards, ` +
    `dongles, keys, locks, stationery, consumables, email access, software applications of the Company, banks, ` +
    `clients or vendors, digital signatures, uniforms, Company seals, and any other equipment or property issued ` +
    `from time to time.`, { gap: 2 });
  writeParagraph(s,
    `The Employee shall not download, copy, forward, store, or transfer any Company data, emails, documents, ` +
    `files, or information to any personal device without prior written authorization from the Company.`, { gap: 5 });

  // ── Confidentiality ──
  writeParagraph(s, 'Confidentiality & Non-Disclosure', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Employee shall at all times, during and after the term of employment, maintain strict confidentiality ` +
    `of all confidential, proprietary, financial, client-related, and business information of the Company. ` +
    `The Employee shall not, directly or indirectly, disclose, use, copy, or allow access to such information ` +
    `except in the ordinary course of employment and with prior written authorization from the Company.`, { gap: 5 });

  // ── Non-Solicitation ──
  writeParagraph(s, 'Non-Solicitation (Clients, Employees, Business Partners)', { heading: true, gap: 2 });
  writeParagraph(s,
    `During the term of employment and for a period of twelve (12) months following cessation of employment, ` +
    `the Employee shall not directly or indirectly solicit, induce, or attempt to solicit any client, customer, ` +
    `employee, consultant, or business associate of the Company for purposes competing with the business of the Company.`,
    { gap: 5 });

  // ── Conflict of Interest ──
  writeParagraph(s, 'Conflict of Interest', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Employee shall promptly disclose any actual or potential conflict of interest and shall not engage in ` +
    `any business, profession, or employment that conflicts with the interests of the Company, without prior ` +
    `written approval from the Company.`, { gap: 5 });

  // ── Compliance ──
  writeParagraph(s, 'Compliance With Laws & Company Policies', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Employee shall comply with all applicable laws, regulations, and internal policies of the Company, ` +
    `including but not limited to policies relating to data protection, information security, regulatory ` +
    `compliance, and ethical conduct. Any violation may result in disciplinary action, including termination.`,
    { gap: 5 });

  // ── Data Protection ──
  writeParagraph(s, 'Data Protection & IT Security', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Employee shall adhere to the Company's data protection and IT security protocols and shall not store, ` +
    `transmit, or access Company or client data through unauthorized devices, accounts, or networks.`, { gap: 5 });

  // ── Disciplinary ──
  writeParagraph(s, 'Disciplinary Action & Code of Conduct', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Company reserves the right to initiate disciplinary action, including warnings, suspension, or ` +
    `termination, for misconduct, negligence, violation of Company policies, or breach of contractual obligations.`,
    { gap: 5 });

  // ── Effect of Termination ──
  writeParagraph(s, 'Effect of Termination / Resignation', { heading: true, gap: 2 });
  writeParagraph(s,
    `Immediately upon termination or cessation of this employment, whether by resignation, termination, expiry ` +
    `of probation, or otherwise, the Employee shall promptly return to the Company all Company property, ` +
    `including but not limited to documents, records, data, materials, equipment, credentials, and all ` +
    `copies—physical or electronic—of Confidential Information and/or deliverables, whether complete or ` +
    `incomplete, in the Employee's possession or control.`,
    { gap: 2 });
  writeParagraph(s,
    `The Employee shall thereafter refrain from any act or omission that may result in the unauthorized use, ` +
    `disclosure, transmission, misappropriation, or infringement of the Company's Confidential Information ` +
    `and/or Intellectual Property.`, { gap: 2 });
  writeParagraph(s,
    `Upon termination of employment for any reason, any outstanding dues payable by the Employee to the Company ` +
    `may be adjusted, recovered, or set off by the Company against the Employee's full and final settlement, ` +
    `bonus, incentives, or ex-gratia payments, if any. In the event such dues exceed the payable amounts, the ` +
    `Employee shall be liable to pay the balance amount to the Company within seven (7) days from the effective ` +
    `date of termination.`, { gap: 2 });
  writeParagraph(s,
    `If the Employee voluntarily resigns during the probation period, the Employee shall be required to serve a ` +
    `notice period of fifteen (15) working days, without any waiver or adjustment against leave balances.`,
    { gap: 2 });
  writeParagraph(s,
    `If the Employee voluntarily resigns after confirmation of service, the Employee shall be required to serve ` +
    `a notice period of thirty (30) working days, without any waiver or adjustment against leave balances.`,
    { gap: 2 });
  writeParagraph(s,
    `In the event of wilful absconding or unauthorized absence, the Company shall be under no obligation to ` +
    `issue any Service Certificate, Experience Letter, or Relieving Letter to the Employee.`, { gap: 5 });

  // ── Background Verification ──
  writeParagraph(s, 'Background Verification', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Company reserves the right to conduct personal, professional, educational, employment, and background ` +
    `verification of the Employee at any time during the probationary period and/or the course of employment, ` +
    `either directly or through third-party agencies, without providing prior notice to the Employee.`, { gap: 2 });
  writeParagraph(s,
    `If such verification reveals that the Employee has furnished false information, misrepresented facts, or ` +
    `concealed any material information, the Company shall be entitled to terminate the Employee's services with ` +
    `immediate effect, without any notice or compensation, and without prejudice to any other rights or remedies ` +
    `available to the Company under law.`, { gap: 5 });

  // ── Amendment ──
  writeParagraph(s, 'Amendment & Waiver', { heading: true, gap: 2 });
  writeParagraph(s,
    `No amendment or waiver of any provision of this appointment letter shall be valid unless made in writing ` +
    `and signed by an authorized representative of the Company.`, { gap: 5 });

  // ── Governing Law ──
  writeParagraph(s, 'Governing Law & Jurisdiction', { heading: true, gap: 2 });
  writeParagraph(s,
    `This appointment letter shall be governed by and construed in accordance with the laws of India. The ` +
    `courts at Hyderabad, Telangana, shall have exclusive jurisdiction over any disputes arising herefrom.`,
    { gap: 5 });

  // ── Severability ──
  writeParagraph(s, 'Severability', { heading: true, gap: 2 });
  writeParagraph(s,
    `If any provision of this appointment letter is held invalid or unenforceable, the remaining provisions ` +
    `shall continue in full force and effect.`, { gap: 7 });

  writeParagraph(s,
    `IN WITNESS WHEREOF, the undersigned have signed this accord, as of the date first above written.`,
    { bold: true, gap: 5 });

  writeSignatures(s, CO.ceo, CO.ceoTitle, 'SIGNED BY THE WITHIN NAMED EMPLOYEE', data.empName);

  // ── Annexure I ────────────────────────────────────────────────────────────
  // Always start on a new page for the salary table
  drawFooter(s.pdf, s.W);
  s.pdf.addPage();
  s.curPage++;
  drawLetterhead(s.pdf, s.W, refNum, dateStr);
  s.y = BODY_TOP;

  writeParagraph(s, 'Annexure – I', { bold: true, fontSize: 11, gap: 2 });
  writeParagraph(s, 'Details of Remuneration', { bold: true, gap: 1 });
  writeParagraph(s, `Salary Structure: ${data.salutation} ${data.empName}`, { gap: 4 });

  // Calculate totals from salaryRows
  const total = data.salaryRows.reduce((sum, r) => {
    const m = parseFloat(r.monthly.replace(/,/g, '')) || 0;
    return sum + m;
  }, 0);
  const totalMonthly = total.toLocaleString('en-IN');
  const totalAnnual  = (total * 12).toLocaleString('en-IN');

  const tableBody: (string | { content: string; styles: object })[][] = data.salaryRows.map((r) => {
    const monthly = r.monthly.replace(/,/g, '');
    const annual  = ((parseFloat(monthly) || 0) * 12).toLocaleString('en-IN');
    return [r.component, r.description, parseFloat(monthly).toLocaleString('en-IN'), annual];
  });
  tableBody.push(['Gross Salary', '', totalMonthly, totalAnnual]);
  tableBody.push(['TOTAL COST TO COMPANY (CTC)', '', totalMonthly, totalAnnual]);

  autoTable(s.pdf, {
    startY:  s.y,
    head:    [['Salary Component', 'Description', 'Monthly (₹)', 'Annual (₹)']],
    body:    tableBody,
    headStyles:  { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles:  { fontSize: 8.5, textColor: [40, 40, 40] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 70 },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
    didParseCell: (cellData) => {
      if (cellData.row.index >= tableBody.length - 2) {
        cellData.cell.styles.fontStyle = 'bold';
        (cellData.cell.styles as { fillColor: number[] }).fillColor = [240, 236, 222];
      }
    },
    margin: { left: MARGIN, right: MARGIN },
  });
  s.y = ((s.pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY) + 10;

  // Annexure signature row
  if (s.y + 20 > BODY_BOTTOM) { breakPage(s); }
  s.pdf.setFont('helvetica', 'normal');
  s.pdf.setFontSize(FONT_SMALL - 0.5);
  s.pdf.setTextColor(...MUTE);
  s.pdf.text('. . . . . . . . . . . . . . . . . . . . . . . . . . .', MARGIN, s.y);
  s.pdf.text('. . . . . . . . . . . . . . . . . . . . . . . . . . .', s.W - MARGIN, s.y, { align: 'right' });
  s.pdf.setFont('helvetica', 'bold');
  s.pdf.setFontSize(FONT_SMALL);
  s.pdf.setTextColor(...INK);
  s.pdf.text('Signed By HR', MARGIN, s.y + 5);
  s.pdf.text('Signed by Employee', s.W - MARGIN, s.y + 5, { align: 'right' });

  drawFooter(s.pdf, s.W);
  return s.pdf;
}

// ─── OFFER LETTER ─────────────────────────────────────────────────────────────

function buildOfferLetter(data: OfferLetterData, seq: string): jsPDF {
  const dateStr = todayDMY();
  const year    = new Date().getFullYear();
  const refNum  = `FV/${TYPE_ABBREV.offer_letter}/${year}/${seq.padStart(3, '0')}`;
  const pdf     = new jsPDF({ unit: 'mm', format: 'a4' });
  const W       = pdf.internal.pageSize.getWidth();

  drawLetterhead(pdf, W, refNum, dateStr);
  const s: PState = { pdf, y: BODY_TOP, W, refNum, date: dateStr, curPage: 1 };

  // Address block
  s.pdf.setFont('helvetica', 'normal');
  s.pdf.setFontSize(FONT_BODY);
  s.pdf.setTextColor(...INK);
  s.pdf.text('To', MARGIN, s.y); s.y += lh(FONT_BODY) + 1.5;
  s.pdf.text(`${data.salutation} ${data.empName}`, MARGIN, s.y); s.y += lh(FONT_BODY) + 1;
  if (data.careof) {
    s.pdf.text(`C/O ${data.careof}`, MARGIN, s.y); s.y += lh(FONT_BODY) + 1;
  }
  s.y += 5;

  // Subject line
  writeParagraph(s, 'OFFER OF EMPLOYMENT', { bold: true, gap: 4 });

  writeParagraph(s, `Dear ${data.salutation} ${data.empName},`, { gap: 4 });

  writeParagraph(s,
    `We are pleased to extend this offer of employment to you at ${CO.name}. ` +
    `After careful consideration, we believe that your skills and experience will be a valuable addition ` +
    `to our team. Please find the terms of your offer set out below:`,
    { gap: 5 });

  // Terms table
  const tableRows: [string, string][] = [
    ['Designation',      data.designation],
    ['Department',       data.department],
    ['CTC (Per Annum)',  `INR ${data.ctcAnnual}/-`],
    ['Joining Deadline', data.joiningDate],
    ['Probation Period', data.probationPeriod],
    ['Reporting To',     data.reportingTo],
    ['Offer Ref / Code', refNum],
  ];

  autoTable(s.pdf, {
    startY: s.y,
    head:   [['Term', 'Details']],
    body:   tableRows,
    headStyles: {
      fillColor:  NAVY,
      textColor:  [255, 255, 255],
      fontSize:   9,
      fontStyle:  'bold',
      halign:     'left',
    },
    bodyStyles: {
      fontSize:  9,
      textColor: [40, 40, 40],
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 55 },
      1: { cellWidth: 'auto' },
    },
    margin: { left: MARGIN, right: MARGIN },
  });
  s.y = ((s.pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY) + 6;

  writeParagraph(s,
    `This offer is contingent upon successful verification of your credentials, educational qualifications, ` +
    `and the completion of any pre-joining formalities as required by the Company. The Company reserves the ` +
    `right to withdraw this offer in the event of unsatisfactory verification results.`,
    { gap: 4 });

  writeParagraph(s,
    `Please confirm your acceptance of this offer by signing and returning a copy of this letter on or ` +
    `before your joining date. Kindly note that your probation period will be from your joining date to ` +
    `${data.probationEndDate}. Your appointment letter with full terms and conditions will be issued upon joining.`,
    { gap: 6 });

  writeParagraph(s,
    `We look forward to welcoming you to the Finvastra family and wish you a rewarding career with us.`,
    { gap: 7 });

  // Dual signature block — offer letter format
  if (s.y + 35 > BODY_BOTTOM) breakPage(s);

  const sigY = s.y;

  // Left: For the Company
  s.pdf.setFont('helvetica', 'bold');
  s.pdf.setFontSize(FONT_SMALL);
  s.pdf.setTextColor(...INK);
  s.pdf.text(`For ${CO.name}`, MARGIN, sigY);
  s.pdf.setFont('helvetica', 'normal');
  s.pdf.setFontSize(FONT_SMALL - 0.5);
  s.pdf.setTextColor(...MUTE);
  s.pdf.text('. . . . . . . . . . . . . . . . . . . . . . . . . . .', MARGIN, sigY + 10);
  s.pdf.setFont('helvetica', 'bold');
  s.pdf.setFontSize(FONT_SMALL);
  s.pdf.setTextColor(...INK);
  s.pdf.text('Authorised Signatory / Human Resources Department', MARGIN, sigY + 15);

  // Right: Employee signature
  const rx = s.W - MARGIN;
  s.pdf.setFont('helvetica', 'bold');
  s.pdf.setFontSize(FONT_SMALL);
  s.pdf.setTextColor(...INK);
  s.pdf.text(`Employee's Signature`, rx, sigY, { align: 'right' });
  s.pdf.setFont('helvetica', 'normal');
  s.pdf.setFontSize(FONT_SMALL - 0.5);
  s.pdf.setTextColor(...MUTE);
  s.pdf.text('. . . . . . . . . . . . . . . . . . . . . . . . . . .', rx, sigY + 10, { align: 'right' });
  s.pdf.setFont('helvetica', 'normal');
  s.pdf.setFontSize(FONT_SMALL);
  s.pdf.setTextColor(...INK);
  s.pdf.text(`Name: ___________________________`, rx, sigY + 15, { align: 'right' });
  s.pdf.text(`Date: ___________________________`, rx, sigY + 20, { align: 'right' });

  s.y = sigY + 28;

  drawFooter(s.pdf, s.W);
  return s.pdf;
}

// ─── "To" block (used by confirmation + extension letters) ────────────────────

function writeToBlock(s: PState, empCode: string, empName: string, designation: string): void {
  s.pdf.setFont('helvetica', 'normal');
  s.pdf.setFontSize(FONT_BODY);
  s.pdf.setTextColor(...INK);
  s.pdf.text('To',          MARGIN, s.y);       s.y += lh(FONT_BODY) + 1.5;
  s.pdf.text(`Employee Code: ${empCode}`,  MARGIN, s.y);  s.y += lh(FONT_BODY) + 1.5;
  s.pdf.text(`Employee Name: ${empName}`,  MARGIN, s.y);  s.y += lh(FONT_BODY) + 1.5;
  s.pdf.text(`Designation: ${designation}`, MARGIN, s.y); s.y += lh(FONT_BODY) + 5;
}

// ─── CONFIRMATION LETTER ──────────────────────────────────────────────────────

function buildConfirmation(data: ConfirmationData, seq: string): jsPDF {
  const dateStr = todayDMY();
  const year    = new Date().getFullYear();
  const refNum  = `FV/${TYPE_ABBREV.confirmation}/${year}/${seq.padStart(3, '0')}`;
  const pdf     = new jsPDF({ unit: 'mm', format: 'a4' });
  const W       = pdf.internal.pageSize.getWidth();

  drawLetterhead(pdf, W, refNum, dateStr);
  const s: PState = { pdf, y: BODY_TOP, W, refNum, date: dateStr, curPage: 1 };

  const finalDesignation = data.newDesignation?.trim() || data.designation;

  writeToBlock(s, data.empCode, data.empName, data.designation);

  writeParagraph(s, 'Probation Confirmation Letter', { bold: true, gap: 5 });
  writeParagraph(s, `Dear ${data.empName},`, { gap: 4 });
  writeParagraph(s, 'Congratulations!', { bold: true, gap: 4 });
  writeParagraph(s,
    `We are glad to inform you that, based on your performance review during the probationary period ` +
    `from ${data.probationFrom} to ${data.probationTo} your employment with the organization is being ` +
    `confirmed as "${finalDesignation}" effective from ${data.confirmationDate}.`,
    { gap: 5 });
  writeParagraph(s,
    `The terms and conditions as mentioned in your appointment letter shall remain unchanged.`,
    { gap: 5 });
  writeParagraph(s,
    `We look forward to your valuable contributions and wish you all the very best for a successful ` +
    `career with the organization.`,
    { gap: 8 });
  writeParagraph(s, `For ${CO.name}`, { gap: 5 });

  writeHrSignatures(s, data.empName, data.empCode);
  drawFooter(s.pdf, s.W);
  return s.pdf;
}

// ─── PROBATION EXTENSION LETTER ───────────────────────────────────────────────

function buildProbationExtension(data: ProbationExtensionData, seq: string): jsPDF {
  const dateStr = todayDMY();
  const year    = new Date().getFullYear();
  const refNum  = `FV/${TYPE_ABBREV.probation_extension}/${year}/${seq.padStart(3, '0')}`;
  const pdf     = new jsPDF({ unit: 'mm', format: 'a4' });
  const W       = pdf.internal.pageSize.getWidth();

  drawLetterhead(pdf, W, refNum, dateStr);
  const s: PState = { pdf, y: BODY_TOP, W, refNum, date: dateStr, curPage: 1 };

  writeToBlock(s, data.empCode, data.empName, data.designation);

  writeParagraph(s, 'PROBATION EXTENSION LETTER', { bold: true, gap: 5 });
  writeParagraph(s, `Dear ${data.empName},`, { gap: 4 });
  writeParagraph(s,
    `We are issuing this letter to inform you that your ${data.probationDuration} probation period ` +
    `is due end on ${data.originalProbationEnd}.`,
    { gap: 3 });
  writeParagraph(s,
    `This is to bring to your notice that on the basis of your recent assessments and your manager's ` +
    `feedback, we have come to the conclusion that your probation period is extended till ` +
    `${data.extendedUntilDate}.`,
    { gap: 5 });
  writeParagraph(s,
    `This extension will help us to evaluate you thoroughly and also provide you the time to perform ` +
    `better. If your performance is improved and satisfactory as determined by the company, then only ` +
    `your employment will be confirmed with the company.`,
    { gap: 8 });
  writeParagraph(s, `For ${CO.name}`, { gap: 5 });

  writeHrSignatures(s, data.empName, data.empCode);
  drawFooter(s.pdf, s.W);
  return s.pdf;
}

// ─── CONSULTANT AGREEMENT ─────────────────────────────────────────────────────

function buildConsultantAgreement(data: ConsultantAgreementData, seq: string): jsPDF {
  const dateStr = todayDMY();
  const year    = new Date().getFullYear();
  const refNum  = `FV/${TYPE_ABBREV.consultant_agreement}/${year}/${seq.padStart(3, '0')}`;
  const pdf     = new jsPDF({ unit: 'mm', format: 'a4' });
  const W       = pdf.internal.pageSize.getWidth();

  drawLetterhead(pdf, W, refNum, dateStr);
  const s: PState = { pdf, y: BODY_TOP, W, refNum, date: dateStr, curPage: 1 };

  writeParagraph(s, 'CONSULTANCY AGREEMENT', { bold: true, fontSize: 11, gap: 4, center: true });
  writeParagraph(s,
    `This CONSULTANCY AGREEMENT ("Agreement") is entered into as of ${data.startDate}, between:`,
    { gap: 4 });
  writeParagraph(s,
    `${CO.name}, a company incorporated under the provisions of the Companies Act, 2013, having its ` +
    `registered office at H.No. 7-1-617/A, 3rd Floor, Unit No. 305, Imperial Towers, Ameerpet, ` +
    `Hyderabad, Telangana – 500016, hereinafter referred to as the "Company", of the ONE PART.`,
    { gap: 4 });
  writeParagraph(s, 'AND', { bold: true, gap: 3, center: true });
  writeParagraph(s,
    `${data.salutation} ${data.consultantName}, bearing Aadhaar Number ___________________________, ` +
    `residing at ${data.consultantAddress}, hereinafter referred to as the "Consultant", of the OTHER PART.`,
    { gap: 6 });

  writeParagraph(s, '1. Appointment', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Company hereby engages the Consultant, and the Consultant agrees to provide consultancy services ` +
    `to the Company in the capacity of ${data.role} with effect from ${data.startDate} to ${data.endDate}, ` +
    `on a non-exclusive, independent consultant basis.`, { gap: 5 });

  writeParagraph(s, '2. Scope of Services', { heading: true, gap: 2 });
  writeParagraph(s, data.scopeOfServices, { gap: 2 });
  writeParagraph(s,
    `Services must be performed diligently, professionally, and in the best interests of the Company.`,
    { gap: 5 });

  writeParagraph(s, '3. Term', { heading: true, gap: 2 });
  writeParagraph(s,
    `This Agreement shall be valid for an initial term of ${data.termMonths}, commencing from ` +
    `${data.startDate}, unless terminated earlier in accordance with this Agreement. Any extension ` +
    `shall require mutual written consent of both parties.`, { gap: 5 });

  writeParagraph(s, '4. Consultancy Fee', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Consultant shall be paid a consultancy fee of up to INR ${data.feeAmount}/- ` +
    `(Rupees ${data.feeInWords} Only) per month, or such proportionate amount as agreed, ` +
    `inclusive of performance-based incentives.`, { gap: 5 });

  writeParagraph(s, '5. Independent Consultant Relationship', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Consultant is engaged as an independent consultant and not as an employee of the Company. ` +
    `This Agreement shall not entitle the Consultant to any employment benefits including Provident ` +
    `Fund, Employee State Insurance, paid leaves, gratuity, or retirement benefits.`, { gap: 5 });

  writeParagraph(s, '6. Confidentiality & Non-Disclosure', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Consultant shall maintain strict confidentiality of all confidential, proprietary, financial, ` +
    `client-related, and business information of the Company during the term of this Agreement and thereafter.`,
    { gap: 5 });

  writeParagraph(s, '7. Intellectual Property', { heading: true, gap: 2 });
  writeParagraph(s,
    `All work products, data, materials, documents, processes, or intellectual property created or developed ` +
    `by the Consultant during the course of providing services shall be the sole and exclusive property of the Company.`,
    { gap: 5 });

  writeParagraph(s, '8. Conflict of Interest', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Consultant shall not engage in any activities that conflict with the interests of the Company ` +
    `without prior written consent of the Company.`, { gap: 5 });

  writeParagraph(s, '9. Non-Solicitation', { heading: true, gap: 2 });
  writeParagraph(s,
    `During the term of this Agreement and for a period of one (1) month thereafter, the Consultant ` +
    `shall not solicit or attempt to solicit the Company's clients, employees, or business partners ` +
    `for any competing business.`, { gap: 5 });

  writeParagraph(s, '10. Use of Company Assets', { heading: true, gap: 2 });
  writeParagraph(s,
    `Company assets must be used strictly for official purposes and shall be returned immediately ` +
    `upon termination or completion of services.`, { gap: 5 });

  writeParagraph(s, '11. Termination', { heading: true, gap: 2 });
  writeParagraph(s,
    `Either party may terminate this Agreement with seven (7) days' written notice, without assigning ` +
    `any reason. The Company may terminate immediately for breach, misconduct, conflict of interest, ` +
    `or violation of this Agreement.`, { gap: 5 });

  writeParagraph(s, '12. Indemnity', { heading: true, gap: 2 });
  writeParagraph(s,
    `The Consultant agrees to indemnify and hold harmless the Company from any loss, claim, liability, ` +
    `or expense arising out of breach of this Agreement, negligence, or willful misconduct.`, { gap: 5 });

  writeParagraph(s, '13. Severability', { heading: true, gap: 2 });
  writeParagraph(s,
    `If any provision of this Agreement is held to be invalid or unenforceable, the remaining provisions ` +
    `shall remain in full force and effect.`, { gap: 8 });

  writeParagraph(s,
    `IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first above written.`,
    { bold: true, gap: 5 });

  writeSignatures(s, CO.ceo, CO.ceoTitle, 'SIGNED BY THE CONSULTANT', data.consultantName);
  drawFooter(s.pdf, s.W);
  return s.pdf;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generates the letter PDF and returns an ArrayBuffer.
 * Caller uploads to Firebase Storage, retrieves the download URL, and opens it.
 */
export function generateLetterPdf(data: LetterData, seq: string): ArrayBuffer {
  let pdf: jsPDF;
  switch (data.type) {
    case 'offer_letter':         pdf = buildOfferLetter(data, seq);         break;
    case 'appointment':          pdf = buildAppointment(data, seq);         break;
    case 'confirmation':         pdf = buildConfirmation(data, seq);        break;
    case 'probation_extension':  pdf = buildProbationExtension(data, seq);  break;
    case 'consultant_agreement': pdf = buildConsultantAgreement(data, seq); break;
  }
  return pdf.output('arraybuffer') as ArrayBuffer;
}
