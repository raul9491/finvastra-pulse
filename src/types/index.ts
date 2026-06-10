// ─── Auth & User ───────────────────────────────────────────────────────────

export type Role = 'admin' | 'employee';

// CRM-specific roles (separate from the HRMS admin/employee role above)
// 'viewer' = read-only CRM access (sees all data, cannot create/edit/delete)
export type CrmRole = 'admin' | 'manager' | 'lead_generator' | 'lead_convertor' | 'viewer' | null;
export type ConvertorVertical = 'loan' | 'wealth' | 'insurance' | null;

export type EmployeeStatus = 'active' | 'inactive';

export interface BankAccount {
  name: string | null;
  branch: string | null;
  accountNumber: string | null;
  ifsc: string | null;
}

// Stored in /employee_profiles/{empCode} — HR/admin only.
// Account numbers are encrypted server-side and never sent to the browser.
// Aadhaar number is never stored here or anywhere else (UIDAI prohibition).
export interface EmployeeProfile {
  uid: string;                          // = empCode
  dob: string | null;
  uan: string | null;
  presentAddress: string | null;
  permanentAddress: string | null;
  personalEmail: string | null;
  personalPhone: string | null;
  // Bank meta (non-account fields — safe to show)
  personalBankName: string | null;
  personalBankBranch: string | null;
  personalBankIfsc: string | null;
  officialBankName: string | null;
  officialBankBranch: string | null;
  officialBankIfsc: string | null;
  // Encrypted blobs — present server-side only, typed as object client-side
  panEncrypted?: object;
  personalBankAccountEncrypted?: object;
  officialBankAccountEncrypted?: object;
  // Aadhaar compliance — verification record only, number never stored
  aadhaarVerified: boolean;
  aadhaarVerifiedOn: string | null;     // DD-MM-YYYY
  aadhaarVerifiedBy: string | null;     // empCode of HR who verified
  aadhaarDriveLink: string | null;
  updatedAt?: import('firebase/firestore').Timestamp;
  createdAt?: import('firebase/firestore').Timestamp;
}

// Stored in /employee_sensitive/{userId} — readable only by admin or the employee themselves
export interface EmployeeSensitive {
  userId: string;
  personalBank?: BankAccount;
  officialBank?: BankAccount;  // salary credit account
  updatedAt?: import('firebase/firestore').Timestamp;
}

export interface UserProfile {
  userId: string;
  employeeId?: string;
  email: string;
  displayName: string;
  role: Role;
  photoURL: string;
  department?: string;
  designation?: string;
  managerId?: string;
  joiningDate?: string;        // YYYY-MM-DD
  location?: string;
  reportingManagerName?: string;
  employeeStatus?: EmployeeStatus;
  // Module access flags. Absent field is treated as the safe default:
  // hrmsAccess absent → true (everyone gets HRMS self-service)
  // crmAccess  absent → false (only RMs explicitly granted access)
  hrmsAccess?: boolean;
  crmAccess?: boolean;
  hasCalendarAccess?: boolean;
  // CRM role determines lead routing and access patterns
  crmRole?: CrmRole;
  // Only set when crmRole === 'lead_convertor'; drives handoff matching
  convertorVertical?: ConvertorVertical;                       // legacy single (kept for back-compat reads)
  convertorVerticals?: ('loan' | 'wealth' | 'insurance')[];    // multi — a convertor can cover several business lines
  needsEmailSetup?: boolean;   // true = no @finvastra.com email yet; cannot log in
  mustResetPassword?: boolean; // true = forced reset on first login
  isHrmsManager?: boolean;    // grants leave approval + admin attendance override
  crmCanImport?: boolean;     // can trigger bulk Sheet imports (default: only managers; admin can grant individually)
  misAccess?: MisAccess;
  commandCentreAccess?: boolean; // grants the cross-module Command Centre (admins always have it)
  createdAt?: import('firebase/firestore').Timestamp;
}

// Stored in /user_details/{userId} — readable only by admin, HRMS manager, or the employee themselves.
// Keeps personal contact info and HR data out of the world-readable /users collection.
export interface UserDetails {
  phone?: string;
  officialPhone?: string;
  personalEmail?: string;
  dateOfBirth?: string;        // MM-DD format
  presentAddress?: string;
  permanentAddress?: string;
  lastWorkingDate?: string;    // YYYY-MM-DD
  gender?: string;
  bloodGroup?: string;
  fatherMotherName?: string;
  spouseName?: string;
  // Emergency contact — self-service editable by the employee themselves
  emergencyContactName?:         string;
  emergencyContactPhone?:        string;
  emergencyContactRelationship?: string;
  updatedAt?: import('firebase/firestore').Timestamp;
}

// ─── Access Requests ─────────────────────────────────────────────────────────

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected';

export interface AccessRequest {
  id: string;
  fullName: string;
  personalEmail: string;
  mobileNumber: string;
  department: string;
  designation: string;
  message: string;
  status: AccessRequestStatus;
  submittedAt: import('firebase/firestore').Timestamp;
  reviewedBy: string | null;
  reviewedAt: import('firebase/firestore').Timestamp | null;
  rejectionReason: string | null;
  createdUid: string | null;
}

// ─── MIS: Commission Reconciliation ──────────────────────────────────────────

export type MisAccess = 'admin' | 'viewer';

export type CommissionStatementStatus =
  | 'imported' | 'reconciling' | 'reconciled' | 'discrepancy' | 'closed';

export type StatementLineStatus =
  | 'unmatched' | 'matched' | 'discrepancy' | 'unknown' | 'excluded';

export interface CommissionStatement {
  id: string;
  providerId: string;
  source: 'bank' | 'amc' | 'insurer';
  periodStart: string;   // YYYY-MM
  periodEnd: string;     // YYYY-MM
  statementDate: string; // YYYY-MM-DD
  receivedDate: string;  // YYYY-MM-DD
  fileName: string;
  fileUploadedAt: any;
  totalAmount: number;
  lineCount: number;
  matchedCount: number;
  discrepancyCount: number;
  unmatchedCount: number;
  status: CommissionStatementStatus;
  importedBy: string;
  importedAt: any;
  closedBy: string | null;
  closedAt: any | null;
  notes: string;
}

export interface StatementLine {
  id: string;
  statementId: string;
  providerId: string;
  rawDate: string;
  rawDescription: string;
  rawAmount: string;
  parsedDate: string;    // YYYY-MM-DD
  parsedAmount: number;
  matchedCommissionRecordId: string | null;
  matchedOpportunityId: string | null;
  discrepancyAmount: number | null;
  status: StatementLineStatus;
  reconciledBy: string | null;
  reconciledAt: any | null;
  notes: string;
}

export interface RmPayoutSlab {
  id: string;
  targetType: 'user' | 'role';
  targetId: string;   // userId OR crmRole value (e.g. 'lead_convertor')
  businessLine: 'loan' | 'wealth' | 'insurance';
  percentage: number; // 0-100
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  createdBy: string;
  createdAt: any;
}

export interface RmPayoutLineItem {
  commissionRecordId: string;
  opportunityId: string;
  leadId: string;
  providerId: string;
  providerName: string;
  product: string;
  receivedAmount: number;
  payoutPercentage: number;
  payoutAmount: number;
}

export interface RmPayout {
  id: string;
  rmId: string;
  rmDisplayName: string;
  periodStart: string;   // YYYY-MM
  periodEnd: string;     // YYYY-MM
  lineItems: RmPayoutLineItem[];
  totalReceivedBase: number;
  totalPayout: number;
  status: 'draft' | 'approved' | 'paid';
  generatedAt: any;
  generatedBy: string;
  approvedBy: string | null;
  approvedAt: any | null;
  paidAt: any | null;
  paymentReference: string | null;
  paymentNotes: string | null;
}

// ─── HRMS ────────────────────────────────────────────────────────────────────

export type HrmsRole = 'admin' | 'manager' | 'employee';

// ─── Leave ─────────────────────────────────────────────────────────────────

export type LeaveType = 'casual' | 'sick' | 'earned' | 'lop' | 'optional' | 'comp_off' | 'maternity';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveApplication {
  id: string;
  employeeId: string;
  type: LeaveType;
  fromDate: string;   // YYYY-MM-DD
  toDate: string;     // YYYY-MM-DD
  days: number;       // working days (Sundays + holidays excluded; Mon–Sat working week)
  reason: string;
  status: LeaveStatus;
  appliedAt: import('firebase/firestore').Timestamp;
  approvedBy: string | null;
  approvedAt: import('firebase/firestore').Timestamp | null;
  rejectionReason: string | null;
  calendarEventId: string | null;
}

export interface LeaveBalance {
  employeeId: string;
  year: number;
  casual:    { total: number; used: number; remaining: number };
  sick:      { total: number; used: number; remaining: number };
  earned:    { total: number; used: number; remaining: number };
  // Optional: only present when comp off has been allocated. Existing docs without this field
  // continue to work — the balance edit modal initialises it to 0 if missing.
  comp_off?: { total: number; used: number; remaining: number };
}

// ─── Leave Year-End Reset ─────────────────────────────────────────────────────

/** Summary record written to /leave_year_resets/{year} when a year-end reset completes. */
export interface LeaveYearReset {
  year:               number;
  resetAt:            import('firebase/firestore').Timestamp;
  resetBy:            string;   // uid
  resetByName:        string;
  employeesProcessed: number;
  errorCount:         number;
  notes:              string | null;
}

/** Immutable audit entry written to /leave_balance_adjustments/{id} on every balance change. */
export interface LeaveBalanceAdjustment {
  employeeId:      string;
  year:            number;
  type:            'year_end_reset' | 'manual_adjustment' | 'comp_off_grant' | 'encashment';
  prevYear?:       number;
  elCarryForward?: number;
  before:          Record<string, { total: number; used: number; remaining: number }> | null;
  after:           Record<string, { total: number; used: number; remaining: number }>;
  adjustedBy:      string;
  adjustedByName:  string;
  adjustedAt:      import('firebase/firestore').Timestamp;
  notes:           string | null;
}

// ─── Leave Encashment Requests ────────────────────────────────────────────────

export type EncashmentStatus = 'pending' | 'approved' | 'rejected' | 'paid';

export interface LeaveEncashmentRequest {
  id:              string;
  employeeId:      string;
  employeeName:    string;
  leaveDays:       number;    // days being encashed
  dailyRate:       number;    // ₹ (grossSalary / 26)
  grossSalary:     number;    // ₹ gross monthly salary as entered by employee
  totalAmount:     number;    // leaveDays × dailyRate
  reason:          string;
  month:           string;    // YYYY-MM — payroll month for which this should be processed
  status:          EncashmentStatus;
  submittedAt:     import('firebase/firestore').Timestamp;
  approvedBy:      string | null;
  approvedAt:      import('firebase/firestore').Timestamp | null;
  rejectionReason: string | null;
  paidAt:          import('firebase/firestore').Timestamp | null;
  paymentReference: string | null;
  notes:           string | null;
}

// ─── Attendance ─────────────────────────────────────────────────────────────

export type AttendanceStatus = 'present' | 'half_day' | 'absent' | 'leave' | 'holiday';

export interface Attendance {
  id: string;
  userId: string;
  date: string;           // YYYY-MM-DD
  checkIn: import('firebase/firestore').Timestamp | null;
  checkOut: import('firebase/firestore').Timestamp | null;
  workingHours: number;
  status: AttendanceStatus;
  markedBy: 'self' | 'admin';
  notes: string;
  createdAt: import('firebase/firestore').Timestamp;
  updatedAt: import('firebase/firestore').Timestamp;
}

// ─── Payslip ─────────────────────────────────────────────────────────────────

export interface Payslip {
  id: string;
  employeeId: string;
  month: string;            // YYYY-MM
  basicSalary: number;
  hra: number;
  conveyanceAllowance: number;
  medicalAllowance: number;
  otherAllowances: number;
  totalEarnings: number;
  pf: number;
  professionalTax: number;
  tds: number;
  otherDeductions: number;
  totalDeductions: number;
  netPay: number;
  workingDays: number;
  presentDays: number;
  lopDays: number;
  generatedAt: import('firebase/firestore').Timestamp;
  generatedBy: string;
  notes: string;
}

// ─── Payslip Extras ──────────────────────────────────────────────────────────
//
// Optional supplementary fields for PDF generation.
// Fetched from employee_sensitive, user_details, and leave_balances at download time.
// All fields are optional — the PDF falls back to "—" when absent.

export interface PayslipExtras {
  gender?:           string;
  /** Pre-masked PAN string e.g. "ABCDE****F". Absent → shows "On file" in PDF. */
  panMasked?:        string;
  bankName?:         string;        // official salary-credit bank name
  bankAccountLast4?: string;        // last 4 digits of salary account number
  pfNumber?:         string;        // EPFO PF member ID (e.g. CBSLM00479350000024243)
  uan?:              string;        // Universal Account Number
  joiningDate?:      string;        // YYYY-MM-DD — from UserProfile
  location?:         string;        // default "Hyderabad"
  leaveBalance?: {
    sick:    { credited: number; availed: number; closing: number };
    casual:  { credited: number; availed: number; closing: number };
    earned:  { credited: number; availed: number; closing: number };
  };
}

// ─── CRM: Leads (person record) ──────────────────────────────────────────────

export type LeadSource = 'website' | 'instagram' | 'facebook' | 'walkin' | 'referral' | 'broker' | 'offline_bulk' | 'social_meta' | 'employee_referral';
export type ConsentMethod = 'verbal' | 'written' | 'digital' | 'offline_collection';
export type TriagePriority = 'high' | 'medium' | 'low';

export type LeadStatus =
  | 'new' | 'interested' | 'callback'
  | 'not_interested' | 'no_response' | 'wrong_number' | 'converted';

export interface Lead {
  id: string;
  displayName: string;
  phone: string;
  email?: string;
  panRaw?: string;
  panEncrypted?: {           // AES-256-GCM encrypted PAN (replaces panRaw in Phase 2.8 migration)
    ciphertext: string;
    iv: string;
    tag: string;
    keyVersion: number;
  };
  panMasked?: string;        // Pre-computed masked version (server writes this alongside panEncrypted)
  source: LeadSource;
  tags: string[];
  referrerName?: string;
  monthlyIncome?: number;      // ₹ per month — used for FOIR calculation
  existingEmis?: number;       // ₹ per month total of all existing EMIs
  primaryOwnerId: string;
  // Connector (channel partner / DSA) who sourced this customer. Selected on the
  // New Customer form; flows to the commission record → MIS. See Connector type.
  connectorId?: string;
  connectorCode?: string;   // FAC-### — denormalised for display
  connectorName?: string;
  // Compliance — mandatory per DPDP Act 2023
  consentGiven: true;
  consentTimestamp: any;
  consentMethod: ConsentMethod;
  // SLA & triage — set at creation; slaDeadline is a Firestore Timestamp
  slaDeadline?: any;
  triagePriority?: TriagePriority;
  // Employee referral provenance — UID of HRMS employee who submitted this lead.
  // Preserved after primaryOwnerId is reassigned; drives read access in Firestore rules.
  referredBy?: string;
  // Telecaller disposition — for leads worked before any opportunity exists
  leadStatus?: LeadStatus;
  leadStatusAt?: any;
  leadStatusBy?: string;
  // Callback scheduling — set when leadStatus === 'callback'
  callbackAt?: string;             // ISO datetime the customer asked to be called back
  callbackReminderSent?: boolean;  // server sets true once the due reminder has fired
  // Bulk import provenance fields
  importBatchId?: string;
  importName?: string;    // denormalised batch label for source-quality analysis
  importHash?: string;    // SHA256(phone|email|displayName) for idempotency
  importedBy?: string;
  importedAt?: any;
  createdAt: any;
  createdBy: string;
  updatedAt?: any;
  deleted: boolean;
  deletedAt?: any;
}

// ─── CRM: Opportunities (deal record) ────────────────────────────────────────

export type OpportunityType = 'loan' | 'wealth' | 'insurance';

export type LoanProductId =
  | 'home_loan'
  | 'lap'
  | 'personal_loan'
  | 'business_loan_secured'
  | 'business_loan_unsecured'
  | 'education_loan'
  | 'auto_loan';

export type DocumentTypeId = string;
export type DocumentStatus = 'pending' | 'collected' | 'submitted' | 'accepted' | 'rejected';

export interface ConditionalDocumentRule {
  when: { field: string; equals: string };
  addDocuments: DocumentTypeId[];
}

export interface CustomFieldDefinition {
  type: 'text' | 'number' | 'enum' | 'boolean' | 'date';
  label: string;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
}
export type OpportunityStatus = 'open' | 'won' | 'lost';

export interface Opportunity {
  id: string;
  opportunityType: OpportunityType;
  product: string;       // matches OpportunityTypeConfig.name
  dealSize: number;
  stage: string;         // from OpportunityTypeConfig.stages[]
  ownerId: string;
  status: OpportunityStatus;
  expectedCloseDate?: string;
  actualCloseDate?: string;
  notes?: string;
  lostDetails?: LostDetails;
  customFields?: Record<string, unknown>;
  // Connector who sourced this case (channel partner / DSA) — see Connector below.
  connectorId?: string;
  connectorCode?: string;   // FAC-### — denormalised for display
  connectorName?: string;   // denormalised so CRM views show it without a lookup
  createdAt: any;
  updatedAt: any;
}

// ─── CRM: Bank Submissions ───────────────────────────────────────────────────

export type BankSubmissionStatus =
  | 'preparing'
  | 'submitted'
  | 'in_review'
  | 'sanctioned'
  | 'disbursed'
  | 'rejected';

export interface BankSubmissionHistoryEntry {
  from: BankSubmissionStatus;
  to: BankSubmissionStatus;
  at: string; // ISO string — client timestamp; serverTimestamp() can't go inside arrays
  by: string;
  notes?: string;
}

export interface BankSubmission {
  id: string;
  providerId: string;        // references /providers
  status: BankSubmissionStatus;
  requestedAmount?: number;
  sanctionedAmount?: number;
  disbursedAmount?: number;
  interestRate?: number;     // percentage
  tenureMonths?: number;
  submittedAt?: any;
  decisionAt?: any;
  disbursedAt?: any;
  isPrimary: boolean;        // true = this is the primary disbursement; triggers opp win
  rejectionReason?: string;
  notes?: string;
  documentStatus?: Record<DocumentTypeId, DocumentStatus>;
  documentStatusLog?: Array<{
    docTypeId: DocumentTypeId;
    from: DocumentStatus;
    to: DocumentStatus;
    by: string;
    at: string;
  }>;
  statusHistory: BankSubmissionHistoryEntry[];
  createdAt: any;
  createdBy: string;
  updatedAt: any;
}

// ─── CRM: Commission Slabs ───────────────────────────────────────────────────

export interface CommissionSlab {
  id: string;
  providerId: string;         // FK → /providers, must be type:'bank'
  product: string;            // loan product name — matches Opportunity.product exactly
  minTicket: number;          // ₹ lower bound (inclusive)
  maxTicket: number | null;   // ₹ upper bound (inclusive); null = no limit
  percentage?: number;        // e.g. 0.5 means 0.5%; mutually exclusive with flatFee
  flatFee?: number;           // ₹; mutually exclusive with percentage
  basisOn: 'sanctioned' | 'disbursed';
  effectiveFrom: string;      // yyyy-MM-dd
  effectiveTo: string | null; // yyyy-MM-dd; null = open-ended
  notes?: string;
  active: boolean;
  createdAt: any;
  updatedAt: any;
  lastModifiedBy: string;
}

// ─── CRM: Commission Records ──────────────────────────────────────────────────

export type CommissionRecordStatus = 'pending' | 'paid' | 'clawed_back';

export interface CommissionRecord {
  id: string;
  leadId: string;
  opportunityId: string;
  submissionId: string;       // FK chain for full traceability
  providerId: string;
  rmOwnerId: string;          // RM who owns the opportunity (for per-RM reports)
  // Connector who sourced the case (from the opportunity, else the lead) — lets MIS
  // track which channel partner each commission belongs to, through to payout.
  connectorId?: string;
  connectorCode?: string;
  connectorName?: string;
  slabId: string | null;      // null when NO_SLAB_MATCH
  basisAmount: number;        // disbursedAmount or sanctionedAmount used
  calculatedCommission: number;
  status: CommissionRecordStatus;
  expectedPayoutDate: string; // yyyy-MM-dd (disbursedAt + 30 days default)
  actualPayoutDate?: string;
  actualAmount?: number;      // may differ from calculated; tracks variance
  clawbackReason?: string;
  notes?: string;
  createdAt: any;
  paidAt?: any;
}

// ─── CRM: Config collections ──────────────────────────────────────────────────

export interface OpportunityTypeConfig {
  id: string;
  name: string;
  businessLine: OpportunityType;
  stages: string[];   // ordered, excluding 'Lost' which is always available
  active: boolean;
  customFieldsSchema?: Record<string, CustomFieldDefinition>;
  requiredDocuments?: DocumentTypeId[];
  conditionalDocuments?: ConditionalDocumentRule[];
  eligibleProviderIds?: string[];
}

export type ProviderType = 'bank' | 'amc' | 'life_insurer' | 'general_insurer';

export interface EligibilityRule {
  minCibilScore?: number;
  minMonthlyIncome?: number;
  maxFoirPct?: number;
  allowedEmployerTypes?: string[];
  allowedBusinessTypes?: string[];
  minBusinessVintageYears?: number;
  maxTicketSize?: Partial<Record<string, number>>;
  notes?: string;
}

export type EligibilityVerdict = 'likely' | 'possible' | 'unlikely';

export interface EligibilityResult {
  providerId: string;
  providerName: string;
  verdict: EligibilityVerdict;
  reasons: string[];
}

export type FOIRStatus = 'comfortable' | 'acceptable' | 'tight' | 'risky';

export interface FOIRResult {
  proposedEmi: number;
  totalObligationsAfter: number;
  foirPct: number;
  status: FOIRStatus;
  suggestions: string[];
}

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  active: boolean;
  eligibleProducts?: string[];
  typicalTurnaroundDays?: {
    submitted_to_in_review: number;
    in_review_to_sanctioned: number;
    sanctioned_to_disbursed: number;
  };
  eligibilityRules?: EligibilityRule;
}

export interface DocumentType {
  id: string;
  label: string;
  description?: string;
}

// ─── CRM: Activities (subcollection on opportunities) ────────────────────────

export type ActivityType =
  | 'call' | 'email' | 'whatsapp' | 'meeting' | 'note'
  | 'status_change' | 'ownership_change' | 'commission_calculated';

export interface Activity {
  id: string;
  type: ActivityType;
  content: string;
  by: string;
  at: any;
  relatedDocId?: string;
}

// ─── Bulk Import ─────────────────────────────────────────────────────────────

export type ImportJobStatus = 'processing' | 'completed' | 'failed' | 'partial';

export interface ImportJobError {
  row: number;
  data: Record<string, string>;
  reason: string;
}

export interface ImportJob {
  id: string;
  totalRows: number;
  processedRows: number;
  successCount: number;
  errorCount: number;
  status: ImportJobStatus;
  startedAt: any;
  completedAt?: any;
  triggeredBy: string;
  batchId: string;   // YYYY-MM-DD-xxxx
  sheetId: string;
  skipErrors: boolean;
  errors: ImportJobError[];  // capped at 1000 entries
  // Mandatory label for tracking a sheet's source/quality (set at import time)
  importName: string;
  // Two-stage distribution: leads land UNASSIGNED, then distributed from the queue
  distributed?: boolean;
  distributedAt?: any;
  distributedBy?: string;
  distributedCount?: number;
  agentIds?: string[];   // agents the batch was distributed across
}

// ─── Notifications ───────────────────────────────────────────────────────────

export type NotificationType =
  | 'leave_approved'
  | 'leave_rejected'
  | 'leave_pending'
  | 'payroll_processed'
  | 'announcement'
  | 'follow_up_needed'
  | 'system';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: any;
  metadata?: Record<string, any>;
}

// ─── Performance & Target Tracking (Phase N) ─────────────────────────────────

export interface RmTarget {
  rmId: string;
  rmName: string;
  period: string;            // YYYY-MM
  targets: {
    newLeads: number;
    leadsConverted: number;
    disbursalAmount: number;
    commissionGenerated: number;
  };
  setBy: string;
  setAt: any;
}

export interface RmActuals {
  newLeads: number;
  leadsConverted: number;
  disbursalAmount: number;
  commissionGenerated: number;
}

export type LeadAgingBucket = 'fresh' | 'active' | 'aging' | 'stale';

export interface ScorecardLog {
  id?: string;
  rmId: string;
  period: string;            // YYYY-MM
  storageUrl: string;
  sentAt: any;
  generatedBy: string;       // 'scheduler' | uid
}

export interface StatementTemplate {
  id?: string;
  bankId: string;            // matches /providers/{id}
  bankName: string;
  columnMappings: {
    date: string;
    description: string;
    amount: string;
    referenceNumber: string | null;
  };
  dateFormat: string;        // 'DD/MM/YYYY' | 'YYYY-MM-DD' | ...
  skipRows: number;
  amountMultiplier: 1 | -1;
  createdAt: any;
  updatedAt: any;
}

// ─── Announcements ───────────────────────────────────────────────────────────

export type AnnouncementPriority = 'normal' | 'important' | 'urgent';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  publishedBy: string;
  publishedByName: string;
  publishedAt: import('firebase/firestore').Timestamp;
  expiresAt: import('firebase/firestore').Timestamp | null;
  isActive: boolean;
  pinned: boolean;
  readBy: string[];   // array of userIds who dismissed/read
}

// ─── Claims & Reimbursements ──────────────────────────────────────────────────

export type ClaimType = 'travel' | 'mobile' | 'medical' | 'petrol' | 'client_entertainment' | 'cibil' | 'software' | 'office_supplies' | 'other';
export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'paid';

export interface ClaimTravelDetails {
  fromLocation: string;
  toLocation: string;
  distanceKm: number;
  modeOfTransport: string;
}

export interface Claim {
  id: string;
  employeeId: string;
  employeeName: string;
  claimType: ClaimType;
  amount: number;
  description: string;
  travelDetails?: ClaimTravelDetails;
  receiptUrl: string | null;
  submittedAt: import('firebase/firestore').Timestamp;
  status: ClaimStatus;
  approvedBy: string | null;
  approvedAt: import('firebase/firestore').Timestamp | null;
  rejectionReason: string | null;
  paidAt: import('firebase/firestore').Timestamp | null;
  paymentReference: string | null;
  month: string;   // YYYY-MM submission month for filtering
  expenseDate?: string | null;   // ISO datetime the expense/bill actually occurred (spend analysis)
}

// ─── Company Document Library ─────────────────────────────────────────────────

export type CompanyDocumentCategory = 'policy' | 'handbook' | 'circular';

export interface CompanyDocument {
  id: string;
  title: string;
  category: CompanyDocumentCategory;
  description: string;
  fileUrl: string;
  uploadedBy: string;
  uploadedAt: import('firebase/firestore').Timestamp;
  isActive: boolean;
  financialYear: string | null;
  // Policy acknowledgement — optional; absent = false on legacy docs
  requiresAcknowledgement?: boolean;
  acknowledgementDeadlineDays?: number | null;  // days after upload by which all must ack
}

// ─── Policy Acknowledgements ──────────────────────────────────────────────────
// Collection: /document_acknowledgements/{recordId}
// Immutable record of an employee digitally acknowledging a policy document.

export interface DocumentAcknowledgement {
  id: string;
  documentId: string;
  documentTitle: string;
  employeeId: string;
  employeeName: string;
  acknowledgedAt: import('firebase/firestore').Timestamp;
  method: 'checkbox';   // digital tick-box consent
}

export type EmployeeDocumentType =
  | 'offer_letter'
  | 'appointment_letter'
  | 'increment_letter'
  | 'promotion_letter'
  | 'experience_letter'
  | 'relieving_letter'
  | 'form_16';

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  documentType: EmployeeDocumentType;
  title: string;
  fileUrl: string;
  uploadedBy: string;
  uploadedAt: import('firebase/firestore').Timestamp;
  financialYear: string | null;
  isActive: boolean;
}

// ─── Statutory Compliance ─────────────────────────────────────────────────────

// Category — drives the icon/colour. The specific obligation is in `title`.
// (Legacy per-item values like 'tds_deposit' may still exist on old records; the
//  UI falls back to a generic meta for any value not in this set.)
export type ComplianceType =
  | 'tds' | 'gst' | 'income_tax' | 'pt' | 'pf' | 'esi' | 'mca' | 'payroll';

export type ComplianceStatus = 'upcoming' | 'due_soon' | 'overdue' | 'filed';

export interface ComplianceRecord {
  id: string;
  type: ComplianceType;
  title?: string;              // specific obligation, e.g. "GSTR-1" — `type` is the category
  seedVersion?: number;        // schedule version that created this row; drives auto-resync
  month: string;               // YYYY-MM — the month the filing is DUE
  year: number;
  dueDate: string;             // YYYY-MM-DD
  description: string;
  amount: number | null;
  status: ComplianceStatus;
  filedAt: import('firebase/firestore').Timestamp | null;
  filedBy: string | null;
  referenceNumber: string | null;
  notes: string | null;
  createdAt: import('firebase/firestore').Timestamp;
}

// ─── Holidays ─────────────────────────────────────────────────────────────────

export interface Holiday {
  id: string;
  date: string;    // YYYY-MM-DD
  name: string;
  type: 'national' | 'regional' | 'optional';
  year: number;
}

// ─── Sensitive Data Access Logs ──────────────────────────────────────────────

export type AccessLogAction = 'pan_view' | 'phone_view' | 'document_view';

export interface AccessLog {
  id: string;
  actorId: string;
  actorEmail: string;
  action: AccessLogAction;
  targetType: 'lead' | 'opportunity';
  targetId: string;
  accessedAt: any;
  ipAddress?: string;
  userAgent?: string;
}

// ─── Lost Reason (Phase 2.6+ Competitor Intelligence) ─────────────────────────

export type LostReason =
  | 'lower_rate_competitor'
  | 'faster_approval_competitor'
  | 'better_terms_competitor'
  | 'customer_changed_mind'
  | 'insufficient_eligibility'
  | 'documents_unavailable'
  | 'no_response_from_customer'
  | 'other';

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  lower_rate_competitor:       'Lower rate from competitor',
  faster_approval_competitor:  'Faster approval from competitor',
  better_terms_competitor:     'Better terms from competitor',
  customer_changed_mind:       'Customer changed mind',
  insufficient_eligibility:    'Insufficient eligibility',
  documents_unavailable:       'Documents unavailable',
  no_response_from_customer:   'No response from customer',
  other:                       'Other',
};

export interface LostDetails {
  reason: LostReason;
  competitorName?: string;
  competitorRate?: number;   // % (e.g. 8.5)
  notes?: string;
  capturedAt: any;
  capturedBy: string;
}

// ─── Recruitment ─────────────────────────────────────────────────────────────

export type CandidateStage =
  | 'applied' | 'shortlisted' | 'interview_1' | 'interview_2'
  | 'offer_made' | 'hired' | 'rejected';

export type CandidateSource =
  | 'referral' | 'walk_in' | 'linkedin' | 'naukri' | 'job_portal' | 'other';

export type JobOpeningStatus = 'open' | 'on_hold' | 'closed';

export interface JobOpening {
  id: string;
  title: string;               // matches DESIGNATIONS
  department: string;          // matches DEPARTMENTS
  location: string | null;
  description: string | null;
  openedDate: string;          // YYYY-MM-DD
  targetHireDate: string | null;
  status: JobOpeningStatus;
  hiresRequired: number;
  hiresCompleted: number;
  createdBy: string;
  createdAt: import('firebase/firestore').Timestamp;
  updatedAt: import('firebase/firestore').Timestamp;
}

export interface CandidateStageEntry {
  from: CandidateStage;
  to: CandidateStage;
  at: import('firebase/firestore').Timestamp;
  by: string;
  notes?: string;
}

export interface Candidate {
  id: string;
  openingId: string;
  openingTitle: string;    // denormalized for display
  name: string;
  phone: string;
  email: string | null;
  currentDesignation: string | null;
  currentCompany: string | null;
  source: CandidateSource;
  resumeLink: string | null;
  stage: CandidateStage;
  rejectionReason: string | null;
  notes: string | null;
  expectedJoiningDate: string | null;  // YYYY-MM-DD
  offeredCTC: number | null;
  addedBy: string;
  addedAt: import('firebase/firestore').Timestamp;
  updatedAt: import('firebase/firestore').Timestamp;
  stageHistory: CandidateStageEntry[];
}

// ─── Asset Management ────────────────────────────────────────────────────────

export type AssetType = 'laptop' | 'sim_card' | 'mobile_phone' | 'access_card' | 'mouse' | 'visiting_card' | 'id_card' | 'other';
export type AssetStatus = 'available' | 'assigned' | 'under_repair' | 'retired';
export type AssetCondition = 'good' | 'fair' | 'damaged';

export interface Asset {
  id: string;
  assetType: AssetType;
  assetName: string;
  serialNumber: string | null;
  imei: string | null;          // mobile_phone only
  simNumber: string | null;     // sim_card only
  phoneNumber: string | null;   // sim_card only
  purchaseDate: string | null;  // YYYY-MM-DD
  purchaseValue: number | null;
  currentStatus: AssetStatus;
  assignedTo: string | null;    // uid
  assignedToName: string | null;
  assignedDate: string | null;  // YYYY-MM-DD
  returnedDate: string | null;  // YYYY-MM-DD
  condition: AssetCondition;
  notes: string | null;
  addedBy: string;
  addedAt: import('firebase/firestore').Timestamp;
  updatedAt: import('firebase/firestore').Timestamp;
}

// ─── Connectors (channel partners / DSAs) ─────────────────────────────────────
// External partners who source loan / insurance / wealth cases. NOT employees —
// no Google Workspace login. Managed in HRMS; their name populates in CRM when a
// case is added. Code scheme: FAC-### (auto-incremented).

export type ConnectorVertical = 'loan' | 'wealth' | 'insurance';
export type ConnectorStatus = 'active' | 'inactive';

// Public-ish record — readable by CRM users (for the case picker) + admin/HR.
// Sensitive PAN + bank live in /connectors/{id}/private/financial (admin/HR only).
export interface Connector {
  id: string;
  connectorCode: string;          // FAC-001
  displayName: string;
  mobile: string;
  email: string;                  // personal/business email — NOT a Workspace login
  address: string;
  firmName?: string;              // if they operate as a firm / DSA entity
  verticals: ConnectorVertical[]; // what they bring
  status: ConnectorStatus;
  notes?: string;
  deleted?: boolean;
  createdBy: string;
  createdAt: import('firebase/firestore').Timestamp;
  updatedAt: import('firebase/firestore').Timestamp;
}

export interface ConnectorBankDetails {
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  branch?: string;
}

// /connectors/{id}/private/financial — admin/HR only.
export interface ConnectorFinancial {
  pan: string;                    // stored raw; UI always masks via maskPan()
  bank: ConnectorBankDetails;
  updatedAt: import('firebase/firestore').Timestamp;
}

export type ConnectorPayoutStatus = 'pending' | 'paid';

// /connector_payouts/{id} — what Finvastra owes a connector for a sourced case.
export interface ConnectorPayout {
  id: string;
  connectorId: string;
  connectorCode: string;
  connectorName: string;
  businessLine: ConnectorVertical;
  caseLabel: string;              // free-text reference to the case (loan no / customer / app no)
  leadId?: string;
  opportunityId?: string;
  amount: number;
  status: ConnectorPayoutStatus;
  notes?: string;
  createdBy: string;
  createdAt: import('firebase/firestore').Timestamp;
  paidAt?: import('firebase/firestore').Timestamp;
  paidBy?: string;
  paymentReference?: string;
}

// ─── Employee Lifecycle ───────────────────────────────────────────────────────

export type ExitReason =
  | 'resignation' | 'termination' | 'contract_end'
  | 'retirement' | 'absconding' | 'other';

export const EXIT_REASON_LABELS: Record<ExitReason, string> = {
  resignation:   'Resignation',
  termination:   'Termination',
  contract_end:  'Contract End',
  retirement:    'Retirement',
  absconding:    'Absconding',
  other:         'Other',
};

// ─── Onboarding / Offboarding Checklists ─────────────────────────────────────

export type ChecklistItemCategory =
  | 'documents' | 'system_access' | 'assets' | 'induction' | 'other'
  | 'knowledge_transfer' | 'crm';

export interface ChecklistItem {
  id: string;
  category: ChecklistItemCategory;
  task: string;
  completed: boolean;
  completedAt: import('firebase/firestore').Timestamp | null;
  completedBy: string | null;   // uid
  notes: string | null;
}

export type ChecklistStatus = 'pending' | 'in_progress' | 'completed';
export type FnFStatus = 'pending' | 'calculated' | 'settled';

export interface FnFDetails {
  grossSalary: number;
  workingDaysInLastMonth: number;
  daysWorked: number;
  dailyRate: number;
  salaryForDaysWorked: number;
  earnedLeaveBalance: number;
  leaveEncashmentAmount: number;
  gratuityApplicable: boolean;
  gratuityAmount: number;
  noticePeriodDays: number;
  noticePeriodServed: number;
  noticePeriodDeduction: number;
  otherDeductions: number;
  otherDeductionNotes: string;
  totalPayable: number;
  finalizedAt: import('firebase/firestore').Timestamp | null;
  finalizedBy: string | null;
  statementGeneratedAt: import('firebase/firestore').Timestamp | null;
  // Optional extras — absent on legacy Firestore docs
  bonusAmount?: number;
  fuelAmount?: number;
  compOffDays?: number;
  compOffEncashmentAmount?: number;
  excessPaidRecovery?: number;
  excessPaidRecoveryNotes?: string;
}

export interface OnboardingChecklist {
  id: string;             // = employeeId (uid)
  employeeId: string;
  employeeName: string;
  joiningDate: string | null;
  createdAt: import('firebase/firestore').Timestamp;
  createdBy: string;
  status: ChecklistStatus;
  completedAt: import('firebase/firestore').Timestamp | null;
  items: ChecklistItem[];
}

export interface OffboardingChecklist {
  id: string;             // = employeeId (uid)
  employeeId: string;
  employeeName: string;
  lastWorkingDate: string | null;
  exitReason: ExitReason | null;
  createdAt: import('firebase/firestore').Timestamp;
  createdBy: string;
  status: ChecklistStatus;
  completedAt: import('firebase/firestore').Timestamp | null;
  fnfStatus: FnFStatus;
  fnfSettledAt: import('firebase/firestore').Timestamp | null;
  fnfSettledBy: string | null;
  items: ChecklistItem[];
  fnfDetails: FnFDetails | null;
}

// ─── IT Declaration ──────────────────────────────────────────────────────────
// Financial year: April to March. `year` stores the start year (e.g. 2025 for FY 2025-26).
// Document ID: {employeeId}_{year}

export interface ItDeclSection80C {
  lifeInsurance:    number;
  ppf:              number;
  elss:             number;
  nsc:              number;
  homeLoanPrincipal:number;
  tuitionFees:      number;
  epfVoluntary:     number;
  nps80CCD1:        number;
  other80C:         number;
  total80C:         number;  // min(sum, 150000) — computed on save
}

export interface ItDeclSection80D {
  selfFamilyPremium: number;
  parentsPremium:    number;
  parentsSenior:     boolean;
  total80D:          number;  // computed on save
}

export interface ItDeclHra {
  claimingHra:  boolean;
  monthlyRent:  number;
  landlordName: string;
  landlordPan:  string | null;  // required if annual rent > ₹1,00,000
  cityType:     'metro' | 'non_metro';
  annualRent:   number;         // monthlyRent × 12 — computed on save
}

export interface ItDeclHomeLoan {
  claimingHomeLoan: boolean;
  annualInterest:   number;   // deduction capped at ₹2,00,000
  propertyAddress:  string;
  lenderName:       string;
}

export interface ItDeclLta {
  claimingLta:   boolean;
  travelAmount:  number;
  travelDetails: string;
}

export interface ItDeclSection80E {
  claimingEducationLoan: boolean;
  annualInterest:        number;  // no upper limit
}

export type ItDeclarationStatus = 'draft' | 'submitted' | 'accepted';

export interface ItDeclaration {
  id:           string;  // {employeeId}_{year}
  employeeId:   string;
  year:         number;
  status:       ItDeclarationStatus;
  submittedAt:  import('firebase/firestore').Timestamp | null;
  acceptedBy:   string | null;
  acceptedAt:   import('firebase/firestore').Timestamp | null;
  reopenRequested?: boolean;
  revisionNote?:    string | null;
  section80C:   ItDeclSection80C;
  section80D:   ItDeclSection80D;
  hra:          ItDeclHra;
  homeLoan:     ItDeclHomeLoan;
  lta:          ItDeclLta;
  section80E:   ItDeclSection80E;
  totalDeductions:    number;
  estimatedTaxSaving: number;
  createdAt: import('firebase/firestore').Timestamp;
  updatedAt: import('firebase/firestore').Timestamp;
}

// ─── Performance Reviews ─────────────────────────────────────────────────────
// Annual performance management cycle.
// Collection: /performance_reviews/{employeeId}_{year}
// Year = calendar year of the review (2026 = reviews covering calendar year 2026).

export type PerformanceReviewStatus =
  | 'pending'          // created; employee hasn't submitted self-assessment yet
  | 'self_review'      // employee submitted self-assessment
  | 'manager_review'   // manager has submitted their review
  | 'completed';       // HR finalized — increment set, letter available

export interface PerformanceSelfAssessment {
  submittedAt: import('firebase/firestore').Timestamp;
  achievements: string;     // key achievements during the year
  challenges: string;       // challenges faced and how handled
  trainingNeeds: string;    // skills / training requested
  careerGoals: string;      // short- and long-term goals
  overallSelfRating: number;  // 1–5
}

export interface PerformanceManagerReview {
  submittedAt: import('firebase/firestore').Timestamp;
  submittedBy: string;          // uid of reviewer
  managerName: string;
  // KRA ratings — 1 (Poor) to 5 (Excellent)
  workQuality: number;
  workQuantity: number;
  initiative: number;
  communication: number;
  teamwork: number;
  punctuality: number;
  overallRating: number;        // average of 6 KRAs, rounded to 1 decimal
  strengths: string;
  areasForImprovement: string;
  recommendedForPromotion: boolean;
  notes: string | null;
}

export interface PerformanceReview {
  id: string;                   // {employeeId}_{year}
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  designation: string | null;
  year: number;                 // calendar year
  status: PerformanceReviewStatus;
  selfAssessment?: PerformanceSelfAssessment;
  managerReview?: PerformanceManagerReview;
  // HR finalization
  incrementPercentage?: number;    // % e.g. 10
  newGrossSalary?: number;         // ₹ per month
  oldGrossSalary?: number;         // ₹ per month at time of finalization
  incrementEffectiveDate?: string; // YYYY-MM-DD
  hrNotes?: string | null;
  finalizedAt?: import('firebase/firestore').Timestamp;
  finalizedBy?: string;
  createdAt: import('firebase/firestore').Timestamp;
  updatedAt: import('firebase/firestore').Timestamp;
}

// ─── Probation Management ────────────────────────────────────────────────────
// Collection: /probation_records/{userId}
// Created on employee hire; updated as HR reviews and confirms/extends.

export type ProbationStatus = 'on_probation' | 'confirmed' | 'extended' | 'terminated';

export interface ProbationEvaluation {
  submittedAt: import('firebase/firestore').Timestamp;
  submittedBy: string;                        // uid of evaluator
  reportingManagerName: string;
  // Competency ratings — 1 (Poor) to 5 (Excellent)
  workQuality: number;
  communication: number;
  attendance: number;
  teamwork: number;
  learning: number;
  overallRating: number;                      // average of the five, rounded to 1dp
  recommendation: 'confirm' | 'extend' | 'terminate';
  notes: string | null;
}

export interface ProbationRecord {
  id: string;                                 // = userId
  employeeId: string;                         // userId / Firebase uid
  employeeName: string;
  employeeCode: string | null;                // FAPL-xxx
  department: string | null;
  designation: string | null;
  joiningDate: string;                        // YYYY-MM-DD
  probationStartDate: string;                 // YYYY-MM-DD (= joiningDate)
  probationEndDate: string;                   // YYYY-MM-DD (joiningDate + 6 months)
  status: ProbationStatus;
  evaluation?: ProbationEvaluation;
  // Confirmation
  confirmedAt?: import('firebase/firestore').Timestamp;
  confirmedBy?: string;
  confirmationNotes?: string | null;
  // Extension
  extensionReason?: string;
  extensionEndDate?: string;                  // YYYY-MM-DD — the new end date after extension
  extendedAt?: import('firebase/firestore').Timestamp;
  extendedBy?: string;
  createdAt: import('firebase/firestore').Timestamp;
  updatedAt: import('firebase/firestore').Timestamp;
}

// ─── Training & Development ──────────────────────────────────────────────────
// Collections: /training_programs/{id}  /training_records/{id}
// Tracks mandatory compliance certifications (AMFI, IRDA, NCFM) and skill training.

export type TrainingCategory =
  | 'compliance'     // AMFI, IRDA, SEBI, regulatory certifications
  | 'certification'  // External professional certifications
  | 'skills'         // Product knowledge, sales skills, etc.
  | 'induction'      // New joiner orientation / on-the-job training
  | 'safety'         // Workplace safety & POSH
  | 'other';

export type TrainingStatus = 'enrolled' | 'completed' | 'expired';

export interface TrainingProgram {
  id: string;
  name: string;
  category: TrainingCategory;
  description: string | null;
  durationHours: number | null;
  isMandatory: boolean;
  renewalPeriodMonths: number | null;   // null = one-time; else renews every N months
  isActive: boolean;
  createdBy: string;
  createdAt: import('firebase/firestore').Timestamp;
  updatedAt: import('firebase/firestore').Timestamp;
}

export interface TrainingRecord {
  id: string;
  programId: string;
  programName: string;          // denormalized for display
  programCategory: TrainingCategory;
  employeeId: string;
  employeeName: string;         // denormalized for display
  status: TrainingStatus;
  enrolledAt: import('firebase/firestore').Timestamp;
  completedAt: import('firebase/firestore').Timestamp | null;
  expiresAt: import('firebase/firestore').Timestamp | null;   // null = never expires
  certificateUrl: string | null;
  enrolledBy: string;
  completedBy: string | null;
  notes: string | null;
  createdAt: import('firebase/firestore').Timestamp;
  updatedAt: import('firebase/firestore').Timestamp;
}

// ─── Salary History ──────────────────────────────────────────────────────────
// Collection: /salary_history/{recordId}
// Tracks every salary revision: joining CTC, annual increments, promotions.
// Provides a single source of truth for "current salary" for FnF and payslips.

export type SalaryRevisionReason =
  | 'joining'           // Initial CTC on joining
  | 'increment'         // Annual/merit increment
  | 'promotion'         // Promotion-linked revision
  | 'correction'        // Data correction (admin error)
  | 'contract_renewal'  // Fixed-term contract renewal
  | 'other';

export const SALARY_REVISION_REASON_LABELS: Record<SalaryRevisionReason, string> = {
  joining:          'Joining CTC',
  increment:        'Annual Increment',
  promotion:        'Promotion',
  correction:       'Correction',
  contract_renewal: 'Contract Renewal',
  other:            'Other',
};

export interface SalaryHistory {
  id: string;
  employeeId: string;
  employeeName: string;
  effectiveDate: string;                // YYYY-MM-DD — date the new salary took effect
  grossSalary: number;                  // ₹ per month (total CTC / 12)
  basicSalary: number | null;           // optional breakdown
  hra: number | null;
  otherAllowances: number | null;
  reason: SalaryRevisionReason;
  incrementPercentage: number | null;   // null if not an increment/promotion
  previousGrossSalary: number | null;   // previous gross — for display only
  relatedPerformanceReviewId: string | null;
  notes: string | null;
  recordedBy: string;                   // uid
  recordedAt: import('firebase/firestore').Timestamp;
}

// ─── HR Helpdesk / Grievance ─────────────────────────────────────────────────
// Collection: /hr_tickets/{ticketId}
// POSH Act compliance + general HR support requests.

export type HrTicketCategory =
  | 'payroll'            // Pay discrepancy, deduction queries
  | 'leave'              // Leave balance, approval issues
  | 'attendance'         // Attendance correction requests
  | 'hr_policy'          // Policy clarification
  | 'workplace_concern'  // Interpersonal / environment issues
  | 'posh'               // Prevention of Sexual Harassment (POSH Act)
  | 'it_access'          // System / tool access issues
  | 'other';

export type HrTicketStatus   = 'open' | 'in_review' | 'resolved' | 'closed';
export type HrTicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface HrTicket {
  id: string;
  employeeId: string;
  employeeName: string;    // blank if isAnonymous
  category: HrTicketCategory;
  subject: string;
  description: string;
  priority: HrTicketPriority;
  status: HrTicketStatus;
  isAnonymous: boolean;    // hides employeeName/employeeId from admin view
  attachmentUrl: string | null;
  createdAt: import('firebase/firestore').Timestamp;
  updatedAt: import('firebase/firestore').Timestamp;
  resolvedAt: import('firebase/firestore').Timestamp | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
  adminNotes: string | null;  // internal notes visible only to admin
}

// ─── HR Letters ─────────────────────────────────────────────────────────────

/** Mirror of the LetterType union in letterPdf.ts — kept in sync manually. */
export type LetterType =
  | 'appointment'
  | 'confirmation'
  | 'probation_extension'
  | 'consultant_agreement'
  // Legacy types from before Phase H rewrite (may exist in Firestore; displayed as raw string)
  | 'offer'
  | 'increment'
  | 'noc'
  | 'salary_certificate'
  | 'experience'
  | 'relieving';

export interface GeneratedLetter {
  id:              string;
  letterType:      LetterType;
  employeeId:      string;
  employeeName:    string;
  refNumber:       string;
  generatedBy:     string;
  generatedByName: string;
  generatedAt:     import('firebase/firestore').Timestamp;
  storageUrl:      string | null;
  storageStatus:   'uploading' | 'uploaded' | 'failed' | null;
}

// ─── CRM: Wealth Investments ─────────────────────────────────────────────────
// Subcollection: /leads/{leadId}/opportunities/{oppId}/investments/{id}

export type WealthInvestmentType =
  | 'mf_sip'
  | 'mf_lumpsum'
  | 'direct_equity'
  | 'bonds'
  | 'pms'
  | 'aif'
  | 'fd_ncd'
  | 'nps'
  | 'other';

export const WEALTH_INVESTMENT_TYPE_LABELS: Record<WealthInvestmentType, string> = {
  mf_sip:        'MF — SIP',
  mf_lumpsum:    'MF — Lumpsum',
  direct_equity: 'Direct Equity',
  bonds:         'Bonds',
  pms:           'PMS',
  aif:           'AIF',
  fd_ncd:        'FD / NCD',
  nps:           'NPS',
  other:         'Other',
};

export interface WealthInvestment {
  id: string;
  investmentType:  WealthInvestmentType;
  schemeName:      string;         // fund/stock/bond name
  folioNumber?:    string;         // MF folio
  investedAmount:  number;         // total cost basis
  sipAmount?:      number;         // monthly SIP amount
  units?:          number;         // units/shares held
  purchaseNAV?:    number;         // NAV at purchase
  currentNAV?:     number;         // latest NAV (updated manually)
  currentValue?:   number;         // current market value
  purchaseDate:    string;         // YYYY-MM-DD
  status:          'active' | 'redeemed' | 'paused';
  notes?:          string;
  addedBy:         string;
  addedAt:         any;
  updatedAt:       any;
}

// ─── CRM: Insurance Policies ──────────────────────────────────────────────────
// Subcollection: /leads/{leadId}/opportunities/{oppId}/policies/{id}

export type InsurancePolicyType =
  | 'term'
  | 'health'
  | 'motor'
  | 'home'
  | 'personal_accident'
  | 'travel'
  | 'endowment'
  | 'ulip'
  | 'pension'
  | 'other';

export const INSURANCE_POLICY_TYPE_LABELS: Record<InsurancePolicyType, string> = {
  term:              'Term Life',
  health:            'Health',
  motor:             'Motor',
  home:              'Home',
  personal_accident: 'Personal Accident',
  travel:            'Travel',
  endowment:         'Endowment',
  ulip:              'ULIP',
  pension:           'Pension / Annuity',
  other:             'Other',
};

export interface InsurancePolicy {
  id: string;
  policyNumber:      string;
  insurerName:       string;
  productName:       string;
  policyType:        InsurancePolicyType;
  sumAssured:        number;
  annualPremium:     number;
  premiumFrequency:  'annual' | 'semi_annual' | 'quarterly' | 'monthly';
  commencementDate:  string;      // YYYY-MM-DD policy start
  maturityDate?:     string;      // YYYY-MM-DD (for savings/endowment)
  renewalDate:       string;      // YYYY-MM-DD next renewal
  status:            'active' | 'lapsed' | 'matured' | 'cancelled';
  notes?:            string;
  addedBy:           string;
  addedAt:           any;
  updatedAt:         any;
}

// ─── Attendance Regularization ───────────────────────────────────────────────

export type RegularizationStatus = 'pending' | 'approved' | 'rejected';

export interface AttendanceRegularization {
  id: string;
  employeeId:           string;
  employeeName:         string;
  date:                 string;    // YYYY-MM-DD
  requestedCheckIn:     string | null;  // HH:mm (24-hour)
  requestedCheckOut:    string | null;  // HH:mm (24-hour)
  reason:               string;
  existingStatus:       AttendanceStatus | null;
  status:               RegularizationStatus;
  reviewedBy:           string | null;
  reviewedByName:       string | null;
  reviewedAt:           any;
  rejectionReason:      string | null;
  submittedAt:          any;
}

// ─── CRM Document Vault ────────────────────────────────────────────────────
// Files attached to an opportunity: PDFs, scans, bank statements, ITR, etc.
// Stored in Firebase Storage at crm-documents/{opportunityId}/{uuid}_{name}.
// Firestore log at /crm_documents/{docId}.

export interface CrmDocument {
  id:              string;
  opportunityId:   string;
  leadId:          string;
  originalName:    string;       // original filename as uploaded
  storagePath:     string;       // full GCS path, for admin reference
  storageUrl:      string;       // permanent token-based download URL
  fileSize:        number;       // bytes
  contentType:     string;       // MIME type
  docTypeId:       string | null; // optional link to /document_types
  uploadedBy:      string;       // uid
  uploadedByName:  string;
  uploadedAt:      any;          // Timestamp
  deleted:         boolean;
  deletedAt:       any;          // Timestamp | null
  deletedBy:       string | null;
}

// ─── Toast ─────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  title?: string;
  duration?: number;
}
