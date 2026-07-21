/**
 * server/lib/webhook.ts - inbound-lead webhook helpers (phone normalize, workload-aware assign, webhook log, processInboundLead), lifted from server.ts
 * (2026-07-21, Phase 3). Closes only over db/admin. Pure move - behavior unchanged.
 */
import { db, admin } from "../db.js";

// Strips +91, spaces, dashes and validates a 10-digit Indian mobile number.
// Returns the normalised 10-digit string or null if invalid.
function normaliseIndianPhone(raw: string): string | null {
  let s = raw.replace(/[\s\-\.\(\)]/g, "");
  if (s.startsWith("+91"))             s = s.slice(3);
  else if (s.startsWith("91") && s.length === 12) s = s.slice(2);
  return /^[6-9]\d{9}$/.test(s) ? s : null;
}

// Assigns the webhook lead to the active lead_generator with the fewest open leads.
// Falls back to 'UNASSIGNED' when no generators are available.
async function workloadAwareAssign(): Promise<string> {
  const snap = await db.collection("users")
    .where("crmRole", "==", "lead_generator")
    .where("crmAccess", "==", true)
    .get();

  // Filter active generators in-memory (avoids composite index on crmRole + crmAccess + employeeStatus)
  const generators = snap.docs
    .filter((d) => (d.data().employeeStatus ?? "active") === "active")
    .map((d) => d.id);

  if (generators.length === 0) return "UNASSIGNED";

  // Count open (non-deleted) leads per generator in parallel — dataset small at ≤25 employees
  const counts = await Promise.all(
    generators.map(async (gid) => {
      const ls = await db.collection("leads")
        .where("primaryOwnerId", "==", gid)
        .limit(500)
        .get();
      const open = ls.docs.filter((d) => d.data().deleted !== true).length;
      return { gid, open };
    })
  );

  counts.sort((a, b) => a.open - b.open);
  return counts[0].gid;
}

// Writes a log entry to /webhook_logs (Admin SDK — bypasses Firestore rules).
async function writeWebhookLog(
  source: "website" | "social_meta",
  result: "success" | "duplicate" | "invalid" | "error",
  leadId: string | null,
  errorMessage: string | null,
  assignedTo: string | null,
): Promise<void> {
  await db.collection("webhook_logs").add({
    source,
    result,
    leadId,
    errorMessage,
    assignedTo,
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((e) => console.error("[webhook_log write failed]", e));
}

// Shared lead-creation logic for website + Meta intake (steps 1–7 from spec).
// Validates, deduplicates, assigns, writes to Firestore and sends an in-app notification.
// Returns { result, leadId, errorMessage, assignedTo } — caller decides HTTP status code.
async function processInboundLead(payload: {
  name:         string;
  phone:        string;
  email?:       string;
  loanProduct?: string;
  loanAmount?:  number;
  city?:        string;
  utmSource?:   string;
  utmCampaign?: string;
  formId?:      string;
  source:       "website" | "social_meta";
  metaLeadgenId?: string;
}): Promise<{
  result: "success" | "duplicate" | "invalid" | "error";
  leadId: string | null;
  errorMessage: string | null;
  assignedTo: string | null;
}> {
  const { name, phone, email, loanProduct, loanAmount, source } = payload;

  // Step 1: Validate name
  if (!name || name.trim().length < 2) {
    return { result: "invalid", leadId: null, errorMessage: "name must be at least 2 characters", assignedTo: null };
  }

  // Step 2: Normalise and validate phone
  const normPhone = normaliseIndianPhone(phone ?? "");
  if (!normPhone) {
    return { result: "invalid", leadId: null, errorMessage: `invalid Indian mobile: '${phone}'`, assignedTo: null };
  }

  // Step 3: Duplicate check — match on normalised phone among non-deleted leads
  const dupSnap = await db.collection("leads")
    .where("phone", "==", normPhone)
    .where("deleted", "==", false)
    .limit(1)
    .get();
  if (!dupSnap.empty) {
    console.log(`[webhook ${source}] Duplicate lead skipped: ${normPhone}`);
    return { result: "duplicate", leadId: dupSnap.docs[0].id, errorMessage: null, assignedTo: null };
  }

  // Step 4: All inbound leads land as UNASSIGNED — admin assigns manually via the CRM tray
  const assignedTo = "UNASSIGNED";

  // Step 5: Create /leads doc
  // SLA: 30 minutes for website/social_meta leads
  const slaDeadline = new Date(Date.now() + 30 * 60 * 1000);
  const leadRef = db.collection("leads").doc();
  const leadData: Record<string, unknown> = {
    displayName:      name.trim(),
    phone:            normPhone,
    email:            email?.trim() || null,
    source,
    tags:             loanProduct ? [loanProduct] : [],
    primaryOwnerId:   assignedTo,
    consentGiven:     true,
    consentMethod:    "digital",
    consentTimestamp: admin.firestore.FieldValue.serverTimestamp(),
    createdAt:        admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
    createdBy:        `webhook:${source}`,
    deleted:          false,
    slaDeadline:      admin.firestore.Timestamp.fromDate(slaDeadline),
    firstContactedAt: null,   // Stage-2 SLA end — stamped once on first contact
  };
  if (loanAmount)               leadData.loanAmount   = loanAmount;
  if (payload.city?.trim())     leadData.city         = payload.city.trim();
  if (payload.utmSource?.trim()) leadData.utmSource   = payload.utmSource.trim();
  if (payload.utmCampaign?.trim()) leadData.utmCampaign = payload.utmCampaign.trim();
  if (payload.formId?.trim())   leadData.formId       = payload.formId.trim();
  if (payload.metaLeadgenId)    leadData.metaLeadgenId = payload.metaLeadgenId;

  await leadRef.set(leadData);

  // Step 6: Write in-app notification to assigned generator (fire-and-forget)
  if (assignedTo !== "UNASSIGNED") {
    db.collection("notifications").doc(assignedTo).collection("items").add({
      type:        "new_lead",
      source,
      leadId:      leadRef.id,
      leadName:    name.trim(),
      slaDeadline: admin.firestore.Timestamp.fromDate(slaDeadline),
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      read:        false,
    }).catch((e) => console.error("[notification write failed]", e));
  }

  return { result: "success", leadId: leadRef.id, errorMessage: null, assignedTo };
}

export { normaliseIndianPhone, workloadAwareAssign, writeWebhookLog, processInboundLead };
