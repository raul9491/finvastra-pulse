# Finvastra Pulse

> **Product name: Finvastra Pulse.** Internal application replacing Zoho-class SaaS. **Three modules**: HRMS (workforce), CRM (customer pipeline), and MIS (back-office commission reconciliation) for the ~25-person Finvastra team. Lives at `pulse.finvastra.com` (subdomain on Hostinger DNS, app served from Firebase). Built on Firebase + React + Vite + Express. **Owned by Finvastra.**

---

## 🔧 CLAUDE.md Maintenance Rule

> **After every build session, update this file before closing.** Mark completed checklist items ✅, add new features / files / routes / endpoints / collections, and correct any outdated info. This file is the single source of truth for the codebase — if it drifts from the actual code, fixing the doc is part of the same session, not a follow-up. When in doubt, scan `src/`, `router.tsx`, `server.ts`, and `firestore.rules` and reconcile.
>
> _Enforced by a `Stop` hook in `.claude/settings.json` (added 2026-06-06): every session end prompts a CLAUDE.md reconcile → commit → push. Disable/edit via `/hooks`._
>
> _Last full code↔doc audit: **2026-06-06**._

---

## Architecture

| Layer | Tech | Notes |
|---|---|---|
| Frontend | React 19 + Vite 6 + TypeScript + Tailwind v4 | Strict TS, functional components, hooks |
| Backend | Express + Firebase Admin SDK | Same `server.ts` handles dev (Vite middleware) and prod (static) |
| Database | Firestore | Project `gen-lang-client-0643641184`, DB `ai-studio-27afcadd-87fc-4f68-8a88-587e904a31bf` |
| Auth | Firebase Auth + Google OAuth | 5 senior users via Workspace; 20 employees via email/password |
| Hosting | Firebase Hosting + Cloud Run for Express | Or fully Cloud Run with Express serving static |
| PDF | jsPDF + jspdf-autotable | Payslip generation only |
| Email | Google Workspace SMTP via nodemailer | System notifications. No third-party email service. Env vars: `SMTP_USER`, `SMTP_APP_PASSWORD` (Google App Password). |

### Architecture principles

**No AI or LLM in this platform.** All logic is deterministic code. Google Gemini and other AI tools are used externally within Google Workspace (Sheets, Docs) — never inside this application. This is a financial platform; every output must be fully auditable and traceable to explicit business logic.

- Features described as "intelligence" are rule-based: threshold comparisons, scheduled calculations, aggregation of recorded data. No inference, no model calls.
- The Phase 5 reporting layer exports Firestore data to Google Sheets via a Python script — no summarisation or generation.
- If a future request implies an LLM or generative AI call inside the app, **stop and confirm** before building.

## Project files already in repo

- `server.ts` — Express server, Google OAuth, Calendar API proxy, Firebase Admin init
- `vite.config.ts` — Vite + Tailwind + React plugins, `@/` alias
- `firebase-applet-config.json` — client Firebase config (safe to commit)
- `firebase-blueprint.json` — entity schemas for user/attendance/leave (extend for CRM)
- `firestore.rules` — security rules (build out against `security_spec.md`)
- `security_spec.md` — invariants + "Dirty Dozen" attack payloads; **rules must defeat all 12**
- `metadata.json`, `index.html`, `package.json`, `tsconfig.json` — boilerplate

## Brand

```css
--navy:        #0B1538;
--navy-soft:   #1B2A4E;
--gold:        #C9A961;
--gold-deep:   #9A7E3F;
--gold-bright: #E5C97C;
--paper:       #FAFAF7;
--paper-warm:  #F2EFE7;
--ink:         #0A0A0A;
--ink-soft:    #2A2A2A;
--mute:        #8B8B85;
```

- **Display font**: Fraunces (variable, axes: opsz/wght/SOFT). Use `SOFT 30` for italics (less decorative).
- **Sans font**: DM Sans.
- **Aesthetic**: editorial-premium, same family as the Finvastra marketing site. Generous whitespace. Confident not flashy. No purple gradients, no generic SaaS-y rounded everything.

## Feature Map — complete src/ tree (as of 2026-06-06)

Quick navigation reference. Every file listed here exists and is live in production.

```
src/
├── App.tsx                          router entry, wraps ThemeProvider > AuthProvider > ToastProvider
├── main.tsx
├── router.tsx                       all routes — DO NOT TOUCH
├── types/index.ts                   all shared TypeScript types — DO NOT TOUCH
│
├── config/
│   └── hrmsConfig.ts                SUPER_ADMIN_UIDS, DEPARTMENTS, DESIGNATIONS, isSuperAdmin()
│
├── styles/
│   ├── glass.css                    glassmorphism design system; dark/light mode CSS vars
│   └── tokens.css                   brand CSS custom properties (navy, gold, paper, ink)
│
├── lib/                             — DO NOT TOUCH any file in lib/
│   ├── firebase.ts                  client SDK init (emulator-aware)
│   ├── notifications.ts             writeNotification() + sendHrEmailNotification()
│   ├── encryption.ts                AES-256-GCM PAN encrypt/decrypt
│   ├── cn.ts                        Tailwind class merge
│   ├── pdfWatermark.ts              jsPDF watermark helper
│   ├── pdfApplicationPacket.ts      5-page watermarked loan application packet PDF
│   ├── slaUtils.ts                  SLA deadline helpers
│   ├── envValidation.ts             startup env var validation (throws in prod if missing)
│   ├── leadAnonymisation.ts         RTBF/DPDP anonymisation
│   ├── leaveYearResetJob.ts         FY leave balance reset job logic
│   ├── documentExpiryJob.ts         document expiry threshold checks
│   ├── bankSLAJob.ts                bank SLA breach detection
│   ├── commissionLeakageJob.ts      commission leakage detection rules
│   └── hooks/                       shared data hooks: useProfile.ts, useAttendance.ts,
│                                    useLeaves.ts, usePayroll.ts, useNotifications.ts
│                                    (NOTE: audit-log writing lives in server.ts, NOT lib/audit.ts)
│
├── components/
│   ├── VastraLogo.tsx               re-export shim (canonical: components/ui/VastraLogo.tsx)
│   └── layout/
│   │   ├── HrmsShell.tsx            HRMS shell — sidebar, nav badges, mobile drawer
│   │   ├── CrmShell.tsx             CRM shell — includes referral-only mode
│   │   ├── MisShell.tsx             MIS shell
│   │   └── NavItem.tsx              shared nav link primitive
│   └── ui/
│       ├── SearchableSelect.tsx     dropdown with search (+ MultiSearchableSelect)
│       ├── MultiSearchableSelect.tsx re-export shim
│       ├── ThemeProvider.tsx        dark/light mode context + ThemeToggle button (Sun/Moon)
│       ├── NotificationBell.tsx     in-app notification dropdown (bell icon)
│       ├── AppsMenu.tsx             ⊞ module switcher dropdown (HRMS/CRM/MIS → launcher)
│       ├── UserMenu.tsx             avatar dropdown — profile links + sign out (all 3 shells)
│       ├── VideoLogo.tsx            animated logo
│       ├── VastraLogo.tsx           brand mark (size/light/iconOnly props)
│       ├── MercuryBackground.tsx    animated bg
│       ├── Button.tsx               glass-styled button primitive
│       ├── Badge.tsx                status badge
│       ├── Modal.tsx                glass modal wrapper
│       ├── Toast.tsx                toast notification system
│       ├── EmptyState.tsx           empty state illustration
│       ├── Skeleton.tsx             loading skeleton
│       └── BulkActionBar.tsx        multi-select bulk action toolbar
│
└── features/
    ├── auth/
    │   ├── AuthContext.tsx           session, 30-min idle timeout, mustResetPassword
    │   ├── LoginPage.tsx             Google + email/pw login, @finvastra.com domain guard
    │   ├── ResetPasswordPage.tsx     forced reset on first login
    │   ├── RequestAccessPage.tsx
    │   └── AuthActionPage.tsx
    │
    ├── home/
    │   └── LauncherPage.tsx          module selector (HRMS / CRM / MIS cards)
    │
    ├── public/
    │   └── CustomerTrackerPage.tsx   /track/:token — public customer deal status
    │
    ├── hrms/                         /hrms/* — all employees by default (hrmsAccess)
    │   ├── hooks/                    — DO NOT TOUCH any hook file
    │   │   ├── useAttendance.ts      useHolidays.ts  useLeave.ts         usePayslips.ts
    │   │   ├── useClaims.ts          useDocuments.ts useAnnouncements.ts useItDeclarations.ts
    │   │   ├── useCompOff.ts         useBirthdayEmployees.ts             useWorkAnniversaries.ts
    │   │   ├── useProbation.ts       usePerformance.ts  useTraining.ts   useHrTickets.ts
    │   │   ├── useDocumentAcknowledgements.ts          useSalaryHistory.ts
    │   │   ├── useLeaveEncashment.ts useLeaveYearReset.ts                useAttendanceRegularization.ts
    │   │   └── useGeneratedLetters.ts
    │   │
    │   ├── dashboard/     HrmsDashboardPage — birthdays, announcements banner, team today, HR pending panel
    │   ├── employees/     EmployeesPage, EmployeeProfilePage, AddEmployeeModal, ImportEmployeesPage,
    │   │                  AccessRequestsPage (approve /request-access), CrmPerformanceWidget (CRM stats on HR profile)
    │   ├── directory/     EmployeeDirectoryPage — org-wide searchable employee directory
    │   ├── attendance/    AttendancePage (self), AdminAttendancePage (Daily / Monthly grid / Corrections tabs)
    │   ├── leave/         LeavePage, ApplyLeavePage, AdminLeavePage, AdminCompOffPage,
    │   │                  TeamCalendarPage, LeaveYearEndPage
    │   ├── payslips/      PayslipsPage (employee view), GeneratePayslipPage (admin), payslipPdf.ts
    │   ├── claims/        ClaimsPage (employee), AdminClaimsPage
    │   ├── documents/     DocumentsPage (employee), AdminDocumentsPage; Firebase Storage
    │   ├── announcements/ AnnouncementsPage, AdminAnnouncementsPage (readBy tracking, pinned, priority)
    │   ├── itdeclaration/ ItDeclarationPage (employee), AdminItDeclarationsPage; 80C/80D/HRA/HomeLoan
    │   ├── compliance/    ComplianceCalendarPage (TDS/PF/PT/ESIC), PfTrackerPage + ECR export
    │   ├── letters/       HrLetterGeneratorPage (8 letter types), letterPdf.ts; Firebase Storage
    │   ├── salary/        AdminSalaryHistoryPage — salary revision history per employee
    │   ├── recruitment/   RecruitmentPage — job openings, candidate pipeline, Add-to-HRMS CTA
    │   ├── assets/        AssetsPage — laptop/SIM/card assign/return tracking
    │   ├── onboarding/    OnboardingPage — 20-item checklist per new employee, 4 categories
    │   ├── probation/     ProbationPage — confirm/extend/fail probation, timeline
    │   ├── offboarding/   OffboardingPage — 16-item checklist + FnF calculator + FnF PDF
    │   ├── performance/   PerformancePage (self-assessment), AdminPerformancePage
    │   ├── training/      TrainingPage (employee enroll), AdminTrainingPage
    │   ├── helpdesk/      HrHelpdeskPage (raise ticket), AdminHelpdeskPage (POSH Act compliant)
    │   ├── orgchart/      OrgChartPage — CSS flexbox hierarchy, collapse/expand, dept filter
    │   ├── holidays/      HolidaysPage — Hyderabad 2026 calendar, auto-seeded
    │   ├── guide/         PulseGuidePage — 12-section accordion quick-reference
    │   ├── settings/      SettingsPage — Contact HR cards
    │   ├── dataimport/    DataImportPage — bulk import (super admin only)
    │   └── admin/         SuperAdminPermissionsPage — 3 protected accounts, read-only SA rows
    │
    ├── crm/                          /crm/* — crmAccess required; or /crm/referrals for referral-only
    │   │   (NOTE: bulk import is two-stage — import holds leads UNASSIGNED, then distribute from /crm/import/queue)
    │   ├── hooks/                    — DO NOT TOUCH any hook file
    │   │   ├── useLeads.ts           useOpportunities.ts  useBankSubmissions.ts
    │   │   ├── useCommissionRecords.ts useCommissionSlabs.ts useDocumentChecklist.ts
    │   │   ├── useMyLeads.ts         useWealthInvestments.ts  useInsurancePolicies.ts
    │   │   ├── useCrmDocuments.ts    useBankEligibility.ts    useDocumentExpiry.ts
    │   │   ├── useBankSLA.ts         useFOIR.ts               useImportJobs.ts
    │   │   ├── useRmTargets.ts       (Phase N — targets, computeActuals, achievementPct)
    │   │   └── config/              seedData.ts, seedDocumentTypes.ts, seedCrmConfig.ts, migrate.ts
    │   │
    │   ├── dashboard/     CrmDashboardPage — RM perf table, pipeline by biz line, source breakdown;
    │   │                  CommandCentrePage (/crm/command-centre) — cross-module manager dashboard  ← Phase O
    │   ├── leads/         LeadsPage, LeadDetailPage, NewLeadPage, MyQueuePage, QuickContactBar
    │   │                  FOIRCalculator, duplicate detection, bulk actions, PAN masking
    │   ├── opportunities/ OpportunityDetailPage (stage advance, activity timeline, stage data history)
    │   │                  AddOpportunityPage (3-step wizard, dynamic custom fields)
    │   │                  TransferModal, BankEligibilityCard, CrmDocumentVault
    │   │   ├── loans/     AddBankSubmissionModal, BankSubmissionCard, BankSubmissionsSection,
    │   │   │              BankSubmissionDetailPage, ApplicationPacketGenerator
    │   │   ├── wealth/    WealthInvestmentsSection — investment tracking subcollection
    │   │   └── insurance/ InsurancePoliciesSection — policy tracking + 30-day renewal alerts
    │   ├── pipeline/      PipelinePage — Kanban board (stage columns per biz line, totals, Board/Table)
    │   ├── targets/       TargetsPage — RM monthly targets vs live actuals (individual + team)   ← Phase N
    │   ├── reports/       LeadAgingPage — Fresh/Active/Aging/Stale buckets + CSV (admin/manager)  ← Phase N
    │   ├── commissions/   CommissionRecordsPage, CommissionDashboardCard; mark paid/clawback
    │   ├── import/        ImportPage (Sheets bulk + mandatory import name), ImportQueuePage (2-stage distribute),
│   │                  ImportProgressDock (global progress bar in CrmShell), ImportHistoryPage
    │   ├── referrals/     MyReferralsPage, SubmitReferralPage, ImportReferralsPage (referral-only mode)
    │   └── admin/         CommissionSlabsPage, ProvidersPage, DocumentTypesPage,
    │                      EligibilityRulesPage, CommissionLeakagePage, CompetitorIntelligencePage,
    │                      ReferralIntelligencePage, RateNegotiationMemoryPage,
    │                      AccessLogsPage, RightToBeForgottenPage, WebhookConfigPage
    │
    └── mis/                          /mis/* — misAccess required
        ├── hooks/                    — DO NOT TOUCH any hook file
        │   ├── useStatements.ts      useReconciliation.ts  usePayouts.ts  useMisOverview.ts
        ├── overview/      MisOverviewPage — KPI dashboard + Disbursals tab (CRM-MIS bridge)
        ├── statements/    StatementsPage, StatementDetailPage, UploadStatementPage (CSV column mapping)
        ├── reconciliation/ ReconciliationPage (auto-match + manual), LineMatchModal
        │                   shows CRM Loan No/App No in Matched-To column
        ├── payouts/       PayoutsPage, PayoutDetailPage, GeneratePayoutsPage, PayoutSlabsPage
        └── admin/         StatementTemplatesPage — per-bank CSV column templates (Phase N)
```

---

## Phasing — follow strictly, do not jump ahead

| Phase | Weeks | Scope |
|---|---|---|
| **1** | 4 | Core: Firebase Auth (Google + email/pw), RBAC (`admin` / `employee`), admin shell, audit log, user CRUD — **✅ COMPLETE** |
| **2** | 6 | **CRM — Lead & DSA engine** — capture, RM assignment, multi-bank tracker, commission records, doc vault on Drive |
| **3** | 4 | **HRMS lite** — attendance, leave (Calendar sync), holidays, payslip PDF generator — **✅ COMPLETE** |
| **4** | 6 | **MIS — Back-office reconciliation** — statement upload, reconciliation, RM payouts, Workspace integration, provider parsers, AUM/renewal events — **✅ COMPLETE** |
| **5** | 3 | **Python reporting scripts → Google Sheets** — Firestore → Python Firebase Admin SDK → gspread → Sheets. Scheduled via Cloud Scheduler. No in-app dashboard UI required. — **✅ COMPLETE** (`scripts/python/`) |
| **6** | 3 | **Hardening** — security review, employee training, launch — **✅ COMPLETE (Phase 5 Production Hardening)** |

Production target: **end of October 2026.** *(Phase 4 MIS may push this — review after Phase 3.)*

### Phase 4 sub-phases

| Sub-phase | Status | Notes |
|---|---|---|
| 4.1 MIS shell + manual statement upload | **✅ Complete** | `MisShell` at `/mis/*`; `misAccess` guard; CSV upload + column mapping |
| 4.2 Reconciliation UI | **✅ Complete** | Auto-match (amount ±5% + date ±30d, score ≥50), manual match, close statement |
| 4.3 RM payout slabs + monthly generation | **✅ Complete** | `/rm_payouts` per RM per month; user-specific overrides role-based slabs |
| 4.4 Workspace integration | ⬜ Pending | Google Drive folder watcher + Sheets monthly export |
| 4.5 Provider-specific statement parsers | ⬜ Pending | CSV/PDF parsers per bank/AMC/insurer format |
| 4.6 Wealth AUM tracking + insurance renewal events | ⬜ Pending | Recurring revenue events that feed commission_records automatically |

## Phase 2 progress

| Sub-phase | Status | Notes |
|---|---|---|
| 2.1 Lead CRUD (v1) | ~~Superseded~~ | Refactored into Lead-Opportunity model |
| 2.1 Lead-Opportunity model | **✅ Complete** | Lead=person, Opportunity=deal; 3-step wizard; stage stepper; activity timeline per opp |
| 2.2 RM assignment | Bundled into 2.1 | primaryOwnerId on lead, ownerId on opportunity |
| 2.3 Loan bank submissions | **✅ Complete** | Multi-bank parallel tracking; status stepper; auto-promotes opportunity stage; setPrimary triggers Won |
| 2.4 Commission calculator | **✅ Complete** | CommissionSlabs admin page; CommissionRecords auto-created on primary disbursal; markPaid/clawback; dashboard card |
| 2.5a CRM roles + bulk import | **✅ Complete** | CrmRole/convertorVertical on user; Sheets API import; round-robin assignment; SLA deadlines; transferOpportunity |
| 2.6 Loan specialisation | **✅ Complete** | SearchableSelect component; dynamic customFieldsSchema per loan type; document checklist on bank submissions; 7 active loan types; 30+ providers; /document_types collection |
| Post-2.6 Security | **✅ Complete** | AES-256-GCM PAN encryption; /access_logs; RTBF/DPDP anonymisation; PDF watermark; new-device login alerts; device fingerprinting + login_history; Firestore offline persistence; bulk lead actions |
| Post-2.6 Operational Analytics | **✅ Complete** | Document expiry engine (threshold-based); duplicate lead detection; bank SLA breach alerts (day-count threshold); commission leakage detection (rules-based); lost-reason capture; competitor/referral/rate analysis pages |
| Post-2.6 Differentiators | **✅ Complete** | Public customer tracker (/track/:token); application packet PDF (jsPDF, 5-page, watermarked); FOIR pre-qualifier; bank eligibility cards; eligibility rules admin |
| 2.8 Transaction cleanup | **✅ Complete** | `setPrimarySubmission` wrapped in `runTransaction`; seed buttons gated by `import.meta.env.DEV` |
| 2.5b Social/website webhook intake | **✅ Complete** | `POST /api/leads/intake/website` (X-Finvastra-Webhook-Secret header) + `GET/POST /api/leads/intake/meta` (X-Hub-Signature-256 HMAC); workload-aware assignment; `/webhook_logs`; admin config page at `/crm/admin/webhooks` |
| 2.5c Lead queue + transfer UI | **✅ Complete** | My Queue page; urgency-sorted queue; inline log-call; transfer-to-specialist modal; QuickContactBar on LeadDetailPage; overdue badge in nav |
| 2.5d Drive doc vault | **✅ Complete** | Per-opportunity document vault; upload to Firebase Storage, categorise, download |
| 2.7 Wealth investments | **✅ Complete** | `/investments` subcollection per opportunity; WealthInvestmentsSection on OpportunityDetailPage |
| 2.8b Insurance policies | **✅ Complete** | `/policies` subcollection per opportunity; InsurancePoliciesSection + 30-day renewal alert badge |

## Phase 2.5b — Website + Meta Lead Ads Webhook Intake (2026-05-26)

Real-time lead intake without manual import. Both sources use the same shared processing pipeline.

| Feature | Status | Files |
|---|---|---|
| **Website form webhook** | ✅ Complete | `server.ts` — `POST /api/leads/intake/website` |
| **Meta Lead Ads webhook** | ✅ Complete | `server.ts` — `GET/POST /api/leads/intake/meta` |
| **Webhook logs** | ✅ Complete | `/webhook_logs` Firestore collection; `GET /api/admin/webhook-logs` proxy |
| **Admin config page** | ✅ Complete | `src/features/crm/admin/WebhookConfigPage.tsx` at `/crm/admin/webhooks` |

### Shared processing pipeline (`processInboundLead`)

1. **Validate name** — required, min 2 chars
2. **Normalise + validate phone** — strips `+91`, spaces, dashes; checks 10-digit Indian mobile regex
3. **Duplicate check** — `where('phone', '==', normPhone).where('deleted', '==', false)` → skip silently on match (return 200 so callers don't retry)
4. **Workload-aware assignment** — queries active `lead_generator` users, counts open leads per generator in parallel, assigns the one with fewest; falls back to `'UNASSIGNED'`
5. **Create `/leads` doc** — `source: 'website'|'social_meta'`, `consentMethod: 'digital'`, `slaDeadline: now + 30 min`, `createdBy: 'webhook:{source}'`
6. **In-app notification** — writes to `/notifications/{uid}/items/{id}` with `type: 'new_lead'` (Admin SDK, bypasses rules)
7. **Webhook log** — writes to `/webhook_logs` regardless of outcome

### Authentication

| Endpoint | Auth mechanism |
|---|---|
| `POST /api/leads/intake/website` | `X-Finvastra-Webhook-Secret` header must match `WEBSITE_WEBHOOK_SECRET` env var |
| `GET /api/leads/intake/meta` | `hub.verify_token` query param must match `META_WEBHOOK_SECRET` |
| `POST /api/leads/intake/meta` | `X-Hub-Signature-256: sha256=HMAC(rawBody, META_WEBHOOK_SECRET)` |

### Raw body capture

`express.json()` is configured with a `verify` callback that stores the raw `Buffer` on `req.rawBody`. The Meta endpoint reads `req.rawBody` for HMAC verification before the parsed `req.body` is used.

### Firestore collection

```
/webhook_logs/{logId}
  source:       'website' | 'social_meta'
  result:       'success' | 'duplicate' | 'invalid' | 'error'
  leadId:       string | null
  errorMessage: string | null
  assignedTo:   string | null
  receivedAt:   Timestamp
```

Rules: `allow read: if isAdmin()` · `allow write: if false` (server-only via Admin SDK).

### Env vars required before go-live

```bash
gcloud run services update pulse-api \
  --set-env-vars \
  "WEBSITE_WEBHOOK_SECRET=<strong-random-secret>,META_WEBHOOK_SECRET=<meta-verify-token>" \
  --region asia-south1
```

**Schema decisions (2.1):**
- PAN stored as raw field `pan` in Firestore. `maskPan()` in `panUtils.ts` is the ONLY place rendering happens. Never pass raw PAN to any UI component.
- `consentTimestamp` is always `serverTimestamp()` — client clock never used.
- Soft-delete: `deleted: boolean` + `deletedAt` field. `allow delete: if false` enforced in rules.
- Activities are a subcollection (`/leads/{id}/activities`) not an array — avoids document growth limit and enables real-time feed independently.
- Stage transitions create a `status_change` activity entry automatically.

## Multi-Business-Line Architecture (Lead-Opportunity Model)

**Lead = person. Opportunity = deal.** Inspired by LeadSquared — the dominant Indian financial services CRM. A single customer can have multiple simultaneous opportunities across Loans, Wealth, and Insurance.

**Never collapse lead + deal into one record** — the old Phase 2.1 schema that embedded `product/ticketSize/stage` directly on the lead doc has been migrated away.

```
/leads/{leadId}                           ← PERSON record
  displayName, phone, email
  panRaw (raw PAN — UI always calls maskPan(); never renders raw)
  source: website | instagram | facebook | walkin | referral | broker
  tags: string[]
  primaryOwnerId (main RM relationship)
  consentGiven, consentTimestamp, consentMethod (DPDP Act mandatory)
  createdAt, createdBy, updatedAt
  deleted, deletedAt

/leads/{leadId}/opportunities/{oppId}     ← DEAL record
  opportunityType: loan | wealth | insurance
  product (string — matches /opportunity_types name)
  dealSize (₹)
  stage (from /opportunity_types stages array)
  ownerId (RM working this deal)
  status: open | won | lost
  expectedCloseDate, actualCloseDate
  notes

/leads/{leadId}/opportunities/{oppId}/activities/{actId}
  type: call | email | whatsapp | meeting | note | status_change
  content, by, at, relatedDocId?

/opportunity_types/{typeId}               ← admin-configurable
  name, businessLine (loan|wealth|insurance)
  stages: string[]  (ordered; 'Lost' is always available as terminal)
  active
  customFieldsSchema?: Record<string, CustomFieldDefinition>  ← Phase 2.6
  requiredDocuments?: DocumentTypeId[]                        ← Phase 2.6
  conditionalDocuments?: ConditionalDocumentRule[]            ← Phase 2.6
  eligibleProviderIds?: string[]                              ← Phase 2.6

/providers/{providerId}                   ← admin-configurable
  name, type: bank | amc | life_insurer | general_insurer
  active
  eligibleProducts?: string[]             ← Phase 2.6; loan product names

/document_types/{typeId}                  ← Phase 2.6; typeId is a stable string key
  label: string                           ← human-readable name

/commission_slabs/{slabId}
  bank, product, minTicket, maxTicket, percentage, flatFee
  effectiveFrom, effectiveTo
```

**Seeded defaults** (32 opportunity types × 3 business lines; 30+ providers):
- Loans **active** (7): Home Loan, LAP, Personal Loan, Business Loan, Business Loan (Unsecured), Education Loan, Auto Loan
- Loans **inactive** (4): Two-Wheeler Loan, Gold Loan, Credit Card, Balance Transfer
- Wealth (10): MF SIP, MF Lumpsum, PMS, AIF, Direct Equity, Bonds, FD/NCD, NPS, SGB, Tax-Saving
- Insurance (11): Term Life, Whole Life, Endowment, ULIP, Pension, Health, Motor, Travel, Home, Personal Accident, Commercial
- Providers: 5 core banks + HDFC Credila + 11 HFCs/NBFCs/auto finance + 5 AMCs + 5 life insurers + 5 general insurers

Commission calculator reads the active slab for `(provider, product, dealSize, close_date)` and produces a clear breakdown.

### Commission slab matching rules (Phase 2.4)

1. Filter by `providerId == submission.providerId`, `product == opportunity.product`, `active == true`
2. Filter by `basisAmount` in `[minTicket, maxTicket]` (maxTicket null = no upper limit)
3. Filter by `disbursedAt` in `[effectiveFrom, effectiveTo]` (effectiveTo null = open-ended)
4. If zero slabs match → `calculatedCommission = 0`, `notes = 'NO_SLAB_MATCH'`, flagged in UI for admin
5. If slab matched → `percentage != null`: `basisAmount × percentage / 100`; else `flatFee`
6. `basisOn` controls whether `disbursedAmount` or `sanctionedAmount` is used as the basis
7. `expectedPayoutDate = disbursedAt + 30 days` (hardcoded default; admin-configurable in Phase 4)
8. `commission_records` are **never deleted** — they are referenced by MIS `/commission_statements/lines.matchedRecordId`

### Commission record lifecycle

```
opportunity won + isPrimary set
       ↓
commission_record created (status: pending)  ← client writes (Phase 6: move to Cloud Function)
       ↓
Admin reviews, bank pays
       ↓
Admin marks paid → status: paid, actualAmount, actualPayoutDate recorded
  OR
Admin marks clawed_back → status: clawed_back, clawbackReason recorded
```

## Lead Routing Model (Phase 2.5+)

### CRM roles (set by admin on `/users/{uid}.crmRole`)

**Valid roles: `lead_generator` | `lead_convertor` | `manager` | `admin` | `null` (no role)**

`viewer` is **not a valid CRM role** and must not be assigned via the UI. The `CrmRole` type in `src/types/index.ts` retains `'viewer'` for backward-compat display of legacy data only.

| Role | Function |
|---|---|
| `lead_generator` | Sources leads (offline bulk, walk-ins, referrals). `primaryOwnerId` on the lead. Works opportunities at early stages. |
| `lead_convertor` | Closes deals. `ownerId` on the opportunity (set when transferred). Vertical-specific: **`convertorVertical` is required** — must be `loan`, `wealth`, or `insurance`. Set alongside crmRole in Permission Manager. |
| `manager` | Can trigger bulk imports; sees all leads and opportunities for their team. |
| `admin` | Full access everywhere. |

### Handoff pattern
- `lead.primaryOwnerId` → stays with the **generator** throughout the lead's life
- `opportunity.ownerId` → set to the **convertor** when transferred via `transferOpportunity()`
- This split lets the generator retain credit for sourcing while the convertor handles conversion

### Lead sources and SLA defaults

| Source | How leads arrive | SLA window |
|---|---|---|
| `offline_bulk` | Google Sheets import (`/crm/import`) | 24 calendar hours (Phase 2.5b: skip weekends) |
| `social_meta` | Meta Ads webhook (Phase 2.5b) | 30 minutes |
| `website` | Website form webhook (Phase 2.5b) | 30 minutes |
| Other (walkin, referral, etc.) | Manually created | 24 calendar hours |

### Round-robin assignment (two-stage as of Phase M — 2026-06-06)
Bulk import is now **two-stage**. The import creates every lead at `primaryOwnerId: 'UNASSIGNED'` with a mandatory `importName` — it does **not** assign at import time. An admin/manager then opens `/crm/import/queue`, selects agents, and triggers `POST /api/import/distribute`, which round-robins the batch's still-UNASSIGNED leads across the selected agents (sorted by `userId` for deterministic ordering), re-owns open opportunities, and sets each lead's +24h SLA at distribution time. Eligible agents = active `admin` / `lead_generator` / `lead_convertor`. See **Phase M**.

> _Legacy (pre-Phase-M): imports assigned immediately via `batchRowIndex % generatorCount`. Batches created before Phase M have no `importName` and never appear in the Import Queue._

### ImportBatchId provenance
Every bulk-imported lead carries `importBatchId: 'YYYY-MM-DD-XXXX'` **and `importName`**, linking it to an `/import_jobs/{id}` doc that records row counts, errors, who triggered the import, and (Phase M) the `importName` + distribution state (`distributed`, `distributedCount`, `agentIds`).

## MIS Module (Phase 4)

Four Firestore collections. Access gated by `misAccess: 'admin' | 'viewer'` on the user doc (set via Employees page).

```
/commission_statements/{statementId}
  providerId, source: 'bank'|'amc'|'insurer'
  periodStart, periodEnd (YYYY-MM), statementDate, receivedDate
  totalAmount, lineCount, matchedCount, discrepancyCount, unmatchedCount
  status: 'imported'|'reconciling'|'reconciled'|'discrepancy'|'closed'
  importedBy, importedAt, closedBy, closedAt

/commission_statements/{statementId}/lines/{lineId}
  rawDate, rawDescription, rawAmount
  parsedDate (YYYY-MM-DD), parsedAmount
  matchedCommissionRecordId: string | null
  discrepancyAmount: number | null
  status: 'unmatched'|'matched'|'discrepancy'|'unknown'|'excluded'
  reconciledBy, reconciledAt

/rm_payout_slabs/{slabId}
  targetType: 'user'|'role', targetId (userId or crmRole)
  businessLine: 'loan'|'wealth'|'insurance', percentage (0-100)
  effectiveFrom, effectiveTo, active

/rm_payouts/{payoutId}
  rmId, rmDisplayName, periodStart, periodEnd
  lineItems: Array<{ commissionRecordId, receivedAmount, payoutPercentage, payoutAmount, ... }>
  totalReceivedBase, totalPayout
  status: 'draft'|'approved'|'paid'
  generatedAt, generatedBy, approvedBy, approvedAt, paidAt, paymentReference
```

**Reconciliation flow:** Upload CSV → auto-detect columns → process into lines (all 'unmatched') → Auto-Match runs scoring algorithm (amount ±5% +50pts, date ±30 days +30pts, threshold ≥50) → manual match remaining lines → Close statement.

**Payout generation flow:** Select period → system finds all `commission_records` with `status='paid'` and `actualPayoutDate` in period → groups by `rmOwnerId` → applies active payout slab (user-specific overrides role-based) → creates draft `RmPayout` → admin approves → marks paid with payment reference.

**CSV upload:** Client reads file using `FileReader`, encodes as base64, sends in JSON body to `POST /api/mis/statements/upload`. Server parses and returns column detection results. Second call to `POST /api/mis/statements/process` with confirmed column mapping creates all line docs.

## Python Reporting (Phase 5)

`scripts/python/monthly_mis_report.py` — standalone script, not part of the React app.

**What it does:** Reads Firestore data (commission_records, commission_statements, rm_payouts) for a given month and writes 4 worksheets to a Google Sheet:
- Sheet 1 "Summary": total expected vs received, variance %
- Sheet 2 "By Bank": per-bank commission breakdown
- Sheet 3 "RM Payouts": per-RM payout totals
- Sheet 4 "Discrepancies": all unresolved discrepancy lines

**How to run:** `python monthly_mis_report.py 2026-05`
Requires: `.env` file with `GOOGLE_SA_KEY_PATH` and `MIS_REPORT_SHEET_ID`.
See `scripts/python/README.md` for full setup and scheduling instructions.

## Platform Hierarchy & Super Admins

Three accounts have permanent, elevated protection. They cannot be deactivated, and their permissions cannot be changed by non-super-admins — enforced in `server.ts`, `firestore.rules`, `SuperAdminPermissionsPage.tsx`, and `EmployeesPage.tsx`.

> **Note**: `AccessManagementPage.tsx` (`/hrms/admin/access`) has been **removed**. It is fully superseded by the Permission Manager at `/hrms/admin/permissions` (`SuperAdminPermissionsPage.tsx`).

| # | Name | Emp Code | Firebase UID | Hierarchy Label |
|---|------|----------|--------------|-----------------|
| 1 | Ajay Newatia | FAPL-000 | `3zdX5QBnTbQAcTdLzUjfXxefP8r2` | Co-Founder & Owner |
| 2 | Kumar Mangalam | FAPL-003 | `ZmZaciATPDYBb1O2blYWBjjbzMv1` | Director — Operations |
| 3 | Rahul Vijay Wargia | FAPL-022 | `5lAbJ4CZ5uM0LbU4gUYItNRAlEn2` | Tech & Builder |

**Single source of truth**: `src/config/hrmsConfig.ts` — `SUPER_ADMIN_UIDS`, `SUPER_ADMIN_LABELS`, `isSuperAdmin()`.

**Enforcement points**:
- **`server.ts`** — `SUPER_ADMIN_UIDS_LIST` parsed from `process.env.SUPER_ADMIN_UIDS`. Deactivate endpoint returns 403 for super admin targets. Sync-claims endpoint requires caller to also be a super admin to modify a super admin.
- **`firestore.rules`** — `isSuperAdminUid()` (is caller protected?) and `isSuperAdminTarget(userId)` (is target protected?) with UIDs hardcoded. `/users/{uid}` update rule: admin cannot modify a super admin doc unless the caller is also a super admin.
- **`SuperAdminPermissionsPage.tsx`** (`/hrms/admin/permissions`, super admin only) — Single permission interface for all 25 employees. Super admin rows shown read-only at top with gold `SUPER ADMIN` badge + lock icon. All dropdowns/toggles locked on SA rows. "Fix Ajay's Permissions" button auto-shown when his permissions mismatch canonical values (disappears once Firestore updates via onSnapshot). Convertor Vertical sub-dropdown appears when CRM Role = Convertor (required, shows amber warning if blank). "Super Admins" filter chip isolates SA rows. Column header tooltips on hover.
- **`EmployeesPage.tsx`** — Super admin rows show "★ Super Admin" badge. "Mark as Exited" button is hidden. Rows are excluded from bulk edit selection.

**Cloud Run env var**: `SUPER_ADMIN_UIDS=3zdX5QBnTbQAcTdLzUjfXxefP8r2,ZmZaciATPDYBb1O2blYWBjjbzMv1,5lAbJ4CZ5uM0LbU4gUYItNRAlEn2`

### Standard Departments

```
Management · Business Development & Client Relations · Digital Marketing · Human Resources
Finance & Accounts · Technology · Operations · Admin & Facilities · Housekeeping · Consultant
```

Defined in `src/config/hrmsConfig.ts` as `DEPARTMENTS` const array. Used as `<select>` in all department dropdowns (AddEmployeeModal, employee edit modals).

### Standard Designations (grouped for `<optgroup>`)

| Group | Designations |
|-------|-------------|
| Founder | Co-Founder & Director |
| Senior Management | Director — Operations, Director — Finance, Director — Technology |
| Mid Management | Vice President, Assistant Vice President |
| Team Lead | Senior Manager |
| Executive | Manager |
| Junior | Sales Manager, Relationship Manager |
| Entry Level | Jr. Relationship Manager, Telesales Officer |
| Support | Digital Content Manager, Accountant Officer, Office Assistant |
| Non-Staff | Consultant, Housekeeping |

Defined in `DESIGNATIONS` (flat TypeScript const) and `DESIGNATION_GROUPS` (grouped for `<optgroup>`) in `src/config/hrmsConfig.ts`.

## HRMS Data Model (Phase 3)

Five Firestore collections. All timestamps are `serverTimestamp()` — no client-clock dates.

```
/attendance/{recordId}
  userId, date (YYYY-MM-DD), checkIn: Timestamp|null, checkOut: Timestamp|null
  workingHours: number, status: 'present'|'half_day'|'absent'|'leave'|'holiday'
  markedBy: 'self'|'admin', notes

/leave_applications/{applicationId}
  employeeId, type: 'casual'|'sick'|'earned'|'lop'|'optional'
  fromDate, toDate (YYYY-MM-DD), days: number (working days)
  reason, status: 'pending'|'approved'|'rejected'|'cancelled'
  appliedAt, approvedBy, approvedAt, rejectionReason, calendarEventId

/leave_balances/{userId}_{year}
  employeeId, year,
  casual: { total, used, remaining }
  sick:   { total, used, remaining }
  earned: { total, used, remaining }

/holidays/{holidayId}
  date (YYYY-MM-DD), name, type: 'national'|'regional'|'optional', year

/payslips/{payslipId}
  employeeId, month (YYYY-MM)
  basicSalary, hra, conveyanceAllowance, medicalAllowance, otherAllowances, totalEarnings
  pf, professionalTax, tds, otherDeductions, totalDeductions, netPay
  workingDays, presentDays, lopDays
  generatedAt, generatedBy, notes
```

**Key design decisions:**
- Payslip PDF is generated on demand from stored data — no files in Firebase Storage. CA provides the salary figures manually each month via `/hrms/admin/payslips`.
- Leave approval triggers a Google Calendar all-day event on the Finvastra shared calendar via `POST /api/hrms/leave/sync-calendar` in `server.ts`. The Calendar sync is fire-and-forget and non-fatal — leave is approved regardless of whether the Calendar event creation succeeds.
- Leave balance doc ID is `{userId}_{year}` — a flat doc per employee per year, not a subcollection.
- `isHrmsManager: boolean` on the user doc grants leave approval + admin attendance override without requiring `role: 'admin'`. Set via the Employees page edit modal.
- Holidays seed (Hyderabad 2026) fires automatically on the HolidaysPage if the collection is empty.

## Commission System — Three Layers

Three distinct concepts that **must not be collapsed** into a single model. Each lives in a different module and Firestore collection tree.

| Layer | Phase | Module | Collection | What it represents |
|---|---|---|---|---|
| **Expected Commission** | 2.4–2.7 | CRM | `/commission_records` | What Finvastra *should* receive, calculated at deal close from slab × deal size |
| **Received Commission** | 4.1+ | MIS | `/commission_statements` | Actual payments from banks/AMCs/insurers, imported and reconciled |
| **RM Payout** | 4.3+ | MIS | `/rm_payouts` | What Finvastra pays each RM — % of *received* (not expected), with its own slab config |

### Key design rules

- `commission_records` IDs are **stable and permanent**. MIS statement lines reference them via `matchedRecordId` when a statement line is reconciled against an expected record. **Never delete commission_records** — this is enforced by `allow delete: if false` in `firestore.rules`, consistent with the soft-delete policy on `/leads`.
- Expected commission is calculated CRM-side and written when `opportunity.status` transitions to `'won'`. It is the CRM's output, not the MIS's input.
- Received commission is MIS-only. CRM screens never show raw bank payment data.
- RM payout is calculated on received, not expected. An opportunity can close but the payout only releases once the bank actually transfers the fee. This prevents paying RMs on optimistic projections.

### Firestore schema (planned — Phase 4)

```
/commission_records/{recordId}          ← CRM write, MIS reads for reconciliation
  opportunityId, leadId
  providerId, product, businessLine
  dealSize, rate, expectedAmount
  status: pending | partially_received | received | written_off
  matchedStatementIds: string[]         ← filled by MIS reconciliation

/commission_statements/{statementId}    ← MIS only
  providerId, statementMonth, importedAt, importedBy
  totalAmount, currency

/commission_statements/{statId}/lines/{lineId}
  description, amount
  matchedRecordId?                      ← links back to /commission_records
  reconciliationStatus: unmatched | matched | disputed

/commission_slabs/{slabId}             ← provider-facing slabs (CRM uses this)
  providerId, product, minTicket, maxTicket, percentage, flatFee
  effectiveFrom, effectiveTo

/rm_payout_slabs/{slabId}             ← RM-facing slabs (MIS uses this)
  minReceived, maxReceived, rmPercentage
  effectiveFrom, effectiveTo

/rm_payouts/{payoutId}                 ← MIS only
  rmId, month, totalReceived, totalPayout, status: draft | approved | paid
  lineItems: [{ opportunityId, recordId, received, payout }]
```

## UI Patterns (Phase 2.6+)

### VastraLogo (canonical)
The brand mark lives at `src/components/ui/VastraLogo.tsx`. All shells (`HrmsShell`, `CrmShell`, `MisShell`), the launcher, and the public tracker page import it from `src/components/VastraLogo.tsx` which re-exports the canonical version. **Do not create alternate logo implementations.** Props: `size` ('sm'|'md'|'lg'), `light` (white wordmark on dark backgrounds), `iconOnly` (mark without wordmark).

### SearchableSelect rule
Use `<SearchableSelect>` (from `src/components/ui/SearchableSelect.tsx`) for **any dropdown with more than 10 options or with dynamic data** (employees, providers, products). Use a plain `<select>` for static 6-option enums. This keeps the interaction cost low for small pickers while making large lists navigable.

`<MultiSearchableSelect>` (re-exported from `src/components/ui/MultiSearchableSelect.tsx`) is the multi-select variant — used for admin configuration of eligible products, document type overrides, etc.

### Loan Specialisation Pattern (Phase 2.6)
Each loan opportunity type carries a `customFieldsSchema` that drives a dynamic form section in Step 3 of the Add Opportunity wizard. The schema lives in `/opportunity_types/{typeId}` in Firestore (also embedded in the seed data in `seedData.ts`).

Key files:
- `src/features/crm/opportunities/AddOpportunityPage.tsx` — `DynamicFieldRenderer` component renders the schema; validation runs on submit
- `src/features/crm/config/seedData.ts` — canonical schema definitions for all 7 active loan types
- `src/types/index.ts` — `CustomFieldDefinition`, `ConditionalDocumentRule`, `DocumentTypeId`, `DocumentStatus`

Document checklist pattern:
- `requiredDocuments` + `conditionalDocuments` on `OpportunityTypeConfig` define the expected document set
- `conditionalDocuments` evaluates against `opportunity.customFields` at render time to add extra docs
- Actual collection status (`pending→collected→submitted→accepted`) is stored on the bank submission doc under `documentStatus: Record<DocumentTypeId, DocumentStatus>`
- `src/features/crm/hooks/useDocumentChecklist.ts` — `useDocumentChecklist()` resolves the final list; `advanceDocumentStatus()` and `rejectDocument()` mutate it
- `src/features/crm/config/seedDocumentTypes.ts` — seeds the `/document_types` collection (39 stable IDs)

Provider eligibility:
- `Provider.eligibleProducts?: string[]` — list of loan product names this provider supports
- `AddBankSubmissionModal` filters the bank picker to only show eligible providers for the current opportunity's product
- Backwards compat: providers with no `eligibleProducts` array are shown for all products

## Out of scope — DO NOT BUILD

- ❌ **Indian statutory payroll** (PF/ESI/PT/TDS/Form 16). CA handles in Excel. Our payslip module only renders PDFs from CA-provided salary data.
- ❌ **Customer-facing portals** — internal-only platform.
- ❌ **Payment processing / collections** — no money flow inside the app.
- ❌ **WhatsApp bot** — deferred to a later phase. Don't add Interakt/Twilio integration now.
- ❌ **Native mobile apps** — web-only; must be responsive.
- ❌ **Real-time collaboration features** — not needed for this use case.

If a request implies something on this list, **stop and confirm with me** before building.

## Coding conventions

- **TypeScript strict everywhere**. Run `npm run lint` (which is `tsc --noEmit`) after non-trivial changes.

### Form validation standard — field-level inline errors (ALL forms)

Every form in the platform must highlight invalid or missing required fields **in red directly on the field** when the user submits without filling them in. A single error banner at the top is **not** sufficient on its own — the banner is reserved for server/network errors only.

**Implementation pattern** (use this in every new form):

```typescript
// 1. State
const [serverError, setServerError] = useState('');            // API / network errors only
const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

// 2. Clear a field's error the moment the user starts correcting it
const set = (k: keyof MyForm, v: string) => {
  setFormValue(k, v);
  if (fieldErrors[k]) setFieldErrors(prev => { const n = { ...prev }; delete n[k]; return n; });
};

// 3. On submit — collect ALL errors first, then bail if any
const handleSubmit = async () => {
  const errs: Record<string, string> = {};
  if (!form.requiredField.trim()) errs.requiredField = 'Required';
  if (!form.email.trim()) errs.email = 'Email is required';
  else if (!form.email.endsWith('@finvastra.com')) errs.email = 'Must be @finvastra.com';
  if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }
  setFieldErrors({});
  // ... proceed with API call
};

// 4. Style helpers — inp() / sel() take an optional field key
const baseInp = 'w-full text-sm px-3.5 py-2.5 border rounded-lg outline-none focus:ring-2 bg-white transition-colors';
const inp = (field?: string) =>
  `${baseInp} ${field && fieldErrors[field]
    ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30'
    : 'border-slate-200 focus:ring-navy'}`;
const sel = (field?: string) => inp(field);   // same styling, different element

// 5. Label helper — shows red label text + inline error message
const fLabel = (text: string, field?: string, required = false) => (
  <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
    style={{ color: field && fieldErrors[field] ? '#DC2626' : '#8B8B85' }}>
    {text}{required && <span className="text-red-500 ml-0.5">*</span>}
    {field && fieldErrors[field] && (
      <span className="ml-2 text-red-500 font-medium normal-case tracking-normal">
        — {fieldErrors[field]}
      </span>
    )}
  </label>
);
```

**Usage**:
```tsx
{fLabel('Full Name', 'displayName', true)}
<input className={inp('displayName')} value={form.displayName} onChange={e => set('displayName', e.target.value)} />

{fLabel('Status')}   {/* no validation — optional field */}
<select className={sel()} ...>

{/* Server/network error only — not for validation */}
{serverError && <div className="...error banner...">{serverError}</div>}
```

**Rules**:
- Required fields: pass `field` key to both `fLabel()` and `inp()`/`sel()` — they turn red together
- Optional fields: call `inp()` / `sel()` with no argument (gets default border style)
- Template literals: `` className={`${inp()} resize-none`} `` — always call as function
- Never show a validation error inside the server error banner — keep them separate

## Routing architecture

The app has three modules behind a post-login launcher. **Never add features from one module into another module's shell.**

| Path | Component | Guard |
|---|---|---|
| `/login` | `LoginPage` | — |
| `/` | `LauncherPage` | authenticated |
| `/hrms/*` | `HrmsShell` + nested pages | authenticated + `hrmsAccess` |
| `/crm/*` | `CrmShell` + nested pages | authenticated + `crmAccess` |
| `/mis/*` | `MisShell` + nested pages | authenticated + `misAccess` |

**Module access flags on `/users/{uid}`:**
- `hrmsAccess: boolean` — default `true`. Everyone gets HRMS self-service.
- `crmAccess: boolean` — default `false`. Set `true` for RMs by admin.
- `misAccess: boolean` — default `false`. Set `true` for finance/accounts team by admin. Phase 4 build.
- `commandCentreAccess: boolean` — default `false`. Grants the cross-module Command Centre (`/crm/command-centre`); admins always have it. Toggled per-user in Permission Manager. Phase O.
- `role === 'admin'` bypasses all flags and can enter any module.

**CRM note**: the Lead engine builds entirely into `/crm/*`. Do not add Lead, Pipeline, or Commission routes to the HRMS shell or the root router.

**MIS note**: all commission reconciliation, statement imports, and RM payout generation live in `/mis/*`. Never add reconciliation UI to CRM or HRMS.

Each module shell (`HrmsShell`, `CrmShell`, `MisShell`) has an **Apps** button (⊞ icon) in the top nav that returns the user to `/` (the launcher).

- **File structure** (feature-based, not type-based):
  ```
  src/
    main.tsx, App.tsx, router.tsx
    components/ui/        ← shared primitives (Button, Input, Card, etc.)
    components/layout/    ← HrmsShell, CrmShell
    features/
      auth/               ← login, session, AuthContext
      home/               ← LauncherPage (module selector)
      hrms/
        dashboard/        ← Phase 4
        employees/        ← Phase 1
        attendance/       ← Phase 3
        leave/            ← Phase 3
        payslips/         ← Phase 3
        holidays/         ← Phase 3
        settings/         ← Phase 1
      crm/
        dashboard/        ← Phase 2
        leads/            ← Phase 2
        pipeline/         ← Phase 2
        commissions/      ← Phase 2
      mis/
        dashboard/        ← Phase 4.1
        statements/       ← Phase 4.1 (received commission import)
        reconciliation/   ← Phase 4.2
        payouts/          ← Phase 4.3
    lib/
      firebase.ts         ← client SDK init (emulator-aware)
      audit.ts            ← audit logger
    hooks/                ← useAuth, useFirestoreDoc, etc.
    styles/
      tokens.css          ← CSS vars (brand colours, fonts)
    types/                ← shared TS types from firebase-blueprint
  ```
- **Components**: functional, named exports (`export function LeadCard()`), no default exports except for routes/pages.
- **Forms**: react-hook-form + zod schemas. Validation schema lives next to the form.
- **State**: prefer Firestore subscriptions + local React state. No Redux/Zustand unless we hit real complexity.
- **Tailwind**: utility-first. Custom colours/fonts via the CSS vars in `tokens.css`, exposed through `@theme` in Tailwind v4 config.
- **Comments**: explain *why* not *what*. Code should be readable enough that the *what* is obvious.
- **No `any`**. Use `unknown` + narrow, or define the type.

## Security non-negotiables

- **All Firestore access goes through `firestore.rules`.** The rules must defeat every payload in `security_spec.md` ("Dirty Dozen"). Run rules tests with `@firebase/rules-unit-testing` before merging changes to rules.
- **Server timestamps only** for `createdAt` / `updatedAt`. Never trust the client clock — `request.time` in rules, `serverTimestamp()` on writes.
- **Audit log** every admin write to `/audit_logs/{logId}` with `{ actor, action, targetPath, before, after, at }`.
- **Role check on mutations**: `request.auth.token.role == 'admin'` for admin actions. Custom claims set via Cloud Function on user creation.
- **Strict schema validation** in rules — reject extra fields. Use `request.resource.data.keys().hasOnly([...])`.
- **No PII in client console logs** — ever. No `console.log(user)`.
- **Secrets via env vars only.** `.env.local` is gitignored. Production secrets via Cloud Run env config.

## Commands

```bash
npm install                  # first time
npm run dev                  # app only, real Firebase → http://localhost:3000
npm run dev:emulators        # Firebase emulators (auth:9099, firestore:8080, ui:4000)
npm run dev:app              # app with VITE_USE_EMULATOR=true → run alongside dev:emulators
npm run lint                 # tsc --noEmit, TypeScript check
npm run build                # vite build → dist/
npm run preview              # serve built dist
```

## Workflow with Claude Code

- **Plan before code**: for any task touching more than 2 files, output a written plan first (files to create/modify, order, open questions). Wait for my "go" before writing.
- **One feature per branch**: `feature/phase1-auth`, `feature/phase2-leads-capture`, etc.
- **Commit format**: `feat(scope): description` or `fix(scope): description` or `chore(scope): description`. Keep commits small and reviewable.
- **Never commit secrets**. Re-check `.env.local` is gitignored before any commit.
- **Ask before deleting** files or large code blocks.
- **Reference files when relevant**: `security_spec.md` for security tests, `firebase-blueprint.json` for entity shapes, `server.ts` for OAuth/Calendar patterns already wired.

## Compliance

### Laws that apply
| Law | What it covers | What the build does |
|---|---|---|
| DPDP Act 2023 | Personal data of loan applicants + employees | Consent on every lead, purpose limitation, PAN masking, retention policy |
| IT Act 2000 §43A | Sensitive personal data (PAN, financial info) | RBAC, audit logs, HTTPS/Firebase encryption, Firestore rules |
| RBI DSA Master Directions | Customer data handling by DSAs | Consent recorded, data not shared without consent, audit trail |

### Mandatory build controls
- **Consent**: Every lead must capture `consentGiven: true`, `consentTimestamp` (server), `consentMethod: 'verbal'|'written'|'digital'`. No lead creation without this. The submit button is disabled until the consent checkbox is checked.
- **PAN masking**: Full PAN stored in Firestore, **NEVER shown in UI**. Always render as `ABCDE****F` (first 5 + last 1 visible, middle 4 as `****`). Use `maskPan()` from `src/features/crm/leads/panUtils.ts` everywhere PAN is displayed.
- **Audit log**: Every admin write → `/audit_logs/{id}` with `{ actor, action, targetPath, before, after, at: serverTimestamp() }`.
- **No Aadhaar storage**: UIDAI prohibits this. Do not add Aadhaar fields anywhere — reject any request to add them.
- **Soft deletes**: Never physically delete leads. Set `deleted: true` + `deletedAt: serverTimestamp()`. Retain for 7 years per RBI guidelines. Firestore rules enforce `allow delete: if false` on the `/leads` collection.

## Known limitations — Phase 6 hardening backlog

Items that are accepted for now but must be resolved before production launch:

- ✅ **RESOLVED — `setPrimarySubmission` race condition** (`src/features/crm/hooks/useBankSubmissions.ts:136`): now wrapped in `runTransaction(db, ...)` (Phase 2.8). Reads + commission_record writes are atomic — duplicate-commission and dual-primary risks eliminated.
- ✅ **RESOLVED — Seed buttons exposed in prod**: `CrmDashboardPage.tsx` and `MisOverviewPage.tsx` setup panels are gated behind `import.meta.env.DEV` — absent from production builds. (Re-verify if bundler config changes.)
- **Role check reads Firestore** (`isAdmin()` and `hasCrmAccess()` in `firestore.rules`): each request does a `get()` on `/users/{uid}`. Migrate to custom claims via a Cloud Function trigger for performance and to eliminate this per-request read (TODO comment already in rules).
- **Attendance timestamps are strings** (`checkIn`, `checkOut`): stored as ISO strings, not `serverTimestamp()`. Firestore rules can only validate format, not prevent backdating. Rebuild attendance with `serverTimestamp()` in Phase 3.
- **Cross-tenant profile read** (Dirty Dozen Payload 12): all signed-in users can `get` any user profile doc (required for the employee directory). Field-level security requires either a server proxy or splitting public/private profile docs. Review in Phase 6.

## Pre-launch checklist

Items that **must be resolved before any production traffic hits the app**. Each has a severity and the phase it belongs to.

| # | Item | Severity | Phase | File / Location |
|---|------|----------|-------|-----------------|
| 1 | ✅ **DONE — `setPrimarySubmission` now transactional** — wrapped in `runTransaction` (reads + commission_record writes atomic); verified at `useBankSubmissions.ts:136` | ✅ Resolved | 2.8 | `src/features/crm/hooks/useBankSubmissions.ts` |
| 2 | ✅ **DONE — Seed/migration buttons gated by `import.meta.env.DEV`** — absent from prod build (CrmDashboardPage + MisOverviewPage); re-verify after any bundler config change | ✅ Resolved | 2.8 | `src/features/crm/dashboard/CrmDashboardPage.tsx` |
| 3 | **Role checks read Firestore on every request** — `isAdmin()` and `hasCrmAccess()` each do a `get()` call; migrate to custom claims via Cloud Function | 🟡 Performance | 6 | `firestore.rules` |
| 4 | **Attendance timestamps are strings** — `checkIn`/`checkOut` stored as ISO strings, not `serverTimestamp()`; Firestore rules can only validate format, not prevent backdating | 🟡 Security | Phase 3 rebuild | `src/lib/hooks/useAttendance.ts` |
| 5 | **Cross-tenant profile read** (Dirty Dozen Payload 12) — all signed-in users can `get` any user profile; required by directory but exposes private fields | 🟡 Privacy | 6 | `firestore.rules` |
| 6 | **Import batch processing in Express** — background `processImportBatch()` runs in the same process as the HTTP server; large imports risk Cloud Run timeout | 🟠 Reliability | 6 | `server.ts` → migrate to Cloud Function |
| 7 | **Service account email for Sheets API** — production ADC email must be confirmed and the template Sheet shared with it before enabling bulk import | 🟠 Config | Pre-launch | `server.ts` `TEMPLATE_SHEET_URL` + Cloud Run SA email |
| 8 | **CLAUDE.md `TEMPLATE_SHEET_URL` placeholder** — replace with the real published template Sheet URL | 🟢 Docs | Pre-launch | `server.ts` line 1 |
| 9 | **Generate and set `PAN_ENCRYPTION_KEY`** — generate a 64-char hex key (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) and add to `.env.local` (dev) and Cloud Run env (prod). Then run the "Migrate PAN Encryption" button from the admin dashboard once. | 🔴 Security | Pre-launch | `server.ts` `/api/admin/migrate-pan-encryption` |
| 10 | **Configure SMTP credentials** — add `SMTP_USER` (sender@finvastra.com) and `SMTP_APP_PASSWORD` (16-char Google App Password) to Cloud Run env vars for new-device login alerts and support ticket emails | 🟠 Config | Pre-launch | `server.ts` `/api/auth/login-alert`, `/api/support/raise` |
| 11 | **Schedule daily Cloud Scheduler HTTP jobs** — set up three cron HTTP targets pointing to: `/api/admin/run-document-expiry-check`, `/api/admin/run-bank-sla-check`, `/api/admin/run-commission-leakage-check` (all admin-authed via a service-account ID token) | 🟠 Config | Pre-launch | `server.ts` |
| 12 | **Review eligibility rules** — defaults in `/crm/admin/eligibility-rules` are empty; add real bank eligibility criteria before going live | 🟠 Config | Pre-launch | `ProvidersPage` + `EligibilityRulesPage` |
| 13 | **Add `expiryDays` to document types** — go to `/crm/admin/document-types` and set expiry windows per doc type (bank statements: 90 days, Form 16: 365 days, etc.) | 🟢 Admin | Pre-launch | `DocumentTypesPage` |
| 14 | **PAN encryption key: move from `process.env.PAN_ENCRYPTION_KEY` to Google Cloud Secret Manager** before go-live. `src/lib/encryption.ts` is already structured to accept the key as a parameter; just change where it's fetched from. | 🔴 Security | Pre-launch | `src/lib/encryption.ts` |
| 15 | **Scheduled jobs: register `bankSLAJob`, `commissionLeakageJob`, and `documentExpiryJob` endpoints in Google Cloud Scheduler** before go-live. Recommended schedule: `bankSLAJob` daily 09:00 IST, `documentExpiryJob` daily 09:15 IST, `commissionLeakageJob` 1st of each month 08:00 IST. | 🟠 Config | Pre-launch | `server.ts` |
| 16 | **MIS access: grant `misAccess` to CA (viewer) and accounts admin (admin)** before go-live via Employees page. | 🟢 Admin | Pre-launch | Employees page edit modal |
| 17 | **Seed production payout slabs with actual RM split percentages** before first payout generation — defaults (20% generator, 50% convertor, 30% manager) are illustrative only. Update via `/mis/admin/payout-slabs`. | 🔴 Financial | Pre-launch | `PayoutSlabsPage` |
| 18 | **Set `MIS_REPORT_SHEET_ID` in production `.env`** and share the target Google Sheet with the service account email before scheduling the monthly report. | 🟠 Config | Pre-launch | `scripts/python/.env` |

**Legend**: 🔴 must fix before first transaction · 🟠 must fix before scaling · 🟡 ongoing hardening · 🟢 admin/ops task

---

## Production Deployment

### How to build
```bash
npm run build:prod   # runs tsc --noEmit first, then vite build → dist/
```

### How to deploy
```bash
npm run deploy       # build:prod + firebase deploy --only hosting
```

All 18 pre-launch checklist items **must be completed** before running `deploy` for the first time. Pay special attention to items 9 (PAN encryption key), 16–17 (MIS access and payout slabs), and the service account email for Sheets.

### Domain
`pulse.finvastra.com` → Firebase Hosting via Hostinger DNS CNAME: `pulse` → `gen-lang-client-0643641184.web.app`. The `firebase.json` `hosting.target` is set to `"pulse"`. The deploy script runs `firebase target:apply` automatically.

### Security headers (configured in firebase.json)
- `X-Frame-Options: DENY` — clickjacking protection
- `X-Content-Type-Options: nosniff` — MIME-sniffing protection
- `Referrer-Policy: strict-origin-when-cross-origin`
- Long-lived cache on JS/CSS assets (`max-age=31536000, immutable`); `no-cache` on `index.html`

---

## Phase 5 — Production Hardening Summary

| Item | Status | Notes |
|---|---|---|
| `setPrimarySubmission` race condition | ✅ Fixed | Wrapped in `runTransaction()` — reads + financial writes atomic |
| 30-min idle session timeout | ✅ Added | `AuthContext.tsx`; event listeners on click/keydown/scroll/mousemove; `sessionStorage` flag shows "Session expired" on login page |
| Dev-only seed buttons in prod | ✅ Guarded | CrmDashboardPage + MisOverviewPage both behind `import.meta.env.DEV` |
| Client env validation | ✅ Added | `src/lib/envValidation.ts` called on startup; throws in PROD if Firebase vars missing or emulator flag on |
| Server env validation | ✅ Added | `validateServerEnv()` in `server.ts`; throws in `NODE_ENV=production` if any required var absent |
| CORS allowlist | ✅ Added | `server.ts` middleware; dev = 3 origins, prod = 2 (`pulse.finvastra.com`, `finvastra.com`) |
| Rate limiting | ✅ Upgraded | ~~In-memory~~ → Firestore `runTransaction` on `/rate_limits/{endpoint}:{uid}`; multi-instance safe; upload 10/hr, calendar-sync 20/hr, import 5/hr per user |
| Firebase Custom Claims | ✅ Added | `POST /api/admin/users/:uid/sync-claims` stamps `{role,hrmsAccess,crmAccess,crmRole,isHrmsManager,misAccess}` on Auth tokens; called on Add Employee and from SuperAdminPermissionsPage on every role/access change |
| `rm_payout_slabs` read too permissive | ✅ Fixed | Was `isSignedIn()` (any employee); now `isAdmin() || hasMisAccess()` |
| Firebase Hosting config | ✅ Added | `firebase.json` with rewrites, cache headers, security headers |
| Build + deploy scripts | ✅ Added | `npm run build:prod` (tsc-gated), `npm run deploy` |

### Dirty Dozen Audit Results (Phase 5)

| # | Payload | Result | Notes |
|---|---|---|---|
| 1 | Identity Theft (Attendance) | ✅ PASS | `incoming().userId == request.auth.uid` enforced |
| 2 | Privilege Escalation (role→admin) | ✅ PASS | Create rule locks `role == 'employee'`; admin update allowed by `isAdmin()` only |
| 3 | Self-Approval (Leave) | ✅ PASS | Update restricted to `isAdmin() \|\| isHrmsManager()` |
| 4 | Time Poisoning | ⚠️ PARTIAL | Date format validated; range validation requires server timestamps (Phase 3 rebuild TODO) |
| 5 | Ghost Field Injection | ✅ PASS | `hasOnly([...])` strict schema on user self-update |
| 6 | Orphaned Attendance | ✅ PASS | `hasAll(['userId','date','status'])` required |
| 7 | Shadow Modification | ✅ PASS | Attendance update allows only `[checkOut, status, duration]` |
| 8 | Resource Exhaustion | ✅ PASS | Leave reason capped at 2000 chars |
| 9 | ID Hijacking | ✅ PASS | Leave create requires `leaveId.matches('^[A-Za-z0-9]+$')` |
| 10 | Admin Spoofing | ✅ PASS | Global deny-all catches unknown collections |
| 11 | Future Dating | ⚠️ PARTIAL | String length checked; timestamp range validation deferred to Phase 3 |
| 12 | Cross-Tenant Access | ⚠️ KNOWN | User docs readable by all signed-in users (required for employee directory). Accepted known limitation — review in Phase 6 |
| — | MIS Viewer write attempt | ✅ PASS | `isMisAdmin() \|\| isAdmin()` required for all MIS writes |
| — | MIS statement delete | ✅ PASS | `allow delete: if false` on commission_statements |
| — | MIS payout delete | ✅ PASS | `allow delete: if false` on rm_payouts |
| — | Employee reads MIS data | ✅ PASS | `hasMisAccess()` returns false when `misAccess` is absent |
| — | Employee reads payout slabs | ✅ FIXED | Was FAIL (`isSignedIn()`); now `isAdmin() \|\| hasMisAccess()` |

## Phase A — HRMS Improvements (2026-05-24)

Additional HRMS features built after Phase 5 hardening. All have zero TS errors.

| Feature | Status | Files |
|---|---|---|
| **Claims & Reimbursements** | ✅ Complete | `src/features/hrms/claims/ClaimsPage.tsx`, `AdminClaimsPage.tsx`, `src/features/hrms/hooks/useClaims.ts` |
| **Company Document Library** | ✅ Complete | `src/features/hrms/documents/DocumentsPage.tsx`, `AdminDocumentsPage.tsx`, `src/features/hrms/hooks/useDocuments.ts`; Firebase Storage via `uploadBytesResumable` |
| **Announcements** | ✅ Complete | `src/features/hrms/announcements/AnnouncementsPage.tsx`, `AdminAnnouncementsPage.tsx`, `src/features/hrms/hooks/useAnnouncements.ts`; `readBy` tracking; unread badge in nav |
| **Dashboard improvements** | ✅ Complete | AnnouncementBanner strip; TeamTodayCard (admin/manager only); Quick Actions updated |
| **Attendance Today Card** | ✅ Complete | Dark gradient header with live time; full-width Clock In/Out buttons |
| **Employee Profile Completion** | ✅ Complete | Progress bar + missing-field chips for own profile in `EmployeeProfilePage.tsx` |
| **Settings → Contact HR** | ✅ Complete | Removed support ticket form; replaced with Email/Phone/Admin contact cards |

### Firestore collections added (Phase A)

```
/claims/{claimId}
  employeeId, employeeName, claimType, amount, description
  travelDetails?: { fromLocation, toLocation, distanceKm, modeOfTransport }
  receiptUrl, submittedAt, status: pending|approved|rejected|paid
  approvedBy, approvedAt, rejectionReason, paidAt, paymentReference, month (YYYY-MM)

/company_documents/{docId}
  title, category: policy|handbook|circular, description, fileUrl
  uploadedBy, uploadedAt, isActive, financialYear

/employee_documents/{docId}
  employeeId, documentType, title, fileUrl
  uploadedBy, uploadedAt, isActive, financialYear

/announcements/{announcementId}
  title, body, priority: normal|important|urgent
  publishedBy, publishedByName, publishedAt, expiresAt, isActive, pinned
  readBy: string[]   ← employees append their own uid via arrayUnion

/rate_limits/{endpoint}:{uid}   ← server-only (Admin SDK); rules deny all client access
  count, windowStart, updatedAt
```

### Firebase Storage (Phase A)

`src/lib/firebase.ts` exports `storage = getStorage(app)`. Document uploads use `uploadBytesResumable` → `getDownloadURL`. Files stored at `company-documents/{uuid}/{filename}` and `employee-documents/{uid}/{uuid}/{filename}`.

### Custom Claims (Phase A security)

`POST /api/admin/users/:uid/sync-claims` (admin-only server endpoint) stamps `{role, hrmsAccess, crmAccess, crmRole, isHrmsManager, misAccess}` as Firebase Auth custom claims. Called automatically:
- On Add Employee (in `create employee` handler in `server.ts`)
- On every role/access change in `SuperAdminPermissionsPage.tsx` (replaces old AccessManagementPage)

This replaces per-request Firestore `get()` calls for role checks — future milestone: update `firestore.rules` helpers to read from `request.auth.token.*` instead of `get()` once all sessions have refreshed tokens.

## Phase C — Birthday Announcements + Active Count Badge (2026-05-25)

Birthday logic is pure client-side date comparison — no scheduler, no AI.

| Feature | Status | Files |
|---|---|---|
| **Birthday hook** | ✅ Complete | `src/features/hrms/hooks/useBirthdayEmployees.ts` |
| **Birthday cards on Dashboard** | ✅ Complete | `src/features/hrms/dashboard/HrmsDashboardPage.tsx` |
| **Upcoming Birthdays section** | ✅ Complete | `src/features/hrms/dashboard/HrmsDashboardPage.tsx` |
| **Auto-read tracking (3s delay)** | ✅ Complete | `src/features/hrms/dashboard/HrmsDashboardPage.tsx` |
| **Dashboard nav badge** | ✅ Complete | `src/components/layout/HrmsShell.tsx` |
| **readBy rule hardened** | ✅ Complete | `firestore.rules` |
| **Unread count excludes expired** | ✅ Complete | `src/features/hrms/hooks/useAnnouncements.ts` |

### Birthday hook (`useBirthdayEmployees`)

- **Data source**: `/users` (all employees) + `/employee_profiles/{employeeId}` (DOB)
- **DOB format**: `"DD-MM-YYYY"` stored in `employee_profiles.dob`
- **Year ignored**: only `day + month` compared against today's date
- **Silently empty for non-admin**: `/employee_profiles` is admin/hrmsManager-only; regular employees see no birthday section (Firestore `permission-denied` is caught)
- Returns `birthdayEmployees` (today) and `upcomingBirthdays` (next 1–7 days, max 5, sorted ascending)
- `enabled` param: pass `false` to skip fetching entirely (shell passes `isAdmin || isHrmsManager`)

### Birthday cards on Dashboard

- Shown above the AnnouncementBanner, admin/manager only
- Gold left border (`4px solid #C9A961`), gold-tinted background
- Cake emoji 🎂 + "Happy Birthday, [Name]! 🎉" + department/designation subtitle
- Dismiss button (×) stores key in `localStorage`: `dismissed_birthday_{uid}_{YYYY-MM-DD}`
- Dismissed cards reappear the next day (date-scoped key)
- Multiple birthdays: "N birthdays today 🎉" header above stacked cards

### Upcoming Birthdays section

- Below Team Today card; hidden if no birthdays in next 7 days
- Shows avatar initial (or photo), name, designation, "in N days 🎂"
- Sorted ascending by daysUntil; capped at 5 entries

### Auto-read tracking

On `HrmsDashboardPage` mount, after **3 seconds** on the page:
- Captures the list of unread announcements at that moment
- Calls `markAnnouncementRead(id, uid)` for each (Firestore `arrayUnion`)
- Uses a `useRef` guard so it fires exactly once per page load, not on every subscription update
- Badge count drops in real-time as the writes propagate back

### Dashboard nav badge

`dashboardBadge = unreadAnnouncements + undismissedBirthdays`

- Unread announcements: live Firestore subscription (now also filters expired by `expiresAt`)
- Undismissed birthdays: read from `localStorage` at shell render time; refreshes on each navigation
- Announcements nav item retains its own `unreadAnnouncements` badge (unchanged)

### Firestore rule — announcements readBy

Employee self-service `arrayUnion` is now hardened with four guards:
1. Only `readBy` field changes (`.affectedKeys().hasOnly(['readBy'])`)
2. No entries removed (`incoming().readBy.hasAll(existing().readBy)`)
3. Exactly one uid added (`size() == existing().size() + 1`)
4. The added uid is the requesting user's own (`hasAll([request.auth.uid])`)

## Phase B — Statutory Compliance (2026-05-25)

Deterministic compliance tracking and PF calculation. All logic is rule-based — no AI/LLM anywhere.

| Feature | Status | Files |
|---|---|---|
| **Compliance Calendar** | ✅ Complete | `src/features/hrms/compliance/ComplianceCalendarPage.tsx` |
| **PF Tracker + ECR export** | ✅ Complete | `src/features/hrms/compliance/PfTrackerPage.tsx` |
| **PT auto-calculation in payslip generator** | ✅ Complete | `src/features/hrms/payslips/GeneratePayslipPage.tsx` |
| **PDF hides PT row when zero** | ✅ Complete | `src/features/hrms/payslips/payslipPdf.ts` |
| **HrmsShell: Statutory nav section + overdue badge** | ✅ Complete | `src/components/layout/HrmsShell.tsx` |
| **Router: compliance routes** | ✅ Complete | `src/router.tsx` |

### Compliance Calendar

**Path**: `/hrms/admin/compliance`  
**Access**: admin + isHrmsManager  
**Collection**: `/compliance_records/{recordId}`

Auto-seeds the current month when no records exist. Items seeded per month:
- TDS deposit — 7th of following month (e.g. June TDS due 7 July)
- PF deposit — 15th of following month
- PT deposit — last day of the month (Feb = 28/29)
- ESIC deposit — 21st of following month
- Quarterly TDS return — last month of each quarter (June/Sep/Dec/Mar)
- Annual PF return — March
- Annual PT return — March

Status computation:
- `filed` — `filedAt` is non-null
- `overdue` — `dueDate < today` and not filed
- `due_soon` — due within 7 days and not filed
- `upcoming` — more than 7 days away

`useOverdueComplianceCount(enabled)` — exported hook; HrmsShell uses it to show a red badge on the "Statutory" nav section header when overdue items exist.

Mark-as-Filed modal collects: reference number (required), amount (optional), notes (optional).

### PF Tracker

**Path**: `/hrms/admin/pf-tracker`  
**Access**: admin + isHrmsManager  
**Data source**: `/payslips/{id}` for the selected month + `/users/{uid}` + `/employee_profiles/{uid}` (for UAN)

PF calculation rules (wage ceiling ₹15,000):
```
pfWages          = min(basicSalary, 15000)
empContrib       = round(pfWages × 12%)          ← employee share
epsContrib       = min(round(pfWages × 8.33%), 1250)   ← Pension Scheme (employer)
epfDiff          = round(pfWages × 12%) − epsContrib   ← EPF proper (employer)
employerTotal    = epsContrib + epfDiff
totalContrib     = empContrib + employerTotal
```

**ECR export** (`exportECR()`): Tilde-delimited TXT in EPFO ECR v2 format. Filename: `ECR_Finvastra_YYYY-MM.txt`.  
**Summary CSV** (`exportSummaryCSV()`): Human-readable columns (Name, EmpCode, UAN, Basic, PF wages, all contribution columns). Filename: `PF_Summary_Finvastra_YYYY-MM.csv`.

Amber warning banner shown if any employee is missing a UAN number.

### Professional Tax (Telangana slabs)

`computePT(grossSalary, monthStr)` in `GeneratePayslipPage.tsx`:
- ≤₹15,000 gross → ₹0
- ₹15,001–₹20,000 → ₹150
- >₹20,000 → ₹200
- February surcharge: +₹100 if PT > 0 (annual adjustment under the Telangana PT Act)

Auto-recalculated whenever any earning field (basic, HRA, conveyance, medical, other allowances) changes. Admin can override the computed value manually. Hint text shown below the PT cell: "Auto-calc · TG PT Act".

PDF (`payslipPdf.ts`): PT row is suppressed entirely when `professionalTax === 0`. Label updated to `'Professional Tax (PT)'`. LOP row similarly suppressed when `lopDays === 0`.

### Firestore rules added (Phase B)

```
/compliance_records/{recordId}
  allow read:          isAdmin() || isHrmsManager()
  allow create,update: isAdmin() || isHrmsManager()
  allow delete:        false
```

## Add Employee Modal — known issues fixed (2026-05-25)

| Bug | Fix |
|---|---|
| **`officialEmail` sent as wrong field name** — server expects `email`, client was sending `officialEmail`, causing "email is required" even when filled | Changed body key to `email` in `AddEmployeeModal.tsx` |
| **Success screen never showed** — `onCreated()` closed the modal before `setResult()` could render the success UI; user saw nothing | Removed `onCreated()` from `handleSubmit`; Done button in success screen now calls both `onCreated` and `onClose` |
| **Error message below scroll fold** — error appeared at bottom of long form, outside viewport | Moved error to a red banner at the **top** of the form |
| **Emp code row caused horizontal scroll** — four `shrink-0` items in a half-width column overflowed the modal | Emp code section now spans full width (`col-span-2`); preview shown inline without overflow |
| **Official email not marked required** — label gave no indication it was mandatory | Added `*` required marker; client validates presence and `@finvastra.com` suffix before sending |

### Add Employee — required fields
- **Full Name** — required
- **Official Email (`@finvastra.com`)** — required; this becomes the Firebase Auth login address and temp password `Finvastra@2026` is set

### Add Employee — field-to-server mapping
The server endpoint `POST /api/admin/employees/create` expects the official login email as the field **`email`** (not `officialEmail`). All other optional fields are passed through as-is.

---

## Phase D — Employee Lifecycle, Assets & Access Fixes (2026-05-25)

Full lifecycle management: asset tracking, onboarding/offboarding checklists, FnF settlement, and employee UI access hardening.

| Feature | Status | Files |
|---|---|---|
| **EmployeesPage access fixes** | ✅ Complete | `src/features/hrms/employees/EmployeesPage.tsx` |
| **Employee exit / reactivation flow** | ✅ Complete | `server.ts` (deactivate + reactivate endpoints), `EmployeesPage.tsx` |
| **Asset Management** | ✅ Complete | `src/features/hrms/assets/AssetsPage.tsx` |
| **Employee profile assets section** | ✅ Complete | `src/features/hrms/employees/EmployeeProfilePage.tsx` |
| **Onboarding Checklist** | ✅ Complete | `src/features/hrms/onboarding/OnboardingPage.tsx` |
| **Offboarding Checklist + FnF** | ✅ Complete | `src/features/hrms/offboarding/OffboardingPage.tsx` |
| **HrmsShell: Lifecycle nav section + badges** | ✅ Complete | `src/components/layout/HrmsShell.tsx` |
| **Router: 3 new routes** | ✅ Complete | `src/router.tsx` |
| **ResetPasswordPage — `auth/requires-recent-login` fix** | ✅ Complete | `src/features/auth/ResetPasswordPage.tsx` — `signOut` on stale session; "Sign out and sign in again" button on error; permanent "Having trouble? Sign out" footer escape |

### EmployeesPage access changes

- **Login Status column**: hidden for regular employees; only visible to admin or `isHrmsManager`
- **Employee list filter**: regular employees see only `status === 'active'` employees; admin/HR manager sees All / Active / Inactive (default: All)
- **Inactive rows**: shown at `opacity-0.5` with red "Inactive" badge inline in the name cell
- `canManage` flag: `isAdmin || isHrmsManager` — gates all admin actions and the Login Status column

### Employee exit flow (server-side, requires admin token)

**`POST /api/admin/employees/:uid/deactivate`** — body: `{ lwd, exitReason, notes }`
1. Validates `exitReason` is a valid `ExitReason` literal
2. `admin.auth().updateUser(uid, { disabled: true })`
3. `admin.auth().revokeRefreshTokens(uid)` — immediate session invalidation
4. Updates `/users/{uid}`: `status=inactive`, `lwd`, `exitReason`, `deactivatedAt`, `deactivatedBy`
5. Calls `createOffboardingChecklist(uid, ...)` — creates `/offboarding_checklists/{uid}` with 16 items
6. Writes audit log entry

**`POST /api/admin/employees/:uid/reactivate`** — body: `{ newJoiningDate?, notes? }`
1. `admin.auth().updateUser(uid, { disabled: false })`
2. Updates `/users/{uid}`: `status=active`, clears `lwd`/`exitReason`, sets `reactivatedAt`, `reactivatedBy`, `mustResetPassword=true`
3. Calls `createOnboardingChecklist(uid, ...)` — creates `/onboarding_checklists/{uid}` with 20 items
4. Writes audit log entry

**Auto-create on new employee**: The `/api/admin/employees/create` endpoint calls `createOnboardingChecklist` in a non-fatal `try/catch` after claims sync.

### Checklist item defaults

**Onboarding (20 items, 4 categories):**
- `documents` (8): offer letter, appointment letter, POSH acknowledgement, NDA, ID proof, address proof, educational certificates, bank account details
- `system_access` (4): Google Workspace account, Pulse access, email signature, shared drives
- `assets` (3): laptop + accessories, SIM card / phone if applicable, access card
- `induction` (5): office tour, team introduction, HR policy walkthrough, benefits and leave policy, buddy assignment

**Offboarding (16 items, 4 categories):**
- `knowledge_transfer` (4): handover document, active leads/tasks briefed, credentials transferred, client introductions
- `assets` (4): laptop return, SIM card return, access card return, any other assets
- `system_access` (4): Pulse access disabled (auto-completed=true on creation), Google Workspace disabled, email forwarding set, Drive files transferred
- `documents` (4): resignation acceptance letter, experience letter, NOC, relieving letter

### Asset Management

**Firestore collection**: `/assets/{assetId}`

```
assetType: 'laptop' | 'sim_card' | 'mobile_phone' | 'access_card' | 'other'
assetName: string
serialNumber: string | null
imei: string | null          ← only for mobile_phone
simNumber: string | null     ← only for sim_card
phoneNumber: string | null   ← only for sim_card
purchaseDate: string | null  (YYYY-MM-DD)
purchaseValue: number | null
currentStatus: 'available' | 'assigned' | 'under_repair' | 'retired'
assignedTo: string | null    ← uid
assignedToName: string | null
assignedDate: string | null
returnedDate: string | null
condition: 'good' | 'fair' | 'damaged' | null
notes: string | null
addedBy: string              ← uid
addedAt: Timestamp
updatedAt: Timestamp
```

**Page** (`/hrms/admin/assets`, admin + isHrmsManager):
- Summary strip: Total / Assigned / Available / Under Repair counts
- Filter by type and status; free-text search by name/serial
- Add/Edit modal: conditional IMEI field (mobile_phone only); conditional SIM/phone fields (sim_card only)
- Assign modal: `SearchableSelect` for active employees, assign date, condition picker
- Return modal: return date, condition on return, notes
- **EmployeeProfilePage** shows currently assigned assets (admin/HR only, live Firestore subscription)

**Firestore rules**:
```
/assets/{assetId}
  allow read:          isAdmin() || isHrmsManager()
  allow create,update: isAdmin() || isHrmsManager()
  allow delete:        false
```

### Onboarding Page

**Path**: `/hrms/admin/onboarding`  
**Access**: admin + isHrmsManager  
**Collection**: `/onboarding_checklists/{uid}` (keyed by employee uid)

- List view with gold status strip (Pending / In Progress / Completed) — click strip card to filter
- Free-text search by employee name
- Click row → detail view with overall progress bar and items grouped by category
- Click any item → tick modal: optional notes; toggle complete/incomplete
- Status auto-advances: `pending → in_progress → completed` as items are ticked; rolls back if items are unticked
- **HrmsShell badge** (gold): count of pending + in_progress checklists

### Offboarding Page

**Path**: `/hrms/admin/offboarding`  
**Access**: admin + isHrmsManager  
**Collection**: `/offboarding_checklists/{uid}` (keyed by employee uid)

- List view with 5 filter cards: All / Pending / In Progress / Completed / FnF Pending
- **HrmsShell badge** (red): count of checklists with `fnfStatus !== 'settled'`
- Click row → detail view with checklist (same tick pattern as onboarding) plus FnF panel

**FnF Calculator (all deterministic arithmetic — no AI/LLM)**:

```
Daily rate          = grossSalary / workingDaysInLastMonth      (default 26)
Salary for days     = dailyRate × daysWorked
Leave encashment    = min(earnedLeaveBalance, 30) × dailyRate   (earned leave only, capped 30)
Gratuity            = (basic / 26) × 15 × tenureYears           (only if tenure ≥ 5 years)
                      basic ≈ grossSalary × 0.4 (approximation when separate basic not provided)
Notice deduction    = max(0, noticePeriodDays − noticePeriodServed) × dailyRate
Net payable         = salary + encashment + gratuity − noticeDeduction − otherDeductions
```

Joining date and LWD entered as `DD-MM-YYYY` or `YYYY-MM-DD`. Tenure computed with `differenceInYears(lwd, joiningDate)`.

**FnF PDF** (jsPDF + autotable):
- Navy letterhead, gold "FINVASTRA" wordmark
- Employee name, LWD, exit reason, generation date
- Earnings table (salary, leave encashment, gratuity) + Deductions table (notice, other)
- Green total-payable row
- Signature line for employee + HR/Management
- Filename: `FnF_{empCode}_{Name}_{YYYY-MM}.pdf`

**Mark FnF as Settled** modal: payment date (required) + UTR reference (required) → sets `fnfStatus: 'settled'`, `fnfSettledAt`, `fnfSettledBy`.

**`fnfStatus` lifecycle**: `pending → calculated` (after FnF calculator saved) → `settled` (after mark-settled).

### Firestore rules added (Phase D)

```
/onboarding_checklists/{docId}
  allow read:          isAdmin() || isHrmsManager()
  allow create,update: isAdmin() || isHrmsManager()
  allow delete:        false

/offboarding_checklists/{docId}
  allow read:          isAdmin() || isHrmsManager()
  allow create,update: isAdmin() || isHrmsManager()
  allow delete:        false
```

## HRMS ↔ CRM ↔ MIS Integration (2026-05-26)

Cross-module integration points. All data flows are **read-only from the source module**. No writes cross module boundaries — each module remains the single authoritative writer for its own data.

### 1. Exit Flow — Open Lead Reassignment

**Trigger**: `POST /api/admin/employees/:uid/deactivate` in `server.ts`

After disabling the Firebase Auth account, the deactivate endpoint now:
1. Queries `/leads` where `primaryOwnerId === uid` — counts non-deleted leads
2. Queries `collectionGroup('opportunities')` where `ownerId === uid` — counts open opportunities
3. If either count > 0, adds a `crm_reassignment` item (category: `'crm'`) to the offboarding checklist
4. Returns `{ ok, warning, openLeads, openOpportunities }` in the response
5. `EmployeesPage.tsx` shows a `toast.warning` if `warning` is present

**OffboardingPage.tsx enforcement:**
- `crm_reassignment` item is rendered at the **top** of the checklist with a red border when present
- "Go to CRM to reassign →" button links to `/crm/leads?ownerId=uid`
- "Mark FnF as Settled" button is **disabled** until `crm_reassignment.completed === true`
- Tooltip: "Reassign all open CRM items before settling FnF."

**Type**: `ChecklistItemCategory` now includes `'crm'`. `CATEGORY_META` in `OffboardingPage.tsx` has `crm: { label: 'CRM Reassignment', icon: AlertCircle, color: '#DC2626' }`.

### 2. CRM Performance Widget on Employee Profile

**File**: `src/features/hrms/employees/CrmPerformanceWidget.tsx`

Shown on `EmployeeProfilePage` (admin + isHrmsManager only) when `profile.crmAccess === true`.

**Data reads** (on mount, one-time):
- `/leads` where `primaryOwnerId === employeeUid` + `deleted === false` → total lead count
- Iterates each lead's `/opportunities` subcollection → counts `won` and `open` opportunities owned by this employee
- `/commission_records` where `rmOwnerId === employeeUid` + `status === 'paid'` → filters in-memory to current month → sums `calculatedCommission`

**Widget layout:** 3 stat cards (Active Leads / Disbursals ₹ / Open Opportunities) + conversion rate % + "View in CRM →" link.

No collection group index required — uses per-lead subcollection iteration (small dataset at 25 employees).

### 3. MIS Payout → Payslip Performance Incentive Suggestion

**File**: `src/features/hrms/payslips/GeneratePayslipPage.tsx`

When the admin selects a payslip month, the page checks `/rm_payouts` for approved or paid payouts matching that month. For each employee with a matching payout:
- A gold inline banner appears under the **Other Allow.** column: "MIS Payout Available — ₹X approved for [Name]"
- **Add ₹X** button: pre-fills `otherAllowances` with the payout amount
- **Dismiss** button: hides the banner for this session (state only, no write)
- Admin can always override the pre-filled amount — this is a suggestion only

### 4. Cross-Module Navigation Links

| Link | Location | Visible to |
|---|---|---|
| "View HR Profile →" | CRM `LeadDetailPage` — next to Primary RM name | Admin only |
| "HR Profile →" | MIS `PayoutDetailPage` — next to RM name in header | Admin only |

Both links navigate to `/hrms/employees/{uid}`.

## Phase E — IT Declaration Module (2026-05-26)

Allows employees to declare investments and exemptions for TDS computation. All calculations are deterministic rule-based code — no AI/LLM anywhere.

| Feature | Status | Files |
|---|---|---|
| **Employee IT Declaration form** | ✅ Complete | `src/features/hrms/itdeclaration/ItDeclarationPage.tsx` |
| **Admin IT Declarations review** | ✅ Complete | `src/features/hrms/itdeclaration/AdminItDeclarationsPage.tsx` |
| **Hook + tax computations** | ✅ Complete | `src/features/hrms/hooks/useItDeclarations.ts` |
| **HrmsShell nav + badges** | ✅ Complete | `src/components/layout/HrmsShell.tsx` |

### Tax Rules (Indian Income Tax Act — deterministic code)

| Component | Cap | Notes |
|---|---|---|
| **Section 80C** | ₹1,50,000 total | LI + PPF + ELSS + NSC + home loan principal + tuition + EPF voluntary + NPS 80CCD(1) + other |
| **Section 80D self/family** | ₹25,000 | Medical insurance premium |
| **Section 80D parents** | ₹25,000 / ₹50,000 if senior (60+) | `parentsSenior` flag on form |
| **Home Loan Interest Sec 24(b)** | ₹2,00,000 | Self-occupied property |
| **Section 80E education loan** | No limit | Full interest paid |
| **LTA** | As per company policy | Travel receipts required |
| **Estimated tax saving** | Indicative only | `totalDeductions × 0.30` (30% bracket) — not used for actual TDS computation |

### Financial Year

- April → March cycle. `year` stored as start year (2025 = FY 2025-26).
- Document ID: `{employeeId}_{year}`
- `currentFinancialYear()`: `month >= 4 ? year : year - 1`

### Declaration Lifecycle

```
Employee fills form → Save as Draft (status: 'draft')
       ↓
Employee submits → status: 'submitted', submittedAt set
       ↓
HR reviews:
  Accept   → status: 'accepted', acceptedBy, acceptedAt
  Revise   → status: 'draft', revisionNote written, employee notified
       ↓
Employee reopens → sets reopenRequested: true (HR sees flag in admin panel)
```

### Firestore collection

```
/it_declarations/{employeeId}_{year}
  employeeId, year, status: draft|submitted|accepted
  submittedAt, acceptedBy, acceptedAt
  reopenRequested: boolean, revisionNote: string|null
  section80C: { lifeInsurance, ppf, elss, nsc, homeLoanPrincipal, tuitionFees,
                epfVoluntary, nps80CCD1, other80C, total80C }
  section80D: { selfFamilyPremium, parentsPremium, parentsSenior, total80D }
  hra: { claimingHra, monthlyRent, landlordName, landlordPan, cityType, annualRent }
  homeLoan: { claimingHomeLoan, annualInterest, propertyAddress, lenderName }
  lta: { claimingLta, travelAmount, travelDetails }
  section80E: { claimingEducationLoan, annualInterest }
  totalDeductions, estimatedTaxSaving
  createdAt, updatedAt
```

### Nav badges

- **Employee nav** (IT Declaration): `1` (amber) if current FY declaration is null or `status === 'draft'`
- **Admin nav** (IT Declarations): count of `status === 'submitted'` across all years — single-field query, no composite index needed

### Key computation functions (all in `useItDeclarations.ts`)

- `compute80C(c)` → `min(sum of all 80C fields, 150000)`
- `compute80D(d)` → `min(self, 25000) + min(parents, parentsSenior ? 50000 : 25000)`
- `computeTotalDeductions(c80, d80, homeLoan, edu, lta)` → sum of all applicable deductions
- `computeTaxSaving(total)` → `round(total × 0.30)` — indicative only

## Phase F — Leave Policy Fixes + New Leave Types (2026-05-27)

HR Handbook alignment. All changes are deterministic code — no AI/LLM.

| Change | Detail |
|---|---|
| **Leave balances corrected** | Fallback defaults updated: CL→8, SL→7 (HR Handbook values). EL→15 was already correct. |
| **Saturday now a working day** | `calculateWorkingDays` in `useLeave.ts` uses `d.getDay() !== 0` instead of `isWeekend()`. Mon–Sat is the Finvastra work week. |
| **Compensatory Off** | Added `comp_off` to `LeaveType`, `LeaveBalance.comp_off?` (optional so existing docs work), balance editor, `ApplyLeavePage`, `AdminLeavePage.TYPE_LABELS`, `LeavePage` balance card |
| **Maternity Leave** | Added `maternity` to `LeaveType` and `ApplyLeavePage` dropdown only. No balance tracking needed (statutory). |

Files changed: `src/types/index.ts`, `src/features/hrms/hooks/useLeave.ts`, `src/features/hrms/leave/ApplyLeavePage.tsx`, `src/features/hrms/leave/AdminLeavePage.tsx`, `src/features/hrms/leave/LeavePage.tsx`

---

## Phase G — Leave Year-End Reset, HR Letters, Self-Service Profile, Leave Encashment, Org Chart (2026-05-27)

Five new HRMS features. All deterministic rule-based code — no AI/LLM anywhere.

| Feature | Status | Files |
|---|---|---|
| **Leave Year-End Reset** | ✅ Complete | `src/lib/leaveYearResetJob.ts`, `src/features/hrms/hooks/useLeaveYearReset.ts`, `src/features/hrms/leave/LeaveYearEndPage.tsx` |
| **HR Letter Generator** | ✅ Complete | `src/features/hrms/letters/letterPdf.ts`, `src/features/hrms/letters/HrLetterGeneratorPage.tsx` |
| **Employee Self-Service Profile** | ✅ Complete | `EditMyDetailsModal` inside `src/features/hrms/employees/EmployeeProfilePage.tsx` |
| **Leave Encashment Request** | ✅ Complete | `src/features/hrms/hooks/useLeaveEncashment.ts`, tabs added in `LeavePage.tsx` + `AdminLeavePage.tsx`, suggestion banner in `GeneratePayslipPage.tsx` |
| **Organisation Chart** | ✅ Complete | `src/features/hrms/orgchart/OrgChartPage.tsx` |
| **Navigation + Router** | ✅ Complete | `HrmsShell.tsx` + `src/router.tsx` |

### Leave Year-End Reset

**Path**: `/hrms/admin/leave-year-end`  
**Access**: admin + isHrmsManager  
**Server endpoint**: `POST /api/admin/run-leave-year-reset` — accepts OIDC or Firebase admin token; idempotent (409 if already done).

**Reset rules (FY April–March):**
- CL → 8 (fresh, no carry-forward)
- SL → 7 (fresh, no carry-forward)
- EL → `min(previousYearRemaining, 30) + 15` (carry-forward capped at 30)
- Comp Off → 0 (new doc has no `comp_off` field; optional field so existing docs unaffected)

**FY year** = April onwards: current calendar year; Jan–Mar: previous year. `currentFyYear()` in `useLeaveYearReset.ts`.

**HrmsShell badge**: red `1` on "Year-End Reset" nav item if current FY's `/leave_year_resets/{year}` doc doesn't exist yet.

**Cloud Scheduler job**: `leave-year-end-reset` — **already created** in `asia-south1`, fires `0 1 1 4 *` (April 1 at 01:00 UTC). Next run: 2027-04-01.

```bash
# Job already exists. To view or modify:
gcloud scheduler jobs describe leave-year-end-reset --location=asia-south1

# To run manually outside of April 1 (e.g. for FY 2026 if not yet run):
gcloud scheduler jobs run leave-year-end-reset --location=asia-south1

# Original creation command (for reference):
gcloud scheduler jobs create http leave-year-end-reset \
  --location=asia-south1 \
  --schedule="0 1 1 4 *" \
  --uri="https://pulse-api-787616231546.asia-south1.run.app/api/admin/run-leave-year-reset" \
  --oidc-service-account-email="787616231546-compute@developer.gserviceaccount.com" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{}'
```

**Firestore collections added:**
```
/leave_year_resets/{year}
  year, resetAt, resetBy, resetByName, employeesProcessed, errorCount, notes

/leave_balance_adjustments/{id}
  employeeId, year, leaveType, oldTotal, newTotal, delta, reason
  adjustedBy, adjustedByName, adjustedAt
```

### HR Letter Generator

**Path**: `/hrms/admin/letters`  
**Access**: admin + isHrmsManager  
**Collection**: `/generated_letters/{id}` (log only; no PDF stored — generated on demand)

**Four letter types:**

| Type | Ref prefix | Key fields |
|---|---|---|
| Appointment | `FV/APT/{YEAR}/{seq}` | designation, department, salary, joining date |
| Increment | `FV/INC/{YEAR}/{seq}` | new CTC, effective date, new designation (optional) |
| Experience | `FV/EXP/{YEAR}/{seq}` | from date, to date, last designation |
| Relieving | `FV/REL/{YEAR}/{seq}` | LWD, exit reason |

PDF format: navy letterhead header, gold rule, ref + date, letter body, dual signature block (employee + HR/Management), CIN footer.

### Employee Self-Service Profile Updates

7 fields employees can edit on their own profile (all via `/user_details/{userId}`):
- **Contact**: phone, personalEmail
- **Address**: presentAddress  
- **Health**: bloodGroup
- **Emergency contact**: name, phone, relationship

Firestore rule: `affectedKeys().hasOnly([phone, personalEmail, presentAddress, bloodGroup, emergencyContactName, emergencyContactPhone, emergencyContactRelationship, updatedAt])`. Sensitive fields (DOB, gender, PAN, permanentAddress) remain admin-only.

Every self-service update is logged to `/profile_update_logs/{id}` for audit.

### Leave Encashment Request

**Collection**: `/leave_encashment_requests/{id}`  
**Constraints**: EL only, min 1 day, max 30 days per request.

**Status lifecycle**: `pending` → `approved` / `rejected` → `paid`

**Employee flow** (LeavePage "Encashment" section):
- Form: days, gross salary, payroll month, reason
- Shows estimated amount = `days × (grossSalary / 26)`
- History table with status pills

**Admin flow** (AdminLeavePage "Encashment" tab):
- Pending card: approve / reject with reason
- Processed table: last 20 with status

**GeneratePayslipPage**: gold suggestion banner per employee row when an `approved` encashment exists for the selected month. "Add ₹X" pre-fills Other Allowances; "Dismiss" hides for the session.

**HrmsShell badge**: pending encashment count shown on "Leave Approvals" admin nav item.

### Organisation Chart

**Path**: `/hrms/org-chart`  
**Access**: all authenticated employees (read-only)  
**Data source**: `managerId` field on `/users/{uid}` docs (active employees only).

- Root: Ajay Newatia (FAPL-000, UID `3zdX5QBnTbQAcTdLzUjfXxefP8r2`)
- Employees with no/invalid `managerId` attach directly under root
- Max depth: 10 (guards against circular references in bad data)
- Collapse/expand per node (chevron button below each card); Expand All / Collapse All buttons
- Department filter (dropdown + legend chips): shows subtree containing matching employees, preserving ancestor chain
- Each card: avatar initial (or photo), name, designation, emp code, department badge in dept colour
- No external chart library — pure CSS flexbox tree

**Dept colours** (matching left-border accent on cards):

| Department | Colour |
|---|---|
| Management | gold `#C9A961` |
| Business Development & Client Relations | blue `#3B82F6` |
| Digital Marketing | purple `#8B5CF6` |
| Human Resources | pink `#EC4899` |
| Finance & Accounts | green `#10B981` |
| Technology | amber `#F59E0B` |
| Operations | cyan `#06B6D4` |
| Admin & Facilities | indigo `#6366F1` |
| Housekeeping | lime `#84CC16` |
| Consultant | orange `#F97316` |

---

## Authentication rules

- **Only `@finvastra.com` Google Workspace accounts** may log in. Enforced in `onAuthStateChanged` (hard block) — not just the Google picker hint. Personal Gmail addresses are blocked even if they somehow reach the auth flow.
- Blocked non-domain login attempts are written to `/access_logs` with `action: 'blocked_non_domain_login'`.
- `personalEmail` field on user docs = contact info only. Never used for Firebase Auth.
- Admin account: `rahulv@finvastra.com` (Rahul Vijay Wargia, FAPL-022). Hard-coded in `AuthContext.tsx` `ADMIN_EMAILS` and server `bootstrap-admin` endpoint.

## Employee login states

| `needsEmailSetup` | `employeeStatus` | Can log in? |
|---|---|---|
| `false` | `active` | ✅ Yes — email/password or Google |
| `true` | `active` | ❌ No — no `@finvastra.com` email exists yet |
| — | `inactive` | ❌ No — no Auth account created |

- 6 employees currently `needsEmailSetup: true` (FAPL-002, FAPL-013, FAPL-018, FAPL-021, HK-001, CON-003). Cannot log in until Ajay creates their Google Workspace email and admin runs the Add Employee flow.
- Temp password for all new employees created via admin: `Finvastra@2026`. Employee is sent a password reset link to set their own password on first login.

## Emulator development

- Persistence: `--import ./emulator-data --export-on-exit ./emulator-data` — data survives clean restarts (Ctrl+C). Force kills skip the export.
- Seed script: `npm run seed:emulator` — run **once** after `npm run dev:emulators`. Creates all 22 employee Auth accounts + Firestore profiles.
- `emulator-data/` is gitignored except `.gitkeep`. Never commit emulator data.
- Admin in emulator: `rahulv@finvastra.com` — created by seed script with temp password `Finvastra@2026`.

## Phase H — HR Letter Generator Extension + Firebase Storage (2026-05-27)

8 letter types covering the full employee lifecycle. PDFs stored in Firebase Storage and downloadable from two places.

| Feature | Status | Files |
|---|---|---|
| **4 new letter types (total: 8)** | ✅ Complete | `src/features/hrms/letters/letterPdf.ts` |
| **Firebase Storage upload flow** | ✅ Complete | `src/features/hrms/letters/HrLetterGeneratorPage.tsx` |
| **Download button in admin letters table** | ✅ Complete | `src/features/hrms/letters/HrLetterGeneratorPage.tsx` |
| **`useMyLetters` / `useAllLetters` hooks** | ✅ Complete | `src/features/hrms/hooks/useGeneratedLetters.ts` |
| **`GeneratedLetter` type + `LetterType`** | ✅ Complete | `src/types/index.ts` |
| **"My Letters" section on Employee Profile** | ✅ Complete | `src/features/hrms/employees/EmployeeProfilePage.tsx` |
| **`storage.rules`** | ✅ Complete | `storage.rules` (new file) |
| **`firebase.json` storage section** | ✅ Complete | `firebase.json` |

### 8 Letter Types

| # | Type | Ref prefix | When used |
|---|---|---|---|
| 1 | **Offer Letter** | `FV/OFR/YYYY/NNN` | Pre-joining candidate |
| 2 | **Appointment Letter** | `FV/APT/YYYY/NNN` | Formal appointment on joining |
| 3 | **Confirmation Letter** | `FV/CON/YYYY/NNN` | End of probation |
| 4 | **Salary Increment** | `FV/INC/YYYY/NNN` | Annual/mid-year revision |
| 5 | **NOC** | `FV/NOC/YYYY/NNN` | Bank loan, passport, part-time study |
| 6 | **Salary / CTC Certificate** | `FV/SAL/YYYY/NNN` | Bank loan, visa application |
| 7 | **Experience Certificate** | `FV/EXP/YYYY/NNN` | Post-exit proof of employment |
| 8 | **Relieving Letter** | `FV/REL/YYYY/NNN` | Separation + exit |

### Generate flow (changed from Phase G)

| Step | What happens |
|---|---|
| 1 | jsPDF builds PDF → `pdf.output('arraybuffer')` → `ArrayBuffer` |
| 2 | Upload to Firebase Storage: `hr-letters/{employeeId}/{FV_TYPE_YEAR_SEQ_Name.pdf}` |
| 3 | `getDownloadURL()` returns permanent URL |
| 4 | Save to `/generated_letters/{id}` with `storageUrl: url, storageStatus: 'uploaded'` |
| 5 | `window.open(url)` opens PDF in new tab |

### `generateLetterPdf()` return type change

`letterPdf.ts`: `generateLetterPdf()` now returns `ArrayBuffer` (not `jsPDF`). Callers never call `pdf.save()` directly — the page handles upload + `window.open`.

### Download access points

- **HR admin** (`/hrms/admin/letters`): Recent Letters table has a **PDF** download button on every row with a `storageUrl`.
- **Employee profile** (`/hrms/employees/{uid}`): "My Letters" section visible to the employee themselves + admin + isHrmsManager. Lists all letters with ref number, date, and **PDF** button.

### `GeneratedLetter` schema additions

```
storageUrl:    string | null    // Firebase Storage permanent download URL
storageStatus: 'uploading' | 'uploaded' | 'failed' | null
```

### Firebase Storage rules (`storage.rules`)

```
match /hr-letters/{employeeId}/{fileName} {
  allow read:  employee reads own OR admin/isHrmsManager
  allow write: admin/isHrmsManager only
}
match /company-documents/{allPaths=**} {
  allow read:  all authenticated employees
  allow write: admin/isHrmsManager only
}
match /employee-documents/{employeeId}/{allPaths=**} {
  allow read:  employee reads own OR admin/isHrmsManager
  allow write: admin/isHrmsManager only
}
```

### Storage setup (one-time — required before first letter upload)

Firebase Storage must be initialised via the Firebase Console before `storage.rules` can be deployed:

1. Go to https://console.firebase.google.com/project/gen-lang-client-0643641184/storage
2. Click **Get Started** → choose **Start in production mode** → select `asia-south1` region
3. Then run: `firebase deploy --only storage`

### Removed

- `generateAppointmentLetter()` function in `EmployeeProfilePage.tsx` — replaced by the full HR Letters page + profile download section.
- `jsPDF` import from `EmployeeProfilePage.tsx` — no longer needed.
- Local `GeneratedLetter` interface in `HrLetterGeneratorPage.tsx` — moved to `src/types/index.ts`.

---

## Phase I — CRM + HRMS Completion Sprint (2026-05-27)

CRM Dashboard rebuilt, HRMS Admin Dashboard upgraded, Wealth investment tracking, Insurance policy tracking, and employee quick-reference guide. All deterministic code — no AI/LLM anywhere.

| Feature | Status | Files |
|---|---|---|
| **CRM Dashboard rebuild** | ✅ Complete | `src/features/crm/dashboard/CrmDashboardPage.tsx` |
| **HRMS Admin Dashboard upgrade** | ✅ Complete | `src/features/hrms/dashboard/HrmsDashboardPage.tsx` |
| **CRM Wealth investment tracking** | ✅ Complete | `src/features/crm/hooks/useWealthInvestments.ts`, `src/features/crm/opportunities/wealth/WealthInvestmentsSection.tsx` |
| **CRM Insurance policy tracking** | ✅ Complete | `src/features/crm/hooks/useInsurancePolicies.ts`, `src/features/crm/opportunities/insurance/InsurancePoliciesSection.tsx` |
| **Employee quick-reference guide** | ✅ Complete | `src/features/hrms/guide/PulseGuidePage.tsx` |
| **Types: WealthInvestment, InsurancePolicy** | ✅ Complete | `src/types/index.ts` |
| **Firestore rules: investments + policies subcollections** | ✅ Complete | `firestore.rules` |

### CRM Dashboard Rebuild

**File**: `src/features/crm/dashboard/CrmDashboardPage.tsx` (~550 lines)

**Admin / manager view:**
- 4 stat cards: Total Leads, Open Pipeline, Won This Month, Commission Earned
- 3 business-line pipeline cards: Loans / Wealth / Insurance total ₹
- RM Performance Table: per-RM active leads, open opps, pipeline value, commission this month
- Source Breakdown: lead count by origin (website, social, walk-in, referral, etc.)
- CommissionDashboardCard + Quick Actions + SLA overdue alert

**RM view** (crmRole === 'lead_generator' or 'lead_convertor'):
- 4 personal stat cards: My Leads, My Open Opps, My Pipeline ₹, My Commission This Month
- My Pipeline by business line (if has opps)
- Source Breakdown of own leads
- CommissionDashboardCard + Quick Actions + SLA alert

**Inline hook `useOpenOppsStats()`**: uses `collectionGroup(db, 'opportunities')` with `where('status','==','open')` — reads only `opportunityType`, `dealSize`, `ownerId` fields; no per-lead batch fetches. All RM aggregation computed client-side from already-loaded arrays.

**DevAdminTools**: preserved at bottom, gated by `import.meta.env.DEV && isAdmin`.

### HRMS Admin Dashboard Upgrade

**Added to `HrmsDashboardPage.tsx`:**
- `usePendingHrCounts(enabled)` — three real-time `onSnapshot` subscriptions to claims/it_declarations/leave_encashment_requests counting pending items
- `useHeadcount(enabled)` — one-time `getDocs` on active users, groups by department
- `HrPendingActionsPanel` — amber panel with 4 clickable action rows (leave, claims, IT declarations, encashment); renders null when all counts are 0
- `HeadcountCard` — total headcount + top 5 departments as horizontal bars; admin-only

### Wealth Investment Tracking

**Firestore path**: `/leads/{leadId}/opportunities/{oppId}/investments/{investId}`

**Schema:**
```
investmentType: WealthInvestmentType  ('mf_sip'|'mf_lumpsum'|'direct_equity'|'bonds'|'pms'|'aif'|'fd_ncd'|'nps'|'other')
schemeName, folioNumber?, investedAmount, sipAmount?, units?, purchaseNAV?
currentValue?, purchaseDate (YYYY-MM-DD)
status: 'active'|'redeemed'|'paused'
notes?, addedBy, addedAt, updatedAt
```

**`WealthInvestmentsSection`** on OpportunityDetailPage (wealth type):
- Summary strip (Invested / Current / Return %) when ≥2 investments
- Per-investment rows with gain/loss indicator
- `AddInvestmentModal` with field-level validation; folio/SIP/units shown conditionally by type

### Insurance Policy Tracking

**Firestore path**: `/leads/{leadId}/opportunities/{oppId}/policies/{policyId}`

**Schema:**
```
policyNumber, insurerName, productName
policyType: InsurancePolicyType  ('term'|'health'|'motor'|'home'|'personal_accident'|'travel'|'endowment'|'ulip'|'pension'|'other')
sumAssured, annualPremium, premiumFrequency: 'annual'|'semi_annual'|'quarterly'|'monthly'
commencementDate, maturityDate? (savings products), renewalDate
status: 'active'|'lapsed'|'matured'|'cancelled'
notes?, addedBy, addedAt, updatedAt
```

**`InsurancePoliciesSection`** on OpportunityDetailPage (insurance type):
- Renewal alert badge (amber, `AlertTriangle` icon) when active policy renews within 30 days
- `AddPolicyModal` with conditional maturity date for savings products (endowment/ulip/pension)

### Firestore rules added (Phase I)

```
/leads/{leadId}/opportunities/{oppId}/investments/{investId}
  allow read:   isAdmin() || (hasCrmAccess() && (ownerId match || primaryOwner match))
  allow create: isAdmin() || hasCrmAccess() + ownership check
  allow update: isAdmin() || (hasCrmAccess() && ownerId match)
  allow delete: isAdmin()

/leads/{leadId}/opportunities/{oppId}/policies/{policyId}
  // same pattern as investments above
```

### Pulse Guide (Employee Quick-Reference)

**Path**: `/hrms/guide`  
**Access**: all authenticated HRMS employees  
**File**: `src/features/hrms/guide/PulseGuidePage.tsx`

12 accordion sections covering all key features:
1. Attendance — check-in/out, how records are stored
2. Leave — apply, types, balances, calendar
3. Claims & Reimbursements — submit, travel claims, receipts
4. Payslips — where to find, what's included
5. IT Declaration — what to declare, financial year, lifecycle
6. Company Documents — library, handbook, policies
7. My Profile — what you can edit yourself, what needs HR
8. Announcements — where to find, mark as read
9. Performance Reviews — cycles, self-evaluation
10. Training — enroll, certificate
11. HR Helpdesk — raise a ticket
12. Security & Privacy — session timeout, password reset

Search box filters sections by keyword in real time.

Quick links bar navigates to related HRMS pages (uses `<QuickLink>` component — extracted to avoid hook-in-map React violation).

---

## Phase J — In-App Notifications + Recruitment-HRMS Bridge (2026-05-27)

Notification bell in both shells, status notifications for leave/claims/IT declarations, and a direct "Add to HRMS" path from a hired candidate to the employee add modal.

| Feature | Status | Files |
|---|---|---|
| **`writeNotification()` helper** | ✅ Complete | `src/lib/notifications.ts` |
| **`NotificationBell` component** | ✅ Complete | `src/components/ui/NotificationBell.tsx` |
| **Bell in CRM shell** | ✅ Complete | `src/components/layout/CrmShell.tsx` |
| **Bell in HRMS shell** | ✅ Complete | `src/components/layout/HrmsShell.tsx` |
| **Leave approve/reject → notify employee** | ✅ Complete | `src/features/hrms/leave/AdminLeavePage.tsx` |
| **Claim approve/reject/pay → notify employee** | ✅ Complete | `src/features/hrms/claims/AdminClaimsPage.tsx` |
| **IT Declaration accept/revise → notify employee** | ✅ Complete | `src/features/hrms/itdeclaration/AdminItDeclarationsPage.tsx` |
| **Recruitment "Add to HRMS" CTA for hired candidates** | ✅ Complete | `src/features/hrms/recruitment/RecruitmentPage.tsx` |
| **EmployeesPage URL-param prefill** | ✅ Complete | `src/features/hrms/employees/EmployeesPage.tsx`, `AddEmployeeModal.tsx` |
| **Firestore rules: `/notifications/{uid}/items`** | ✅ Complete | `firestore.rules` |

### Notification schema

```
/notifications/{uid}/items/{itemId}
  type:      NotificationType   — new_lead | leave_approved | leave_rejected |
                                  claim_approved | claim_rejected | claim_paid |
                                  it_decl_revision | it_decl_accepted
  title:     string             — short heading shown in dropdown
  body:      string             — one-line detail
  link?:     string             — route to navigate on click
  read:      boolean
  createdAt: Timestamp
```

### Notification Bell (shared component)

`src/components/ui/NotificationBell.tsx` — placed in both shell headers (right side, before user avatar).
- Subscribes to `/notifications/{uid}/items` (newest 20, ordered by `createdAt desc`)
- Red badge shows unread count (9+ if more than 9)
- Click → dropdown with notification list; click item → mark read + navigate to `link`
- "Mark all read" button uses `writeBatch` to clear all in one round trip
- Closes on outside click

### `writeNotification(targetUid, payload)` helper

In `src/lib/notifications.ts`. Always fire-and-forget (`.catch(() => {})`). Called from:
- `AdminClaimsPage` — after approve, reject, mark-paid
- `AdminLeavePage` — after approve, reject
- `AdminItDeclarationsPage` — after accept, request-revision

### Recruitment → HRMS bridge

`RecruitmentPage.tsx`: candidates with `stage === 'hired'` show a green **Add to HRMS** button.
Clicking navigates to `/hrms/employees?addNew=1&prefillName=...&prefillEmail=...&prefillPhone=...`.

`EmployeesPage.tsx`: on mount, reads URL params. If `addNew=1`, auto-opens `AddEmployeeModal` with name/email/phone pre-filled. Clears params from URL with `replace: true` so refresh doesn't re-open.

`AddEmployeeModal.tsx`: accepts optional `prefill?: { name?, email?, phone? }` prop, initialises form state from it.

### Firestore rules (notifications)

```
match /notifications/{uid}/items/{itemId} {
  allow read:   if isSignedIn() && request.auth.uid == uid;
  allow create: if isAdmin() || isHrmsManager();
  allow update: if isSignedIn() && uid == request.auth.uid
                && affectedKeys().hasOnly(['read']) && read == true;
  allow delete: if false;
}
```

---

## Phase K — Email Notifications for HR Actions (2026-05-27)

In-app notifications existed from Phase J. Phase K adds SMTP email delivery for the same events, so employees are notified even when not logged in to Pulse.

| Feature | Status | Files |
|---|---|---|
| **`POST /api/hrms/notify/email` server endpoint** | ✅ Complete | `server.ts` |
| **`buildHrEmailHtml()` branded template helper** | ✅ Complete | `src/lib/notifications.ts` |
| **`sendHrEmailNotification()` client helper** | ✅ Complete | `src/lib/notifications.ts` |
| **Leave approve/reject → email** | ✅ Complete | `src/features/hrms/leave/AdminLeavePage.tsx` |
| **Claim approve/reject/pay → email** | ✅ Complete | `src/features/hrms/claims/AdminClaimsPage.tsx` |
| **IT Declaration accept/revise → email** | ✅ Complete | `src/features/hrms/itdeclaration/AdminItDeclarationsPage.tsx` |

### Server endpoint — `POST /api/hrms/notify/email`

Auth: caller must be admin or isHrmsManager (verified server-side against Firestore).

Body: `{ employeeId: string, subject: string, htmlBody: string }`

The server:
1. Verifies auth
2. Looks up employee email via `admin.auth().getUser(employeeId)` — skips silently if no Auth account
3. Sends branded HTML email via Google Workspace SMTP (nodemailer)
4. Always returns 200 — email failure is non-fatal (in-app notification is the primary channel)

### `buildHrEmailHtml(opts)` — client-side template builder

Produces a full branded HTML email (navy header, gold accents, detail rows table, optional note/highlight box, CTA button, footer). Never stores or logs PII — the HTML is built on the client and sent to the server in one call.

Parameters: `{ title, lines: [{label, value}][], note?, ctaLabel?, ctaLink? }`

### `sendHrEmailNotification(opts)` — client helper

Fetches current user's ID token, calls `POST /api/hrms/notify/email`. Always fire-and-forget: `.catch(() => {})`. Called alongside `writeNotification()` in all three admin pages.

### Notification channels side by side

| Action | In-app bell | Email |
|---|---|---|
| Leave approved | ✅ | ✅ |
| Leave rejected | ✅ (+ reason) | ✅ (+ reason in note box) |
| Claim approved | ✅ | ✅ |
| Claim rejected | ✅ (+ reason) | ✅ (+ reason in note box) |
| Claims paid | ✅ per claim (+ UTR) | ✅ per employee (+ UTR) |
| IT decl accepted | ✅ | ✅ |
| IT decl revision | ✅ (+ HR note) | ✅ (+ HR note in note box) |

---

## Phase L — Attendance Regularization + Payslip Notification (2026-05-27)

Employees can request corrections to past attendance. HR approves/rejects from an admin tab. Payslip generation now sends an in-app + email notification.

| Feature | Status | Files |
|---|---|---|
| **`AttendanceRegularization` type** | ✅ Complete | `src/types/index.ts` |
| **`useAttendanceRegularization` hook** | ✅ Complete | `src/features/hrms/hooks/useAttendanceRegularization.ts` |
| **`RegularizeModal` + calendar `?` buttons** | ✅ Complete | `src/features/hrms/attendance/AttendancePage.tsx` |
| **Correction request history section** | ✅ Complete | `src/features/hrms/attendance/AttendancePage.tsx` |
| **Admin `Corrections` tab** | ✅ Complete | `src/features/hrms/attendance/AdminAttendancePage.tsx` |
| **Approve/Reject + in-app + email notify** | ✅ Complete | `src/features/hrms/attendance/AdminAttendancePage.tsx` |
| **HrmsShell badge on admin Attendance nav** | ✅ Complete | `src/components/layout/HrmsShell.tsx` |
| **Firestore rules** | ✅ Complete | `firestore.rules` |
| **Payslip generation → notify employee** | ✅ Complete | `src/features/hrms/payslips/GeneratePayslipPage.tsx` |

### Regularization flow

```
Employee taps ? on a past absent/incomplete day
       ↓
RegularizeModal: enter corrected check-in + check-out + reason
       ↓
/attendance_regularizations/{id}  status: 'pending'
       ↓
Admin → Corrections tab → Approve or Reject (with reason)
  Approve → attendance record created/updated; status 'present'; workingHours computed
  Reject  → rejectionReason saved; employee can re-submit
       ↓
Employee notified (in-app bell + email)
```

### Calendar cell indicators

- **`?` button** (navy, gold text): past working day that is absent or missing check-in/out — no pending request yet
- **Amber dot** in cell corner: request is pending review
- **Amber border** on cell: request pending
- **Green background** on cell: request approved

### Correction request history

Below the calendar, a "My Correction Requests" section lists this month's requests with status pills. Rejected requests show an HR note and a "Submit a new request" link.

### Admin Corrections tab

Two-tab layout: **Daily View** (existing) + **Corrections** (new).

Corrections tab:
- Filter chips: Pending / Approved / Rejected / All
- Each card: employee name, status pill, date, requested times, reason
- Pending cards: **Approve** (green) + **Reject** (red, opens modal for reason)
- Approve looks up existing attendance doc via `getDocs` query before calling `approveRegularization()`

### Firestore rules (`/attendance_regularizations/{reqId}`)

```
allow read:   employee reads own OR admin/HR reads all
allow create: employee for own records, status must be 'pending', date format validated
allow update: admin/HR only (to approve/reject)
allow delete: false
```

### Notification channels (attendance correction)

| Action | In-app bell | Email |
|---|---|---|
| Correction approved | ✅ | ✅ |
| Correction rejected | ✅ (+ reason) | ✅ (+ reason in note box) |

### Payslip notification (added to Phase L)

After `createPayslip()` succeeds, the page fires:
- `writeNotification(employeeId, { type: 'leave_approved', title: 'Payslip ready — Month', ... })`
- `sendHrEmailNotification` with net pay + working days in the detail table

Both are fire-and-forget. Employee is directed to `/hrms/payslips`.

---

## Known context for the build

- Solo developer (Rahul) on this. Part-time alongside other Finvastra work.
- Director (Ajay) is non-technical. UI must be self-explanatory.
- 25-employee scale today, designed to handle 250 without architecture changes.
- Marketing site `finvastra.com` runs on Hostinger. This app lives at `pulse.finvastra.com` via DNS CNAME → Firebase Hosting. No conflict between the two.
- Today's date when this file was written: **May 19, 2026.** Production launch target: **end of October 2026.**

---

## June 2026 Sprint — What Was Built

### UI/UX — Glassmorphism Design System

Complete visual overhaul to editorial-premium dark glass aesthetic.

| Item | File(s) | Notes |
|---|---|---|
| Glass design system | `src/styles/glass.css` | CSS variables for panels, inputs, badges, tables, modals, sidebars, headers |
| Brand tokens | `src/styles/tokens.css` | `--navy-*`, `--gold-*`, `--paper-*`, `--ink-*`, `--mute` mapped to Tailwind theme |
| 42-page glass sweep | CRM + MIS pages | `glass-panel`, `glass-inp`, `glass-table`, `glass-modal-panel`, `badge-glass-*` applied across all features |
| Page fade-in animation | All shells | `AnimatePresence` + `motion.div` on route change (0.18s ease-out) |
| Mobile hamburger drawer | HrmsShell, CrmShell, MisShell | Spring-animated slide-in drawer; closes on navigation |
| Shared primitives | `Button`, `Badge`, `Skeleton`, `EmptyState`, `cn()` | Reusable across all modules |

### Dark / Light Mode Toggle

| Item | Detail |
|---|---|
| `ThemeProvider.tsx` | React context + `useTheme()` + `ThemeToggle` button (Sun/Moon icon) |
| Persistence | `localStorage('fv-theme')` — survives page reload |
| Dark mode CSS vars | `--shell-text-secondary/dim/icon`, `--shell-border`, `--shell-border-mid`, `--shell-hover-*` |
| Light mode overrides | `body.light-mode` in `glass.css` — all panels, sidebar, header, modals, tables, buttons |
| SearchableSelect | Both single + multi variants use `var(--ss-*)` CSS vars — fully theme-aware |
| Native `<select>` | `color-scheme: dark` on `:root` → OS renders options dark; `option` background overrides for Webkit |
| Shell chrome | All three shells: zero hardcoded `rgba(240,236,224,…)` values — all use CSS variables |
| ThemeToggle in shells | Placed in header (right side) of HrmsShell, CrmShell, MisShell |

### CRM — Pipeline Stage Data Capture

Each opportunity stage now collects structured data on advance.

| Stage | Fields captured |
|---|---|
| Contacted | Contact method, outcome, callback date, notes |
| Documents | Document type, completeness %, missing docs, notes |
| Submitted to Bank | Bank name, application number, submission date, notes |
| Sanctioned | Sanctioned amount, sanction date, ROI, tenure, notes |
| Disbursed | Loan No, Application No, Disbursed Amount, Disbursal Date, DSA Code/Name, City/State, Company Name |
| Lost | Lost reason (competitor/price/docs/other), competitor name, notes |

- **StageAdvanceModal**: form per stage, validation, saves to `opportunity.stageData` in Firestore
- **StageDataHistory**: accordion timeline showing all captured stage data on `OpportunityDetailPage`
- **Firestore rules**: `stageData` added to allowable update keys on `/leads/{id}/opportunities/{id}`
- **Mark-as-Lost fix (2026-06-08)**: `lostDetails` added to the opportunity owner's allowed update keys (was denied for non-admin telecallers, so "Mark as Lost" silently failed for them); `slaDeadline` added to the **lead** owner's allowed keys **but only when cleared to `null`** (owners cannot extend their own SLA to dodge the overdue badge). On marking an opp lost with no other open opps, `OpportunityDetailPage` clears the lead's `slaDeadline` → it drops out of all overdue-SLA counts instantly.
- **Lead disposition (2026-06-08)**: raw / no-opportunity leads can now be dispositioned **directly on `LeadDetailPage`** via a **Status dropdown** (New · Interested · Callback later · Not interested · No response · Wrong number), shown to the lead's owner or admin. Stored as `leadStatus` / `leadStatusAt` / `leadStatusBy` on `/leads/{id}` (added to the owner's allowed update keys). Closing dispositions (`not_interested` / `no_response` / `wrong_number`) also clear `slaDeadline` → instantly out of overdue. This closes the gap where "Mark as Lost" only existed at the **opportunity** level — useless for telecallers working freshly-distributed leads that have **0 opportunities**. New type: `LeadStatus`.

### CRM — Pipeline Kanban Board (`/crm/pipeline`)

Complete rewrite from table to Bigin/Jira-style board.

- Stage columns derived from `useOpportunityTypes()` — ordered per config, filtered by business line
- Column header: stage name + count chip + total pipeline value
- Deal cards: customer name, product, deal size (gold), RM avatar, age in days, Overdue/Due-soon alerts
- **Board/Table toggle** in page header
- Horizontal scroll with fixed-width columns; per-column `overflow-y-auto` scroll
- Stage accent colours cycle through a 10-colour palette
- Falls back to stages from rows when `opportunity_types` collection not seeded

### CRM-MIS Disbursal Bridge

When a CRM user marks an opportunity as "Disbursed" (stage advance), the disbursal fields are written to the matching `commission_record` doc.

**CRM side (`OpportunityDetailPage.tsx`):**
- After saving DisbursedData, queries `commission_records` where `opportunityId == oppId`
- Updates each record: `loanNo`, `applicationNo`, `disbursedAmount`, `disbursalDate`, `dsaCode`, `dsaName`, `cityState`, `customerCompanyName`

**MIS Reconciliation (`ReconciliationPage.tsx`):**
- Fetches `commission_records` for all matched statement lines (batched `documentId()` queries)
- "Matched To" column shows: Loan No (gold mono), App No, Company Name
- View modal shows full CRM disbursal table + **"View full opportunity in CRM →"** link

**MIS Overview — Disbursals tab (`MisOverviewPage.tsx`):**
- New tab alongside "Overview" tab
- Fetches all `commission_records`, filters by selected month on `disbursalDate ?? expectedPayoutDate`
- Table: Loan No, App No, Company, Date, Amount, Commission ₹, DSA Code, Status badge, "View →" CRM link

**Firestore rules update:** `commission_records` update now allows two cases:
1. Admin: status/payment fields only
2. CRM user (own record): disbursal reference fields only

### HRMS — Email Notifications: ACTIVE

Email notifications are live. All HR actions send both an in-app bell (`writeNotification()`) **and** an email to the employee's `@finvastra.com` address.

**Transport**: Gmail API via domain-wide delegation (`GOOGLE_SA_JSON_BASE64` + `GMAIL_SENDER=admin@finvastra.com`). No SMTP password required — same transport used by login alerts and password reset emails.

**`/api/hrms/notify/email` endpoint**: Updated to call `sendGmailMessage()`. Falls back to nodemailer SMTP only when a PDF attachment is present and `SMTP_USER`/`SMTP_APP_PASSWORD` are set.

**`/api/admin/test-smtp` endpoint** (admin only): POST to send a test email to `rahulv@finvastra.com`.

**Call sites** (all fire-and-forget `.catch(() => {})`):
- `AdminLeavePage.tsx` — leave approved, leave rejected
- `AdminClaimsPage.tsx` — claim approved, claim rejected, claim paid
- `AdminItDeclarationsPage.tsx` — IT declaration accepted, revision requested (detail view + quick-accept in list)
- `AdminAttendancePage.tsx` — correction approved, correction rejected
- `GeneratePayslipPage.tsx` — payslip generated

### Other Fixes

| Fix | Detail |
|---|---|
| Payslip PDF | Rebuilt to match official Finvastra format (letterhead, signatures, deduction table) |
| Company name/email corrections | Employee profiles updated for data accuracy |
| Holiday calendar | Fixed edge cases in auto-seed logic |
| Referral lead permissions | Employees in referral-only mode correctly route new leads via workload-aware assignment |
| HRMS nav simplification | `Employees` page gated to admin/HR manager; sub-group labels in admin nav |
| Data Import page | Super-admin-only bulk import for employee data |

---

## Phase M — Two-Stage Bulk Import, Import Queue & Lead-View Audit (2026-06-06)

Bulk lead import reworked from one-shot round-robin into a two-stage flow (import → hold → distribute), plus a global progress indicator and a lead-view audit trail. All deterministic — no AI/LLM.

| Feature | Status | Files |
|---|---|---|
| **Two-stage import** | ✅ | `server.ts` `/api/import/run` requires `importName` and holds every lead at `primaryOwnerId: 'UNASSIGNED'` — no distribution at import time |
| **Distribute endpoint** | ✅ | `server.ts` `POST /api/import/distribute` — round-robins a batch's still-UNASSIGNED leads across selected agents, re-owns open opportunities, resets +24h SLA, one aggregated notification per agent, stamps `distributed*` on the job. **Parallelised** (bounded-concurrency waves, per-lead try/catch) and **run in-request** (not fire-and-forget) so Cloud Run keeps CPU allocated — finishes in seconds for hundreds of leads instead of minutes of serial round-trips |
| **Mandatory import name** | ✅ | `ImportPage.tsx` Step 1 field (inline validation); stored on `import_jobs.importName` + denormalised to each lead's `importName` for later source-quality analysis |
| **Import Queue page** | ✅ | `src/features/crm/import/ImportQueuePage.tsx` at `/crm/import/queue` — lists undistributed batches (name · count · date), agent picker, Distribute action |
| **Global import progress dock** | ✅ | `src/features/crm/import/ImportProgressDock.tsx` — mounted once in `CrmShell`; live progress bar on every CRM page; flips to "Distribute now →" on completion. Reuses the shell's `import_jobs` subscription (no extra listener) |
| **CrmShell nav + badge** | ✅ | "Import Queue" nav item (icon `PackageOpen`) with awaiting-distribution badge; Import nav now exact-match active |
| **Import History columns** | ✅ | Name + Distributed columns added to `ImportHistoryPage.tsx` |
| **Lead-view audit log** | ✅ | `LeadDetailPage.tsx` writes `/lead_view_logs` on each lead open; `AccessLogsPage.tsx` reads (admin) — detects employees systematically mining the customer list |
| **Header refactor** | ✅ | `components/ui/AppsMenu.tsx` + `UserMenu.tsx` extracted; used across HrmsShell / CrmShell / MisShell |
| **Login redirect hardening** | ✅ | `AuthContext.tsx` — `onAuthStateChanged` profile load wrapped in `try/catch` so `loading` always resolves to `false` even if the Firestore read fails (prevents stuck-on-sign-in) |
| **LauncherPage theme fix** | ✅ | Sign-out button + divider use theme tokens (`var(--text-muted)` / `var(--shell-border)`) instead of hardcoded cream rgba |

> Also in this session: the import **preview table** is height-capped (`max-height` + sticky header) so a large sheet scrolls inside its panel instead of running down the whole page; and the agent-eligibility fix (include `lead_convertor` telecallers, exclude inactive staff) now lives on the Import Queue picker.

### `ImportJob` schema additions (`src/types/index.ts`)
```
importName: string                 // mandatory label set at import (tracks sheet source/quality)
distributed?: boolean              // false until routed from the queue
distributedAt?, distributedBy?, distributedCount?, agentIds?
```
`Lead` also gains `importName?` (denormalised batch label).

### Agent eligibility (distribution & import-queue picker)
Routes to **active** employees who are `admin`, `lead_generator`, or `lead_convertor` (telecallers): `employeeStatus !== 'inactive'`. (Replaces the old generator-only filter, which hid telecallers.)

### Firestore — `/lead_view_logs/{logId}`
```
viewedBy (uid), viewedByName, leadId, leadName, viewedAt
allow read:   isAdmin()
allow create: signed-in & viewedBy == request.auth.uid & keys hasAll([viewedBy, leadId, viewedAt])
allow update, delete: false
```

---

## Complete API Endpoint Index (server.ts — as of 2026-06-06)

Authoritative list of every Express route. Verify against `server.ts` after any backend change.

**Auth / OAuth / session**
- `GET  /api/auth/google/url` · `GET /api/auth/callback` — Google OAuth (Calendar consent)
- `POST /api/auth/login-alert` — new-device login email
- `POST /api/auth/forgot-password` · `POST /api/auth/verify-reset-dob` — branded password reset (DOB-gated)

**Calendar**
- `POST /api/calendar/events` · `POST /api/hrms/leave/sync-calendar` — leave → shared Calendar (fire-and-forget)

**Admin / dev / claims**
- `GET  /api/health`
- `POST /api/dev/bootstrap-admin` — promote allowlisted admin email
- `POST /api/admin/users/:uid/sync-claims` — stamp role/access custom claims
- `POST /api/admin/migrate-pan-encryption` — one-time PAN encryption migration
- `POST /api/admin/test-smtp` — admin test email
- `GET  /api/admin/webhook-logs` — webhook log proxy (admin read)

**CRM — PAN, bulk import, documents**
- `POST /api/leads/:leadId/pan` — encrypt + store PAN server-side
- `GET  /api/import/service-account-email` · `POST /api/import/check` · `POST /api/import/preview`
- `POST /api/import/run` — start import (holds leads UNASSIGNED; requires `importName`)
- `POST /api/import/distribute` — round-robin a held batch to agents  ← Phase M
- `POST /api/crm/documents/upload` — opportunity doc vault upload

**CRM — public tracker**
- `GET  /api/track/:token` · `POST /api/leads/:leadId/opportunities/:oppId/submissions/:subId/tracker-token`

**CRM — webhook intake**
- `POST /api/leads/intake/website` · `GET|POST /api/leads/intake/meta` · `POST /api/leads/referral/submit`

**HRMS — notify / letters / employees**
- `POST /api/support/raise` · `POST /api/hrms/notify/email` (Gmail API DWD)
- `POST /api/admin/hr-letters/upload`
- `POST /api/admin/employees/create` · `POST /api/hrms/employees/create`
- `POST /api/admin/employees/:uid/deactivate` · `POST /api/admin/employees/:uid/reactivate`
- `POST /api/admin/employees/import-preview` · `POST /api/admin/employees/import-confirm` · `POST /api/hrms/employees/import-from-sheet`

**MIS**
- `POST /api/mis/statements/upload` · `POST /api/mis/statements/process` · `POST /api/mis/statements/:statementId/lines`

**Scheduled-job HTTP targets (Cloud Scheduler, OIDC or admin token)**
- `POST /api/admin/run-bank-sla-check` · `POST /api/admin/run-commission-leakage-check`
- `POST /api/admin/run-document-expiry-check` · `POST /api/admin/run-leave-year-reset`
- `POST /api/admin/run-followup-check` (Phase N) · `POST /api/admin/run-daily-briefing` (Phase N)
- `POST /api/admin/run-monthly-scorecards` (Phase N) · `POST /api/admin/generate-scorecard/:uid/:period` (Phase N — manual, admin)

**SPA fallback**: `GET *` → `index.html` (prod static).

---

## Complete Firestore Collection Index (firestore.rules — as of 2026-06-06)

Every collection with a rule block. The global deny-all (`/{document=**}`) rejects anything not listed here.

**Identity & profile**: `users`, `user_details`, `employee_profiles`, `employee_sensitive`, `users/{uid}/login_history`, `users/{uid}/known_devices`

**Notifications**: `notifications/{notifId}` (legacy), `notifications/{uid}/items/{itemId}`

**CRM — leads & deals**: `leads`, `leads/{id}/opportunities`, `…/activities`, `…/bank_submissions`, `…/investments`, `…/policies`

**CRM — config**: `opportunity_types`, `providers`, `document_types`, `commission_slabs`, `commission_records`, `commission_leakage_reports`

**CRM — ops & audit**: `import_logs`, `import_jobs`, `access_requests`, `webhook_logs`, `lead_view_logs` (Phase M), `rtbf_log`, `public_tracker_links`, `crm_documents`

**HRMS — attendance & leave**: `attendance`, `attendance_regularizations`, `leave_applications`, `leave_balances`, `leave_balance_adjustments`, `leave_year_resets`, `leave_encashment_requests`, `comp_off_credits`, `holidays`

**HRMS — payroll & compliance**: `payslips`, `compliance_records`, `salary_history`, `it_declarations`, `generated_letters`

**HRMS — people ops**: `claims`, `company_documents`, `employee_documents`, `document_acknowledgements`, `announcements`, `assets`, `onboarding_checklists`, `offboarding_checklists`, `performance_reviews`, `probation_records`, `job_openings`, `candidates`, `training_programs`, `training_records`, `hr_tickets`, `profile_update_logs`

**MIS**: `commission_statements`, `commission_statements/{id}/lines`, `rm_payout_slabs`, `rm_payouts`

**Infra**: `rate_limits` (server-only), `audit_logs`, `access_logs`

**Performance (Phase N)**: `rm_targets`, `follow_up_logs`, `scorecard_logs`, `commission_statement_templates`

---

## Phase N — Performance & Target Tracking (2026-06-08)

CRM performance suite — monthly RM targets vs live actuals, smart follow-up reminders, daily briefing emails, lead-aging report, RM scorecard PDFs, and bank statement-template auto-mapping. All deterministic (thresholds, date math, aggregation of existing Firestore). No AI/LLM.

| Part | Feature | Files |
|---|---|---|
| 1 | **Targets + tracking** | `src/features/crm/hooks/useRmTargets.ts` (`useMyTargets`, `useTeamTargets`, `setTarget`, `computeActuals`, `achievementPct`); `src/features/crm/targets/TargetsPage.tsx` (`/crm/targets`) — 4 progress cards, pipeline mini-table, team table w/ totals + cell colour coding |
| 2 | **Smart follow-up reminders** | `server.ts` `POST /api/admin/run-followup-check` — active leads (open opp) with no activity >3 days → in-app `follow_up_needed` notification + RM email; per-lead-per-day dedup via `/follow_up_logs` |
| 3 | **Daily RM briefing** | `server.ts` `POST /api/admin/run-daily-briefing` — per RM: overdue SLA, stale leads, target progress, one deterministic priority action; skips RMs with no leads |
| 4 | **Lead aging report** | `src/features/crm/reports/LeadAgingPage.tsx` (`/crm/reports/aging`, admin/manager) — Fresh 0–7 / Active 8–30 / Aging 31–60 / Stale 61+ buckets, RM/stage/line filters, CSV export |
| 5 | **RM scorecard PDF** | `server.ts` `POST /api/admin/run-monthly-scorecards` (all RMs, prior month) + `POST /api/admin/generate-scorecard/:uid/:period` (manual). jsPDF in Node → Storage `scorecards/{uid}/…` → email PDF attachment to RM + admin → `/scorecard_logs`. Manual button on TargetsPage team view |
| 6 | **Statement template auto-parser** | `src/features/mis/admin/StatementTemplatesPage.tsx` (`/mis/admin/statement-templates`); `UploadStatementPage.tsx` auto-maps columns when `/commission_statement_templates/{providerId}` exists; "Save as template" on manual map; seed HDFC/SBI/ICICI/Axis/Kotak (matched to providers by name) |
| 7 | **Navigation** | CrmShell: "Targets" (badge when current-month target unset, admin/manager) + Reports → "Lead Aging"; MisShell admin: "Statement Templates" |
| 8 | **Types** | `RmTarget`, `RmActuals`, `LeadAgingBucket`, `ScorecardLog`, `StatementTemplate`; `NotificationType += 'follow_up_needed'` |

### Actuals — computed live, never stored
- **newLeads**: `/leads` where `primaryOwnerId==uid && deleted==false && createdAt >= month start`
- **leadsConverted**: collectionGroup `opportunities` where `status=='won' && ownerId==uid && actualCloseDate startsWith period`
- **disbursalAmount**: Σ `commission_records.disbursedAmount` where `rmOwnerId==uid && disbursalDate startsWith period`
- **commissionGenerated**: Σ `commission_records.actualAmount` (paid) where `rmOwnerId==uid && actualPayoutDate startsWith period`
- **Index-safe**: each query uses a single equality filter; period/date narrowing happens in memory. Scorecard activity-counts use `collectionGroup('activities').where('by',==,uid)`, backed by a `(by ASC, at DESC)` collection-group index in `firestore.indexes.json` (added 2026-06-08); the try/catch fallback remains as defense.

### Firestore rules added
`rm_targets` (read: **any signed-in** — targets are non-PII; write: admin/manager · delete: false); `follow_up_logs` + `scorecard_logs` (admin read, server-only write); `commission_statement_templates` (read: admin/misAccess · write+delete: admin). New helper `isManager()` (`crmRole=='manager'`).

### Cloud Scheduler jobs — ✅ registered & ENABLED (2026-06-08)
`followup-check` daily 09:00 IST (`30 3 * * *`) · `daily-rm-briefing` daily 08:30 IST (`0 3 * * *`) · `monthly-scorecards` 1st 07:00 IST (`30 1 1 * *`) — all in `asia-south1`, hitting `pulse-api` with OIDC (SA `787616231546-compute@developer.gserviceaccount.com`). Manage: `gcloud scheduler jobs run|pause|describe <name> --location=asia-south1`.

### Resolved follow-ups (2026-06-08)
- **Targets read rule relaxed** to `isSignedIn()` — the "target not set" nav badge now works for every RM (no permission-denied on a non-existent own target). Targets are non-PII; writes stay admin/manager only.
- **Scorecard activity index added** — `activities (by ASC, at DESC)` collection-group composite, so calls/meetings counts are real instead of silently 0.

---

## Phase O — Manager Command Centre (2026-06-08)

Single cross-module command centre for Ajay & Kumar — reads **HRMS + CRM + MIS**. Pure aggregation of existing Firestore data; **no new collections / endpoints / rules**, no AI.

**Route**: `/crm/command-centre` — access = `role === 'admin'` **OR** the per-user `commandCentreAccess` flag (toggled in Permission Manager `/hrms/admin/permissions`; admins always have it). · **File**: `src/features/crm/dashboard/CommandCentrePage.tsx`

| Section | Source collections |
|---|---|
| Header KPI chips (checked-in · pending approvals · leads overdue SLA · compliance overdue) | derived from the sections below; each chip scroll-jumps to its section |
| Team attendance today | `/attendance` (date==today) × `/users` (active) → Present / On-Leave / Not-checked-in (last group only after 10:00 IST) |
| Pending approvals | `/leave_applications` + `/claims` (pending) · `/it_declarations` (submitted) · `/attendance_regularizations` + `/leave_encashment_requests` (pending) → deep-links to HRMS admin pages |
| Pipeline health | collectionGroup `opportunities` (open + won), `rm_targets` target/achievement via `useTeamTargets`, open pipeline by business line, overdue-SLA count |
| RM targets snapshot | `useTeamTargets(period)` — table (desktop) / cards (mobile); deterministic 🟢 On track / 🟡 Watch / 🔴 Behind |
| Compliance alerts | `/compliance_records` — overdue/due_soon computed from `dueDate`/`filedAt` (same logic as ComplianceCalendarPage) |
| Recent activity feed | `/audit_logs` (5) + recent `/leave_applications` (3) + paid `/commission_records` (3), merged & sorted DESC, max 10 |

**Navigation**: CrmShell nav "Command Centre" at the **TOP** (admin or `commandCentreAccess`) with a red badge = total pending approvals; LauncherPage **4th card** "Command Centre" for the same.

**Access management**: `commandCentreAccess: boolean` on `/users/{uid}`, toggled via a "⌘ Cmd Centre" checkbox in the CRM-access cell of the Permission Manager. UI-gating only (no rules dependency). A **non-admin grantee also needs `crmAccess`** to enter the CRM shell, and **`isHrmsManager`** for the HR sections to populate (those collections are rule-gated to admin/HR-manager). Admins/super-admins have everything.

**Mobile (< md)**: KPI chips 2×2; attendance avatars horizontal-scroll; RM targets render as cards not a table; pipeline business-line bars hidden (totals only); all sections stack.

Reuses `useRmTargets` (`useTeamTargets`, `achievementPct`) for the targets/pipeline maths — no duplicated actuals logic.

**Resilience**: each of the ~14 cross-module queries loads **fail-safe** (per-query `.catch` → empty) so a denied or unindexed collection degrades only its own section instead of blanking the whole dashboard. (A plain `Promise.all` would reject the entire batch on a single failure.)
