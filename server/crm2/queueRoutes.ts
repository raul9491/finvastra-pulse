/**
 * server/crm2/queueRoutes.ts - the FIFO pull-queue work model for warm inbound
 * CRM 2.0 leads (ADS + website).
 *
 * claim = oldest unassigned lead in the caller's eligible queues, claimed in a
 * Firestore TRANSACTION (re-read in-tx, so two concurrent claims never collide -
 * proven by qa:queue). release returns it to the pool preserving receivedAt.
 * state = per-queue depth + oldest working-age + Stage-1 SLA countdown, for the
 * manager monitor.
 *
 * Extracted verbatim from server/crm2.ts (2026-07-23); only the dedent and
 * registerQueueRoutes(app, deps).
 *
 * CONTEXT THREADING: loadSlaConfig + loadBusinessHours are PASSED IN, not
 * duplicated - they are shared with the SLA sweep job that still lives in crm2.ts
 * and both read app_config docs. Same pattern as whatsapp's requireSchedulerOrAdmin.
 */
import type express from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../db.js';
import { route, ApiError, optStr, isStr, reqStr } from './core.js';
import { requirePerm, updateAudit, getCallerMeta } from './context.js';
import {
  queueConfigFromDoc, eligibleQueues, leadEligibleForSkills, queueForLead,
  isQueueableLead, type QueueDef,
} from '../../src/lib/crm2/queue.js';
import { toMs, type SlaConfig } from '../../src/lib/crm2/sla.js';
import { elapsedWorkingMs, type BusinessHoursConfig } from '../../src/lib/crm2/businessHours.js';
import { leadName } from '../../src/lib/crm2/leadModel.js';

export function registerQueueRoutes(
  app: express.Express,
  loadSlaConfig: () => Promise<SlaConfig>,
  loadBusinessHours: () => Promise<BusinessHoursConfig>,
  // Threaded in: both are registerCrm2Routes-local (notify closes over the
  // injected sendBrandedEmail); the release escalation path uses them.
  resolveEscalationUids: () => Promise<string[]>,
  notify: (uid: string, payload: Record<string, unknown>) => Promise<void>,
): void {
  // ═══ FIFO pull-queue work model ═══════════════════════════════════════════════
  // Warm-inbound CRM 2.0 leads (ADS + website) sit unassigned, oldest-first. A free
  // telecaller pulls the FRONT of the line (serve-don't-browse); the claim stamps
  // owner + assignedAt in a TRANSACTION so two concurrent claims never grab the same
  // lead. Sits on top of the SLA engine — Stage 1 now measures time-in-queue.

  async function loadQueues(): Promise<QueueDef[]> {
    const snap = await db.collection("app_config").doc("queues").get();
    return queueConfigFromDoc(snap.exists ? (snap.data() as Record<string, unknown>) : null);
  }
  async function callerQueueSkills(uid: string): Promise<string[]> {
    const u = (await db.collection("users").doc(uid).get()).data();
    const s = u?.queueSkills;
    return Array.isArray(s) ? (s as unknown[]).filter((x) => isStr(x)).map(String) : [];
  }
  const CRM2_TERMINAL_STATUS = new Set(["NOT_INTERESTED", "NOT_ELIGIBLE", "JUNK_DUPLICATE", "DROPPED", "CONVERTED"]);
  // An unassigned, non-terminal, warm-inbound CRM 2.0 lead waiting in the queue.
  function isWaiting(d: Record<string, unknown>): boolean {
    return d.assignedRm == null && d.converted !== true
      && !CRM2_TERMINAL_STATUS.has(String(d.status ?? "")) && isQueueableLead(d);
  }

  // POST /api/crm2/queue/claim — pull the oldest eligible waiting lead (FIFO by
  // receivedAt) and claim it atomically. Assigns to the CALLER (self-serve).
  app.post("/api/crm2/queue/claim", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.leads.write");
    if (!caller) return;
    const [queues, skills] = await Promise.all([loadQueues(), callerQueueSkills(caller.uid)]);
    if (eligibleQueues(queues, skills).length === 0) { res.json({ ok: true, lead: null, reason: "no eligible queues" }); return; }

    // Oldest unassigned CRM 2.0 leads first; filter to eligible + waiting in memory.
    const snap = await db.collection("leads")
      .where("assignedRm", "==", null).where("converted", "==", false)
      .orderBy("receivedAt", "asc").limit(50).get();

    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (!isWaiting(d) || !leadEligibleForSkills(queues, skills, d)) continue;
      // Atomic claim: only succeeds if still unassigned (loser falls through to next).
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        const fd = fresh.data();
        if (!fd || fd.assignedRm != null) return false;
        tx.update(doc.ref, {
          assignedRm: caller.fapl, assignedAt: FieldValue.serverTimestamp(),
          status: "ASSIGNED", queueClaimedAt: FieldValue.serverTimestamp(),
          ...updateAudit(caller.fapl),
        });
        return true;
      });
      if (claimed) { res.json({ ok: true, lead: { id: doc.id, ...(await doc.ref.get()).data() } }); return; }
    }
    res.json({ ok: true, lead: null, reason: "queue empty" });
  }));

  // POST /api/crm2/queue/release — return a claimed lead to the queue. Preserves
  // receivedAt (captureAt) so an aging lead keeps its place; bumps releaseCount;
  // flags for the manager at >= 3.
  app.post("/api/crm2/queue/release", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.leads.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const leadId = reqStr(b, "leadId");
    const reason = optStr(b, "reason");
    const ref = db.collection("leads").doc(leadId);
    const meta = await getCallerMeta(caller.uid);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new ApiError(404, `${leadId} not found`);
      const d = snap.data() as Record<string, unknown>;
      // Owner (current assignee) or a manager/admin may release.
      if (!(meta.isAdmin || meta.isManager || d.assignedRm === caller.fapl)) {
        throw new ApiError(403, "Only the lead's owner or a manager can release it");
      }
      if (d.assignedRm == null) throw new ApiError(400, "Lead is already in the queue");
      const releaseCount = ((d.releaseCount as number | undefined) ?? 0) + 1;
      tx.update(ref, {
        assignedRm: null, assignedAt: null, status: "QUEUED",   // receivedAt UNCHANGED → keeps its place
        releaseCount, lastReleaseReason: reason ?? null,
        ...(releaseCount >= 3 ? { queueFlagged: true } : {}),
        ...updateAudit(caller.fapl),
      });
      return { releaseCount, flagged: releaseCount >= 3, name: leadName(d) };
    });

    if (result.flagged) {
      // Flag the manager: the lead has bounced too many times.
      const targets = await resolveEscalationUids();
      for (const uid of targets) {
        await notify(uid, {
          type: "queue_flag", title: `Lead released ${result.releaseCount}×: ${result.name}`,
          body: `Bounced back to the queue ${result.releaseCount} times — needs manager attention.`,
          link: "/crm/pipeline/leads",
        });
      }
    }
    res.json({ ok: true, releaseCount: result.releaseCount, flagged: result.flagged });
  }));

  // GET /api/crm2/queue/state — per-queue depth, oldest-lead age, SLA countdown, and
  // active telecallers (claimed-but-uncontacted). For ~10s client polling.
  app.get("/api/crm2/queue/state", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.leads.read");
    if (!caller) return;
    const [queues, cfg, bh] = await Promise.all([loadQueues(), loadSlaConfig(), loadBusinessHours()]);
    const nowMs = Date.now();

    // All waiting (unassigned) warm leads, oldest first → bucket by queue.
    const waitingSnap = await db.collection("leads")
      .where("assignedRm", "==", null).where("converted", "==", false)
      .orderBy("receivedAt", "asc").limit(500).get();
    const waiting = waitingSnap.docs.map((d) => ({ id: d.id, d: d.data() as Record<string, unknown> }))
      .filter((x) => isWaiting(x.d));

    const queueState = queues.map((q) => {
      const inQ = waiting.filter((x) => queueForLead(queues, x.d)?.id === q.id);
      const oldest = inQ[0];
      let oldestAgeMs = 0, oldestWallMs = 0, slaCountdownMs: number | null = null;
      if (oldest) {
        const capMs = toMs(oldest.d.receivedAt);
        if (capMs != null) {
          oldestWallMs = nowMs - capMs;
          oldestAgeMs = elapsedWorkingMs(capMs, nowMs, bh);
          slaCountdownMs = cfg.WARM.stage1Ms - oldestAgeMs;   // <0 = breached
        }
      }
      return { id: q.id, name: q.name, depth: inQ.length, oldestLeadId: oldest?.id ?? null,
        oldestWorkingAgeMs: oldestAgeMs, oldestWallAgeMs: oldestWallMs, slaCountdownMs };
    });

    // Active telecallers: assigned + not yet contacted (claimed, working).
    const activeSnap = await db.collection("leads")
      .where("firstContactedAt", "==", null).where("converted", "==", false)
      .limit(500).get();
    const byRm = new Map<string, number>();
    for (const doc of activeSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (d.assignedRm != null && isQueueableLead(d) && !CRM2_TERMINAL_STATUS.has(String(d.status ?? ""))) {
        const rm = String(d.assignedRm);
        byRm.set(rm, (byRm.get(rm) ?? 0) + 1);
      }
    }
    const activeTelecallers = [...byRm.entries()].map(([fapl, openClaims]) => ({ fapl, openClaims }));

    res.json({ ok: true, queues: queueState, totalWaiting: waiting.length, activeTelecallers });
  }));
}
