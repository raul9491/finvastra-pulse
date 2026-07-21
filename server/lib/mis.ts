/**
 * server/lib/mis.ts - MIS statement CSV staging + parsers, lifted from server.ts
 * (2026-07-21, Phase 3). _stagedParsedData is a SHARED module singleton: the
 * upload route writes it and the process route reads/deletes it (cross-request
 * handoff), so both must import THIS one instance. The 4 parsers are pure.
 */

// In-memory staging store for parsed CSV data between upload and process steps.
// Keyed by statementId, cleaned up after 5 min TTL.
const _stagedParsedData = new Map<string, {
  rows: Array<{ rawDate: string; rawDescription: string; rawAmount: string }>;
  detectedColumns: { dateCol: number; descCol: number; amountCol: number };
  headers: string[];
  expiresAt: number;
}>();

function cleanStagedData() {
  const now = Date.now();
  for (const [key, val] of _stagedParsedData.entries()) {
    if (val.expiresAt < now) _stagedParsedData.delete(key);
  }
}

// Simple RFC-4180 compliant CSV row parser
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function detectColumns(headers: string[]): { dateCol: number; descCol: number; amountCol: number } {
  const lower = headers.map(h => h.toLowerCase());
  const dateKw    = ['date','on','at','period','dt'];
  const descKw    = ['desc','narration','remark','name','ref','particular','detail'];
  const amountKw  = ['amount','commission','payment','credit','debit','inr','₹','total'];
  const find = (kws: string[]) => lower.findIndex(h => kws.some(k => h.includes(k)));
  return {
    dateCol:   find(dateKw),
    descCol:   find(descKw),
    amountCol: find(amountKw),
  };
}

function parseFlexibleDate(raw: string): string {
  const s = raw.trim().replace(/\//g, '-');
  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  // Try MM-DD-YYYY
  const mdy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  return s; // return as-is if unparseable
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[₹,\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.abs(n);
}

export { _stagedParsedData, cleanStagedData, parseCsvLine, detectColumns, parseFlexibleDate, parseAmount };
