/**
 * server/lib/scorecard.ts - RM monthly scorecard PDF build + email delivery,
 * lifted from server.ts (2026-07-21, Phase 3). Uses jspdf (dynamic import),
 * getStorage, the perf actuals + branded-email helpers, and the shared inr.
 */
import { getStorage } from "firebase-admin/storage";
import { db, admin } from "../db.js";
import { inrRound as inr } from "../../src/lib/money.js";
import { computeActualsServer } from "./perf.js";
import { buildBrandEmail, sendGmailWithAttachment } from "./email.js";

// ─── PART 5 — RM monthly scorecard PDF ───────────────────────────────────────
export async function generateAndDeliverScorecard(uid: string, period: string, generatedBy: string): Promise<{ storageUrl: string }> {
  const STORAGE_BUCKET = "gen-lang-client-0643641184.firebasestorage.app";
  const userDoc = await db.collection("users").doc(uid).get();
  const u: any = userDoc.data() ?? {};
  const empCode = u.empCode ?? u.employeeCode ?? uid;
  const rmName = u.displayName ?? uid;
  const designation = u.designation ?? "";
  const target: any = (await db.collection("rm_targets").doc(`${uid}_${period}`).get()).data();
  const actuals = await computeActualsServer(uid, period);

  // Pipeline snapshot (open opps for this RM)
  const oppsSnap = await db.collectionGroup("opportunities").where("status", "==", "open").get();
  const mine = oppsSnap.docs.filter((d) => (d.data() as any).ownerId === uid);
  const pipeline: Array<{ name: string; product: string; stage: string; value: number }> = [];
  for (const d of mine.slice(0, 30)) {
    const o: any = d.data(); const leadRef = d.ref.parent.parent;
    let name = "Lead";
    if (leadRef) { try { const ls = await leadRef.get(); name = (ls.data() as any)?.displayName ?? "Lead"; } catch { /* ignore */ } }
    pipeline.push({ name, product: o.product ?? "—", stage: o.stage ?? "—", value: Number(o.dealSize ?? 0) });
  }
  pipeline.sort((a, b) => b.value - a.value);

  // Activity summary (best-effort — needs a collection-group index on activities.by)
  let calls = 0, meetings = 0, leadsAdded = actuals.newLeads;
  try {
    const startMs = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1).getTime();
    const actSnap = await db.collectionGroup("activities").where("by", "==", uid).get();
    actSnap.forEach((d) => { const a: any = d.data(); const ms = a.at?.toMillis ? a.at.toMillis() : 0; if (ms >= startMs) { if (a.type === "call") calls++; if (a.type === "meeting") meetings++; } });
  } catch { /* index missing — leave zeros */ }

  // Metrics
  const metrics = [
    { label: "New Leads", target: target?.targets?.newLeads ?? 0, actual: actuals.newLeads, money: false },
    { label: "Conversions", target: target?.targets?.leadsConverted ?? 0, actual: actuals.leadsConverted, money: false },
    { label: "Disbursals", target: target?.targets?.disbursalAmount ?? 0, actual: actuals.disbursalAmount, money: true },
    { label: "Commission", target: target?.targets?.commissionGenerated ?? 0, actual: actuals.commissionGenerated, money: true },
  ];
  const pct = (a: number, t: number) => (t > 0 ? Math.min(100, Math.round((a / t) * 100)) : 0);
  const overall = Math.round(metrics.reduce((s, m) => s + pct(m.actual, m.target), 0) / metrics.length);

  // Build PDF
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default as any;
  const docp: any = new jsPDF();
  docp.setFillColor(11, 21, 56); docp.rect(0, 0, 210, 30, "F");
  docp.setTextColor(201, 169, 97); docp.setFontSize(16); docp.setFont("helvetica", "bold");
  docp.text("FINVASTRA ADVISORS PVT. LTD.", 14, 14);
  docp.setTextColor(255, 255, 255); docp.setFontSize(10); docp.setFont("helvetica", "normal");
  docp.text(`RM Performance Scorecard — ${period}`, 14, 22);

  docp.setTextColor(10, 10, 10); docp.setFontSize(12); docp.setFont("helvetica", "bold");
  docp.text(rmName, 14, 42);
  docp.setFontSize(9); docp.setFont("helvetica", "normal"); docp.setTextColor(90, 90, 90);
  docp.text(`${designation || "RM"}  ·  Emp ${empCode}  ·  Period ${period}`, 14, 48);
  docp.setFontSize(11); docp.setTextColor(11, 21, 56); docp.setFont("helvetica", "bold");
  docp.text(`Overall achievement: ${overall}%`, 14, 57);

  autoTable(docp, {
    startY: 64,
    head: [["Metric", "Target", "Actual", "Achievement %"]],
    body: metrics.map((m) => [m.label, m.money ? inr(m.target) : String(m.target), m.money ? inr(m.actual) : String(m.actual), `${pct(m.actual, m.target)}%`]),
    headStyles: { fillColor: [11, 21, 56], textColor: [201, 169, 97] },
    didParseCell: (data: any) => {
      if (data.section === "body" && data.column.index === 3) {
        const p = pct(metrics[data.row.index].actual, metrics[data.row.index].target);
        data.cell.styles.textColor = p >= 100 ? [16, 122, 81] : p >= 75 ? [180, 130, 20] : [200, 50, 50];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  let y = (docp.lastAutoTable?.finalY ?? 90) + 10;
  docp.setFontSize(11); docp.setTextColor(11, 21, 56); docp.setFont("helvetica", "bold");
  docp.text("Pipeline snapshot (open)", 14, y); y += 2;
  autoTable(docp, {
    startY: y + 2,
    head: [["Deal", "Product", "Stage", "Value"]],
    body: pipeline.slice(0, 10).map((p) => [p.name, p.product, p.stage, inr(p.value)]),
    headStyles: { fillColor: [27, 42, 78], textColor: [255, 255, 255] },
    styles: { fontSize: 8 },
  });

  y = (docp.lastAutoTable?.finalY ?? y + 20) + 10;
  docp.setFontSize(11); docp.setTextColor(11, 21, 56); docp.setFont("helvetica", "bold");
  docp.text("Activity summary", 14, y);
  docp.setFontSize(9); docp.setFont("helvetica", "normal"); docp.setTextColor(60, 60, 60);
  docp.text(`Calls logged: ${calls}    Meetings: ${meetings}    Leads added: ${leadsAdded}`, 14, y + 7);

  docp.setFontSize(8); docp.setTextColor(140, 140, 140);
  docp.text(`Generated by Finvastra Pulse on ${new Date().toISOString().slice(0, 10)}`, 14, 285);

  const buf = Buffer.from(docp.output("arraybuffer"));
  const filename = `Scorecard_${empCode}_${period}.pdf`;
  const filePath = `scorecards/${uid}/${filename}`;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await getStorage().bucket(STORAGE_BUCKET).file(filePath).save(buf, {
    metadata: { contentType: "application/pdf", metadata: { firebaseStorageDownloadTokens: token } },
  });
  const storageUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;

  const b64 = buf.toString("base64");
  const html = buildBrandEmail({
    title: `Performance Scorecard — ${period}`,
    intro: `Hi ${rmName}, your monthly scorecard is attached. Overall achievement: ${overall}%.`,
    rows: metrics.map((m) => ({ label: m.label, value: `${m.money ? inr(m.actual) : m.actual} / ${m.money ? inr(m.target) : m.target} (${pct(m.actual, m.target)}%)` })),
    ctaLabel: "Open Targets", ctaLink: "https://pulse.finvastra.com/crm/targets",
  });
  const authUser = await admin.auth().getUser(uid).catch(() => null);
  if (authUser?.email) await sendGmailWithAttachment(authUser.email, `Your Finvastra Scorecard — ${period}`, html, { filename, base64: b64 }).catch(() => {});
  await sendGmailWithAttachment("rahulv@finvastra.com", `Scorecard — ${rmName} — ${period}`, html, { filename, base64: b64 }).catch(() => {});

  await db.collection("scorecard_logs").add({ rmId: uid, period, storageUrl, sentAt: admin.firestore.FieldValue.serverTimestamp(), generatedBy });
  return { storageUrl };
}
