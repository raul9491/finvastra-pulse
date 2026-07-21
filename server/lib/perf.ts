/**
 * server/lib/perf.ts - CRM performance/aggregation helpers, lifted from server.ts
 * (2026-07-21, Phase 3). One-pass per-person accumulation (accumulatePerf) shared
 * by team-summary + all-teams so the views can never drift, plus computeDownline,
 * computeActualsServer, the elevated/active-RM predicates, sumTeamTotals, and the
 * 45s in-process response cache (cachedJson). Reads BOTH lead models via the
 * shared leadModel normalizer. Pure move - behavior unchanged.
 */
import type express from "express";
import { db, admin } from "../db.js";
import { verifyFirebaseToken, verifySchedulerOIDC, isSuperAdmin, SUPER_ADMIN_UIDS_LIST } from "./auth.js";
import { isCrm2Lead, isLeadDeleted, isLeadTerminal, leadBucket, leadOwner, leadName, leadMobile, leadCreatedMs, leadAttempted } from "../../src/lib/crm2/leadModel.js";

// Live actuals from existing Firestore (Admin SDK) — mirrors useRmTargets.computeActuals.
async function computeActualsServer(uid: string, period: string) {
  const startMs = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1).getTime();
  const leadsSnap = await db.collection("leads").where("primaryOwnerId", "==", uid).where("deleted", "==", false).get();
  let newLeads = 0;
  leadsSnap.forEach((d) => { const c: any = d.get("createdAt"); const ms = c?.toMillis ? c.toMillis() : 0; if (ms >= startMs) newLeads++; });
  const wonSnap = await db.collectionGroup("opportunities").where("status", "==", "won").get();
  let leadsConverted = 0;
  wonSnap.forEach((d) => { const o: any = d.data(); if (o.ownerId === uid && typeof o.actualCloseDate === "string" && o.actualCloseDate.startsWith(period)) leadsConverted++; });
  const crSnap = await db.collection("commission_records").where("rmOwnerId", "==", uid).get();
  let disbursalAmount = 0, commissionGenerated = 0;
  crSnap.forEach((d) => {
    const r: any = d.data();
    if (typeof r.disbursalDate === "string" && r.disbursalDate.startsWith(period)) disbursalAmount += Number(r.disbursedAmount ?? 0);
    if (r.status === "paid" && typeof r.actualPayoutDate === "string" && r.actualPayoutDate.startsWith(period)) commissionGenerated += Number(r.actualAmount ?? r.calculatedCommission ?? 0);
  });
  return { newLeads, leadsConverted, disbursalAmount, commissionGenerated };
}

// Latest activity timestamp + type for a lead.
async function latestActivity(leadId: string): Promise<{ atMs: number; type: string }> {
  const s = await db.collection("leads").doc(leadId).collection("activities").orderBy("at", "desc").limit(1).get();
  const a: any = s.docs[0]?.data();
  return { atMs: a?.at?.toMillis ? a.at.toMillis() : 0, type: a?.type ?? "none" };
}

async function requireAdminOrScheduler(req: express.Request, res: express.Response): Promise<boolean> {
  if (await verifySchedulerOIDC(req)) return true;
  const uid = await verifyFirebaseToken(req);
  if (!uid) { res.status(401).json({ error: "Unauthorized" }); return false; }
  const u = await db.collection("users").doc(uid).get();
  if (u.data()?.role !== "admin") { res.status(403).json({ error: "Admin only" }); return false; }
  return true;
}

const activeRmFilter = (u: any) =>
  u.employeeStatus !== "inactive" &&
  (u.role === "admin" || u.crmAccess === true || ["lead_generator", "lead_convertor", "manager"].includes(u.crmRole));

// ─── Team (director) performance — strict downline via reportingManagerUid ────
// Set of all descendant uids of a manager (transitive org tree, excludes self).
function computeDownline(users: Array<{ uid: string; reportingManagerUid?: string }>, managerUid: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const u of users) {
    const mgr = u.reportingManagerUid;
    if (mgr) { if (!childrenOf.has(mgr)) childrenOf.set(mgr, []); childrenOf.get(mgr)!.push(u.uid); }
  }
  const team = new Set<string>();
  const stack = [...(childrenOf.get(managerUid) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (team.has(id) || id === managerUid) continue;
    team.add(id);
    for (const c of (childrenOf.get(id) ?? [])) stack.push(c);
  }
  return team;
}

// Elevated = platform admin, CRM manager, or super admin. These people may LEAD
// a team, but must never appear INSIDE another manager's team roll-up — a manager
// must not see another manager's / a director's numbers. This is the metrics-layer
// guardrail; the same rule is enforced at assignment time (employee endpoints +
// the add-to-team / reporting-manager pickers).
const isElevatedUser = (u: any) =>
  !!u && (u.role === "admin" || u.crmRole === "manager" || SUPER_ADMIN_UIDS_LIST.includes(u.uid));

const EMPTY_TEAM_TOTALS = { leads: 0, openOpps: 0, pipelineValue: 0, disbursalAmount: 0, target: 0, overdueSla: 0, dueCallbacks: 0 };
const periodStartMs = (period: string) => new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1).getTime();
const sumTeamTotals = (rows: any[]) => rows.reduce((t, a) => ({
  leads: t.leads + a.leads, openOpps: t.openOpps + a.openOpps, pipelineValue: t.pipelineValue + a.pipelineValue,
  disbursalAmount: t.disbursalAmount + a.disbursalAmount, target: t.target + a.target,
  overdueSla: t.overdueSla + a.overdueSla, dueCallbacks: t.dueCallbacks + a.dueCallbacks,
}), { ...EMPTY_TEAM_TOTALS });

// One-pass accumulation of per-person CRM performance for a period (YYYY-MM).
// Shared by computeTeamSummary (one head + their team) and the all-teams overview,
// so the two views can never drift. Pure aggregation via Admin SDK.
async function accumulatePerf(people: any[], period: string) {
  const startMs = periodStartMs(period);
  const nowMs = Date.now();
  const [leadsSnap, openSnap, crSnap, targetsSnap] = await Promise.all([
    db.collection("leads").get(),   // deleted filtered in-memory (CRM 2.0 leads omit the field)
    db.collectionGroup("opportunities").where("status", "==", "open").get(),
    db.collection("commission_records").get(),
    db.collection("rm_targets").where("period", "==", period).get(),
  ]);

  const acc = new Map<string, any>();
  for (const m of people) acc.set(m.uid, {
    uid: m.uid, name: m.displayName ?? "—", designation: m.designation ?? "", crmRole: m.crmRole ?? null,
    leads: 0, newLeads: 0, openOpps: 0, pipelineValue: 0, disbursalAmount: 0, commission: 0,
    target: 0, achievementPct: 0, overdueSla: 0, dueCallbacks: 0,
    // Per-person lead-status breakdown — what each rep's customers answered, so
    // a manager can see status at a glance before deciding any manual reassign.
    status: { new: 0, interested: 0, callback: 0, not_interested: 0, no_response: 0, wrong_number: 0, not_eligible: 0, converted: 0 } as Record<string, number>,
    // Tagged→attempted funnel: attempted = firstContactedAt stamped (first call/
    // attempt logged); untouched = still status 'new' AND never contacted — the
    // "data given but not worked" signal managers need at a glance.
    attempted: 0, untouched: 0,
    lastActivityMs: 0,
  });

  const callbacks: any[] = [];
  const slaBreaches: any[] = [];

  // Resolve a CRM 2.0 lead's assignedRm (FAPL-xxx) → that person's accumulator.
  const byFapl = new Map<string, any>();
  for (const m of people) if (m.employeeId) byFapl.set(m.employeeId, acc.get(m.uid));

  // ALL lead reads go through leadModel — ONE source of truth for both models
  // (owner uid-vs-FAPL, status bucket, deleted, timestamps). See src/lib/crm2/leadModel.ts.
  leadsSnap.forEach((d) => {
    const l: any = d.data();
    if (isLeadDeleted(l)) return;                      // deleted filtered in-memory (query fetches all)
    const owner = leadOwner(l);                        // {kind:'fapl'|'uid', value}
    const a = owner.kind === "fapl" ? byFapl.get(owner.value ?? "") : acc.get(owner.value ?? "");
    if (!a) return;                                    // unassigned / not in this team

    const bucket = leadBucket(l);
    a.leads++;
    a.status[bucket] = (a.status[bucket] ?? 0) + 1;
    if (leadAttempted(l)) a.attempted++;
    else if (bucket === "new") a.untouched++;
    const uMs = l.updatedAt?.toMillis ? l.updatedAt.toMillis() : 0;
    if (uMs > a.lastActivityMs) a.lastActivityMs = uMs;
    if (leadCreatedMs(l) >= startMs) a.newLeads++;

    // Callback + SLA-deadline are OLD-MODEL signals (CRM 2.0 has its own SLA
    // engine + queue). Only old-model customers contribute to these.
    if (!isCrm2Lead(l)) {
      if (l.leadStatus === "callback" && typeof l.callbackAt === "string" && new Date(l.callbackAt).getTime() <= nowMs) {
        a.dueCallbacks++;
        callbacks.push({ leadId: d.id, name: leadName(l), phone: leadMobile(l) ?? "", ownerName: a.name, callbackAt: l.callbackAt });
      }
      const slaMs = l.slaDeadline?.toMillis ? l.slaDeadline.toMillis() : (typeof l.slaDeadline === "string" ? new Date(l.slaDeadline).getTime() : 0);
      if (!isLeadTerminal(l) && slaMs && slaMs < nowMs) {
        a.overdueSla++;
        slaBreaches.push({ leadId: d.id, name: leadName(l), phone: leadMobile(l) ?? "", ownerName: a.name, slaDeadlineMs: slaMs });
      }
    }
  });
  openSnap.forEach((d) => {
    const o: any = d.data();
    const a = acc.get(o.ownerId); if (!a) return;
    a.openOpps++; a.pipelineValue += Number(o.dealSize ?? 0);
  });
  crSnap.forEach((d) => {
    const r: any = d.data();
    const a = acc.get(r.rmOwnerId); if (!a) return;
    if (typeof r.disbursalDate === "string" && r.disbursalDate.startsWith(period)) a.disbursalAmount += Number(r.disbursedAmount ?? 0);
    if (r.status === "paid" && typeof r.actualPayoutDate === "string" && r.actualPayoutDate.startsWith(period)) a.commission += Number(r.actualAmount ?? r.calculatedCommission ?? 0);
  });
  targetsSnap.forEach((d) => {
    const t: any = d.data();
    const a = acc.get(t.rmId); if (!a) return;
    a.target = Number(t.targets?.disbursalAmount ?? 0);
  });

  // Coaching metrics (deterministic): conversion %, days since last activity.
  const rows = [...acc.values()].map((a) => ({
    ...a,
    achievementPct: a.target > 0 ? Math.min(100, Math.round((a.disbursalAmount / a.target) * 100)) : 0,
    conversionRate: a.leads > 0 ? Math.round((a.status.converted / a.leads) * 100) : 0,
    inactiveDays: a.lastActivityMs > 0 ? Math.floor((nowMs - a.lastActivityMs) / 86400000) : null,
  }));
  callbacks.sort((a, b) => new Date(a.callbackAt).getTime() - new Date(b.callbackAt).getTime());
  slaBreaches.sort((a, b) => a.slaDeadlineMs - b.slaDeadlineMs);
  return { rows, callbacks, slaBreaches };
}

// Aggregate a team head's OWN performance (optional) + their AGENT team for a
// period. includeHead=false keeps the weekly-team-digest behaviour unchanged
// (reports only). Members are agents ONLY — elevated users are filtered even if
// a bad reporting link exists, so their numbers can never leak into a team view.
async function computeTeamSummary(managerUid: string, period: string, includeHead = false) {
  const usersSnap = await db.collection("users").get();
  const users = usersSnap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
  const byUid = new Map(users.map((u) => [u.uid, u]));
  const teamSet = computeDownline(users, managerUid);
  const members = [...teamSet].map((id) => byUid.get(id))
    .filter((u: any) => u && u.employeeStatus !== "inactive" && !isElevatedUser(u));
  const headUser = includeHead ? byUid.get(managerUid) : undefined;
  const people = headUser ? [headUser, ...members] : members;

  if (people.length === 0) {
    return { head: null, members: [], totals: { ...EMPTY_TEAM_TOTALS }, actionNeeded: { callbacks: [], slaBreaches: [] }, period };
  }

  const { rows, callbacks, slaBreaches } = await accumulatePerf(people, period);

  // Contact touches this period (call/whatsapp/email/meeting activities) — the
  // "how much outreach is this person doing" coaching signal. Best-effort; uses
  // the existing activities (by, at) collection-group index (same as scorecards).
  const startMs = periodStartMs(period);
  await Promise.all(rows.map(async (r: any) => {
    try {
      const snap = await db.collectionGroup("activities").where("by", "==", r.uid).get();
      let n = 0;
      snap.forEach((d) => {
        const a: any = d.data();
        const atMs = a.at?.toMillis ? a.at.toMillis() : 0;
        if (atMs >= startMs && ["call", "whatsapp", "email", "meeting"].includes(a.type)) n++;
      });
      r.callsLogged = n;
    } catch { r.callsLogged = null; }
  }));

  const headBase = headUser ? rows.find((r: any) => r.uid === managerUid) : undefined;
  const head = headBase ? { ...headBase, isHead: true } : null;
  const memberRows = rows.filter((r: any) => !headUser || r.uid !== managerUid);
  memberRows.sort((x: any, y: any) => y.disbursalAmount - x.disbursalAmount);
  const totals = sumTeamTotals(head ? [head, ...memberRows] : memberRows);
  return { head, members: memberRows, totals, actionNeeded: { callbacks, slaBreaches }, period };
}

// Short in-process cache for the heavy management aggregations (team perf /
// all-teams / import perf). These endpoints scan whole collections per request
// — the source of the "page feels laggy" report. 45s of staleness is fine for
// a management dashboard; ?fresh=1 (the UI's Refresh button + post-action
// reloads) bypasses and repopulates. Per-instance only — Cloud Run typically
// runs one instance at this scale.
const perfCache = new Map<string, { at: number; data: any }>();
const PERF_CACHE_TTL_MS = 45_000;
const cachedJson = async (key: string, fresh: boolean, compute: () => Promise<any>) => {
  const hit = perfCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < PERF_CACHE_TTL_MS) return hit.data;
  const data = await compute();
  perfCache.set(key, { at: Date.now(), data });
  if (perfCache.size > 200) { // bound the map — evict oldest half
    const entries = [...perfCache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < entries.length / 2; i++) perfCache.delete(entries[i][0]);
  }
  return data;
};

export { computeActualsServer, latestActivity, requireAdminOrScheduler, activeRmFilter, computeDownline, isElevatedUser, periodStartMs, sumTeamTotals, accumulatePerf, computeTeamSummary, cachedJson };
