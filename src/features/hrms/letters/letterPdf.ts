/**
 * letterPdf.ts — HR letter generation using jsPDF.
 *
 * Eight letter types covering the full employee lifecycle:
 *   offer              — pre-joining offer to a candidate
 *   appointment        — formal appointment on joining
 *   confirmation       — probation completion / confirmation of employment
 *   increment          — salary increment notification
 *   noc                — No Objection Certificate (bank loan, passport, study)
 *   salary_certificate — CTC / salary proof for banks / visa
 *   experience         — experience certificate
 *   relieving          — relieving letter on separation
 *
 * Returns: generateLetterPdf() → ArrayBuffer (for Firebase Storage upload).
 * Caller uses getDownloadURL() after upload and opens URL for download.
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export type LetterType =
  | 'offer'
  | 'appointment'
  | 'confirmation'
  | 'increment'
  | 'noc'
  | 'salary_certificate'
  | 'experience'
  | 'relieving';

// ─── Data interfaces ──────────────────────────────────────────────────────────

export interface OfferData {
  type:            'offer';
  empName:         string;
  empCode:         string;   // may be blank for pre-joining candidates
  designation:     string;
  department:      string;
  ctc:             string;   // e.g. "₹4,80,000 per annum"
  joiningDeadline: string;   // e.g. "15-Jun-2026"
  probation:       string;   // e.g. "6 months"
  reportingTo:     string;
}

export interface AppointmentData {
  type:        'appointment';
  empName:     string;
  empCode:     string;
  designation: string;
  department:  string;
  joiningDate: string;   // dd-MMM-yyyy
  ctc:         string;   // e.g. "₹4,80,000 per annum"
  probation:   string;   // e.g. "6 months"
  reportingTo: string;
}

export interface ConfirmationData {
  type:             'confirmation';
  empName:          string;
  empCode:          string;
  designation:      string;
  department:       string;
  joiningDate:      string;
  confirmationDate: string;
  newDesignation:   string;   // empty if no change
}

export interface IncrementData {
  type:          'increment';
  empName:       string;
  empCode:       string;
  designation:   string;
  department:    string;
  effectiveDate: string;
  oldCtc:        string;
  newCtc:        string;
  percentage:    string;   // e.g. "15%"
}

export interface NocData {
  type:        'noc';
  empName:     string;
  empCode:     string;
  designation: string;
  department:  string;
  joiningDate: string;
  purpose:     string;   // e.g. "home loan application", "passport application"
  validUntil:  string;   // e.g. "31-Dec-2026"
}

export interface SalaryCertificateData {
  type:        'salary_certificate';
  empName:     string;
  empCode:     string;
  designation: string;
  department:  string;
  joiningDate: string;
  grossCtc:    string;   // e.g. "₹4,80,000 per annum"
  basicSalary: string;   // e.g. "₹15,000 per month"
  purpose:     string;   // e.g. "home loan application"
}

export interface ExperienceData {
  type:            'experience';
  empName:         string;
  empCode:         string;
  designation:     string;
  department:      string;
  joiningDate:     string;
  lastWorkingDate: string;
}

export interface RelievingData {
  type:            'relieving';
  empName:         string;
  empCode:         string;
  designation:     string;
  department:      string;
  joiningDate:     string;
  lastWorkingDate: string;
  exitReason:      string;
}

export type LetterData =
  | OfferData
  | AppointmentData
  | ConfirmationData
  | IncrementData
  | NocData
  | SalaryCertificateData
  | ExperienceData
  | RelievingData;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NAVY  = [11,  21,  56]  as [number, number, number];
const GOLD  = [201, 169, 97]  as [number, number, number];
const MUTE  = [139, 139, 133] as [number, number, number];

const COMPANY = {
  name:    'Finvastra Advisory Private Limited',
  addr1:   '6-3-571/1, Rock View Colony, Somajiguda',
  addr2:   'Hyderabad, Telangana 500082',
  phone:   '+91 40 2341 0000',
  email:   'hr@finvastra.com',
  website: 'www.finvastra.com',
  cin:     'U74999TG2021PTC153426',
};

export const TYPE_ABBREV: Record<LetterType, string> = {
  offer:               'OFR',
  appointment:         'APT',
  confirmation:        'CON',
  increment:           'INC',
  noc:                 'NOC',
  salary_certificate:  'SAL',
  experience:          'EXP',
  relieving:           'REL',
};

function refNumber(type: LetterType, year: number, seq: string): string {
  return `FV/${TYPE_ABBREV[type]}/${year}/${seq.padStart(3, '0')}`;
}

/** Exported helper so callers can build the ref string without re-duplicating TYPE_ABBREV. */
export function letterRefNumber(type: LetterType, year: number, seq: string): string {
  return refNumber(type, year, seq);
}

function drawLetterhead(pdf: jsPDF, refNum: string, date: string): void {
  const W = pdf.internal.pageSize.getWidth();

  // Navy header bar
  pdf.setFillColor(...NAVY);
  pdf.rect(0, 0, W, 26, 'F');

  // Company name (white)
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(255, 255, 255);
  pdf.text('FINVASTRA', 14, 11);

  // Tagline in gold
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.setTextColor(...GOLD);
  pdf.text('Advisory Private Limited', 14, 16.5);

  // Right: address
  pdf.setFontSize(7);
  pdf.setTextColor(200, 210, 230);
  pdf.text([COMPANY.addr1, COMPANY.addr2, COMPANY.email], W - 14, 8, { align: 'right' });

  // Gold rule
  pdf.setDrawColor(...GOLD);
  pdf.setLineWidth(0.6);
  pdf.line(0, 26, W, 26);

  // Ref + date block (right-aligned, below header)
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(...MUTE);
  pdf.text(`Ref: ${refNum}`, W - 14, 34, { align: 'right' });
  pdf.text(`Date: ${date}`,  W - 14, 40, { align: 'right' });
}

function sectionHeading(pdf: jsPDF, text: string, y: number, W: number): void {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(...NAVY);
  pdf.text(text.toUpperCase(), W / 2, y, { align: 'center' });
  pdf.setDrawColor(...NAVY);
  pdf.setLineWidth(0.3);
  pdf.line(14, y + 2.5, W - 14, y + 2.5);
}

function bodyText(pdf: jsPDF, text: string, x: number, y: number, maxW: number): number {
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(30, 30, 30);
  const lines = pdf.splitTextToSize(text, maxW) as string[];
  pdf.text(lines, x, y);
  return y + lines.length * 5.5;
}

function sigBlock(pdf: jsPDF, y: number, W: number): void {
  const sigY = Math.min(y + 16, pdf.internal.pageSize.getHeight() - 30);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(50, 50, 50);
  pdf.text('For Finvastra Advisory Private Limited', 14, sigY);
  pdf.setFontSize(8);
  pdf.setTextColor(...MUTE);
  pdf.text('Authorised Signatory', 14, sigY + 14);
  pdf.text('Human Resources Department', 14, sigY + 19);

  // Recipient acknowledgement (right side)
  pdf.setFontSize(9);
  pdf.setTextColor(50, 50, 50);
  pdf.text("Employee's Signature", W - 14, sigY, { align: 'right' });
  pdf.setFontSize(8);
  pdf.setTextColor(...MUTE);
  pdf.text('Name: _______________________', W - 14, sigY + 14, { align: 'right' });
  pdf.text('Date: ________________________', W - 14, sigY + 19, { align: 'right' });

  // Footer
  pdf.setDrawColor(...GOLD);
  pdf.setLineWidth(0.3);
  const footerY = pdf.internal.pageSize.getHeight() - 10;
  pdf.line(14, footerY - 4, W - 14, footerY - 4);
  pdf.setFontSize(7);
  pdf.setTextColor(...MUTE);
  pdf.text(`${COMPANY.name}  ·  CIN: ${COMPANY.cin}  ·  ${COMPANY.website}`, W / 2, footerY, { align: 'center' });
}

// ─── Offer letter ─────────────────────────────────────────────────────────────

function buildOffer(data: OfferData, seq: string): jsPDF {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W   = pdf.internal.pageSize.getWidth();
  const today   = new Date();
  const dateStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const ref  = refNumber('offer', today.getFullYear(), seq);

  drawLetterhead(pdf, ref, dateStr);
  sectionHeading(pdf, 'Offer Letter', 52, W);

  let y = 62;
  y = bodyText(pdf, `Dear ${data.empName},`, 14, y, W - 28);
  y += 4;
  y = bodyText(pdf,
    `We are pleased to offer you the position of ${data.designation} in our ${data.department} department ` +
    `at Finvastra Advisory Private Limited. This offer is subject to the terms and conditions set out below.`,
    14, y, W - 28);
  y += 5;

  autoTable(pdf, {
    startY: y,
    head: [['Term', 'Details']],
    body: [
      ['Designation',      data.designation],
      ['Department',       data.department],
      ['CTC',              data.ctc],
      ['Joining Deadline', data.joiningDeadline],
      ['Probation Period', data.probation],
      ['Reporting To',     data.reportingTo],
      ...(data.empCode ? [['Offer Ref / Code', data.empCode]] : []),
    ],
    headStyles:  { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles:  { fontSize: 8.5, textColor: [40, 40, 40] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 } },
    margin: { left: 14, right: 14 },
  });

  y = (pdf as any).lastAutoTable.finalY + 7;
  y = bodyText(pdf,
    'This offer is conditional upon: (a) satisfactory verification of your educational and employment credentials; ' +
    '(b) your signing of the Non-Disclosure Agreement on or before your joining date; (c) completion of the ' +
    'mandatory POSH induction within 30 days of joining.',
    14, y, W - 28);
  y += 4;
  y = bodyText(pdf,
    `Kindly confirm your acceptance of this offer on or before ${data.joiningDeadline} by signing and returning ` +
    'the duplicate copy of this letter.',
    14, y, W - 28);

  sigBlock(pdf, y, W);
  return pdf;
}

// ─── Appointment letter ────────────────────────────────────────────────────────

function buildAppointment(data: AppointmentData, seq: string): jsPDF {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W   = pdf.internal.pageSize.getWidth();
  const today  = new Date();
  const dateStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const ref  = refNumber('appointment', today.getFullYear(), seq);

  drawLetterhead(pdf, ref, dateStr);
  sectionHeading(pdf, 'Appointment Letter', 52, W);

  let y = 62;
  y = bodyText(pdf, `Dear ${data.empName},`, 14, y, W - 28);
  y += 4;
  y = bodyText(pdf,
    `We are pleased to offer you the position of ${data.designation} in our ${data.department} department ` +
    `at Finvastra Advisory Private Limited, with effect from ${data.joiningDate}.`,
    14, y, W - 28);
  y += 5;

  autoTable(pdf, {
    startY: y,
    head: [['Term', 'Details']],
    body: [
      ['Employee Code',   data.empCode],
      ['Designation',     data.designation],
      ['Department',      data.department],
      ['Date of Joining', data.joiningDate],
      ['CTC',             data.ctc],
      ['Probation Period',data.probation],
      ['Reporting To',    data.reportingTo],
    ],
    headStyles:  { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles:  { fontSize: 8.5, textColor: [40, 40, 40] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 } },
    margin: { left: 14, right: 14 },
  });

  y = (pdf as any).lastAutoTable.finalY + 7;
  y = bodyText(pdf,
    'This appointment is subject to: (a) verification of your educational and employment credentials; ' +
    '(b) your signing of the Non-Disclosure Agreement; (c) completion of the mandatory POSH training ' +
    'within 30 days of joining; and (d) satisfactory performance during the probation period.',
    14, y, W - 28);
  y += 4;
  y = bodyText(pdf,
    'Kindly sign and return the duplicate copy of this letter as a token of your acceptance.',
    14, y, W - 28);

  sigBlock(pdf, y, W);
  return pdf;
}

// ─── Confirmation letter ──────────────────────────────────────────────────────

function buildConfirmation(data: ConfirmationData, seq: string): jsPDF {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W   = pdf.internal.pageSize.getWidth();
  const today   = new Date();
  const dateStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const ref  = refNumber('confirmation', today.getFullYear(), seq);

  drawLetterhead(pdf, ref, dateStr);
  sectionHeading(pdf, 'Confirmation of Employment', 52, W);

  let y = 62;
  y = bodyText(pdf, `Dear ${data.empName},`, 14, y, W - 28);
  y += 4;
  y = bodyText(pdf,
    `We are pleased to inform you that upon review of your performance during the probation period, ` +
    `you have been confirmed as a permanent employee of Finvastra Advisory Private Limited ` +
    `with effect from ${data.confirmationDate}.`,
    14, y, W - 28);
  y += 5;

  const tableBody: string[][] = [
    ['Employee Code',       data.empCode],
    ['Name',                data.empName],
    ['Department',          data.department],
    ['Date of Joining',     data.joiningDate],
    ['Confirmation Date',   data.confirmationDate],
    ['Current Designation', data.designation],
  ];
  if (data.newDesignation && data.newDesignation !== data.designation) {
    tableBody.push(['Revised Designation', data.newDesignation]);
  }

  autoTable(pdf, {
    startY: y,
    head: [['Details', 'Information']],
    body: tableBody,
    headStyles:  { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles:  { fontSize: 8.5, textColor: [40, 40, 40] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 } },
    margin: { left: 14, right: 14 },
  });

  y = (pdf as any).lastAutoTable.finalY + 7;
  y = bodyText(pdf,
    'We appreciate your contributions and look forward to your continued growth within the organisation. ' +
    'Your terms of employment remain as specified in your appointment letter unless otherwise communicated.',
    14, y, W - 28);

  sigBlock(pdf, y, W);
  return pdf;
}

// ─── Increment letter ─────────────────────────────────────────────────────────

function buildIncrement(data: IncrementData, seq: string): jsPDF {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W   = pdf.internal.pageSize.getWidth();
  const today   = new Date();
  const dateStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const ref  = refNumber('increment', today.getFullYear(), seq);

  drawLetterhead(pdf, ref, dateStr);
  sectionHeading(pdf, 'Salary Increment Letter', 52, W);

  let y = 62;
  y = bodyText(pdf, `Dear ${data.empName},`, 14, y, W - 28);
  y += 4;
  y = bodyText(pdf,
    `We are pleased to inform you that the management has decided to revise your compensation ` +
    `with effect from ${data.effectiveDate}. This revision is in recognition of your contributions ` +
    `and performance during the review period.`,
    14, y, W - 28);
  y += 5;

  autoTable(pdf, {
    startY: y,
    head: [['Details', 'Information']],
    body: [
      ['Employee Code',  data.empCode],
      ['Name',           data.empName],
      ['Designation',    data.designation],
      ['Department',     data.department],
      ['Previous CTC',   data.oldCtc],
      ['Revised CTC',    data.newCtc],
      ['Increment %',    data.percentage],
      ['Effective Date', data.effectiveDate],
    ],
    headStyles:  { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles:  { fontSize: 8.5, textColor: [40, 40, 40] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 } },
    margin: { left: 14, right: 14 },
  });

  y = (pdf as any).lastAutoTable.finalY + 7;
  y = bodyText(pdf,
    'We appreciate your dedication and commitment to Finvastra. We look forward to your continued ' +
    'excellence and growth within the organisation.',
    14, y, W - 28);

  sigBlock(pdf, y, W);
  return pdf;
}

// ─── NOC ──────────────────────────────────────────────────────────────────────

function buildNoc(data: NocData, seq: string): jsPDF {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W   = pdf.internal.pageSize.getWidth();
  const today   = new Date();
  const dateStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const ref  = refNumber('noc', today.getFullYear(), seq);

  drawLetterhead(pdf, ref, dateStr);
  sectionHeading(pdf, 'No Objection Certificate', 52, W);

  let y = 62;
  y = bodyText(pdf, 'To Whomsoever It May Concern,', 14, y, W - 28);
  y += 4;
  y = bodyText(pdf,
    `This is to certify that ${data.empName} (Employee Code: ${data.empCode}), ${data.designation}, ` +
    `${data.department} department, has been employed with Finvastra Advisory Private Limited ` +
    `since ${data.joiningDate} and is currently on our active rolls.`,
    14, y, W - 28);
  y += 5;
  y = bodyText(pdf,
    `We have no objection to ${data.empName} proceeding with their ${data.purpose}. ` +
    `This certificate is issued at the employee's request and is valid until ${data.validUntil}.`,
    14, y, W - 28);
  y += 5;

  autoTable(pdf, {
    startY: y,
    head: [['Details', 'Information']],
    body: [
      ['Employee Code',  data.empCode],
      ['Name',           data.empName],
      ['Designation',    data.designation],
      ['Department',     data.department],
      ['Date of Joining',data.joiningDate],
      ['Purpose',        data.purpose],
      ['Valid Until',    data.validUntil],
    ],
    headStyles:  { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles:  { fontSize: 8.5, textColor: [40, 40, 40] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 } },
    margin: { left: 14, right: 14 },
  });

  y = (pdf as any).lastAutoTable.finalY + 7;
  y = bodyText(pdf,
    'This certificate is issued purely for informational purposes and does not constitute a guarantee ' +
    'or endorsement of any financial or legal obligation.',
    14, y, W - 28);

  sigBlock(pdf, y, W);
  return pdf;
}

// ─── Salary / CTC Certificate ─────────────────────────────────────────────────

function buildSalaryCertificate(data: SalaryCertificateData, seq: string): jsPDF {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W   = pdf.internal.pageSize.getWidth();
  const today   = new Date();
  const dateStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const ref  = refNumber('salary_certificate', today.getFullYear(), seq);

  drawLetterhead(pdf, ref, dateStr);
  sectionHeading(pdf, 'Salary / CTC Certificate', 52, W);

  let y = 62;
  y = bodyText(pdf, 'To Whomsoever It May Concern,', 14, y, W - 28);
  y += 4;
  y = bodyText(pdf,
    `This is to certify that ${data.empName} (Employee Code: ${data.empCode}), ${data.designation}, ` +
    `${data.department} department, is employed with Finvastra Advisory Private Limited ` +
    `since ${data.joiningDate} on our active rolls.`,
    14, y, W - 28);
  y += 5;

  autoTable(pdf, {
    startY: y,
    head: [['Compensation Details', 'Amount']],
    body: [
      ['Employee Code',           data.empCode],
      ['Name',                    data.empName],
      ['Designation',             data.designation],
      ['Department',              data.department],
      ['Date of Joining',         data.joiningDate],
      ['Gross Annual CTC',        data.grossCtc],
      ['Basic Salary (Monthly)',  data.basicSalary],
      ['Purpose of Certificate',  data.purpose],
    ],
    headStyles:  { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles:  { fontSize: 8.5, textColor: [40, 40, 40] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 70 } },
    margin: { left: 14, right: 14 },
  });

  y = (pdf as any).lastAutoTable.finalY + 7;
  y = bodyText(pdf,
    `This certificate is issued at the employee's request for the purpose of ${data.purpose}. ` +
    'The figures stated above are the gross compensation and are subject to applicable deductions ' +
    'as per company policy and statutory requirements.',
    14, y, W - 28);

  sigBlock(pdf, y, W);
  return pdf;
}

// ─── Experience certificate ───────────────────────────────────────────────────

function buildExperience(data: ExperienceData, seq: string): jsPDF {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W   = pdf.internal.pageSize.getWidth();
  const today   = new Date();
  const dateStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const ref  = refNumber('experience', today.getFullYear(), seq);

  drawLetterhead(pdf, ref, dateStr);
  sectionHeading(pdf, 'Experience Certificate', 52, W);

  let y = 62;
  y = bodyText(pdf, 'To Whomsoever It May Concern,', 14, y, W - 28);
  y += 4;
  y = bodyText(pdf,
    `This is to certify that ${data.empName} (Employee Code: ${data.empCode}) was employed ` +
    `with Finvastra Advisory Private Limited as ${data.designation} in the ${data.department} department ` +
    `from ${data.joiningDate} to ${data.lastWorkingDate}.`,
    14, y, W - 28);
  y += 5;
  y = bodyText(pdf,
    `During the tenure, ${data.empName} demonstrated professionalism, dedication, and a strong work ethic. ` +
    `We found them to be a diligent and reliable team member. We wish them the very best for their future endeavours.`,
    14, y, W - 28);
  y += 5;
  y = bodyText(pdf, 'This certificate is issued on request for the purpose it may serve.', 14, y, W - 28);

  sigBlock(pdf, y, W);
  return pdf;
}

// ─── Relieving letter ─────────────────────────────────────────────────────────

function buildRelieving(data: RelievingData, seq: string): jsPDF {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W   = pdf.internal.pageSize.getWidth();
  const today   = new Date();
  const dateStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const ref  = refNumber('relieving', today.getFullYear(), seq);

  drawLetterhead(pdf, ref, dateStr);
  sectionHeading(pdf, 'Relieving Letter', 52, W);

  let y = 62;
  y = bodyText(pdf, `Dear ${data.empName},`, 14, y, W - 28);
  y += 4;
  y = bodyText(pdf,
    `This is to inform you that your resignation from the position of ${data.designation} ` +
    `in the ${data.department} department has been accepted. Your last working day was ${data.lastWorkingDate}.`,
    14, y, W - 28);
  y += 5;
  y = bodyText(pdf,
    `You joined us on ${data.joiningDate} and over the course of your tenure, you have been a valued ` +
    `member of the Finvastra team. We have completed all exit formalities and you are relieved from your duties.`,
    14, y, W - 28);
  y += 5;
  y = bodyText(pdf,
    'We appreciate your contributions to the organisation and wish you success in your future pursuits.',
    14, y, W - 28);

  sigBlock(pdf, y, W);
  return pdf;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generates the letter PDF and returns an ArrayBuffer.
 * Caller uploads to Firebase Storage, gets the download URL, and opens it.
 */
export function generateLetterPdf(data: LetterData, seq: string): ArrayBuffer {
  let pdf: jsPDF;
  switch (data.type) {
    case 'offer':               pdf = buildOffer(data, seq);               break;
    case 'appointment':         pdf = buildAppointment(data, seq);         break;
    case 'confirmation':        pdf = buildConfirmation(data, seq);        break;
    case 'increment':           pdf = buildIncrement(data, seq);           break;
    case 'noc':                 pdf = buildNoc(data, seq);                 break;
    case 'salary_certificate':  pdf = buildSalaryCertificate(data, seq);  break;
    case 'experience':          pdf = buildExperience(data, seq);          break;
    case 'relieving':           pdf = buildRelieving(data, seq);           break;
  }
  return pdf.output('arraybuffer') as ArrayBuffer;
}

export function letterFilename(data: LetterData, year: number, seq: string): string {
  const abbrev = TYPE_ABBREV[data.type];
  const name   = data.empName.replace(/\s+/g, '_');
  return `FV_${abbrev}_${year}_${seq.padStart(3, '0')}_${name}.pdf`;
}
