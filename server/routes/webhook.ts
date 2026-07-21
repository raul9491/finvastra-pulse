/**
 * server/routes/webhook.ts - website + Meta + referral lead-intake webhooks + webhook-logs, lifted from server.ts
 * (2026-07-21, Phase 3 route split). Registered via registerWebhookRoutes(app); imports its
 * helpers directly from server/lib/* + ../db.js.
 */
import express from "express";
import crypto from "crypto";
import { db, admin } from "../db.js";
import {
  verifyFirebaseToken,
} from "../lib/auth.js";
import {
  normaliseIndianPhone,
  processInboundLead,
  workloadAwareAssign,
  writeWebhookLog,
} from "../lib/webhook.js";
import { leadName } from "../../src/lib/crm2/leadModel.js";

export function registerWebhookRoutes(app: express.Express): void {
  // ─── Webhook Intake: helpers ────────────────────────────────────────────────────


  // ─── POST /api/leads/intake/website — Website form webhook ────────────────────
  // Called by the Finvastra website contact/enquiry form.
  // Auth: X-Finvastra-Webhook-Secret header must match WEBSITE_WEBHOOK_SECRET env var.
  // Always returns 200 on duplicate so the website doesn't retry unnecessarily.
  app.post("/api/leads/intake/website", async (req, res) => {
    const secret = process.env.WEBSITE_WEBHOOK_SECRET;
    // Constant-time secret comparison (guard undefined + length mismatch first).
    const providedSecret = req.headers["x-finvastra-webhook-secret"];
    const providedSecretStr = typeof providedSecret === "string" ? providedSecret : "";
    let webhookSecretOk = false;
    if (secret && providedSecretStr) {
      const a = Buffer.from(providedSecretStr);
      const b = Buffer.from(secret);
      webhookSecretOk = a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    if (!webhookSecretOk) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { name, phone, email, loanProduct, loanAmount, city, utmSource, utmCampaign, formId } =
      req.body as Record<string, unknown>;

    if (!name || typeof name !== "string") {
      await writeWebhookLog("website", "invalid", null, "name missing", null);
      return res.status(400).json({ error: "name is required" });
    }
    if (!phone || typeof phone !== "string") {
      await writeWebhookLog("website", "invalid", null, "phone missing", null);
      return res.status(400).json({ error: "phone is required" });
    }

    // Kick off processing async — respond quickly, then write Firestore
    res.json({ success: true });

    try {
      const outcome = await processInboundLead({
        name:        String(name),
        phone:       String(phone),
        email:       email   ? String(email)   : undefined,
        loanProduct: loanProduct ? String(loanProduct) : undefined,
        loanAmount:  typeof loanAmount === "number" ? loanAmount : undefined,
        city:        city   ? String(city)   : undefined,
        utmSource:   utmSource   ? String(utmSource)   : undefined,
        utmCampaign: utmCampaign ? String(utmCampaign) : undefined,
        formId:      formId ? String(formId) : undefined,
        source:      "website",
      });
      await writeWebhookLog("website", outcome.result, outcome.leadId, outcome.errorMessage, outcome.assignedTo);
    } catch (e) {
      console.error("[webhook/website] processing error:", e);
      await writeWebhookLog("website", "error", null, String(e), null);
    }
  });

  // ─── GET /api/leads/intake/meta — Meta webhook verification handshake ─────────
  // Meta sends this request when the webhook URL is first configured in Meta Business Suite.
  app.get("/api/leads/intake/meta", (req, res) => {
    const mode      = req.query["hub.mode"];
    const token     = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const secret    = process.env.META_WEBHOOK_SECRET;

    if (mode === "subscribe" && token === secret) {
      console.log("[webhook/meta] Webhook verified by Meta");
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: "Verification failed" });
  });

  // ─── POST /api/leads/intake/meta — Meta Lead Ads webhook intake ───────────────
  // Receives new lead form submissions from Meta Lead Ads.
  // Auth: X-Hub-Signature-256 HMAC verification using META_WEBHOOK_SECRET.
  // Always returns 200 — Meta retries on any non-200 response.
  app.post("/api/leads/intake/meta", async (req, res) => {
    const secret = process.env.META_WEBHOOK_SECRET;

    // HMAC verification — uses rawBody captured by express.json verify option.
    // Fail closed: with no configured secret there is no way to authenticate the
    // caller, so reject rather than processing (and creating leads from) unsigned input.
    if (!secret) {
      console.warn("[webhook/meta] META_WEBHOOK_SECRET not set — rejecting (fail closed)");
      return res.status(403).json({ error: "Webhook not configured" });
    }
    {
      const sig = req.headers["x-hub-signature-256"] as string | undefined;
      const rawBuf = (req as express.Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
      const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBuf).digest("hex");
      if (!sig || sig !== expected) {
        console.warn("[webhook/meta] HMAC mismatch — rejected");
        return res.status(403).json({ error: "Signature mismatch" });
      }
    }

    // Always ACK immediately — Meta retries on non-200
    res.status(200).json({ ok: true });

    // Parse Meta payload structure
    const body = req.body as {
      object?: string;
      entry?: Array<{
        changes?: Array<{
          value?: {
            leadgen_id?: string;
            page_id?:   string;
            form_id?:   string;
            field_data?: Array<{ name: string; values: string[] }>;
          };
        }>;
      }>;
    };

    if (body.object !== "page" || !Array.isArray(body.entry)) {
      await writeWebhookLog("social_meta", "invalid", null, "unexpected payload structure", null);
      return;
    }

    for (const entry of body.entry) {
      for (const change of entry.changes ?? []) {
        const val = change.value;
        if (!val?.field_data) continue;

        // Extract fields — Meta form field names vary; check common variants
        const get = (keys: string[]) => {
          for (const key of keys) {
            const found = val.field_data!.find((f) => f.name.toLowerCase() === key.toLowerCase());
            if (found?.values?.[0]) return found.values[0];
          }
          return undefined;
        };

        const name        = get(["full_name", "name", "first_name"]);
        const phone       = get(["phone_number", "phone", "mobile"]);
        const email       = get(["email"]);
        const loanProduct = get(["loan_type", "product", "loan_product"]);
        const loanAmtRaw  = get(["loan_amount", "amount"]);
        const loanAmount  = loanAmtRaw ? parseFloat(loanAmtRaw.replace(/[^0-9.]/g, "")) || undefined : undefined;

        if (!name || !phone) {
          await writeWebhookLog("social_meta", "invalid", null,
            `missing name or phone in leadgen_id=${val.leadgen_id}`, null);
          continue;
        }

        try {
          const outcome = await processInboundLead({
            name, phone, email,
            loanProduct, loanAmount,
            formId:        val.form_id,
            metaLeadgenId: val.leadgen_id,
            source:        "social_meta",
          });
          await writeWebhookLog("social_meta", outcome.result, outcome.leadId,
            outcome.errorMessage, outcome.assignedTo);
        } catch (e) {
          console.error("[webhook/meta] processing error:", e);
          await writeWebhookLog("social_meta", "error", null, String(e), null);
        }
      }
    }
  });

  // ─── POST /api/leads/referral/submit — Employee referral lead intake ─────────
  //
  // Called by SubmitReferralPage when an HRMS employee submits a referral.
  // Uses workload-aware assignment so the lead lands in a real RM's queue.
  //
  // WHY server-side: the client-side createReferralLead() was setting
  // primaryOwnerId = referrer's own UID (an HRMS employee, not an RM), so leads
  // went nowhere. Server handles assignment correctly.
  //
  // Auth: Firebase ID token in Authorization header.
  // Body: { displayName, phone, email?, productInterest?, notes?, consentMethod }
  app.post("/api/leads/referral/submit", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { displayName, phone, email, productInterest, notes, consentMethod } =
      req.body as Record<string, unknown>;

    // Validate required fields
    if (!displayName || typeof displayName !== "string" || displayName.trim().length < 2) {
      return res.status(400).json({ error: "displayName must be at least 2 characters" });
    }
    if (!phone || typeof phone !== "string") {
      return res.status(400).json({ error: "phone is required" });
    }
    const validConsentMethods = ["verbal", "written", "digital", "offline_collection"];
    if (!consentMethod || !validConsentMethods.includes(String(consentMethod))) {
      return res.status(400).json({ error: "valid consentMethod is required" });
    }

    // Normalise phone
    const normPhone = normaliseIndianPhone(String(phone));
    if (!normPhone) {
      return res.status(400).json({ error: `Invalid Indian mobile number: '${phone}'` });
    }

    // Duplicate check
    const dupSnap = await db.collection("leads")
      .where("phone", "==", normPhone)
      .where("deleted", "==", false)
      .limit(1)
      .get();
    if (!dupSnap.empty) {
      return res.json({ ok: true, duplicate: true, leadId: dupSnap.docs[0].id });
    }

    // Workload-aware assignment to a lead_generator
    const assignedTo = await workloadAwareAssign();

    // SLA: 24 hours for employee referrals
    const slaDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Get referrer's display name for the notification
    let referrerName = "An employee";
    try {
      const referrerSnap = await db.collection("users").doc(uid).get();
      referrerName = referrerSnap.data()?.displayName ?? referrerName;
    } catch { /* non-fatal */ }

    const tags: string[] = productInterest && typeof productInterest === "string" && productInterest.trim()
      ? [productInterest.trim()]
      : [];

    const leadRef = db.collection("leads").doc();
    await leadRef.set({
      displayName:      displayName.trim(),
      phone:            normPhone,
      ...(email && typeof email === "string" && email.trim() ? { email: email.trim() } : {}),
      ...(notes && typeof notes === "string" && notes.trim()  ? { notes: notes.trim() } : {}),
      source:           "employee_referral",
      referredBy:       uid,
      referredByName:   referrerName,
      tags,
      primaryOwnerId:   assignedTo,
      consentGiven:     true,
      consentMethod:    String(consentMethod),
      consentTimestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt:        admin.firestore.FieldValue.serverTimestamp(),
      createdBy:        `referral:${uid}`,
      updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
      deleted:          false,
      slaDeadline:      admin.firestore.Timestamp.fromDate(slaDeadline),
    });

    // Notify the assigned RM (and all generators so anyone can action if RM misses it)
    try {
      const genSnap = await db.collection("users")
        .where("crmRole", "==", "lead_generator")
        .where("crmAccess", "==", true)
        .where("employeeStatus", "==", "active")
        .get();

      if (!genSnap.empty) {
        const batch = db.batch();
        for (const genDoc of genSnap.docs) {
          const notifRef = db.collection("notifications").doc(genDoc.id).collection("items").doc();
          batch.set(notifRef, {
            type:        "new_referral",
            title:       `New referral — ${displayName.trim()}`,
            body:        `Referred by ${referrerName}${tags.length ? ` · ${tags[0]}` : ""}`,
            link:        `/crm/leads/${leadRef.id}`,
            leadId:      leadRef.id,
            leadName:    displayName.trim(),
            submittedBy: referrerName,
            createdAt:   admin.firestore.FieldValue.serverTimestamp(),
            read:        false,
          });
        }
        await batch.commit();
      }
    } catch (e) {
      console.warn("[referral/submit] notification batch failed (non-fatal):", e);
    }

    return res.json({ ok: true, duplicate: false, leadId: leadRef.id, assignedTo });
  });

  // ─── Webhook logs read API ────────────────────────────────────────────────────
  // GET /api/admin/webhook-logs — returns latest 20 entries, admin only.
  // Firestore rules deny client access; this endpoint acts as the proxy.
  app.get("/api/admin/webhook-logs", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

    const snap = await db.collection("webhook_logs")
      .orderBy("receivedAt", "desc")
      .limit(20)
      .get();

    const logs = snap.docs.map((d) => {
      const data = d.data();
      return {
        id:           d.id,
        source:       data.source,
        result:       data.result,
        leadId:       data.leadId,
        errorMessage: data.errorMessage,
        assignedTo:   data.assignedTo,
        receivedAt:   data.receivedAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    return res.json({ logs });
  });
}
