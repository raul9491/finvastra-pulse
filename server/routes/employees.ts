/**
 * server/routes/employees.ts - employee create/deactivate/reactivate + sheet-import routes, lifted from server.ts
 * (2026-07-21, Phase 3 route split). Registered via registerEmployeeRoutes(app); imports its
 * helpers directly from server/lib/* + ../db.js.
 */
import express from "express";
import crypto from "crypto";
import { db, admin } from "../db.js";
import {
  extractSheetId,
  fetchEmployeeMasterRows,
  parseEmployeeRow,
} from "../lib/imports.js";
import {
  isSuperAdmin,
  verifyFirebaseToken,
} from "../lib/auth.js";
import {
  createOffboardingChecklist,
  createOnboardingChecklist,
} from "../lib/employee.js";
import { encryptField } from "../../src/lib/encryption.js";

export function registerEmployeeRoutes(app: express.Express): void {
  // ─── Admin: create employee (spec-compliant) ─────────────────────────────────
  // Validates @finvastra.com domain, creates Auth + Firestore doc, sends reset link.
  app.post("/api/admin/employees/create", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(uid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const {
        displayName, email, employeeId, department, designation,
        reportingManagerName, reportingManagerUid, joiningDate, phone, personalEmail,
        officialPhone, location, employeeStatus = "active",
        lastWorkingDate,
        dateOfBirth, gender, bloodGroup, fatherMotherName, spouseName,
        presentAddress, permanentAddress,
        salaryBasic, salaryHra, salaryConveyance, salaryMedical, salaryOther, grossSalary,
        role = "employee", hrmsAccess = true, crmAccess = false,
        crmRole = null, convertorVertical = null,
        isHrmsManager = false, misAccess = null,
      } = req.body as Record<string, unknown>;

      if (!displayName || typeof displayName !== "string") {
        return res.status(400).json({ error: "displayName is required" });
      }
      if (!email || typeof email !== "string") {
        return res.status(400).json({ error: "email is required" });
      }
      if (!email.endsWith("@finvastra.com")) {
        return res.status(400).json({ error: "Email must be a @finvastra.com address" });
      }

      // Guardrail: managers/admins must never sit INSIDE a CRM manager's team —
      // their numbers would leak into that manager's team view. (Super admins are
      // admins, so this covers them too.)
      if (typeof reportingManagerUid === "string" && reportingManagerUid &&
          (role === "admin" || crmRole === "manager")) {
        const mgrSnap = await db.collection("users").doc(reportingManagerUid).get();
        if (mgrSnap.data()?.crmRole === "manager") {
          return res.status(400).json({ error: "Managers, admins and super admins cannot be placed inside a manager's team. Pick a different reporting manager." });
        }
      }

      // Create Firebase Auth account with fixed temp password
      let newUid: string;
      try {
        const existing = await admin.auth().getUserByEmail(email);
        newUid = existing.uid;
      } catch {
        const authUser = await admin.auth().createUser({
          email, displayName, password: "Finvastra@2026", emailVerified: false,
        });
        newUid = authUser.uid;
      }

      // Generate password reset link so employee sets their own password
      let resetLink: string | null = null;
      try {
        resetLink = await admin.auth().generatePasswordResetLink(email);
      } catch { /* non-fatal — admin can resend later */ }

      // Create Firestore profile — public directory fields only
      await db.collection("users").doc(newUid).set({
        userId:               newUid,
        displayName,
        email,
        ...(location             ? { location }             : {}),
        ...(employeeId           ? { employeeId }           : {}),
        ...(department           ? { department }           : {}),
        ...(designation          ? { designation }          : {}),
        ...(reportingManagerName ? { reportingManagerName } : {}),
        ...(reportingManagerUid  ? { reportingManagerUid }  : {}),
        ...(joiningDate          ? { joiningDate }          : {}),
        role,
        hrmsAccess,
        crmAccess,
        crmRole,
        convertorVertical,
        isHrmsManager,
        misAccess,
        employeeStatus:      employeeStatus ?? "active",
        needsEmailSetup:     false,
        mustResetPassword:   true,
        photoURL:            null,
        createdAt:           admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Write personal details to /user_details/{uid} (admin/HR-only collection)
      const personalData: Record<string, unknown> = {};
      if (phone)           personalData.phone          = phone;
      if (officialPhone)   personalData.officialPhone  = officialPhone;
      if (personalEmail)   personalData.personalEmail  = personalEmail;
      if (dateOfBirth)     personalData.dateOfBirth    = dateOfBirth;
      if (lastWorkingDate) personalData.lastWorkingDate = lastWorkingDate;
      if (gender)          personalData.gender         = gender;
      if (bloodGroup)      personalData.bloodGroup     = bloodGroup;
      if (fatherMotherName) personalData.fatherMotherName = fatherMotherName;
      if (spouseName)      personalData.spouseName     = spouseName;
      if (presentAddress)  personalData.presentAddress = presentAddress;
      if (permanentAddress) personalData.permanentAddress = permanentAddress;
      if (Object.keys(personalData).length > 0) {
        await db.collection("user_details").doc(newUid).set(personalData, { merge: true });
      }

      // Write salary to employee_sensitive (access-controlled; not world-readable)
      const salaryData: Record<string, unknown> = {};
      if (salaryBasic)      salaryData.salaryBasic      = salaryBasic;
      if (salaryHra)        salaryData.salaryHra        = salaryHra;
      if (salaryConveyance) salaryData.salaryConveyance = salaryConveyance;
      if (salaryMedical)    salaryData.salaryMedical    = salaryMedical;
      if (salaryOther)      salaryData.salaryOther      = salaryOther;
      if (grossSalary)      salaryData.grossSalary      = grossSalary;
      if (Object.keys(salaryData).length > 0) {
        await db.collection("employee_sensitive").doc(newUid).set(salaryData, { merge: true });
      }

      // Try to generate a password reset link so employee sets their own password.
      // Fire-and-forget; mustResetPassword flag is the primary enforcement.
      try {
        const resetLink = await admin.auth().generatePasswordResetLink(email as string);
        console.log(`[create-employee] Password reset link for ${email}: ${resetLink}`);
      } catch (e) {
        console.warn(`[create-employee] Could not generate reset link for ${email}:`, e);
      }

      // Audit log
      await db.collection("audit_logs").add({
        actor:        uid,
        action:       "employee_created",
        targetEmail:  email,
        targetPath:   `/users/${newUid}`,
        at:           admin.firestore.FieldValue.serverTimestamp(),
      });

      // Stamp custom claims immediately so the new employee's first token has the right role
      try {
        await admin.auth().setCustomUserClaims(newUid, {
          role:          role ?? "employee",
          hrmsAccess:    hrmsAccess ?? true,
          crmAccess:     crmAccess ?? false,
          crmRole:       crmRole ?? null,
          isHrmsManager: isHrmsManager ?? false,
          misAccess:     misAccess ?? null,
        });
      } catch (e) {
        console.warn("[create-employee] setCustomUserClaims failed (non-fatal):", e);
      }

      // Auto-create onboarding checklist (non-fatal — HR can create manually if this fails)
      try {
        await createOnboardingChecklist(
          newUid,
          typeof displayName === "string" ? displayName : String(displayName),
          typeof joiningDate === "string" ? joiningDate : null,
          uid,
        );
      } catch (e) {
        console.warn("[create-employee] createOnboardingChecklist failed (non-fatal):", e);
      }

      return res.json({ uid: newUid, email, empCode: employeeId ?? null, resetLink });
    } catch (e) {
      console.error("create employee error:", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
    }
  });

  // ─── Checklist helpers ────────────────────────────────────────────────────────


  // ─── Deactivate employee ──────────────────────────────────────────────────────
  // Disables Firebase Auth account, revokes sessions, updates Firestore,
  // creates offboarding checklist doc, writes audit log.
  app.post("/api/admin/employees/:uid/deactivate", async (req, res) => {
    try {
      const callerUid = await verifyFirebaseToken(req);
      if (!callerUid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(callerUid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const { uid } = req.params;

      // Super admin accounts are permanently protected — cannot be deactivated by anyone
      if (isSuperAdmin(uid)) {
        return res.status(403).json({ error: "Super admin accounts cannot be deactivated." });
      }

      const { lastWorkingDate, exitReason, notes } = req.body as Record<string, string>;

      if (!lastWorkingDate) return res.status(400).json({ error: "lastWorkingDate is required" });
      if (!exitReason)       return res.status(400).json({ error: "exitReason is required" });

      // 1+2. Disable the Auth account + revoke sessions. SKIPPED when the
      // employee has no login account at all (needsEmailSetup staff — no
      // workspace email was ever created): there is nothing to disable, and
      // the HR exit must still complete. Any OTHER auth error still aborts so
      // an active login is never left behind on a marked-exited employee.
      try {
        await admin.auth().updateUser(uid, { disabled: true });
        await admin.auth().revokeRefreshTokens(uid);
      } catch (e) {
        if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
      }

      // 3. Update Firestore /users doc
      const empSnap = await db.collection("users").doc(uid).get();
      const empName = empSnap.data()?.displayName ?? uid;
      await db.collection("users").doc(uid).update({
        employeeStatus: "inactive",
        lwd:            lastWorkingDate,
        exitReason,
        deactivatedAt:  admin.firestore.FieldValue.serverTimestamp(),
        deactivatedBy:  callerUid,
      });

      // 4. Check for open CRM items that need reassignment before exit
      // Query leads — filter deleted in-memory to avoid requiring a composite index
      const leadsSnap = await db.collection("leads")
        .where("primaryOwnerId", "==", uid)
        .get();
      const openLeadsCount = leadsSnap.docs.filter((d) => d.data().deleted !== true).length;

      // Query opportunities across all leads via collectionGroup — filter status in-memory
      const oppsSnap = await db.collectionGroup("opportunities")
        .where("ownerId", "==", uid)
        .get();
      const openOppsCount = oppsSnap.docs.filter((d) => d.data().status === "open").length;

      // Build an extra checklist item if any open CRM work exists
      const extraItems: object[] = [];
      if (openLeadsCount > 0 || openOppsCount > 0) {
        extraItems.push({
          id:          "crm_reassignment",
          category:    "crm",
          task:        `Reassign ${openLeadsCount} open lead${openLeadsCount !== 1 ? "s" : ""} and ${openOppsCount} open opportunit${openOppsCount !== 1 ? "ies" : "y"} before exit`,
          completed:   false,
          completedAt: null,
          completedBy: null,
          notes:       null,
          required:    true,
          metadata: {
            openLeadsCount,
            openOpportunitiesCount: openOppsCount,
            reassignUrl: `/crm/leads?ownerId=${uid}`,
          },
        });
      }

      // 5. Create offboarding checklist (CRM item prepended via extraItems)
      await createOffboardingChecklist(uid, empName, lastWorkingDate, exitReason, callerUid, extraItems);

      // 6. Audit log
      await db.collection("audit_logs").add({
        actor:      callerUid,
        action:     "employee_deactivated",
        targetPath: `/users/${uid}`,
        after:      { employeeStatus: "inactive", lwd: lastWorkingDate, exitReason, notes: notes ?? null },
        at:         admin.firestore.FieldValue.serverTimestamp(),
      });

      const warning = openLeadsCount > 0 || openOppsCount > 0
        ? "Employee has open CRM items that need reassignment"
        : null;

      return res.json({ ok: true, warning, openLeads: openLeadsCount, openOpportunities: openOppsCount });
    } catch (e) {
      console.error("[deactivate-employee]", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
    }
  });

  // ─── Reactivate employee ──────────────────────────────────────────────────────
  // Re-enables Firebase Auth account, updates Firestore, creates onboarding checklist.
  app.post("/api/admin/employees/:uid/reactivate", async (req, res) => {
    try {
      const callerUid = await verifyFirebaseToken(req);
      if (!callerUid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(callerUid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const { uid } = req.params;
      const { newJoiningDate, notes } = req.body as Record<string, string>;

      // 1. Re-enable the Auth account — skipped when the employee never had a
      // login (no workspace email); the HR record still reactivates.
      try {
        await admin.auth().updateUser(uid, { disabled: false });
      } catch (e) {
        if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
      }

      // 2. Update Firestore /users doc
      const empSnap = await db.collection("users").doc(uid).get();
      const empName = empSnap.data()?.displayName ?? uid;
      const joiningDate = newJoiningDate || (empSnap.data()?.joiningDate ?? null);
      await db.collection("users").doc(uid).update({
        employeeStatus:  "active",
        lwd:             null,
        exitReason:      null,
        reactivatedAt:   admin.firestore.FieldValue.serverTimestamp(),
        reactivatedBy:   callerUid,
        mustResetPassword: true,   // fresh login required
      });

      // 3. Create new onboarding checklist (fresh start)
      await createOnboardingChecklist(uid, empName, joiningDate, callerUid);

      // 4. Audit log
      await db.collection("audit_logs").add({
        actor:      callerUid,
        action:     "employee_reactivated",
        targetPath: `/users/${uid}`,
        after:      { employeeStatus: "active", newJoiningDate: newJoiningDate ?? null, notes: notes ?? null },
        at:         admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ ok: true });
    } catch (e) {
      console.error("[reactivate-employee]", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
    }
  });

  // ─── Create single employee ───────────────────────────────────────────────────
  // Creates Firebase Auth account (email/password) + Firestore /users doc.
  // Returns the generated uid and a temporary password for distribution.
  app.post("/api/hrms/employees/create", async (req, res) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const callerSnap = await db.collection("users").doc(uid).get();
    if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

    const {
      displayName, officialEmail, employeeId, employeeStatus = "active",
      phone, officialPhone, personalEmail, department, designation,
      reportingManagerName, reportingManagerUid, location, joiningDate, dateOfBirth,
      gender, bloodGroup, fatherMotherName, spouseName,
      presentAddress, permanentAddress, grossSalary, lastWorkingDate,
      salaryBasic, salaryHra, salaryConveyance, salaryMedical, salaryOther,
      bankData,
    } = req.body as Record<string, string | number | Record<string, unknown> | undefined>;

    if (!displayName) return res.status(400).json({ error: "displayName is required" });

    const genPwd = () => {
      const ch = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
      let p = ""; const b = crypto.randomBytes(12);
      for (let i = 0; i < 12; i++) p += ch[b[i] % ch.length];
      return p;
    };

    // Public directory fields only — no personal data in /users
    const profileData: Record<string, unknown> = {
      displayName,
      role: "employee",
      photoURL: "",
      employeeStatus,
      ...(employeeId           ? { employeeId }           : {}),
      ...(department           ? { department }           : {}),
      ...(designation          ? { designation }          : {}),
      ...(location             ? { location }             : {}),
      ...(reportingManagerName ? { reportingManagerName } : {}),
      ...(joiningDate          ? { joiningDate }          : {}),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Personal details — goes to /user_details (admin/HR-only)
    const personalDetails: Record<string, unknown> = {};
    if (phone)            personalDetails.phone           = phone;
    if (officialPhone)    personalDetails.officialPhone   = officialPhone;
    if (personalEmail)    personalDetails.personalEmail   = personalEmail;
    if (dateOfBirth)      personalDetails.dateOfBirth     = dateOfBirth;
    if (gender)           personalDetails.gender          = gender;
    if (bloodGroup)       personalDetails.bloodGroup      = bloodGroup;
    if (fatherMotherName) personalDetails.fatherMotherName = fatherMotherName;
    if (spouseName)       personalDetails.spouseName      = spouseName;
    if (presentAddress)   personalDetails.presentAddress  = presentAddress;
    if (permanentAddress) personalDetails.permanentAddress = permanentAddress;
    if (lastWorkingDate)  personalDetails.lastWorkingDate = lastWorkingDate;

    let newUid: string;
    let tempPassword: string | null = null;

    if (officialEmail) {
      // Check for existing auth account
      try {
        const existing = await admin.auth().getUserByEmail(String(officialEmail));
        newUid = existing.uid;
        const existingSnap = await db.collection("users").doc(newUid).get();
        if (existingSnap.exists) {
          await existingSnap.ref.update(profileData);
        } else {
          await db.collection("users").doc(newUid).set({ ...profileData, email: officialEmail, userId: newUid });
        }
      } catch {
        tempPassword = genPwd();
        const authUser = await admin.auth().createUser({
          email: String(officialEmail),
          password: tempPassword,
          displayName: String(displayName),
          disabled: employeeStatus === "inactive",
        });
        newUid = authUser.uid;
        await db.collection("users").doc(newUid).set({ ...profileData, email: officialEmail, userId: newUid });
      }
    } else {
      // No login email — profile-only record
      const docRef = db.collection("users").doc();
      newUid = docRef.id;
      await docRef.set({ ...profileData, email: "", userId: newUid });
    }

    // Write personal details to /user_details (admin/HR-only collection)
    if (Object.keys(personalDetails).length > 0) {
      await db.collection("user_details").doc(newUid).set(
        { ...personalDetails, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    // Store salary data in /employee_sensitive (admin-only collection)
    const salaryFields: Record<string, unknown> = {};
    if (salaryBasic)      salaryFields.salaryBasic      = Number(salaryBasic);
    if (salaryHra)        salaryFields.salaryHra        = Number(salaryHra);
    if (salaryConveyance) salaryFields.salaryConveyance = Number(salaryConveyance);
    if (salaryMedical)    salaryFields.salaryMedical    = Number(salaryMedical);
    if (salaryOther)      salaryFields.salaryOther      = Number(salaryOther);
    if (grossSalary)      salaryFields.grossSalary      = Number(grossSalary);
    const sensitivePayload: Record<string, unknown> = { ...salaryFields };
    if (bankData) Object.assign(sensitivePayload, bankData as Record<string, unknown>);
    if (Object.keys(sensitivePayload).length > 0) {
      await db.collection("employee_sensitive").doc(newUid).set(
        { ...sensitivePayload, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    await db.collection("audit_logs").add({
      actor: uid, action: "create_employee",
      targetPath: `/users/${newUid}`,
      before: null, after: { displayName, email: officialEmail ?? "" },
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ uid: newUid, tempPassword });
  });

  // ─── Employee master import (service-account Sheets API) ────────────────────

  // Preview: reads sheet via SA, returns parsed employee list. No writes.
  app.post("/api/admin/employees/import-preview", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(uid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const rows = await fetchEmployeeMasterRows();
      const employees = rows
        .map(parseEmployeeRow)
        .filter((e) => e.empCode && e.name);

      return res.json({
        employees: employees.map(({ panRaw: _, personalBankAcct: _2, officialBankAcct: _3, ...rest }) => rest),
        total:    employees.length,
        active:   employees.filter((e) => e.status === "active").length,
        inactive: employees.filter((e) => e.status === "inactive").length,
      });
    } catch (e) {
      console.error("[import-preview]", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Preview failed" });
    }
  });

  // Confirm: re-reads sheet via SA, creates Auth + Firestore + encrypted profile docs.
  app.post("/api/admin/employees/import-confirm", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(uid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const rows = await fetchEmployeeMasterRows();
      const parsed = rows.map(parseEmployeeRow).filter((e) => e.empCode && e.name);

      let created = 0, updated = 0, skipped = 0;
      const errors: string[] = [];

      for (const emp of parsed) {
        try {
          const docId     = emp.status === "active" && emp.officialEmail ? null : emp.empCode;
          // Public directory fields only
          const profileBase: Record<string, unknown> = {
            employeeId:           emp.empCode,
            displayName:          emp.name,
            email:                emp.officialEmail ?? "",
            department:           emp.department,
            designation:          emp.designation,
            reportingManagerName: emp.reportingManager,
            joiningDate:          emp.doj,
            employeeStatus:       emp.status,
            needsEmailSetup:      emp.needsEmailSetup,
            photoURL:             null,
            ...emp.roleAttrs,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };

          // Personal details → /user_details (admin/HR-only)
          const importUserDetails: Record<string, unknown> = {};
          if (emp.officialPhone ?? emp.phone) importUserDetails.phone = emp.officialPhone ?? emp.phone;
          if (emp.personalEmail)              importUserDetails.personalEmail = emp.personalEmail;
          if (emp.dob)                        importUserDetails.dateOfBirth   = emp.dob;
          if (emp.presentAddress)             importUserDetails.presentAddress = emp.presentAddress;
          if (emp.permanentAddress)           importUserDetails.permanentAddress = emp.permanentAddress;
          if (emp.status === "inactive" && emp.lwd) importUserDetails.lastWorkingDate = emp.lwd;

          // Aadhaar column (index 13) is intentionally skipped — UIDAI prohibition.
          const sensitiveDoc: Record<string, unknown> = {
            uid:              emp.empCode,
            dob:              emp.dob,
            uan:              emp.uan,
            presentAddress:   emp.presentAddress,
            permanentAddress: emp.permanentAddress,
            personalEmail:    emp.personalEmail,
            personalPhone:    emp.phone,
            personalBankName:    emp.personalBankName,
            personalBankBranch:  emp.personalBankBranch,
            personalBankIfsc:    emp.personalBankIfsc,
            officialBankName:    emp.officialBankName,
            officialBankBranch:  emp.officialBankBranch,
            officialBankIfsc:    emp.officialBankIfsc,
            grossSalary:         emp.grossSalary,
            aadhaarVerified:     false,
            aadhaarVerifiedOn:   null,
            aadhaarVerifiedBy:   null,
            aadhaarDriveLink:    null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          if (emp.panRaw) sensitiveDoc.panEncrypted = encryptField(emp.panRaw);
          if (emp.personalBankAcct) sensitiveDoc.personalBankAccountEncrypted = encryptField(emp.personalBankAcct);
          if (emp.officialBankAcct) sensitiveDoc.officialBankAccountEncrypted = encryptField(emp.officialBankAcct);

          if (emp.status === "inactive" || !emp.officialEmail) {
            // No Auth account — use empCode as doc ID
            const ref  = db.collection("users").doc(emp.empCode);
            const snap = await ref.get();
            if (snap.exists) {
              await ref.set({ ...profileBase, userId: emp.empCode, createdAt: snap.data()!.createdAt }, { merge: false });
              updated++;
            } else {
              await ref.set({ ...profileBase, userId: emp.empCode, createdAt: admin.firestore.FieldValue.serverTimestamp() });
              created++;
            }
            if (Object.keys(importUserDetails).length > 0) {
              await db.collection("user_details").doc(emp.empCode).set(
                { ...importUserDetails, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
              );
            }
            await db.collection("employee_profiles").doc(emp.empCode).set(
              { ...sensitiveDoc, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
            );
            if (emp.status === "inactive") { skipped++; created--; }
            continue;
          }

          // Active + has email → Auth account
          let authUid: string;
          let authExisted = false;
          try {
            const existing = await admin.auth().getUserByEmail(emp.officialEmail);
            authUid     = existing.uid;
            authExisted = true;
          } catch {
            const newUser = await admin.auth().createUser({
              email: emp.officialEmail, displayName: emp.name,
              password: "Finvastra@2026", emailVerified: false, disabled: false,
            });
            authUid = newUser.uid;
          }

          const userRef  = db.collection("users").doc(authUid);
          const userSnap = await userRef.get();
          if (userSnap.exists) {
            await userRef.set({ ...profileBase, userId: authUid, email: emp.officialEmail, createdAt: userSnap.data()!.createdAt }, { merge: false });
            updated++;
          } else {
            // New Auth account → force password reset on first login
            const resetFlag = !authExisted ? { mustResetPassword: true } : {};
            await userRef.set({ ...profileBase, ...resetFlag, userId: authUid, email: emp.officialEmail, createdAt: admin.firestore.FieldValue.serverTimestamp() });
            if (!authExisted) created++;
            else updated++;
          }

          if (Object.keys(importUserDetails).length > 0) {
            await db.collection("user_details").doc(authUid).set(
              { ...importUserDetails, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
            );
          }
          await db.collection("employee_profiles").doc(emp.empCode).set(
            { ...sensitiveDoc, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
          );
          await db.collection("audit_logs").add({
            actor: uid, action: "import_employee",
            targetPath: `/users/${authUid}`,
            before: null, after: { email: emp.officialEmail, displayName: emp.name },
            at: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (rowErr) {
          errors.push(`${emp.empCode} ${emp.name}: ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`);
        }
      }

      return res.json({ created, updated, skipped, errors });
    } catch (e) {
      console.error("[import-confirm]", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Import failed" });
    }
  });

  // ─── Employee master import from Google Sheet (legacy — kept for compat) ─────
  // Original endpoint used public CSV; new flow uses /api/admin/employees/import-preview
  // and /api/admin/employees/import-confirm above. This endpoint is no longer called
  // by the UI but preserved in case it's needed via API directly.
  app.post("/api/hrms/employees/import-from-sheet", async (req, res) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });
      const callerSnap = await db.collection("users").doc(uid).get();
      if (callerSnap.data()?.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const { sheetUrl, dryRun = false } = req.body as { sheetUrl: string; dryRun?: boolean };
      if (!sheetUrl) return res.status(400).json({ error: "sheetUrl required" });

      // ── helpers ──
      const norm = (s: string | undefined) => { const t = (s ?? "").trim(); return (!t || t === "NA") ? null : t; };
      const ddToISO  = (s: string) => { const m = s.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}` : null; };
      const ddToMMDD = (s: string) => { const m = s.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); return m ? `${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}` : null; };
      const parseSalary = (s: string) => { const n = Number((s ?? "").replace(/,/g,"")); return isNaN(n) || n === 0 ? null : n; };
      const genPwd = () => { const ch = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"; let p = ""; const b = crypto.randomBytes(12); for(let i=0;i<12;i++) p+=ch[b[i]%ch.length]; return p; };

      // ── CSV parser (handles quoted fields with embedded commas) ──
      function parseCSV(text: string): string[][] {
        const rows: string[][] = []; let row: string[] = [], field = "", inQ = false;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (inQ) { if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
          else if (ch === '"') { inQ = true; }
          else if (ch === ',') { row.push(field); field = ""; }
          else if (ch === '\n') { row.push(field); field = ""; if (row.some(c=>c.trim())) rows.push(row); row = []; }
          else if (ch !== '\r') { field += ch; }
        }
        if (field || row.length > 0) { row.push(field); if (row.some(c=>c.trim())) rows.push(row); }
        return rows;
      }

      // ── Fetch sheet as CSV ──
      let csvText: string;
      try {
        const sheetId = extractSheetId(sheetUrl);
        const gidMatch = sheetUrl.match(/gid=(\d+)/);
        const gid = gidMatch ? gidMatch[1] : "0";
        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
        const fetchRes = await fetch(csvUrl, { redirect: "follow" });
        if (!fetchRes.ok) return res.status(400).json({ error: `Could not fetch sheet (HTTP ${fetchRes.status}). Make sure the sheet is set to "Anyone with the link can view".` });
        csvText = await fetchRes.text();
      } catch (e) {
        return res.status(400).json({ error: `Sheet fetch failed: ${e instanceof Error ? e.message : String(e)}` });
      }

      const allRows = parseCSV(csvText);
      // Row 0 = main headers, Row 1 = bank sub-headers, data from Row 2
      const dataRows = allRows.slice(2).filter(r => norm(r[2]) || norm(r[3]));

      // Column indices (0-based, Finvastra employee master sheet)
      const C = {
        status:1, empCode:2, name:3, dob:4, phone:5, personalEmail:6, doj:7,
        officialEmail:8, officialPhone:9, dept:10, designation:11, manager:12,
        // 13=Aadhaar SKIP, 14=PAN SKIP, 15=UAN SKIP
        presentAddr:16, permanentAddr:17,
        // Bank accounts (stored in /employee_sensitive)
        personalBankName:18, personalBankBranch:19, personalBankAcct:20, personalBankIfsc:21,
        officialBankName:22, officialBankBranch:23, officialBankAcct:24, officialBankIfsc:25,
        lwd:26, salary:27,
      };

      const results: Array<{
        empCode: string; name: string; email: string | null;
        status: "created" | "exists" | "no_email" | "error";
        tempPassword?: string; error?: string;
      }> = [];

      for (const row of dataRows) {
        try {
          const empCode       = norm(row[C.empCode]) ?? "";
          const name          = norm(row[C.name]) ?? "";
          const officialEmail = norm(row[C.officialEmail]);
          const statusStr     = (norm(row[C.status]) ?? "active").toLowerCase();

          if (!name) continue;

          const dobRaw = norm(row[C.dob]);
          const dojRaw = norm(row[C.doj]);
          const lwdRaw = norm(row[C.lwd]);

          const profileData: Record<string, unknown> = {
            displayName:    name,
            employeeId:     empCode || null,
            role:           "employee",
            photoURL:       "",
            employeeStatus: statusStr === "inactive" ? "inactive" : "active",
            ...(norm(row[C.phone])         ? { phone: norm(row[C.phone]) }                          : {}),
            ...(norm(row[C.officialPhone]) ? { officialPhone: norm(row[C.officialPhone]) }          : {}),
            ...(norm(row[C.personalEmail]) ? { personalEmail: norm(row[C.personalEmail]) }          : {}),
            ...(norm(row[C.dept])          ? { department: norm(row[C.dept]) }                      : {}),
            ...(norm(row[C.designation])   ? { designation: norm(row[C.designation]) }              : {}),
            ...(norm(row[C.manager])       ? { reportingManagerName: norm(row[C.manager]) }         : {}),
            ...(dobRaw                     ? { dateOfBirth: ddToMMDD(dobRaw) }                      : {}),
            ...(dojRaw                     ? { joiningDate:  ddToISO(dojRaw) }                      : {}),
            ...(norm(row[C.presentAddr])   ? { presentAddress: norm(row[C.presentAddr]) }           : {}),
            ...(norm(row[C.permanentAddr]) ? { permanentAddress: norm(row[C.permanentAddr]) }       : {}),
            ...(lwdRaw                     ? { lastWorkingDate: ddToISO(lwdRaw) }                   : {}),
            ...(parseSalary(row[C.salary] ?? "") !== null ? { grossSalary: parseSalary(row[C.salary] ?? "") } : {}),
            importedAt: admin.firestore.FieldValue.serverTimestamp(),
          };

          // Sensitive bank data → /employee_sensitive/{uid}
          const personalBank = {
            name: norm(row[C.personalBankName]),
            branch: norm(row[C.personalBankBranch]),
            accountNumber: norm(row[C.personalBankAcct]),
            ifsc: norm(row[C.personalBankIfsc]),
          };
          const officialBank = {
            name: norm(row[C.officialBankName]),
            branch: norm(row[C.officialBankBranch]),
            accountNumber: norm(row[C.officialBankAcct]),
            ifsc: norm(row[C.officialBankIfsc]),
          };
          const hasBankData = Object.values(personalBank).some(Boolean) || Object.values(officialBank).some(Boolean);

          if (!officialEmail) {
            if (!dryRun) {
              const docRef = db.collection("users").doc();
              await docRef.set({ ...profileData, email: "", userId: docRef.id });
              if (hasBankData) {
                await db.collection("employee_sensitive").doc(docRef.id).set(
                  { personalBank, officialBank, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                  { merge: true }
                );
              }
            }
            results.push({ empCode, name, email: null, status: "no_email" });
            continue;
          }

          // Check for existing Firebase Auth account
          let existingUid: string | null = null;
          try {
            const existingAuth = await admin.auth().getUserByEmail(officialEmail);
            existingUid = existingAuth.uid;
          } catch { /* user does not exist */ }

          if (existingUid) {
            if (!dryRun) {
              await db.collection("users").doc(existingUid).set(
                { ...profileData, email: officialEmail, userId: existingUid },
                { merge: true }
              );
              if (hasBankData) {
                await db.collection("employee_sensitive").doc(existingUid).set(
                  { personalBank, officialBank, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                  { merge: true }
                );
              }
            }
            results.push({ empCode, name, email: officialEmail, status: "exists" });
          } else {
            const tempPassword = genPwd();
            if (!dryRun) {
              const authUser = await admin.auth().createUser({
                email: officialEmail,
                password: tempPassword,
                displayName: name,
                disabled: statusStr === "inactive",
              });
              await db.collection("users").doc(authUser.uid).set({
                ...profileData, email: officialEmail, userId: authUser.uid,
              });
              if (hasBankData) {
                await db.collection("employee_sensitive").doc(authUser.uid).set(
                  { personalBank, officialBank, updatedAt: admin.firestore.FieldValue.serverTimestamp() }
                );
              }
              await db.collection("audit_logs").add({
                actor: uid, action: "import_employee",
                targetPath: `/users/${authUser.uid}`,
                before: null, after: { email: officialEmail, displayName: name },
                at: admin.firestore.FieldValue.serverTimestamp(),
              });
            }
            results.push({ empCode, name, email: officialEmail, status: "created", tempPassword });
          }
        } catch (rowErr) {
          const empCode = norm(row[2]) ?? "";
          const name    = norm(row[3]) ?? "Unknown";
          console.error(`Import row error (${empCode} ${name}):`, rowErr);
          results.push({ empCode, name, email: null, status: "error",
            error: rowErr instanceof Error ? rowErr.message : String(rowErr) });
        }
      }

      const summary = {
        total:   results.length,
        created: results.filter(r => r.status === "created").length,
        exists:  results.filter(r => r.status === "exists").length,
        noEmail: results.filter(r => r.status === "no_email").length,
        errors:  results.filter(r => r.status === "error").length,
      };
      return res.json({ dryRun, summary, results });

    } catch (e) {
      console.error("Import-from-sheet fatal error:", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "Internal server error" });
    }
  });
}
