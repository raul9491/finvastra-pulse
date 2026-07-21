/**
 * server/routes/crmPerformance.ts - CRM team/performance + activity/workload/not-eligible/imports-perf read routes, lifted from server.ts
 * (2026-07-21, Phase 3 route split). Registered via registerCrmPerformanceRoutes(app); imports its
 * helpers directly from server/lib/* + ../db.js.
 */
import express from "express";
import { db, admin } from "../db.js";
import {
  isSuperAdmin,
  verifyFirebaseToken,
} from "../lib/auth.js";
import {
  accumulatePerf,
  activeRmFilter,
  cachedJson,
  computeDownline,
  computeTeamSummary,
  isElevatedUser,
  periodStartMs,
  sumTeamTotals,
} from "../lib/perf.js";
import { leadBucket, leadName } from "../../src/lib/crm2/leadModel.js";

export function registerCrmPerformanceRoutes(app: express.Express): void {

  // GET /api/crm/team/performance?period=YYYY-MM[&managerUid=UID][&fresh=1]
  // Everyone gets their OWN numbers (head row) + their agent team (empty team →
  // own numbers only — managers/admins/SAs generate business too). An admin/
  // super-admin may pass ?managerUid to view ANY person's head+team; a non-admin's
  // managerUid param is ignored — they only ever see themselves + their reports.
  app.get("/api/crm/team/performance", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const q = req.query.period;
      const period = typeof q === "string" && /^\d{4}-\d{2}$/.test(q) ? q : new Date().toISOString().slice(0, 7);
      const callerDoc = await db.collection("users").doc(uid).get();
      const callerIsAdmin = callerDoc.data()?.role === "admin" || isSuperAdmin(uid);
      const reqMgr = req.query.managerUid;
      const targetUid = (callerIsAdmin && typeof reqMgr === "string" && reqMgr) ? reqMgr : uid;
      const fresh = req.query.fresh === "1";
      return res.json(await cachedJson(`team:${targetUid}:${period}`, fresh,
        () => computeTeamSummary(targetUid, period, /* includeHead */ true)));
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // GET /api/crm/team/all-teams?period=YYYY-MM — admin/super-admin only.
  // The top-down view: every CRM manager with their OWN numbers (managers generate
  // business too) + their agents' rows + the combined team total, plus agents not
  // assigned to any manager. Single accumulation pass — no N×4 collection reads.
  app.get("/api/crm/team/all-teams", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerDoc = await db.collection("users").doc(uid).get();
      if (callerDoc.data()?.role !== "admin" && !isSuperAdmin(uid)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const q = req.query.period;
      const period = typeof q === "string" && /^\d{4}-\d{2}$/.test(q) ? q : new Date().toISOString().slice(0, 7);
      const fresh = req.query.fresh === "1";
      return res.json(await cachedJson(`allteams:${period}`, fresh, async () => {

      const usersSnap = await db.collection("users").get();
      const users = usersSnap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
      const active = users.filter((u: any) => u.employeeStatus !== "inactive");
      const heads = active.filter((u: any) => u.crmRole === "manager");
      const headSet = new Set(heads.map((h: any) => h.uid));
      const agents = active.filter((u: any) => !isElevatedUser(u) && activeRmFilter(u));

      const { rows } = await accumulatePerf([...heads, ...agents], period);
      const rowBy = new Map(rows.map((r: any) => [r.uid, r]));

      const teams = heads.map((h: any) => {
        const memberRows = agents
          .filter((a: any) => a.reportingManagerUid === h.uid)
          .map((a: any) => rowBy.get(a.uid)).filter(Boolean)
          .sort((x: any, y: any) => y.disbursalAmount - x.disbursalAmount);
        const managerRow = { ...(rowBy.get(h.uid) ?? {}), isHead: true };
        return { manager: managerRow, members: memberRows, totals: sumTeamTotals([managerRow, ...memberRows]) };
      }).sort((a: any, b: any) => b.totals.disbursalAmount - a.totals.disbursalAmount);

      const unassigned = agents
        .filter((a: any) => !a.reportingManagerUid || !headSet.has(a.reportingManagerUid))
        .map((a: any) => rowBy.get(a.uid)).filter(Boolean)
        .sort((x: any, y: any) => y.disbursalAmount - x.disbursalAmount);

      return { teams, unassigned, period };
      }));
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // GET /api/crm/team/all — admin/super-admin only. Lists every manager (a user
  // with ≥1 direct report) so the super admin can pick any team to inspect.
  app.get("/api/crm/team/all", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerDoc = await db.collection("users").doc(uid).get();
      if (callerDoc.data()?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
      const usersSnap = await db.collection("users").get();
      const users = usersSnap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
      const byUid = new Map(users.map((u) => [u.uid, u]));
      const directCount = new Map<string, number>();
      for (const u of users) {
        if (u.employeeStatus === "inactive") continue;
        const mgr = u.reportingManagerUid;
        if (mgr) directCount.set(mgr, (directCount.get(mgr) ?? 0) + 1);
      }
      const managers = [...directCount.entries()]
        .map(([mgrUid, count]) => ({ uid: mgrUid, name: byUid.get(mgrUid)?.displayName ?? "—", memberCount: count }))
        .filter((m) => byUid.has(m.uid))
        .sort((a, b) => a.name.localeCompare(b.name));
      return res.json({ managers });
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // GET /api/crm/imports/performance[?fresh=1] — the "which data worked" view for
  // management. Groups ALL leads by their import (importName, falling back to the
  // batch id; manually-added customers form their own bucket) and reports the
  // tagged → attempted → outcome funnel per import: leads, still-unassigned,
  // attempted, untouched, disposition mix, converted, dead (no-response +
  // not-interested + wrong-number). Auth: admin / CRM manager / crmCanImport.
  app.get("/api/crm/imports/performance", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerDoc = await db.collection("users").doc(uid).get();
      const caller: any = callerDoc.data() ?? {};
      const allowed = caller.role === "admin" || isSuperAdmin(uid) || caller.crmRole === "manager" || caller.crmCanImport === true;
      if (!allowed) return res.status(403).json({ error: "Forbidden" });
      const fresh = req.query.fresh === "1";

      return res.json(await cachedJson("importperf", fresh, async () => {
        const leadsSnap = await db.collection("leads").where("deleted", "==", false).get();
        const groups = new Map<string, any>();
        const groupFor = (key: string, label: string, batchId: string | null) => {
          let g = groups.get(key);
          if (!g) {
            g = {
              key, name: label, batchId, leads: 0, unassigned: 0, attempted: 0, untouched: 0,
              converted: 0, interested: 0, callbackDue: 0, dead: 0,
              status: { new: 0, interested: 0, callback: 0, not_interested: 0, no_response: 0, wrong_number: 0, not_eligible: 0, converted: 0 } as Record<string, number>,
              firstMs: 0, lastMs: 0,
            };
            groups.set(key, g);
          }
          return g;
        };
        const DEAD = new Set(["not_interested", "no_response", "wrong_number", "not_eligible"]);
        leadsSnap.forEach((d) => {
          const l: any = d.data();
          const batchId = typeof l.importBatchId === "string" && l.importBatchId ? l.importBatchId : null;
          const name = typeof l.importName === "string" && l.importName ? l.importName : (batchId ? `Batch ${batchId}` : "Manually added");
          const g = groupFor(batchId ?? "__manual__:" + name, name, batchId);
          g.leads++;
          if (l.primaryOwnerId === "UNASSIGNED" || !l.primaryOwnerId) g.unassigned++;
          const st = (typeof l.leadStatus === "string" && l.leadStatus) ? l.leadStatus : "new";
          g.status[st] = (g.status[st] ?? 0) + 1;
          if (st === "converted") g.converted++;
          if (st === "interested" || st === "callback") g.interested++;
          if (DEAD.has(st)) g.dead++;
          if (l.firstContactedAt) g.attempted++;
          else if (st === "new" && l.primaryOwnerId && l.primaryOwnerId !== "UNASSIGNED") g.untouched++;
          const cMs = l.createdAt?.toMillis ? l.createdAt.toMillis() : 0;
          if (cMs && (!g.firstMs || cMs < g.firstMs)) g.firstMs = cMs;
          if (cMs > g.lastMs) g.lastMs = cMs;
        });
        const imports = [...groups.values()]
          .map((g) => ({
            ...g,
            attemptedPct: g.leads > 0 ? Math.round((g.attempted / g.leads) * 100) : 0,
            deadPct: g.attempted > 0 ? Math.round((g.dead / g.attempted) * 100) : 0,
          }))
          .sort((a, b) => b.lastMs - a.lastMs);
        return { imports, generatedAtMs: Date.now() };
      }));
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // ── Workload — who is handling what RIGHT NOW, across all three entity
  // types (old-model customers, CRM 2.0 leads, cases). One row per person;
  // managers/admins/SAs get the complete roster + the unassigned bucket.
  app.get("/api/crm/workload", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerDoc = await db.collection("users").doc(uid).get();
      const caller: any = callerDoc.data() ?? {};
      const allowed = caller.role === "admin" || isSuperAdmin(uid) || caller.crmRole === "manager";
      if (!allowed) return res.status(403).json({ error: "Forbidden" });
      const fresh = req.query.fresh === "1";

      return res.json(await cachedJson("workload", fresh, async () => {
        const [leadsSnap, casesSnap, usersSnap] = await Promise.all([
          db.collection("leads").get(),
          db.collection("cases").get(),
          db.collection("users").get(),
        ]);
        // "Open" definitions — mirrors the app's terminal sets.
        const OLD_CLOSED = new Set(["not_interested", "no_response", "wrong_number", "not_eligible", "converted"]);
        const CRM2_TERMINAL = new Set(["NOT_INTERESTED", "NOT_ELIGIBLE", "JUNK_DUPLICATE", "DROPPED", "CONVERTED"]);
        const CASE_DONE = new Set(["COMPLETED", "CLOSED"]);

        const byUid = new Map<string, { customers: number }>();
        const byFapl = new Map<string, { leads: number; cases: number; shared: number }>();
        const bump = <K, T extends Record<string, number>>(m: Map<K, T>, k: K, blank: T, f: keyof T) => {
          const cur = m.get(k) ?? { ...blank };
          (cur[f] as number)++;
          m.set(k, cur);
        };
        const unassigned = { customers: 0, leads: 0, cases: 0 };

        for (const d of leadsSnap.docs) {
          const l: any = d.data();
          if (l.receivedAt != null) {
            // CRM 2.0 lead
            if (l.converted === true || CRM2_TERMINAL.has(String(l.status ?? ""))) continue;
            if (typeof l.assignedRm === "string" && l.assignedRm) bump(byFapl, l.assignedRm, { leads: 0, cases: 0, shared: 0 }, "leads");
            else unassigned.leads++;
          } else {
            // old-model customer
            if (l.deleted === true) continue;
            if (OLD_CLOSED.has(String(l.leadStatus ?? ""))) continue;
            const owner = l.primaryOwnerId;
            if (typeof owner === "string" && owner && owner !== "UNASSIGNED") bump(byUid, owner, { customers: 0 }, "customers");
            else unassigned.customers++;
          }
        }
        for (const d of casesSnap.docs) {
          const c: any = d.data();
          if (CASE_DONE.has(String(c.stage ?? ""))) continue;
          if (typeof c.handlingRm === "string" && c.handlingRm) bump(byFapl, c.handlingRm, { leads: 0, cases: 0, shared: 0 }, "cases");
          else unassigned.cases++;
          for (const col of (Array.isArray(c.collaborators) ? c.collaborators : [])) {
            if (typeof col === "string" && col) bump(byFapl, col, { leads: 0, cases: 0, shared: 0 }, "shared");
          }
        }

        const rows: any[] = [];
        let idle = 0;
        for (const d of usersSnap.docs) {
          const u: any = d.data();
          if (u.employeeStatus === "inactive") continue;
          const own = byUid.get(d.id) ?? { customers: 0 };
          const fap = (u.employeeId && byFapl.get(u.employeeId)) || { leads: 0, cases: 0, shared: 0 };
          const total = own.customers + fap.leads + fap.cases;
          const crmPerson = u.crmAccess === true || u.crmRole != null || total > 0;
          if (!crmPerson) continue;
          if (total === 0 && fap.shared === 0) { idle++; continue; }
          rows.push({
            uid: d.id, name: u.displayName ?? d.id,
            customers: own.customers, leads: fap.leads, cases: fap.cases, shared: fap.shared,
            total,
          });
        }
        rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
        return { rows, unassigned, idle };
      }));
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });

  // ── Not-eligible register — every rejected customer/lead across BOTH models,
  // with the CIBIL score / reason, who marked it and when. Managers + admins +
  // super admins get the complete view; the data lives on the lead docs.
  app.get("/api/crm/not-eligible", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerDoc = await db.collection("users").doc(uid).get();
      const caller: any = callerDoc.data() ?? {};
      const allowed = caller.role === "admin" || isSuperAdmin(uid) || caller.crmRole === "manager";
      if (!allowed) return res.status(403).json({ error: "Forbidden" });
      const fresh = req.query.fresh === "1";

      return res.json(await cachedJson("noteligible", fresh, async () => {
        const [oldSnap, newSnap, usersSnap] = await Promise.all([
          db.collection("leads").where("leadStatus", "==", "not_eligible").get(),
          db.collection("leads").where("status", "==", "NOT_ELIGIBLE").get(),
          db.collection("users").get(),
        ]);
        const nameByUid = new Map<string, string>();
        const nameByFapl = new Map<string, string>();
        for (const d of usersSnap.docs) {
          const u: any = d.data();
          nameByUid.set(d.id, u.displayName ?? d.id);
          if (u.employeeId) nameByFapl.set(u.employeeId, u.displayName ?? u.employeeId);
        }
        const anyName = (v: string | null | undefined) =>
          v ? (nameByFapl.get(v) ?? nameByUid.get(v) ?? v) : null;
        const ms = (v: any) => (v?.toMillis ? v.toMillis() : null);

        const rows: any[] = [];
        for (const d of oldSnap.docs) {
          const l: any = d.data();
          if (l.deleted === true) continue;
          rows.push({
            id: d.id, model: "customer",
            name: l.displayName ?? d.id, mobile: l.phone ?? null,
            creditScore: l.creditScore ?? null, reason: l.notEligibleReason ?? null,
            markedBy: anyName(l.leadStatusBy), markedAt: ms(l.leadStatusAt) ?? ms(l.updatedAt),
            owner: anyName(l.primaryOwnerId),
            link: `/crm/leads/${d.id}`,
          });
        }
        for (const d of newSnap.docs) {
          const l: any = d.data();
          rows.push({
            id: d.id, model: "lead",
            name: l.name ?? l.leadCode ?? d.id, mobile: l.mobile ?? null,
            creditScore: l.creditScore ?? null, reason: l.notEligibleReason ?? null,
            markedBy: anyName(l.updatedBy), markedAt: ms(l.updatedAt),
            owner: anyName(l.assignedRm),
            link: "/crm/pipeline/leads",
          });
        }
        rows.sort((a, b) => (b.markedAt ?? 0) - (a.markedAt ?? 0));
        return { rows, total: rows.length };
      }));
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });


  // GET /api/crm/activity/summary?period=YYYY-MM[&uid=UID]
  // The outbound-call activity view for ONE person: tagged → attempted → outcome.
  // Powers /crm/my-activity. Anyone may view THEMSELVES; a CRM manager may view
  // anyone in their downline; admin/super-admin may view anyone. Pure aggregation
  // via Admin SDK over the person's owned leads + their logged activities (the
  // existing activities (by, at) collection-group index).
  app.get("/api/crm/activity/summary", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const q = req.query.period;
      const period = typeof q === "string" && /^\d{4}-\d{2}$/.test(q) ? q : new Date().toISOString().slice(0, 7);
      const reqUid = typeof req.query.uid === "string" && req.query.uid ? req.query.uid : uid;

      let target = uid;
      if (reqUid !== uid) {
        const callerDoc = await db.collection("users").doc(uid).get();
        const caller: any = callerDoc.data() ?? {};
        if (caller.role === "admin" || isSuperAdmin(uid)) target = reqUid;
        else if (caller.crmRole === "manager") {
          const usersSnap = await db.collection("users").get();
          const users = usersSnap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
          if (!computeDownline(users, uid).has(reqUid)) return res.status(403).json({ error: "Not your team member" });
          target = reqUid;
        } else return res.status(403).json({ error: "Forbidden" });
      }

      const startMs = periodStartMs(period);
      const endMs = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1).getTime();
      const TOUCH_TYPES = ["call", "whatsapp", "email", "meeting"];
      const [leadsSnap, actSnap, targetDoc] = await Promise.all([
        db.collection("leads").where("primaryOwnerId", "==", target).where("deleted", "==", false).get(),
        db.collectionGroup("activities").where("by", "==", target).orderBy("at", "desc").limit(5000).get(),
        db.collection("users").doc(target).get(),
      ]);

      // CRM 2.0 leads are keyed by assignedRm (the person's FAPL), not
      // primaryOwnerId — pull them too so the activity view reflects ALL the
      // leads this person actually handles (not just old-model customers).
      const targetFapl = (targetDoc.data()?.employeeId as string | undefined) ?? null;
      const crm2Snap = targetFapl
        ? await db.collection("leads").where("assignedRm", "==", targetFapl).get()
        : null;

      // Optional import filter: restrict everything (counts, statuses, untouched
      // list, and the activity log below) to leads from ONE import file — so
      // management can judge a specific data set. importNames is always the
      // person's full distinct list (for the dropdown), computed before filtering.
      const importFilter = typeof req.query.importName === "string" && req.query.importName ? req.query.importName : null;
      const importNamesSet = new Set<string>();
      const filteredLeadIds = importFilter ? new Set<string>() : null;

      // Owned customers: total tagged, tagged this period (when the data was
      // handed to them), attempted (first contact stamped), disposition mix, and
      // the untouched list — status still 'new' AND never contacted.
      const status: Record<string, number> = { new: 0, interested: 0, callback: 0, not_interested: 0, no_response: 0, wrong_number: 0, not_eligible: 0, converted: 0 };
      let tagged = 0, taggedInPeriod = 0, attempted = 0;
      const untouched: Array<{ leadId: string; name: string; taggedAtMs: number | null; importName: string | null }> = [];
      // Per-contact drill-down: clicking a status chip in the UI opens these.
      const contacts: Array<{ leadId: string; name: string; mobile: string | null; status: string; model: "customer" | "lead" }> = [];
      leadsSnap.forEach((d) => {
        const l: any = d.data();
        const leadImport = typeof l.importName === "string" && l.importName ? l.importName : null;
        if (leadImport) importNamesSet.add(leadImport);
        if (importFilter) {
          if (leadImport !== importFilter) return;
          filteredLeadIds!.add(d.id);
        }
        tagged++;
        const st = (typeof l.leadStatus === "string" && l.leadStatus) ? l.leadStatus : "new";
        status[st] = (status[st] ?? 0) + 1;
        contacts.push({ leadId: d.id, name: l.displayName ?? "Customer", mobile: l.phone ?? null, status: st, model: "customer" });
        const tMs = l.assignedToCurrentOwnerAt?.toMillis ? l.assignedToCurrentOwnerAt.toMillis()
          : (l.createdAt?.toMillis ? l.createdAt.toMillis() : 0);
        if (tMs >= startMs && tMs < endMs) taggedInPeriod++;
        if (l.firstContactedAt) attempted++;
        else if (st === "new") untouched.push({ leadId: d.id, name: l.displayName ?? "Lead", taggedAtMs: tMs || null, importName: l.importName ?? null });
      });
      // CRM 2.0 leads have no importName → skip entirely under an import filter
      // (imports are an old-model concept), but always count them otherwise.
      if (crm2Snap && !importFilter) {
        crm2Snap.forEach((d) => {
          const l: any = d.data();
          tagged++;
          const bucket = leadBucket(l);   // single source: src/lib/crm2/leadModel.ts
          status[bucket] = (status[bucket] ?? 0) + 1;
          contacts.push({ leadId: d.id, name: l.name ?? l.leadCode ?? "Lead", mobile: l.mobile ?? null, status: bucket, model: "lead" });
          const tMs = l.receivedAt?.toMillis ? l.receivedAt.toMillis() : 0;
          if (tMs >= startMs && tMs < endMs) taggedInPeriod++;
          if (l.firstContactedAt) attempted++;
          else if (bucket === "new") untouched.push({ leadId: d.id, name: l.name ?? l.leadCode ?? "Lead", taggedAtMs: tMs || null, importName: null });
        });
      }
      untouched.sort((a, b) => (a.taggedAtMs ?? 0) - (b.taggedAtMs ?? 0)); // oldest data first

      // Activity in the period: counts by type, per-IST-day outreach, unique
      // customers touched, and a recent drill-down list.
      const byType: Record<string, number> = { call: 0, whatsapp: 0, email: 0, meeting: 0, note: 0, status_change: 0 };
      const daily = new Map<string, number>();
      const touchedLeads = new Set<string>();
      const recent: any[] = [];
      actSnap.forEach((d) => {
        const a: any = d.data();
        const atMs = a.at?.toMillis ? a.at.toMillis() : 0;
        if (atMs < startMs || atMs >= endMs) return;
        const type = typeof a.type === "string" ? a.type : "note";
        const segs = d.ref.path.split("/");
        const leadId = segs[0] === "leads" ? segs[1] : null;
        // Import filter also scopes the activity log — only touches on that
        // import's leads count.
        if (filteredLeadIds && (!leadId || !filteredLeadIds.has(leadId))) return;
        byType[type] = (byType[type] ?? 0) + 1;
        if (TOUCH_TYPES.includes(type)) {
          if (leadId) touchedLeads.add(leadId);
          const istDay = new Date(atMs + 330 * 60000).toISOString().slice(0, 10);
          daily.set(istDay, (daily.get(istDay) ?? 0) + 1);
        }
        if (recent.length < 150) recent.push({ leadId, type, atMs, content: typeof a.content === "string" ? a.content.slice(0, 140) : "" });
      });
      const nameById = new Map(leadsSnap.docs.map((d) => [d.id, (d.data() as any).displayName ?? "Customer"]));
      for (const r of recent) r.leadName = (r.leadId && nameById.get(r.leadId)) || "Customer";

      return res.json({
        period, uid: target, name: targetDoc.data()?.displayName ?? "—",
        importFilter, importNames: [...importNamesSet].sort(),
        tagged, taggedInPeriod, attempted, status,
        untouchedCount: untouched.length, untouched: untouched.slice(0, 100),
        byType, totalTouches: TOUCH_TYPES.reduce((s, t) => s + byType[t], 0),
        uniqueCustomersTouched: touchedLeads.size,
        daily: [...daily.entries()].sort().map(([date, count]) => ({ date, count })),
        recent,
        contacts: contacts.slice(0, 2000),
      });
    } catch (e) { return res.status(500).json({ error: String(e) }); }
  });
}
