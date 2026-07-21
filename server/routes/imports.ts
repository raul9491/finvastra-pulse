/**
 * server/routes/imports.ts - bulk lead-import + lead-pull/queue + phone-backfill
 * HTTP routes, lifted from server.ts (2026-07-21, Phase 3 route split). Registered
 * via registerImportRoutes(app); imports its helpers directly from server/lib/*.
 */
import express from "express";
import { db, admin } from "../db.js";
import { HOUR_MS, checkRateLimit, verifyFirebaseToken } from "../lib/auth.js";
import {
  TEMPLATE_SHEET_URL,
  buildImportHash,
  buildImportHashLegacy,
  canonicalPhone,
  detectColumnMapping,
  distributeBatch,
  extractCells,
  extractSheetId,
  findExistingImportHashes,
  getServiceAccountEmail,
  getSheetsClient,
  processImportBatch,
  salvagePhoneFromName,
  splitPhones,
  validateCells,
  validateRow,
  writeImportedLead,
} from "../lib/imports.js";
import type { ColumnMapping } from "../lib/imports.js";

export function registerImportRoutes(app: express.Express): void {
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
      if (msg.includes("Office file") || msg.includes("not supported for this document")) {
        res.status(400).json({ error: "This link is an uploaded Excel file, not a Google Sheet. In Google Drive, right-click it → Open with → Google Sheets, then File → Save as Google Sheets, and paste that new link here. (Excel/.xlsx files can't be read directly.)" });
      } else if (msg.includes("404") || msg.includes("not found")) {
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
      // Read rows 1-51 (row 1 = headers, rows 2-51 = data)
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: "A1:ZZ51",
      });
      const rawRows = (result.data.values ?? []) as string[][];

      // Fetch valid loan products from Firestore
      const oppTypesSnap = await db.collection("opportunity_types")
        .where("businessLine", "==", "loan")
        .where("active", "==", true)
        .get();
      const loanProducts = new Set(oppTypesSnap.docs.map(d => d.data().name as string));

      const headers = rawRows[0] ?? [];
      const dataRows = rawRows.slice(1);
      const sampleRows = dataRows.slice(0, 20);
      const mapping = detectColumnMapping(headers, sampleRows, loanProducts);

      const rows = dataRows.map((raw, i) => {
        const errors = validateRow(raw, mapping, loanProducts);
        const cells = extractCells(raw, mapping);
        return {
          rowNumber: i + 2,
          data: cells as unknown as Record<string, string>,
          valid: errors.length === 0,
          errors,
        };
      });

      // Count total rows in sheet to report totalRows (not just first 50)
      const countResult = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: "A1:A",
      });
      const totalRows = Math.max(0, (countResult.data.values?.length ?? 1) - 1);

      res.json({
        rows,
        totalRows,
        headers,
        mapping,
        validCount: rows.filter(r => r.valid).length,
        errorCount: rows.filter(r => !r.valid).length,
        serviceAccountEmail: await getServiceAccountEmail(),
        loanProducts: [...loanProducts],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Office file") || msg.includes("not supported for this document")) {
        res.status(400).json({ error: "This link is an uploaded Excel file, not a Google Sheet. In Google Drive, right-click it → Open with → Google Sheets, then File → Save as Google Sheets, and paste that new link here." });
      } else {
        res.status(500).json({ error: msg });
      }
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

    const { sheetUrl, skipErrors = false, columnMapping: clientMapping, importName: rawImportName } = req.body;
    if (!sheetUrl) return res.status(400).json({ error: "sheetUrl required" });
    const importName = typeof rawImportName === "string" ? rawImportName.trim() : "";
    if (importName.length < 2) return res.status(400).json({ error: "Import name is required (min 2 characters) — used to track this sheet's source and quality." });
    if (importName.length > 120) return res.status(400).json({ error: "Import name too long (max 120 characters)." });
    const sheetId = extractSheetId(sheetUrl);

    // Generate batch ID: YYYY-MM-DD-xxxx
    const dateStr = new Date().toISOString().slice(0, 10);
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const batchId = `${dateStr}-${suffix}`;
    const jobId = db.collection("import_jobs").doc().id;

    // Read all rows from the Sheet (including header row for auto-detection)
    let allRows: string[][];
    try {
      const sheets = await getSheetsClient();
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: "A1:ZZ",
      });
      allRows = (result.data.values ?? []) as string[][];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Office file") || msg.includes("not supported for this document")) {
        return res.status(400).json({ error: "This link is an uploaded Excel file, not a Google Sheet. In Google Drive, right-click it → Open with → Google Sheets, then File → Save as Google Sheets, and paste that new link here." });
      }
      return res.status(500).json({ error: `Failed to read Sheet: ${msg}` });
    }

    // Fetch loan products once
    const oppTypesSnap = await db.collection("opportunity_types")
      .where("businessLine", "==", "loan").where("active", "==", true).get();
    const loanProducts = new Set(oppTypesSnap.docs.map(d => d.data().name as string));

    // Determine column mapping: use client-provided if given, otherwise auto-detect from header row
    const headerRow = allRows[0] ?? [];
    const dataRows  = allRows.slice(1);
    let columnMapping: ColumnMapping;
    if (clientMapping && typeof clientMapping === "object" && Object.keys(clientMapping).length > 0) {
      columnMapping = clientMapping as ColumnMapping;
    } else {
      const sampleRows = dataRows.slice(0, 20);
      columnMapping = detectColumnMapping(headerRow, sampleRows, loanProducts);
    }

    // Create the job doc
    await db.collection("import_jobs").doc(jobId).set({
      totalRows: dataRows.length,
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
      importName,
      distributed: false,
    });

    // Respond immediately — process in background
    res.json({ jobId, batchId, totalRows: dataRows.length });

    // Background processing (intentionally not awaited). Leads land UNASSIGNED;
    // they are routed to agents later from the Import Queue (POST /api/import/distribute).
    processImportBatch(jobId, sheetId, skipErrors, uid, batchId, dataRows, loanProducts, columnMapping, importName, headerRow)
      .catch(err => {
        console.error(`Import job ${jobId} failed:`, err);
        db.collection("import_jobs").doc(jobId).update({
          status: "failed",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          errors: [{ row: 0, data: {}, reason: String(err) }],
        }).catch(() => {});
      });
  });

  // ─── POST /api/import/retry-errors — re-process a job's failed rows IN PLACE ───
  // Smarter than re-uploading the whole sheet: re-validates ONLY the stored error
  // rows with the CURRENT logic (incl. phone salvage), imports the now-valid ones
  // (deduped against existing leads so no duplicates), and updates the job's
  // errors/counts/status. New leads land UNASSIGNED under the same batch → route
  // them from the Import Queue.
  app.post("/api/import/retry-errors", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const userSnap = await db.collection("users").doc(uid).get();
    const u = userSnap.data();
    if (!(u?.role === "admin" || u?.crmRole === "manager" || u?.crmCanImport === true)) {
      return res.status(403).json({ error: "Import access not granted." });
    }
    const { jobId } = req.body ?? {};
    if (!jobId) return res.status(400).json({ error: "jobId required" });

    const jobRef = db.collection("import_jobs").doc(String(jobId));
    const snap = await jobRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Import job not found" });
    const job = snap.data()!;
    const prevErrors: Array<{ row: number; data: Record<string, string>; reason: string }> =
      Array.isArray(job.errors) ? job.errors : [];
    if (prevErrors.length === 0) return res.json({ imported: 0, duplicates: 0, stillFailing: 0 });

    const batchId       = String(job.batchId ?? "");
    const importName    = String(job.importName ?? "");
    const triggerUserId = String(job.triggeredBy ?? uid);

    const oppTypesSnap = await db.collection("opportunity_types")
      .where("businessLine", "==", "loan").where("active", "==", true).get();
    const loanProducts = new Set(oppTypesSnap.docs.map(d => d.data().name as string));

    type Cand = { row: number; cells: ReturnType<typeof extractCells>; importHash: string; legacyHash: string };
    const stillFailing: typeof prevErrors = [];
    const cands: Cand[] = [];
    const seen = new Set<string>();

    for (const err of prevErrors) {
      const cells = {
        displayName: '', phone: '', altPhones: [], email: '', panRaw: '', loanProduct: '',
        dealSize: '', address: '', triagePriority: '', notes: '', importExtras: {},
        ...(err.data ?? {}),
      } as ReturnType<typeof extractCells>;
      // Re-split a multi-number cell ("9885299945, 9885012345") that an OLD job
      // stored whole as a failed row → primary + alternates (same as a fresh import).
      const phones = splitPhones(cells.phone);
      if (phones.length) { cells.phone = phones[0]; cells.altPhones = phones.slice(1); }
      // Re-apply salvage (stored error data predates the salvage logic).
      if (!cells.phone && cells.displayName) {
        const salv = salvagePhoneFromName(cells.displayName);
        if (salv) { cells.phone = salv.phone; cells.displayName = salv.cleanName; }
      }
      const errs = validateCells(cells);
      if (errs.length > 0) {
        stillFailing.push({ row: err.row, data: cells as unknown as Record<string, string>, reason: errs.join("; ") });
        continue;
      }
      const importHash = buildImportHash(cells.phone, cells.email, cells.displayName);
      if (seen.has(importHash)) {
        stillFailing.push({ row: err.row, data: cells as unknown as Record<string, string>, reason: "duplicate (repeated within the retry set)" });
        continue;
      }
      seen.add(importHash);
      cands.push({
        row: err.row, cells, importHash,
        legacyHash: buildImportHashLegacy(cells.phone, cells.email, cells.displayName),
      });
    }

    let imported = 0, duplicates = 0;
    for (let i = 0; i < cands.length; i += 30) {
      const slice = cands.slice(i, i + 30);
      // Canonical + legacy raw-phone hashes (transition — see buildImportHashLegacy).
      const existing = await findExistingImportHashes(slice);
      const batch = db.batch();
      let n = 0;
      for (const c of slice) {
        if (existing.has(c.importHash) || existing.has(c.legacyHash)) {
          duplicates++;
          stillFailing.push({ row: c.row, data: c.cells as unknown as Record<string, string>, reason: "duplicate (already imported)" });
          continue;
        }
        writeImportedLead(batch, c.cells, { batchId, importName, triggerUserId, importHash: c.importHash, loanProducts });
        n++;
      }
      if (n > 0) await batch.commit();
      imported += n;
    }

    const newErrors     = stillFailing.slice(0, 1000);
    const newErrorCount = newErrors.length;
    const newSuccess    = (job.successCount ?? 0) + imported;
    await jobRef.update({
      errors:       newErrors,
      errorCount:   newErrorCount,
      successCount: newSuccess,
      status:       newErrorCount === 0 ? "completed" : (newSuccess > 0 ? "partial" : "failed"),
      retriedAt:    admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ imported, duplicates, stillFailing: newErrorCount });
  });

  // ─── POST /api/import/backfill-extras — fill importExtras on an already-imported batch ──
  // Batches imported BEFORE importExtras shipped (or any time a column got dropped)
  // lose the sheet's extra columns. Re-reads the sheet, rebuilds the extras per row,
  // and stamps them onto the existing leads (matched by importHash). Idempotent —
  // skips leads that already carry extras. No new leads created; no duplicates.
  app.post("/api/import/backfill-extras", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const userSnap = await db.collection("users").doc(uid).get();
    const user = userSnap.data();
    const canRun = user?.role === "admin" || user?.crmRole === "manager" || user?.crmCanImport === true;
    if (!canRun) return res.status(403).json({ error: "Import access not granted." });

    const { batchId } = req.body;
    if (typeof batchId !== "string" || !batchId) return res.status(400).json({ error: "batchId required" });
    const jobSnap = await db.collection("import_jobs").where("batchId", "==", batchId).limit(1).get();
    if (jobSnap.empty) return res.status(404).json({ error: "Import batch not found." });
    const job = jobSnap.docs[0].data();
    const sheetId = job.sheetId as string;
    if (!sheetId) return res.status(400).json({ error: "This batch has no source sheet on record." });

    // Re-read the sheet
    let allRows: string[][];
    try {
      const sheets = await getSheetsClient();
      const result = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: "A1:ZZ" });
      allRows = (result.data.values ?? []) as string[][];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Office file") || msg.includes("not supported for this document")) {
        return res.status(400).json({ error: "The source is an uploaded Excel file, not a Google Sheet — convert it to a Google Sheet to backfill." });
      }
      if (msg.includes("permission") || msg.includes("PERMISSION") || msg.includes("403")) {
        const sa = await getServiceAccountEmail();
        return res.status(400).json({ error: `Can't read the source sheet — re-share it (Viewer) with ${sa}, then click Backfill again.` });
      }
      return res.status(400).json({ error: `Couldn't read the source sheet: ${msg}` });
    }

    const headers  = allRows[0] ?? [];
    const dataRows = allRows.slice(1);
    const oppTypesSnap = await db.collection("opportunity_types")
      .where("businessLine", "==", "loan").where("active", "==", true).get();
    const loanProducts = new Set(oppTypesSnap.docs.map((d) => d.data().name as string));
    const mapping = detectColumnMapping(headers, dataRows.slice(0, 20), loanProducts);

    // importHash → extras (first occurrence wins, matching the original import order).
    // Registered under BOTH the canonical hash and the legacy raw-phone hash so
    // batches imported before phone canonicalisation still match.
    const extrasByHash = new Map<string, Record<string, string>>();
    for (const raw of dataRows) {
      const cells = extractCells(raw, mapping, headers);
      if (Object.keys(cells.importExtras).length === 0) continue;
      const h  = buildImportHash(cells.phone, cells.email, cells.displayName);
      const lh = buildImportHashLegacy(cells.phone, cells.email, cells.displayName);
      if (!extrasByHash.has(h))  extrasByHash.set(h,  cells.importExtras);
      if (!extrasByHash.has(lh)) extrasByHash.set(lh, cells.importExtras);
    }

    const leadsSnap = await db.collection("leads").where("importBatchId", "==", batchId).get();
    let updated = 0, batchWrite = db.batch(), ops = 0;
    for (const d of leadsSnap.docs) {
      const lead = d.data();
      if (lead.importExtras && Object.keys(lead.importExtras).length) continue;   // already has extras
      const extras = extrasByHash.get(lead.importHash as string);
      if (!extras) continue;
      batchWrite.update(d.ref, { importExtras: extras });
      updated++; ops++;
      if (ops >= 400) { await batchWrite.commit(); batchWrite = db.batch(); ops = 0; }
    }
    if (ops > 0) await batchWrite.commit();
    return res.json({ updated, totalLeads: leadsSnap.size });
  });

  // ─── POST /api/import/distribute — route a held batch to agents ───────────────
  app.post("/api/import/distribute", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    if (!(await checkRateLimit(uid, "import-distribute", 30, HOUR_MS))) {
      return res.status(429).json({ error: "Too many distribution requests. Try again later." });
    }

    const userSnap = await db.collection("users").doc(uid).get();
    const user = userSnap.data();
    const canRun = user?.role === "admin" || user?.crmRole === "manager" || user?.crmCanImport === true;
    if (!canRun) return res.status(403).json({ error: "Distribution access not granted." });

    const { batchId, agentIds, perAgent } = req.body;
    if (typeof batchId !== "string" || !batchId) return res.status(400).json({ error: "batchId required" });
    const agents: string[] = Array.isArray(agentIds)
      ? (agentIds as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    if (agents.length === 0) return res.status(400).json({ error: "Select at least one agent to distribute to." });
    // Optional per-agent cap (e.g. 100). 0 / unset = distribute everything (legacy behaviour).
    const perAgentCap = Number.isFinite(Number(perAgent)) && Number(perAgent) > 0
      ? Math.min(Math.floor(Number(perAgent)), 1000) : undefined;

    // Locate the job by its batchId
    const jobSnap = await db.collection("import_jobs").where("batchId", "==", batchId).limit(1).get();
    if (jobSnap.empty) return res.status(404).json({ error: "Import batch not found." });
    const jobDoc = jobSnap.docs[0];
    const job = jobDoc.data();
    // Re-distribution IS allowed when a batch still holds UNASSIGNED leads (e.g. rows
    // recovered later via "Retry failed rows" land unassigned under an already-
    // distributed batch). distributeBatch only ever touches UNASSIGNED leads, so a
    // re-run on a fully-distributed batch is a harmless no-op. Block only if nothing
    // is left to route.
    if (job.distributed === true && (job.successCount ?? 0) <= (job.distributedCount ?? 0)) {
      return res.status(409).json({ error: "This batch is fully distributed — no unassigned leads left." });
    }

    // Run the distribution within the request so Cloud Run keeps CPU allocated — background work
    // after res.json() gets CPU-throttled and crawls. Now parallelised + per-lead try/catch, so it
    // finishes in seconds even for hundreds of leads. The client's onSnapshot still clears the card
    // when `distributed` flips (set at the end of distributeBatch).
    try {
      await distributeBatch(jobDoc.id, batchId, agents, uid, (job.importName as string) ?? batchId, perAgentCap);
      return res.json({ ok: true, jobId: jobDoc.id });
    } catch (err) {
      console.error(`Distribute batch ${batchId} failed:`, err);
      return res.status(500).json({ error: "Distribution failed — please retry." });
    }
  });

  // ─── POST /api/leads/pull — telecaller self-serve: claim N oldest UNASSIGNED leads ──
  // Active telecallers (lead_convertor/lead_generator) + managers/admins pull a chunk
  // (default 100) of the oldest unassigned imported leads to themselves — oldest-first
  // (FIFO fairness), RACE-SAFE: each claim is a transaction that re-checks the lead is
  // still UNASSIGNED, so two pullers can never grab the same contact.
  app.post("/api/leads/pull", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    if (!(await checkRateLimit(uid, "leads-pull", 60, HOUR_MS))) {
      return res.status(429).json({ error: "Too many pulls. Try again shortly." });
    }
    const userSnap = await db.collection("users").doc(uid).get();
    const u = userSnap.data();
    const eligible = !!u && u.employeeStatus !== "inactive" &&
      (u.role === "admin" || u.crmRole === "manager" || u.crmRole === "lead_convertor" || u.crmRole === "lead_generator");
    if (!eligible) return res.status(403).json({ error: "You don't have permission to pull leads." });

    // HARD cap 100 per pull — a telecaller can never claim more than 100 at a time.
    const reqCount = Number((req.body ?? {}).count);
    const count = Number.isFinite(reqCount) && reqCount > 0 ? Math.min(Math.floor(reqCount), 100) : 100;

    const snap = await db.collection("leads")
      .where("primaryOwnerId", "==", "UNASSIGNED")
      .where("deleted", "==", false)
      .orderBy("createdAt", "asc")     // oldest first
      .limit(count)
      .get();
    if (snap.empty) return res.json({ pulled: 0 });

    const slaMs = 24 * 60 * 60 * 1000;
    const claimed: admin.firestore.DocumentReference[] = [];
    const docs = snap.docs;
    const CONCURRENCY = 25;
    for (let start = 0; start < docs.length; start += CONCURRENCY) {
      await Promise.all(docs.slice(start, start + CONCURRENCY).map(async (d) => {
        try {
          const ok = await db.runTransaction(async (tx) => {
            const fresh = await tx.get(d.ref);
            // Someone else grabbed it between the query and now → skip (race-safe).
            if (!fresh.exists || fresh.data()!.primaryOwnerId !== "UNASSIGNED") return false;
            tx.update(d.ref, {
              primaryOwnerId:           uid,
              assignedToCurrentOwnerAt: admin.firestore.FieldValue.serverTimestamp(),
              slaDeadline:              admin.firestore.Timestamp.fromDate(new Date(Date.now() + slaMs)),
              distributedAt:            admin.firestore.FieldValue.serverTimestamp(),
              updatedAt:                admin.firestore.FieldValue.serverTimestamp(),
            });
            return true;
          });
          if (ok) claimed.push(d.ref);
        } catch (e) { console.error("[leads/pull] claim failed", d.id, e); }
      }));
    }

    // Re-own any open opportunities on the claimed leads + log an activity (best-effort).
    await Promise.all(claimed.map(async (ref) => {
      try {
        const opps = await ref.collection("opportunities").where("status", "==", "open").get();
        if (opps.empty) return;
        const batch = db.batch();
        for (const opp of opps.docs) {
          batch.update(opp.ref, { ownerId: uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          batch.set(opp.ref.collection("activities").doc(), {
            type: "status_change", content: "Pulled from the unassigned pool",
            by: uid, at: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
      } catch (e) { console.error("[leads/pull] opp re-own failed", ref.id, e); }
    }));

    return res.json({ pulled: claimed.length });
  });

  // ─── GET /api/leads/pull/available — how many contacts are waiting in the pool ──
  // Telecallers can't list UNASSIGNED leads (rules block it — they'd see names/phones,
  // a leak), so the COUNT is returned server-side via the Admin SDK. Only a number
  // crosses the wire — never the contacts themselves.
  app.get("/api/leads/pull/available", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const userSnap = await db.collection("users").doc(uid).get();
    const u = userSnap.data();
    const eligible = !!u && u.employeeStatus !== "inactive" &&
      (u.role === "admin" || u.crmRole === "manager" || u.crmRole === "lead_convertor" || u.crmRole === "lead_generator");
    if (!eligible) return res.status(403).json({ error: "Not permitted." });
    try {
      const agg = await db.collection("leads")
        .where("primaryOwnerId", "==", "UNASSIGNED")
        .where("deleted", "==", false)
        .count().get();
      return res.json({ available: agg.data().count });
    } catch (e) {
      console.error("[leads/pull/available]", e);
      return res.json({ available: null });   // count unavailable → UI hides the number, button still works
    }
  });

  // ─── POST /api/leads/check-duplicate — dup check that works for EVERYONE ────────
  // Telecallers can only LIST their own leads (rules), so the client-side phone/PAN
  // dup query is denied for them. This Admin-SDK endpoint checks across ALL leads and
  // returns only a minimal verdict (exists? + the name + is-it-yours) — never another
  // rep's phone/PAN/owner — so duplicates are caught at entry without leaking contacts.
  app.post("/api/leads/check-duplicate", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const userSnap = await db.collection("users").doc(uid).get();
    const u = userSnap.data();
    const ok = !!u && (u.role === "admin" || u.crmAccess === true || !!u.crmRole);
    if (!ok) return res.status(403).json({ error: "Not permitted." });

    const phone  = String((req.body ?? {}).phone ?? "").trim();
    const panRaw = String((req.body ?? {}).panRaw ?? "").trim();
    const firstLive = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) =>
      docs.map((d) => d.data()).find((l) => l.deleted !== true);   // index-free: filter soft-deleted in memory
    try {
      // Compare CANONICAL vs canonical (every lead write stores canonicalPhone).
      // Transition: also query the raw form as typed — leads written before the
      // phone backfill (/api/admin/backfill-phone-normalization) may still hold a
      // raw-formatted phone.
      const phoneForms = [...new Set([canonicalPhone(phone), phone].filter(Boolean))];
      for (const p of phoneForms) {
        const snap = await db.collection("leads").where("phone", "==", p).limit(5).get();
        const hit = firstLive(snap.docs);
        if (hit) return res.json({ duplicate: true, matchType: "exact_phone", name: hit.displayName ?? "a customer", ownedByYou: hit.primaryOwnerId === uid });
      }
      if (panRaw) {
        const snap = await db.collection("leads").where("panRaw", "==", panRaw).limit(5).get();
        const hit = firstLive(snap.docs);
        if (hit) return res.json({ duplicate: true, matchType: "exact_pan", name: hit.displayName ?? "a customer", ownedByYou: hit.primaryOwnerId === uid });
      }
      return res.json({ duplicate: false });
    } catch (e) {
      console.error("[check-duplicate]", e);
      return res.json({ duplicate: false });   // never block the save on a check failure
    }
  });

  // ─── POST /api/admin/backfill-phone-normalization — canonical-phone backfill ────
  // One-time (but safely re-runnable) admin sweep: rewrites every lead's `phone` /
  // `altPhones` to the canonical stored form (see canonicalPhone) so the dedup
  // checks — which compare canonical vs canonical — also catch leads written
  // before canonicalisation shipped. Behaviour:
  //   • IDEMPOTENT — a phone already canonical produces no write; re-running is a
  //     no-op after the first pass.
  //   • The pre-change value is preserved ONCE in the additive field
  //     `phoneOriginal`, only when the phone actually changes; an existing
  //     phoneOriginal is NEVER overwritten (so the true original survives).
  //   • When the phone changes on an imported lead, its `importHash` is recomputed
  //     on the canonical basis (buildImportHash canonicalises internally), so the
  //     import dedup + backfill-extras matching stay aligned.
  //   • Chunked batch writes (≤400/commit), resilient — a failed commit is logged
  //     and the sweep continues.
  // Returns { scanned, changed, skipped, failed }.
  app.post("/api/admin/backfill-phone-normalization", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only." });

    let scanned = 0, changed = 0, failed = 0;
    let batch = db.batch();
    let pending = 0;
    const flush = async () => {
      if (pending === 0) return;
      const n = pending;
      try { await batch.commit(); changed += n; }
      catch (e) { failed += n; console.error("[backfill-phone] batch commit failed", e); }
      batch = db.batch();
      pending = 0;
    };

    try {
      const PAGE = 500;
      let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      for (;;) {
        let q = db.collection("leads")
          .orderBy(admin.firestore.FieldPath.documentId())
          .limit(PAGE);
        if (last) q = q.startAfter(last);
        const snap = await q.get();
        if (snap.empty) break;

        for (const d of snap.docs) {
          scanned++;
          const lead = d.data();
          const update: Record<string, unknown> = {};

          const curPhone = typeof lead.phone === "string" ? lead.phone : "";
          const canon = canonicalPhone(curPhone);
          if (curPhone && canon && canon !== curPhone) {
            update.phone = canon;
            // Preserve the original once — never overwrite an existing phoneOriginal.
            if (lead.phoneOriginal === undefined) update.phoneOriginal = curPhone;
            if (typeof lead.importHash === "string" && typeof lead.displayName === "string") {
              update.importHash = buildImportHash(
                canon,
                typeof lead.email === "string" ? lead.email : "",
                lead.displayName,
              );
            }
          }

          if (Array.isArray(lead.altPhones)) {
            const primary = (update.phone as string | undefined) ?? curPhone;
            const canonAlts = Array.from(new Set(
              (lead.altPhones as unknown[])
                .filter((p): p is string => typeof p === "string")
                .map(canonicalPhone)
                .filter((p) => p && p !== primary),
            ));
            if (JSON.stringify(canonAlts) !== JSON.stringify(lead.altPhones)) {
              update.altPhones = canonAlts;
            }
          }

          if (Object.keys(update).length > 0) {
            batch.update(d.ref, update);
            pending++;
            if (pending >= 400) await flush();
          }
        }

        last = snap.docs[snap.docs.length - 1];
        if (snap.size < PAGE) break;
      }
      await flush();
      return res.json({ scanned, changed, skipped: scanned - changed - failed, failed });
    } catch (e) {
      await flush().catch(() => {});
      console.error("[backfill-phone] sweep failed", e);
      return res.status(500).json({ error: "Backfill failed part-way — safe to re-run.", scanned, changed, failed });
    }
  });
}
