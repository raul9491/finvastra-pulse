/**
 * server/crm2/taskRoutes.ts - Case collaboration (Phase 6) + ad-hoc tasks.
 *
 *   collaborators : add/remove FAPLs on a case (attribution + a worklist)
 *   case tasks    : a per-case update/task thread; my-case-tasks lists open
 *                   tasks assigned to the caller across all cases
 *   ad-hoc tasks  : a manager/admin assigns a to-do to any specific person
 *
 * NOT on the money path - these touch case metadata (collaborators, tasks) and
 * the crm_tasks collection, never payout/misRecords/disburse. Extracted verbatim
 * from server/crm2.ts (2026-07-23); only the dedent + registerTaskRoutes(app, deps).
 *
 * CONTEXT THREADING: notify + sendBrandedEmail (registerCrm2Routes-local; email is
 * the injected Deps.sendBrandedEmail) and faplToUid (defined in crm2.ts, used in
 * five places). notifyFapls is local to this module - it wraps notify over a set
 * of FAPLs and is used by nothing else.
 */
import type express from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../db.js';
import { route, ApiError, reqStr, optStr, reqEnum, optTs, isStr } from './core.js';
import { decodeToken, requirePerm, getCallerMeta, createAudit, updateAudit } from './context.js';

type NotifyFn = (uid: string, payload: Record<string, unknown>) => Promise<void>;
type EmailFn = (to: string, subject: string, body: {
  title: string; intro: string; rows: Array<{ label: string; value: string }>;
  note?: string; ctaLabel?: string; ctaLink?: string;
}) => Promise<void>;

export function registerTaskRoutes(
  app: express.Express,
  notify: NotifyFn,
  sendBrandedEmail: EmailFn,
  faplToUid: (fapl: string) => Promise<string | null>,
  faplDisplayName: (fapl: string) => Promise<string>,
): void {
  // ═══ Phase 6 — Case collaboration (collaborators + task/update thread) ════════
  // Case access is already permission-wide (crm.cases.read); collaboration adds
  // attribution (who's working it → their Tasks page) + a comms thread. Server-only
  // writes. Bells the counterparties so a task by one is seen + actionable by another.

  async function notifyFapls(fapls: Iterable<string>, payload: Record<string, unknown>): Promise<void> {
    const seen = new Set<string>();
    for (const f of fapls) {
      if (!f || seen.has(f)) continue; seen.add(f);
      const uid = await faplToUid(f);
      if (uid) await notify(uid, payload);
    }
  }

  // POST collaborators — set the full collaborator set (admin/manager/owner only).
  app.post("/api/crm2/cases/:id/collaborators", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const meta = await getCallerMeta(caller.uid);
    const caseRef = db.collection("cases").doc(req.params.id);
    const snap = await caseRef.get();
    if (!snap.exists) throw new ApiError(404, `${req.params.id} not found`);
    const c = snap.data()!;
    const handlingRm = c.handlingRm as string;
    if (!(meta.isAdmin || meta.isManager || handlingRm === caller.fapl)) {
      throw new ApiError(403, "Only an admin, a manager, or the handling RM can change collaborators");
    }
    const raw = Array.isArray((req.body ?? {}).collaborators) ? (req.body as Record<string, unknown>).collaborators as unknown[] : [];
    const next = [...new Set(raw.map((x) => String(x).trim()).filter((x) => /^FAPL-\d+$/.test(x)))]
      .filter((f) => f !== handlingRm).slice(0, 12);
    const prev = ((c.collaborators as string[]) ?? []);
    await caseRef.update({ collaborators: next, ...updateAudit(caller.fapl) });
    const added = next.filter((f) => !prev.includes(f));
    if (added.length) {
      const byName = await faplDisplayName(caller.fapl);
      await notifyFapls(added, {
        type: "new_lead", title: `Added to a case by ${byName}`,
        body: `${req.params.id} — ${(c as Record<string, unknown>).clientId ?? ""}`, link: `/crm/pipeline/cases/${req.params.id}`,
      });
    }
    res.json({ ok: true, collaborators: next });
  }));

  // POST a task/update onto the case thread.
  app.post("/api/crm2/cases/:id/tasks", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const kind = reqEnum(b, "kind", ["task", "update"] as const);
    const text = reqStr(b, "text").slice(0, 2000);
    const assignedTo = kind === "task" && isStr(b.assignedTo) && /^FAPL-\d+$/.test(String(b.assignedTo)) ? String(b.assignedTo) : null;
    const caseRef = db.collection("cases").doc(req.params.id);
    const snap = await caseRef.get();
    if (!snap.exists) throw new ApiError(404, `${req.params.id} not found`);
    const c = snap.data()!;
    const clientSnap = await db.collection("clients").doc(c.clientId as string).get();
    const clientName = (clientSnap.data()?.name as string | null) ?? null;
    const assignedToName = assignedTo ? await faplDisplayName(assignedTo) : null;
    const createdByName = await faplDisplayName(caller.fapl);

    const ref = await caseRef.collection("tasks").add({
      caseId: req.params.id, clientName, kind, text,
      assignedTo, assignedToName, status: kind === "task" ? "open" : "done",
      doneAt: kind === "update" ? FieldValue.serverTimestamp() : null, doneBy: null,
      createdByName, ...createAudit(caller.fapl),
    });
    // Bell the counterparties (handling RM + collaborators + assignee), minus the author.
    const audience = new Set<string>([c.handlingRm as string, ...((c.collaborators as string[]) ?? []), ...(assignedTo ? [assignedTo] : [])]);
    audience.delete(caller.fapl);
    await notifyFapls(audience, {
      type: "new_lead",
      title: kind === "task" ? `New task on ${req.params.id}` : `Update on ${req.params.id}`,
      body: `${createdByName}: ${text.slice(0, 120)}`, link: `/crm/pipeline/cases/${req.params.id}`,
    });
    res.json({ ok: true, taskId: ref.id });
  }));

  // PATCH a task — toggle open/done (tasks only).
  app.patch("/api/crm2/cases/:id/tasks/:taskId", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.write");
    if (!caller) return;
    const status = reqEnum((req.body ?? {}) as Record<string, unknown>, "status", ["open", "done"] as const);
    const ref = db.collection("cases").doc(req.params.id).collection("tasks").doc(req.params.taskId);
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, "Task not found");
    if (snap.data()!.kind !== "task") throw new ApiError(400, "Only tasks can be marked done");
    await ref.update({
      status,
      doneAt: status === "done" ? FieldValue.serverTimestamp() : null,
      doneBy: status === "done" ? caller.fapl : null,
      ...updateAudit(caller.fapl),
    });
    res.json({ ok: true });
  }));

  // GET my open case-tasks (across all cases) — powers the Tasks page section.
  app.get("/api/crm2/my-case-tasks", route(async (req, res) => {
    const caller = await requirePerm(req, res, "crm.cases.read");
    if (!caller) return;
    const snap = await db.collectionGroup("tasks").where("assignedTo", "==", caller.fapl).get();
    const ms = (v: unknown) => (v as { toMillis?: () => number })?.toMillis?.() ?? 0;
    const tasks = snap.docs
      .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
      .filter((r) => r.data.status === "open" && r.data.kind === "task")
      .sort((a, b) => ms(b.data.createdAt) - ms(a.data.createdAt))
      .map((r) => ({ id: r.id, caseId: r.data.caseId, clientName: r.data.clientName, text: r.data.text,
        createdByName: r.data.createdByName, createdAt: ms(r.data.createdAt) || null }));
    res.json({ ok: true, tasks });
  }));

  // Keep-style task extras — colour accent + optional checklist items.
  const TASK_COLORS = new Set(["default", "red", "orange", "yellow", "green", "teal", "blue", "purple"]);
  function sanitizeTaskColor(v: unknown): string {
    return isStr(v) && TASK_COLORS.has(String(v)) ? String(v) : "default";
  }
  function sanitizeTaskItems(v: unknown): Array<{ id: string; text: string; done: boolean }> | null {
    if (!Array.isArray(v)) return null;
    const out = v.slice(0, 50).map((raw, i) => {
      const it = (raw ?? {}) as Record<string, unknown>;
      return {
        id: isStr(it.id) ? String(it.id).slice(0, 40) : `i${i}_${Math.abs(i * 2654435761 % 100000)}`,
        text: String(it.text ?? "").slice(0, 300),
        done: it.done === true,
      };
    }).filter((it) => it.text.trim() !== "");
    return out.length ? out : null;
  }

  // ═══ Ad-hoc tasks — a manager/admin assigns a to-do to any specific person ═══
  // Collection /crm_tasks — server-only writes (rules: write false); the assignee,
  // the creator, and managers/admins can read. Assignment bells + emails the
  // assignee and the task sits on their Tasks → To-Do tab until marked done.
  app.post("/api/crm2/tasks", route(async (req, res) => {
    const decoded = await decodeToken(req);
    if (!decoded) throw new ApiError(401, "Unauthorized");

    const b = (req.body ?? {}) as Record<string, unknown>;
    const assignedTo = reqStr(b, "assignedTo");
    // Anyone may add a task for THEMSELVES (personal to-do); assigning to
    // someone else stays a manager/admin action.
    if (assignedTo !== decoded.uid) {
      const meta = await getCallerMeta(decoded.uid);
      if (!meta.isManager) throw new ApiError(403, "Only a manager or admin can assign tasks to someone else");
    }
    const text = (optStr(b, "text") ?? "").slice(0, 4000);
    const title = (optStr(b, "title") ?? "").slice(0, 200) || null;
    const color = sanitizeTaskColor(b.color);
    const items = sanitizeTaskItems(b.items);
    if (!text.trim() && !title && !(items && items.length)) throw new ApiError(400, "Task needs a title, text or checklist items");
    const dueAt = optTs(b, "dueAt");
    const link = optStr(b, "link");

    const [uSnap, callerSnap] = await Promise.all([
      db.collection("users").doc(assignedTo).get(),
      db.collection("users").doc(decoded.uid).get(),
    ]);
    if (!uSnap.exists) throw new ApiError(404, "Assignee not found");
    const assignee = uSnap.data() ?? {};
    const callerName = (callerSnap.data()?.displayName as string) ?? decoded.uid;

    const taskRef = await db.collection("crm_tasks").add({
      assignedTo,
      assignedToName: (assignee.displayName as string) ?? assignedTo,
      text,
      title,
      color,
      items,
      reminderSent: false,
      dueAt: dueAt ?? null,
      link: link ? link.slice(0, 500) : null,
      status: "open",
      createdBy: decoded.uid,
      createdByName: callerName,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      doneAt: null, doneBy: null,
    });

    if (assignedTo !== decoded.uid) await notify(assignedTo, {
      type: "task_assigned",
      title: `New task from ${callerName}`,
      body: (title || text).slice(0, 140),
      link: "/crm/tasks",
    });
    const email = assignee.email as string | undefined;
    if (email && assignedTo !== decoded.uid) {
      void sendBrandedEmail(email, `New task from ${callerName}`, {
        title: "You have a new task",
        intro: `${callerName} assigned you a task on Pulse.`,
        rows: [
          { label: "Task", value: (title ? `${title} — ${text}` : text).slice(0, 300) },
          ...(dueAt ? [{ label: "Due", value: dueAt.toDate().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) }] : []),
        ],
        ctaLabel: "Open Tasks", ctaLink: "https://pulse.finvastra.com/crm/tasks",
      }).catch(() => {});
    }
    res.json({ ok: true, id: taskRef.id });
  }));

  // Mark done / reopen — assignee, creator, or a manager/admin.
  app.patch("/api/crm2/tasks/:id", route(async (req, res) => {
    const decoded = await decodeToken(req);
    if (!decoded) throw new ApiError(401, "Unauthorized");
    const taskRef = db.collection("crm_tasks").doc(req.params.id);
    const snap = await taskRef.get();
    if (!snap.exists) throw new ApiError(404, "Task not found");
    const t = snap.data() ?? {};
    if (t.assignedTo !== decoded.uid && t.createdBy !== decoded.uid) {
      const meta = await getCallerMeta(decoded.uid);
      if (!meta.isManager) throw new ApiError(403, "Not your task");
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    if (b.status !== undefined) {
      const status = reqEnum(b, "status", ["open", "done"] as const);
      fields.status = status;
      fields.doneAt = status === "done" ? FieldValue.serverTimestamp() : null;
      fields.doneBy = status === "done" ? decoded.uid : null;
    }
    if (b.title !== undefined) fields.title = (optStr(b, "title") ?? "").slice(0, 200) || null;
    if (b.text !== undefined) fields.text = (optStr(b, "text") ?? "").slice(0, 4000);
    if (b.color !== undefined) fields.color = sanitizeTaskColor(b.color);
    if (b.items !== undefined) fields.items = sanitizeTaskItems(b.items);
    if (b.dueAt !== undefined) {
      fields.dueAt = optTs(b, "dueAt");
      fields.reminderSent = false;                    // re-arm the due reminder
    }
    // Comment — appended with author + time (never overwrites the task), and
    // bells the other side of the task (assignee <-> creator, never self).
    if (typeof b.comment === "string" && b.comment.trim()) {
      const commentText = String(b.comment).trim().slice(0, 1000);
      const callerSnap = await db.collection("users").doc(decoded.uid).get();
      const callerName = (callerSnap.data()?.displayName as string) ?? decoded.uid;
      fields.comments = FieldValue.arrayUnion({
        by: decoded.uid, byName: callerName,
        text: commentText,
        at: Timestamp.now(),   // arrayUnion cannot hold serverTimestamp()
      });
      const others = new Set([t.assignedTo, t.createdBy].filter((u) => u && u !== decoded.uid));
      for (const target of others) {
        await notify(String(target), {
          type: "task_assigned",
          title: `Comment on: ${String(t.title || t.text || "task").slice(0, 50)}`,
          body: `${callerName}: ${commentText.slice(0, 120)}`,
          link: "/crm/tasks",
        });
      }
    }
    if (Object.keys(fields).length === 0) throw new ApiError(400, "No editable fields in payload");
    // Content edits (not status ticks) stamp editedAt → the card shows an "edited" tag.
    if (b.title !== undefined || b.text !== undefined || b.color !== undefined
        || b.items !== undefined || b.dueAt !== undefined) {
      fields.editedAt = FieldValue.serverTimestamp();
      fields.editedBy = decoded.uid;
    }
    await taskRef.update({ ...fields, updatedAt: FieldValue.serverTimestamp() });
    res.json({ ok: true });
  }));
}
