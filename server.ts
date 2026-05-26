import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { JWT, OAuth2Client } from "google-auth-library";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { encryptField, decryptField } from "./src/lib/encryption.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin (uses Application Default Credentials in Cloud Run)
if (!admin.apps.length) {
  admin.initializeApp();
}

// Named Firestore database — must match firestoreDatabaseId in firebase-applet-config.json.
// The emulator uses the default database; production uses the named one.
const FIRESTORE_DB_ID = "ai-studio-27afcadd-87fc-4f68-8a88-587e904a31bf";
const useEmulator = process.env.VITE_USE_EMULATOR === "true";
const db = useEmulator
  ? admin.firestore()
  : getFirestore(admin.app(), FIRESTORE_DB_ID);

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
const TEMPLATE_SHEET_URL = "https://docs.google.com/spreadsheets/d/REPLACE_WITH_TEMPLATE_ID";

// Column order in the template (0-indexed, row 1 = headers)
const COLUMN_KEYS = ["displayName","phone","email","panRaw","loanProduct","dealSize","triagePriority","notes"] as const;

interface ParsedRow {
  rowNumber: number;
  data: Record<string, string>;
  valid: boolean;
  errors: string[];
}

function validateRow(raw: string[], loanProducts: Set<string>): ParsedRow["errors"] {
  const errors: string[] = [];
  const cells = COLUMN_KEYS.map((_, i) => (raw[i] ?? "").trim());
  const [displayName, phone, , panRaw, loanProduct, dealSize, triagePriority] = cells;

  if (!displayName) errors.push("displayName is required");
  if (!phone) {
    errors.push("phone is required");
  } else if (!/^[6-9]\d{9}$/.test(phone)) {
    errors.push("phone must be a 10-digit Indian mobile starting with 6–9");
  }
  if (panRaw && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panRaw)) {
    errors.push("panRaw must match ABCDE1234F format");
  }
  if (!loanProduct) {
    errors.push("loanProduct is required");
  } else if (loanProducts.size > 0 && !loanProducts.has(loanProduct)) {
    errors.push(`loanProduct '${loanProduct}' not found in opportunity_types`);
  }
  if (dealSize && isNaN(Number(dealSize))) {
    errors.push("dealSize must be a number");
  }
  if (triagePriority && !["high","medium","low",""].includes(triagePriority.toLowerCase())) {
    errors.push("triagePriority must be high, medium, or low");
  }
  return errors;
}

function buildImportHash(phone: string, email: string, displayName: string): string {
  return crypto
    .createHash("sha256")
    .update(`${phone}|${email.toLowerCase()}|${displayName.toLowerCase()}`)
    .digest("hex");
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

// Runs import in background — DO NOT await this from request handlers.
// Phase 6 hardening: move to a Cloud Function for >10K rows to avoid Cloud Run timeout.
async function processImportBatch(
  jobId: string,
  sheetId: string,
  skipErrors: boolean,
  triggerUserId: string,
  batchId: string,
  rows: string[][],
  loanProducts: Set<string>,
): Promise<void> {
  const jobRef = db.collection("import_jobs").doc(jobId);
  const generators = await getLeadGenerators();
  const totalRows = rows.length;
  let processedRows = 0, successCount = 0, errorCount = 0;
  const errors: Array<{ row: number; data: Record<string, string>; reason: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2; // 1=header, data starts at 2
    const cells = COLUMN_KEYS.map((_, ci) => (raw[ci] ?? "").trim());
    const rowData: Record<string, string> = Object.fromEntries(COLUMN_KEYS.map((k, ci) => [k, cells[ci]]));
    const rowErrors = validateRow(raw, loanProducts);

    if (rowErrors.length > 0) {
      errorCount++;
      if (errors.length < 1000) errors.push({ row: rowNum, data: rowData, reason: rowErrors.join("; ") });
      if (!skipErrors) { processedRows++; continue; }
    }

    const [displayName, phone, email, panRaw, loanProduct, dealSizeRaw, triagePriorityRaw, notes] = cells;
    const importHash = buildImportHash(phone, email, displayName);

    // Idempotency check
    const existing = await db.collection("leads").where("importHash", "==", importHash).limit(1).get();
    if (!existing.empty) {
      if (errors.length < 1000) errors.push({ row: rowNum, data: rowData, reason: "duplicate (hash matched existing lead)" });
      errorCount++; processedRows++;
      if ((i + 1) % 100 === 0) {
        await jobRef.update({ processedRows, successCount, errorCount, errors });
      }
      continue;
    }

    // Assign via round-robin
    const assignedOwner = generators[i % generators.length]?.userId ?? triggerUserId;

    // SLA deadline: offline_bulk = +24 calendar hours
    const slaDeadline = new Date();
    slaDeadline.setHours(slaDeadline.getHours() + 24);

    const leadRef = db.collection("leads").doc();

    // Firestore batch for lead + opportunity + activity (atomic)
    const batch = db.batch();

    batch.set(leadRef, {
      displayName,
      phone,
      ...(email  ? { email  } : {}),
      ...(panRaw ? { panRaw } : {}),
      source:        "offline_bulk",
      tags:          [],
      primaryOwnerId: assignedOwner,
      consentGiven:       true,
      consentTimestamp:   admin.firestore.FieldValue.serverTimestamp(),
      consentMethod:      "offline_collection",
      slaDeadline:        admin.firestore.Timestamp.fromDate(slaDeadline),
      triagePriority:     (triagePriorityRaw || "low").toLowerCase(),
      importBatchId:      batchId,
      importHash,
      importedBy:         triggerUserId,
      importedAt:         admin.firestore.FieldValue.serverTimestamp(),
      createdAt:          admin.firestore.FieldValue.serverTimestamp(),
      createdBy:          triggerUserId,
      updatedAt:          admin.firestore.FieldValue.serverTimestamp(),
      deleted:            false,
    });

    // Create opportunity if loanProduct is valid
    if (loanProduct && loanProducts.has(loanProduct)) {
      const oppRef = leadRef.collection("opportunities").doc();
      batch.set(oppRef, {
        opportunityType: "loan",
        product:         loanProduct,
        dealSize:        dealSizeRaw ? Number(dealSizeRaw) : 0,
        stage:           "New",
        ownerId:         assignedOwner,
        status:          "open",
        ...(notes ? { notes } : {}),
        createdAt:       admin.firestore.FieldValue.serverTimestamp(),
        updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
      });
      // Creation activity
      const actRef = oppRef.collection("activities").doc();
      batch.set(actRef, {
        type:    "note",
        content: `Lead imported from offline_bulk batch ${batchId}`,
        by:  triggerUserId,
        at:  admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    successCount++;
    processedRows++;

    // Write progress every 100 rows
    if ((i + 1) % 100 === 0) {
      await jobRef.update({ processedRows, successCount, errorCount, errors });
    }
  }

  // Final update
  await jobRef.update({
    processedRows: totalRows,
    successCount,
    errorCount,
    errors,
    status: errorCount > 0 && !skipErrors ? "partial" : errorCount === totalRows ? "failed" : "completed",
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ─── Auth middleware ───────────────────────────────────────────────────────────
async function verifyFirebaseToken(req: express.Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    return decoded.uid;
  } catch {
    return null;
  }
}

// ─── Cloud Scheduler OIDC auth ────────────────────────────────────────────────
// Cloud Scheduler sends an OIDC token, not a Firebase ID token.
// Verify it with google-auth-library and confirm the issuing service account
// matches the one attached to the pulse-api Cloud Run service.
const _schedulerOidcClient = new OAuth2Client();
const SCHEDULER_SA_EMAIL = "787616231546-compute@developer.gserviceaccount.com";

async function verifySchedulerOIDC(req: express.Request): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return false;
  try {
    const ticket = await _schedulerOidcClient.verifyIdToken({ idToken: authHeader.slice(7) });
    const payload = ticket.getPayload();
    return payload?.email === SCHEDULER_SA_EMAIL && payload?.email_verified === true;
  } catch {
    return false;
  }
}

// ─── Server env validation ────────────────────────────────────────────────────
function validateServerEnv(): void {
  if (process.env.NODE_ENV !== "production") return;
  const missing: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID)     missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!process.env.PAN_ENCRYPTION_KEY || process.env.PAN_ENCRYPTION_KEY.length < 64) {
    missing.push("PAN_ENCRYPTION_KEY (must be 64 hex chars / 32 bytes)");
  }
  if (missing.length > 0) {
    throw new Error(
      `[server] Missing required production env vars: ${missing.join(", ")}. ` +
      "Add them to Cloud Run environment configuration before deploying."
    );
  }
}
validateServerEnv();

// ─── Super admin protection ───────────────────────────────────────────────────
// These three accounts cannot be deactivated or have their roles changed by
// non-super-admins — enforced here and in firestore.rules.
const SUPER_ADMIN_UIDS_LIST = (process.env.SUPER_ADMIN_UIDS || '')
  .split(',').map((u: string) => u.trim()).filter(Boolean);
function isSuperAdmin(uid: string): boolean {
  return SUPER_ADMIN_UIDS_LIST.includes(uid);
}

// ─── Firestore-based rate limiter (sliding window, multi-instance safe) ───────
// Keyed by "{endpoint}:{userId or IP}" in the /rate_limits collection.
// Uses Firestore transactions so concurrent requests across Cloud Run instances
// share the same counter — replaces the previous single-instance in-memory store.
const HOUR_MS = 60 * 60 * 1000;

async function checkRateLimit(
  identifier: string,
  endpoint: string,
  maxRequests: number,
  windowMs: number,
): Promise<boolean> {
  const key = `${endpoint}:${identifier}`;
  const ref = db.collection("rate_limits").doc(key);
  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    const allowed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      let count = 0;
      let wStart = now;

      if (snap.exists) {
        const data = snap.data()!;
        wStart = data.windowStart ?? now;
        count  = data.count ?? 0;
        // Reset window if it has expired
        if (wStart < windowStart) { count = 0; wStart = now; }
      }

      if (count >= maxRequests) return false;
      tx.set(ref, { count: count + 1, windowStart: wStart, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
    return allowed;
  } catch {
    // On Firestore error, fail open so a transient error doesn't block all uploads.
    return true;
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 8080;

  // ─── CORS ─────────────────────────────────────────────────────────────────
  const ALLOWED_ORIGINS = process.env.NODE_ENV === "production"
    ? ["https://pulse.finvastra.com", "https://finvastra.com"]
    : ["https://pulse.finvastra.com", "https://finvastra.com", "http://localhost:3000"];

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    next();
  });

  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser());

  // Google OAuth Configuration
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/api/auth/callback`
  );

  // Auth URL endpoint
  app.get("/api/auth/google/url", (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/calendar",
      ],
      prompt: "consent",
    });
    res.json({ url });
  });

  // OAuth Callback
  app.get(["/api/auth/callback", "/api/auth/callback/"], async (req, res) => {
    const { code } = req.query;
    try {
      const { tokens } = await oauth2Client.getToken(code as string);
      res.send(`
        <html><body><script>
          if (window.opener) {
            window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', tokens: ${JSON.stringify(tokens)} }, '*');
            window.close();
          } else { window.location.href = '/'; }
        </script><p>Authentication successful.</p></body></html>
      `);
    } catch (error) {
      console.error("OAuth Error:", error);
      res.status(500).send("Authentication failed");
    }
  });

  // Calendar events proxy
  app.post("/api/calendar/events", async (req, res) => {
    const { tokens } = req.body;
    if (!tokens) return res.status(401).json({ error: "No tokens" });
    const client = new google.auth.OAuth2();
    client.setCredentials(tokens);
    const calendar = google.calendar({ version: "v3", auth: client });
    try {
      const response = await calendar.events.list({
        calendarId: "primary",
        timeMin: new Date().toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: "startTime",
      });
      res.json(response.data.items);
    } catch (error) {
      console.error("Calendar API Error:", error);
      res.status(500).json({ error: "Failed to fetch calendar" });
    }
  });

  // ─── HRMS: Leave Calendar Sync ──────────────────────────────────────────────
  // POST /api/hrms/leave/sync-calendar
  // Called by the client after approving a leave application.
  // Creates an all-day event on the approving admin's primary Google Calendar.
  app.post("/api/hrms/leave/sync-calendar", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    if (!(await checkRateLimit(uid, "leave-calendar-sync", 20, HOUR_MS))) {
      return res.status(429).json({ error: "Too many requests. Maximum 20 calendar syncs per hour." });
    }

    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    const canApprove = userData?.role === "admin" || userData?.isHrmsManager === true;
    if (!canApprove) return res.status(403).json({ error: "Not authorised to approve leave" });

    const { applicationId } = req.body as { applicationId?: string };
    if (!applicationId) return res.status(400).json({ error: "applicationId required" });

    const appSnap = await db.collection("leave_applications").doc(applicationId).get();
    if (!appSnap.exists) return res.status(404).json({ error: "Application not found" });
    const application = appSnap.data()!;

    // Fetch the employee's display name for the calendar event title
    const empSnap = await db.collection("users").doc(application.employeeId as string).get();
    const empName: string = (empSnap.data()?.displayName as string | undefined) ?? "Employee";

    // Use the shared oauth2Client credentials set during the admin's Google OAuth flow.
    // If no credentials are stored (admin hasn't connected Calendar), skip gracefully.
    try {
      if (!oauth2Client.credentials?.access_token) {
        console.warn("[Leave Calendar] No Google OAuth credentials — skipping calendar sync");
        return res.json({ ok: true, calendarEventId: null });
      }

      const calendar = google.calendar({ version: "v3", auth: oauth2Client });
      const event = await calendar.events.insert({
        calendarId: "primary",
        requestBody: {
          summary: `${empName} — On Leave`,
          start: { date: application.fromDate as string },
          end:   { date: application.toDate   as string },
          description: `${(application.type as string).charAt(0).toUpperCase() + (application.type as string).slice(1)} Leave · ${application.days as number} day(s)`,
          colorId: "7",  // blue
        },
      });

      const calendarEventId = event.data.id ?? null;
      if (calendarEventId) {
        await db.collection("leave_applications").doc(applicationId).update({ calendarEventId });
      }
      return res.json({ ok: true, calendarEventId });
    } catch (e) {
      console.error("[Leave Calendar] Failed to create calendar event:", e);
      // Non-fatal — calendar sync failure must not break the approval flow
      return res.json({ ok: true, calendarEventId: null });
    }
  });

  // Health check
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // ─── Bootstrap admin ─────────────────────────────────────────────────────────
  // Promotes the caller to admin if their email is in the hardcoded allowlist.
  // Safe to expose: the allowlist is server-side only; no client can self-promote.
  app.post("/api/dev/bootstrap-admin", async (req, res) => {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Sign in first, then call this endpoint." });

      const userRecord = await admin.auth().getUser(uid);
      const profileRef = db.collection("users").doc(uid);
      const snap = await profileRef.get();

      const profile = {
        userId:      uid,
        email:       userRecord.email ?? "",
        displayName: userRecord.displayName ?? userRecord.email ?? "Admin",
        role:        "admin",
        photoURL:    userRecord.photoURL ?? "",
        department:  "Management",
        designation: "Admin",
        joiningDate: new Date().toISOString().slice(0, 10),
        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      };

      // Only allow known admin emails to use this endpoint
      const ADMIN_EMAILS = ["rahulv@finvastra.com"];
      if (!ADMIN_EMAILS.includes(userRecord.email ?? "")) {
        return res.status(403).json({ error: "Email not in admin allowlist." });
      }

      if (snap.exists) {
        await profileRef.update({ role: "admin", crmAccess: true });
        return res.json({ message: "Role updated to admin.", uid, existing: true });
      } else {
        await profileRef.set(profile);
        return res.json({ message: "Admin profile created.", uid, existing: false });
      }
    });

  // ─── Custom Claims Sync ──────────────────────────────────────────────────────
  // POST /api/admin/users/:uid/sync-claims
  // Reads the user's Firestore profile and stamps matching Firebase Auth custom claims.
  // Called by Add Employee and by AccessManagementPage on role/access changes.
  // Claims set: { role, hrmsAccess, crmAccess, crmRole, isHrmsManager, misAccess }
  app.post("/api/admin/users/:uid/sync-claims", async (req, res) => {
    try {
      const callerUid = await verifyFirebaseToken(req);
      if (!callerUid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(callerUid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const { uid } = req.params;

      // Protect super admin accounts: only another super admin can sync their claims
      if (isSuperAdmin(uid) && !isSuperAdmin(callerUid)) {
        return res.status(403).json({ error: "Only a super admin can modify another super admin's claims." });
      }

      const snap = await db.collection("users").doc(uid).get();
      if (!snap.exists) return res.status(404).json({ error: "User not found" });
      const p = snap.data()!;

      await admin.auth().setCustomUserClaims(uid, {
        role:           p.role          ?? "employee",
        hrmsAccess:     p.hrmsAccess    ?? true,
        crmAccess:      p.crmAccess     ?? false,
        crmRole:        p.crmRole       ?? null,
        isHrmsManager:  p.isHrmsManager ?? false,
        misAccess:      p.misAccess     ?? null,
      });

      await db.collection("audit_logs").add({
        actor:      callerUid,
        action:     "sync_custom_claims",
        targetPath: `/users/${uid}`,
        at:         admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ ok: true, uid });
    } catch (e) {
      console.error("sync-claims error:", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
    }
  });

  // ─── PAN Decryption API ──────────────────────────────────────────────────────
  // POST /api/leads/:leadId/pan — decrypt PAN and log the access.
  // Auth: admin OR the lead's primaryOwnerId OR any opportunity owner on the lead.
  app.post("/api/leads/:leadId/pan", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { leadId } = req.params;
    const leadSnap = await db.collection("leads").doc(leadId).get();
    if (!leadSnap.exists) return res.status(404).json({ error: "Lead not found" });
    const lead = leadSnap.data()!;

    // Authorisation: admin OR primaryOwner OR any opportunity owner
    const userSnap = await db.collection("users").doc(uid).get();
    const isAdmin = userSnap.data()?.role === "admin";
    const isPrimaryOwner = lead.primaryOwnerId === uid;

    let isOppOwner = false;
    if (!isAdmin && !isPrimaryOwner) {
      const oppsSnap = await db.collection("leads").doc(leadId).collection("opportunities").get();
      isOppOwner = oppsSnap.docs.some((d) => d.data().ownerId === uid);
    }

    if (!isAdmin && !isPrimaryOwner && !isOppOwner) {
      return res.status(403).json({ error: "Not authorised to view this PAN" });
    }

    // Decrypt — prefer panEncrypted; fall back to legacy panRaw during migration period
    let panPlain: string | null = null;
    if (lead.panEncrypted) {
      try {
        panPlain = decryptField(lead.panEncrypted as Parameters<typeof decryptField>[0]);
      } catch {
        return res.status(500).json({ error: "Decryption failed" });
      }
    } else if (lead.panRaw) {
      panPlain = lead.panRaw as string;
    }

    if (!panPlain) return res.status(404).json({ error: "No PAN on record" });

    // Log the access — Admin SDK bypasses Firestore rules (allow create: if false on access_logs)
    await db.collection("access_logs").add({
      actorId:    uid,
      actorEmail: userSnap.data()?.email ?? "",
      action:     "pan_view",
      targetType: "lead",
      targetId:   leadId,
      accessedAt: admin.firestore.FieldValue.serverTimestamp(),
      ipAddress:  req.ip ?? req.socket.remoteAddress ?? "",
      userAgent:  req.headers["user-agent"] ?? "",
    });

    return res.json({ pan: panPlain });
  });

  // POST /api/admin/migrate-pan-encryption — encrypts all leads with plaintext panRaw.
  // Admin-only. Run once per environment after setting PAN_ENCRYPTION_KEY.
  app.post("/api/admin/migrate-pan-encryption", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

    let migrated = 0, skipped = 0, failed = 0;
    try {
      const snap = await db.collection("leads").where("panRaw", "!=", null).get();
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        if (!data.panRaw || data.panEncrypted) { skipped++; continue; }
        try {
          const enc = encryptField(data.panRaw as string);
          const raw = data.panRaw as string;
          const masked = raw.length === 10
            ? raw.slice(0, 5) + "****" + raw.slice(-1)
            : "*".repeat(raw.length);
          await docSnap.ref.update({
            panEncrypted: enc,
            panMasked:    masked,
            panRaw:       admin.firestore.FieldValue.delete(),
          });
          migrated++;
        } catch {
          failed++;
        }
      }
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
    return res.json({ migrated, skipped, failed });
  });

  // ─── Import API ──────────────────────────────────────────────────────────────

  // Returns the service account email so managers know which address to share with
  app.get("/api/import/service-account-email", async (_req, res) => {
    const email = await getServiceAccountEmail();
    res.json({ email, templateSheetUrl: TEMPLATE_SHEET_URL });
  });

  // Checks whether the service account can read a given Sheet
  app.post("/api/import/check", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const { sheetUrl } = req.body;
    if (!sheetUrl) return res.status(400).json({ error: "sheetUrl required" });
    const sheetId = extractSheetId(sheetUrl);
    try {
      const sheets = await getSheetsClient();
      await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "spreadsheetId,properties.title" });
      res.json({ ok: true, sheetId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404") || msg.includes("not found")) {
        res.status(404).json({ error: "Sheet not found. Check the URL." });
      } else if (msg.includes("403") || msg.includes("permission")) {
        const sa = await getServiceAccountEmail();
        res.status(403).json({ error: `No access. Share the Sheet with: ${sa}` });
      } else {
        res.status(500).json({ error: `Sheets API error: ${msg}` });
      }
    }
  });

  // Returns first 50 rows with per-row validation
  app.post("/api/import/preview", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const { sheetUrl } = req.body;
    if (!sheetUrl) return res.status(400).json({ error: "sheetUrl required" });
    const sheetId = extractSheetId(sheetUrl);
    try {
      const sheets = await getSheetsClient();
      // Read rows 2-51 (row 1 is header)
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: "A2:H51",
      });
      const rawRows = (result.data.values ?? []) as string[][];

      // Fetch valid loan products from Firestore
      const oppTypesSnap = await db.collection("opportunity_types")
        .where("businessLine", "==", "loan")
        .where("active", "==", true)
        .get();
      const loanProducts = new Set(oppTypesSnap.docs.map(d => d.data().name as string));

      const rows = rawRows.map((raw, i) => {
        const errors = validateRow(raw, loanProducts);
        const cells = COLUMN_KEYS.map((_, ci) => (raw[ci] ?? "").trim());
        return {
          rowNumber: i + 2,
          data: Object.fromEntries(COLUMN_KEYS.map((k, ci) => [k, cells[ci]])),
          valid: errors.length === 0,
          errors,
        };
      });

      // Count total rows in sheet to report totalRows (not just first 50)
      const countResult = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: "A:A",
      });
      const totalRows = Math.max(0, (countResult.data.values?.length ?? 1) - 1);

      res.json({
        rows,
        totalRows,
        validCount: rows.filter(r => r.valid).length,
        errorCount: rows.filter(r => !r.valid).length,
        serviceAccountEmail: await getServiceAccountEmail(),
        loanProducts: [...loanProducts],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // Starts a background import job; responds immediately with jobId
  app.post("/api/import/run", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    if (!(await checkRateLimit(uid, "import-run", 5, HOUR_MS))) {
      return res.status(429).json({ error: "Too many import jobs. Maximum 5 per hour." });
    }

    // Only admin and manager can trigger imports
    const userSnap = await db.collection("users").doc(uid).get();
    const user = userSnap.data();
    const canRun = user?.role === "admin" || user?.crmRole === "manager" || user?.crmCanImport === true;
    if (!canRun) return res.status(403).json({ error: "Import access not granted. Ask your admin to enable bulk import for your account." });

    const { sheetUrl, skipErrors = false } = req.body;
    if (!sheetUrl) return res.status(400).json({ error: "sheetUrl required" });
    const sheetId = extractSheetId(sheetUrl);

    // Generate batch ID: YYYY-MM-DD-xxxx
    const dateStr = new Date().toISOString().slice(0, 10);
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const batchId = `${dateStr}-${suffix}`;
    const jobId = db.collection("import_jobs").doc().id;

    // Read all rows from the Sheet
    let allRows: string[][];
    try {
      const sheets = await getSheetsClient();
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: "A2:H",  // skip header row
      });
      allRows = (result.data.values ?? []) as string[][];
    } catch (err) {
      return res.status(500).json({ error: `Failed to read Sheet: ${err instanceof Error ? err.message : String(err)}` });
    }

    // Fetch loan products once
    const oppTypesSnap = await db.collection("opportunity_types")
      .where("businessLine", "==", "loan").where("active", "==", true).get();
    const loanProducts = new Set(oppTypesSnap.docs.map(d => d.data().name as string));

    // Create the job doc
    await db.collection("import_jobs").doc(jobId).set({
      totalRows: allRows.length,
      processedRows: 0,
      successCount: 0,
      errorCount: 0,
      status: "processing",
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      triggeredBy: uid,
      batchId,
      sheetId,
      skipErrors,
      errors: [],
    });

    // Respond immediately — process in background
    res.json({ jobId, batchId, totalRows: allRows.length });

    // Background processing (intentionally not awaited)
    processImportBatch(jobId, sheetId, skipErrors, uid, batchId, allRows, loanProducts)
      .catch(err => {
        console.error(`Import job ${jobId} failed:`, err);
        db.collection("import_jobs").doc(jobId).update({
          status: "failed",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          errors: [{ row: 0, data: {}, reason: String(err) }],
        }).catch(() => {});
      });
  });

  // ─── Auth Alerts API ─────────────────────────────────────────────────────────
  // Called by the client after detecting a new device login.
  // Sends email notification via Google Workspace SMTP (nodemailer).
  app.post("/api/auth/login-alert", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { userAgent = "", isNewDevice = false } = req.body as { userAgent?: string; isNewDevice?: boolean };
    if (!isNewDevice) return res.json({ ok: true }); // nothing to do

    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    if (!userData) return res.status(404).json({ error: "User not found" });

    const ipAddress = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    const message = `New login to Finvastra from ${(userAgent as string).slice(0, 60)} at ${timestamp} (IP: ${ipAddress})`;

    // Send email via Google Workspace SMTP if credentials are configured
    if (process.env.SMTP_USER && process.env.SMTP_APP_PASSWORD) {
      try {
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.default.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_APP_PASSWORD },
        });
        await transporter.sendMail({
          from: `"Finvastra Security" <${process.env.SMTP_USER}>`,
          to: userData.email as string,
          subject: "New device login — Finvastra",
          text: `Hello ${userData.displayName as string},\n\n${message}\n\nIf this wasn't you, change your password immediately.\n\nFinvastra Security`,
        });
      } catch (e) {
        console.error("Login alert email failed:", e);
      }
    } else {
      console.log(`[Login Alert - no SMTP config] ${userData.email as string}: ${message}`);
    }

    return res.json({ ok: true });
  });

  // ─── Gmail helper ─────────────────────────────────────────────────────────────
  // Builds a Gmail API client using domain-wide delegation so the server can send
  // email as admin@finvastra.com without storing a password.
  // Local dev:  uses the service-account JSON key found by getServiceAccountPath()
  // Cloud Run:  uses GOOGLE_SA_JSON_BASE64 env var (base64 of the same JSON key)
  async function getGmailClient() {
    const senderEmail = process.env.GMAIL_SENDER ?? "admin@finvastra.com";
    let authClient: JWT;

    if (process.env.GOOGLE_SA_JSON_BASE64) {
      const keyData = JSON.parse(
        Buffer.from(process.env.GOOGLE_SA_JSON_BASE64, "base64").toString("utf-8")
      ) as { client_email: string; private_key: string };
      authClient = new JWT({
        email:   keyData.client_email,
        key:     keyData.private_key,
        scopes:  ["https://www.googleapis.com/auth/gmail.send"],
        subject: senderEmail,
      });
    } else {
      const keyFile = getServiceAccountPath();
      if (!keyFile) throw new Error("No service-account key available for Gmail DWD");
      const keyData = JSON.parse(fs.readFileSync(keyFile, "utf-8")) as { client_email: string; private_key: string };
      authClient = new JWT({
        email:   keyData.client_email,
        key:     keyData.private_key,
        scopes:  ["https://www.googleapis.com/auth/gmail.send"],
        subject: senderEmail,
      });
    }
    return google.gmail({ version: "v1", auth: authClient });
  }

  // Sends an HTML email via the Gmail API (domain-wide delegation).
  // Falls back to console.log when the SA key is not configured (emulator mode).
  async function sendGmailMessage(to: string, subject: string, htmlBody: string) {
    const senderEmail  = process.env.GMAIL_SENDER ?? "admin@finvastra.com";
    const senderName   = "Finvastra Pulse";

    if (useEmulator && !process.env.GOOGLE_SA_JSON_BASE64 && !getServiceAccountPath()) {
      console.log(`[Gmail stub] To: ${to} | Subject: ${subject}`);
      return;
    }

    const raw = [
      `From: ${senderName} <${senderEmail}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
      htmlBody,
    ].join("\r\n");

    const encoded = Buffer.from(raw)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const gmail = await getGmailClient();
    await gmail.users.messages.send({ userId: "me", requestBody: { raw: encoded } });
  }

  // Branded HTML email template for password reset.
  function buildPasswordResetEmail(displayName: string, resetLink: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F2EFE7;font-family:'DM Sans',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2EFE7;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#0B1538 0%,#1B2A4E 100%);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;">
        <img src="https://pulse.finvastra.com/favicon.png" alt="Finvastra" width="64" height="64"
          style="border-radius:12px;object-fit:contain;display:block;margin:0 auto 12px;" />
        <div style="color:#C9A961;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">FINVASTRA PULSE</div>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#ffffff;padding:40px;">
        <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#0A0A0A;margin:0 0 8px 0;">
          Reset your password
        </h1>
        <p style="font-size:15px;color:#2A2A2A;line-height:1.7;margin:0 0 8px 0;">Hi ${displayName},</p>
        <p style="font-size:15px;color:#2A2A2A;line-height:1.7;margin:0 0 28px 0;">
          We received a request to reset your Finvastra Pulse password. Click the button below —
          you'll be asked to verify your date of birth before setting a new password.
        </p>

        <!-- CTA -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td align="center" style="padding:0 0 32px 0;">
            <a href="${resetLink}"
              style="display:inline-block;background:linear-gradient(135deg,#0B1538,#1B2A4E);color:#C9A961;
                     padding:14px 44px;border-radius:12px;text-decoration:none;font-weight:700;
                     font-size:15px;letter-spacing:0.5px;">
              Reset my password &rarr;
            </a>
          </td></tr>
        </table>

        <div style="border-top:1px solid #E2E8F0;padding-top:20px;">
          <p style="font-size:13px;color:#8B8B85;line-height:1.6;margin:0 0 8px 0;">
            &#9200; This link expires in <strong>1 hour</strong>.
          </p>
          <p style="font-size:13px;color:#8B8B85;line-height:1.6;margin:0;">
            If you didn&rsquo;t request a password reset, you can safely ignore this email &mdash; your password won&rsquo;t change.
          </p>
        </div>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#F2EFE7;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
        <p style="font-size:12px;color:#8B8B85;margin:0 0 4px 0;">Finvastra Financial Services Pvt. Ltd.</p>
        <p style="font-size:11px;color:#8B8B85;margin:0;">Access restricted to Finvastra team members only.</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
  }

  // ─── Password Reset (custom flow with DOB verification) ───────────────────────

  // Step 1 — Employee clicks "Forgot password" on login page.
  // Generates a Firebase reset link, extracts the oobCode, builds our own
  // pulse.finvastra.com/auth-action URL, and sends a branded Gmail.
  // Always returns { ok: true } regardless of whether the email exists — prevents
  // email enumeration attacks.
  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body as { email?: string };
    const ok = () => res.json({ ok: true });

    if (!email || !email.trim().endsWith("@finvastra.com")) return ok();

    try {
      let userRecord: admin.auth.UserRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email.trim());
      } catch {
        return ok(); // user not found — don't leak
      }

      // Block deactivated employees — their Auth account is disabled; reset would
      // succeed but sign-in would still fail, which is confusing.
      if (userRecord.disabled) return ok();

      // generatePasswordResetLink issues a valid Firebase oobCode we can reuse.
      // No continueUrl — we extract the oobCode and build our own pulse.finvastra.com/auth-action
      // URL, so continueUrl is irrelevant. Passing it requires the domain to be in Firebase's
      // authorized-domains list, which was the root cause of the "unauthorized-continue-uri" error.
      const firebaseLink = await admin.auth().generatePasswordResetLink(email.trim());

      const oobCode = new URL(firebaseLink).searchParams.get("oobCode");
      if (!oobCode) throw new Error("oobCode missing from Firebase link");

      const resetLink =
        `https://pulse.finvastra.com/auth-action?mode=resetPassword` +
        `&oobCode=${encodeURIComponent(oobCode)}`;

      const displayName =
        userRecord.displayName ?? email.split("@")[0];

      await sendGmailMessage(
        email.trim(),
        "Reset your Finvastra Pulse password",
        buildPasswordResetEmail(displayName, resetLink),
      );
    } catch (e) {
      // Log but still return ok — never surface internals to unauthenticated callers
      console.error("[forgot-password]", e);
    }

    return ok();
  });


  // Step 2 — /auth-action page verifies DOB before showing the new-password form.
  // Accepts { email, dob } where dob is "YYYY-MM-DD" (browser date-input format).
  // Compares the MM-DD portion against /user_details/{uid}.dateOfBirth (stored MM-DD).
  // Returns { dobRequired: false } when no DOB is on file (skip the check gracefully).
  app.post("/api/auth/verify-reset-dob", async (req, res) => {
    const { email, dob } = req.body as { email?: string; dob?: string };
    if (!email || !dob) return res.status(400).json({ error: "Missing fields" });

    try {
      const userRecord = await admin.auth().getUserByEmail(email);
      const uid        = userRecord.uid;

      const snap = await db.collection("user_details").doc(uid).get();
      const storedDob = (snap.data()?.dateOfBirth as string | undefined) ?? null;

      if (!storedDob) {
        // No DOB on file — let the employee proceed without the check
        return res.json({ dobRequired: false });
      }

      // storedDob: "MM-DD"   submitted dob: "YYYY-MM-DD" — compare only the MM-DD part
      const submittedMMDD = dob.substring(5); // e.g. "1990-03-15" → "03-15"
      if (submittedMMDD !== storedDob) {
        return res.status(400).json({ error: "Date of birth does not match our records." });
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error("[verify-reset-dob]", e);
      return res.status(400).json({ error: "Could not verify. Please try again." });
    }
  });

  // ─── Support Tickets ─────────────────────────────────────────────────────────
  // Sends an email to rahulv@finvastra.com when an employee raises a support ticket.
  // The Firestore write happens client-side first; this endpoint is fire-and-forget.
  app.post("/api/support/raise", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { category, subject, description } = req.body as {
      category: string; subject: string; description: string;
    };
    if (!category || !subject || !description) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    const senderName  = (userData?.displayName as string | undefined) ?? "An employee";
    const senderEmail = (userData?.email       as string | undefined) ?? "";
    const empId       = (userData?.employeeId  as string | undefined) ?? "";

    // Send email via Google Workspace SMTP if credentials are configured
    if (process.env.SMTP_USER && process.env.SMTP_APP_PASSWORD) {
      try {
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.default.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_APP_PASSWORD },
        });
        await transporter.sendMail({
          from: `"Finvastra Pulse" <${process.env.SMTP_USER}>`,
          to: "rahulv@finvastra.com",
          subject: `[Support] ${category}: ${subject}`,
          text: [
            `Support ticket raised on Finvastra Pulse`,
            ``,
            `From     : ${senderName} (${empId}) <${senderEmail}>`,
            `Category : ${category}`,
            `Subject  : ${subject}`,
            ``,
            `Details`,
            `───────`,
            description,
            ``,
            `View all tickets in the Firestore /support_requests collection.`,
          ].join("\n"),
        });
      } catch (e) {
        console.error("[support/raise] email failed:", e);
      }
    } else {
      console.log(`[Support Ticket - no SMTP config] From: ${senderEmail} | ${category}: ${subject}`);
    }

    return res.json({ ok: true });
  });

  // ─── Scheduled Jobs API ─────────────────────────────────────────────────────
  // All three endpoints are triggered daily by Cloud Scheduler (HTTP target).
  // Manual admin trigger also available from the dashboard.

  // POST /api/admin/run-bank-sla-check
  // Accepts: Firebase admin token (dashboard) OR Cloud Scheduler OIDC token.
  app.post("/api/admin/run-bank-sla-check", async (req, res) => {
    const fromScheduler = await verifySchedulerOIDC(req);
    if (!fromScheduler) {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const userSnap = await db.collection("users").doc(uid).get();
      if (userSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    }
    try {
      const { runBankSLACheck } = await import("./src/lib/bankSLAJob");
      const result = await runBankSLACheck(db);
      return res.json(result);
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // POST /api/admin/run-commission-leakage-check
  // Accepts: Firebase admin token (dashboard) OR Cloud Scheduler OIDC token.
  app.post("/api/admin/run-commission-leakage-check", async (req, res) => {
    const fromScheduler = await verifySchedulerOIDC(req);
    if (!fromScheduler) {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const userSnap = await db.collection("users").doc(uid).get();
      if (userSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    }
    try {
      const { runCommissionLeakageCheck } = await import("./src/lib/commissionLeakageJob");
      const result = await runCommissionLeakageCheck(db);
      return res.json(result);
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // POST /api/admin/run-document-expiry-check
  // Triggered daily by Cloud Scheduler (HTTP + OIDC). Manual trigger from admin dashboard.
  // Accepts: Firebase admin token (dashboard) OR Cloud Scheduler OIDC token.
  app.post("/api/admin/run-document-expiry-check", async (req, res) => {
    const fromScheduler = await verifySchedulerOIDC(req);
    if (!fromScheduler) {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const userSnap = await db.collection("users").doc(uid).get();
      if (userSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    }
    try {
      const { runDocumentExpiryCheck } = await import("./src/lib/documentExpiryJob");
      const result = await runDocumentExpiryCheck(db);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  });

  // ─── Public Application Tracker ──────────────────────────────────────────────
  // GET /api/track/:token — unauthenticated, returns minimal public-safe data
  app.get("/api/track/:token", async (req, res) => {
    const { token } = req.params;
    if (!token || token.length < 20) return res.status(400).json({ error: "Invalid link" });

    const linkSnap = await db.collection("public_tracker_links").doc(token).get();
    if (!linkSnap.exists) return res.status(404).json({ error: "Link not found or expired" });

    const link = linkSnap.data()!;

    // Check expiry
    const expiresAt = link.expiresAt?.toDate?.() ?? null;
    if (expiresAt && new Date() > expiresAt) {
      return res.status(410).json({ error: "This link has expired. Please contact your advisor." });
    }

    // Fetch submission + opportunity + lead
    const leadId = link.leadId, oppId = link.opportunityId, subId = link.submissionId;
    const [subSnap, oppSnap, leadSnap] = await Promise.all([
      db.collection("leads").doc(leadId).collection("opportunities").doc(oppId)
        .collection("bank_submissions").doc(subId).get(),
      db.collection("leads").doc(leadId).collection("opportunities").doc(oppId).get(),
      db.collection("leads").doc(leadId).get(),
    ]);

    if (!subSnap.exists || !oppSnap.exists || !leadSnap.exists) {
      return res.status(404).json({ error: "Application not found" });
    }

    const sub = subSnap.data()!, opp = oppSnap.data()!, lead = leadSnap.data()!;

    // Fetch provider name
    let bankName = "Bank";
    const providerSnap = await db.collection("providers").doc(sub.providerId).get();
    if (providerSnap.exists) bankName = providerSnap.data()!.name;

    // Sanitise: only return first name and non-PII data
    const fullName: string = lead.displayName ?? "Applicant";
    const firstName = fullName.split(" ")[0];

    const dealSize: number = opp.dealSize ?? 0;
    const ticketSizeL = Math.round(dealSize / 100000 * 10) / 10;

    // Expected decision date (submittedAt + 7 days as default)
    let expectedDecisionDate: string | null = null;
    if (sub.submittedAt?.toDate) {
      const exp = new Date(sub.submittedAt.toDate());
      exp.setDate(exp.getDate() + 7);
      expectedDecisionDate = exp.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    }

    const submittedDate = sub.submittedAt?.toDate
      ? sub.submittedAt.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : "";

    const lastUpdated = sub.updatedAt?.toDate
      ? sub.updatedAt.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : submittedDate;

    // Increment view count (fire-and-forget)
    linkSnap.ref.update({
      viewCount: admin.firestore.FieldValue.increment(1),
      lastViewedAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    return res.json({
      applicantFirstName: firstName,
      loanType: opp.product ?? "Loan",
      ticketSizeL,
      bankName,
      currentStatus: sub.status,
      submittedDate,
      expectedDecisionDate,
      referenceId: subId.slice(-8).toUpperCase(),
      lastUpdated,
    });
  });

  // POST /api/leads/:leadId/opportunities/:oppId/submissions/:subId/tracker-token
  // Generate (or retrieve) the public tracker token for a submission.
  app.post("/api/leads/:leadId/opportunities/:oppId/submissions/:subId/tracker-token", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { leadId, oppId, subId } = req.params;
    const subRef = db.collection("leads").doc(leadId).collection("opportunities").doc(oppId)
      .collection("bank_submissions").doc(subId);
    const subSnap = await subRef.get();
    if (!subSnap.exists) return res.status(404).json({ error: "Submission not found" });

    const existing = subSnap.data()!.publicTrackerToken;
    if (existing) {
      return res.json({ token: existing, url: `/track/${existing}` });
    }

    // Generate new token (32 random bytes → base64url)
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    await db.runTransaction(async (t) => {
      t.update(subRef, { publicTrackerToken: token });
      t.set(db.collection("public_tracker_links").doc(token), {
        submissionId: subId,
        leadId,
        opportunityId: oppId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        viewCount: 0,
        lastViewedAt: null,
      });
    });

    return res.json({ token, url: `/track/${token}` });
  });

  // ─── MIS: Statement Upload & Processing ──────────────────────────────────────

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

  // POST /api/mis/statements/upload
  // Body: { csvBase64, fileName, providerId, periodStart, periodEnd, statementDate, receivedDate }
  // Returns: { detectedHeaders, detectedColumns, previewRows, tempId }
  app.post("/api/mis/statements/upload", async (req, res) => {
    cleanStagedData();
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    if (!(await checkRateLimit(uid, "mis-upload", 10, HOUR_MS))) {
      return res.status(429).json({ error: "Too many uploads. Maximum 10 per hour." });
    }
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    if (userData?.role !== "admin" && userData?.misAccess !== "admin") {
      return res.status(403).json({ error: "MIS admin access required" });
    }
    const { csvBase64, fileName, providerId, periodStart, periodEnd, statementDate, receivedDate } = req.body;
    if (!csvBase64 || !providerId || !periodStart) {
      return res.status(400).json({ error: "csvBase64, providerId and periodStart are required" });
    }
    try {
      const csvText = Buffer.from(csvBase64, "base64").toString("utf-8");
      const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length < 2) return res.status(400).json({ error: "CSV must have at least a header row and one data row" });
      const headers = parseCsvLine(lines[0]);
      const detected = detectColumns(headers);
      const previewRows = lines.slice(1, 6).map(l => parseCsvLine(l));
      const tempId = db.collection("_temp").doc().id; // just a random ID
      _stagedParsedData.set(tempId, {
        rows: lines.slice(1).map(l => {
          const cells = parseCsvLine(l);
          return {
            rawDate:        detected.dateCol   >= 0 ? (cells[detected.dateCol]   ?? '') : '',
            rawDescription: detected.descCol   >= 0 ? (cells[detected.descCol]   ?? '') : '',
            rawAmount:      detected.amountCol >= 0 ? (cells[detected.amountCol] ?? '') : '',
          };
        }),
        detectedColumns: detected,
        headers,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      return res.json({
        tempId,
        headers,
        detectedColumns: detected,
        previewRows,
        fileName: fileName ?? "upload.csv",
        periodStart, periodEnd, statementDate, receivedDate, providerId,
      });
    } catch (e) {
      return res.status(500).json({ error: `Parse error: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  // POST /api/mis/statements/process
  // Body: { tempId, confirmedColumns: { dateCol, descCol, amountCol }, providerId, periodStart,
  //         periodEnd, statementDate, receivedDate, fileName }
  app.post("/api/mis/statements/process", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    if (userData?.role !== "admin" && userData?.misAccess !== "admin") {
      return res.status(403).json({ error: "MIS admin access required" });
    }
    const { tempId, confirmedColumns, providerId, periodStart, periodEnd, statementDate, receivedDate, fileName } = req.body;
    const staged = _stagedParsedData.get(tempId);
    if (!staged) return res.status(400).json({ error: "Upload session expired. Please re-upload." });
    if (Date.now() > staged.expiresAt) {
      _stagedParsedData.delete(tempId);
      return res.status(400).json({ error: "Upload session expired. Please re-upload." });
    }
    // confirmedColumns is accepted but unused here — rows were already sliced by detected columns
    void confirmedColumns;
    try {
      // Re-parse using confirmed columns (or re-use staged rows which already have the fields)
      const rows = staged.rows;
      const parsedRows = rows.map(r => ({
        rawDate:        r.rawDate,
        rawDescription: r.rawDescription,
        rawAmount:      r.rawAmount,
        parsedDate:     parseFlexibleDate(r.rawDate),
        parsedAmount:   parseAmount(r.rawAmount),
      })).filter(r => r.parsedAmount > 0);
      const totalAmount = parsedRows.reduce((s, r) => s + r.parsedAmount, 0);
      const now = admin.firestore.FieldValue.serverTimestamp();
      // Create statement doc
      const stmtRef = db.collection("commission_statements").doc();
      const stmtData = {
        providerId, source: "bank",
        periodStart, periodEnd, statementDate, receivedDate,
        fileName: fileName ?? "upload.csv",
        fileUploadedAt: now,
        totalAmount,
        lineCount: parsedRows.length,
        matchedCount: 0, discrepancyCount: 0, unmatchedCount: parsedRows.length,
        status: "imported",
        importedBy: uid, importedAt: now,
        closedBy: null, closedAt: null, notes: "",
      };
      const batch = db.batch();
      batch.set(stmtRef, stmtData);
      for (const r of parsedRows) {
        const lineRef = stmtRef.collection("lines").doc();
        batch.set(lineRef, {
          statementId: stmtRef.id, providerId,
          rawDate: r.rawDate, rawDescription: r.rawDescription, rawAmount: r.rawAmount,
          parsedDate: r.parsedDate, parsedAmount: r.parsedAmount,
          matchedCommissionRecordId: null, matchedOpportunityId: null,
          discrepancyAmount: null, status: "unmatched",
          reconciledBy: null, reconciledAt: null, notes: "",
        });
      }
      await batch.commit();
      _stagedParsedData.delete(tempId);
      return res.json({ statementId: stmtRef.id, lineCount: parsedRows.length, totalAmount });
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  });

  // POST /api/mis/statements/:statementId/lines — manual single line entry
  app.post("/api/mis/statements/:statementId/lines", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    if (userData?.role !== "admin" && userData?.misAccess !== "admin") {
      return res.status(403).json({ error: "MIS admin access required" });
    }
    const { statementId } = req.params;
    const { rawDate, rawDescription, rawAmount } = req.body;
    if (!rawDate || !rawDescription || !rawAmount) {
      return res.status(400).json({ error: "rawDate, rawDescription and rawAmount required" });
    }
    const stmtSnap = await db.collection("commission_statements").doc(statementId).get();
    if (!stmtSnap.exists) return res.status(404).json({ error: "Statement not found" });
    const lineRef = db.collection("commission_statements").doc(statementId).collection("lines").doc();
    await lineRef.set({
      statementId, providerId: stmtSnap.data()!.providerId,
      rawDate, rawDescription, rawAmount,
      parsedDate: parseFlexibleDate(rawDate),
      parsedAmount: parseAmount(rawAmount),
      matchedCommissionRecordId: null, matchedOpportunityId: null,
      discrepancyAmount: null, status: "unmatched",
      reconciledBy: null, reconciledAt: null, notes: "",
    });
    await db.collection("commission_statements").doc(statementId).update({
      lineCount: admin.firestore.FieldValue.increment(1),
      unmatchedCount: admin.firestore.FieldValue.increment(1),
    });
    return res.json({ lineId: lineRef.id });
  });

  // ─── Admin: create employee (spec-compliant) ─────────────────────────────────
  // Validates @finvastra.com domain, creates Auth + Firestore doc, sends reset link.
  app.post("/api/admin/employees/create", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(uid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const {
        displayName, email, employeeId, department, designation,
        reportingManagerName, joiningDate, phone, personalEmail,
        officialPhone, location, employeeStatus = "active",
        lastWorkingDate,
        dateOfBirth, gender, bloodGroup, fatherMotherName, spouseName,
        presentAddress, permanentAddress,
        salaryBasic, salaryHra, salaryConveyance, salaryMedical, salaryOther, grossSalary,
        role = "employee", hrmsAccess = true, crmAccess = false,
        crmRole = null, convertorVertical = null,
        isHrmsManager = false, misAccess = null,
      } = req.body as Record<string, unknown>;

      if (!displayName || typeof displayName !== "string") {
        return res.status(400).json({ error: "displayName is required" });
      }
      if (!email || typeof email !== "string") {
        return res.status(400).json({ error: "email is required" });
      }
      if (!email.endsWith("@finvastra.com")) {
        return res.status(400).json({ error: "Email must be a @finvastra.com address" });
      }

      // Create Firebase Auth account with fixed temp password
      let newUid: string;
      try {
        const existing = await admin.auth().getUserByEmail(email);
        newUid = existing.uid;
      } catch {
        const authUser = await admin.auth().createUser({
          email, displayName, password: "Finvastra@2026", emailVerified: false,
        });
        newUid = authUser.uid;
      }

      // Generate password reset link so employee sets their own password
      let resetLink: string | null = null;
      try {
        resetLink = await admin.auth().generatePasswordResetLink(email);
      } catch { /* non-fatal — admin can resend later */ }

      // Create Firestore profile — public directory fields only
      await db.collection("users").doc(newUid).set({
        userId:               newUid,
        displayName,
        email,
        ...(location             ? { location }             : {}),
        ...(employeeId           ? { employeeId }           : {}),
        ...(department           ? { department }           : {}),
        ...(designation          ? { designation }          : {}),
        ...(reportingManagerName ? { reportingManagerName } : {}),
        ...(joiningDate          ? { joiningDate }          : {}),
        role,
        hrmsAccess,
        crmAccess,
        crmRole,
        convertorVertical,
        isHrmsManager,
        misAccess,
        employeeStatus:      employeeStatus ?? "active",
        needsEmailSetup:     false,
        mustResetPassword:   true,
        photoURL:            null,
        createdAt:           admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Write personal details to /user_details/{uid} (admin/HR-only collection)
      const personalData: Record<string, unknown> = {};
      if (phone)           personalData.phone          = phone;
      if (officialPhone)   personalData.officialPhone  = officialPhone;
      if (personalEmail)   personalData.personalEmail  = personalEmail;
      if (dateOfBirth)     personalData.dateOfBirth    = dateOfBirth;
      if (lastWorkingDate) personalData.lastWorkingDate = lastWorkingDate;
      if (gender)          personalData.gender         = gender;
      if (bloodGroup)      personalData.bloodGroup     = bloodGroup;
      if (fatherMotherName) personalData.fatherMotherName = fatherMotherName;
      if (spouseName)      personalData.spouseName     = spouseName;
      if (presentAddress)  personalData.presentAddress = presentAddress;
      if (permanentAddress) personalData.permanentAddress = permanentAddress;
      if (Object.keys(personalData).length > 0) {
        await db.collection("user_details").doc(newUid).set(personalData, { merge: true });
      }

      // Write salary to employee_sensitive (access-controlled; not world-readable)
      const salaryData: Record<string, unknown> = {};
      if (salaryBasic)      salaryData.salaryBasic      = salaryBasic;
      if (salaryHra)        salaryData.salaryHra        = salaryHra;
      if (salaryConveyance) salaryData.salaryConveyance = salaryConveyance;
      if (salaryMedical)    salaryData.salaryMedical    = salaryMedical;
      if (salaryOther)      salaryData.salaryOther      = salaryOther;
      if (grossSalary)      salaryData.grossSalary      = grossSalary;
      if (Object.keys(salaryData).length > 0) {
        await db.collection("employee_sensitive").doc(newUid).set(salaryData, { merge: true });
      }

      // Try to generate a password reset link so employee sets their own password.
      // Fire-and-forget; mustResetPassword flag is the primary enforcement.
      try {
        const resetLink = await admin.auth().generatePasswordResetLink(email as string);
        console.log(`[create-employee] Password reset link for ${email}: ${resetLink}`);
      } catch (e) {
        console.warn(`[create-employee] Could not generate reset link for ${email}:`, e);
      }

      // Audit log
      await db.collection("audit_logs").add({
        actor:        uid,
        action:       "employee_created",
        targetEmail:  email,
        targetPath:   `/users/${newUid}`,
        at:           admin.firestore.FieldValue.serverTimestamp(),
      });

      // Stamp custom claims immediately so the new employee's first token has the right role
      try {
        await admin.auth().setCustomUserClaims(newUid, {
          role:          role ?? "employee",
          hrmsAccess:    hrmsAccess ?? true,
          crmAccess:     crmAccess ?? false,
          crmRole:       crmRole ?? null,
          isHrmsManager: isHrmsManager ?? false,
          misAccess:     misAccess ?? null,
        });
      } catch (e) {
        console.warn("[create-employee] setCustomUserClaims failed (non-fatal):", e);
      }

      // Auto-create onboarding checklist (non-fatal — HR can create manually if this fails)
      try {
        await createOnboardingChecklist(
          newUid,
          typeof displayName === "string" ? displayName : String(displayName),
          typeof joiningDate === "string" ? joiningDate : null,
          uid,
        );
      } catch (e) {
        console.warn("[create-employee] createOnboardingChecklist failed (non-fatal):", e);
      }

      return res.json({ uid: newUid, email, empCode: employeeId ?? null, resetLink });
    } catch (e) {
      console.error("create employee error:", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
    }
  });

  // ─── Checklist helpers ────────────────────────────────────────────────────────

  function buildOnboardingItems() {
    return [
      // Documents
      { id: "ob_doc_offer",       category: "documents",      task: "Offer letter signed and collected",             completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_doc_appoint",     category: "documents",      task: "Appointment letter issued",                     completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_doc_pan",         category: "documents",      task: "PAN card copy collected",                       completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_doc_aadhaar",     category: "documents",      task: "Aadhaar copy collected (do not store number)",  completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_doc_bank",        category: "documents",      task: "Bank account details collected",                completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_doc_emergency",   category: "documents",      task: "Emergency contact details collected",           completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_doc_edu",         category: "documents",      task: "Educational certificates verified",             completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_doc_prevexp",     category: "documents",      task: "Previous employment documents verified",        completed: false, completedAt: null, completedBy: null, notes: null },
      // System Access
      { id: "ob_sys_email",       category: "system_access",  task: "@finvastra.com email created in Google Workspace", completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_sys_pulse",       category: "system_access",  task: "Added to Finvastra Pulse (this system)",       completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_sys_whatsapp",    category: "system_access",  task: "Added to relevant WhatsApp groups",            completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_sys_drive",       category: "system_access",  task: "Added to Google Drive shared folders",         completed: false, completedAt: null, completedBy: null, notes: null },
      // Assets
      { id: "ob_asset_laptop",    category: "assets",         task: "Laptop issued (update asset management)",      completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_asset_sim",       category: "assets",         task: "SIM card issued (update asset management)",    completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_asset_card",      category: "assets",         task: "Access card issued (if applicable)",           completed: false, completedAt: null, completedBy: null, notes: null },
      // Induction
      { id: "ob_ind_policy",      category: "induction",      task: "HR policy walkthrough done",                   completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_ind_posh",        category: "induction",      task: "POSH policy acknowledged",                     completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_ind_manager",     category: "induction",      task: "Reporting manager introduction done",          completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_ind_team",        category: "induction",      task: "Team introduction done",                       completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "ob_ind_kpi",         category: "induction",      task: "Role and KPIs explained",                      completed: false, completedAt: null, completedBy: null, notes: null },
    ];
  }

  function buildOffboardingItems() {
    return [
      // Knowledge Transfer
      { id: "off_kt_handover",   category: "knowledge_transfer", task: "Handover document prepared",                     completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "off_kt_wip",        category: "knowledge_transfer", task: "Work-in-progress handed over to manager",        completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "off_kt_clients",    category: "knowledge_transfer", task: "Client contacts handed over",                    completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "off_kt_creds",      category: "knowledge_transfer", task: "Passwords and credentials handed over",          completed: false, completedAt: null, completedBy: null, notes: null },
      // Assets
      { id: "off_asset_laptop",  category: "assets",             task: "Laptop returned and condition checked",          completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "off_asset_sim",     category: "assets",             task: "SIM card returned",                              completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "off_asset_card",    category: "assets",             task: "Access card returned",                           completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "off_asset_other",   category: "assets",             task: "Any other company property returned",            completed: false, completedAt: null, completedBy: null, notes: null },
      // System Access
      { id: "off_sys_pulse",     category: "system_access",      task: "Pulse access disabled (auto — done on deactivation)", completed: true,  completedAt: null, completedBy: null, notes: "Auto-completed on deactivation" },
      { id: "off_sys_email",     category: "system_access",      task: "Google Workspace email disabled",                completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "off_sys_whatsapp",  category: "system_access",      task: "Removed from WhatsApp groups",                   completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "off_sys_drive",     category: "system_access",      task: "Removed from shared Google Drive folders",       completed: false, completedAt: null, completedBy: null, notes: null },
      // Documents
      { id: "off_doc_resign",    category: "documents",          task: "Resignation letter received and filed",          completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "off_doc_exp",       category: "documents",          task: "Experience letter issued",                       completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "off_doc_relieve",   category: "documents",          task: "Relieving letter issued",                        completed: false, completedAt: null, completedBy: null, notes: null },
      { id: "off_doc_form16",    category: "documents",          task: "Form 16 issued (if applicable)",                 completed: false, completedAt: null, completedBy: null, notes: null },
    ];
  }

  async function createOnboardingChecklist(
    uid: string, employeeName: string, joiningDate: string | null, createdBy: string
  ) {
    await db.collection("onboarding_checklists").doc(uid).set({
      employeeId:  uid,
      employeeName,
      joiningDate: joiningDate ?? null,
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      createdBy,
      status:      "pending",
      completedAt: null,
      items:       buildOnboardingItems(),
    });
  }

  async function createOffboardingChecklist(
    uid: string, employeeName: string,
    lastWorkingDate: string | null, exitReason: string | null, createdBy: string,
    extraItems: object[] = [],
  ) {
    const items = [...buildOffboardingItems(), ...extraItems];
    await db.collection("offboarding_checklists").doc(uid).set({
      employeeId:      uid,
      employeeName,
      lastWorkingDate: lastWorkingDate ?? null,
      exitReason:      exitReason ?? null,
      createdAt:       admin.firestore.FieldValue.serverTimestamp(),
      createdBy,
      status:          "pending",
      completedAt:     null,
      fnfStatus:       "pending",
      fnfSettledAt:    null,
      fnfSettledBy:    null,
      items,
      fnfDetails:      null,
    });
  }

  // ─── Deactivate employee ──────────────────────────────────────────────────────
  // Disables Firebase Auth account, revokes sessions, updates Firestore,
  // creates offboarding checklist doc, writes audit log.
  app.post("/api/admin/employees/:uid/deactivate", async (req, res) => {
    try {
      const callerUid = await verifyFirebaseToken(req);
      if (!callerUid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(callerUid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const { uid } = req.params;

      // Super admin accounts are permanently protected — cannot be deactivated by anyone
      if (isSuperAdmin(uid)) {
        return res.status(403).json({ error: "Super admin accounts cannot be deactivated." });
      }

      const { lastWorkingDate, exitReason, notes } = req.body as Record<string, string>;

      if (!lastWorkingDate) return res.status(400).json({ error: "lastWorkingDate is required" });
      if (!exitReason)       return res.status(400).json({ error: "exitReason is required" });

      // 1. Disable Firebase Auth account — employee cannot log in immediately
      await admin.auth().updateUser(uid, { disabled: true });

      // 2. Revoke all existing sessions — forces token invalidation
      await admin.auth().revokeRefreshTokens(uid);

      // 3. Update Firestore /users doc
      const empSnap = await db.collection("users").doc(uid).get();
      const empName = empSnap.data()?.displayName ?? uid;
      await db.collection("users").doc(uid).update({
        employeeStatus: "inactive",
        lwd:            lastWorkingDate,
        exitReason,
        deactivatedAt:  admin.firestore.FieldValue.serverTimestamp(),
        deactivatedBy:  callerUid,
      });

      // 4. Check for open CRM items that need reassignment before exit
      // Query leads — filter deleted in-memory to avoid requiring a composite index
      const leadsSnap = await db.collection("leads")
        .where("primaryOwnerId", "==", uid)
        .get();
      const openLeadsCount = leadsSnap.docs.filter((d) => d.data().deleted !== true).length;

      // Query opportunities across all leads via collectionGroup — filter status in-memory
      const oppsSnap = await db.collectionGroup("opportunities")
        .where("ownerId", "==", uid)
        .get();
      const openOppsCount = oppsSnap.docs.filter((d) => d.data().status === "open").length;

      // Build an extra checklist item if any open CRM work exists
      const extraItems: object[] = [];
      if (openLeadsCount > 0 || openOppsCount > 0) {
        extraItems.push({
          id:          "crm_reassignment",
          category:    "crm",
          task:        `Reassign ${openLeadsCount} open lead${openLeadsCount !== 1 ? "s" : ""} and ${openOppsCount} open opportunit${openOppsCount !== 1 ? "ies" : "y"} before exit`,
          completed:   false,
          completedAt: null,
          completedBy: null,
          notes:       null,
          required:    true,
          metadata: {
            openLeadsCount,
            openOpportunitiesCount: openOppsCount,
            reassignUrl: `/crm/leads?ownerId=${uid}`,
          },
        });
      }

      // 5. Create offboarding checklist (CRM item prepended via extraItems)
      await createOffboardingChecklist(uid, empName, lastWorkingDate, exitReason, callerUid, extraItems);

      // 6. Audit log
      await db.collection("audit_logs").add({
        actor:      callerUid,
        action:     "employee_deactivated",
        targetPath: `/users/${uid}`,
        after:      { employeeStatus: "inactive", lwd: lastWorkingDate, exitReason, notes: notes ?? null },
        at:         admin.firestore.FieldValue.serverTimestamp(),
      });

      const warning = openLeadsCount > 0 || openOppsCount > 0
        ? "Employee has open CRM items that need reassignment"
        : null;

      return res.json({ ok: true, warning, openLeads: openLeadsCount, openOpportunities: openOppsCount });
    } catch (e) {
      console.error("[deactivate-employee]", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
    }
  });

  // ─── Reactivate employee ──────────────────────────────────────────────────────
  // Re-enables Firebase Auth account, updates Firestore, creates onboarding checklist.
  app.post("/api/admin/employees/:uid/reactivate", async (req, res) => {
    try {
      const callerUid = await verifyFirebaseToken(req);
      if (!callerUid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(callerUid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const { uid } = req.params;
      const { newJoiningDate, notes } = req.body as Record<string, string>;

      // 1. Re-enable Firebase Auth account
      await admin.auth().updateUser(uid, { disabled: false });

      // 2. Update Firestore /users doc
      const empSnap = await db.collection("users").doc(uid).get();
      const empName = empSnap.data()?.displayName ?? uid;
      const joiningDate = newJoiningDate || (empSnap.data()?.joiningDate ?? null);
      await db.collection("users").doc(uid).update({
        employeeStatus:  "active",
        lwd:             null,
        exitReason:      null,
        reactivatedAt:   admin.firestore.FieldValue.serverTimestamp(),
        reactivatedBy:   callerUid,
        mustResetPassword: true,   // fresh login required
      });

      // 3. Create new onboarding checklist (fresh start)
      await createOnboardingChecklist(uid, empName, joiningDate, callerUid);

      // 4. Audit log
      await db.collection("audit_logs").add({
        actor:      callerUid,
        action:     "employee_reactivated",
        targetPath: `/users/${uid}`,
        after:      { employeeStatus: "active", newJoiningDate: newJoiningDate ?? null, notes: notes ?? null },
        at:         admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ ok: true });
    } catch (e) {
      console.error("[reactivate-employee]", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
    }
  });

  // ─── Create single employee ───────────────────────────────────────────────────
  // Creates Firebase Auth account (email/password) + Firestore /users doc.
  // Returns the generated uid and a temporary password for distribution.
  app.post("/api/hrms/employees/create", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const callerSnap = await db.collection("users").doc(uid).get();
    if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

    const {
      displayName, officialEmail, employeeId, employeeStatus = "active",
      phone, officialPhone, personalEmail, department, designation,
      reportingManagerName, location, joiningDate, dateOfBirth,
      gender, bloodGroup, fatherMotherName, spouseName,
      presentAddress, permanentAddress, grossSalary, lastWorkingDate,
      salaryBasic, salaryHra, salaryConveyance, salaryMedical, salaryOther,
      bankData,
    } = req.body as Record<string, string | number | Record<string, unknown> | undefined>;

    if (!displayName) return res.status(400).json({ error: "displayName is required" });

    const genPwd = () => {
      const ch = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
      let p = ""; const b = crypto.randomBytes(12);
      for (let i = 0; i < 12; i++) p += ch[b[i] % ch.length];
      return p;
    };

    // Public directory fields only — no personal data in /users
    const profileData: Record<string, unknown> = {
      displayName,
      role: "employee",
      photoURL: "",
      employeeStatus,
      ...(employeeId           ? { employeeId }           : {}),
      ...(department           ? { department }           : {}),
      ...(designation          ? { designation }          : {}),
      ...(location             ? { location }             : {}),
      ...(reportingManagerName ? { reportingManagerName } : {}),
      ...(joiningDate          ? { joiningDate }          : {}),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Personal details — goes to /user_details (admin/HR-only)
    const personalDetails: Record<string, unknown> = {};
    if (phone)            personalDetails.phone           = phone;
    if (officialPhone)    personalDetails.officialPhone   = officialPhone;
    if (personalEmail)    personalDetails.personalEmail   = personalEmail;
    if (dateOfBirth)      personalDetails.dateOfBirth     = dateOfBirth;
    if (gender)           personalDetails.gender          = gender;
    if (bloodGroup)       personalDetails.bloodGroup      = bloodGroup;
    if (fatherMotherName) personalDetails.fatherMotherName = fatherMotherName;
    if (spouseName)       personalDetails.spouseName      = spouseName;
    if (presentAddress)   personalDetails.presentAddress  = presentAddress;
    if (permanentAddress) personalDetails.permanentAddress = permanentAddress;
    if (lastWorkingDate)  personalDetails.lastWorkingDate = lastWorkingDate;

    let newUid: string;
    let tempPassword: string | null = null;

    if (officialEmail) {
      // Check for existing auth account
      try {
        const existing = await admin.auth().getUserByEmail(String(officialEmail));
        newUid = existing.uid;
        const existingSnap = await db.collection("users").doc(newUid).get();
        if (existingSnap.exists) {
          await existingSnap.ref.update(profileData);
        } else {
          await db.collection("users").doc(newUid).set({ ...profileData, email: officialEmail, userId: newUid });
        }
      } catch {
        tempPassword = genPwd();
        const authUser = await admin.auth().createUser({
          email: String(officialEmail),
          password: tempPassword,
          displayName: String(displayName),
          disabled: employeeStatus === "inactive",
        });
        newUid = authUser.uid;
        await db.collection("users").doc(newUid).set({ ...profileData, email: officialEmail, userId: newUid });
      }
    } else {
      // No login email — profile-only record
      const docRef = db.collection("users").doc();
      newUid = docRef.id;
      await docRef.set({ ...profileData, email: "", userId: newUid });
    }

    // Write personal details to /user_details (admin/HR-only collection)
    if (Object.keys(personalDetails).length > 0) {
      await db.collection("user_details").doc(newUid).set(
        { ...personalDetails, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    // Store salary data in /employee_sensitive (admin-only collection)
    const salaryFields: Record<string, unknown> = {};
    if (salaryBasic)      salaryFields.salaryBasic      = Number(salaryBasic);
    if (salaryHra)        salaryFields.salaryHra        = Number(salaryHra);
    if (salaryConveyance) salaryFields.salaryConveyance = Number(salaryConveyance);
    if (salaryMedical)    salaryFields.salaryMedical    = Number(salaryMedical);
    if (salaryOther)      salaryFields.salaryOther      = Number(salaryOther);
    if (grossSalary)      salaryFields.grossSalary      = Number(grossSalary);
    const sensitivePayload: Record<string, unknown> = { ...salaryFields };
    if (bankData) Object.assign(sensitivePayload, bankData as Record<string, unknown>);
    if (Object.keys(sensitivePayload).length > 0) {
      await db.collection("employee_sensitive").doc(newUid).set(
        { ...sensitivePayload, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    await db.collection("audit_logs").add({
      actor: uid, action: "create_employee",
      targetPath: `/users/${newUid}`,
      before: null, after: { displayName, email: officialEmail ?? "" },
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ uid: newUid, tempPassword });
  });

  // ─── Employee master import (service-account Sheets API) ────────────────────

  // Preview: reads sheet via SA, returns parsed employee list. No writes.
  app.post("/api/admin/employees/import-preview", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(uid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const rows = await fetchEmployeeMasterRows();
      const employees = rows
        .map(parseEmployeeRow)
        .filter((e) => e.empCode && e.name);

      return res.json({
        employees: employees.map(({ panRaw: _, personalBankAcct: _2, officialBankAcct: _3, ...rest }) => rest),
        total:    employees.length,
        active:   employees.filter((e) => e.status === "active").length,
        inactive: employees.filter((e) => e.status === "inactive").length,
      });
    } catch (e) {
      console.error("[import-preview]", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Preview failed" });
    }
  });

  // Confirm: re-reads sheet via SA, creates Auth + Firestore + encrypted profile docs.
  app.post("/api/admin/employees/import-confirm", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(uid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const rows = await fetchEmployeeMasterRows();
      const parsed = rows.map(parseEmployeeRow).filter((e) => e.empCode && e.name);

      let created = 0, updated = 0, skipped = 0;
      const errors: string[] = [];

      for (const emp of parsed) {
        try {
          const docId     = emp.status === "active" && emp.officialEmail ? null : emp.empCode;
          // Public directory fields only
          const profileBase: Record<string, unknown> = {
            employeeId:           emp.empCode,
            displayName:          emp.name,
            email:                emp.officialEmail ?? "",
            department:           emp.department,
            designation:          emp.designation,
            reportingManagerName: emp.reportingManager,
            joiningDate:          emp.doj,
            employeeStatus:       emp.status,
            needsEmailSetup:      emp.needsEmailSetup,
            photoURL:             null,
            ...emp.roleAttrs,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };

          // Personal details → /user_details (admin/HR-only)
          const importUserDetails: Record<string, unknown> = {};
          if (emp.officialPhone ?? emp.phone) importUserDetails.phone = emp.officialPhone ?? emp.phone;
          if (emp.personalEmail)              importUserDetails.personalEmail = emp.personalEmail;
          if (emp.dob)                        importUserDetails.dateOfBirth   = emp.dob;
          if (emp.presentAddress)             importUserDetails.presentAddress = emp.presentAddress;
          if (emp.permanentAddress)           importUserDetails.permanentAddress = emp.permanentAddress;
          if (emp.status === "inactive" && emp.lwd) importUserDetails.lastWorkingDate = emp.lwd;

          // Aadhaar column (index 13) is intentionally skipped — UIDAI prohibition.
          const sensitiveDoc: Record<string, unknown> = {
            uid:              emp.empCode,
            dob:              emp.dob,
            uan:              emp.uan,
            presentAddress:   emp.presentAddress,
            permanentAddress: emp.permanentAddress,
            personalEmail:    emp.personalEmail,
            personalPhone:    emp.phone,
            personalBankName:    emp.personalBankName,
            personalBankBranch:  emp.personalBankBranch,
            personalBankIfsc:    emp.personalBankIfsc,
            officialBankName:    emp.officialBankName,
            officialBankBranch:  emp.officialBankBranch,
            officialBankIfsc:    emp.officialBankIfsc,
            grossSalary:         emp.grossSalary,
            aadhaarVerified:     false,
            aadhaarVerifiedOn:   null,
            aadhaarVerifiedBy:   null,
            aadhaarDriveLink:    null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          if (emp.panRaw) sensitiveDoc.panEncrypted = encryptField(emp.panRaw);
          if (emp.personalBankAcct) sensitiveDoc.personalBankAccountEncrypted = encryptField(emp.personalBankAcct);
          if (emp.officialBankAcct) sensitiveDoc.officialBankAccountEncrypted = encryptField(emp.officialBankAcct);

          if (emp.status === "inactive" || !emp.officialEmail) {
            // No Auth account — use empCode as doc ID
            const ref  = db.collection("users").doc(emp.empCode);
            const snap = await ref.get();
            if (snap.exists) {
              await ref.set({ ...profileBase, userId: emp.empCode, createdAt: snap.data()!.createdAt }, { merge: false });
              updated++;
            } else {
              await ref.set({ ...profileBase, userId: emp.empCode, createdAt: admin.firestore.FieldValue.serverTimestamp() });
              created++;
            }
            if (Object.keys(importUserDetails).length > 0) {
              await db.collection("user_details").doc(emp.empCode).set(
                { ...importUserDetails, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
              );
            }
            await db.collection("employee_profiles").doc(emp.empCode).set(
              { ...sensitiveDoc, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
            );
            if (emp.status === "inactive") { skipped++; created--; }
            continue;
          }

          // Active + has email → Auth account
          let authUid: string;
          let authExisted = false;
          try {
            const existing = await admin.auth().getUserByEmail(emp.officialEmail);
            authUid     = existing.uid;
            authExisted = true;
          } catch {
            const newUser = await admin.auth().createUser({
              email: emp.officialEmail, displayName: emp.name,
              password: "Finvastra@2026", emailVerified: false, disabled: false,
            });
            authUid = newUser.uid;
          }

          const userRef  = db.collection("users").doc(authUid);
          const userSnap = await userRef.get();
          if (userSnap.exists) {
            await userRef.set({ ...profileBase, userId: authUid, email: emp.officialEmail, createdAt: userSnap.data()!.createdAt }, { merge: false });
            updated++;
          } else {
            // New Auth account → force password reset on first login
            const resetFlag = !authExisted ? { mustResetPassword: true } : {};
            await userRef.set({ ...profileBase, ...resetFlag, userId: authUid, email: emp.officialEmail, createdAt: admin.firestore.FieldValue.serverTimestamp() });
            if (!authExisted) created++;
            else updated++;
          }

          if (Object.keys(importUserDetails).length > 0) {
            await db.collection("user_details").doc(authUid).set(
              { ...importUserDetails, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
            );
          }
          await db.collection("employee_profiles").doc(emp.empCode).set(
            { ...sensitiveDoc, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
          );
          await db.collection("audit_logs").add({
            actor: uid, action: "import_employee",
            targetPath: `/users/${authUid}`,
            before: null, after: { email: emp.officialEmail, displayName: emp.name },
            at: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (rowErr) {
          errors.push(`${emp.empCode} ${emp.name}: ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`);
        }
      }

      return res.json({ created, updated, skipped, errors });
    } catch (e) {
      console.error("[import-confirm]", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Import failed" });
    }
  });

  // ─── Employee master import from Google Sheet (legacy — kept for compat) ─────
  // Original endpoint used public CSV; new flow uses /api/admin/employees/import-preview
  // and /api/admin/employees/import-confirm above. This endpoint is no longer called
  // by the UI but preserved in case it's needed via API directly.
  app.post("/api/hrms/employees/import-from-sheet", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(uid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const { sheetUrl, dryRun = false } = req.body as { sheetUrl: string; dryRun?: boolean };
      if (!sheetUrl) return res.status(400).json({ error: "sheetUrl required" });

      // ── helpers ──
      const norm = (s: string | undefined) => { const t = (s ?? "").trim(); return (!t || t === "NA") ? null : t; };
      const ddToISO  = (s: string) => { const m = s.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}` : null; };
      const ddToMMDD = (s: string) => { const m = s.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); return m ? `${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}` : null; };
      const parseSalary = (s: string) => { const n = Number((s ?? "").replace(/,/g,"")); return isNaN(n) || n === 0 ? null : n; };
      const genPwd = () => { const ch = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"; let p = ""; const b = crypto.randomBytes(12); for(let i=0;i<12;i++) p+=ch[b[i]%ch.length]; return p; };

      // ── CSV parser (handles quoted fields with embedded commas) ──
      function parseCSV(text: string): string[][] {
        const rows: string[][] = []; let row: string[] = [], field = "", inQ = false;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (inQ) { if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
          else if (ch === '"') { inQ = true; }
          else if (ch === ',') { row.push(field); field = ""; }
          else if (ch === '\n') { row.push(field); field = ""; if (row.some(c=>c.trim())) rows.push(row); row = []; }
          else if (ch !== '\r') { field += ch; }
        }
        if (field || row.length > 0) { row.push(field); if (row.some(c=>c.trim())) rows.push(row); }
        return rows;
      }

      // ── Fetch sheet as CSV ──
      let csvText: string;
      try {
        const sheetId = extractSheetId(sheetUrl);
        const gidMatch = sheetUrl.match(/gid=(\d+)/);
        const gid = gidMatch ? gidMatch[1] : "0";
        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
        const fetchRes = await fetch(csvUrl, { redirect: "follow" });
        if (!fetchRes.ok) return res.status(400).json({ error: `Could not fetch sheet (HTTP ${fetchRes.status}). Make sure the sheet is set to "Anyone with the link can view".` });
        csvText = await fetchRes.text();
      } catch (e) {
        return res.status(400).json({ error: `Sheet fetch failed: ${e instanceof Error ? e.message : String(e)}` });
      }

      const allRows = parseCSV(csvText);
      // Row 0 = main headers, Row 1 = bank sub-headers, data from Row 2
      const dataRows = allRows.slice(2).filter(r => norm(r[2]) || norm(r[3]));

      // Column indices (0-based, Finvastra employee master sheet)
      const C = {
        status:1, empCode:2, name:3, dob:4, phone:5, personalEmail:6, doj:7,
        officialEmail:8, officialPhone:9, dept:10, designation:11, manager:12,
        // 13=Aadhaar SKIP, 14=PAN SKIP, 15=UAN SKIP
        presentAddr:16, permanentAddr:17,
        // Bank accounts (stored in /employee_sensitive)
        personalBankName:18, personalBankBranch:19, personalBankAcct:20, personalBankIfsc:21,
        officialBankName:22, officialBankBranch:23, officialBankAcct:24, officialBankIfsc:25,
        lwd:26, salary:27,
      };

      const results: Array<{
        empCode: string; name: string; email: string | null;
        status: "created" | "exists" | "no_email" | "error";
        tempPassword?: string; error?: string;
      }> = [];

      for (const row of dataRows) {
        try {
          const empCode       = norm(row[C.empCode]) ?? "";
          const name          = norm(row[C.name]) ?? "";
          const officialEmail = norm(row[C.officialEmail]);
          const statusStr     = (norm(row[C.status]) ?? "active").toLowerCase();

          if (!name) continue;

          const dobRaw = norm(row[C.dob]);
          const dojRaw = norm(row[C.doj]);
          const lwdRaw = norm(row[C.lwd]);

          const profileData: Record<string, unknown> = {
            displayName:    name,
            employeeId:     empCode || null,
            role:           "employee",
            photoURL:       "",
            employeeStatus: statusStr === "inactive" ? "inactive" : "active",
            ...(norm(row[C.phone])         ? { phone: norm(row[C.phone]) }                          : {}),
            ...(norm(row[C.officialPhone]) ? { officialPhone: norm(row[C.officialPhone]) }          : {}),
            ...(norm(row[C.personalEmail]) ? { personalEmail: norm(row[C.personalEmail]) }          : {}),
            ...(norm(row[C.dept])          ? { department: norm(row[C.dept]) }                      : {}),
            ...(norm(row[C.designation])   ? { designation: norm(row[C.designation]) }              : {}),
            ...(norm(row[C.manager])       ? { reportingManagerName: norm(row[C.manager]) }         : {}),
            ...(dobRaw                     ? { dateOfBirth: ddToMMDD(dobRaw) }                      : {}),
            ...(dojRaw                     ? { joiningDate:  ddToISO(dojRaw) }                      : {}),
            ...(norm(row[C.presentAddr])   ? { presentAddress: norm(row[C.presentAddr]) }           : {}),
            ...(norm(row[C.permanentAddr]) ? { permanentAddress: norm(row[C.permanentAddr]) }       : {}),
            ...(lwdRaw                     ? { lastWorkingDate: ddToISO(lwdRaw) }                   : {}),
            ...(parseSalary(row[C.salary] ?? "") !== null ? { grossSalary: parseSalary(row[C.salary] ?? "") } : {}),
            importedAt: admin.firestore.FieldValue.serverTimestamp(),
          };

          // Sensitive bank data → /employee_sensitive/{uid}
          const personalBank = {
            name: norm(row[C.personalBankName]),
            branch: norm(row[C.personalBankBranch]),
            accountNumber: norm(row[C.personalBankAcct]),
            ifsc: norm(row[C.personalBankIfsc]),
          };
          const officialBank = {
            name: norm(row[C.officialBankName]),
            branch: norm(row[C.officialBankBranch]),
            accountNumber: norm(row[C.officialBankAcct]),
            ifsc: norm(row[C.officialBankIfsc]),
          };
          const hasBankData = Object.values(personalBank).some(Boolean) || Object.values(officialBank).some(Boolean);

          if (!officialEmail) {
            if (!dryRun) {
              const docRef = db.collection("users").doc();
              await docRef.set({ ...profileData, email: "", userId: docRef.id });
              if (hasBankData) {
                await db.collection("employee_sensitive").doc(docRef.id).set(
                  { personalBank, officialBank, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                  { merge: true }
                );
              }
            }
            results.push({ empCode, name, email: null, status: "no_email" });
            continue;
          }

          // Check for existing Firebase Auth account
          let existingUid: string | null = null;
          try {
            const existingAuth = await admin.auth().getUserByEmail(officialEmail);
            existingUid = existingAuth.uid;
          } catch { /* user does not exist */ }

          if (existingUid) {
            if (!dryRun) {
              await db.collection("users").doc(existingUid).set(
                { ...profileData, email: officialEmail, userId: existingUid },
                { merge: true }
              );
              if (hasBankData) {
                await db.collection("employee_sensitive").doc(existingUid).set(
                  { personalBank, officialBank, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                  { merge: true }
                );
              }
            }
            results.push({ empCode, name, email: officialEmail, status: "exists" });
          } else {
            const tempPassword = genPwd();
            if (!dryRun) {
              const authUser = await admin.auth().createUser({
                email: officialEmail,
                password: tempPassword,
                displayName: name,
                disabled: statusStr === "inactive",
              });
              await db.collection("users").doc(authUser.uid).set({
                ...profileData, email: officialEmail, userId: authUser.uid,
              });
              if (hasBankData) {
                await db.collection("employee_sensitive").doc(authUser.uid).set(
                  { personalBank, officialBank, updatedAt: admin.firestore.FieldValue.serverTimestamp() }
                );
              }
              await db.collection("audit_logs").add({
                actor: uid, action: "import_employee",
                targetPath: `/users/${authUser.uid}`,
                before: null, after: { email: officialEmail, displayName: name },
                at: admin.firestore.FieldValue.serverTimestamp(),
              });
            }
            results.push({ empCode, name, email: officialEmail, status: "created", tempPassword });
          }
        } catch (rowErr) {
          const empCode = norm(row[2]) ?? "";
          const name    = norm(row[3]) ?? "Unknown";
          console.error(`Import row error (${empCode} ${name}):`, rowErr);
          results.push({ empCode, name, email: null, status: "error",
            error: rowErr instanceof Error ? rowErr.message : String(rowErr) });
        }
      }

      const summary = {
        total:   results.length,
        created: results.filter(r => r.status === "created").length,
        exists:  results.filter(r => r.status === "exists").length,
        noEmail: results.filter(r => r.status === "no_email").length,
        errors:  results.filter(r => r.status === "error").length,
      };
      return res.json({ dryRun, summary, results });

    } catch (e) {
      console.error("Import-from-sheet fatal error:", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // ─── Vite / static serving ───────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
