// Application Packet PDF generator — uses jsPDF (npm install jspdf jspdf-autotable)
// Generates a multi-page PDF for bank submissions.
// Client-side only — do not import in server.ts.

import { addWatermarkToAllPages } from './pdfWatermark';
import { format } from 'date-fns';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface PacketData {
  lead: {
    displayName: string;
    phone: string;
    email?: string;
    panMasked?: string;
    // Full PAN is included here because this PDF goes to the bank.
    // The UI must NEVER expose panRaw directly — only pass it to this generator.
    panRaw?: string;
    consentMethod: string;
    consentTimestamp: unknown;
  };
  opportunity: {
    product: string;
    dealSize: number;
    customFields?: Record<string, unknown>;
    opportunityType: string;
  };
  submission: {
    providerId: string;
    requestedAmount?: number;
    sanctionedAmount?: number;
    interestRate?: number;
    tenureMonths?: number;
    submittedAt?: unknown;
  };
  providerName: string;
  rmName: string;
  documentStatuses: Array<{ label: string; status: string; collectedAt?: string }>;
  generatedBy: string;
  generatedAt: Date;
  referenceId: string;
}

// ─── Structural type that jsPDF satisfies ─────────────────────────────────────
// Mirrors the shape used by addWatermarkToAllPages plus what we need for drawing.

interface JsPDFLike {
  getNumberOfPages: () => number;
  setPage: (page: number) => void;
  setFontSize: (size: number) => void;
  setTextColor: (r: number, g: number, b: number) => void;
  setFont: (font: string, style?: string) => void;
  text: (text: string, x: number, y: number, options?: Record<string, unknown>) => void;
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
  setDocumentProperties?: (props: Record<string, string>) => void;
  // Additional methods used by this generator
  addPage: () => void;
  setDrawColor: (r: number, g: number, b: number) => void;
  setLineWidth: (width: number) => void;
  line: (x1: number, y1: number, x2: number, y2: number) => void;
  setFillColor: (r: number, g: number, b: number) => void;
  rect: (x: number, y: number, w: number, h: number, style?: string) => void;
  save: (filename: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rupees(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

function safeDate(ts: unknown): string {
  if (!ts) return '—';
  try {
    // Handles Firestore Timestamp objects, ISO strings, and Date instances
    const d =
      ts instanceof Date
        ? ts
        : typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: unknown }).toDate === 'function'
          ? (ts as { toDate: () => Date }).toDate()
          : new Date(ts as string);
    return isNaN(d.getTime()) ? '—' : format(d, 'dd MMM yyyy');
  } catch {
    return '—';
  }
}

function formatLabel(key: string): string {
  // camelCase or snake_case → "Title Case"
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Navy and gold as RGB for jsPDF
const NAVY = [11, 21, 56] as const;
const GOLD = [201, 169, 97] as const;
const INK  = [10, 10, 10] as const;
const MUTE = [139, 139, 133] as const;

// ─── Drawing helpers ──────────────────────────────────────────────────────────

function drawSectionHeader(doc: JsPDFLike, title: string, y: number, pageW: number): number {
  // Navy background bar
  doc.setFillColor(...NAVY);
  doc.rect(14, y, pageW - 28, 9, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(title, 18, y + 6.2);
  doc.setTextColor(...INK);
  return y + 14;
}

function drawField(
  doc: JsPDFLike,
  label: string,
  value: string,
  x: number,
  y: number,
): number {
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...MUTE);
  doc.text(label, x, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...INK);
  doc.text(value || '—', x + 55, y);
  return y + 7;
}

function drawHRule(doc: JsPDFLike, y: number, pageW: number): void {
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.5);
  doc.line(14, y, pageW - 14, y);
}

function drawSimpleTable(
  doc: JsPDFLike,
  headers: string[],
  rows: string[][],
  startY: number,
  pageW: number,
): number {
  const colWidths = headers.map(() => (pageW - 28) / headers.length);
  let y = startY;

  // Header row
  doc.setFillColor(...NAVY);
  doc.rect(14, y, pageW - 28, 8, 'F');
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  let x = 16;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], x, y + 5.5);
    x += colWidths[i];
  }
  y += 8;

  // Data rows
  doc.setFont('helvetica', 'normal');
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (r % 2 === 0) {
      doc.setFillColor(250, 250, 247);
      doc.rect(14, y, pageW - 28, 7, 'F');
    }
    doc.setTextColor(...INK);
    doc.setFontSize(8.5);
    x = 16;
    for (let c = 0; c < row.length; c++) {
      doc.text(row[c] ?? '—', x, y + 5);
      x += colWidths[c];
    }
    y += 7;
  }

  return y + 4;
}

// ─── Page builders ─────────────────────────────────────────────────────────────

function buildCoverPage(doc: JsPDFLike, data: PacketData, pageW: number): void {
  let y = 30;

  // Wordmark
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...NAVY);
  doc.text('FINVASTRA', pageW / 2, y, { align: 'center' } as Record<string, unknown>);
  y += 10;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GOLD);
  doc.text('Loan Application Packet', pageW / 2, y, { align: 'center' } as Record<string, unknown>);
  y += 6;

  // Gold rule
  drawHRule(doc, y, pageW);
  y += 10;

  // Summary table
  const summaryRows: string[][] = [
    ['Applicant',   data.lead.displayName],
    ['Loan Type',   data.opportunity.product],
    ['Loan Amount', rupees(data.opportunity.dealSize)],
    ['Bank',        data.providerName],
    ['Submitted',   safeDate(data.submission.submittedAt)],
    ['Reference',   data.referenceId],
  ];

  y = drawSimpleTable(doc, ['Field', 'Detail'], summaryRows, y, pageW);
  y += 6;

  // Documents included line
  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...MUTE);
  doc.text(
    `Documents included: ${data.documentStatuses.length} document${data.documentStatuses.length !== 1 ? 's' : ''}`,
    pageW / 2,
    y,
    { align: 'center' } as Record<string, unknown>,
  );
  y += 8;

  drawHRule(doc, y, pageW);
  y += 10;

  // Generated by
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTE);
  doc.text(
    `Generated by ${data.rmName} on ${format(data.generatedAt, 'dd MMM yyyy, HH:mm')}`,
    pageW / 2,
    y,
    { align: 'center' } as Record<string, unknown>,
  );
}

function buildApplicantPage(doc: JsPDFLike, data: PacketData, pageW: number): void {
  let y = drawSectionHeader(doc, 'APPLICANT INFORMATION', 20, pageW);

  const { lead, opportunity } = data;

  y = drawField(doc, 'Full Name',       lead.displayName,    16, y);
  y = drawField(doc, 'Mobile',          lead.phone,          16, y);
  y = drawField(doc, 'Email',           lead.email ?? '—',   16, y);
  // Full PAN goes to the bank PDF — legal requirement for loan processing
  y = drawField(doc, 'PAN',             lead.panRaw ?? lead.panMasked ?? '—', 16, y);
  y = drawField(doc, 'Consent Method',  lead.consentMethod,  16, y);
  y = drawField(doc, 'Consent Date',    safeDate(lead.consentTimestamp), 16, y);

  // Custom fields — applicant context
  if (opportunity.customFields && Object.keys(opportunity.customFields).length > 0) {
    y += 4;
    drawHRule(doc, y, pageW);
    y += 8;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...MUTE);
    doc.text('ADDITIONAL APPLICANT DETAILS', 16, y);
    y += 8;

    for (const [key, value] of Object.entries(opportunity.customFields)) {
      y = drawField(doc, formatLabel(key), String(value ?? '—'), 16, y);
      if (y > 260) break; // guard against overflow on a single page
    }
  }
}

function buildLoanDetailsPage(doc: JsPDFLike, data: PacketData, pageW: number): void {
  let y = drawSectionHeader(doc, 'LOAN DETAILS', 20, pageW);

  const { opportunity, submission } = data;

  y = drawField(doc, 'Product',          opportunity.product,                               16, y);
  y = drawField(doc, 'Deal Size',        rupees(opportunity.dealSize),                      16, y);
  y = drawField(doc, 'Requested Amount', submission.requestedAmount ? rupees(submission.requestedAmount) : '—', 16, y);
  y = drawField(doc, 'Sanctioned Amount', submission.sanctionedAmount ? rupees(submission.sanctionedAmount) : '—', 16, y);
  y = drawField(doc, 'Interest Rate',    submission.interestRate != null ? `${submission.interestRate}% p.a.` : '—', 16, y);
  y = drawField(doc, 'Tenure',           submission.tenureMonths != null ? `${submission.tenureMonths} months` : '—', 16, y);
  y = drawField(doc, 'Bank',             data.providerName,                                 16, y);
  y = drawField(doc, 'Business Line',    opportunity.opportunityType,                       16, y);

  // Loan-specific custom fields
  if (opportunity.customFields && Object.keys(opportunity.customFields).length > 0) {
    y += 4;
    drawHRule(doc, y, pageW);
    y += 8;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...MUTE);
    doc.text('LOAN PARAMETERS', 16, y);
    y += 8;

    for (const [key, value] of Object.entries(opportunity.customFields)) {
      y = drawField(doc, formatLabel(key), String(value ?? '—'), 16, y);
      if (y > 260) break;
    }
  }
}

function buildDocumentChecklistPage(doc: JsPDFLike, data: PacketData, pageW: number): void {
  const y = drawSectionHeader(doc, 'DOCUMENT CHECKLIST', 20, pageW);

  const rows = data.documentStatuses.map((d) => [
    d.label,
    d.status.charAt(0).toUpperCase() + d.status.slice(1),
    d.collectedAt ?? '—',
  ]);

  drawSimpleTable(
    doc,
    ['Document Name', 'Status', 'Date'],
    rows,
    y,
    pageW,
  );
}

function buildConsentPage(doc: JsPDFLike, data: PacketData, pageW: number): void {
  let y = drawSectionHeader(doc, 'CONSENT & DECLARATIONS', 20, pageW);

  const consentDate = safeDate(data.lead.consentTimestamp);
  const method = data.lead.consentMethod.charAt(0).toUpperCase() + data.lead.consentMethod.slice(1);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...INK);
  doc.text(`Consent was obtained on ${consentDate} via ${method} consent.`, 16, y);
  y += 12;

  drawHRule(doc, y, pageW);
  y += 10;

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...MUTE);
  doc.text('DISCLAIMER', 16, y);
  y += 7;

  const disclaimer = [
    'This document is strictly confidential and intended solely for the named financial institution.',
    'It contains personally identifiable information (PII) including financial data of the loan applicant.',
    'Reproduction, distribution, or disclosure to any third party without express written consent of',
    'Finvastra Financial Services is strictly prohibited.',
    '',
    'The information contained herein has been provided by the applicant and is believed to be accurate.',
    'Finvastra Financial Services does not warrant its completeness and bears no responsibility for',
    'decisions made by the receiving institution based on this document.',
    '',
    'This application packet was prepared and transmitted in accordance with the RBI DSA Master',
    'Directions and the Digital Personal Data Protection Act, 2023.',
  ];

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...INK);
  doc.setFontSize(8.5);
  for (const line of disclaimer) {
    doc.text(line, 16, y);
    y += 5.5;
  }

  y += 8;
  drawHRule(doc, y, pageW);
  y += 10;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...MUTE);
  doc.text(
    `This document was generated by ${data.rmName} on ${format(data.generatedAt, 'dd MMM yyyy, HH:mm')}.`,
    16,
    y,
  );
  y += 6;
  doc.text(`Reference ID: ${data.referenceId}`, 16, y);
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function generateApplicationPacket(data: PacketData): Promise<void> {
  // Dynamic import — handles the case where jsPDF isn't installed without
  // causing a compile-time error (TypeScript sees it as a type-only reference).
  let jsPDFCtor: { new (orientation: string, unit: string, format: string): JsPDFLike };
  try {
    const module = await import('jspdf');
    // jsPDF 4.x exports the constructor as the named export `jsPDF`
    jsPDFCtor = module.jsPDF as unknown as typeof jsPDFCtor;
  } catch {
    throw new Error('jsPDF is not installed. Run: npm install jspdf jspdf-autotable');
  }

  const doc = new jsPDFCtor('portrait', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();

  // ── Page 1: Cover ─────────────────────────────────────────────────────────
  buildCoverPage(doc, data, pageW);

  // ── Page 2: Applicant details ─────────────────────────────────────────────
  doc.addPage();
  buildApplicantPage(doc, data, pageW);

  // ── Page 3: Loan details ──────────────────────────────────────────────────
  doc.addPage();
  buildLoanDetailsPage(doc, data, pageW);

  // ── Page 4: Document checklist ────────────────────────────────────────────
  doc.addPage();
  buildDocumentChecklistPage(doc, data, pageW);

  // ── Page 5: Consent & declarations ───────────────────────────────────────
  doc.addPage();
  buildConsentPage(doc, data, pageW);

  // ── Watermark on every page (downloader attribution + confidential) ───────
  addWatermarkToAllPages(doc, {
    downloaderName: data.rmName,
    timestamp: data.generatedAt,
  });

  // ── Download ──────────────────────────────────────────────────────────────
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 30);
  const filename = `Finvastra-${sanitize(data.providerName)}-${sanitize(data.opportunity.product)}-${sanitize(data.lead.displayName.split(' ')[0])}-${data.generatedAt.toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
