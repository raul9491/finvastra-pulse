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
  opsPoc: { name: string; email: string; mobile: string } | null;
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
  connectorId: string;                // aggregators/{id}
  lenderId: string;
  dsaCode: string;                    // bank-dump match key
  codeRegisteredName: string;         // recon string-match
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
  | 'NEW' | 'ATTEMPTED' | 'CONTACTED' | 'QUALIFIED' | 'JUNK_DUPLICATE'
  | 'NOT_INTERESTED' | 'CONVERTED' | 'DROPPED';
export type Crm2LeadSource =
  | 'WEBSITE' | 'JUSTDIAL' | 'REFERRAL_CLIENT' | 'REFERRAL_SUBDSA' | 'ADS' | 'WALKIN' | 'COLD_CALL';

export interface Crm2LeadFields {
  receivedAt: Ts;
  category: Crm2LeadCategory;
  productId: string | null;
  name: string; mobile: string; email: string | null; city: string | null;
  source: Crm2LeadSource;
  sourceMeta: { formId: string | null; sourceUrl: string | null;
                utm: { source?: string; medium?: string; campaign?: string } | null };
  amountRequired: number | null;
  referredById: string | null;        // subDsaId or clientId
  referredByType: 'SUBDSA' | 'CLIENT' | null;
  referredByName: string | null;      // denormalised label (sub-DSA / referring client name)
  referredByCode: string | null;      // SDSA-### code (for REFERRAL_SUBDSA), shown on the lead
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
  handlingRm: string;                 // FAPL-xxx
  subDsaId: string | null;            // "Sourced By"; null = self-sourced
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
  stage: CaseStage;
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
}

/** cases/{id}/private/payout — money mirror, readable only with payout.amounts.read. */
export interface CasePayoutMirror {
  finvastraPayoutPct: number | null; finvastraPayoutExpected: number | null;
  subDsaPayoutPct: number | null; subDsaPayoutExpected: number | null;
  netMarginExpected: number | null;
  updatedAt: Ts;
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
