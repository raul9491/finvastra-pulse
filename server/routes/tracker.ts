/**
 * server/routes/tracker.ts - public application tracker (status by token) + tracker-token issue, lifted from server.ts
 * (2026-07-21, Phase 3 route split). Registered via registerTrackerRoutes(app); imports its
 * helpers directly from server/lib/* + ../db.js.
 */
import express from "express";
import crypto from "crypto";
import { db, admin } from "../db.js";
import {
  verifyFirebaseToken,
} from "../lib/auth.js";

export function registerTrackerRoutes(app: express.Express): void {
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
}
