// Utility to stamp "Downloaded by X on DD MMM YYYY HH:mm · Finvastra · Confidential"
// on every page of a jsPDF document.
// Used by Application Packet (Agent H, Group 3) and any other PDF exports.

// NOTE: jsPDF must be installed: npm install jspdf jspdf-autotable
// This file is a client-side utility (runs in the browser via jsPDF).

export interface WatermarkOptions {
  downloaderName: string;
  timestamp?: Date;
  companyName?: string;
}

export function addWatermarkToAllPages(
  // Using 'unknown' since jsPDF type may not be installed yet
  doc: {
    getNumberOfPages: () => number;
    setPage: (page: number) => void;
    setFontSize: (size: number) => void;
    setTextColor: (r: number, g: number, b: number) => void;
    setFont: (font: string, style?: string) => void;
    text: (text: string, x: number, y: number, options?: Record<string, unknown>) => void;
    internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
    setDocumentProperties?: (props: Record<string, string>) => void;
  },
  options: WatermarkOptions,
): void {
  const { downloaderName, timestamp = new Date(), companyName = 'Finvastra Pulse' } = options;

  // Format: "Downloaded by Rahul Sharma on 20 May 2026, 14:30 · Finvastra · Confidential"
  const dateStr = timestamp.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  const timeStr = timestamp.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const watermarkText = `Downloaded by ${downloaderName} on ${dateStr}, ${timeStr} · ${companyName} · Confidential`;

  const pageCount = doc.getNumberOfPages();
  const { getWidth, getHeight } = doc.internal.pageSize;

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.setFont('helvetica', 'normal');
    doc.text(watermarkText, getWidth() / 2, getHeight() - 8, { align: 'center' } as Record<string, unknown>);
  }

  // Metadata watermark (survives even if footer is cropped)
  if (doc.setDocumentProperties) {
    doc.setDocumentProperties({
      author: `${downloaderName} — ${companyName}`,
      keywords: `confidential downloaded-by:${downloaderName} date:${dateStr}`,
    });
  }
}
