/**
 * CRM 2.0 / Pipeline types — Leads → Clients → Cases → Payout Cycles → MIS → Recon.
 *
 * Authoritative spec mapping lives in PLAN.md (repo root). Three signed-off decisions
 * override the original spec wording:
 *  1. Upstream aggregators live in `aggregators/{CONN-xxx}` (NOT `connectors/`, which
 *     belongs to the existing Phase Q channel partners). Field names stay `connectorId`.
 *  2. Money fields are doc-split: payoutCycles + misRecords readable only with
 *     `payout.amounts.read`; the Case money mirror lives in `cases/{id}/private/payout`.
 *  3. New screens mount in CrmShell under a "Pipeline" nav group.
 *
 * All people fields store FAPL-xxx employee codes (NOT Firebase uids).
 * All *Enc fields store the EncryptedField object from src/lib/encryption.ts.
 * All money/derived fields are SERVER-CALCULATED — clients never write them.
 */

import type { EncryptedField } from '../lib/encryption';

// Firestore Timestamp — typed loosely here so these interfaces work on both the
// client SDK and the Admin SDK without importing either.
export type Ts = { toMillis(): number; toDate(): Date };

export interface Audit {
  createdAt: Ts;
  createdBy: string;          // FAPL-xxx
  updatedAt: Ts;
  updatedBy: string;          // FAPL-xxx
}

export interface Address {
  line: string;
  city: string;
  state: string;
  pincode: string;
}

// ─── Permission keys (Permission Manager `perms` map + custom claims) ──────────
export const CRM2_PERM_KEYS = [
  'crm.leads.read', 'crm.leads.write',
  'crm.cases.read', 'crm.cases.write',
  'crm.masters.write',
  'payout.read', 'payout.write', 'payout.amounts.read',
  'mis.read', 'recon.read',
] as const;
export type Crm2PermKey = typeof CRM2_PERM_KEYS[number];
export type PermsMap = Partial<Record<Crm2PermKey, boolean>>;

// ─── Masters ────────────────────────────────────────────────────────────────────

export interface Lender extends Audit {
  name: string;                       // "Fedbank Financial Services"
  type: 'PSU_BANK' | 'PRIVATE_BANK' | 'NBFC' | 'HFC';
  productsOffered: string[];          // productIds
  contacts: Array<{ name: string; role: 'SM' | 'RM' | 'ASM' | 'OTHER';
                    email: string; mobile: string; branch: string }>;
  loginEmail: string;                 // file-submission inbox
  tatBenchmarkDays: number | null;    // login → sanction SLA
  status: 'ACTIVE' | 'INACTIVE';
}

export type ProductVertical = 'LOANS' | 'WEALTH' | 'INSURANCE' | 'CHANNEL_PARTNER' | 'VAS';

export interface Product extends Audit {
  name: string;
  shortCode: string;                  // "LAP", "BL", "HL"
  vertical: ProductVertical;
  subProducts: string[];              // e.g. ["Salaried", "Self-Employed", "BT"]
  defaultDocChecklist: string[];      // documentMaster ids
  defaultRoiRange: string | null;     // display only
  status: 'ACTIVE' | 'INACTIVE';
}

/** Upstream aggregator (Ruloans, Shraddha Group, Star Digiloans…).
 *  Collection: `aggregators/{CONN-xxx}` — see PLAN.md decision 1. */
export interface Aggregator extends Audit {
  name: string;
  type: 'MASTER_AGGREGATOR' | 'SUB_AGGREGATOR';
  empanelmentDate: Ts | null;
  opsPoc: { name: string; email: string; mobile: string } | null;   // legacy single POC
  contacts: Array<{ name: string; dept: string; mobile: string }>;  // multiple phone contacts
  emails: Array<{ name: string; dept: string; email: string }>;     // multiple email contacts
  claimsEmail: string | null;
  accountsEmail: string | null;
  billingEntityName: string | null;   // entity Finvastra invoices
  billingGstin: string | null;
  payoutFrequency: 'MONTHLY' | 'PER_CASE';
  standardTdsPct: number;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface MappingSlab {
  slabId: string;                     // uuid — frozen onto cases for audit
  productIds: string[];
  connectorPayoutPctFromBank: number | null;   // transparency only
  finvastraPayoutPct: number;
  subDsaDefaultPayoutPct: number | null;
  tdsPct: number | null;              // overrides aggregator.standardTdsPct when set
  effectiveFrom: Ts;
  effectiveTo: Ts | null;             // null = current
}

/** One doc per Aggregator + Lender pair — THE PAYOUT ENGINE. */
export interface DsaCodeMapping extends Audit {
  connectorId: string;                // aggregators/{id} (the "aggregator")
  lenderId: string;
  productId: string;                  // products/{id} — DSA codes are per product
  subProduct: string | null;          // optional finer grain (one of Product.subProducts)
  dsaCode: string;                    // bank-dump match key
  codeRegisteredName: string | null;  // recon string-match — OPTIONAL
  status: 'ACTIVE' | 'INACTIVE';
  slabs: MappingSlab[];
}

/** Downstream partner who sources cases to Finvastra. */
export interface SubDsa extends Audit {
  name: string;
  type: 'INDIVIDUAL' | 'CORPORATE' | 'REFERRAL_CLIENT' | 'WALKIN_REFERRER';
  sourceLeadId: string | null;
  mobile: string; email: string | null; city: string; state: string;
  panEnc: EncryptedField | null; panLast4: string | null;
  gstin: string | null;
  payoutBank: { accountNoEnc: EncryptedField; accountNoLast4: string;
                ifsc: string; bankName: string } | null;
  tdsPct: number | null;              // TDS deducted on this connector's payouts
  payoutSlabs: Array<{ productIds: string[]; payoutPct: number }>;
  relationshipOwner: string;          // FAPL-xxx
  onboardingDate: Ts | null;
  status: 'ACTIVE' | 'INACTIVE' | 'BLACKLISTED';
}

export type DocStage = 'LOGIN' | 'SANCTION' | 'DISBURSEMENT' | 'PDD';

export interface DocumentDef extends Audit {
  name: string;
  category: 'ENTITY_KYC' | 'INDIVIDUAL_KYC' | 'FINANCIALS' | 'PROPERTY' | 'POST_SANCTION_PDD';
  applicableTo: 'ENTITY' | 'EACH_APPLICANT' | 'GUARANTOR' | 'PROPERTY';
  mandatoryForProducts: string[];
  validityDays: number | null;
  requiredByStage: DocStage;
  status: 'ACTIVE' | 'INACTIVE';
}

// ─── Leads (extension of the existing collection — additive) ───────────────────

export type Crm2LeadCategory = 'LOAN' | 'WEALTH' | 'INSURANCE' | 'CIBIL_CHECK' | 'PARTNER_DSA' | 'GENERAL';
export type Crm2LeadStatus =
  | 'NEW' | 'QUEUED' | 'ASSIGNED' | 'ATTEMPTED' | 'CONTACTED' | 'QUALIFIED' | 'JUNK_DUPLICATE'
  | 'NOT_INTERESTED' | 'CONVERTED' | 'DROPPED';   // QUEUED/ASSIGNED drive the FIFO pull queue
export type Crm2LeadSource =
  | 'WEBSITE' | 'JUSTDIAL' | 'REFERRAL_CLIENT' | 'REFERRAL_SUBDSA' | 'ADS' | 'WALKIN' | 'COLD_CALL';

export interface Crm2LeadFields {
  receivedAt: Ts;
  // Human-friendly code (LD-YYYY-#####), shown in the UI. For natively-created
  // leads it equals the doc id; for promoted Customers (which keep their original
  // random doc id) it is minted separately so every lead reads LD-YYYY-#####.
  leadCode?: string;
  category: Crm2LeadCategory;
  productId: string | null;
  // `name` = the ENTITY name (business / applicant entity). `customerName` is the
  // contact person — often identical (a "same as entity name" tick mirrors it).
  name: string; customerName?: string | null; mobile: string; email: string | null; city: string | null;
  source: Crm2LeadSource;
  sourceMeta: { formId: string | null; sourceUrl: string | null;
                utm: { source?: string; medium?: string; campaign?: string } | null };
  amountRequired: number | null;
  referredById: string | null;        // subDsaId or clientId
  referredByType: 'SUBDSA' | 'CLIENT' | null;
  referredByName: string | null;      // denormalised label (sub-DSA / referring client name)
  referredByCode: string | null;      // SDSA-### code (for REFERRAL_SUBDSA), shown on the lead
  // The "Sub DSA" channel partner (HRMS `connectors`, FAC-###) who SOURCED this
  // lead. Attribution — carried lead→case→login→MIS. Distinct from referredBy*
  // (subDsas/clients) and from the case's connectorId (aggregators) / subDsaId (subDsas).
  channelPartnerId: string | null;    // FAC-### (HRMS connectors)
  channelPartnerCode: string | null;
  channelPartnerName: string | null;
  // Phase 3 — link an existing client master to the lead (pre-fills convert).
  linkedExistingClientId: string | null;
  // Phase 3 — optional "bigger client details" captured on the lead.
  customerProfile: { constitution: string | null; businessName: string | null;
                     annualTurnover: number | null; requirements: string | null } | null;
  assignedRm: string | null;          // FAPL-xxx
  assignedAt: Ts | null;              // SLA anchor
  status: Crm2LeadStatus;
  priority: 'HOT' | 'WARM' | 'COLD';  // shown as a Red / Yellow / Green traffic light
  nextFollowUpAt: Ts | null;
  nextFollowUpNote: string | null;    // Phase 3 — emailed with the follow-up reminder
  followUpReminderSent: boolean;      // re-armed whenever nextFollowUpAt changes
  attempts: number;
  activityLog: Array<{ at: Ts; by: string; note: string; action: string }>;
  dropReason: 'RATE' | 'AVAILED_ELSEWHERE' | 'NOT_ELIGIBLE' | 'UNREACHABLE' | 'DOCS_ISSUE' | null;
  // conversion outputs — server-written
  converted: boolean; convertedAt: Ts | null;
  linkedClientId: string | null; linkedCaseId: string | null; linkedSubDsaId: string | null;
  // dedupe — server-written on create
  duplicateOfLeadId: string | null;
  dupeKeys: string[];                 // ["m:9701097333","e:x@y.com"]
  // Phase 3 — set when a doc was promoted from an old-CRM "Customer" record.
  promotedFromCustomer?: boolean;
  // SLA (Phase 2) — set-once on first contact attempt; server-stamped.
  firstContactedAt?: Ts | null;
  // FIFO pull queue (server-managed): claim stamps assignedRm+assignedAt; release
  // returns to the queue preserving receivedAt (captureAt) + bumps releaseCount.
  releaseCount?: number;
  lastReleaseReason?: string | null;
  queueFlagged?: boolean;          // raised when releaseCount >= 3 (needs manager)
}

// ─── Clients + vault ────────────────────────────────────────────────────────────

export interface Client extends Audit {
  constitution: 'INDIVIDUAL' | 'PROPRIETORSHIP' | 'PARTNERSHIP' | 'LLP' | 'PVT_LTD' | 'HUF';
  name: string;
  industry: string | null;
  panEnc: EncryptedField | null; panLast4: string | null;
  gstin: string | null; udyam: string | null; cin: string | null;
  incorporationDate: Ts | null;
  regAddress: Address; commAddress: Address;
  primaryContact: { name: string; mobile: string; email: string | null };
  latestCibil: { score: number; pulledAt: Ts } | null;
  existingRelationships: Array<{ bank: string; facility: string; outstanding: number; emi: number }>;
  sourceLeadId: string | null;
  sourcedById: string | null;         // subDsaId
  ownerRm: string;                    // FAPL-xxx
  kycStatus: 'PENDING' | 'PARTIAL' | 'COMPLETE';
  status: 'ACTIVE' | 'INACTIVE' | 'BLACKLISTED';
  dupeKeys: string[];
}

export interface VaultDoc extends Audit {
  documentDefId: string;
  applicantId: string | null;         // null = entity-level
  fileName: string;
  storagePath: string;                // clients/{clientId}/vault/{vaultDocId}
  uploadedAt: Ts;
  validUntil: Ts | null;
  status: 'VALID' | 'EXPIRED' | 'REPLACED';
  replacedByVaultDocId: string | null;
}

// ─── Cases ──────────────────────────────────────────────────────────────────────

export type CaseStage =
  | 'OPENED' | 'ELIGIBILITY' | 'DOC_COLLECTION' | 'CODE_ASSIGNMENT' | 'LOGIN'
  | 'UNDER_PROCESS' | 'SANCTIONED' | 'DISBURSED' | 'PDD_OTC' | 'CLOSED';

export const CASE_STAGE_ORDER: CaseStage[] = [
  'OPENED', 'ELIGIBILITY', 'DOC_COLLECTION', 'CODE_ASSIGNMENT', 'LOGIN',
  'UNDER_PROCESS', 'SANCTIONED', 'DISBURSED', 'PDD_OTC', 'CLOSED',
];

export interface Crm2Case extends Audit {
  clientId: string; leadId: string | null;
  productId: string;
  subProduct: string | null;          // one of Product.subProducts — payout/DSA finer grain
  handlingRm: string;                 // FAPL-xxx
  subDsaId: string | null;            // "Connector" (subDsas/SDSA-###) — per-login payout sub-agent
  // "Sub DSA" (HRMS connectors/FAC-###) — the sourcing channel partner (attribution).
  channelPartnerId: string | null; channelPartnerCode: string | null; channelPartnerName: string | null;
  lenderId: string | null;
  connectorId: string | null;         // aggregators/{id} — "Routed Via"
  // frozen from Mapping (server-written)
  mappingId: string | null; slabId: string | null; dsaCode: string | null;
  connectorCaseRef: string | null;
  bankApplicationNo: string | null;
  loanAccountNo: string | null;
  amountRequested: number;
  amountSanctioned: number | null; amountDisbursed: number | null;
  roiPct: number | null; tenureMonths: number | null; processingFee: number | null;
  disbursalCity: string | null; disbursalState: string | null;
  stage: CaseLevelStage | CaseStage;   // Phase 4 cutover: case-level (legacy union kept for old readers)
  outcome: 'COMPLETED' | 'REJECTED' | 'WITHDRAWN' | null;
  rejectionReason: string | null;
  keyDates: { opened: Ts; docsComplete: Ts | null; login: Ts | null;
              sanction: Ts | null; disbursement: Ts | null;
              pddCleared: Ts | null; otcCleared: Ts | null; closed: Ts | null };
  bankContact: { name: string; email: string; mobile: string } | null;
  pddStatus: 'NA' | 'PENDING' | 'PARTIAL' | 'CLEARED';
  otcStatus: 'NA' | 'PENDING' | 'CLEARED';
  pddPendingList: string[];
  queryLog: Array<{ raisedAt: Ts; detail: string; resolvedAt: Ts | null }>;
  // payout status badge — server-written. Money mirror lives in
  // cases/{id}/private/payout (PLAN.md decision 2) gated by payout.amounts.read.
  payoutStatus: PayoutCycleStatus | 'NOT_DUE';
  payoutCycleId: string | null;
  // add-ons (schema reserved; UI Phase 6)
  wealth: WealthAddon | null; insurance: InsuranceAddon | null;
  docsCompletePct: number;            // server-maintained from docTracker
  nextAction: string | null; remarks: string | null;
  // Stage-1 "Opened" underwriting capture (PLAN §4 stage 1) — editable anytime.
  stage1?: CaseStage1 | null;
  // Stage-2 "Basic Docs + Eligibility" — CIBIL taken + per-applicant issues table.
  eligibility?: CaseEligibility | null;
  // Stage-3 "Docs" — Google Drive client folder link (folder named = client id).
  docsFolderUrl?: string | null;
  // Phase 6 — RMs collaborating on this case besides handlingRm (FAPL-xxx).
  collaborators?: string[];
}

/** Stage-2 eligibility — CIBIL pulled? + a per-applicant/owner issues table. */
export interface CaseEligibility {
  cibilTaken: boolean;
  issues: Array<{
    name: string;                     // applicant / owner name
    score: number | null;
    overdue: string;                  // free text: overdues
    settlement: string;               // settlements
    writtenOff: string;               // written-off
    dpd: string;                      // DPD / days-past-due notes
  }>;
}

/** cases/{caseId}/tasks/{taskId} — the per-case collaboration thread (PLAN §5). */
export interface Crm2CaseTask extends Audit {
  caseId: string;                     // denormalised (powers the cross-case Tasks page)
  clientName: string | null;          // denormalised case label
  kind: 'task' | 'update';            // task = actionable+assignable; update = a note
  text: string;
  assignedTo: string | null;          // FAPL-xxx (tasks only)
  assignedToName: string | null;
  status: 'open' | 'done';
  doneAt: Ts | null;
  doneBy: string | null;              // FAPL-xxx
  createdByName: string;
}

/** Rich Stage-1 (Opened) underwriting data — additive, editable anytime. */
export interface CaseStage1 {
  property: { description: string | null; address: string | null; marketValue: number | null } | null;
  turnover: Array<{ fy: string; amount: number }>;            // last 3 financial years
  gstTurnover: { period: string | null; amount: number | null } | null;
  existingLoans: Array<{ lender: string; loanType: string; outstanding: number; emi: number }>;
  income: { company: number | null; individual: number | null; rental: number | null } | null;
  references: Array<{ name: string; mobile: string; relation: string }>;   // 2 references
  notes: string | null;               // partner/director-as-applicant details, etc.
}

/** cases/{id}/private/payout — money mirror, readable only with payout.amounts.read. */
export interface CasePayoutMirror {
  finvastraPayoutPct: number | null; finvastraPayoutExpected: number | null;
  subDsaPayoutPct: number | null; subDsaPayoutExpected: number | null;
  netMarginExpected: number | null;
  updatedAt: Ts;
}

// ─── Phase 4 — per-login model ────────────────────────────────────────────────
// Stages 1–3 are CASE-level (Opened · Basic Docs+Eligibility · Docs); from stage 4
// each LOGIN (one file → one bank/NBFC) runs its OWN progression and (Build #2)
// produces its own payout cycle + MIS record. The case shows a derived roll-up.
// These are ADDITIVE to the legacy CaseStage engine during the staged cutover.
export type CaseLevelStage = 'OPENED' | 'BASIC_DOCS' | 'DOCS' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED';
export const CASE_LEVEL_STAGE_ORDER: CaseLevelStage[] = ['OPENED', 'BASIC_DOCS', 'DOCS', 'IN_PROGRESS', 'COMPLETED'];

export type LoginStage =
  | 'FILE_LOGIN' | 'CODE_LOGIN_DONE' | 'IN_PROCESS' | 'SANCTIONED' | 'DISBURSED' | 'PDD_OTC' | 'COMPLETED';
export const LOGIN_STAGE_ORDER: LoginStage[] =
  ['FILE_LOGIN', 'CODE_LOGIN_DONE', 'IN_PROCESS', 'SANCTIONED', 'DISBURSED', 'PDD_OTC', 'COMPLETED'];

// ─── 10-stage case pipeline (the spec's full lifecycle, shown on the workspace) ─
// Presentation layer over the engine: stages 1–3 + 10 are case-level; stages 4–9
// are the per-login working zone (case stage = IN_PROGRESS, each login runs 4–9).
// Lets the user click any stage and work it; advancement is forward-by-one
// (case-level for 1→3→IN_PROGRESS→10; per-login for 4–9).
export interface CasePipelineStageDef {
  n: number;                          // 1..10 (display order)
  key: string;
  label: string;
  level: 'case' | 'login';            // case = single case form; login = per-login zone
  caseStage?: CaseLevelStage;         // the underlying case stage (level 'case' only)
  loginStage?: LoginStage;            // the underlying login stage (level 'login' only)
}
export const CASE_PIPELINE: CasePipelineStageDef[] = [
  { n: 1,  key: 'OPENED',          label: 'Opened',               level: 'case',  caseStage: 'OPENED' },
  { n: 2,  key: 'BASIC_DOCS',      label: 'Basic Docs + Eligibility', level: 'case', caseStage: 'BASIC_DOCS' },
  { n: 3,  key: 'DOCS',            label: 'Docs',                 level: 'case',  caseStage: 'DOCS' },
  { n: 4,  key: 'FILE_LOGIN',      label: 'File Login',           level: 'login', loginStage: 'FILE_LOGIN' },
  { n: 5,  key: 'CODE_LOGIN_DONE', label: 'Code + Login Done',    level: 'login', loginStage: 'CODE_LOGIN_DONE' },
  { n: 6,  key: 'IN_PROCESS',      label: 'In Process',           level: 'login', loginStage: 'IN_PROCESS' },
  { n: 7,  key: 'SANCTIONED',      label: 'Sanctioned / Rejected', level: 'login', loginStage: 'SANCTIONED' },
  { n: 8,  key: 'DISBURSED',       label: 'Disbursement',         level: 'login', loginStage: 'DISBURSED' },
  { n: 9,  key: 'PDD_OTC',         label: 'PDD / OTC',            level: 'login', loginStage: 'PDD_OTC' },
  { n: 10, key: 'COMPLETED',       label: 'Case Completed',       level: 'case',  caseStage: 'COMPLETED' },
];
const LOGIN_STAGE_TO_N: Record<LoginStage, number> = {
  FILE_LOGIN: 4, CODE_LOGIN_DONE: 5, IN_PROCESS: 6, SANCTIONED: 7, DISBURSED: 8, PDD_OTC: 9, COMPLETED: 9,
};
/** Which of the 10 display stages the case is currently "on" (for highlighting).
 *  During IN_PROGRESS it points at the earliest-active login (the bottleneck). */
export function activeCasePipelineStage(caseStage: string, loginStages: LoginStage[]): number {
  if (caseStage === 'OPENED') return 1;
  if (caseStage === 'BASIC_DOCS') return 2;
  if (caseStage === 'DOCS') return 3;
  if (caseStage === 'COMPLETED' || caseStage === 'CLOSED') return 10;
  // IN_PROGRESS (per-login zone)
  if (!loginStages.length) return 4;
  const active = loginStages.filter((s) => s !== 'COMPLETED');
  const pool = active.length ? active : loginStages;
  return Math.min(...pool.map((s) => LOGIN_STAGE_TO_N[s]));
}

export interface SubProcess {
  status: 'NA' | 'PENDING' | 'IN_PROGRESS' | 'DONE';
  query: string | null;
  remarks: string | null;
}

/** cases/{caseId}/logins/{LGN-YYYY-####} — the per-login pipeline unit. */
export interface Login extends Audit {
  caseId: string;
  seq: number;                          // display order within the case (1,2,3…)
  lenderId: string | null;             // bank/NBFC this file went to
  connectorId: string | null;          // aggregator routed-via (defaults from case)
  subDsaId: string | null;             // "Connector" (subDsas) — defaults from case
  // "Sub DSA" (HRMS connectors/FAC-###) sourcing partner — defaults from the case.
  channelPartnerId: string | null; channelPartnerCode: string | null; channelPartnerName: string | null;
  branch: string | null;
  // Stage 4 — File / Bank Login
  amountRequested: number | null;
  smName: string | null; smNumber: string | null; smEmail: string | null;     // bank Sales Manager
  asmName: string | null; asmNumber: string | null; asmEmail: string | null;  // bank Area Sales Manager
  docsSent: boolean;
  docsSentVia: 'email' | 'whatsapp' | null;   // how the file was sent to the bank
  directFromBank: boolean;             // structure now; payout-routing logic later (decision I)
  // Stage 5 — Code + bank login done
  // Whose DSA code the file is logged under: Finvastra's own code, or an
  // aggregator's code — `dsaAggregatorId` then names which aggregator (master).
  dsaCodeUsed: 'finvastra' | 'connector_own' | null;
  dsaAggregatorId: string | null;     // aggregators master id (e.g. AGG-001) when dsaCodeUsed='connector_own'
  codeName: string | null;
  loginDone: boolean;
  loanApplicationNo: string | null;
  // Stage 6 — In Process (parallel sub-processes)
  queryLog: Array<{ raisedAt: Ts; detail: string; resolvedAt: Ts | null }>;
  subProcesses: { pd: SubProcess; technical: SubProcess; valuation: SubProcess; legal: SubProcess; credit: SubProcess };
  // Stage 7 — Sanctioned / Rejected
  amountSanctioned: number | null; roiPct: number | null; tenureMonths: number | null;
  processingFee: number | null; insuranceAmount: number | null; otherCharges: number | null;
  sanctionDate: Ts | null; sanctionLetterPath: string | null; verifiedAppNo: string | null;
  customerDecision: 'ACCEPTED' | 'PENDING' | 'REJECTED' | null;
  // Stage 8 — Disbursement (money engine = Build #2; fields reserved/frozen there)
  amountDisbursed: number | null; disbursementDate: Ts | null; loanAccountNo: string | null;
  disbursalCity: string | null; disbursalState: string | null;
  bt: { isBt: boolean; amount: number | null; date: Ts | null; mode: string | null; kind: 'TOPUP' | 'FINAL' | null } | null;
  secured: { isSecured: boolean; modtDate: Ts | null; agreementDate: Ts | null; mode: string | null } | null;
  // Stage 9 — PDD / OTC
  pddStatus: 'NA' | 'PENDING' | 'PARTIAL' | 'CLEARED';
  otcStatus: 'NA' | 'PENDING' | 'CLEARED';
  pddPendingList: string[];
  // money badge + frozen economics (Build #2)
  payoutStatus: PayoutCycleStatus | 'NOT_DUE';
  payoutCycleId: string | null;
  mappingId: string | null; slabId: string | null; dsaCode: string | null;
  // lifecycle
  stage: LoginStage;
  outcome: 'COMPLETED' | 'REJECTED' | 'WITHDRAWN' | null;
  rejectionReason: string | null;
  applicantIds: string[];              // subset of the case's applicants on this file
  keyDates: { fileLogin: Ts; codeLoginDone: Ts | null; inProcess: Ts | null; sanction: Ts | null;
              disbursement: Ts | null; pddCleared: Ts | null; otcCleared: Ts | null; completed: Ts | null };
  remarks: string | null;
}

export interface Applicant extends Audit {
  type: 'PRIMARY' | 'CO_APPLICANT' | 'GUARANTOR';
  relationshipToPrimary: 'SELF' | 'SPOUSE' | 'FATHER' | 'MOTHER' | 'PARTNER' | 'DIRECTOR' | 'OTHER';
  name: string;
  panEnc: EncryptedField | null; panLast4: string | null;
  /** COMPLIANCE: ONLY the last 4 digits — the API rejects 12-digit Aadhaar input. */
  aadhaarLast4: string | null;
  dob: Ts | null;
  mobile: string; email: string | null; address: Address | null;
  occupation: string | null; incomeMonthly: number | null;
  cibil: { score: number; pulledAt: Ts } | null;
}

export interface DocTrackerRow extends Audit {
  documentDefId: string;
  applicantId: string | null;
  requiredByStage: DocStage;
  status: 'PENDING' | 'REQUESTED' | 'RECEIVED' | 'VERIFIED' | 'REJECTED_REUPLOAD' | 'EXPIRED';
  vaultDocId: string | null;
  requestedAt: Ts | null; receivedAt: Ts | null;
  verifiedBy: string | null;          // FAPL-xxx
  remarks: string | null;
}

export interface StageHistoryEntry {
  from: CaseStage | null;
  to: CaseStage;
  at: Ts;
  by: string;                         // FAPL-xxx
  note: string | null;
}

export interface WealthAddon {
  ucc: string; platform: 'NJ_EWEALTH' | 'BSE_STAR_MF';
  txnType: 'SIP' | 'LUMPSUM' | 'SWITCH' | 'REDEMPTION';
  scheme: string; amount: number; folio: string | null;
  tpinStatus: 'GENERATED' | 'PENDING'; mandateStatus: 'ACTIVE' | 'PENDING' | 'FAILED';
  trailCommissionPct: number | null;
}

export interface InsuranceAddon {
  policyType: 'LIFE' | 'HEALTH' | 'MOTOR' | 'GENERAL';
  insurer: string; sumAssured: number; premium: number;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'SINGLE';
  policyNo: string | null; startDate: Ts | null; endDate: Ts | null;
  status: 'PROPOSAL' | 'ISSUED' | 'LAPSED' | 'RENEWED';
}

// ─── Payout Cycle — SOURCE OF TRUTH for payout ──────────────────────────────────

export type PayoutCycleStatus =
  | 'AWAITING_DATA_SHARE' | 'CONFIRMATION_RAISED' | 'BANKER_CONFIRMED'
  | 'PDD_OTC_HOLD' | 'PAYOUT_CONFIRMED' | 'BILLED' | 'RECEIVED'
  | 'SUBDSA_PAID' | 'CLOSED' | 'DISPUTED';

export interface PayoutCycle extends Audit {
  caseId: string; clientId: string;
  connectorId: string; lenderId: string; subDsaId: string | null;
  dsaCode: string; bankApplicationNo: string | null; loanAccountNo: string | null;
  // frozen economics
  slabId: string;
  disbursedAmount: number; disbursementDate: Ts;
  finvastraPayoutPct: number; expectedGross: number;
  subDsaPayoutPct: number | null; subDsaExpected: number | null;
  expectedTdsPct: number;
  status: PayoutCycleStatus;          // DERIVED — deriveCycleStatus()
  // Step 2 — data shared with aggregator
  dataSharedAt: Ts | null; dataSharedTo: string | null;
  reportingMonth: string | null;      // "2026-05"
  sharingMode: 'MAIL' | 'PORTAL' | null;
  // Step 3 — confirmation raised to bank SM
  confirmationRaisedAt: Ts | null; confirmationRaisedFrom: string | null;
  bankSmAddressed: string | null; connectorCaseRef: string | null;
  // Step 4 — banker confirmation
  bankerConfirmedAt: Ts | null;
  bankerConfirmedBy: { name: string; email: string } | null;
  confirmedAmount: number | null; confirmedDsaCode: string | null;
  pddStatusAtConfirmation: string | null;
  bankerMismatch: boolean;            // server-derived
  // Step 5 — PDD/OTC clearance
  pddOtcClearedMonth: string | null;
  holdFlag: boolean; holdReason: string | null;
  // Step 6 — payout confirmation by aggregator
  payoutConfirmedAt: Ts | null;
  confirmedPayoutPct: number | null; confirmedGross: number | null;
  pctVariance: boolean;               // server-derived
  // Step 7 — bill raised
  billNo: string | null; billDate: Ts | null;
  billGross: number | null; billGst: number | null; billGstin: string | null;
  billedToEntity: string | null;
  billSentAt: Ts | null; billMode: 'MAIL' | 'PORTAL' | null;
  billStoragePath: string | null;
  // Step 8 — payout received
  receivedAt: Ts | null; receivedNet: number | null;
  tdsDeducted: number | null; utr: string | null;
  receivedInAccount: string | null;
  amountVariance: number | null;      // server-derived
  varianceReason: string | null;
  // Step 9 — sub-DSA leg
  subDsaBillNo: string | null; subDsaBillDate: Ts | null;
  subDsaBillAmount: number | null; subDsaApprovedBy: string | null;
  subDsaPaidAt: Ts | null; subDsaPaidAmount: number | null;
  subDsaTds: number | null; subDsaUtr: string | null;
  // Step 10 — closure
  closedAt: Ts | null;
  netMarginRealised: number | null;   // server-derived
  // ageing — server-recomputed on every write
  ageing: { disbToDataShare: number | null; disbToBankerConfirm: number | null;
            disbToBilled: number | null; disbToReceived: number | null };
  disputeFlag: boolean; disputeNotes: string | null;
}

// ─── MIS projection (doc ID == case ID; server-only) ───────────────────────────

export interface MisRecord {
  reportingMonth: string;
  caseId: string; payoutCycleId: string;
  partyName: string; city: string; state: string;
  productCode: string; lenderName: string; connectorName: string; dsaCode: string;
  subDsaId: string | null; subDsaName: string | null;
  handlingRmId: string; handlingRmName: string;
  connectorId: string; lenderId: string;
  bankApplicationNo: string | null; loanAccountNo: string | null;
  disbursedAmount: number; disbursementDate: Ts;
  roiPct: number | null; processingFee: number | null;
  finvastraPayoutPct: number; expectedGross: number;
  bankerConfirmedAt: Ts | null; pddOtcClearedMonth: string | null;
  billNo: string | null; billDate: Ts | null; billGross: number | null;
  receivedAt: Ts | null; receivedNet: number | null;
  tdsDeducted: number | null; utr: string | null;
  subDsaPayoutPct: number | null; subDsaPaidAmount: number | null;
  subDsaPaidAt: Ts | null; subDsaUtr: string | null;
  netMargin: number | null;
  cycleStatus: PayoutCycleStatus;
  ageingDays: number | null;
  updatedAt: Ts;
}
