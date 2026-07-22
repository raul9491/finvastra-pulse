/**
 * server/routes/admin.ts - health + dev bootstrap + claims sync + PAN encrypt/migrate admin routes, lifted from server.ts
 * (2026-07-21, Phase 3 route split). Registered via registerAdminRoutes(app); imports its
 * helpers directly from server/lib/* + ../db.js.
 */
import express from "express";
import { db, admin } from "../db.js";
import {
  isSuperAdmin,
  verifyFirebaseToken,
} from "../lib/auth.js";
import { encryptField, decryptField } from "../../src/lib/encryption.js";

export function registerAdminRoutes(app: express.Express): void {
  // Health check
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // Deep health check — actually touches Firestore so uptime monitoring catches
  // DB/quota/rules outages (a plain HTTP 200 check would miss them: in the
  // 2026-06-10 incident index.html stayed 200 while every Firestore read 429'd).
  // Returns 200 only if a real read succeeds; 503 otherwise. ~1 read/min = trivial.
  app.get("/api/health/deep", async (_req, res) => {
    try {
      await db.collection("users").limit(1).get();
      return res.json({ status: "ok", firestore: "ok" });
    } catch (e) {
      console.error("deep health check failed:", e);
      return res.status(503).json({ status: "degraded", firestore: "error",
        message: e instanceof Error ? e.message : "read failed" });
    }
  });

  // ─── Bootstrap admin ─────────────────────────────────────────────────────────
  // Promotes the caller to admin if their email is in the hardcoded allowlist.
  // Safe to expose: the allowlist is server-side only; no client can self-promote.
  app.post("/api/dev/bootstrap-admin", async (req, res) => {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Sign in first, then call this endpoint." });

      const userRecord = await admin.auth().getUser(uid);
      const profileRef = db.collection("users").doc(uid);
      const snap = await profileRef.get();

      const profile = {
        userId:      uid,
        email:       userRecord.email ?? "",
        displayName: userRecord.displayName ?? userRecord.email ?? "Admin",
        role:        "admin",
        photoURL:    userRecord.photoURL ?? "",
        department:  "Management",
        designation: "Admin",
        joiningDate: new Date().toISOString().slice(0, 10),
        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      };

      // Only allow known admin emails to use this endpoint
      const ADMIN_EMAILS = ["rahulv@finvastra.com"];
      if (!ADMIN_EMAILS.includes(userRecord.email ?? "")) {
        return res.status(403).json({ error: "Email not in admin allowlist." });
      }

      if (snap.exists) {
        await profileRef.update({ role: "admin", crmAccess: true });
        return res.json({ message: "Role updated to admin.", uid, existing: true });
      } else {
        await profileRef.set(profile);
        return res.json({ message: "Admin profile created.", uid, existing: false });
      }
    });

  // ─── Custom Claims Sync ──────────────────────────────────────────────────────
  // POST /api/admin/users/:uid/sync-claims
  // Reads the user's Firestore profile and stamps matching Firebase Auth custom claims.
  // Called by Add Employee and by AccessManagementPage on role/access changes.
  // Claims set: { role, hrmsAccess, crmAccess, crmRole, isHrmsManager, misAccess }
  app.post("/api/admin/users/:uid/sync-claims", async (req, res) => {
    try {
      const callerUid = await verifyFirebaseToken(req);
      if (!callerUid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(callerUid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const { uid } = req.params;

      // Protect super admin accounts: only another super admin can sync their claims
      if (isSuperAdmin(uid) && !isSuperAdmin(callerUid)) {
        return res.status(403).json({ error: "Only a super admin can modify another super admin's claims." });
      }

      const snap = await db.collection("users").doc(uid).get();
      if (!snap.exists) return res.status(404).json({ error: "User not found" });
      const p = snap.data()!;

      await admin.auth().setCustomUserClaims(uid, {
        role:           p.role          ?? "employee",
        hrmsAccess:     p.hrmsAccess    ?? true,
        crmAccess:      p.crmAccess     ?? false,
        crmRole:        p.crmRole       ?? null,
        isHrmsManager:  p.isHrmsManager ?? false,
        misAccess:      p.misAccess     ?? null,
        perms:          p.perms         ?? {},   // CRM 2.0 permission keys (PLAN.md decision 2)
        // CON-### id when this account IS a channel partner (connector) rather than
        // an employee. Its PRESENCE is what marks the account external-scoped: the
        // rules helper isConnectorUser() keys off it, so every read they get is
        // narrowed to rows carrying their own channelPartnerId. null for staff.
        connectorId:    p.connectorId   ?? null,
      });

      // Signal the target user's open sessions to force-refresh their ID token —
      // without this, a REVOKED permission lingers in the stale claims for up to
      // 1h (grants were already instant via the rules/API get() fallbacks).
      await db.collection("users").doc(uid).update({
        claimsRefreshedAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});

      await db.collection("audit_logs").add({
        actor:      callerUid,
        action:     "sync_custom_claims",
        targetPath: `/users/${uid}`,
        at:         admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ ok: true, uid });
    } catch (e) {
      console.error("sync-claims error:", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
    }
  });

  // POST /api/admin/sync-all-claims
  // Bulk re-stamp custom claims for EVERY user from their Firestore profile.
  // Run once after the 2026-06-10 claims-first rules change so every token carries
  // claims (then the rules skip the per-request /users read for that user).
  app.post("/api/admin/sync-all-claims", async (req, res) => {
    try {
      const callerUid = await verifyFirebaseToken(req);
      if (!callerUid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(callerUid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });
      const callerIsSuper = isSuperAdmin(callerUid);

      const usersSnap = await db.collection("users").get();
      let synced = 0, skipped = 0, noAuth = 0;
      for (const docu of usersSnap.docs) {
        const uid = docu.id;
        // Only a super admin may modify a super admin's claims.
        if (isSuperAdmin(uid) && !callerIsSuper) { skipped++; continue; }
        const p = docu.data();
        try {
          await admin.auth().setCustomUserClaims(uid, {
            role:          p.role          ?? "employee",
            hrmsAccess:    p.hrmsAccess    ?? true,
            crmAccess:     p.crmAccess     ?? false,
            crmRole:       p.crmRole       ?? null,
            isHrmsManager: p.isHrmsManager ?? false,
            misAccess:     p.misAccess     ?? null,
            perms:         p.perms         ?? {},   // CRM 2.0 permission keys
            connectorId:   p.connectorId   ?? null, // CON-### when this account is a connector
          });
          await docu.ref.update({
            claimsRefreshedAt: admin.firestore.FieldValue.serverTimestamp(),
          }).catch(() => {});
          synced++;
        } catch {
          // No Firebase Auth account yet (e.g. needsEmailSetup) — nothing to stamp.
          noAuth++;
        }
      }

      await db.collection("audit_logs").add({
        actor:      callerUid,
        action:     "sync_all_custom_claims",
        targetPath: "/users",
        at:         admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ ok: true, synced, skipped, noAuth, total: usersSnap.size });
    } catch (e) {
      console.error("sync-all-claims error:", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
    }
  });

  // ─── PAN Decryption API ──────────────────────────────────────────────────────
  // POST /api/leads/:leadId/pan — decrypt PAN and log the access.
  // Auth: admin OR the lead's primaryOwnerId OR any opportunity owner on the lead.
  app.post("/api/leads/:leadId/pan", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { leadId } = req.params;
    const leadSnap = await db.collection("leads").doc(leadId).get();
    if (!leadSnap.exists) return res.status(404).json({ error: "Lead not found" });
    const lead = leadSnap.data()!;

    // Authorisation: admin OR primaryOwner OR any opportunity owner
    const userSnap = await db.collection("users").doc(uid).get();
    const isAdmin = userSnap.data()?.role === "admin";
    const isPrimaryOwner = lead.primaryOwnerId === uid;

    let isOppOwner = false;
    if (!isAdmin && !isPrimaryOwner) {
      const oppsSnap = await db.collection("leads").doc(leadId).collection("opportunities").get();
      isOppOwner = oppsSnap.docs.some((d) => d.data().ownerId === uid);
    }

    if (!isAdmin && !isPrimaryOwner && !isOppOwner) {
      return res.status(403).json({ error: "Not authorised to view this PAN" });
    }

    // Decrypt — prefer panEncrypted; fall back to legacy panRaw during migration period
    let panPlain: string | null = null;
    if (lead.panEncrypted) {
      try {
        panPlain = decryptField(lead.panEncrypted as Parameters<typeof decryptField>[0]);
      } catch {
        return res.status(500).json({ error: "Decryption failed" });
      }
    } else if (lead.panRaw) {
      panPlain = lead.panRaw as string;
    }

    if (!panPlain) return res.status(404).json({ error: "No PAN on record" });

    // Log the access — Admin SDK bypasses Firestore rules (allow create: if false on access_logs)
    await db.collection("access_logs").add({
      actorId:    uid,
      actorEmail: userSnap.data()?.email ?? "",
      action:     "pan_view",
      targetType: "lead",
      targetId:   leadId,
      accessedAt: admin.firestore.FieldValue.serverTimestamp(),
      ipAddress:  req.ip ?? req.socket.remoteAddress ?? "",
      userAgent:  req.headers["user-agent"] ?? "",
    });

    return res.json({ pan: panPlain });
  });

  // POST /api/admin/migrate-pan-encryption — encrypts all leads with plaintext panRaw.
  // Admin-only. Run once per environment after setting PAN_ENCRYPTION_KEY.
  app.post("/api/admin/migrate-pan-encryption", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

    let migrated = 0, skipped = 0, failed = 0;
    try {
      const snap = await db.collection("leads").where("panRaw", "!=", null).get();
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        if (!data.panRaw || data.panEncrypted) { skipped++; continue; }
        try {
          const enc = encryptField(data.panRaw as string);
          const raw = data.panRaw as string;
          const masked = raw.length === 10
            ? raw.slice(0, 5) + "****" + raw.slice(-1)
            : "*".repeat(raw.length);
          await docSnap.ref.update({
            panEncrypted: enc,
            panMasked:    masked,
            panRaw:       admin.firestore.FieldValue.delete(),
          });
          migrated++;
        } catch {
          failed++;
        }
      }
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
    return res.json({ migrated, skipped, failed });
  });
}
