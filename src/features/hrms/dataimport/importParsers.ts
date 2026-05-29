/**
 * importParsers.ts
 *
 * Pure parsing + validation logic for the 3 bulk-import types.
 * Each parser takes a raw 2D array (from SheetJS) and returns:
 *   { rows: ParsedRow[], errors: string[] }
 *
 * Parsing is deterministic — no AI, no inference. Columns are matched by
 * header name (case-insensitive, trimmed). Missing required fields are
 * flagged as row-level errors.
 */

// ─── Row types ────────────────────────────────────────────────────────────────

export type AssetRow = {
  rowIndex: number;
  empCode: string;
  assetType: 'laptop' | 'sim_card' | 'mobile_phone' | 'access_card' | 'other';
  assetName: string;
  serialNumber: string;
  imei: string;
  simNumber: string;
  phoneNumber: string;
  assignmentDate: string;   // YYYY-MM-DD after normalisation
  condition: 'good' | 'fair' | 'damaged' | null;
  notes: string;
  _errors: string[];
};

export type LeaveBalanceRow = {
  rowIndex: number;
  empCode: string;
  year: number;
  clTotal: number;   clUsed: number;
  slTotal: number;   slUsed: number;
  elTotal: number;   elUsed: number;
  compOffTotal: number; compOffUsed: number;
  _errors: string[];
};

export type EmployeeProfileRow = {
  rowIndex: number;
  empCode: string;
  joiningDate: string;        // YYYY-MM-DD after normalisation (may be empty)
  grossSalary: number | null;
  department: string;
  designation: string;
  managerEmpCode: string;
  uan: string;
  bloodGroup: string;
  _errors: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a date string in DD-MM-YYYY or YYYY-MM-DD into YYYY-MM-DD. Returns '' on failure. */
export function normaliseDate(raw: string): string {
  const s = (raw ?? '').toString().trim();
  if (!s) return '';
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD-MM-YYYY or DD/MM/YYYY
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  // Excel numeric date (days since 1900-01-01, accounting for Excel's leap-year bug)
  const n = Number(s);
  if (!isNaN(n) && n > 10000) {
    const d = new Date((n - 25569) * 86400 * 1000);
    const yyyy = d.getUTCFullYear();
    const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd   = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return '';
}

/** Build a case-insensitive column-index map from the header row. */
function buildHeaderMap(header: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((cell, i) => {
    if (cell != null) {
      map[String(cell).trim().toLowerCase()] = i;
    }
  });
  return map;
}

/** Read a cell value as a trimmed string, defaulting to ''. */
function str(row: unknown[], idx: number | undefined): string {
  if (idx === undefined || row[idx] == null) return '';
  return String(row[idx]).trim();
}

/** Read a cell value as a number, defaulting to 0. */
function num(row: unknown[], idx: number | undefined): number {
  if (idx === undefined || row[idx] == null) return 0;
  const n = Number(row[idx]);
  return isNaN(n) ? 0 : n;
}

// ─── Asset parser ─────────────────────────────────────────────────────────────

const ASSET_TYPE_MAP: Record<string, AssetRow['assetType']> = {
  laptop: 'laptop', desktop: 'laptop', 'laptop/desktop': 'laptop',
  sim_card: 'sim_card', sim: 'sim_card', 'sim card': 'sim_card',
  mobile_phone: 'mobile_phone', mobile: 'mobile_phone', phone: 'mobile_phone',
  access_card: 'access_card', 'access card': 'access_card', id_card: 'access_card', 'id card': 'access_card',
  other: 'other',
};

const CONDITION_MAP: Record<string, AssetRow['condition']> = {
  good: 'good', fair: 'fair', damaged: 'damaged', '': null,
};

/**
 * Expected columns (case-insensitive):
 * Emp Code | Asset Type | Asset Name | Serial Number | IMEI | SIM Number |
 * Phone Number | Assignment Date | Condition | Notes
 */
export function parseAssetRows(sheetData: unknown[][]): { rows: AssetRow[]; globalErrors: string[] } {
  if (!sheetData.length) return { rows: [], globalErrors: ['Sheet is empty'] };

  const header = sheetData[0] as unknown[];
  const hm = buildHeaderMap(header);

  const required = ['emp code', 'asset type', 'asset name'];
  const missing = required.filter((k) => hm[k] === undefined);
  if (missing.length) {
    return { rows: [], globalErrors: [`Missing required columns: ${missing.join(', ')}`] };
  }

  const rows: AssetRow[] = [];

  for (let i = 1; i < sheetData.length; i++) {
    const r = sheetData[i] as unknown[];
    // Skip completely empty rows
    if (r.every((c) => c == null || String(c).trim() === '')) continue;

    const errors: string[] = [];
    const empCode  = str(r, hm['emp code']);
    const typeRaw  = str(r, hm['asset type']).toLowerCase();
    const assetName = str(r, hm['asset name']);

    if (!empCode)   errors.push('Emp Code is required');
    if (!assetName) errors.push('Asset Name is required');

    const assetType = ASSET_TYPE_MAP[typeRaw] ?? 'other';
    if (!typeRaw)   errors.push('Asset Type is required');

    const dateRaw = str(r, hm['assignment date']);
    const assignmentDate = normaliseDate(dateRaw);
    if (dateRaw && !assignmentDate) errors.push(`Invalid Assignment Date: "${dateRaw}"`);

    const condRaw = str(r, hm['condition']).toLowerCase();
    const condition = CONDITION_MAP[condRaw] ?? null;

    rows.push({
      rowIndex: i + 1,
      empCode,
      assetType,
      assetName,
      serialNumber:   str(r, hm['serial number']),
      imei:           str(r, hm['imei']),
      simNumber:      str(r, hm['sim number']),
      phoneNumber:    str(r, hm['phone number']),
      assignmentDate: assignmentDate || dateRaw,
      condition,
      notes:          str(r, hm['notes']),
      _errors:        errors,
    });
  }

  return { rows, globalErrors: [] };
}

// ─── Leave Balance parser ─────────────────────────────────────────────────────

/**
 * Expected columns (case-insensitive):
 * Emp Code | Year | CL Total | CL Used | SL Total | SL Used |
 * EL Total | EL Used | Comp Off Total | Comp Off Used
 */
export function parseLeaveBalanceRows(sheetData: unknown[][]): { rows: LeaveBalanceRow[]; globalErrors: string[] } {
  if (!sheetData.length) return { rows: [], globalErrors: ['Sheet is empty'] };

  const header = sheetData[0] as unknown[];
  const hm = buildHeaderMap(header);

  const required = ['emp code'];
  const missing = required.filter((k) => hm[k] === undefined);
  if (missing.length) {
    return { rows: [], globalErrors: [`Missing required columns: ${missing.join(', ')}`] };
  }

  const currentYear = new Date().getFullYear();
  const rows: LeaveBalanceRow[] = [];

  for (let i = 1; i < sheetData.length; i++) {
    const r = sheetData[i] as unknown[];
    if (r.every((c) => c == null || String(c).trim() === '')) continue;

    const errors: string[] = [];
    const empCode = str(r, hm['emp code']);
    if (!empCode) errors.push('Emp Code is required');

    const yearRaw = num(r, hm['year']);
    const year    = yearRaw >= 2020 && yearRaw <= 2100 ? yearRaw : currentYear;

    rows.push({
      rowIndex: i + 1,
      empCode,
      year,
      clTotal:      num(r, hm['cl total']),
      clUsed:       num(r, hm['cl used']),
      slTotal:      num(r, hm['sl total']),
      slUsed:       num(r, hm['sl used']),
      elTotal:      num(r, hm['el total']),
      elUsed:       num(r, hm['el used']),
      compOffTotal: num(r, hm['comp off total']),
      compOffUsed:  num(r, hm['comp off used']),
      _errors:      errors,
    });
  }

  return { rows, globalErrors: [] };
}

// ─── Employee Profile parser ──────────────────────────────────────────────────

/**
 * Expected columns (case-insensitive):
 * Emp Code | Joining Date | Gross Salary | Department | Designation |
 * Manager Emp Code | UAN | Blood Group
 *
 * All fields except Emp Code are optional — blank values are skipped (non-destructive).
 */
export function parseEmployeeProfileRows(sheetData: unknown[][]): { rows: EmployeeProfileRow[]; globalErrors: string[] } {
  if (!sheetData.length) return { rows: [], globalErrors: ['Sheet is empty'] };

  const header = sheetData[0] as unknown[];
  const hm = buildHeaderMap(header);

  if (hm['emp code'] === undefined) {
    return { rows: [], globalErrors: ['Missing required column: Emp Code'] };
  }

  const rows: EmployeeProfileRow[] = [];

  for (let i = 1; i < sheetData.length; i++) {
    const r = sheetData[i] as unknown[];
    if (r.every((c) => c == null || String(c).trim() === '')) continue;

    const errors: string[] = [];
    const empCode = str(r, hm['emp code']);
    if (!empCode) errors.push('Emp Code is required');

    const joiningDateRaw = str(r, hm['joining date']);
    const joiningDate    = joiningDateRaw ? normaliseDate(joiningDateRaw) : '';
    if (joiningDateRaw && !joiningDate) errors.push(`Invalid Joining Date: "${joiningDateRaw}"`);

    const salaryRaw = str(r, hm['gross salary']);
    const grossSalary = salaryRaw ? (isNaN(Number(salaryRaw)) ? null : Number(salaryRaw)) : null;
    if (salaryRaw && grossSalary === null) errors.push(`Invalid Gross Salary: "${salaryRaw}"`);

    rows.push({
      rowIndex: i + 1,
      empCode,
      joiningDate,
      grossSalary,
      department:     str(r, hm['department']),
      designation:    str(r, hm['designation']),
      managerEmpCode: str(r, hm['manager emp code']),
      uan:            str(r, hm['uan']),
      bloodGroup:     str(r, hm['blood group']),
      _errors:        errors,
    });
  }

  return { rows, globalErrors: [] };
}

// ─── Template generators ──────────────────────────────────────────────────────
// Generate a CSV string with headers + one example row so the admin knows the format.

export function assetTemplate(): string {
  const headers = 'Emp Code,Asset Type,Asset Name,Serial Number,IMEI,SIM Number,Phone Number,Assignment Date,Condition,Notes';
  const example = 'FAPL-001,laptop,Company Laptop,SN123456,,,, 01-10-2025,good,Assigned at joining';
  return `${headers}\n${example}\n`;
}

export function leaveBalanceTemplate(): string {
  const headers = 'Emp Code,Year,CL Total,CL Used,SL Total,SL Used,EL Total,EL Used,Comp Off Total,Comp Off Used';
  const example = 'FAPL-001,2026,8,2,7,1,15,3,2,1';
  return `${headers}\n${example}\n`;
}

export function employeeProfileTemplate(): string {
  const headers = 'Emp Code,Joining Date,Gross Salary,Department,Designation,Manager Emp Code,UAN,Blood Group';
  const example = 'FAPL-001,01-10-2025,50000,Management,Co-Founder & Director,,100500123456,B+';
  return `${headers}\n${example}\n`;
}
