/**
 * server/lib/imports.ts - bulk-ingest helpers (Google Sheets access, employee-row
 * parsing, phone normalization/validation, lead-import hashing + batch write +
 * round-robin distribution). Lifted verbatim from server.ts (2026-07-21, Phase 3
 * refactor) so the import/employee/webhook route groups can share them from one
 * module instead of server.ts's closure. Pure move - behavior unchanged.
 */
import fs from "fs";
import crypto from "crypto";
import { google } from "googleapis";
import { JWT } from "google-auth-library";
import { db, admin } from "../db.js";

// ─── Sheets API helpers ────────────────────────────────────────────────────────

// Returns a Sheets API client using ADC.
// Local dev: run `gcloud auth application-default login` first.
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: "v4", auth: authClient as Parameters<typeof google.sheets>[0]["auth"] });
}

// Returns the service account email (for sharing the Sheet with).
async function getServiceAccountEmail(): Promise<string> {
  try {
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const client = await auth.getClient();
    // JWT / service account clients expose an 'email' property
    const email = (client as { email?: string }).email;
    if (email) return email;
    // Cloud Run metadata fallback
    const res = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email",
      { headers: { "Metadata-Flavor": "Google" } }
    );
    if (res.ok) return await res.text();
  } catch {/* ADC not configured */}
  return "service-account-not-configured@your-project.iam.gserviceaccount.com";
}

function extractSheetId(urlOrId: string): string {
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : urlOrId.trim();
}

// ─── Service-account path for Sheets API ─────────────────────────────────────
// Prefer GOOGLE_APPLICATION_CREDENTIALS env var; fall back to auto-detect.
function getServiceAccountPath(): string | null {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  try {
    const dir   = "C:/Users/raul9/Downloads";
    const files = fs.readdirSync(dir);
    const sa    = files.find((f) => f.includes("firebase-adminsdk") || f.includes("service-account"));
    return sa ? `${dir}/${sa}` : null;
  } catch { return null; }
}

// ─── Employee master sheet reader (service account, not public CSV) ───────────
const EMPLOYEE_SHEET_ID  = "14AQc2MZe9Z2EcS5e8XYVvoPERgNPL2pCVhGHaYA-bPc";
const EMPLOYEE_SHEET_TAB = "Employee Master";

async function fetchEmployeeMasterRows(): Promise<string[][]> {
  const sheets = await getSheetsClient();
  const res    = await sheets.spreadsheets.values.get({
    spreadsheetId: EMPLOYEE_SHEET_ID,
    range:         `${EMPLOYEE_SHEET_TAB}!A1:AC`,
  });
  const rows = res.data.values as string[][] | null;
  if (!rows || rows.length < 3) throw new Error("Sheet returned fewer than 3 rows — check tab name and sharing permissions.");
  return rows.slice(2); // skip 2 header rows
}

// ─── Role resolver (mirrors importEmployeesFromSheet.ts) ──────────────────────
interface SheetRoleAttrs {
  role: "admin" | "employee";
  hrmsAccess: boolean; crmAccess: boolean;
  crmRole: string | null; convertorVertical: string | null;
  isHrmsManager: boolean; misAccess: string | null;
}

function resolveSheetRole(dept: string, desig: string): SheetRoleAttrs {
  const d  = dept.trim().toLowerCase();
  const dg = desig.trim().toLowerCase();
  if (d === "tech")
    return { role:"admin",    hrmsAccess:true,  crmAccess:true,  crmRole:"admin",           convertorVertical:null,   isHrmsManager:false, misAccess:"admin"  };
  if (d === "management" && (dg.includes("director") || dg.includes("co-founder")))
    return { role:"admin",    hrmsAccess:true,  crmAccess:true,  crmRole:"admin",           convertorVertical:null,   isHrmsManager:false, misAccess:"admin"  };
  if (d === "management" && dg.includes("accountant"))
    return { role:"employee", hrmsAccess:true,  crmAccess:false, crmRole:null,              convertorVertical:null,   isHrmsManager:false, misAccess:"viewer" };
  if (d === "management" && (dg.includes("sales manager") || dg.includes("vice president") || dg.includes(" vp")))
    return { role:"employee", hrmsAccess:true,  crmAccess:true,  crmRole:"lead_convertor",  convertorVertical:"loan", isHrmsManager:false, misAccess:null     };
  if (d.includes("bd") || d.includes("client relation")) {
    if (dg.includes("vice president") || dg.includes(" vp") || dg.includes("sales manager") || dg.includes("relationship manager"))
      return { role:"employee", hrmsAccess:true, crmAccess:true, crmRole:"lead_convertor", convertorVertical:"loan", isHrmsManager:false, misAccess:null };
    if (dg.includes("telesales"))
      return { role:"employee", hrmsAccess:true, crmAccess:true, crmRole:"lead_generator", convertorVertical:null,   isHrmsManager:false, misAccess:null };
    return   { role:"employee", hrmsAccess:true, crmAccess:true, crmRole:null,             convertorVertical:null,   isHrmsManager:false, misAccess:null };
  }
  if (d === "hr" && dg.includes("manager"))
    return { role:"employee", hrmsAccess:true,  crmAccess:false, crmRole:null, convertorVertical:null, isHrmsManager:true,  misAccess:null };
  if (d === "consultant")
    return { role:"employee", hrmsAccess:false, crmAccess:false, crmRole:null, convertorVertical:null, isHrmsManager:false, misAccess:null };
  return     { role:"employee", hrmsAccess:true,  crmAccess:false, crmRole:null, convertorVertical:null, isHrmsManager:false, misAccess:null };
}

// Column indices for the employee master sheet (verified 2026-05-21)
const EC = {
  status:1, empCode:2, name:3, dob:4, contactNo:5, personalEmail:6, doj:7,
  officialEmail:8, officialPhone:9, department:10, designation:11, manager:12,
  /* col 13 = aadhaar — never read/stored (UIDAI prohibition) */
  pan:14, uan:15, presentAddr:16, permanentAddr:17,
  personalBankName:18, personalBankBranch:19, personalBankAcct:20, personalBankIfsc:21,
  officialBankName:22, officialBankBranch:23, officialBankAcct:24, officialBankIfsc:25,
  lwd:26, salary:27,
} as const;

function maskPanServer(pan: string): string {
  if (!pan || pan.length < 6) return pan;
  return pan.slice(0, 5) + "****" + pan.slice(-1);
}

function parseEmployeeRow(row: string[]): {
  empCode:string; name:string; status:"active"|"inactive";
  officialEmail:string|null; personalEmail:string|null;
  phone:string|null; officialPhone:string|null;
  dob:string|null; doj:string|null; lwd:string|null;
  department:string|null; designation:string|null; reportingManager:string|null;
  panMasked:string|null; panRaw:string|null; uan:string|null;
  presentAddress:string|null; permanentAddress:string|null;
  personalBankName:string|null; personalBankBranch:string|null;
  personalBankAcct:string|null; personalBankIfsc:string|null;
  officialBankName:string|null; officialBankBranch:string|null;
  officialBankAcct:string|null; officialBankIfsc:string|null;
  grossSalary:number|null;
  roleAttrs: SheetRoleAttrs; needsEmailSetup:boolean;
} {
  const n = (s: string | undefined) => { const t=(s??"").trim(); return (!t||t==="NA")?null:t; };
  const parseDate = (s: string) => { const m=s.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/); return m?`${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`:(/^\d{4}-\d{2}-\d{2}$/.test(s.trim())?s.trim():null); };
  const parseMoney = (s: string) => { const v=parseFloat((s??"").replace(/,/g,"").trim()); return isNaN(v)||v===0?null:v; };

  const statusRaw    = (n(row[EC.status])??"active").toLowerCase();
  const officialEmail = n(row[EC.officialEmail]);
  const panRaw       = n(row[EC.pan]);

  return {
    empCode:         n(row[EC.empCode]) ?? "",
    name:            n(row[EC.name])    ?? "",
    status:          statusRaw.includes("inactive") ? "inactive" : "active",
    officialEmail,
    personalEmail:   n(row[EC.personalEmail]),
    phone:           n(row[EC.contactNo]),
    officialPhone:   n(row[EC.officialPhone]),
    dob:             row[EC.dob]  ? parseDate(row[EC.dob])  : null,
    doj:             row[EC.doj]  ? parseDate(row[EC.doj])  : null,
    lwd:             row[EC.lwd]  ? parseDate(row[EC.lwd])  : null,
    department:      n(row[EC.department]),
    designation:     n(row[EC.designation]),
    reportingManager:n(row[EC.manager]),
    panMasked:       panRaw ? maskPanServer(panRaw) : null,
    panRaw,
    uan:             n(row[EC.uan]),
    presentAddress:  n(row[EC.presentAddr]),
    permanentAddress:n(row[EC.permanentAddr]),
    personalBankName:   n(row[EC.personalBankName]),
    personalBankBranch: n(row[EC.personalBankBranch]),
    personalBankAcct:   n(row[EC.personalBankAcct]),
    personalBankIfsc:   n(row[EC.personalBankIfsc]),
    officialBankName:   n(row[EC.officialBankName]),
    officialBankBranch: n(row[EC.officialBankBranch]),
    officialBankAcct:   n(row[EC.officialBankAcct]),
    officialBankIfsc:   n(row[EC.officialBankIfsc]),
    grossSalary:     row[EC.salary] ? parseMoney(row[EC.salary]) : null,
    roleAttrs:       resolveSheetRole(n(row[EC.department])??"", n(row[EC.designation])??""),
    needsEmailSetup: !officialEmail,
  };
}

// Template Sheet URL — replace with an actual published Sheet before launch
export const TEMPLATE_SHEET_URL = "https://docs.google.com/spreadsheets/d/REPLACE_WITH_TEMPLATE_ID";

interface ParsedRow {
  rowNumber: number;
  data: Record<string, string>;
  valid: boolean;
  errors: string[];
}

// Accept BOTH 10-digit mobiles (6-9) AND landlines (with/without STD code),
// e.g. "040-66320094". Business lists legitimately contain landline numbers.
// Strips non-digits, an optional +91, and STD leading zero, then accepts a
// mobile or any plausible 8–12-digit landline. Only blank / garbage is rejected.
function isOnePhone(token: string): boolean {
  let d = token.replace(/\D/g, "");
  if (d.startsWith("91") && d.length >= 12) d = d.slice(2);   // +91 / 91 prefix
  d = d.replace(/^0+/, "");                                    // STD leading zero(s)
  if (/^[6-9]\d{9}$/.test(d)) return true;                     // mobile
  return d.length >= 8 && d.length <= 12;                      // landline / STD
}

// A phone CELL may legitimately hold MULTIPLE numbers separated by a comma /
// slash / semicolon / & / newline — e.g. "9885299945, 9885012345". Return every
// valid one (trimmed, order preserved, de-duped) so an agent can try both.
function splitPhones(raw: string): string[] {
  const out: string[] = [];
  for (const part of String(raw ?? "").split(/[,/;&\n]+/)) {
    const t = part.trim();
    if (t && isOnePhone(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

// A cell is acceptable if it yields at least one valid number (one or many).
function isImportablePhone(rawPhone: string): boolean {
  return splitPhones(rawPhone).length > 0;
}

// ─── CANONICAL STORED PHONE FORM ────────────────────────────────────────────────
// THE dedup contract: every write of `lead.phone` / `lead.altPhones` in this file
// stores this exact form, and every duplicate check compares canonical vs
// canonical. Rules:
//   1. Digits only — strip "+", spaces, dashes, dots, parens, everything non-digit.
//   2. Strip ONE leading "91" country code ONLY when the remainder is a valid
//      10-digit Indian mobile (starts 6-9): "+91 98852 99945" → "9885299945".
//   3. Landlines keep their digits EXACTLY as given, INCLUDING the STD leading
//      zero: "040-66320094" → "04066320094". We deliberately do NOT strip the
//      trunk "0" — "080-6632-0094" minus its zero would collide with the genuine
//      mobile "8066320094".
// This is a DIFFERENT contract from:
//   • normaliseIndianPhone (webhook intake) — returns null unless a valid MOBILE
//     (its 10-digit output is already canonical, so those writes need no change);
//   • isOnePhone (import validation) — also strips the STD zero, but only to judge
//     plausibility; it never decides the stored form.
// Do not merge them.
function canonicalPhone(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("91") && /^[6-9]\d{9}$/.test(digits.slice(2))) return digits.slice(2);
  return digits;
}

// Some source rows merge the phone into the NAME cell, e.g.
// "3M Car Care Gachibowli | 073373 93337" with an empty phone column.
// When the phone cell is blank/invalid, pull a phone-like token out of the name
// (a run of 8+ digits, optional spaces/dashes/+) and clean it off the name.
// Gated by isImportablePhone so shop numbers / addresses aren't mistaken for phones.
function salvagePhoneFromName(name: string): { phone: string; cleanName: string } | null {
  const matches = name.match(/\+?\d[\d\s\-]{6,}\d/g);
  if (!matches) return null;
  for (let i = matches.length - 1; i >= 0; i--) {   // phones usually trail the name
    const cand = matches[i].trim();
    if (isImportablePhone(cand)) {
      const cleanName = name.replace(cand, "").replace(/[\s|,/–-]+$/, "").replace(/^[\s|,/–-]+/, "").trim();
      return { phone: cand, cleanName: cleanName || name };
    }
  }
  return null;
}

// Validate already-extracted cells (shared by validateRow + the retry-errors path).
function validateCells(c: ReturnType<typeof extractCells>): string[] {
  const errors: string[] = [];
  if (!c.displayName) errors.push("Name is required");
  if (!c.phone) {
    errors.push("Phone is required");
  } else if (!isImportablePhone(c.phone)) {
    errors.push("Phone must be a valid mobile or landline number");
  }
  if (c.panRaw && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(c.panRaw)) {
    errors.push("PAN format invalid (expected ABCDE1234F)");
  }
  // NOTE: an unrecognised product is deliberately NOT an error — the lead still
  // imports (without an opportunity) and the raw value is kept in its notes.
  if (c.dealSize && isNaN(Number(c.dealSize))) errors.push("Deal size must be a number");
  if (c.triagePriority && !["high", "medium", "low", ""].includes(c.triagePriority.toLowerCase())) {
    errors.push("Priority must be: high, medium, or low");
  }
  return errors;
}

function validateRow(raw: string[], mapping: ColumnMapping, _loanProducts: Set<string>): ParsedRow["errors"] {
  return validateCells(extractCells(raw, mapping));
}

// Import dedup hash — built on the CANONICAL phone so the same number in any
// formatting ("+91 98852 99945" vs "9885299945") hashes identically.
function buildImportHash(phone: string, email: string, displayName: string): string {
  return crypto
    .createHash("sha256")
    .update(`${canonicalPhone(phone)}|${email.toLowerCase()}|${displayName.toLowerCase()}`)
    .digest("hex");
}

// TRANSITION-ONLY: leads imported before phone canonicalisation (2026-07) carry an
// importHash built on the RAW phone cell. Keep computing that legacy form so
// re-imports still dedup against pre-fix leads until the phone backfill
// (/api/admin/backfill-phone-normalization) has rewritten their hashes.
function buildImportHashLegacy(phone: string, email: string, displayName: string): string {
  return crypto
    .createHash("sha256")
    .update(`${phone}|${email.toLowerCase()}|${displayName.toLowerCase()}`)
    .digest("hex");
}

// Which of the given import-hash pairs already exist on /leads? Checks the
// canonical hash AND (transition) the legacy raw-phone hash. Chunks at the
// Firestore `in` limit of 30 internally; returns the set of matched hashes —
// callers test `has(importHash) || has(legacyHash)`.
async function findExistingImportHashes(
  pairs: Array<{ importHash: string; legacyHash: string }>,
): Promise<Set<string>> {
  const wanted = new Set<string>();
  for (const p of pairs) {
    wanted.add(p.importHash);
    if (p.legacyHash !== p.importHash) wanted.add(p.legacyHash);
  }
  const found = new Set<string>();
  const all = [...wanted];
  for (let i = 0; i < all.length; i += 30) {
    const snap = await db.collection("leads")
      .where("importHash", "in", all.slice(i, i + 30))
      .get();
    for (const d of snap.docs) found.add(d.data().importHash as string);
  }
  return found;
}

async function getLeadGenerators(): Promise<{ userId: string }[]> {
  const snap = await db.collection("users")
    .where("crmRole", "==", "lead_generator")
    .where("crmAccess", "==", true)
    .get();
  if (snap.empty) {
    // Fall back to admins if no generators exist yet
    const adminSnap = await db.collection("users").where("role", "==", "admin").limit(5).get();
    return adminSnap.docs.map(d => ({ userId: d.id })).sort((a, b) => a.userId.localeCompare(b.userId));
  }
  return snap.docs.map(d => ({ userId: d.id })).sort((a, b) => a.userId.localeCompare(b.userId));
}

// Maps known product name variations to the canonical name in opportunity_types
const PRODUCT_ALIASES: Record<string, string> = {
  'housing loan': 'Home Loan', 'home loan': 'Home Loan',
  'lap': 'LAP', 'loan against property': 'LAP',
  'personal loan': 'Personal Loan', 'pl': 'Personal Loan',
  'business loan': 'Business Loan', 'bl': 'Business Loan',
  'unsecured business loan': 'Business Loan (Unsecured)',
  'education loan': 'Education Loan', 'edu loan': 'Education Loan',
  'auto loan': 'Auto Loan', 'car loan': 'Auto Loan',
  'two wheeler loan': 'Two-Wheeler Loan',
};

// Keyword hints per field (header must CONTAIN one of these substrings)
const FIELD_HEADER_HINTS: Record<string, string[]> = {
  displayName:    ['name', 'full name', 'customer', 'applicant', 'client', 'borrower'],
  phone:          ['phone', 'mobile', 'contact', 'mob', 'cell'],
  email:          ['email', 'mail'],
  panRaw:         ['pan'],
  loanProduct:    ['product', 'loan type', 'scheme', 'type', 'service', 'requirement', 'category'],
  dealSize:       ['amount', 'deal', 'size', 'ticket', 'loan amount', 'value', 'quantum'],
  address:        ['address', 'city', 'location', 'area', 'district', 'state', 'pincode'],
  triagePriority: ['priority', 'urgent', 'triage'],
  notes:          ['note', 'remark', 'comment'],
};

interface ColumnMapping {
  displayName?:    number;
  phone?:          number;
  email?:          number;
  panRaw?:         number;
  loanProduct?:    number;
  dealSize?:       number;
  address?:        number;
  triagePriority?: number;
  notes?:          number;
}

function detectColumnMapping(
  headers: string[],
  sampleRows: string[][],
  loanProducts: Set<string>,
): ColumnMapping {
  type FieldName = keyof ColumnMapping;
  const fields = Object.keys(FIELD_HEADER_HINTS) as FieldName[];

  // Score[col][field] = confidence score (higher = more likely)
  const scores: Array<Partial<Record<FieldName, number>>> = headers.map((h, col) => {
    const header = h.toLowerCase().trim();
    const sampleVals = sampleRows.map(r => (r[col] ?? '').trim()).filter(Boolean);
    const total = sampleVals.length || 1;
    const fieldScore: Partial<Record<FieldName, number>> = {};

    // Header keyword scoring
    for (const field of fields) {
      const hints = FIELD_HEADER_HINTS[field];
      if (hints.some(kw => header.includes(kw))) {
        fieldScore[field] = (fieldScore[field] ?? 0) + 80;
      }
    }

    // Data pattern scoring (mobiles AND landlines count as phone-like)
    const phoneHits    = sampleVals.filter(v => isImportablePhone(v)).length / total;
    const emailHits    = sampleVals.filter(v => v.includes('@') && v.includes('.')).length / total;
    const panHits      = sampleVals.filter(v => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v)).length / total;
    const productHits  = sampleVals.filter(v => {
      const lc = v.toLowerCase();
      return loanProducts.has(v) || !!PRODUCT_ALIASES[lc];
    }).length / total;
    const numericHits  = sampleVals.filter(v => v !== '' && !isNaN(Number(v)) && Number(v) > 0).length / total;
    const priorityHits = sampleVals.filter(v => ['high','medium','low'].includes(v.toLowerCase())).length / total;

    if (phoneHits    > 0.5) fieldScore['phone']          = (fieldScore['phone']          ?? 0) + 90;
    if (emailHits    > 0.4) fieldScore['email']           = (fieldScore['email']           ?? 0) + 85;
    if (panHits      > 0.3) fieldScore['panRaw']          = (fieldScore['panRaw']          ?? 0) + 90;
    if (productHits  > 0.3) fieldScore['loanProduct']     = (fieldScore['loanProduct']     ?? 0) + 90;
    if (numericHits  > 0.6) fieldScore['dealSize']        = (fieldScore['dealSize']        ?? 0) + 60;
    if (priorityHits > 0.4) fieldScore['triagePriority']  = (fieldScore['triagePriority']  ?? 0) + 85;

    return fieldScore;
  });

  // Greedy assignment: pick highest-scoring (col, field) pair, mark both as used
  const usedCols   = new Set<number>();
  const usedFields = new Set<FieldName>();
  const mapping: ColumnMapping = {};

  type Candidate = { col: number; field: FieldName; score: number };
  const candidates: Candidate[] = [];
  for (let col = 0; col < headers.length; col++) {
    for (const field of fields) {
      const score = scores[col][field] ?? 0;
      if (score > 30) candidates.push({ col, field, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  for (const { col, field, score } of candidates) {
    if (usedCols.has(col) || usedFields.has(field)) continue;
    if (score < 30) break;
    mapping[field] = col;
    usedCols.add(col);
    usedFields.add(field);
  }

  return mapping;
}

function normaliseProduct(raw: string, loanProducts: Set<string>): string {
  if (loanProducts.has(raw)) return raw;
  const alias = PRODUCT_ALIASES[raw.toLowerCase()];
  if (alias && loanProducts.has(alias)) return alias;
  // Case-insensitive search
  for (const p of loanProducts) {
    if (p.toLowerCase() === raw.toLowerCase()) return p;
  }
  return raw; // return as-is; will fail validation
}

function extractCells(raw: string[], mapping: ColumnMapping, headers?: string[]): {
  displayName: string; phone: string; altPhones: string[]; email: string; panRaw: string;
  loanProduct: string; dealSize: string; address: string;
  triagePriority: string; notes: string; importExtras: Record<string, string>;
} {
  const g = (f: keyof ColumnMapping) => mapping[f] !== undefined ? (raw[mapping[f]!] ?? '').trim() : '';
  let displayName = g('displayName');
  // A phone cell may hold several numbers ("9885299945, 9885012345") — take the
  // first valid one as the primary; keep the rest as alternates so an agent can
  // try every number on the row.
  const phones = splitPhones(g('phone'));
  let phone = phones[0] ?? '';
  let altPhones = phones.slice(1);
  // Salvage a phone embedded in the name cell when the phone column is empty/invalid.
  if (!phone && displayName) {
    const salv = salvagePhoneFromName(displayName);
    if (salv) { phone = salv.phone; displayName = salv.cleanName; }
  }
  // Preserve EVERY other column from the sheet (amount, city, branch, source, …) as
  // header→value so nothing useful is lost — telecallers/managers see it on the
  // customer. Exclude the columns already shown as first-class fields, and NEVER
  // include the PAN column (must stay masked). dealSize/product/priority + all
  // unmapped columns are kept, so e.g. "Disbursed Amount" always survives.
  const importExtras: Record<string, string> = {};
  if (headers && headers.length) {
    const EXCLUDE: Array<keyof ColumnMapping> = ['displayName', 'phone', 'email', 'panRaw', 'address', 'notes'];
    const excludedCols = new Set(EXCLUDE.map((f) => mapping[f]).filter((c): c is number => c !== undefined));
    for (let i = 0; i < headers.length && Object.keys(importExtras).length < 40; i++) {
      if (excludedCols.has(i)) continue;
      const label = (headers[i] ?? '').trim();
      const val   = (raw[i] ?? '').trim();
      if (label && val) importExtras[label] = val.slice(0, 500);
    }
  }
  return {
    displayName,
    phone,
    altPhones,
    email:          g('email'),
    panRaw:         g('panRaw'),
    loanProduct:    g('loanProduct'),
    dealSize:       g('dealSize'),
    address:        g('address'),
    triagePriority: g('triagePriority'),
    notes:          g('notes'),
    importExtras,
  };
}

// Writes ONE imported lead (+ optional opportunity & creation activity) into the
// batch. Shared by processImportBatch and the retry-errors path so they never diverge.
function writeImportedLead(
  batch: admin.firestore.WriteBatch,
  cells: ReturnType<typeof extractCells>,
  ctx: { batchId: string; importName: string; triggerUserId: string; importHash: string; loanProducts: Set<string> },
): void {
  const { displayName, email, panRaw, address } = cells;
  // Store the CANONICAL phone form (see canonicalPhone) so webhook-created and
  // imported leads dedup against each other — the raw sheet token may carry
  // "+91", spaces or dashes. Alternates are canonicalised, de-duped and never
  // repeat the primary.
  const phone = canonicalPhone(cells.phone);
  const altPhones = Array.from(new Set(
    (cells.altPhones ?? []).map(canonicalPhone).filter((p) => p && p !== phone),
  ));
  const importExtras = cells.importExtras ?? {};
  const loanProduct = normaliseProduct(cells.loanProduct, ctx.loanProducts);
  const productValid = !!loanProduct && ctx.loanProducts.has(loanProduct);
  // Unrecognised product values aren't lost — they ride along in the lead's notes.
  // Alternate numbers are surfaced in notes too, so an agent sees them even on
  // screens that only render the primary phone.
  const notes = [
    cells.notes,
    cells.loanProduct && !productValid ? `Imported product value: ${cells.loanProduct}` : '',
    altPhones.length ? `Alt phone${altPhones.length > 1 ? 's' : ''}: ${altPhones.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
  const assignedOwner = "UNASSIGNED";   // held UNASSIGNED until distributed from the queue
  const slaDeadline = new Date();
  slaDeadline.setHours(slaDeadline.getHours() + 24);

  const leadRef = db.collection("leads").doc();
  batch.set(leadRef, {
    displayName,
    phone,
    ...(altPhones.length ? { altPhones } : {}),
    ...(email   ? { email   } : {}),
    ...(panRaw  ? { panRaw  } : {}),
    ...(address ? { address } : {}),
    ...(notes   ? { notes   } : {}),
    ...(Object.keys(importExtras).length ? { importExtras } : {}),
    source:           "offline_bulk",
    tags:             [],
    primaryOwnerId:   assignedOwner,
    consentGiven:     true,
    consentTimestamp: admin.firestore.FieldValue.serverTimestamp(),
    consentMethod:    "offline_collection",
    slaDeadline:      admin.firestore.Timestamp.fromDate(slaDeadline),
    triagePriority:   (cells.triagePriority || "low").toLowerCase(),
    importBatchId:    ctx.batchId,
    importName:       ctx.importName,
    importHash:       ctx.importHash,
    importedBy:       ctx.triggerUserId,
    importedAt:       admin.firestore.FieldValue.serverTimestamp(),
    createdAt:        admin.firestore.FieldValue.serverTimestamp(),
    createdBy:        ctx.triggerUserId,
    updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
    deleted:          false,
    firstContactedAt: null,
  });

  if (productValid) {
    const oppRef = leadRef.collection("opportunities").doc();
    batch.set(oppRef, {
      opportunityType: "loan",
      product:         loanProduct,
      dealSize:        cells.dealSize ? Number(cells.dealSize) : 0,
      stage:           "New",
      ownerId:         assignedOwner,
      status:          "open",
      ...(notes ? { notes } : {}),
      createdAt:       admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
    });
    const actRef = oppRef.collection("activities").doc();
    batch.set(actRef, {
      type:    "note",
      content: `Lead imported from offline_bulk batch ${ctx.batchId}`,
      by:  ctx.triggerUserId,
      at:  admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

// Runs import in background — DO NOT await this from request handlers.
// Phase 6 hardening: move to a Cloud Function for >10K rows to avoid Cloud Run timeout.
async function processImportBatch(
  jobId: string,
  sheetId: string,
  _skipErrors: boolean,  // kept for signature compat; invalid rows are now always skipped
  triggerUserId: string,
  batchId: string,
  rows: string[][],
  loanProducts: Set<string>,
  columnMapping: ColumnMapping,
  importName: string,
  headers: string[] = [],   // sheet header row — preserved as importExtras so no column is lost
): Promise<void> {
  const jobRef = db.collection("import_jobs").doc(jobId);
  const totalRows = rows.length;
  let processedRows = 0, successCount = 0, errorCount = 0, duplicateCount = 0;
  const errors: Array<{ row: number; data: Record<string, string>; reason: string }> = [];

  // PERFORMANCE: rows are processed in chunks of 30 — one `in` duplicate query
  // + one WriteBatch commit + one progress update per chunk (3 round-trips per
  // 30 rows). The previous per-row read+commit design made ~2 sequential
  // round-trips per row, which on large sheets took tens of minutes.
  const CHUNK = 30; // Firestore `in` filter limit
  const seenHashes = new Set<string>(); // intra-sheet duplicate detection

  for (let start = 0; start < rows.length; start += CHUNK) {
    const slice = rows.slice(start, start + CHUNK);

    // 1. Validate the chunk in memory
    type Entry = {
      rowNum: number; cells: ReturnType<typeof extractCells>;
      rowData: Record<string, string>; importHash: string; legacyHash: string;
    };
    const entries: Entry[] = [];
    for (let j = 0; j < slice.length; j++) {
      const raw = slice[j];
      const rowNum = start + j + 2; // 1=header, data starts at 2
      const cells = extractCells(raw, columnMapping, headers);
      const rowData: Record<string, string> = cells as unknown as Record<string, string>;
      const rowErrors = validateRow(raw, columnMapping, loanProducts);

      if (rowErrors.length > 0) {
        // Invalid rows are ALWAYS skipped — never import bad data. The skipErrors
        // flag only controls whether the UI lets an import start with known
        // preview errors.
        errorCount++;
        if (errors.length < 1000) errors.push({ row: rowNum, data: rowData, reason: rowErrors.join("; ") });
        continue;
      }

      const importHash = buildImportHash(cells.phone, cells.email, cells.displayName);
      if (seenHashes.has(importHash)) {
        // Duplicates are NOT validation errors — count them separately so the
        // uploader sees a clear "N duplicates removed" figure, and they stay out
        // of the retryable error list (re-trying a dup can't help).
        duplicateCount++;
        continue;
      }
      seenHashes.add(importHash);
      entries.push({
        rowNum, cells, rowData, importHash,
        legacyHash: buildImportHashLegacy(cells.phone, cells.email, cells.displayName),
      });
    }

    // 2. One duplicate-check pass for the whole chunk — matches the canonical
    // hash AND (transition) the legacy raw-phone hash of pre-fix leads.
    const existingHashes = entries.length > 0 ? await findExistingImportHashes(entries) : new Set<string>();

    // 3. One WriteBatch for the whole chunk (≤30 leads × ≤3 docs = ≤90 ops, well under 500)
    const batch = db.batch();
    let chunkSuccess = 0;

    for (const e of entries) {
      if (existingHashes.has(e.importHash) || existingHashes.has(e.legacyHash)) {
        duplicateCount++;   // already in the system — skipped, counted as a duplicate (not an error)
        continue;
      }

      writeImportedLead(batch, e.cells, { batchId, importName, triggerUserId, importHash: e.importHash, loanProducts });
      chunkSuccess++;
    }

    if (chunkSuccess > 0) await batch.commit();
    successCount += chunkSuccess;
    processedRows += slice.length;

    // 4. Live progress per chunk (drives the ImportProgressDock).
    // Counts ONLY — the errors array (up to 1000 entries with row data) is written
    // once at the end. Including it here made every progress tick re-stream a huge
    // doc to every subscribed client, visibly slowing the whole CRM during imports.
    await jobRef.update({ processedRows, successCount, errorCount, duplicateCount });
  }

  // Final update. Duplicates are skipped-but-fine, so they don't make a job "failed".
  const status = (errorCount > 0 && successCount === 0) ? "failed" : (errorCount > 0 ? "partial" : "completed");
  await jobRef.update({
    processedRows: totalRows,
    successCount,
    errorCount,
    duplicateCount,
    errors,
    status,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ─── Distribute a held import batch to selected agents (round-robin) ───────────
// Imported leads sit with primaryOwnerId === "UNASSIGNED" until an admin/manager routes
// them from the Import Queue. This reassigns every still-unassigned lead in the batch across
// the chosen agents, re-owns their open opportunities, resets the SLA, and notifies each
// agent once with their new lead count.
async function distributeBatch(
  jobId: string,
  batchId: string,
  agentIds: string[],
  actorUid: string,
  importName: string,
  perAgentCap?: number,   // when set, assign at most this many to EACH agent; the rest stay UNASSIGNED for the next round
): Promise<void> {
  const jobRef = db.collection("import_jobs").doc(jobId);
  const agents = [...agentIds].sort((a, b) => a.localeCompare(b)); // deterministic order
  const assignedCountByAgent: Record<string, number> = {};

  const leadsSnap = await db.collection("leads")
    .where("importBatchId", "==", batchId)
    .where("primaryOwnerId", "==", "UNASSIGNED")
    .where("deleted", "==", false)
    .get();

  // Round-robin assigns agents[(idx) % agents.length], so the first (cap × agents) leads give
  // each agent AT MOST `cap` — slicing to that count enforces the per-agent cap; leftover stays
  // UNASSIGNED and the batch re-surfaces in the Import Queue for the next round.
  const docs = (perAgentCap && perAgentCap > 0)
    ? leadsSnap.docs.slice(0, perAgentCap * agents.length)
    : leadsSnap.docs;

  // Owner is pre-assigned by position (deterministic round-robin, as before). A
  // lead that turns out to be already claimed simply doesn't fill its agent's
  // slot — an agent can end up with FEWER than the cap, never more.
  const planned = docs.map((d, i) => ({ ref: d.ref, owner: agents[i % agents.length] }));

  // RACE FIX: leads are claimed in chunked TRANSACTIONS that re-read each lead and
  // re-check it is still UNASSIGNED — the telecaller self-pull endpoint
  // (/api/leads/pull) claims via the same in-transaction check, so a concurrent
  // pull can no longer be clobbered by a blind write; whoever commits second sees
  // the lead is taken and skips it. Skipped leads do NOT count as distributed.
  // Opportunity re-owning + the activity log ride in the SAME transaction, so a
  // lead and its opportunities never end up owned by different people (matching
  // the old per-lead atomic WriteBatch). Bounded-concurrency waves keep a large
  // batch finishing in seconds; per-transaction try/catch keeps one bad chunk
  // from aborting the whole run (which would leave the job never marked
  // `distributed` and the UI spinning forever).
  const TX_SIZE = 16;        // leads per transaction — keeps reads+writes per tx small
  const TX_CONCURRENCY = 4;  // transactions in flight per wave (≈64 leads at once)
  const chunks: Array<typeof planned> = [];
  for (let i = 0; i < planned.length; i += TX_SIZE) chunks.push(planned.slice(i, i + TX_SIZE));

  let totalAssigned = 0;
  for (let w = 0; w < chunks.length; w += TX_CONCURRENCY) {
    const waveResults = await Promise.all(chunks.slice(w, w + TX_CONCURRENCY).map(async (chunk) => {
      try {
        // The tx callback may RETRY on contention — it must not mutate outer
        // state; it returns the owners actually assigned and we tally outside.
        return await db.runTransaction(async (tx) => {
          // All reads before any write (Firestore tx rule): leads, then their open opps.
          const snaps = await tx.getAll(...chunk.map((c) => c.ref));
          const claim: typeof chunk = [];
          snaps.forEach((s, i) => {
            const data = s.exists ? s.data() : undefined;
            // Re-check: still UNASSIGNED and not soft-deleted? A telecaller pull
            // (or a parallel distribute) may have claimed it since the outer query.
            if (data && data.primaryOwnerId === "UNASSIGNED" && data.deleted !== true) claim.push(chunk[i]);
          });
          const oppSnaps = await Promise.all(claim.map((c) =>
            tx.get(c.ref.collection("opportunities").where("status", "==", "open"))));

          const slaDeadline = new Date();
          slaDeadline.setHours(slaDeadline.getHours() + 24);
          claim.forEach((c, i) => {
            tx.update(c.ref, {
              primaryOwnerId: c.owner,
              // Anchors "time with current owner" for the team view (informational).
              assignedToCurrentOwnerAt: admin.firestore.FieldValue.serverTimestamp(),
              slaDeadline:    admin.firestore.Timestamp.fromDate(slaDeadline),
              distributedAt:  admin.firestore.FieldValue.serverTimestamp(),
              updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
            });
            // Re-own any open opportunities + log an activity
            for (const oppDoc of oppSnaps[i].docs) {
              tx.update(oppDoc.ref, { ownerId: c.owner, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
              tx.set(oppDoc.ref.collection("activities").doc(), {
                type:    "status_change",
                content: `Assigned via distribution of import "${importName}" (batch ${batchId})`,
                by:      actorUid,
                at:      admin.firestore.FieldValue.serverTimestamp(),
              });
            }
          });
          return claim.map((c) => c.owner);
        });
      } catch (e) {
        console.error("[distribute] chunk failed", chunk.map((c) => c.ref.id).join(","), e);
        return [] as string[];
      }
    }));
    for (const owners of waveResults) {
      for (const owner of owners) {
        assignedCountByAgent[owner] = (assignedCountByAgent[owner] ?? 0) + 1;
        totalAssigned++;
      }
    }
  }

  // One aggregated notification per agent (avoids per-lead notification spam).
  // Counts reflect what was ACTUALLY assigned (skipped/failed leads excluded).
  await Promise.all(Object.entries(assignedCountByAgent).map(([agentUid, count]) =>
    db.collection("notifications").doc(agentUid).collection("items").add({
      type:      "new_lead",
      title:     `${count} new lead${count > 1 ? "s" : ""} assigned`,
      body:      `From import "${importName}". Check My Queue.`,
      link:      "/crm/my-queue",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      read:      false,
    }).catch((e) => console.error("[distribute notification failed]", e)),
  ));

  await jobRef.update({
    distributed:      true,
    distributedAt:    admin.firestore.FieldValue.serverTimestamp(),
    distributedBy:    actorUid,
    // Increment by what was ACTUALLY assigned this round — NOT docs.length (the
    // planned slice): leads skipped because a pull claimed them first, and leads
    // whose transaction failed, are excluded. Counting planned leads inflated
    // distributedCount and made the queue hide leftover unassigned leads.
    // Increment (not overwrite) so successive rounds accumulate correctly; the
    // Import Queue's live UNASSIGNED count remains the ground truth either way.
    distributedCount: admin.firestore.FieldValue.increment(totalAssigned),
    agentIds:         agents,
  });
}

export {
  getSheetsClient,
  getServiceAccountEmail,
  extractSheetId,
  getServiceAccountPath,
  fetchEmployeeMasterRows,
  resolveSheetRole,
  maskPanServer,
  parseEmployeeRow,
  isOnePhone,
  splitPhones,
  isImportablePhone,
  canonicalPhone,
  salvagePhoneFromName,
  validateCells,
  validateRow,
  buildImportHash,
  buildImportHashLegacy,
  findExistingImportHashes,
  getLeadGenerators,
  detectColumnMapping,
  normaliseProduct,
  extractCells,
  writeImportedLead,
  processImportBatch,
  distributeBatch,
};
export type { SheetRoleAttrs, ParsedRow, ColumnMapping };
