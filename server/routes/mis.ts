/**
 * server/routes/mis.ts - MIS statement upload/process/lines (CSV reconciliation), lifted from server.ts
 * (2026-07-21, Phase 3 route split). Registered via registerMisRoutes(app); imports its
 * helpers directly from server/lib/* + ../db.js.
 */
import express from "express";
import { db, admin } from "../db.js";
import {
  HOUR_MS,
  checkRateLimit,
  verifyFirebaseToken,
} from "../lib/auth.js";
import {
  _stagedParsedData,
  cleanStagedData,
  detectColumns,
  parseAmount,
  parseCsvLine,
  parseFlexibleDate,
} from "../lib/mis.js";

export function registerMisRoutes(app: express.Express): void {

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
}
