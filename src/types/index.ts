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
  phone?: string;              // official/personal contact
  officialPhone?: string;      // office direct number
  personalEmail?: string;      // personal email (not login)
  dateOfBirth?: string;        // MM-DD format for celebrations
  presentAddress?: string;
  permanentAddress?: string;
  grossSalary?: number;          // monthly CTC in ₹ — total (Basic+HRA+Conveyance+Other)
  lastWorkingDate?: string;      // YYYY-MM-DD; set for inactive employees
  reportingManagerName?: string; // stored as name; resolved to managerId separately
  employeeStatus?: EmployeeStatus;
  // Personal details (from individual employee sheets)
  gender?: string;
  bloodGroup?: string;
  fatherMotherName?: string;
  spouseName?: string;
  // Salary structure — monthly components that pre-fill payslip generation
  salaryBasic?: number;
  salaryHra?: number;
  salaryConveyance?: number;
  salaryMedical?: number;
  salaryOther?: number; // 'active' | 'inactive'
  // Module access flags. Absent field is treated as the safe default:
  // hrmsAccess absent → true (everyone gets HRMS self-service)
  // crmAccess  absent → false (only RMs explicitly granted access)
  hrmsAccess?: boolean;
  crmAccess?: boolean;
  hasCalendarAccess?: boolean;
  // CRM role determines lead routing and access patterns
  crmRole?: CrmRole;
  // Only set when crmRole === 'lead_convertor'; drives handoff matching
  convertorVertical?: ConvertorVertical;
  isHrmsManager?: boolean;    // grants leave approval + admin attendance override
  crmCanImport?: boolean;     // can trigger bulk Sheet imports (default: only managers; admin can grant individually)
  misAccess?: MisAccess;
  createdAt?: import('firebase/firestore').Timestamp;
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

export type LeaveType = 'casual' | 'sick' | 'earned' | 'lop' | 'optional';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveApplication {
  id: string;
  employeeId: string;
  type: LeaveType;
  fromDate: string;   // YYYY-MM-DD
  toDate: string;     // YYYY-MM-DD
  days: number;       // working days (weekends + holidays excluded)
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
  casual: { total: number; used: number; remaining: number };
  sick:   { total: number; used: number; remaining: number };
  earned: { total: number; used: number; remaining: number };
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

// ─── CRM: Leads (person record) ──────────────────────────────────────────────

export type LeadSource = 'website' | 'instagram' | 'facebook' | 'walkin' | 'referral' | 'broker' | 'offline_bulk' | 'social_meta';
export type ConsentMethod = 'verbal' | 'written' | 'digital' | 'offline_collection';
export type TriagePriority = 'high' | 'medium' | 'low';

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
  // Compliance — mandatory per DPDP Act 2023
  consentGiven: true;
  consentTimestamp: any;
  consentMethod: ConsentMethod;
  // SLA & triage — set at creation; slaDeadline is a Firestore Timestamp
  slaDeadline?: any;
  triagePriority?: TriagePriority;
  // Bulk import provenance fields
  importBatchId?: string;
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
}

// ─── Notifications ───────────────────────────────────────────────────────────

export type NotificationType =
  | 'leave_approved'
  | 'leave_rejected'
  | 'leave_pending'
  | 'payroll_processed'
  | 'announcement'
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

// ─── Announcements ───────────────────────────────────────────────────────────

export type AnnouncementPriority = 'normal' | 'urgent';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  createdBy: string;
  createdByName?: string;
  createdAt: any;
  targetAll: boolean;
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

// ─── Toast ─────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  title?: string;
  duration?: number;
}
