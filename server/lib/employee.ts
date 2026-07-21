/**
 * server/lib/employee.ts - CRM/HRMS onboarding + offboarding checklist builders + creators, lifted from server.ts
 * (2026-07-21, Phase 3). Closes only over db/admin. Pure move - behavior unchanged.
 */
import { db, admin } from "../db.js";

function buildOnboardingItems() {
  return [
    // Documents
    { id: "ob_doc_offer",       category: "documents",      task: "Offer letter signed and collected",             completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_doc_appoint",     category: "documents",      task: "Appointment letter issued",                     completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_doc_pan",         category: "documents",      task: "PAN card copy collected",                       completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_doc_aadhaar",     category: "documents",      task: "Aadhaar copy collected (do not store number)",  completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_doc_bank",        category: "documents",      task: "Bank account details collected",                completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_doc_emergency",   category: "documents",      task: "Emergency contact details collected",           completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_doc_edu",         category: "documents",      task: "Educational certificates verified",             completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_doc_prevexp",     category: "documents",      task: "Previous employment documents verified",        completed: false, completedAt: null, completedBy: null, notes: null },
    // System Access
    { id: "ob_sys_email",       category: "system_access",  task: "@finvastra.com email created in Google Workspace", completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_sys_pulse",       category: "system_access",  task: "Added to Finvastra Pulse (this system)",       completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_sys_whatsapp",    category: "system_access",  task: "Added to relevant WhatsApp groups",            completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_sys_drive",       category: "system_access",  task: "Added to Google Drive shared folders",         completed: false, completedAt: null, completedBy: null, notes: null },
    // Assets
    { id: "ob_asset_laptop",    category: "assets",         task: "Laptop issued (update asset management)",      completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_asset_sim",       category: "assets",         task: "SIM card issued (update asset management)",    completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_asset_card",      category: "assets",         task: "Access card issued (if applicable)",           completed: false, completedAt: null, completedBy: null, notes: null },
    // Induction
    { id: "ob_ind_policy",      category: "induction",      task: "HR policy walkthrough done",                   completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_ind_posh",        category: "induction",      task: "POSH policy acknowledged",                     completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_ind_manager",     category: "induction",      task: "Reporting manager introduction done",          completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_ind_team",        category: "induction",      task: "Team introduction done",                       completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "ob_ind_kpi",         category: "induction",      task: "Role and KPIs explained",                      completed: false, completedAt: null, completedBy: null, notes: null },
  ];
}

function buildOffboardingItems() {
  return [
    // Knowledge Transfer
    { id: "off_kt_handover",   category: "knowledge_transfer", task: "Handover document prepared",                     completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "off_kt_wip",        category: "knowledge_transfer", task: "Work-in-progress handed over to manager",        completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "off_kt_clients",    category: "knowledge_transfer", task: "Client contacts handed over",                    completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "off_kt_creds",      category: "knowledge_transfer", task: "Passwords and credentials handed over",          completed: false, completedAt: null, completedBy: null, notes: null },
    // Assets
    { id: "off_asset_laptop",  category: "assets",             task: "Laptop returned and condition checked",          completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "off_asset_sim",     category: "assets",             task: "SIM card returned",                              completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "off_asset_card",    category: "assets",             task: "Access card returned",                           completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "off_asset_other",   category: "assets",             task: "Any other company property returned",            completed: false, completedAt: null, completedBy: null, notes: null },
    // System Access
    { id: "off_sys_pulse",     category: "system_access",      task: "Pulse access disabled (auto — done on deactivation)", completed: true,  completedAt: null, completedBy: null, notes: "Auto-completed on deactivation" },
    { id: "off_sys_email",     category: "system_access",      task: "Google Workspace email disabled",                completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "off_sys_whatsapp",  category: "system_access",      task: "Removed from WhatsApp groups",                   completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "off_sys_drive",     category: "system_access",      task: "Removed from shared Google Drive folders",       completed: false, completedAt: null, completedBy: null, notes: null },
    // Documents
    { id: "off_doc_resign",    category: "documents",          task: "Resignation letter received and filed",          completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "off_doc_exp",       category: "documents",          task: "Experience letter issued",                       completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "off_doc_relieve",   category: "documents",          task: "Relieving letter issued",                        completed: false, completedAt: null, completedBy: null, notes: null },
    { id: "off_doc_form16",    category: "documents",          task: "Form 16 issued (if applicable)",                 completed: false, completedAt: null, completedBy: null, notes: null },
  ];
}

async function createOnboardingChecklist(
  uid: string, employeeName: string, joiningDate: string | null, createdBy: string
) {
  await db.collection("onboarding_checklists").doc(uid).set({
    employeeId:  uid,
    employeeName,
    joiningDate: joiningDate ?? null,
    createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    createdBy,
    status:      "pending",
    completedAt: null,
    items:       buildOnboardingItems(),
  });
}

async function createOffboardingChecklist(
  uid: string, employeeName: string,
  lastWorkingDate: string | null, exitReason: string | null, createdBy: string,
  extraItems: object[] = [],
) {
  const items = [...buildOffboardingItems(), ...extraItems];
  await db.collection("offboarding_checklists").doc(uid).set({
    employeeId:      uid,
    employeeName,
    lastWorkingDate: lastWorkingDate ?? null,
    exitReason:      exitReason ?? null,
    createdAt:       admin.firestore.FieldValue.serverTimestamp(),
    createdBy,
    status:          "pending",
    completedAt:     null,
    fnfStatus:       "pending",
    fnfSettledAt:    null,
    fnfSettledBy:    null,
    items,
    fnfDetails:      null,
  });
}

export { buildOnboardingItems, buildOffboardingItems, createOnboardingChecklist, createOffboardingChecklist };
